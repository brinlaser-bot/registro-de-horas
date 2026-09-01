/**
 * 4D (PARTE F) / 4D.1 (PARTES A/D/E) — PREVISÃO DO CALENDÁRIO DA EMPRESA
 * (helper PURO).
 *
 * Lê APENAS:
 *  - as entradas do calendário da empresa (entryOnDate — resolução central);
 *  - os registros legados de compensação kind="calendario" que apontam para
 *    a data da obrigação, para identificar COBERTURA específica:
 *    status "concluida" = cobertura QUITADA; "pendente" = cobertura PLANEJADA.
 *
 * 4D.1 (PARTE A) — A OBRIGAÇÃO NÃO SOME NA DATA:
 *  A data do evento determina quando a folga/recesso ACONTECE; ela NÃO
 *  determina quando a obrigação deixa de existir. Enquanto
 *  uncoveredMinutes > 0 e a entrada estiver DENTRO do ciclo consultado,
 *  a obrigação permanece no total — seja FUTURA, de HOJE ou PASSADA EM
 *  ABERTO. Ela só sai do total quando quitada (uncovered === 0) ou quando
 *  o ciclo termina (isolamento 30/04).
 *
 * 4D.1 (PARTE D) — FIM DE SEMANA:
 *  Sábado/domingo COMUM (sem entrada do calendário) continua folga neutra
 *  (sem entrada não há o que ler). Uma entrada EXPLÍCITA do calendário
 *  (COMPENSAR com horasACompensar > 0) é respeitada TAMBÉM se cair em
 *  fim de semana — usando SOMENTE o horasACompensar importado (nada é
 *  inferido). Continuam neutros: ABONADO/feriado com horasACompensar = 0
 *  e COMPENSAR com horasACompensar <= 0.
 *
 * REGRA ATUAL: PLANEJADO ≠ REALIZADO (4D, Parte F).
 *  - Planejado NÃO reduz o uncovered (leitura conservadora); aparece
 *    separado e nunca vira fato nem alimenta projeção/saldo.
 *  - Obrigação de calendário NUNCA é déficit factual (o factual tem corte
 *    temporal próprio — dayBalanceContribution) nem entra na projeção [10+].
 *
 * STATUS TEMPORAL (4D.1 — apenas classificação, NUNCA condição financeira):
 *  date >  today                 => "future"
 *  date === today                => "today"   (ou "settled" se quitada)
 *  date <  today && aberta       => "overdue" (ou "settled" se quitada)
 *
 * Regras históricas preservadas (§Parte F da 4D):
 *  1. Feriado útil abonado  → obrigação 0;
 *  3. Abono integral → 0;
 *  4. COMPENSAR 8h (jornadaEsperada 0) → obrigação 8h;
 *  5. Jornada parcial (ex.: Cinzas 4h+4h) → obrigação = horasACompensar (4h);
 *  6. Recesso: cada dia com horasACompensar gera a PRÓPRIA obrigação;
 *  7/8. futuro/hoje/passado não alteram o factual nem "Sem registro";
 *  9. isolamento 30/04: só obrigações DENTRO do ciclo informado.
 */
import { entryOnDate, type CalendarCategory, type CalendarTreatment, type CompanyCalendars } from "./company-calendar";
import { annualCycleBounds, listDaysBetween } from "./periods";
import type { Compensation } from "./types";

/** Status TEMPORAL da obrigação (não é condição para existir financeiramente). */
export type CalendarObligationStatus = "future" | "today" | "overdue" | "settled";

export interface CalendarForecastEvent {
  /** Data da obrigação (YYYY-MM-DD). */
  date: string;
  descricao: string;
  categoria: CalendarCategory;
  tratamento: CalendarTreatment;
  /** Obrigação ORIGINAL do dia (COMPENSAR · horasACompensar > 0 · dia útil OU fim de semana explícito). */
  originalMinutes: number;
  /** Cobertura QUITADA (compensação concluída kind="calendario" na data). */
  concludedCoverageMinutes: number;
  /** Cobertura PLANEJADA (compensação pendente kind="calendario" na data). */
  plannedCoverageMinutes: number;
  /** max(0, original − concluída) — PLANEJADO NÃO reduz. */
  uncoveredMinutes: number;
  /** future · today · overdue (passada e aberta) · settled (quitada). */
  status: CalendarObligationStatus;
}

export interface CalendarForecast {
  /** Σ das obrigações ORIGINAIS do ciclo (inclui as já quitadas — histórico). */
  obligationMinutes: number;
  /** Σ da cobertura já QUITADA dessas obrigações. */
  concludedCoverageMinutes: number;
  /** Σ da cobertura PLANEJADA (informação separada — não é fato). */
  plannedCoverageMinutes: number;
  /**
   * Σ ainda descoberta = Σ max(0, obrigação − quitada). INDICADOR PRINCIPAL.
   * Inclui obrigações FUTURAS, de HOJE e PASSADAS ainda em aberto.
   */
  uncoveredMinutes: number;
  /** Nº de eventos com uncovered > 0 ("N eventos a compensar"). */
  openEventCount: number;
  events: CalendarForecastEvent[];
}

/**
 * Previsão das obrigações de calendário CONHECIDAS dentro do ciclo anual
 * informado (isolamento absoluto 30/04 — regra 9). Helper puro.
 */
export function buildCalendarForecast(p: {
  calendars: CompanyCalendars | undefined;
  compensations: Compensation[];
  /** Ciclo anual escopo (ex.: "2026/2027"). */
  cycle: string;
  /** Corte civil (hoje, injetável — só classifica o status temporal). */
  today: string;
}): CalendarForecast {
  const { from, to } = annualCycleBounds(p.cycle);
  const events: CalendarForecastEvent[] = [];

  for (const date of listDaysBetween(from, to)) {
    const entry = entryOnDate(p.calendars, date);
    if (!entry) continue;
    // 4D.1 (Parte D): só ENTRADA EXPLÍCITA gera obrigação — e é lida em
    // qualquer dia da semana (o fim de semana comum não tem entrada aqui).
    // Fonte única: horasACompensar da própria entrada (nada inferido).
    const originalMinutes =
      entry.tratamento === "COMPENSAR" ? Math.max(0, entry.horasACompensar * 60) : 0;
    if (originalMinutes <= 0) continue; // abono/feriado 0h · COMPENSAR ≤ 0 → neutro
    let concludedCoverageMinutes = 0;
    let plannedCoverageMinutes = 0;
    for (const c of p.compensations) {
      if ((c.kind ?? "excedente") !== "calendario") continue;
      if (c.sourceDate !== date) continue; // cobertura ESPECÍFICA da obrigação
      if (c.status === "concluida") concludedCoverageMinutes += Math.max(0, c.minutes);
      else if (c.status === "pendente") plannedCoverageMinutes += Math.max(0, c.minutes);
    }
    const uncoveredMinutes = Math.max(0, originalMinutes - concludedCoverageMinutes);
    // Status TEMPORAL — apenas classificação; nunca condição financeira.
    const status: CalendarObligationStatus =
      date > p.today
        ? "future"
        : date === p.today
          ? uncoveredMinutes > 0
            ? "today"
            : "settled"
          : uncoveredMinutes > 0
            ? "overdue"
            : "settled";
    events.push({
      date,
      descricao: entry.descricao,
      categoria: entry.categoria,
      tratamento: entry.tratamento,
      originalMinutes,
      concludedCoverageMinutes,
      plannedCoverageMinutes,
      uncoveredMinutes,
      status,
    });
  }

  const obligationMinutes = events.reduce((s, e) => s + e.originalMinutes, 0);
  const concludedCoverageMinutes = events.reduce((s, e) => s + e.concludedCoverageMinutes, 0);
  const plannedCoverageMinutes = events.reduce((s, e) => s + e.plannedCoverageMinutes, 0);
  const uncoveredMinutes = events.reduce((s, e) => s + e.uncoveredMinutes, 0);

  return {
    obligationMinutes,
    concludedCoverageMinutes,
    plannedCoverageMinutes,
    uncoveredMinutes,
    openEventCount: events.filter((e) => e.uncoveredMinutes > 0).length,
    events,
  };
}
