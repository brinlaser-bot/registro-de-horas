/**
 * VERIFICAÇÃO — Data de início do controle.
 * TZ=America/Sao_Paulo npx tsx tests/verify-control-start-date.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { companyDayContext, parseCompanyCalendarCsv, buildCompanyCalendar } from "../src/lib/company-calendar.ts";
import {
  applyControlStartMigration,
  earliestOperationalDate,
  resolveControlStartDate,
} from "../src/lib/control-start.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { isMissingExpectedRecord, missingExpectedRecordDates, registrosTimelineDates } from "../src/lib/missing-records.ts";
import { situationsOfDay } from "../src/lib/day-situation.ts";
import { annualCycleBounds, getAnnualPointCycle, getPointPeriod } from "../src/lib/periods.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { buildLegacyDemoScenario, buildSeedData, createEmptyState, SEED_CONTROL_START } from "../src/lib/seed-data.ts";
import { actions, getAppData, hydrateAppData, parseStoredAppData, settingsOf } from "../src/lib/store.ts";
import { computeDay, dateToString } from "../src/lib/time.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const TODAY = "2026-08-29";
const START = "2026-08-29";
const PERIOD = getPointPeriod(TODAY);
const CYCLE = annualCycleBounds(getAnnualPointCycle(TODAY));
const WED = "2026-08-26";
const SAT = "2026-08-22";
const FUTURE = "2026-09-01";
const cals = seedCompanyCalendars();

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const viewOf = (date: string, entries: TimeEntry[] = [], calendars = cals) =>
  companyDayContext(date, entries, [], calendars, S);

check("1. produção nova recebe hoje local como data inicial", () => {
  const empty = createEmptyState(TODAY);
  assert.equal(empty.user.controlStartDate, TODAY);
  const hydrated = hydrateAppData(null, TODAY);
  assert.equal(hydrated.user.controlStartDate, TODAY);
  assert.equal(hydrated.entries.length, 0);
});

check("2. timezone America/Sao_Paulo não desloca a data", () => {
  const late = new Date(2026, 7, 29, 22, 0, 0);
  assert.equal(dateToString(late), "2026-08-29");
  assert.equal(late.toISOString().slice(0, 10), "2026-08-30");
  const src = srcOf("src/lib/seed-data.ts");
  assert.ok(src.includes("todayString()"));
  assert.ok(!src.includes("toISOString().slice(0, 10)"));
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(!cfg.includes("toISOString().slice(0,10)"));
});

check("3. dia anterior ao início não é Sem registro", () => {
  const v = viewOf(WED, []);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, [], START), false);
  const missing = missingExpectedRecordDates(PERIOD, TODAY, [], [], undefined, S, [], START);
  assert.ok(!missing.includes(WED));
  assert.ok(!missing.includes("2026-08-21"));
  assert.ok(!missing.includes("2026-08-24"));
  assert.ok(!missing.includes("2026-08-25"));
  assert.ok(!missing.includes("2026-08-27"));
  assert.ok(!missing.includes("2026-08-28"));
});

check("4. dia igual ao início pode seguir regra normal", () => {
  const v = viewOf(START, []);
  assert.equal(isMissingExpectedRecord(START, TODAY, v, [], START), false, "hoje = início: ainda não Sem registro");
});

check("5. dia posterior segue regra normal", () => {
  const laterToday = "2026-09-01";
  const monday = "2026-08-31";
  const v = viewOf(monday, []);
  assert.ok(v.effectiveExpected > 0);
  assert.equal(isMissingExpectedRecord(monday, laterToday, v, [], START), true);
});

check("6. hoje não vira Sem registro prematuramente", () => {
  const v = viewOf(TODAY, []);
  assert.equal(isMissingExpectedRecord(TODAY, TODAY, v, [], START), false);
});

check("7. futuro não vira Sem registro", () => {
  const v = viewOf(FUTURE, []);
  assert.equal(isMissingExpectedRecord(FUTURE, TODAY, v, [], START), false);
});

check("8. sábado/base 0 continua correto", () => {
  const v = viewOf(SAT, [], undefined);
  assert.equal(v.effectiveExpected, 0);
  assert.equal(isMissingExpectedRecord(SAT, TODAY, v, [], "2026-08-01"), false);
});

check("9. feriado/base 0 continua correto quando houver calendário", () => {
  const feriado = "2026-09-07";
  const v = viewOf(feriado);
  assert.equal(v.effectiveExpected, 0);
  assert.equal(isMissingExpectedRecord(feriado, "2026-09-08", v, [], "2026-08-01"), false);
});

check("10. ABONO PARCIAL posterior ao início continua funcionando", () => {
  const sebraeCsv = readFileSync(new URL("./fixtures/calendario-sebrae-2025-2026.csv", import.meta.url), "utf8");
  const parsed = parseCompanyCalendarCsv(sebraeCsv, S);
  assert.equal(parsed.ok, true);
  const sebrae = [buildCompanyCalendar(parsed.entries)];
  const cinzas = "2026-02-18";
  const v = companyDayContext(cinzas, [], [], sebrae, S);
  assert.equal(v.effectiveExpected, 240);
  /* 4D.4 (Parte I): dia com entrada do calendário NUNCA é "Sem registro" —
   * o evento explícito é fato conhecido: crédito 4h + jornada 4h ⇒ −4h
   * factual quando o dia passou sem as 4h regulares. */
  assert.equal(isMissingExpectedRecord(cinzas, TODAY, v, [], "2026-02-01"), false, "evento de calendário não é Sem registro");
  assert.equal(v.regularBalance, -240, "−4h factual (0h de 4h)");
  assert.equal(isMissingExpectedRecord(cinzas, TODAY, v, [], "2026-08-29"), false);
});

check("11. Resumo Dias sem registro respeita início", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  const days = srcOf("src/lib/resumo-days.ts");
  assert.ok(r.includes("user.controlStartDate"));
  assert.ok(days.includes("isMissingExpectedRecord(date, today, cctx, faltas, controlStartDate)"));
  const missing = missingExpectedRecordDates(PERIOD, TODAY, [], [], undefined, S, [], START);
  assert.equal(missing.length, 0);
});

check("12. alerta de Sem registro respeita início", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("detailStats.missingRecords > 0"));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("missingCount"));
  assert.ok(reg.includes("user.controlStartDate"));
});

check("13. ?semRegistro=1 respeita início", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("days.filter((d) => d.missingExpected)"));
  assert.ok(reg.includes("isMissingExpectedRecord(date, todayStr, cctx, faltas, user.controlStartDate)"));
  const missing = missingExpectedRecordDates(PERIOD, TODAY, [], [], undefined, S, [], START);
  assert.ok(!missing.includes(WED));
});

check("14. linha do tempo continua mostrando dias anteriores", () => {
  const dates = registrosTimelineDates(PERIOD);
  assert.ok(dates.includes("2026-08-21"));
  assert.ok(dates.includes(WED));
  assert.ok(dates.includes(START));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("registrosTimelineDates(range)"));
});

check("15. lançamento manual anterior ao início é permitido", () => {
  actions.replaceAll(createEmptyState(START));
  const res = actions.addEntry({ date: "2026-08-15", time: "08:00", type: "entrada", note: null, source: "manual" });
  assert.equal(res.ok, true, res.error);
  const res2 = actions.addEntry({ date: "2026-08-15", time: "17:00", type: "saida", note: null, source: "manual" });
  assert.equal(res2.ok, true, res2.error);
  assert.equal(getAppData().entries.filter((e) => e.date === "2026-08-15").length, 2);
});

check("16. fato anterior ao início entra nos cálculos quando explicitamente registrado", () => {
  const entries: TimeEntry[] = [
    { id: 1, date: "2026-08-15", time: "08:00", type: "entrada", note: null },
    { id: 2, date: "2026-08-15", time: "12:00", type: "saida", note: null },
    { id: 3, date: "2026-08-15", time: "13:00", type: "entrada", note: null },
    { id: 4, date: "2026-08-15", time: "17:00", type: "saida", note: null },
  ];
  const day = computeDay(entries, S);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.canFinalizeFinancialDay, true);
  const v = viewOf("2026-08-15", entries, undefined);
  assert.equal(isMissingExpectedRecord("2026-08-15", TODAY, v, [], START), false);
});

check("17. ausência de fato anterior não cria Banco negativo", () => {
  const empty = createEmptyState(START);
  const bank = hourBankSummary(
    empty.entries, empty.compensations, empty.absences, empty.companyCalendars,
    empty.faltas, empty.excessReasons, S, PERIOD, TODAY,
  );
  assert.equal(bank.realizedBalance, 0);
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(bank.openNegativeTotal, 0);
  assert.equal(bank.excessSpecialFreeTotal, 0);
  assert.equal(bank.plannedTotal, 0);
});

check("18. alteração da data atualiza UI imediatamente", () => {
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(cfg.includes("Início do controle"));
  assert.ok(cfg.includes("Data de início do controle"));
  assert.ok(cfg.includes("Registros anteriores continuam podendo ser lançados manualmente."));
  assert.ok(cfg.includes("Data de início do controle atualizada."));
  assert.ok(cfg.includes("actions.updateUser({ controlStartDate })"));
  assert.ok(!cfg.includes("location.reload"));
  actions.replaceAll(createEmptyState(START));
  actions.updateUser({ controlStartDate: "2026-08-01" });
  assert.equal(getAppData().user.controlStartDate, "2026-08-01");
});

check("19. configuração persiste após reload", () => {
  const empty = createEmptyState(START);
  const raw = JSON.stringify(empty);
  const again = hydrateAppData(raw, TODAY);
  assert.equal(again.user.controlStartDate, START);
});

check("20. clearAll preserva controlStartDate", () => {
  actions.reseed();
  assert.equal(getAppData().user.controlStartDate, SEED_CONTROL_START);
  actions.clearAll();
  assert.equal(getAppData().user.controlStartDate, SEED_CONTROL_START);
  assert.equal(getAppData().entries.length, 0);
});

check("21. reseed explícito continua funcionando", () => {
  const seed = buildSeedData();
  actions.reseed();
  assert.equal(getAppData().entries.length, seed.entries.length);
  assert.equal(getAppData().user.controlStartDate, SEED_CONTROL_START);
  assert.ok(SEED_CONTROL_START < "2026-08-18", "anterior ao primeiro dia demonstrativo");
});

check("22. estado existente com dados não é apagado", () => {
  const seed = buildSeedData();
  const { controlStartDate: _drop, ...userRest } = seed.user;
  const raw = JSON.stringify({ ...seed, user: userRest });
  const parsed = parseStoredAppData(raw);
  assert.ok(parsed);
  assert.equal(parsed!.entries.length, seed.entries.length);
  const hydrated = hydrateAppData(raw, TODAY);
  assert.equal(hydrated.entries.length, seed.entries.length);
  assert.ok(hydrated.entries.some((e) => e.date === "2026-08-24"));
});

check("23. estado antigo vazio recebe hoje na migração", () => {
  const blank = createEmptyState(TODAY);
  const user = { ...blank.user };
  delete (user as { controlStartDate?: string | null }).controlStartDate;
  const raw = JSON.stringify({ ...blank, user });
  const hydrated = hydrateAppData(raw, TODAY);
  assert.equal(hydrated.user.controlStartDate, TODAY);
  assert.equal(hydrated.entries.length, 0);
});

check("24. estado antigo com fatos não recebe hoje de forma que esconda fatos", () => {
  // Fixture legada 3.1: este check depende de fatos em 11/08 (cenário legado).
  const seed = buildLegacyDemoScenario();
  const user = { ...seed.user };
  delete (user as { controlStartDate?: string | null }).controlStartDate;
  const raw = JSON.stringify({ ...seed, user });
  const hydrated = hydrateAppData(raw, TODAY);
  const earliest = earliestOperationalDate(seed);
  assert.ok(earliest);
  assert.ok(earliest! < TODAY);
  assert.equal(hydrated.user.controlStartDate, earliest);
  assert.equal(resolveControlStartDate({ ...seed, user }, TODAY), earliest);
  const migrated = applyControlStartMigration({ ...seed, user }, TODAY);
  assert.equal(migrated.user.controlStartDate, earliest);
  const v = viewOf("2026-08-11", seed.entries.filter((e) => e.date === "2026-08-11"));
  assert.equal(isMissingExpectedRecord("2026-08-11", TODAY, v, seed.faltas, hydrated.user.controlStartDate), false);
});

check("25. filtros Situação continuam funcionando com fatos históricos", () => {
  // Fixture legada 3.1: 24/08 com 11h (situação "excedente-10") só existe no cenário legado.
  const seed = buildLegacyDemoScenario();
  const ids = situationsOfDay(
    "2026-08-24", TODAY, seed.entries, seed.absences, seed.companyCalendars, S,
    { compensations: seed.compensations, faltas: seed.faltas, excessReasons: seed.excessReasons, controlStartDate: seed.user.controlStartDate },
  );
  assert.ok(ids.includes("excedente-10"));
  const beforeStart = situationsOfDay(
    "2026-08-24", TODAY, seed.entries, seed.absences, seed.companyCalendars, S,
    { compensations: seed.compensations, faltas: seed.faltas, excessReasons: seed.excessReasons, controlStartDate: "2026-08-29" },
  );
  assert.ok(beforeStart.includes("excedente-10"), "fato histórico anterior ao início continua classificável");
});

check("cenário atual 29/08 vazio: Dias sem registro = 0 e Banco = 0", () => {
  const empty = createEmptyState(START);
  const missing = missingExpectedRecordDates(PERIOD, TODAY, empty.entries, empty.absences, empty.companyCalendars, S, empty.faltas, empty.user.controlStartDate);
  assert.equal(PERIOD.from, "2026-08-21");
  assert.equal(PERIOD.to, "2026-09-20");
  assert.equal(missing.length, 0);
  const bank = hourBankSummary(
    empty.entries, empty.compensations, empty.absences, empty.companyCalendars,
    empty.faltas, empty.excessReasons, S, PERIOD, TODAY,
  );
  assert.equal(bank.realizedBalance, 0);
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(bank.excessSpecialFreeTotal, 0);
  assert.equal(empty.compensations.length, 0);
});

actions.replaceAll(createEmptyState(TODAY));
console.log(`\nCONTROL START DATE — OK (${passed} testes)`);
