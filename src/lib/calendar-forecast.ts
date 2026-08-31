/**
 * 4D (PARTE F) — PREVISÃO DO CALENDÁRIO DA EMPRESA (helper PURO).
 *
 * Lê APENAS:
 *  - as entradas do calendário da empresa (entryOnDate — resolução central);
 *  - os registros legados de compensação kind="calendario" que apontam para
 *    a data da obrigação, para identificar COBERTURA específica (§Parte F):
 *    status "concluida" = cobertura QUITADA; "pendente" = cobertura PLANEJADA.
 *
 * REGRA ATUAL: PLANEJADO ≠ REALIZADO.
 *  - Planejado NÃO reduz o impacto ainda descoberto (leitura conservadora);
 *    aparece separado e nunca vira fato nem alimenta projeção/saldo.
 *  - Evento futuro NUNCA é déficit factual (o factual tem corte temporal
 *    próprio — dayBalanceContribution); aqui é apenas PREVISÃO conhecida.
 *
 * Regras históricas preservadas (§Parte F):
 *  1. Feriado útil abonado  → obrigação 0 (impacto 0);
 *  2. Feriado/obrigação em sábado/domingo → 0 (folga não gera obrigação);
 *  3. Abono integral → 0;
 *  4. COMPENSAR 8h (jornadaEsperada 0) → obrigação 8h;
 *  5. Jornada parcial (ex.: Cinzas 4h+4h) → obrigação = horasACompensar (4h);
 *  6. Recesso: cada dia com horasACompensar gera a PRÓPRIA obrigação;
 *  7/8. futuro não vira déficit factual nem "Sem registro" (fora daqui);
 *  9. isolamento 30/04: só obrigações DENTRO do ciclo informado.
 */
import { entryOnDate, isWeekendDate, type CalendarCategory, type CalendarTreatment, type CompanyCalendars } from "./company-calendar";
import { annualCycleBounds } from "./periods";
import { listDaysBetween } from "./periods";
import type { Compensation } from "./types";

export interface CalendarForecastEvent {
  /** Data da obrigação (YYYY-MM-DD). */
  date: string;
  descricao: string;
  categoria: CalendarCategory;
  tratamento: CalendarTreatment;
  /** Obrigação do dia (COMPENSAR · dia útil) — 0 caso contrário. */
  obligationMinutes: number;
  /** Cobertura QUITADA (compensação concluída kind="calendario" na data). */
  concludedCoverageMinutes: number;
  /** Cobertura PLANEJADA (compensação pendente kind="calendario" na data). */
  plannedCoverageMinutes: number;
  /** obrigação − cobertura quitada (≥ 0) — PLANEJADO NÃO reduz. */
  uncoveredMinutes: number;
}

export interface CalendarForecast {
  /** Σ das obrigações futuras conhecidas do ciclo. */
  futureObligationMinutes: number;
  /** Σ da cobertura já QUITADA dessas obrigações. */
  concludedCoverageMinutes: number;
  /** Σ da cobertura PLANEJADA (informação separada — não é fato). */
  plannedCoverageMinutes: number;
  /** Σ ainda descoberta = Σ max(0, obrigação − quitada). INDICADOR PRINCIPAL. */
  uncoveredFutureMinutes: number;
  /** Nº de eventos futuros com obrigação > 0 ("N eventos a compensar"). */
  futureEventCount: number;
  events: CalendarForecastEvent[];
}

/**
 * Previsão dos impactos futuros CONHECIDOS do calendário dentro do ciclo
 * anual informado (isolamento absoluto 30/04 — regra 9).
 */
export function buildCalendarForecast(p: {
  calendars: CompanyCalendars | undefined;
  compensations: Compensation[];
  /** Ciclo anual escopo (ex.: "2026/2027"). */
  cycle: string;
  /** Corte civil (hoje, injetável — PLANEJADO ≠ REALIZADO). */
  today: string;
}): CalendarForecast {
  const { from, to } = annualCycleBounds(p.cycle);
  const events: CalendarForecastEvent[] = [];

  for (const date of listDaysBetween(from, to)) {
    if (date <= p.today) continue; // apenas o que ainda está pela frente
    const entry = entryOnDate(p.calendars, date);
    if (!entry) continue; // regra 8: dia normal futuro não é evento
    // Regras 1–6: só COMPENSAR gera obrigação; fim de semana não (regra 2);
    // Cinzas/recesso usam o horasACompensar do PRÓPRIO dia (regras 5/6).
    const obligationMinutes =
      entry.tratamento === "COMPENSAR" && !isWeekendDate(date)
        ? Math.max(0, entry.horasACompensar * 60)
        : 0;
    if (obligationMinutes <= 0) continue; // regras 1/2/3: impacto 0
    let concludedCoverageMinutes = 0;
    let plannedCoverageMinutes = 0;
    for (const c of p.compensations) {
      if ((c.kind ?? "excedente") !== "calendario") continue;
      if (c.sourceDate !== date) continue; // cobertura ESPECÍFICA da obrigação
      if (c.status === "concluida") concludedCoverageMinutes += Math.max(0, c.minutes);
      else if (c.status === "pendente") plannedCoverageMinutes += Math.max(0, c.minutes);
    }
    events.push({
      date,
      descricao: entry.descricao,
      categoria: entry.categoria,
      tratamento: entry.tratamento,
      obligationMinutes,
      concludedCoverageMinutes,
      plannedCoverageMinutes,
      uncoveredMinutes: Math.max(0, obligationMinutes - concludedCoverageMinutes),
    });
  }

  const futureObligationMinutes = events.reduce((s, e) => s + e.obligationMinutes, 0);
  const concludedCoverageMinutes = events.reduce((s, e) => s + e.concludedCoverageMinutes, 0);
  const plannedCoverageMinutes = events.reduce((s, e) => s + e.plannedCoverageMinutes, 0);
  const uncoveredFutureMinutes = events.reduce((s, e) => s + e.uncoveredMinutes, 0);

  return {
    futureObligationMinutes,
    concludedCoverageMinutes,
    plannedCoverageMinutes,
    uncoveredFutureMinutes,
    futureEventCount: events.length,
    events,
  };
}
