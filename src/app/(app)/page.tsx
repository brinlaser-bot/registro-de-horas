"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Cake,
  CalendarClock,
  Clock3,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { actions, getAppData, settingsOf, useAppData, useIsClient } from "@/lib/store";
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
import { compensarObligationOnDate, isAbonadoDay } from "@/lib/compensar";
import { getAnnualPointCycle, getPointPeriod } from "@/lib/periods";
import { canRegisterFalta, faltaOnDate } from "@/lib/faltas";
import { excessReasonOnDate, shouldPromptExcessReason } from "@/lib/hour-bank";
import { pendingPunchDatesInCycle } from "@/lib/pending-punches";
import { buildResumoDayRow, resumoFinancialFrozen, type ResumoDayRow } from "@/lib/resumo-days";
import { buildCalendarForecast } from "@/lib/calendar-forecast";
import { buildCycleSituation } from "@/lib/cycle-dashboard";
import { buildResumoPeriodView } from "@/lib/resumo-period-view";
import { buildSpecialExcessBank } from "@/lib/special-excess-bank";
import { buildSpecialExcessDayView } from "@/lib/special-excess-day-view";
import { ExcessReasonModal } from "@/components/excess-reason-modal";
import { SpecialExcessUseModal } from "@/components/special-excess-use-modal";
import type { DayResult, DaySummary } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ExcessTenBadge, Skeleton, StatCard } from "@/components/ui";
import { QuickPunch } from "@/components/quick-punch";
import { SmartExit } from "@/components/smart-exit";
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

/** Convenção de sinal (+30min / −1h30) — a mesma do Resumo. */
function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${formatMinutes(v)}`;
}

/**
 * ETAPA 4V/4D/4D.1 — VISÃO GERAL como visão geral de verdade: ordem
 * saudação → Atenção agora (condicional) → REGISTRO DE HOJE → Situação do
 * Ciclo → Período atual → O que vem pela frente → Dias recentes.
 * A página apenas APRESENTA valores já derivados pelas fontes canônicas
 * (dayBalanceContribution, buildResumoPeriodView 3A, buildSpecialExcessBank
 * 3C, cycle-dashboard/calendar-forecast 4D) — nenhuma nova fórmula. O
 * gerenciamento detalhado permanece nas
 * páginas próprias (Central de Horas, Registros, Resumo).
 */
export default function DashboardPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendars, faltas, excessReasons, specialExcessUses, specialExcessPlans } = useAppData();
  const settings = settingsOf(user);
  const todayStr = todayString();
  const period = getPointPeriod(todayStr);
  const [reasonDate, setReasonDate] = useState<string | null>(null);
  const [busyFalta, setBusyFalta] = useState(false);
  /* 4C.1B — pendência da 4V: "Completar jornada com [10+]" no Registro de
   * hoje da Visão Geral (o MESMO fluxo/modal já validado em Registros). */
  const [completeDate, setCompleteDate] = useState<string | null>(null);

  // Relógio: mantém previsão de saída e horas "em andamento" em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

  /* 4D: o saldo do PERÍODO passa a vir da fonte canônica do Resumo
   * (buildResumoPeriodView, abaixo) — a MESMA Σ de balanceContribution que
   * este memo somava (prova de igualdade na suíte 4V). Aqui ficam apenas o
   * dia corrente e os Dias recentes. */
  const { today, todayCtx, recent, recentRows } = useMemo(() => {
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

    return { today: todays, todayCtx: tCtx, recent: recents, recentRows };
  }, [entries, absences, companyCalendars, faltas, settings, todayStr, nowMinutes, user]);

  /* 4D — PERÍODO ATUAL: nada é recalculado aqui. O saldo factual e o saldo
   * projetado do período vêm da MESMA derivação canônica do Resumo
   * (buildResumoPeriodView — 2A/3A/3C); o Banco [10+] disponível vem da
   * MESMA fonte canônica 3C usada pelo Resumo e pela reconciliação 3G (a
   * fórmula fica na lib — a página apenas apresenta o valor derivado). */
  const resumoView = useMemo(
    () =>
      buildResumoPeriodView({
        period,
        today: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [entries, absences, companyCalendars, settings, faltas, period, todayStr, user, specialExcessUses, specialExcessPlans],
  );
  const projection = resumoView.cards.projection;
  const projApplied = projection.appliedSpecialMinutes;
  const projAppliedDays = projection.days.filter((d) => d.appliedSpecialMinutes > 0).length;

  const specialBank = useMemo(
    () =>
      buildSpecialExcessBank({
        cycle: getAnnualPointCycle(todayStr),
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? "",
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [todayStr, entries, absences, companyCalendars, settings, faltas, user, specialExcessUses, specialExcessPlans],
  );

  /* 4C.1B — visão canônica do dia de HOJE (buildSpecialExcessDayView, a
   * MESMA de Registros): gating "Completar jornada com [10+]" — canComplete
   * já exige encerrada + financeiramente válida + abaixo da base +
   * remainingNeed > 0 + Banco [10+] disponível > 0. Sem horário de parede. */
  const todaySpecialView = useMemo(
    () =>
      buildSpecialExcessDayView({
        date: todayStr,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [todayStr, entries, absences, companyCalendars, settings, faltas, user, specialExcessUses, specialExcessPlans],
  );

  /* 4D (PARTES B/C) — SITUAÇÃO DO CICLO: fonte canônica PURA
   * (buildCycleSituation → projectRealizedPeriodOfficial sobre 01/05→30/04).
   * Factual = Σ balanceContribution; Projetado = factual + [10+] aplicado
   * (usos ativos, need-cap); reserva futura NÃO entra. */
  const cycleSituation = useMemo(
    () =>
      buildCycleSituation({
        today: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
      }),
    [todayStr, entries, absences, companyCalendars, settings, faltas, user, specialExcessUses],
  );

  /* 4D (PARTE F) / 4D.1 (PARTES A/D/E) — PREVISÃO DO CALENDÁRIO: obrigações
   * COMPENSAR do ciclo ainda não QUITADAS — FUTURAS, de HOJE e PASSADAS EM
   * ABERTO (a data do evento diz quando a folga acontece, não quando a
   * obrigação deixa de existir). Sábado/domingo com entrada EXPLÍCITA é
   * respeitado; cobertura concluída reduz, planejada NÃO (PLANEJADO ≠
   * REALIZADO). Helper puro calendar-forecast. */
  const forecast = useMemo(
    () =>
      buildCalendarForecast({
        calendars: companyCalendars,
        compensations,
        cycle: cycleSituation.cycle,
        today: todayStr,
        // 4D.2: dados factuais p/ cobertura pelo próprio dia (derivada DENTRO
        // do helper canônico — a página NÃO recalcula nada).
        entries,
        absences,
        settings,
      }),
    [companyCalendars, compensations, cycleSituation.cycle, todayStr, entries, absences, settings],
  );

  /* 4D.1 (PARTE C) — PREVISÃO DO CICLO = saldo projetado atual do ciclo −
   * obrigações de calendário ainda descobertas (futuro + hoje + passado em
   * aberto). Rotulada como PREVISÃO — nunca saldo factual/atual/realizado. */
  const forecastBalanceMinutes = cycleSituation.projectedBalanceMinutes - forecast.uncoveredMinutes;

  /* 4D.1 (PARTE F) — "Atenção agora" pode avisar obrigação de calendário
   * de HOJE ou PASSADA ainda em aberto (sempre total resumido e sempre com
   * o nome do que é — obrigação de calendário, não saldo do dia). */
  const calendarTodayUncoveredMinutes = forecast.events
    .filter((e) => e.status === "today")
    .reduce((s, e) => s + e.uncoveredMinutes, 0);
  const calendarOverdueUncoveredMinutes = forecast.events
    .filter((e) => e.status === "overdue")
    .reduce((s, e) => s + e.uncoveredMinutes, 0);

  /* 4D (PARTE I) — "Atenção agora": somente pendências factuais canônicas. */
  const pendingPlansCount = useMemo(
    () => (specialExcessPlans ?? []).filter((pl) => pl.status === "planned" && pl.destinationDate <= todayStr).length,
    [specialExcessPlans, todayStr],
  );
  const pendingPunchesCount = useMemo(() => pendingPunchDatesInCycle(entries, settings, todayStr).length, [entries, settings, todayStr]);

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
        <Skeleton className="h-64" />
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

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
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

      {/* B. ATENÇÃO AGORA (4D, Parte I / 4D.1, Parte F) — SOMENTE decisões
          reais: pendências factuais canônicas + obrigação de calendário de
          HOJE ou PASSADA ainda em aberto (sempre como "obrigação de
          calendário", nunca como saldo negativo do dia). Sem tocar o
          saldo factual. */}
      {(pendingPunchesCount > 0 || pendingPlansCount > 0 || calendarTodayUncoveredMinutes > 0 || calendarOverdueUncoveredMinutes > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-extrabold text-amber-800">⚠ Atenção agora</p>
          <ul className="mt-1 space-y-1 text-xs font-medium text-amber-700">
            {pendingPunchesCount > 0 && (
              <li>
                Registros pendentes: {pendingPunchesCount} — dias que precisam de correção antes do saldo ser definitivo.{" "}
                <Link href="/registros?pendentes=1" className="font-bold text-amber-800 underline underline-offset-2">
                  Ver pendências
                </Link>
              </li>
            )}
            {pendingPlansCount > 0 && (
              <li>
                Planejamentos [10+] aguardando confirmação: {pendingPlansCount} — resolva ou libere nos dias de Registros.{" "}
                <Link href="/registros" className="font-bold text-amber-800 underline underline-offset-2">
                  Abrir Registros
                </Link>
              </li>
            )}
            {calendarTodayUncoveredMinutes > 0 && (
              <li>Hoje há {formatMinutes(calendarTodayUncoveredMinutes)} de calendário ainda a compensar.</li>
            )}
            {calendarOverdueUncoveredMinutes > 0 && (
              <li>Há {formatMinutes(calendarOverdueUncoveredMinutes)} de obrigação de calendário pendente.</li>
            )}
          </ul>
        </div>
      )}

      {/* C. REGISTRO DE HOJE (4D.1, Parte G — logo após a saudação/atenção) — Ponto + Assistente de jornada em UM ÚNICO card
          (preservado integralmente pela 4V: batidas, jornada em andamento/
          encerrada, saldo do dia, botões e ações já existentes). */}
      <Card
        compact
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
        {/* 4C.1B — "Completar jornada com [10+]" no dia de hoje (pendência da
            4V). Gating CANÔNICO (a mesma visão de Registros — sem horário de
            parede): canComplete já exige encerrada + financeiramente válida +
            abaixo da base + remainingNeed > 0 + Banco [10+] > 0. Após o uso,
            o factual acima permanece (ex.: 7h30/−30); aqui aparece, discreto,
            o [10+] aplicado e a projeção no ponto (8h/0) — mesma fonte 3A. */}
        {(todaySpecialView.canComplete || todaySpecialView.usedActiveMinutes > 0) && (
          <div className="mt-4 space-y-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
            {todaySpecialView.usedActiveMinutes > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-violet-900/80">
                <Badge tone="violet" className="shrink-0 py-0.5">
                  <CalendarClock size={12} aria-hidden /> [10+]
                </Badge>
                <span>
                  Aplicado hoje: <b className="tabular-nums">{formatMinutes(todaySpecialView.usedActiveMinutes)}</b>
                  {todaySpecialView.projection && (
                    <>
                      {" "}· Projeção no ponto:{" "}
                      <b className="tabular-nums">
                        {formatMinutes(todaySpecialView.projection.workedMinutes)} / {fmtSigned(todaySpecialView.projection.balanceMinutes)}
                      </b>
                    </>
                  )}
                </span>
              </p>
            )}
            {todaySpecialView.canComplete && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 text-xs font-medium text-violet-900/80">
                  Jornada encerrada abaixo da base — faltam{" "}
                  <b className="tabular-nums">{formatMinutes(todaySpecialView.remainingMinutes)}</b> para a base.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"
                  onClick={() => setCompleteDate(todayStr)}
                >
                  <CalendarClock size={13} /> Completar jornada com [10+]
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* D. SITUAÇÃO DO CICLO (4D, Partes B/C/E) — três grandezas NUNCA
          misturadas: FACTUAL (sem [10+]) · PROJETADO (com [10+] já aplicado)
          · BANCO [10+] DISPONÍVEL. Título derivado do ciclo real. */}
      <div>
        <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-slate-400">
          Ciclo {cycleSituation.cycle}
        </h3>
        <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          <StatCard
            compact
            label="Saldo factual"
            value={fmtSigned(cycleSituation.factualBalanceMinutes)}
            sub="Sem [10+]"
            tone={cycleSituation.factualBalanceMinutes > 0 ? "emerald" : cycleSituation.factualBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<Wallet size={16} />}
          />
          <StatCard
            compact
            label="Saldo projetado"
            value={fmtSigned(cycleSituation.projectedBalanceMinutes)}
            sub="Com [10+] já aplicado"
            tone={cycleSituation.projectedBalanceMinutes > 0 ? "indigo" : cycleSituation.projectedBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<TrendingUp size={16} />}
          />
          <StatCard
            compact
            label="BANCO [10+] DISPONÍVEL"
            value={formatMinutes(specialBank.availableMinutes)}
            sub={specialBank.reservedMinutes > 0 ? `${formatMinutes(specialBank.reservedMinutes)} reservados` : undefined}
            tone={specialBank.availableMinutes > 0 ? "violet" : "slate"}
            icon={<Zap size={16} />}
          />
        </div>
      </div>

      {/* E. PERÍODO ATUAL (4D, Parte D) — factual e projetado da MESMA fonte
          canônica do Resumo (buildResumoPeriodView — nada recalculado aqui),
          com o fechamento derivado do período real em destaque. */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">
            Período atual — {formatDateShortBR(period.from)} a {formatDateShortBR(period.to)}
          </h3>
          <Badge tone="slate">Fecha em {formatDateShortBR(period.to)}</Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
          <StatCard
            compact
            label="Saldo factual do período"
            value={fmtSigned(resumoView.cards.regularBalanceMinutes)}
            sub="Sem [10+] · a mesma fonte do Resumo"
            tone={resumoView.cards.regularBalanceMinutes > 0 ? "emerald" : resumoView.cards.regularBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<Wallet size={16} />}
          />
          <StatCard
            compact
            label="Saldo projetado do período"
            value={fmtSigned(projection.projectedBalanceMinutes)}
            sub={
              projApplied > 0
                ? `Com [10+] já aplicado · inclui ${formatMinutes(projApplied)} em ${projAppliedDays} dia(s).`
                : "Com [10+] já aplicado · nenhum uso ativo ainda."
            }
            tone={projection.projectedBalanceMinutes > 0 ? "indigo" : projection.projectedBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<TrendingUp size={16} />}
          />
        </div>
      </div>

      {/* F. O QUE VEM PELA FRENTE (4D, Partes F/G · 4D.1, Partes A–E) — impactos futuros
          CONHECIDOS do calendário e a PREVISÃO do ciclo (projetado + impacto
          descoberto). PREVISÃO ≠ saldo factual/atual/realizado. Estado neutro
          quando não há obrigações futuras (nunca inventar zero negativo). */}
      <div>
        <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-slate-400">
          O que vem pela frente
        </h3>
        {forecast.openEventCount > 0 ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <StatCard
                compact
                label="Obrigações de calendário a compensar"
                value={fmtSigned(-forecast.uncoveredMinutes)}
                sub={`Inclui obrigações futuras e ainda não concluídas · ${forecast.openEventCount} evento(s)`}
                tone={forecast.uncoveredMinutes > 0 ? "rose" : "slate"}
                icon={<CalendarClock size={16} />}
              />
              <StatCard
                compact
                label="Previsão do ciclo"
                value={fmtSigned(forecastBalanceMinutes)}
                sub="Saldo projetado − obrigações em aberto"
                tone={forecastBalanceMinutes > 0 ? "emerald" : forecastBalanceMinutes < 0 ? "rose" : "slate"}
                icon={<TrendingUp size={16} />}
              />
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-slate-400">
              Considera eventos de calendário já conhecidos. Dias normais futuros presumem jornada cumprida.
            </p>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-500">
            Nenhuma obrigação de calendário em aberto neste ciclo.
          </div>
        )}
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
            {/* 4D (PARTE J) — somente APRESENTAÇÃO: mobile em duas linhas por
                dia; desktop em grid estável. Classificação 3H, saldo "—" para
                congelados, chip [10+] e fallback recentDayStatusOf INTACTOS. */}
            {recentDays.map((d) => {
              const row = recentRows[d.date];
              const worked = formatMinutes(row?.workedMinutes ?? d.workedMinutes);
              const frozen = !!row && resumoFinancialFrozen(row);
              const bal = row ? row.balanceMinutes : d.balanceMinutes;
              const isExcess = !!row && row.status === "excess";
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
              const chip = isExcess ? <ExcessTenBadge /> : <Badge tone={st.tone}>{st.label}</Badge>;
              return (
                <Link key={d.date} href="/registros" className="block rounded-lg px-1 py-2.5 transition-colors hover:bg-slate-50/70 sm:px-2 sm:py-3">
                  {/* MOBILE: dia/trabalhado na 1ª linha; saldo + situação na 2ª */}
                  <div className="sm:hidden">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-bold text-slate-800">
                        {weekdayShort(d.date).replace(".", "")}
                        <span className="ml-1.5 font-medium text-slate-400">{formatDateShortBR(d.date)}</span>
                      </span>
                      <span className="text-sm font-extrabold tabular-nums text-slate-900">{worked}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">
                        Saldo{" "}
                        {frozen ? (
                          <span className="font-bold text-slate-300">—</span>
                        ) : (
                          <span className={`font-bold tabular-nums ${bal > 0 ? "text-emerald-600" : bal < 0 ? "text-rose-600" : "text-slate-400"}`}>
                            {bal >= 0 ? "+" : ""}
                            {formatMinutes(bal)}
                          </span>
                        )}
                      </span>
                      {chip}
                    </div>
                  </div>
                  {/* DESKTOP: MESMAS colunas em todas as linhas —
                      [Dia/Data · Horas · Saldo · Status] com larguras fixas,
                      saldo tabular alinhado e status sempre na mesma posição
                      (4D.1, Parte I). */}
                  <div className="hidden items-center sm:grid sm:grid-cols-[7.5rem_9rem_1fr_9rem]">
                    <span className="text-sm font-bold text-slate-800">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">{formatDateShortBR(d.date)}</span>
                    </span>
                    <span className="text-sm font-extrabold tabular-nums text-slate-900">
                      {worked} <span className="text-xs font-medium text-slate-400">trabalhadas</span>
                    </span>
                    <span>
                      {frozen ? (
                        <span className="text-xs font-bold text-slate-300">—</span>
                      ) : (
                        <span
                          className={`text-xs font-bold tabular-nums ${
                            bal > 0 ? "text-emerald-600" : bal < 0 ? "text-rose-600" : "text-slate-400"
                          }`}
                        >
                          {bal >= 0 ? "+" : ""}
                          {formatMinutes(bal)}
                        </span>
                      )}
                    </span>
                    <span className="justify-self-start">{chip}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      {/* 4C.1B — o MESMO modal "Completar jornada com [10+]" de Registros
          (SpecialExcessUseModal: Automático/Manual, FIFO, manualMaxForOrigin,
          banco canônico com plans descontados, gate do store, cancelamento). */}
      {completeDate && (
        <SpecialExcessUseModal date={completeDate} onClose={() => setCompleteDate(null)} />
      )}

      {/* §10 Modal do motivo do excedente >10h (parte do fluxo de batida do
          Registro de hoje — preservado pela 4V). */}
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
