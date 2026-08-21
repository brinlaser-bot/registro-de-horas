// Import/Export de backup (JSON) com versionamento e validação.
import type { AppData, Compensation, TimeEntry, User } from "./types";

export const BACKUP_VERSION = 1;
export const INVALID_BACKUP_MSG = "Este arquivo não é um backup válido do Meu Horário.";

export interface BackupPayload {
  version: number;
  exportedAt: string;
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
}

export interface BackupSummary {
  entriesCount: number;
  compensationsCount: number;
  userName: string;
  schedule: string;
  version: number;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface ParsedBackup {
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
  version: number;
  summary: BackupSummary;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isTime = (v: unknown): v is string => isStr(v) && TIME_RE.test(v);
const isDate = (v: unknown): v is string => isStr(v) && DATE_RE.test(v);

function validUser(v: unknown): v is User {
  if (!v || typeof v !== "object") return false;
  const u = v as Record<string, unknown>;
  return (
    isStr(u.name) &&
    isStr(u.email) &&
    isTime(u.workStart) &&
    isTime(u.workEnd) &&
    isTime(u.lunchStart) &&
    isTime(u.lunchEnd) &&
    isNum(u.maxDailyMinutes) &&
    isBool(u.autoDeductLunch)
  );
}

function validEntry(v: unknown): v is TimeEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    isNum(e.id) &&
    isDate(e.date) &&
    isTime(e.time) &&
    (e.type === "entrada" || e.type === "saida") &&
    (e.note == null || isStr(e.note))
  );
}

function validComp(v: unknown): v is Compensation {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    isNum(c.id) &&
    isDate(c.sourceDate) &&
    isDate(c.targetDate) &&
    isNum(c.minutes) &&
    (c.status === "pendente" || c.status === "concluida" || c.status === "cancelada") &&
    (c.note == null || isStr(c.note)) &&
    isNum(c.createdAt)
  );
}

/** Gera o payload do backup com versionamento (usado pelo Exportar). */
export function buildBackupPayload(data: AppData): BackupPayload {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user: data.user,
    entries: data.entries,
    compensations: data.compensations,
  };
}

/**
 * Valida e interpreta o texto de um arquivo de backup.
 * Aceita o formato atual ({version, user, entries, compensations}) e o
 * formato antigo (sem `version`), mantendo compatibilidade retroativa.
 */
export function parseBackup(
  text: string,
): { ok: true; backup: ParsedBackup } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid-json" };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "not-object" };
  }

  const obj = raw as Record<string, unknown>;

  if (!validUser(obj.user)) return { ok: false, error: "bad-user" };
  if (!Array.isArray(obj.entries) || !obj.entries.every(validEntry)) {
    return { ok: false, error: "bad-entries" };
  }
  if (!Array.isArray(obj.compensations) || !obj.compensations.every(validComp)) {
    return { ok: false, error: "bad-comps" };
  }

  const version = isNum(obj.version) ? obj.version : 1;
  const user = { ...(obj.user as User), id: 1 } as User;
  const entries = obj.entries as TimeEntry[];
  const compensations = (obj.compensations as Compensation[]).map((c) => ({
    ...c,
    kind: c.kind ?? "excedente",
  }));

  const allDates = [
    ...entries.map((e) => e.date),
    ...compensations.flatMap((c) => [c.sourceDate, c.targetDate]),
  ];
  const periodFrom = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : null;
  const periodTo = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : null;

  const summary: BackupSummary = {
    entriesCount: entries.length,
    compensationsCount: compensations.length,
    userName: user.name,
    schedule: `${user.workStart}–${user.workEnd} (almoço ${user.lunchStart}–${user.lunchEnd})`,
    version,
    periodFrom,
    periodTo,
  };

  return { ok: true, backup: { user, entries, compensations, version, summary } };
}
