/**
 * VERIFICAÇÃO — Resumo: inconsistente, rótulos, cores, tooltip [10+], card.
 * TZ=America/Sao_Paulo npx tsx tests/verify-resumo-apresentacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { specialExcessBook } from "../src/lib/hour-bank.ts";
import { listDaysBetween } from "../src/lib/periods.ts";
import {
  buildResumoDayRow,
  isQuietResumoDay,
  resumoEventKind,
  resumoFinancialFrozen,
} from "../src/lib/resumo-days.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import { computeDay, formatMinutes } from "../src/lib/time.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const TODAY = "2026-08-29";
const START = "2026-08-01";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function punch(id: number, date: string, time: string, type: "entrada" | "saida"): TimeEntry {
  return { id, date, time, type, note: null };
}

function row(date: string, entries: TimeEntry[]) {
  return buildResumoDayRow({
    date, today: TODAY, entries, absences: [], calendars: undefined, settings: S, faltas: [],
    controlStartDate: START,
  });
}

check("A. sequência inconsistente congela o financeiro e não vira Ok", () => {
  const date = "2026-08-27";
  const entries = [
    punch(1, date, "08:00", "entrada"),
    punch(3, date, "13:00", "entrada"),
    punch(4, date, "17:00", "saida"),
  ];
  const day = computeDay(entries, S);
  assert.equal(day.consistent, false);
  assert.equal(day.canFinalizeFinancialDay, false);
  const d = row(date, entries);
  assert.equal(resumoEventKind(d), "Registro inconsistente");
  assert.notEqual(resumoEventKind(d), "Ok");
  assert.equal(resumoFinancialFrozen(d), true);
  assert.equal(d.deficitContribution, 0);
  assert.equal(d.status, "inconsistent");
});

check("B. 7h30 / base 8h => Jornada abaixo do previsto e −30min", () => {
  const date = "2026-08-21";
  const entries = [
    punch(1, date, "08:00", "entrada"), punch(2, date, "12:00", "saida"),
    punch(3, date, "13:00", "entrada"), punch(4, date, "16:30", "saida"),
  ];
  const d = row(date, entries);
  assert.equal(resumoEventKind(d), "Jornada abaixo do previsto");
  assert.equal(d.workedMinutes, 450);
  assert.equal(d.expectedMinutes, 480);
  assert.equal(d.balanceMinutes, -30);
  assert.equal(resumoFinancialFrozen(d), false);
  // 3F.1: o badge do dia (mesma lógica de tons) vive no item mobile
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  const rowMobileSrc = srcOf("src/components/resumo-day-row-mobile.tsx");
  const badgeSrc = page.includes('kind === "Jornada abaixo do previsto"') ? page : rowMobileSrc;
  assert.ok(badgeSrc.includes('kind === "Jornada abaixo do previsto"'));
  assert.ok(badgeSrc.includes('? "rose"'));
});

check("C. 11h30 => no ponto 10h, extra +2h, [10+] 1h30; tooltip separa", () => {
  const date = "2026-08-24";
  const entries = [
    punch(1, date, "08:00", "entrada"), punch(2, date, "12:00", "saida"),
    punch(3, date, "13:00", "entrada"), punch(4, date, "20:30", "saida"),
  ];
  const day = computeDay(entries, S);
  assert.equal(day.workedMinutes, 690);
  assert.equal(day.excessMinutes, 90);
  assert.equal(day.registrableMinutes, 600);
  const d = row(date, entries);
  assert.equal(resumoEventKind(d), "Acima do limite [10+]");
  const data = buildStackedPeriodData({
    entries, compensations: [], settings: S,
    period: { from: date, to: date }, today: TODAY,
  });
  const bar = data.find((x) => x.date === date)!;
  assert.equal(bar.workedMinutes, 690);
  assert.equal(bar.base, 480);
  assert.equal(bar.extra, 120);
  assert.equal(bar.excess, 90);
  const chart = srcOf("src/components/charts.tsx");
  assert.ok(chart.includes("Trabalhado: {formatMinutes(d.workedMinutes)}"));
  assert.ok(chart.includes("No ponto: {formatMinutes(Math.min(d.workedMinutes, cap))}"));
  assert.ok(chart.includes("Extra regular: +{formatMinutes(d.extra)}"));
  assert.ok(chart.includes("Excedente [10+]: {formatMinutes(d.excess)}"));
  assert.ok(!chart.includes("Saldo regular:"));
});

check("D. card [10+] do período mostra o gerado (3C) — sem Realocado/A realocar (3F)", () => {
  const date = "2026-08-24";
  const entries = [
    punch(1, date, "08:00", "entrada"), punch(2, date, "12:00", "saida"),
    punch(3, date, "13:00", "entrada"), punch(4, date, "20:30", "saida"),
  ];
  // engine legado continua íntegro (preservado em 2º plano)
  const book0 = specialExcessBook(
    entries, [], [], undefined, S, [], { from: date, to: date }, TODAY,
  );
  assert.equal(book0.original, 90);
  assert.equal(book0.realized, 0);
  assert.equal(formatMinutes(book0.original), "1h30");
  // novo modelo (3F): o card do Resumo mostra o gerado factual do período
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  const view = srcOf("src/lib/resumo-period-view.ts");
  assert.ok(page.includes('label="[10+] gerado no período"'));
  assert.ok(page.includes("Excedente factual acima de 10h/dia."));
  assert.ok(view.includes("buildSpecialExcessBank"), "fonte 3C na derivação");
  assert.ok(!page.includes("Realocado"), "sem 'Realocado' no Resumo");
  assert.ok(!page.includes("A realocar"), "sem 'A realocar' no Resumo");
});

check("R1. dias anteriores à controlStartDate continuam —", () => {
  const d = buildResumoDayRow({
    date: "2026-08-21", today: TODAY, entries: [], absences: [], calendars: undefined,
    settings: S, faltas: [], controlStartDate: "2026-08-29",
  });
  assert.equal(resumoEventKind(d), "—");
  assert.equal(resumoFinancialFrozen(d), true);
});

check("R2. Sem registro permanece Sem registro", () => {
  const d = buildResumoDayRow({
    date: "2026-08-26", today: TODAY, entries: [], absences: [], calendars: undefined,
    settings: S, faltas: [], controlStartDate: "2026-08-01",
  });
  assert.equal(resumoEventKind(d), "Sem registro");
});

check("R3. Folga permanece Folga", () => {
  const d = buildResumoDayRow({
    date: "2026-08-22", today: TODAY, entries: [], absences: [], calendars: undefined,
    settings: S, faltas: [], controlStartDate: "2026-08-01",
  });
  assert.equal(resumoEventKind(d), "Folga");
});

check("R4. botão Período atual permanece", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("{!viewingCurrentPeriod && ("));
  assert.ok(page.includes("Período atual"));
});

check("R5. cores distintas Sem registro / abaixo / [10+] / Folga", () => {
  // 3F.1: o mapeamento de tons do badge vive no item mobile (mesma lógica)
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  const rowMobileSrc = srcOf("src/components/resumo-day-row-mobile.tsx");
  const badgeSrc = page.includes('kind === "Acima do limite [10+]"') ? page : rowMobileSrc;
  assert.ok(badgeSrc.includes('kind === "Sem registro"'));
  assert.ok(badgeSrc.includes('kind === "Jornada abaixo do previsto"'));
  assert.ok(badgeSrc.includes('kind === "Acima do limite [10+]"'));
  assert.ok(badgeSrc.includes('kind === "Folga"'));
  assert.ok(badgeSrc.includes('? "violet"'));
  assert.ok(badgeSrc.includes('? "sky"'));
});

check("R6. histórico sem fatos não vira abaixo do previsto", () => {
  const days = listDaysBetween("2026-07-21", "2026-08-20")
    .map((date) => buildResumoDayRow({
      date, today: TODAY, entries: [], absences: [], calendars: undefined,
      settings: S, faltas: [], controlStartDate: "2026-08-29",
    }))
    .filter(isQuietResumoDay);
  assert.equal(days.filter((d) => resumoEventKind(d) === "Jornada abaixo do previsto").length, 0);
});

console.log(`\nRESUMO APRESENTAÇÃO — OK (${passed} testes)`);
