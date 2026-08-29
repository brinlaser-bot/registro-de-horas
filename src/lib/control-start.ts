// Data de início do controle — configuração estrutural (não é fato operacional).
// Define a partir de quando o app COBRA registro/justificativa. Não esconde
// a linha do tempo e não bloqueia lançamento histórico.
import type { AppData } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidControlStartDate(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function controlStartOf(user: { controlStartDate?: string | null } | undefined): string | null {
  const d = user?.controlStartDate;
  return isValidControlStartDate(d) ? d : null;
}

export function hasOperationalFacts(data: Pick<
  AppData,
  "entries" | "compensations" | "absences" | "faltas" | "excessReasons" | "companyCalendars"
>): boolean {
  return (
    data.entries.length > 0 ||
    data.compensations.length > 0 ||
    data.absences.length > 0 ||
    data.faltas.length > 0 ||
    (data.excessReasons ?? []).length > 0 ||
    (data.companyCalendars ?? []).length > 0
  );
}

/** Menor data operacional persistida, ou null se não houver fatos. */
export function earliestOperationalDate(data: Pick<
  AppData,
  "entries" | "compensations" | "absences" | "faltas" | "excessReasons" | "companyCalendars"
>): string | null {
  const dates: string[] = [];
  for (const e of data.entries) dates.push(e.date);
  for (const f of data.faltas) dates.push(f.date);
  for (const a of data.absences) {
    dates.push(a.startDate);
    dates.push(a.endDate);
  }
  for (const c of data.compensations) {
    dates.push(c.sourceDate);
    dates.push(c.targetDate);
  }
  for (const r of data.excessReasons ?? []) dates.push(r.date);
  for (const cal of data.companyCalendars ?? []) {
    dates.push(cal.cycleStart);
    for (const e of cal.entries) dates.push(e.date);
  }
  const valid = dates.filter((d) => DATE_RE.test(d));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a < b ? a : b));
}

/**
 * Resolve controlStartDate na hidratação:
 * - já preenchida → preserva;
 * - sem fatos → hoje local;
 * - com fatos → data do fato mais antigo (não esconde histórico).
 */
export function resolveControlStartDate(data: AppData, today: string): string {
  const existing = controlStartOf(data.user);
  if (existing) return existing;
  if (!hasOperationalFacts(data)) return today;
  return earliestOperationalDate(data) ?? today;
}

export function applyControlStartMigration(data: AppData, today: string): AppData {
  const resolved = resolveControlStartDate(data, today);
  if (data.user.controlStartDate === resolved) return data;
  return { ...data, user: { ...data.user, controlStartDate: resolved } };
}
