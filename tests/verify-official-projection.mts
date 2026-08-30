/**
 * VERIFICAÇÃO — ETAPA 3A: PROJEÇÃO OFICIAL (FATO + [10+] UTILIZADO)
 *
 * Motor puro: FATO REAL + [10+] EFETIVAMENTE UTILIZADO → como ficaria
 * no sistema oficial. Sem UI, sem store, sem planejamento, sem
 * SpecialExcessAgreement, sem adapter legado.
 *
 * ELEGIBILIDADE (regra de produto): o uso de [10+] serve SOMENTE para
 * COMPLETAR uma jornada factual válida que terminou ABAIXO da base
 * efetiva (status "deficit" do Resumo — o único status elegível).
 * NÃO é elegível: falta · férias · afastamento · base cumprida (ok,
 * saldo 0) · saldo positivo · excess (>10h) · incompleto · inconsistente.
 * Em dia não elegível a função NÃO projeta [10+] (projectable false,
 * applied 0, factual intacto) mas DETECTA o uso indevido
 * (excessUsedMinutes + needsReview) — sem correção silenciosa.
 *
 *  A 7h, base 8h, uso [10+] 1h      → applied 1h, projetado 8h / saldo 0
 *  B 7h, uso [10+] 30min            → projetado 7h30 / −30min
 *  C 7h30, uso [10+] 30min          → projetado 8h / 0
 *  D 7h45, uso [10+] 15min          → projetado 8h / 0
 *  E 8h (base cumprida)             → NÃO elegível: applied 0, excess 30, needsReview, idem
 *  F 8h30 (+30min) uso 30min        → NÃO elegível: idem 8h30/+30min, excess 30, needsReview
 *  G 7h30, uso registrado 1h        → needed 30, applied 30, excess 30, needsReview, projetado 8h/0
 *  H incompleto/futuro              → projectable false, identity; uso → detectado
 *  I 3 dias (8h/10h30/7h): sem uso → factual +1h = projetado +1h;
 *    usando 30min do [10+] no dia 7h → factual CONTINUA +1h, projetado +1h30
 *  J mesmo cenário, uso de 1h no dia 7h → factual +1h, projetado +2h
 *  K uso em dia 10h30 (excess)      → NÃO elegível: applied 0, needsReview, sem extra artificial
 *  L uso em data fora do escopo     → não é aplicado (destino é único)
 *  ELE1–9 elegibilidade pelo status REAL de buildResumoDayRow:
 *    7h → deficit (elegível) · 7h30 → deficit (elegível) · 8h → ok · 8h30 → ok ·
 *    falta · férias · afastamento · incompleto · inconsistente → não elegíveis
 *  INV 1–12 (invariantes)
 *
 * Executar: npx tsx tests/verify-official-projection.mts
 */
import assert from "node:assert/strict";

import {
  isProjectableDayStatus,
  projectRealizedDayOfficial,
  projectRealizedPeriodOfficial,
  type RealizedDayOfficialProjectionInput,
} from "../src/lib/official-projection.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { listDaysBetween } from "../src/lib/periods.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Falta, TimeEntry, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const TODAY = "2026-08-30";
const CONTROL_START = "2026-04-01";
const BASE = 480; // 8h

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
/** Dia com almoço explícito (08:00–12:00 + 13:00–saída). */
const day = (date: string, end: string) => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, end, "saida"),
];
/** Dia 7h (08–12 + 13–16:00). */
const day7h = (date: string) => day(date, "16:00");
/** Dia 7h30 (08–12 + 13–16:30). */
const day730 = (date: string) => day(date, "16:30");
/** Dia 7h45 (08–12 + 13–16:45). */
const day745 = (date: string) => day(date, "16:45");
/** Dia 8h (08–12 + 13–17:00). */
const day8h = (date: string) => day(date, "17:00");
/** Dia 8h30 (08–12 + 13–17:30). */
const day830 = (date: string) => day(date, "17:30");
/** Dia 10h30 (08–12 + 13–19:30). */
const day10h30 = (date: string) => day(date, "19:30");

const dayInput = (over: Partial<RealizedDayOfficialProjectionInput> = {}): RealizedDayOfficialProjectionInput => ({
  date: "2026-08-26",
  factualWorkedMinutes: 420,
  factualRegistrableMinutes: 420,
  factualRegularBalanceMinutes: -60,
  effectiveBaseMinutes: BASE,
  financialValid: true,
  realized: true,
  usedSpecialMinutes: 0,
  ...over,
});

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. 7h, uso 1h → completa a base ──────────────────────── */
check("A. 7h/base8 uso 1h → needed 1h, applied 1h, projetado 8h/saldo 0", () => {
  const p = projectRealizedDayOfficial(dayInput({ usedSpecialMinutes: 60 }));
  assert.equal(p.projectable, true, "jornada válida abaixo da base → elegível");
  assert.equal(p.neededToBaseMinutes, 60, "needed = 8h − 7h = 1h");
  assert.equal(p.appliedSpecialMinutes, 60);
  assert.equal(p.excessUsedMinutes, 0);
  assert.equal(p.needsReview, false);
  assert.equal(p.projectedWorkedMinutes, 480, "projetado 8h");
  assert.equal(p.projectedBalanceMinutes, 0);
  assert.equal(p.factualWorkedMinutes, 420, "factual intacto");
  assert.equal(p.factualRegularBalanceMinutes, -60, "saldo factual intacto");
});

/* ── B. 7h, uso 30min → 7h30/−30min ───────────────────────── */
check("B. 7h uso 30min → projetado 7h30/saldo −30min", () => {
  const p = projectRealizedDayOfficial(dayInput({ usedSpecialMinutes: 30 }));
  assert.equal(p.projectable, true);
  assert.equal(p.appliedSpecialMinutes, 30);
  assert.equal(p.neededToBaseMinutes, 60);
  assert.equal(p.needsReview, false, "uso ≤ necessidade → sem revisão");
  assert.equal(p.projectedWorkedMinutes, 450, "7h30");
  assert.equal(p.projectedBalanceMinutes, -30);
});

/* ── C. 7h30, uso 30min → 8h/0 ────────────────────────────── */
check("C. 7h30 uso 30min → projetado 8h/saldo 0", () => {
  const p = projectRealizedDayOfficial(dayInput({
    factualWorkedMinutes: 450, factualRegistrableMinutes: 450,
    factualRegularBalanceMinutes: -30, usedSpecialMinutes: 30,
  }));
  assert.equal(p.projectable, true);
  assert.equal(p.appliedSpecialMinutes, 30);
  assert.equal(p.projectedWorkedMinutes, 480);
  assert.equal(p.projectedBalanceMinutes, 0);
});

/* ── D. 7h45, uso 15min → 8h/0 ────────────────────────────── */
check("D. 7h45 uso 15min → projetado 8h/saldo 0", () => {
  const p = projectRealizedDayOfficial(dayInput({
    factualWorkedMinutes: 465, factualRegistrableMinutes: 465,
    factualRegularBalanceMinutes: -15, usedSpecialMinutes: 15,
  }));
  assert.equal(p.projectable, true);
  assert.equal(p.neededToBaseMinutes, 15);
  assert.equal(p.appliedSpecialMinutes, 15);
  assert.equal(p.projectedWorkedMinutes, 480);
  assert.equal(p.projectedBalanceMinutes, 0);
});

/* ── E. 8h (base cumprida) → NÃO elegível ─────────────────── */
check("E. 8h uso 30min → NÃO elegível: applied 0, excess 30, needsReview, idem 8h/0", () => {
  const p = projectRealizedDayOfficial(dayInput({
    factualWorkedMinutes: 480, factualRegistrableMinutes: 480,
    factualRegularBalanceMinutes: 0, financialValid: false, usedSpecialMinutes: 30,
  }));
  assert.equal(p.projectable, false, "base cumprida → não elegível");
  assert.equal(p.reason, "not-financially-valid");
  assert.equal(p.neededToBaseMinutes, 0);
  assert.equal(p.appliedSpecialMinutes, 0);
  assert.equal(p.excessUsedMinutes, 30);
  assert.equal(p.needsReview, true, "uso indevido detectado");
  assert.equal(p.projectedWorkedMinutes, 480, "projetado permanece 8h");
  assert.equal(p.projectedBalanceMinutes, 0, "saldo permanece 0");
});

/* ── F. 8h30 (+30min) → NÃO elegível, sem extra artificial ── */
check("F. 8h30 (+30min) uso 30min → NÃO elegível: idem 8h30/+30min, excess 30, needsReview", () => {
  const p = projectRealizedDayOfficial(dayInput({
    factualWorkedMinutes: 510, factualRegistrableMinutes: 510,
    factualRegularBalanceMinutes: 30, financialValid: false, usedSpecialMinutes: 30,
  }));
  assert.equal(p.projectable, false, "saldo positivo → não elegível");
  assert.equal(p.neededToBaseMinutes, 0);
  assert.equal(p.appliedSpecialMinutes, 0);
  assert.equal(p.excessUsedMinutes, 30);
  assert.equal(p.needsReview, true);
  assert.equal(p.projectedWorkedMinutes, 510, "permanece 8h30 (não vira +1h artificial)");
  assert.equal(p.projectedBalanceMinutes, 30, "saldo projetado permanece +30min");
});

/* ── G. 7h30, uso registrado 1h → aplica 30min, sinaliza 30min ─ */
check("G. 7h30 uso 1h → needed 30, applied 30, excess 30, needsReview, projetado 8h/0", () => {
  const p = projectRealizedDayOfficial(dayInput({
    factualWorkedMinutes: 450, factualRegistrableMinutes: 450,
    factualRegularBalanceMinutes: -30, usedSpecialMinutes: 60,
  }));
  assert.equal(p.projectable, true);
  assert.equal(p.neededToBaseMinutes, 30);
  assert.equal(p.appliedSpecialMinutes, 30);
  assert.equal(p.excessUsedMinutes, 30);
  assert.equal(p.needsReview, true);
  assert.equal(p.projectedWorkedMinutes, 480);
  assert.equal(p.projectedBalanceMinutes, 0);
});

/* ── H. Dia não elegível (incompleto/futuro) → nada projetado; uso detectado ─ */
check("H1. dia incompleto → projectable false, identity, uso detectado (needsReview)", () => {
  const inp = dayInput({ financialValid: false, usedSpecialMinutes: 30 });
  const p = projectRealizedDayOfficial(inp);
  assert.equal(p.projectable, false);
  assert.equal(p.reason, "not-financially-valid");
  assert.equal(p.neededToBaseMinutes, 0);
  assert.equal(p.appliedSpecialMinutes, 0, "[10+] não é projetado em dia não elegível");
  assert.equal(p.excessUsedMinutes, 30, "uso indevido sinalizado");
  assert.equal(p.needsReview, true);
  assert.equal(p.projectedWorkedMinutes, inp.factualRegistrableMinutes, "identity: nada projetado");
  assert.equal(p.projectedBalanceMinutes, inp.factualRegularBalanceMinutes, "identity: saldo factual intacto");
});
check("H2. dia ainda não realizado → projectable false (not-realized), uso detectado", () => {
  const p = projectRealizedDayOfficial(dayInput({ realized: false, financialValid: false, usedSpecialMinutes: 30 }));
  assert.equal(p.projectable, false);
  assert.equal(p.reason, "not-realized");
  assert.equal(p.appliedSpecialMinutes, 0);
  assert.equal(p.excessUsedMinutes, 30, "uso em dia sem fato é detectado");
  assert.equal(p.needsReview, true);
  assert.equal(p.projectedWorkedMinutes, 420, "identity");
});

/* ── Cenário de período: 24/08 8h · 25/08 10h30 · 26/08 7h ── */
const PERIOD = { from: "2026-08-24", to: "2026-08-26" };
const scenarioEntries = [
  ...day8h("2026-08-24"),      // 8h  → 0 (ok — não elegível)
  ...day10h30("2026-08-25"),   // 10h30 → +2h regular (+30min [10+] gerado) (excess — não elegível)
  ...day7h("2026-08-26"),      // 7h  → −1h (deficit — elegível)
];

const period = (usedByDate: Record<string, number>) =>
  projectRealizedPeriodOfficial({
    ...PERIOD,
    today: TODAY,
    entries: scenarioEntries,
    absences: [],
    calendars: undefined,
    settings,
    faltas: [],
    controlStartDate: CONTROL_START,
    usedSpecialMinutesByDate: usedByDate,
  });

const dayOf = (r: ReturnType<typeof period>, date: string) => {
  const d = r.days.find((x) => x.date === date);
  assert.ok(d, `dia ${date} presente`);
  return d!;
};

/* ── I. Sem uso → factual = projetado = +1h ───────────────── */
const noUse = period({});
check("I0. sem uso [10+] → factual +1h e projetado +1h (idem)", () => {
  assert.equal(noUse.factualBalanceMinutes, 60, "0 + 120 − 60 = +1h");
  assert.equal(noUse.projectedBalanceMinutes, 60);
  assert.equal(noUse.appliedSpecialMinutes, 0);
  assert.equal(noUse.reviewRequiredMinutes, 0);
  assert.deepEqual(noUse.daysWithReview, []);
});
check("I1. 30min de [10+] no dia 7h (deficit) → factual CONTINUA +1h; projetado +1h30", () => {
  const r = period({ "2026-08-26": 30 });
  assert.equal(r.factualBalanceMinutes, 60, "factual inalterado pelo uso");
  assert.equal(r.appliedSpecialMinutes, 30);
  assert.equal(r.projectedBalanceMinutes, 90, "+1h30");
  const d = dayOf(r, "2026-08-26");
  assert.equal(d.projectable, true, "dia 7h = status 'deficit' → elegível");
  assert.equal(d.appliedSpecialMinutes, 30);
  assert.equal(d.projectedWorkedMinutes, 450, "dia 3 projetado 7h30");
  assert.equal(d.projectedBalanceMinutes, -30, "dia 3 projetado −30min");
  assert.equal(d.factualWorkedMinutes, 420, "dia 3 factual 7h intacto");
});
check("I2. dia 10h30 do cenário: [10+] gerado 30min não entra no saldo factual; dia não elegível", () => {
  const d = dayOf(noUse, "2026-08-25");
  assert.equal(d.factualWorkedMinutes, 630, "trabalhado factual 10h30");
  assert.equal(d.factualRegistrableMinutes, 600, "no ponto 10h (teto oficial)");
  assert.equal(d.factualRegularBalanceMinutes, 120, "saldo regular +2h ([10+] fora)");
  assert.equal(d.projectable, false, "10h30 = status 'excess' → não elegível");
});

/* ── J. Uso de 1h no dia 7h → factual +1h, projetado +2h ──── */
check("J. uso 1h no dia 7h → factual +1h, projetado +2h (não é trabalho a mais factual)", () => {
  const r = period({ "2026-08-26": 60 });
  assert.equal(r.factualBalanceMinutes, 60);
  assert.equal(r.appliedSpecialMinutes, 60);
  assert.equal(r.projectedBalanceMinutes, 120, "+2h");
  const d = dayOf(r, "2026-08-26");
  assert.equal(d.neededToBaseMinutes, 60);
  assert.equal(d.appliedSpecialMinutes, 60);
  assert.equal(d.projectedWorkedMinutes, 480, "dia projetado 8h");
  assert.equal(d.projectedBalanceMinutes, 0);
  assert.equal(d.needsReview, false);
});

/* ── K. Uso em dia 10h30 (excess) → NÃO elegível, review ──── */
check("K. uso 30min no dia 10h30 (excess) → NÃO elegível: applied 0, needsReview, sem extra artificial", () => {
  const r = period({ "2026-08-25": 30 });
  const d = dayOf(r, "2026-08-25");
  assert.equal(d.projectable, false, "10h30 = status 'excess' → não elegível");
  assert.equal(d.neededToBaseMinutes, 0);
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 30);
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedWorkedMinutes, 600, "permanece no ponto 10h");
  assert.equal(r.factualBalanceMinutes, 60);
  assert.equal(r.projectedBalanceMinutes, 60, "projeção inalterada");
  assert.equal(r.reviewRequiredMinutes, 30);
  assert.deepEqual(r.daysWithReview, ["2026-08-25"]);
});

/* ── L. Uso em data fora do escopo → não é aplicado ───────── */
check("L. uso em data fora do período → não afeta a projeção (destino único)", () => {
  const r = period({ "2026-08-20": 30 });
  assert.equal(r.appliedSpecialMinutes, 0);
  assert.equal(r.projectedBalanceMinutes, 60);
  assert.equal(r.reviewRequiredMinutes, 0, "uso fora do escopo não é 'excesso' do período");
  assert.deepEqual(r.daysWithReview, []);
});

/* ── ELE. Elegibilidade pelo status REAL de buildResumoDayRow ──
 * 24/08 = segunda-feira. Cada caso usa o MESMO dia com batidas/
 * faltas/ausências diferentes e 60min de uso registrado (tentativa
 * de uso) para provar: elegível → aplica; não elegível → não projeta
 * mas detecta (excessUsed + needsReview), factual intacto.
 */
const SINGLE = { from: "2026-08-24", to: "2026-08-24" };
let nextFaltaId = 1;
let nextAbsenceId = 1;

function singleDay(entries: TimeEntry[], over: { faltas?: Falta[]; absences?: Absence[] } = {}) {
  return projectRealizedPeriodOfficial({
    ...SINGLE,
    today: TODAY,
    entries,
    absences: over.absences ?? [],
    calendars: undefined,
    settings,
    faltas: over.faltas ?? [],
    controlStartDate: CONTROL_START,
    usedSpecialMinutesByDate: { "2026-08-24": 60 },
  });
}
function rowStatus(entries: TimeEntry[], over: { faltas?: Falta[]; absences?: Absence[] } = {}) {
  return buildResumoDayRow({
    date: "2026-08-24", today: TODAY, entries,
    absences: over.absences ?? [], calendars: undefined, settings,
    faltas: over.faltas ?? [], controlStartDate: CONTROL_START,
  }).status;
}

check("ELE1. jornada válida 7h/base8 → status 'deficit' → projectable true", () => {
  const entries = day7h("2026-08-24");
  assert.equal(rowStatus(entries), "deficit", "status real do dia 7h");
  const d = dayOf(singleDay(entries), "2026-08-24");
  assert.equal(d.projectable, true);
  assert.equal(d.neededToBaseMinutes, 60);
  assert.equal(d.appliedSpecialMinutes, 60, "uso de 1h completa a base");
  assert.equal(d.needsReview, false);
});
check("ELE2. jornada válida 7h30/base8 → status 'deficit' → projectable true", () => {
  const entries = day730("2026-08-24");
  assert.equal(rowStatus(entries), "deficit", "status real do dia 7h30");
  const d = dayOf(singleDay(entries), "2026-08-24");
  assert.equal(d.projectable, true);
  assert.equal(d.neededToBaseMinutes, 30);
  assert.equal(d.appliedSpecialMinutes, 30, "aplica só o necessário");
  assert.equal(d.excessUsedMinutes, 30, "o restante é sinalizado");
  assert.equal(d.needsReview, true);
});
check("ELE3. 8h (base cumprida) → status 'ok' → projectable false", () => {
  const entries = day8h("2026-08-24");
  assert.equal(rowStatus(entries), "ok", "status real do dia 8h");
  const d = dayOf(singleDay(entries), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 60, "uso indevido detectado");
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedWorkedMinutes, 480, "identity 8h");
  assert.equal(d.projectedBalanceMinutes, 0, "identity saldo 0");
});
check("ELE4. 8h30 (saldo positivo) → status 'ok' → projectable false", () => {
  const entries = day830("2026-08-24");
  assert.equal(rowStatus(entries), "ok", "status real do dia 8h30");
  const d = dayOf(singleDay(entries), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 60);
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedWorkedMinutes, 510, "identity 8h30 (sem +1h artificial)");
  assert.equal(d.projectedBalanceMinutes, 30, "identity +30min");
});
check("ELE5. falta → status 'falta' → projectable false (factual intacto)", () => {
  const faltas: Falta[] = [{ id: nextFaltaId++, date: "2026-08-24", createdAt: 1 }];
  assert.equal(rowStatus([], { faltas }), "falta", "status real do dia de falta");
  const d = dayOf(singleDay([], { faltas }), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.factualWorkedMinutes, 0, "falta não é jornada trabalhada");
  assert.equal(d.factualRegularBalanceMinutes, -480, "saldo factual da falta (−jornada) intacto");
  assert.equal(d.appliedSpecialMinutes, 0, "[10+] não projeta falta");
  assert.equal(d.excessUsedMinutes, 60);
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedWorkedMinutes, 0, "identity");
  assert.equal(d.projectedBalanceMinutes, -480, "identity");
});
check("ELE6. férias → status 'ferias' → projectable false", () => {
  const absences: Absence[] = [{
    id: nextAbsenceId++, kind: "ferias", startDate: "2026-08-24", endDate: "2026-08-24",
    duration: "integral", note: null, createdAt: 1,
  }];
  assert.equal(rowStatus([], { absences }), "ferias", "status real do dia de férias");
  const d = dayOf(singleDay([], { absences }), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.factualRegularBalanceMinutes, 0, "férias: saldo neutro");
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 60);
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedBalanceMinutes, 0, "identity");
});
check("ELE7. afastamento → status 'afastamento' → projectable false", () => {
  const absences: Absence[] = [{
    id: nextAbsenceId++, kind: "saude", startDate: "2026-08-24", endDate: "2026-08-24",
    duration: "integral", note: null, createdAt: 1,
  }];
  assert.equal(rowStatus([], { absences }), "afastamento", "status real do dia de afastamento");
  const d = dayOf(singleDay([], { absences }), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 60);
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedBalanceMinutes, d.factualRegularBalanceMinutes, "identity");
});
check("ELE8. dia incompleto (ponto financeiro pendente) → status 'incomplete' → projectable false", () => {
  const entries = [punch("2026-08-24", "08:00", "entrada")]; // só entrada, dia passado
  assert.equal(rowStatus(entries), "incomplete", "status real do dia incompleto");
  const d = dayOf(singleDay(entries), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 60);
  assert.equal(d.needsReview, true, "uso em dia sem fato definido é detectado");
  assert.equal(d.projectedWorkedMinutes, d.factualWorkedMinutes, "identity");
  assert.equal(d.projectedBalanceMinutes, d.factualRegularBalanceMinutes, "identity");
});
check("ELE9. dia inconsistente → status 'inconsistent' → projectable false", () => {
  const entries = [punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "09:00", "entrada")];
  assert.equal(rowStatus(entries), "inconsistent", "status real do dia inconsistente");
  const d = dayOf(singleDay(entries), "2026-08-24");
  assert.equal(d.projectable, false);
  assert.equal(d.appliedSpecialMinutes, 0);
  assert.equal(d.excessUsedMinutes, 60);
  assert.equal(d.needsReview, true);
  assert.equal(d.projectedWorkedMinutes, d.factualWorkedMinutes, "identity");
  assert.equal(d.projectedBalanceMinutes, d.factualRegularBalanceMinutes, "identity");
});

/* ── Invariantes ──────────────────────────────────────────── */
check("INV1. factualWorkedMinutes nunca muda (eco dos insumos)", () => {
  for (const used of [0, 30, 60, 120]) {
    const inp = dayInput({ factualWorkedMinutes: 420, usedSpecialMinutes: used });
    assert.equal(projectRealizedDayOfficial(inp).factualWorkedMinutes, 420);
  }
});
check("INV2. factualRegularBalanceMinutes nunca muda (eco dos insumos)", () => {
  for (const used of [0, 30, 60, 120]) {
    const inp = dayInput({ factualRegularBalanceMinutes: -60, usedSpecialMinutes: used });
    assert.equal(projectRealizedDayOfficial(inp).factualRegularBalanceMinutes, -60);
  }
});
check("INV3. appliedSpecialMinutes <= neededToBaseMinutes (todos os casos)", () => {
  const cases: Array<[number, number]> = [
    [420, 60], [420, 30], [450, 30], [465, 15], [480, 30], [510, 30], [450, 60], [420, 120],
  ];
  for (const [worked, used] of cases) {
    const p = projectRealizedDayOfficial(dayInput({
      factualWorkedMinutes: worked, factualRegistrableMinutes: worked,
      factualRegularBalanceMinutes: worked - BASE, usedSpecialMinutes: used,
    }));
    assert.ok(p.appliedSpecialMinutes <= p.neededToBaseMinutes, `${worked}/${used}`);
  }
});
check("INV4. projeção nunca ultrapassa a base por causa do [10+]", () => {
  // elegível (abaixo da base) → projetado ≤ base
  for (const worked of [420, 450, 465]) {
    const p = projectRealizedDayOfficial(dayInput({
      factualWorkedMinutes: worked, factualRegistrableMinutes: worked,
      factualRegularBalanceMinutes: worked - BASE, usedSpecialMinutes: 60,
    }));
    assert.ok(p.projectedWorkedMinutes <= BASE, `${worked}: ${p.projectedWorkedMinutes} ≤ ${BASE}`);
  }
  // não elegível (já ≥ base) → identity: nada é somado
  const f = projectRealizedDayOfficial(dayInput({
    factualWorkedMinutes: 510, factualRegistrableMinutes: 510,
    factualRegularBalanceMinutes: 30, financialValid: false, usedSpecialMinutes: 30,
  }));
  assert.equal(f.projectedWorkedMinutes, 510);
});
check("INV5. [10+] nunca cria crédito regular positivo artificial no destino", () => {
  for (const [worked, bal] of [[480, 0], [510, 30], [600, 120]] as Array<[number, number]>) {
    const p = projectRealizedDayOfficial(dayInput({
      factualWorkedMinutes: worked, factualRegistrableMinutes: worked,
      factualRegularBalanceMinutes: bal, financialValid: false, usedSpecialMinutes: 30,
    }));
    assert.equal(p.appliedSpecialMinutes, 0);
    assert.equal(p.projectedBalanceMinutes, bal, `saldo ${bal} permanece ${bal}`);
    assert.equal(p.needsReview, true, "uso em dia não elegível é detectado");
  }
});
check("INV6. needsReview ⇔ uso acima do aplicado (inclusive em dia não elegível)", () => {
  const withReview = [
    // elegível, uso > necessidade
    projectRealizedDayOfficial(dayInput({ factualWorkedMinutes: 450, factualRegistrableMinutes: 450, factualRegularBalanceMinutes: -30, usedSpecialMinutes: 60 })),
    // não elegível (base cumprida / saldo positivo), uso > 0
    projectRealizedDayOfficial(dayInput({ factualWorkedMinutes: 480, factualRegistrableMinutes: 480, factualRegularBalanceMinutes: 0, financialValid: false, usedSpecialMinutes: 30 })),
    projectRealizedDayOfficial(dayInput({ factualWorkedMinutes: 510, factualRegistrableMinutes: 510, factualRegularBalanceMinutes: 30, financialValid: false, usedSpecialMinutes: 30 })),
  ];
  assert.ok(withReview.every((p) => p.needsReview), "excesso/uso indevido → needsReview");
  const noReview = [
    projectRealizedDayOfficial(dayInput({ usedSpecialMinutes: 60 })), // elegível, uso ≤ necessidade
    projectRealizedDayOfficial(dayInput({ usedSpecialMinutes: 0 })), // sem uso
    projectRealizedDayOfficial(dayInput({ financialValid: false, usedSpecialMinutes: 0 })), // não elegível, sem uso
  ];
  assert.ok(noReview.every((p) => !p.needsReview), "sem excesso → sem review");
});
check("INV7. dia não elegível: sem projeção (identity, applied 0) + uso detectado", () => {
  for (const over of [{ financialValid: false }, { realized: false, financialValid: false }] as const) {
    const p = projectRealizedDayOfficial(dayInput({ ...over, usedSpecialMinutes: 60 }));
    assert.equal(p.projectable, false);
    assert.equal(p.appliedSpecialMinutes, 0);
    assert.equal(p.projectedWorkedMinutes, 420, "identity");
    assert.equal(p.projectedBalanceMinutes, -60, "factual intacto");
    assert.equal(p.excessUsedMinutes, 60, "uso indevido sinalizado");
    assert.equal(p.needsReview, true);
  }
});
check("INV8. saldo factual do período é independente do uso [10+]", () => {
  const r1 = period({});
  const r2 = period({ "2026-08-26": 30 });
  const r3 = period({ "2026-08-26": 60 });
  assert.equal(r1.factualBalanceMinutes, 60);
  assert.equal(r2.factualBalanceMinutes, 60);
  assert.equal(r3.factualBalanceMinutes, 60);
});
check("INV9. saldo projetado do período muda apenas pelo [10+] efetivamente aplicável", () => {
  for (const r of [period({}), period({ "2026-08-26": 30 }), period({ "2026-08-26": 60 }), period({ "2026-08-25": 30 })]) {
    assert.equal(r.projectedBalanceMinutes, r.factualBalanceMinutes + r.appliedSpecialMinutes);
  }
});
check("INV10. saldo factual do período = MESMA fonte do Resumo (Σ balanceContribution)", () => {
  let resumo = 0;
  for (const date of listDaysBetween(PERIOD.from, PERIOD.to)) {
    resumo += buildResumoDayRow({
      date, today: TODAY, entries: scenarioEntries, absences: [], calendars: undefined,
      settings, faltas: [], controlStartDate: CONTROL_START,
    }).balanceContribution;
  }
  assert.equal(period({}).factualBalanceMinutes, resumo, "idêntico ao 'Saldo do período' do Resumo");
});
check("INV11. função é pura: não muta o objeto de insumo", () => {
  const inp = dayInput({ usedSpecialMinutes: 60 });
  const snapshot = { ...inp };
  projectRealizedDayOfficial(inp);
  assert.deepEqual(inp, snapshot, "insumo inalterado");
});
check("INV12. elegibilidade: SOMENTE status 'deficit' (jornada válida abaixo da base)", () => {
  assert.ok(isProjectableDayStatus("deficit"));
  for (const s of ["ok", "excess", "falta", "ferias", "afastamento", "in-progress", "inconsistent", "incomplete", "future", "empty", "idle"] as const) {
    assert.ok(!isProjectableDayStatus(s), `"${s}" não elegível`);
  }
});

console.log(`\nPROJEÇÃO OFICIAL (ÉTAPA 3A) — OK (${passed} testes)`);
