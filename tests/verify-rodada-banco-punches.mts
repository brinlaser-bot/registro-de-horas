/**
 * VERIFICAÇÃO — Banco unificado, ABONO_PARCIAL (Cinzas) e sequência de batidas.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-rodada-banco-punches.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyzePunches } from "../src/lib/punches.ts";
import { computeDay, insertPunchError } from "../src/lib/time.ts";
import { hourBankSummary, negativeBalanceViews, realizedNegativeOpenMinutes, specialExcessLedger } from "../src/lib/hour-bank.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { debtOriginLabel } from "../src/lib/compensar.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = { id: 1, name: "Teste", email: "t@t.com", ...settings, birthDate: null };
const cals = seedCompanyCalendars();
const TODAY = "2026-08-26";
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

const acordo: Absence = {
  id: 1, kind: "acordado", startDate: "2026-08-06", endDate: "2026-08-06",
  duration: "integral", treatment: "compensar", note: null, createdAt: 1,
};

const reset = (entries: TimeEntry[] = [], comps: Compensation[] = [], absences: Absence[] = [acordo]) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences,
    companyCalendars: cals, faltas: [], excessReasons: [],
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const calDates = ["2026-05-04", "2026-06-05", "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-08-25"];

check("BANCO. estoque realizado 62h20 = soma Dias com saldo negativo", () => {
  const comps: Compensation[] = [
    { id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120, status: "concluida", note: null, kind: "acordo", createdAt: 1 },
  ];
  const entries = [
    punch("2026-08-19", "08:00", "entrada"), punch("2026-08-19", "16:40", "saida"),
  ];
  const bank = hourBankSummary(entries, comps, [acordo], cals, [], [], settings, { from: "2026-05-01", to: "2027-04-30" }, TODAY);
  const views = negativeBalanceViews(entries, comps, [acordo], cals, [], settings, { from: "2026-05-01", to: "2027-04-30" }, TODAY);
  const sum = views.reduce((s, d) => s + d.openMinutes, 0);
  const open = realizedNegativeOpenMinutes(entries, comps, [acordo], cals, [], settings, TODAY);
  assert.equal(open, sum, "agregador = soma dos cards");
  assert.equal(bank.openNegativeTotal, sum, "Banco = Dias com saldo negativo");
  // 7×8h calendário + acordo 6h + déficit 19/08 20min = 62h20
  assert.equal(sum, 7 * 480 + 360 + 20, `esperado 62h20, veio ${sum}`);
});

check("BANCO. 4h em 25/08 → 58h20; 10min de 10+ → 58h10", () => {
  const comps: Compensation[] = [
    { id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120, status: "concluida", note: null, kind: "acordo", createdAt: 1 },
  ];
  const work25 = [punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida")];
  const def19 = [punch("2026-08-19", "08:00", "entrada"), punch("2026-08-19", "16:40", "saida")];
  const afterWork = realizedNegativeOpenMinutes([...def19, ...work25], comps, [acordo], cals, [], settings, TODAY);
  assert.equal(afterWork, 7 * 480 + 360 + 20 - 240, "25/08 efetiva 4h");

  reset(
    [...def19, ...work25, punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "20:00", "saida")],
    comps,
  );
  actions.setExcessReason({ date: "2026-08-24", reason: "demanda-urgente" });
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-25", minutes: 10, kind: "calendario" });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const after = realizedNegativeOpenMinutes(d.entries, d.compensations, d.absences, cals, [], settings, TODAY);
  assert.equal(after, 7 * 480 + 360 + 20 - 240 - 10);
  const led = specialExcessLedger("2026-08-24", d.compensations, 60, cals);
  assert.ok(led.realizedTo.some((t) => t.originLabel.includes("Folga a compensar") && t.date === "2026-08-25"));
  assert.equal(debtOriginLabel("calendario", "2026-08-25", cals), "Folga a compensar — Calendário");
});

check("CINZAS. 10/02/2027 é ABONADO_PARCIAL, sem obrigação COMPENSAR", () => {
  const ctx = companyDayContext("2027-02-10", [], [], cals, settings);
  assert.equal(ctx.calendarEntry?.tratamento, "ABONADO_PARCIAL");
  assert.equal(ctx.marker, "abono-parcial");
  assert.match(ctx.label ?? "", /ABONO PARCIAL/);
  assert.equal(ctx.effectiveExpected, 240);
  assert.equal(ctx.calendarioACompensar, 0);
  const bank = hourBankSummary([], [], [], cals, [], [], settings, { from: "2026-05-01", to: "2027-04-30" }, "2026-08-26");
  const views = negativeBalanceViews([], [], [], cals, [], settings, { from: "2026-05-01", to: "2027-04-30" }, "2026-08-26");
  assert.ok(!views.some((v) => v.date === "2027-02-10"), "Cinzas futura não entra no realizado");
  void bank;
});

check("CINZAS. passada sem trabalho na tarde = déficit 4h; manhã não quita a tarde", () => {
  const past = "2027-02-11";
  const empty = companyDayContext("2027-02-10", [], [], cals, settings);
  assert.equal(empty.adjustedDeficit, 240);
  const morning = [
    punch("2027-02-10", "09:00", "entrada"), punch("2027-02-10", "11:00", "saida"),
  ];
  const mctx = companyDayContext("2027-02-10", morning, [], cals, settings);
  assert.equal(mctx.workedInAbonoMinutes, 120);
  assert.equal(mctx.adjustedDeficit, 240, "2h de manhã NÃO quitam a jornada 13–17");
  const afternoon = [
    punch("2027-02-10", "13:00", "entrada"), punch("2027-02-10", "17:00", "saida"),
  ];
  const actx = companyDayContext("2027-02-10", afternoon, [], cals, settings);
  assert.equal(actx.adjustedDeficit, 0);
  void past;
});

const S = settings;
const e = (id: number, time: string, type: "entrada" | "saida") => ({ id, date: "2026-08-21", time, type, note: null });

check("PUNCH A. 08E 12S 13E 17S = 8h complete consistent", () => {
  const entries = [e(1, "08:00", "entrada"), e(2, "12:00", "saida"), e(3, "13:00", "entrada"), e(4, "17:00", "saida")];
  const a = analyzePunches(entries);
  assert.equal(a.isComplete, true);
  assert.equal(a.isConsistent, true);
  const day = computeDay(entries, S);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.financialPending, false);
});

check("PUNCH B. duas entradas: inconsistente, saldo não finaliza", () => {
  const entries = [e(1, "08:00", "entrada"), e(2, "13:00", "entrada"), e(3, "17:00", "saida")];
  const a = analyzePunches(entries);
  assert.equal(a.isConsistent, false);
  const day = computeDay(entries, S);
  assert.equal(day.financialPending, true);
  assert.equal(day.excessMinutes, 0);
  assert.notEqual(day.workedMinutes, 540, "não emparelha 08→17");
});

check("PUNCH C. duas saídas: inconsistente", () => {
  const entries = [e(1, "08:00", "entrada"), e(2, "12:00", "saida"), e(3, "17:00", "saida")];
  assert.equal(analyzePunches(entries).isConsistent, false);
  assert.equal(computeDay(entries, S).financialPending, true);
});

check("PUNCH D. entrada aberta passada: incompleto, sem déficit definitivo", () => {
  const entries = [e(1, "08:00", "entrada"), e(2, "12:00", "saida"), e(3, "13:00", "entrada")];
  const a = analyzePunches(entries);
  assert.equal(a.isComplete, false);
  assert.equal(a.isConsistent, true);
  const day = computeDay(entries, S);
  assert.equal(day.open, true);
});

check("PUNCH E. editar 17S → 13E: aceita, fica incompleto", () => {
  const existing = [e(1, "08:00", "entrada"), e(2, "12:00", "saida"), e(3, "17:00", "saida")];
  const edited = { ...existing[2], time: "13:00", type: "entrada" as const };
  assert.equal(insertPunchError(existing, edited), null);
  const a = analyzePunches([existing[0], existing[1], edited]);
  assert.equal(a.isConsistent, true);
  assert.equal(a.isComplete, false);
});

check("PUNCH F. inserir 08–12 quando já existe 13–17", () => {
  const existing = [e(3, "13:00", "entrada"), e(4, "17:00", "saida")];
  const add = [e(1, "08:00", "entrada"), e(2, "12:00", "saida")];
  assert.equal(insertPunchError(existing, add), null);
  const day = computeDay([...existing, ...add], S);
  assert.equal(day.workedMinutes, 480);
});

check("PUNCH G. sobreposição 16–18 em 13–17 bloqueada", () => {
  const existing = [e(1, "13:00", "entrada"), e(2, "17:00", "saida")];
  const add = [e(3, "16:00", "entrada"), e(4, "18:00", "saida")];
  const err = insertPunchError(existing, add);
  assert.ok(err && err.includes("sobrepon"));
});

check("ALMOÇO. 08–17 fallback 1h; 12:30–13:15 substitui (8h15)", () => {
  const base = [e(1, "08:00", "entrada"), e(2, "17:00", "saida")];
  assert.equal(computeDay(base, S).workedMinutes, 480);
  assert.equal(computeDay(base, S).lunchDeductedMinutes, 60);
  const withLunch = [e(1, "08:00", "entrada"), e(2, "12:30", "saida"), e(3, "13:15", "entrada"), e(4, "17:00", "saida")];
  const day = computeDay(withLunch, S);
  assert.equal(day.lunchDeductedMinutes, 0);
  assert.equal(day.workedMinutes, 495);
});

check("STORE. addEntries 08–12 + 13–17 de uma vez = 8h; modal fecha", () => {
  reset([]);
  const res = actions.addEntries([
    { date: "2026-08-21", time: "08:00", type: "entrada", note: null, source: "manual" },
    { date: "2026-08-21", time: "12:00", type: "saida", note: null, source: "manual" },
    { date: "2026-08-21", time: "13:00", type: "entrada", note: null, source: "manual" },
    { date: "2026-08-21", time: "17:00", type: "saida", note: null, source: "manual" },
  ]);
  assert.equal(res.ok, true, res.error);
  assert.equal(getAppData().entries.length, 4);
  assert.equal(computeDay(getAppData().entries, S).workedMinutes, 480);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("inflight"));
  assert.ok(modal.includes("onClose()"));
  assert.ok(modal.includes("Adicionar registros"));
});

check("STORE. já existe 13–17; addEntries 08–12 ordena e aceita", () => {
  reset([punch("2026-08-21", "13:00", "entrada"), punch("2026-08-21", "17:00", "saida")]);
  const res = actions.addEntries([
    { date: "2026-08-21", time: "08:00", type: "entrada", note: null },
    { date: "2026-08-21", time: "12:00", type: "saida", note: null },
  ]);
  assert.equal(res.ok, true, res.error);
  assert.equal(computeDay(getAppData().entries.filter((e) => e.date === "2026-08-21"), S).workedMinutes, 480);
});

check("EXCLUSÃO. apagar 13E deixa inconsistente; restaurar volta a 8h", () => {
  reset([
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "12:00", "saida"),
    punch("2026-08-21", "13:00", "entrada"), punch("2026-08-21", "17:00", "saida"),
  ]);
  const mid = getAppData().entries.find((e) => e.time === "13:00")!;
  assert.equal(actions.deleteEntry(mid.id).ok, true);
  const broken = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-21"), S);
  assert.equal(broken.financialPending, true);
  assert.equal(actions.addEntries([{ date: "2026-08-21", time: "13:00", type: "entrada", note: null }]).ok, true);
  const ok = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-21"), S);
  assert.equal(ok.workedMinutes, 480);
  assert.equal(ok.financialPending, false);
});

check("UI. modal 10+ preserva natureza; Registros tem ações COMPENSAR", () => {
  const alloc = srcOf("src/components/allocate-excess-modal.tsx");
  assert.ok(alloc.includes("Quitar saldo negativo com excedente disponível"));
  assert.ok(alloc.includes("selectedDeficit.originLabel"));
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Usar excedente disponível"));
  assert.ok(card.includes("Como foi quitado"));
  assert.ok(card.includes("Obrigação efetiva"));
  assert.ok(card.includes("Excluir batida?"));
});

check("SEED. Cinzas não é COMPENSAR 4h", () => {
  const cinzas = cals[0].entries.find((e) => e.date === "2027-02-10")!;
  assert.equal(cinzas.tratamento, "ABONADO_PARCIAL");
  assert.equal(cinzas.horasACompensar, 0);
  const compensar = cals[0].entries.filter((e) => e.tratamento === "COMPENSAR");
  assert.equal(compensar.length, 18);
});

reset([]);
console.log(`\nRODADA BANCO/PUNCHES — OK (${passed} testes)`);
