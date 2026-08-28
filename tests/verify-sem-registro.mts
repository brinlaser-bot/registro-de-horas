/**
 * Linha do tempo completa + Sem registro (pendência operacional).
 * TZ=America/Sao_Paulo npx tsx tests/verify-sem-registro.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { companyDayContext, parseCompanyCalendarCsv, buildCompanyCalendar } from "../src/lib/company-calendar.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { isMissingExpectedRecord, missingExpectedRecordDates, registrosTimelineDates } from "../src/lib/missing-records.ts";
import { isPunchDayPending, pendingPunchDates } from "../src/lib/pending-punches.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { computeDay } from "../src/lib/time.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Falta, TimeEntry, WorkSettings } from "../src/lib/types.ts";

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const cals = seedCompanyCalendars();
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const TODAY = "2026-08-28";
const RANGE = { from: "2026-08-21", to: "2026-09-20" };
const WED = "2026-08-26";
const SAT = "2026-08-22";
const FUTURE = "2026-09-01";
const viewOf = (
  date: string,
  entries: TimeEntry[] = [],
  absences: Absence[] = [],
  calendars = cals,
) => companyDayContext(date, entries, absences, calendars, S);

const sebraeCsv = readFileSync(new URL("./fixtures/calendario-sebrae-2025-2026.csv", import.meta.url), "utf8");
const sebraeParsed = parseCompanyCalendarCsv(sebraeCsv, S);
assert.equal(sebraeParsed.ok, true);
const sebraeCals = [buildCompanyCalendar(sebraeParsed.entries)];

check("1. período 21→20 gera um item por data", () => {
  const dates = registrosTimelineDates(RANGE);
  assert.equal(dates.length, 31);
  assert.equal(dates[0], "2026-08-21");
  assert.equal(dates[dates.length - 1], "2026-09-20");
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("registrosTimelineDates(range)"));
  assert.ok(!reg.includes("const dates = new Set<string>()"));
});

check("2. dia sem qualquer evento aparece na lista", () => {
  const dates = registrosTimelineDates(RANGE);
  assert.ok(dates.includes(WED));
  const v = viewOf(WED);
  assert.equal(v.ctx.day.empty, true);
  assert.equal(v.ctx.absence, undefined);
  assert.equal(v.calendarEntry, undefined);
});

check("3. dia útil passado base 8h sem batidas: Sem registro", () => {
  const v = viewOf(WED);
  assert.equal(v.effectiveExpected, 480);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, []), true);
});

check("4. esse dia NÃO altera Banco", () => {
  const onlyWed = { from: WED, to: WED };
  const bank = hourBankSummary([], [], [], cals, [], [], S, onlyWed, TODAY);
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(bank.openNegativeTotal, 0);
  assert.equal(bank.realizedBalance, 0);
  assert.equal(bank.freeRegularTotal, 0);
  const v = viewOf(WED);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, []), true);
});

check("5. sábado base 0 vazio: não Sem registro", () => {
  const v = viewOf(SAT, []);
  assert.equal(v.effectiveExpected, 0);
  assert.equal(isMissingExpectedRecord(SAT, TODAY, v, []), false);
});

check("6. feriado base 0: não Sem registro", () => {
  const feriado = "2026-06-04";
  const v = viewOf(feriado);
  assert.ok((v.effectiveExpected ?? 0) === 0);
  assert.equal(isMissingExpectedRecord(feriado, TODAY, v, []), false);
});

check("7. futuro vazio: não Sem registro", () => {
  const v = viewOf(FUTURE);
  assert.ok(v.effectiveExpected > 0);
  assert.equal(isMissingExpectedRecord(FUTURE, TODAY, v, []), false);
});

check("8. hoje vazio: não Sem registro", () => {
  const v = viewOf(TODAY);
  assert.equal(isMissingExpectedRecord(TODAY, TODAY, v, []), false);
});

check("9. férias: não Sem registro", () => {
  const abs: Absence[] = [{
    id: 1, kind: "ferias", startDate: WED, endDate: WED,
    duration: "integral", createdAt: 1,
  }];
  const v = viewOf(WED, [], abs);
  assert.equal(v.effectiveExpected, 0);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, []), false);
});

check("10. falta prevista: não Sem registro", () => {
  const futura = "2026-08-31";
  const faltas: Falta[] = [{ id: 1, date: futura, createdAt: 1 }];
  const v = viewOf(futura);
  assert.equal(isMissingExpectedRecord(futura, TODAY, v, faltas), false);
});

check("11. ABONO PARCIAL passado base efetiva 4h vazio: Sem registro", () => {
  const cinzas = "2026-02-18";
  const v = companyDayContext(cinzas, [], [], sebraeCals, S);
  assert.equal(v.effectiveExpected, 240);
  assert.equal(isMissingExpectedRecord(cinzas, TODAY, v, []), true);
});

check("12. entrada isolada: Registro pendente, não Sem registro", () => {
  const entries = [punch(WED, "08:00", "entrada")];
  const v = viewOf(WED, entries);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, []), false);
  const day = computeDay(entries, S);
  assert.equal(isPunchDayPending({
    consistent: day.consistent, open: day.open, empty: day.empty, date: WED, today: TODAY,
  }), true);
  assert.ok(pendingPunchDates(entries, S, TODAY, RANGE).includes(WED));
});

check("13. resumo compacto mostra Dias com registro / Pendentes / Sem registro", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("Dias com registro"));
  assert.ok(reg.includes("Pendentes"));
  assert.ok(reg.includes("Sem registro"));
  assert.ok(reg.includes("{missingCount}"));
});

check("14. Ver dias sem registro abre /registros?semRegistro=1", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes('router.replace("/registros?semRegistro=1")'));
  assert.ok(reg.includes("Ver dias sem registro"));
});

check("15. filtro mostra somente dias Sem registro", () => {
  const dates = missingExpectedRecordDates(RANGE, TODAY, [], [], cals, S, []);
  assert.ok(dates.includes(WED));
  assert.ok(!dates.includes(SAT));
  assert.ok(!dates.includes(TODAY));
  assert.ok(!dates.includes(FUTURE));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("days.filter((d) => d.missingExpected)"));
  assert.ok(reg.includes("missingOnly"));
});

check("16. voltar remove filtro", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("filtro aplicado"));
  assert.ok(reg.includes("Voltar aos registros do período"));
  assert.ok(reg.includes('router.replace("/registros")'));
});

check("17. consulta por data encontra dia vazio", () => {
  const one = registrosTimelineDates({ from: WED, to: WED });
  assert.deepEqual(one, [WED]);
  const v = viewOf(WED);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, []), true);
});

check("18. consulta por intervalo mostra todas as datas", () => {
  const dates = registrosTimelineDates({ from: "2026-08-10", to: "2026-08-15" });
  assert.equal(dates.length, 6);
  assert.deepEqual(dates, [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15",
  ]);
});

check("19. lançar batida válida remove Sem registro", () => {
  const before = viewOf(WED, []);
  assert.equal(isMissingExpectedRecord(WED, TODAY, before, []), true);
  const entries = [
    punch(WED, "08:00", "entrada"), punch(WED, "12:00", "saida"),
    punch(WED, "13:00", "entrada"), punch(WED, "17:00", "saida"),
  ];
  const after = viewOf(WED, entries);
  assert.equal(isMissingExpectedRecord(WED, TODAY, after, []), false);
  const day = computeDay(entries, S);
  assert.equal(day.canFinalizeFinancialDay, true);
});

check("20. registrar ausência válida remove Sem registro", () => {
  const faltas: Falta[] = [{ id: 1, date: WED, createdAt: 1 }];
  const v = viewOf(WED, []);
  assert.equal(isMissingExpectedRecord(WED, TODAY, v, faltas), false);
});

check("21. resolver último item limpa ?semRegistro=1", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("wantMissing && missingCount === 0"));
  assert.ok(reg.includes('router.replace("/registros")'));
});

check("22. Ver mais detalhes do período contém Dias sem registro", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes('label="Dias sem registro"'));
  assert.ok(r.includes("detailStats.missingRecords"));
});

check("23. /resumo possui CTA Ver dias sem registro quando count > 0", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("detailStats.missingRecords > 0"));
  assert.ok(r.includes("Ver dias sem registro"));
  assert.ok(r.includes("Existem dias de expediente sem registro ou justificativa."));
});

check("24. CTA do Resumo abre /registros?semRegistro=1", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes('href="/registros?semRegistro=1"'));
});

check("25. filtros pendentes e semRegistro não permanecem ativos juntos", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(!reg.includes("pendentes=1&semRegistro"));
  assert.ok(!reg.includes("semRegistro=1&pendentes"));
  assert.ok(reg.includes('searchParams.get("semRegistro") === "1"'));
  assert.ok(reg.includes("wantPending && wantMissing"));
  assert.ok(reg.includes('router.replace("/registros?semRegistro=1")'));
  assert.ok(reg.includes('router.replace("/registros?pendentes=1")'));
  assert.ok(reg.includes("if (wantPending) router.replace(\"/registros\")"));
  assert.ok(reg.includes("if (wantMissing) router.replace(\"/registros\")"));
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes('href="/registros?pendentes=1"'));
  assert.ok(r.includes('href="/registros?semRegistro=1"'));
});

check("26. card Sem registro usa aviso âmbar (não vermelho) e ações existentes", () => {
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("⚠ Sem registro"));
  assert.ok(card.includes("Este dia tinha jornada prevista, mas não possui registros ou justificativa."));
  assert.ok(card.includes("Preencher registros do dia"));
  assert.ok(card.includes("Registrar falta"));
  assert.ok(card.includes("missingExpected"));
  assert.ok(!card.includes("Falta automática"));
});

check("27. hoje vazio permanece Jornada não iniciada", () => {
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Jornada não iniciada"));
  assert.ok(card.includes("Dia futuro"));
});

console.log(`\nSEM REGISTRO — OK (${passed} testes)`);
