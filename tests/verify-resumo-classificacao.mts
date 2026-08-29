/**
 * VERIFICAÇÃO — Classificação do Resumo (Abaixo da base) + botão Período atual.
 * TZ=America/Sao_Paulo npx tsx tests/verify-resumo-classificacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isAbaixoDaBase, situationsOfDay } from "../src/lib/day-situation.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { isMissingExpectedRecord } from "../src/lib/missing-records.ts";
import {
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  listDaysBetween,
  samePointPeriod,
} from "../src/lib/periods.ts";
import { buildResumoDayRow, isQuietResumoDay, resumoEventKind } from "../src/lib/resumo-days.ts";
import { createEmptyState } from "../src/lib/seed-data.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};

const TODAY = "2026-08-29";
const START = "2026-08-29";
const HIST = { from: "2026-07-21", to: "2026-08-20" };
const CURRENT = getPointPeriod(TODAY);

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function punch(id: number, date: string, time: string, type: "entrada" | "saida"): TimeEntry {
  return { id, date, time, type, note: null };
}

function row(date: string, extra?: {
  today?: string;
  start?: string | null;
  entries?: TimeEntry[];
}) {
  return buildResumoDayRow({
    date,
    today: extra?.today ?? TODAY,
    entries: extra?.entries ?? [],
    absences: [],
    calendars: undefined,
    settings: S,
    faltas: [],
    controlStartDate: extra?.start === undefined ? START : extra.start,
  });
}

check("1. dia anterior a controlStartDate sem fatos => não é Abaixo da base", () => {
  const d = row("2026-08-28");
  assert.equal(resumoEventKind(d), "—");
  assert.notEqual(d.status, "deficit");
  const view = companyDayContext("2026-08-28", [], [], undefined, S);
  assert.equal(isAbaixoDaBase({ date: "2026-08-28", today: TODAY, view, missingExpected: false }), false);
  assert.ok(!situationsOfDay("2026-08-28", TODAY, [], [], undefined, S, { controlStartDate: START }).includes("abaixo-base"));
});

check("2. dia anterior sem fatos => evento —", () => {
  for (const date of ["2026-07-21", "2026-07-22", "2026-08-24", "2026-08-28"]) {
    const d = row(date);
    assert.equal(resumoEventKind(d), "—", date);
    assert.equal(d.workedMinutes, 0);
    assert.equal(d.balanceContribution, 0);
    assert.equal(d.deficitContribution, 0);
  }
});

check("3. dia posterior ao início, passado e sem fatos => Sem registro", () => {
  const monday = "2026-08-31";
  const d = row(monday, { today: "2026-09-01", start: START });
  assert.equal(d.missingExpected, true);
  assert.equal(resumoEventKind(d), "Sem registro");
  const view = companyDayContext(monday, [], [], undefined, S);
  assert.equal(isMissingExpectedRecord(monday, "2026-09-01", view, [], START), true);
});

check("4. Sem registro não cria saldo negativo", () => {
  const monday = "2026-08-31";
  const d = row(monday, { today: "2026-09-01", start: START });
  assert.equal(d.balanceContribution, 0);
  assert.equal(d.deficitContribution, 0);
  const saldoCell = d.status === "empty" || d.entryCount === 0;
  assert.equal(saldoCell, true);
});

check("5. dia futuro sem fatos => —", () => {
  const d = row("2026-09-01");
  assert.equal(resumoEventKind(d), "—");
  assert.notEqual(d.status, "deficit");
  assert.equal(d.balanceContribution, 0);
});

check("6. hoje incompleto não vira Abaixo da base prematuramente", () => {
  const weekdayToday = "2026-08-28";
  const idle = row(weekdayToday, { today: weekdayToday, start: "2026-08-01" });
  assert.equal(resumoEventKind(idle), "Jornada não iniciada");
  assert.notEqual(resumoEventKind(idle), "Abaixo da base");
  const open = row(weekdayToday, {
    today: weekdayToday,
    start: "2026-08-01",
    entries: [punch(1, weekdayToday, "08:00", "entrada")],
  });
  assert.notEqual(resumoEventKind(open), "Abaixo da base");
  assert.equal(open.status, "in-progress");
});

check("7. registro completo 7h30/base 8h => Abaixo da base", () => {
  const date = "2026-08-21";
  const entries = [
    punch(1, date, "08:00", "entrada"), punch(2, date, "12:00", "saida"),
    punch(3, date, "13:00", "entrada"), punch(4, date, "16:30", "saida"),
  ];
  const d = row(date, { entries, start: "2026-08-01" });
  assert.equal(d.workedMinutes, 450);
  assert.equal(d.expectedMinutes, 480);
  assert.equal(resumoEventKind(d), "Abaixo da base");
  assert.equal(d.status, "deficit");
  assert.ok(situationsOfDay(date, TODAY, entries, [], undefined, S).includes("abaixo-base"));
});

check("8. Folga continua Folga", () => {
  const sat = row("2026-08-22");
  assert.equal(resumoEventKind(sat), "Folga");
  const sun = row("2026-08-23");
  assert.equal(resumoEventKind(sun), "Folga");
});

check("9. períodos históricos antes do início não ficam cheios de Abaixo da base", () => {
  const days = listDaysBetween(HIST.from, HIST.to)
    .map((date) => row(date))
    .filter(isQuietResumoDay);
  const abaixo = days.filter((d) => resumoEventKind(d) === "Abaixo da base");
  assert.equal(abaixo.length, 0);
  const weekdays = days.filter((d) => !d.eventLabel);
  assert.ok(weekdays.length > 0);
  assert.ok(weekdays.every((d) => resumoEventKind(d) === "—"));
  assert.ok(weekdays.every((d) => d.expectedMinutes === 480));
});

check("10. botão Período atual não aparece no período vigente", () => {
  const src = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(src.includes("{!viewingCurrentPeriod && ("));
  assert.ok(src.includes("Período atual"));
  assert.ok(!src.includes("Voltar para o período atual"));
  assert.equal(samePointPeriod(CURRENT, getPointPeriod(TODAY)), true);
});

check("11. botão aparece ao navegar para período anterior", () => {
  const prev = getPreviousPointPeriod(CURRENT);
  assert.equal(samePointPeriod(prev, CURRENT), false);
  const src = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(src.includes("getPreviousPointPeriod(period)"));
  assert.ok(src.includes("setPeriod(currentPeriod)"));
});

check("12. botão aparece ao navegar para período posterior", () => {
  const next = getNextPointPeriod(CURRENT);
  assert.equal(samePointPeriod(next, CURRENT), false);
  const src = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(src.includes("getNextPointPeriod(period)"));
});

check("13. clicar retorna ao período vigente", () => {
  const src = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(src.includes("onClick={() => setPeriod(currentPeriod)}"));
  assert.ok(src.includes("const currentPeriod = getPointPeriod(todayStr)"));
  const jumped = getPreviousPointPeriod(getPreviousPointPeriod(CURRENT));
  assert.equal(samePointPeriod(jumped, CURRENT), false);
  assert.equal(samePointPeriod(CURRENT, getPointPeriod(TODAY)), true);
});

check("14. F5 no período vigente mantém comportamento correto", () => {
  const src = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(src.includes("getPointPeriod(todayString())"));
  assert.ok(!src.includes("toISOString().slice(0, 10)"));
  assert.equal(getPointPeriod(TODAY).from, "2026-08-21");
  assert.equal(getPointPeriod(TODAY).to, "2026-09-20");
});

check("15. cálculos do topo permanecem inalterados", () => {
  const empty = createEmptyState(START);
  const days = listDaysBetween(HIST.from, HIST.to)
    .map((date) =>
      buildResumoDayRow({
        date,
        today: TODAY,
        entries: empty.entries,
        absences: empty.absences,
        calendars: empty.companyCalendars,
        settings: S,
        faltas: empty.faltas,
        controlStartDate: START,
      }),
    )
    .filter(isQuietResumoDay);
  const tracked = days.filter((d) => d.entryCount > 0).length;
  const worked = days.reduce((s, d) => s + d.workedMinutes, 0);
  const balance = days.reduce((s, d) => s + d.balanceContribution, 0);
  const excess = days.reduce((s, d) => s + d.excessMinutes, 0);
  assert.equal(tracked, 0);
  assert.equal(worked, 0);
  assert.equal(balance, 0);
  assert.equal(excess, 0);
  const bank = hourBankSummary(
    empty.entries, empty.compensations, empty.absences, empty.companyCalendars,
    empty.faltas, empty.excessReasons, S, HIST, TODAY,
  );
  assert.equal(bank.realizedBalance, 0);
  assert.equal(bank.openDeficitTotal, 0);
  assert.equal(bank.excessSpecialFreeTotal, 0);
});

console.log(`\nRESUMO CLASSIFICAÇÃO — OK (${passed} testes)`);
