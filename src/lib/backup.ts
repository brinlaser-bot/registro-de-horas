// Import/Export de backup (JSON) com versionamento e validação.
import type { AppData, Compensation, ExcessReason, Falta, TimeEntry, User } from "./types";
import type { Absence } from "./absences";
import { normalizeCompanyCalendars, type CompanyCalendars } from "./company-calendar";

/**
 * v1: user + entries + compensations.
 * v2: + absences (férias/afastamentos). Backups v1 importam com lista vazia.
 * v3: + companyCalendars (um por ciclo anual). Backups v2 com o campo antigo
 *     "companyCalendar" (único) importam como coleção com 1 calendário.
 */
export const BACKUP_VERSION = 3;
export const INVALID_BACKUP_MSG = "Este arquivo não é um backup válido do Meu Horário.";

export interface BackupPayload {
  version: number;
  exportedAt: string;
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: Absence[];
  companyCalendars?: CompanyCalendars;
  /** Faltas (inclusive previstas). Campo opcional: backups antigos não o têm. */
  faltas?: Falta[];
  /** Motivos de excedente >10h. Campo opcional: backups antigos não o têm. */
  excessReasons?: ExcessReason[];
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
  absences: Absence[];
  companyCalendars?: CompanyCalendars;
  faltas: Falta[];
  excessReasons: ExcessReason[];
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
    isBool(u.autoDeductLunch) &&
    // birthDate é opcional (backups v1/v2/v3 antigos não o tinham)
    (u.birthDate === undefined || u.birthDate === null || isDate(u.birthDate)) &&
    (u.controlStartDate === undefined || u.controlStartDate === null || isDate(u.controlStartDate))
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

function validAbsence(v: unknown): v is Absence {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    isNum(a.id) &&
    (a.kind === "ferias" || a.kind === "saude" || a.kind === "acordado" || a.kind === "abono" || a.kind === "outro") &&
    isDate(a.startDate) &&
    isDate(a.endDate) &&
    (a.duration === "integral" || a.duration === "parcial") &&
    isNum(a.createdAt)
  );
}

/** Validação de falta em backups (campo opcional, introduzido sem nova versão). */
function validFalta(v: unknown): v is Falta {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return isNum(f.id) && isDate(f.date) && isNum(f.createdAt);
}

/** Comparação de conteúdo para mesclagem de faltas: uma falta por dia. */
export function faltasEqual(a: Falta, b: Falta): boolean {
  return a.date === b.date;
}

const EXCESS_REASON_CODES = new Set([
  "demanda-urgente",
  "reuniao-prolongada",
  "viagem-deslocamento",
  "atendimento-evento",
  "necessidade-operacional",
  "outro",
]);

/** Validação de motivo de excedente em backups (campo opcional, retrocompatível). */
function validExcessReason(v: unknown): v is ExcessReason {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    isNum(r.id) &&
    isDate(r.date) &&
    EXCESS_REASON_CODES.has(r.reason as string) &&
    (r.customReason == null || isStr(r.customReason)) &&
    (r.observation == null || isStr(r.observation)) &&
    isNum(r.createdAt) &&
    isNum(r.updatedAt)
  );
}

/** Comparação para mesclagem de motivos: um motivo por data. */
export function excessReasonsEqual(a: ExcessReason, b: ExcessReason): boolean {
  return (
    a.date === b.date &&
    a.reason === b.reason &&
    (a.customReason ?? null) === (b.customReason ?? null) &&
    (a.observation ?? null) === (b.observation ?? null)
  );
}

/** Comparação de conteúdo para mesclagem de ausências. */
export function absencesEqual(a: Absence, b: Absence): boolean {
  return (
    a.kind === b.kind &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.duration === b.duration &&
    (a.partialStart ?? null) === (b.partialStart ?? null) &&
    (a.partialEnd ?? null) === (b.partialEnd ?? null) &&
    (a.medicalCert ?? null) === (b.medicalCert ?? null) &&
    (a.treatment ?? null) === (b.treatment ?? null) &&
    (a.note ?? null) === (b.note ?? null)
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
    absences: data.absences ?? [],
    companyCalendars: data.companyCalendars,
    faltas: data.faltas ?? [],
    excessReasons: data.excessReasons ?? [],
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
  // Retrocompatibilidade: backups v1 não possuem "absences" → lista vazia.
  // Eventos divididos no fechamento anual permanecem registros independentes
  // (nunca são recombinados na importação/mesclagem).
  const rawAbsences = obj.absences;
  if (rawAbsences !== undefined && (!Array.isArray(rawAbsences) || !rawAbsences.every(validAbsence))) {
    return { ok: false, error: "bad-absences" };
  }
  const absences = (rawAbsences as Absence[] | undefined) ?? [];
  // Compatibilidade: v3 lê "companyCalendars" (coleção); v2/antigos trazem
  // "companyCalendar" (objeto único) — ambos normalizados para a coleção.
  const companyCalendars =
    normalizeCompanyCalendars(obj.companyCalendars) ??
    normalizeCompanyCalendars(obj.companyCalendar);
  // Retrocompatibilidade: backups v1/v2/v3 antigos não possuem "faltas" → [].
  const rawFaltas = obj.faltas;
  if (rawFaltas !== undefined && (!Array.isArray(rawFaltas) || !rawFaltas.every(validFalta))) {
    return { ok: false, error: "bad-faltas" };
  }
  const faltas = (rawFaltas as Falta[] | undefined) ?? [];
  // Retrocompatibilidade: backups antigos não possuem "excessReasons" → [].
  const rawReasons = obj.excessReasons;
  if (rawReasons !== undefined && (!Array.isArray(rawReasons) || !rawReasons.every(validExcessReason))) {
    return { ok: false, error: "bad-excess-reasons" };
  }
  const excessReasons = (rawReasons as ExcessReason[] | undefined) ?? [];

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

  return { ok: true, backup: { user, entries, compensations, absences, companyCalendars, faltas, excessReasons, version, summary } };
}

/* ──────────────────────────────────────────────────────────
   Mesclagem segura (importar backup sem perder eventos distintos)
   ────────────────────────────────────────────────────────── */

/** Compara todo o conteúdo relevante de dois registros de ponto. */
export function entriesEqual(a: TimeEntry, b: TimeEntry): boolean {
  return (
    a.date === b.date &&
    a.time === b.time &&
    a.type === b.type &&
    (a.note ?? null) === (b.note ?? null)
  );
}

/** Compara todo o conteúdo relevante de duas compensações. */
export function compsEqual(a: Compensation, b: Compensation): boolean {
  return (
    a.sourceDate === b.sourceDate &&
    a.targetDate === b.targetDate &&
    a.minutes === b.minutes &&
    a.status === b.status &&
    (a.note ?? null) === (b.note ?? null) &&
    (a.kind ?? "excedente") === (b.kind ?? "excedente")
  );
}

export interface MergeOutcome<T> {
  merged: T[];
  added: number;
  skipped: number;
}

/**
 * Mescla itens importados nos existentes com estratégia segura:
 * - mesmo ID + mesmo conteúdo  → duplicado (ignorado);
 * - mesmo ID + conteúdo diferente → preserva ambos, gerando novo ID p/ o importado;
 * - sem correspondência de ID → novo registro (mantém o ID se livre, senão gera outro).
 *
 * NUNCA descarta um registro apenas por compartilhar dias/minutos com outro:
 * a deduplicação só ocorre quando ID e conteúdo coincidem por completo.
 */
export function mergeByIdAndContent<T extends { id: number }>(
  existing: T[],
  imported: T[],
  isEqual: (a: T, b: T) => boolean,
): MergeOutcome<T> {
  const merged: T[] = [...existing];
  const usedIds = new Set<number>(existing.map((x) => x.id));
  let cursor = existing.reduce((max, x) => Math.max(max, x.id), 0) + 1;

  const alloc = (): number => {
    let id = cursor;
    while (usedIds.has(id)) id += 1;
    usedIds.add(id);
    cursor = id + 1;
    return id;
  };

  let added = 0;
  let skipped = 0;

  for (const item of imported) {
    const sameId = existing.filter((x) => x.id === item.id);
    const identical = sameId.some((x) => isEqual(x, item));

    if (identical) {
      skipped += 1;
      continue;
    }

    if (sameId.length > 0) {
      merged.push({ ...item, id: alloc() } as T);
      added += 1;
      continue;
    }

    const id = usedIds.has(item.id) ? alloc() : item.id;
    usedIds.add(id);
    if (id >= cursor) cursor = id + 1;
    merged.push({ ...item, id } as T);
    added += 1;
  }

  return { merged, added, skipped };
}
