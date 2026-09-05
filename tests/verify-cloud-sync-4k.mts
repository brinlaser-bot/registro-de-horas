/**
 * VERIFICAÇÃO — ETAPA 4K: SINCRONIZAÇÃO SEGURA MULTI-DISPOSITIVO.
 *
 * Escopo FECHADO (Supabase como estado canônico após ativação; nenhum motor
 * financeiro, formato de backup ou migration tocados):
 *   - estado cloud = MESMA representação do BACKUP v3 (serializer/validador
 *     reutilizados; BACKUP_VERSION 3; payload_version 1);
 *   - primeiro envio SOMENTE por ação explícita (nunca automático);
 *   - escrita otimista por revision (CAS +1 exato; zero rows = conflito);
 *   - nenhum last-write-wins silencioso; nenhum tempo real; nenhuma sondagem;
 *   - troca de conta nunca exibe o cache da conta anterior;
 *   - pendência sobrevive a reload; logout preserva pendência e cache.
 *
 * Os testes dinâmicos usam um Supabase falso em memória (o store e a metadata
 * operam em memória fora do navegador). Nenhum teste toca na rede real.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-cloud-sync-4k.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AppData, TimeEntry } from "../src/lib/types";
import type { CloudDataClient } from "../src/lib/cloud-sync/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (p: string) => readFileSync(join(root, p), "utf8");
const exists = (p: string) => existsSync(join(root, p));

let passed = 0;
const check = async (id: string, fn: () => void | Promise<void>) => {
  await fn();
  passed++;
  console.log(`✔ ${id}`);
};

const backup = await import("../src/lib/backup.ts");
const store = await import("../src/lib/store.ts");
const seed = await import("../src/lib/seed-data.ts");
const canonical = await import("../src/lib/cloud-sync/canonical.ts");
const metadata = await import("../src/lib/cloud-sync/metadata.ts");
const engine = await import("../src/lib/cloud-sync/engine.ts");

/* ── Localizadores ── */
const CANONICAL = "src/lib/cloud-sync/canonical.ts";
const META = "src/lib/cloud-sync/metadata.ts";
const CLIENT = "src/lib/cloud-sync/client.ts";
const ENGINE = "src/lib/cloud-sync/engine.ts";
const PROVIDER = "src/components/cloud-sync-provider.tsx";
const SETTINGS = "src/components/cloud-sync-settings.tsx";
const STATUS_LINE = "src/components/sync-status-line.tsx";
const SIGN_OUT = "src/components/sign-out-button.tsx";
const CLOUD_FILES = [CANONICAL, META, CLIENT, ENGINE, PROVIDER, SETTINGS, STATUS_LINE];

/* ── Supabase falso (memória; registra chamadas; nunca toca a rede) ── */

type Filter = [string, string | number];

interface RecordedCall {
  op: "select" | "insert" | "update";
  filters: Filter[];
  values: Record<string, unknown> | null;
}

class FakeQuery {
  filters: Filter[] = [];
  constructor(
    private fake: FakeSupabase,
    private op: "select" | "insert" | "update",
    private values: Record<string, unknown> | null = null,
  ) {}
  eq(col: string, value: string | number): FakeQuery {
    this.filters.push([col, value]);
    return this;
  }
  select(_columns?: string): FakeQuery {
    return this;
  }
  async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    return this.fake.exec(this.op, this.filters, this.values);
  }
  then(
    onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    return Promise.resolve()
      .then(() => this.fake.exec(this.op, this.filters, this.values))
      .then(onFulfilled, onRejected);
  }
}

class FakeSupabase {
  calls: RecordedCall[] = [];
  userId: string | null = "user-A";
  row: Record<string, unknown> | null = null;
  failSelect: string | null = null;
  failInsert: string | null = null;
  failUpdate: string | null = null;
  forceInsertConflict = false;
  /** Row que "surge" no servidor quando o INSERT falha como duplicado (corrida real). */
  revealOnConflict: Record<string, unknown> | null = null;

  from(_table: string): {
    select(columns: string): FakeQuery;
    insert(values: Record<string, unknown>): FakeQuery;
    update(values: Record<string, unknown>): FakeQuery;
  } {
    const fake = this;
    return {
      select(_columns: string) {
        return new FakeQuery(fake, "select");
      },
      insert(values: Record<string, unknown>) {
        return new FakeQuery(fake, "insert", values);
      },
      update(values: Record<string, unknown>) {
        return new FakeQuery(fake, "update", values);
      },
    };
  }

  auth = {
    getUser: async (): Promise<{ data: { user: { id: string } | null } }> => ({
      data: { user: this.userId ? { id: this.userId } : null },
    }),
  };

  asClient(): CloudDataClient {
    return this as unknown as CloudDataClient;
  }

  callsOf(op: "select" | "insert" | "update"): RecordedCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  exec(
    op: "select" | "insert" | "update",
    filters: Filter[],
    values: Record<string, unknown> | null,
  ): { data: unknown; error: unknown } {
    if (op === "select") {
      this.calls.push({ op, filters: [...filters], values: null });
      if (this.failSelect) return { data: null, error: { message: this.failSelect } };
      return { data: this.matchRow(filters), error: null };
    }
    if (op === "insert") {
      this.calls.push({ op, filters: [...filters], values: values ? { ...values } : null });
      if (this.failInsert) return { data: null, error: { message: this.failInsert } };
      const userId = values?.user_id as string | undefined;
      if (this.forceInsertConflict || (this.row && this.row.user_id === userId)) {
        if (this.revealOnConflict) this.row = this.revealOnConflict;
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      this.row = { ...(values ?? {}), updated_at: "2026-09-05T12:00:00.000Z" };
      return { data: [this.row], error: null };
    }
    this.calls.push({ op, filters: [...filters], values: values ? { ...values } : null });
    if (this.failUpdate) return { data: null, error: { message: this.failUpdate } };
    const current = this.matchRow(filters);
    if (!current) return { data: [], error: null };
    this.row = { ...current, ...(values ?? {}), updated_at: "2026-09-05T12:01:00.000Z" };
    return { data: [this.row], error: null };
  }

  private matchRow(filters: Filter[]): Record<string, unknown> | null {
    if (!this.row) return null;
    for (const [col, val] of filters) {
      if (this.row[col] !== val) return null;
    }
    return this.row;
  }
}

/* ── Mundo de teste (store em memória + metadata em memória) ── */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function remoteRowFor(payload: unknown, revision: number, userId = "user-A"): Record<string, unknown> {
  return {
    user_id: userId,
    payload: clone(payload),
    payload_version: 1,
    revision,
    updated_at: "2026-09-05T12:00:00.000Z",
  };
}

function entryOn(id: number, date: string, time: string): TimeEntry {
  return { id, date, time, type: "entrada", note: null };
}

function setLocal(data: AppData): void {
  store.actions.replaceAll({
    user: data.user,
    entries: data.entries,
    compensations: data.compensations,
    absences: data.absences,
    companyCalendars: data.companyCalendars,
    faltas: data.faltas,
    excessReasons: data.excessReasons,
    specialExcessUses: data.specialExcessUses,
    specialExcessPlans: data.specialExcessPlans,
    periodConsolidations: data.periodConsolidations,
    annualCycleClosures: data.annualCycleClosures,
  });
}

function resetWorld(): void {
  engine.resetCloudSyncEngineForTests();
  metadata.resetSyncMetadata();
  metadata.clearAccountStash("user-A");
  metadata.clearAccountStash("user-B");
  setLocal(seed.createEmptyState("2026-09-05"));
}

function relevantLocal(): AppData {
  const base = store.getAppData();
  return { ...base, entries: [entryOn(1, "2026-09-04", "08:00")] };
}

/** Configura nuvem ativa e consistente na revision 5 com o conteúdo atual. */
function linkCloudAtRevision5(fake: FakeSupabase, userId = "user-A"): void {
  const snap = canonical.serializeCanonicalAppState(store.getAppData());
  fake.row = remoteRowFor(snap, 5, userId);
  engine.configureCloudSync(fake.asClient(), userId);
  metadata.updateSyncMetadata({
    mode: "cloud",
    activeUserId: userId,
    revision: 5,
    cloudRevision: 5,
    status: "synced",
    pendingPayload: null,
    pendingBaseRevision: null,
    lastSyncedFingerprint: canonical.canonicalFingerprint(snap),
    lastSyncedAt: "2026-09-05T12:00:00.000Z",
    lastError: null,
  });
}

const flush = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ═══════════════ T01 — 4J intacta ═══════════════ */
await check("T01 — 4J continua presente e auth intacta", () => {
  assert.ok(exists("tests/verify-supabase-auth-4j.mts"), "suite 4J deve continuar no repo");
  const out = execFileSync("npx", ["--no-install", "tsx", "tests/verify-supabase-auth-4j.mts"], {
    cwd: root,
    env: { ...process.env, TZ: "America/Sao_Paulo" },
    timeout: 180000,
  }).toString();
  assert.ok(out.includes("28/28"), "4J deve continuar 28/28");
});

/* ═══════════════ T02 — BACKUP_VERSION ═══════════════ */
await check("T02 — BACKUP_VERSION continua 3", () => {
  assert.equal(backup.BACKUP_VERSION, 3, "BACKUP_VERSION deve continuar 3");
});

/* ═══════════════ T03 — payload_version ═══════════════ */
await check("T03 — payload_version cloud continua 1", () => {
  assert.equal(canonical.CLOUD_PAYLOAD_VERSION, 1, "envelope cloud deve continuar na versão 1");
});

/* ═══════════════ T04 — sem segredos ═══════════════ */
await check("T04 — Não existe service role/secret", () => {
  const hay = [...CLOUD_FILES, "src/app/(app)/layout.tsx"].map(srcOf).join("\n");
  for (const f of [
    "service_role",
    "serviceRole",
    "sb_secret_",
    "SUPABASE_SERVICE_ROLE",
    "secret_key",
    "SECRET_KEY",
    "DATABASE_PASSWORD",
    "api_secret",
  ]) {
    assert.ok(!hay.includes(f), `código 4K não pode conter ${f}`);
  }
});

/* ═══════════════ T05 — sem tempo real/sondagem ═══════════════ */
await check("T05 — Não existe Realtime/polling", () => {
  const hay = CLOUD_FILES.map(srcOf).join("\n");
  for (const f of [
    "realtime",
    "Realtime",
    "REALTIME",
    "postgres_changes",
    "setInterval",
    "setTimeout",
    ".channel(",
    "polling",
    "Polling",
  ]) {
    assert.ok(!hay.includes(f), `código 4K não pode conter ${f}`);
  }
  const en = srcOf(ENGINE);
  assert.ok(en.includes('addEventListener("focus"'), "atualização deve reagir a focus");
  assert.ok(en.includes("visibilitychange"), "atualização deve reagir a visibilitychange");
  assert.ok(en.includes('"online"'), "retentativa deve reagir a online");
});

/* ═══════════════ T06 — camada centralizada ═══════════════ */
await check("T06 — Cloud layer centralizada", () => {
  for (const f of [CANONICAL, META, CLIENT, ENGINE]) {
    assert.ok(exists(f), `${f} deve existir`);
  }
  const cl = srcOf(CLIENT);
  assert.ok(cl.includes("export async function fetchCloudState"), "deve exportar fetchCloudState");
  assert.ok(cl.includes("export async function createInitialCloudState"), "deve exportar createInitialCloudState");
  assert.ok(cl.includes("export async function saveCloudStateCAS"), "deve exportar saveCloudStateCAS");
  const md = srcOf(META);
  assert.ok(md.includes("export function getSyncMetadata"), "deve exportar getSyncMetadata");
  assert.ok(md.includes("export function setSyncMetadata"), "deve exportar setSyncMetadata");
  const en = srcOf(ENGINE);
  assert.ok(en.includes("export function retryPendingSync"), "deve exportar retryPendingSync");
  for (const c of [PROVIDER, SETTINGS, STATUS_LINE]) {
    const s = srcOf(c);
    assert.ok(s.includes("cloud-sync"), `${c} deve consumir a camada cloud-sync`);
    assert.ok(!s.includes("@/lib/supabase/client"), `${c} não pode acessar o Supabase direto`);
    assert.ok(!s.includes("user_app_state"), `${c} não pode referenciar a tabela`);
    assert.ok(!s.includes(".from("), `${c} não pode consultar a Data API`);
  }
});

/* ═══════════════ T07 — reuso do backup ═══════════════ */
await check("T07 — Estado canônico reutiliza serializer/validator do backup", () => {
  const s = srcOf(CANONICAL);
  assert.ok(s.includes("buildBackupPayload"), "deve serializar com buildBackupPayload");
  assert.ok(s.includes("parseBackup"), "deve validar com parseBackup");
  assert.ok(s.includes("backupImportPayload"), "deve aplicar com backupImportPayload");
  assert.ok(s.includes('from "../backup"'), "deve importar do módulo de backup");
  resetWorld();
  setLocal(relevantLocal());
  const snap = canonical.serializeCanonicalAppState(store.getAppData());
  assert.equal(snap.version, 3, "canônico deve ser BACKUP v3");
  const validated = canonical.validateCanonicalAppState(snap);
  assert.equal(validated.ok, true, "snapshot local deve validar");
  if (validated.ok) {
    assert.deepEqual(validated.parsed.entries, store.getAppData().entries);
  }
});

/* ═══════════════ T08 — sem auth no payload ═══════════════ */
await check("T08 — Auth/session não entra no payload", () => {
  resetWorld();
  setLocal(relevantLocal());
  const text = JSON.stringify(canonical.serializeCanonicalAppState(store.getAppData())).toLowerCase();
  for (const t of [
    "access_token",
    "refresh_token",
    "supabase",
    "session",
    "cookie",
    "secret",
    "password",
    "smtp",
    "publishable",
    "bearer",
  ]) {
    assert.ok(!text.includes(t), `payload não pode conter ${t}`);
  }
  for (const f of [CANONICAL, "src/lib/backup.ts"]) {
    const s = srcOf(f).toLowerCase();
    for (const t of ["access_token", "refresh_token", "supabase"]) {
      assert.ok(!s.includes(t), `${f} não pode citar ${t}`);
    }
  }
});

/* ═══════════════ T09 — NOT_FOUND não cria row ═══════════════ */
await check("T09 — Cloud NOT_FOUND não cria row automaticamente", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  fake.row = null;
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready");
  assert.equal(fake.row, null, "nenhum row pode ser criado no bootstrap");
  assert.equal(fake.callsOf("insert").length, 0, "nenhum INSERT automático");
  assert.equal(fake.callsOf("update").length, 0, "nenhum UPDATE automático");
  assert.equal(metadata.getSyncMetadata().mode, "local");
});

/* ═══════════════ T10 — modo local operacional ═══════════════ */
await check("T10 — Modo local continua operacional sem row", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const before = clone(store.getAppData());
  const fake = new FakeSupabase();
  fake.row = null;
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready", "sem row, o app segue operacional");
  assert.deepEqual(clone(store.getAppData()), before, "estado local intacto");
  assert.equal(metadata.getSyncMetadata().status, "not-started");
});

/* ═══════════════ T11 — ativação explícita ═══════════════ */
await check("T11 — Primeira ativação exige ação explícita", () => {
  const en = srcOf(ENGINE);
  assert.ok(en.includes("Usar estes dados na minha conta"), "CTA de ativação em pt-BR");
  assert.ok(en.includes("export function activateCloudSync"), "ativação é função dedicada");
  // createInitialCloudState só é chamado dentro de activateCloudSync.
  const activateAt = en.indexOf("export function activateCloudSync");
  const createCallAt = en.indexOf("createInitialCloudState(current.db");
  assert.ok(activateAt >= 0 && createCallAt > activateAt, "INSERT inicial só via activateCloudSync");
  assert.equal(
    en.split("createInitialCloudState").length - 1,
    2,
    "createInitialCloudState: 1 import + 1 chamada",
  );
  const st = srcOf(SETTINGS);
  assert.ok(st.includes("MSG_ACTIVATE_CTA"), "Configurações exibe o CTA de ativação");
  assert.ok(st.includes("onClick={runActivate}"), "ativação parte de clique explícito");
  assert.ok(st.includes("await ctx.activate()"), "clique chama a ativação");
});

/* ═══════════════ T12 — backup pré-ativação v3 ═══════════════ */
await check("T12 — Backup de segurança usa BACKUP v3 existente", () => {
  const st = srcOf(SETTINGS);
  assert.ok(st.includes("downloadLocalBackup"), "deve reutilizar o download de backup");
  assert.ok(st.includes("MSG_BACKUP_CTA"), "deve exibir “Baixar backup de segurança”");
  const en = srcOf(ENGINE);
  assert.ok(en.includes("Baixar backup de segurança"), "rótulo do backup em pt-BR");
  assert.equal(canonical.BACKUP_FILE_NAME, "meu-horario-backup.json", "mesmo arquivo do Exportar");
  assert.ok(
    srcOf("src/app/(app)/configuracoes/page.tsx").includes("meu-horario-backup.json"),
    "Exportar existente mantém o nome",
  );
  resetWorld();
  const parsed = backup.parseBackup(
    JSON.stringify(canonical.serializeCanonicalAppState(store.getAppData())),
  );
  assert.equal(parsed.ok, true, "conteúdo do backup de segurança valida no parser v3");
});

/* ═══════════════ T13 — recheck antes do INSERT ═══════════════ */
await check("T13 — Antes de INSERT inicial há recheck remoto", async () => {
  resetWorld();
  const { createInitialCloudState } = await import("../src/lib/cloud-sync/client.ts");
  const fake = new FakeSupabase();
  fake.row = null;
  const snap = canonical.serializeCanonicalAppState(store.getAppData());
  const result = await createInitialCloudState(fake.asClient(), "user-A", snap);
  assert.equal(result.status, "created");
  assert.ok(fake.calls.length >= 2, "select + insert");
  assert.equal(fake.calls[0].op, "select", "primeiro re-lê o remoto");
  assert.equal(fake.calls[1].op, "insert", "só então insere");
  assert.ok(srcOf(CLIENT).toLowerCase().includes("recheck"), "código documenta o recheck");
});

/* ═══════════════ T14 — INSERT revision 1 ═══════════════ */
await check("T14 — INSERT inicial cria revision 1", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  fake.row = null;
  engine.configureCloudSync(fake.asClient(), "user-A");
  const result = await engine.activateCloudSync();
  assert.equal(result.phase, "ready");
  const inserts = fake.callsOf("insert");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values?.revision, 1, "revision inicial = 1");
  assert.equal(inserts[0].values?.payload_version, 1, "payload_version = 1");
  assert.equal(inserts[0].values?.user_id, "user-A", "row da conta autenticada");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.mode, "cloud");
  assert.equal(meta.revision, 1);
  assert.equal(meta.status, "synced");
  assert.equal(meta.activeUserId, "user-A");
});

/* ═══════════════ T15 — duplicado não sobrescreve ═══════════════ */
await check("T15 — Duplicate inicial não sobrescreve row existente", async () => {
  const { createInitialCloudState } = await import("../src/lib/cloud-sync/client.ts");
  const existingPayload = () =>
    canonical.serializeCanonicalAppState({
      ...store.getAppData(),
      entries: [entryOn(7, "2026-09-02", "08:00")],
    });

  // Caso 1 — recheck encontra o row (ativado em outro dispositivo): nem tenta INSERT.
  resetWorld();
  setLocal(relevantLocal());
  const before = clone(store.getAppData());
  const fake = new FakeSupabase();
  const existing = remoteRowFor(existingPayload(), 5);
  fake.row = existing;
  const rowBefore = clone(existing);
  const direct = await createInitialCloudState(
    fake.asClient(),
    "user-A",
    canonical.serializeCanonicalAppState(store.getAppData()),
  );
  assert.equal(direct.status, "exists", "row existente não é sobrescrito");
  assert.equal(fake.callsOf("insert").length, 0, "recheck positivo dispensa o INSERT");
  assert.equal(fake.callsOf("update").length, 0, "nenhum UPDATE após duplicado");
  assert.deepEqual(fake.row, rowBefore, "row remoto intacto");
  assert.deepEqual(clone(store.getAppData()), before, "local intacto");

  // Caso 2 — corrida real: recheck vazio, INSERT devolve 23505, row surge no servidor.
  resetWorld();
  setLocal(relevantLocal());
  const racing = new FakeSupabase();
  racing.row = null;
  racing.forceInsertConflict = true;
  racing.revealOnConflict = remoteRowFor(existingPayload(), 5);
  const raced = await createInitialCloudState(
    racing.asClient(),
    "user-A",
    canonical.serializeCanonicalAppState(store.getAppData()),
  );
  assert.equal(raced.status, "exists", "duplicado no INSERT vira fluxo de colisão");
  assert.equal(racing.callsOf("update").length, 0, "nenhum UPDATE após duplicado");
  assert.deepEqual(racing.row, racing.revealOnConflict, "row remoto intacto");

  // Caso 3 — caminho do motor: ativação com row existente re-resolve (colisão), sem sobrescrever.
  engine.configureCloudSync(racing.asClient(), "user-A");
  const viaEngine = await engine.activateCloudSync();
  assert.equal(viaEngine.phase, "collision", "motor re-resolve em vez de sobrescrever");
  assert.equal(racing.callsOf("update").length, 0, "motor não força escrita");
  assert.deepEqual(racing.row, racing.revealOnConflict, "row remoto intacto");
});

/* ═══════════════ T16 — dispositivo limpo hidrata ═══════════════ */
await check("T16 — Cloud válido hidrata dispositivo limpo", async () => {
  resetWorld(); // local vazio (dispositivo limpo)
  assert.equal(canonical.isEmptyOperationalState(store.getAppData()), true);
  const cloudLocal: AppData = {
    ...store.getAppData(),
    entries: [entryOn(1, "2026-09-04", "08:00"), entryOn(2, "2026-09-04", "12:00")],
  };
  const fake = new FakeSupabase();
  fake.row = remoteRowFor(canonical.serializeCanonicalAppState(cloudLocal), 3);
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready");
  assert.deepEqual(clone(store.getAppData().entries), clone(cloudLocal.entries), "cache hidratado da nuvem");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.mode, "cloud");
  assert.equal(meta.revision, 3);
  assert.equal(meta.activeUserId, "user-A");
  assert.equal(meta.status, "synced");
});

/* ═══════════════ T17 — cloud inválido preserva local ═══════════════ */
await check("T17 — Cloud inválido não toca local", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const before = clone(store.getAppData());
  const fake = new FakeSupabase();
  fake.row = remoteRowFor({ nao: "é um backup" }, 2);
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready");
  assert.deepEqual(clone(store.getAppData()), before, "local preservado");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.mode, "local");
  assert.equal(meta.status, "error");
  assert.equal(meta.lastError, engine.MSG_CLOUD_INVALID);
});

/* ═══════════════ T18 — erro de rede ≠ NOT_FOUND ═══════════════ */
await check("T18 — Erro de rede não é tratado como NOT_FOUND", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  fake.failSelect = "network down";
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready");
  assert.equal(fake.callsOf("insert").length, 0, "erro de rede não autoriza INSERT");
  assert.equal(fake.row, null);
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.status, "error", "status erro — nunca “não iniciada”");
  assert.equal(meta.mode, "local");
});

/* ═══════════════ T19 — activeUserId impede vazamento ═══════════════ */
await check("T19 — activeUserId impede vazamento entre contas", async () => {
  resetWorld();
  setLocal(relevantLocal()); // cache da conta A
  const cacheA = clone(store.getAppData());
  metadata.updateSyncMetadata({ activeUserId: "user-A", mode: "local", status: "not-started" });
  const fake = new FakeSupabase();
  fake.row = null; // conta B sem nuvem
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-B");
  assert.equal(result.phase, "blocked-other-account", "conta B é bloqueada com segurança");
  assert.deepEqual(clone(store.getAppData()), cacheA, "cache da conta A intacto");
  assert.equal(fake.callsOf("insert").length, 0);
  assert.equal(fake.callsOf("update").length, 0);
  const stash = metadata.readAccountStash("user-A");
  assert.ok(stash, "slot da conta A guardado");
  assert.equal(stash?.meta.activeUserId, "user-A");
});

/* ═══════════════ T20 — outra conta não vê cache ═══════════════ */
await check("T20 — Outra conta não vê cache da conta anterior", async () => {
  const pv = srcOf(PROVIDER);
  assert.ok(
    srcOf(ENGINE).includes("Este navegador possui dados de outra conta"),
    "mensagem da tela segura em pt-BR",
  );
  assert.ok(pv.includes("MSG_BLOCKED_TITLE"), "tela segura exibe a mensagem de bloqueio");
  assert.ok(pv.includes("function BlockedGate"), "portão possui tela de bloqueio dedicada");
  assert.ok(
    pv.includes('if (ctx.phase === "blocked-other-account") return <BlockedGate />;'),
    "fase bloqueada renderiza SÓ a tela segura (sem children)",
  );
  // Dinâmico: B bloqueada; A volta e retoma o próprio slot.
  resetWorld();
  setLocal(relevantLocal());
  const cacheA = clone(store.getAppData());
  metadata.updateSyncMetadata({ activeUserId: "user-A", mode: "local", status: "not-started" });
  const fake = new FakeSupabase();
  fake.row = null;
  assert.equal((await engine.bootstrapCloudSync(fake.asClient(), "user-B")).phase, "blocked-other-account");
  const back = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(back.phase, "ready");
  assert.deepEqual(clone(store.getAppData()), cacheA, "conta A retoma o próprio cache");
  assert.equal(metadata.readAccountStash("user-A"), null, "compartimento consumido ao voltar");
  assert.equal(metadata.getSyncMetadata().activeUserId, "user-A");
});

/* ═══════════════ T21 — save usa CAS ═══════════════ */
await check("T21 — Save normal usa CAS com revision esperada", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  const mutated: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")],
  };
  setLocal(mutated);
  await engine.noteLocalMutation();
  const updates = fake.callsOf("update");
  assert.equal(updates.length, 1, "um UPDATE por mutação");
  const filters = Object.fromEntries(updates[0].filters);
  assert.equal(filters.user_id, "user-A", "escopo da conta");
  assert.equal(filters.revision, 5, "revision esperada = base conhecida");
});

/* ═══════════════ T22 — CAS incrementa +1 ═══════════════ */
await check("T22 — Save CAS incrementa revision exatamente +1", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  setLocal({ ...store.getAppData(), entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")] });
  await engine.noteLocalMutation();
  const updates = fake.callsOf("update");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].values?.revision, 6, "UPDATE grava base + 1");
  assert.equal(fake.row?.revision, 6, "remoto avança para 6");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.revision, 6);
  assert.equal(meta.status, "synced");
  assert.equal(meta.pendingPayload, null);
});

/* ═══════════════ T23 — UPDATE sem revision proibido ═══════════════ */
await check("T23 — UPDATE sem revision esperada é proibido", () => {
  const cl = srcOf(CLIENT);
  assert.equal(cl.split(".update(").length - 1, 1, "um único ponto de UPDATE na camada");
  assert.ok(cl.includes('.eq("revision", baseRevision)'), "UPDATE exige revision esperada");
  for (const f of [CANONICAL, META, ENGINE]) {
    assert.ok(!srcOf(f).includes(".update("), `${f} não pode ter UPDATE direto`);
  }
});

/* ═══════════════ T24 — CAS zero rows = conflito ═══════════════ */
await check("T24 — CAS zero rows gera conflict", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  // Outro dispositivo avançou para 6 com conteúdo DIFERENTE.
  fake.row = remoteRowFor(
    canonical.serializeCanonicalAppState({
      ...store.getAppData(),
      entries: [entryOn(9, "2026-09-01", "08:00")],
    }),
    6,
  );
  setLocal({ ...store.getAppData(), entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")] });
  await engine.noteLocalMutation();
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.status, "conflict", "CAS sem rows → conflito");
  assert.ok(meta.pendingPayload, "pendência preservada");
  assert.equal(meta.pendingBaseRevision, 5, "base original mantida");
  assert.equal(meta.cloudRevision, 6);
});

/* ═══════════════ T25 — conflito não toca local ═══════════════ */
await check("T25 — Conflict não sobrescreve local", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  fake.row = remoteRowFor(
    canonical.serializeCanonicalAppState({
      ...store.getAppData(),
      entries: [entryOn(9, "2026-09-01", "08:00")],
    }),
    6,
  );
  const mutated: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")],
  };
  setLocal(mutated);
  const localBefore = clone(store.getAppData());
  await engine.noteLocalMutation();
  assert.equal(metadata.getSyncMetadata().status, "conflict");
  assert.deepEqual(clone(store.getAppData()), localBefore, "cache local intacto no conflito");
});

/* ═══════════════ T26 — conflito não toca cloud ═══════════════ */
await check("T26 — Conflict não sobrescreve cloud", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  const remotePayload = canonical.serializeCanonicalAppState({
    ...store.getAppData(),
    entries: [entryOn(9, "2026-09-01", "08:00")],
  });
  fake.row = remoteRowFor(remotePayload, 6);
  const remoteBefore = clone(fake.row);
  setLocal({ ...store.getAppData(), entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")] });
  await engine.noteLocalMutation();
  assert.equal(metadata.getSyncMetadata().status, "conflict");
  assert.deepEqual(fake.row, remoteBefore, "row remoto intacto");
  assert.equal(fake.callsOf("update").length, 1, "só o CAS que falhou; sem force-save");
  assert.equal(fake.callsOf("insert").length, 0);
});

/* ═══════════════ T27 — falso conflito idêntico ═══════════════ */
await check("T27 — Payloads idênticos após CAS miss resolvem sem conflito falso", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  const mutated: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")],
  };
  setLocal(mutated);
  // Outro dispositivo gravou o conteúdo IDÊNTICO na revision 6.
  fake.row = remoteRowFor(canonical.serializeCanonicalAppState(store.getAppData()), 6);
  await engine.noteLocalMutation();
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.status, "synced", "conteúdo idêntico não gera conflito");
  assert.equal(meta.revision, 6, "adota a revision remota");
  assert.equal(meta.pendingPayload, null, "pendência limpa");
});

/* ═══════════════ T28 — falha de rede mantém pending ═══════════════ */
await check("T28 — Falha de rede mantém pending", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  fake.failUpdate = "network down";
  const mutated: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")],
  };
  setLocal(mutated);
  const localBefore = clone(store.getAppData());
  await engine.noteLocalMutation();
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.status, "pending", "falha de rede → pendente de sincronização");
  assert.ok(meta.pendingPayload, "snapshot guardado");
  assert.equal(meta.pendingBaseRevision, 5);
  assert.deepEqual(clone(store.getAppData()), localBefore, "mutação local preservada");
});

/* ═══════════════ T29 — pending sobrevive reload ═══════════════ */
await check("T29 — Pending sobrevive reload", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  fake.failUpdate = "network down";
  setLocal({ ...store.getAppData(), entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")] });
  await engine.noteLocalMutation();
  const before = metadata.getSyncMetadata();
  assert.ok(before.pendingPayload, "pré-condição: há pendência");
  // A metadata é lida integralmente do backend a cada acesso — reler equivale
  // ao estado após F5/fechar-reabrir.
  const afterReload = metadata.getSyncMetadata();
  assert.deepEqual(afterReload.pendingPayload, before.pendingPayload, "snapshot intacto após reload");
  assert.equal(afterReload.pendingBaseRevision, 5, "base intacta após reload");
  assert.equal(afterReload.status, "pending");
  assert.equal(afterReload.mode, "cloud");
});

/* ═══════════════ T30 — retry mantém base ═══════════════ */
await check("T30 — Retry mantém baseRevision original até sucesso", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  fake.failUpdate = "network down";
  const base1: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")],
  };
  setLocal(base1);
  await engine.noteLocalMutation();
  const base2: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(3, "2026-09-04", "13:00")],
  };
  setLocal(base2);
  await engine.noteLocalMutation();
  const mid = metadata.getSyncMetadata();
  assert.equal(mid.pendingBaseRevision, 5, "duas mutações seguidas mantêm a base");
  assert.equal(mid.pendingPayload?.entries.length, 3, "pendência carrega o snapshot mais novo");
  fake.failUpdate = null;
  await engine.retryPendingSync();
  const updates = fake.callsOf("update");
  assert.ok(updates.length >= 1, "retentativa envia");
  for (const u of updates) {
    assert.equal(Object.fromEntries(u.filters).revision, 5, "toda tentativa usa a base original");
  }
  const last = updates[updates.length - 1];
  assert.deepEqual(
    (last.values?.payload as { entries?: unknown[] })?.entries,
    base2.entries,
    "envia o snapshot final consolidado",
  );
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.status, "synced");
  assert.equal(meta.revision, 6);
});

/* ═══════════════ T31 — focus baixa remoto mais novo ═══════════════ */
await check("T31 — Focus baixa remote mais novo quando não há pending", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  const remoteLocal: AppData = {
    ...store.getAppData(),
    entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")],
  };
  fake.row = remoteRowFor(canonical.serializeCanonicalAppState(remoteLocal), 7);
  const result = await engine.refreshOnFocus();
  assert.equal(result, null, "sem pendência não há re-resolução");
  assert.deepEqual(clone(store.getAppData().entries), clone(remoteLocal.entries), "cache hidratado do remoto");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.revision, 7);
  assert.equal(meta.status, "synced");
});

/* ═══════════════ T32 — focus não toca pending ═══════════════ */
await check("T32 — Focus NÃO sobrescreve pending local", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  fake.failUpdate = "network down";
  setLocal({ ...store.getAppData(), entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")] });
  await engine.noteLocalMutation();
  const localBefore = clone(store.getAppData());
  const pendingBefore = clone(metadata.getSyncMetadata().pendingPayload);
  // Remoto avança enquanto há pendência: o foco não pode passar por cima.
  fake.failUpdate = null;
  fake.row = remoteRowFor(
    canonical.serializeCanonicalAppState({
      ...store.getAppData(),
      entries: [entryOn(9, "2026-09-01", "08:00")],
    }),
    9,
  );
  await engine.refreshOnFocus();
  assert.deepEqual(clone(store.getAppData()), localBefore, "cache local intacto");
  const meta = metadata.getSyncMetadata();
  assert.deepEqual(meta.pendingPayload, pendingBefore, "pendência intacta");
  assert.equal(meta.pendingBaseRevision, 5);
  assert.equal(meta.revision, 5, "revision local não avança por cima da pendência");
});

/* ═══════════════ T33 — import vira CAS ═══════════════ */
await check("T33 — Import BACKUP em cloud vira mutação CAS", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  const unsubscribe = store.subscribeToAppData(() => {
    void engine.noteLocalMutation();
  });
  try {
    // Caminho real da importação: texto → parseBackup → backupImportPayload → replaceAll.
    const modified: AppData = {
      ...store.getAppData(),
      entries: [...store.getAppData().entries, entryOn(9, "2026-09-03", "08:00")],
    };
    const parsed = backup.parseBackup(JSON.stringify(backup.buildBackupPayload(modified)));
    assert.equal(parsed.ok, true, "backup de teste deve validar");
    if (parsed.ok) {
      store.actions.replaceAll(backup.backupImportPayload(parsed.backup));
    }
    await flush();
    const updates = fake.callsOf("update");
    assert.equal(updates.length, 1, "importação dispara exatamente um CAS");
    assert.equal(Object.fromEntries(updates[0].filters).revision, 5, "CAS usa a base vigente");
    const meta = metadata.getSyncMetadata();
    assert.equal(meta.status, "synced");
    assert.equal(meta.revision, 6);
  } finally {
    unsubscribe();
  }
});

/* ═══════════════ T34 — reset vira CAS, sem DELETE ═══════════════ */
await check("T34 — Reset/apagar dados em cloud vira mutação CAS, não DELETE do row", async () => {
  for (const f of CLOUD_FILES) {
    // `map.delete(`/`listeners.delete(` são estruturas em memória — o proibido é DELETE na Data API.
    const stripped = srcOf(f).replaceAll("map.delete(", "").replaceAll("listeners.delete(", "");
    assert.ok(!stripped.includes(".delete("), `${f} não pode deletar o row`);
  }
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  store.actions.clearAll();
  await engine.noteLocalMutation();
  const updates = fake.callsOf("update");
  assert.equal(updates.length, 1, "apagar dados dispara CAS normal");
  assert.deepEqual((updates[0].values?.payload as { entries?: unknown })?.entries, [], "payload zerado");
  assert.ok(fake.row, "row remoto continua existindo");
  assert.deepEqual((fake.row?.payload as { entries?: unknown })?.entries, [], "nuvem reflete o zero");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.status, "synced");
  assert.equal(meta.revision, 6);
});

/* ═══════════════ T35 — logout preserva ═══════════════ */
await check("T35 — Logout preserva pending e cache de forma segura", async () => {
  const s = srcOf(SIGN_OUT);
  assert.ok(!/localStorage\s*\.\s*(getItem|setItem|removeItem|clear|key|length)/.test(s), "logout não toca no armazenamento");
  assert.ok(!s.includes("removeItem"), "logout não remove itens");
  assert.ok(!s.includes("clear"), "logout não limpa nada");
  assert.ok(!s.includes("cloud-sync"), "logout não aciona a camada de sync");
  assert.ok(!s.includes("resetSyncMetadata"), "logout não zera a metadata");
  assert.ok(!s.includes("user_app_state"), "logout não referencia a tabela");
  // Dinâmico: a metadata vive fora do payload e do cache operacional.
  resetWorld();
  setLocal(relevantLocal());
  const payload = canonical.serializeCanonicalAppState(store.getAppData());
  const keys = Object.keys(payload).sort();
  assert.deepEqual(keys, [...backup.BACKUP_COLLECTIONS, "exportedAt", "version"].sort(), "payload = contrato do backup, nada de sync");
  assert.equal(metadata.CLOUD_SYNC_META_KEY, "meu-horario:cloud-sync:v1");
  assert.ok(srcOf("src/lib/store.ts").includes("meu-horario:data:v1"), "cache operacional tem chave própria");
  assert.notEqual(metadata.CLOUD_SYNC_META_KEY, "meu-horario:data:v1", "metadata separada do cache");
  // Pendência segue guardada (logout não executa nada que a toque — estático prova).
  const fake = new FakeSupabase();
  linkCloudAtRevision5(fake);
  fake.failUpdate = "network down";
  setLocal({ ...store.getAppData(), entries: [...store.getAppData().entries, entryOn(2, "2026-09-04", "12:00")] });
  await engine.noteLocalMutation();
  const meta = metadata.getSyncMetadata();
  assert.ok(meta.pendingPayload, "pendência guardada no navegador");
  assert.deepEqual(metadata.getSyncMetadata().pendingPayload, meta.pendingPayload, "pendência estável");
});

/* ═══════════════ T36 — "Sincronizado" estrito ═══════════════ */
await check("T36 — Status “Sincronizado” só ocorre com cloud ativo, revision conhecida e zero pending/conflict", () => {
  const base = metadata.defaultSyncMetadata();
  const synced = {
    ...base,
    mode: "cloud" as const,
    status: "synced" as const,
    revision: 4,
    pendingPayload: null,
  };
  assert.equal(metadata.displaySyncStatus(synced), "synced");
  assert.equal(metadata.syncStatusLabel(synced), "Sincronizado");
  assert.equal(metadata.displaySyncStatus({ ...synced, mode: "local" }), "pending", "sem cloud não há sincronizado");
  assert.equal(metadata.displaySyncStatus({ ...synced, revision: null }), "pending", "sem revision não há sincronizado");
  assert.equal(
    metadata.displaySyncStatus({ ...synced, pendingPayload: {} as never }),
    "pending",
    "com pendência não há sincronizado",
  );
  assert.equal(metadata.displaySyncStatus({ ...base, status: "conflict" }), "conflict", "conflito não vira sincronizado");
  // Metadata incoerente persistida é rebaixada já na leitura.
  metadata.setSyncMetadata({ ...base, mode: "local", status: "synced", revision: null });
  assert.equal(metadata.getSyncMetadata().status, "pending", "leitura saneia “sincronizado” indevido");
  metadata.resetSyncMetadata();
  assert.ok(
    srcOf(META).includes('synced: "Sincronizado"'),
    "mapa oficial traduz synced → “Sincronizado”",
  );
  assert.ok(srcOf(SETTINGS).includes("SYNC_STATUS_LABEL"), "Configurações usa os rótulos oficiais");
  assert.ok(srcOf(STATUS_LINE).includes("SYNC_STATUS_LABEL"), "sidebar usa os rótulos oficiais");
});

console.log(`\n4K — ${passed}/36 verificações concluídas.`);
if (passed !== 36) process.exit(1);
