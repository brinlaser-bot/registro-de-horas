/**
 * VERIFICAÇÃO — ETAPA 4A: MOTOR DE PLANEJAMENTO / RESERVA FUTURA [10+].
 *
 * A 4A adiciona SOMENTE a camada 5 da regra-mãe: PLANEJAMENTOS/RESERVAS
 * [10+] para dias futuros (SpecialExcessPlan). PLANEJADO NÃO É UTILIZADO:
 *
 *   DISPONÍVEL = GERADO − UTILIZADO ATIVO − RESERVADO ATIVO
 *
 * A reserva usa a MESMA verdade canônica da 3C (geração factual, FIFO,
 * ciclo anual, capacidade por origem) — nenhuma segunda matemática.
 * Reserva não altera fatos, saldo regular, "No ponto", Resumo,
 * SpecialExcessUse nem projeção de dia realizado. Sem UI nesta etapa.
 *
 * Prioridade canônica (§19): USO REALIZADO > PLANO FUTURO — testada.
 * Determinismo (§21): planos mais antigos primeiro (createdAt ASC).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-plans-4a.mts
 */
import assert from "node:assert/strict";

import { buildSpecialExcessBank, allocateSpecialExcessManual } from "../src/lib/special-excess-bank.ts";
import { specialExcessPlanMinutes } from "../src/lib/special-excess-plan.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf, parseStoredAppData } from "../src/lib/store.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { getAnnualPointCycle, sameAnnualCycle } from "../src/lib/periods.ts";
import { todayString, addDays } from "../src/lib/time.ts";
import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import type { SpecialExcessPlan } from "../src/lib/special-excess-plan.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const ASOF = "2026-08-30"; // corte civil dos testes (origens já realizadas)
const DEST = "2026-09-10"; // destino futuro padrão (mesmo ciclo 2026/2027)

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixtures: jornadas com geração [10+] conhecida ── */

let eid = 1;
const e = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: eid++,
  date,
  time,
  type,
  note: null,
});
const day4 = (date: string, start: string, lunchOut: string, lunchIn: string, end: string) => [
  e(date, start, "entrada"),
  e(date, lunchOut, "saida"),
  e(date, lunchIn, "entrada"),
  e(date, end, "saida"),
];
const gen60 = (date: string) => day4(date, "07:00", "12:00", "13:00", "19:00"); // 11h   → [10+] 60min
const gen40 = (date: string) => day4(date, "07:30", "12:00", "13:00", "19:10"); // 10h40 → [10+] 40min
const gen30 = (date: string) => day4(date, "07:30", "12:00", "13:00", "19:00"); // 10h30 → [10+] 30min
const gen10 = (date: string) => day4(date, "07:30", "12:00", "13:00", "18:40"); // 10h10 → [10+] 10min
const gen0 = (date: string) => day4(date, "07:30", "12:00", "13:00", "18:30"); // 10h   → [10+] 0
const def30 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:30"); // 7h30  → precisa 30min

/* ── Harness do store ── */

let clock = 10_000;
const NOW = () => (clock += 1000);

const SEED = buildSeedData();
function resetSeed() {
  actions.replaceAll({
    user: SEED.user,
    entries: SEED.entries,
    compensations: SEED.compensations,
    absences: SEED.absences,
    companyCalendars: SEED.companyCalendars,
    faltas: SEED.faltas,
    excessReasons: SEED.excessReasons,
    specialExcessUses: SEED.specialExcessUses ?? [],
  });
}
function setState(entries: TimeEntry[], uses: Parameters<typeof actions.replaceAll>[0]["specialExcessUses"] = [], plans: SpecialExcessPlan[] = []) {
  actions.replaceAll({
    user: SEED.user,
    entries,
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: uses,
    specialExcessPlans: plans,
  });
}

const d = () => getAppData();
const plans = () => d().specialExcessPlans ?? [];
const uses = () => d().specialExcessUses ?? [];
const activePlans = () => plans().filter((p) => p.status === "planned");
const planTotal = (p: SpecialExcessPlan) => specialExcessPlanMinutes(p);
const activePlanMinutes = () => activePlans().reduce((s, p) => s + planTotal(p), 0);

function bankOf(date = ASOF) {
  const dd = d();
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(date),
    asOfDate: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? "",
    uses: dd.specialExcessUses ?? [],
    plans: dd.specialExcessPlans ?? [],
  });
}

function rowOf(date: string) {
  const dd = d();
  return buildResumoDayRow({
    date,
    today: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
  });
}

/** Invariantes L/G/H: fórmula canônica por lote; nenhuma origem excede a geração real. */
function assertBankSane(b: ReturnType<typeof bankOf>) {
  let sumAvailable = 0;
  let sumReserved = 0;
  let sumUsed = 0;
  for (const lot of b.lots) {
    assert.equal(
      lot.availableMinutes,
      Math.max(0, lot.generatedMinutes - lot.usedMinutes - lot.reservedMinutes),
      `fórmula canônica por lote (${lot.originDate})`,
    );
    assert.ok(
      lot.usedMinutes + lot.reservedMinutes <= lot.generatedMinutes,
      `origem ${lot.originDate}: usado+reservado nunca excede a geração real`,
    );
    assert.equal(lot.needsReview, false, `sem overuse/overreserve novo em ${lot.originDate}`);
    sumAvailable += lot.availableMinutes;
    sumReserved += lot.reservedMinutes;
    sumUsed += lot.usedMinutes;
  }
  assert.equal(b.availableMinutes, sumAvailable, "disponível do banco = Σ lotes");
  assert.equal(b.reservedMinutes, sumReserved, "reservado do banco = Σ lotes");
  assert.equal(b.usedMinutes, sumUsed, "utilizado do banco = Σ lotes");
}

/* ════════════════ TESTES 01–18 ════════════════ */

check("TESTE 01 DE 18 — BANCO SEM PLANOS", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20")]);
  const b = bankOf();
  assert.equal(b.generatedMinutes, 120, "gerado 2h");
  assert.equal(b.usedMinutes, 0, "utilizado 0");
  assert.equal(b.reservedMinutes, 0, "reservado 0");
  assert.equal(b.availableMinutes, 120, "disponível 2h");
  assert.ok(b.lots.every((l) => l.reservedMinutes === 0), "nenhum lote reservado");
  assertBankSane(b);
  // Fórmula obrigatória pós-4A no nível do banco:
  assert.equal(b.availableMinutes, b.generatedMinutes - b.usedMinutes - b.reservedMinutes);
});

check("TESTE 02 DE 18 — USO + RESERVA", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def30("2026-08-24")]);
  const u = actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(u.ok, `uso criado: ${u.error}`);
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano criado: ${r.error}`);
  const b = bankOf();
  assert.equal(b.generatedMinutes, 120, "gerado 2h");
  assert.equal(b.usedMinutes, 30, "utilizado 30min (apenas o USO)");
  assert.equal(b.reservedMinutes, 60, "reservado 1h (apenas o PLANO)");
  assert.equal(b.availableMinutes, 30, "disponível 30min");
  // Invariante A: PLANEJADO NÃO É UTILIZADO (reserva não entra no utilizado).
  assert.notEqual(b.usedMinutes, 90);
  assertBankSane(b);
  const plan = activePlans()[0];
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.allocations, [
    { originDate: "2026-08-18", minutes: 30 },
    { originDate: "2026-08-20", minutes: 30 },
  ], "FIFO consumiu o remanescente da origem mais antiga");
});

check("TESTE 03 DE 18 — FIFO AUTOMÁTICO", () => {
  resetSeed(); // 18/08 → 40min · 20/08 → 1h · 28/08 → 30min (gerado 130)
  assert.equal(bankOf().generatedMinutes, 130);
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano criado: ${r.error}`);
  const plan = activePlans()[0];
  assert.equal(plan.selectionMode, "automatic");
  assert.deepEqual(plan.allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 20 },
  ], "origem mais antiga primeiro, fragmentando (invariante I: FIFO continua FIFO)");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 60);
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-18")?.availableMinutes, 0);
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-20")?.availableMinutes, 40);
  assert.equal(b.availableMinutes, 70, "130 gerado − 60 reservado");
  assertBankSane(b);
});

check("TESTE 04 DE 18 — SELEÇÃO MANUAL", () => {
  // (estado do TESTE 03: plano FIFO ativo de 1h)
  const r = actions.createSpecialExcessPlan({
    destinationDate: "2026-09-15",
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(r.ok, `plano manual criado: ${r.error}`);
  const plan = activePlans().find((p) => p.selectionMode === "manual");
  assert.ok(plan, "plano manual ativo");
  assert.deepEqual(plan!.allocations, [{ originDate: "2026-08-28", minutes: 30 }],
    "allocation permanece EXATAMENTE na origem escolhida (invariante J)");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 90, "1h (FIFO) + 30min (manual)");
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-28")?.availableMinutes, 0);
  assert.equal(b.availableMinutes, 40, "130 gerado − 90 reservado");
  assertBankSane(b);
});

check("TESTE 05 DE 18 — RESERVA ACIMA DO DISPONÍVEL", () => {
  setState([...gen30("2026-08-28")]); // disponível 30min
  const before = plans().length;
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.equal(r.ok, false, "rejeita pedido acima do disponível");
  assert.equal(r.code, "insufficient-special-balance");
  assert.equal(r.available, 30, "informa a capacidade real");
  assert.equal(plans().length, before, "ATÔMICO: nenhum plano parcial persistido");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 0, "banco intacto");
  assert.equal(b.availableMinutes, 30);
  // manual acima do disponível também rejeita sem clamping silencioso:
  const m = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 60,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 60 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.equal(m.ok, false);
  assert.equal(m.code, "insufficient-special-balance");
  assert.equal(plans().length, before, "nenhum plano parcial no modo manual");
});

check("TESTE 06 DE 18 — DOIS PLANOS", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20")]); // 2h livres
  const a = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  const bres = actions.createSpecialExcessPlan({ destinationDate: "2026-09-15", minutes: 30, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(a.ok && bres.ok, `dois planos criados: ${a.error ?? ""} ${bres.error ?? ""}`);
  const [pa, pb] = activePlans();
  assert.deepEqual(pa.allocations, [{ originDate: "2026-08-18", minutes: 60 }]);
  assert.deepEqual(pb.allocations, [{ originDate: "2026-08-20", minutes: 30 }],
    "plano B NÃO reutiliza os minutos já reservados pelo plano A (18/08 esgotado)");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 90, "reserved 1h30");
  assert.equal(b.availableMinutes, 30, "available 30min");
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-18")?.reservedMinutes, 60);
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-20")?.reservedMinutes, 30);
  assertBankSane(b); // sem dupla contagem por origem (invariantes G/L)
});

check("TESTE 07 DE 18 — CANCELAMENTO", () => {
  // (estado do TESTE 06: A 1h + B 30min)
  const pa = activePlans()[0];
  const before = bankOf();
  assert.equal(before.reservedMinutes, 90);
  const c = actions.cancelSpecialExcessPlan({ id: pa.id, now: NOW() });
  assert.ok(c.ok, `cancelado: ${c.error}`);
  const b = bankOf();
  assert.equal(b.reservedMinutes, 30, "reserved −1h");
  assert.equal(b.availableMinutes, 90, "available +1h");
  const original = plans().find((p) => p.id === pa.id);
  assert.equal(original!.status, "cancelled", "registro preservado como cancelled");
  assert.deepEqual(original!.allocations, pa.allocations, "histórico de allocations intacto");
  assert.ok(original!.cancelledAt, "cancelledAt registrado");
  assert.equal(original!.createdAt, pa.createdAt, "createdAt preservado (invariante O)");
  assert.equal(d().entries.length, 8, "reserva não altera fatos");
  assert.equal(uses().length, 0, "cancelamento não cria uso");
  assertBankSane(b);
});

check("TESTE 08 DE 18 — CANCELAMENTO DUPLO", () => {
  // (estado do TESTE 07: A cancelado, B ativo 30min)
  const pa = plans().find((p) => p.status === "cancelled")!;
  const snapshot = JSON.stringify(plans());
  const bankBefore = bankOf();
  const c2 = actions.cancelSpecialExcessPlan({ id: pa.id, now: NOW() });
  assert.equal(c2.ok, true, "cancelamento duplo é seguro/idempotente (§15)");
  assert.equal(JSON.stringify(plans()), snapshot, "estado idêntico — nada muda");
  const b = bankOf();
  assert.equal(b.reservedMinutes, bankBefore.reservedMinutes, "capacidade NÃO é devolvida duas vezes");
  assert.equal(b.availableMinutes, bankBefore.availableMinutes, "banco sem corrupção");
  assertBankSane(b);
});

check("TESTE 09 DE 18 — CONCLUDED", () => {
  // (estado do TESTE 08: A cancelado, B ativo 30min, gerado 2h)
  const pb = activePlans()[0];
  const entriesBefore = JSON.stringify(d().entries);
  const rowsBefore = JSON.stringify([rowOf("2026-08-18"), rowOf("2026-08-20")]);
  const usesBefore = uses().length;
  const cc = actions.concludeSpecialExcessPlan({ id: pb.id, now: NOW() });
  assert.ok(cc.ok, `concluído: ${cc.error}`);
  const concluded = plans().find((p) => p.id === pb.id)!;
  assert.equal(concluded.status, "concluded");
  assert.ok(concluded.concludedAt, "concludedAt registrado");
  assert.deepEqual(concluded.allocations, pb.allocations, "histórico preservado");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 0, "não conta mais em reserved");
  assert.equal(b.availableMinutes, 120, "capacidade devolvida por derivação");
  assert.equal(uses().length, usesBefore, "NÃO cria SpecialExcessUse (invariante F)");
  assert.equal(JSON.stringify(d().entries), entriesBefore, "jornada factual intocada (invariante B)");
  assert.equal(JSON.stringify([rowOf("2026-08-18"), rowOf("2026-08-20")]), rowsBefore,
    "saldo regular, 'No ponto' e projeção do dia realizado intocados (invariantes C/D/E)");
  // transições só partem de "planned":
  const again = actions.concludeSpecialExcessPlan({ id: pb.id, now: NOW() });
  assert.equal(again.ok, false);
  assert.equal(again.code, "plan-already-concluded");
  assertBankSane(b);
});

check("TESTE 10 DE 18 — MANUAL 30 → 10", () => {
  setState([...gen30("2026-08-28")]);
  const r = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(r.ok, `plano manual 30min: ${r.error}`);
  const originalId = activePlans()[0].id;
  // origem cai de 30min para 10min (10h30 → 10h10):
  const punch = d().entries.find((x) => x.date === "2026-08-28" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(punch.id, { time: "18:40" }, { now: NOW() });
  assert.ok(res.ok, `edição da origem: ${res.error}`);
  assert.ok((res.warning ?? "").includes("10min") && (res.warning ?? "").includes("20min"),
    "aviso curto (§10): o que fica e o que sai");
  const active = activePlans();
  assert.equal(active.length, 1);
  assert.equal(planTotal(active[0]), 10, "plano ativo passa a ter 10min");
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-28", minutes: 10 }],
    "mesma origem — sem migração silenciosa (invariante J)");
  assert.equal(active[0].selectionMode, "manual");
  const original = plans().find((p) => p.id === originalId)!;
  assert.equal(original.status, "cancelled", "original preservado no histórico");
  assert.ok(original.note?.includes("Reconciliado"), "motivo registrado (append)");
  assert.deepEqual(original.allocations, [{ originDate: "2026-08-28", minutes: 30 }], "histórico intacto");
  const b = bankOf();
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-28")?.generatedMinutes, 10);
  assert.equal(b.reservedMinutes, 10, "20min liberados");
  assert.equal(b.availableMinutes, 0);
  assertBankSane(b);
});

check("TESTE 11 DE 18 — MANUAL 30 → 0", () => {
  setState([...gen30("2026-08-28")]);
  const r = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(r.ok, `plano manual 30min: ${r.error}`);
  const originalId = activePlans()[0].id;
  // origem desaparece (10h30 → 10h exatas, geração 0):
  const punch = d().entries.find((x) => x.date === "2026-08-28" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(punch.id, { time: "18:30" }, { now: NOW() });
  assert.ok(res.ok, `edição da origem: ${res.error}`);
  assert.ok((res.warning ?? "").includes("30min"), "aviso curto (§10)");
  assert.equal(activePlans().length, 0, "nenhum minuto ativo permanece lastreado na origem zerada");
  const original = plans().find((p) => p.id === originalId)!;
  assert.equal(original.status, "cancelled", "plano zerado → cancelado explicitamente");
  assert.ok(original.note?.includes("Reconciliado"));
  assert.deepEqual(original.allocations, [{ originDate: "2026-08-28", minutes: 30 }],
    "histórico preservado; NENHUMA troca de origem");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 0);
  assert.equal(b.availableMinutes, 0, "origem sem geração não cria saldo fictício");
  assertBankSane(b);
});

check("TESTE 12 DE 18 — AUTOMÁTICO COM REDISTRIBUIÇÃO", () => {
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20")]);
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano 1h: ${r.error}`);
  assert.deepEqual(activePlans()[0].allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 20 },
  ]);
  const planId = activePlans()[0].id;
  // 18/08 perde os 40min (10h40 → 10h); 20/08 ainda possui 60min livres:
  const punch = d().entries.find((x) => x.date === "2026-08-18" && x.type === "saida" && x.time === "19:10")!;
  const res = actions.updateEntry(punch.id, { time: "18:30" }, { now: NOW() });
  assert.ok(res.ok, `edição da origem: ${res.error}`);
  assert.ok(/redistribu/i.test(res.warning ?? ""), "aviso de redistribuição (§10)");
  const active = activePlans();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, planId, "total preservado → redistribuição in-place (mesmo id)");
  assert.equal(active[0].status, "planned");
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-20", minutes: 60 }],
    "20/08 assume os 60min — plano continua 1h");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 60, "total do plano preservado (nunca aumentou)");
  assert.equal(b.availableMinutes, 0);
  assertBankSane(b);
});

check("TESTE 13 DE 18 — AUTOMÁTICO SEM SALDO SUFICIENTE", () => {
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20")]);
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano 1h: ${r.error}`);
  const planId = activePlans()[0].id;
  // 1ª queda: 18/08 perde os 40min → redistribuição in-place para 20/08 (60min):
  const p18 = d().entries.find((x) => x.date === "2026-08-18" && x.type === "saida" && x.time === "19:10")!;
  assert.ok(actions.updateEntry(p18.id, { time: "18:30" }, { now: NOW() }).ok);
  assert.deepEqual(activePlans()[0].allocations, [{ originDate: "2026-08-20", minutes: 60 }]);
  // 2ª queda: 20/08 cai de 60min para 40min — só há 40min no total:
  const p20 = d().entries.find((x) => x.date === "2026-08-20" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(p20.id, { time: "18:40" }, { now: NOW() });
  assert.ok(res.ok, `edição da origem: ${res.error}`);
  assert.ok((res.warning ?? "").includes("40min") && (res.warning ?? "").includes("20min"));
  const active = activePlans();
  assert.equal(active.length, 1);
  assert.equal(planTotal(active[0]), 40, "plano reduz para 40min — sem saldo fictício");
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-20", minutes: 40 }]);
  const original = plans().find((p) => p.id === planId)!;
  assert.equal(original.status, "cancelled", "versão anterior preservada no histórico");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 40);
  assert.equal(b.availableMinutes, 0, "reserved = geração restante; nada inventado");
  assertBankSane(b);
});

check("TESTE 14 DE 18 — USO TEM PRIORIDADE SOBRE PLANO", () => {
  setState([...gen60("2026-08-20"), ...def30("2026-08-24")]);
  const u = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24",
    minutes: 30,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(u.ok, `uso manual criado: ${u.error}`);
  const p = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(p.ok, `plano manual criado: ${p.error}`);
  assert.equal(bankOf().availableMinutes, 0, "60min gerados = 30 usados + 30 reservados");
  // origem cai de 60min para 40min (11h → 10h40):
  const punch = d().entries.find((x) => x.date === "2026-08-20" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(punch.id, { time: "18:40" }, { now: NOW() });
  assert.ok(res.ok, `edição da origem: ${res.error}`);
  // USO REALIZADO permanece lastreado primeiro (invariante K):
  const use = uses()[0];
  assert.equal(use.status, "utilizado");
  assert.deepEqual(use.allocations, [{ originDate: "2026-08-20", minutes: 30 }],
    "uso realizado NUNCA é invalidado para preservar reserva futura");
  // plano recebe somente o remanescente (40 − 30 = 10):
  const active = activePlans();
  assert.equal(active.length, 1);
  assert.equal(planTotal(active[0]), 10, "plano futuro fica com a capacidade restante");
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-20", minutes: 10 }]);
  const b = bankOf();
  assert.equal(b.generatedMinutes, 40);
  assert.equal(b.usedMinutes, 30);
  assert.equal(b.reservedMinutes, 10);
  assert.equal(b.availableMinutes, 0);
  assertBankSane(b);
});

check("TESTE 15 DE 18 — VÁRIOS PLANOS / DETERMINISMO", () => {
  setState([...gen60("2026-08-20")]);
  const ra = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 40,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 40 }],
    asOfDate: ASOF,
    now: NOW(), // mais antigo
  });
  const rb = actions.createSpecialExcessPlan({
    destinationDate: "2026-09-15",
    minutes: 20,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 20 }],
    asOfDate: ASOF,
    now: NOW(), // mais novo
  });
  assert.ok(ra.ok && rb.ok, `dois planos na mesma origem: ${ra.error ?? ""} ${rb.error ?? ""}`);
  const idA = activePlans()[0].id;
  const idB = activePlans()[1].id;
  assert.ok(plans().find((p) => p.id === idA)!.createdAt < plans().find((p) => p.id === idB)!.createdAt,
    "createdAt ASC define a ordem");
  // origem cai de 60min para 30min (11h → 10h30):
  const punch = d().entries.find((x) => x.date === "2026-08-20" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(punch.id, { time: "18:30" }, { now: NOW() });
  assert.ok(res.ok, `edição da origem: ${res.error}`);
  // Resultado determinístico: plano MAIS ANTIGO preservado primeiro (§21):
  const active = activePlans();
  assert.equal(active.length, 1);
  assert.equal(planTotal(active[0]), 30, "plano mais antigo fica com o lastro restante");
  assert.ok(active[0].note?.includes(`original ${idA}`), "versão reconciliada do plano A");
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-20", minutes: 30 }]);
  const bCancelled = plans().find((p) => p.id === idB)!;
  assert.equal(bCancelled.status, "cancelled", "plano mais novo reconciliado depois (perdeu o lastro)");
  assert.ok(bCancelled.note?.includes("Reconciliado"));
  assert.equal(plans().length, 3, "histórico completo preservado (A original + B cancelado + A ativo)");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 30);
  assertBankSane(b);
});

check("TESTE 16 DE 18 — FECHAMENTO ANUAL", () => {
  setState([...gen30("2026-08-28")]);
  const r = actions.createSpecialExcessPlan({
    destinationDate: "2027-05-05",
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2027-04-20", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.equal(r.ok, false, "origem 20/04/2027 → destino 05/05/2027 é REJEITADO");
  assert.equal(r.code, "cross-cycle");
  assert.equal(plans().length, 0, "nenhuma allocation atravessa 30/04 (invariante M)");
  // automático também não atravessa (banco do ciclo do destino 2027/2028 é vazio):
  const ra = actions.createSpecialExcessPlan({ destinationDate: "2027-05-05", minutes: 30, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.equal(ra.ok, false, "destino em outro ciclo não encontra geração reservável");
  assert.equal(plans().length, 0);
  // motor puro 3C: barreira explícita de ciclo — o banco do ciclo 2026/2027
  // (que possui geração) NÃO pode servir a um destino após 30/04/2027:
  const m = allocateSpecialExcessManual({
    bank: bankOf(),
    destinationDate: "2027-05-05",
    requestedAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
  });
  assert.equal(m.ok, false);
  assert.ok(m.error?.includes("destino-fora-do-ciclo"), "3C rejeita destino fora do ciclo do banco");
  // invariante M em todo estado de planos:
  for (const p of plans()) {
    for (const a of p.allocations) {
      assert.ok(sameAnnualCycle(a.originDate, p.destinationDate), "nenhuma reserva atravessa 30/04");
    }
  }
});

check("TESTE 17 DE 18 — DESTINO NÃO FUTURO", () => {
  resetSeed();
  const TODAY = todayString(); // data civil America/Sao_Paulo (TZ do processo; nunca toISOString)
  const rToday = actions.createSpecialExcessPlan({ destinationDate: TODAY, minutes: 30, selectionMode: "automatic", asOfDate: TODAY, now: NOW() });
  assert.equal(rToday.ok, false, "hoje é rejeitado");
  assert.equal(rToday.code, "destination-not-future");
  const rPast = actions.createSpecialExcessPlan({ destinationDate: addDays(TODAY, -1), minutes: 30, selectionMode: "automatic", asOfDate: TODAY, now: NOW() });
  assert.equal(rPast.ok, false, "ontem é rejeitado");
  assert.equal(rPast.code, "destination-not-future");
  assert.equal(plans().length, 0, "nada é persistido nas rejeições");
  const rFuture = actions.createSpecialExcessPlan({ destinationDate: addDays(TODAY, 7), minutes: 30, selectionMode: "automatic", asOfDate: TODAY, now: NOW() });
  assert.ok(rFuture.ok, `destino futuro é aceito: ${rFuture.error}`);
  assert.equal(plans().length, 1);
  assert.equal(activePlans()[0].allocations[0].originDate, "2026-08-18", "FIFO do seed (origem mais antiga)");
});

check("TESTE 18 DE 18 — BACKUP", () => {
  // cenário com um plano (note preservada no roundtrip):
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20")]);
  const created = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 60,
    selectionMode: "manual",
    manualAllocations: [
      { originDate: "2026-08-18", minutes: 40 },
      { originDate: "2026-08-20", minutes: 20 },
    ],
    note: "Reservar 1h para sair mais cedo",
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(created.ok, `plano criado: ${created.error}`);
  const withPlan = JSON.parse(JSON.stringify(d())) as ReturnType<typeof d>;
  const plan = withPlan.specialExcessPlans![0];
  const payload = buildBackupPayload(withPlan);

  // A) backup ANTIGO sem "specialExcessPlans" → restaura com []
  const { specialExcessPlans: _omitted, ...oldPayload } = payload;
  const parsedOld = parseBackup(JSON.stringify(oldPayload));
  assert.ok(parsedOld.ok, "backup antigo válido");
  assert.deepEqual(parsedOld.ok ? parsedOld.backup.specialExcessPlans : null, [], "backups antigos → specialExcessPlans = []");
  actions.replaceAll({
    user: parsedOld.ok ? parsedOld.backup.user : withPlan.user,
    entries: parsedOld.ok ? parsedOld.backup.entries : [],
    compensations: parsedOld.ok ? parsedOld.backup.compensations : [],
    absences: parsedOld.ok ? parsedOld.backup.absences : [],
    companyCalendars: parsedOld.ok ? parsedOld.backup.companyCalendars : undefined,
    faltas: parsedOld.ok ? parsedOld.backup.faltas : [],
    excessReasons: parsedOld.ok ? parsedOld.backup.excessReasons : [],
    specialExcessUses: parsedOld.ok ? parsedOld.backup.specialExcessUses : [],
  });
  assert.deepEqual(d().specialExcessPlans ?? [], [], "restauração de backup antigo deixa planos []");
  const rehydratedOld = parseStoredAppData(JSON.stringify(oldPayload));
  assert.ok(rehydratedOld, "storage antigo legível");
  assert.deepEqual(rehydratedOld!.specialExcessPlans ?? [], [], "reload de storage antigo → planos []");

  // B) backup NOVO com plano → restaura EXATAMENTE (status, modo, destino,
  //    minutes, allocations, createdAt, note)
  const parsedNew = parseBackup(JSON.stringify(payload));
  assert.ok(parsedNew.ok, "backup novo válido");
  const restored = parsedNew.ok ? parsedNew.backup.specialExcessPlans : [];
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0], plan, "plano preservado exatamente no backup");
  assert.equal(restored[0].status, "planned");
  assert.equal(restored[0].selectionMode, "manual");
  assert.equal(restored[0].destinationDate, DEST);
  assert.equal(specialExcessPlanMinutes(restored[0]), 60);
  assert.deepEqual(restored[0].allocations, plan.allocations);
  assert.equal(restored[0].createdAt, plan.createdAt);
  assert.equal(restored[0].note, "Reservar 1h para sair mais cedo");
  actions.replaceAll({
    user: parsedNew.ok ? parsedNew.backup.user : withPlan.user,
    entries: parsedNew.ok ? parsedNew.backup.entries : [],
    compensations: parsedNew.ok ? parsedNew.backup.compensations : [],
    absences: parsedNew.ok ? parsedNew.backup.absences : [],
    companyCalendars: parsedNew.ok ? parsedNew.backup.companyCalendars : undefined,
    faltas: parsedNew.ok ? parsedNew.backup.faltas : [],
    excessReasons: parsedNew.ok ? parsedNew.backup.excessReasons : [],
    specialExcessUses: parsedNew.ok ? parsedNew.backup.specialExcessUses : [],
    specialExcessPlans: restored,
  });
  assert.deepEqual(d().specialExcessPlans, withPlan.specialExcessPlans, "restauração byte-a-byte do plano");
  // reload/serialização (localStorage → parseStoredAppData):
  const rehydrated = parseStoredAppData(JSON.stringify(withPlan));
  assert.ok(rehydrated);
  assert.deepEqual(rehydrated!.specialExcessPlans, withPlan.specialExcessPlans, "reload preserva o plano");
  // merge (importar sem perder eventos distintos):
  setState([...gen40("2026-08-18")]);
  actions.mergeBackup({
    entries: payload.entries,
    compensations: payload.compensations,
    absences: payload.absences,
    companyCalendars: payload.companyCalendars,
    faltas: payload.faltas,
    excessReasons: payload.excessReasons,
    specialExcessUses: payload.specialExcessUses,
    specialExcessPlans: payload.specialExcessPlans,
  });
  assert.equal(d().specialExcessPlans!.length, 1, "merge une planos por id");
  assert.deepEqual(d().specialExcessPlans![0], plan, "merge preserva o plano exatamente");
});

console.log(`\n${passed}/18 verificações da Etapa 4A passaram.`);
if (passed !== 18) process.exit(1);
