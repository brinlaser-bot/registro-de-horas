// ─────────────────────────────────────────────────────────────
// FONTE CENTRAL: “Sem registro esperado”.
//
// SEM REGISTRO é uma PENDÊNCIA OPERACIONAL — ausência de informação
// suficiente. NÃO é déficit, falta, crédito, Banco, [10+] nem compensação.
// O usuário resolve o fato (batidas, falta ou ausência); só então o
// sistema calcula o efeito financeiro correspondente.
//
// Distinto de REGISTRO PENDENTE (há batidas incompletas/inconsistentes).
// ─────────────────────────────────────────────────────────────
import { faltaOnDate } from "./faltas";
import { companyDayContext, type CalendarDayView, type CompanyCalendars } from "./company-calendar";
import { listDaysBetween } from "./periods";
import type { Absence } from "./absences";
import type { Falta, TimeEntry, WorkSettings } from "./types";

/**
 * Um dia entra em “Sem registro” SOMENTE quando TODAS as condições valem:
 *  1. a data já passou (não é hoje em andamento nem futuro);
 *  2. a jornada/base EFETIVA é maior que zero;
 *  3. não existe nenhuma batida;
 *  4. não existe situação que dispense ou explique a ausência
 *     (falta, férias, saúde, abono integral, dispensado, feriado/folga
 *     com base 0 — já refletidos em effectiveExpected ou em falta).
 *
 * ABONO PARCIAL: se a base efetiva restante > 0 e não há batidas,
 * classifica como Sem registro (a parte a cumprir ficou sem fato).
 *
 * Data de início do controle: date < controlStartDate nunca é Sem registro.
 * Ausente/inválida → sem piso extra (compatível com testes e dados antigos).
 */
export function isMissingExpectedRecord(
  date: string,
  today: string,
  view: CalendarDayView,
  faltas?: Falta[],
  controlStartDate?: string | null,
): boolean {
  if (!date || date >= today) return false;
  if (controlStartDate && /^\d{4}-\d{2}-\d{2}$/.test(controlStartDate) && date < controlStartDate) {
    return false;
  }
  if (view.ctx.day.entries.length > 0) return false;
  if (view.effectiveExpected <= 0) return false;
  if (faltaOnDate(faltas, date)) return false;
  return true;
}

/**
 * Dia ANTERIOR ao início do controle e já passado.
 * Não é Sem registro (não cobra justificativa). Continua podendo receber
 * lançamento histórico. Ausente/inválida → nunca histórico-neutro por esta via.
 */
export function isHistoricalEmptyDate(
  date: string,
  today: string,
  controlStartDate?: string | null,
): boolean {
  if (!date || date >= today) return false;
  if (!controlStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(controlStartDate)) return false;
  return date < controlStartDate;
}

/** Datas do intervalo classificadas como Sem registro (ordem cronológica). */
export function missingExpectedRecordDates(
  range: { from: string; to: string },
  today: string,
  entries: TimeEntry[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  faltas?: Falta[],
  controlStartDate?: string | null,
): string[] {
  return listDaysBetween(range.from, range.to).filter((date) => {
    const view = companyDayContext(date, entries, absences, calendars, settings);
    return isMissingExpectedRecord(date, today, view, faltas, controlStartDate);
  });
}

/**
 * Linha do tempo completa do período/consulta: UM item por data, inclusive
 * dias sem batida. Fonte única da listagem principal de Registros.
 */
export function registrosTimelineDates(range: { from: string; to: string }): string[] {
  return listDaysBetween(range.from, range.to);
}
