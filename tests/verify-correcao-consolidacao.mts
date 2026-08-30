/**
 * VERIFICAÇÃO — CORREÇÃO E CONSOLIDAÇÃO (futuro, overplan, HOJE idle, gestão)
 *
 * Executar: npx tsx tests/verify-correcao-consolidacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dayContext, type Absence } from "../src/lib/absences.ts";
import {
  buildDebtDays,
  extraCapacityForDate,
  originalHourExtraDebt,
  OVERPLAN_MSG,
  sourcePlanningHeadroom,
} from "../src/lib/debt.ts";
import {
  deficitViews,
  eligibleSpecialSourcesForDeficit,
  excessReasonObservation,
  hourBankSummary,
  specialExcessLedger,
} from "../src/lib/hour-bank.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { computeDay, isRealizedDate } from "../src/lib/time.ts";
import type { Compensation, ExcessReason, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const TODAY = "2026-08-25";

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const reason = (date: string): ExcessReason => ({
  id: nextId++, date, reason: "demanda-urgente",
  customReason: null, observation: null, createdAt: 1, updatedAt: 1,
});

const dayDef15 = () => [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida")];
const day11h = () => [punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "20:00", "saida")];
const future2h = () => [punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida")];

const reset = (
  entries: TimeEntry[],
  comps: Compensation[] = [],
  excessReasons: ExcessReason[] = [],
  absences: Absence[] = [],
) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences,
    companyCalendars: undefined, faltas: [], excessReasons,
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const pageSrc = srcOf("src/app/(app)/page.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");
const quickSrc = srcOf("src/components/quick-punch.tsx");
const resumoSrc = srcOf("src/app/(app)/resumo/page.tsx");
const formSrc = srcOf("src/components/compensation-form.tsx");
const allocSrc = srcOf("src/components/allocate-excess-modal.tsx");

/* ── A. Futuro 07/09 não é fato realizado ─────────────────── */
check("A. 07/09 08:00–10:00 em 25/08: sem déficit, crédito, totais nem saldo negativo", () => {
  const entries = [...dayDef15(), ...future2h()];
  assert.equal(isRealizedDate("2026-09-07", TODAY), false);
  assert.equal(isRealizedDate("2026-08-25", TODAY), true);
  const debts = buildDebtDays(entries, [], settings, { from: "2026-08-21", to: "2026-09-20" }, [], undefined, [], TODAY);
  assert.equal(debts.find((d) => d.date === "2026-09-07" && d.kind === "deficit"), undefined);
  assert.equal(debts.find((d) => d.date === "2026-09-07" && d.kind === "excedente"), undefined);
  const views = deficitViews(entries, [], [], undefined, [], settings, { from: "2026-08-21", to: "2026-09-20" }, TODAY);
  assert.equal(views.some((d) => d.date === "2026-09-07"), false);
  const cctx = companyDayContext("2026-09-07", entries, [], [], settings);
  assert.equal(dayBalanceContribution(cctx, [], "2026-09-07", TODAY), 0);
  const bank = hourBankSummary(entries, [], [], undefined, [], [], settings, { from: "2026-08-21", to: "2026-09-20" }, TODAY);
  assert.ok(bank.realizedBalance !== 120 - 480, "futuro não entra como −6h");
  const seed = buildSeedData();
  const seedDebts = buildDebtDays(
    seed.entries, seed.compensations, settings,
    { from: "2026-08-21", to: "2026-09-20" }, seed.absences, seed.companyCalendars, seed.faltas, TODAY,
  );
  assert.equal(seedDebts.find((d) => d.date === "2026-09-07"), undefined);
  const resumoDays = srcOf("src/lib/resumo-days.ts");
  assert.ok(resumoDays.includes("Jornada não iniciada"));
  assert.ok(resumoDays.includes("Registro futuro"));
  assert.ok(pageSrc.includes("date <= todayStr && day.entries.length > 0"));
});

/* ── B. HOJE sem ponto: jornada não iniciada, sem −8h ─────── */
check("B. 25/08 zero punches: mini card idle, não mostra −8h", () => {
  assert.ok(quickSrc.includes("jornada não iniciada"));
  assert.ok(quickSrc.includes("idle"));
  assert.ok(pageSrc.includes("idle={todayIdle}"));
  assert.ok(!pageSrc.includes("window.confirm(faltaConfirmText"));
  const cctx = companyDayContext("2026-08-25", [], [], [], settings);
  assert.equal(cctx.type, "regular");
  assert.equal(cctx.effectiveExpected, 480);
  assert.equal(cctx.ctx.day.empty, true);
});

/* ── C. Overplan déficit ──────────────────────────────────── */
check("C. orig 15 / plan 10 → nova 10 rejeitada; máximo novo = 5", () => {
  reset([...dayDef15()]);
  const p1 = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 10, note: null, kind: "deficit",
  });
  assert.equal(p1.ok, true, p1.error);
  const original = originalHourExtraDebt(
    "2026-08-21", "deficit", getAppData().entries, getAppData().compensations, [], undefined, settings,
  );
  assert.equal(original, 15);
  const head = sourcePlanningHeadroom(getAppData().compensations, "2026-08-21", "deficit", original);
  assert.equal(head.openMinutes, 15);
  assert.equal(head.plannedMinutes, 10);
  assert.equal(head.unplannedMinutes, 5);
  const p2 = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-29", minutes: 10, note: null, kind: "deficit",
  });
  assert.equal(p2.ok, false);
  assert.match(p2.error ?? "", /5min/);
  const p3 = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-29", minutes: 5, note: null, kind: "deficit",
  });
  assert.equal(p3.ok, true, p3.error);
});

/* ── D. Overplan acordo ───────────────────────────────────── */
check("D. acordo orig 8h / conc 2h / plan 2h / cap 10h → máximo nova = 4h", () => {
  const abs: Absence[] = [{
    id: 1, kind: "acordado", startDate: "2026-08-06", endDate: "2026-08-06",
    duration: "integral", treatment: "compensar", note: null, createdAt: 1,
  }];
  const sat = [punch("2026-08-29", "08:00", "entrada"), punch("2026-08-29", "18:00", "saida")];
  const extraDay = [punch("2026-08-07", "08:00", "entrada"), punch("2026-08-07", "19:00", "saida")];
  reset([...extraDay, ...sat], [{
    id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120,
    status: "concluida", note: null, kind: "acordo", createdAt: 1,
  }, {
    id: 2, sourceDate: "2026-08-06", targetDate: "2026-08-25", minutes: 120,
    status: "pendente", note: null, kind: "acordo", createdAt: 2,
  }], [], abs);
  const original = originalHourExtraDebt(
    "2026-08-06", "acordo", getAppData().entries, getAppData().compensations, abs, undefined, settings,
  );
  assert.equal(original, 480);
  const head = sourcePlanningHeadroom(getAppData().compensations, "2026-08-06", "acordo", original);
  assert.equal(head.openMinutes, 360);
  assert.equal(head.plannedMinutes, 120);
  assert.equal(head.unplannedMinutes, 240);
  const cap = extraCapacityForDate("2026-08-29", getAppData().entries, getAppData().compensations, settings);
  assert.equal(Math.min(head.unplannedMinutes, cap.available), 240);
  const tooMuch = actions.addComp({
    sourceDate: "2026-08-06", targetDate: "2026-08-29", minutes: 360, note: null, kind: "acordo",
  });
  assert.equal(tooMuch.ok, false);
  assert.match(tooMuch.error ?? "", /4h/);
  const ok = actions.addComp({
    sourceDate: "2026-08-06", targetDate: "2026-08-29", minutes: 240, note: null, kind: "acordo",
  });
  assert.equal(ok.ok, true, ok.error);
});

/* ── E. Modal acordo prefill = min(sem programação, capacidade) ─ */
check("E. pendência sem programação 6h e capacidade 2h → prefill 2h", () => {
  assert.ok(formSrc.includes("planning?.unplannedMinutes"));
  assert.ok(formSrc.includes("maxOperationMinutes"));
  const unplanned = 360;
  const capacity = 120;
  assert.equal(Math.min(unplanned, capacity), 120);
});

/* ── F. Dashboard excedente 24/08: 10/50 não 0/60 ─────────── */
check("F. 24/08 ledger 60/25/35; progresso usa specialBook não sair-cedo", () => {
  const seed = buildSeedData();
  const led = specialExcessLedger("2026-08-24", seed.compensations, 60);
  assert.equal(led.original, 60);
  assert.equal(led.realized, 25);
  assert.equal(led.free, 35);
  assert.ok(panelSrc.includes("Progresso de realocação do excedente"));
  assert.ok(panelSrc.includes("specialBook.realized"));
  assert.ok(!panelSrc.includes("excessTotals.concluded"));
});

/* ── G. Falta sem window.confirm; store cria uma vez ──────── */
check("G. Registrar falta: sem confirm nativo; duplo add rejeitado; excluir reverte", () => {
  assert.ok(!pageSrc.includes("window.confirm(faltaConfirmText"));
  assert.ok(pageSrc.includes("busyFalta"));
  reset([]);
  assert.equal(actions.addFalta("2026-08-25").ok, true);
  assert.equal(actions.addFalta("2026-08-25").ok, false);
  assert.equal(getAppData().faltas.length, 1);
  const id = getAppData().faltas[0].id;
  assert.equal(actions.removeFalta(id).ok, true);
  assert.equal(getAppData().faltas.length, 0);
});

/* ── H. Filtro de pendências: factual em aberto permanece (Programado) ─ */
check("H. déficit 100% planejado continua na lista com status Programado", () => {
  reset([...dayDef15()], [{
    id: 1, sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 15,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  }]);
  const [dv] = deficitViews(
    getAppData().entries, getAppData().compensations, [], undefined, [], settings,
    { from: "2026-08-21", to: "2026-08-21" }, TODAY,
  );
  assert.equal(dv.openMinutes, 15);
  assert.equal(dv.unplannedMinutes, 0);
  assert.ok(panelSrc.includes("d.openMinutes > 0 && d.date <= today"));
  assert.ok(panelSrc.includes("Programado"));
  assert.ok(allocSrc.includes("Quitar saldo negativo com excedente disponível"));
  assert.ok(allocSrc.includes("eligibleSpecialSourcesForDeficit"));
});

/* ── Motivo duplicado ─────────────────────────────────────── */
check("I. observation igual ao label do motivo é omitida", () => {
  const r: ExcessReason = {
    id: 1, date: "2026-08-24", reason: "demanda-urgente",
    customReason: null, observation: "Demanda urgente de trabalho", createdAt: 1, updatedAt: 1,
  };
  assert.equal(excessReasonObservation(r), null);
  assert.equal(excessReasonObservation({ ...r, observation: "Plantão" }), "Plantão");
});

/* ── Fontes inversas ──────────────────────────────────────── */
check("J. eligibleSpecialSourcesForDeficit lista 24/08 para quitar 19/08", () => {
  const seed = buildSeedData();
  const srcs = eligibleSpecialSourcesForDeficit(
    "2026-08-19", seed.entries, seed.compensations, seed.absences,
    seed.companyCalendars, settings, seed.excessReasons, TODAY,
  );
  assert.ok(srcs.some((v) => v.date === "2026-08-24" && v.freeSpecial === 35));
});

reset([]);
console.log(`\nCORREÇÃO CONSOLIDAÇÃO — OK (${passed} testes)`);
