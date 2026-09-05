/**
 * VERIFICAÇÃO — ETAPA 4J: FUNDAÇÃO SUPABASE (AUTH OTP + SESSÃO + RLS).
 *
 * Escopo FECHADO (somente fundação de autenticação/nuvem — NENHUM motor
 * financeiro, store operacional ou formato de backup tocado):
 *   - login por e-mail + código OTP de 6 dígitos (sem senha);
 *   - sessão persistente via cookies SSR (proxy Next 16);
 *   - proteção server-side das rotas + redirect de /entrar;
 *   - logout sem apagar dados locais;
 *   - localStorage segue como fonte de verdade (sem sync nesta etapa);
 *   - migration SQL versionada de public.user_app_state + RLS (NÃO aplicada
 *     no remoto — aplicação manual via SQL Editor);
 *   - BACKUP_VERSION continua 3; nenhum segredo no repo.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-supabase-auth-4j.mts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (p: string) => readFileSync(join(root, p), "utf8");
const exists = (p: string) => existsSync(join(root, p));

let passed = 0;
const check = async (id: string, fn: () => void | Promise<void>) => {
  await fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Localizadores (audita a arquitetura antes de fixar nomes) ── */
const BROWSER_CLIENT = "src/lib/supabase/client.ts";
const SERVER_CLIENT = "src/lib/supabase/server.ts";
const ENV_HELPER = "src/lib/supabase/env.ts";
const PROXY = exists("src/proxy.ts") ? "src/proxy.ts" : "middleware.ts";
const LOGIN_PAGE = "src/app/entrar/page.tsx";
const LOGIN_FORM = "src/components/login-form.tsx";
const SIGN_OUT = "src/components/sign-out-button.tsx";
const APP_LAYOUT = "src/app/(app)/layout.tsx";
const MIGRATION_DIR = "supabase/migrations";

const migrationFiles = () =>
  exists(MIGRATION_DIR)
    ? readdirSync(join(root, MIGRATION_DIR)).filter((f) => f.endsWith(".sql")).sort()
    : [];
const migrationSql = () =>
  migrationFiles()
    .map((f) => srcOf(`${MIGRATION_DIR}/${f}`))
    .join("\n");

const FORBIDDEN = ["sb_secret_", "service_role", "SUPABASE_SERVICE_ROLE", "DATABASE_PASSWORD", "SMTP_PASSWORD"];

/* ═══════════════ T01 — dependências modernas ═══════════════ */
await check("T01 — Dependências Supabase modernas presentes", () => {
  const pkg = JSON.parse(srcOf("package.json"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  assert.ok(deps["@supabase/supabase-js"], "falta @supabase/supabase-js");
  assert.ok(deps["@supabase/ssr"], "falta @supabase/ssr");
  assert.ok(
    !Object.keys(deps).some((d) => d.includes("auth-helpers")),
    "pacote auth-helpers antigo/deprecated não pode ser usado",
  );
});

/* ═══════════════ T02 — browser client ═══════════════ */
await check("T02 — Browser client usa somente URL + publishable key via env", () => {
  const s = srcOf(BROWSER_CLIENT);
  const env = srcOf(ENV_HELPER);
  assert.ok(s.includes("createBrowserClient"), "deve usar createBrowserClient (@supabase/ssr)");
  assert.ok(
    s.includes("requireSupabaseEnv") || s.includes("getSupabaseUrl"),
    "deve obter URL/key via helper de env em runtime (nunca em import-time)",
  );
  assert.ok(env.includes("NEXT_PUBLIC_SUPABASE_URL"), "helper deve ler NEXT_PUBLIC_SUPABASE_URL");
  assert.ok(
    env.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    "helper deve ler NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  for (const f of FORBIDDEN) assert.ok(!s.includes(f), `browser client não pode conter ${f}`);
});

/* ═══════════════ T03 — server client SSR/cookies ═══════════════ */
await check("T03 — Server client usa mecanismo SSR/cookies compatível", () => {
  const s = srcOf(SERVER_CLIENT);
  assert.ok(s.includes("createServerClient"), "deve usar createServerClient (@supabase/ssr)");
  assert.ok(s.includes("cookies"), "deve usar cookies (next/headers)");
  assert.ok(s.includes("getAll"), "deve implementar getAll");
  assert.ok(s.includes("setAll"), "deve implementar setAll");
  const p = srcOf(PROXY);
  assert.ok(p.includes("getUser"), "proxy deve chamar getUser para refresh da sessão");
});

/* ═══════════════ T04 — sem secrets ═══════════════ */
await check("T04 — Nenhuma secret/service_role foi adicionada", () => {
  const hay = [BROWSER_CLIENT, SERVER_CLIENT, ENV_HELPER, PROXY, LOGIN_PAGE, LOGIN_FORM, SIGN_OUT, APP_LAYOUT]
    .map(srcOf)
    .join("\n");
  const mig = migrationSql();
  for (const f of FORBIDDEN) {
    assert.ok(!hay.includes(f), `código não pode conter ${f}`);
    assert.ok(!mig.includes(f), `migration não pode conter ${f}`);
  }
  const example = srcOf(".env.example");
  for (const f of FORBIDDEN) assert.ok(!example.includes(f), `.env.example não pode conter ${f}`);
});

/* ═══════════════ T05 — sem valores reais ═══════════════ */
await check("T05 — Nenhum valor real de env foi commitado", () => {
  const example = srcOf(".env.example");
  assert.ok(example.includes("NEXT_PUBLIC_SUPABASE_URL="), "deve declarar NEXT_PUBLIC_SUPABASE_URL");
  assert.ok(
    example.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="),
    "deve declarar NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  for (const line of example.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    assert.match(t, /^NEXT_PUBLIC_SUPABASE_(URL|PUBLISHABLE_KEY)=$/, "linha de env deve ser NOME= sem valor");
  }
  assert.ok(!example.includes("https://"), ".env.example não pode conter URL real");
  assert.ok(!/sb_[A-Za-z0-9_-]{10,}/.test(example), ".env.example não pode conter chave real");
  const gi = srcOf(".gitignore");
  assert.ok(gi.includes(".env"), ".gitignore deve cobrir arquivos .env");
});

/* ═══════════════ T06 — rota pública /entrar ═══════════════ */
await check("T06 — /entrar existe como rota pública", () => {
  assert.ok(exists(LOGIN_PAGE), "src/app/entrar/page.tsx deve existir");
  const s = srcOf(LOGIN_PAGE);
  assert.ok(s.includes("LoginForm"), "página /entrar deve renderizar o formulário de login");
  const f = srcOf(LOGIN_FORM);
  assert.ok(f.includes("Meu Horário"), "título “Meu Horário”");
  assert.ok(
    f.includes("Entre para acessar seu controle em seus dispositivos."),
    "subtítulo esperado",
  );
  assert.ok(f.includes("Enviar código"), "botão “Enviar código”");
});

/* ═══════════════ T07 — proteção sem sessão ═══════════════ */
await check("T07 — Rota protegida sem sessão redireciona para /entrar", () => {
  const p = srcOf(PROXY);
  assert.ok(p.includes("/entrar"), "proxy deve redirecionar para /entrar");
  assert.ok(p.includes("redirect"), "proxy deve usar redirect");
  const layout = srcOf(APP_LAYOUT);
  assert.ok(layout.includes("/entrar"), "layout do grupo operacional deve redirecionar para /entrar");
  assert.ok(layout.includes("getUser"), "layout deve conferir a sessão via getUser");
});

/* ═══════════════ T08 — autenticado em /entrar volta para / ═══════════════ */
await check("T08 — Usuário autenticado em /entrar volta para /", () => {
  const page = srcOf(LOGIN_PAGE);
  assert.ok(page.includes('redirect("/")'), "/entrar deve redirecionar autenticado para /");
  const p = srcOf(PROXY);
  assert.ok(p.includes("entrar"), "proxy deve tratar a rota /entrar");
  assert.ok(/new URL\("\/", request\.url\)/.test(p), "proxy deve redirecionar autenticado para /");
});

/* ═══════════════ T09 — signInWithOtp ═══════════════ */
await check("T09 — Enviar código usa signInWithOtp", () => {
  assert.ok(srcOf(LOGIN_FORM).includes("signInWithOtp"), "deve usar supabase.auth.signInWithOtp");
});

/* ═══════════════ T10 — shouldCreateUser ═══════════════ */
await check("T10 — signInWithOtp permite criação de usuário conforme fluxo da v1.0", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(s.includes("shouldCreateUser"), "deve declarar shouldCreateUser");
  assert.ok(/shouldCreateUser:\s*true/.test(s), "shouldCreateUser deve ser true");
});

/* ═══════════════ T11 — sanitização do e-mail ═══════════════ */
await check("T11 — E-mail é sanitizado antes do envio", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(s.includes(".trim()"), "deve aplicar trim");
  assert.ok(s.includes(".toLowerCase()"), "deve aplicar lowercase");
  assert.ok(/signInWithOtp\(\{\s*email:\s*\w+/.test(s) || s.includes("sanitizeEmail"), "deve enviar o e-mail sanitizado");
});

/* ═══════════════ T12 — campo OTP ═══════════════ */
await check("T12 — Campo OTP aceita 6 dígitos e one-time-code", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(s.includes("one-time-code"), "deve usar autocomplete one-time-code");
  assert.ok(s.includes("numeric"), "deve usar inputMode numeric");
  assert.ok(/maxLength=\{6\}|maxLength="6"/.test(s), "deve limitar a 6 caracteres");
  assert.ok(s.includes("slice(0, 6)") || s.includes("length !== 6"), "deve tratar 6 dígitos");
  assert.ok(s.includes("Código de acesso"), "rótulo “Código de acesso”");
});

/* ═══════════════ T13 — verifyOtp type=email ═══════════════ */
await check("T13 — Verificação usa verifyOtp com type=email", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(s.includes("verifyOtp"), "deve usar supabase.auth.verifyOtp");
  assert.ok(/type:\s*["']email["']/.test(s), 'deve usar type: "email"');
  assert.ok(s.includes("token"), "deve enviar o token digitado");
});

/* ═══════════════ T14 — redirect pós-login ═══════════════ */
await check("T14 — Login bem-sucedido redireciona para o app", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(s.includes('router.replace("/")'), 'deve fazer router.replace("/")');
  assert.ok(s.includes("router.refresh()"), "deve fazer router.refresh()");
});

/* ═══════════════ T15 — reenvio 60s ═══════════════ */
await check("T15 — Reenvio respeita espera de 60 segundos", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(/RESEND_WAIT_SECONDS\s*=\s*60/.test(s), "intervalo mínimo de 60 segundos");
  assert.ok(s.includes("Reenviar em"), "deve exibir contador (“Reenviar em Ns”)");
  assert.ok(s.includes("Reenviar código"), "deve ter ação “Reenviar código”");
  assert.ok(s.includes("cooldown"), "botão indisponível durante a espera");
});

/* ═══════════════ T16 — logout ═══════════════ */
await check("T16 — Logout usa signOut e volta para /entrar", () => {
  const s = srcOf(SIGN_OUT);
  assert.ok(s.includes("signOut"), "deve usar supabase.auth.signOut");
  assert.ok(s.includes("/entrar"), "após logout deve ir para /entrar");
  assert.ok(s.includes("Sair"), "ação discreta “Sair”");
  const shell = srcOf("src/components/app-shell.tsx");
  const config = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(
    shell.includes("SignOutButton") || config.includes("SignOutButton"),
    "“Sair” deve estar na área de usuário/sidebar ou Configurações",
  );
});

/* ═══════════════ T17 — sessão persistente, sem auth caseiro ═══════════════ */
await check("T17 — Sessão é tratada como persistente/refreshável via cookies/SSR", () => {
  const p = srcOf(PROXY);
  assert.ok(p.includes("setAll"), "proxy deve propagar cookies (refresh persistente)");
  assert.ok(p.includes("getUser"), "proxy deve revalidar a sessão a cada requisição");
  for (const f of [LOGIN_FORM, SIGN_OUT, BROWSER_CLIENT, SERVER_CLIENT, PROXY]) {
    assert.ok(!/localStorage\s*\.\s*(getItem|setItem|removeItem|clear|key|length)/.test(srcOf(f)), `${f} não pode criar auth caseiro em localStorage`);
  }
});

/* ═══════════════ T18 — login preserva dados locais ═══════════════ */
await check("T18 — Login NÃO apaga nem altera os dados locais existentes", () => {
  for (const f of [LOGIN_FORM, LOGIN_PAGE]) {
    const s = srcOf(f);
    assert.ok(!/localStorage\s*\.\s*(getItem|setItem|removeItem|clear|key|length)/.test(s), `${f} não pode tocar no localStorage`);
    assert.ok(!s.includes("replaceAll"), `${f} não pode sobrescrever o store`);
  }
});

/* ═══════════════ T19 — logout preserva dados locais ═══════════════ */
await check("T19 — Logout NÃO apaga dados operacionais locais", () => {
  const s = srcOf(SIGN_OUT);
  assert.ok(!/localStorage\s*\.\s*(getItem|setItem|removeItem|clear|key|length)/.test(s), "logout não pode tocar no localStorage");
  assert.ok(!s.includes("removeItem"), "logout não pode remover itens locais");
  assert.ok(!s.includes("clear"), "logout não pode limpar armazenamento");
});

/* ═══════════════ T20 — stores não leem user_app_state ═══════════════ */
await check("T20 — Stores atuais NÃO começaram a ler user_app_state nesta etapa", () => {
  const store = srcOf("src/lib/store.ts");
  assert.ok(!store.includes("user_app_state"), "store não pode referenciar user_app_state");
  assert.ok(!store.includes("supabase"), "store não pode importar supabase nesta etapa");
});

/* ═══════════════ T21 — stores não escrevem user_app_state ═══════════════ */
await check("T21 — Stores atuais NÃO começaram a escrever user_app_state nesta etapa", () => {
  const store = srcOf("src/lib/store.ts");
  assert.ok(!/\.from\(\s*["']/.test(store), "store não pode escrever via Data API nesta etapa");
  assert.ok(!store.includes("user_app_state"), "store não pode referenciar a tabela cloud");
  assert.ok(!store.includes("payload_version"), "store não pode conhecer o envelope cloud");
});

/* ═══════════════ T22 — backup v3 sem tokens ═══════════════ */
await check("T22 — BACKUP_VERSION permanece 3 e tokens não entram no backup", async () => {
  const { BACKUP_VERSION } = await import("../src/lib/backup.ts");
  assert.equal(BACKUP_VERSION, 3, "BACKUP_VERSION deve continuar 3");
  const s = srcOf("src/lib/backup.ts");
  for (const t of ["access_token", "refresh_token", "supabase", "user_app_state"]) {
    assert.ok(!s.toLowerCase().includes(t), `backup não pode conter ${t}`);
  }
});

/* ═══════════════ T23 — migration: tabela ═══════════════ */
await check("T23 — Migration cria user_app_state com user_id PK + FK auth.users CASCADE", () => {
  assert.ok(migrationFiles().length >= 1, "deve existir ao menos uma migration em supabase/migrations");
  const sql = migrationSql();
  assert.ok(sql.includes("user_app_state"), "deve criar public.user_app_state");
  assert.ok(sql.includes("user_id"), "deve ter coluna user_id");
  assert.ok(/primary\s+key/i.test(sql), "user_id deve ser PRIMARY KEY");
  assert.ok(sql.includes("auth.users"), "deve referenciar auth.users");
  assert.ok(/on\s+delete\s+cascade/i.test(sql), "FK deve ter ON DELETE CASCADE");
  assert.ok(/payload\s+jsonb/i.test(sql), "coluna payload JSONB");
  assert.ok(/payload_version/i.test(sql), "coluna payload_version");
  assert.ok(/revision/i.test(sql), "coluna revision");
  assert.ok(/created_at/i.test(sql) && /updated_at/i.test(sql), "colunas created_at/updated_at");
});

/* ═══════════════ T24 — migration: RLS + sem anon ═══════════════ */
await check("T24 — Migration habilita RLS e não concede acesso a anon", () => {
  const sql = migrationSql();
  assert.ok(/enable\s+row\s+level\s+security/i.test(sql), "deve ter ENABLE ROW LEVEL SECURITY");
  assert.ok(/revoke[^;]*anon/i.test(sql), "deve revogar acesso de anon explicitamente");
  assert.ok(!/grant[^;]*to\s+anon/i.test(sql), "não pode conceder nada a anon");
});

/* ═══════════════ T25 — migration: policies owner ═══════════════ */
await check("T25 — Migration possui políticas owner SELECT/INSERT/UPDATE/DELETE", () => {
  const sql = migrationSql();
  for (const op of ["select", "insert", "update", "delete"]) {
    assert.ok(new RegExp(`for\\s+${op}`, "i").test(sql), `deve ter policy FOR ${op.toUpperCase()}`);
  }
  const ownerChecks = (sql.match(/auth\.uid\(\)\s*=\s*user_id/g) ?? []).length;
  assert.ok(ownerChecks >= 4, "policies devem limitar por auth.uid() = user_id");
  assert.ok(/with\s+check/i.test(sql), "INSERT/UPDATE devem ter WITH CHECK");
});

/* ═══════════════ T26 — grants authenticated + sem realtime ═══════════════ */
await check("T26 — Grants explícitos a authenticated e sem Realtime", () => {
  const sql = migrationSql();
  assert.ok(/grant\s+select,\s*insert,\s*update,\s*delete[^;]*to\s+authenticated/i.test(sql), "deve conceder SELECT/INSERT/UPDATE/DELETE a authenticated");
  assert.ok(!/create\s+publication/i.test(sql), "não pode criar publication");
  assert.ok(!/alter\s+publication/i.test(sql), "não pode alterar publication");
  assert.ok(!/postgres_changes/i.test(sql), "não pode usar postgres_changes");
});

/* ═══════════════ T27 — envs ausentes: erro controlado ═══════════════ */
await check("T27 — Ausência das envs não vaza nem quebra build; erro controlado em runtime", async () => {
  const helper = srcOf(ENV_HELPER);
  assert.ok(
    helper.includes("O acesso ainda não está configurado neste ambiente."),
    "mensagem clara de configuração ausente",
  );
  assert.ok(!/^throw /m.test(helper), "não pode lançar em import-time");
  const mod = await import("../src/lib/supabase/env.ts");
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    assert.equal(mod.isSupabaseConfigured(), false, "sem envs não está configurado");
    assert.throws(() => mod.requireSupabaseEnv(), /ainda não está configurado/, "erro controlado em runtime");
  } finally {
    if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = savedKey;
  }
});

/* ═══════════════ T28 — mobile 320/360/412 ═══════════════ */
await check("T28 — Tela de login utilizável em 320/360/412 sem overflow", () => {
  const s = srcOf(LOGIN_FORM);
  assert.ok(s.includes("max-w-sm"), "card centralizado com largura máxima");
  assert.ok(s.includes("w-full"), "ocupa a largura disponível");
  assert.ok(s.includes("min-w-0"), "inputs nunca estouram o viewport");
  assert.ok(s.includes("px-4"), "respiro lateral em telas estreitas");
  assert.ok(!/w-\[\d{3,}px\]/.test(s), "sem larguras fixas que quebrem em 320px");
});

console.log(`\n4J — ${passed}/28 verificações concluídas.`);
if (passed !== 28) process.exit(1);
