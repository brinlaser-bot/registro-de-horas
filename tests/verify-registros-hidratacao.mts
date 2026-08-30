/**
 * Hidratação de Registros: primeiro carregamento não inventa −8h.
 * TZ=America/Sao_Paulo npx tsx tests/verify-registros-hidratacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { companyDayBalanceView, companyDayContext } from "../src/lib/company-calendar.ts";
import { isMissingExpectedRecord } from "../src/lib/missing-records.ts";
import { createEmptyState, EMPTY_USER, REAL_USER_IDENTITY } from "../src/lib/seed-data.ts";
import { hydrateAppData, parseStoredAppData } from "../src/lib/store.ts";
import type { AppData, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const TODAY = "2026-08-30";
const START = "2026-08-01";
const PAST = "2026-08-27"; // quinta vazia no período 21/08→20/09
const BEFORE_START = "2026-07-28";
const FUTURE = "2026-09-01";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function persisted(controlStartDate: string | null, extra?: Partial<AppData>): string {
  const empty = createEmptyState(TODAY);
  const data: AppData = {
    ...empty,
    user: {
      ...EMPTY_USER,
      ...REAL_USER_IDENTITY,
      ...S,
      controlStartDate,
    },
    ...extra,
  };
  return JSON.stringify(data);
}

function cardView(date: string, today: string, controlStartDate: string | null) {
  const cctx = companyDayContext(date, [], [], undefined, S);
  const missingExpected = isMissingExpectedRecord(date, today, cctx, [], controlStartDate);
  const empty = cctx.ctx.day.empty;
  const noFacts = empty && !cctx.ctx.absence;
  const baseView = companyDayBalanceView(cctx);
  const balanceView =
    date > today || missingExpected || noFacts
      ? { ...baseView, adjustedBalance: 0, adjustedDeficit: 0 }
      : baseView;
  return { cctx, missingExpected, noFacts, balanceView, empty };
}

check("A. primeiro carregamento com controlStartDate aplicável: Sem registro, sem −8h", () => {
  const hydrated = hydrateAppData(persisted(START), TODAY);
  assert.equal(hydrated.user.controlStartDate, START);
  assert.equal(hydrated.entries.length, 0);
  const d = cardView(PAST, TODAY, hydrated.user.controlStartDate ?? null);
  assert.equal(d.empty, true);
  assert.equal(d.missingExpected, true);
  assert.equal(d.balanceView.adjustedBalance, 0);
  assert.equal(d.balanceView.adjustedDeficit, 0);
  assert.notEqual(d.balanceView.adjustedBalance, -480);
});

check("B. dia anterior à controlStartDate sem fatos: não é Sem registro nem déficit", () => {
  const d = cardView(BEFORE_START, TODAY, START);
  assert.equal(d.missingExpected, false);
  assert.equal(d.noFacts, true);
  assert.equal(d.balanceView.adjustedBalance, 0);
  assert.equal(d.balanceView.adjustedDeficit, 0);
});

check("C. hoje vazio não é Sem registro", () => {
  const d = cardView(TODAY, TODAY, START);
  assert.equal(d.missingExpected, false);
  assert.equal(d.balanceView.adjustedBalance, 0);
});

check("D. futuro vazio não é Sem registro", () => {
  const d = cardView(FUTURE, TODAY, START);
  assert.equal(d.missingExpected, false);
  assert.equal(d.balanceView.adjustedBalance, 0);
});

check("E. hidratação lê controlStartDate persistida sem passar por Configurações", () => {
  const raw = persisted(START);
  const parsed = parseStoredAppData(raw);
  assert.ok(parsed);
  assert.equal(parsed!.user.controlStartDate, START);
  const hydrated = hydrateAppData(raw, TODAY);
  assert.equal(hydrated.user.controlStartDate, START);
  const pristineLike = createEmptyState(TODAY);
  assert.equal(pristineLike.user.controlStartDate, TODAY);
  assert.notEqual(hydrated.user.controlStartDate, pristineLike.user.controlStartDate);
  const fromPristine = cardView(PAST, TODAY, pristineLike.user.controlStartDate ?? null);
  assert.equal(fromPristine.missingExpected, false, "pristine (hoje) esconde Sem registro");
  const fromHydrated = cardView(PAST, TODAY, hydrated.user.controlStartDate ?? null);
  assert.equal(fromHydrated.missingExpected, true, "storage persistido classifica Sem registro");
});

check("F. store hidrata no getSnapshot; Registros espera storeReady", () => {
  const store = srcOf("src/lib/store.ts");
  assert.ok(store.includes("function ensureLoaded()"));
  assert.ok(store.includes("getSnapshot() {\n  ensureLoaded();"));
  assert.ok(store.includes("export function useIsStoreReady"));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("useIsStoreReady"));
  assert.ok(reg.includes("if (!mounted || !storeReady)"));
  assert.ok(reg.includes("user.controlStartDate"));
  assert.ok(reg.includes("isMissingExpectedRecord(date, todayStr, cctx, faltas, user.controlStartDate)"));
});

check("G. card sem fatos não mostra MiniStat de −8h", () => {
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("const noFacts = d.empty && !falta && !absence"));
  assert.ok(card.includes("!punchPending && !missingExpected && !noFacts"));
  assert.ok(card.includes("Preencher registros do dia"));
  assert.ok(card.includes("Registrar falta"));
});

check("H. storage vazio continua produção limpa (sem seed automático)", () => {
  const empty = hydrateAppData(null, TODAY);
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.user.controlStartDate, TODAY);
  const store = srcOf("src/lib/store.ts");
  assert.ok(!store.includes("mutate(() => buildSeedData())"));
});

console.log(`\nREGISTROS HIDRATAÇÃO — OK (${passed} testes)`);
