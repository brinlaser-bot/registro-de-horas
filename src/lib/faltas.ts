// Regras centrais de FALTA (registro manual, integral — esta versão).
// A falta é uma ocorrência de PONTO: não é férias/afastamento e nunca é
// criada automaticamente. A jornada da falta vem SEMPRE da resolução central
// (companyDayContext.effectiveExpected) — nunca uma fórmula paralela de 8h.
import { absenceLabel, type Absence } from "./absences";
import { companyDayContext, isWeekendDate, type CompanyCalendars } from "./company-calendar";
import { formatDateBR, formatMinutes } from "./time";
import type { Falta, TimeEntry, WorkSettings } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Falta registrada para a data, se houver. */
export function faltaOnDate(faltas: Falta[] | undefined, date: string): Falta | undefined {
  return faltas?.find((f) => f.date === date);
}

/** Falta efetiva = já vale hoje (date <= hoje). Futura = "Falta prevista". */
export function faltaEffectiveOnDate(
  faltas: Falta[] | undefined,
  date: string,
  today: string,
): Falta | undefined {
  const f = faltaOnDate(faltas, date);
  return f && f.date <= today ? f : undefined;
}

export function faltaStatusOf(date: string, today: string): "efetiva" | "prevista" {
  return date <= today ? "efetiva" : "prevista";
}

/** Somente as faltas que já valem (date <= today) — alimentam déficit/resumo. */
export function effectiveFaltas(faltas: Falta[] | undefined, today: string): Falta[] {
  return (faltas ?? []).filter((f) => f.date <= today);
}

/** Contador simples do resumo: faltas EFETIVAS dentro do intervalo. */
export function countEffectiveFaltas(
  faltas: Falta[] | undefined,
  range: { from: string; to: string },
  today: string,
): number {
  return effectiveFaltas(faltas, today).filter((f) => f.date >= range.from && f.date <= range.to).length;
}

export interface FaltaGate {
  ok: boolean;
  error?: string;
  /** Jornada efetiva do dia (min) — preenchida quando ok. */
  jornadaMinutes?: number;
}

/**
 * GATE CENTRAL: o dia aceita registrar falta integral?
 * Aceita ⇔ sem batidas, sem falta já registrada, sem cobertura integral e a
 * resolução central indica jornada efetiva > 0. Folga/fim de semana, dia
 * integralmente abonado, folga a compensar (jornada 0) e férias/afastamento
 * integral possuem jornada efetiva 0 → bloqueados com mensagem específica.
 */
export function canRegisterFalta(
  date: string,
  entries: TimeEntry[],
  absences: Absence[],
  companyCalendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  faltas: Falta[] | undefined,
): FaltaGate {
  if (!DATE_RE.test(date)) return { ok: false, error: "Data inválida." };
  if (faltaOnDate(faltas, date)) {
    return { ok: false, error: "Já existe uma falta registrada para este dia." };
  }
  if (entries.some((e) => e.date === date)) {
    return {
      ok: false,
      error:
        "Este dia possui registros de horário. O déficit será calculado automaticamente pelas horas trabalhadas.",
    };
  }
  const integral = absences.find(
    (a) => a.duration === "integral" && a.startDate <= date && date <= a.endDate,
  );
  if (integral) {
    return {
      ok: false,
      error: `Este dia já está coberto por ${absenceLabel(integral)} (integral).`,
    };
  }
  const cctx = companyDayContext(date, entries, absences, companyCalendars ?? [], settings);
  if (cctx.calendarEntry && cctx.effectiveExpected === 0) {
    if (cctx.calendarEntry.tratamento === "ABONADO") {
      return {
        ok: false,
        error: "Esta data está integralmente abonada pelo calendário — não há falta a registrar.",
      };
    }
    return {
      ok: false,
      error:
        "Esta data já possui obrigação própria do calendário (a compensar) — não é gerada falta comum.",
    };
  }
  if (isWeekendDate(date)) {
    return { ok: false, error: "Esta data é uma folga e não possui jornada a cumprir." };
  }
  if (cctx.effectiveExpected <= 0) {
    return { ok: false, error: "Esta data não possui jornada a cumprir — não há falta a registrar." };
  }
  return { ok: true, jornadaMinutes: cctx.effectiveExpected };
}

/** Texto da confirmação do "Registrar falta" (Visão geral / modal). */
export function faltaConfirmText(date: string, jornadaMinutes: number, today: string): string {
  const j = formatMinutes(jornadaMinutes);
  if (date <= today) {
    return `Registrar falta em ${formatDateBR(date)}?\nJornada prevista: ${j}.\nSerá gerado um déficit de ${j}.`;
  }
  return `Registrar falta em ${formatDateBR(date)}?\nJornada prevista: ${j}.\nFicará como "Falta prevista" e ainda não afetará o saldo.`;
}
