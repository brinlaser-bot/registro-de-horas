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
import type { Falta, TimeEntry, WorkSettings } from "./types";

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
  for (const date of listDaysBetween(input.from, input.to)) {
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
    if (balance > 0) generatedCreditMinutes += balance;
    else if (balance < 0) generatedDeficitMinutes += -balance;
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
