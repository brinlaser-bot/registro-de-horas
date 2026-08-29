/**
 * Excedente [10+] no CICLO ANUAL: Visão geral, Compensações e Resumo.
 * TZ=America/Sao_Paulo npx tsx tests/verify-excedente-ciclo.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  hourBankSummary,
  pendingSpecialExcessDays,
  specialExcessBook,
  specialExcessLedger,
} from "../src/lib/hour-bank.ts";
import { annualCycleBounds, getAnnualPointCycle, getPointPeriod } from "../src/lib/periods.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { computeDay } from "../src/lib/time.ts";
import type { Compensation, ExcessReason, TimeEntry, WorkSettings } from "../src/lib/types.ts";

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const cals = seedCompanyCalendars();
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const TODAY = "2026-08-28";
const CYCLE = annualCycleBounds(getAnnualPointCycle(TODAY));
const PERIOD = getPointPeriod(TODAY);
const seed = buildSeedData();

function book(range = CYCLE, today = TODAY, extra?: {
  entries?: TimeEntry[];
  comps?: Compensation[];
  reasons?: ExcessReason[];
}) {
  return specialExcessBook(
    extra?.entries ?? seed.entries,
    extra?.comps ?? seed.compensations,
    seed.absences,
    cals,
    S,
    extra?.reasons ?? seed.excessReasons,
    range,
    today,
  );
}

function pending(range = CYCLE, today = TODAY, extra?: Parameters<typeof book>[2]) {
  return pendingSpecialExcessDays(book(range, today, extra));
}

function day11h(id0: number, date: string): TimeEntry[] {
  return [
    { id: id0, date, time: "08:00", type: "entrada", note: null },
    { id: id0 + 1, date, time: "12:00", type: "saida", note: null },
    { id: id0 + 2, date, time: "13:00", type: "entrada", note: null },
    { id: id0 + 3, date, time: "20:00", type: "saida", note: null },
  ];
}

check("1. [10+] livre do período atual aparece", () => {
  const dates = pending().map((d) => d.date);
  assert.ok(dates.includes("2026-08-24"));
  const d = pending().find((x) => x.date === "2026-08-24")!;
  assert.ok(d.free > 0);
  assert.equal(PERIOD.from, "2026-08-21");
});

check("2. [10+] livre de período anterior do mesmo ciclo também aparece", () => {
  const dates = pending().map((d) => d.date);
  assert.ok(dates.includes("2026-08-11"), "11/08 é 21/07→20/08, mesmo ciclo");
  assert.ok("2026-08-11" < PERIOD.from);
  assert.ok("2026-08-11" >= CYCLE.from);
});

check("3. [10+] livre com motivo aparece", () => {
  const d = pending().find((x) => x.date === "2026-08-24")!;
  assert.equal(d.hasReason, true);
  assert.ok(d.free > 0);
});

check("4. [10+] livre sem motivo aparece", () => {
  const d = pending().find((x) => x.date === "2026-08-11")!;
  assert.equal(d.hasReason, false);
  assert.ok(d.free > 0);
});

check("5. sem motivo mostra Registrar motivo", () => {
  const panel = srcOf("src/components/excess-panel.tsx");
  assert.ok(panel.includes("Registrar motivo"));
  assert.ok(panel.includes("Motivo pendente"));
});

check("6. com motivo mostra Realocar excedente", () => {
  const panel = srcOf("src/components/excess-panel.tsx");
  assert.ok(panel.includes("Realocar excedente"));
  assert.ok(panel.includes("Alterar motivo"));
  assert.ok(panel.includes("disabled={!reason}"));
});

check("7. programado 100%, livre 0, não aparece", () => {
  const led = specialExcessLedger("2026-08-18", seed.compensations, 45);
  assert.equal(led.free, 0);
  assert.equal(led.status, "programado");
  assert.ok(!pending().some((d) => d.date === "2026-08-18"));
});

check("8. realizado 100%, livre 0, não aparece", () => {
  const led = specialExcessLedger("2026-08-17", seed.compensations, 30);
  assert.equal(led.free, 0);
  assert.equal(led.status, "tratado");
  assert.ok(!pending().some((d) => d.date === "2026-08-17"));
});

check("9. parcialmente realizado com livre >0 aparece", () => {
  const d = pending().find((x) => x.date === "2026-08-24")!;
  assert.ok(d.realized > 0);
  assert.ok(d.free > 0);
});

check("10. ordenação mais recente → mais antigo", () => {
  const dates = pending().map((d) => d.date);
  const sorted = [...dates].sort((a, b) => b.localeCompare(a));
  assert.deepEqual(dates, sorted);
  assert.ok(dates.indexOf("2026-08-24") < dates.indexOf("2026-08-11"));
});

check("11. pendência de ciclo anterior não aparece após 01/05", () => {
  const prevCycleDay = "2026-04-29";
  const afterClose = "2026-05-02";
  const entries = day11h(1, prevCycleDay);
  const reasons: ExcessReason[] = [{
    id: 1, date: prevCycleDay, reason: "demanda-urgente",
    customReason: null, observation: null, createdAt: 1, updatedAt: 1,
  }];
  const oldCycle = annualCycleBounds(getAnnualPointCycle(prevCycleDay));
  const newCycle = annualCycleBounds(getAnnualPointCycle(afterClose));
  assert.notEqual(oldCycle.from, newCycle.from);
  const inOld = pending(oldCycle, "2026-04-30", { entries, comps: [], reasons });
  assert.ok(inOld.some((d) => d.date === prevCycleDay && d.free > 0));
  const inNew = pending(newCycle, afterClose, { entries, comps: [], reasons });
  assert.ok(!inNew.some((d) => d.date === prevCycleDay));
});

check("12. Excedente livre no ciclo soma todos os freeMinutes", () => {
  const b = book();
  const sum = pending().reduce((s, d) => s + d.free, 0);
  assert.equal(b.free, sum);
  assert.ok(b.free > 0);
});

check("13. inclui freeMinutes de diferentes períodos 21→20", () => {
  const dates = pending().map((d) => d.date);
  assert.ok(dates.includes("2026-08-24"));
  assert.ok(dates.includes("2026-08-11"));
});

check("14. inclui livre sem motivo", () => {
  assert.ok(pending().some((d) => d.date === "2026-08-11" && !d.hasReason && d.free > 0));
});

check("15. Excedente programado soma apenas programação ativa", () => {
  const b = book();
  const sum = b.days.reduce((s, d) => s + d.planned, 0);
  assert.equal(b.planned, sum);
  const led18 = specialExcessLedger("2026-08-18", seed.compensations, 45);
  assert.equal(led18.planned, 45);
  assert.ok(b.planned >= 45);
});

check("16. programado não entra como livre", () => {
  const b = book();
  const d18 = b.days.find((d) => d.date === "2026-08-18")!;
  assert.equal(d18.planned, 45);
  assert.equal(d18.free, 0);
  assert.ok(!pending().some((d) => d.date === "2026-08-18"));
});

check("17. realocado soma somente realizado", () => {
  const b = book();
  const sum = b.days.reduce((s, d) => s + d.realized, 0);
  assert.equal(b.realized, sum);
  const led24 = specialExcessLedger("2026-08-24", seed.compensations, 60);
  assert.equal(led24.realized, 25);
  assert.ok(b.realized >= 25);
});

check("18. programado não conta como realocado", () => {
  const d18 = book().days.find((d) => d.date === "2026-08-18")!;
  assert.equal(d18.planned, 45);
  assert.equal(d18.realized, 0);
});

check("19. Déficit aberto usa fonte central", () => {
  const bank = hourBankSummary(
    seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S, CYCLE, TODAY,
  );
  const comps = srcOf("src/app/(app)/compensacoes/page.tsx");
  assert.ok(comps.includes("bank.openDeficitTotal"));
  assert.ok(bank.openDeficitTotal >= 0);
});

check("20. futuro não entra no déficit aberto", () => {
  const bank = hourBankSummary(
    seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S, CYCLE, TODAY,
  );
  const futureBank = hourBankSummary(
    seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S,
    { from: "2026-09-07", to: "2026-09-07" }, TODAY,
  );
  assert.equal(futureBank.openDeficitTotal, 0);
  void bank;
});

check("21. incompleto/inconsistente não entra", () => {
  const incomplete: TimeEntry[] = [{ id: 1, date: "2026-08-26", time: "08:00", type: "entrada", note: null }];
  const day = computeDay(incomplete, S);
  assert.equal(day.canFinalizeFinancialDay, false);
  assert.equal(day.excessMinutes, 0);
  const b = book(CYCLE, TODAY, { entries: incomplete, comps: [], reasons: [] });
  assert.equal(b.days.length, 0);
  const bank = hourBankSummary(incomplete, [], [], cals, [], [], S, CYCLE, TODAY);
  assert.equal(bank.openDeficitTotal, 0);
});

check("22. fechamento 30/04 respeitado", () => {
  assert.equal(CYCLE.to.endsWith("-04-30") || getAnnualPointCycle("2026-04-30") !== getAnnualPointCycle("2026-05-01"), true);
  assert.equal(getAnnualPointCycle("2026-04-30"), "2025/2026");
  assert.equal(getAnnualPointCycle("2026-05-01"), "2026/2027");
});

check("23. novo ciclo começa zerado em relação ao ciclo anterior", () => {
  const entries = day11h(1, "2026-04-29");
  const newCycle = annualCycleBounds(getAnnualPointCycle("2026-05-02"));
  const b = book(newCycle, "2026-05-02", { entries, comps: [], reasons: [] });
  assert.equal(b.free, 0);
  assert.equal(b.days.length, 0);
});

check("24. Gestão de excedentes do período aparece em Ver mais detalhes", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("Gestão de excedentes do período"));
  assert.ok(r.includes("Já realocado do excedente gerado no período"));
  assert.ok(r.includes("Ainda a realocar do excedente gerado no período"));
  assert.ok(r.includes("{detailsOpen && ("));
});

check("25. Excedente do período usa somente excedente gerado no período selecionado", () => {
  const periodBook = book(PERIOD);
  const cycleB = book(CYCLE);
  assert.ok(cycleB.original >= periodBook.original);
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("periodExcessBook.original"));
  assert.ok(!pending(PERIOD).some((d) => d.date === "2026-08-11"));
});

check("26. Já realocado refere-se ao excedente originado no período", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("periodExcessBook.realized"));
  const periodBook = book(PERIOD);
  const d24 = periodBook.days.find((d) => d.date === "2026-08-24");
  assert.ok(d24);
  assert.equal(d24!.realized, 25);
});

check("27. Ainda a realocar refere-se ao excedente originado no período", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("periodExcessBook.free"));
  const periodBook = book(PERIOD);
  assert.equal(periodBook.free, pending(PERIOD).reduce((s, d) => s + d.free, 0));
});

check("28. Déficit do período é do período selecionado", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("Déficit do período"));
  assert.ok(r.includes("detailStats.deficitMinutes"));
});

check("29. mudar período muda esses quatro valores", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("getNextPointPeriod(period)"));
  assert.ok(r.includes("getPreviousPointPeriod(period)"));
  const a = book(PERIOD);
  const b = book({ from: "2026-07-21", to: "2026-08-20" });
  assert.notEqual(a.original + a.free, b.original + b.free);
});

check("30. isso não altera os cards operacionais do ciclo em Compensações", () => {
  const c = srcOf("src/app/(app)/compensacoes/page.tsx");
  assert.ok(c.includes("Gestão de excedentes — ciclo atual"));
  assert.ok(c.includes("Excedente livre [10+]"));
  assert.ok(c.includes("Excedente programado"));
  assert.ok(c.includes("Excedente realocado"));
  assert.ok(c.includes("Déficit aberto"));
  assert.ok(c.includes("cycleBounds"));
  assert.ok(c.includes("cycleExcessBook.free"));
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("periodExcessBook"));
  assert.ok(!r.includes("cycleExcessBook"));
});

check("31. Visão geral pendentes usam o ciclo, não o período 21→20", () => {
  const panel = srcOf("src/components/excess-panel.tsx");
  assert.ok(panel.includes("pendingSpecialExcessDays(cycleBook)"));
  assert.ok(panel.includes("ciclo anual"));
});

console.log(`\nEXCEDENTE CICLO — OK (${passed} testes)`);
