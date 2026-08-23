"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  CalendarClock,
  Clock3,
  PlusCircle,
  Timer,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { actions, enrichComp, settingsOf, useAppData, useIsClient } from "@/lib/store";
import {
  addDays,
  computeDay,
  expectedMinutesOf,
  formatDateShortBR,
  formatMinutes,
  nowMinutesLocal,
  todayString,
  weekdayShort,
  type EntryType,
} from "@/lib/time";
import { dayContext } from "@/lib/absences";
import { companyDayContext } from "@/lib/company-calendar";
import {
  annualCycleBounds,
  getAnnualPointCycle,
  getPointPeriod,
  periodLabel,
  sameAnnualCycle,
} from "@/lib/periods";
import { activeAcordos, canCompleteComp, extraCapacityForDate } from "@/lib/debt";
import type { CompKind, DayResult, DaySummary } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Skeleton, StatCard } from "@/components/ui";
import { QuickPunch } from "@/components/quick-punch";
import { BarsChart, type BarDatum } from "@/components/charts";
import { ExcessPanel } from "@/components/excess-panel";
import { SmartExit } from "@/components/smart-exit";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";
import { useToast } from "@/components/toast";

function toSummary(d: DayResult, date?: string): DaySummary {
  return {
    date: date ?? d.date,
    workedMinutes: d.workedMinutes,
    expectedMinutes: d.expectedMinutes,
    balanceMinutes: d.balanceMinutes,
    excessMinutes: d.excessMinutes,
    registrableMinutes: d.registrableMinutes,
    status: d.status,
    open: d.open,
    entryCount: d.entries.length,
  };
}

export default function DashboardPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendar } = useAppData();
  const settings = settingsOf(user);
  const todayStr = todayString();
  const period = getPointPeriod(todayStr);
  const [compOpen, setCompOpen] = useState(false);
  const [compDraft, setCompDraft] = useState<{ kind: CompKind; initial: CompFormData } | null>(null);

  // Relógio: mantém previsão de saída e horas "em andamento" em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

  const { monthDays, totals, today, todayCtx, recent, pending } = useMemo(() => {
    const byDate = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.date >= period.from && e.date <= period.to) {
        byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
      }
    }

    const days: DaySummary[] = [];
    for (const [date, list] of byDate) {
      // Saldo do período considera a jornada efetiva (férias/afastamentos)
      const ctx = dayContext(date, entries, absences, settings);
      const s = toSummary(computeDay(list, settings), date);
      s.expectedMinutes = ctx.effectiveExpected;
      s.balanceMinutes = ctx.adjustedBalance;
      days.push(s);
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    const sum = days.reduce(
      (acc, d) => {
        acc.trackedDays += 1;
        acc.workedTotal += d.workedMinutes;
        acc.registrableTotal += d.registrableMinutes;
        acc.balanceTotal += d.balanceMinutes;
        acc.excessTotal += d.excessMinutes;
        return acc;
      },
      { trackedDays: 0, workedTotal: 0, registrableTotal: 0, balanceTotal: 0, excessTotal: 0 },
    );

    const tCtx = companyDayContext(todayStr, entries, absences, companyCalendar, settings, nowMinutes);
    const todays = tCtx.displayDay;

    const recents: DaySummary[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(todayStr, -i);
      recents.push(toSummary(computeDay(entries.filter((e) => e.date === d), settings), d));
    }

    // Regra 15: pendências de ciclos encerrados NÃO aparecem como ativas no ciclo atual
    const pend = compensations
      .filter((c) => c.status === "pendente" && sameAnnualCycle(c.sourceDate, todayStr))
      .map((c) => enrichComp(c, entries, settings))
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate));

    return { monthDays: days, totals: sum, today: todays, todayCtx: tCtx, recent: recents, pending: pend };
  }, [entries, compensations, absences, companyCalendar, settings, period, todayStr, nowMinutes]);

  const range = period;

  const onAddEntry = async (p: { date: string; time: string; type: EntryType; note: string | null }) => {
    actions.addEntry(p);
  };

  const onDeleteEntry = async (id: number) => actions.deleteEntry(id);

  const completeComp = async (id: number) => {
    const res = actions.completeComp(id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível concluir.", "error");
      return;
    }
    toast.show("Compensação concluída. Bom descanso!");
  };

  const createComp = async (payload: CompFormData & { kind?: CompKind }) => {
    const res = actions.addComp({
      sourceDate: payload.sourceDate,
      targetDate: payload.targetDate,
      minutes: payload.minutes,
      note: payload.note || null,
      kind: payload.kind ?? "excedente",
    });
    if (!res.ok) throw new Error(res.error); // modal exibe a mensagem e permanece aberto
    setCompOpen(false);
    toast.show("Compensação criada!");
  };

  /** Saída em 1 clique: registra a saída (hora atual) e quita compensações de saída antecipada. */
  const smartExit = async (time: string, compIds: number[]) => {
    actions.addEntry({
      date: todayStr,
      time,
      type: "saida",
      note: "Saída sugerida pelo assistente",
    });
    for (const id of compIds) actions.completeComp(id);
    toast.show(
      compIds.length > 0
        ? `Saída registrada às ${time} e compensação concluída!`
        : `Saída registrada às ${time}!`,
    );
  };

  /** Confirmação manual de quitação por hora extra (sem registrar saída). */
  const confirmComps = async (compIds: number[]) => {
    let done = 0;
    for (const id of compIds) {
      const res = actions.completeComp(id);
      if (!res.ok) toast.show(res.error ?? "Não foi possível concluir.", "error");
      else done += 1;
    }
    if (done > 0) toast.show("Quitação confirmada — déficit abatido!");
  };

  /** Acordos a compensar ativos do ciclo anual atual (independe do período 21→20). */
  const acordos = useMemo(() => {
    const bounds = annualCycleBounds(getAnnualPointCycle(todayStr));
    return activeAcordos(entries, compensations, settings, bounds, absences);
  }, [entries, compensations, absences, settings, todayStr]);

  /** Abre o formulário central já preenchido para quitar um acordo/déficit. */
  const openExtraForm = (kind: CompKind, sourceDate: string, minutes: number) => {
    setCompDraft({
      kind,
      initial: {
        sourceDate,
        targetDate: todayStr,
        minutes,
        note: kind === "acordo" ? `Acordo de ${formatDateShortBR(sourceDate)}` : `Déficit de ${formatDateShortBR(sourceDate)}`,
      },
    });
    setCompOpen(true);
  };

  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-56" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const t = today;
  /* Visão geral exige "Folga hoje"; a resolução central usa "Folga" (listas). */
  const todayLabel = todayCtx.type === "folga" ? "Folga hoje" : (todayCtx.label ?? undefined);
  const balanceTone = totals.balanceTotal > 0 ? "emerald" : totals.balanceTotal < 0 ? "rose" : "slate";
  const excessTone = totals.excessTotal > 0 ? "rose" : "slate";
  const todayStatusTone =
    t.status === "excess" ? "rose" : t.status === "deficit" ? "amber" : t.status === "in-progress" ? "indigo" : "slate";
  const firstName = user.name.split(" ")[0];

  const chartData: BarDatum[] = recent.map((d) => ({
    label: weekdayShort(d.date).replace(".", ""),
    value: d.workedMinutes,
    baseline: d.expectedMinutes,
    cap: settings.maxDailyMinutes,
    status: d.status,
  }));

  const recentDays = [...recent].filter((d) => d.entryCount > 0).slice(-7).reverse();

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">
            Olá, {firstName}! 👋
          </h2>
          <p className="text-sm text-slate-500">
            {todayCtx.type === "folga"
              ? "Folga hoje. Se você registrar trabalho, as horas serão contabilizadas como trabalho em folga."
              : todayCtx.type === "trabalho-folga"
                ? "Trabalho em folga registrado hoje."
                : t.empty
                  ? "Você ainda não bateu o ponto hoje. Registre sua entrada abaixo."
                  : t.open
                    ? "Seu ponto de hoje está em andamento."
                    : "Seu ponto de hoje está fechado."}
          </p>
        </div>
        <Link href="/registros">
          <Button variant="secondary">
            <CalendarClock size={15} /> Ver registros
          </Button>
        </Link>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Hoje"
          value={formatMinutes(t.workedMinutes)}
          sub={
            <>
              {todayCtx.type === "folga" || todayCtx.type === "trabalho-folga"
                ? `${todayLabel} · esperado ${formatMinutes(t.expectedMinutes)}`
                : `base ${formatMinutes(t.expectedMinutes || expectedMinutesOf(settings))}`} ·{" "}
              <span className={t.balanceMinutes >= 0 ? "text-emerald-600" : "text-rose-600"}>
                {t.balanceMinutes >= 0 ? "+" : ""}
                {formatMinutes(t.balanceMinutes)}
              </span>
            </>
          }
          tone={todayStatusTone}
          icon={<Timer size={16} />}
        />
        <StatCard
          label="Saldo do período"
          value={`${totals.balanceTotal >= 0 ? "+" : ""}${formatMinutes(totals.balanceTotal)}`}
          sub={totals.balanceTotal >= 0 ? "horas a seu favor (crédito)" : "horas em débito — atenção"}
          tone={balanceTone}
          icon={<Wallet size={16} />}
        />
        <StatCard
          label="Excedente do período"
          value={formatMinutes(totals.excessTotal)}
          sub={`acima de ${formatMinutes(settings.maxDailyMinutes)}/dia · ${totals.trackedDays} dia(s) registrados`}
          tone={excessTone}
          icon={<TriangleAlert size={16} />}
        />
        <StatCard
          label="Compensações pendentes"
          value={pending.length}
          sub={
            pending.length > 0
              ? `${formatMinutes(pending.reduce((s, c) => s + c.minutes, 0))} a compensar`
              : "tudo em dia 🎉"
          }
          tone={pending.length > 0 ? "indigo" : "slate"}
          icon={<ArrowLeftRight size={16} />}
        />
      </div>

      {/* Assistente de saída + Registro rápido */}
      <SmartExit
        date={todayStr}
        day={t}
        settings={settings}
        comps={compensations}
        nowMinutes={nowMinutes}
        onSmartExit={smartExit}
        onConfirmComps={confirmComps}
        isToday
        effectiveExpected={todayCtx.effectiveExpected}
      />

      <QuickPunch
        today={t}
        todayStr={todayStr}
        settings={settings}
        dayLabel={todayCtx.type === "regular" ? undefined : todayLabel}
        onAddEntry={onAddEntry}
        onDeleteEntry={onDeleteEntry}
      />

      {/* Gestão de excedentes */}
      <div>
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-slate-400">
          Gestão de Excedentes
        </h3>
        <div className="space-y-6">
          <ExcessPanel
            entries={entries}
            compensations={compensations}
            absences={absences}
            companyCalendar={companyCalendar}
            settings={settings}
            range={range}
            monthLabel={periodLabel(period)}
            onCreateComp={createComp}
          />
        </div>
      </div>

      {/* Acordos a compensar — ativos no ciclo anual, independentemente do período */}
      <Card
        title="Acordos a compensar"
        subtitle={`Pendências ativas do ciclo anual ${getAnnualPointCycle(todayStr)} — visíveis até quitação ou fechamento anual (30/04)`}
      >
        {acordos.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nenhum acordo pendente neste ciclo anual.
          </p>
        ) : (
          <ul className="space-y-3">
            {acordos.map((d) => (
              <li key={d.date} className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">
                    Acordo a compensar — {formatMinutes(d.originalMinutes)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Origem: {formatDateShortBR(d.date)} · Ciclo anual:{" "}
                    {getAnnualPointCycle(d.date)} · Compensado:{" "}
                    <b className="text-emerald-600">{formatMinutes(d.compensatedMinutes)}</b> ·
                    Restante: <b className="text-amber-600">{formatMinutes(d.remainingMinutes)}</b>
                    {d.plannedMinutes > 0 && (
                      <> · Planejado: <b className="text-sky-600">{formatMinutes(d.plannedMinutes)}</b></>
                    )}
                  </p>
                </div>
                {d.remainingMinutes > 0 && (
                  <Button size="sm" variant="subtle" onClick={() => openExtraForm("acordo", d.date, d.remainingMinutes)}>
                    Compensar com hora extra
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Compensações pendentes */}
        <Card
          title="Compensações pendentes"
          subtitle="Horas excedentes que precisam ser compensadas"
          actions={
            <Button size="sm" variant="subtle" onClick={() => { setCompDraft(null); setCompOpen(true); }}>
              <PlusCircle size={13} /> Nova
            </Button>
          }
        >
          {pending.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight size={24} />}
              title="Nenhuma compensação pendente"
              description="Quando um dia passar de 10h, crie uma compensação para o dia seguinte."
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800">
                      Compensar {formatMinutes(c.minutes)}{" "}
                      <span className="font-medium text-slate-400">
                        ({(c.kind ?? "excedente") === "deficit" ? "hora extra de " : "excedente de "}
                        {formatDateShortBR(c.sourceDate)})
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {c.targetDate === todayStr && (
                        <span className="font-bold text-indigo-600">Hoje · </span>
                      )}
                      até {formatDateShortBR(c.targetDate)}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  <Badge
                    tone={
                      (c.kind ?? "excedente") === "deficit"
                        ? "emerald"
                        : (c.kind ?? "excedente") === "acordo"
                          ? "indigo"
                          : "indigo"
                    }
                  >
                    {(c.kind ?? "excedente") === "deficit"
                      ? "hora extra"
                      : (c.kind ?? "excedente") === "acordo"
                        ? "hora extra · acordo"
                        : "sair cedo"}
                  </Badge>
                  {(() => {
                    const isExtra = c.kind === "deficit" || c.kind === "acordo";
                    const check = isExtra
                      ? canCompleteComp(c, entries, compensations, settings, todayStr)
                      : { ok: true };
                    return (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!check.ok}
                        title={check.ok ? undefined : check.error}
                        onClick={() => completeComp(c.id)}
                      >
                        {isExtra && check.ok ? "Confirmar quitação" : "Concluir"}
                      </Button>
                    );
                  })()}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Últimos 14 dias */}
        <Card title="Últimos 14 dias" subtitle="Horas trabalhadas por dia vs. base diária">
          <BarsChart data={chartData} height={150} />
        </Card>
      </div>

      {/* Dias recentes */}
      <Card title="Dias recentes" subtitle="Seus últimos dias com registro">
        {recentDays.length === 0 ? (
          <EmptyState
            icon={<Clock3 size={24} />}
            title="Nenhum registro ainda"
            description="Use o registro rápido acima ou a página de Registros para começar."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {recentDays.map((d) => (
              <Link key={d.date} href="/registros" className="flex items-center gap-3 py-3 transition-colors hover:bg-slate-50/70">
                <span className="w-24 shrink-0 text-sm font-bold text-slate-800">
                  {weekdayShort(d.date).replace(".", "")}
                  <span className="ml-1.5 font-medium text-slate-400">{formatDateShortBR(d.date)}</span>
                </span>
                <span className="hidden text-xs text-slate-400 sm:block">{d.entryCount} batida(s)</span>
                <span className="ml-auto text-sm font-extrabold tabular-nums text-slate-900">
                  {formatMinutes(d.workedMinutes)}
                </span>
                <span
                  className={`w-20 text-right text-xs font-bold tabular-nums ${
                    d.balanceMinutes > 0 ? "text-emerald-600" : d.balanceMinutes < 0 ? "text-rose-600" : "text-slate-400"
                  }`}
                >
                  {d.balanceMinutes >= 0 ? "+" : ""}
                  {formatMinutes(d.balanceMinutes)}
                </span>
                {d.excessMinutes > 0 ? <Badge tone="rose">+10h</Badge> : <Badge tone="slate">ok</Badge>}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <CompensationForm
        open={compOpen}
        onClose={() => {
          setCompOpen(false);
          setCompDraft(null);
        }}
        kind={compDraft?.kind ?? "excedente"}
        initial={compDraft?.initial}
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings)
        }
        onSave={createComp}
      />
    </div>
  );
}
