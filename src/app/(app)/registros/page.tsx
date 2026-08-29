"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, ChevronLeft, ChevronRight, Clock3, Search, X } from "lucide-react";
import { actions, getAppData, settingsOf, useAppData, useIsClient } from "@/lib/store";
import {
  computeDay,
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
  companyDayBalanceView,
  companyDayContext,
  companyDeficitContribution,
} from "@/lib/company-calendar";
import {
  getAnnualPointCycle,
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  periodLabel,
  sameAnnualCycle,
  type PointPeriod,
} from "@/lib/periods";
import { acordoViewOf, buildDebtDays, checkSourceOverflow, extraCapacityForDate } from "@/lib/debt";
import { compensarObligationOnDate, isAbonadoDay } from "@/lib/compensar";
import { dayBalanceContribution, effectiveFaltas, faltaOnDate, faltaStatusOf } from "@/lib/faltas";
import { dayCreditView, excessReasonOnDate, hasEligibleSpecialExcessInCycle, shouldPromptExcessReason } from "@/lib/hour-bank";
import { isMissingExpectedRecord, registrosTimelineDates } from "@/lib/missing-records";
import {
  dayMatchesSituations,
  parseSituationParam,
  serializeSituationParam,
  situationsFromView,
  type DaySituationId,
} from "@/lib/day-situation";

import type { CompKind, WorkSettings } from "@/lib/types";
import { DayCard } from "@/components/day-card";
import { ManualEntryModal, type ManualPairData } from "@/components/manual-entry-modal";
import { FaltaModal } from "@/components/falta-modal";
import { FillDayRecordsModal } from "@/components/fill-day-records-modal";
import { ExcessReasonModal } from "@/components/excess-reason-modal";
import { AllocateExcessModal } from "@/components/allocate-excess-modal";
import { DaySituationChips, DaySituationFilter } from "@/components/day-situation-filter";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, entries, compensations, absences, companyCalendars, faltas, excessReasons } = useAppData();
  const todayStr = todayString();

  const settings: WorkSettings = settingsOf(user);

  // Navegação por período oficial do ponto (21→20, com especiais 21/04–30/04 e 01/05–20/05)
  const [period, setPeriod] = useState<PointPeriod>(() => getPointPeriod(todayStr));
  // Consulta personalizada (apenas leitura, pode atravessar períodos/ciclos/anos)
  const [query, setQuery] = useState<{ from: string; to: string } | null>(null);
  const [queryDraft, setQueryDraft] = useState({ from: "", to: "" });
  const [manualOpen, setManualOpen] = useState(false);
  const [faltaOpen, setFaltaOpen] = useState(false);
  const [reasonDate, setReasonDate] = useState<string | null>(null);
  const [allocateDate, setAllocateDate] = useState<string | null>(null);
  const [allocateFromDeficit, setAllocateFromDeficit] = useState<{ date: string; kind?: CompKind } | null>(null);
  const [faltaInitialDate, setFaltaInitialDate] = useState<string | null>(null);
  const [fillDate, setFillDate] = useState<string | null>(null);
  const wantPending = searchParams.get("pendentes") === "1";
  const wantMissing = searchParams.get("semRegistro") === "1";
  const situacaoRaw = searchParams.get("situacao");
  const situationIds = parseSituationParam(
    wantPending || wantMissing ? null : situacaoRaw,
  );

  // Faltas que JÁ valem (date <= hoje) — previstas não geram déficit/saldo
  const effectiveFaltaList = useMemo(() => effectiveFaltas(faltas, todayStr), [faltas, todayStr]);

  // Relógio para o assistente de saída em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

  const range = query ?? period;
  const cycleHasSpecial = useMemo(
    () =>
      hasEligibleSpecialExcessInCycle(
        entries, compensations, absences, companyCalendars, settings, excessReasons, todayStr,
      ),
    [entries, compensations, absences, companyCalendars, settings, excessReasons, todayStr],
  );

  // Linha do tempo completa: UM card por data do intervalo, mesmo sem batidas.
  const days = useMemo(() => {
    return registrosTimelineDates(range)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const cctx = companyDayContext(date, entries, absences, companyCalendars, settings, date === todayStr ? nowMinutes : undefined);
        const baseView = companyDayBalanceView(cctx);
        const falta = faltaOnDate(faltas, date);
        const faltaStatus = falta ? faltaStatusOf(date, todayStr) : null;
        const missingExpected = isMissingExpectedRecord(date, todayStr, cctx, faltas);
        const creditView = dayCreditView(date, entries, compensations, absences, companyCalendars, settings, excessReasons);
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
          calendarLabel: cctx.label,
          falta: falta
            ? { id: falta.id, status: faltaStatus!, jornadaMinutes: cctx.effectiveExpected }
            : undefined,
          /* View model central: card e resumo consomem SEMPRE a resolução central
           * (calendário/folga/evento) — nunca o saldo bruto de computeDay/dayContext.
           * Falta PREVISTA: saldo/déficit mascarados em 0 até a data chegar.
           * SEM REGISTRO: pendência operacional — não inventa déficit/saldo. */
          balanceView:
            date > todayStr || missingExpected
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
          deficitContribution:
            missingExpected || date > todayStr || faltaStatus === "prevista" ? 0 : companyDeficitContribution(cctx),
          absence: absenceOnDate(absences, date),
          missingExpected,
          compact,
          creditView,
          situations,
        };
      });
  }, [entries, compensations, absences, companyCalendars, faltas, excessReasons, settings, range, todayStr, nowMinutes]);

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
  const pendingOnly = wantPending && !wantMissing && pendingCount > 0;
  const missingOnly = wantMissing && !wantPending && missingCount > 0;
  const situationActive = situationIds.length > 0 && !pendingOnly && !missingOnly;
  const listedDays = pendingOnly
    ? days.filter((d) => d.displayDay.financialPending || !d.displayDay.consistent)
    : missingOnly
    ? days.filter((d) => d.missingExpected)
    : situationActive
    ? days.filter((d) => dayMatchesSituations(d.situations, situationIds))
    : days;

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
  }, [wantPending, wantMissing, pendingCount, missingCount, router, situacaoRaw]);

  /* ── Handlers (preservam comportamento validado) ── */

  const snapshotDay = (date: string) => {
    const snap = getAppData();
    return computeDay(
      snap.entries.filter((e) => e.date === date),
      settingsOf(snap.user),
    );
  };

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

  const addEntry = async (p: { date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }) => {
    // §7: data futura → bloquear ANTES de tratar qualquer conflito com falta
    if (isFutureDate(p.date)) {
      toast.show(FUTURE_DATE_ERROR, "error");
      return;
    }
    if (!resolveFaltaConflict(p.date)) return;
    const before = snapshotDay(p.date);
    const res = actions.addEntry(p);
    if (!res.ok) {
      toast.show(res.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
    promptExcessReasonIfNeeded(p.date, before);
    reconcileDay(p.date);
  };

  const updateEntry = async (id: number, patch: { time?: string; type?: EntryType; note?: string | null; date?: string }) => {
    const target = entries.find((e) => e.id === id);
    const before = target ? snapshotDay(target.date) : { excessMinutes: 0, open: false };
    const res = actions.updateEntry(id, patch);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível editar o registro.", "error");
      return;
    }
    if (target) {
      promptExcessReasonIfNeeded(target.date, before);
      reconcileDay(target.date);
    }
  };

  const deleteEntry = async (id: number) => {
    const target = entries.find((e) => e.id === id);
    // §25: excluir usa a MESMA guarda central do updateEntry — bloqueado se a
    // batida sustenta compensação concluída (origem OU destino).
    const res = actions.deleteEntry(id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível excluir o registro.", "error");
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

  /** Atalhos de compensação por dia (déficit comum / acordo), via funções centrais. */
  const shortcutsByDate = useMemo(() => {
    // Idem: a mesma resolução central do card/resumo. Em folga com trabalho
    // (Trabalho em folga) o ajustedDeficit central é 0 → nenhum banner
    // "Déficit pendente" / botão "Quitar com hora extra" é exibido.
    const debts = buildDebtDays(entries, compensations, settings, range, absences, companyCalendars, effectiveFaltaList, todayStr);
    const map = new Map<
      string,
      {
        deficitRemaining: number;
        acordoMinutes: number;
        acordoCompensated: number;
        acordoPlanned: number;
        acordoRemaining: number;
        canCompensate: boolean;
      }
    >();
    for (const dd of debts) {
      const cur = map.get(dd.date) ?? {
        deficitRemaining: 0,
        acordoMinutes: 0,
        acordoCompensated: 0,
        acordoPlanned: 0,
        acordoRemaining: 0,
        canCompensate: sameAnnualCycle(dd.date, todayStr),
      };
      if (dd.kind === "deficit") cur.deficitRemaining = dd.remainingMinutes;
      if (dd.kind === "acordo") {
        // Valores vindos da função central acordoViewOf (sem recalcular aqui)
        const acordo = acordoViewOf(dd);
        cur.acordoMinutes = acordo.originalMinutes;
        cur.acordoCompensated = acordo.compensatedMinutes;
        cur.acordoPlanned = acordo.plannedMinutes;
        cur.acordoRemaining = acordo.remainingMinutes;
      }
      map.set(dd.date, cur);
    }
    return map;
  }, [entries, compensations, absences, companyCalendars, effectiveFaltaList, settings, range, todayStr]);

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

  const createComp = async (payload: { sourceDate: string; targetDate: string; minutes: number; note: string; kind?: CompKind }) => {
    const res = actions.addComp({ ...payload, note: payload.note || null, kind: payload.kind ?? "excedente" });
    if (!res.ok) throw new Error(res.error); // modal exibe a mensagem e permanece aberto
  };

  const capComp = async (date: string, kind: CompKind, maxMinutes: number) => {
    actions.capCompensationsForSource(date, kind, maxMinutes);
    toast.show("Compensação ajustada para manter consistência.");
  };

  const addManualPair = async (data: ManualPairData) => {
    // §4/§7: data futura → bloquear ANTES de tratar qualquer conflito com falta
    if (isFutureDate(data.date)) {
      toast.show(FUTURE_DATE_ERROR, "error");
      return;
    }
    if (!resolveFaltaConflict(data.date)) return;
    const before = snapshotDay(data.date);
    const r1 = actions.addEntry({ date: data.date, time: data.entrada, type: "entrada", note: data.note || null, source: "manual" });
    if (!r1.ok) {
      toast.show(r1.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
    const r2 = actions.addEntry({ date: data.date, time: data.saida, type: "saida", note: data.note || null, source: "manual" });
    if (!r2.ok) {
      toast.show(r2.error ?? FUTURE_DATE_ERROR, "error");
      return;
    }
    promptExcessReasonIfNeeded(data.date, before);
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

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Navegação por período oficial + consulta personalizada */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setQuery(null); setPeriod(getPreviousPointPeriod(period)); }} aria-label="Período anterior">
            <ChevronLeft size={16} />
          </Button>
          <div className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-extrabold text-slate-800">
            {query ? (
              <span>
                Consulta: {formatDateShortBR(query.from)} → {formatDateShortBR(query.to)}
              </span>
            ) : (
              <span>
                Período do ponto: {periodLabel(period)}
              </span>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => { setQuery(null); setPeriod(getNextPointPeriod(period)); }} aria-label="Próximo período">
            <ChevronRight size={16} />
          </Button>
          {(query || periodLabel(period) !== periodLabel(getPointPeriod(todayStr))) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery(null);
                setPeriod(getPointPeriod(todayStr));
              }}
            >
              Período atual
            </Button>
          )}
          {query && (
            <Button variant="ghost" size="sm" onClick={() => setQuery(null)}>
              <X size={13} /> Limpar consulta
            </Button>
          )}
          <Button size="sm" onClick={() => setManualOpen(true)}>
            Lançamento manual
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setFaltaInitialDate(null); setFaltaOpen(true); }}>
            <Ban size={14} /> Registrar falta
          </Button>
        </div>

        {/* Consulta personalizada */}
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
      {(() => {
        const saldo = summaries.reduce((s, x) => s + x.balanceMinutes, 0);
        const tracked = summaries.reduce((s, x) => s + x.workedDays, 0);
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">
            <span className="font-extrabold text-slate-800">
              {query
                ? query.from === query.to
                  ? `Consulta ${formatDateShortBR(query.from)}`
                  : `Consulta ${formatDateShortBR(query.from)} → ${formatDateShortBR(query.to)}`
                : `Período ${periodLabel(period)}`}
            </span>
            <span>Saldo <b className={saldo >= 0 ? "text-emerald-600" : "text-rose-600"}>{saldo >= 0 ? "+" : ""}{formatMinutes(saldo)}</b></span>
            <span>Dias com registro <b className="text-slate-900">{tracked}</b></span>
            <span>Pendentes <b className="text-amber-700">{pendingCount}</b></span>
            <span>Sem registro <b className="text-amber-700">{missingCount}</b></span>
          </div>
        );
      })()}

      {situationActive && (
        <DaySituationChips
          selected={situationIds}
          found={listedDays.length}
          onRemove={(id) => writeSituacao(situationIds.filter((x) => x !== id))}
        />
      )}

      {pendingCount > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm">
          {pendingOnly ? (
            <>
              <p className="min-w-0 flex-1 text-xs font-bold text-amber-800">
                ⚠ Registros pendentes: {pendingCount} · filtro aplicado
                <span className="mt-0.5 block font-medium">Exibindo somente os registros que precisam de correção.</span>
              </p>
              <Button size="sm" variant="warning" onClick={() => router.replace("/registros")}>
                Voltar aos registros do período
              </Button>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-xs font-bold text-amber-800">
                ⚠ Registros pendentes: {pendingCount}
                <span className="mt-0.5 block font-medium">Existem dias que precisam de correção antes do saldo ser definitivo.</span>
              </p>
              <Button size="sm" variant="warning" onClick={() => router.replace("/registros?pendentes=1")}>
                Ver pendências
              </Button>
            </>
          )}
        </div>
      )}

      {missingCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
          {missingOnly ? (
            <>
              <p className="min-w-0 flex-1 text-xs font-bold text-amber-800">
                ⚠ Dias sem registro: {missingCount} · filtro aplicado
                <span className="mt-0.5 block font-medium">Exibindo somente os dias de expediente sem registro ou justificativa.</span>
              </p>
              <Button size="sm" variant="warning" onClick={() => router.replace("/registros")}>
                Voltar aos registros do período
              </Button>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-xs font-bold text-amber-800">
                ⚠ Dias sem registro: {missingCount}
                <span className="mt-0.5 block font-medium">Existem dias de expediente já encerrados sem registro ou justificativa.</span>
              </p>
              <Button size="sm" variant="warning" onClick={() => router.replace("/registros?semRegistro=1")}>
                Ver dias sem registro
              </Button>
            </>
          )}
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
        <div className={missingOnly || pendingOnly ? "space-y-4" : "space-y-2"}>
          {listedDays.map(({ date, balanceView, displayDay, absence, calendarLabel, falta, workedInAbonoMinutes, abonoParcial, missingExpected, compact }) => (
            <DayCard
              key={date}
              result={displayDay}
              settings={settings}
              compsForDate={compensations.filter((c) => c.targetDate === date)}
              allComps={compensations}
              nowMinutes={nowMinutes}
              isToday={date === todayStr}
              absence={absence}
              calendarLabel={calendarLabel}
              falta={falta}
              missingExpected={missingExpected}
              compact={compact}
              onRegisterFalta={
                missingExpected
                  ? () => {
                      setFaltaInitialDate(date);
                      setFaltaOpen(true);
                    }
                  : undefined
              }
              onFillDayRecords={missingExpected ? () => setFillDate(date) : undefined}
              effectiveExpected={balanceView.effectiveExpected}
              balanceView={balanceView}
              shortcuts={shortcutsByDate.get(date)}
              getCapacity={(targetDate) =>
                extraCapacityForDate(targetDate, entries, compensations, settings, { companyCalendars })
              }
              onAddEntry={addEntry}
              onUpdateEntry={updateEntry}
              onDeleteEntry={deleteEntry}
              onCompleteComp={completeComp}
              onCreateComp={createComp}
              onCapComp={capComp}
              onRemoveFalta={removeFalta}
              creditView={dayCreditView(date, entries, compensations, absences, companyCalendars, settings, excessReasons)}
              onRegisterReason={(d) => setReasonDate(d)}
              onAllocateExcess={(d) => setAllocateDate(d)}
              onUseAvailableExcess={(d, kind) => setAllocateFromDeficit({ date: d, kind })}
              hasAvailableSpecialExcess={cycleHasSpecial}
              compensarHint={(() => {
                const obl = compensarObligationOnDate(
                  date, entries, compensations, absences, companyCalendars, settings, todayStr,
                );
                return obl
                  ? {
                      label: obl.originLabel,
                      originalMinutes: obl.originalMinutes,
                      effectiveObligationMinutes: obl.effectiveObligationMinutes,
                      completedMinutes: obl.completedMinutes,
                      plannedMinutes: obl.plannedMinutes,
                      openMinutes: obl.openMinutes,
                      compKind: obl.compKind,
                    }
                  : null;
              })()}
              abonadoHint={(() => {
                const a = isAbonadoDay(date, absences, companyCalendars);
                return a.abonado ? { label: a.label ?? "Dia abonado" } : null;
              })()}
              workedInAbonoMinutes={workedInAbonoMinutes}
              abonoParcial={abonoParcial}
            />
          ))}
        </div>
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
              promptExcessReasonIfNeeded(d, { excessMinutes: 0, open: false });
              reconcileDay(d);
            }
          }}
        />
      )}
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
      {allocateDate && (
        <AllocateExcessModal
          open
          onClose={() => setAllocateDate(null)}
          excessDate={allocateDate}
          entries={entries}
          compensations={compensations}
          absences={absences}
          companyCalendars={companyCalendars}
          faltas={faltas}
          excessReasons={excessReasons}
          settings={settings}
        />
      )}
      {allocateFromDeficit && (
        <AllocateExcessModal
          open
          onClose={() => setAllocateFromDeficit(null)}
          deficitDate={allocateFromDeficit.date}
          deficitKind={allocateFromDeficit.kind}
          entries={entries}
          compensations={compensations}
          absences={absences}
          companyCalendars={companyCalendars}
          faltas={faltas}
          excessReasons={excessReasons}
          settings={settings}
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
    </div>
  );
}
