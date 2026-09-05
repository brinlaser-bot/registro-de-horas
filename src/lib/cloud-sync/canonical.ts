/**
 * ETAPA 4K — Estado operacional canônico da sincronização.
 *
 * REGRA-MÃE: a nuvem NÃO inventa uma segunda serialização do app. O payload
 * do `user_app_state` reutiliza a MESMA representação já validada pelo
 * BACKUP v3:
 *
 *   - serializar  → `buildBackupPayload` (BACKUP_VERSION continua 3);
 *   - validar     → `parseBackup` (o mesmo validador da importação);
 *   - aplicar     → `backupImportPayload` + `actions.replaceAll`.
 *
 * NUNCA entra no payload: tokens/sessão, segredos, chaves, SMTP, cookies ou
 * estado efêmero de UI — somente as coleções operacionais do contrato único
 * de backup (BACKUP_COLLECTIONS).
 */
import {
  BACKUP_VERSION,
  backupImportPayload,
  buildBackupPayload,
  parseBackup,
  type BackupPayload,
  type ParsedBackup,
} from "../backup";
import { actions, getAppData } from "../store";
import { EMPTY_USER } from "../seed-data";
import type { AppData, User } from "../types";

/** Versão do envelope `user_app_state.payload_version` nesta etapa. */
export const CLOUD_PAYLOAD_VERSION = 1;

/** Nome do arquivo de backup de segurança (o mesmo do Exportar existente). */
export const BACKUP_FILE_NAME = "meu-horario-backup.json";

/** O payload cloud É um payload de backup v3 (mesmo formato, sem bifurcação). */
export type CanonicalCloudPayload = BackupPayload;

/**
 * Serializa o estado operacional atual para o formato canônico (BACKUP v3).
 * Função pura sobre o AppData informado.
 */
export function serializeCanonicalAppState(data: AppData): CanonicalCloudPayload {
  const payload = buildBackupPayload(data);
  // Trava de sanidade: o serializer do backup é a autoridade do formato.
  if (payload.version !== BACKUP_VERSION) {
    throw new Error("Formato canônico inesperado.");
  }
  return payload;
}

/**
 * Valida um payload vindo da nuvem com o MESMO validador da importação de
 * backup. Nunca lança: `ok:false` significa "não aplicar, preservar o local".
 */
export function validateCanonicalAppState(
  payload: unknown,
): { ok: true; parsed: ParsedBackup } | { ok: false } {
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return { ok: false };
  }
  const result = parseBackup(text);
  if (!result.ok) return { ok: false };
  return { ok: true, parsed: result.backup };
}

/**
 * Aplica um estado canônico validado ao cache local (substituição integral,
 * idêntica ao "Substituir" da importação de backup).
 */
export function applyCanonicalAppState(parsed: ParsedBackup): void {
  actions.replaceAll(backupImportPayload(parsed));
}

/* ─────────────────────────────────────────────────────────────
   Impressão digital canônica (detecção de "falso conflito").
   Compara APENAS o estado operacional: `exportedAt` é metadata transitória
   de exportação e valores `undefined` não sobrevivem ao JSONB — ambos são
   ignorados para que o snapshot local e o row remoto sejam comparáveis.
   ───────────────────────────────────────────────────────────── */

function stripTransient(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTransient);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "exportedAt") continue;
      if (entry === undefined) continue;
      out[key] = stripTransient(entry);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** Impressão estável do estado canônico (ordem de chaves irrelevante). */
export function canonicalFingerprint(payload: unknown): string {
  return stableStringify(stripTransient(payload));
}

/* ─────────────────────────────────────────────────────────────
   Estado local "comprovadamente vazio" (dispositivo limpo).
   Coleções operacionais zeradas + perfil equivalente ao padrão de fábrica
   (ignora `controlStartDate`/`birthDate`, preenchidos automaticamente).
   ───────────────────────────────────────────────────────────── */

const DEFAULT_GUIDE_MIN = "08:00";
const DEFAULT_GUIDE_MAX = "17:45";

function isDefaultUser(user: User): boolean {
  const d = EMPTY_USER;
  return (
    user.name === d.name &&
    user.email === d.email &&
    user.workStart === d.workStart &&
    user.workEnd === d.workEnd &&
    user.lunchStart === d.lunchStart &&
    user.lunchEnd === d.lunchEnd &&
    user.maxDailyMinutes === d.maxDailyMinutes &&
    user.autoDeductLunch === d.autoDeductLunch &&
    (user.guideMinEntry ?? DEFAULT_GUIDE_MIN) === (d.guideMinEntry ?? DEFAULT_GUIDE_MIN) &&
    (user.guideMaxExit ?? DEFAULT_GUIDE_MAX) === (d.guideMaxExit ?? DEFAULT_GUIDE_MAX)
  );
}

/**
 * `true` quando o cache local equivale a um dispositivo limpo: nenhuma coleção
 * operacional com conteúdo e perfil padrão. Usado para hidratar a nuvem sem
 * fricção (novo dispositivo) e para dispensar o backup pré-ativação.
 */
export function isEmptyOperationalState(data: AppData): boolean {
  const collections: ReadonlyArray<ReadonlyArray<unknown> | undefined> = [
    data.entries,
    data.compensations,
    data.absences,
    data.companyCalendars,
    data.faltas,
    data.excessReasons,
    data.specialExcessUses,
    data.specialExcessPlans,
    data.periodConsolidations,
    data.annualCycleClosures,
  ];
  if (collections.some((c) => (c ?? []).length > 0)) return false;
  return isDefaultUser(data.user);
}

/**
 * Baixa o backup de segurança BACKUP v3 do estado local atual (reutiliza o
 * exportador existente — nenhum novo tipo de backup).
 */
export function downloadLocalBackup(): void {
  if (typeof document === "undefined") return;
  const text = JSON.stringify(serializeCanonicalAppState(getAppData()), null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = BACKUP_FILE_NAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
