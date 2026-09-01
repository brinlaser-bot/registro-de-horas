/**
 * 4D (PARTE F) / 4D.1 (PARTES A/D/E) / 4D.2 (PARTES A–E) — PREVISÃO DO
 * CALENDÁRIO DA EMPRESA (helper PURO).
 *
 * Lê APENAS:
 *  - as entradas do calendário da empresa (entryOnDate — resolução central);
 *  - a resolução central do dia (companyDayContext) para derivar a cobertura
 *    pelo TRABALHO DO PRÓPRIO DIA (4D.2) — nenhuma fórmula paralela;
 *  - os registros legados de compensação kind="calendario" que apontam para
 *    a data da obrigação, para identificar COBERTURA EXTERNA específica:
 *    status "concluida" = QUITADA; "pendente" = PLANEJADA (informativa).
 *
 * A OBRIGAÇÃO NÃO SOME NA DATA (4D.1):
 *  A data do evento determina quando a folga/recesso ACONTECE; ela NÃO
 *  determina quando a obrigação deixa de existir. Enquanto
 *  uncoveredMinutes > 0 e a entrada estiver DENTRO do ciclo consultado,
 *  a obrigação permanece no total — seja FUTURA, de HOJE ou PASSADA EM
 *  ABERTO. Sai do total apenas quando quitada ou fora do ciclo.
 *
 * COBERTURA PELO PRÓPRIO DIA (4D.2, Parte B) — REGRA CONGELADA:
 *  "Trabalho em dia COMPENSAR reduz PRIMEIRO a obrigação daquele próprio dia."
 *  A resolução central (companyDayContext) já consome o trabalho do dia antes
 *  de formar saldo: compensarSurplus = max(0, min(worked, 10h) − obrigação)
 *  é o CRÉDITO regular do dia. A parte do trabalho consumida pela obrigação
 *  é, portanto, DERIVADA do contexto canônico:
 *
 *    selfWorkedCoverageMinutes = workedCap − compensarSurplus
 *                                = min(min(worked, 10h), obrigação)
 *
 *  Exemplos (obrigação 8h, jornada esperada 0):
 *    trabalhado 8h → self 8h, uncovered 0, saldo regular 0;
 *    trabalhado 3h → self 3h, uncovered 5h, saldo regular 0;
 *    trabalhado 9h → self 8h (só 8h cobrem), saldo regular +1h.
 *  Jornada parcial (ex.: Cinzas 4h+4h): MESMA fórmula canônica do contexto —
 *  com 4h trabalhadas self 4h (obrigação coberta, déficit regular 0); acima
 *  disso o excedente segue a semântica regular existente.
 *
 * PROTEÇÃO CONTRA DUPLA COBERTURA (4D.2, REGRA CRÍTICA):
 *    coveredMinutes = min(original, selfWorked + concludedExternal)
 *    uncoveredMinutes = original − coveredMinutes   (nunca negativo)
 *  O histórico de concludedExternalCoverageMinutes permanece íntegro mesmo
 *  quando a cobertura antiga é excedentária.
 *
 * DIA NÃO REALIZADO / CONGELADO (4D.2, Partes D/E):
 *  - futuro (date > today): selfWorkedCoverage = 0 — batida futura é
 *    proibida/não realizada; jornada prevista NÃO é cobertura;
 *  - jornada aberta/financeiramente pendente (day.open || day.financialPending):
 *    selfWorkedCoverage = 0 — só jornada financeiramente VÁLIDA cobre.
 *
 * FIM DE SEMANA (4D.1, Parte D): fim de semana COMUM (sem entrada) é folga
 * neutra; entrada EXPLÍCITA COMPENSAR é respeitada em qualquer dia, usando
 * SOMENTE o horasACompensar importado. ABONADO 0h e COMPENSAR ≤ 0: neutros.
 *
 * PLANEJADO ≠ REALIZADO: planejado NÃO reduz uncovered (só informação).
 * Obrigação de calendário NUNCA é déficit factual nem entra na projeção [10+].
 *
 * STATUS TEMPORAL (classificação — NUNCA condição financeira):
 *  date >  today => "future" · date === today => "today" ·
 *  date <  today && aberta => "overdue" · quitada => "settled".
 *
 * ISOLAMENTO 30/04 (regra 9): só obrigações DENTRO do ciclo informado.
 */
import { companyDayContext, entryOnDate, type CalendarCategory, type CalendarTreatment, type CompanyCalendars } from "./company-calendar";
import { annualCycleBounds, listDaysBetween } from "./periods";
import type { Absence } from "./absences";
import type { WorkSettings } from "./time";
import type { Compensation, TimeEntry } from "./types";

/** Status TEMPORAL da obrigação (não é condição para existir financeiramente). */
export type CalendarObligationStatus = "future" | "today" | "overdue" | "settled";

export interface CalendarForecastEvent {
  /** Data da obrigação (YYYY-MM-DD). */
  date: string;
  descricao: string;
  categoria: CalendarCategory;
  tratamento: CalendarTreatment;
  /** Obrigação ORIGINAL do dia (COMPENSAR · horasACompensar > 0). */
  originalMinutes: number;
  /** 4D.2 — cobertura factual pelo trabalho do PRÓPRIO dia (resolução central). */
  selfWorkedCoverageMinutes: number;
  /** Cobertura EXTERNA QUITADA (compensação concluída kind="calendario" na data). */
  concludedExternalCoverageMinutes: number;
  /** Cobertura PLANEJADA (compensação pendente kind="calendario" — informativa). */
  plannedCoverageMinutes: number;
  /** min(original, self + concluída) — proteção contra dupla cobertura. */
  coveredMinutes: number;
  /** original − covered (≥ 0) — PLANEJADO NÃO reduz. */
  uncoveredMinutes: number;
  /** future · today · overdue (passada e aberta) · settled (quitada). */
  status: CalendarObligationStatus;
}

export interface CalendarForecast {
  /** Σ das obrigações ORIGINAIS do ciclo (inclui as já quitadas — histórico). */
  obligationMinutes: number;
  /** Σ da cobertura factual pelo próprio dia. */
  selfWorkedCoverageMinutes: number;
  /** Σ da cobertura externa QUITADA (histórico bruto — pode exceder a obrigação). */
  concludedExternalCoverageMinutes: number;
  /** Σ da cobertura PLANEJADA (informação separada — não é fato). */
  plannedCoverageMinutes: number;
  /** Σ min(original, self + concluída). */
  coveredMinutes: number;
  /**
   * Σ ainda descoberta = Σ (original − covered). INDICADOR PRINCIPAL.
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
 *
 * 4D.2: quando entries/absences/settings são informados, a cobertura pelo
 * trabalho do PRÓPRIO dia é derivada da resolução central
 * (companyDayContext) — a MESMA semântica do DayCard/Visão Geral.
 */
export function buildCalendarForecast(p: {
  calendars: CompanyCalendars | undefined;
  compensations: Compensation[];
  /** Ciclo anual escopo (ex.: "2026/2027"). */
  cycle: string;
  /** Corte civil (hoje, injetável — só classifica o status temporal). */
  today: string;
  /** 4D.2 — dados factuais para a cobertura pelo próprio dia (opcionais). */
  entries?: TimeEntry[];
  absences?: Absence[];
  settings?: WorkSettings;
}): CalendarForecast {
  const { from, to } = annualCycleBounds(p.cycle);
  const events: CalendarForecastEvent[] = [];

  for (const date of listDaysBetween(from, to)) {
    const entry = entryOnDate(p.calendars, date);
    if (!entry) continue;
    // Só ENTRADA EXPLÍCITA gera obrigação — em qualquer dia da semana (4D.1).
    // Fonte única: horasACompensar da própria entrada (nada inferido).
    const originalMinutes =
      entry.tratamento === "COMPENSAR" ? Math.max(0, entry.horasACompensar * 60) : 0;
    if (originalMinutes <= 0) continue; // abono/feriado 0h · COMPENSAR ≤ 0 → neutro

    // 4D.2 (Partes B/D/E) — cobertura pelo trabalho do PRÓPRIO dia, derivada
    // da resolução central: o contexto canônico já consome o trabalho da
    // obrigação antes de formar crédito (compensarSurplus). Só jornada
    // realizada (date <= today) e financeiramente VÁLIDA (não pendente) cobre.
    let selfWorkedCoverageMinutes = 0;
    if (date <= p.today && p.settings && p.entries) {
      const cctx = companyDayContext(date, p.entries, p.absences ?? [], p.calendars, p.settings);
      const pendente = cctx.ctx.day.open || cctx.ctx.day.financialPending;
      if (!pendente) {
        const workedCap = Math.min(cctx.ctx.day.workedMinutes, p.settings.maxDailyMinutes);
        const compensarSurplus = Math.max(0, workedCap - originalMinutes); // MESMA fórmula do contexto
        selfWorkedCoverageMinutes = Math.max(0, workedCap - compensarSurplus);
      }
    }

    let concludedExternalCoverageMinutes = 0;
    let plannedCoverageMinutes = 0;
    for (const c of p.compensations) {
      if ((c.kind ?? "excedente") !== "calendario") continue;
      if (c.sourceDate !== date) continue; // cobertura ESPECÍFICA da obrigação
      if (c.status === "concluida") concludedExternalCoverageMinutes += Math.max(0, c.minutes);
      else if (c.status === "pendente") plannedCoverageMinutes += Math.max(0, c.minutes);
    }

    // REGRA CRÍTICA (4D.2): a cobertura total NUNCA supera a obrigação.
    const coveredMinutes = Math.min(originalMinutes, selfWorkedCoverageMinutes + concludedExternalCoverageMinutes);
    const uncoveredMinutes = originalMinutes - coveredMinutes;

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
      selfWorkedCoverageMinutes,
      concludedExternalCoverageMinutes,
      plannedCoverageMinutes,
      coveredMinutes,
      uncoveredMinutes,
      status,
    });
  }

  const sum = (f: (e: CalendarForecastEvent) => number) => events.reduce((s, e) => s + f(e), 0);

  return {
    obligationMinutes: sum((e) => e.originalMinutes),
    selfWorkedCoverageMinutes: sum((e) => e.selfWorkedCoverageMinutes),
    concludedExternalCoverageMinutes: sum((e) => e.concludedExternalCoverageMinutes),
    plannedCoverageMinutes: sum((e) => e.plannedCoverageMinutes),
    coveredMinutes: sum((e) => e.coveredMinutes),
    uncoveredMinutes: sum((e) => e.uncoveredMinutes),
    openEventCount: events.filter((e) => e.uncoveredMinutes > 0).length,
    events,
  };
}
