"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Download, TriangleAlert, Wallet } from "lucide-react";
import { settingsOf, useAppData, useIsClient } from "@/lib/store";
import { formatMinutes, isRealizedDate, todayString, weekdayShort } from "@/lib/time";
import { effectiveFaltas } from "@/lib/faltas";
import {
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  listDaysBetween,
  periodLabel,
  samePointPeriod,
  type PointPeriod,
} from "@/lib/periods";
import { pendingPunchDates } from "@/lib/pending-punches";
import { buildDebtDays } from "@/lib/debt";
import { specialExcessBook } from "@/lib/hour-bank";
import {
  buildResumoDayRow,
  isQuietResumoDay,
  resumoEventKind,
  resumoFinancialFrozen,
  type ResumoDayRow,
} from "@/lib/resumo-days";
import { Badge, Button, Card, EmptyState, Skeleton, StatCard } from "@/components/ui";
import { StackedPeriodChart } from "@/components/stacked-period-chart";

export default function ResumoPage() {
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendars, faltas, excessReasons } = useAppData();
  const settings = settingsOf(user);
  const todayStr = todayString();
  const currentPeriod = getPointPeriod(todayStr);
  const [period, setPeriod] = useState<PointPeriod>(() => getPointPeriod(todayString()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const viewingCurrentPeriod = samePointPeriod(period, currentPeriod);

  const allDays = useMemo(() => {
    return listDaysBetween(period.from, period.to)
      .map((date) =>
        buildResumoDayRow({
          date,
          today: todayStr,
          entries,
          absences,
          calendars: companyCalendars,
          settings,
          faltas,
          controlStartDate: user.controlStartDate,
        }),
      )
      .filter(isQuietResumoDay);
  }, [entries, absences, companyCalendars, faltas, settings, period, todayStr, user.controlStartDate]);

  const totals = useMemo(
    () =>
      allDays.reduce(
        (acc, d) => {
          if (d.entryCount > 0 && isRealizedDate(d.date, todayStr)) acc.trackedDays += 1;
          acc.workedTotal += d.workedMinutes;
          acc.registrableTotal += d.registrableMinutes;
          // Mesmo agregador central usado em Registros; dias sem dados e jornada aberta = 0.
          acc.balanceTotal += d.balanceContribution;
          acc.excessTotal += d.excessMinutes;
          return acc;
        },
        { trackedDays: 0, workedTotal: 0, registrableTotal: 0, balanceTotal: 0, excessTotal: 0 },
      ),
    [allDays, todayStr],
  );

  const detailStats = useMemo(() => {
    const debts = buildDebtDays(
      entries,
      compensations,
      settings,
      period,
      absences,
      companyCalendars,
      effectiveFaltas(faltas, todayStr),
      todayStr,
    );
    const acordo = debts.filter((d) => d.kind === "acordo");
    let vacationDays = 0, healthDays = 0, waivedDays = 0;
    for (const d of allDays) {
      if (d.absence?.kind === "ferias") vacationDays += 1;
      if (d.absence?.kind === "saude") healthDays += 1;
      if (d.absence && (d.absence.kind === "outro" || (d.absence.kind === "acordado" && d.absence.treatment === "dispensado"))) {
        waivedDays += 1;
      }
    }
    let compensatedMinutes = 0, pendingCompMinutes = 0;
    for (const c of compensations) {
      if (c.sourceDate < period.from || c.sourceDate > period.to) continue;
      if (c.status === "concluida") compensatedMinutes += c.minutes;
      if (c.status === "pendente") pendingCompMinutes += c.minutes;
    }
    let faltaDays = 0, faltaPrevistaDays = 0;
    for (const f of faltas) {
      if (f.date < period.from || f.date > period.to) continue;
      if (f.date <= todayStr) faltaDays += 1;
      else faltaPrevistaDays += 1;
    }
    return {
      workedDays: totals.trackedDays,
      workedMinutes: totals.workedTotal,
      registrableMinutes: totals.registrableTotal,
      balanceMinutes: totals.balanceTotal,
      excessMinutes: totals.excessTotal,
      deficitMinutes: allDays.reduce((s, d) => s + d.deficitContribution, 0),
      compensatedMinutes,
      pendingCompMinutes,
      vacationDays,
      healthDays,
      waivedDays,
      faltaDays,
      faltaPrevistaDays,
      acordoTotal: acordo.reduce((s, d) => s + d.debtMinutes, 0),
      acordoDone: acordo.reduce((s, d) => s + d.concludedMinutes, 0),
      acordoPending: acordo.reduce((s, d) => s + d.remainingMinutes, 0),
      pendingPunches: pendingPunchDates(entries, settings, todayStr, period).length,
      missingRecords: allDays.filter((d) => d.missingExpected).length,
    };
  }, [allDays, totals, entries, compensations, settings, period, absences, companyCalendars, faltas, todayStr]);

  const periodExcessBook = useMemo(
    () =>
      specialExcessBook(
        entries, compensations, absences, companyCalendars, settings, excessReasons, period, todayStr,
      ),
    [entries, compensations, absences, companyCalendars, settings, excessReasons, period, todayStr],
  );

  const exportCsv = () => {
    const rows = [
      ["data", "dia_semana", "evento", "batidas", "trabalhado_min", "jornada_efetiva_min", "saldo_min", "excedente_min", "no_ponto_min"],
      ...allDays.map((d) => [
        d.date,
        weekdayShort(d.date),
        d.eventLabel ?? "",
        d.entryCount,
        d.workedMinutes,
        d.expectedMinutes,
        d.balanceMinutes,
        d.excessMinutes,
        d.registrableMinutes,
      ]),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resumo-${period.from}_${period.to}.csv`;
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPeriod(getPreviousPointPeriod(period))} aria-label="Período anterior">
            <ChevronLeft size={16} />
          </Button>
          <div className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-extrabold text-slate-800">
            Período do ponto: {periodLabel(period)}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setPeriod(getNextPointPeriod(period))} aria-label="Próximo período">
            <ChevronRight size={16} />
          </Button>
          {!viewingCurrentPeriod && (
            <Button variant="secondary" size="sm" onClick={() => setPeriod(currentPeriod)}>
              Período atual
            </Button>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download size={14} /> Exportar CSV
        </Button>
      </div>

      {(() => {
        const n = pendingPunchDates(entries, settings, todayStr, period).length;
        if (n <= 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-amber-800">Registros pendentes: {n}</p>
              <p className="mt-0.5 text-xs text-amber-700">O saldo pode sofrer alteração após a correção dos registros pendentes.</p>
            </div>
            <Link href="/registros?pendentes=1">
              <Button size="sm" variant="warning">Ver pendências</Button>
            </Link>
          </div>
        );
      })()}
      {detailStats.missingRecords > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-amber-800">Dias sem registro: {detailStats.missingRecords}</p>
            <p className="mt-0.5 text-xs text-amber-700">Existem dias de expediente sem registro ou justificativa.</p>
          </div>
          <Link href="/registros?semRegistro=1">
            <Button size="sm" variant="warning">Ver dias sem registro</Button>
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4">
        <StatCard label="Dias com registro" value={totals.trackedDays} sub={`no período`} icon={<CalendarDays size={16} />} />
        <StatCard
          label="Total trabalhado"
          value={formatMinutes(totals.workedTotal)}
          sub={`para registrar no ponto: ${formatMinutes(totals.registrableTotal)}`}
          icon={<Clock3 size={16} />}
        />
        <StatCard
          label="Saldo do período"
          value={`${totals.balanceTotal >= 0 ? "+" : ""}${formatMinutes(totals.balanceTotal)}`}
          sub={totals.balanceTotal >= 0 ? "crédito (a seu favor)" : "débito"}
          tone={totals.balanceTotal > 0 ? "emerald" : totals.balanceTotal < 0 ? "rose" : "slate"}
          icon={<Wallet size={16} />}
        />
        <StatCard
          label="Excedente do período [10+]"
          value={formatMinutes(periodExcessBook.original)}
          sub={
            <span className="block truncate">
              Realocado {formatMinutes(periodExcessBook.realized)}
              {" · "}
              A realocar {formatMinutes(Math.max(0, periodExcessBook.original - periodExcessBook.realized))}
            </span>
          }
          tone={periodExcessBook.original > 0 ? "violet" : "slate"}
          icon={<TriangleAlert size={16} />}
        />
      </div>

      <div>
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
        >
          <span>{detailsOpen ? "Ocultar detalhes do período" : "Ver mais detalhes do período"}</span>
          {detailsOpen ? <ChevronUp size={18} className="shrink-0 text-slate-500" /> : <ChevronDown size={18} className="shrink-0 text-slate-500" />}
        </button>
        {detailsOpen && (
          <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
            <DetailColumn title="Jornada e saldo">
              <DetailRow label="No ponto" value={formatMinutes(detailStats.registrableMinutes)} />
              <DetailRow label="Déficit do período" value={formatMinutes(detailStats.deficitMinutes)} />
            </DetailColumn>
            <DetailColumn title="Compensações">
              <DetailRow label="Horas compensadas" value={formatMinutes(detailStats.compensatedMinutes)} />
              <DetailRow label="Compensações pendentes" value={formatMinutes(detailStats.pendingCompMinutes)} />
              <DetailRow
                label="Acordo a compensar"
                value={formatMinutes(detailStats.acordoTotal)}
                hint={`feito ${formatMinutes(detailStats.acordoDone)} · falta ${formatMinutes(detailStats.acordoPending)}`}
              />
            </DetailColumn>
            <DetailColumn title="Ausências e abonos">
              <DetailRow label="Férias" value={String(detailStats.vacationDays)} />
              <DetailRow label="Saúde" value={String(detailStats.healthDays)} />
              <DetailRow label="Dispensados" value={String(detailStats.waivedDays)} />
              <DetailRow label="Faltas" value={String(detailStats.faltaDays)} />
              <DetailRow label="Faltas previstas" value={String(detailStats.faltaPrevistaDays)} />
            </DetailColumn>
          </div>
        )}
      </div>

      <Card
        title="Barras empilhadas do período"
        subtitle="Base · extra no ponto · excedente do limite diário · horas compensadas — férias/afastamentos reduzem a base"
      >
        {/* Preparação + componente COMPARTILHADOS (src/components/stacked-period-chart):
            mesma fonte usada pela Visão geral — dados idênticos para o mesmo período. */}
        <StackedPeriodChart
          entries={entries}
          compensations={compensations}
          absences={absences}
          companyCalendars={companyCalendars}
          settings={settings}
          period={period}
          faltas={faltas}
          today={todayStr}
          height={210}
        />
      </Card>

      <Card title="Detalhamento diário" subtitle="Clique em um dia na aba Registros para ver as batidas">
        {allDays.length === 0 ? (
          <EmptyState icon={<BarChart3 size={24} />} title="Sem registros neste período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="pb-2 pr-3">Dia</th>
                  <th className="pb-2 pr-3">Evento</th>
                  <th className="pb-2 pr-3 text-right">Trabalhado</th>
                  <th className="pb-2 pr-3 text-right">Jornada</th>
                  <th className="pb-2 pr-3 text-right">Saldo</th>
                  <th className="pb-2 pr-3 text-right">No ponto*</th>
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
                    <td className="py-2.5 pr-3">
                      <ResumoEventBadge day={d} />
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-900">
                      {resumoFinancialFrozen(d) || d.workedMinutes <= 0 ? "—" : formatMinutes(d.workedMinutes)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-400">
                      {formatMinutes(d.expectedMinutes)}
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                        resumoFinancialFrozen(d)
                          ? "text-slate-400"
                          : d.balanceMinutes > 0
                            ? "text-emerald-600"
                            : d.balanceMinutes < 0
                              ? "text-rose-600"
                              : "text-slate-400"
                      }`}
                    >
                      {resumoFinancialFrozen(d) || d.faltaStatus === "prevista" || !(d.entryCount > 0 || d.eventLabel)
                        ? "—"
                        : `${d.balanceMinutes >= 0 ? "+" : ""}${formatMinutes(d.balanceMinutes)}`}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-indigo-600">
                      {resumoFinancialFrozen(d) || d.entryCount <= 0 ? "—" : formatMinutes(d.registrableMinutes)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-extrabold text-slate-900">
                  <td className="py-3 pr-3">Total</td>
                  <td className="py-3 pr-3 text-slate-500">{totals.trackedDays} dia(s)</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatMinutes(totals.workedTotal)}</td>
                  <td className="py-3 pr-3" />
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
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              * &quot;No ponto&quot; = total que pode ser lançado no sistema da empresa (limitado a{" "}
              {formatMinutes(settings.maxDailyMinutes)}/dia). Férias e afastamentos reduzem a jornada
              esperada do dia.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function ResumoEventBadge({ day }: { day: ResumoDayRow }) {
  const kind = resumoEventKind(day);
  if (kind === "—") return <span className="text-xs text-slate-300">—</span>;
  const tone =
    kind === "Sem registro" || kind === "Registro inconsistente" || kind === "Registro incompleto"
      ? "amber"
      : kind === "Jornada abaixo do previsto"
        ? "rose"
        : kind === "Acima do limite [10+]"
          ? "violet"
          : kind === "Folga"
            ? "sky"
            : kind === "Ok"
              ? "emerald"
              : kind === "Em andamento"
                ? "indigo"
                : kind === "Falta"
                  ? "rose"
                  : "sky";
  return <Badge tone={tone}>{kind}</Badge>;
}

function DetailColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-50/80 px-3.5 py-3 ring-1 ring-slate-100">
      <h3 className="mb-3 text-[13px] font-bold text-slate-800">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="min-w-0 shrink text-xs text-slate-500">
        {label}
        {hint ? <span className="mt-0.5 block text-[11px] font-medium text-slate-400">{hint}</span> : null}
      </dt>
      <dd className="ml-auto shrink-0 text-right text-sm font-extrabold tabular-nums leading-snug text-slate-800">{value}</dd>
    </div>
  );
}
