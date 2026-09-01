/**
 * 4D.4 (PARTES J/K) — PREVISÃO DO CALENDÁRIO DA EMPRESA (helper PURO).
 *
 * REGRA-MÃE (4D.4): o calendário tem dois momentos —
 *  1. ANTES DA DATA: o evento é PREVISÃO (não altera saldo factual);
 *  2. DEPOIS DE REALIZADO: o efeito real entra no SALDO FACTUAL
 *     (companyDayContext — uma única contribuição por dia).
 *
 * Este helper voltou a ser realmente uma PREVISÃO: considera SOMENTE os
 * impactos excepcionais FUTUROS conhecidos, mesmo presumindo cumprimento
 * normal da jornada futura:
 *  · COMPENSAR INTEGRAL (jornadaEsperadaHoras = 0, horasACompensar > 0)
 *    futuro  ⇒ impacto previsto = −horasACompensar;
 *  · COMPENSAR integral HOJE ainda NÃO realizado (jornada aberta/pendente)
 *    ⇒ permanece previsão (nada de −8h prematuro — Parte G);
 *  · COMPENSAR PARCIAL (jornadaEsperadaHoras > 0, ex.: Cinzas 4h+4h)
 *    ⇒ 0 (presume as horas regulares trabalhadas);
 *  · ABONADO/ABONADO_PARCIAL ⇒ 0 (crédito cumpre a base);
 *  · dia normal futuro ⇒ 0.
 *
 * SEM DUPLA CONTAGEM (Parte J): dia realizado NÃO aparece aqui — seu efeito
 * pertence ao saldo factual. Nunca aos dois simultaneamente. A cobertura do
 * 4D.2 (self/externa/planejada) foi SUPERADA: o trabalho do próprio dia
 * quita a folga pelo saldo factual do dia, e as compensações
 * kind="calendario" seguem apenas no fluxo legado da Central (compensar.ts).
 *
 * Fim de semana: folga comum (sem entrada) é neutra; entrada EXPLÍCITA é
 * respeitada em qualquer dia (4D.1, Parte D — mantida). Isolamento 30/04:
 * só eventos DENTRO do ciclo informado. Helper puro.
 */
import { calendarEventPendingToday, companyDayContext, entryOnDate, type CalendarCategory, type CalendarTreatment, type CompanyCalendars } from "./company-calendar";
import { annualCycleBounds, listDaysBetween } from "./periods";
import type { Absence } from "./absences";
import type { WorkSettings } from "./time";
import type { TimeEntry } from "./types";

export interface CalendarForecastEvent {
  /** Data da obrigação (YYYY-MM-DD). */
  date: string;
  descricao: string;
  categoria: CalendarCategory;
  tratamento: CalendarTreatment;
  /** Impacto previsto no saldo (≤ 0 — folga/recesso integral a compensar). */
  impactMinutes: number;
  /** "future" (após hoje) · "today-pending" (hoje, jornada ainda não encerrada). */
  status: "future" | "today-pending";
}

export interface CalendarForecast {
  /** Σ dos impactos futuros conhecidos (≤ 0) — INDICADOR PRINCIPAL. */
  futureImpactMinutes: number;
  /** Nº de eventos de previsão ("N evento(s) futuros"). */
  eventCount: number;
  events: CalendarForecastEvent[];
}

/**
 * Impactos futuros CONHECIDOS do calendário dentro do ciclo anual informado
 * (isolamento absoluto 30/04). Previsão NUNCA vira saldo factual/atual.
 */
export function buildCalendarForecast(p: {
  calendars: CompanyCalendars | undefined;
  /** Ciclo anual escopo (ex.: "2026/2027") — isolamento 30/04. */
  cycle: string;
  /** Corte civil (hoje, injetável). */
  today: string;
  /** Dados factuais para saber se o HOJE já foi realizado (Parte G). */
  entries?: TimeEntry[];
  absences?: Absence[];
  settings?: WorkSettings;
}): CalendarForecast {
  const { from, to } = annualCycleBounds(p.cycle);
  const events: CalendarForecastEvent[] = [];

  for (const date of listDaysBetween(from, to)) {
    const entry = entryOnDate(p.calendars, date);
    if (!entry) continue;
    // Só folga/recesso INTEGRAL a compensar gera impacto futuro (Parte K):
    if (entry.tratamento !== "COMPENSAR") continue; // abono/feriado ⇒ 0
    const horasACompensar = Math.max(0, entry.horasACompensar * 60);
    if (horasACompensar <= 0) continue; // COMPENSAR ≤ 0 ⇒ neutro
    if ((entry.jornadaEsperadaHoras * 60 | 0) > 0) continue; // dia PARCIAL: presume jornada cumprida ⇒ 0
    // Dia realizado ⇒ o efeito já está no SALDO FACTUAL (Parte J — nunca aqui):
    if (date < p.today) continue;
    // HOJE: só sai da previsão quando já é FATO (registro com jornada
    // encerrada — Parte G; folga hoje ainda sem batidas continua prevista).
    if (date === p.today && p.settings && p.entries) {
      const cctx = companyDayContext(date, p.entries, p.absences ?? [], p.calendars, p.settings);
      if (!calendarEventPendingToday(cctx, date, p.today)) continue;
    }
    events.push({
      date,
      descricao: entry.descricao,
      categoria: entry.categoria,
      tratamento: entry.tratamento,
      impactMinutes: -horasACompensar,
      status: date > p.today ? "future" : "today-pending",
    });
  }

  return {
    futureImpactMinutes: events.reduce((s, e) => s + e.impactMinutes, 0),
    eventCount: events.length,
    events,
  };
}
