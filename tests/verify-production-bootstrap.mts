/**
 * VERIFICAÇÃO — BOOTSTRAP DE PRODUÇÃO LIMPO vs SEED EXPLÍCITO
 *
 * Produção (storage vazio) nasce sem fatos fictícios.
 * Seed/demo continua disponível só por chamada explícita.
 * localStorage existente não é apagado. Testes ricos permanecem.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-production-bootstrap.mts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { activeAcordos, activeCalendarObligations } from "../src/lib/debt.ts";
import {
  hourBankSummary,
  specialExcessBook,
} from "../src/lib/hour-bank.ts";
import { isMissingExpectedRecord, missingExpectedRecordDates } from "../src/lib/missing-records.ts";
import { annualCycleBounds, getAnnualPointCycle, getPointPeriod } from "../src/lib/periods.ts";
import {
  buildLegacyDemoScenario,
  buildSeedData,
  createDemoSeed,
  createEmptyState,
  DEFAULT_WORK_SETTINGS,
  EMPTY_USER,
  SEED_VERSION,
} from "../src/lib/seed-data.ts";
import { actions, getAppData, hydrateAppData, parseStoredAppData, settingsOf } from "../src/lib/store.ts";
import type { AppData } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string) => readFileSync(join(root, rel), "utf8");

const TODAY = "2026-08-28";
const CYCLE = annualCycleBounds(getAnnualPointCycle(TODAY));
const PERIOD = getPointPeriod(TODAY);

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function transactionalCounts(d: AppData) {
  return {
    punches: d.entries.length,
    comps: d.compensations.length,
    absences: d.absences.length,
    faltas: d.faltas.length,
    reasons: (d.excessReasons ?? []).length,
    calendars: (d.companyCalendars ?? []).length,
  };
}

const empty = createEmptyState();
const settings = settingsOf(empty.user);
const storeSrc = srcOf("src/lib/store.ts");
const seedSrc = srcOf("src/lib/seed-data.ts");

check("1. storage vazio em produção => estado transacional limpo", () => {
  const hydrated = hydrateAppData(null);
  const counts = transactionalCounts(hydrated);
  assert.deepEqual(counts, { punches: 0, comps: 0, absences: 0, faltas: 0, reasons: 0, calendars: 0 });
  assert.ok(storeSrc.includes("createEmptyState()"));
  assert.ok(storeSrc.includes("Primeiro acesso: estado transacional vazio"));
  assert.ok(!storeSrc.includes("popula com dados de exemplo"));
  const hydrateFn = storeSrc.slice(storeSrc.indexOf("function ensureLoaded("), storeSrc.indexOf("function subscribe"));
  assert.ok(hydrateFn.includes("createEmptyState"));
  assert.ok(!hydrateFn.includes("buildSeedData"));
});

check("2. não existem punches seedados", () => {
  assert.equal(empty.entries.length, 0);
  assert.equal(hydrateAppData("").entries.length, 0);
  assert.ok(!empty.entries.some((e) => e.date === "2026-08-11"));
  assert.ok(!empty.entries.some((e) => e.date === "2026-08-24"));
});

check("3. não existem [10+] seedados", () => {
  const book = specialExcessBook(
    empty.entries, empty.compensations, empty.absences, empty.companyCalendars,
    settings, empty.excessReasons, CYCLE, TODAY,
  );
  assert.equal(book.original, 0);
  assert.equal(book.free, 0);
  assert.equal(book.days.length, 0);
});

check("4. não existem compensações seedadas", () => {
  assert.equal(empty.compensations.length, 0);
  assert.equal(hydrateAppData(null).compensations.length, 0);
});

check("5. não existem faltas/ausências seedadas", () => {
  assert.equal(empty.faltas.length, 0);
  assert.equal(empty.absences.length, 0);
});

check("6. não existem programações seedadas", () => {
  assert.equal(empty.compensations.filter((c) => c.status === "pendente").length, 0);
});

check("7. não existem realocações seedadas", () => {
  assert.equal(empty.compensations.filter((c) => c.portion === "especial").length, 0);
  assert.equal((empty.excessReasons ?? []).length, 0);
});

check("8. configurações estruturais continuam disponíveis", () => {
  assert.equal(empty.user.workStart, DEFAULT_WORK_SETTINGS.workStart);
  assert.equal(empty.user.workEnd, DEFAULT_WORK_SETTINGS.workEnd);
  assert.equal(empty.user.lunchStart, DEFAULT_WORK_SETTINGS.lunchStart);
  assert.equal(empty.user.lunchEnd, DEFAULT_WORK_SETTINGS.lunchEnd);
  assert.equal(empty.user.maxDailyMinutes, 600);
  assert.equal(empty.user.autoDeductLunch, true);
  // ETAPA 4L — primeiro uso: jornada genérica SEM nenhum dado pessoal fictício.
  assert.equal(empty.user.name, "");
  assert.equal(empty.user.email, "");
  assert.equal(empty.user.birthDate, null);
  assert.match(empty.user.controlStartDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(PERIOD.from.slice(8, 10), "21");
  assert.equal(PERIOD.to.slice(8, 10), "20");
  assert.equal(getAnnualPointCycle("2026-04-30"), "2025/2026");
  assert.equal(getAnnualPointCycle("2026-05-01"), "2026/2027");
  assert.equal(CYCLE.from, "2026-05-01");
  assert.equal(CYCLE.to, "2027-04-30");
});

check("9. localStorage existente não é apagado", () => {
  const seed = buildSeedData();
  const raw = JSON.stringify(seed);
  const parsed = parseStoredAppData(raw);
  assert.ok(parsed);
  assert.equal(parsed!.entries.length, seed.entries.length);
  assert.equal(parsed!.compensations.length, seed.compensations.length);
  const hydrated = hydrateAppData(raw);
  assert.equal(hydrated.entries.length, seed.entries.length);
  assert.ok(hydrated.entries.some((e) => e.date === "2026-08-24"));
  assert.equal((hydrated.excessReasons ?? []).length, 0, "seed 4.0 sem motivos legados");
  assert.equal(parseStoredAppData("{not-json"), null);
  assert.equal(hydrateAppData("{not-json").entries.length, 0);
});

check("10. seed explícito continua funcionando", () => {
  assert.equal(SEED_VERSION, "4.0");
  const demo = createDemoSeed();
  const seed = buildSeedData();
  assert.equal(JSON.stringify(demo), JSON.stringify(seed));
  assert.ok(demo.entries.length > 0);
  assert.ok(demo.entries.some((e) => e.date === "2026-08-18"), "origem [10+] 18/08");
  assert.ok(demo.entries.some((e) => e.date === "2026-08-20"), "origem [10+] 20/08");
  assert.ok(demo.entries.some((e) => e.date === "2026-08-26"), "destino 26/08");
  assert.ok(demo.entries.some((e) => e.date === "2026-08-24"), "destino 24/08");
  actions.replaceAll(createEmptyState());
  assert.equal(getAppData().entries.length, 0);
  actions.reseed();
  assert.equal(getAppData().entries.length, seed.entries.length);
  assert.equal(getAppData().compensations.length, seed.compensations.length);
  assert.ok(storeSrc.includes("buildSeedData()"));
  assert.ok(storeSrc.includes("withPreservedIdentity"));
  assert.ok(seedSrc.includes("createEmptyState"));
  assert.ok(seedSrc.includes("createDemoSeed"));
});

check("11. fixtures dos verify continuam disponíveis", () => {
  assert.ok(existsSync(join(root, "tests/fixtures/calendario-sebrae-2025-2026.csv")));
  assert.ok(existsSync(join(root, "tests/fixtures/calendario-ficticio-2026-2027.csv")));
  assert.ok(existsSync(join(root, "src/lib/seed-calendars.ts")));
  // O seed 4.0 é limpo (sem calendário); o calendário fictício continua
  // disponível na fixture legada 3.1.
  const legacy = buildLegacyDemoScenario();
  assert.ok((legacy.companyCalendars ?? []).length >= 1);
  assert.ok((legacy.companyCalendars ?? [])[0].entries.some((e) => e.tratamento === "COMPENSAR"));
  assert.ok((legacy.companyCalendars ?? [])[0].entries.some((e) => e.tratamento === "ABONADO_PARCIAL"));
});

check("12. backup continua funcionando", () => {
  const payload = buildBackupPayload(createEmptyState());
  const emptyParsed = parseBackup(JSON.stringify(payload));
  assert.equal(emptyParsed.ok, true);
  if (!emptyParsed.ok) return;
  assert.equal(emptyParsed.backup.entries.length, 0);

  const live: AppData = {
    ...createEmptyState(),
    user: { ...EMPTY_USER, name: "Maria Real", email: "maria@empresa.com" },
    entries: [
      { id: 1, date: "2026-08-27", time: "08:00", type: "entrada", note: null },
      { id: 2, date: "2026-08-27", time: "17:00", type: "saida", note: null },
    ],
  };
  const exported = buildBackupPayload(live);
  actions.replaceAll(createEmptyState());
  assert.equal(getAppData().entries.length, 0);
  const restored = parseBackup(JSON.stringify(exported));
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  actions.replaceAll({
    user: restored.backup.user,
    entries: restored.backup.entries,
    compensations: restored.backup.compensations,
    absences: restored.backup.absences,
    companyCalendars: restored.backup.companyCalendars,
    faltas: restored.backup.faltas,
    excessReasons: restored.backup.excessReasons,
  });
  assert.equal(getAppData().user.name, "Maria Real");
  assert.equal(getAppData().entries.length, 2);
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  // ETAPA 4L — botão único de backup no cartão "Dados e sincronização".
  assert.ok(cfg.includes("Baixar backup (JSON)"));
  assert.ok(cfg.includes("Importar backup (JSON)"));
  assert.ok(cfg.includes("O backup JSON reúne perfil, jornada, registros"));
});

check("13. calendário não cria trabalho fictício em feriado", () => {
  assert.equal(empty.companyCalendars, undefined);
  assert.ok(!empty.entries.some((e) => e.date === "2026-09-07"));
  const obl = activeCalendarObligations(
    empty.entries, empty.compensations, settings, CYCLE, empty.companyCalendars, TODAY,
  );
  assert.equal(obl.length, 0);
  const acordos = activeAcordos(empty.entries, empty.compensations, settings, CYCLE, empty.absences);
  assert.equal(acordos.length, 0);
});

check("14. Sem registro continua derivado corretamente", () => {
  const wed = "2026-08-26";
  const sat = "2026-08-22";
  const viewWed = companyDayContext(wed, empty.entries, empty.absences, empty.companyCalendars, settings);
  const viewSat = companyDayContext(sat, empty.entries, empty.absences, empty.companyCalendars, settings);
  assert.equal(isMissingExpectedRecord(wed, TODAY, viewWed, empty.faltas), true);
  assert.equal(isMissingExpectedRecord(sat, TODAY, viewSat, empty.faltas), false);
  const missing = missingExpectedRecordDates(PERIOD, TODAY, empty.entries, empty.absences, empty.companyCalendars, settings, empty.faltas);
  assert.ok(missing.includes(wed));
  assert.ok(!missing.includes(sat));
  assert.ok(!missing.includes(TODAY));
  assert.ok(missing.every((d) => d < TODAY));
});

check("15. Banco com base nova não recebe saldo fictício", () => {
  const bank = hourBankSummary(
    empty.entries, empty.compensations, empty.absences, empty.companyCalendars,
    empty.faltas, empty.excessReasons, settings, CYCLE, TODAY,
  );
  assert.equal(bank.realizedBalance, 0);
  assert.equal(bank.freeRegularTotal, 0);
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(bank.openNegativeTotal, 0);
  assert.equal(bank.excessSpecialFreeTotal, 0);
  assert.equal(bank.excessWithoutReason, 0);
  assert.equal(bank.plannedTotal, 0);
});

actions.replaceAll(createEmptyState());
console.log(`\nPRODUCTION BOOTSTRAP — OK (${passed} testes)`);
