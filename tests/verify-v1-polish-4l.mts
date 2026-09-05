/**
 * VERIFICAÇÃO — ETAPA 4L: ACABAMENTO FINAL DA V1.0.
 *
 * Escopo FECHADO (UX / onboarding / acabamento; NENHUM motor financeiro,
 * formato de backup, schema ou motor de sincronização alterado):
 *   - primeiro uso sem dado pessoal fictício; onboarding derivado do estado
 *     canônico (sem novo BACKUP_VERSION);
 *   - ativação automática da nuvem SOMENTE quando comprovadamente segura;
 *   - dados legados não vinculados continuam exigindo decisão explícita;
 *   - múltiplas contas no mesmo navegador com isolamento total (stash);
 *   - cartão único "Dados e sincronização", backup único, textos dinâmicos;
 *   - favicon do App Router, sidebar sem truncamento, mobile.
 *
 * O motor 4K é PRESERVADO: CAS por revision, pending, stash, payload_version 1
 * e BACKUP_VERSION 3 continuam intocados (T01/T02/T03/T24/T32).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-v1-polish-4l.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
const onboarding = await import("../src/lib/onboarding.ts");
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
const ONBOARDING_UI = "src/components/onboarding-gate.tsx";
const CONFIG = "src/app/(app)/configuracoes/page.tsx";
const CLOUD_FILES = [CANONICAL, META, CLIENT, ENGINE, PROVIDER, SETTINGS, STATUS_LINE];

/* ── Supabase falso em memória (mesmo formato da 4K; nunca toca a rede) ── */

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
  email: string | null = "vinicius@exemplo.com";
  /** Rows por conta: cada conta enxerga SOMENTE o próprio row (como o RLS). */
  rows = new Map<string, Record<string, unknown>>();
  failSelect: string | null = null;

  from(_table: string) {
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
    getUser: async (): Promise<{ data: { user: { id: string; email?: string | null } | null } }> => ({
      data: { user: this.userId ? { id: this.userId, email: this.email } : null },
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
    this.calls.push({ op, filters: [...filters], values: values ? { ...values } : null });
    if (op === "select") {
      if (this.failSelect) return { data: null, error: { message: this.failSelect } };
      return { data: this.matchRow(filters), error: null };
    }
    if (op === "insert") {
      const userId = String(values?.user_id ?? "");
      if (this.rows.has(userId)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      this.rows.set(userId, { ...(values ?? {}), updated_at: "2026-09-05T12:00:00.000Z" });
      return { data: [this.rows.get(userId)], error: null };
    }
    const current = this.matchRow(filters);
    if (!current) return { data: [], error: null };
    const userId = String(current.user_id);
    const next = { ...current, ...(values ?? {}), updated_at: "2026-09-05T12:01:00.000Z" };
    this.rows.set(userId, next);
    return { data: [next], error: null };
  }

  private matchRow(filters: Filter[]): Record<string, unknown> | null {
    const userId = filters.find(([c]) => c === "user_id")?.[1];
    const row = typeof userId === "string" ? this.rows.get(userId) : undefined;
    if (!row) return null;
    for (const [col, val] of filters) {
      if (row[col] !== val) return null;
    }
    return row;
  }
}

/* ── Mundo de teste ── */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const TODAY = "2026-09-05";

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
  setLocal(seed.createEmptyState(TODAY));
}

/** Estado local com conteúdo real (dados legados do dispositivo). */
function relevantLocal(): AppData {
  const base = store.getAppData();
  return { ...base, entries: [entryOn(1, "2026-09-04", "08:00")] };
}

function remoteRowFor(payload: unknown, revision: number, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    payload: clone(payload),
    payload_version: 1,
    revision,
    updated_at: "2026-09-05T12:00:00.000Z",
  };
}

/* ═══════════════ T01 — checkpoint 4K presente ═══════════════ */
await check("T01 — Checkpoint 4K continua presente e verde (36/36)", () => {
  assert.ok(exists("tests/verify-cloud-sync-4k.mts"), "suite 4K deve continuar no repo");
  const out = execFileSync("npx", ["--no-install", "tsx", "tests/verify-cloud-sync-4k.mts"], {
    cwd: root,
    env: { ...process.env, TZ: "America/Sao_Paulo" },
    timeout: 300000,
  }).toString();
  assert.ok(out.includes("36/36"), "4K deve continuar 36/36");
});

/* ═══════════════ T02 — BACKUP_VERSION ═══════════════ */
await check("T02 — BACKUP_VERSION continua 3", () => {
  assert.equal(backup.BACKUP_VERSION, 3, "BACKUP_VERSION deve continuar 3");
  assert.equal(canonical.serializeCanonicalAppState(store.getAppData()).version, 3);
  // O onboarding NÃO introduziu campo persistido novo: é derivado.
  const onb = srcOf("src/lib/onboarding.ts");
  assert.ok(!onb.includes('from "./backup"'), "onboarding não depende do formato do backup");
  assert.ok(!onb.includes("onboardingCompleted"), "nenhum campo persistido novo");
  assert.ok(onb.includes("export function isOnboardingComplete"), "conclusão é derivada");
});

/* ═══════════════ T03 — payload_version ═══════════════ */
await check("T03 — payload_version cloud continua 1", () => {
  assert.equal(canonical.CLOUD_PAYLOAD_VERSION, 1);
  assert.ok(srcOf(CLIENT).includes("payload_version: CLOUD_PAYLOAD_VERSION"));
});

/* ═══════════════ T04 — nenhuma migration nova ═══════════════ */
await check("T04 — Nenhuma migration nova / nenhum SQL executado", () => {
  const migrations = readdirSync(join(root, "supabase/migrations")).sort();
  assert.deepEqual(migrations, ["20260905000000_4j_user_app_state.sql"], "somente a migration 4J");
  const files = [...CLOUD_FILES, CONFIG, ONBOARDING_UI, "src/lib/onboarding.ts"];
  for (const f of files) {
    const s = srcOf(f).toLowerCase();
    for (const t of ["create table", "alter table", "create policy", "create function", "create trigger", "rpc("]) {
      assert.ok(!s.includes(t), `${f} não pode conter ${t}`);
    }
  }
});

/* ═══════════════ T05 — sem Realtime/polling/service worker ═══════════════ */
await check("T05 — Nenhum Realtime, polling ou service worker", () => {
  const files = [...CLOUD_FILES, ONBOARDING_UI, "src/lib/onboarding.ts", "src/app/layout.tsx"];
  const hay = files.map(srcOf).join("\n");
  for (const t of [
    "realtime",
    "Realtime",
    "postgres_changes",
    ".channel(",
    "setInterval",
    "serviceWorker",
    "service-worker",
    "workbox",
    "manifest.json",
  ]) {
    assert.ok(!hay.includes(t), `código 4L não pode conter ${t}`);
  }
  assert.ok(!exists("public/sw.js"), "nenhum service worker publicado");
  assert.ok(!exists("public/manifest.json"), "nenhum manifesto PWA");
  // Nenhum segredo/serviço privilegiado no frontend (Grupo D).
  for (const t of ["service_role", "serviceRole", "SUPABASE_SERVICE_ROLE", "sb_secret_"]) {
    assert.ok(!hay.includes(t), `frontend não pode conter ${t}`);
  }
  // Invariantes 4K vivas no motor (Grupo A/D).
  const en = srcOf(ENGINE);
  for (const inv of [
    "pendingBaseRevision",
    "pendingPayload",
    "activeUserId",
    "stashAccountSlot",
    "readAccountStash",
    'addEventListener("focus"',
    "visibilitychange",
    '"online"',
  ]) {
    assert.ok(en.includes(inv), `invariante 4K preservada: ${inv}`);
  }
});

/* ═══════════════ T06 — sem perfil fictício em conta nova ═══════════════ */
await check("T06 — Conta nova não recebe perfil fictício", () => {
  const empty = seed.createEmptyState(TODAY);
  assert.equal(empty.user.name, "", "sem nome fictício");
  assert.equal(empty.user.email, "", "sem e-mail fictício");
  assert.equal(empty.user.birthDate, null, "nascimento NUNCA é inventado");
  assert.equal(seed.EMPTY_USER.name, "");
  assert.equal(seed.EMPTY_USER.email, "");
  assert.equal(seed.EMPTY_USER.birthDate, null);
  const text = JSON.stringify(empty);
  for (const t of ["Maria Helena", "meu@horario.com", "1989-08-23", "Alex Santos", "voce@exemplo.com"]) {
    assert.ok(!text.includes(t), `estado inicial não pode conter ${t}`);
  }
  // Reload de uma instalação nova continua sem identidade fictícia.
  const again = store.hydrateAppData(JSON.stringify(empty), TODAY);
  assert.equal(again.user.name, "");
  assert.equal(again.user.email, "");
});

/* ═══════════════ T07 — e-mail deriva da auth ═══════════════ */
await check("T07 — E-mail de conta nova deriva da conta autenticada", async () => {
  assert.ok(
    srcOf(CLIENT).includes("export async function getAuthenticatedUserEmail"),
    "camada cloud expõe o e-mail da sessão",
  );
  const { getAuthenticatedUserEmail } = await import("../src/lib/cloud-sync/client.ts");
  const fake = new FakeSupabase();
  fake.email = "vinicius@exemplo.com";
  assert.equal(await getAuthenticatedUserEmail(fake.asClient()), "vinicius@exemplo.com");
  fake.email = null;
  assert.equal(await getAuthenticatedUserEmail(fake.asClient()), null, "sem e-mail → null (nada inventado)");
  const pv = srcOf(PROVIDER);
  assert.ok(pv.includes("getAuthenticatedUserEmail"), "provedor resolve o e-mail da conta");
  const ui = srcOf(ONBOARDING_UI);
  assert.ok(ui.includes("accountEmail"), "onboarding usa o e-mail da conta autenticada");
  assert.ok(ui.includes("E-mail da conta"), "campo informativo do e-mail da conta");
});

/* ═══════════════ T08 — jornada genérica sem dado pessoal ═══════════════ */
await check("T08 — Jornada genérica existe como configuração inicial editável", () => {
  const u = seed.createEmptyState(TODAY).user;
  assert.equal(u.workStart, "08:00");
  assert.equal(u.workEnd, "17:00");
  assert.equal(u.lunchStart, "12:00");
  assert.equal(u.lunchEnd, "13:00");
  assert.equal(u.maxDailyMinutes, 600, "teto de 10h/dia");
  assert.equal(u.autoDeductLunch, true);
  // Base diária de 8h derivada da jornada padrão.
  assert.equal(seed.DEFAULT_WORK_SETTINGS.maxDailyMinutes, 600);
  // Nada disso é dado pessoal.
  assert.equal(u.name, "");
  assert.equal(u.birthDate, null);
  const ui = srcOf(ONBOARDING_UI);
  for (const label of ["Início da jornada", "Fim da jornada", "Início do almoço", "Fim do almoço"]) {
    assert.ok(ui.includes(label), `onboarding permite editar: ${label}`);
  }
  assert.ok(ui.includes("Data de início do controle"), "início do controle é campo do onboarding");
  // Nascimento: campo OPCIONAL, jamais preenchido automaticamente.
  assert.ok(ui.includes("Data de nascimento (opcional)"), "nascimento é opcional no onboarding");
  const draft = {
    name: "Vinicius",
    email: "vinicius@exemplo.com",
    workStart: "08:00",
    workEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    controlStartDate: "2026-09-01",
    birthDate: "",
  };
  assert.equal(onboarding.validateOnboardingDraft(draft), null, "nascimento vazio é válido");
  assert.equal(onboarding.onboardingUserPatch(draft).birthDate, null, "vazio nunca vira data falsa");
  assert.equal(
    onboarding.onboardingUserPatch({ ...draft, birthDate: "1990-02-03" }).birthDate,
    "1990-02-03",
    "quando informado, o nascimento é respeitado",
  );
  assert.equal(
    onboarding.validateOnboardingDraft({ ...draft, name: "V" }),
    "Informe seu nome.",
    "nome é obrigatório",
  );
  // O onboarding só aparece em conta realmente nova e vazia.
  const empty = seed.createEmptyState(TODAY);
  assert.equal(onboarding.shouldShowOnboarding(empty), true);
  assert.equal(
    onboarding.shouldShowOnboarding({ ...empty, entries: [entryOn(1, "2026-09-04", "08:00")] }),
    false,
    "com dados operacionais o app NUNCA interrompe o uso",
  );
});

/* ═══════════════ T09 — conta nova + local vazio ativa sozinha ═══════════════ */
await check("T09 — Conta nova com dispositivo vazio ativa a nuvem automaticamente", async () => {
  resetWorld();
  assert.equal(canonical.isEmptyOperationalState(store.getAppData()), true, "pré-condição: vazio");
  const fake = new FakeSupabase();
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready", "app abre direto, sem tela de decisão");
  assert.equal(fake.callsOf("insert").length, 1, "estado inicial criado automaticamente");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.mode, "cloud");
  assert.equal(meta.status, "synced");
  assert.equal(meta.activeUserId, "user-A");
  // O CTA manual não é necessário nesse cenário.
  assert.equal(metadata.displaySyncStatus(meta), "synced", "não fica “não iniciada”");
});

/* ═══════════════ T10 — autoativação cria revision 1 ═══════════════ */
await check("T10 — Autoativação inicial cria revision 1 (mesmo caminho da 4K)", async () => {
  resetWorld();
  const fake = new FakeSupabase();
  await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  const inserts = fake.callsOf("insert");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values?.revision, 1, "revision inicial = 1");
  assert.equal(inserts[0].values?.payload_version, 1);
  assert.equal(inserts[0].values?.user_id, "user-A");
  assert.equal(metadata.getSyncMetadata().revision, 1);
  // O INSERT continua saindo exclusivamente de activateCloudSync (4K).
  const en = srcOf(ENGINE);
  assert.equal(en.split("createInitialCloudState").length - 1, 2, "1 import + 1 chamada");
});

/* ═══════════════ T11 — dados legados NÃO sobem sozinhos ═══════════════ */
await check("T11 — Conta nova com dados legados relevantes não faz upload automático", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const before = clone(store.getAppData());
  const fake = new FakeSupabase();
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready", "o app continua utilizável");
  assert.equal(fake.callsOf("insert").length, 0, "NENHUM envio automático");
  assert.equal(fake.callsOf("update").length, 0);
  assert.equal(fake.rows.size, 0, "nuvem continua sem row");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.mode, "local");
  assert.equal(meta.status, "not-started");
  assert.deepEqual(clone(store.getAppData()), before, "dados locais intactos");
});

/* ═══════════════ T12 — confirmação explícita dos dados legados ═══════════════ */
await check("T12 — Dados legados oferecem confirmação explícita", () => {
  const en = srcOf(ENGINE);
  assert.equal(engine.MSG_LEGACY_TITLE, "Encontramos dados neste dispositivo.");
  assert.equal(
    engine.MSG_LEGACY_EXPLAIN,
    "Você pode vinculá-los à sua conta para acessar em outros dispositivos.",
  );
  assert.equal(engine.MSG_LEGACY_LINK_CTA, "Vincular estes dados à minha conta");
  assert.equal(engine.MSG_LEGACY_DISCARD_CTA, "Começar esta conta sem esses dados");
  assert.ok(en.includes("export function startFreshForAccount"), "opção segura de recomeço");
  const st = srcOf(SETTINGS);
  assert.ok(st.includes("MSG_LEGACY_TITLE"), "cartão exibe o aviso");
  assert.ok(st.includes("MSG_LEGACY_LINK_CTA"), "cartão exibe a vinculação explícita");
  assert.ok(st.includes("onClick={runActivate}"), "vinculação parte de clique explícito");
  assert.ok(st.includes("await ctx.activate()"), "clique chama a ativação (CAS/INSERT da 4K)");
});

/* ═══════════════ T13 — backup antes de vincular ═══════════════ */
await check("T13 — Dados legados oferecem backup antes de vincular", () => {
  const st = srcOf(SETTINGS);
  assert.ok(st.includes("downloadLocalBackup"), "botão de backup no mesmo bloco");
  assert.ok(st.includes("MSG_BACKUP_JSON_CTA"), "usa o rótulo único de backup");
  assert.equal(engine.MSG_BACKUP_JSON_CTA, "Baixar backup (JSON)");
  assert.equal(canonical.BACKUP_FILE_NAME, "meu-horario-backup.json", "mesmo arquivo do Exportar");
  resetWorld();
  setLocal(relevantLocal());
  const parsed = backup.parseBackup(
    JSON.stringify(canonical.serializeCanonicalAppState(store.getAppData())),
  );
  assert.equal(parsed.ok, true, "o backup oferecido é o BACKUP v3 válido");
});

/* ═══════════════ T14 — cloud existente hidrata automaticamente ═══════════════ */
await check("T14 — Conta com cloud existente hidrata automaticamente", async () => {
  resetWorld();
  const cloudState: AppData = {
    ...store.getAppData(),
    entries: [entryOn(1, "2026-09-04", "08:00"), entryOn(2, "2026-09-04", "12:00")],
  };
  const fake = new FakeSupabase();
  fake.rows.set("user-A", remoteRowFor(canonical.serializeCanonicalAppState(cloudState), 3, "user-A"));
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(result.phase, "ready", "sem botão de ativação");
  assert.deepEqual(clone(store.getAppData().entries), clone(cloudState.entries), "nuvem carregada");
  const meta = metadata.getSyncMetadata();
  assert.equal(meta.mode, "cloud");
  assert.equal(meta.revision, 3);
  assert.equal(meta.status, "synced");
  assert.equal(fake.callsOf("insert").length, 0, "nada é recriado");
});

/* ═══════════════ T15 — conta B não vê cache de A ═══════════════ */
await check("T15 — Conta B nunca vê o cache da conta A", async () => {
  resetWorld();
  // A usa o navegador com nuvem própria ativa.
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  fake.rows.set(
    "user-A",
    remoteRowFor(canonical.serializeCanonicalAppState(store.getAppData()), 4, "user-A"),
  );
  await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  const cacheA = clone(store.getAppData());
  assert.equal(metadata.getSyncMetadata().activeUserId, "user-A");

  // B entra no MESMO navegador.
  const resultB = await engine.bootstrapCloudSync(fake.asClient(), "user-B");
  assert.notEqual(resultB.phase, "collision", "B não decide sobre dados alheios");
  const visible = clone(store.getAppData());
  assert.notDeepEqual(visible.entries, cacheA.entries, "nenhum frame mostra os dados de A");
  assert.deepEqual(visible.entries, [], "B começa vazia");
  assert.equal(metadata.getSyncMetadata().activeUserId, "user-B");
  // O slot de A ficou guardado, não apagado.
  const stashA = metadata.readAccountStash("user-A");
  assert.ok(stashA, "slot da conta A preservado");
  assert.equal(stashA?.meta.activeUserId, "user-A");
});

/* ═══════════════ T16 — B nova começa em slot vazio isolado ═══════════════ */
await check("T16 — Conta B nova começa em ambiente vazio e isolado", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  fake.rows.set(
    "user-A",
    remoteRowFor(canonical.serializeCanonicalAppState(store.getAppData()), 4, "user-A"),
  );
  await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-B");
  assert.equal(result.phase, "ready", "B não fica em beco sem saída");
  assert.equal(canonical.isEmptyOperationalState(store.getAppData()), true, "ambiente vazio");
  // Cenário A aplicado à conta B: nuvem própria criada em revision 1.
  const rowB = fake.rows.get("user-B");
  assert.ok(rowB, "B ganhou o próprio estado na nuvem");
  assert.equal(rowB?.revision, 1);
  assert.equal(rowB?.user_id, "user-B");
  // O row de A continua exatamente onde estava.
  assert.equal(fake.rows.get("user-A")?.revision, 4, "nuvem da conta A intocada");
});

/* ═══════════════ T17 — retorno de A restaura o slot A ═══════════════ */
await check("T17 — Retorno da conta A restaura o compartimento de A", async () => {
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  fake.rows.set(
    "user-A",
    remoteRowFor(canonical.serializeCanonicalAppState(store.getAppData()), 4, "user-A"),
  );
  await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  const cacheA = clone(store.getAppData());
  await engine.bootstrapCloudSync(fake.asClient(), "user-B");
  assert.deepEqual(store.getAppData().entries, [], "B isolada");

  const back = await engine.bootstrapCloudSync(fake.asClient(), "user-A");
  assert.equal(back.phase, "ready");
  assert.deepEqual(clone(store.getAppData().entries), cacheA.entries, "A retoma o próprio conteúdo");
  assert.equal(metadata.getSyncMetadata().activeUserId, "user-A");
  // E o slot de B fica guardado para quando B voltar.
  assert.ok(metadata.readAccountStash("user-B"), "slot da conta B preservado");
});

/* ═══════════════ T18 — dados ambíguos continuam protegidos ═══════════════ */
await check("T18 — Dados legados não vinculados continuam protegidos na troca de conta", async () => {
  resetWorld();
  // A usou o navegador SEM nunca enviar nada: propriedade ambígua.
  setLocal(relevantLocal());
  const cacheA = clone(store.getAppData());
  metadata.updateSyncMetadata({ activeUserId: "user-A", mode: "local", status: "not-started" });
  const fake = new FakeSupabase();
  const result = await engine.bootstrapCloudSync(fake.asClient(), "user-B");
  assert.equal(result.phase, "blocked-other-account", "tela segura preservada (4K)");
  assert.deepEqual(clone(store.getAppData()), cacheA, "nada foi apagado nem exibido a B");
  assert.equal(fake.callsOf("insert").length, 0, "nenhum envio de dados alheios");
  assert.equal(fake.rows.size, 0);
  assert.ok(metadata.readAccountStash("user-A"), "slot de A guardado mesmo assim");
  assert.ok(srcOf(PROVIDER).includes("MSG_BLOCKED_TITLE"), "tela segura continua no portão");
});

/* ═══════════════ T19 — um único card Dados e sincronização ═══════════════ */
await check("T19 — Existe um único card “Dados e sincronização”", () => {
  const cfg = srcOf(CONFIG);
  assert.equal(
    cfg.split('title="Dados e sincronização"').length - 1,
    1,
    "exatamente um card unificado",
  );
  assert.ok(!cfg.includes('title="Dados"'), "card “Dados” isolado removido");
  assert.ok(
    !cfg.includes('title="Sincronização entre dispositivos"'),
    "card de sincronização separado removido",
  );
  assert.ok(!srcOf(SETTINGS).includes("<Card"), "a seção de sync não abre um segundo cartão");
  // Indicadores do topo preservados dentro do card único.
  for (const label of ["Registros de ponto", "Compensações", "Armazenado"]) {
    assert.ok(cfg.includes(label), `indicador preservado: ${label}`);
  }
  assert.ok(cfg.includes("<CloudSyncSettings />"), "a sincronização vive dentro do card único");
});

/* ═══════════════ T20 — botão único de backup ═══════════════ */
await check("T20 — Existe um único botão principal de backup JSON", () => {
  const cfg = srcOf(CONFIG);
  assert.equal(cfg.split("Baixar backup (JSON)").length - 1, 1, "um único botão de backup");
  assert.ok(!cfg.includes("Exportar backup (JSON)"), "rótulo duplicado removido");
  assert.ok(!cfg.includes("Baixar backup de segurança"), "botão redundante removido do card");
  assert.ok(!srcOf(SETTINGS).includes("Baixar backup deste dispositivo"), "sem terceiro rótulo");
  assert.equal(cfg.split("Importar backup (JSON)").length - 1, 1, "um único importar");
  // Continua sendo o MESMO formato: BACKUP v3.
  assert.equal(backup.BACKUP_VERSION, 3);
  assert.ok(cfg.includes("buildBackupPayload"), "exporta pelo serializer canônico");
});

/* ═══════════════ T21 — texto legado removido ═══════════════ */
await check("T21 — Texto “nada vai para servidores” não existe mais", () => {
  const files = [CONFIG, SETTINGS, PROVIDER, ONBOARDING_UI, "src/components/app-shell.tsx"];
  for (const f of files) {
    const s = srcOf(f);
    assert.ok(!s.includes("nada vai para servidores"), `${f} não pode afirmar isso`);
    assert.ok(!s.includes("localStorage)"), `${f} não expõe o termo técnico ao usuário`);
    assert.ok(!s.includes("100% localStorage"), `${f} não expõe o termo técnico ao usuário`);
  }
  // Nenhum jargão técnico nas explicações do usuário final.
  const explains = Object.values(metadata.SYNC_EXPLAIN).join(" ");
  for (const t of ["localStorage", "JSONB", "CAS", "revision", "Supabase"]) {
    assert.ok(!explains.includes(t), `explicação não pode citar ${t}`);
  }
});

/* ═══════════════ T22 — texto dinâmico local/cloud ═══════════════ */
await check("T22 — Texto do card é dinâmico conforme o estado", () => {
  const base = metadata.defaultSyncMetadata();
  const local = { ...base, mode: "local" as const, status: "not-started" as const };
  const synced = { ...base, mode: "cloud" as const, status: "synced" as const, revision: 2 };
  const pending = { ...base, mode: "cloud" as const, status: "pending" as const, revision: 2 };
  const conflict = { ...base, mode: "cloud" as const, status: "conflict" as const, revision: 2 };
  assert.equal(metadata.syncExplainText(local), "Seus dados estão somente neste dispositivo.");
  assert.equal(
    metadata.syncExplainText(synced),
    "Seus dados ficam neste dispositivo e sincronizados com sua conta.",
  );
  assert.equal(
    metadata.syncExplainText(pending),
    "Há alterações neste dispositivo aguardando sincronização.",
  );
  assert.equal(
    metadata.syncExplainText(conflict),
    "Há alterações neste dispositivo e em outro dispositivo.",
  );
  assert.equal(metadata.syncExplainText(null), "Seus dados estão somente neste dispositivo.");
  assert.ok(srcOf(CONFIG).includes("syncExplainText(cloud?.meta)"), "card usa o texto dinâmico");
  // Erro mantém a mensagem segura já existente (4K).
  assert.equal(engine.MSG_FETCH_FAILED.includes("preservados"), true);
});

/* ═══════════════ T23 — “Apagar dados do controle” ═══════════════ */
await check("T23 — “Apagar dados do controle” substitui o rótulo antigo", () => {
  const cfg = srcOf(CONFIG);
  assert.ok(cfg.includes("Apagar dados do controle"), "novo rótulo presente");
  assert.ok(!cfg.includes("Apagar todos os dados"), "rótulo antigo removido");
  assert.ok(cfg.includes('title="Apagar dados do controle?"'));
  assert.ok(cfg.includes('confirmLabel="Apagar dados do controle"'));
  assert.ok(
    cfg.includes("Esta alteração também será sincronizada com sua conta."),
    "em nuvem ativa, a confirmação avisa a sincronização",
  );
  assert.ok(cfg.includes('cloud?.meta.mode === "cloud"'), "aviso condicionado à nuvem ativa");
});

/* ═══════════════ T24 — reset continua CAS, não DELETE ═══════════════ */
await check("T24 — Reset em nuvem continua usando mutação/CAS (nunca DELETE do row)", async () => {
  for (const f of CLOUD_FILES) {
    const stripped = srcOf(f).replaceAll("map.delete(", "").replaceAll("listeners.delete(", "");
    assert.ok(!stripped.includes(".delete("), `${f} não pode deletar o row`);
  }
  resetWorld();
  setLocal(relevantLocal());
  const fake = new FakeSupabase();
  const snap = canonical.serializeCanonicalAppState(store.getAppData());
  fake.rows.set("user-A", remoteRowFor(snap, 5, "user-A"));
  engine.configureCloudSync(fake.asClient(), "user-A");
  metadata.updateSyncMetadata({
    mode: "cloud",
    activeUserId: "user-A",
    revision: 5,
    cloudRevision: 5,
    status: "synced",
    lastSyncedFingerprint: canonical.canonicalFingerprint(snap),
  });
  store.actions.clearAll();
  await engine.noteLocalMutation();
  const updates = fake.callsOf("update");
  assert.equal(updates.length, 1, "apagar dados dispara UM CAS");
  assert.equal(Object.fromEntries(updates[0].filters).revision, 5, "CAS com a revision esperada");
  assert.equal(updates[0].values?.revision, 6, "revision +1 exato");
  assert.ok(fake.rows.get("user-A"), "user_app_state NÃO é deletado");
  assert.deepEqual((fake.rows.get("user-A")?.payload as { entries?: unknown })?.entries, []);
});

/* ═══════════════ T25 — seed de exemplo oculto em produção ═══════════════ */
await check("T25 — “Restaurar dados de exemplo” fica oculto em production", () => {
  const cfg = srcOf(CONFIG);
  assert.ok(
    cfg.includes('const SHOW_DEMO_SEED = process.env.NODE_ENV !== "production"'),
    "flag de ambiente para o seed",
  );
  assert.ok(cfg.includes("{SHOW_DEMO_SEED && ("), "botão renderizado condicionalmente");
  const at = cfg.indexOf("{SHOW_DEMO_SEED && (");
  const label = cfg.indexOf("Restaurar dados de exemplo", at);
  assert.ok(label > at && label - at < 400, "o botão do seed está dentro da condição");
  // As funções internas continuam disponíveis aos testes.
  assert.equal(typeof store.actions.reseed, "function", "reseed continua existindo");
  assert.equal(typeof seed.buildSeedData, "function");
});

/* ═══════════════ T26 — perfil sem “sem login” ═══════════════ */
await check("T26 — Perfil/Conta sem textos legados de “sem login”", () => {
  const cfg = srcOf(CONFIG);
  assert.ok(!cfg.includes("sem login"), "texto legado removido");
  assert.ok(!cfg.includes("app de uso pessoal — sem login"));
  assert.ok(cfg.includes('subtitle="Dados do seu perfil"'), "novo subtítulo do perfil");
  assert.ok(cfg.includes("Conta conectada"), "card Conta identifica a conta autenticada");
  assert.ok(cfg.includes("{cloud.email}"), "exibe o e-mail, nunca o identificador interno");
  assert.ok(!cfg.includes("userId"), "user_id não é exibido em Configurações");
  assert.ok(
    cfg.includes("Sair encerra a sessão apenas neste navegador."),
    "logout continua sendo só deste navegador",
  );
});

/* ═══════════════ T27 — conflito mostra a conta autenticada ═══════════════ */
await check("T27 — Conflito identifica a conta conectada", () => {
  const st = srcOf(SETTINGS);
  const pv = srcOf(PROVIDER);
  assert.ok(st.includes("Conta conectada: {ctx.email}"), "cartão de conflito mostra a conta");
  assert.ok(pv.includes("Conta conectada: {email}"), "faixa/portão mostram a conta");
  assert.ok(st.includes("{MSG_USE_CLOUD_CTA} desta conta"), "“Usar versão da nuvem desta conta”");
  // Segurança inalterada: nenhum user_id exposto, nenhum force-overwrite remoto.
  for (const f of [st, pv]) {
    assert.ok(!f.includes("{ctx.userId}"), "user_id nunca aparece na interface");
    assert.ok(!f.toLowerCase().includes("forçar"), "sem botão de sobrescrever a nuvem");
  }
  assert.ok(!srcOf(ENGINE).includes("forceOverwrite"), "motor sem force-overwrite");
});

/* ═══════════════ T28 — sidebar sem texto truncável ═══════════════ */
await check("T28 — Status da sidebar usa rótulos curtos, sem truncamento", () => {
  const shorts = Object.values(metadata.SYNC_STATUS_SHORT_LABEL);
  assert.deepEqual(
    metadata.SYNC_STATUS_SHORT_LABEL["not-started"],
    "Não iniciada",
    "rótulo curto oficial",
  );
  assert.equal(metadata.SYNC_STATUS_SHORT_LABEL.synced, "Sincronizado");
  assert.equal(metadata.SYNC_STATUS_SHORT_LABEL.pending, "Pendente");
  assert.equal(metadata.SYNC_STATUS_SHORT_LABEL.conflict, "Conflito");
  assert.equal(metadata.SYNC_STATUS_SHORT_LABEL.error, "Erro");
  assert.equal(metadata.SYNC_STATUS_SHORT_LABEL.syncing, "Sincronizando");
  for (const label of shorts) {
    assert.ok(label.length <= 14, `rótulo curto demais para cortar: ${label}`);
  }
  const sl = srcOf(STATUS_LINE);
  assert.ok(sl.includes("SYNC_STATUS_SHORT_LABEL[ctx.status]"), "sidebar usa o rótulo curto");
  assert.ok(!sl.includes('<span className="truncate">'), "sem truncamento no texto do status");
  assert.equal(metadata.syncStatusShortLabel(metadata.defaultSyncMetadata()), "Não iniciada");
});

/* ═══════════════ T29 — textos do cálculo respeitam [10+] ═══════════════ */
await check("T29 — “Como o cálculo funciona” respeita [10+] separado", () => {
  const cfg = srcOf(CONFIG);
  const at = cfg.indexOf("Como o cálculo funciona");
  assert.ok(at > 0, "seção presente");
  const section = cfg.slice(at, cfg.indexOf("<ImportBackupModal", at));
  assert.ok(section.includes("Base diária de 8h"), "base regular 8h");
  assert.ok(section.includes("Até 10h no dia entram no"), "até 10h entra no cálculo regular");
  assert.ok(section.includes("[10+]"), "excedente acima de 10h é o [10+]");
  assert.ok(section.includes("não abate automaticamente"), "[10+] não compensa saldo sozinho");
  // Textos legados que contradiziam as regras atuais.
  assert.ok(
    !section.includes("vira <b>excedente</b> para compensar em outro dia"),
    "texto legado de compensação automática removido",
  );
  assert.ok(!section.includes("não pode ser registrado no ponto e vira"), "texto legado removido");
  assert.ok(!section.includes("automaticamente compensação"), "sem promessa de automatismo");
  assert.ok(section.includes("Nada é reorganizado sozinho"), "saldo factual não é motor automático");
});

/* ═══════════════ T30 — texto do intervalo ═══════════════ */
await check("T30 — Texto do intervalo respeita a regra do intervalo explícito", () => {
  const cfg = srcOf(CONFIG);
  const at = cfg.indexOf("Como o cálculo funciona");
  const section = cfg.slice(at, cfg.indexOf("<ImportBackupModal", at));
  assert.ok(
    section.includes("intervalo realmente registrado é\n              respeitado pelo tempo exato") ||
      section.includes("respeitado pelo tempo exato"),
    "intervalo real vale pelo tempo exato",
  );
  assert.ok(section.includes("A 1h automática só é usada quando"), "1h é apenas fallback");
  assert.ok(section.includes("não existe</b>{\" \"}"), "fallback condicionado à ausência");
  assert.ok(section.includes("intervalo intermediário"), "regra do intervalo intermediário");
  assert.ok(
    !section.includes("o app desconta 1h automaticamente (se ativado)"),
    "texto legado do almoço removido",
  );
});

/* ═══════════════ T31 — favicon no App Router ═══════════════ */
await check("T31 — Favicon do Meu Horário existe no App Router", () => {
  assert.ok(exists("src/app/icon.svg"), "ícone na convenção nativa do Next (App Router)");
  const svg = srcOf("src/app/icon.svg");
  assert.ok(svg.trimStart().startsWith("<svg"), "SVG válido");
  assert.ok(/#34d399|#059669|emerald/i.test(svg), "identidade verde já aprovada");
  assert.ok(svg.includes("<circle"), "relógio: mostrador");
  assert.ok(svg.includes("stroke=\"#ffffff\""), "relógio branco sobre o verde");
  assert.ok(svg.includes("rx="), "forma quadrada arredondada");
  assert.ok(svg.includes("Meu Horário"), "rotulado como Meu Horário");
  // Sem PWA nesta etapa.
  assert.ok(!srcOf("src/app/layout.tsx").includes("manifest"), "nenhum manifesto PWA");
});

/* ═══════════════ T32 — nenhum motor financeiro alterado ═══════════════ */
await check("T32 — Nenhum motor financeiro foi alterado", () => {
  const engines = [
    "src/lib/hour-bank.ts",
    "src/lib/regular-facts.ts",
    "src/lib/special-excess-bank.ts",
    "src/lib/special-excess-use.ts",
    "src/lib/special-excess-plan.ts",
    "src/lib/compensar.ts",
    "src/lib/compensations.ts",
    "src/lib/absences.ts",
    "src/lib/faltas.ts",
    "src/lib/breaks.ts",
    "src/lib/periods.ts",
    "src/lib/period-consolidation.ts",
    "src/lib/annual-cycle-close.ts",
    "src/lib/annual-cycle-closure.ts",
    "src/lib/official-projection.ts",
    "src/lib/point-guide.ts",
    "src/lib/debt.ts",
    "src/lib/company-calendar.ts",
    "src/lib/time.ts",
  ];
  const diff = execFileSync(
    "git",
    ["diff", "--name-only", "3b61287ceb3bb93d3d48e1e3119b58cc17641833", "--", ...engines],
    { cwd: root },
  )
    .toString()
    .trim();
  assert.equal(diff, "", `motores financeiros intocados (alterados: ${diff})`);
  // Sanidade viva das regras canônicas (nada foi reinterpretado).
  assert.equal(seed.DEFAULT_WORK_SETTINGS.maxDailyMinutes, 600, "teto diário 10h");
  const closures = execFileSync(
    "git",
    ["diff", "--name-only", "3b61287ceb3bb93d3d48e1e3119b58cc17641833", "--", "supabase"],
    { cwd: root },
  )
    .toString()
    .trim();
  assert.equal(closures, "", "nenhuma alteração de banco");
});

console.log(`\n4L — ${passed}/32 verificações concluídas.`);
if (passed !== 32) process.exit(1);
