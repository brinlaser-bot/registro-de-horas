/**
 * VERIFICAÇÃO — ETAPA 4C: RESOLUÇÃO DO PLANEJAMENTO [10+] QUANDO O DIA CHEGA
 * + USO DIRETO DE [10+] NO DIA DE HOJE (jornada encerrada e válida).
 *
 * PLANO NUNCA VIRA USO AUTOMATICAMENTE (§4): a resolução existe somente por
 * ação explícita, via resolveSpecialExcessPlan — action ATÔMICA que
 * revalida plano/data/dia/necessidade pelo gate canônico 3A/3G, cria o
 * SpecialExcessUse com as MESMAS origens reservadas (§10, sem FIFO novo),
 * marca o plano concluded com metadados (§12) e libera a sobra (§8/§9).
 *
 * Fluxo B reutiliza o fluxo atual de SpecialExcessUse (3D/3E/3G.2) para
 * hoje — nenhum motor novo. "Hoje" nos testes é injeção de asOfDate
 * (ASOF) — determinístico, sem parede de relógio.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-plans-resolution-4c.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { activeSpecialPlansForDate } from "../src/lib/special-excess-plan.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { projectRealizedDayOfficial, isProjectableDayStatus } from "../src/lib/official-projection.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { addDays, todayString } from "../src/lib/time.ts";
import { manualMaxForOrigin } from "../src/components/special-excess-use-modal.tsx";
import type { SpecialExcessPlan } from "../src/lib/special-excess-plan.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30"; // "hoje" injetado (determinístico)
const DEST = "2026-09-10"; // futuro padrão

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixtures ── */
let eid = 1;
const e = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: eid++, date, time, type, note: null });
const day4 = (date: string, s: string, lo: string, li: string, end: string) => [e(date, s, "entrada"), e(date, lo, "saida"), e(date, li, "entrada"), e(date, end, "saida")];
const gen60 = (date: string) => day4(date, "07:00", "12:00", "13:00", "19:00"); // 11h   → [10+] 60min
const gen40 = (date: string) => day4(date, "07:30", "12:00", "13:00", "19:10"); // 10h40 → [10+] 40min
const gen30 = (date: string) => day4(date, "07:00", "12:00", "13:00", "18:30"); // 10h30 → [10+] 30min
const def60 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:00"); // 7h    → precisa 60min
const def45 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:15"); // 7h15  → precisa 45min
const def30 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:30"); // 7h30  → precisa 30min
const def0 = (date: string) => day4(date, "08:00", "12:00", "13:00", "17:00"); // 8h     → precisa 0
const incomplete = (date: string) => [e(date, "08:00", "entrada"), e(date, "12:00", "saida"), e(date, "13:00", "entrada")]; // sem saída final

/* ── Harness ── */
let clock = 10_000;
const NOW = () => (clock += 1000);
const SEED = buildSeedData();
function setState(entries: TimeEntry[], useList: ReturnType<typeof uses> = [], planList: SpecialExcessPlan[] = []) {
  actions.replaceAll({
    user: SEED.user,
    entries,
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: useList,
    specialExcessPlans: planList,
  });
}
const d = () => getAppData();
const plans = () => d().specialExcessPlans ?? [];
const uses = () => d().specialExcessUses ?? [];
const activePlans = () => plans().filter((p) => p.status === "planned");

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
// "Hoje" do Fluxo B: segunda-feira JÁ PASSADA (24/08) injetada via asOfDate —
// determinística (computeDay aplica parede de relógio a batidas do hoje real,
// então o dia simulado como "hoje" precisa ser anterior ao dia real).
const HOJE = "2026-08-24";
function rowOf(date: string, today = ASOF) {
  const dd = d();
  return buildResumoDayRow({
    date,
    today,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
  });
}
function dayViewOf(date: string, asOfDate = ASOF) {
  const dd = d();
  return buildSpecialExcessDayView({
    date,
    asOfDate,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
    uses: dd.specialExcessUses ?? [],
    plans: dd.specialExcessPlans ?? [],
  });
}
function projectionOf(date: string, asOf = ASOF) {
  const row = rowOf(date, asOf);
  return projectRealizedDayOfficial({
    date,
    factualWorkedMinutes: row.workedMinutes,
    factualRegistrableMinutes: row.registrableMinutes,
    factualRegularBalanceMinutes: row.balanceMinutes,
    effectiveBaseMinutes: row.expectedMinutes,
    financialValid: isProjectableDayStatus(row.status),
    realized: row.entryCount > 0 && date <= asOf,
    usedSpecialMinutes: uses().filter((u) => u.status === "utilizado" && u.destinationDate === date).reduce((s, u) => s + u.allocations.reduce((k, a) => k + a.minutes, 0), 0),
  });
}
/** Plano para um dia que JÁ CHEGOU (destino realizado; criado antes da data). */
function planForArrived(dest: string, minutes: number, asOfCreation: string, now = NOW()) {
  const r = actions.createSpecialExcessPlan({ destinationDate: dest, minutes, selectionMode: "automatic", asOfDate: asOfCreation, now });
  assert.ok(r.ok, `plano para ${dest}: ${r.error}`);
  const mine = activePlans().filter((p) => p.destinationDate === dest);
  return mine[mine.length - 1]!;
}
/** Seção da action de resolução no store (auditoria estrutural §10/§20). */
function resolveSection() {
  const store = src("src/lib/store.ts");
  const start = store.indexOf("resolveSpecialExcessPlan(p:");
  const end = store.indexOf("concludeSpecialExcessPlan(p:", start);
  assert.ok(start > 0 && end > start, "action resolveSpecialExcessPlan no store");
  return store.slice(start, end);
}

/* ════════════════ TESTES 01–20 ════════════════ */

check("TESTE 01 DE 20 — FUTURO CONTINUA RESERVA", () => {
  setState([...gen60("2026-08-18")]);
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() }).ok);
  assert.equal(uses().length, 0, "nenhum uso criado");
  const r = actions.resolveSpecialExcessPlan({ id: activePlans()[0].id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.equal(r.ok, false, "não há 'Usar planejamento' antes da data");
  assert.equal(r.code, "destination-not-realized");
  assert.equal(activePlans()[0].status, "planned", "continua reserva");
  // UI: "Usar planejamento" só existe com dia chegado + elegível + necessidade:
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("const canApply = arrived && eligible === true && needRemaining > 0"), "gating da decisão");
  assert.ok(summary.includes("canApply && onResolvePlan"), "ação só com decisão válida");
});

check("TESTE 02 DE 20 — DIA CHEGA, NÃO CONVERTE SOZINHO", () => {
  const today = todayString();
  const origin = addDays(today, -3);
  setState(day4(origin, "07:00", "12:00", "13:00", "19:00"));
  const r = actions.createSpecialExcessPlan({ destinationDate: today, minutes: 60, selectionMode: "automatic", asOfDate: addDays(today, -1), now: NOW() });
  assert.ok(r.ok, `plano criado ontem para hoje: ${r.error}`);
  // abrir o estado várias vezes (simula re-render/abrir app): nada muda sozinho
  for (let i = 0; i < 3; i++) {
    const dd = getAppData();
    assert.equal(dd.specialExcessPlans![0].status, "planned");
    assert.equal(dd.specialExcessUses!.length, 0, "nenhum uso automático");
    assert.equal(bankOf(today).reservedMinutes, 60, "continua reservado");
  }
  // Estrutural: o store documenta e não possui conversão automática
  const store = src("src/lib/store.ts");
  assert.ok(store.includes("PLANO NUNCA VIRA USO AUTOMATICAMENTE"));
  const resolveModal = src("src/components/special-excess-plan-resolve-modal.tsx");
  assert.ok(resolveModal.includes("actions.resolveSpecialExcessPlan("), "resolução só via action, no clique do modal");
});

check("TESTE 03 DE 20 — PLANO = NECESSIDADE", () => {
  setState([...gen60("2026-08-18"), ...def60("2026-08-25")]);
  const plan = planForArrived("2026-08-25", 60, "2026-08-20");
  const rowBefore = JSON.stringify(rowOf("2026-08-25"));
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `resolução: ${res.error}`);
  const use = uses()[0];
  assert.equal(use.status, "utilizado");
  assert.deepEqual(use.allocations, [{ originDate: "2026-08-18", minutes: 60 }], "uso 1h nas origens reservadas");
  const resolved = plans().find((p) => p.id === plan.id)!;
  assert.equal(resolved.status, "concluded", "plano resolvido");
  assert.equal(resolved.resolvedMinutes, 60);
  assert.equal(resolved.releasedMinutes, 0);
  assert.equal(resolved.resolvedUseId, use.id, "uso vinculado nos metadados (§12)");
  assert.ok(resolved.resolvedAt);
  const b = bankOf();
  assert.equal(b.reservedMinutes, 0, "reserved −1h");
  assert.equal(b.usedMinutes, 60, "used +1h");
  const proj = projectionOf("2026-08-25");
  assert.equal(proj.projectedWorkedMinutes, 480, "projeção 8h");
  assert.equal(proj.projectedBalanceMinutes, 0, "projeção 0min");
  assert.equal(JSON.stringify(rowOf("2026-08-25")), rowBefore, "factual 7h/−1h intocado");
  assert.equal(activeSpecialPlansForDate(plans(), "2026-08-25").length, 0, "reserva deixa de existir como reserved");
});

check("TESTE 04 DE 20 — RESERVOU MAIS QUE PRECISA", () => {
  setState([...gen60("2026-08-18"), ...def30("2026-08-25")]); // necessidade 30
  const plan = planForArrived("2026-08-25", 60, "2026-08-20");
  const over = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.equal(over.ok, false, "aplicar 1h é rejeitado");
  assert.equal(over.code, "requested-exceeds-destination-need");
  assert.equal(over.limitMinutes, 30, "máximo aplicável = necessidade restante");
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `aplicar 30: ${res.error}`);
  const resolved = plans().find((p) => p.id === plan.id)!;
  assert.equal(resolved.resolvedMinutes, 30);
  assert.equal(resolved.releasedMinutes, 30, "30 liberados");
  assert.equal(bankOf().reservedMinutes, 0, "nenhuma sobra permanece reservada");
  assert.equal(bankOf().availableMinutes, 30, "sobra voltou ao banco");
  const proj = projectionOf("2026-08-25");
  assert.equal(proj.projectedWorkedMinutes, 480, "projeção 8h/0");
});

check("TESTE 05 DE 20 — ESCOLHE USAR MENOS", () => {
  setState([...gen60("2026-08-18"), ...def60("2026-08-25")]); // necessidade 1h
  const plan = planForArrived("2026-08-25", 60, "2026-08-20");
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `aplicar 30 de 60: ${res.error}`);
  const resolved = plans().find((p) => p.id === plan.id)!;
  assert.equal(resolved.status, "concluded", "plano resolvido");
  assert.equal(resolved.resolvedMinutes, 30);
  assert.equal(resolved.releasedMinutes, 30, "restante liberado (não continua reservado)");
  const proj = projectionOf("2026-08-25");
  assert.equal(proj.projectedWorkedMinutes, 450, "projeção 7h30");
  assert.equal(proj.projectedBalanceMinutes, -30, "projeção −30min");
});

check("TESTE 06 DE 20 — MESMAS ORIGENS DA RESERVA", () => {
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20")]);
  const r = actions.createSpecialExcessPlan({ destinationDate: "2026-08-25", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-21", now: NOW() });
  assert.ok(r.ok, `plano A40+B20: ${r.error}`);
  assert.deepEqual(activePlans()[0].allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 20 },
  ]);
  const destRow = def60("2026-08-25");
  setState([...d().entries, ...destRow], uses(), plans());
  const plan = activePlans().find((p) => p.destinationDate === "2026-08-25")!;
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `resolução: ${res.error}`);
  assert.deepEqual(uses()[0].allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 20 },
  ], "uso consome as MESMAS origens reservadas");
  assert.ok(!resolveSection().includes("allocateSpecialExcessFifo"), "NENHUM novo FIFO na resolução");
});

check("TESTE 07 DE 20 — USO PARCIAL DAS ALLOCATIONS", () => {
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20"), ...def30("2026-08-25")]);
  const plan = planForArrived("2026-08-25", 60, "2026-08-21");
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `resolução parcial: ${res.error}`);
  assert.deepEqual(uses()[0].allocations, [{ originDate: "2026-08-18", minutes: 30 }],
    "primeiros 30min da ORDEM PERSISTIDA da própria reserva (prefixo)");
  const resolved = plans().find((p) => p.id === plan.id)!;
  assert.equal(resolved.releasedMinutes, 30, "restante (10 de A + 20 de B) liberado");
  const b = bankOf();
  assert.equal(b.availableMinutes, 70, "100 gerado − 30 usado");
  assert.equal(b.reservedMinutes, 0);
});

check("TESTE 08 DE 20 — NECESSIDADE ZERO", () => {
  // Dia abaixo da base cuja necessidade já foi coberta por uso ativo:
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def60("2026-08-25")]);
  const prior = actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(prior.ok, `uso prévio cobre a base: ${prior.error}`);
  const plan = planForArrived("2026-08-25", 60, "2026-08-20");
  const r = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.equal(r.ok, false, "não permite aplicação");
  assert.equal(r.code, "destination-no-remaining-need");
  assert.ok(r.error?.includes("já atingiu a base"), "mensagem do §13");
  const c = actions.cancelSpecialExcessPlan({ id: plan.id, now: NOW() });
  assert.ok(c.ok, "liberar reserva continua disponível");
  assert.equal(uses().length, 1, "nenhum uso NOVO criado pela resolução falha");
  assert.equal(plans().find((p) => p.id === plan.id)!.status, "cancelled");
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("Sua jornada já atingiu a base. Esta reserva não é mais necessária."), "texto do §13 na UI");
  assert.ok(summary.includes('needZero ? "Liberar reserva" : "Cancelar reserva"'), "ação Liberar reserva");
});

check("TESTE 09 DE 20 — REGISTRO INCOMPLETO", () => {
  setState([...gen60("2026-08-18"), ...incomplete("2026-08-25")]);
  const plan = planForArrived("2026-08-25", 60, "2026-08-20");
  const r = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.equal(r.ok, false, "dia incompleto não aplica");
  assert.equal(r.code, "destination-not-eligible");
  assert.ok(r.error?.includes("Complete ou corrija os registros deste dia"), "mensagem do §6");
  assert.equal(activePlans()[0].status, "planned", "plano permanece");
  const c = actions.cancelSpecialExcessPlan({ id: plan.id, now: NOW() });
  assert.ok(c.ok, "cancelar/liberar continua disponível (§6)");
  assert.equal(uses().length, 0);
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("Complete ou corrija os registros deste dia antes de decidir o uso do [10+]."), "orientação na UI");
});

check("TESTE 10 DE 20 — PLANO MENOR QUE NECESSIDADE", () => {
  setState([...gen30("2026-08-18"), ...gen30("2026-08-28"), ...def60("2026-08-25")]);
  const plan = planForArrived("2026-08-25", 30, "2026-08-20");
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `aplicar 30: ${res.error}`);
  let proj = projectionOf("2026-08-25");
  assert.equal(proj.projectedWorkedMinutes, 450, "projeção 7h30");
  assert.equal(proj.projectedBalanceMinutes, -30, "−30min");
  // Fluxo existente "Completar mais com [10+]" para os 30 restantes:
  const more = actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(more.ok, `complemento: ${more.error}`);
  proj = projectionOf("2026-08-25");
  assert.equal(proj.projectedWorkedMinutes, 480, "agora 8h/0");
  const summary = src("src/components/special-excess-use-summary.tsx");
  assert.ok(summary.includes("Completar mais com [10+]"), "fluxo existente intacto");
});

check("TESTE 11 DE 20 — DOIS PLANOS NO MESMO DIA", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def60("2026-08-25")]);
  const planA = planForArrived("2026-08-25", 60, "2026-08-21");
  const planB = planForArrived("2026-08-25", 30, "2026-08-22");
  assert.equal(activeSpecialPlansForDate(plans(), "2026-08-25").length, 2);
  const resA = actions.resolveSpecialExcessPlan({ id: planA.id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.ok(resA.ok, `resolver A: ${resA.error}`);
  // B continua planned até decisão explícita (§15):
  const stillB = activeSpecialPlansForDate(plans(), "2026-08-25");
  assert.equal(stillB.length, 1);
  assert.equal(stillB[0].id, planB.id);
  // Necessidade 0 → B só pode ser LIBERADO (não aplicado):
  const rB = actions.resolveSpecialExcessPlan({ id: planB.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.equal(rB.ok, false);
  assert.equal(rB.code, "destination-no-remaining-need", "não cria overtime artificial");
  const cB = actions.cancelSpecialExcessPlan({ id: planB.id, now: NOW() });
  assert.ok(cB.ok, "liberação de B disponível");
});

check("TESTE 12 DE 20 — USO JÁ EXISTENTE + PLANO", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def60("2026-08-25")]);
  const u = actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(u.ok, `uso existente: ${u.error}`);
  const plan = planForArrived("2026-08-25", 60, "2026-08-20", NOW());
  const over = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 60, asOfDate: ASOF, now: NOW() });
  assert.equal(over.ok, false, "necessidade restante é 30 — 60 é rejeitado");
  assert.equal(over.limitMinutes, 30, "máximo = min(plano, restante após uso ativo)");
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: ASOF, now: NOW() });
  assert.ok(res.ok, `resolver 30: ${res.error}`);
  const proj = projectionOf("2026-08-25");
  assert.equal(proj.projectedWorkedMinutes, 480, "projeção 8h/0 (uso existente respeitado)");
  assert.equal(proj.needsReview, false, "nada acima da base");
});

check("TESTE 13 DE 20 — ATOMICIDADE", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...gen30("2026-08-22"), ...def60("2026-08-25"), ...incomplete("2026-08-26")]);
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() }).ok);
  const future = activePlans().find((p) => p.destinationDate === DEST)!;
  const arrived = planForArrived("2026-08-25", 60, "2026-08-20");
  const incomp = planForArrived("2026-08-26", 30, "2026-08-25");
  const usesBefore = uses().length;
  const bankBefore = bankOf().reservedMinutes;
  // Falhas em pontos diferentes (plano/destino/dia/valor):
  assert.equal(actions.resolveSpecialExcessPlan({ id: "sep-99", minutes: 30, asOfDate: ASOF, now: NOW() }).code, "plan-not-found");
  assert.equal(actions.resolveSpecialExcessPlan({ id: future.id, minutes: 60, asOfDate: ASOF, now: NOW() }).code, "destination-not-realized");
  assert.equal(actions.resolveSpecialExcessPlan({ id: incomp.id, minutes: 30, asOfDate: ASOF, now: NOW() }).code, "destination-not-eligible");
  assert.equal(actions.resolveSpecialExcessPlan({ id: arrived.id, minutes: 0, asOfDate: ASOF, now: NOW() }).code, "invalid");
  assert.ok(actions.cancelSpecialExcessPlan({ id: incomp.id, now: NOW() }).ok, "cancela o do dia incompleto p/ testar já-cancelado");
  assert.equal(actions.resolveSpecialExcessPlan({ id: incomp.id, minutes: 30, asOfDate: ASOF, now: NOW() }).code, "plan-already-cancelled");
  // NADA persistiu em nenhuma tentativa:
  assert.equal(uses().length, usesBefore, "nenhum uso parcial");
  assert.equal(activePlans().find((p) => p.id === arrived.id)!.status, "planned", "plano permanece planned");
  assert.equal(bankOf().reservedMinutes, bankBefore - 30, "banco intacto (só o cancelamento explícito liberou)");
});

check("TESTE 14 DE 20 — ALERTA PENDENTE (4D.5.2: faixa única violeta compartilhada)", () => {
  // 4D.5.2 (SUPERADA a faixa legada laranja "Planejamentos [10+] aguardando
  // confirmação: X — resolva ou libere nos dias abaixo." — expectativa
  // atualizada com justificativa): a ÚNICA faixa de planejamento é a violeta
  // compartilhada da 4D.5/4D.5.1 (fonte única attention-now); o predicado
  // canônico (planned + destino <= hoje) vive em hasArrivedSpecialPlan:
  const page = src("src/app/(app)/registros/page.tsx");
  const attention = src("src/lib/attention-now.ts");
  assert.ok(page.includes('Planejamento [10+] aguardando confirmação: {attention["plano-10"].length}'), "faixa única violeta");
  assert.ok(!page.includes("pendingPlansCount"), "faixa/variável legada removida");
  assert.ok(!page.includes("resolva ou libere nos dias abaixo"), "texto legado removido");
  assert.ok(attention.includes('date <= today && activeSpecialPlansForDate(plans, date).length > 0'), "contagem = planned com destino <= hoje (fonte única)");
  // Funcional: o predicado da página sobre o estado atual:
  setState([...gen60("2026-08-18"), ...def60("2026-08-25")]);
  planForArrived("2026-08-25", 60, "2026-08-20");
  const pending = (plans() as SpecialExcessPlan[]).filter((pl) => pl.status === "planned" && pl.destinationDate <= ASOF).length;
  assert.equal(pending, 1, "1 planejamento pendente");
});

check("TESTE 15 DE 20 — HOJE SEM PLANO / AUTOMÁTICO", () => {
  setState([...gen60("2026-08-18"), ...def45(HOJE)]); // hoje 7h15/−45
  const view = dayViewOf(HOJE, HOJE);
  assert.equal(view.eligible, true, "jornada encerrada e financeiramente válida");
  assert.equal(view.remainingMinutes, 45);
  assert.equal(view.canComplete, true, "card de hoje oferece Completar jornada com [10+]");
  const u = actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 45, allocationStrategy: "fifo", asOfDate: HOJE, now: NOW() });
  assert.ok(u.ok, `uso direto hoje: ${u.error}`);
  const row = rowOf(HOJE, HOJE);
  assert.equal(row.workedMinutes, 435, "factual permanece 7h15");
  assert.equal(row.balanceMinutes, -45, "saldo regular permanece −45");
  const proj = projectionOf(HOJE, HOJE);
  assert.equal(proj.projectedWorkedMinutes, 480, "projeção 8h/0");
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(modal.includes("Completar jornada com [10+]"), "nomenclatura validada");
});

check("TESTE 16 DE 20 — HOJE SEM PLANO / MANUAL", () => {
  setState([...gen60("2026-08-18"), ...def45(HOJE)]);
  const view = dayViewOf(HOJE, HOJE);
  assert.equal(view.remainingMinutes, 45);
  // Limite dinâmico 3G.2 na UI (mesmo helper do modal de uso):
  assert.equal(manualMaxForOrigin(60, 45, 0), 45, "máximo da origem = necessidade restante");
  assert.equal(manualMaxForOrigin(60, 45, 30), 15, "desconta outras seleções");
  // Store gate: manual acima do restante é rejeitado:
  const over = actions.createSpecialExcessUse({
    destinationDate: HOJE,
    minutes: 60,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-18", minutes: 60 }],
    asOfDate: HOJE,
    now: NOW(),
  });
  assert.equal(over.ok, false, "acima do restante rejeitado");
  assert.equal(over.code, "requested-exceeds-destination-need");
  const ok = actions.createSpecialExcessUse({
    destinationDate: HOJE,
    minutes: 45,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-18", minutes: 45 }],
    asOfDate: HOJE,
    now: NOW(),
  });
  assert.ok(ok.ok, `manual 45: ${ok.error}`);
  assert.deepEqual(uses()[0].allocations, [{ originDate: "2026-08-18", minutes: 45 }], "origem preservada");
});

check("TESTE 17 DE 20 — HOJE INCOMPLETO", () => {
  setState([...gen60("2026-08-18"), ...incomplete(HOJE)]); // batida aberta
  const view = dayViewOf(HOJE, HOJE);
  assert.equal(view.eligible, false, "dia incompleto não é elegível");
  assert.equal(view.canComplete, false, "sem opção de aplicar [10+]");
  const r = actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE, now: NOW() });
  assert.equal(r.ok, false, "store rejeita uso em dia incompleto");
  assert.equal(r.code, "destination-not-eligible");
  // UI: botão do uso é gated por canComplete (card) e o resumo orienta corrigir:
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("specialExcess.canComplete && onCompleteJornada"), "botão de uso gated por canComplete");
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("dayBlocked"), "bloco de plano orienta corrigir quando o dia chegou inválido");
});

check("TESTE 18 DE 20 — BANCO MENOR QUE NECESSIDADE", () => {
  setState([...gen30("2026-08-18"), ...def60(HOJE)]); // hoje 7h/−1h, banco 30min
  const view = dayViewOf(HOJE, HOJE);
  assert.equal(view.bankAvailableMinutes, 30);
  assert.equal(view.canComplete, true, "uso PARCIAL é permitido (não exige completar 8h)");
  const full = actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 60, allocationStrategy: "fifo", asOfDate: HOJE, now: NOW() });
  assert.equal(full.ok, false, "60 é rejeitado (banco tem 30)");
  assert.equal(full.code, "insufficient-special-balance");
  const partial = actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE, now: NOW() });
  assert.ok(partial.ok, `uso parcial 30: ${partial.error}`);
  const proj = projectionOf(HOJE, HOJE);
  assert.equal(proj.projectedWorkedMinutes, 450, "projeção 7h30");
  assert.equal(proj.projectedBalanceMinutes, -30, "projeção −30min");
});

check("TESTE 19 DE 20 — PLANO PARA HOJE + COMPLEMENTO", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def60(HOJE)]);
  const plan = planForArrived(HOJE, 30, addDays(HOJE, -1)); // planejou ontem p/ hoje
  const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 30, asOfDate: HOJE, now: NOW() });
  assert.ok(res.ok, `resolver plano 30: ${res.error}`);
  let proj = projectionOf(HOJE, HOJE);
  assert.equal(proj.projectedWorkedMinutes, 450, "7h30");
  assert.equal(proj.projectedBalanceMinutes, -30, "−30min");
  // Complemento independente via fluxo normal (decisão nova, não fundida):
  const more = actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE, now: NOW() });
  assert.ok(more.ok, `completar mais 30: ${more.error}`);
  proj = projectionOf(HOJE, HOJE);
  assert.equal(proj.projectedWorkedMinutes, 480, "8h/0");
  assert.equal(uses().length, 2, "duas decisões distintas (plano resolvido + complemento)");
});

check("TESTE 20 DE 20 — BACKUP + SEMÂNTICA", () => {
  // Cenário com plano resolvido (campos novos preenchidos):
  setState([...gen60("2026-08-18"), ...def60("2026-08-25")]);
  const plan = planForArrived("2026-08-25", 60, "2026-08-20");
  assert.ok(actions.resolveSpecialExcessPlan({ id: plan.id, minutes: 60, asOfDate: ASOF, now: NOW() }).ok);
  const withResolved = JSON.parse(JSON.stringify(d())) as ReturnType<typeof d>;
  const payload = buildBackupPayload(withResolved);
  // Backup NOVO preserva os campos de resolução:
  const parsedNew = parseBackup(JSON.stringify(payload));
  assert.ok(parsedNew.ok);
  const restoredPlan = parsedNew.ok ? parsedNew.backup.specialExcessPlans[0] : null;
  assert.ok(restoredPlan);
  assert.equal(restoredPlan!.status, "concluded");
  assert.equal(restoredPlan!.resolvedMinutes, 60);
  assert.equal(restoredPlan!.releasedMinutes, 0);
  assert.equal(restoredPlan!.resolvedUseId, withResolved.specialExcessUses![0].id);
  assert.ok(restoredPlan!.resolvedAt);
  // Backup ANTIGO (sem os campos) continua válido:
  const oldPlan = JSON.parse(JSON.stringify(restoredPlan!)) as Record<string, unknown>;
  delete oldPlan.resolvedAt;
  delete oldPlan.resolvedUseId;
  delete oldPlan.resolvedMinutes;
  delete oldPlan.releasedMinutes;
  const oldPayload = { ...payload, specialExcessPlans: [oldPlan] };
  const parsedOld = parseBackup(JSON.stringify(oldPayload));
  assert.ok(parsedOld.ok, "backup antigo válido");
  assert.equal(parsedOld.ok ? parsedOld.backup.specialExcessPlans[0].status : "", "concluded");
  // Merge preserva a resolução:
  setState([...gen60("2026-08-18")]);
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
  assert.equal(d().specialExcessPlans![0].resolvedUseId, restoredPlan!.resolvedUseId, "merge preserva resolução");
  // Semântica estrutural:
  const section = resolveSection();
  assert.ok(!section.includes("allocateSpecialExcessFifo") && !section.includes("allocateSpecialExcessManual"), "resolução não executa FIFO/seleção nova");
  assert.ok(section.includes("checkSpecialDestination"), "resolução usa o gate canônico");
  assert.ok(section.includes("target.allocations"), "resolução consome as allocations do plano");
  const resolveModal = src("src/components/special-excess-plan-resolve-modal.tsx");
  const resolveCode = resolveModal.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.ok(!resolveCode.includes("createSpecialExcessUse"), "modal de resolução não cria uso fora da action");
  assert.ok(!resolveCode.includes("projectRealizedDayOfficial"), "sem simulação de jornada futura");
  assert.ok(!resolveCode.includes("allocateSpecialExcessFifo"), "sem FIFO no componente");
  const summaryCode = src("src/components/special-excess-plan-summary.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.ok(!summaryCode.includes("SpecialExcessUse"), "resumo não mistura domínio do USO");
  const legacy = src("src/lib/hour-bank.ts");
  assert.ok(!legacy.includes("SpecialExcessPlan"), "Central legado intocada");
});

console.log(`\n${passed}/20 verificações da Etapa 4C passaram.`);
if (passed !== 20) process.exit(1);
