"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { getAppData, settingsOf, useAppData, useIsClient } from "@/lib/store";
import {
  expectedMinutesOf,
  formatMinutes,
  isWeekend,
  listDaysInMonth,
  monthKey,
  todayString,
  weekdayShort,
} from "@/lib/time";
import type { DaySummary } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Skeleton, StatCard } from "@/components/ui";
import { StackedBarsChart, type StackedDatum } from "@/components/charts";
import { appliedOnDate } from "@/lib/debt";
import { computeDay, stackedSegments } from "@/lib/time";

function zeroSummary(date: string, expected: number): DaySummary {
  return {
    date,
    workedMinutes: 0,
    expectedMinutes: expected,
    balanceMinutes: 0,
    excessMinutes: 0,
    registrableMinutes: 0,
    status: "empty",
    open: false,
    entryCount: 0,
  };
}

function statusBadgeFor(status: DaySummary["status"]) {
  if (status === "excess") return <Badge tone="rose">Acima do limite</Badge>;
  if (status === "deficit") return <Badge tone="amber">Abaixo da base</Badge>;
  if (status === "in-progress") return <Badge tone="indigo">Em andamento</Badge>;
  if (status === "empty") return <Badge tone="slate">—</Badge>;
  return <Badge tone="emerald">Ok</Badge>;
}

export default function ResumoPage() {
  const mounted = useIsClient();
  const { user, entries, compensations } = useAppData();
  const settings = settingsOf(user);
  const [month, setMonth] = useState(monthKey(todayString()));

  const allDays: DaySummary[] = useMemo(() => {
    const byDate = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.date.startsWith(month)) {
        byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
      }
    }
    const expected = expectedMinutesOf(settings);
    return listDaysInMonth(month)
      .map((date) => {
        const list = byDate.get(date);
        if (!list) return zeroSummary(date, expected);
        const res = computeDay(list, settings);
        return {
          date,
          workedMinutes: res.workedMinutes,
          expectedMinutes: res.expectedMinutes,
          balanceMinutes: res.balanceMinutes,
          excessMinutes: res.excessMinutes,
          registrableMinutes: res.registrableMinutes,
          status: res.status,
          open: res.open,
          entryCount: res.entries.length,
        };
      })
      .filter((d) => d.entryCount > 0 || !isWeekend(d.date));
  }, [entries, month, settings]);

  const totals = useMemo(
    () =>
      allDays.reduce(
        (acc, d) => {
          if (d.entryCount > 0) acc.trackedDays += 1;
          acc.workedTotal += d.workedMinutes;
          acc.registrableTotal += d.registrableMinutes;
          acc.balanceTotal += d.balanceMinutes;
          acc.excessTotal += d.excessMinutes;
          return acc;
        },
        { trackedDays: 0, workedTotal: 0, registrableTotal: 0, balanceTotal: 0, excessTotal: 0 },
      ),
    [allDays],
  );

  // Dados do gráfico empilhado: blocos + compensação aplicada no dia
  const chartData: StackedDatum[] = allDays.map((d) => {
    const seg = stackedSegments(d.workedMinutes, d.expectedMinutes, settings.maxDailyMinutes);
    const used = appliedOnDate(compensations, d.date);
    return {
      date: d.date,
      label: d.date.slice(8),
      workedMinutes: d.workedMinutes,
      expectedMinutes: d.expectedMinutes,
      base: seg.base,
      extra: seg.extra,
      excess: seg.excess,
      compensated: Math.max(0, Math.min(used, Math.max(0, d.expectedMinutes - d.workedMinutes))),
    };
  });

  const changeMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const exportCsv = () => {
    const rows = [
      ["data", "dia_semana", "batidas", "trabalhado_min", "base_min", "saldo_min", "excedente_min", "no_ponto_min", "status"],
      ...allDays.map((d) => [
        d.date,
        weekdayShort(d.date),
        d.entryCount,
        d.workedMinutes,
        d.expectedMinutes,
        d.balanceMinutes,
        d.excessMinutes,
        d.registrableMinutes,
        d.status,
      ]),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `horas-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => changeMonth(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </Button>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
          />
          <Button variant="secondary" size="sm" onClick={() => changeMonth(1)} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </Button>
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download size={14} /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Dias com registro" value={totals.trackedDays} sub={`em ${month}`} icon={<BarChart3 size={16} />} />
        <StatCard
          label="Total trabalhado"
          value={formatMinutes(totals.workedTotal)}
          sub={`para registrar no ponto: ${formatMinutes(totals.registrableTotal)}`}
          icon={<BarChart3 size={16} />}
        />
        <StatCard
          label="Saldo do mês"
          value={`${totals.balanceTotal >= 0 ? "+" : ""}${formatMinutes(totals.balanceTotal)}`}
          sub={totals.balanceTotal >= 0 ? "crédito (a seu favor)" : "débito"}
          tone={totals.balanceTotal > 0 ? "emerald" : totals.balanceTotal < 0 ? "rose" : "slate"}
        />
        <StatCard
          label="Excedente (acima do limite)"
          value={formatMinutes(totals.excessTotal)}
          sub={`limite de ${formatMinutes(settings.maxDailyMinutes)}/dia`}
          tone={totals.excessTotal > 0 ? "amber" : "slate"}
        />
      </div>

      <Card
        title={`Barras empilhadas — ${month}`}
        subtitle="Base · extra no ponto · excedente (dívida) · horas compensadas"
      >
        {chartData.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={24} />}
            title="Sem dados neste mês"
            description="Registre seus horários para ver o gráfico e o resumo mensal."
          />
        ) : (
          <StackedBarsChart
            data={chartData}
            expected={expectedMinutesOf(settings)}
            cap={settings.maxDailyMinutes}
            height={210}
          />
        )}
      </Card>

      <Card title="Detalhamento diário" subtitle="Clique em um dia para ver os registros">
        {allDays.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={24} />}
            title="Sem registros neste mês"
            description="Nenhuma batida encontrada. Que tal registrar agora?"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="pb-2 pr-3">Dia</th>
                  <th className="pb-2 pr-3">Batidas</th>
                  <th className="pb-2 pr-3 text-right">Trabalhado</th>
                  <th className="pb-2 pr-3 text-right">Base</th>
                  <th className="pb-2 pr-3 text-right">Saldo</th>
                  <th className="pb-2 pr-3 text-right">No ponto*</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allDays.map((d) => (
                  <tr key={d.date} className="transition-colors hover:bg-slate-50/70">
                    <td className="py-2.5 pr-3 font-bold text-slate-800">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">
                        {d.date.slice(8)}/{d.date.slice(5, 7)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">{d.entryCount || "—"}</td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-900">
                      {d.workedMinutes > 0 ? formatMinutes(d.workedMinutes) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-400">
                      {formatMinutes(d.expectedMinutes)}
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                        d.balanceMinutes > 0
                          ? "text-emerald-600"
                          : d.balanceMinutes < 0
                            ? "text-rose-600"
                            : "text-slate-400"
                      }`}
                    >
                      {d.entryCount > 0
                        ? `${d.balanceMinutes >= 0 ? "+" : ""}${formatMinutes(d.balanceMinutes)}`
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-indigo-600">
                      {d.entryCount > 0 ? formatMinutes(d.registrableMinutes) : "—"}
                    </td>
                    <td className="py-2.5 text-right">{statusBadgeFor(d.status)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-extrabold text-slate-900">
                  <td className="py-3 pr-3">Total</td>
                  <td className="py-3 pr-3 text-slate-500">{totals.trackedDays} dia(s)</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatMinutes(totals.workedTotal)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-slate-400">
                    {formatMinutes(totals.trackedDays * expectedMinutesOf(settings))}
                  </td>
                  <td
                    className={`py-3 pr-3 text-right tabular-nums ${
                      totals.balanceTotal >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {totals.balanceTotal >= 0 ? "+" : ""}
                    {formatMinutes(totals.balanceTotal)}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-indigo-600">
                    {formatMinutes(totals.registrableTotal)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              * "No ponto" = total que pode ser lançado no sistema da empresa (limitado a{" "}
              {formatMinutes(settings.maxDailyMinutes)}/dia).
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
