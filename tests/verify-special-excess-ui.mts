/**
 * VERIFICAÇÃO — ETAPA 3E: INTERFACE "COMPLETAR JORNADA COM [10+]"
 *
 * Testa a derivação do dia (buildSpecialExcessDayView — fonte única da
 * regra visual) + os motores que o modal/card exibem + a integração com
 * as ações 3D (create/cancel) + varredura de fonte (sem action legada no
 * fluxo). A UI em si (React) não roda aqui; a lógica de decisão é a
 * MESMA função pura que o card/modal consomem.
 *
 *  A  dia deficit + banco [10+] → botão disponível (canComplete)
 *  B  registro incompleto (1 batida, dia passado) → sem botão
 *  C  registro inconsistente (2 entradas) → sem botão
 *  D  dia 8h (ok) → sem botão
 *  E  dia 8h30 (acima da base) → sem botão
 *  F  falta / férias / afastamento → sem botão
 *  G  deficit + banco 0 → elegível, mas canComplete false (info "sem saldo")
 *  H  modal abre com a necessidade correta (cabeçalho)
 *  I  automático: preview de origens vem do motor 3C (FIFO)
 *  J  automático não permite mais que a necessidade restante
 *  K  manual lista só lotes com disponível > 0
 *  L  manual aceita origem posterior ao destino, já realizada
 *  M  manual não mostra origem futura
 *  N  manual: soma das seleções é a quantidade autoritativa
 *  O  preview da projeção vem do motor 3A (sem fórmula na UI)
 *  P  confirmar cria o SpecialExcessUse (auto e manual)
 *  Q  após uso: card factual (trabalhado/saldo) inalterado
 *  R  card mostra [10+] utilizado + projeção
 *  S  uso parcial → ainda pode completar ("completar mais")
 *  T  uso integral → sem botão de novo uso
 *  U  cancelamento devolve saldo ao banco
 *  V  cancelamento restaura a projeção (remover efeito)
 *  W  vários usos no mesmo destino → agregado + detalhe
 *  X  cancelamento individual preserva os outros usos
 *  Y  zero action legada no fluxo + textos obrigatórios
 *
 * Executar: npx tsx tests/verify-special-excess-ui.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { actions, getAppData } from "../src/lib/store.ts";
import { allocateSpecialExcessFifo } from "../src/lib/special-excess-bank.ts";
import { usedSpecialMinutesByDestination, type SpecialExcessUse } from "../src/lib/special-excess-use.ts";
import { projectRealizedDayOfficial } from "../src/lib/official-projection.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Compensation, Falta, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

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
const DEST = "2026-08-24"; // seg

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
/** Dia 08:00–12:00 + 13:00–saída. end 16:00 = 7h; 17:00 = 8h; 19:30 = 10h30. */
const day = (date: string, end: string) => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, end, "saida"),
];
const day7h = (d: string) => day(d, "16:00");
const day8h = (d: string) => day(d, "17:00");
const day830 = (d: string) => day(d, "17:30");
const day10h30 = (d: string) => day(d, "19:30");
const day10h40 = (d: string) => day(d, "19:40");
const day11h = (d: string) => day(d, "20:00");

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const reset = (entries: TimeEntry[], uses: SpecialExcessUse[] = [], absences: never[] = [], faltas: Falta[] = []) =>
  actions.replaceAll({
    user, entries, compensations: [] as Compensation[], absences,
    companyCalendars: undefined, faltas, excessReasons: [],
    specialExcessUses: uses,
  });

const st = () => getAppData();
const usesOf = () => st().specialExcessUses ?? [];

/** MESMA função que o card/modal consomem (fonte única da regra visual). */
const viewOf = (
  date: string,
  entries: TimeEntry[],
  uses: SpecialExcessUse[] = [],
  absences: Absence[] = [],
  faltas: Falta[] = [],
) =>
  buildSpecialExcessDayView({
    date, asOfDate: ASOF, entries, absences, calendars: undefined,
    settings, faltas, controlStartDate: user.controlStartDate, uses,
  });

/** Origens [10+] do ciclo 2026/2027 (130min no total). */
const ORIGINS = [...day10h40("2026-05-05"), ...day11h("2026-06-19"), ...day10h30("2026-08-10")];
/** Dia elegível: 7h trabalhados, base 8h → falta 60. */
const dest7 = () => day7h(DEST);

/* ── A. deficit + banco → botão ───────────────────────────── */
check("A. dia deficit (7h) + banco [10+] 130min → canComplete true (botão)", () => {
  const v = viewOf(DEST, [...ORIGINS, ...dest7()]);
  assert.equal(v.eligible, true);
  assert.equal(v.neededMinutes, 60);
  assert.equal(v.bankAvailableMinutes, 130);
  assert.equal(v.canComplete, true);
});

/* ── B. incompleto → sem botão ────────────────────────────── */
check("B. registro incompleto (1 batida, dia passado) → não elegível", () => {
  const v = viewOf(DEST, [punch(DEST, "08:00", "entrada")], [], [], []);
  assert.equal(v.eligible, false, "incompleto ≠ abaixo do previsto");
  assert.equal(v.canComplete, false);
});

/* ── C. inconsistente → sem botão ─────────────────────────── */
check("C. registro inconsistente (2 entradas) → não elegível", () => {
  const v = viewOf(DEST, [punch(DEST, "08:00", "entrada"), punch(DEST, "13:00", "entrada")]);
  assert.equal(v.eligible, false);
  assert.equal(v.canComplete, false);
});

/* ── D/E. 8h e 8h30 → sem botão ───────────────────────────── */
check("D. dia 8h (na base) → não elegível", () => {
  const v = viewOf(DEST, day8h(DEST));
  assert.equal(v.eligible, false);
  assert.equal(v.canComplete, false);
});
check("E. dia 8h30 (acima da base, sem [10+]) → não elegível", () => {
  const v = viewOf(DEST, day830(DEST));
  assert.equal(v.eligible, false);
  assert.equal(v.canComplete, false);
});

/* ── F. falta / férias / afastamento → sem botão ──────────── */
check("F. falta / férias / afastamento → não elegível", () => {
  const vFalta = viewOf(DEST, [], [], [], [{ id: 1, date: DEST, createdAt: NOW }]);
  assert.equal(vFalta.eligible, false, "falta");
  const ferias: Absence = { id: 1, kind: "ferias", startDate: DEST, endDate: DEST, duration: "integral", createdAt: NOW };
  const saude: Absence = { id: 2, kind: "saude", startDate: DEST, endDate: DEST, duration: "integral", createdAt: NOW };
  assert.equal(viewOf(DEST, [], [], [ferias]).eligible, false, "férias");
  assert.equal(viewOf(DEST, [], [], [saude]).eligible, false, "afastamento");
});

/* ── G. deficit + banco 0 → info, sem botão ───────────────── */
check("G. deficit + banco [10+] 0 → elegível, canComplete false (info sem saldo)", () => {
  const v = viewOf(DEST, dest7());
  assert.equal(v.eligible, true);
  assert.equal(v.neededMinutes, 60);
  assert.equal(v.bankAvailableMinutes, 0);
  assert.equal(v.canComplete, false, "NUNCA usa saldo regular");
});

/* ── H. cabeçalho do modal ────────────────────────────────── */
check("H. modal abre com a necessidade correta (cabeçalho)", () => {
  const v = viewOf(DEST, [...ORIGINS, ...dest7()]);
  assert.equal(v.workedMinutes, 420, "jornada factual 7h");
  assert.equal(v.factualBalanceMinutes, -60, "saldo factual −60");
  assert.equal(v.neededMinutes, 60, "falta para completar");
  assert.equal(v.usedActiveMinutes, 0, "ainda não utilizado");
  assert.equal(v.remainingMinutes, 60, "ainda pode completar");
  assert.equal(v.bankAvailableMinutes, 130, "banco disponível");
  assert.equal(v.maxUsableMinutes, 60, "máx = min(restante, banco)");
});

/* ── I. preview automático = motor 3C ─────────────────────── */
check("I. automático: preview de origens vem do motor 3C (mais antigas 1º)", () => {
  const v = viewOf(DEST, [...ORIGINS, ...dest7()]);
  const fifo = allocateSpecialExcessFifo({ bank: v.bank, destinationDate: DEST, requestedMinutes: v.maxUsableMinutes });
  assert.equal(fifo.allocatedMinutes, 60);
  assert.deepEqual(fifo.allocations, [
    { originDate: "2026-05-05", minutes: 40 },
    { originDate: "2026-06-19", minutes: 20 },
  ], "a UI exibe exatamente as allocations do motor (sem FIFO próprio)");
});

/* ── J. automático ≤ necessidade ──────────────────────────── */
check("J. automático não permite mais que a necessidade restante", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.remainingMinutes, 30);
  assert.equal(v.maxUsableMinutes, 30, "máx cai junto com o restante");
  assert.ok(Math.min(90, v.maxUsableMinutes) <= v.neededMinutes, "clamp da UI ≤ necessidade");
});

/* ── K. manual só lotes disponíveis ───────────────────────── */
check("K. manual lista só lotes com disponível > 0", () => {
  reset([...ORIGINS, ...dest7()]);
  const r = actions.createSpecialExcessUse({
    destinationDate: DEST, minutes: 40, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-05-05", minutes: 40 }], asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.ok(!v.lots.some((l) => l.originDate === "2026-05-05"), "lote esgotado sai da lista");
  assert.ok(v.lots.every((l) => l.availableMinutes > 0));
  assert.ok(v.lots.some((l) => l.originDate === "2026-06-19"));
});

/* ── L. origem posterior ao destino, já realizada ─────────── */
check("L. manual mostra origem posterior ao destino (28/08), já realizada no asOf", () => {
  const v = viewOf(DEST, [...ORIGINS, ...day10h30("2026-08-28"), ...dest7()]);
  assert.ok(v.lots.some((l) => l.originDate === "2026-08-28"), "28/08 > 24/08, realizado → visível");
});

/* ── M. origem futura não aparece ─────────────────────────── */
check("M. manual não mostra origem futura (09/03/2027)", () => {
  const v = viewOf(DEST, [...ORIGINS, ...day10h30("2027-03-09"), ...dest7()]);
  assert.ok(!v.lots.some((l) => l.originDate === "2027-03-09"), "futura em relação ao asOf → fora");
  assert.equal(v.bankAvailableMinutes, 130, "banco só conta realizado");
});

/* ── N. soma das manualAllocations é autoritativa ─────────── */
check("N. manual: soma das seleções = quantidade (mesma lógica do modal)", () => {
  reset([...ORIGINS, ...dest7()]);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()]);
  const manualSel: Record<string, number> = { "2026-05-05": 40, "2026-06-19": 20, "2026-08-10": 0 };
  const manualAllocations = Object.entries(manualSel)
    .filter(([, m]) => m > 0)
    .map(([originDate, minutes]) => ({ originDate, minutes }));
  const manualTotal = manualAllocations.reduce((s, a) => s + a.minutes, 0);
  assert.equal(manualTotal, 60);
  for (const a of manualAllocations) {
    const lot = v.bank.lots.find((l) => l.originDate === a.originDate);
    assert.ok(lot && a.minutes <= lot.availableMinutes, "cada origem ≤ disponível");
  }
  const r = actions.createSpecialExcessUse({
    destinationDate: DEST, minutes: manualTotal, allocationStrategy: "manual",
    manualAllocations, asOfDate: ASOF, now: NOW,
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(usesOf()[0].allocations, [
    { originDate: "2026-05-05", minutes: 40 },
    { originDate: "2026-06-19", minutes: 20 },
  ]);
});

/* ── O. preview da projeção = motor 3A ────────────────────── */
check("O. preview da projeção vem do motor 3A (7h + uso)", () => {
  const p30 = projectRealizedDayOfficial({
    date: DEST, factualWorkedMinutes: 420, factualRegistrableMinutes: 420,
    factualRegularBalanceMinutes: -60, effectiveBaseMinutes: 480,
    financialValid: true, realized: true, usedSpecialMinutes: 30,
  });
  assert.equal(p30.projectedWorkedMinutes, 450);
  assert.equal(p30.projectedBalanceMinutes, -30);
  const p60 = projectRealizedDayOfficial({
    date: DEST, factualWorkedMinutes: 420, factualRegistrableMinutes: 420,
    factualRegularBalanceMinutes: -60, effectiveBaseMinutes: 480,
    financialValid: true, realized: true, usedSpecialMinutes: 60,
  });
  assert.equal(p60.projectedWorkedMinutes, 480);
  assert.equal(p60.projectedBalanceMinutes, 0);
});

/* ── P. confirmar cria o uso (auto e manual) ──────────────── */
check("P. confirmar cria o SpecialExcessUse (mesma chamada do modal)", () => {
  reset([...ORIGINS, ...dest7()]);
  const rAuto = actions.createSpecialExcessUse({
    destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW,
  });
  assert.equal(rAuto.ok, true, rAuto.error);
  const uAuto = usesOf()[0];
  assert.equal(uAuto.allocationStrategy, "fifo");
  assert.deepEqual(uAuto.allocations, [
    { originDate: "2026-05-05", minutes: 40 },
    { originDate: "2026-06-19", minutes: 20 },
  ]);
  assert.equal(uAuto.status, "utilizado");
  reset([...ORIGINS, ...dest7()]);
  const rMan = actions.createSpecialExcessUse({
    destinationDate: DEST, minutes: 60, allocationStrategy: "manual",
    manualAllocations: [
      { originDate: "2026-05-05", minutes: 40 },
      { originDate: "2026-06-19", minutes: 20 },
    ],
    asOfDate: ASOF, now: NOW,
  });
  assert.equal(rMan.ok, true, rMan.error);
  assert.equal(usesOf()[0].allocationStrategy, "manual");
});

/* ── Q. factual inalterado após uso ───────────────────────── */
check("Q. após uso: Trabalhado/Saldo factual do card seguem inalterados", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.workedMinutes, 420, "factual continua 7h");
  assert.equal(v.factualBalanceMinutes, -60, "saldo factual continua −60");
  const entriesAfter = st().entries;
  assert.equal(entriesAfter.length, 4 + ORIGINS.length, "batidas intactas");
});

/* ── R. card mostra [10+] + projeção ──────────────────────── */
check("R. card mostra [10+] utilizado + projeção (7h30 / −30min)", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.usedActiveMinutes, 30);
  assert.equal(v.activeUses.length, 1);
  assert.deepEqual(v.projection, { workedMinutes: 450, balanceMinutes: -30 });
});

/* ── S. parcial → completar mais ──────────────────────────── */
check("S. uso parcial → estado 'completar mais' (canContinue com uso ativo)", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.activeUses.length, 1);
  assert.equal(v.canComplete, true, "ainda falta 30 e há banco");
  assert.equal(v.remainingMinutes, 30);
});

/* ── T. integral → sem botão ──────────────────────────────── */
check("T. uso integral → sem botão de novo uso (só mostra uso + projeção)", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.remainingMinutes, 0);
  assert.equal(v.canComplete, false, "necessidade quitada → sem botão");
  assert.equal(v.usedActiveMinutes, 60);
  assert.deepEqual(v.projection, { workedMinutes: 480, balanceMinutes: 0 });
});

/* ── U. cancel devolve saldo ──────────────────────────────── */
check("U. cancelamento devolve saldo ao banco [10+]", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const vMid = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(vMid.bankAvailableMinutes, 70, "130 − 60");
  const r = actions.cancelSpecialExcessUse({ id: usesOf()[0].id, now: NOW });
  assert.equal(r.ok, true, r.error);
  const vAfter = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(vAfter.bankAvailableMinutes, 130, "saldo devolvido");
});

/* ── V. cancel restaura projeção ──────────────────────────── */
check("V. cancelamento restaura a projeção (efeito removido)", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  const before = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.deepEqual(before.projection, { workedMinutes: 450, balanceMinutes: -30 });
  assert.equal(actions.cancelSpecialExcessUse({ id: usesOf()[0].id, now: NOW }).ok, true);
  const after = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(after.usedActiveMinutes, 0);
  assert.equal(after.projection, null, "sem uso ativo → sem projeção de uso");
  const byDest = usedSpecialMinutesByDestination(usesOf());
  assert.ok(byDest[DEST] === undefined || byDest[DEST] === 0, "destino sai da projeção de usos");
  assert.equal(after.eligible, true, "dia continua elegível (facto inalterado)");
});

/* ── W. vários usos → agregado + detalhe ──────────────────── */
check("W. vários usos no mesmo destino → agregado + detalhe por uso", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  assert.equal(actions.createSpecialExcessUse({
    destinationDate: DEST, minutes: 20, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 20 }], asOfDate: ASOF, now: NOW,
  }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.usedActiveMinutes, 50, "agregado");
  assert.equal(v.activeUses.length, 2, "detalhe por uso");
  assert.deepEqual(v.projection, { workedMinutes: 470, balanceMinutes: -10 });
  assert.deepEqual(v.activeUses[0].allocations, [{ originDate: "2026-05-05", minutes: 30 }]);
  assert.deepEqual(v.activeUses[1].allocations, [{ originDate: "2026-08-10", minutes: 20 }]);
});

/* ── X. cancel individual preserva os outros ──────────────── */
check("X. cancelamento individual preserva os outros usos", () => {
  reset([...ORIGINS, ...dest7()]);
  assert.equal(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW }).ok, true);
  assert.equal(actions.createSpecialExcessUse({
    destinationDate: DEST, minutes: 20, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-10", minutes: 20 }], asOfDate: ASOF, now: NOW,
  }).ok, true);
  const idMan = usesOf()[1].id; // uso B (manual, 20min)
  assert.equal(actions.cancelSpecialExcessUse({ id: idMan, now: NOW }).ok, true);
  const v = viewOf(DEST, [...ORIGINS, ...dest7()], usesOf());
  assert.equal(v.activeUses.length, 1, "só o uso A continua ativo");
  assert.equal(v.usedActiveMinutes, 30, "20min voltaram, 30 intactos");
  assert.deepEqual(v.projection, { workedMinutes: 450, balanceMinutes: -30 });
  assert.equal(v.canComplete, true, "restam 20min de necessidade → 'completar mais'");
});

/* ── Y. zero action legada no fluxo + textos ──────────────── */
check("Y. zero action legada no fluxo + textos obrigatórios", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const modal = read("src/components/special-excess-use-modal.tsx");
  const summary = read("src/components/special-excess-use-summary.tsx");
  const dayView = read("src/lib/special-excess-day-view.ts");
  const page = read("src/app/(app)/registros/page.tsx");

  const forbidden = [
    "actions.addComp", "actions.updateComp", "actions.deleteComp",
    "planRealizedCreditUse", "applyOverflowToDeficit",
    "actions.useRealizedCredit", "actions.allocateSpecialExcess(",
    "buildDebtDays", "hourBankSummary", "specialExcessLedger",
  ];
  for (const src of [modal, summary, dayView]) {
    for (const token of forbidden) {
      assert.ok(!src.includes(token), `token legada presente: ${token}`);
    }
  }
  // Ações 3D usadas exatamente onde devem:
  assert.ok(modal.includes("createSpecialExcessUse"), "modal confirma via 3D create");
  assert.ok(summary.includes("cancelSpecialExcessUse"), "card cancela via 3D cancel");
  assert.ok(!summary.includes("excluir") && !summary.includes("Excluir"), "cancelamento nunca é 'excluir'");
  // Derivação sempre pelos motores:
  assert.ok(dayView.includes("isProjectableDayStatus") && dayView.includes("projectRealizedDayOfficial") && dayView.includes("buildSpecialExcessBank"));
  // Wiring na página:
  assert.ok(page.includes("specialExcess=") && page.includes("onCompleteJornada=") && page.includes("<SpecialExcessUseModal"));
  // Textos obrigatórios (sem "FIFO" como texto principal):
  assert.ok(modal.includes("Completar jornada com [10+]"));
  assert.ok(modal.includes("Usar horas mais antigas primeiro"));
  assert.ok(modal.includes("Escolher a origem das horas"));
  assert.ok(modal.includes("O Meu Horário usa primeiro os saldos [10+] mais antigos disponíveis."));
  assert.ok(modal.includes("Como ficará na projeção do ponto"));
  assert.ok(modal.includes("O uso de [10+] não altera sua jornada real."));
  assert.ok(modal.includes("Usar [10+]"));
  assert.ok(!/[>"]FIFO[<"]/.test(modal), "'FIFO' não aparece como texto de UI");
  assert.ok(summary.includes("Completar jornada com [10+]"));
  assert.ok(summary.includes("Completar mais com [10+]"));
  assert.ok(summary.includes("Sem saldo [10+] disponível"));
  assert.ok(summary.includes("Seleção automática"));
  assert.ok(summary.includes("Origem escolhida manualmente"));
  assert.ok(summary.includes("Cancelar uso de [10+]"));
  assert.ok(summary.includes("O valor voltará ao saldo [10+] disponível e a jornada factual continuará inalterada."));
});

console.log(`\n${passed}/${passed} verificações 3E (UI [10+]) passaram.`);
