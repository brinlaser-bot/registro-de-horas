// ─────────────────────────────────────────────────────────────
// FONTE ÚNICA do "Atenção agora" (4D.5) — faixas independentes.
//
// Consulta SOMENTE as classificações canônicas já existentes
// (computeDay via companyDayContext, isMissingExpectedRecord,
// SpecialExcessPlan). NÃO cria status novo, NÃO altera saldo,
// Banco, [10+], calendário nem persistência.
//
// ESCOPO: ciclo ANUAL atual (01/05→30/04) — coerente com a
// arquitetura da Visão Geral. Uma pendência de período de ponto
// anterior (21→20) continua visível enquanto existir no ciclo;
// a coerência com Registros é garantia de ESCOPO no destino do
// CTA (mesmo range consultado), nunca redução de contagem.
// ─────────────────────────────────────────────────────────────
import { annualCycleBounds, getAnnualPointCycle, listDaysBetween } from "./periods";
import { companyDayContext, type CalendarDayView, type CompanyCalendars } from "./company-calendar";
import { isMissingExpectedRecord } from "./missing-records";
import { activeSpecialPlansForDate, type SpecialExcessPlan } from "./special-excess-plan";
import type { Absence } from "./absences";
import type { Falta, TimeEntry, WorkSettings } from "./types";

export type AttentionCategory = "inconsistente" | "incompleto" | "sem-registro" | "plano-10";

/** Campos canônicos de computeDay usados na classificação. */
export interface AttentionInputDay {
  consistent: boolean;
  open: boolean;
  empty: boolean;
}

/**
 * Categorias INDEPENDENTES do dia (uma data pode pertencer a categorias
 * diferentes, EXCETO inconsistente/incompleto — mutuamente exclusivas):
 * - INCONSISTENTE: há batidas e a sequência contém erro estrutural
 *   (validação canônica computeDay/analyzePunches — !consistent).
 *   Vence INCOMPLETO: a mesma data NUNCA aparece nas duas faixas.
 * - INCOMPLETO: batidas com sequência válida que não encerraram o
 *   registro (open) em dia JÁ PASSADO (date < today). A jornada do DIA
 *   ATUAL em andamento NÃO é pendência. (Mesma semântica de
 *   isPunchDayPending, aqui na forma não sobreposta.)
 * - SEM REGISTRO: fonte canônica isMissingExpectedRecord (já exclui
 *   hoje/futuro, fim de semana comum, feriado/ABONADO/COMPENSAR,
 *   férias/afastamento, falta e pré-controlStartDate).
 * - PLANO [10+]: reserva (status planned) cuja data de destino JÁ
 *   CHEGOU — futuro puro não alerta; já utilizada não é mais "planned".
 */
export function attentionCategoriesForDay(p: {
  date: string;
  today: string;
  day: AttentionInputDay;
  missingExpected: boolean;
  hasArrivedPlan: boolean;
}): AttentionCategory[] {
  const out: AttentionCategory[] = [];
  if (!p.day.empty && !p.day.consistent) out.push("inconsistente");
  else if (!p.day.empty && p.day.open && p.date < p.today) out.push("incompleto");
  if (p.missingExpected) out.push("sem-registro");
  if (p.hasArrivedPlan) out.push("plano-10");
  return out;
}

/** Extrai os campos canônicos do dia a partir da view central. */
export function attentionDayOf(view: CalendarDayView): AttentionInputDay {
  return {
    consistent: view.ctx.day.consistent,
    open: view.ctx.day.open,
    empty: view.ctx.day.empty,
  };
}

/** Plano [10+] aguardando confirmação NESTE dia (chegou e segue planned). */
export function hasArrivedSpecialPlan(plans: SpecialExcessPlan[], date: string, today: string): boolean {
  return date <= today && activeSpecialPlansForDate(plans, date).length > 0;
}

/**
 * Datas por categoria no intervalo (padrão: ciclo anual atual de "today").
 * As quatro contagens são INDEPENDENTES — nunca somadas numa faixa
 * genérica "Registros pendentes". A Visão Geral (faixas) e o filtro de
 * Registros consumem ESTA MESMA classificação (coerência por construção).
 */
export function attentionNowSummary(opts: {
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas?: Falta[];
  controlStartDate?: string | null;
  plans?: SpecialExcessPlan[];
  range?: { from: string; to: string };
}): Record<AttentionCategory, string[]> {
  const range = opts.range ?? annualCycleBounds(getAnnualPointCycle(opts.today));
  const result: Record<AttentionCategory, string[]> = {
    "inconsistente": [],
    "incompleto": [],
    "sem-registro": [],
    "plano-10": [],
  };
  for (const date of listDaysBetween(range.from, range.to)) {
    const view = companyDayContext(date, opts.entries, opts.absences, opts.calendars, opts.settings);
    const cats = attentionCategoriesForDay({
      date,
      today: opts.today,
      day: attentionDayOf(view),
      missingExpected: isMissingExpectedRecord(date, opts.today, view, opts.faltas, opts.controlStartDate),
      hasArrivedPlan: hasArrivedSpecialPlan(opts.plans ?? [], date, opts.today),
    });
    for (const c of cats) result[c].push(date);
  }
  return result;
}
