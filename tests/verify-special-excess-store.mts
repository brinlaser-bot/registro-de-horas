/**
 * VERIFICAÇÃO — ETAPA 3D: PERSISTÊNCIA E AÇÕES DO NOVO USO [10+]
 *
 * Conecta 3A (projeção/elegibilidade) + 3B (SpecialExcessUse) +
 * 3C (banco/FIFO/manual) ao store. Sem UI, sem adapter legado, sem
 * fechamento persistido (periodClosed = contexto do caller).
 *
 *  A  hidratação de estado antigo (sem specialExcessUses) → []
 *  B  criação FIFO simples
 *  C  criação FIFO com várias origens
 *  D  FIFO insuficiente → falha atômica, zero uso novo
 *  E  criação manual
 *  F  manual com mesma origem repetida → persistido consolidado
 *  G  manual origem insuficiente → falha sem mutação
 *  H  origem inexistente → falha
 *  I  origem futura (após asOf) → falha
 *  J  origem posterior ao destino, já realizada → válida
 *  K  origem de outro ciclo → falha
 *  L  destino 7h/base8 + uso 1h → válido
 *  M  destino 7h + uso 30min → válido
 *  N  segundo uso 30min → válido
 *  O  terceiro pedido 31min → falha (só restam 30)
 *  P  dia 8h → não aceita
 *  Q  falta/férias/afastamento → não aceita
 *  R  incompleto/inconsistente → não aceita
 *  S  banco insuficiente NÃO usa saldo regular
 *  T  cancelamento preserva histórico
 *  U  cancelamento devolve saldo ao banco
 *  V  cancelamento remove efeito da projeção
 *  W  cancelar cancelado → falha
 *  X  periodClosed bloqueia create
 *  Y  periodClosed bloqueia edit
 *  Z  periodClosed bloqueia cancel
 *  AA edição FIFO válida
 *  AB edição manual válida
 *  AC edição inválida é atômica e preserva uso antigo
 *  AD edição considera as próprias allocations antigas como livres
 *  AE uso FIFO histórico não muda após surgir origem antiga
 *  AF reload mantém allocations exatamente como persistidas
 *  AG legacy Compensation permanece intacto
 *  AH seed antigo não é convertido automaticamente
 *
 * Executar: npx tsx tests/verify-special-excess-store.mts
 */
import assert from "node:assert/strict";

import { buildSeedData } from "../src/lib/seed-data.ts";
import {
  actions,
  getAppData,
  parseStoredAppData,
} from "../src/lib/store.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { usedSpecialMinutesByDestination } from "../src/lib/special-excess-use.ts";
import { projectRealizedPeriodOfficial } from "../src/lib/official-projection.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com",
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true, birthDate: null,
  controlStartDate: "2026-04-01",
};
const ASOF = "2026-08-30";
const NOW = 1_000_000;

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
/** Dia 08:00–12:00 + 13:00–saída. Ex.: end 16:00 = 7h; 19:30 = 10h30. */
const day = (date: string, end: string) => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, end, "saida"),
];
const day7h = (date: string) => day(date, "16:00");    // deficit 60
const day730 = (date: string) => day(date, "16:30");   // deficit 30
const day8h = (date: string) => day(date, "17:00");    // 0 (ok)
const day10h30 = (date: string) => day(date, "19:30"); // excess 30
const day10h40 = (date: string) => day(date, "19:40"); // excess 40
const day11h = (date: string) => day(date, "20:00");   // excess 60

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const reset = (
  entries: TimeEntry[] = [],
  compensations: Compensation[] = [],
  absences: never[] = [],
  faltas: never[] = [],
  uses: never[] = [],
) =>
  actions.replaceAll({
    user, entries, compensations, absences,
    companyCalendars: undefined, faltas, excessReasons: [],
    specialExcessUses: uses,
  });

const st = () => getAppData();
const uses = () => st().specialExcessUses ?? [];
/** Snapshot normalizado (sem chaves undefined) para comparação de estado. */
const snap = () => JSON.parse(JSON.stringify(st()));

/* ── A. hidratação antiga → [] ────────────────────────────── */
check("A. estado antigo sem specialExcessUses → hidrata com []", () => {
  const raw = JSON.stringify({ user, entries: day8h("2026-08-24"), compensations: [] });
  const d = parseStoredAppData(raw);
  assert.ok(d);
  assert.deepEqual(d.specialExcessUses, []);
  assert.equal(d.entries.length, 4, "dados antigos preservados");
  assert.deepEqual(d.compensations, []);
});

/* ── B/C. criação FIFO ────────────────────────────────────── */
check("B. criação FIFO simples (30min da origem 10/08)", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(uses().length, 1);
  const u = uses()[0];
  assert.equal(u.id, "seu-1");
  assert.equal(u.status, "utilizado", "nasce utilizado (sem pendente/planejado)");
  assert.equal(u.allocationStrategy, "fifo");
  assert.equal(u.destinationDate, "2026-08-24");
  assert.deepEqual(u.allocations, [{ originDate: "2026-08-10", minutes: 30 }]);
  assert.equal(u.createdAt, NOW);
});
check("C. criação FIFO com várias origens (60min: 40 da 05/05 + 20 da 06/19)", () => {
  reset([
    ...day10h40("2026-05-05"), ...day11h("2026-06-19"), ...day10h30("2026-08-10"), ...day7h("2026-08-24"),
  ]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(uses()[0].allocations, [
    { originDate: "2026-05-05", minutes: 40 },
    { originDate: "2026-06-19", minutes: 20 },
  ], "persiste exatamente as allocations retornadas pelo FIFO");
});

/* ── D. FIFO insuficiente → falha atômica ─────────────────── */
check("D. FIFO insuficiente (pedido 60, banco 30) → falha atômica, zero uso novo", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "insufficient-special-balance");
  assert.equal(r.available, 30);
  assert.ok(r.error?.includes("faltam 30min"), r.error);
  assert.equal(uses().length, 0, "nada foi persistido (sem uso parcial de 30)");
});

/* ── E–H. criação manual ──────────────────────────────────── */
check("E. criação manual (10/08 → 30min)", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 30 }], asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(uses()[0].allocationStrategy, "manual");
  assert.deepEqual(uses()[0].allocations, [{ originDate: "2026-08-10", minutes: 30 }]);
});
check("F. manual com mesma origem repetida (15+15) → persistido como UMA allocation de 30", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 15 }, { originDate: "2026-08-10", minutes: 15 }],
    asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(uses()[0].allocations, [{ originDate: "2026-08-10", minutes: 30 }], "consolidado — nunca duas allocations da mesma origem");
});
check("G. manual origem insuficiente (45 de 30) → falha sem mutação", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const antes = snap();
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 45, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 45 }], asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "insufficient-special-balance");
  assert.deepEqual(snap(), antes, "estado intacto");
});
check("H. origem inexistente no banco → falha origin-not-found", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-07-15", minutes: 30 }], asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "origin-not-found");
  assert.equal(uses().length, 0);
});

/* ── I–K. origem futura / posterior / outro ciclo ─────────── */
check("I. origem futura (03/09, após asOf 30/08) → falha origin-not-realized", () => {
  reset([...day10h30("2026-09-03"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-09-03", minutes: 30 }], asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "origin-not-realized");
  assert.equal(uses().length, 0);
});
check("J. origem 28/08 posterior ao destino 26/08 (já realizada) → válida", () => {
  reset([...day10h30("2026-08-28"), ...day7h("2026-08-26")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(uses()[0].allocations, [{ originDate: "2026-08-28", minutes: 30 }]);
});
check("K. origem 29/04 (ciclo 2025/2026) x destino 24/08 (2026/2027) → falha origin-outside-cycle", () => {
  reset([...day11h("2026-04-29"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-04-29", minutes: 30 }], asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "origin-outside-cycle");
  assert.equal(uses().length, 0);
});

/* ── L–O. usos parciais no mesmo destino ──────────────────── */
check("L. destino 7h/base8 + uso 1h → válido (necessidade 1h atendida)", () => {
  reset([...day10h40("2026-05-05"), ...day11h("2026-06-19"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(uses()[0].allocations, [
    { originDate: "2026-05-05", minutes: 40 },
    { originDate: "2026-06-19", minutes: 20 },
  ]);
});
check("M. destino 7h + uso 30min → válido (restam 30min)", () => {
  reset([...day10h40("2026-05-05"), ...day11h("2026-06-19"), ...day7h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
});
check("N. após o primeiro 30, segundo uso 30min → válido (necessidade completa)", () => {
  reset([...day10h40("2026-05-05"), ...day11h("2026-06-19"), ...day7h("2026-08-24")]);
  assert.equal(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok,
    true,
  );
  const r2 = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW + 1,
  });
  assert.equal(r2.ok, true, r2.error);
  assert.equal(uses().length, 2);
});
check("O. após dois usos de 30, terceiro pedido 31min → falha (só restam 30; aqui 0)", () => {
  reset([...day10h40("2026-05-05"), ...day11h("2026-06-19"), ...day7h("2026-08-24")]);
  actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW });
  actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW + 1 });
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 31, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW + 2,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "destination-no-remaining-need", r.error);
  assert.equal(uses().length, 2, "nada foi persistido");
});

/* ── P–R. destino não elegível (fonte 3A) ─────────────────── */
check("P. dia 8h (base cumprida) → não aceita uso", () => {
  reset([...day10h30("2026-08-10"), ...day8h("2026-08-24")]);
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "destination-not-eligible");
  assert.equal(uses().length, 0);
});
check("Q. falta / férias / afastamento → não aceita uso", () => {
  reset([...day10h30("2026-08-10")], [], [
    { id: 1, kind: "ferias", startDate: "2026-08-25", endDate: "2026-08-25", duration: "integral", note: null, createdAt: 1 },
    { id: 2, kind: "saude", startDate: "2026-08-26", endDate: "2026-08-26", duration: "integral", note: null, createdAt: 1 },
  ], [{ id: 1, date: "2026-08-27", createdAt: 1 }]);
  for (const dest of ["2026-08-27", "2026-08-25", "2026-08-26"]) {
    const r = actions.createSpecialExcessUse({
      destinationDate: dest, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
    });
    assert.equal(r.ok, false, dest);
    assert.equal(r.code, "destination-not-eligible", `${dest}: ${r.error}`);
  }
  assert.equal(uses().length, 0);
});
check("R. dia incompleto (só entrada) e dia inconsistente (2 entradas) → não aceitam uso", () => {
  reset([
    ...day10h30("2026-08-10"),
    punch("2026-08-27", "08:00", "entrada"),
    punch("2026-08-28", "08:00", "entrada"),
    punch("2026-08-28", "09:00", "entrada"),
  ]);
  const rInc = actions.createSpecialExcessUse({
    destinationDate: "2026-08-27", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(rInc.ok, false);
  assert.equal(rInc.code, "destination-not-eligible");
  const rIncons = actions.createSpecialExcessUse({
    destinationDate: "2026-08-28", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(rIncons.ok, false);
  assert.equal(rIncons.code, "destination-not-eligible");
  assert.equal(uses().length, 0);
});

/* ── S. banco insuficiente NÃO usa saldo regular ──────────── */
check("S. destino precisa 1h, banco tem 30min [10+] e o dia de origem tem +2h regulares → falha por [10+]", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const row = buildResumoDayRow({
    date: "2026-08-10", today: ASOF, entries: st().entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01",
  });
  assert.equal(row.balanceMinutes, 120, "a origem tem +2h de saldo REGULAR…");
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, false, "…mas o [10+] não é completado com saldo regular");
  assert.equal(r.code, "insufficient-special-balance");
  assert.equal(r.available, 30);
  assert.equal(uses().length, 0);
});

/* ── T–W. cancelamento ────────────────────────────────────── */
check("T. cancelamento preserva histórico (id/destino/allocations/strategy/createdAt/note)", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  const criado = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW, note: "nota de teste",
  });
  assert.equal(criado.ok, true);
  const r = actions.cancelSpecialExcessUse({ id: "seu-1", periodClosed: false, now: NOW + 10 });
  assert.equal(r.ok, true);
  assert.equal(uses().length, 1, "registro NÃO é apagado");
  const u = uses()[0];
  assert.equal(u.status, "cancelado");
  assert.equal(u.cancelledAt, NOW + 10);
  assert.equal(u.updatedAt, NOW + 10);
  assert.equal(u.id, "seu-1");
  assert.equal(u.destinationDate, "2026-08-24");
  assert.deepEqual(u.allocations, [{ originDate: "2026-08-10", minutes: 30 }]);
  assert.equal(u.allocationStrategy, "fifo");
  assert.equal(u.createdAt, NOW);
  assert.equal(u.note, "nota de teste");
});
check("U. cancelamento devolve saldo ao banco por derivação", () => {
  const d = st();
  const bank = buildSpecialExcessBank({
    cycle: "2026/2027", asOfDate: ASOF, entries: d.entries, absences: d.absences,
    calendars: d.companyCalendars, settings, faltas: d.faltas,
    controlStartDate: "2026-04-01", uses: d.specialExcessUses ?? [],
  });
  const lot = bank.lots.find((l) => l.originDate === "2026-08-10")!;
  assert.equal(lot.usedMinutes, 0, "cancelado não consome");
  assert.equal(lot.availableMinutes, 30, "saldo voltou");
  assert.equal(bank.availableMinutes, 30);
});
check("V. cancelamento remove o efeito da projeção (3A volta ao factual)", () => {
  reset([...day10h30("2026-08-10"), ...day730("2026-08-26")]);
  assert.equal(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok,
    true,
  );
  const project = () =>
    projectRealizedPeriodOfficial({
      from: "2026-08-26", to: "2026-08-26", today: ASOF,
      entries: st().entries, absences: [], calendars: undefined, settings, faltas: [],
      controlStartDate: "2026-04-01",
      usedSpecialMinutesByDate: usedSpecialMinutesByDestination(st().specialExcessUses ?? []),
    });
  const comUso = project();
  assert.equal(comUso.factualBalanceMinutes, -30, "factual 7h30 intacto");
  assert.equal(comUso.projectedBalanceMinutes, 0, "com uso: projetado 8h/0");
  assert.equal(actions.cancelSpecialExcessUse({ id: "seu-1", now: NOW + 5 }).ok, true);
  const semUso = project();
  assert.equal(semUso.factualBalanceMinutes, -30, "factual continua 7h30");
  assert.equal(semUso.projectedBalanceMinutes, -30, "projeção volta para 7h30/−30");
});
check("W. cancelar uso já cancelado → falha use-already-cancelled", () => {
  const r = actions.cancelSpecialExcessUse({ id: "seu-1", now: NOW + 20 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "use-already-cancelled");
});

/* ── X–Z. periodClosed (contexto do caller) ───────────────── */
check("X. periodClosed=true bloqueia create", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  assert.equal(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok,
    true,
    "uso criado com o período ainda aberto",
  );
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW + 1, periodClosed: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "period-closed");
  assert.equal(uses().length, 1, "apenas o uso anterior persistido");
});
check("Y. periodClosed=true bloqueia edit (uso intacto)", () => {
  const antes = JSON.parse(JSON.stringify(uses()[0]));
  const r = actions.updateSpecialExcessUse({ id: "seu-1", note: "x", asOfDate: ASOF, now: NOW + 1, periodClosed: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, "period-closed");
  assert.deepEqual(uses()[0], antes);
});
check("Z. periodClosed=true bloqueia cancel", () => {
  const r = actions.cancelSpecialExcessUse({ id: "seu-1", periodClosed: true, now: NOW + 1 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "period-closed");
  assert.equal(uses()[0].status, "utilizado");
});

/* ── AA–AD. edição atômica ────────────────────────────────── */
check("AA. edição FIFO válida (30→60 recalcula allocations; id/createdAt preservados)", () => {
  reset([...day11h("2026-06-19"), ...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  assert.equal(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok,
    true,
  );
  const u0 = uses()[0];
  assert.deepEqual(u0.allocations, [{ originDate: "2026-06-19", minutes: 30 }]);
  const r = actions.updateSpecialExcessUse({ id: "seu-1", minutes: 60, asOfDate: ASOF, now: NOW + 20 });
  assert.equal(r.ok, true, r.error);
  const u1 = uses()[0];
  assert.deepEqual(u1.allocations, [{ originDate: "2026-06-19", minutes: 60 }], "recalculado na edição (decisão consciente)");
  assert.equal(u1.id, "seu-1", "id preservado");
  assert.equal(u1.createdAt, NOW, "createdAt preservado");
  assert.equal(u1.updatedAt, NOW + 20);
  assert.equal(u1.status, "utilizado");
  assert.equal(uses().length, 1, "substituição, não novo registro");
});
check("AB. edição manual válida (troca de origens/quantidades, ordem do usuário)", () => {
  const r = actions.updateSpecialExcessUse({
    id: "seu-1", allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 30 }, { originDate: "2026-06-19", minutes: 30 }],
    asOfDate: ASOF, now: NOW + 30,
  });
  assert.equal(r.ok, true, r.error);
  const u = uses()[0];
  assert.equal(u.allocationStrategy, "manual");
  assert.deepEqual(u.allocations, [
    { originDate: "2026-08-10", minutes: 30 },
    { originDate: "2026-06-19", minutes: 30 },
  ], "ordem informada preservada (não virou FIFO)");
});
check("AC. edição inválida (60→90, necessidade 60) é atômica e preserva o uso antigo", () => {
  const snapUse = () => JSON.parse(JSON.stringify(uses()[0]));
  const antes = snapUse();
  const r = actions.updateSpecialExcessUse({
    id: "seu-1", allocationStrategy: "fifo", minutes: 90, asOfDate: ASOF, now: NOW + 40,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "requested-exceeds-destination-need");
  assert.deepEqual(snapUse(), antes, "uso antigo intacto (byte a byte)");
});
check("AD. edição considera as próprias allocations antigas como livres durante a validação", () => {
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")]);
  assert.equal(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok,
    true,
  );
  // origem 10/08 está 100% consumida pelo uso; editá-lo para a MESMA origem
  // só passa se as 30min antigas forem temporariamente liberadas na validação
  const r = actions.updateSpecialExcessUse({
    id: "seu-1", allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 30 }],
    asOfDate: ASOF, now: NOW + 50,
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(uses()[0].status, "utilizado");
});

/* ── AE–AF. histórico e reload ────────────────────────────── */
check("AE. uso FIFO histórico não muda quando surge origem mais antiga (01/05)", () => {
  reset([
    ...day11h("2026-06-19"), ...day10h30("2026-08-10"), ...day("2026-08-24", "15:30"), // 6h30 → deficit 90
    ...day7h("2026-08-25"),
  ]);
  assert.equal(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 90, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok,
    true,
  );
  const historico = JSON.parse(JSON.stringify(uses()[0].allocations));
  assert.deepEqual(historico, [
    { originDate: "2026-06-19", minutes: 60 },
    { originDate: "2026-08-10", minutes: 30 },
  ]);
  // surge origem mais antiga (05/05) — reload com o novo fato + uso persistido
  actions.replaceAll({
    user,
    entries: [...st().entries, ...day10h40("2026-05-05")],
    compensations: [], absences: [], companyCalendars: undefined, faltas: [], excessReasons: [],
    specialExcessUses: st().specialExcessUses ?? [],
  });
  assert.deepEqual(uses()[0].allocations, historico, "allocations históricas NÃO foram recalculadas");
  const novo = actions.createSpecialExcessUse({
    destinationDate: "2026-08-25", minutes: 40, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW + 1,
  });
  assert.equal(novo.ok, true, novo.error);
  assert.deepEqual(uses()[1].allocations, [{ originDate: "2026-05-05", minutes: 40 }], "novo uso usa a origem mais antiga");
});
check("AF. reload mantém allocations exatamente como persistidas", () => {
  const serialized = JSON.stringify(st());
  const reloaded = parseStoredAppData(serialized);
  assert.ok(reloaded);
  assert.deepEqual(reloaded.specialExcessUses, st().specialExcessUses, "idêntico após parse (nenhum recálculo na hidratação)");
});

/* ── AG–AH. legado intacto / seed não convertido ──────────── */
check("AG. legacy Compensation permanece intacto após operações [10+]", () => {
  const legacy: Compensation[] = [
    { id: 77, sourceDate: "2026-08-10", targetDate: "2026-08-24", minutes: 30, status: "pendente", note: "legado", createdAt: NOW, kind: "excedente" },
  ];
  reset([...day10h30("2026-08-10"), ...day7h("2026-08-24")], legacy);
  actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW });
  actions.cancelSpecialExcessUse({ id: "seu-1", now: NOW + 5 });
  assert.deepEqual(st().compensations, legacy, "compensações legacy intactas");
  assert.deepEqual(
    st().entries.map((e) => [e.date, e.time, e.type]),
    [...day10h30("2026-08-10"), ...day7h("2026-08-24")].map((e) => [e.date, e.time, e.type]),
    "fatos intactos",
  );
});
check("AH. seed antigo não é convertido automaticamente (compensações ≠ SpecialExcessUse)", () => {
  const seed = buildSeedData();
  assert.deepEqual(seed.specialExcessUses, [], "banco novo começa vazio");
  assert.ok(seed.compensations.length >= 10, "seed legado mantém as compensações antigas");
});

console.log(`\nUSO [10+] — PERSISTÊNCIA E AÇÕES (ÉTAPA 3D) — OK (${passed} testes)`);
