/**
 * VERIFICAÇÃO — Perfil real (Maria Helena) preservado.
 *
 * Seed/demo restaura fatos operacionais, nunca nome/e-mail/nascimento.
 * clearAll e F5/reload também preservam o perfil.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-perfil-real.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isBirthdayToday, suggestedAbonoDate } from "../src/lib/absences.ts";
import {
  applyDemoIdentityMigration,
  buildSeedData,
  createEmptyState,
  DEFAULT_USER,
  DEMO_USER_IDENTITY,
  EMPTY_USER,
  REAL_USER_IDENTITY,
  SEED_CONTROL_START,
  withPreservedIdentity,
} from "../src/lib/seed-data.ts";
import { actions, getAppData, hydrateAppData } from "../src/lib/store.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import { settingsOf } from "../src/lib/store.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

const TODAY = "2026-08-29";
const CYCLE = annualCycleBounds(getAnnualPointCycle(TODAY));

check("1. perfil da bancada de exemplo (4L: instalação nova fica SEM identidade)", () => {
  assert.equal(REAL_USER_IDENTITY.name, "Maria Helena");
  assert.equal(REAL_USER_IDENTITY.email, "meu@horario.com");
  assert.equal(REAL_USER_IDENTITY.birthDate, "1989-08-23");
  assert.equal(DEFAULT_USER.name, "Maria Helena");
  assert.equal(DEFAULT_USER.email, "meu@horario.com");
  assert.equal(DEFAULT_USER.birthDate, "1989-08-23");
  // ETAPA 4L — conta nova NUNCA recebe dado pessoal fictício.
  assert.equal(EMPTY_USER.name, "");
  assert.equal(EMPTY_USER.email, "");
  assert.equal(EMPTY_USER.birthDate, null);
  assert.equal(buildSeedData().user.name, "Maria Helena");
  assert.equal(buildSeedData().user.email, "meu@horario.com");
  assert.equal(buildSeedData().user.birthDate, "1989-08-23");
});

check("2. saudação, menu e Configurações usam o perfil", () => {
  const page = srcOf("src/app/(app)/page.tsx");
  const shell = srcOf("src/components/app-shell.tsx");
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(page.includes("Olá, {user.name}! 👋"), "saudação com nome completo");
  assert.ok(page.includes("Feliz aniversário, {firstName}! 🎉"), "banner de aniversário inalterado");
  assert.ok(shell.includes("{mounted ? user.name : \"Carregando…\"}"));
  assert.ok(shell.includes("{mounted ? user.email : \"\"}"));
  assert.ok(cfg.includes('label="Nome completo"'));
  assert.ok(cfg.includes("value={profile.name}"));
  assert.ok(cfg.includes("value={profile.email}"));
  assert.ok(cfg.includes('label="Data de nascimento"'));
  assert.ok(cfg.includes("value={profile.birthDate}"));
});

check("3. nascimento continua na regra de aniversário (sem alterar a lógica)", () => {
  assert.equal(isBirthdayToday("1989-08-23", "2026-08-23"), true);
  assert.equal(isBirthdayToday("1989-08-23", "2026-08-29"), false);
  assert.equal(suggestedAbonoDate("1989-08-23", "2026-08-29"), "2026-08-23");
  const absSrc = srcOf("src/lib/absences.ts");
  assert.ok(absSrc.includes("birthDate.slice(5, 10) === today.slice(5, 10)"));
  assert.ok(srcOf("src/app/(app)/page.tsx").includes("isBirthdayToday(user.birthDate, todayStr)"));
});

check("4. F5/reload preserva o perfil informado pelo usuário", () => {
  const base = createEmptyState(TODAY);
  // ETAPA 4L — o estado novo nasce sem identidade; o perfil vem do onboarding.
  assert.equal(base.user.name, "");
  const empty = { ...base, user: { ...base.user, ...REAL_USER_IDENTITY } };
  const again = hydrateAppData(JSON.stringify(empty), TODAY);
  assert.equal(again.user.name, "Maria Helena");
  assert.equal(again.user.email, "meu@horario.com");
  assert.equal(again.user.birthDate, "1989-08-23");
  assert.equal(again.user.controlStartDate, TODAY);
  assert.equal(again.entries.length, 0);
});

check("5. Apagar todos os dados preserva o perfil", () => {
  actions.replaceAll({
    ...createEmptyState(TODAY),
    user: {
      ...EMPTY_USER,
      name: "Maria Helena",
      email: "meu@horario.com",
      birthDate: "1989-08-23",
      controlStartDate: TODAY,
    },
  });
  actions.addEntry({ date: "2026-08-28", time: "08:00", type: "entrada", note: null, source: "manual" });
  actions.clearAll();
  const after = getAppData();
  assert.equal(after.user.name, "Maria Helena");
  assert.equal(after.user.email, "meu@horario.com");
  assert.equal(after.user.birthDate, "1989-08-23");
  assert.equal(after.user.controlStartDate, TODAY);
  assert.equal(after.entries.length, 0);
});

check("6. Restaurar dados de exemplo preserva perfil customizado", () => {
  actions.replaceAll({
    ...createEmptyState(TODAY),
    user: {
      ...EMPTY_USER,
      name: "Outra Pessoa",
      email: "outra@empresa.com",
      birthDate: "2000-01-15",
      controlStartDate: "2026-08-01",
    },
  });
  const seed = buildSeedData();
  actions.reseed();
  const restored = getAppData();
  assert.equal(restored.user.name, "Outra Pessoa");
  assert.equal(restored.user.email, "outra@empresa.com");
  assert.equal(restored.user.birthDate, "2000-01-15");
  assert.equal(restored.entries.length, seed.entries.length);
  assert.equal(restored.compensations.length, seed.compensations.length);
  assert.equal(restored.faltas.length, 0, "seed 4.0 sem faltas");
  assert.equal(restored.absences.length, 0, "seed 4.0 sem ausências");
  assert.equal((restored.excessReasons ?? []).length, 0, "seed 4.0 sem motivos legados");
  assert.equal(restored.user.controlStartDate, SEED_CONTROL_START);
  assert.equal(restored.user.workStart, seed.user.workStart);
});

check("7. seed continua restaurando os dados operacionais de teste", () => {
  const base = createEmptyState(TODAY);
  actions.replaceAll({ ...base, user: { ...base.user, ...REAL_USER_IDENTITY } });
  actions.reseed();
  const d = getAppData();
  const seed = buildSeedData();
  assert.equal(d.entries.length, seed.entries.length);
  assert.ok(d.entries.some((e) => e.date === "2026-08-18"), "origem [10+] 18/08");
  assert.ok(d.entries.some((e) => e.date === "2026-08-26"), "destino 26/08");
  assert.ok(d.entries.filter((e) => e.date === "2026-08-18").length === 4);
  assert.equal(d.absences.length, 0, "seed 4.0 sem ausências");
  assert.equal((d.excessReasons ?? []).length, 0, "seed 4.0 sem motivos legados");
  assert.equal(d.user.name, "Maria Helena");
  assert.equal(d.user.email, "meu@horario.com");
  assert.equal(d.user.birthDate, "1989-08-23");
});

check("8. identidade de demo antiga migra sem apagar fatos", () => {
  const seed = buildSeedData();
  const demo = {
    ...seed,
    user: { ...seed.user, ...DEMO_USER_IDENTITY },
  };
  assert.equal(demo.user.name, "Alex Santos");
  const migrated = applyDemoIdentityMigration(demo);
  assert.equal(migrated.user.name, "Maria Helena");
  assert.equal(migrated.user.email, "meu@horario.com");
  assert.equal(migrated.user.birthDate, "1989-08-23");
  assert.equal(migrated.entries.length, seed.entries.length);
  assert.equal(migrated.user.controlStartDate, seed.user.controlStartDate);
  const hydrated = hydrateAppData(JSON.stringify(demo), TODAY);
  assert.equal(hydrated.user.name, "Maria Helena");
  assert.equal(hydrated.entries.length, seed.entries.length);
  const custom = { ...seed, user: { ...seed.user, name: "Cliente X", email: "x@y.com" } };
  assert.equal(hydrateAppData(JSON.stringify(custom), TODAY).user.name, "Cliente X");
});

check("9. withPreservedIdentity não altera jornada", () => {
  const seedUser = buildSeedData().user;
  const kept = withPreservedIdentity(seedUser, {
    name: "Z",
    email: "z@z.com",
    birthDate: "1991-02-03",
  });
  assert.equal(kept.name, "Z");
  assert.equal(kept.workStart, seedUser.workStart);
  assert.equal(kept.maxDailyMinutes, seedUser.maxDailyMinutes);
  assert.equal(kept.controlStartDate, seedUser.controlStartDate);
});

check("10. cálculos financeiros do seed permanecem iguais", () => {
  const seed = buildSeedData();
  const settings = settingsOf(seed.user);
  const bank = hourBankSummary(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars,
    seed.faltas, seed.excessReasons, settings, CYCLE, TODAY,
  );
  actions.reseed();
  const live = getAppData();
  const liveBank = hourBankSummary(
    live.entries, live.compensations, live.absences, live.companyCalendars,
    live.faltas, live.excessReasons, settingsOf(live.user), CYCLE, TODAY,
  );
  assert.equal(liveBank.realizedBalance, bank.realizedBalance);
  assert.equal(liveBank.openDeficitTotal, bank.openDeficitTotal);
  assert.equal(liveBank.excessSpecialFreeTotal, bank.excessSpecialFreeTotal);
  assert.equal(liveBank.plannedTotal, bank.plannedTotal);
});

check("11. UI de restaurar declara que o perfil é mantido", () => {
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(cfg.includes("Nome, e-mail e data de nascimento serão mantidos."));
  // ETAPA 4L — o seed de exemplo continua no código, oculto em produção.
  assert.ok(cfg.includes("Restaurar dados de exemplo"));
  assert.ok(cfg.includes("SHOW_DEMO_SEED"));
  const store = srcOf("src/lib/store.ts");
  assert.ok(store.includes("withPreservedIdentity(seed.user, d.user)"));
  assert.ok(!store.includes("mutate(() => buildSeedData())"));
});

actions.replaceAll(createEmptyState(TODAY));
console.log(`\nPERFIL REAL — OK (${passed} testes)`);
