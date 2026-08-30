/**
 * VERIFICAÇÃO — ETAPA 2B: COBERTURA NATURAL DO DÉFICIT PELO SALDO REGULAR
 *
 * summarizeRegularCoverage / regularCoverageByCycle derivam, dos fatos
 * da Etapa 2A (summarizeRegularFacts — mesma fonte do Resumo), quanto
 * do déficit factual é naturalmente coberto pelo próprio banco regular.
 * Derivação matemática: nenhum settlement, parcela, transferência ou
 * gravação no store. [10+] e settlements: fora (Etapa 2C).
 *
 *  A crédito 2h30 / déficit 30min → coberto 30min, sem cobertura 0, líquido +2h
 *  B crédito 20min / déficit 30min → coberto 20min, sem cobertura 10min, líquido −10min
 *  C crédito 0 / déficit 30min → coberto 0, sem cobertura 30min
 *  D crédito 2h / déficit 0 → coberto 0, sem cobertura 0, líquido +2h
 *  E crédito POSTERIOR ao déficit (mesmo ciclo) → sem cobertura 0
 *  F fechamento anual: 29/04 −1h (ciclo 2025/2026) × 04/05 +2h (2026/2027)
 *    → crédito do novo ciclo NÃO cobre; sem cobertura total = 1h
 *    (02/05/2026 é sábado; usa 04/05, 1º dia útil do novo ciclo)
 *  G dois ciclos com déficit → anterior 30min sem cobertura, novo 0, total 30min
 *  H seed 21/08→20/09 → coberto 45min, sem cobertura 0, líquido +6h15
 *  I invariantes 1–5 em todos os cenários
 *
 * Executar: npx tsx tests/verify-regular-coverage.mts
 */
import assert from "node:assert/strict";

import { buildLegacyDemoScenario } from "../src/lib/seed-data.ts";
import { getPointPeriod } from "../src/lib/periods.ts";
import { regularCoverageByCycle, summarizeRegularCoverage, type RegularFactsRangeInput, type RegularCoverage } from "../src/lib/regular-facts.ts";
import { settingsOf } from "../src/lib/store.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const TODAY = "2026-08-30";
const CONTROL_START = "2026-04-01";

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
/** Dia com almoço explícito (08:00–12:00 + 13:00–saída). */
const day = (date: string, end: string) => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, end, "saida"),
];
/** 7h (−1h) · 7h30 (−30) · 8h20 (+20) · 8h30 (+30) · 9h (+1h) · 10h (+2h). */
const day7h = (date: string) => day(date, "16:00");
const day730 = (date: string) => day(date, "16:30");
const day820 = (date: string) => day(date, "17:20");
const day830 = (date: string) => day(date, "17:30");
const day9h = (date: string) => day(date, "18:00");
const day10h = (date: string) => day(date, "19:00");

const RANGE = { from: "2026-08-21", to: "2026-08-27" };

function coverage(entries: TimeEntry[], extra?: { from?: string; to?: string }): RegularCoverage {
  return summarizeRegularCoverage({
    from: extra?.from ?? RANGE.from,
    to: extra?.to ?? RANGE.to,
    today: TODAY,
    entries,
    absences: [],
    calendars: undefined,
    settings,
    faltas: [],
    controlStartDate: CONTROL_START,
  });
}

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. Crédito 2h30 / Déficit 30min ────────────────────────── */
check("A. crédito 2h30 × déficit 30min → coberto 30min, sem cobertura 0, líquido +2h", () => {
  const f = coverage([...day10h("2026-08-24"), ...day730("2026-08-25"), ...day830("2026-08-26")]);
  assert.equal(f.generatedCreditMinutes, 150, "crédito gerado 2h30");
  assert.equal(f.generatedDeficitMinutes, 30, "déficit histórico 30min (não reescrito)");
  assert.equal(f.coveredByRegularMinutes, 30, "coberto naturalmente pelo regular");
  assert.equal(f.uncoveredByRegularMinutes, 0);
  assert.equal(f.netBalanceMinutes, 120, "líquido +2h");
});

/* ── B. Crédito 20min / Déficit 30min ───────────────────────── */
check("B. crédito 20min × déficit 30min → coberto 20min, sem cobertura 10min, líquido −10min", () => {
  const f = coverage([...day820("2026-08-24"), ...day730("2026-08-25")]);
  assert.equal(f.generatedCreditMinutes, 20);
  assert.equal(f.generatedDeficitMinutes, 30);
  assert.equal(f.coveredByRegularMinutes, 20, "cobertura limitada ao crédito gerado");
  assert.equal(f.uncoveredByRegularMinutes, 10);
  assert.equal(f.netBalanceMinutes, -10);
});

/* ── C. Crédito 0 / Déficit 30min ───────────────────────────── */
check("C. crédito 0 × déficit 30min → coberto 0, sem cobertura 30min", () => {
  const f = coverage(day730("2026-08-25"));
  assert.equal(f.generatedCreditMinutes, 0);
  assert.equal(f.generatedDeficitMinutes, 30);
  assert.equal(f.coveredByRegularMinutes, 0);
  assert.equal(f.uncoveredByRegularMinutes, 30);
  assert.equal(f.netBalanceMinutes, -30);
});

/* ── D. Crédito 2h / Déficit 0 ──────────────────────────────── */
check("D. crédito 2h × déficit 0 → coberto 0, sem cobertura 0, líquido +2h", () => {
  const f = coverage(day10h("2026-08-24"));
  assert.equal(f.generatedCreditMinutes, 120);
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.coveredByRegularMinutes, 0);
  assert.equal(f.uncoveredByRegularMinutes, 0);
  assert.equal(f.netBalanceMinutes, 120);
});

/* ── E. Crédito posterior ao déficit (mesmo ciclo) ──────────── */
check("E. −30min em dia 1 e +1h em dia 2 (mesmo ciclo) → sem cobertura 0", () => {
  const f = coverage([...day730("2026-08-24"), ...day9h("2026-08-25")]);
  assert.equal(f.generatedDeficitMinutes, 30, "déficit histórico preservado");
  assert.equal(f.coveredByRegularMinutes, 30, "crédito posterior cobre no mesmo ciclo");
  assert.equal(f.uncoveredByRegularMinutes, 0);
  assert.equal(f.netBalanceMinutes, 30);
});

/* ── F. Fechamento anual é absoluto ─────────────────────────── */
check("F. 29/04 −1h (2025/2026) × 04/05 +2h (2026/2027) → sem cobertura total 1h", () => {
  const entries = [...day7h("2026-04-29"), ...day10h("2026-05-04")];
  const f = coverage(entries, { from: "2026-04-25", to: "2026-05-06" });
  assert.equal(f.generatedCreditMinutes, 120);
  assert.equal(f.generatedDeficitMinutes, 60);
  assert.equal(f.coveredByRegularMinutes, 0, "NENHUMA cobertura cruza o fechamento");
  assert.equal(f.uncoveredByRegularMinutes, 60, "déficit do ciclo anterior continua em aberto");
  assert.equal(f.netBalanceMinutes, 60);

  const byCycle = regularCoverageByCycle({
    from: "2026-04-25", to: "2026-05-06", today: TODAY, entries,
    absences: [], calendars: undefined, settings, faltas: [], controlStartDate: CONTROL_START,
  });
  assert.deepEqual(
    byCycle.map((c) => c.cycle),
    ["2025/2026", "2026/2027"],
    "intervalo segmentado em exatamente 2 ciclos",
  );
  assert.equal(byCycle[0].generatedDeficitMinutes, 60, "ciclo anterior: déficit 1h");
  assert.equal(byCycle[0].coveredByRegularMinutes, 0, "ciclo anterior: nada o cobre");
  assert.equal(byCycle[0].uncoveredByRegularMinutes, 60, "ciclo anterior: 1h sem cobertura");
  assert.equal(byCycle[1].generatedCreditMinutes, 120, "ciclo novo: +2h fica no novo ciclo");
  assert.equal(byCycle[1].uncoveredByRegularMinutes, 0);
});

/* ── G. Dois ciclos com déficit ─────────────────────────────── */
check("G. anterior (déficit 1h, crédito 30min) + novo (déficit 30min, crédito 2h) → total sem cobertura 30min", () => {
  const entries = [
    ...day7h("2026-04-28"), // ciclo 2025/2026: −1h
    ...day830("2026-04-29"), // ciclo 2025/2026: +30min
    ...day730("2026-05-01"), // ciclo 2026/2027: −30min
    ...day10h("2026-05-04"), // ciclo 2026/2027: +2h
  ];
  const input: RegularFactsRangeInput = {
    from: "2026-04-27", to: "2026-05-06", today: TODAY, entries,
    absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: CONTROL_START,
  };
  const byCycle = regularCoverageByCycle(input);
  assert.deepEqual(
    byCycle.map((c) => c.cycle),
    ["2025/2026", "2026/2027"],
  );
  assert.equal(byCycle[0].generatedDeficitMinutes, 60);
  assert.equal(byCycle[0].generatedCreditMinutes, 30);
  assert.equal(byCycle[0].coveredByRegularMinutes, 30, "ciclo anterior: coberto apenas pelo próprio crédito");
  assert.equal(byCycle[0].uncoveredByRegularMinutes, 30, "ciclo anterior: 30min sem cobertura");
  assert.equal(byCycle[1].generatedDeficitMinutes, 30);
  assert.equal(byCycle[1].generatedCreditMinutes, 120);
  assert.equal(byCycle[1].coveredByRegularMinutes, 30);
  assert.equal(byCycle[1].uncoveredByRegularMinutes, 0, "ciclo novo: 0 sem cobertura");

  const f = summarizeRegularCoverage(input);
  assert.equal(f.generatedCreditMinutes, 150);
  assert.equal(f.generatedDeficitMinutes, 90);
  assert.equal(f.coveredByRegularMinutes, 60);
  assert.equal(f.uncoveredByRegularMinutes, 30, "total sem cobertura = 30min (só o do ciclo anterior)");
  assert.equal(f.netBalanceMinutes, 60);
  // Fórmula plana (máx(déficit total − crédito total, 0)) daria 0 — a segmentação evita isso
  assert.notEqual(f.uncoveredByRegularMinutes, Math.max(f.generatedDeficitMinutes - f.generatedCreditMinutes, 0));
});

/* ── H. Seed 3.1 validado: 21/08 → 20/09 ────────────────────── */
check("H. seed 21/08→20/09 → histórico 45min, coberto 45min, sem cobertura 0, líquido +6h15", () => {
  const seed = buildLegacyDemoScenario();
  const s = settingsOf(seed.user);
  const period = getPointPeriod(TODAY);
  const f = summarizeRegularCoverage({
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
  });
  assert.equal(period.from, "2026-08-21");
  assert.equal(period.to, "2026-09-20");
  assert.equal(f.generatedCreditMinutes, 420, "crédito regular 7h (Etapa 2A intacta)");
  assert.equal(f.generatedDeficitMinutes, 45, "déficit histórico 45min");
  assert.equal(f.coveredByRegularMinutes, 45, "mesmo ciclo → integralmente coberto pelo regular");
  assert.equal(f.uncoveredByRegularMinutes, 0, "déficit sem cobertura regular = 0min");
  assert.equal(f.netBalanceMinutes, 375, "saldo factual líquido +6h15 (inalterado)");
  const byCycle = regularCoverageByCycle({
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
  });
  assert.equal(byCycle.length, 1, "período dentro de UM único ciclo");
  assert.equal(byCycle[0].cycle, "2026/2027");
});

/* ── I. Invariantes em todos os cenários ────────────────────── */
check("I. invariantes 1–5: covered≤déficit, covered≤crédito, uncovered=déficit−covered, crédito≥déficit⇒uncovered 0 (1 ciclo), nunca entre ciclos", () => {
  const seed = buildLegacyDemoScenario();
  const s = settingsOf(seed.user);
  const period = getPointPeriod(TODAY);
  const seedInput = {
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
  };
  const scenarios: Record<string, () => RegularCoverage> = {
    A: () => coverage([...day10h("2026-08-24"), ...day730("2026-08-25"), ...day830("2026-08-26")]),
    B: () => coverage([...day820("2026-08-24"), ...day730("2026-08-25")]),
    C: () => coverage(day730("2026-08-25")),
    D: () => coverage(day10h("2026-08-24")),
    E: () => coverage([...day730("2026-08-24"), ...day9h("2026-08-25")]),
    F: () => coverage([...day7h("2026-04-29"), ...day10h("2026-05-04")], { from: "2026-04-25", to: "2026-05-06" }),
    G: () => summarizeRegularCoverage({
      from: "2026-04-27", to: "2026-05-06", today: TODAY,
      entries: [...day7h("2026-04-28"), ...day830("2026-04-29"), ...day730("2026-05-01"), ...day10h("2026-05-04")],
      absences: [], calendars: undefined, settings, faltas: [], controlStartDate: CONTROL_START,
    }),
    H: () => summarizeRegularCoverage(seedInput),
  };
  for (const [id, fn] of Object.entries(scenarios)) {
    const f = fn();
    // Invariante 1: covered ≤ déficit
    assert.ok(f.coveredByRegularMinutes <= f.generatedDeficitMinutes, `inv.1 (${id})`);
    // Invariante 2: covered ≤ crédito
    assert.ok(f.coveredByRegularMinutes <= f.generatedCreditMinutes, `inv.2 (${id})`);
    // Invariante 3: uncovered = déficit − covered
    assert.equal(f.uncoveredByRegularMinutes, f.generatedDeficitMinutes - f.coveredByRegularMinutes, `inv.3 (${id})`);
    // Líquido consistente com a Etapa 2A
    assert.equal(f.netBalanceMinutes, f.generatedCreditMinutes - f.generatedDeficitMinutes, `líquido (${id})`);
    assert.ok(f.coveredByRegularMinutes >= 0 && f.uncoveredByRegularMinutes >= 0, `não negativos (${id})`);
  }
  // Invariante 4: num único ciclo, crédito ≥ déficit ⇒ uncovered = 0 (A, D, E, H)
  for (const id of ["A", "D", "E", "H"]) {
    const f = scenarios[id]();
    if (f.generatedCreditMinutes >= f.generatedDeficitMinutes) {
      assert.equal(f.uncoveredByRegularMinutes, 0, `inv.4 (${id})`);
    }
  }
  // Invariante 5: nunca crédito de outro ciclo — verificada item a item
  // nos checks F e G: byCycle[i].coveredByRegularMinutes usa apenas os
  // fatos do próprio segmento (≤ min(credit_i, deficit_i) por ciclo).
});

console.log(`\nCOBERTURA REGULAR (ÉTAPA 2B) — OK (${passed} testes)`);
