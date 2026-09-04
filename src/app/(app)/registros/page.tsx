"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Ban, CalendarOff, ChevronLeft, ChevronRight, Clock3, FileWarning, Hourglass, Search, X } from "lucide-react";
import { actions, getAppData, settingsOf, useAppData, useIsClient, useIsStoreReady } from "@/lib/store";
import { useSpecialPunchActions } from "@/components/special-release-confirm";
import {
  formatDateShortBR,
  formatMinutes,
  FUTURE_DATE_ERROR,
  isFutureDate,
  nowMinutesLocal,
  todayString,
  type EntryType,
} from "@/lib/time";
import {
  absenceOnDate,
  dayContext,
} from "@/lib/absences";
import {
  calendarEventPendingToday,
  companyDayBalanceView,
  companyDayContext,
  companyDeficitContribution,
} from "@/lib/company-calendar";
import {
  annualCycleBounds,
  getAnnualPointCycle,
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  PERIOD_CONTEXT_LABEL,
  periodLabel,
  pointPeriodContext,
  type PointPeriod,
} from "@/lib/periods";
import { buildDebtDays, checkSourceOverflow } from "@/lib/debt";
import { isAbonadoDay } from "@/lib/compensar";
import { dayBalanceContribution, effectiveFaltas, faltaOnDate, faltaStatusOf } from "@/lib/faltas";
import { dayCreditView } from "@/lib/hour-bank";
import { isHistoricalEmptyDate, isMissingExpectedRecord, registrosTimelineDates } from "@/lib/missing-records";
import {
  dayMatchesSituations,
  parseSituationParam,
  serializeSituationParam,
  situationsFromView,
  type DaySituationId,
} from "@/lib/day-situation";

import { buildSpecialExcessBank, type SpecialExcessBankSummary } from "@/lib/special-excess-bank";
import { carriedSlicesIntoCycle, dateFallsInClosedCycle } from "@/lib/annual-cycle-closure";
import { buildSpecialExcessDayView } from "@/lib/special-excess-day-view";
import { activeSpecialPlansForDate } from "@/lib/special-excess-plan";
import { attentionNowSummary } from "@/lib/attention-now";
import type { WorkSettings } from "@/lib/types";
import { DayCard } from "@/components/day-card";
import { ManualEntryModal, type ManualPairData } from "@/components/manual-entry-modal";
import { FaltaModal } from "@/components/falta-modal";
import { FillDayRecordsModal } from "@/components/fill-day-records-modal";
import { SpecialExcessUseModal } from "@/components/special-excess-use-modal";
import { SpecialExcessPlanModal } from "@/components/special-excess-plan-modal";
import { SpecialExcessPlanResolveModal } from "@/components/special-excess-plan-resolve-modal";
import { DaySituationChips, DaySituationFilter } from "@/components/day-situation-filter";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { PeriodNavigator } from "@/components/period-navigator";
import { consolidationLockCoveringRange, consolidationLockForDate } from "@/lib/period-consolidation";

interface RangeSummary {
  cycle: string;
  workedDays: number;
  workedMinutes: number;
  registrableMinutes: number;
  balanceMinutes: number;
  excessMinutes: number;
  deficitMinutes: number;
  compensatedMinutes: number; // concluídas no intervalo
  pendingCompMinutes: number; // pendentes com origem no intervalo
  vacationDays: number;
  healthDays: number;
  waivedDays: number; // acordado dispensado / outro
  acordoTotal: number;
  acordoDone: number;
  acordoPending: number;
  faltaDays: number; // faltas efetivas no intervalo
  faltaPrevistaDays: number; // faltas previstas (ainda não valem)
}

export default function RegistrosPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      }
    >
      <RegistrosBody />
    </Suspense>
  );
}

function RegistrosBody() {
  const toast = useToast();
  const mounted = useIsClient();
  const storeReady = useIsStoreReady();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, entries, compensations, absences, companyCalendars, faltas, excessReasons, specialExcessUses, specialExcessPlans, periodConsolidations, annualCycleClosures } = useAppData();
  const todayStr = todayString();

  const settings: WorkSettings = settingsOf(user);

  // Navegação por período oficial do ponto (21→20, com especiais 21/04–30/04 e 01/05–20/05)
  const [period, setPeriod] = useState<PointPeriod>(() => getPointPeriod(todayStr));
  // Consulta personalizada (apenas leitura, pode atravessar períodos/ciclos/anos)
  const [query, setQuery] = useState<{ from: string; to: string } | null>(null);
  const [queryDraft, setQueryDraft] = useState({ from: "", to: "" });
  const [manualOpen, setManualOpen] = useState(false);
  const [faltaOpen, setFaltaOpen] = useState(false);
  const [faltaInitialDate, setFaltaInitialDate] = useState<string | null>(null);
  const [fillDate, setFillDate] = useState<string | null>(null);
  const [completeDate, setCompleteDate] = useState<string | null>(null);
  // 4B: data FUTURA do modal "Planejar uso de [10+]".
  const [planDate, setPlanDate] = useState<string | null>(null);
  // 4C: id do plano em resolução ("Usar planejamento [10+]").
  const [resolvePlanId, setResolvePlanId] = useState<string | null>(null);
  const wantPending = searchParams.get("pendentes") === "1";
  const wantMissing = searchParams.get("semRegistro") === "1";
  const situacaoRaw = searchParams.get("situacao");
  const situationIds = parseSituationParam(
    wantPending || wantMissing ? null : situacaoRaw,
  );
  /* 4D.5 — destino dos CTAs "Atenção agora" (Visão Geral):
   *  ?atencao=plano-10  → planejamentos [10+] que chegaram ao dia;
   *  ?escopo=ciclo      → consulta o CICLO ANUAL atual (mesmo escopo das
   *                       faixas — pendência de período anterior continua
   *                       visível; a coerência é por escopo, não por
   *                       redução de contagem);
   *  ?data=YYYY-MM-DD   → foco com exatamente 1 item: card expandido. */
  const atencaoPlano = searchParams.get("atencao") === "plano-10";
  const wantCycleScope = searchParams.get("escopo") === "ciclo";
  // 4G — o intervalo exibido está integralmente dentro de um período consolidado?
  // (no escopo ciclo/consulta a faixa é ampla demais para o banner; o lock real é por motor.)
  const lockBound =
    !query && !wantCycleScope ? consolidationLockCoveringRange(periodConsolidations, period.from, period.to) : null;
  // 4H.1 — o período exibido pertence a um ciclo anual FORMALMENTE encerrado?
  // Quando sim, NÃO existe reabertura: o texto não pode mandar "reabrir no
  // Resumo" (o próprio Resumo já oculta a ação e o store bloqueia).
  const cicloEncerradoAqui = lockBound ? dateFallsInClosedCycle(annualCycleClosures, period.from) : false;
  /** Tooltip das ações bloqueadas do período (difere quando o ciclo já encerrou). */
  const tituloAcaoBloqueada = cicloEncerradoAqui
    ? "Ciclo encerrado — este período não pode mais ser alterado."
    : "Período consolidado — reabra o período no Resumo para editar.";
  // 4G.1 — CONTEXTO do período exibido (informação; derivação única em periods.ts)
  // e MODO HISTÓRICO (período do ponto ≠ período atual): as faixas globais de
  // Atenção pertencem ao CICLO ATUAL — exibi-las numa consulta histórica
  // contradiz o resumo do período exibido (ex.: "Sem registro 0" + faixa
  // "Dia sem registro: 8" de outras datas). No período ATUAL nada muda.
  const contextoPeriodo = pointPeriodContext(period, getPointPeriod(todayStr));
  const historicalPeriodView = !wantCycleScope && !query && contextoPeriodo !== "current";
  /** 4G.1 — o período exibido é o atual? (mesma derivação única do contexto) */
  const samePointPeriodCurrent = contextoPeriodo === "current";
  const focusDateRaw = searchParams.get("data");
  const focusDate = focusDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(focusDateRaw) ? focusDateRaw : null;

  // Faltas que JÁ valem (date <= hoje) — previstas não geram déficit/saldo
  const effectiveFaltaList = useMemo(() => effectiveFaltas(faltas, todayStr), [faltas, todayStr]);

  // Relógio para o assistente de saída em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

  /* 4D.5: escopo da listagem. Padrão: período do ponto. Com ?escopo=ciclo:
   * ciclo ANUAL atual — MESMO escopo das faixas "Atenção agora" (a coerência
   * VG→Registros vem do escopo compartilhado, nunca de reduzir a contagem).
   * ?data= foco: garante que a data pedida esteja no intervalo. */
  const cycleRange = useMemo(() => annualCycleBounds(getAnnualPointCycle(todayStr)), [todayStr]);
  const range = useMemo(() => {
    let r = wantCycleScope ? cycleRange : query ?? period;
    if (focusDate && (focusDate < r.from || focusDate > r.to)) {
      r = { from: focusDate < r.from ? focusDate : r.from, to: focusDate > r.to ? focusDate : r.to };
    }
    return r;
  }, [wantCycleScope, cycleRange, query, period, focusDate]);

  // NOVO [10+] (Etapa 3E): banco 3C por ciclo presente no intervalo (uma vez
  // por ciclo, reutilizado por todos os dias do ciclo). Fonte de saldo/lotes.
  const specialBankByCycle = useMemo(() => {
    const map = new Map<string, SpecialExcessBankSummary>();
    for (const c of new Set(registrosTimelineDates(range).map(getAnnualPointCycle))) {
      map.set(
        c,
        buildSpecialExcessBank({
          cycle: c,
          asOfDate: todayStr,
          entries,
          absences,
          calendars: companyCalendars,
          settings,
          faltas,
          controlStartDate: user.controlStartDate ?? "",
          uses: specialExcessUses ?? [],
          // 4A: disponibilidade/lotes consideram reservas ativas — minuto
          // reservado não pode parecer livre para um novo uso.
          plans: specialExcessPlans ?? [],
          // 4H.1: capacidade do ciclo inclui saldo TRANSPORTADO formalmente
          // (mesma fonte canônica do store) — os cards do dia refletem o banco
          // real (gerado + trazido) e o gating canComplete nunca subestima.
          carried: carriedSlicesIntoCycle(annualCycleClosures, c),
        }),
      );
    }
    return map;
  }, [entries, absences, companyCalendars, settings, faltas, specialExcessUses, specialExcessPlans, annualCycleClosures, user.controlStartDate, todayStr, range]);

  // Linha do tempo completa: UM card por data do intervalo, mesmo sem batidas.
  // 4E.1 — ORDEM CRONOLÓGICA CRESCENTE na RENDERIZAÇÃO (21/08 → 20/09; ciclo
  // 01/05 → 30/04; filtros herdam a ordem). Somente apresentação: os motores
  // (saldos, situações, atenção, banco [10+]) não dependem da ordem — as
  // somas são aditivas e as contagens são ordem-independentes.
  const days = useMemo(() => {
    return registrosTimelineDates(range)
      .sort((a, b) => a.localeCompare(b))
      .map((date) => {
        const cctx = companyDayContext(date, entries, absences, companyCalendars, settings, date === todayStr ? nowMinutes : undefined);
        const baseView = companyDayBalanceView(cctx);
        const falta = faltaOnDate(faltas, date);
        const faltaStatus = falta ? faltaStatusOf(date, todayStr) : null;
        const missingExpected = isMissingExpectedRecord(date, todayStr, cctx, faltas, user.controlStartDate);
        const creditView = dayCreditView(date, entries, compensations, absences, companyCalendars, settings, excessReasons);
        // NOVO [10+] (3E): visão do dia derivada 3A/3C (elegibilidade, saldo,
        // usos ativos, projeção) — a UI só exibe; nenhuma regra paralela aqui.
        const specialExcess = buildSpecialExcessDayView({
          date,
          asOfDate: todayStr,
          entries,
          absences,
          calendars: companyCalendars,
          settings,
          faltas,
          controlStartDate: user.controlStartDate ?? null,
          uses: specialExcessUses ?? [],
          bank: specialBankByCycle.get(getAnnualPointCycle(date)),
        });
        const situations = situationsFromView({
          date,
          today: todayStr,
          view: cctx,
          missingExpected,
          faltaStatus,
          regularExtra: creditView.regularExtra,
          excessSpecial: creditView.excessSpecial,
        });
        const empty = cctx.ctx.day.empty;
        // 4D.4 (Parte I): dia com entrada do calendário NUNCA é "sem fatos" —
        // o evento explícito é fato conhecido (a situação vem do calendário).
        const noFacts = empty && !falta && !cctx.ctx.absence && !cctx.calendarEntry;
        const historicalEmpty = noFacts && isHistoricalEmptyDate(date, todayStr, user.controlStartDate);
        const compact =
          empty &&
          !missingExpected &&
          !falta &&
          !cctx.ctx.absence &&
          !cctx.ctx.day.financialPending &&
          cctx.ctx.day.consistent;
        return {
          date,
          ctx: cctx.ctx,
          // 4D.3: BASE EFETIVA canônica do dia (resolução central) — gate do
          // planejamento [10+] em dias futuros especiais (feriado/abono/
          // folga/afastamento/COMPENSAR base 0 ⇒ 0; parcial ⇒ a própria base).
          planningCapacityMinutes: cctx.effectiveExpected,
          // 4D.4 (Parte M): semântica factual do calendário para o card
          // (base de referência · crédito do calendário · trabalho necessário).
          calendarSemantics: cctx.calendarEntry
            ? {
                referenceBaseMinutes: cctx.referenceBaseMinutes,
                calendarCreditMinutes: cctx.calendarCreditMinutes,
                requiredWorkMinutes: cctx.requiredWorkMinutes,
                abonadoIntegral: cctx.abonadoIntegral,
                workedOnAbonadoIntegral: cctx.abonadoIntegral && cctx.ctx.day.workedMinutes > 0,
                // 4D.4 (Parte G): hoje sem jornada encerrada = previsão (o
                // card exibe saldo 0, nunca −8h prematuro).
                pendingToday: calendarEventPendingToday(cctx, date, todayStr),
              }
            : null,
          calendarLabel: cctx.label,
          falta: falta
            ? { id: falta.id, status: faltaStatus!, jornadaMinutes: cctx.effectiveExpected }
            : undefined,
          /* View model central: card e resumo consomem SEMPRE a resolução central
           * (calendário/folga/evento) — nunca o saldo bruto de computeDay/dayContext.
           * Falta PREVISTA: saldo/déficit mascarados em 0 até a data chegar.
           * SEM REGISTRO / dia sem fatos: pendência operacional — não inventa déficit/saldo. */
          balanceView:
            date > todayStr || missingExpected || noFacts
              ? { ...baseView, adjustedBalance: 0, adjustedDeficit: 0 }
              : faltaStatus === "prevista"
              ? { ...baseView, adjustedBalance: 0, adjustedDeficit: 0 }
              : baseView,
          displayDay: cctx.displayDay,
          workedInAbonoMinutes: cctx.workedInAbonoMinutes,
          abonoParcial: cctx.calendarEntry?.tratamento === "ABONADO_PARCIAL"
            ? {
                abonoStart: cctx.calendarEntry.abonoStart ?? "08:00",
                abonoEnd: cctx.calendarEntry.abonoEnd ?? "12:00",
                expectedRegular: cctx.effectiveExpected,
              }
            : null,
          // Contribuição CENTRAL (dayBalanceContribution) — MESMA soma da
          // Visão geral e do Resumo do período (falta efetiva conta; prevista 0).
          balanceContribution: dayBalanceContribution(cctx, faltas, date, todayStr),
          // 4D.4 (Parte G): evento em HOJE sem jornada encerrada = previsão.
          deficitContribution:
            missingExpected ||
            noFacts ||
            date > todayStr ||
            faltaStatus === "prevista" ||
            calendarEventPendingToday(cctx, date, todayStr)
              ? 0
              : companyDeficitContribution(cctx),
          absence: absenceOnDate(absences, date),
          missingExpected,
          historicalEmpty,
          compact,
          creditView,
          specialExcess,
          // 4B: planos/reservas ATIVAS do dia (badge + detalhe + cancelamento).
          specialPlans: activeSpecialPlansForDate(specialExcessPlans ?? [], date),
          // 4D.5: reserva [10+] deste dia JÁ CHEGOU e segue aguardando
          // confirmação (futuro puro não gera faixa de atenção).
          planoAguardando:
            date <= todayStr && activeSpecialPlansForDate(specialExcessPlans ?? [], date).length > 0,
          situations,
        };
      });
  }, [entries, compensations, absences, companyCalendars, faltas, excessReasons, settings, range, todayStr, nowMinutes, user.controlStartDate, specialExcessUses, specialExcessPlans, specialBankByCycle]);

  // Resumo do intervalo, AGRUPADO POR CICLO ANUAL (nunca mistura pendências)
  const summaries = useMemo(() => {
    // SEMPRE com a coleção de calendários: a resolução central zera o déficit
    // comum em folga/abonado/recesso/folga a compensar (sem "8h − trabalhado").
    const debts = buildDebtDays(entries, compensations, settings, range, absences, companyCalendars, effectiveFaltaList, todayStr);
    const byCycle = new Map<string, RangeSummary>();
    const get = (cycle: string): RangeSummary => {
      let s = byCycle.get(cycle);
      if (!s) {
        s = {
          cycle, workedDays: 0, workedMinutes: 0, registrableMinutes: 0, balanceMinutes: 0,
          excessMinutes: 0, deficitMinutes: 0, compensatedMinutes: 0, pendingCompMinutes: 0,
          vacationDays: 0, healthDays: 0, waivedDays: 0, acordoTotal: 0, acordoDone: 0, acordoPending: 0,
          faltaDays: 0, faltaPrevistaDays: 0,
        };
        byCycle.set(cycle, s);
      }
      return s;
    };

    for (const { date, ctx, balanceContribution, deficitContribution, absence } of days) {
      const s = get(getAnnualPointCycle(date));
      if (date <= todayStr && ctx.day.entries.length > 0) {
        s.workedDays += 1;
        s.workedMinutes += ctx.day.workedMinutes;
        s.registrableMinutes += ctx.day.registrableMinutes;
        s.excessMinutes += ctx.day.excessMinutes;
      }
      // Mesmo agregador central do Resumo: sem dados/jornada aberta não geram saldo artificial.
      s.balanceMinutes += balanceContribution;
      // Déficit comum vem da resolução central (eventos de calendário não geram déficit).
      s.deficitMinutes += deficitContribution;
      if (absence?.kind === "ferias") s.vacationDays += 1;
      if (absence?.kind === "saude") s.healthDays += 1;
      if (absence && (absence.kind === "outro" || (absence.kind === "acordado" && absence.treatment === "dispensado"))) {
        s.waivedDays += 1;
      }
    }

    for (const d of debts) {
      const s = get(getAnnualPointCycle(d.date));
      if (d.kind === "acordo") {
        s.acordoTotal += d.debtMinutes;
        s.acordoDone += d.concludedMinutes;
        s.acordoPending += d.remainingMinutes;
      }
    }

    for (const c of compensations) {
      if (c.sourceDate < range.from || c.sourceDate > range.to) continue;
      const s = get(getAnnualPointCycle(c.sourceDate));
      if (c.status === "concluida") s.compensatedMinutes += c.minutes;
      if (c.status === "pendente") s.pendingCompMinutes += c.minutes;
    }

    // Faltas: efetivas contam como "Faltas"; previstas ficam separadas (opcional)
    for (const f of faltas) {
      if (f.date < range.from || f.date > range.to) continue;
      const s = get(getAnnualPointCycle(f.date));
      if (f.date <= todayStr) s.faltaDays += 1;
      else s.faltaPrevistaDays += 1;
    }

    return [...byCycle.values()].sort((a, b) => a.cycle.localeCompare(b.cycle));
  }, [days, entries, compensations, absences, companyCalendars, faltas, effectiveFaltaList, settings, range, todayStr]);

  const pendingCount = days.filter((d) => d.displayDay.financialPending || !d.displayDay.consistent).length;
  const missingCount = days.filter((d) => d.missingExpected).length;
  // 4D.5: planejamentos [10+] aguardando confirmação (contagem de DIAS com
  // reserva chegada — MESMA fonte das faixas da Visão Geral).
  const planoCount = days.filter((d) => d.planoAguardando).length;
  const pendingOnly = wantPending && !wantMissing && pendingCount > 0;
  const missingOnly = wantMissing && !wantPending && missingCount > 0;
  const planoOnly = atencaoPlano && !pendingOnly && !missingOnly;
  const situationActive = situationIds.length > 0 && !pendingOnly && !missingOnly && !planoOnly;

  /* 4D.5.1 — as MESMAS quatro faixas "Atenção agora" da Visão Geral: MESMA
   * fonte única (attention-now) e MESMO escopo (ciclo anual). As faixas da
   * página NÃO recalculam classificação — consomem este memo. */
  const attention = useMemo(
    () =>
      attentionNowSummary({
        today: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        plans: specialExcessPlans ?? [],
      }),
    [todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessPlans],
  );
  /** CTA da faixa: aplica o filtro NA PRÓPRIA página (compartilhável via
   *  URL). 2+ itens ⇒ filtro + escopo ciclo; 1 item ⇒ + foco na data. */
  const faixaHref = (dates: string[], filtro: string) =>
    `/registros?situacao=${filtro}&escopo=ciclo${dates.length === 1 ? `&data=${dates[0]}` : ""}`;
  const planoFaixaHref = (dates: string[]) =>
    `/registros?atencao=plano-10&escopo=ciclo${dates.length === 1 ? `&data=${dates[0]}` : ""}`;
  /** Parte F — "Limpar filtro": remove filtro + foco de data, preservando
   *  o escopo ciclo quando ativo (nunca deixa query param órfão). */
  const limparFiltro = () => router.replace(wantCycleScope ? "/registros?escopo=ciclo" : "/registros");
  /** Parte F — "Voltar ao período": limpa filtro + foco + escopo. */
  const voltarAoPeriodo = () => router.replace("/registros");
  const listedDays = pendingOnly
    ? days.filter((d) => d.displayDay.financialPending || !d.displayDay.consistent)
    : missingOnly
    ? days.filter((d) => d.missingExpected)
    : planoOnly
    ? days.filter((d) => d.planoAguardando)
    : situationActive
    ? days.filter((d) => dayMatchesSituations(d.situations, situationIds))
    : days;

  /* 4E.1 — POSICIONAMENTO AUTOMÁTICO DO FOCO (complemento da 4D.5.2):
   * com ?data=YYYY-MM-DD, após o card focado existir no DOM (expansão já
   * garantida pelo remount com key), a viewport rola até ele compensando o
   * header sticky (h-16). Sem setState derivado — efeito dedicado a scroll/
   * navegação; sem ?data= NADA acontece. Sem hardcode de datas: funciona
   * para qualquer link interno que use data= (Central, Visão Geral,
   * Atenção agora). */
  const listedCount = listedDays.length;
  const lastFocusScrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!focusDate || lastFocusScrolled.current === focusDate) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById(`dia-card-${focusDate}`);
      if (el) {
        const HEADER_STICKY_OFFSET = 76; // h-16 (64px) + folga visual
        const y = el.getBoundingClientRect().top + window.scrollY - HEADER_STICKY_OFFSET;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
        lastFocusScrolled.current = focusDate;
        return;
      }
      if (tries++ < 10) timer = setTimeout(attempt, 60);
    };
    timer = setTimeout(attempt, 60);
    return () => clearTimeout(timer);
  }, [focusDate, listedCount]);

  const writeSituacao = (ids: DaySituationId[]) => {
    const params = new URLSearchParams();
    const serialized = serializeSituationParam(ids);
    if (serialized) params.set("situacao", serialized);
    const q = params.toString();
    router.replace(q ? `/registros?${q}` : "/registros");
  };

  useEffect(() => {
    if (wantPending && wantMissing) {
      router.replace("/registros?semRegistro=1");
      return;
    }
    if (wantPending && situacaoRaw) {
      router.replace("/registros?pendentes=1");
      return;
    }
    if (wantMissing && situacaoRaw) {
      router.replace("/registros?semRegistro=1");
      return;
    }
    if (wantPending && pendingCount === 0) router.replace("/registros");
    if (wantMissing && missingCount === 0) router.replace("/registros");
    // 4D.5: CTA de planejamento sem nenhum aguardando ⇒ nada a mostrar.
    if (planoOnly && planoCount === 0) router.replace("/registros");
  }, [wantPending, wantMissing, pendingCount, missingCount, planoOnly, planoCount, router, situacaoRaw]);

  /* ── Handlers (preservam comportamento validado) ── */

  const reconcileDay = (date: string) => {
    const snap = getAppData();
    const s = settingsOf(snap.user);
    const ctx = dayContext(date, snap.entries, snap.absences, s);
    const ov = checkSourceOverflow(snap.compensations, date, ctx.day.excessMinutes, ctx.adjustedDeficit);
    if (ov.excessOverflow > 0) {
      toast.show(
        `Atenção: ${formatMinutes(ov.excessOverflow)} de compensação ficou acima do novo excedente do dia ${formatDateShortBR(date)}. Abra o dia para revisar.`,
        "info",
      );
    }
    if (ov.deficitOverflow > 0) {
      toast.show(
        `Atenção: ${formatMinutes(ov.deficitOverflow)} de compensação ficou acima do novo déficit do dia ${formatDateShortBR(date)}. Abra o dia para revisar.`,
        "info",
      );
    }
  };

  const punches = useSpecialPunchActions();

  const addEntry = async (p: { date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }) => {
    // §7: data futura → bloquear ANTES de tratar qualquer conflito com falta
    if (isFutureDate(p.date)) {
      toast.show(FUTURE_DATE_ERROR, "error");
      return;
    }
    if (!resolveFaltaConflict(p.date)) return;
    const res = await punches.addEntry(p);
    if (!res.ok) {
      // 3G: "Voltar" na confirmação de [10+] é aborto silencioso (o diálogo já é o feedback).
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
    reconcileDay(p.date);
  };

  const updateEntry = async (id: number, patch: { time?: string; type?: EntryType; note?: string | null; date?: string }) => {
    const target = entries.find((e) => e.id === id);
    const res = await punches.updateEntry(id, patch);
    if (!res.ok) {
      // 3G: aborto silencioso ao escolher "Voltar" na confirmação de [10+].
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? "Não foi possível editar o registro.", "error");
      return;
    }
    if (target) {
      reconcileDay(target.date);
    }
  };

  const deleteEntry = async (id: number) => {
    const target = entries.find((e) => e.id === id);
    // §25: excluir usa a MESMA guarda central do updateEntry — bloqueado se a
    // batida sustenta compensação concluída (origem OU destino).
    const res = await punches.deleteEntry(id);
    if (!res.ok) {
      // 3G: aborto silencioso ao escolher "Voltar" na confirmação de [10+].
      if (res.code !== "special-release-cancelled") toast.show(res.error ?? "Não foi possível excluir o registro.", "error");
      return;
    }
    if (target) reconcileDay(target.date);
  };

  const completeComp = async (id: number) => {
    const res = actions.completeComp(id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível concluir.", "error");
      return;
    }
    toast.show("Compensação concluída!");
  };

  /** Registrar falta (modal) — validação central no store. */
  const registerFalta = async (date: string) => {
    const res = actions.addFalta(date);
    if (!res.ok) throw new Error(res.error); // modal exibe e permanece aberto
    setFaltaOpen(false);
    toast.show(faltaStatusOf(date, todayStr) === "prevista" ? "Falta prevista registrada." : "Falta registrada.");
  };

  /** Excluir/cancelar falta — bloqueio de compensação vinculada vem do store. */
  const removeFalta = async (id: number) => {
    const res = actions.removeFalta(id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível excluir a falta.", "error");
      return;
    }
    toast.show("Falta excluída");
  };

  /**
   * Conflito falta ↔ batida: nunca manter os dois. Confirma a remoção da falta
   * antes de registrar o horário; cancelado → nada é alterado.
   */
  const resolveFaltaConflict = (date: string): boolean => {
    const f = faltaOnDate(faltas, date);
    if (!f) return true;
    if (
      !window.confirm(
        "Existe uma falta registrada para este dia.\nDeseja remover a falta e registrar o horário?",
      )
    ) {
      return false;
    }
    const res = actions.removeFalta(f.id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível remover a falta.", "error");
      return false;
    }
    return true;
  };

  const addManualPair = async (data: ManualPairData) => {
    // §4/§7: data futura → bloquear ANTES de tratar qualquer conflito com falta
    if (isFutureDate(data.date)) {
      toast.show(FUTURE_DATE_ERROR, "error");
      return;
    }
    if (!resolveFaltaConflict(data.date)) return;
    const r1 = await punches.addEntry({ date: data.date, time: data.entrada, type: "entrada", note: data.note || null, source: "manual" });
    if (!r1.ok) {
      if (r1.code !== "special-release-cancelled") toast.show(r1.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
    const r2 = await punches.addEntry({ date: data.date, time: data.saida, type: "saida", note: data.note || null, source: "manual" });
    if (!r2.ok) {
      if (r2.code !== "special-release-cancelled") toast.show(r2.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
    reconcileDay(data.date);
    toast.show("Lançamento manual registrado!");
  };

  const runQuery = () => {
    const from = queryDraft.from;
    const to = queryDraft.to;
    if (wantPending) router.replace("/registros");
    if (wantMissing) router.replace("/registros");
    if (situationIds.length > 0) writeSituacao(situationIds);
    if (!from && !to) {
      setQuery(null);
      return;
    }
    if (from && to && to < from) {
      toast.show("A data final não pode ser anterior à inicial.", "error");
      return;
    }
    if (from && !to) {
      setQuery({ from, to: from });
      return;
    }
    if (!from && to) {
      setQuery({ from: to, to });
      return;
    }
    setQuery({ from, to });
  };

  const clearAllFilters = () => {
    setQuery(null);
    setQueryDraft({ from: "", to: "" });
    setPeriod(getPointPeriod(todayStr));
    router.replace("/registros");
  };

  if (!mounted || !storeReady) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* A/B (4G.2 — ORDEM EM REGISTROS): A. navegação do período → B. filtros
          (DE/ATÉ/Situação/Consultar/Limpar). C. banner de consolidação →
          D. faixa-resumo → E. ações do período → F. atenções → G. dias.
          (4G: controle único compacto — [‹][rótulo][›] numa linha no mobile) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator
            fullLabel={query
              ? `Consulta: ${formatDateShortBR(query.from)} → ${formatDateShortBR(query.to)}`
              : wantCycleScope
                ? `Ciclo ${getAnnualPointCycle(todayStr)} — ${formatDateShortBR(cycleRange.from)} → ${formatDateShortBR(cycleRange.to)}`
                : `Período do ponto: ${periodLabel(period)}`}
            shortLabel={query
              ? `${query.from.slice(8)}/${query.from.slice(5, 7)} → ${query.to.slice(8)}/${query.to.slice(5, 7)}`
              : `${period.from.slice(8)}/${period.from.slice(5, 7)} → ${period.to.slice(8)}/${period.to.slice(5, 7)}`}
            onPrev={() => { setQuery(null); setPeriod(getPreviousPointPeriod(period)); }}
            onNext={() => { setQuery(null); setPeriod(getNextPointPeriod(period)); }}
            contextLabel={query || wantCycleScope ? undefined : PERIOD_CONTEXT_LABEL[contextoPeriodo]}
            onBackToCurrent={
              query || !samePointPeriodCurrent
                ? () => { setQuery(null); setPeriod(getPointPeriod(todayStr)); }
                : undefined
            }
          />
          {query && (
            <Button variant="ghost" size="sm" onClick={() => setQuery(null)}>
              <X size={13} /> Limpar consulta
            </Button>
          )}
        </div>

        {/* B — FILTROS (4G.2: consulta personalizada imediatamente após a
            navegação; as AÇÕES DO PERÍODO descem para logo abaixo da
            faixa-resumo — funções diferentes, blocos diferentes). */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            De
            <input
              type="date"
              value={queryDraft.from}
              onChange={(e) => setQueryDraft({ ...queryDraft, from: e.target.value })}
              className="mt-0.5 block h-9 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
            />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Até
            <input
              type="date"
              value={queryDraft.to}
              onChange={(e) => setQueryDraft({ ...queryDraft, to: e.target.value })}
              className="mt-0.5 block h-9 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
            />
          </label>
          <DaySituationFilter selected={situationIds} onChange={writeSituacao} />
          <Button variant="secondary" size="sm" onClick={runQuery}>
            <Search size={14} /> Consultar
          </Button>
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Limpar
          </Button>
          <p className="basis-full text-[11px] text-slate-400">
            Informe uma data para busca específica ou duas datas para consultar um período.
          </p>
        </div>
      </div>
      {/* C — 4G — aviso de período consolidado (dados e DayCards continuam visíveis;
          apenas mutações são bloqueadas — a segurança real está no motor).
          4G.2 — "Abrir Resumo" preserva o PERÍODO exibido (query ?data= com a
          própria data do período; o Resumo deriva com getPointPeriod — nenhuma
          segunda matemática 21→20, nenhum hardcode). */}
      {lockBound && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-300 bg-violet-50/60 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-bold text-violet-900">
            {cicloEncerradoAqui
              ? "Ciclo encerrado — registros protegidos. Este período não pode mais ser reaberto ou alterado."
              : "Período consolidado — registros protegidos. Reabra o período no Resumo para editar."}
          </p>
          <Link href={`/resumo?data=${period.from}`}>
            <Button size="sm" variant="secondary">Abrir Resumo</Button>
          </Link>
        </div>
      )}
      {(() => {
        const saldo = summaries.reduce((s, x) => s + x.balanceMinutes, 0);
        const tracked = summaries.reduce((s, x) => s + x.workedDays, 0);
        // 4D.5.2 — mesma semântica canônica da 4D.5 (situations ⇒ attention-now),
        // aplicada ao RANGE EFETIVO da tela (days): período no modo período,
        // ciclo no modo ciclo. Nunca o count cego do escopo anual.
        const inconsistentes = days.filter((d) => d.situations.includes("registro-inconsistente")).length;
        const incompletos = days.filter((d) => d.situations.includes("registro-incompleto")).length;
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">
            <span className="font-extrabold text-slate-800">
              {query
                ? query.from === query.to
                  ? `Consulta ${formatDateShortBR(query.from)}`
                  : `Consulta ${formatDateShortBR(query.from)} → ${formatDateShortBR(query.to)}`
                : wantCycleScope
                ? `Ciclo ${getAnnualPointCycle(todayStr)} (${formatDateShortBR(cycleRange.from)} → ${formatDateShortBR(cycleRange.to)})`
                : `Período ${periodLabel(period)}`}
            </span>
            <span>Saldo <b className={saldo >= 0 ? "text-emerald-600" : "text-rose-600"}>{saldo >= 0 ? "+" : ""}{formatMinutes(saldo)}</b></span>
            <span>Dias com registro <b className="text-slate-900">{tracked}</b></span>
            <span>Inconsistentes <b className="text-amber-700">{inconsistentes}</b></span>
            <span>Incompletos <b className="text-amber-700">{incompletos}</b></span>
            <span>Sem registro <b className="text-amber-700">{missingCount}</b></span>
          </div>
        );
      })()}

      {/* E — AÇÕES DO PERÍODO (4G.2): imediatamente abaixo da faixa-resumo —
          separadas da navegação/filtros (funções diferentes, blocos diferentes).
          Comportamento funcional intacto; em período consolidado continuam
          disabled (somente leitura, conforme 4G). Registrar falta usa a MESMA
          linguagem amarelo/laranja do "Registro de hoje" (variant=warning);
          Lançamento manual permanece verde (primary). */}
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Button
          size="sm"
          disabled={!!lockBound}
          title={lockBound ? tituloAcaoBloqueada : undefined}
          className="flex-1 sm:flex-none"
          onClick={() => setManualOpen(true)}
        >
          Lançamento manual
        </Button>
        <Button
          variant="warning"
          size="sm"
          disabled={!!lockBound}
          title={lockBound ? tituloAcaoBloqueada : undefined}
          className="flex-1 sm:flex-none"
          onClick={() => { setFaltaInitialDate(null); setFaltaOpen(true); }}
        >
          <Ban size={14} /> Registrar falta
        </Button>
      </div>

      {situationActive && (
        <DaySituationChips
          selected={situationIds}
          found={listedDays.length}
          onRemove={(id) => writeSituacao(situationIds.filter((x) => x !== id))}
        />
      )}

      {/* 4D.5 — destino do CTA "Planejamento [10+] aguardando confirmação". */}
      {planoOnly && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 shadow-sm">
          <p className="min-w-0 flex-1 text-xs font-bold text-violet-800">
            ⏱ Planejamento [10+] aguardando confirmação: {planoCount} · filtro aplicado
            <span className="mt-0.5 block font-medium">
              {wantCycleScope
                ? "Escopo: ciclo anual atual — somente os dias com reserva que chegou ao dia."
                : "Somente os dias com reserva que chegou ao dia."}
            </span>
          </p>
          <Button size="sm" variant="secondary" onClick={limparFiltro}>
            Limpar filtro
          </Button>
        </div>
      )}

      {/* 4D.5 — indicador do escopo amplo vindo das faixas "Atenção agora". */}
      {wantCycleScope && !planoOnly && !pendingOnly && !missingOnly && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-xs font-bold text-slate-600">
            Escopo: ciclo anual {getAnnualPointCycle(todayStr)} (01/05 → 30/04)
            {focusDate ? ` · foco em ${focusDate.split("-").reverse().join("/")}` : ""}
            <span className="mt-0.5 block font-medium">Inclui pendências de períodos anteriores do mesmo ciclo.</span>
          </p>
          <Button size="sm" variant="secondary" onClick={voltarAoPeriodo}>
            Voltar ao período
          </Button>
        </div>
      )}

      {/* 4D.5.1 — as MESMAS quatro faixas "Atenção agora" da Visão Geral
          (fonte única attention-now; mesmo escopo ciclo), no modo normal de
          Registros. Ocultas quando um filtro específico está ativo (Parte C)
          e somente com contagem > 0. CTA aplica o filtro na própria página:
          1 item ⇒ + foco na data (card expandido). */}
      {!historicalPeriodView && !pendingOnly && !missingOnly && !planoOnly && !situationActive && (
        <section aria-label="Atenção agora" className="space-y-2">
          {attention.inconsistente.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    Registro inconsistente: {attention.inconsistente.length}
                  </p>
                  <p className="text-xs font-medium text-amber-700">
                    {attention.inconsistente.length === 1
                      ? "Há uma sequência de batidas que precisa ser corrigida."
                      : "Há sequências de batidas que precisam de correção."}
                  </p>
                </div>
              </div>
              <Link href={faixaHref(attention.inconsistente, "registro-inconsistente")} className="shrink-0 text-sm font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900">
                {attention.inconsistente.length === 1 ? "Ver inconsistência" : "Ver inconsistências"}
              </Link>
            </div>
          )}

          {attention.incompleto.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <FileWarning size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    Registro incompleto: {attention.incompleto.length}
                  </p>
                  <p className="text-xs font-medium text-amber-700">
                    {attention.incompleto.length === 1
                      ? "Há uma jornada encerrada com batida faltando."
                      : "Há jornadas encerradas com batida faltando."}
                  </p>
                </div>
              </div>
              <Link href={faixaHref(attention.incompleto, "registro-incompleto")} className="shrink-0 text-sm font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900">
                {attention.incompleto.length === 1 ? "Ver registro incompleto" : "Ver registros incompletos"}
              </Link>
            </div>
          )}

          {attention["sem-registro"].length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <CalendarOff size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    Dia sem registro: {attention["sem-registro"].length}
                  </p>
                  <p className="text-xs font-medium text-amber-700">
                    {attention["sem-registro"].length === 1
                      ? "Há um dia regular já encerrado sem ponto ou justificativa."
                      : "Há dias regulares já encerrados sem ponto ou justificativa."}
                  </p>
                </div>
              </div>
              <Link href={faixaHref(attention["sem-registro"], "sem-registro")} className="shrink-0 text-sm font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900">
                {attention["sem-registro"].length === 1 ? "Ver dia sem registro" : "Ver dias sem registro"}
              </Link>
            </div>
          )}

          {attention["plano-10"].length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-violet-300 bg-violet-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Hourglass size={16} aria-hidden className="mt-0.5 shrink-0 text-violet-600" />
                <div>
                  <p className="text-sm font-bold text-violet-900">
                    Planejamento [10+] aguardando confirmação: {attention["plano-10"].length}
                  </p>
                  <p className="text-xs font-medium text-violet-700">
                    {attention["plano-10"].length === 1
                      ? "Há uma reserva que chegou ao dia e precisa de decisão."
                      : "Há reservas que chegaram ao dia e precisam de decisão."}
                  </p>
                </div>
              </div>
              <Link href={planoFaixaHref(attention["plano-10"])} className="shrink-0 text-sm font-bold text-violet-700 underline underline-offset-2 hover:text-violet-900">
                {attention["plano-10"].length === 1 ? "Revisar planejamento" : "Revisar planejamentos"}
              </Link>
            </div>
          )}
        </section>
      )}

      {pendingOnly && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm">
          <>
              <p className="min-w-0 flex-1 text-xs font-bold text-amber-800">
                ⚠ Registros pendentes: {pendingCount} · filtro aplicado
                <span className="mt-0.5 block font-medium">Exibindo somente os registros que precisam de correção.</span>
              </p>
              <Button size="sm" variant="warning" onClick={voltarAoPeriodo}>
                Voltar aos registros do período
              </Button>
            </>
        </div>
      )}

      {missingOnly && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
          <>
              <p className="min-w-0 flex-1 text-xs font-bold text-amber-800">
                ⚠ Dias sem registro: {missingCount} · filtro aplicado
                <span className="mt-0.5 block font-medium">Exibindo somente os dias de expediente sem registro ou justificativa.</span>
              </p>
              <Button size="sm" variant="warning" onClick={voltarAoPeriodo}>
                Voltar aos registros do período
              </Button>
            </>
        </div>
      )}

      {/* Dias — todos recolhidos por padrão */}
      {days.length === 0 ? (
        <EmptyState
          icon={<Clock3 size={26} />}
          title={query ? "Nenhum registro no intervalo consultado" : "Nenhum registro neste período"}
          description="Use o lançamento manual para incluir entradas e saídas de dias anteriores."
        />
      ) : listedDays.length === 0 ? (
        <EmptyState
          icon={<Clock3 size={26} />}
          title="Nenhum dia encontrado com os filtros selecionados."
          description="Ajuste a situação do dia ou o intervalo consultado."
          action={
            <Button variant="secondary" size="sm" onClick={() => writeSituacao([])}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <>
          {/* 4D.5.2 — a faixa legada global de planejamentos [10+] FOI REMOVIDA:
              a única faixa de planejamento é a violeta compartilhada da 4D.5
              (fonte única attention-now), exibida no modo normal; com o filtro
              plano-10 ativo resta apenas o contexto violeta do filtro. */}          <div className={missingOnly || pendingOnly || planoOnly ? "space-y-4" : "space-y-2"}>
          {listedDays.map(({ date, balanceView, displayDay, absence, calendarLabel, falta, workedInAbonoMinutes, abonoParcial, missingExpected, historicalEmpty, compact, specialExcess, specialPlans, planningCapacityMinutes, calendarSemantics }) => (
            <div key={date} id={`dia-card-${date}`}>
            <DayCard
              /* 4D.5.2 — a identidade muda quando o FOCO transiciona: navegando
               * client-side na MESMA página (muda ?data=), o card focado é
               * REMONTADO e lê initiallyExpanded fresco (a prop só é lida no
               * primeiro mount). Sem efeito/setState — sem cascata de render;
               * com o foco ativo o usuário ainda recolhe/expande manualmente
               * (a key só muda de novo quando o foco sai). */
              key={focusDate === date ? `${date}-atencao` : date}
              consolidated={consolidationLockForDate(periodConsolidations, date) !== null}
              result={displayDay}
              settings={settings}
              allComps={compensations}
              nowMinutes={nowMinutes}
              isToday={date === todayStr}
              initiallyExpanded={focusDate === date}
              absence={absence}
              calendarLabel={calendarLabel}
              falta={falta}
              missingExpected={missingExpected}
              historicalEmpty={historicalEmpty}
              compact={compact}
              onRegisterFalta={
                missingExpected
                  ? () => {
                      setFaltaInitialDate(date);
                      setFaltaOpen(true);
                    }
                  : undefined
              }
              onFillDayRecords={missingExpected || historicalEmpty ? () => setFillDate(date) : undefined}
              effectiveExpected={balanceView.effectiveExpected}
              balanceView={balanceView}
              onAddEntry={addEntry}
              onUpdateEntry={updateEntry}
              onDeleteEntry={deleteEntry}
              onCompleteComp={completeComp}
              onRemoveFalta={removeFalta}
              abonadoHint={(() => {
                const a = isAbonadoDay(date, absences, companyCalendars);
                return a.abonado ? { label: a.label ?? "Dia abonado" } : null;
              })()}
              workedInAbonoMinutes={workedInAbonoMinutes}
              abonoParcial={abonoParcial}
              specialExcess={specialExcess.eligible || specialExcess.activeUses.length > 0 ? specialExcess : null}
              onCompleteJornada={(d) => setCompleteDate(d)}
              specialPlans={specialPlans}
              // 4B: a ação de planejar só é oferecida para dia FUTURO
              // (destinationDate > hoje); 4D.3 exige base efetiva positiva e
              // o store 4A continua o gate final.
              onPlanSpecial={date > todayStr ? () => setPlanDate(date) : undefined}
              planningCapacityMinutes={planningCapacityMinutes}
              calendarSemantics={calendarSemantics}
              // 4C: resolução individual do plano (modal "Usar planejamento").
              onResolvePlan={(planId) => setResolvePlanId(planId)}
            />
            </div>
          ))}
          </div>
        </>
      )}

      <Card padded={false} className="bg-slate-900 !border-slate-800">
        <div className="grid gap-4 px-5 py-4 text-xs text-slate-300 sm:grid-cols-3">
          <p>
            <span className="font-bold text-emerald-400">Período do ponto:</span> dia 21 até dia 20
            do mês seguinte (especiais: 21/04–30/04 e 01/05–20/05 no fechamento anual).
          </p>
          <p>
            <span className="font-bold text-rose-400">Limite da empresa:</span>{" "}
            {formatMinutes(settings.maxDailyMinutes)} por dia. O que passar disso é excedente e
            precisa ser compensado no mesmo ciclo anual.
          </p>
          <p>
            <span className="font-bold text-sky-400">Férias e afastamentos:</span> não geram déficit.
            Acordo &quot;compensar posteriormente&quot; vira pendência própria, nunca déficit comum.
          </p>
        </div>
      </Card>

      <ManualEntryModal open={manualOpen} onClose={() => setManualOpen(false)} />
      {fillDate && (
        <FillDayRecordsModal
          date={fillDate}
          onClose={() => setFillDate(null)}
          onSaved={() => {
            const d = fillDate;
            setFillDate(null);
            toast.show("Registros do dia salvos!");
            if (d) {
              reconcileDay(d);
            }
          }}
        />
      )}
      <FaltaModal
        open={faltaOpen}
        onClose={() => {
          setFaltaOpen(false);
          setFaltaInitialDate(null);
        }}
        initialDate={faltaInitialDate ?? todayStr}
        entries={entries}
        absences={absences}
        companyCalendars={companyCalendars}
        settings={settings}
        faltas={faltas}
        todayStr={todayStr}
        onSave={registerFalta}
      />
      {/* NOVO [10+] (Etapa 3E): modal "Completar jornada com [10+]". */}
      {completeDate && (
        <SpecialExcessUseModal date={completeDate} onClose={() => setCompleteDate(null)} />
      )}
      {/* NOVO [10+] (Etapa 4B): modal "Planejar uso de [10+]" (reserva futura). */}
      {planDate && (
        <SpecialExcessPlanModal date={planDate} onClose={() => setPlanDate(null)} />
      )}
      {/* NOVO [10+] (Etapa 4C): modal "Usar planejamento [10+]" (dia chegou —
          decisão explícita; store resolveSpecialExcessPlan é atômico). */}
      {resolvePlanId &&
        (() => {
          const plan = (specialExcessPlans ?? []).find((pl) => pl.id === resolvePlanId && pl.status === "planned");
          return plan ? <SpecialExcessPlanResolveModal plan={plan} onClose={() => setResolvePlanId(null)} /> : null;
        })()}
    </div>
  );
}
