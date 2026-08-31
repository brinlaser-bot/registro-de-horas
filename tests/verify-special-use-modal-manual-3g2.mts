/**
 * VERIFICAÇÃO — CORREÇÃO PONTUAL 3G.2: IMPEDIR SOBREALOCAÇÃO NO MODO MANUAL.
 *
 * BUG: no modal "Completar jornada com [10+] → Manual" era possível
 * selecionar MAIS [10+] do que a necessidade do destino (24/08, need 30:
 * aceitou 40min, 1h e até 2h10 somando origens). A projeção limitava o
 * efeito (3A), mas a UI reservava uso artificial — violação da regra-mãe:
 * um destino só recebe [10+] até completar a BASE EFETIVA.
 *
 * CORREÇÃO (apresentação; gate persistente JÁ EXISTIA — comprovado, não
 * duplicado):
 *   maxForThisOrigin = min(available, max(remainingNeed − selectedOthers, 0))
 * reaproveitando `remainingMinutes` do day-view — sem fórmula financeira
 * paralela. Gate final: checkSpecialDestination (store, motor 3A).
 *
 * Casos: A need30+orig30→30 · B orig40→máx30 · C orig60→máx30 ·
 * D 10+20→30 · E total30 trava terceira · F reduzir libera ·
 * G desmarcar libera · H/I/J store rejeita 40/60/2h10 ·
 * K erro não consome banco · L projeção intacta e limitada ·
 * M origem posterior válida · N FIFO intacto · O 3G.1 preservado.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-use-modal-manual-3g2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  manualMaxForOrigin,
  manualRemainingAfterSelection,
} from "../src/components/special-excess-use-modal.tsx";
import { allocateSpecialExcessFifo, buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { projectRealizedDayOfficial } from "../src/lib/official-projection.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";
const DEST = "2026-08-24"; // 7h30 → need 30min

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function resetSeed() {
  const seed = buildSeedData();
  actions.replaceAll({
    user: seed.user,
    entries: seed.entries,
    compensations: seed.compensations,
    absences: seed.absences,
    companyCalendars: seed.companyCalendars,
    faltas: seed.faltas,
    excessReasons: seed.excessReasons,
    specialExcessUses: seed.specialExcessUses ?? [],
  });
}

function dayViewOf(date: string) {
  const d = getAppData();
  return buildSpecialExcessDayView({
    date,
    asOfDate: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate ?? null,
    uses: d.specialExcessUses ?? [],
  });
}

function bankOf(date: string) {
  const d = getAppData();
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(date),
    asOfDate: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate ?? null,
    uses: d.specialExcessUses ?? [],
  });
}

/* ── A–G: máximo dinâmico por origem (derivação pura do modal) ───────── */

check("A. need30 + origem de 30 → máximo permitido 30 (permite completar)", () => {
  assert.equal(manualMaxForOrigin(30, 30, 0), 30);
});

check("B. need30 + origem de 40 → máximo 30 (não pode lançar 40)", () => {
  assert.equal(manualMaxForOrigin(40, 30, 0), 30);
  assert.equal(manualMaxForOrigin(40, 30, 0) < 40, true, "40 é bloqueado");
});

check("C. need30 + origem de 60 → máximo 30 (não pode lançar 60)", () => {
  assert.equal(manualMaxForOrigin(60, 30, 0), 30);
});

check("D. selecionado 10 → outras origens podem receber no máximo 20", () => {
  assert.equal(manualMaxForOrigin(60, 30, 10), 20, "20/08 com 60 disponíveis → 20");
  assert.equal(manualMaxForOrigin(30, 30, 10), 20, "28/08 com 30 disponíveis → 20");
});

check("E. total 30 (10+20) → qualquer outra origem fica sem capacidade (0)", () => {
  const total = 10 + 20;
  assert.equal(manualRemainingAfterSelection(30, total), 0);
  assert.equal(manualMaxForOrigin(30, 30, total), 0, "28/08 não aceita mais nada");
  assert.equal(manualMaxForOrigin(40, 30, total), 0);
});

check("F. reduzir uma origem libera capacidade imediatamente (20→10 → outras até 10)", () => {
  const totalAposReducao = 10 + 10;
  assert.equal(manualMaxForOrigin(30, 30, totalAposReducao), 10, "28/08 volta a aceitar 10");
  assert.equal(manualRemainingAfterSelection(30, totalAposReducao), 10);
});

check("G. desmarcar origem devolve a capacidade às demais", () => {
  assert.equal(manualMaxForOrigin(30, 30, 0), 30, "tudo desmarcado → 30 de novo");
  assert.equal(manualMaxForOrigin(30, 30, 10), 20, "desmarcou uma das duas → 20");
});

check("H-estrutural. nunca negativo e nunca acima da disponibilidade da origem", () => {
  assert.equal(manualMaxForOrigin(15, 30, 0), 15, "respeita o lote pequeno");
  assert.equal(manualMaxForOrigin(60, 30, 90), 0, "seleção impossível → 0, nunca negativo");
  for (const available of [0, 15, 30, 60]) {
    for (const need of [0, 15, 30, 60]) {
      for (const others of [0, 10, 30, 90]) {
        const m = manualMaxForOrigin(available, need, others);
        assert.ok(m >= 0 && m <= available, `max ${m} dentro de [0, ${available}]`);
      }
    }
  }
});

/* ── H/I/J/K: GATE PERSISTENTE (action 3D — já existia; comprovado) ──── */

resetSeed();

check("H. store REJEITA seleção manual de 40min para need 30 (camada persistente)", () => {
  const res = actions.createSpecialExcessUse({
    destinationDate: DEST,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-18", minutes: 40 }],
    asOfDate: ASOF,
    now: 1000,
  });
  assert.equal(res.ok, false, "40min > need 30 deve ser rejeitado");
  assert.equal(res.code, "requested-exceeds-destination-need");
});

check("I. store REJEITA seleção manual de 60min para need 30", () => {
  const res = actions.createSpecialExcessUse({
    destinationDate: DEST,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 60 }],
    asOfDate: ASOF,
    now: 1001,
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "requested-exceeds-destination-need");
});

check("J. store REJEITA seleção manual de 2h10 (40+60+30) para need 30", () => {
  const res = actions.createSpecialExcessUse({
    destinationDate: DEST,
    allocationStrategy: "manual",
    manualAllocations: [
      { originDate: "2026-08-18", minutes: 40 },
      { originDate: "2026-08-20", minutes: 60 },
      { originDate: "2026-08-28", minutes: 30 },
    ],
    asOfDate: ASOF,
    now: 1002,
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "requested-exceeds-destination-need");
});

check("K. atomicidade: rejeições NÃO consumiram banco nem criaram uso parcial", () => {
  const d = getAppData();
  assert.equal((d.specialExcessUses ?? []).length, 0, "nenhum uso criado");
  const bank = bankOf(DEST);
  assert.equal(bank.generatedMinutes, 130, "gerado intacto");
  assert.equal(bank.usedMinutes, 0, "nada consumido");
  assert.equal(bank.availableMinutes, 130, "disponível intacto");
});

/* ── M: origem posterior continua válida (regra preservada) ──────────── */

check("M. origem POSTERIOR 28/08 → 30min para destino 24/08 continua válida", () => {
  const res = actions.createSpecialExcessUse({
    destinationDate: DEST,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
    asOfDate: ASOF,
    now: 1003,
  });
  assert.equal(res.ok, true, `origem posterior válida falhou: ${res.error}`);
  const uses = getAppData().specialExcessUses ?? [];
  assert.equal(uses.length, 1);
  assert.deepEqual(uses[0].allocations, [{ originDate: "2026-08-28", minutes: 30 }]);
  const bank = bankOf(DEST);
  assert.equal(bank.usedMinutes, 30, "uso legítimo consumiu 30");
  assert.equal(bank.availableMinutes, 100);
});

/* ── L: projeção continua limitada e intacta (motor 3A) ──────────────── */

check("L. projeção (3A) continua limitando: uso 60 em need 30 → aplica 30, sinaliza excesso", () => {
  const proj = projectRealizedDayOfficial({
    date: DEST,
    factualWorkedMinutes: 450,
    factualRegistrableMinutes: 450,
    factualRegularBalanceMinutes: -30,
    effectiveBaseMinutes: 480,
    financialValid: true,
    realized: true,
    usedSpecialMinutes: 60,
  });
  assert.equal(proj.appliedSpecialMinutes, 30, "aplica só o necessário");
  assert.equal(proj.projectedWorkedMinutes, 480, "projeção 8h");
  assert.equal(proj.projectedBalanceMinutes, 0, "saldo projetado 0 (nunca crédito artificial)");
  assert.equal(proj.excessUsedMinutes, 30);
  assert.equal(proj.needsReview, true, "excesso é sinalizado");
});

/* ── N: FIFO automático intacto ──────────────────────────────────────── */

resetSeed();

check("N. FIFO automático continua intacto (origens mais antigas primeiro)", () => {
  const view = dayViewOf("2026-08-26"); // need 60
  assert.equal(view.remainingMinutes, 60);
  const fifo = allocateSpecialExcessFifo({ bank: view.bank, destinationDate: "2026-08-26", requestedMinutes: 30 });
  assert.equal(fifo.error, undefined);
  assert.deepEqual(fifo.allocations, [{ originDate: "2026-08-18", minutes: 30 }], "mais antiga primeiro — sem mudança");
  const res = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1100 });
  assert.equal(res.ok, true);
});

/* ── O: 3G.1 preservado (restante manual) ────────────────────────────── */

resetSeed();

check("O. 3G.1 preservado: restante manual continua correto (30/0, 30/30, 30/15)", () => {
  const view = dayViewOf(DEST);
  assert.equal(view.remainingMinutes, 30, "need antes da seleção");
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 0), 30);
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 15), 15);
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 30), 0);
});

check("O-integração. need do day-view APÓS uso ativo alimenta o máximo dinâmico", () => {
  const view = dayViewOf(DEST); // 24/08 sem uso ativo
  // Com 28/08→30 selecionado numa origem qualquer, outras origens ficam a 0:
  assert.equal(manualMaxForOrigin(60, view.remainingMinutes, 30), 0);
  // Com seleção de 10 numa origem, as demais aceitam até 20 (caso D real):
  assert.equal(manualMaxForOrigin(60, view.remainingMinutes, 10), 20);
  assert.equal(view.maxUsableMinutes, 30, "maxUsable do day-view intacto");
});

/* ── Estrutural: modal trava por origem e avisa ao digitar acima ─────── */

check("Modal. máximo dinâmico por campo + bloqueio visual + aviso 'Máximo disponível...'", () => {
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(modal.includes("manualMaxForOrigin(lot.availableMinutes, view.remainingMinutes, manualTotal - sel)"), "máximo dinâmico usa a derivação pura");
  assert.ok(/max=\{maxForThisOrigin\}/.test(modal), "atributo max dinâmico no input");
  assert.ok(modal.includes("disabled={blocked}"), "checkbox desabilitado quando a necessidade já está completa");
  assert.ok(modal.includes("opacity-50"), "bloqueio visualmente claro");
  assert.ok(modal.includes("Máximo disponível para esta seleção:"), "aviso curto quando digita acima");
  assert.ok(!/max=\{lot\.availableMinutes\}/.test(modal), "máximo antigo (só disponibilidade) removido");
  // Gate persistente não foi duplicado na UI (store continua a fonte):
  const store = src("src/lib/store.ts");
  assert.ok(store.includes("requested-exceeds-destination-need"), "gate persistente presente no store");
});

console.log(`\n${passed} verificações 3G.2 passaram.`);
