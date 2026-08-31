/**
 * VERIFICAÇÃO — ETAPA 3G: RECONCILIAÇÃO DO [10+] APÓS ALTERAÇÃO DA JORNADA FACTUAL
 *
 * BUG corrigido: usar [10+] num destino e DEPOIS alterar as batidas do dia
 * (ex.: 7h → 8h) deixava o uso ativo consumindo o banco sem necessidade.
 * REGRA-MÃE: ACTIVE_SPECIAL_USED ≤ NEEDED_TO_BASE (regra 3A) no estado
 * PROSPECTIVO do dia, após confirmação humana (nunca silenciosa).
 *
 * Seções:
 *   A–G   helper puro (plano: release/keep/reduce/cancel; não aumenta uso)
 *   H–L   histórico (cancelamento preservado; parcial cria versão ativa)
 *   M–R   allocations (prefixo histórico; fifo/manuial; sem origem nova)
 *   S–W   confirmação (não persiste; Voltar = nada; confirmar = coeso)
 *   Bug real   7h → 8h (§37) · Parcial real 7h → 7h30 (§38) · Sem mudança (§39)
 *   §24 não aumenta uso · §25 cancelados · §26 outros dias · §40 transitório
 *
 * Números do seed 4.0: banco 130min (18/08 40 · 20/08 60 · 28/08 30).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-reconciliacao-3g.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { planSpecialExcessReconciliation, type SpecialReconciliationPlan } from "../src/lib/special-excess-reconciliation.ts";
import { specialExcessUseMinutes, type SpecialExcessUse } from "../src/lib/special-excess-use.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { projectRealizedDayOfficial, isProjectableDayStatus } from "../src/lib/official-projection.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30"; // hoje do cenário (TZ=America/Sao_Paulo)
const DEST = "2026-08-26";
const NOW = 1_700_000_000_000;

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function resetStore() {
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

const d = () => getAppData();

function bankOf() {
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(DEST),
    asOfDate: ASOF,
    entries: d().entries,
    absences: d().absences,
    calendars: d().companyCalendars,
    settings: settingsOf(d().user),
    faltas: d().faltas,
    controlStartDate: d().user.controlStartDate ?? null,
    uses: d().specialExcessUses ?? [],
  });
}

function activeUsesOf(date: string): SpecialExcessUse[] {
  return (d().specialExcessUses ?? []).filter((u) => u.destinationDate === date && u.status === "utilizado");
}

function activeMinutesOf(date: string): number {
  return activeUsesOf(date).reduce((s, u) => s + specialExcessUseMinutes(u), 0);
}

const entryOf = (date: string, time: string): TimeEntry => {
  const e = d().entries.find((x) => x.date === date && x.time === time);
  assert.ok(e, `batida ${date} ${time} presente`);
  return e;
};

/** Uso sintético para os testes do helper puro. */
const syntheticUse = (id: string, createdAt: number, allocations: Array<{ originDate: string; minutes: number }>): SpecialExcessUse => ({
  id,
  destinationDate: DEST,
  allocations,
  allocationStrategy: "fifo",
  status: "utilizado",
  createdAt,
});

/** Projeção 3A do dia 26/08 com o estado REAL do store (fatos derivados). */
function projection26() {
  const dd = d();
  const row = buildResumoDayRow({
    date: DEST,
    today: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
  });
  return projectRealizedDayOfficial({
    date: DEST,
    factualWorkedMinutes: row.workedMinutes,
    factualRegistrableMinutes: row.registrableMinutes,
    factualRegularBalanceMinutes: row.balanceContribution,
    effectiveBaseMinutes: row.expectedMinutes,
    financialValid: isProjectableDayStatus(row.status),
    realized: true,
    usedSpecialMinutes: activeMinutesOf(DEST),
  });
}

/* ══════════════ A–G: HELPER PURO (plano) ══════════════ */

const use60 = [syntheticUse("u1", 1000, [{ originDate: "2026-08-18", minutes: 40 }, { originDate: "2026-08-20", minutes: 20 }])];
const use30 = [syntheticUse("u1", 1000, [{ originDate: "2026-08-18", minutes: 30 }])];

check("A. 7h + used60 → prospectivo 8h: release 60 (liberação total)", () => {
  const plan = planSpecialExcessReconciliation({
    destinationDate: DEST,
    prospectiveStatus: "ok",
    prospectiveWorkedMinutes: 480,
    prospectiveBaseMinutes: 480,
    prospectiveRegistrableMinutes: 480,
    uses: use60,
  });
  assert.equal(plan.activeUsedMinutesBefore, 60);
  assert.equal(plan.neededMinutesAfter, 0);
  assert.equal(plan.allowedUsedMinutesAfter, 0);
  assert.equal(plan.releaseMinutes, 60);
  assert.equal(plan.needsReconciliation, true);
  assert.deepEqual(plan.decisions.map((x) => x.action), ["cancel"]);
});

check("B. 7h + used60 → prospectivo 7h30: keep 30 / release 30 (reduce com prefixo)", () => {
  const plan = planSpecialExcessReconciliation({
    destinationDate: DEST,
    prospectiveStatus: "deficit",
    prospectiveWorkedMinutes: 450,
    prospectiveBaseMinutes: 480,
    prospectiveRegistrableMinutes: 450,
    uses: use60,
  });
  assert.equal(plan.neededMinutesAfter, 30);
  assert.equal(plan.allowedUsedMinutesAfter, 30);
  assert.equal(plan.releaseMinutes, 30);
  assert.equal(plan.needsReconciliation, true);
  assert.equal(plan.decisions.length, 1);
  const dec = plan.decisions[0];
  assert.equal(dec.action, "reduce");
  if (dec.action === "reduce") {
    assert.deepEqual(dec.keepAllocations, [{ originDate: "2026-08-18", minutes: 30 }]);
    assert.deepEqual(dec.releasedAllocations, [
      { originDate: "2026-08-18", minutes: 10 },
      { originDate: "2026-08-20", minutes: 20 },
    ]);
  }
});

check("C. 7h + used30 → prospectivo 7h30: release 0 — sem reconciliação", () => {
  const plan = planSpecialExcessReconciliation({
    destinationDate: DEST,
    prospectiveStatus: "deficit",
    prospectiveWorkedMinutes: 450,
    prospectiveBaseMinutes: 480,
    prospectiveRegistrableMinutes: 450,
    uses: use30,
  });
  assert.equal(plan.neededMinutesAfter, 30);
  assert.equal(plan.activeUsedMinutesBefore, 30);
  assert.equal(plan.releaseMinutes, 0);
  assert.equal(plan.needsReconciliation, false);
  assert.deepEqual(plan.decisions.map((x) => x.action), ["keep"]);
});

check("D. 7h30 + used30 → prospectivo 7h: release 0 — NÃO aumenta o uso", () => {
  const plan = planSpecialExcessReconciliation({
    destinationDate: DEST,
    prospectiveStatus: "deficit",
    prospectiveWorkedMinutes: 420,
    prospectiveBaseMinutes: 480,
    prospectiveRegistrableMinutes: 420,
    uses: use30,
  });
  assert.equal(plan.neededMinutesAfter, 60, "necessidade subiu para 1h");
  assert.equal(plan.allowedUsedMinutesAfter, 30, "uso permanece 30min (nunca usa mais sozinho)");
  assert.equal(plan.releaseMinutes, 0);
  assert.equal(plan.needsReconciliation, false);
});

check("E. regra-mãe: uso permitido pós-plano NUNCA excede a necessidade (varredura)", () => {
  const cases: Array<{ status: "deficit" | "ok"; registrable: number; uses: SpecialExcessUse[] }> = [
    { status: "deficit", registrable: 420, uses: use60 },
    { status: "deficit", registrable: 450, uses: use60 },
    { status: "ok", registrable: 480, uses: use60 },
    { status: "deficit", registrable: 420, uses: [syntheticUse("a", 1, [{ originDate: "2026-08-18", minutes: 20 }]), syntheticUse("b", 2, [{ originDate: "2026-08-20", minutes: 40 }])] },
    { status: "deficit", registrable: 465, uses: [syntheticUse("a", 1, [{ originDate: "2026-08-18", minutes: 15 }]), syntheticUse("b", 2, [{ originDate: "2026-08-20", minutes: 30 }])] },
  ];
  for (const c of cases) {
    const plan = planSpecialExcessReconciliation({
      destinationDate: DEST,
      prospectiveStatus: c.status,
      prospectiveWorkedMinutes: c.registrable,
      prospectiveBaseMinutes: 480,
      prospectiveRegistrableMinutes: c.registrable,
      uses: c.uses,
    });
    const need = Math.max(0, 480 - c.registrable);
    assert.ok(plan.allowedUsedMinutesAfter <= need, `allowed ${plan.allowedUsedMinutesAfter} ≤ need ${need}`);
    assert.ok(plan.allowedUsedMinutesAfter <= plan.activeUsedMinutesBefore, "nunca usa mais do que já usava");
    const keptActive = plan.decisions.reduce((s, dec) => s + dec.keepAllocations.reduce((k, a) => k + a.minutes, 0), 0);
    assert.equal(keptActive, plan.allowedUsedMinutesAfter, "ativo pós-plano = permitido");
  }
});

check("F. usos CANCELADOS não participam do plano", () => {
  const cancelled: SpecialExcessUse = { ...use30[0], id: "velho", status: "cancelado", cancelledAt: 1, allocations: [{ originDate: "2026-08-18", minutes: 90 }] };
  const plan = planSpecialExcessReconciliation({
    destinationDate: DEST,
    prospectiveStatus: "ok",
    prospectiveWorkedMinutes: 480,
    prospectiveBaseMinutes: 480,
    prospectiveRegistrableMinutes: 480,
    uses: [cancelled, ...use60],
  });
  assert.equal(plan.activeUsedMinutesBefore, 60, "cancelado não conta");
  assert.equal(plan.releaseMinutes, 60);
  assert.ok(!plan.decisions.some((x) => x.useId === "velho"), "cancelado nunca é reativado/editado");
});

check("G. usos de OUTRO destinationDate são ignorados", () => {
  const otherDay: SpecialExcessUse = { ...use60[0], id: "outro", destinationDate: "2026-08-24" };
  const plan = planSpecialExcessReconciliation({
    destinationDate: DEST,
    prospectiveStatus: "ok",
    prospectiveWorkedMinutes: 480,
    prospectiveBaseMinutes: 480,
    prospectiveRegistrableMinutes: 480,
    uses: [otherDay],
  });
  assert.equal(plan.activeUsedMinutesBefore, 0);
  assert.equal(plan.needsReconciliation, false);
  assert.equal(plan.decisions.length, 0);
});

/* ══════════════ §37: BUG REAL — 7h → 8h ══════════════ */

resetStore();
const created = actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 });
assert.ok(created.ok, `criação do uso falhou: ${created.error}`);

check("§37.a banco antes da edição: usado 60 / disponível 70", () => {
  const bank = bankOf();
  assert.equal(bank.generatedMinutes, 130);
  assert.equal(bank.usedMinutes, 60);
  assert.equal(bank.availableMinutes, 70);
});

let plan37: SpecialReconciliationPlan | undefined;
const saida16 = entryOf(DEST, "16:00");
check("§37.b S/T. editar 16:00→17:00 NÃO persiste: devolve plano exigindo liberação 60", () => {
  const res = actions.updateEntry(saida16.id, { time: "17:00" });
  assert.equal(res.ok, false, "operação não é aplicada sem confirmação");
  assert.equal(res.code, "special-release-required");
  assert.ok(res.specialReleases?.length === 1, "um plano para o dia 26/08");
  plan37 = res.specialReleases?.[0];
  assert.equal(plan37?.destinationDate, DEST);
  assert.equal(plan37?.prospectiveWorkedMinutes, 480, "prospectivo: 8h");
  assert.equal(plan37?.neededMinutesAfter, 0);
  assert.equal(plan37?.releaseMinutes, 60);
  assert.equal(plan37?.activeUsedMinutesBefore, 60);
});

check("§37.c U. estado INTACTO após a tentativa não confirmada (Voltar não muda nada)", () => {
  assert.equal(entryOf(DEST, "16:00").time, "16:00", "batida intacta");
  assert.equal(activeMinutesOf(DEST), 60, "uso ativo intacto");
  const bank = bankOf();
  assert.equal(bank.usedMinutes, 60, "banco intacto");
  assert.equal(bank.availableMinutes, 70, "banco intacto");
});

check("§37.d V/W. confirmação aplica batidas + reconciliação NO MESMO frame (coeso)", () => {
  const res = actions.updateEntry(saida16.id, { time: "17:00" }, { specialReleaseConfirmed: true, now: NOW });
  assert.equal(res.ok, true, `confirmação falhou: ${res.error}`);
  const snap = d(); // UM snapshot — não existe frame com factual novo + uso antigo
  const e17 = snap.entries.find((x) => x.id === saida16.id);
  assert.equal(e17?.time, "17:00", "factual novo aplicado");
  const uses = snap.specialExcessUses ?? [];
  assert.equal(uses.filter((u) => u.destinationDate === DEST && u.status === "utilizado").length, 0, "nenhum uso ativo restante no MESMO snapshot");
  assert.equal(uses.filter((u) => u.destinationDate === DEST && u.status === "cancelado").length, 1, "uso original no histórico");
});

check("§37.e H. histórico: uso original permanece CANCELADO com allocations/strategy/createdAt", () => {
  const hist = (d().specialExcessUses ?? []).find((u) => u.destinationDate === DEST);
  assert.ok(hist);
  assert.equal(hist.status, "cancelado");
  assert.equal(hist.cancelledAt, NOW);
  assert.equal(hist.updatedAt, NOW);
  assert.deepEqual(hist.allocations, [{ originDate: "2026-08-18", minutes: 40 }, { originDate: "2026-08-20", minutes: 20 }], "allocations antigas preservadas");
  assert.equal(hist.allocationStrategy, "fifo");
  assert.equal(hist.createdAt, 1000, "createdAt preservado");
  assert.equal(hist.id, "seu-1", "id antigo preservado");
});

check("§37.f estado final do bug: 8h / saldo 0 / uso ativo 0", () => {
  const v = buildResumoPeriodView({
    period: { from: "2026-08-21", to: "2026-09-20" },
    today: ASOF,
    entries: d().entries,
    absences: d().absences,
    calendars: d().companyCalendars,
    settings: settingsOf(d().user),
    faltas: d().faltas,
    controlStartDate: d().user.controlStartDate ?? null,
    uses: d().specialExcessUses ?? [],
  });
  const r26 = v.days.find((x) => x.day.date === DEST)!;
  assert.equal(r26.day.workedMinutes, 480, "Trabalhado 8h");
  assert.equal(r26.day.balanceMinutes, 0, "Saldo regular 0");
  assert.equal(r26.specialUsed, 0, "[10+] utilizado caiu a zero");
  assert.equal(r26.projection.appliedSpecialMinutes, 0);
  assert.equal(r26.projection.projectedWorkedMinutes, 480, "Projeção 8h");
  assert.equal(r26.projection.projectedBalanceMinutes, 0, "Projeção saldo 0");
});

check("§37.g banco DEPOIS da reconciliação total: gerado 130 / usado 0 / disponível 130", () => {
  const bank = bankOf();
  assert.equal(bank.generatedMinutes, 130);
  assert.equal(bank.usedMinutes, 0);
  assert.equal(bank.availableMinutes, 130);
});

/* ══════════════ §38/§21: PARCIAL REAL — 7h → 7h30 (60 → 30) ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("§38.a M/N. reduzir 60→30: versão ativa com PREFIXO histórico (18/08 30) — sem FIFO novo", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "16:30" }, { specialReleaseConfirmed: true, now: NOW });
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const active = activeUsesOf(DEST);
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-18", minutes: 30 }], "origem1 30min (prefixo do próprio uso)");
  assert.equal(active[0].allocationStrategy, "fifo", "Q. strategy fifo continua fifo");
  assert.ok(!active[0].allocations.some((a) => a.originDate === "2026-08-20"), "R. nenhuma origem nova/realocada");
});

check("§38.b I. histórico parcial: original 60min permanece cancelado + versão ativa 30min", () => {
  const uses = d().specialExcessUses ?? [];
  assert.equal(uses.length, 2, "original + reconciliado (nenhum apagado)");
  const original = uses.find((u) => u.id === "seu-1")!;
  assert.equal(original.status, "cancelado");
  assert.deepEqual(original.allocations, [{ originDate: "2026-08-18", minutes: 40 }, { originDate: "2026-08-20", minutes: 20 }], "histórico demonstra os 60min originais");
  const reconciled = uses.find((u) => u.id !== "seu-1")!;
  assert.equal(reconciled.status, "utilizado");
  assert.equal(specialExcessUseMinutes(reconciled), 30);
});

check("§38.c estado final parcial: 7h30 / -30min / uso ativo 30 / projeção 8h e 0", () => {
  assert.equal(entryOf(DEST, "16:30").time, "16:30");
  const v = buildResumoPeriodView({
    period: { from: "2026-08-21", to: "2026-09-20" },
    today: ASOF,
    entries: d().entries,
    absences: d().absences,
    calendars: d().companyCalendars,
    settings: settingsOf(d().user),
    faltas: d().faltas,
    controlStartDate: d().user.controlStartDate ?? null,
    uses: d().specialExcessUses ?? [],
  });
  const r26 = v.days.find((x) => x.day.date === DEST)!;
  assert.equal(r26.day.workedMinutes, 450, "7h30");
  assert.equal(r26.day.balanceMinutes, -30);
  assert.equal(r26.specialUsed, 30);
  assert.equal(r26.projection.appliedSpecialMinutes, 30);
  assert.equal(r26.projection.projectedWorkedMinutes, 480, "projeção 8h");
  assert.equal(r26.projection.projectedBalanceMinutes, 0, "saldo projetado 0");
});

check("§38.d banco parcial: usado 30 / disponível 100 (1h40)", () => {
  const bank = bankOf();
  assert.equal(bank.usedMinutes, 30);
  assert.equal(bank.availableMinutes, 100);
});

/* ══════════════ §39: SEM ALTERAÇÃO NECESSÁRIA (7h + 30 → 7h30) ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("§39. need final 30 = used 30: SEM confirmação, uso intacto, nenhuma devolução", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "16:30" });
  assert.equal(res.ok, true, `não deveria pedir confirmação: ${res.code ?? ""} ${res.error ?? ""}`);
  const uses = d().specialExcessUses ?? [];
  assert.equal(uses.length, 1, "nenhuma versão nova criada");
  assert.equal(uses[0].id, "seu-1");
  assert.equal(uses[0].status, "utilizado");
  assert.deepEqual(uses[0].allocations, [{ originDate: "2026-08-18", minutes: 30 }], "uso exatamente igual");
  const bank = bankOf();
  assert.equal(bank.usedMinutes, 30);
  assert.equal(bank.availableMinutes, 100);
});

/* ══════════════ §24: NECESSIDADE AUMENTA — nunca usa mais sozinho ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("§24. 7h30 + used30 → 7h: need 60, uso permanece 30 (sem auto-completar)", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "15:30" });
  assert.equal(res.ok, true, `sem gate esperado: ${res.code ?? ""}`);
  assert.equal(activeMinutesOf(DEST), 30, "uso intacto");
  const bank = bankOf();
  assert.equal(bank.usedMinutes, 30, "banco não consumiu mais nada");
});

/* ══════════════ §34 J/K: MÚLTIPLOS USOS NO MESMO DESTINO ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 2000 }).ok);

check("J. múltiplos usos 30+30, need 30: mais ANTIGO fica; mais novo é cancelado", () => {
  assert.equal(activeMinutesOf(DEST), 60);
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "16:30" }, { specialReleaseConfirmed: true, now: NOW });
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const uses = d().specialExcessUses ?? [];
  const first = uses.find((u) => u.id === "seu-1")!;
  const second = uses.find((u) => u.id === "seu-2")!;
  assert.equal(first.status, "utilizado", "uso mais antigo permanece");
  assert.equal(specialExcessUseMinutes(first), 30);
  assert.equal(second.status, "cancelado", "uso mais novo cancelado por inteiro");
  assert.equal(second.cancelledAt, NOW);
  assert.equal(activeMinutesOf(DEST), 30);
  assert.equal(uses.filter((u) => u.status === "utilizado").length, 1, "L. nenhum uso ativo duplicado além do limite");
});

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 20, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 40, allocationStrategy: "fifo", asOfDate: ASOF, now: 2000 }).ok);

check("K. múltiplos usos 20+40, need 30: 20 antigo fica; segundo é reconciliado para 10", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "16:30" }, { specialReleaseConfirmed: true, now: NOW });
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const uses = d().specialExcessUses ?? [];
  const first = uses.find((u) => u.id === "seu-1")!;
  assert.equal(first.status, "utilizado", "20 antigo permanece intocado");
  assert.deepEqual(first.allocations, [{ originDate: "2026-08-18", minutes: 20 }]);
  const secondOriginal = uses.find((u) => u.id === "seu-2")!;
  assert.equal(secondOriginal.status, "cancelado");
  const reconciled = uses.find((u) => u.status === "utilizado" && u.id !== "seu-1")!;
  assert.equal(specialExcessUseMinutes(reconciled), 10, "segundo reconciliado para 10min");
  assert.equal(activeMinutesOf(DEST), 30, "ativo total = 30");
});

/* ══════════════ §35: ALLOCAÇÕES — prefixo / manual / sem origem nova ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("N. FIFO 40+20 reduzido para 45: ativo = origem1 40 + origem2 5", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "16:15" }, { specialReleaseConfirmed: true, now: NOW });
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const active = activeUsesOf(DEST);
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 5 },
  ], "§18: prefixo na ordem registrada; libera 15 de B");
});

resetStore();
assert.ok(
  actions.createSpecialExcessUse({
    destinationDate: DEST,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
    asOfDate: ASOF,
    now: 1000,
  }).ok,
);

check("O/P/R. manual 30 reduzido para 15: continua 28/08 15min e CONTINUA manual", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "16:45" }, { specialReleaseConfirmed: true, now: NOW });
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const active = activeUsesOf(DEST);
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].allocations, [{ originDate: "2026-08-28", minutes: 30 }].map((a) => ({ ...a, minutes: 15 })), "origem manual preservada, 15min");
  assert.equal(active[0].allocationStrategy, "manual", "P. strategy manual continua manual");
  assert.ok(!active[0].allocations.some((a) => a.originDate !== "2026-08-28"), "R. não trocou para origem mais antiga (nada de FIFO novo)");
});

/* ══════════════ §25: USOS CANCELADOS FORA DA RECONCILIAÇÃO ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);
assert.ok(actions.cancelSpecialExcessUse({ id: "seu-1", now: 1500 }).ok);

check("§25. uso cancelado: editar o destino NÃO pede confirmação e NÃO reativa", () => {
  const res = actions.updateEntry(entryOf(DEST, "16:00").id, { time: "17:00" });
  assert.equal(res.ok, true, `esperava edição direta: ${res.code ?? ""} ${res.error ?? ""}`);
  const uses = d().specialExcessUses ?? [];
  assert.equal(uses.length, 1);
  assert.equal(uses[0].status, "cancelado", "permanece cancelado");
  assert.equal(uses[0].cancelledAt, 1500, "cancelamento original intacto");
  assert.equal(activeMinutesOf(DEST), 0);
});

/* ══════════════ §26: OUTROS DIAS NÃO SÃO AFETADOS ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("§26. editar 25/08 não toca nos usos de 26/08 (reconciliação por destinationDate)", () => {
  const res = actions.updateEntry(entryOf("2026-08-25", "17:00").id, { time: "17:30" });
  assert.equal(res.ok, true, `esperava edição direta: ${res.code ?? ""} ${res.error ?? ""}`);
  assert.equal(activeMinutesOf(DEST), 60, "uso de 26/08 intacto");
  const bank = bankOf();
  assert.equal(bank.usedMinutes, 60);
  assert.equal(bank.availableMinutes, 70);
});

/* ══════════════ §40: ESTADOS TRANSITÓRIOS (correção multi-etapa) ══════════════ */

resetStore();
assert.ok(actions.createSpecialExcessUse({ destinationDate: DEST, minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("§40.a excluir batida deixa o dia INCOMPLETO: uso [10+] NÃO é cancelado", () => {
  const res = actions.deleteEntry(entryOf(DEST, "16:00").id);
  assert.equal(res.ok, true, `exclusão deveria passar sem gate: ${res.code ?? ""} ${res.error ?? ""}`);
  assert.equal(activeMinutesOf(DEST), 30, "uso preservado no estado transitório");
  const proj = projection26();
  assert.equal(proj.projectable, false, "dia deixou de ser projetável (incompleto)");
});

check("§40.b dia INCONSISTENTE no meio da correção: uso [10+] segue intacto", () => {
  const res = actions.deleteEntry(entryOf(DEST, "12:00").id);
  assert.equal(res.ok, true);
  assert.equal(activeMinutesOf(DEST), 30, "nada destruído em estado intermediário");
});

check("§40.c fim da correção multi-etapa (dia válido 7h de novo): uso 30 preservado", () => {
  assert.ok(actions.addEntry({ date: DEST, time: "12:00", type: "saida", note: null, source: "manual" }).ok);
  assert.equal(activeMinutesOf(DEST), 30);
  const res = actions.addEntry({ date: DEST, time: "16:00", type: "saida", note: null, source: "manual" });
  assert.equal(res.ok, true, `última batida sem gate: ${res.code ?? ""} ${res.error ?? ""}`);
  assert.equal(entryOf(DEST, "16:00").time, "16:00", "dia reconstituído: 7h");
  assert.equal(activeMinutesOf(DEST), 30, "uso intacto (need 30 = used 30)");
  const uses = d().specialExcessUses ?? [];
  assert.equal(uses.filter((u) => u.status === "cancelado").length, 0, "nenhuma reconciliação destrutiva aconteceu no caminho");
});

/* ══════════════ Confirmação na UI: wiring estrutural ══════════════ */

check("UI. provider único montado no layout; diálogo com Voltar/Continuar; sem jargão técnico", () => {
  const layout = src("src/app/layout.tsx");
  assert.ok(layout.includes("<SpecialReleaseProvider>"), "provider 3G no layout raiz");
  const dialog = src("src/components/special-release-confirm.tsx");
  assert.ok(/Voltar<\/?Button>|Voltar\s*<\/Button>/s.test(dialog) || dialog.includes("Voltar"), "ação Voltar");
  assert.ok(dialog.includes("Continuar e ajustar [10+]"), "ação de confirmação");
  assert.ok(dialog.includes("specialReleaseConfirmed: true"), "re-invoca o MESMO action com confirmação");
  assert.ok(dialog.includes("special-release-cancelled"), "Voltar devolve código de aborto");
  // §29: sem jargão técnico no TEXTO RENDERIZADO (identificadores/comentários
  // do código não são interface):
  {
    const rendered = dialog.match(/>[^<>]+</g) ?? [];
    for (const chunk of rendered) {
      for (const term of ["reconciliation", "Reconciliation", "allocation", "FIFO"]) {
        assert.ok(!chunk.includes(term), `sem jargão técnico na interface: ${term} em ${chunk}`);
      }
    }
  }
  for (const label of ["Nova jornada", "[10+] utilizado atualmente", "[10+] necessário após a alteração", "Voltará ao banco"]) {
    assert.ok(dialog.includes(label), `linha do resumo: ${label}`);
  }
});

check("UI. todos os caminhos de batida passam pelo gate (nenhum actions.* direto na UI)", () => {
  for (const f of [
    "src/app/(app)/page.tsx",
    "src/app/(app)/registros/page.tsx",
    "src/components/day-card.tsx",
    "src/components/correct-punches-modal.tsx",
    "src/components/manual-entry-modal.tsx",
    "src/components/fill-day-records-modal.tsx",
  ]) {
    const s = src(f);
    assert.ok(!/actions\.(addEntry|addEntries|updateEntry|deleteEntry)\(/.test(s), `${f} sem chamada direta`);
  }
});

check("Store. liberação nunca é silenciosa e nunca apaga histórico (estrutura)", () => {
  const store = src("src/lib/store.ts");
  assert.ok(store.includes("special-release-required"), "código do gate");
  assert.ok(store.includes("specialReleaseConfirmed"), "confirmação explícita");
  assert.ok(!store.includes("specialExcessUses: (d.specialExcessUses ?? []).filter"), "nunca filtra (apaga) usos");
});

console.log(`\n${passed} verificações 3G passaram.`);
