// Import/Export de backup (JSON) com versionamento e validação.
import type { AppData, Compensation, ExcessReason, Falta, TimeEntry, User } from "./types";
import type { Absence } from "./absences";
import type { SpecialExcessUse } from "./special-excess-use";
import type { SpecialExcessPlan } from "./special-excess-plan";
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
  /** Usos do [10+] (novo modelo). Campo opcional: backups antigos não o têm. */
  specialExcessUses?: SpecialExcessUse[];
  /** Planos/reservas futuras [10+] (4A). Campo opcional: backups antigos não o têm. */
  specialExcessPlans?: SpecialExcessPlan[];
  /** Consolidações do período do ponto (4G). Campo opcional: backups antigos não o têm. */
  periodConsolidations?: import("./period-consolidation").PeriodConsolidation[];
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

/* ═══════════════════════════════════════════════════════════════════════
 * 4C.1B — CONTRATO ÚNICO DE BACKUP (definition of done de persistência).
 *
 * Toda coleção PERSISTENTE do Meu Horário (a mesma do AppData/localStorage)
 * deve constar EXATAMENTE UMA VEZ nesta lista. O pipeline inteiro passa a
 * consumi-la: a exportação e o parse são auditados pelo teste sentinela
 * contra o estado real do store, e o payload das actions de importação
 * (Substituir/Mesclar) é DERIVADO daqui — uma coleção nova entra no
 * contrato e automaticamente participa de export → parse → replace/merge.
 * O teste sentinela (verify-backup-contract-4c1b.mts) falha se uma chave
 * do estado real ficar fora deste contrato.
 * ═══════════════════════════════════════════════════════════════════════ */
export const BACKUP_COLLECTIONS = [
  "user",
  "entries",
  "compensations",
  "absences",
  "companyCalendars",
  "faltas",
  "excessReasons",
  "specialExcessUses",
  "specialExcessPlans",
  "periodConsolidations",
] as const;

export type BackupCollectionKey = (typeof BACKUP_COLLECTIONS)[number];

/**
 * Payload aceito pelas actions de importação (replaceAll/mergeBackup) —
 * a MESMA forma do contrato, com coleções opcionais (backups antigos não
 * as têm e o parse devolve defaults seguros).
 */
export interface BackupImportPayload {
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences?: Absence[];
  companyCalendars?: CompanyCalendars;
  faltas?: Falta[];
  excessReasons?: ExcessReason[];
  specialExcessUses?: SpecialExcessUse[];
  specialExcessPlans?: SpecialExcessPlan[];
}

/**
 * 4C.1B — Deriva o payload das actions de importação DIRETO do contrato.
 * Usado pelo ImportBackupModal (Substituir e Mesclar): impossível importar
 * uma coleção e esquecer outra — a lista é esta, e o sentinela a mantém
 * alinhada com o estado real do store.
 */
export function backupImportPayload(parsed: ParsedBackup): BackupImportPayload {
  const out = {} as Record<BackupCollectionKey, unknown>;
  for (const key of BACKUP_COLLECTIONS) {
    out[key] = parsed[key];
  }
  return out as unknown as BackupImportPayload;
}

export interface ParsedBackup {
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: Absence[];
  companyCalendars?: CompanyCalendars;
  faltas: Falta[];
  excessReasons: ExcessReason[];
  specialExcessUses: SpecialExcessUse[];
  /** 4A: planos/reservas futuras. Backups antigos → []. */
  specialExcessPlans: SpecialExcessPlan[];
  /** 4G: consolidações do período do ponto. Backups antigos → []. */
  periodConsolidations: import("./period-consolidation").PeriodConsolidation[];
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

/** Valida o shape estrutural de um plano/reserva futura [10+] (4A). */
/** 4G — validador da coleção de consolidações (histórico nunca rejeitado por campos novos). */
function validPeriodConsolidation(v: unknown): v is import("./period-consolidation").PeriodConsolidation {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    isNum(c.id) &&
    isDate(c.periodStart) &&
    isDate(c.periodEnd) &&
    isDate(c.cycleStart) &&
    isDate(c.cycleEnd) &&
    isNum(c.consolidatedAt) &&
    isNum(c.revision) &&
    (c.status === "active" || c.status === "superseded") &&
    isNum(c.factualBalanceMinutes) &&
    isNum(c.projectedBalanceMinutes) &&
    isNum(c.regularPositiveMinutes) &&
    isNum(c.regularNegativeMinutes) &&
    isNum(c.trackedDays) &&
    isNum(c.specialExcessUsedMinutes) &&
    Array.isArray(c.useIds) &&
    (c.useIds as unknown[]).every((u) => isStr(u)) &&
    Array.isArray(c.allocations) &&
    (c.allocations as unknown[]).every((a) => {
      if (!a || typeof a !== "object") return false;
      const al = a as Record<string, unknown>;
      return isDate(al.originDate) && isNum(al.minutes);
    }) &&
    isNum(c.pendingCountAtConsolidation) &&
    (c.reopenedAt === undefined || c.reopenedAt === null || isNum(c.reopenedAt)) &&
    (c.reopenNote === undefined || c.reopenNote === null || isStr(c.reopenNote))
  );
}

function validSpecialExcessPlan(v: unknown): v is SpecialExcessPlan {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    isDate(p.destinationDate) &&
    (p.selectionMode === "automatic" || p.selectionMode === "manual") &&
    (p.status === "planned" || p.status === "cancelled" || p.status === "concluded") &&
    isNum(p.createdAt) &&
    Array.isArray(p.allocations) &&
    p.allocations.length > 0 &&
    (p.allocations as unknown[]).every((a) => {
      if (!a || typeof a !== "object") return false;
      const al = a as Record<string, unknown>;
      return isDate(al.originDate) && isNum(al.minutes) && (al.minutes as number) > 0;
    }) &&
    (p.note === undefined || p.note === null || isStr(p.note)) &&
    // 4C — campos de rastreabilidade da resolução (opcionais; backups
    // 4A/4A.1 não os têm e continuam válidos).
    (p.resolvedAt === undefined || isNum(p.resolvedAt)) &&
    (p.resolvedUseId === undefined || isStr(p.resolvedUseId)) &&
    (p.resolvedMinutes === undefined || isNum(p.resolvedMinutes)) &&
    (p.releasedMinutes === undefined || isNum(p.releasedMinutes))
  );
}

/** Valida o shape estrutural de um uso do [10+] (novo modelo). */
function validSpecialExcessUse(v: unknown): v is SpecialExcessUse {
  if (!v || typeof v !== "object") return false;
  const u = v as Record<string, unknown>;
  return (
    typeof u.id === "string" &&
    u.id.length > 0 &&
    isDate(u.destinationDate) &&
    (u.allocationStrategy === "fifo" || u.allocationStrategy === "manual") &&
    (u.status === "utilizado" || u.status === "cancelado") &&
    isNum(u.createdAt) &&
    Array.isArray(u.allocations) &&
    u.allocations.length > 0 &&
    (u.allocations as unknown[]).every((a) => {
      if (!a || typeof a !== "object") return false;
      const al = a as Record<string, unknown>;
      return isDate(al.originDate) && isNum(al.minutes) && (al.minutes as number) > 0;
    })
  );
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
    specialExcessUses: data.specialExcessUses ?? [],
    specialExcessPlans: data.specialExcessPlans ?? [],
    periodConsolidations: data.periodConsolidations ?? [],
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
  // Retrocompatibilidade: backups antigos não possuem "specialExcessUses" → [].
  const rawUses = obj.specialExcessUses;
  if (rawUses !== undefined && (!Array.isArray(rawUses) || !rawUses.every(validSpecialExcessUse))) {
    return { ok: false, error: "bad-special-excess-uses" };
  }
  const specialExcessUses = (rawUses as SpecialExcessUse[] | undefined) ?? [];
  // Retrocompatibilidade: backups antigos não possuem "specialExcessPlans" → []
  // (4A — campo opcional introduzido sem nova versão, como faltas/motivos/usos).
  const rawPlans = obj.specialExcessPlans;
  if (rawPlans !== undefined && (!Array.isArray(rawPlans) || !rawPlans.every(validSpecialExcessPlan))) {
    return { ok: false, error: "bad-special-excess-plans" };
  }
  const specialExcessPlans = (rawPlans as SpecialExcessPlan[] | undefined) ?? [];
  // Retrocompatibilidade: backups antigos não possuem "periodConsolidations" → []
  // (4G — campo opcional introduzido sem nova versão, como faltas/motivos/usos/planos).
  const rawConsolidations = obj.periodConsolidations;
  if (rawConsolidations !== undefined && (!Array.isArray(rawConsolidations) || !rawConsolidations.every(validPeriodConsolidation))) {
    return { ok: false, error: "bad-period-consolidations" };
  }
  const periodConsolidations = (rawConsolidations as import("./period-consolidation").PeriodConsolidation[] | undefined) ?? [];

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

  return { ok: true, backup: { user, entries, compensations, absences, companyCalendars, faltas, excessReasons, specialExcessUses, specialExcessPlans, periodConsolidations, version, summary } };
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
