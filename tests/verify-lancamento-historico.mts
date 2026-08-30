/**
 * Lançamento histórico em dias anteriores à controlStartDate.
 * TZ=America/Sao_Paulo npx tsx tests/verify-lancamento-historico.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { companyDayContext } from "../src/lib/company-calendar.ts";
import { isHistoricalEmptyDate, isMissingExpectedRecord } from "../src/lib/missing-records.ts";
import { hydrateAppData } from "../src/lib/store.ts";
import { createEmptyState, EMPTY_USER, REAL_USER_IDENTITY } from "../src/lib/seed-data.ts";
import type { AppData, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const TODAY = "2026-08-30";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function classify(date: string, start: string, today = TODAY) {
  const view = companyDayContext(date, [], [], undefined, S);
  const missing = isMissingExpectedRecord(date, today, view, [], start);
  const historical = view.ctx.day.empty && isHistoricalEmptyDate(date, today, start);
  return { view, missing, historical, empty: view.ctx.day.empty };
}

function persist(controlStartDate: string): string {
  const empty = createEmptyState(TODAY);
  const data: AppData = {
    ...empty,
    user: { ...EMPTY_USER, ...REAL_USER_IDENTITY, ...S, controlStartDate },
  };
  return JSON.stringify(data);
}

check("A1. 27/08 início: 26/08 vazio é histórico neutro, não Sem registro", () => {
  const d = classify("2026-08-26", "2026-08-27");
  assert.equal(d.empty, true);
  assert.equal(d.missing, false);
  assert.equal(d.historical, true);
  assert.equal(d.view.effectiveExpected, 480);
});

check("A2. 27/08 início: 27/08 vazio passado é Sem registro operacional", () => {
  const d = classify("2026-08-27", "2026-08-27");
  assert.equal(d.missing, true);
  assert.equal(d.historical, false);
});

check("A3. 27/08 início: 28/08 vazio passado é Sem registro", () => {
  const d = classify("2026-08-28", "2026-08-27");
  assert.equal(d.missing, true);
  assert.equal(d.historical, false);
});

check("B1. 28/08 início: 27/08 vazio é histórico neutro", () => {
  const d = classify("2026-08-27", "2026-08-28");
  assert.equal(d.missing, false);
  assert.equal(d.historical, true);
});

check("B2. 28/08 início: 28/08 vazio passado é Sem registro", () => {
  const d = classify("2026-08-28", "2026-08-28");
  assert.equal(d.missing, true);
  assert.equal(d.historical, false);
});

check("C. 30/08 início: 24–28/08 vazios são históricos, sem dívida", () => {
  for (const date of ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]) {
    const d = classify(date, "2026-08-30");
    assert.equal(d.missing, false, date);
    assert.equal(d.historical, true, date);
  }
});

check("D. após preenchimento o dia deixa de ser histórico vazio", () => {
  const before = classify("2026-08-26", "2026-08-27");
  assert.equal(before.historical, true);
  const view = companyDayContext(
    "2026-08-26",
    [
      { id: 1, date: "2026-08-26", time: "08:00", type: "entrada", note: null },
      { id: 2, date: "2026-08-26", time: "12:00", type: "saida", note: null },
      { id: 3, date: "2026-08-26", time: "13:00", type: "entrada", note: null },
      { id: 4, date: "2026-08-26", time: "17:00", type: "saida", note: null },
    ],
    [],
    undefined,
    S,
  );
  assert.equal(view.ctx.day.empty, false);
  assert.equal(isHistoricalEmptyDate("2026-08-26", TODAY, "2026-08-27") && view.ctx.day.empty, false);
  assert.equal(isMissingExpectedRecord("2026-08-26", TODAY, view, [], "2026-08-27"), false);
});

check("E. F5: controlStartDate persistida classifica sem Configurações", () => {
  const hydrated = hydrateAppData(persist("2026-08-27"), TODAY);
  assert.equal(hydrated.user.controlStartDate, "2026-08-27");
  const d26 = classify("2026-08-26", hydrated.user.controlStartDate!);
  const d27 = classify("2026-08-27", hydrated.user.controlStartDate!);
  assert.equal(d26.historical, true);
  assert.equal(d26.missing, false);
  assert.equal(d27.missing, true);
  const store = srcOf("src/lib/store.ts");
  assert.ok(store.includes("function ensureLoaded()"));
  assert.ok(store.includes("export function useIsStoreReady"));
});

check("F. UI: histórico usa modal moderno, sem Registrar falta, sem Adicionar batida", () => {
  const card = srcOf("src/components/day-card.tsx");
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("isHistoricalEmptyDate"));
  assert.ok(page.includes("historicalEmpty={historicalEmpty}"));
  assert.ok(page.includes("missingExpected || historicalEmpty"));
  assert.ok(card.includes("historicalEmpty && !missingExpected"));
  // 3E.2: o bloco de adição também fica atrás do gate estrutural
  // (incompleto/inconsistente corrigem primeiro via "Corrigir registros")
  assert.ok(card.includes("!missingExpected && !historicalEmpty && !incompletePast && !inconsistent && ("));
  const hist = card.slice(card.indexOf("{historicalEmpty && !missingExpected && ("), card.indexOf("{incompletePast && ("));
  assert.ok(hist.includes("Preencher registros do dia"));
  assert.ok(!hist.includes("Registrar falta"));
  assert.ok(!hist.includes("Adicionar batida"));
  const missing = card.slice(card.indexOf("{missingExpected && ("), card.indexOf("{historicalEmpty && !missingExpected && ("));
  assert.ok(missing.includes("Registrar falta"));
  assert.ok(missing.includes("Preencher registros do dia"));
  assert.ok(card.includes("Adicionar batida"), "dias com registros preservam Adicionar batida");
});

check("G. hoje e futuro não são histórico", () => {
  assert.equal(isHistoricalEmptyDate(TODAY, TODAY, "2026-08-01"), false);
  assert.equal(isHistoricalEmptyDate("2026-09-01", TODAY, "2026-08-01"), false);
});

console.log(`\nLANÇAMENTO HISTÓRICO — OK (${passed} testes)`);
