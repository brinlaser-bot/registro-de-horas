// ─────────────────────────────────────────────────────────────
// ETAPA 4H — GATE DE FECHAMENTO ANUAL (PURA, sem store/UI).
//
// "Encerrar ciclo" é uma decisão MANUAL e DEFINITIVA (não existe reabrir).
// Um ciclo terminou no calendário quando today > cycleEnd (30/04),
// SEMPRE em data civil local (America/Sao_Paulo; nunca UTC).
//
// PRÉ-REQUISITOS (seção 9):
//   A. o ciclo já terminou (today > cycleEnd);
//   B. não há pendência bloqueante canônica nas datas CONTROLADAS do ciclo;
//   C. os períodos do ponto da parte CONTROLADA estão consolidados;
//   D. o período curto 21/04→30/04 está consolidado (cai em C);
//   E. nenhum plano/reserva [10+] pendente (planned) no ciclo;
//   F. datas totalmente anteriores a controlStartDate NÃO criam pendência
//      artificial (controlledFrom = controlStartDate quando aplicável).
//
// controlStartDate é preservado integralmente. Datas anteriores a ele são
// neutras quando vazias (sem déficit inventado); períodos que intersectam o
// controlStartDate, possuem registros factuais ou já pertencem ao histórico
// controlado seguem a arquitetura canônica.
//
// NENHUMA matemática nova: pendência e consolidação delegam aos motores
// canônicos (attentionNowSummary, activeConsolidationForPeriod).
// ─────────────────────────────────────────────────────────────
import { annualCycleBounds, getNextPointPeriod, getPointPeriod, periodLabel, type PointPeriod } from "./periods";
import { closureForCycle, previousCycleLabel, type AnnualCycleClosure } from "./annual-cycle-closure";
import { activeConsolidationForPeriod } from "./period-consolidation";
import { attentionNowSummary } from "./attention-now";
import { buildSpecialExcessBank } from "./special-excess-bank";
import type { CompanyCalendars } from "./company-calendar";
import type { Absence } from "./absences";
import type { Falta, TimeEntry, WorkSettings } from "./types";
import type { SpecialExcessPlan } from "./special-excess-plan";
import type { SpecialExcessUse } from "./special-excess-use";
import type { PeriodConsolidation } from "./period-consolidation";
import type { AnnualCycleClosureSourceSlice as Slice } from "./annual-cycle-closure";

export type { AnnualCycleClosureSourceSlice } from "./annual-cycle-closure";

/** primeiro dia CONTROLADO do ciclo (>= controlStartDate), no recorte do ciclo. */
export function controlledFromOf(controlStartDate: string | null | undefined, cycleStart: string): string {
  if (!controlStartDate) return cycleStart;
  return controlStartDate > cycleStart ? controlStartDate : cycleStart;
}

/** Períodos canônicos do ponto que cobrem [from, to] (partição, sem lacuna). */
export function periodsCovering(from: string, to: string): PointPeriod[] {
  const out: PointPeriod[] = [];
  let p = getPointPeriod(from);
  while (p.from <= to) {
    out.push(p);
    if (p.to >= to) break;
    p = getNextPointPeriod(p);
  }
  return out;
}

export interface CycleCloseEligibility {
  ok: boolean;
  label: string;
  cycleStart: string;
  cycleEnd: string;
  ended: boolean;
  alreadyClosed: boolean;
  controlledFrom: string;
  /** períodos obrigatórios (rótulo DD/MM → DD/MM) que precisam estar consolidados. */
  requiredPeriodLabels: string[];
  /** períodos obrigatórios NÃO consolidados (bloqueiam). */
  missingConsolidationLabels: string[];
  /** datas controladas com pendência bloqueante de apuração. */
  blockingPendencyDates: string[];
  /** planos/reservas [10+] ainda planned com destino no ciclo. */
  pendingPlans: number;
  /** mensagens humanas dos bloqueios (vazio ⇒ ok). */
  blockers: string[];
}

export function checkCycleClose(input: {
  today: string;
  label: string;
  closures: AnnualCycleClosure[] | undefined;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null | undefined;
  plans: SpecialExcessPlan[];
  consolidations: PeriodConsolidation[] | undefined;
}): CycleCloseEligibility {
  const { label } = input;
  const { from: cycleStart, to: cycleEnd } = annualCycleBounds(label);
  const alreadyClosed = closureForCycle(input.closures, label) !== null;
  const ended = input.today > cycleEnd;

  const controlledFrom = controlledFromOf(input.controlStartDate, cycleStart);
  const required = periodsCovering(controlledFrom, cycleEnd);
  const requiredPeriodLabels = required.map(periodLabel);
  const missingConsolidationLabels = required
    .filter((p) => !activeConsolidationForPeriod(input.consolidations, p.from, p.to))
    .map(periodLabel);

  const pend = attentionNowSummary({
    today: input.today,
    entries: input.entries,
    absences: input.absences,
    calendars: input.calendars,
    settings: input.settings,
    faltas: input.faltas,
    controlStartDate: input.controlStartDate,
    plans: input.plans,
    range: { from: controlledFrom, to: cycleEnd },
  });
  const blockingPendencyDates = [
    ...pend.inconsistente,
    ...pend.incompleto,
    ...pend["sem-registro"],
    ...pend["plano-10"],
  ].sort();

  const pendingPlans = input.plans.filter(
    (p) => p.status === "planned" && p.destinationDate >= cycleStart && p.destinationDate <= cycleEnd,
  ).length;

  const blockers: string[] = [];
  if (alreadyClosed) blockers.push("Este ciclo já foi encerrado.");
  if (!ended) blockers.push("O ciclo ainda não terminou — encerre após 30/04.");
  if (blockingPendencyDates.length > 0) {
    blockers.push(`Existem pendências de apuração em datas controladas deste ciclo (${blockingPendencyDates.length}).`);
  }
  if (missingConsolidationLabels.length > 0) {
    blockers.push(
      `Os períodos ${missingConsolidationLabels.join(", ")} ainda não estão consolidados.`,
    );
  }
  if (pendingPlans > 0) {
    blockers.push(
      `${pendingPlans} reserva(s)/planejamento(s) de [10+] ainda pendente(s) aguardando conclusão ou cancelamento.`,
    );
  }

  return {
    ok: blockers.length === 0,
    label,
    cycleStart,
    cycleEnd,
    ended,
    alreadyClosed,
    controlledFrom,
    requiredPeriodLabels,
    missingConsolidationLabels,
    blockingPendencyDates,
    pendingPlans,
    blockers,
  };
}

export interface ClosingExcessComposition {
  /** saldo [10+] final disponível do ciclo (0 ⇒ disposition "none"). */
  closingMinutes: number;
  /** fatias a destinar (liquidar/transportar); vazio quando 0. */
  slices: Slice[];
  /** fatias transportadas recebidas do ciclo anterior que ainda restaram. */
  carriedRemainingMinutes: number;
  /** geração factual deste ciclo que ainda restou. */
  factualRemainingMinutes: number;
}

/**
 * Calcula o saldo [10+] FINAL do ciclo no fechamento, fatiado por proveniência:
 *  · fatias TRANSPORTADAS de ciclos anteriores (restantes) → originalOriginDate
 *    preserva a origem cronológica ORIGINAL e originCycle o ciclo natal;
 *  · fatias FACTUAIS geradas NESTE ciclo que restaram.
 * O banco (buildSpecialExcessBank) já descontou usos ativos e reservas ativas.
 * (asOfDate = cycleEnd: fecha exatamente o ciclo; sem inventar geração futura.)
 */
export function computeClosingExcess(input: {
  label: string;
  closures: AnnualCycleClosure[] | undefined;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null | undefined;
  uses: SpecialExcessUse[];
  plans: SpecialExcessPlan[];
}): ClosingExcessComposition {
  const { label } = input;
  const { from: cycleStart, to: cycleEnd } = annualCycleBounds(label);
  const prevClosure = closureForCycle(input.closures, previousCycleLabel(label));
  const carriedSlices = (prevClosure && prevClosure.disposition === "carried"
    ? prevClosure.sourceSlices
    : []).filter((s) => s.minutes > 0);

  const bank = buildSpecialExcessBank({
    cycle: label,
    asOfDate: cycleEnd,
    entries: input.entries,
    absences: input.absences,
    calendars: input.calendars,
    settings: input.settings,
    faltas: input.faltas,
    controlStartDate: input.controlStartDate ?? "",
    uses: input.uses,
    plans: input.plans.filter((p) => p.status === "planned"),
    carried: carriedSlices,
  });

  const slices: Slice[] = [];
  let carriedRemaining = 0;
  let factualRemaining = 0;
  for (const lot of bank.lots) {
    if (lot.availableMinutes <= 0) continue;
    if (lot.carried) {
      carriedRemaining += lot.availableMinutes;
      slices.push({
        originalOriginDate: lot.originDate,
        minutes: lot.availableMinutes,
        originCycle: lot.originCycle ?? previousCycleLabel(label),
        provenance: `Transportado do ciclo ${previousCycleLabel(label)} (origem factual ${lot.originDate})`,
      });
    } else {
      factualRemaining += lot.availableMinutes;
      slices.push({
        originalOriginDate: lot.originDate,
        minutes: lot.availableMinutes,
        originCycle: label,
        provenance: `Gerado no ciclo ${label} em ${lot.originDate}`,
      });
    }
  }
  slices.sort((a, b) => (a.originalOriginDate < b.originalOriginDate ? -1 : 1));
  const closingMinutes = slices.reduce((s, x) => s + x.minutes, 0);
  return { closingMinutes, slices, carriedRemainingMinutes: carriedRemaining, factualRemainingMinutes: factualRemaining };
}

export type { AnnualCycleClosure };
