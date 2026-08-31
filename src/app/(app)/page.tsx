"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Cake,
  CalendarClock,
  Clock3,
  TrendingUp,
  TriangleAlert,
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
import {
  getAnnualPointCycle,
  getPointPeriod,
  listDaysBetween,
} from "@/lib/periods";
import { canRegisterFalta, dayBalanceContribution, faltaOnDate } from "@/lib/faltas";
import { excessReasonOnDate, shouldPromptExcessReason } from "@/lib/hour-bank";
import { pendingPunchDatesInCycle } from "@/lib/pending-punches";
import { buildResumoDayRow, resumoFinancialFrozen, type ResumoDayRow } from "@/lib/resumo-days";
import { buildResumoPeriodView } from "@/lib/resumo-period-view";
import { buildSpecialExcessBank } from "@/lib/special-excess-bank";
import { ExcessReasonModal } from "@/components/excess-reason-modal";
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
 * ETAPA 4V — VISÃO GERAL como visão geral de verdade: hoje, pendências,
 * resumo rápido (saldo regular · projeção · Banco [10+]) e dias recentes.
 * A página apenas APRESENTA valores já derivados pelas fontes canônicas
 * (dayBalanceContribution, buildResumoPeriodView 3A, buildSpecialExcessBank
 * 3C) — nenhuma nova fórmula. O gerenciamento detalhado permanece nas
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

  // Relógio: mantém previsão de saída e horas "em andamento" em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

  const { totals, today, todayCtx, recent, recentRows } = useMemo(() => {
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

    return { totals: sum, today: todays, todayCtx: tCtx, recent: recents, recentRows };
  }, [entries, absences, companyCalendars, faltas, settings, period, todayStr, nowMinutes, user]);

  /* ETAPA 4V — RESUMO RÁPIDO: nada é recalculado aqui. A projeção no ponto e
   * o [10+] gerado no período vêm da MESMA derivação canônica do Resumo
   * (buildResumoPeriodView — 3A/3C); o Banco [10+] disponível vem da MESMA
   * fonte canônica 3C usada pelo Resumo e pela reconciliação 3G (a fórmula
   * fica na lib — a página apenas apresenta o valor derivado). */
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
  const balanceTone = totals.balanceTotal > 0 ? "emerald" : totals.balanceTotal < 0 ? "rose" : "slate";
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

      {/* B. REGISTRO DE HOJE — Ponto + Assistente de jornada em UM ÚNICO card
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
      </Card>

      {/* C. PENDÊNCIAS RELEVANTES — apenas o aviso já existente de registros
          pendentes (dias que precisam de correção). Nenhuma nova lógica. */}
      {(() => {
        const nPending = pendingPunchDatesInCycle(entries, settings, todayStr).length;
        if (nPending <= 0) return null;
        return (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-extrabold text-amber-800">⚠ Registros pendentes: {nPending}</p>
            <p className="mt-0.5 text-xs text-amber-700">Existem dias que precisam de correção antes do saldo ser definitivo.</p>
            <Link href="/registros?pendentes=1">
              <Button size="sm" className="mt-2" variant="warning">Ver pendências</Button>
            </Link>
          </div>
        );
      })()}

      {/* D. RESUMO RÁPIDO — os indicadores do período em um bloco curto.
          Fontes canônicas, nenhuma fórmula na página:
          · Saldo regular do período → soma central (dayBalanceContribution),
            a MESMA fonte de antes (igual ao Resumo);
          · Projeção no ponto → buildResumoPeriodView (3A, usos ativos),
            a MESMA fonte do Resumo;
          · BANCO [10+] DISPONÍVEL → buildSpecialExcessBank (3C: gerado −
            utilizado ativo − reservado ativo), a MESMA fonte do Resumo;
          · [10+] gerado no período → factual (3F), MESMA fonte do Resumo.
          Mobile: 2×2 · Desktop: 4 colunas. */}
      <div>
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-slate-400">
          Resumo rápido
        </h3>
        <div className="grid grid-cols-2 items-stretch gap-2 lg:grid-cols-4 lg:gap-3">
          <StatCard
            label="Saldo regular do período"
            value={fmtSigned(totals.balanceTotal)}
            sub="Saldo factual dentro do limite diário de 10h."
            tone={balanceTone}
            icon={<Wallet size={16} />}
          />
          <StatCard
            label="Projeção no ponto"
            value={fmtSigned(projection.projectedBalanceMinutes)}
            sub={
              projApplied > 0
                ? `Inclui ${formatMinutes(projApplied)} de [10+] aplicado em ${projAppliedDays} dia(s).`
                : "Igual ao saldo factual (sem usos [10+] ativos)."
            }
            tone={projection.projectedBalanceMinutes > 0 ? "indigo" : projection.projectedBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<TrendingUp size={16} />}
          />
          <StatCard
            label="BANCO [10+] DISPONÍVEL"
            value={formatMinutes(specialBank.availableMinutes)}
            sub={`${formatMinutes(specialBank.generatedMinutes)} gerado · ${formatMinutes(specialBank.usedMinutes)} utilizado${specialBank.reservedMinutes > 0 ? ` · ${formatMinutes(specialBank.reservedMinutes)} reservado` : ""}`}
            tone={specialBank.availableMinutes > 0 ? "violet" : "slate"}
            icon={<Zap size={16} />}
          />
          <StatCard
            label="[10+] gerado no período"
            value={formatMinutes(resumoView.cards.specialGeneratedMinutes)}
            sub="Excedente factual acima de 10h/dia."
            tone={resumoView.cards.specialGeneratedMinutes > 0 ? "violet" : "slate"}
            icon={<TriangleAlert size={16} />}
          />
        </div>
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
