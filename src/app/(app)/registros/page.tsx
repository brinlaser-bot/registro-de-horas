"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, CalendarClock, ChevronLeft, ChevronRight, Clock3, Search, X } from "lucide-react";
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
  type Absence,
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
  listDaysBetween,
  periodLabel,
  sameAnnualCycle,
  type PointPeriod,
} from "@/lib/periods";
import { acordoViewOf, buildDebtDays, checkSourceOverflow, extraCapacityForDate } from "@/lib/debt";
import { dayBalanceContribution, effectiveFaltas, faltaOnDate, faltaStatusOf } from "@/lib/faltas";
import { dayCreditView, excessReasonOnDate, shouldPromptExcessReason } from "@/lib/hour-bank";
import type { CompKind, DayResult, WorkSettings } from "@/lib/types";
import { DayCard } from "@/components/day-card";
import { ManualEntryModal, type ManualPairData } from "@/components/manual-entry-modal";
import { FaltaModal } from "@/components/falta-modal";
import { ExcessReasonModal } from "@/components/excess-reason-modal";
import { AllocateExcessModal } from "@/components/allocate-excess-modal";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
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
  const toast = useToast();
  const mounted = useIsClient();
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

  // Dias do intervalo: com batidas OU cobertos por ausência
  const days = useMemo(() => {
    const dates = new Set<string>();
    for (const e of entries) {
      if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
    }
    for (const a of absences) {
      for (const d of listDaysBetween(a.startDate, a.endDate)) {
        if (d >= range.from && d <= range.to) dates.add(d);
      }
    }
    for (const e of (companyCalendars ?? []).flatMap((c) => c.entries)) {
      if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
    }
    // Faltas registradas (efetivas E previstas) também ganham card no intervalo
    for (const f of faltas) {
      if (f.date >= range.from && f.date <= range.to) dates.add(f.date);
    }
    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const cctx = companyDayContext(date, entries, absences, companyCalendars, settings, date === todayStr ? nowMinutes : undefined);
        const baseView = companyDayBalanceView(cctx);
        const falta = faltaOnDate(faltas, date);
        const faltaStatus = falta ? faltaStatusOf(date, todayStr) : null;
        return {
          date,
          ctx: cctx.ctx,
          calendarLabel: cctx.label,
          falta: falta
            ? { id: falta.id, status: faltaStatus!, jornadaMinutes: cctx.effectiveExpected }
            : undefined,
          /* View model central: card e resumo consomem SEMPRE a resolução central
           * (calendário/folga/evento) — nunca o saldo bruto de computeDay/dayContext.
           * Falta PREVISTA: saldo/déficit mascarados em 0 até a data chegar. */
          balanceView:
            faltaStatus === "prevista"
              ? { ...baseView, adjustedBalance: 0, adjustedDeficit: 0 }
              : baseView,
          displayDay: cctx.displayDay,
          // Contribuição CENTRAL (dayBalanceContribution) — MESMA soma da
          // Visão geral e do Resumo do período (falta efetiva conta; prevista 0).
          balanceContribution: dayBalanceContribution(cctx, faltas, date, todayStr),
          deficitContribution: faltaStatus === "prevista" ? 0 : companyDeficitContribution(cctx),
          absence: absenceOnDate(absences, date),
        };
      });
  }, [entries, absences, companyCalendars, faltas, settings, range, todayStr, nowMinutes]);

  // Resumo do intervalo, AGRUPADO POR CICLO ANUAL (nunca mistura pendências)
  const summaries = useMemo(() => {
    // SEMPRE com a coleção de calendários: a resolução central zera o déficit
    // comum em folga/abonado/recesso/folga a compensar (sem "8h − trabalhado").
    const debts = buildDebtDays(entries, compensations, settings, range, absences, companyCalendars, effectiveFaltaList);
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
      if (ctx.day.entries.length > 0) {
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
    const debts = buildDebtDays(entries, compensations, settings, range, absences, companyCalendars, effectiveFaltaList);
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
    toast.show("Falta removida. O déficit dela foi revertido.");
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
    if (!queryDraft.from || !queryDraft.to) {
      toast.show("Informe as datas inicial e final.", "error");
      return;
    }
    if (queryDraft.to < queryDraft.from) {
      toast.show("A data final não pode ser anterior à inicial.", "error");
      return;
    }
    setQuery({ from: queryDraft.from, to: queryDraft.to });
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
          <Button variant="secondary" size="sm" onClick={() => setFaltaOpen(true)}>
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
          <Button variant="secondary" size="sm" onClick={runQuery}>
            <Search size={14} /> Consultar
          </Button>
        </div>
      </div>

      {/* Resumo do intervalo — agrupado por ciclo anual */}
      {summaries.length > 0 && (
        <Card
          title={query ? "Resumo do intervalo consultado" : "Resumo do período"}
          subtitle={
            summaries.length > 1
              ? "Intervalo atravessa ciclos anuais — as pendências NÃO são transferíveis entre ciclos."
              : undefined
          }
        >
          <div className="space-y-4">
            {summaries.map((s) => (
              <div key={s.cycle} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                {summaries.length > 1 && (
                  <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                    Ciclo anual {s.cycle}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-3 lg:grid-cols-4">
                  <Sum label="Dias trabalhados" value={String(s.workedDays)} />
                  <Sum label="Horas trabalhadas" value={formatMinutes(s.workedMinutes)} />
                  <Sum label="No ponto" value={formatMinutes(s.registrableMinutes)} />
                  <Sum
                    label="Saldo"
                    value={`${s.balanceMinutes >= 0 ? "+" : ""}${formatMinutes(s.balanceMinutes)}`}
                    tone={s.balanceMinutes >= 0 ? "text-emerald-600" : "text-rose-600"}
                  />
                  <Sum label="Excedentes" value={formatMinutes(s.excessMinutes)} />
                  <Sum label="Déficit" value={formatMinutes(s.deficitMinutes)} />
                  <Sum label="Horas compensadas" value={formatMinutes(s.compensatedMinutes)} />
                  <Sum label="Compensações pendentes" value={formatMinutes(s.pendingCompMinutes)} />
                  <Sum label="Férias (dias)" value={String(s.vacationDays)} />
                  <Sum label="Saúde (dias)" value={String(s.healthDays)} />
                  <Sum label="Dispensados (dias)" value={String(s.waivedDays)} />
                  <Sum label="Faltas (dias)" value={String(s.faltaDays)} />
                  {s.faltaPrevistaDays > 0 && (
                    <Sum label="Faltas previstas" value={String(s.faltaPrevistaDays)} />
                  )}
                  <Sum
                    label="Acordo a compensar"
                    value={`${formatMinutes(s.acordoTotal)} (feito ${formatMinutes(s.acordoDone)} · falta ${formatMinutes(s.acordoPending)})`}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Dias — todos recolhidos por padrão */}
      {days.length === 0 ? (
        <EmptyState
          icon={<Clock3 size={26} />}
          title={query ? "Nenhum registro no intervalo consultado" : "Nenhum registro neste período"}
          description="Use o lançamento manual para incluir entradas e saídas de dias anteriores."
        />
      ) : (
        <div className="space-y-4">
          {days.map(({ date, balanceView, displayDay, absence, calendarLabel, falta }) => (
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

      <ManualEntryModal open={manualOpen} onClose={() => setManualOpen(false)} onSave={addManualPair} />
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
      <FaltaModal
        open={faltaOpen}
        onClose={() => setFaltaOpen(false)}
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

function Sum({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-inset ring-slate-200">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`font-extrabold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}
