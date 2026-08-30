/**
 * VERIFICAÇÃO — ETAPA 3B: MODELO DE DOMÍNIO PURO — USO DO [10+]
 *
 * SpecialExcessUse: UM destino, UMA ou VÁRIAS origens, estratégia
 * (fifo|manual), status (utilizado|cancelado), histórico preservado.
 * Sem UI, sem store, sem FIFO real, sem planejamento, sem legado.
 *
 *  A  uma origem → um destino
 *  B  duas origens → um destino (UM uso com duas allocations)
 *  C  uma origem → múltiplos destinos (usos separados, mesma origem)
 *  D  fracionamento (30min de uma origem de 2h — disponível é 3C)
 *  E  strategy "fifo" registrada
 *  F  strategy "manual" registrada
 *  G  originDate posterior ao destinationDate, mesmo ciclo → válido
 *  H  cruzar 30/04 → inválido
 *  I  cancelado preserva histórico e sai dos agregados ativos
 *  J  rastreabilidade origem → destino
 *  K  rastreabilidade destino → origens
 *  L  agregado por destino compatível com o input da projeção 3A
 *  M  allocations duplicadas da mesma origem → inválido
 *  N  minutes zero/negativo → inválido
 *  O  cancelado sem cancelledAt → inválido
 *  P  utilizado com cancelledAt → inválido
 *  Q  periodClosed=true → não editável
 *  R  periodClosed=false + utilizado → editável
 *  S  cancelado → não editável como uso ativo
 *
 * Executar: npx tsx tests/verify-special-excess-use.mts
 */
import assert from "node:assert/strict";

import {
  activeSpecialExcessUses,
  canEditSpecialExcessUse,
  specialExcessUseMinutes,
  specialUseDestinationsForOrigin,
  specialUseOriginsForDestination,
  usedSpecialMinutesByDestination,
  usedSpecialMinutesByOrigin,
  validateSpecialExcessUse,
  type SpecialExcessUse,
} from "../src/lib/special-excess-use.ts";
import { projectRealizedPeriodOfficial } from "../src/lib/official-projection.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/** Uso padrão: destino 26/08 (abaixo da base), origem 28/08 (posterior, mesmo ciclo), 30min, fifo. */
const baseUse = (over: Partial<SpecialExcessUse> = {}): SpecialExcessUse => ({
  id: "uso-1",
  destinationDate: "2026-08-26",
  allocations: [{ originDate: "2026-08-28", minutes: 30 }],
  allocationStrategy: "fifo",
  status: "utilizado",
  createdAt: 1000,
  ...over,
});

/* ── A. uma origem → um destino ───────────────────────────── */
check("A. uma origem → um destino: válido, total derivado de allocations", () => {
  const u = baseUse();
  const v = validateSpecialExcessUse(u);
  assert.equal(v.ok, true, `esperava ok, erros: ${v.errors.join(", ")}`);
  assert.equal(specialExcessUseMinutes(u), 30, "total é SOMENTE soma de allocations");
  assert.deepEqual(usedSpecialMinutesByDestination([u]), { "2026-08-26": 30 });
  assert.deepEqual(usedSpecialMinutesByOrigin([u]), { "2026-08-28": 30 });
});

/* ── B. duas origens → um destino (UM uso) ─────────────────── */
check("B. duas origens → um destino: UM uso com duas allocations (40+20=60)", () => {
  const u = baseUse({
    id: "uso-b",
    destinationDate: "2026-08-31",
    allocations: [
      { originDate: "2026-05-05", minutes: 40 },
      { originDate: "2026-06-20", minutes: 20 },
    ],
  });
  assert.equal(validateSpecialExcessUse(u).ok, true);
  assert.equal(specialExcessUseMinutes(u), 60);
  assert.equal(u.allocations.length, 2, "UM uso, não dois");
  assert.deepEqual(usedSpecialMinutesByDestination([u]), { "2026-08-31": 60 });
  assert.deepEqual(usedSpecialMinutesByOrigin([u]), { "2026-05-05": 40, "2026-06-20": 20 });
});

/* ── C. uma origem → múltiplos destinos (usos separados) ───── */
check("C. uma origem (10/08, 2h) → 3 destinos: usos separados, mesma origem (30+45+15=90)", () => {
  const origem = "2026-08-10";
  const usa = baseUse({ id: "usa", destinationDate: "2026-08-15", allocations: [{ originDate: origem, minutes: 30 }] });
  const usb = baseUse({ id: "usb", destinationDate: "2026-08-20", allocations: [{ originDate: origem, minutes: 45 }] });
  const usc = baseUse({ id: "usc", destinationDate: "2026-08-25", allocations: [{ originDate: origem, minutes: 15 }] });
  for (const u of [usa, usb, usc]) {
    assert.equal(validateSpecialExcessUse(u).ok, true, u.id);
  }
  assert.deepEqual(usedSpecialMinutesByOrigin([usa, usb, usc]), { [origem]: 90 }, "mesma origem somada entre usos");
  assert.deepEqual(
    usedSpecialMinutesByDestination([usa, usb, usc]),
    { "2026-08-15": 30, "2026-08-20": 45, "2026-08-25": 15 },
  );
});

/* ── D. fracionamento ──────────────────────────────────────── */
check("D. fracionamento: 30min de uma origem de 2h → modelo suporta (disponível é 3C)", () => {
  const u = baseUse({ id: "uso-d", destinationDate: "2026-08-15", allocations: [{ originDate: "2026-08-10", minutes: 30 }] });
  assert.equal(validateSpecialExcessUse(u).ok, true, "uso parcial da origem é estruturalmente válido");
  assert.equal(specialExcessUseMinutes(u), 30);
  assert.deepEqual(usedSpecialMinutesByOrigin([u]), { "2026-08-10": 30 }, "só 30min saem da origem (1h30 restante fica para 3C)");
});

/* ── E/F. estratégia registrada ────────────────────────────── */
check("E. strategy 'fifo' registrada no registro", () => {
  const u = baseUse({ allocationStrategy: "fifo" });
  assert.equal(validateSpecialExcessUse(u).ok, true);
  assert.equal(u.allocationStrategy, "fifo", "o registro guarda a estratégia (algoritmo é futuro)");
});
check("F. strategy 'manual' registrada no registro", () => {
  const u = baseUse({ allocationStrategy: "manual" });
  assert.equal(validateSpecialExcessUse(u).ok, true);
  assert.equal(u.allocationStrategy, "manual");
});

/* ── G. origem posterior ao destino, MESMO ciclo → válido ──── */
check("G. origem 28/08 posterior ao destino 26/08, mesmo ciclo → válido", () => {
  const u = baseUse(); // destino 26/08, origem 28/08
  const v = validateSpecialExcessUse(u);
  assert.equal(v.ok, true, `esperava ok, erros: ${v.errors.join(", ")}`);
  assert.ok(!v.errors.some((e) => e.startsWith("ciclos-diferentes")));
});

/* ── H. cruzar 30/04 → inválido ────────────────────────────── */
check("H. destino 29/04 x origem 02/05 (cruzou 30/04) → inválido", () => {
  const u = baseUse({ destinationDate: "2026-04-29", allocations: [{ originDate: "2026-05-02", minutes: 30 }] });
  const v = validateSpecialExcessUse(u);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("ciclos-diferentes")), `erros: ${v.errors.join(", ")}`);
});

/* ── I. cancelado: histórico preservado, sai dos ativos ────── */
check("I. cancelado preserva allocations/histórico e sai dos agregados ativos", () => {
  const cx: SpecialExcessUse = {
    id: "uso-cx",
    destinationDate: "2026-08-15",
    allocations: [{ originDate: "2026-08-10", minutes: 30 }],
    allocationStrategy: "fifo",
    status: "cancelado",
    createdAt: 1000,
    cancelledAt: 2000,
    note: "repetição acidental",
  };
  assert.equal(validateSpecialExcessUse(cx).ok, true);
  // registro NÃO é apagado: histórico intacto
  assert.deepEqual(cx.allocations, [{ originDate: "2026-08-10", minutes: 30 }]);
  assert.equal(cx.destinationDate, "2026-08-15");
  assert.equal(cx.allocationStrategy, "fifo");
  assert.equal(cx.createdAt, 1000);
  assert.equal(cx.cancelledAt, 2000);
  // sai dos agregados ativos
  assert.deepEqual(activeSpecialExcessUses([cx]), []);
  assert.deepEqual(usedSpecialMinutesByDestination([cx]), {});
  assert.deepEqual(usedSpecialMinutesByOrigin([cx]), {});
  // rastreabilidade histórica continua existindo (com o status)
  const hist = specialUseOriginsForDestination([cx], "2026-08-15");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].status, "cancelado");
  assert.equal(hist[0].totalMinutes, 30);
});

/* ── J. rastreabilidade origem → destino ───────────────────── */
check("J. origem 05/05 → destino 31/08 com 40min", () => {
  const u = baseUse({
    id: "uso-1",
    destinationDate: "2026-08-31",
    allocations: [
      { originDate: "2026-05-05", minutes: 40 },
      { originDate: "2026-06-20", minutes: 20 },
    ],
  });
  const tr = specialUseDestinationsForOrigin([u], "2026-05-05");
  assert.deepEqual(tr, [{ useId: "uso-1", status: "utilizado", destinationDate: "2026-08-31", minutes: 40 }]);
  assert.deepEqual(specialUseDestinationsForOrigin([u], "2026-06-20"), [
    { useId: "uso-1", status: "utilizado", destinationDate: "2026-08-31", minutes: 20 },
  ]);
});

/* ── K. rastreabilidade destino → origens ──────────────────── */
check("K. destino 31/08 → as duas origens (05/05:40, 20/06:20)", () => {
  const u = baseUse({
    id: "uso-1",
    destinationDate: "2026-08-31",
    allocations: [
      { originDate: "2026-05-05", minutes: 40 },
      { originDate: "2026-06-20", minutes: 20 },
    ],
  });
  const tr = specialUseOriginsForDestination([u], "2026-08-31");
  assert.equal(tr.length, 1);
  assert.equal(tr[0].useId, "uso-1");
  assert.equal(tr[0].totalMinutes, 60);
  assert.deepEqual(
    tr[0].allocations.map((a) => `${a.originDate}:${a.minutes}`).sort(),
    ["2026-05-05:40", "2026-06-20:20"],
  );
  assert.deepEqual(specialUseOriginsForDestination([u], "2026-08-30"), [], "outro destino → vazio");
});

/* ── L. ponte com a 3A: formato exato de usedSpecialMinutesByDate ── */
check("L. usedSpecialMinutesByDestination alimenta projectRealizedPeriodOfficial (3A) direto", () => {
  let nextId = 1;
  const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
    id: nextId++, date, time, type, note: null,
  });
  const day = (date: string, end: string) => [
    punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
    punch(date, "13:00", "entrada"), punch(date, end, "saida"),
  ];
  const entries = [
    ...day("2026-08-24", "17:00"),  // 8h   → 0
    ...day("2026-08-25", "19:30"),  // 10h30 → +2h
    ...day("2026-08-26", "16:00"),  // 7h   → −1h (elegível)
  ];
  const usePonte: SpecialExcessUse = {
    id: "uso-ponte",
    destinationDate: "2026-08-26",
    allocations: [{ originDate: "2026-08-28", minutes: 30 }],
    allocationStrategy: "manual",
    status: "utilizado",
    createdAt: 1,
  };
  const byDest = usedSpecialMinutesByDestination([usePonte]);
  assert.deepEqual(byDest, { "2026-08-26": 30 }, "formato Record<destinationDate, min>");
  const r = projectRealizedPeriodOfficial({
    from: "2026-08-24", to: "2026-08-26", today: "2026-08-30",
    entries, absences: [], calendars: undefined, settings, faltas: [],
    controlStartDate: "2026-04-01", usedSpecialMinutesByDate: byDest,
  });
  assert.equal(r.factualBalanceMinutes, 60, "factual +1h intacto");
  assert.equal(r.appliedSpecialMinutes, 30, "30min aplicados no destino 7h");
  assert.equal(r.projectedBalanceMinutes, 90, "projetado +1h30");
});

/* ── M. allocations duplicadas da mesma origem ─────────────── */
check("M. duas allocations da mesma origem no MESMO uso → inválido", () => {
  const u = baseUse({ allocations: [{ originDate: "2026-08-10", minutes: 30 }, { originDate: "2026-08-10", minutes: 20 }] });
  const v = validateSpecialExcessUse(u);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("origem-duplicada: 2026-08-10"), `erros: ${v.errors.join(", ")}`);
});

/* ── N. minutes zero/negativo ──────────────────────────────── */
check("N. minutes 0 e -30 → inválido", () => {
  for (const minutes of [0, -30]) {
    const u = baseUse({ allocations: [{ originDate: "2026-08-28", minutes }] });
    const v = validateSpecialExcessUse(u);
    assert.equal(v.ok, false, `minutes=${minutes}`);
    assert.ok(v.errors.some((e) => e.startsWith("minutos-invalidos")), `erros: ${v.errors.join(", ")}`);
  }
});

/* ── O/P. coerência status × cancelledAt ───────────────────── */
check("O. cancelado sem cancelledAt → inválido", () => {
  const u = baseUse({ status: "cancelado" });
  const v = validateSpecialExcessUse(u);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("cancelado-sem-cancelledAt"), `erros: ${v.errors.join(", ")}`);
});
check("P. utilizado com cancelledAt → inválido (incoerente)", () => {
  const u = baseUse({ status: "utilizado", cancelledAt: 2000 });
  const v = validateSpecialExcessUse(u);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("utilizado-com-cancelledAt"), `erros: ${v.errors.join(", ")}`);
});

/* ── Q/R/S. permissão de edição ────────────────────────────── */
check("Q. periodClosed=true → não editável (mesmo uso ativo)", () => {
  const r = canEditSpecialExcessUse({ use: baseUse(), periodClosed: true });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "period-closed");
});
check("R. periodClosed=false + utilizado → editável", () => {
  const r = canEditSpecialExcessUse({ use: baseUse(), periodClosed: false });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, undefined);
});
check("S. cancelado → não editável como uso ativo (mesmo período aberto)", () => {
  const r = canEditSpecialExcessUse({
    use: baseUse({ status: "cancelado", cancelledAt: 2000 }),
    periodClosed: false,
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "already-cancelled");
});

console.log(`\nUSO DO [10+] — MODELO 3B — OK (${passed} testes)`);
