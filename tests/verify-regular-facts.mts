/**
 * VERIFICAÇÃO — ETAPA 2A: BASE FACTUAL DO DÉFICIT E DO CRÉDITO REGULAR
 *
 * summarizeRegularFacts apura, no escopo de datas, SOMENTE fatos
 * realizados, usando a MESMA fonte do Resumo (buildResumoDayRow +
 * balanceContribution):
 *   crédito regular factual gerado · déficit factual gerado · líquido.
 *
 *  A +2h, −30min, +30min → crédito 2h30, déficit 30min, líquido +2h
 *  B somente −30min     → crédito 0, déficit 30min, líquido −30min
 *  C somente +2h        → crédito 2h, déficit 0, líquido +2h
 *  D 11h30/base8        → crédito +2h, déficit 0; [10+] 1h30 NÃO entra
 *  E folga base0 + 11h  → crédito +10h, déficit 0; [10+] 1h NÃO entra
 *  F Sem registro       → 0/0 (nunca −8h)
 *  G registro incompleto → 0/0
 *  H registro inconsistente → 0/0
 *  I falta prevista futura → 0/0
 *  J invariante: líquido = crédito − déficit (todos os cenários + seed)
 *  K seed 3.1 · 21/08→20/09 → crédito 7h, déficit 45min, líquido +6h15
 *    (mesma fonte: soma de balanceContribution = líquido)
 *  L regressão Etapa 1 via fatos: 10h30 → +2h/[10+] 30min; 11h30 → +2h/[10+] 1h30
 *
 * Executar: npx tsx tests/verify-regular-facts.mts
 */
import assert from "node:assert/strict";

import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { getPointPeriod, listDaysBetween } from "../src/lib/periods.ts";
import { dayRegularFactBalance, summarizeRegularFacts, type RegularFacts } from "../src/lib/regular-facts.ts";
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
/** Dia 7h30 (08–12 + 13–16:30). */
const day730 = (date: string) => day(date, "16:30");
/** Dia 8h30 (08–12 + 13–17:30). */
const day830 = (date: string) => day(date, "17:30");
/** Dia 10h (08–12 + 13–19:00). */
const day10h = (date: string) => day(date, "19:00");
/** Dia 10h30 (08–12 + 13–19:30). */
const day10h30 = (date: string) => day(date, "19:30");
/** Dia 11h30 (08–12 + 13–20:30). */
const day11h30 = (date: string) => day(date, "20:30");

const RANGE = { from: "2026-08-21", to: "2026-08-27" }; // 21/08 sex → 27/08 qui

function facts(entries: TimeEntry[], extra?: { today?: string; from?: string; to?: string }) {
  return summarizeRegularFacts({
    from: extra?.from ?? RANGE.from,
    to: extra?.to ?? RANGE.to,
    today: extra?.today ?? TODAY,
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

/* ── A. Cenário canônico: +2h, −30min, +30min ─────────────── */
check("A. +2h, −30min, +30min → crédito 2h30, déficit 30min, líquido +2h", () => {
  const entries = [...day10h("2026-08-24"), ...day730("2026-08-25"), ...day830("2026-08-26")];
  const f = facts(entries);
  assert.equal(f.generatedCreditMinutes, 150, "crédito 2h30 (120 + 30)");
  assert.equal(f.generatedDeficitMinutes, 30, "déficit 30min");
  assert.equal(f.netBalanceMinutes, 120, "líquido +2h");
  // 21/08 e 27/08 sem batidas = Sem registro (0, nunca −8h); 22/23 folga sem trabalho (0)
  const semRegistro = buildResumoDayRow({
    date: "2026-08-21", today: TODAY, entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: CONTROL_START,
  });
  assert.equal(semRegistro.missingExpected, true, "21/08 segue classificado como Sem registro");
  assert.equal(semRegistro.balanceContribution, 0, "Sem registro não vira −8h");
});

/* ── B. Somente −30min ─────────────────────────────────────── */
check("B. somente −30min → crédito 0, déficit 30min, líquido −30min", () => {
  const f = facts(day730("2026-08-25"));
  assert.equal(f.generatedCreditMinutes, 0);
  assert.equal(f.generatedDeficitMinutes, 30);
  assert.equal(f.netBalanceMinutes, -30);
});

/* ── C. Somente +2h ────────────────────────────────────────── */
check("C. somente +2h → crédito 2h, déficit 0, líquido +2h", () => {
  const f = facts(day10h("2026-08-24"));
  assert.equal(f.generatedCreditMinutes, 120);
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 120);
});

/* ── D. 11h30/base8: [10+] 1h30 NÃO entra no crédito regular ─ */
check("D. 11h30/base8 → crédito +2h, déficit 0; [10+] 1h30 fora da apuração", () => {
  const entries = day11h30("2026-08-24");
  const f = facts(entries);
  assert.equal(f.generatedCreditMinutes, 120, "crédito = no ponto (10h) − base (8h) = +2h (não +3h30)");
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 120);
  const row = buildResumoDayRow({
    date: "2026-08-24", today: TODAY, entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: CONTROL_START,
  });
  assert.equal(row.excessMinutes, 90, "[10+] 1h30 permanece separado na linha");
  assert.equal(row.workedMinutes, 690, "trabalhado real preservado (11h30)");
});

/* ── E. Folga base 0 + 11h trabalhadas ─────────────────────── */
check("E. folga base0 + 11h → crédito regular +10h, déficit 0; [10+] 1h fora", () => {
  const entries = day("2026-08-22", "20:00"); // sábado, 08–12 + 13–20 = 11h
  const f = facts(entries);
  assert.equal(f.generatedCreditMinutes, 600, "crédito limitado ao ponto oficial (10h), não 11h");
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 600);
  const row = buildResumoDayRow({
    date: "2026-08-22", today: TODAY, entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: CONTROL_START,
  });
  assert.equal(row.excessMinutes, 60, "[10+] 1h separado");
  assert.equal(row.workedMinutes, 660, "trabalhado real preservado (11h)");
});

/* ── F. Sem registro ───────────────────────────────────────── */
check("F. Sem registro → crédito 0, déficit 0 (escopo vazio de fatos)", () => {
  const f = facts([]);
  assert.equal(f.generatedCreditMinutes, 0);
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 0, "nunca 0h − base");
});

/* ── G. Registro incompleto ────────────────────────────────── */
check("G. registro incompleto (dia passado só com entrada) → 0/0", () => {
  const entries = [punch("2026-08-25", "08:00", "entrada")];
  const row = buildResumoDayRow({
    date: "2026-08-25", today: TODAY, entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: CONTROL_START,
  });
  assert.equal(row.status, "incomplete", "linha segue classificada como incompleto");
  assert.equal(row.balanceContribution, 0, "financeiro congelado (mesma fonte do Resumo)");
  const f = facts(entries);
  assert.equal(f.generatedCreditMinutes, 0);
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 0);
});

/* ── H. Registro inconsistente ─────────────────────────────── */
check("H. registro inconsistente (entrada, entrada, saída) → 0/0", () => {
  const entries = [
    punch("2026-08-25", "08:00", "entrada"),
    punch("2026-08-25", "13:00", "entrada"),
    punch("2026-08-25", "17:00", "saida"),
  ];
  const row = buildResumoDayRow({
    date: "2026-08-25", today: TODAY, entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: CONTROL_START,
  });
  assert.equal(row.status, "inconsistent", "linha segue classificada como inconsistente");
  assert.equal(row.balanceContribution, 0);
  const f = facts(entries);
  assert.equal(f.generatedCreditMinutes, 0);
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 0);
});

/* ── I. Falta prevista futura ──────────────────────────────── */
check("I. falta prevista futura (03/09) → 0/0; dia não vira −8h antes da data", () => {
  const f = summarizeRegularFacts({
    from: "2026-08-21", to: "2026-09-05", today: TODAY, entries: [], absences: [],
    calendars: undefined, settings,
    faltas: [{ id: 1, date: "2026-09-03", createdAt: 1 }],
    controlStartDate: CONTROL_START,
  });
  assert.equal(f.generatedCreditMinutes, 0);
  assert.equal(f.generatedDeficitMinutes, 0);
  assert.equal(f.netBalanceMinutes, 0);
});

/* ── K. Seed 3.1 validado: 21/08 → 20/09 ───────────────────── */
check("K. seed 21/08→20/09 → crédito 7h, déficit 45min, líquido +6h15", () => {
  const seed = buildSeedData();
  const s = settingsOf(seed.user);
  const period = getPointPeriod(TODAY);
  assert.equal(period.from, "2026-08-21");
  assert.equal(period.to, "2026-09-20");

  const f = summarizeRegularFacts({
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
  });
  assert.equal(f.generatedCreditMinutes, 420, "crédito 7h (22/08 +2h · 23/08 +1h · 24/08 +2h · 28/08 +2h)");
  assert.equal(f.generatedDeficitMinutes, 45, "déficit 45min (21/08 −15 · 26/08 −30)");
  assert.equal(f.netBalanceMinutes, 375, "líquido +6h15");

  // Fatos por dia (MESMA fonte do Resumo)
  const dayFact = (date: string) =>
    dayRegularFactBalance(buildResumoDayRow({
      date, today: TODAY, entries: seed.entries, absences: seed.absences,
      calendars: seed.companyCalendars, settings: s, faltas: seed.faltas,
      controlStartDate: seed.user.controlStartDate,
    }));
  assert.equal(dayFact("2026-08-21"), -15, "21/08 7h45 → −15min");
  assert.equal(dayFact("2026-08-22"), 120, "22/08 sábado 2h → +2h");
  assert.equal(dayFact("2026-08-23"), 60, "23/08 domingo 1h → +1h");
  assert.equal(dayFact("2026-08-24"), 120, "24/08 11h → +2h ([10+] 1h fora)");
  assert.equal(dayFact("2026-08-25"), 0, "25/08 COMPENSAR sem batidas → 0");
  assert.equal(dayFact("2026-08-26"), -30, "26/08 7h30 → −30min");
  assert.equal(dayFact("2026-08-27"), 0, "27/08 Sem registro → 0");
  assert.equal(dayFact("2026-08-28"), 120, "28/08 11h30 → +2h ([10+] 1h30 fora)");
  assert.equal(dayFact("2026-08-31"), 0, "31/08 falta PREVISTA → 0 (data ainda não chegou)");
  assert.equal(dayFact("2026-09-03"), 0, "03/09 batidas futuras → 0");
  assert.equal(dayFact("2026-09-07"), 0, "07/09 feriado futuro com batidas → 0");
});

/* ── J. Invariante + mesmo agregador do Resumo ─────────────── */
check("J. invariante líquido = crédito − déficit; seed: soma do agregador do Resumo = líquido", () => {
  const scenarios: Record<string, () => RegularFacts> = {
    A: () => facts([...day10h("2026-08-24"), ...day730("2026-08-25"), ...day830("2026-08-26")]),
    B: () => facts(day730("2026-08-25")),
    C: () => facts(day10h("2026-08-24")),
    D: () => facts(day11h30("2026-08-24")),
    E: () => facts(day("2026-08-22", "20:00")),
    F: () => facts([]),
    G: () => facts([punch("2026-08-25", "08:00", "entrada")]),
    H: () => facts([punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida")]),
    I: () => summarizeRegularFacts({
      from: "2026-08-21", to: "2026-09-05", today: TODAY, entries: [], absences: [],
      calendars: undefined, settings,
      faltas: [{ id: 9, date: "2026-09-03", createdAt: 1 }],
      controlStartDate: CONTROL_START,
    }),
  };
  for (const [id, fn] of Object.entries(scenarios)) {
    const f = fn();
    assert.equal(f.netBalanceMinutes, f.generatedCreditMinutes - f.generatedDeficitMinutes, `invariante (${id})`);
    assert.ok(f.generatedCreditMinutes >= 0, `crédito não negativo (${id})`);
    assert.ok(f.generatedDeficitMinutes >= 0, `déficit não negativo (${id})`);
  }

  // Seed: o líquido da apuração é exatamente a soma de balanceContribution
  // que o Resumo soma como "Saldo do período" (mesma fonte).
  const seed = buildSeedData();
  const s = settingsOf(seed.user);
  const period = getPointPeriod(TODAY);
  let resumoTotal = 0;
  for (const date of listDaysBetween(period.from, period.to)) {
    resumoTotal += dayRegularFactBalance(buildResumoDayRow({
      date, today: TODAY, entries: seed.entries, absences: seed.absences,
      calendars: seed.companyCalendars, settings: s, faltas: seed.faltas,
      controlStartDate: seed.user.controlStartDate,
    }));
  }
  const f = summarizeRegularFacts({
    from: period.from, to: period.to, today: TODAY,
    entries: seed.entries, absences: seed.absences, calendars: seed.companyCalendars,
    settings: s, faltas: seed.faltas, controlStartDate: seed.user.controlStartDate,
  });
  assert.equal(f.netBalanceMinutes, resumoTotal, "líquido = soma do agregador do Resumo (mesma fonte)");
});

/* ── L. Regressão Etapa 1 (via fatos) ──────────────────────── */
check("L. Etapa 1 intacta: 10h30 → +2h/[10+] 30min · 11h30 → +2h/[10+] 1h30", () => {
  const d1030 = facts(day10h30("2026-08-24"));
  assert.equal(d1030.generatedCreditMinutes, 120, "10h30: crédito +2h");
  assert.equal(d1030.generatedDeficitMinutes, 0);
  const d1130 = facts(day11h30("2026-08-24"));
  assert.equal(d1130.generatedCreditMinutes, 120, "11h30: crédito +2h");
  assert.equal(d1130.generatedDeficitMinutes, 0);
});

console.log(`\nBASE FACTUAL (ÉTAPA 2A) — OK (${passed} testes)`);
