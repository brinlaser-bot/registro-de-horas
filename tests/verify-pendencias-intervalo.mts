/**
 * Pendências de batida, intervalo automático derivado e busca por uma data.
 * TZ=America/Sao_Paulo npx tsx tests/verify-pendencias-intervalo.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyzePunches, suggestedPunchTypeAt } from "../src/lib/punches.ts";
import { computeDay, insertPunchError } from "../src/lib/time.ts";
import { breakRequiredForExpected, derivedAutomaticBreak, predictedBreakWindow } from "../src/lib/breaks.ts";
import { pendingPunchDates, pendingPunchDatesInCycle } from "../src/lib/pending-punches.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { buildDebtDays } from "../src/lib/debt.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import type { TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = { id: 1, name: "Teste", email: "t@t.com", ...settings, birthDate: null };
const cals = seedCompanyCalendars();
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

const reset = (entries: TimeEntry[] = []) =>
  actions.replaceAll({ user, entries, compensations: [], absences: [], companyCalendars: cals, faltas: [], excessReasons: [] });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const S = settings;
const PAST = "2026-08-21";
const bankRange = { from: "2026-05-01", to: "2027-04-30" };

check("A. passado 08E 13E 17S: inconsistente, sem déficit/crédito/10+, Banco inalterado", () => {
  const entries = [punch(PAST, "08:00", "entrada"), punch(PAST, "13:00", "entrada"), punch(PAST, "17:00", "saida")];
  const day = computeDay(entries, S);
  assert.equal(day.consistent, false);
  assert.equal(day.financialPending, true);
  assert.equal(day.canFinalizeFinancialDay, false);
  assert.equal(day.workedMinutes, 0, "não usa pares confirmados como saldo");
  assert.equal(day.excessMinutes, 0);
  assert.equal(day.balanceMinutes, 0);
  const ctx = companyDayContext(PAST, entries, [], cals, S);
  assert.equal(ctx.adjustedDeficit, 0);
  assert.equal(ctx.adjustedBalance, 0);
  const debts = buildDebtDays(entries, [], S, bankRange, [], cals, [], "2026-08-26");
  assert.equal(debts.filter((d) => d.date === PAST && d.kind === "deficit").length, 0);
  const emptyBank = hourBankSummary([], [], [], cals, [], [], S, bankRange, "2026-08-26");
  const withBank = hourBankSummary(entries, [], [], cals, [], [], S, bankRange, "2026-08-26");
  assert.equal(withBank.openNegativeTotal, emptyBank.openNegativeTotal);
  assert.equal(withBank.freeRegularTotal, emptyBank.freeRegularTotal);
});

check("B. passado 08E: incompleto, sem −8h, Banco inalterado", () => {
  const entries = [punch(PAST, "08:00", "entrada")];
  const day = computeDay(entries, S);
  assert.equal(day.open, true);
  assert.equal(day.consistent, true);
  assert.equal(day.financialPending, true);
  assert.equal(day.canFinalizeFinancialDay, false);
  const ctx = companyDayContext(PAST, entries, [], cals, S);
  assert.equal(ctx.adjustedDeficit, 0, "sem −8h");
  const emptyBank = hourBankSummary([], [], [], cals, [], [], S, bankRange, "2026-08-26");
  const withBank = hourBankSummary(entries, [], [], cals, [], [], S, bankRange, "2026-08-26");
  assert.equal(withBank.openNegativeTotal, emptyBank.openNegativeTotal);
});

check("C. hoje inconsistente: não é jornada encerrada; sem −4h", () => {
  const TODAY = "2026-08-28";
  const entries = [punch(TODAY, "08:00", "entrada"), punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:00", "saida")];
  const day = computeDay(entries, S);
  assert.equal(day.consistent, false);
  assert.equal(day.open, false);
  assert.equal(day.workedMinutes, 0);
  assert.notEqual(day.status, "ok");
  const ctx = companyDayContext(TODAY, entries, [], cals, S);
  assert.equal(ctx.adjustedDeficit, 0);
  const smart = srcOf("src/components/smart-exit.tsx");
  assert.ok(smart.includes("Registro inconsistente"));
});

check("D. hoje 08E 12S 13E: válida aberta", () => {
  const TODAY = "2026-08-26";
  const entries = [punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"), punch(TODAY, "13:00", "entrada")];
  const day = computeDay(entries, S);
  assert.equal(day.consistent, true);
  assert.equal(day.open, true);
  assert.equal(day.canFinalizeFinancialDay, false);
  assert.equal(analyzePunches(entries).isComplete, false);
});

check("E. inserir 12S em 08E 13E 17S: aceita e vira 8h", () => {
  const existing = [punch(PAST, "08:00", "entrada"), punch(PAST, "13:00", "entrada"), punch(PAST, "17:00", "saida")];
  assert.equal(suggestedPunchTypeAt(existing, "12:00"), "saida");
  const add = punch(PAST, "12:00", "saida");
  assert.equal(insertPunchError(existing, add), null);
  const day = computeDay([...existing, add], S);
  assert.equal(day.consistent, true);
  assert.equal(day.canFinalizeFinancialDay, true);
  assert.equal(day.workedMinutes, 480);
});

check("F. entrada 08:40 em dia 8h: intervalo previsto 12:40–13:40", () => {
  const entries = [punch("2026-08-28", "08:40", "entrada")];
  const pred = predictedBreakWindow(entries, S, 480);
  assert.ok(pred);
  assert.equal(pred.start, "12:40");
  assert.equal(pred.end, "13:40");
});

check("G. 08:40–17:20 sem intermediárias: 8h40 − 1h = 7h40; derivado, não punch", () => {
  const entries = [punch(PAST, "08:40", "entrada"), punch(PAST, "17:20", "saida")];
  const day = computeDay(entries, S);
  assert.equal(day.workedMinutes, 460);
  assert.equal(day.lunchDeductedMinutes, 60);
  assert.ok(day.derivedBreak);
  assert.equal(day.derivedBreak?.source, "automatic_break");
  assert.equal(day.entries.length, 2, "não persiste batidas falsas");
  const a = analyzePunches(entries);
  const der = derivedAutomaticBreak(a, S, 480);
  assert.ok(der);
});

check("H. editar automático 12:40–13:40 para 12:20–13:05 → 7h55 explícito", () => {
  reset([punch(PAST, "08:40", "entrada"), punch(PAST, "17:20", "saida")]);
  const res = actions.addEntries([
    { date: PAST, time: "12:20", type: "saida", note: null, source: "manual" },
    { date: PAST, time: "13:05", type: "entrada", note: null, source: "manual" },
  ]);
  assert.equal(res.ok, true, res.error);
  const day = computeDay(getAppData().entries.filter((e) => e.date === PAST), S);
  assert.equal(day.lunchDeductedMinutes, 0);
  assert.equal(day.workedMinutes, 475);
  assert.equal(day.derivedBreak ?? null, null);
});

check("I. 08:40 12:30 13:15 17:20: intervalo 45min, sem automático", () => {
  const entries = [
    punch(PAST, "08:40", "entrada"), punch(PAST, "12:30", "saida"),
    punch(PAST, "13:15", "entrada"), punch(PAST, "17:20", "saida"),
  ];
  const day = computeDay(entries, S);
  assert.equal(day.lunchDeductedMinutes, 0);
  assert.equal(day.derivedBreak ?? null, null);
  assert.equal(day.workedMinutes, 475);
});

check("J. 08–17 + intervalo atômico 12:30/13:15 = 8h15", () => {
  reset([punch(PAST, "08:00", "entrada"), punch(PAST, "17:00", "saida")]);
  assert.equal(actions.addEntries([
    { date: PAST, time: "12:30", type: "saida", note: null },
    { date: PAST, time: "13:15", type: "entrada", note: null },
  ]).ok, true);
  const day = computeDay(getAppData().entries.filter((e) => e.date === PAST), S);
  assert.equal(day.workedMinutes, 495);
  assert.equal(day.lunchDeductedMinutes, 0);
});

check("K. base 4h 13–17: não exige intervalo 1h", () => {
  assert.equal(breakRequiredForExpected(240, S), false);
  const entries = [punch("2027-02-10", "13:00", "entrada"), punch("2027-02-10", "17:00", "saida")];
  const a = analyzePunches(entries);
  assert.equal(derivedAutomaticBreak(a, S, 240), null);
});

check("L. dia 8h com entrada 13:00: NÃO é meia jornada", () => {
  assert.equal(breakRequiredForExpected(480, S), true);
  const ctx = companyDayContext("2026-08-21", [punch("2026-08-21", "13:00", "entrada")], [], undefined, S);
  assert.equal(ctx.effectiveExpected, 480);
});

check("M. um dia com várias batidas inválidas = 1 pendência", () => {
  const entries = [
    punch(PAST, "08:00", "entrada"), punch(PAST, "13:00", "entrada"), punch(PAST, "17:00", "saida"),
  ];
  const dates = pendingPunchDates(entries, S, "2026-08-26");
  assert.equal(dates.length, 1);
  assert.equal(dates[0], PAST);
});

check("N. corrigir último pendente zera contador e Banco recalcula", () => {
  reset([
    punch(PAST, "08:00", "entrada"), punch(PAST, "13:00", "entrada"), punch(PAST, "18:00", "saida"),
  ]);
  assert.equal(pendingPunchDates(getAppData().entries, S, "2026-08-26").length, 1);
  const before = hourBankSummary(getAppData().entries, [], [], cals, [], [], S, { from: PAST, to: PAST }, "2026-08-26");
  assert.equal(before.realizedBalance, 0, "pendente não inventa saldo no Banco");
  assert.equal(actions.addEntry({ date: PAST, time: "12:00", type: "saida", note: null }).ok, true);
  assert.equal(pendingPunchDates(getAppData().entries, S, "2026-08-26").length, 0);
  const after = hourBankSummary(getAppData().entries, [], [], cals, [], [], S, { from: PAST, to: PAST }, "2026-08-26");
  // 08–12 + 13–18 = 9h → +1h regular livre
  assert.equal(after.realizedBalance, 60);
});

check("O. Ver pendências aponta /registros?pendentes=1", () => {
  const home = srcOf("src/app/(app)/page.tsx");
  assert.ok(home.includes("/registros?pendentes=1"));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("pendingOnly"));
  assert.ok(reg.includes("Ver todos os registros"));
});

check("P. busca só DE: query from=to", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("if (from && !to)"));
  assert.ok(reg.includes('setQuery({ from, to: from })'));
  assert.ok(!reg.includes("Informe as datas inicial e final."));
});

check("Q. Cinzas ABONO PARCIAL 08–12 / 13–17 / base 4h / sem COMPENSAR", () => {
  const ctx = companyDayContext("2027-02-10", [], [], cals, S);
  assert.equal(ctx.calendarEntry?.tratamento, "ABONADO_PARCIAL");
  assert.equal(ctx.effectiveExpected, 240);
  assert.equal(ctx.calendarioACompensar, 0);
  assert.equal(ctx.calendarEntry?.abonoStart ?? "08:00", "08:00");
  assert.equal(ctx.calendarEntry?.abonoEnd ?? "12:00", "12:00");
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Período abonado"));
  assert.ok(card.includes("Jornada a cumprir"));
});

check("UI. Corrigir registros + intervalo no card + modal labels", () => {
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Corrigir registros"));
  assert.ok(card.includes("Registrar intervalo"));
  assert.ok(card.includes("Adicionar batida"));
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("O que deseja registrar?"));
  assert.ok(modal.includes("Horário trabalhado"));
  assert.ok(modal.includes("Intervalo / pausa"));
  assert.ok(modal.includes("Saída para intervalo"));
});

reset([]);
console.log(`\nPENDÊNCIAS/INTERVALO — OK (${passed} testes)`);
