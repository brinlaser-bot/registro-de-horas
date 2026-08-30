// ─────────────────────────────────────────────────────────────
// BASE FACTUAL DO SALDO REGULAR (Etapa 2A) — fonte central.
//
// Apura, dentro de um escopo de datas, SOMENTE fatos realmente
// realizados:
//   1. crédito regular factual positivo gerado;
//   2. déficit factual gerado;
//   3. saldo regular factual líquido (= crédito − déficit).
//
// A jornada factual não é reescrita por compensação posterior: um dia
// 7h30/base8 continua −30min mesmo quando o déficit é depois coberto.
//
// Etapa 2B (neste arquivo): cobertura NATURAL do déficit pelo banco
// regular (derivação — sem store, sem settlement, [10+] fora), com
// fechamento anual (30/04) absoluto entre ciclos.
//
// Etapa 2C (neste arquivo): DÉFICIT ABERTO operacional = déficit
// factual − settlements [10+] REALIZADOS (ledger de compensações,
// somente porção especial concluída, por vínculo de origem) e, só
// depois, cobertura natural pelo regular restante. Ordem fixa para
// evitar dupla quitação. Também é derivação — sem estado novo.
//
// NÃO recria elegibilidade: cada dia passa por buildResumoDayRow (a
// MESMA fonte do Resumo) e a apuração consome balanceContribution
// (dayBalanceContribution) — o mesmo valor que o Resumo soma como
// "Saldo do período". Todo o masking de dia sem fato realizado já vive
// lá (Sem registro, incompleto, inconsistente, futuro, falta prevista,
// histórico anterior a controlStartDate, folga sem trabalho) e o [10+]
// nunca chega ao saldo regular (teto do ponto oficial — Etapa 1).
// ─────────────────────────────────────────────────────────────
import { getAnnualPointCycle, listDaysBetween } from "./periods";
import { buildResumoDayRow, type ResumoDayRow } from "./resumo-days";
import type { Absence } from "./absences";
import type { CompanyCalendars } from "./company-calendar";
import type { Compensation, Falta, TimeEntry, WorkSettings } from "./types";

/** Fatos regulares apurados em um escopo de datas (somente realizado). */
export interface RegularFacts {
  /** Crédito regular factual positivo gerado (min). */
  generatedCreditMinutes: number;
  /** Déficit factual gerado (min) — sempre >= 0. */
  generatedDeficitMinutes: number;
  /** Saldo regular factual líquido (min) = crédito − déficit. */
  netBalanceMinutes: number;
}

/** Escopo + contexto dos dias — mesmos insumos do Resumo. */
export interface RegularFactsRangeInput {
  from: string; // YYYY-MM-DD (inclusivo)
  to: string; // YYYY-MM-DD (inclusivo)
  /** Corte temporal (hoje). Injetável — testes usam data fixa. */
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate?: string | null;
}

/**
 * Saldo regular factual de UM dia — MESMA fonte do Resumo: a
 * contribuição da linha (balanceContribution), que já aplica todo o
 * masking de dias sem fato realizado. Dia sem fato contribui 0 —
 * nunca "0h trabalhado − base".
 */
export function dayRegularFactBalance(row: ResumoDayRow): number {
  return row.balanceContribution;
}

/** Fato regular de UM dia do escopo (crédito/déficit já separados). */
interface DayRegularFact {
  date: string;
  creditMinutes: number;
  deficitMinutes: number;
}

/**
 * Fatos regulares dia a dia do intervalo — única varredura usada pela
 * Etapa 2A (totais) e pela 2C (por dia, para o vínculo dos settlements).
 * Cada dia passa por buildResumoDayRow (fonte do Resumo).
 */
function dayFactsForRange(input: RegularFactsRangeInput, from: string, to: string): DayRegularFact[] {
  return listDaysBetween(from, to).map((date) => {
    const balance = dayRegularFactBalance(
      buildResumoDayRow({
        date,
        today: input.today,
        entries: input.entries,
        absences: input.absences,
        calendars: input.calendars,
        settings: input.settings,
        faltas: input.faltas,
        controlStartDate: input.controlStartDate,
      }),
    );
    return { date, creditMinutes: Math.max(0, balance), deficitMinutes: Math.max(0, -balance) };
  });
}

/**
 * APURAÇÃO FACTUAL do escopo: decompõe os saldos regulares diários
 * (fonte do Resumo) em crédito positivo gerado e déficit gerado.
 *
 * Invariante: netBalanceMinutes = generatedCreditMinutes −
 * generatedDeficitMinutes.
 *
 * Fora do escopo de propósito: [10+] (livre/programado/realocado),
 * settlements/alocações e compensação (consumo, quitação, parcelas,
 * prioridade de banco).
 */
export function summarizeRegularFacts(input: RegularFactsRangeInput): RegularFacts {
  let generatedCreditMinutes = 0;
  let generatedDeficitMinutes = 0;
  for (const day of dayFactsForRange(input, input.from, input.to)) {
    generatedCreditMinutes += day.creditMinutes;
    generatedDeficitMinutes += day.deficitMinutes;
  }
  return {
    generatedCreditMinutes,
    generatedDeficitMinutes,
    netBalanceMinutes: generatedCreditMinutes - generatedDeficitMinutes,
  };
}

/* ── Etapa 2B: cobertura NATURAL do déficit pelo banco regular ───
 * Créditos e débitos regulares pertencem ao MESMO banco regular, então
 * a cobertura é consequência matemática do saldo factual — derivação,
 * nunca um settlement/parcela/transferência gravada no store.
 *
 * Fechamento anual (30/04) é ABSOLUTO: créditos de um ciclo não cobrem
 * déficit de outro. Intervalos que cruzam o fechamento são segmentados
 * por ciclo anual (getAnnualPointCycle/annualCycleBounds — helper
 * existente) e a cobertura é calculada CICLO A CICLO antes de agregar.
 *
 * Fora do escopo (Etapa 2C): [10+] e settlements/alocações.
 */

/** Cobertura regular factual de um escopo (derivação — sem estado). */
export interface RegularCoverage {
  /** Crédito regular factual gerado (min). */
  generatedCreditMinutes: number;
  /** Déficit factual gerado — histórico, nunca reescrito (min). */
  generatedDeficitMinutes: number;
  /** Déficit naturalmente coberto pelo banco regular (min). */
  coveredByRegularMinutes: number;
  /** Déficit sem cobertura regular (min). */
  uncoveredByRegularMinutes: number;
  /** Saldo regular factual líquido (min) = crédito − déficit. */
  netBalanceMinutes: number;
}

/** Cobertura apurada em UM segmento de ciclo anual. */
export interface CycleRegularCoverage extends RegularCoverage {
  /** Ciclo anual do segmento, ex.: "2025/2026". */
  cycle: string;
}

/**
 * Segmente um intervalo em blocos contíguos de UM ciclo anual.
 * Reutiliza getAnnualPointCycle (fonte do fechamento em 30/04).
 */
function cycleSegments(range: { from: string; to: string }): Array<{ cycle: string; from: string; to: string }> {
  const segments: Array<{ cycle: string; from: string; to: string }> = [];
  for (const date of listDaysBetween(range.from, range.to)) {
    const cycle = getAnnualPointCycle(date);
    const last = segments[segments.length - 1];
    if (last && last.cycle === cycle) last.to = date;
    else segments.push({ cycle, from: date, to: date });
  }
  return segments;
}

/**
 * Cobertura regular CICLO A CICLO dentro do escopo. Para cada segmento
 * de ciclo anual: apura os fatos (summarizeRegularFacts — mesma fonte
 * do Resumo) e calcula covered = min(crédito, déficit) /
 * uncovered = max(déficit − crédito, 0). Nenhum crédito cruza ciclo.
 */
export function regularCoverageByCycle(input: RegularFactsRangeInput): CycleRegularCoverage[] {
  return cycleSegments({ from: input.from, to: input.to }).map((seg) => {
    const facts = summarizeRegularFacts({ ...input, from: seg.from, to: seg.to });
    return {
      cycle: seg.cycle,
      ...facts,
      coveredByRegularMinutes: Math.min(
        facts.generatedCreditMinutes,
        facts.generatedDeficitMinutes,
      ),
      uncoveredByRegularMinutes: Math.max(
        facts.generatedDeficitMinutes - facts.generatedCreditMinutes,
        0,
      ),
    };
  });
}

/**
 * COBERTURA REGULAR AGREGADA do escopo: soma das coberturas por ciclo
 * (o fechamento anual é aplicado ANTES da agregação).
 *
 * Invariantes: covered ≤ déficit; covered ≤ crédito;
 * uncovered = déficit − covered; num único ciclo, crédito ≥ déficit ⇒
 * uncovered = 0.
 */
export function summarizeRegularCoverage(input: RegularFactsRangeInput): RegularCoverage {
  return regularCoverageByCycle(input).reduce(
    (acc, c) => ({
      generatedCreditMinutes: acc.generatedCreditMinutes + c.generatedCreditMinutes,
      generatedDeficitMinutes: acc.generatedDeficitMinutes + c.generatedDeficitMinutes,
      coveredByRegularMinutes: acc.coveredByRegularMinutes + c.coveredByRegularMinutes,
      uncoveredByRegularMinutes: acc.uncoveredByRegularMinutes + c.uncoveredByRegularMinutes,
      netBalanceMinutes: acc.netBalanceMinutes + c.netBalanceMinutes,
    }),
    {
      generatedCreditMinutes: 0,
      generatedDeficitMinutes: 0,
      coveredByRegularMinutes: 0,
      uncoveredByRegularMinutes: 0,
      netBalanceMinutes: 0,
    },
  );
}

/* ── Etapa 2C: DÉFICIT ABERTO após settlements [10+] realizados ──
 * Ordem fixa por ciclo anual (evita dupla quitação):
 *   1. déficit factual (Etapa 2A);
 *   2. settlements [10+] REALIZADOS aplicados a essa dívida;
 *   3. restante após settlement;
 *   4. cobertura natural pelo banco regular (Etapa 2B) — só do restante;
 *   5. déficit aberto = restante − crédito regular (nunca negativo).
 *
 * Fonte dos settlements: o ledger existente (compensações —
 * hour-bank.ts). "Realizado" = status "concluida"; "pendente" é
 * PROGRAMADO (não quita); "cancelada" é ignorada. A porção "especial"
 * marca o consumo da reserva acima de 10h (mesma semântica escrita por
 * allocateSpecialExcess/useRealizedCredit no store) e o vínculo com o
 * déficit é o sourceDate (dia da dívida) — settlement nunca é
 * aplicado globalmente, nem revalidado/reescrito aqui.
 *
 * [10+] livre ou programado NÃO reduz o déficit aberto.
 * Fechamento anual (30/04) segue absoluto: tudo por segmento de ciclo.
 */

/** Escopo da apuração de déficit aberto — 2A/2B + ledger de compensações. */
export interface OpenDeficitInput extends RegularFactsRangeInput {
  /** Ledger de compensações (LEITURA — fonte existente, sem alteração). */
  compensations: Compensation[];
}

/** Déficit aberto apurado (derivação — sem estado). */
export interface OpenDeficitSummary {
  /** Déficit factual gerado — histórico, nunca reescrito (min). */
  generatedDeficitMinutes: number;
  /** Settlement [10+] realizado efetivamente considerado (min, ≤ déficit). */
  settledByExcessMinutes: number;
  /** Soma BRUTA dos settlements [10+] realizados no escopo (sem teto).
   *  raw > settledByExcess ⇒ inconsistência de ledger detectável. */
  rawSettledExcessMinutes: number;
  /** Déficit coberto pelo banco regular APÓS os settlements (min). */
  coveredByRegularMinutes: number;
  /** Déficit aberto: após settlements [10+] + cobertura regular (min). */
  openDeficitMinutes: number;
  /** Crédito regular factual gerado (min) — contexto do banco regular. */
  generatedCreditMinutes: number;
  /** Saldo regular factual líquido (min) = crédito − déficit (inalterado). */
  netBalanceMinutes: number;
}

/** Déficit aberto apurado em UM segmento de ciclo anual. */
export interface CycleOpenDeficit extends OpenDeficitSummary {
  /** Ciclo anual do segmento, ex.: "2025/2026". */
  cycle: string;
}

/**
 * Settlement [10+] REALIZADO aplicado à dívida de `deficitDate`:
 * parcela do ledger com kind=deficit (déficit de jornada — o vínculo),
 * portion="especial" (consumiu a reserva acima de 10h) e status
 * "concluida" (realizado — pendente é programado, cancelada ignora).
 * Mesmos critérios que o ledger especial (hour-bank.ts) usa para
 * contabilizar "realizado" e o destino quitado (realizedTo).
 */
function isRealizedExcessDeficitSettlement(c: Compensation, deficitDate: string): boolean {
  return (
    (c.kind ?? "excedente") === "deficit" &&
    c.portion === "especial" &&
    c.status === "concluida" &&
    c.sourceDate === deficitDate
  );
}

/** Soma BRUTA (sem teto) dos settlements [10+] realizados de um dia. */
function settledExcessRawForDate(compensations: Compensation[], deficitDate: string): number {
  return compensations
    .filter((c) => isRealizedExcessDeficitSettlement(c, deficitDate))
    .reduce((s, c) => s + c.minutes, 0);
}

/**
 * Déficit aberto CICLO A CICLO: para cada segmento de ciclo anual,
 * por dia: déficit factual (2A) e settlement realizado vinculado
 * (sourceDate = dia), com teto DIÁRIO no déficit do próprio dia
 * (proteção contra ledger inconsistente — nunca negativo). Depois:
 * restante → cobertura regular (2B) → aberto.
 */
export function openDeficitByCycle(input: OpenDeficitInput): CycleOpenDeficit[] {
  return cycleSegments({ from: input.from, to: input.to }).map((seg) => {
    let generatedCreditMinutes = 0;
    let generatedDeficitMinutes = 0;
    let settledByExcessMinutes = 0;
    let rawSettledExcessMinutes = 0;
    for (const day of dayFactsForRange(input, seg.from, seg.to)) {
      generatedCreditMinutes += day.creditMinutes;
      generatedDeficitMinutes += day.deficitMinutes;
      const raw = settledExcessRawForDate(input.compensations, day.date);
      rawSettledExcessMinutes += raw;
      // Teto diário: settlement não pode exceder a dívida factual do dia.
      settledByExcessMinutes += Math.min(raw, day.deficitMinutes);
    }
    const remainingAfterSettlements = Math.max(
      generatedDeficitMinutes - settledByExcessMinutes,
      0,
    );
    const coveredByRegularMinutes = Math.min(
      generatedCreditMinutes,
      remainingAfterSettlements,
    );
    return {
      cycle: seg.cycle,
      generatedDeficitMinutes,
      settledByExcessMinutes,
      rawSettledExcessMinutes,
      coveredByRegularMinutes,
      openDeficitMinutes: Math.max(remainingAfterSettlements - generatedCreditMinutes, 0),
      generatedCreditMinutes,
      netBalanceMinutes: generatedCreditMinutes - generatedDeficitMinutes,
    };
  });
}

/**
 * DÉFICIT ABERTO AGREGADO do escopo: soma dos ciclos (fechamento anual
 * aplicado ANTES da agregação).
 *
 * Invariantes: settled ≤ déficit; covered ≤ restante após settlement;
 * settled + covered ≤ déficit; aberto = déficit − settled − covered
 * (nunca negativo); líquido = crédito − déficit (fatos intocados).
 */
export function summarizeOpenDeficit(input: OpenDeficitInput): OpenDeficitSummary {
  return openDeficitByCycle(input).reduce(
    (acc, c) => ({
      generatedDeficitMinutes: acc.generatedDeficitMinutes + c.generatedDeficitMinutes,
      settledByExcessMinutes: acc.settledByExcessMinutes + c.settledByExcessMinutes,
      rawSettledExcessMinutes: acc.rawSettledExcessMinutes + c.rawSettledExcessMinutes,
      coveredByRegularMinutes: acc.coveredByRegularMinutes + c.coveredByRegularMinutes,
      openDeficitMinutes: acc.openDeficitMinutes + c.openDeficitMinutes,
      generatedCreditMinutes: acc.generatedCreditMinutes + c.generatedCreditMinutes,
      netBalanceMinutes: acc.netBalanceMinutes + c.netBalanceMinutes,
    }),
    {
      generatedDeficitMinutes: 0,
      settledByExcessMinutes: 0,
      rawSettledExcessMinutes: 0,
      coveredByRegularMinutes: 0,
      openDeficitMinutes: 0,
      generatedCreditMinutes: 0,
      netBalanceMinutes: 0,
    },
  );
}
