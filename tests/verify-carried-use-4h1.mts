/**
 * VERIFICAÇÃO — ETAPA 4H.1: USO DO SALDO [10+] TRANSPORTADO.
 *
 * Regressão corrigida: o saldo formalmente TRANSPORTADO do ciclo anterior
 * existe no banco canônico (buildSpecialExcessBank com `carried`) e na
 * Central, mas sumia do pipeline operacional do modal de uso — o
 * day-view/modal construíam um banco SEM `carried`, mostrando apenas a
 * geração factual do ciclo. Store (specialBankOf) já consumia o trazido.
 *
 * Cenário padrão (reproduz o bug manual):
 *   · ciclo 2025/2026 encerrado: 90min [10+] TRANSPORTADOS para 2026/2027,
 *     origem factual original 28/04/2026;
 *   · no ciclo 2026/2027, dia 05/05 gera +90min [10+] factuais;
 *   · dia 06/05, jornada 7h30 ⇒ necessidade de 30min.
 *
 * Resultado correto: Disponível 180min; FIFO consome PRIMEIRO 28/04
 * (idade cronológica original), nunca reseta para 01/05/fechamento.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-carried-use-4h1.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData } from "../src/lib/store.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSpecialExcessBank, allocateSpecialExcessFifo } from "../src/lib/special-excess-bank.ts";
import { carriedSlicesIntoCycle, closureForCycle } from "../src/lib/annual-cycle-closure.ts";
import { getAnnualPointCycle, getPointPeriod } from "../src/lib/periods.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};

let nextId = 1;
const p = (d: string, t: string, ty: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date: d, time: t, type: ty, note: null });

/** Closure 2025/2026 → carried 90min com origem factual original 2026-04-28. */
const CARRIED_90 = {
  id: "acc-2025-2026", cycleLabel: "2025/2026", cycleStart: "2025-05-01", cycleEnd: "2026-04-30",
  status: "closed" as const, closedAt: 1, periodConsolidationIds: [] as number[],
  closingSpecialExcessMinutes: 90, disposition: "carried" as const, destinationCycleStart: "2026-05-01",
  sourceSlices: [{ originalOriginDate: "2026-04-28", minutes: 90, originCycle: "2025/2026", provenance: "Transportado do ciclo 2025/2026" }],
  note: null as string | null,
};

function state(withClosure: boolean): Record<string, unknown> {
  const entries: TimeEntry[] = [
    // 05/05: geração de +90min [10+] (jornada 11h30)
    p("2026-05-05", "08:00", "entrada"), p("2026-05-05", "12:00", "saida"),
    p("2026-05-05", "13:00", "entrada"), p("2026-05-05", "20:30", "saida"),
    // 06/05: jornada 7h30 → necessidade de 30min
    p("2026-05-06", "08:00", "entrada"), p("2026-05-06", "12:00", "saida"),
    p("2026-05-06", "13:00", "entrada"), p("2026-05-06", "16:30", "saida"),
  ];
  return {
    user: { id: 1, name: "t", email: "t@t", workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true, birthDate: null, controlStartDate: "2026-05-01" },
    entries,
    compensations: [], absences: [], companyCalendars: undefined, faltas: [], excessReasons: [],
    specialExcessUses: [], specialExcessPlans: [], periodConsolidations: [],
    annualCycleClosures: withClosure ? [CARRIED_90] : [],
  };
}
const reset = (withClosure = true) => {
  nextId = 1;
  actions.replaceAll(state(withClosure) as never);
};
const CYC = () => getAnnualPointCycle("2026-05-06"); // 2026/2027
const bankOf = () =>
  buildSpecialExcessBank({
    cycle: CYC(), asOfDate: "2026-09-03", entries: getAppData().entries, absences: [],
    calendars: getAppData().companyCalendars, settings: S, faltas: [], controlStartDate: "2026-05-01",
    uses: getAppData().specialExcessUses ?? [], plans: getAppData().specialExcessPlans ?? [],
    carried: carriedSlicesIntoCycle(getAppData().annualCycleClosures, CYC()),
  });
const dayView = () =>
  buildSpecialExcessDayView({
    date: "2026-05-06", asOfDate: "2026-09-03", entries: getAppData().entries, absences: [],
    calendars: getAppData().companyCalendars, settings: S, faltas: [], controlStartDate: "2026-05-01",
    uses: getAppData().specialExcessUses ?? [], plans: [],
    closures: getAppData().annualCycleClosures,
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── T01–T03 — capacidade canônica inclui o transportado ── */

check("T01 — carried 90min + geração atual 90min = Disponível operacional 180min", () => {
  reset();
  const b = bankOf();
  assert.equal(b.carriedMinutes, 90);
  assert.equal(b.generatedMinutes, 90);
  assert.equal(b.availableMinutes, 180, "disponível = trazido 90 + gerado 90");
  assert.equal(b.lots.length, 2);
});

check("T02 — carried NÃO entra em 'Gerado neste ciclo'", () => {
  reset();
  const b = bankOf();
  assert.equal(b.generatedMinutes, 90, "gerado = 90 (só a geração factual 05/05)");
  assert.equal(b.carriedMinutes, 90, "trazido separado = 90");
});

check("T03 — modal/selector recebe 180min (day-view com closures), não apenas 90min", () => {
  reset();
  const v = dayView();
  assert.equal(v.bankAvailableMinutes, 180, "banco disponível visto pelo modal = 180");
  assert.equal(v.canComplete, true);
  assert.equal(v.remainingMinutes, 30, "necessidade do destino 06/05 = 30");
  assert.equal(v.maxUsableMinutes, 30, "máximo = min(necessidade 30, disponível 180)");
  assert.ok(v.lots.some((l) => l.originDate === "2026-04-28" && l.carried), "28/04 transportado presente como origem válida");
  assert.ok(v.lots.some((l) => l.originDate === "2026-05-05"), "05/05 gerado presente");
});

/* ── T04–T05 — FIFO/preview usam a origem cronológica original ── */

check("T04 — FIFO automático p/ destino 06/05 escolhe 28/04 (idade original, não 01/05)", () => {
  reset();
  const r = allocateSpecialExcessFifo({ bank: bankOf(), destinationDate: "2026-05-06", requestedMinutes: 30 });
  assert.ok(r.allocations.length >= 1, "aloca");
  assert.equal(r.allocations[0].originDate, "2026-04-28", "28/04 consumido primeiro");
  assert.equal(r.allocations[0].carried, true, "origem é o saldo transportado");
});

check("T05 — preview automático mostra a origem 28/04 (mesmo motor do modal)", () => {
  reset();
  const v = dayView();
  const preview = allocateSpecialExcessFifo({ bank: v.bank, destinationDate: "2026-05-06", requestedMinutes: 30 });
  assert.ok(preview.allocations.length >= 1);
  assert.equal(preview.allocations[0].originDate, "2026-04-28", "preview aponta 28/04");
});

/* ── T06–T09 — uso efetivo + restos ── */

check("T06 — uso efetivo 30min cria allocation da origem 28/04 (store)", () => {
  reset();
  const r = actions.createSpecialExcessUse({ destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-03" });
  assert.equal(r.ok, true);
  const u = getAppData().specialExcessUses?.at(-1)!;
  assert.equal(u.allocations.length, 1);
  assert.equal(u.allocations[0].originDate, "2026-04-28");
  assert.equal(u.allocations[0].minutes, 30);
});

check("T07 — após uso: 28/04 resta 60min", () => {
  reset();
  assert.equal(actions.createSpecialExcessUse({ destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-03" }).ok, true);
  const lot = bankOf().lots.find((l) => l.originDate === "2026-04-28")!;
  assert.equal(lot.availableMinutes, 60, "90 − 30 = 60");
});

check("T08 — 05/05 permanece 90min", () => {
  reset();
  assert.equal(actions.createSpecialExcessUse({ destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-03" }).ok, true);
  const lot = bankOf().lots.find((l) => l.originDate === "2026-05-05")!;
  assert.equal(lot.availableMinutes, 90, "geração 05/05 intocada");
});

check("T09 — Disponível total após uso = 150min", () => {
  reset();
  assert.equal(actions.createSpecialExcessUse({ destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-03" }).ok, true);
  const b = bankOf();
  assert.equal(b.availableMinutes, 150, "180 − 30 = 150");
  assert.equal(b.carriedAvailableMinutes, 60);
});

/* ── T10 — provenance / autorização do transporte ── */

check("T10 — uso preserva provenance/autorização do transporte formal", () => {
  reset();
  const r = actions.createSpecialExcessUse({ destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "manual", manualAllocations: [{ originDate: "2026-04-28", minutes: 30 }], asOfDate: "2026-09-03" });
  assert.equal(r.ok, true);
  const u = getAppData().specialExcessUses?.at(-1)!;
  const alloc = u.allocations.find((a) => a.originDate === "2026-04-28")!;
  assert.equal(alloc.carried, true, "allocation marcada como transportada");
  const cl = closureForCycle(getAppData().annualCycleClosures, "2025/2026")!;
  assert.equal(cl.disposition, "carried");
  assert.equal(cl.sourceSlices[0].originalOriginDate, "2026-04-28");
  assert.ok(cl.sourceSlices[0].provenance.length > 0, "proveniência preservada no closure");
  assert.equal(cl.sourceSlices[0].originCycle, "2025/2026");
});

/* ── T11 — cross-cycle comum permanece bloqueado ── */

check("T11 — origem antiga NÃO transportada continua bloqueada cross-cycle", () => {
  reset(false); // sem fechamento → nada transportado
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-04-28", minutes: 30 }], asOfDate: "2026-09-03",
  });
  assert.equal(r.ok, false, "origem 2025/2026 sem transporte é bloqueada");
  assert.equal(r.code, "origin-outside-cycle", "cross-cycle rejeitado no domínio");
});

/* ── T12–T14 — modo manual ── */

check("T12 — modo manual lista 28/04 (transportado) e 05/05 (atual)", () => {
  reset();
  const v = dayView();
  const origins = v.lots.map((l) => l.originDate).sort();
  assert.deepEqual(origins, ["2026-04-28", "2026-05-05"]);
  const carriedLot = v.lots.find((l) => l.originDate === "2026-04-28")!;
  assert.equal(carriedLot.carried, true);
  assert.equal(carriedLot.carriedInMinutes, 90);
});

check("T13 — manual permite selecionar 28/04 transportado (autorizado)", () => {
  reset();
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-04-28", minutes: 30 }], asOfDate: "2026-09-03",
  });
  assert.equal(r.ok, true, "28/04 transportado é origem manual válida");
  const u = getAppData().specialExcessUses?.at(-1)!;
  assert.equal(u.allocations[0].originDate, "2026-04-28");
  assert.equal(u.allocations[0].carried, true);
});

check("T14 — manual com 05/05 preserva a escolha (não troca silenciosamente p/ FIFO)", () => {
  reset();
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-05-06", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-05-05", minutes: 30 }], asOfDate: "2026-09-03",
  });
  assert.equal(r.ok, true);
  const u = getAppData().specialExcessUses?.at(-1)!;
  assert.equal(u.allocations.length, 1);
  assert.equal(u.allocations[0].originDate, "2026-05-05", "origem manual preservada");
  assert.equal(u.allocations[0].carried, undefined, "não é transportada");
});

/* ── T15–T16 — textos de ciclo encerrado / período curto ── */

check("T15 — Registros de ciclo encerrado não manda 'Reabrir período' (texto + store)", () => {
  const r = src("src/app/(app)/registros/page.tsx");
  assert.ok(
    r.includes("Ciclo encerrado — registros protegidos. Este período não pode mais ser reaberto ou alterado."),
    "ciclo encerrado: texto sem reabertura",
  );
  assert.ok(r.includes("dateFallsInClosedCycle"), "Registros detecta ciclo encerrado");
  // comportamento real: reabrir período de um ciclo encerrado é bloqueado no
  // store ANTES mesmo de existir consolidação (o fechamento anual é a fronteira).
  reset();
  const reopen = actions.reopenPeriod({ periodStart: "2026-01-21", periodEnd: "2026-02-20" });
  assert.equal(reopen.ok, false, "reabertura bloqueada em ciclo encerrado");
  assert.equal(reopen.code, "cycle-closed");
});

check("T16 — Resumo do período curto não apresenta '21→20' como range real", () => {
  const res = src("src/app/(app)/resumo/page.tsx");
  assert.ok(res.includes("origens dentro de {periodLabel(period)}"), "subtexto dinâmico");
  assert.ok(!res.includes("origens dentro de 21→20"), "sem hardcode '21→20'");
  assert.ok(!res.includes("destinos dentro de 21→20"), "sem hardcode '21→20' (destinos)");
  assert.ok(!res.includes("Eventos do calendário em 21→20"), "sem hardcode '21→20' (calendário)");
  // comportamento real: período curto 21/04→30/04 é derivado canonicamente
  const short = getPointPeriod("2026-04-28");
  assert.equal(short.from, "2026-04-21");
  assert.equal(short.to, "2026-04-30");
});

console.log(`\n4H.1 — ${passed}/16 verificações concluídas.`);
if (passed !== 16) process.exit(1);
