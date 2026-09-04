// ─────────────────────────────────────────────────────────────
// ETAPA 4H.2 — HELPERS DERIVADOS DO FLUXO INVERSO "DESTINAR HORAS"
// (origem [10+] disponível → dia abaixo da base).
//
// SOMENTE derivação de motores canônicos existentes — NENHUMA matemática
// de alocação nova e NENHUMA fonte legada (debt.ts / hour-bank.ts legado
// NÃO são verdade aqui):
//
//   · elegibilidade do DESTINO: 3A (isProjectableDayStatus sobre o status
//     do Resumo — "deficit" = jornada factual válida terminada abaixo da
//     base) + MESMA regra do day-view 3E (calendarEventPendingToday) —
//     ABONADO/COMPENSAR/férias/folga/fim de semana/Cinzas parcial e
//     calendários especiais herdam a semântica da classificação;
//   · necessidade restante: MESMA derivação do day-view 3E
//     (requiredWorkMinutes − registrable − usos ativos do destino);
//   · proteções: consolidação ATIVA (period-consolidation) e ciclo anual
//     encerrado (annual-cycle-closure) — a consolidação protege o DESTINO;
//     a origem consolidada continua operacional enquanto o ciclo anual
//     estiver aberto (4H.2);
//   · saldo da ORIGEM: 3C (buildSpecialExcessBank) — quem calcula.
//
// A data de destino NÃO precisa ser posterior à origem (mesmo ciclo):
// destino anterior à origem é legítimo quando realizado/aberto/sem
// consolidação — a lista vem do MAIS ANTIGO para o MAIS RECENTE
// (resolver primeiro o que está aberto há mais tempo) e a escolha é
// livre; nada é alocado automaticamente.
// ─────────────────────────────────────────────────────────────
import type { Absence } from "./absences";
import type { CompanyCalendars } from "./company-calendar";
import {
  carriedSlicesIntoCycle,
  cycleLabelFromStart,
  dateFallsInClosedCycle,
  type AnnualCycleClosure,
} from "./annual-cycle-closure";
import { consolidationLockForDate, type PeriodConsolidation } from "./period-consolidation";
import { annualCycleBounds, getAnnualPointCycle, listDaysBetween } from "./periods";
import { buildResumoDayRow } from "./resumo-days";
import { isProjectableDayStatus } from "./official-projection";
import { buildSpecialExcessBank } from "./special-excess-bank";
import { specialExcessUseMinutes, type SpecialExcessUse } from "./special-excess-use";
import type { SpecialExcessPlan } from "./special-excess-plan";
import type { WorkSettings } from "./time";
import type { Falta, TimeEntry } from "./types";

export interface SpecialExcessDestinationCandidate {
  date: string;
  /** Base efetiva − registrável (≥ 0) — MESMA derivação do day-view 3E. */
  neededMinutes: number;
  /** Σ dos usos ATIVOS já destinados ao dia (cancelados não contam). */
  usedActiveMinutes: number;
  /** Necessidade restante (needed − used, ≥ 0). 0 ⇒ fora da lista. */
  remainingNeedMinutes: number;
  /** Fato do dia (apenas apresentação — o uso NUNCA altera o factual). */
  workedMinutes: number;
  requiredWorkMinutes: number;
}

export interface SpecialExcessDestinationsInput {
  /** Ciclo operacional da ORIGEM (ciclo do lote; p/ transporte é o NOVO ciclo). */
  cycle: string;
  /** Corte as-of: dia futuro/aberto nunca é elegível (status do Resumo). */
  asOfDate: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  /** Usos do ciclo (3B) — usados para a necessidade RESTANTE de cada dia. */
  uses: SpecialExcessUse[];
  /** Usos de reserva ATIVA que também consomem capacidade (4A) — só para
   *  o banco de preview da origem; NÃO alteram a elegibilidade do destino. */
  plans?: SpecialExcessPlan[];
  /** Consolidações: destino em período consolidado NUNCA recebe novo uso (4G). */
  periodConsolidations?: PeriodConsolidation[];
  /** Fechamentos anuais: destino em ciclo encerrado NUNCA recebe novo uso (4H). */
  annualCycleClosures?: AnnualCycleClosure[];
}

/**
 * Dias ELEGÍVEIS a receber [10+] de uma origem do ciclo `cycle` (fluxo
 * inverso — origem → destino). Puro: não muta nada; não lê store.
 *
 * Um dia entra SOMENTE quando TODAS valem (fontes canônicas):
 *   A. realizado (status do Resumo já exige dia realizado/encerrado);
 *   B. jornada factual válida terminada ABAIXO da base ("deficit");
 *   C. remainingNeedMinutes > 0 (necessidade REAL ainda em aberto);
 *   D. pertence ao ciclo operacional da origem;
 *   E. não pertence a ciclo anual encerrado;
 *   F. não está em período com consolidação ACTIVE;
 *   G. não é futuro (corte asOf — status "future"/"empty" exclui);
 *   H. não é hoje em andamento/incompleto ("in-progress"/"incomplete");
 *   I. não é financeiramente pendente/inconsistente;
 *   J. possui trabalho necessário efetivo > 0 (requiredWorkMinutes).
 *
 * Ordem: MAIS ANTIGO → MAIS RECENTE (data ascendente).
 */
export function eligibleSpecialExcessDestinationsForOrigin(
  input: SpecialExcessDestinationsInput,
): SpecialExcessDestinationCandidate[] {
  const { cycle, asOfDate, entries, absences, calendars, settings, faltas, controlStartDate, uses, periodConsolidations, annualCycleClosures } = input;
  const bounds = annualCycleBounds(cycle);
  const to = asOfDate < bounds.to ? asOfDate : bounds.to;
  const out: SpecialExcessDestinationCandidate[] = [];
  if (to < bounds.from) return out;
  for (const date of listDaysBetween(bounds.from, to)) {
    const row = buildResumoDayRow({
      date, today: asOfDate, entries, absences, calendars, settings, faltas, controlStartDate,
    });
    // MESMA elegibilidade do day-view 3E (3A: "deficit" + evento-pendente de hoje).
    if (!isProjectableDayStatus(row.status) || row.calendarEventPendingToday) continue;
    // J: trabalho necessário efetivo (base canônica do dia).
    const neededMinutes = Math.max(row.requiredWorkMinutes - row.registrableMinutes, 0);
    if (neededMinutes <= 0) continue;
    // C: necessidade RESTANTE — usos ativos já aplicados no destino descontam.
    const usedActiveMinutes = uses
      .filter((u) => u.status === "utilizado" && u.destinationDate === date)
      .reduce((s, u) => s + specialExcessUseMinutes(u), 0);
    const remainingNeedMinutes = Math.max(neededMinutes - usedActiveMinutes, 0);
    if (remainingNeedMinutes <= 0) continue;
    // F: destino consolidado = protegido (4G) — nunca recebe novo uso [10+].
    if (consolidationLockForDate(periodConsolidations, date)) continue;
    // E: ciclo anual encerrado = fronteira (4H) — nunca recebe novo uso [10+].
    if (dateFallsInClosedCycle(annualCycleClosures, date)) continue;
    out.push({
      date,
      neededMinutes,
      usedActiveMinutes,
      remainingNeedMinutes,
      workedMinutes: row.workedMinutes,
      requiredWorkMinutes: row.requiredWorkMinutes,
    });
  }
  // MAIS ANTIGO → MAIS RECENTE (visual: resolver primeiro o mais antigo).
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * MÁXIMO da operação origem → destino (uma origem, um destino):
 *   min( disponível da origem, necessidade restante do destino, 0 ou mais )
 * Nunca cria hora extra artificial no destino nem ultrapassa a base.
 * (Derivação de apresentação — a defesa real continua nos guards do store.)
 */
export function maxDestinableMinutes(
  originAvailableMinutes: number,
  destinationRemainingNeedMinutes: number,
): number {
  return Math.max(0, Math.min(originAvailableMinutes, destinationRemainingNeedMinutes));
}

/** Banco do ciclo da origem (capacidade canônica 3C — incl. transportado 4H). */
export function buildSpecialExcessOriginBank(input: {
  cycle: string;
  asOfDate: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  uses: SpecialExcessUse[];
  plans?: SpecialExcessPlan[];
  annualCycleClosures?: AnnualCycleClosure[];
}): ReturnType<typeof buildSpecialExcessBank> {
  const { cycle } = input;
  return buildSpecialExcessBank({
    cycle,
    asOfDate: input.asOfDate,
    entries: input.entries,
    absences: input.absences,
    calendars: input.calendars,
    settings: input.settings,
    faltas: input.faltas,
    controlStartDate: input.controlStartDate ?? "",
    uses: input.uses,
    plans: input.plans ?? [],
    carried: carriedSlicesIntoCycle(input.annualCycleClosures, cycle),
  });
}

export interface CarriedOutInfo {
  /** Minutos deste dia formalmente TRANSPORTADOS no encerramento. */
  minutes: number;
  /** Rótulo do ciclo de destino (ex.: "2026/2027"). */
  destinationCycleLabel: string;
}

/**
 * 4H.2 — Rastreabilidade no card HISTÓRICO (ciclo anual ENCERRADO): quanto
 * do [10+] gerado neste dia foi transportado para o ciclo seguinte.
 * Somente leitura — a administração do saldo acontece NA CENTRAL DO NOVO
 * CICLO (o card antigo NUNCA mostra "Destinar horas").
 */
export function carriedOutForDate(
  closures: AnnualCycleClosure[] | undefined,
  date: string,
): CarriedOutInfo | null {
  for (const c of closures ?? []) {
    if (c.status !== "closed" || c.disposition !== "carried") continue;
    if (!c.destinationCycleStart) continue;
    const minutes = (c.sourceSlices ?? [])
      .filter((s) => s.originalOriginDate === date)
      .reduce((s, x) => s + x.minutes, 0);
    if (minutes > 0) {
      return { minutes, destinationCycleLabel: cycleLabelFromStart(c.destinationCycleStart) };
    }
  }
  return null;
}

/** true quando o lote é do ciclo informado (factual) OU transportado p/ ele. */
export function lotOperatesInCycle(
  lot: { originDate: string; carried?: boolean },
  cycle: string,
): boolean {
  return lot.carried === true || getAnnualPointCycle(lot.originDate) === cycle;
}
