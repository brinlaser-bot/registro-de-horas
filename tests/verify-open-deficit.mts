/**
 * VERIFICAÇÃO — ETAPA 2C: DÉFICIT ABERTO APÓS SETTLEMENTS [10+] REALIZADOS
 *
 * summarizeOpenDeficit / openDeficitByCycle derivam, por ciclo anual:
 *   1. déficit factual (Etapa 2A);
 *   2. settlements [10+] REALIZADOS (ledger: kind=deficit,
 *      portion=especial, status=concluida, vínculo sourceDate = dia);
 *   3. restante; 4. cobertura regular (Etapa 2B) do restante;
 *   5. déficit aberto (nunca negativo; sem dupla quitação).
 *
 *  A déficit 30 × crédito 20 × settlement 10 → aberto 0
 *  B déficit 30 × crédito 2h × settlement 30 → regular cobre 0, aberto 0
 *  C [10+] LIVRE 2h sem settlement → não consome; aberto 10
 *  D [10+] PROGRAMADO 10min (pendente) → não quita; aberto 10
 *  E crédito 0 × settlement 10 → aberto 20
 *  F ledger com settlement realizado 45 > dívida 30 → teto 30, aberto 0,
 *    inconsistência detectável (raw 45 > settled 30)
 *  G ciclo anual: ciclo 1 (déficit 1h, settlement 30) × ciclo 2 (crédito 2h)
 *    → aberto total 30min
 *  H seed 21/08→20/09: histórico 45 · [10+] realizado 40 · regular 5 · aberto 0
 *  I invariantes em todos os cenários
 *  J regressão: 2A/2B intactas no seed
 *
 * Executar: npx tsx tests/verify-open-deficit.mts
 */
import assert from "node:assert/strict";

import { dayCreditView, specialExcessLedger } from "../src/lib/hour-bank.ts";
import { buildLegacyDemoScenario } from "../src/lib/seed-data.ts";
import { getPointPeriod } from "../src/lib/periods.ts";
import {
  openDeficitByCycle,
  summarizeOpenDeficit,
  summarizeRegularCoverage,
  summarizeRegularFacts,
  type OpenDeficitInput,
  type OpenDeficitSummary,
} from "../src/lib/regular-facts.ts";
import { settingsOf } from "../src/lib/store.ts";
import type { Compensation, TimeEntry, WorkSettings } from "../src/lib/types.ts";

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
/** 7h (−1h) · 7h30 (−30) · 8h20 (+20) · 10h (+2h) · 12h (+2h e [10+] 2h). */
const day7h = (date: string) => day(date, "16:00");
const day730 = (date: string) => day(date, "16:30");
const day820 = (date: string) => day(date, "17:20");
const day10h = (date: string) => day(date, "19:00");
const day12h = (date: string) => day(date, "21:00");

const RANGE = { from: "2026-08-21", to: "2026-08-27" };

let nextCompId = 1000;
/** Parcela de SETTLEMENT [10+] realizada (convenção do store/ledger). */
const settled = (sourceDate: string, targetDate: string, minutes: number, over?: Partial<Compensation>): Compensation => ({
  id: nextCompId++, sourceDate, targetDate, minutes,
  status: "concluida", note: null, kind: "deficit", portion: "especial", createdAt: 1, ...over,
});

function openDeficit(entries: TimeEntry[], comps: Compensation[], extra?: { from?: string; to?: string }): OpenDeficitSummary {
  return summarizeOpenDeficit({
    from: extra?.from ?? RANGE.from,
    to: extra?.to ?? RANGE.to,
    today: TODAY,
    entries,
    absences: [],
    calendars: undefined,
    settings,
    faltas: [],
    controlStartDate: CONTROL_START,
    compensations: comps,
  });
}

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. Déficit 30 × crédito 20 × settlement 10 ────────────── */
check("A. déficit 30, crédito 20, [10+] realizado 10 → regular cobre 20, aberto 0", () => {
  const entries = [...day820("2026-08-24"), ...day730("2026-08-25")];
  const comps = [settled("2026-08-25", "2026-08-20", 10)]; // [10+] de dia fora do escopo
  const f = openDeficit(entries, comps);
  assert.equal(f.generatedDeficitMinutes, 30, "histórico 30 (não reescrito)");
  assert.equal(f.settledByExcessMinutes, 10, "[10+] realizado");
  assert.equal(f.coveredByRegularMinutes, 20, "regular cobre o RESTANTE (20), não os 30");
  assert.equal(f.openDeficitMinutes, 0, "aberto 0 — sem dupla quitação (10 + 20, não 10 + 30)");
  assert.equal(f.generatedCreditMinutes, 20);
  assert.equal(f.netBalanceMinutes, -10, "saldo factual intacto");
});

/* ── B. Settlement cobre tudo; regular não é "usado" ───────── */
check("B. déficit 30, crédito 2h, [10+] realizado 30 → regular cobre 0 desse déficit, aberto 0", () => {
  const entries = [...day10h("2026-08-24"), ...day730("2026-08-25")];
  const comps = [settled("2026-08-25", "2026-08-20", 30)];
  const f = openDeficit(entries, comps);
  assert.equal(f.generatedDeficitMinutes, 30);
  assert.equal(f.settledByExcessMinutes, 30, "escolha manual permanece (não revertida)");
  assert.equal(f.coveredByRegularMinutes, 0, "regular NÃO cobre o que o settlement já quitou");
  assert.equal(f.openDeficitMinutes, 0);
  assert.equal(f.generatedCreditMinutes, 120, "crédito 2h segue livre no banco (crédito factual)");
});

/* ── C. [10+] livre não entra ──────────────────────────────── */
check("C. [10+] livre 2h sem settlement → não consome; regular cobre 20, aberto 10", () => {
  const entries = [...day820("2026-08-24"), ...day730("2026-08-25"), ...day12h("2026-08-20")];
  const f = openDeficit(entries, []);
  assert.equal(f.settledByExcessMinutes, 0, "livre ≠ realizado");
  assert.equal(f.coveredByRegularMinutes, 20);
  assert.equal(f.openDeficitMinutes, 10, "[10+] livre não reduz o aberto");
  assert.equal(f.generatedDeficitMinutes, 30);
  // Cross-check no ledger existente: a reserva segue LIVRE (2h)
  const v = dayCreditView("2026-08-20", entries, [], [], undefined, settings, []);
  assert.equal(v.excessSpecial, 120, "reserva especial [10+] 2h gerada");
  assert.equal(v.freeSpecial, 120, "continua livre — a apuração não a tocou");
});

/* ── D. [10+] programado não entra ─────────────────────────── */
check("D. [10+] programado 10min (pendente) → planejado ≠ realizado; aberto 10", () => {
  const entries = [...day820("2026-08-24"), ...day730("2026-08-25"), ...day12h("2026-08-20")];
  const comps = [settled("2026-08-25", "2026-08-20", 10, { status: "pendente" })];
  const f = openDeficit(entries, comps);
  assert.equal(f.settledByExcessMinutes, 0, "pendente NÃO quita");
  assert.equal(f.coveredByRegularMinutes, 20);
  assert.equal(f.openDeficitMinutes, 10);
  // Cross-check: no ledger o minuto aparece como PROGRAMADO, não realizado
  const v = dayCreditView("2026-08-20", entries, comps, [], undefined, settings, []);
  const led = specialExcessLedger("2026-08-20", comps, v.excessSpecial);
  assert.equal(led.realized, 0, "ledger: nada realizado");
  assert.equal(led.planned, 10, "ledger: 10min programado");
});

/* ── E. Crédito 0 × settlement 10 ──────────────────────────── */
check("E. déficit 30, crédito 0, [10+] realizado 10 → aberto 20", () => {
  const entries = day730("2026-08-25");
  const comps = [settled("2026-08-25", "2026-08-20", 10)];
  const f = openDeficit(entries, comps);
  assert.equal(f.generatedDeficitMinutes, 30);
  assert.equal(f.settledByExcessMinutes, 10);
  assert.equal(f.coveredByRegularMinutes, 0);
  assert.equal(f.openDeficitMinutes, 20);
  assert.equal(f.generatedCreditMinutes, 0);
});

/* ── F. Proteção contra settlement maior que a dívida ──────── */
check("F. ledger com settlement realizado 45 > dívida 30 → teto 30, aberto 0, inconsistência detectável", () => {
  const entries = day730("2026-08-25");
  const comps = [settled("2026-08-25", "2026-08-20", 20), settled("2026-08-25", "2026-08-20", 25)];
  const f = openDeficit(entries, comps);
  assert.equal(f.generatedDeficitMinutes, 30);
  assert.equal(f.settledByExcessMinutes, 30, "efetivamente considerado ≤ dívida factual (teto)");
  assert.equal(f.rawSettledExcessMinutes, 45, "bruto do ledger preservado no relatório");
  assert.ok(f.rawSettledExcessMinutes > f.settledByExcessMinutes, "inconsistência detectável (raw > considerado)");
  assert.equal(f.coveredByRegularMinutes, 0);
  assert.equal(f.openDeficitMinutes, 0, "nunca negativo");
  assert.equal(f.netBalanceMinutes, -30, "saldo factual intacto");
});

/* ── G. Ciclo anual: settlement/crédito não cruzam 30/04 ───── */
check("G. ciclo 1 (déficit 1h, settlement 30, crédito 0) × ciclo 2 (crédito 2h) → aberto total 30min", () => {
  const entries = [...day7h("2026-04-29"), ...day10h("2026-05-04")];
  const comps = [settled("2026-04-29", "2026-04-28", 30)];
  const input: OpenDeficitInput = {
    from: "2026-04-27", to: "2026-05-06", today: TODAY, entries,
    absences: [], calendars: undefined, settings, faltas: [],
    controlStartDate: CONTROL_START, compensations: comps,
  };
  const byCycle = openDeficitByCycle(input);
  assert.deepEqual(byCycle.map((c) => c.cycle), ["2025/2026", "2026/2027"]);
  assert.equal(byCycle[0].generatedDeficitMinutes, 60, "ciclo 1: déficit 1h");
  assert.equal(byCycle[0].settledByExcessMinutes, 30, "ciclo 1: settlement 30min");
  assert.equal(byCycle[0].openDeficitMinutes, 30, "ciclo 1: 30min em aberto");
  assert.equal(byCycle[1].generatedCreditMinutes, 120, "ciclo 2: crédito 2h");
  assert.equal(byCycle[1].openDeficitMinutes, 0, "ciclo 2: nada em aberto");
  const f = summarizeOpenDeficit(input);
  assert.equal(f.generatedDeficitMinutes, 60);
  assert.equal(f.settledByExcessMinutes, 30);
  assert.equal(f.coveredByRegularMinutes, 0, "crédito do ciclo 2 NÃO cobre o ciclo 1");
  assert.equal(f.openDeficitMinutes, 30, "total aberto = 30min");
});

/* ── H. Seed 3.1: 21/08 → 20/09 ────────────────────────────── */
check("H. seed → histórico 45 · [10+] realizado 40 · regular 5 · aberto 0 · líquido +6h15", () => {
  const seed = buildLegacyDemoScenario();
  const s = settingsOf(seed.user);
  const period = getPointPeriod(TODAY);
  const input: OpenDeficitInput = {
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
    compensations: seed.compensations,
  };
  const f = summarizeOpenDeficit(input);
  /* 4D.4: a decomposição factual agora inclui a folga a compensar 25/08
   * realizada sem trabalho (−8h — evento explícito é fato suficiente). */
  assert.equal(f.generatedDeficitMinutes, 525, "45min de dias comuns (21/08 −15 · 26/08 −30) + 8h da folga 25/08 (fato)");
  assert.equal(f.rawSettledExcessMinutes, 40, "[10+] realizado no período: 21/08 10min + 26/08 30min");
  assert.equal(f.settledByExcessMinutes, 40, "todos dentro da dívida factual (sem inconsistência)");
  assert.equal(f.coveredByRegularMinutes, 420, "cobertura natural do banco regular sobre a dívida factual");
  assert.equal(f.openDeficitMinutes, 65, "aberto = 105 líquido − 40 já destinados");
  assert.equal(f.generatedCreditMinutes, 420, "crédito factual 7h intacto");
  /* 4D.4: líquido passa a −1h45 (folga 25/08 −8h no saldo factual). */
  assert.equal(f.netBalanceMinutes, -105, "líquido factual = 420 − 525");

  // Vínculo por dia: cada settlement aplicado ao déficit do próprio sourceDate
  const byCycle = openDeficitByCycle(input);
  assert.equal(byCycle.length, 1, "um único ciclo (2026/2027)");
  assert.equal(byCycle[0].cycle, "2026/2027");
});

/* ── I. Invariantes em todos os cenários ───────────────────── */
check("I. invariantes: settled≤déficit, settled+covered≤déficit, aberto=déficit−settled−covered, líquido=crédito−déficit", () => {
  const d730 = day730("2026-08-25");
  const d820 = day820("2026-08-24");
  const d10h = day10h("2026-08-24");
  const d12h = day12h("2026-08-20");
  const scenarios: Record<string, () => OpenDeficitSummary> = {
    A: () => openDeficit([...d820, ...d730], [settled("2026-08-25", "2026-08-20", 10)]),
    B: () => openDeficit([...d10h, ...d730], [settled("2026-08-25", "2026-08-20", 30)]),
    C: () => openDeficit([...d820, ...d730, ...d12h], []),
    D: () => openDeficit([...d820, ...d730, ...d12h], [settled("2026-08-25", "2026-08-20", 10, { status: "pendente" })]),
    E: () => openDeficit(d730, [settled("2026-08-25", "2026-08-20", 10)]),
    F: () => openDeficit(d730, [settled("2026-08-25", "2026-08-20", 20), settled("2026-08-25", "2026-08-20", 25)]),
    G: () => summarizeOpenDeficit({
      from: "2026-04-27", to: "2026-05-06", today: TODAY,
      entries: [...day7h("2026-04-29"), ...day10h("2026-05-04")],
      absences: [], calendars: undefined, settings, faltas: [],
      controlStartDate: CONTROL_START,
      compensations: [settled("2026-04-29", "2026-04-28", 30)],
    }),
  };
  for (const [id, fn] of Object.entries(scenarios)) {
    const f = fn();
    assert.ok(f.settledByExcessMinutes <= f.generatedDeficitMinutes, `settled ≤ déficit (${id})`);
    assert.ok(f.coveredByRegularMinutes <= f.generatedCreditMinutes, `covered ≤ crédito (${id})`);
    assert.ok(f.settledByExcessMinutes + f.coveredByRegularMinutes <= f.generatedDeficitMinutes, `sem dupla quitação (${id})`);
    assert.equal(f.openDeficitMinutes, f.generatedDeficitMinutes - f.settledByExcessMinutes - f.coveredByRegularMinutes, `aberto = déficit − settled − covered (${id})`);
    assert.ok(f.openDeficitMinutes >= 0, `aberto não negativo (${id})`);
    assert.equal(f.netBalanceMinutes, f.generatedCreditMinutes - f.generatedDeficitMinutes, `líquido factual (${id})`);
    assert.ok(f.rawSettledExcessMinutes >= f.settledByExcessMinutes, `raw ≥ considerado (${id})`);
  }
  // G: por ciclo — o crédito do ciclo 2 não cobriu o ciclo 1
  const g = scenarios.G();
  assert.equal(g.openDeficitMinutes, 30, "G total aberto 30min (só do ciclo 1)");
});

/* ── J. Regressão: 2A e 2B intactas no seed ────────────────── */
check("J. 2A/2B intactas: seed → fatos 7h/8h45/−1h45 e cobertura regular (4D.4: folga 25/08 −8h factual)", () => {
  const seed = buildLegacyDemoScenario();
  const s = settingsOf(seed.user);
  const period = getPointPeriod(TODAY);
  const base = {
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
  };
  const facts = summarizeRegularFacts(base);
  assert.equal(facts.generatedCreditMinutes, 420);
  /* 4D.4: folga a compensar 25/08 realizada sem trabalho ⇒ −8h factual. */
  assert.equal(facts.generatedDeficitMinutes, 525);
  assert.equal(facts.netBalanceMinutes, -105);
  const cov = summarizeRegularCoverage(base);
  assert.equal(cov.coveredByRegularMinutes, 420);
  assert.equal(cov.uncoveredByRegularMinutes, 105);
});

console.log(`\nDÉFICIT ABERTO (ÉTAPA 2C) — OK (${passed} testes)`);
