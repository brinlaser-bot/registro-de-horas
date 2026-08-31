/**
 * VERIFICAÇÃO — ETAPA 3C: BANCO ANUAL [10+] + SELEÇÃO FIFO/MANUAL
 *
 * Banco PURO derivado de FATOS + SpecialExcessUse[] (3B). Sem UI, sem
 * store, sem legado, sem planejamento. Ciclo anual 01/05–30/04; o
 * fechamento 21→20 NÃO segmenta o banco.
 *
 * GERADO = row.excessMinutes (factual >10h, computeDay);
 * UTILIZADO = allocations dos usos "utilizado"; DISPONÍVEL = max(G−U, 0).
 *
 *  A  10h30 → gera 30min          B  11h30 → gera 1h30
 *  C  10h → gera 0                D  banco 40+60+30 = 130
 *  E  uso ativo 60 → used 60, available 70
 *  F  uso cancelado → não consome, available volta
 *  G  fracionamento: 120 gerados, 30 usados, 90 disponíveis
 *  H  uma origem → vários destinos: agregado correto
 *  I  várias origens → um destino: agregado correto
 *  J  FIFO 60 (40/60/30) → 40+20   K  FIFO 120 → 40+60+20
 *  L  FIFO pedido > saldo → unfulfilled  M  FIFO ignora origem sem disponível
 *  N  FIFO não usa ciclo diferente
 *  O  origem posterior ao destino (realizada, mesmo ciclo) → usável
 *  P  origem futura vs asOf → não entra
 *  Q  manual escolhe a mais nova (ignora as antigas) → válido
 *  R  manual várias origens → válido (ordem do usuário)
 *  S  manual acima do disponível → erro explícito (15 insuficientes)
 *  T  manual origem inexistente → erro explícito
 *  U  cancelado rastreável historicamente, fora do ativo
 *  V  overuse histórico: 30 gerados × 45 usados → available 0, overused 15
 *  W  29/04 × 02/05 → bancos de ciclos separados
 *  X  saldo não utilizado atravessa períodos 21→20 do mesmo ciclo
 *  Y  FIFO NÃO recalcula uso histórico ao surgir origem mais antiga
 *  Z  resultado FIFO → SpecialExcessUse válido (strategy "fifo")
 *  AA resultado manual → SpecialExcessUse válido (strategy "manual")
 *  INV 1–10
 *
 * Executar: npx tsx tests/verify-special-excess-bank.mts
 */
import assert from "node:assert/strict";

import {
  allocateSpecialExcessFifo,
  allocateSpecialExcessManual,
  buildSpecialExcessBank,
  type SpecialExcessBankInput,
  type SpecialExcessBankSummary,
} from "../src/lib/special-excess-bank.ts";
import {
  annualCycleBounds,
  getAnnualPointCycle,
  listDaysBetween,
} from "../src/lib/periods.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import {
  usedSpecialMinutesByOrigin,
  validateSpecialExcessUse,
  type SpecialExcessUse,
} from "../src/lib/special-excess-use.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const CYCLE = "2026/2027"; // 01/05/2026–30/04/2027
const ASOF = "2026-08-30";

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
/** Dia 08:00–12:00 + 13:00–saída (almoço explícito). Ex.: end 19:30 = 10h30. */
const day = (date: string, end: string) => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, end, "saida"),
];
const day10h30 = (date: string) => day(date, "19:30");  // excess 30
const day10h40 = (date: string) => day(date, "19:40");  // excess 40
const day11h = (date: string) => day(date, "20:00");    // excess 60
const day11h30 = (date: string) => day(date, "20:30");  // excess 90
const day12h = (date: string) => day(date, "21:00");    // excess 120
const day10h = (date: string) => day(date, "19:00");    // excess 0

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const bankOf = (over: Partial<SpecialExcessBankInput> = {}): SpecialExcessBankSummary =>
  buildSpecialExcessBank({
    cycle: CYCLE, asOfDate: ASOF, entries: [], absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01", uses: [], ...over,
  });

const makeUse = (over: Partial<SpecialExcessUse> = {}): SpecialExcessUse => ({
  id: "uso-1",
  destinationDate: "2026-08-26",
  allocations: [{ originDate: "2026-08-10", minutes: 30 }],
  allocationStrategy: "fifo",
  status: "utilizado",
  createdAt: 1,
  ...over,
});

/** Cenário-base: 05/05→40 · 20/06→60 · 10/08→30 (gerado 130). */
const baseFacts = [...day10h40("2026-05-05"), ...day11h("2026-06-20"), ...day10h30("2026-08-10")];
const baseBank = () => bankOf({ entries: baseFacts });

/* ── A–C. geração factual [10+] ───────────────────────────── */
check("A. 10h30 → gera 30min [10+]", () => {
  const b = bankOf({ entries: day10h30("2026-08-10") });
  assert.equal(b.generatedMinutes, 30);
  assert.equal(b.availableMinutes, 30);
  assert.equal(b.lots.length, 1);
  assert.deepEqual(b.lots[0], {
    originDate: "2026-08-10", generatedMinutes: 30, usedMinutes: 0,
    // 4A: o lote ganhou reservedMinutes/overreservedMinutes (sem planos = 0);
    // a garantia anterior (gerado/usado/disponível/review) se preserva.
    reservedMinutes: 0, availableMinutes: 30, overusedMinutes: 0,
    overreservedMinutes: 0, needsReview: false, destinations: [],
  });
});
check("B. 11h30 → gera 1h30 (90min)", () => {
  const b = bankOf({ entries: day11h30("2026-08-10") });
  assert.equal(b.generatedMinutes, 90);
  assert.equal(b.availableMinutes, 90);
});
check("C. 10h (no teto) → gera 0", () => {
  const b = bankOf({ entries: day10h("2026-08-10") });
  assert.equal(b.generatedMinutes, 0);
  assert.equal(b.availableMinutes, 0);
  assert.deepEqual(b.lots, []);
});

/* ── D–I. somas do banco ──────────────────────────────────── */
check("D. banco 40 + 60 + 30 = gerado 130", () => {
  const b = baseBank();
  assert.equal(b.generatedMinutes, 130);
  assert.equal(b.usedMinutes, 0);
  assert.equal(b.availableMinutes, 130);
  assert.deepEqual(b.lots.map((l) => l.originDate), ["2026-05-05", "2026-06-20", "2026-08-10"]);
});
check("E. uso ativo de 60min → used 60, available 70", () => {
  const b = bankOf({
    entries: baseFacts,
    uses: [makeUse({ allocations: [{ originDate: "2026-08-10", minutes: 30 }, { originDate: "2026-06-20", minutes: 30 }] })],
  });
  assert.equal(b.usedMinutes, 60);
  assert.equal(b.availableMinutes, 70);
  assert.equal(b.generatedMinutes, 130);
  assert.equal(b.needsReview, false);
});
check("F. uso cancelado não consome: available volta a 130", () => {
  const b = bankOf({
    entries: baseFacts,
    uses: [makeUse({ id: "uso-f", status: "cancelado", cancelledAt: 5 })],
  });
  assert.equal(b.usedMinutes, 0);
  assert.equal(b.availableMinutes, 130);
  assert.equal(b.needsReview, false);
});
check("G. fracionamento: 120 gerados, 30 usados, 90 disponíveis", () => {
  const b = bankOf({
    entries: day12h("2026-08-10"),
    uses: [makeUse({ allocations: [{ originDate: "2026-08-10", minutes: 30 }] })],
  });
  const lot = b.lots[0];
  assert.equal(lot.generatedMinutes, 120);
  assert.equal(lot.usedMinutes, 30);
  assert.equal(lot.availableMinutes, 90);
  assert.equal(lot.overusedMinutes, 0);
});
check("H. uma origem (30) usada em vários destinos → agregado correto", () => {
  const b = bankOf({
    entries: day10h30("2026-08-10"),
    uses: [
      makeUse({ id: "uso-h1", destinationDate: "2026-08-15", allocations: [{ originDate: "2026-08-10", minutes: 10 }] }),
      makeUse({ id: "uso-h2", destinationDate: "2026-08-20", allocations: [{ originDate: "2026-08-10", minutes: 20 }], allocationStrategy: "manual" }),
    ],
  });
  const lot = b.lots[0];
  assert.equal(lot.usedMinutes, 30);
  assert.equal(lot.availableMinutes, 0);
  assert.equal(lot.destinations.length, 2);
  assert.deepEqual(
    lot.destinations.map((d) => `${d.destinationDate}:${d.minutes}:${d.status}`),
    ["2026-08-15:10:utilizado", "2026-08-20:20:utilizado"],
  );
  assert.equal(b.usedMinutes, 30);
});
check("I. várias origens em um destino → agregado correto", () => {
  const b = bankOf({
    entries: [...day10h40("2026-05-05"), ...day11h("2026-06-20")],
    uses: [makeUse({ allocations: [{ originDate: "2026-05-05", minutes: 40 }, { originDate: "2026-06-20", minutes: 20 }] })],
  });
  assert.equal(b.usedMinutes, 60);
  const lotA = b.lots.find((l) => l.originDate === "2026-05-05")!;
  const lotB = b.lots.find((l) => l.originDate === "2026-06-20")!;
  assert.equal(lotA.usedMinutes, 40);
  assert.equal(lotA.availableMinutes, 0);
  assert.equal(lotB.usedMinutes, 20);
  assert.equal(lotB.availableMinutes, 40);
});

/* ── J–N. FIFO ────────────────────────────────────────────── */
check("J. FIFO 60 (40/60/30) → 40 da primeira + 20 da segunda, unfulfilled 0", () => {
  const r = allocateSpecialExcessFifo({ bank: baseBank(), destinationDate: "2026-08-26", requestedMinutes: 60 });
  assert.deepEqual(r.allocations, [{ originDate: "2026-05-05", minutes: 40 }, { originDate: "2026-06-20", minutes: 20 }]);
  assert.equal(r.allocatedMinutes, 60);
  assert.equal(r.unfulfilledMinutes, 0);
  assert.equal(r.error, undefined);
});
check("K. FIFO 120 → 40 + 60 + 20", () => {
  const r = allocateSpecialExcessFifo({ bank: baseBank(), destinationDate: "2026-08-26", requestedMinutes: 120 });
  assert.deepEqual(r.allocations, [
    { originDate: "2026-05-05", minutes: 40 },
    { originDate: "2026-06-20", minutes: 60 },
    { originDate: "2026-08-10", minutes: 20 },
  ]);
  assert.equal(r.unfulfilledMinutes, 0);
});
check("L. FIFO pedido 150 > saldo 130 → unfulfilled 20 (não fabrica saldo)", () => {
  const r = allocateSpecialExcessFifo({ bank: baseBank(), destinationDate: "2026-08-26", requestedMinutes: 150 });
  assert.equal(r.allocatedMinutes, 130);
  assert.equal(r.unfulfilledMinutes, 20);
  assert.equal(r.allocations.reduce((s, a) => s + a.minutes, 0), 130);
});
check("M. FIFO ignora origem sem disponível (05/05 e 10/08 consumidos)", () => {
  const b = bankOf({
    entries: baseFacts,
    uses: [
      makeUse({ id: "uso-m1", destinationDate: "2026-08-25", allocations: [{ originDate: "2026-05-05", minutes: 40 }] }),
      makeUse({ id: "uso-m2", allocationStrategy: "manual", allocations: [{ originDate: "2026-08-10", minutes: 30 }] }),
    ],
  });
  const r = allocateSpecialExcessFifo({ bank: b, destinationDate: "2026-08-26", requestedMinutes: 60 });
  assert.deepEqual(r.allocations, [{ originDate: "2026-06-20", minutes: 60 }]);
  assert.equal(r.unfulfilledMinutes, 0);
});
check("N. FIFO não usa ciclo diferente (destino 29/04 fora do banco 2026/2027)", () => {
  const r = allocateSpecialExcessFifo({ bank: baseBank(), destinationDate: "2026-04-29", requestedMinutes: 30 });
  assert.equal(r.error, `destino-fora-do-ciclo: 2026-04-29 (${getAnnualPointCycle("2026-04-29")}) x banco ${CYCLE}`);
  assert.deepEqual(r.allocations, []);
  assert.equal(r.allocatedMinutes, 0);
  assert.equal(r.unfulfilledMinutes, 30);
});

/* ── O–P. origem posterior / futura ───────────────────────── */
check("O. origem 28/08 posterior ao destino 26/08 (realizada, mesmo ciclo) → usável", () => {
  const b = bankOf({ entries: day10h30("2026-08-28") });
  const r = allocateSpecialExcessFifo({ bank: b, destinationDate: "2026-08-26", requestedMinutes: 30 });
  assert.deepEqual(r.allocations, [{ originDate: "2026-08-28", minutes: 30 }]);
  assert.equal(r.unfulfilledMinutes, 0);
});
check("P. origem futura (03/09) vs asOf 30/08 → não entra no banco", () => {
  const b = bankOf({ entries: [...day10h30("2026-08-10"), ...day10h30("2026-09-03")] });
  assert.equal(b.generatedMinutes, 30, "só o 10/08 entra");
  assert.deepEqual(b.lots.map((l) => l.originDate), ["2026-08-10"]);
});

/* ── Q–T. modo manual ─────────────────────────────────────── */
check("Q. manual escolhe origem mais nova (10/08), ignorando as antigas → válido", () => {
  const r = allocateSpecialExcessManual({
    bank: baseBank(), destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-08-10", minutes: 30 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocations, [{ originDate: "2026-08-10", minutes: 30 }]);
  assert.equal(r.allocatedMinutes, 30);
});
check("R. manual várias origens → válido, ordem do usuário preservada", () => {
  const r = allocateSpecialExcessManual({
    bank: baseBank(), destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-06-20", minutes: 30 }, { originDate: "2026-08-10", minutes: 20 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocations, [
    { originDate: "2026-06-20", minutes: 30 },
    { originDate: "2026-08-10", minutes: 20 },
  ], "ordem informada pelo usuário (não virou FIFO)");
  assert.equal(r.allocatedMinutes, 50);
});
check("S. manual acima do disponível (45 de 10/08, disp 30) → erro explícito, insuficiente 15", () => {
  const r = allocateSpecialExcessManual({
    bank: baseBank(), destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-08-10", minutes: 45 }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "disponibilidade-insuficiente");
  assert.deepEqual(r.insufficient, [{ originDate: "2026-08-10", requested: 45, available: 30, insufficient: 15 }]);
  assert.deepEqual(r.allocations, [], "sem allocation parcial/inválida");
  assert.equal(r.allocatedMinutes, 0);
});
check("T. manual origem inexistente no banco → erro explícito (sem substituir)", () => {
  const r = allocateSpecialExcessManual({
    bank: baseBank(), destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-07-15", minutes: 30 }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "origem-inexistente: 2026-07-15");
  assert.deepEqual(r.allocations, []);
});

/* ── U–V. cancelado histórico / overuse ───────────────────── */
check("U. uso cancelado permanece rastreável no lote, mas não conta no ativo", () => {
  const b = bankOf({
    entries: day10h30("2026-08-10"),
    uses: [
      makeUse({ id: "uso-u1", destinationDate: "2026-08-15", allocations: [{ originDate: "2026-08-10", minutes: 10 }] }),
      makeUse({ id: "uso-u2", destinationDate: "2026-08-20", allocations: [{ originDate: "2026-08-10", minutes: 10 }], status: "cancelado", cancelledAt: 5 }),
    ],
  });
  const lot = b.lots[0];
  assert.equal(lot.usedMinutes, 10, "só o ativo conta");
  assert.equal(lot.availableMinutes, 20);
  assert.equal(lot.destinations.length, 2, "histórico completo (inclusive cancelado)");
  const cancelado = lot.destinations.find((d) => d.status === "cancelado")!;
  assert.equal(cancelado.destinationDate, "2026-08-20");
  assert.equal(cancelado.minutes, 10);
  assert.equal(b.usedMinutes, 10);
});
check("V. overuse histórico: gerado 30, uso ativo 45 → available 0, overused 15, needsReview", () => {
  const b = bankOf({
    entries: day10h30("2026-08-10"),
    uses: [makeUse({ allocations: [{ originDate: "2026-08-10", minutes: 45 }] })],
  });
  const lot = b.lots[0];
  assert.equal(lot.generatedMinutes, 30);
  assert.equal(lot.usedMinutes, 45);
  assert.equal(lot.availableMinutes, 0, "nunca negativo");
  assert.equal(lot.overusedMinutes, 15);
  assert.equal(lot.needsReview, true);
  assert.equal(b.overusedMinutes, 15);
  assert.equal(b.needsReview, true);
});

/* ── W–X. ciclo anual e atravessamento 21→20 ──────────────── */
check("W. 29/04 × 02/05 → bancos de ciclos SEPARADOS (não somados)", () => {
  const entries = [...day11h("2026-04-29"), ...day12h("2026-05-02")];
  const bancoAntes = buildSpecialExcessBank({
    cycle: "2025/2026", asOfDate: "2026-05-05", entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01", uses: [],
  });
  const bancoDepois = buildSpecialExcessBank({
    cycle: "2026/2027", asOfDate: "2026-05-05", entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01", uses: [],
  });
  assert.equal(bancoAntes.generatedMinutes, 60, "29/04 fica no ciclo 2025/2026");
  assert.deepEqual(bancoAntes.lots.map((l) => l.originDate), ["2026-04-29"]);
  assert.equal(bancoDepois.generatedMinutes, 120, "02/05 fica no ciclo 2026/2027");
  assert.deepEqual(bancoDepois.lots.map((l) => l.originDate), ["2026-05-02"]);
});
check("X. saldo não utilizado atravessa períodos 21→20 do mesmo ciclo", () => {
  // 18/08 gerou 120 (período 21/07–20/08); uso de 30 para 25/08 (período 21/08–20/09)
  const b = bankOf({
    entries: day12h("2026-08-18"),
    asOfDate: "2026-08-31",
    uses: [makeUse({ destinationDate: "2026-08-25", allocations: [{ originDate: "2026-08-18", minutes: 30 }] })],
  });
  assert.equal(b.generatedMinutes, 120);
  assert.equal(b.usedMinutes, 30);
  assert.equal(b.availableMinutes, 90, "o fechamento 21→20 NÃO encerra o [10+]");
});

/* ── Y. FIFO não reescreve o passado ──────────────────────── */
check("Y. uso histórico FIFO permanece intacto ao surgir origem mais antiga", () => {
  const factsFase1 = [...day10h40("2026-05-05"), ...day11h("2026-06-20")];
  const bancoFase1 = bankOf({ entries: factsFase1 });
  const sug = allocateSpecialExcessFifo({ bank: bancoFase1, destinationDate: "2026-08-26", requestedMinutes: 60 });
  const usoAntigo = makeUse({ id: "uso-antigo", allocations: sug.allocations.map((a) => ({ ...a })) });
  const snapshot = JSON.parse(JSON.stringify(usoAntigo.allocations));
  // fase 2: surge origem mais antiga (01/05 → 30min)
  const bancoFase2 = bankOf({
    entries: [...day10h30("2026-05-01"), ...factsFase1],
    uses: [usoAntigo],
  });
  assert.deepEqual(usoAntigo.allocations, snapshot, "allocations históricas NÃO foram recalculadas");
  const lotNova = bancoFase2.lots.find((l) => l.originDate === "2026-05-01")!;
  assert.equal(lotNova.availableMinutes, 30, "nova origem disponível para NOVOS usos");
  const novo = allocateSpecialExcessFifo({ bank: bancoFase2, destinationDate: "2026-08-27", requestedMinutes: 30 });
  assert.deepEqual(novo.allocations, [{ originDate: "2026-05-01", minutes: 30 }], "FIFO novo usa a origem mais antiga");
});

/* ── Z/AA. pontes → SpecialExcessUse válido ───────────────── */
check("Z. resultado FIFO monta SpecialExcessUse válido (strategy 'fifo')", () => {
  const r = allocateSpecialExcessFifo({ bank: baseBank(), destinationDate: "2026-08-26", requestedMinutes: 60 });
  const use: SpecialExcessUse = {
    id: "uso-z", destinationDate: "2026-08-26", allocations: r.allocations,
    allocationStrategy: "fifo", status: "utilizado", createdAt: 1,
  };
  const v = validateSpecialExcessUse(use);
  assert.equal(v.ok, true, `erros: ${v.errors.join(", ")}`);
});
check("AA. resultado manual monta SpecialExcessUse válido (strategy 'manual')", () => {
  const r = allocateSpecialExcessManual({
    bank: baseBank(), destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-06-20", minutes: 30 }, { originDate: "2026-08-10", minutes: 20 }],
  });
  assert.equal(r.ok, true);
  const use: SpecialExcessUse = {
    id: "uso-aa", destinationDate: "2026-08-26", allocations: r.allocations,
    allocationStrategy: "manual", status: "utilizado", createdAt: 1,
  };
  const v = validateSpecialExcessUse(use);
  assert.equal(v.ok, true, `erros: ${v.errors.join(", ")}`);
});

/* ── Invariantes ──────────────────────────────────────────── */
check("INV1. available de lote nunca fica negativo (todos os cenários, incl. overuse)", () => {
  const bancos = [
    baseBank(),
    bankOf({ entries: day10h30("2026-08-10"), uses: [makeUse({ allocations: [{ originDate: "2026-08-10", minutes: 45 }] })] }),
    bankOf({ entries: baseFacts, uses: [makeUse({ status: "cancelado", cancelledAt: 5 })] }),
  ];
  for (const b of bancos) {
    for (const l of b.lots) assert.ok(l.availableMinutes >= 0, `${l.originDate}: ${l.availableMinutes}`);
  }
});
check("INV2. cancelado nunca entra em used ativo (cruzado com o agregado da 3B)", () => {
  const uses = [
    makeUse({ id: "ativo", allocations: [{ originDate: "2026-08-10", minutes: 30 }] }),
    makeUse({ id: "cx", allocations: [{ originDate: "2026-05-05", minutes: 40 }], status: "cancelado", cancelledAt: 5 }),
  ];
  const b = bankOf({ entries: baseFacts, uses });
  assert.equal(b.usedMinutes, 30, "só o ativo");
  assert.equal(b.usedMinutes, Object.values(usedSpecialMinutesByOrigin(uses)).reduce((s, m) => s + m, 0));
});
check("INV3. nenhuma função muta fatos nem SpecialExcessUse[]", () => {
  const entries = [...baseFacts];
  const uses = [makeUse({ id: "uso-1" }), makeUse({ id: "uso-2", destinationDate: "2026-08-25", status: "cancelado", cancelledAt: 9 })];
  const snapEntries = JSON.parse(JSON.stringify(entries));
  const snapUses = JSON.parse(JSON.stringify(uses));
  const b = bankOf({ entries, uses });
  allocateSpecialExcessFifo({ bank: b, destinationDate: "2026-08-26", requestedMinutes: 60 });
  allocateSpecialExcessManual({ bank: b, destinationDate: "2026-08-26", requestedAllocations: [{ originDate: "2026-06-20", minutes: 60 }] });
  assert.deepEqual(entries, snapEntries, "fatos intactos");
  assert.deepEqual(uses, snapUses, "uses intactos");
});
check("INV4. FIFO sempre percorre origens em data ascendente", () => {
  for (const req of [30, 60, 120, 130]) {
    const r = allocateSpecialExcessFifo({ bank: baseBank(), destinationDate: "2026-08-26", requestedMinutes: req });
    const dates = r.allocations.map((a) => a.originDate);
    assert.deepEqual(dates, [...dates].sort(), `pedido ${req} em ordem ascendente`);
  }
});
check("INV5. manual preserva a escolha do usuário (não transforma em FIFO)", () => {
  const r = allocateSpecialExcessManual({
    bank: baseBank(), destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-08-10", minutes: 30 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocations, [{ originDate: "2026-08-10", minutes: 30 }], "apenas a origem escolhida, mesmo havendo mais antigas");
});
check("INV6. o banco usa SOMENTE [10+] — crédito regular do dia nunca entra", () => {
  const entries = day10h30("2026-08-10");
  const row = buildResumoDayRow({ date: "2026-08-10", today: ASOF, entries, absences: [], calendars: undefined, settings, faltas: [], controlStartDate: "2026-04-01" });
  assert.equal(row.balanceMinutes, 120, "o dia tem +2h de saldo REGULAR…");
  const b = bankOf({ entries });
  const r = allocateSpecialExcessFifo({ bank: b, destinationDate: "2026-08-26", requestedMinutes: 60 });
  assert.equal(r.allocatedMinutes, 30, "…mas o banco só tem os 30min de [10+]");
  assert.equal(r.unfulfilledMinutes, 30, "o resto fica não atendido (saldo regular não é usado)");
});
check("INV7. ciclos anuais nunca se misturam (lotes sempre do ciclo consultado)", () => {
  const bancos = [
    baseBank(),
    buildSpecialExcessBank({ cycle: "2025/2026", asOfDate: "2026-05-05", entries: [...day11h("2026-04-29"), ...day12h("2026-05-02")], absences: [], calendars: undefined, settings, faltas: [], controlStartDate: "2026-04-01", uses: [] }),
  ];
  for (const b of bancos) {
    for (const l of b.lots) {
      assert.equal(getAnnualPointCycle(l.originDate), b.cycle, `${l.originDate} em ${b.cycle}`);
    }
  }
});
check("INV8. allocations históricas existentes nunca são recalculadas", () => {
  const usoAntigo = makeUse({
    id: "uso-hist",
    allocations: [{ originDate: "2026-05-05", minutes: 40 }, { originDate: "2026-06-20", minutes: 20 }],
  });
  const snapshot = JSON.parse(JSON.stringify(usoAntigo.allocations));
  // surge origem nova mais antiga; banco é reconstruído
  const b = bankOf({
    entries: [...day10h30("2026-05-01"), ...baseFacts],
    uses: [usoAntigo],
  });
  allocateSpecialExcessFifo({ bank: b, destinationDate: "2026-08-26", requestedMinutes: 30 });
  assert.deepEqual(usoAntigo.allocations, snapshot, "histórico intacto");
  const lotUso = b.lots.find((l) => l.originDate === "2026-05-05")!;
  assert.deepEqual(
    lotUso.destinations.map((d) => `${d.useId}:${d.minutes}`),
    ["uso-hist:40"],
    "lote reflete o uso histórico, não uma nova sugestão FIFO",
  );
});
check("INV9. total ativo usado deriva EXCLUSIVAMENTE das allocations dos usos 'utilizado'", () => {
  const uses = [
    makeUse({ id: "a1", allocations: [{ originDate: "2026-08-10", minutes: 15 }, { originDate: "2026-05-05", minutes: 10 }] }),
    makeUse({ id: "a2", destinationDate: "2026-08-25", allocations: [{ originDate: "2026-06-20", minutes: 20 }] }),
    makeUse({ id: "cx", allocations: [{ originDate: "2026-08-10", minutes: 5 }], status: "cancelado", cancelledAt: 7 }),
  ];
  const b = bankOf({ entries: baseFacts, uses });
  assert.equal(b.usedMinutes, 45, "15 + 10 + 20 (cancelado 5 fora)");
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-10")!.usedMinutes, 15);
  assert.equal(b.lots.find((l) => l.originDate === "2026-05-05")!.usedMinutes, 10);
  assert.equal(b.lots.find((l) => l.originDate === "2026-06-20")!.usedMinutes, 20);
});
check("INV10. generated deriva EXCLUSIVAMENTE dos fatos [10+] (Σ excessMinutes do Resumo)", () => {
  const uses = [makeUse()]; // uso ativo de 30 — não pode inflar generated
  const b = bankOf({ entries: baseFacts, uses });
  let esperado = 0;
  const bounds = annualCycleBounds(CYCLE);
  for (const date of listDaysBetween(bounds.from, bounds.to)) {
    esperado += buildResumoDayRow({ date, today: ASOF, entries: baseFacts, absences: [], calendars: undefined, settings, faltas: [], controlStartDate: "2026-04-01" }).excessMinutes;
  }
  assert.equal(b.generatedMinutes, esperado, "idêntico à soma factual do Resumo");
  assert.equal(b.generatedMinutes, 130);
});

console.log(`\nBANCO ANUAL [10+] (ÉTAPA 3C) — OK (${passed} testes)`);
