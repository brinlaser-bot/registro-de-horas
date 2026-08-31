"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Cake,
  CalendarClock,
  Clock3,
  PlusCircle,
  Timer,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { actions, enrichComp, getAppData, settingsOf, useAppData, useIsClient } from "@/lib/store";
import { useSpecialPunchActions } from "@/components/special-release-confirm";
import {
  addDays,
  computeDay,
  formatDateShortBR,
  formatMinutes,
  FUTURE_DATE_ERROR,
  isFutureDate,
  nowMinutesLocal,
  todayString,
  weekdayShort,
  type EntryType,
} from "@/lib/time";
import { isBirthdayToday } from "@/lib/absences";
import { companyDayContext } from "@/lib/company-calendar";
import {
  getPointPeriod,
  listDaysBetween,
  periodLabel,
  sameAnnualCycle,
} from "@/lib/periods";
import { canCompleteComp, extraCapacityForDate, kindOf, usesHourExtra } from "@/lib/debt";
import { compensarObligationOnDate, isAbonadoDay } from "@/lib/compensar";
import { canRegisterFalta, dayBalanceContribution, faltaOnDate } from "@/lib/faltas";
import { excessReasonOnDate, shouldPromptExcessReason } from "@/lib/hour-bank";
import { pendingPunchDatesInCycle } from "@/lib/pending-punches";
import { buildResumoDayRow, resumoFinancialFrozen, type ResumoDayRow } from "@/lib/resumo-days";
import { HourBankCard } from "@/components/hour-bank-card";
import { ExcessReasonModal } from "@/components/excess-reason-modal";
import type { CompKind, DayResult, DaySummary } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ExcessTenBadge, Skeleton, StatCard } from "@/components/ui";
import { QuickPunch } from "@/components/quick-punch";
import { ExcessPanel } from "@/components/excess-panel";
import { StackedPeriodChart } from "@/components/stacked-period-chart";
import { SmartExit } from "@/components/smart-exit";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";
import { useToast } from "@/components/toast";

/**
 * 3H — Situação canônica de um dia em "Dias recentes".
 * Consome a classificação central (buildResumoDayRow — a MESMA de
 * Registros/Resumo); apenas traduz status → rótulo/tom usando a MESMA
 * nomenclatura dos cards de Registros (statusBadge + estados inválidos).
 * Dias financeiramente congelados nunca exibem saldo como definitivo.
 */
export function recentDayStatusOf(row: ResumoDayRow): { label: string; tone: "amber" | "rose" | "indigo" | "emerald" | "slate" | "sky" } {
  switch (row.status) {
    case "incomplete":
      return { label: "Registro incompleto", tone: "amber" };
    case "inconsistent":
      return { label: "Registro inconsistente", tone: "amber" };
    case "deficit":
      return { label: "Abaixo da base", tone: "amber" };
    case "in-progress":
      return { label: "Em andamento", tone: "indigo" };
    case "falta":
      return { label: "Falta", tone: "rose" };
    case "ferias":
      return { label: "Férias", tone: "sky" };
    case "afastamento":
      return { label: "Afastamento", tone: "sky" };
    case "empty":
      return { label: "Sem registros", tone: "slate" };
    default:
      // "ok" (base cumprida, inclusive com saldo positivo) — excess é
      // tratado pelo chip [10+] existente antes deste helper.
      return { label: "Dia ok", tone: "emerald" };
  }
}

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
  const { user, entries, compensations, absences, companyCalendars, faltas, excessReasons, specialExcessUses, specialExcessPlans } = useAppData();
  const settings = settingsOf(user);
  const todayStr = todayString();
  const period = getPointPeriod(todayStr);
  const [compOpen, setCompOpen] = useState(false);
  const [compDraft, setCompDraft] = useState<{ kind: CompKind; initial: CompFormData } | null>(null);
  const [compPlanning, setCompPlanning] = useState<{
    originalMinutes: number;
    compensatedMinutes: number;
    plannedMinutes: number;
    openMinutes: number;
    unplannedMinutes: number;
  } | null>(null);
  // §10: modal do MOTIVO do excedente (>10h) — abre automaticamente quando o
  // dia é encerrado acima de 10h; fechar sem preencher deixa ⚠ no banco.
  const [reasonDate, setReasonDate] = useState<string | null>(null);
  const [busyFalta, setBusyFalta] = useState(false);

  // Relógio: mantém previsão de saída e horas "em andamento" em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

  const { totals, today, todayCtx, recent, recentRows, pending } = useMemo(() => {
    /* §1 SALDO DO PERÍODO: percorre TODOS os dias do período de ponto com a
     * resolução central (companyDayContext — folga/fim de semana/abonado não
     * geram déficit) e soma a CONTRIBUIÇÃO CENTRAL do dia
     * (dayBalanceContribution — a MESMA fonte do Resumo do período e de
     * Registros: falta efetiva conta −jornada efetiva; falta prevista entra
     * mascarada em 0 até a data chegar). O total da Visão geral é, portanto,
     * SEMPRE igual ao do Resumo — nunca "trabalhado − 8h" por dia com batida.
     */
    const sum = { trackedDays: 0, workedTotal: 0, registrableTotal: 0, balanceTotal: 0, excessTotal: 0 };
    for (const date of listDaysBetween(period.from, period.to)) {
      const cctx = companyDayContext(date, entries, absences, companyCalendars, settings);
      const day = cctx.ctx.day;
      if (date <= todayStr && day.entries.length > 0) {
        sum.trackedDays += 1;
        sum.workedTotal += day.workedMinutes;
        sum.registrableTotal += day.registrableMinutes;
        sum.excessTotal += day.excessMinutes;
      }
      sum.balanceTotal += dayBalanceContribution(cctx, faltas, date, todayStr);
    }

    const tCtx = companyDayContext(todayStr, entries, absences, companyCalendars, settings, nowMinutes);
    const todays = tCtx.displayDay;

    /* §2 DIAS RECENTES: saldo da linha pela resolução central (regularBalance) —
     * sábado/domingo/abonado trabalhados entram como CRÉDITO (+trabalhado);
     * nunca mais "trabalhado − base 8h" (o antigo −6h/−7h de fim de semana).
     */
    const recents: DaySummary[] = [];
    const recentRows: Record<string, ResumoDayRow> = {};
    for (let i = 13; i >= 0; i--) {
      const d = addDays(todayStr, -i);
      const cctx = companyDayContext(d, entries, absences, companyCalendars, settings, d === todayStr ? nowMinutes : undefined);
      const s = toSummary(cctx.ctx.day, d);
      s.expectedMinutes = cctx.effectiveExpected;
      s.balanceMinutes = cctx.adjustedBalance;
      recents.push(s);
      // 3H: classificação CANÔNICA do dia (a MESMA de Registros/Resumo) —
      // incompleto/inconsistente/abaixo da base nunca aparecem como "ok".
      recentRows[d] = buildResumoDayRow({
        date: d,
        today: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
      });
    }

    // Regra 15: pendências de ciclos encerrados NÃO aparecem como ativas no ciclo atual
    const pend = compensations
      .filter((c) => c.status === "pendente" && sameAnnualCycle(c.sourceDate, todayStr))
      .map((c) => enrichComp(c, entries, settings))
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate));

    return { totals: sum, today: todays, todayCtx: tCtx, recent: recents, recentRows, pending: pend };
  }, [entries, compensations, absences, companyCalendars, faltas, settings, period, todayStr, nowMinutes, user]);

  const range = period;

  /** Falta "hoje": a jornada vem SEMPRE da resolução central (nunca 8h fixas). */
  const faltaHojeGate = useMemo(
    () => canRegisterFalta(todayStr, entries, absences, companyCalendars, settings, faltas),
    [todayStr, entries, absences, companyCalendars, settings, faltas],
  );
  const faltaHoje = faltaOnDate(faltas, todayStr);

  /** §3: botão discreto com confirmação simples antes de registrar a falta. */
  const registerFaltaHoje = async () => {
    if (busyFalta) return;
    const gate = canRegisterFalta(todayStr, entries, absences, companyCalendars, settings, faltas);
    if (!gate.ok) {
      toast.show(gate.error ?? "Não é possível registrar falta nesta data.", "error");
      return;
    }
    setBusyFalta(true);
    try {
      const res = actions.addFalta(todayStr);
      if (!res.ok) {
        toast.show(res.error ?? "Não foi possível registrar a falta.", "error");
        return;
      }
      toast.show("Falta registrada — o déficit corresponde à jornada do dia.");
    } finally {
      setBusyFalta(false);
    }
  };

  /** Excluir falta de hoje — sem window.confirm; mutex anti duplo clique. */
  const removeFaltaHoje = async () => {
    if (busyFalta) return;
    const f = faltaOnDate(faltas, todayStr);
    if (!f) return;
    setBusyFalta(true);
    try {
      const res = actions.removeFalta(f.id);
      if (!res.ok) {
        toast.show(res.error ?? "Não foi possível excluir a falta.", "error");
        return;
      }
      toast.show("Falta excluída");
    } finally {
      setBusyFalta(false);
    }
  };

  /**
   * §16: conflito falta ↔ nova batida — nunca ambos no mesmo dia. Confirma a
   * remoção da falta; se cancelar, NADA é alterado.
   */
  const resolveFaltaConflict = (date: string): boolean => {
    const f = faltaOnDate(faltas, date);
    if (!f) return true;
    const ok = window.confirm(
      "Existe uma falta registrada para este dia.\nDeseja remover a falta e registrar o horário?",
    );
    if (!ok) return false;
    const res = actions.removeFalta(f.id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível remover a falta.", "error");
      return false;
    }
    return true;
  };

  /** Snapshot do dia ANTES da mutation — o modal só abre na transição para >10h. */
  const snapshotDay = (date: string) => {
    const snap = getAppData();
    return computeDay(
      snap.entries.filter((e) => e.date === date),
      settingsOf(snap.user),
    );
  };

  /** §10: após MUTATION que fecha o dia acima de 10h sem motivo. Sem loop em render. */
  const promptExcessReasonIfNeeded = (date: string, before: { excessMinutes: number; open: boolean }) => {
    const snap = getAppData();
    const after = computeDay(
      snap.entries.filter((e) => e.date === date),
      settingsOf(snap.user),
    );
    if (
      shouldPromptExcessReason({
        beforeExcessMinutes: before.excessMinutes,
        beforeOpen: before.open,
        after,
        hasReason: !!excessReasonOnDate(snap.excessReasons, date),
      })
    ) {
      setReasonDate(date);
    }
  };

  const punches = useSpecialPunchActions();

  const onAddEntry = async (p: { date: string; time: string; type: EntryType; note: string | null }) => {
    // §7: data futura → bloquear ANTES de tratar qualquer conflito com falta
    if (isFutureDate(p.date)) {
      toast.show(FUTURE_DATE_ERROR, "error");
      return { ok: false as const, error: FUTURE_DATE_ERROR };
    }
    if (!resolveFaltaConflict(p.date)) return { ok: false as const };
    const before = snapshotDay(p.date);
    const res = await punches.addEntry(p);
    // §7: rejeição da validação central de sequência chega aqui (toast + erro)
    if (!res.ok) {
      // 3G: "Voltar" na confirmação de [10+] é aborto silencioso (o diálogo já é o feedback).
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? FUTURE_DATE_ERROR, "error");
      return res;
    }
    promptExcessReasonIfNeeded(p.date, before);
    return res;
  };

  const onDeleteEntry = async (id: number) => {
    const res = await punches.deleteEntry(id);
    // §25: guarda central — batida sustentando compensação concluída é bloqueada
    if (!res.ok) {
      // 3G: aborto silencioso ao escolher "Voltar" na confirmação de [10+].
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? "Não foi possível excluir o registro.", "error");
    }
    return res;
  };

  /** §8/§9: edição de batida pelo Registro rápido — validação da sequência
   *  cronológica final e guarda de compensação concluída vivem no store. O
   *  resultado volta ao modal: erro → toast e o modal PERMANECE aberto. */
  const onUpdateEntry = async (id: number, patch: { time?: string; note?: string | null }) => {
    const target = entries.find((e) => e.id === id);
    const before = target ? snapshotDay(target.date) : { excessMinutes: 0, open: false };
    const res = await punches.updateEntry(id, patch);
    if (!res.ok) {
      // 3G: aborto silencioso ao escolher "Voltar" na confirmação de [10+].
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? "Não foi possível editar o registro.", "error");
      return res;
    }
    if (target) promptExcessReasonIfNeeded(target.date, before);
    return res;
  };

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
  };

  /** Saída em 1 clique: registra a saída (hora atual) e quita compensações de saída antecipada. */
  const smartExit = async (time: string, compIds: number[]) => {
    // §7: data futura → bloquear ANTES de tratar qualquer conflito com falta
    if (isFutureDate(todayStr)) {
      toast.show(FUTURE_DATE_ERROR, "error");
      return;
    }
    if (!resolveFaltaConflict(todayStr)) return;
    const res = await punches.addEntry({
      date: todayStr,
      time,
      type: "saida",
      note: "Saída sugerida pelo assistente",
    });
    if (!res.ok) {
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
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

  if (!mounted) {
    return (
      <div className="flex flex-col gap-4 lg:gap-5">
        <div className="flex flex-col gap-3 lg:gap-4">
          <Skeleton className="h-12" />
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
          <Skeleton className="h-52" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const t = today;
  /* Visão geral exige "Folga hoje"; a resolução central usa "Folga" (listas). */
  const todayLabel = todayCtx.type === "folga" ? "Folga hoje" : (todayCtx.label ?? undefined);
  /* Card HOJE idle: jornada regular vazia, sem falta/ausência — não mostrar −8h. */
  const todayIdle =
    todayCtx.type === "regular" &&
    t.empty &&
    !faltaHoje &&
    !todayCtx.ctx.absence &&
    todayCtx.effectiveExpected > 0;
  const balanceTone = totals.balanceTotal > 0 ? "emerald" : totals.balanceTotal < 0 ? "rose" : "slate";
  const excessTone = totals.excessTotal > 0 ? "rose" : "slate";
  const todayStatusTone =
    t.status === "excess" ? "rose" : t.status === "deficit" ? "amber" : t.status === "in-progress" ? "indigo" : "slate";
  const firstName = user.name.split(" ")[0];
  /* Banner de aniversário: SOMENTE VISUAL (data local dia+mês) — nunca entra
   * em jornada, saldo, déficit ou qualquer cálculo central. */
  const birthdayToday = isBirthdayToday(user.birthDate, todayStr);

  const recentDays = [...recent].filter((d) => d.entryCount > 0 && d.date <= todayStr).slice(-7).reverse();

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {/* H: Felicitação do dia — não altera nenhum número do app */}
      {birthdayToday && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 px-4 py-3 shadow-sm">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Cake size={22} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            {/* §2: SOMENTE mensagem comemorativa — sem CTA. */}
            <p className="text-base font-extrabold text-amber-800">
              Feliz aniversário, {firstName}! 🎉
            </p>
            <p className="text-xs font-medium text-amber-600">
              Que seu novo ciclo seja repleto de alegrias, saúde e boas realizações.
            </p>
          </div>
        </div>
      )}

      {/* Bloco reordenável: no mobile o Registro de hoje sobe (bater o ponto
          sem rolagem); no desktop a ordem clássica é preservada
          (saudação → 4 cards → Registro de hoje). */}
      <div className="flex flex-col gap-3 lg:gap-4">
        {/* Cabeçalho */}
        <div className="order-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900">
              Olá, {user.name}! 👋
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {faltaHoje
                ? "Falta registrada para hoje."
                : todayCtx.type === "folga"
                  ? "Folga hoje. Se você registrar trabalho, as horas serão contabilizadas como trabalho em folga."
                  : todayCtx.type === "trabalho-folga"
                    ? "Trabalho em folga registrado hoje."
                    : !t.consistent && t.entries.length > 0
                      ? "Registro inconsistente — corrija as batidas de hoje."
                    : t.empty
                      ? "Você ainda não bateu o ponto hoje. Registre sua entrada abaixo."
                      : t.open
                        ? "Seu ponto de hoje está em andamento."
                        : "Seu ponto de hoje está fechado."}
            </p>
          </div>
          <Link href="/registros" className="shrink-0">
            <Button variant="secondary">
              <CalendarClock size={15} /> Ver registros
            </Button>
          </Link>
        </div>

        {/* Indicadores — 3º no mobile, 2º no desktop */}
        <div className="order-3 grid grid-cols-2 gap-2 lg:order-2 lg:grid-cols-4 lg:gap-3">
          <StatCard
            compact
            label="Hoje"
            value={formatMinutes(t.workedMinutes)}
            sub={
              <>
                {/* §4 rodada HOTFIX: o card HOJE usa a MESMA base efetiva central
                    do Registro rápido (companyDayContext.effectiveExpected — 0 em
                    folga/feriado/"folga a compensar"). O antigo fallback
                    `expected || jornada` engolvia base 0min (0 é falsy → 8h). */}
                {todayCtx.type === "folga" || todayCtx.type === "trabalho-folga"
                  ? `${todayLabel} · esperado ${formatMinutes(todayCtx.effectiveExpected)}`
                  : `base ${formatMinutes(todayCtx.effectiveExpected)}`}
                {todayIdle ? (
                  <> · jornada não iniciada</>
                ) : t.financialPending ? (
                  <> · pendente</>
                ) : faltaHoje ? (
                  <>
                    {" "}·{" "}
                    <span className="text-rose-600">
                      {t.balanceMinutes >= 0 ? "+" : ""}
                      {formatMinutes(t.balanceMinutes)}
                    </span>
                  </>
                ) : (
                  <>
                    {" "}·{" "}
                    <span className={t.balanceMinutes >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {t.balanceMinutes >= 0 ? "+" : ""}
                      {formatMinutes(t.balanceMinutes)}
                    </span>
                  </>
                )}
              </>
            }
            tone={todayStatusTone}
            icon={<Timer size={16} />}
          />
          <StatCard
            compact
            label="Saldo do período"
            value={`${totals.balanceTotal >= 0 ? "+" : ""}${formatMinutes(totals.balanceTotal)}`}
            sub={totals.balanceTotal >= 0 ? "horas a seu favor (crédito)" : "horas em débito — atenção"}
            tone={balanceTone}
            icon={<Wallet size={16} />}
          />
          <StatCard
            compact
            label="Excedente do período"
            value={formatMinutes(totals.excessTotal)}
            sub={<>excedente do limite diário <ExcessTenBadge /> · {totals.trackedDays} dia(s) registrados</>}
            tone={excessTone}
            icon={<TriangleAlert size={16} />}
          />
          <StatCard
            compact
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

        {/* §7–§14 REGISTRO DE HOJE — Ponto + Assistente de jornada em UM ÚNICO
            card. Mobile: sobe para logo após a saudação (order-2). Desktop:
            permanece depois dos 4 indicadores (lg:order-3). Componentes
            reutilizados no modo embutido (§7: sem duplicar lógica; §10/§11:
            todas as funções do Registro rápido e do Smart Exit preservadas). */}
        {(() => {
          const nPending = pendingPunchDatesInCycle(entries, settings, todayStr).length;
          if (nPending <= 0) return null;
          return (
            <div className="order-2 lg:order-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-extrabold text-amber-800">⚠ Registros pendentes: {nPending}</p>
              <p className="mt-0.5 text-xs text-amber-700">Existem dias que precisam de correção antes do saldo ser definitivo.</p>
              <Link href="/registros?pendentes=1">
                <Button size="sm" className="mt-2" variant="warning">Ver pendências</Button>
              </Link>
            </div>
          );
        })()}
        <Card
          compact
          className="order-2 lg:order-3"
          title="Registro de hoje"
          /* §13 subtítulo contextual pela MESMA fonte central (companyDayContext.label):
             "Folga a compensar — Calendário", "Feriado — …", "Abono…" etc. */
          subtitle={todayCtx.label ?? `Jornada regular · base ${formatMinutes(todayCtx.effectiveExpected)}`}
        >
          {/* §9 desktop: Ponto | Assistente lado a lado · mobile: empilha
              (Ponto sempre primeiro). items-start evita o Assistente esticar
              e criar área vazia. Sem overflow horizontal. */}
          <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-5">
            <section className="min-w-0">
              <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Ponto</h3>
              <QuickPunch
                embedded
                today={t}
                todayStr={todayStr}
                settings={settings}
                dayLabel={todayCtx.type === "regular" ? undefined : todayLabel}
                onAddEntry={onAddEntry}
                onUpdateEntry={onUpdateEntry}
                onDeleteEntry={onDeleteEntry}
                faltaRegistrada={!!faltaHoje}
                jornadaMinutes={todayCtx.effectiveExpected}
                faltaGate={faltaHojeGate}
                onRegisterFalta={registerFaltaHoje}
                onRemoveFalta={removeFaltaHoje}
                idle={todayIdle}
                compensarHint={(() => {
                  const obl = compensarObligationOnDate(
                    todayStr, entries, compensations, absences, companyCalendars, settings, todayStr,
                  );
                  return obl ? { label: obl.originLabel, originalMinutes: obl.originalMinutes } : null;
                })()}
                abonadoHint={(() => {
                  const a = isAbonadoDay(todayStr, absences, companyCalendars);
                  return a.abonado ? { label: a.label ?? "Dia abonado" } : null;
                })()}
                workedInAbonoMinutes={todayCtx.workedInAbonoMinutes}
              />
            </section>
            <section className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-5">
              <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Assistente de jornada
              </h3>
              <SmartExit
                embedded
                date={todayStr}
                day={t}
                settings={settings}
                comps={compensations}
                nowMinutes={nowMinutes}
                onSmartExit={smartExit}
                onConfirmComps={confirmComps}
                isToday
                effectiveExpected={todayCtx.effectiveExpected}
                faltaRegistrada={!!faltaHoje}
                contextLabel={todayCtx.label}
                punchBlocked={
                  todayCtx.marker === "abono" ||
                  todayCtx.ctx.absence?.kind === "ferias" ||
                  todayCtx.ctx.absence?.kind === "saude" ||
                  todayCtx.ctx.absence?.kind === "abono"
                }
              />
            </section>
          </div>
        </Card>
      </div>

      {/* §15 BANCO DE HORAS — mesmo conteúdo, agora DEPOIS do Registro de hoje */}
      <HourBankCard
        entries={entries}
        compensations={compensations}
        absences={absences}
        companyCalendars={companyCalendars}
        faltas={faltas}
        excessReasons={excessReasons}
        settings={settings}
        range={period}
        today={todayStr}
        specialExcessUses={specialExcessUses ?? []}
        specialExcessPlans={specialExcessPlans ?? []}
        controlStartDate={user.controlStartDate ?? null}
        onRegisterReason={(date) => setReasonDate(date)}
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
            companyCalendars={companyCalendars}
            faltas={faltas}
            excessReasons={excessReasons}
            onRegisterReason={(date) => setReasonDate(date)}
            settings={settings}
            range={range}
            monthLabel={periodLabel(period)}
            onCreateComp={createComp}
          />
        </div>
      </div>

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
                        ({kindOf(c) === "deficit"
                          ? `hora extra de ${formatDateShortBR(c.sourceDate)}`
                          : kindOf(c) === "acordo"
                            ? `acordo de ${formatDateShortBR(c.sourceDate)}`
                            : kindOf(c) === "calendario"
                              ? `calendário de ${formatDateShortBR(c.sourceDate)}`
                              : `excedente do limite diário de ${formatDateShortBR(c.sourceDate)}`})
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
                      kindOf(c) === "deficit"
                        ? "emerald"
                        : kindOf(c) === "acordo"
                          ? "indigo"
                          : kindOf(c) === "calendario"
                            ? "amber"
                            : "indigo"
                    }
                  >
                    {kindOf(c) === "deficit"
                      ? "hora extra"
                      : kindOf(c) === "acordo"
                        ? "hora extra · acordo"
                        : kindOf(c) === "calendario"
                          ? "hora extra · calendário"
                          : "sair cedo"}
                  </Badge>
                  {(() => {
                    const isExtra = usesHourExtra(kindOf(c));
                    const check = canCompleteComp(c, entries, compensations, settings, todayStr, { companyCalendars });
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

        {/* Barras empilhadas do período — MESMA preparação/componente do Resumo
            (src/components/stacked-period-chart). Período de ponto ATUAL (21→20,
            resolvido pelo helper central, com os especiais do fechamento anual). */}
        <Card
          title="Barras empilhadas do período"
          subtitle="Base · extra no ponto · excedente do limite diário · horas compensadas"
        >
          <StackedPeriodChart
            entries={entries}
            compensations={compensations}
            absences={absences}
            companyCalendars={companyCalendars}
            settings={settings}
            period={period}
            faltas={faltas}
            today={todayStr}
            height={150}
          />
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
                  {formatMinutes(recentRows[d.date]?.workedMinutes ?? d.workedMinutes)}
                </span>
                {/* 3H: saldo financeiro definitivo só para dia VÁLIDO — dia
                    congelado (incompleto/inconsistente/sem registro) mostra
                    "—" (neutro), nunca +0min como saldo final. */}
                {(() => {
                  const row = recentRows[d.date];
                  if (row && resumoFinancialFrozen(row)) {
                    return <span className="w-20 text-right text-xs font-bold text-slate-300">—</span>;
                  }
                  const bal = row ? row.balanceMinutes : d.balanceMinutes;
                  return (
                    <span
                      className={`w-20 text-right text-xs font-bold tabular-nums ${
                        bal > 0 ? "text-emerald-600" : bal < 0 ? "text-rose-600" : "text-slate-400"
                      }`}
                    >
                      {bal >= 0 ? "+" : ""}
                      {formatMinutes(bal)}
                    </span>
                  );
                })()}
                {/* 3H: situação CANÔNICA — acabou o "ok" genérico para dia
                    inválido/abaixo da base; [10+] preserva seu chip. */}
                {(() => {
                  const row = recentRows[d.date];
                  if (row && row.status === "excess") return <ExcessTenBadge />;
                  const st = recentDayStatusOf(row ?? buildResumoDayRow({
                    date: d.date,
                    today: todayStr,
                    entries,
                    absences,
                    calendars: companyCalendars,
                    settings,
                    faltas,
                    controlStartDate: user.controlStartDate ?? null,
                  }));
                  return <Badge tone={st.tone}>{st.label}</Badge>;
                })()}
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
          setCompPlanning(null);
        }}
        kind={compDraft?.kind ?? "excedente"}
        initial={compDraft?.initial}
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings, { companyCalendars })
        }
        pendingDebtMinutes={compPlanning?.unplannedMinutes}
        planning={compPlanning ?? undefined}
        onSave={createComp}
      />

      {/* §10 Modal do motivo do excedente >10h */}
      {reasonDate &&
        (() => {
          const reasonDay = computeDay(
            entries.filter((e) => e.date === reasonDate),
            settings,
          );
          return (
            <ExcessReasonModal
              open
              onClose={() => setReasonDate(null)}
              date={reasonDate}
              workedMinutes={reasonDay.workedMinutes}
              excessMinutes={reasonDay.excessMinutes}
              existing={excessReasonOnDate(excessReasons, reasonDate)}
            />
          );
        })()}
    </div>
  );
}
