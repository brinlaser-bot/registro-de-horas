/**
 * VERIFICAÇÃO — Apagar todos os dados zera o estado OPERACIONAL.
 *
 * clearAll remove fatos (batidas, faltas, ausências, calendário, compensações)
 * e preserva perfil/jornada. Seed explícito continua existindo.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-clear-all.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { activeAcordos, activeCalendarObligations } from "../src/lib/debt.ts";
import {
  futureCommitmentsSummary,
  hourBankSummary,
  specialExcessBook,
} from "../src/lib/hour-bank.ts";
import { isMissingExpectedRecord } from "../src/lib/missing-records.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildSeedData, createEmptyState } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string) => readFileSync(join(root, rel), "utf8");

const TODAY = "2026-08-28";
const CYCLE = annualCycleBounds(getAnnualPointCycle(TODAY));

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

const storeSrc = srcOf("src/lib/store.ts");
const cfgSrc = srcOf("src/app/(app)/configuracoes/page.tsx");

actions.reseed();
const before = getAppData();
assert.ok(before.entries.length > 0, "pré-condição: seed carregado");
assert.ok((before.companyCalendars ?? []).length > 0);
assert.ok(before.faltas.length > 0);
assert.ok(before.absences.length > 0);
assert.ok(before.compensations.length > 0);

const preservedUser = { ...before.user };
actions.clearAll();
const after = getAppData();
const settings = settingsOf(after.user);

check("1. clearAll remove punches", () => {
  assert.equal(after.entries.length, 0);
});

check("2. remove faltas", () => {
  assert.equal(after.faltas.length, 0);
});

check("3. remove faltas previstas", () => {
  assert.ok(before.faltas.some((f) => f.date > TODAY), "seed tinha falta futura");
  assert.equal(after.faltas.length, 0);
});

check("4. remove férias", () => {
  assert.equal(after.absences.filter((a) => a.kind === "ferias").length, 0);
});

check("5. remove afastamentos", () => {
  assert.equal(after.absences.length, 0);
});

check("6. remove abonos/abono parcial persistidos", () => {
  assert.ok(before.absences.some((a) => a.kind === "abono"));
  assert.equal(after.absences.filter((a) => a.kind === "abono").length, 0);
  const cals = after.companyCalendars ?? [];
  assert.ok(!cals.some((c) => c.entries.some((e) => e.tratamento === "ABONADO_PARCIAL")));
});

check("7. remove acordos", () => {
  assert.ok(before.absences.some((a) => a.kind === "acordado"));
  assert.equal(after.absences.filter((a) => a.kind === "acordado").length, 0);
  assert.equal(activeAcordos(after.entries, after.compensations, settings, CYCLE, after.absences).length, 0);
});

check("8. remove calendário/eventos", () => {
  assert.equal(after.companyCalendars, undefined);
  assert.equal((after.companyCalendars ?? []).length, 0);
});

check("9. remove obrigações COMPENSAR", () => {
  const obl = activeCalendarObligations(
    after.entries, after.compensations, settings, CYCLE, after.companyCalendars, TODAY,
  );
  assert.equal(obl.length, 0);
});

check("10. remove compensações", () => {
  assert.equal(after.compensations.length, 0);
});

check("11. remove programações", () => {
  assert.equal(after.compensations.filter((c) => c.status === "pendente").length, 0);
});

check("12. remove realocações", () => {
  assert.equal(after.compensations.filter((c) => c.portion === "especial" || c.status === "concluida").length, 0);
});

check("13. remove motivos [10+]", () => {
  assert.equal((after.excessReasons ?? []).length, 0);
});

check("14. remove pendências derivadas/persistidas", () => {
  const book = specialExcessBook(
    after.entries, after.compensations, after.absences, after.companyCalendars,
    settings, after.excessReasons, CYCLE, TODAY,
  );
  assert.equal(book.days.length, 0);
  assert.equal(book.free, 0);
  assert.equal(after.compensations.length, 0);
  assert.equal(after.faltas.length, 0);
  assert.equal(after.absences.length, 0);
});

const bank = hourBankSummary(
  after.entries, after.compensations, after.absences, after.companyCalendars,
  after.faltas, after.excessReasons, settings, CYCLE, TODAY,
);
const future = futureCommitmentsSummary(
  after.entries, after.compensations, after.absences, after.companyCalendars,
  after.faltas, settings, TODAY,
);
const excessBook = specialExcessBook(
  after.entries, after.compensations, after.absences, after.companyCalendars,
  settings, after.excessReasons, CYCLE, TODAY,
);

check("15. Banco após clearAll = 0", () => {
  assert.equal(bank.realizedBalance, 0);
  assert.equal(bank.freeRegularTotal, 0);
  assert.equal(bank.plannedTotal, 0);
});

check("16. saldo negativo aberto = 0", () => {
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(bank.openNegativeTotal, 0);
});

check("17. [10+] = 0", () => {
  assert.equal(bank.excessSpecialFreeTotal, 0);
  assert.equal(bank.excessWithoutReason, 0);
  assert.equal(excessBook.original, 0);
  assert.equal(excessBook.free, 0);
  assert.equal(excessBook.planned, 0);
  assert.equal(excessBook.realized, 0);
});

check("18. previsão de calendário = 0", () => {
  assert.equal(future.calendarMinutes, 0);
});

check("19. previsão de faltas = 0", () => {
  assert.equal(future.faltaMinutes, 0);
});

check("20. previsão de acordos = 0", () => {
  assert.equal(future.acordoMinutes, 0);
  assert.equal(future.totalOriginal, 0);
});

check("21. Central de Horas fica zerada", () => {
  assert.equal(excessBook.free, 0);
  assert.equal(excessBook.planned, 0);
  assert.equal(excessBook.realized, 0);
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(activeCalendarObligations(
    after.entries, after.compensations, settings, CYCLE, after.companyCalendars, TODAY,
  ).length, 0);
  assert.equal(activeAcordos(after.entries, after.compensations, settings, CYCLE, after.absences).length, 0);
});

check("22. configurações estruturais permanecem", () => {
  assert.equal(after.user.workStart, preservedUser.workStart);
  assert.equal(after.user.workEnd, preservedUser.workEnd);
  assert.equal(after.user.lunchStart, preservedUser.lunchStart);
  assert.equal(after.user.lunchEnd, preservedUser.lunchEnd);
  assert.equal(after.user.maxDailyMinutes, preservedUser.maxDailyMinutes);
  assert.equal(after.user.autoDeductLunch, preservedUser.autoDeductLunch);
  assert.equal(getAnnualPointCycle("2026-04-30"), "2025/2026");
  assert.equal(getAnnualPointCycle("2026-05-01"), "2026/2027");
});

check("23. perfil do usuário permanece", () => {
  assert.equal(after.user.name, preservedUser.name);
  assert.equal(after.user.email, preservedUser.email);
  assert.equal(after.user.birthDate, preservedUser.birthDate);
  assert.equal(after.user.id, preservedUser.id);
});

check("24. seed não volta sozinho após clearAll", () => {
  const clearFn = storeSrc.slice(storeSrc.indexOf("clearAll()"), storeSrc.indexOf("replaceAll"));
  assert.ok(!clearFn.includes("buildSeedData"));
  assert.ok(clearFn.includes("companyCalendars: undefined"));
  assert.ok(clearFn.includes("faltas: []"));
  assert.ok(clearFn.includes("absences: []"));
  assert.ok(!/\blocalStorage\.clear\s*\(/.test(storeSrc));
  assert.ok(!/\blocalStorage\.clear\s*\(/.test(cfgSrc));
  assert.equal(getAppData().entries.length, 0);
  assert.equal((getAppData().companyCalendars ?? []).length, 0);
});

check("25. reseed explícito continua funcionando", () => {
  const seed = buildSeedData();
  actions.reseed();
  const restored = getAppData();
  assert.equal(restored.entries.length, seed.entries.length);
  assert.equal(restored.compensations.length, seed.compensations.length);
  assert.ok((restored.companyCalendars ?? []).length > 0);
  assert.ok(restored.faltas.length > 0);
  assert.ok(restored.absences.length > 0);
  actions.clearAll();
  assert.equal(getAppData().entries.length, 0);
  actions.reseed();
  assert.equal(getAppData().entries.length, seed.entries.length);
});

check("26. backup/importação continuam funcionando", () => {
  actions.reseed();
  const payload = buildBackupPayload(getAppData());
  assert.ok(payload.entries.length > 0);
  actions.clearAll();
  const parsed = parseBackup(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  actions.replaceAll({
    user: parsed.backup.user,
    entries: parsed.backup.entries,
    compensations: parsed.backup.compensations,
    absences: parsed.backup.absences,
    companyCalendars: parsed.backup.companyCalendars,
    faltas: parsed.backup.faltas,
    excessReasons: parsed.backup.excessReasons,
  });
  assert.equal(getAppData().entries.length, payload.entries.length);
  assert.ok((getAppData().companyCalendars ?? []).length > 0);
});

check("27. Sem registro continua derivado sem criar dívida", () => {
  actions.clearAll();
  const d = getAppData();
  const s = settingsOf(d.user);
  const wed = "2026-08-26";
  const view = companyDayContext(wed, d.entries, d.absences, d.companyCalendars, s);
  assert.equal(isMissingExpectedRecord(wed, TODAY, view, d.faltas), true);
  const bankAfter = hourBankSummary(
    d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, d.excessReasons, s, CYCLE, TODAY,
  );
  assert.equal(bankAfter.openDeficitTotal, 0);
  assert.equal(bankAfter.openNegativeTotal, 0);
  assert.equal(bankAfter.realizedBalance, 0);
});

check("28. UI atualiza imediatamente e confirmação é explícita", () => {
  assert.ok(cfgSrc.includes("ConfirmDialog"));
  assert.ok(cfgSrc.includes('title="Apagar todos os dados?"'));
  assert.ok(cfgSrc.includes('confirmLabel="Apagar todos os dados"'));
  assert.ok(cfgSrc.includes("As configurações gerais serão mantidas."));
  assert.ok(cfgSrc.includes("Dados do controle apagados."));
  assert.ok(cfgSrc.includes("danger"));
  assert.ok(cfgSrc.includes("setClearOpen(true)"));
  assert.ok(cfgSrc.includes("actions.clearAll()"));
  assert.ok(!cfgSrc.includes("location.reload"));
  assert.ok(!cfgSrc.includes("window.confirm(\"Apagar todos os registros e compensações"));
  assert.ok(cfgSrc.includes("{clearOpen && ("));
  assert.ok(!cfgSrc.includes("localStorage.clear"));
  assert.ok(storeSrc.includes("user: d.user"));
});

actions.replaceAll(createEmptyState());
console.log(`\nCLEAR ALL — OK (${passed} testes)`);
