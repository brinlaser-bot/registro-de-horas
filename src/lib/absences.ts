// ─────────────────────────────────────────────────────────────
// FUNÇÕES CENTRAIS de Férias e Afastamentos.
// Efeitos sobre a jornada:
//  - férias / saúde / acordado-dispensado / outro → horas justificadas
//    NÃO geram déficit (jornada esperada efetiva reduzida).
//  - acordado-compensar → horas viram pendência "Acordo a compensar"
//    (não são déficit comum), compensáveis com hora extra no mesmo ciclo.
// ─────────────────────────────────────────────────────────────
import { computeDay, expectedMinutesOf, toMinutes } from "./time";
import { annualCycleClose, getAnnualPointCycle, nextCycleStart, sameAnnualCycle } from "./periods";
import type { DayResult, TimeEntry, WorkSettings } from "./types";

export type AbsenceKind = "ferias" | "saude" | "acordado" | "outro";
export type AbsenceDuration = "integral" | "parcial";
export type AbsenceTreatment = "dispensado" | "compensar";

export interface Absence {
  id: number;
  kind: AbsenceKind;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (mesmo ciclo anual de startDate)
  duration: AbsenceDuration;
  /** HH:MM — apenas quando duration = "parcial" */
  partialStart?: string;
  partialEnd?: string;
  /** Afastamento por saúde: atestado apresentado */
  medicalCert?: boolean;
  /** Apenas afastamento acordado: dispensado | compensar */
  treatment?: AbsenceTreatment;
  note?: string | null;
  createdAt: number;
}

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  ferias: "Férias",
  saude: "Afastamento por saúde",
  acordado: "Afastamento acordado",
  outro: "Outro afastamento justificado",
};

export function absenceLabel(a: Absence): string {
  if (a.kind === "acordado") {
    return a.treatment === "compensar"
      ? "Afastamento acordado — compensar posteriormente"
      : "Afastamento acordado — horas dispensadas";
  }
  return ABSENCE_LABELS[a.kind];
}

/** Janelas de trabalho esperado do dia (sem almoço), em minutos. */
export function workWindows(s: WorkSettings): Array<[number, number]> {
  return [
    [toMinutes(s.workStart), toMinutes(s.lunchStart)],
    [toMinutes(s.lunchEnd), toMinutes(s.workEnd)],
  ];
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** Ausência que cobre a data (se houver). */
export function absenceOnDate(absences: Absence[], date: string): Absence | undefined {
  return absences.find((a) => date >= a.startDate && date <= a.endDate);
}

/**
 * Minutos de jornada esperada cobertos pela ausência no dia.
 * Parcial: apenas a interseção com as janelas de trabalho (almoço não conta).
 */
export function absenceJustifiedMinutes(a: Absence, s: WorkSettings): number {
  const windows = workWindows(s);
  if (a.duration === "integral") {
    return windows.reduce((sum, [w1, w2]) => sum + Math.max(0, w2 - w1), 0);
  }
  const p1 = toMinutes(a.partialStart ?? "");
  const p2 = toMinutes(a.partialEnd ?? "");
  if (p2 <= p1) return 0;
  return windows.reduce((sum, [w1, w2]) => sum + overlap(p1, p2, w1, w2), 0);
}

/** Minutos efetivamente trabalhados DENTRO da janela da ausência. */
export function workedWithinAbsence(day: DayResult, a: Absence, s: WorkSettings): number {
  if (a.duration !== "parcial") {
    // Integral: qualquer trabalho no dia está dentro da ausência
    return day.workedMinutes;
  }
  const p1 = toMinutes(a.partialStart ?? "");
  const p2 = toMinutes(a.partialEnd ?? "");
  return day.segments.reduce(
    (sum, seg) => sum + overlap(toMinutes(seg.start), toMinutes(seg.end), p1, p2),
    0,
  );
  void s;
}

export interface DayContext {
  day: DayResult;
  absence?: Absence;
  /** Jornada esperada efetiva (base − horas dispensadas). */
  effectiveExpected: number;
  /** Saldo considerando a jornada efetiva. */
  adjustedBalance: number;
  /** Déficit comum (0 em dia aberto ou com horas justificadas/acordo). */
  adjustedDeficit: number;
  /** Horas "Acordo a compensar" geradas no dia (acordado/compensar). */
  acordoMinutes: number;
  /** Horas justificadas (férias/saúde/dispensado/outro). */
  justifiedMinutes: number;
  isVacation: boolean;
}

/**
 * FUNÇÃO CENTRAL: contexto de jornada de um dia, já considerando ausências.
 * Todos os relatórios (Dashboard, Registros, Resumo, Consulta, dívidas)
 * devem usar esta função — nunca calcular déficit diretamente do computeDay.
 */
export function dayContext(
  date: string,
  entries: TimeEntry[],
  absences: Absence[],
  settings: WorkSettings,
  nowMinutes?: number,
): DayContext {
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
    nowMinutes,
  );
  if (!day.date) day.date = date;

  const absence = absenceOnDate(absences, date);
  const expected = day.expectedMinutes || expectedMinutesOf(settings);

  if (!absence) {
    return {
      day,
      effectiveExpected: expected,
      adjustedBalance: day.workedMinutes - expected,
      adjustedDeficit: day.open ? 0 : Math.max(0, expected - day.workedMinutes),
      acordoMinutes: 0,
      justifiedMinutes: 0,
      isVacation: false,
    };
  }

  const justified = absenceJustifiedMinutes(absence, settings);

  if (absence.kind === "acordado" && absence.treatment === "compensar") {
    // Horas NÃO dispensadas: viram "Acordo a compensar", nunca déficit comum
    const within = workedWithinAbsence(day, absence, settings);
    const acordo = Math.max(0, justified - within);
    const deficit = day.open ? 0 : Math.max(0, expected - day.workedMinutes - acordo);
    return {
      day,
      absence,
      effectiveExpected: expected,
      adjustedBalance: day.workedMinutes - expected + acordo,
      adjustedDeficit: deficit,
      acordoMinutes: acordo,
      justifiedMinutes: justified,
      isVacation: false,
    };
  }

  // Férias / saúde / acordado-dispensado / outro: horas justificadas
  const effectiveExpected = Math.max(0, expected - justified);
  return {
    day,
    absence,
    effectiveExpected,
    adjustedBalance: day.workedMinutes - effectiveExpected,
    adjustedDeficit: day.open ? 0 : Math.max(0, effectiveExpected - day.workedMinutes),
    acordoMinutes: 0,
    justifiedMinutes: justified,
    isVacation: absence.kind === "ferias" && justified >= expected,
  };
}

/* ── Validação central de férias/afastamentos ────────────── */

export interface AbsenceSplit {
  first: { startDate: string; endDate: string };
  second: { startDate: string; endDate: string };
}

export interface AbsenceValidation {
  ok: boolean;
  error?: string;
  code?: "invalid" | "cross-cycle" | "overlap";
  /** Evento atravessa o fechamento anual: sugestão de divisão em 2 registros. */
  split?: AbsenceSplit;
  /** Evento salvo, mas há batidas no período (informativo, nunca silencia). */
  warning?: string;
}

export function validateAbsence(
  draft: Omit<Absence, "id" | "createdAt">,
  allAbsences: Absence[],
  entries: TimeEntry[],
  excludeId?: number,
): AbsenceValidation {
  const { startDate, endDate } = draft;
  if (!startDate || !endDate) return { ok: false, code: "invalid", error: "Informe as datas." };
  if (endDate < startDate) {
    return { ok: false, code: "invalid", error: "A data final não pode ser anterior à data inicial." };
  }
  if (draft.duration === "parcial") {
    if (!draft.partialStart || !draft.partialEnd) {
      return { ok: false, code: "invalid", error: "Informe o horário inicial e final do período parcial." };
    }
    if (toMinutes(draft.partialEnd) <= toMinutes(draft.partialStart)) {
      return { ok: false, code: "invalid", error: "O horário final deve ser depois do inicial." };
    }
  }
  if (draft.kind === "acordado" && !draft.treatment) {
    return { ok: false, code: "invalid", error: "Informe como tratar as horas do afastamento acordado." };
  }

  // Barreira do fechamento anual: evento não pode atravessar 30/04 → 01/05
  if (!sameAnnualCycle(startDate, endDate)) {
    const cycle = getAnnualPointCycle(startDate);
    return {
      ok: false,
      code: "cross-cycle",
      error:
        "O fechamento anual ocorre em 30/04. Este período precisa ser dividido em dois registros independentes.",
      split: {
        first: { startDate, endDate: annualCycleClose(cycle) },
        second: { startDate: nextCycleStart(cycle), endDate },
      },
    };
  }

  // Sobreposição com outro evento existente → bloqueio
  const conflict = allAbsences.find(
    (a) => a.id !== excludeId && startDate <= a.endDate && endDate >= a.startDate,
  );
  if (conflict) {
    return {
      ok: false,
      code: "overlap",
      error: `Já existe "${absenceLabel(conflict)}" entre ${conflict.startDate} e ${conflict.endDate}. Ajuste as datas.`,
    };
  }

  // Aviso (não bloqueia): existem batidas no período
  const punches = entries.filter((e) => e.date >= startDate && e.date <= endDate);
  const warning =
    punches.length > 0
      ? `Existem ${punches.length} registro(s) de ponto neste período. Eles foram preservados integralmente — nenhuma alteração foi feita nos registros.`
      : undefined;

  return { ok: true, warning };
}
