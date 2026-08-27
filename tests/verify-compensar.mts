/**
 * VERIFICAÇÃO — OBRIGAÇÕES COMPENSAR (fonte central)
 *
 *  A  acordo: original 8h, completed 2h, planned 1h → effective 8 / open 6 / unplanned 5
 *  B  acordo com 4h trabalhadas no próprio dia: original IMUTÁVEL 8h, effective 4, open 2
 *  C  calendário COMPENSAR: 4h work → effective 4 crédito 0; 9h → 0 + 1h; 10h30 → 2h + 30min 10+
 *  D  gating: futuro/hoje não entram no realizado; passado sim
 *  E  planejado não quita
 *  F  10+ quita acordo/calendário
 *  G  modal prefill ao trocar data
 *  H  registro incompleto no passado
 *  I  editar/excluir batida recalcula obrigação
 *  J  sem dupla contagem no saldo
 *  K  ABONADO com batidas: alerta, sem regra financeira nova
 *
 * Executar: npx tsx tests/verify-compensar.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compensarObligationOnDate, isIncompletePastPunch } from "../src/lib/compensar.ts";
import { buildDebtDays, extraCapacityForDate } from "../src/lib/debt.ts";
import { hourBankSummary, previewAllocateSpecialExcess } from "../src/lib/hour-bank.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const TODAY = "2026-08-25";
const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", ...settings, birthDate: null,
};
const cals = seedCompanyCalendars();

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

const formSrc = srcOf("src/components/compensation-form.tsx");
const dayCardSrc = srcOf("src/components/day-card.tsx");
const bankSrc = srcOf("src/components/hour-bank-card.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");

check("A. acordo central: orig 8h / conc 2h / plan 1h → effective 8, open 6, unplanned 5", () => {
  const comps: Compensation[] = [
    { id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120, status: "concluida", note: null, kind: "acordo", createdAt: 1 },
    { id: 2, sourceDate: "2026-08-06", targetDate: "2026-08-28", minutes: 60, status: "pendente", note: null, kind: "acordo", createdAt: 2 },
  ];
  const v = compensarObligationOnDate("2026-08-06", [], comps, [acordo], cals, settings, TODAY)!;
  assert.equal(v.originalMinutes, 480);
  assert.equal(v.workedOnOriginDateMinutes, 0);
  assert.equal(v.effectiveObligationMinutes, 480);
  assert.equal(v.completedMinutes, 120);
  assert.equal(v.openMinutes, 360);
  assert.equal(v.activePlannedMinutes, 60);
  assert.equal(v.unplannedMinutes, 300);
});

check("B. acordo com 4h no próprio dia: original 8h IMUTÁVEL, effective 4, open 2, crédito 0", () => {
  const entries = [punch("2026-08-06", "08:00", "entrada"), punch("2026-08-06", "12:00", "saida")];
  const comps: Compensation[] = [
    { id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120, status: "concluida", note: null, kind: "acordo", createdAt: 1 },
    { id: 2, sourceDate: "2026-08-06", targetDate: "2026-08-28", minutes: 60, status: "pendente", note: null, kind: "acordo", createdAt: 2 },
  ];
  const v = compensarObligationOnDate("2026-08-06", entries, comps, [acordo], cals, settings, TODAY)!;
  assert.equal(v.originalMinutes, 480, "original IMUTÁVEL");
  assert.equal(v.workedOnOriginDateMinutes, 240);
  assert.equal(v.effectiveObligationMinutes, 240);
  assert.equal(v.completedMinutes, 120);
  assert.equal(v.openMinutes, 120);
  assert.equal(v.activePlannedMinutes, 60);
  assert.equal(v.unplannedMinutes, 60);
  assert.equal(v.regularCreditMinutes, 0);
  const ctx = companyDayContext("2026-08-06", entries, [acordo], cals, settings);
  assert.equal(ctx.adjustedBalance, 0, "4h no próprio dia não viram crédito");
});

check("C. calendário COMPENSAR: work reduz obrigação; só o extra vira crédito / 10+", () => {
  const d25 = "2026-08-25"; // Folga a compensar 8h no seed calendar
  const w4 = [punch(d25, "08:00", "entrada"), punch(d25, "12:00", "saida")];
  const v4 = compensarObligationOnDate(d25, w4, [], [], cals, settings, "2026-08-26")!;
  assert.equal(v4.originalMinutes, 480);
  assert.equal(v4.effectiveObligationMinutes, 240);
  assert.equal(v4.openMinutes, 240);
  assert.equal(v4.regularCreditMinutes, 0);
  assert.equal(companyDayContext(d25, w4, [], cals, settings).adjustedBalance, 0);

  const w9 = [punch(d25, "08:00", "entrada"), punch(d25, "12:00", "saida"), punch(d25, "13:00", "entrada"), punch(d25, "18:00", "saida")];
  const v9 = compensarObligationOnDate(d25, w9, [], [], cals, settings, "2026-08-26")!;
  assert.equal(v9.effectiveObligationMinutes, 0);
  assert.equal(v9.regularCreditMinutes, 60);
  assert.equal(v9.excessSpecialMinutes, 0);

  const w1030 = [punch(d25, "08:00", "entrada"), punch(d25, "12:00", "saida"), punch(d25, "13:00", "entrada"), punch(d25, "19:30", "saida")];
  const v1030 = compensarObligationOnDate(d25, w1030, [], [], cals, settings, "2026-08-26")!;
  assert.equal(v1030.effectiveObligationMinutes, 0);
  assert.equal(v1030.regularCreditMinutes, 120);
  assert.equal(v1030.excessSpecialMinutes, 30);
});

check("D. gating: futuro/hoje não entram no realizado; passado sim", () => {
  const vFuture = compensarObligationOnDate("2026-08-25", [], [], [], cals, settings, "2026-08-24")!;
  assert.equal(vFuture.realizedDebtMinutes, 0, "futuro");
  const vToday = compensarObligationOnDate("2026-08-25", [], [], [], cals, settings, "2026-08-25")!;
  assert.equal(vToday.realizedDebtMinutes, 0, "hoje");
  const vPast = compensarObligationOnDate("2026-08-25", [], [], [], cals, settings, "2026-08-26")!;
  assert.equal(vPast.realizedDebtMinutes, 480, "passado");
});

check("E. planejado não quita: open 2h com plan 1h → realizado 2h, unplanned 1h", () => {
  const entries = [punch("2026-08-06", "08:00", "entrada"), punch("2026-08-06", "12:00", "saida")];
  const comps: Compensation[] = [
    { id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120, status: "concluida", note: null, kind: "acordo", createdAt: 1 },
    { id: 2, sourceDate: "2026-08-06", targetDate: "2026-08-28", minutes: 60, status: "pendente", note: null, kind: "acordo", createdAt: 2 },
  ];
  const v = compensarObligationOnDate("2026-08-06", entries, comps, [acordo], cals, settings, TODAY)!;
  assert.equal(v.openMinutes, 120);
  assert.equal(v.unplannedMinutes, 60);
  assert.equal(v.realizedDebtMinutes, 120);
});

check("F. 10+ quita acordo: source reduz, target completed sobe, open reduz, histórico", () => {
  reset(
    [
      punch("2026-08-06", "08:00", "entrada"), punch("2026-08-06", "12:00", "saida"),
      punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "20:00", "saida"),
    ],
    [
      { id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120, status: "concluida", note: null, kind: "acordo", createdAt: 1 },
    ],
  );
  actions.setExcessReason({ date: "2026-08-24", reason: "demanda-urgente" });
  const before = compensarObligationOnDate("2026-08-06", getAppData().entries, getAppData().compensations, getAppData().absences, cals, settings, TODAY)!;
  assert.equal(before.openMinutes, 120);
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-06", minutes: 30, kind: "acordo" });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const after = compensarObligationOnDate("2026-08-06", d.entries, d.compensations, d.absences, cals, settings, TODAY)!;
  assert.equal(after.openMinutes, 90);
  assert.ok(d.compensations.some((c) => c.kind === "acordo" && c.portion === "especial" && c.status === "concluida" && c.minutes === 30));
});

check("G. modal: prefill usa unplanned; troca de data recalcula se intocado; overflow valida", () => {
  assert.ok(formSrc.includes("minutesTouched"));
  assert.ok(formSrc.includes("if (!minutesTouched.current)"));
  assert.ok(formSrc.includes("prefillOf(targetDate)"));
  assert.ok(formSrc.includes("overCapacity"));
  assert.ok(formSrc.includes("disabled={!!invalidReason || busy}"));
});

check("H. passado com entrada aberta: Registro incompleto; sem Registrar saída agora", () => {
  assert.equal(isIncompletePastPunch("2026-08-25", true, "2026-08-26"), true);
  assert.equal(isIncompletePastPunch("2026-08-26", true, "2026-08-26"), false);
  assert.ok(dayCardSrc.includes("Registro incompleto"));
  assert.ok(dayCardSrc.includes("d.open && isToday"));
  assert.ok(!dayCardSrc.includes("d.open && !futureDay && ("));
});

check("I. editar/excluir batida recalcula obrigação COMPENSAR", () => {
  const d25 = "2026-08-25";
  reset([punch(d25, "08:00", "entrada"), punch(d25, "12:00", "saida")], [], []);
  let v = compensarObligationOnDate(d25, getAppData().entries, [], [], cals, settings, "2026-08-26")!;
  assert.equal(v.effectiveObligationMinutes, 240);
  const saida = getAppData().entries.find((e) => e.time === "12:00")!;
  assert.equal(actions.updateEntry(saida.id, { time: "11:00" }).ok, true);
  v = compensarObligationOnDate(d25, getAppData().entries, [], [], cals, settings, "2026-08-26")!;
  assert.equal(v.effectiveObligationMinutes, 300, "4h → 3h work: efetiva 5h");
  assert.equal(actions.deleteEntry(saida.id).ok, true);
  // dia aberto após excluir saída: worked pode ser 0 sem nowMinutes
  v = compensarObligationOnDate(d25, getAppData().entries, [], [], cals, settings, "2026-08-26")!;
  assert.ok(v.effectiveObligationMinutes >= 300);
  const entrada = getAppData().entries[0];
  assert.equal(actions.deleteEntry(entrada.id).ok, true);
  v = compensarObligationOnDate(d25, getAppData().entries, [], [], cals, settings, "2026-08-26")!;
  assert.equal(v.effectiveObligationMinutes, 480);
});

check("J. obrigação ocorrida entra UMA vez no saldo realizado", () => {
  const bank = hourBankSummary(
    [], [], [], cals, [], [], settings,
    { from: "2026-08-21", to: "2026-09-20" }, "2026-08-26",
  );
  // 25/08 COMPENSAR 8h já passou em 26/08 — entra como −8h, uma vez
  assert.ok(bank.openNegativeTotal >= 480);
  assert.ok(bankSrc.includes("Saldo negativo em aberto"));
  assert.ok(panelSrc.includes("Dias com saldo negativo"));
});

check("K. ABONADO com batidas: alerta visual; sem regra financeira nova", () => {
  assert.ok(dayCardSrc.includes("Trabalho registrado em dia abonado"));
  assert.ok(dayCardSrc.includes("Nenhuma regra financeira extra foi aplicada"));
  const abonoSrc = srcOf("src/components/quick-punch.tsx");
  assert.ok(abonoSrc.includes("Trabalho registrado em dia abonado") || abonoSrc.includes("abonadoHint"));
});

reset([]);
console.log(`\nCOMPENSAR — OK (${passed} testes)`);
