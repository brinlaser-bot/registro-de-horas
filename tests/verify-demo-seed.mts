/**
 * VERIFICAÇÃO — ETAPA 3E.1: SEED DE DEMONSTRAÇÃO 4.0 (MODELO ATUAL)
 *
 * Prova, PELO MOTOR REAL (3A/3B/3C), que "Restaurar dados de exemplo"
 * produz o cenário de teste manual do fluxo [10+] novo:
 *   3 origens factuais (18/08, 20/08, 28/08) → banco 2h10;
 *   2 destinos de jornada abaixo do previsto (24/08 7h30, 26/08 7h);
 *   1 dia normal 8h (25/08); 1 registro incompleto (27/08);
 *   zero compensações/usos prévios — tudo nasce das batidas.
 *
 *  A  18/08 gera 40min [10+]
 *  B  20/08 gera 60min
 *  C  28/08 gera 30min
 *  D  total gerado = 130min
 *  E  utilizado = 0
 *  F  disponível = 130min
 *  G  24/08 = déficit de 30min (elegível)
 *  H  26/08 = déficit de 60min (elegível)
 *  I  25/08 = ok / 8h / saldo 0 (não elegível)
 *  J  27/08 = registro incompleto (não elegível)
 *  K  specialExcessUses = []
 *  L  nenhum Compensation interfere nos dias centrais
 *  M  FIFO de 60min sugere 18/08:40 + 20/08:20
 *  N  manual: 28/08 selecionável para destino 26/08 (asOf após 28/08)
 *
 * Executar: npx tsx tests/verify-demo-seed.mts
 */
import assert from "node:assert/strict";

import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import {
  allocateSpecialExcessFifo,
  allocateSpecialExcessManual,
  buildSpecialExcessBank,
} from "../src/lib/special-excess-bank.ts";
import { buildSeedData, SEED_CONTROL_START, SEED_VERSION } from "../src/lib/seed-data.ts";
import { settingsOf } from "../src/lib/store.ts";

const ASOF = "2026-08-30";

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const seed = buildSeedData();
const settings = settingsOf(seed.user);

const bankArgs = {
  cycle: getAnnualPointCycle("2026-08-26"),
  asOfDate: ASOF,
  entries: seed.entries,
  absences: seed.absences,
  calendars: seed.companyCalendars,
  settings,
  faltas: seed.faltas,
  controlStartDate: seed.user.controlStartDate ?? "",
  uses: seed.specialExcessUses ?? [],
};
const bank = buildSpecialExcessBank(bankArgs);
const row = (date: string) =>
  buildResumoDayRow({
    date, today: ASOF, entries: seed.entries, absences: seed.absences,
    calendars: seed.companyCalendars, settings, faltas: seed.faltas,
    controlStartDate: seed.user.controlStartDate,
  });
const lot = (originDate: string) => bank.lots.find((l) => l.originDate === originDate);

/* ── Estrutura do seed ────────────────────────────────────── */
check("S. estrutura: control start 01/08/2026, versão 4.0, 7 datas, 27 batidas", () => {
  assert.equal(SEED_VERSION, "4.0");
  assert.equal(SEED_CONTROL_START, "2026-08-01");
  assert.equal(seed.user.controlStartDate, SEED_CONTROL_START);
  const dates = [...new Set(seed.entries.map((e) => e.date))].sort();
  assert.deepEqual(
    dates,
    ["2026-08-18", "2026-08-20", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"],
  );
  assert.equal(seed.entries.length, 27);
  assert.equal(seed.compensations.length, 0);
  assert.equal(seed.absences.length, 0);
  assert.equal(seed.faltas.length, 0);
  assert.equal(seed.companyCalendars, undefined);
  assert.equal((seed.excessReasons ?? []).length, 0);
});

/* ── A/B/C. origens geram [10+] pelos fatos ───────────────── */
check("A. 18/08 (10h40) gera 40min [10+]", () => {
  const r = row("2026-08-18");
  assert.equal(r.workedMinutes, 640, "10h40 trabalhados");
  assert.equal(r.balanceMinutes, 120, "no ponto 10h → saldo regular +2h");
  assert.equal(r.excessMinutes, 40, "excesso acima de 10h nasce do fato");
  assert.equal(lot("2026-08-18")?.generatedMinutes, 40);
});
check("B. 20/08 (11h) gera 1h [10+]", () => {
  const r = row("2026-08-20");
  assert.equal(r.workedMinutes, 660);
  assert.equal(r.balanceMinutes, 120, "no ponto 10h → saldo regular +2h");
  assert.equal(r.excessMinutes, 60);
  assert.equal(lot("2026-08-20")?.generatedMinutes, 60);
});
check("C. 28/08 (10h30) gera 30min [10+]", () => {
  const r = row("2026-08-28");
  assert.equal(r.workedMinutes, 630);
  assert.equal(r.balanceMinutes, 120, "no ponto 10h → saldo regular +2h");
  assert.equal(r.excessMinutes, 30);
  assert.equal(lot("2026-08-28")?.generatedMinutes, 30);
});

/* ── D/E/F. banco inicial ─────────────────────────────────── */
check("D. total gerado = 130min (2h10)", () => {
  assert.equal(bank.generatedMinutes, 130);
});
check("E. utilizado = 0 (nada pré-preenchido)", () => {
  assert.equal(bank.usedMinutes, 0);
});
check("F. disponível = 130min; 3 lotes claros", () => {
  assert.equal(bank.availableMinutes, 130);
  assert.equal(bank.overusedMinutes, 0);
  assert.equal(bank.needsReview, false);
  assert.deepEqual(
    bank.lots.map((l) => [l.originDate, l.generatedMinutes, l.usedMinutes, l.availableMinutes]),
    [
      ["2026-08-18", 40, 0, 40],
      ["2026-08-20", 60, 0, 60],
      ["2026-08-28", 30, 0, 30],
    ],
  );
});

/* ── G/H. destinos elegíveis (3A) ─────────────────────────── */
check("G. 24/08 = 7h30, déficit 30min, elegível", () => {
  const r = row("2026-08-24");
  assert.equal(r.status, "deficit");
  assert.equal(r.workedMinutes, 450);
  assert.equal(r.balanceMinutes, -30);
  assert.equal(r.expectedMinutes - r.registrableMinutes, 30, "falta 30min para completar");
});
check("H. 26/08 = 7h, déficit 60min, elegível (destino principal)", () => {
  const r = row("2026-08-26");
  assert.equal(r.status, "deficit");
  assert.equal(r.workedMinutes, 420);
  assert.equal(r.balanceMinutes, -60);
  assert.equal(r.expectedMinutes - r.registrableMinutes, 60);
});

/* ── I/J. controle e incompleto ───────────────────────────── */
check("I. 25/08 = ok / 8h / saldo 0 (não elegível)", () => {
  const r = row("2026-08-25");
  assert.equal(r.status, "ok");
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.balanceMinutes, 0);
});
check("J. 27/08 = registro incompleto (sem saída final; não elegível)", () => {
  const r = row("2026-08-27");
  assert.equal(r.status, "incomplete", "incompleto ≠ abaixo do previsto");
});

/* ── K/L. independência de modelo legado ──────────────────── */
check("K. specialExcessUses = [] (usos feitos pela interface)", () => {
  assert.deepEqual(seed.specialExcessUses, []);
});
check("L. nenhum Compensation interfere nos dias centrais", () => {
  assert.equal(seed.compensations.length, 0, "seed visual sem modelo legado ativo");
  // Os status dos dias centrais derivam exclusivamente das batidas:
  assert.equal(row("2026-08-18").status, "excess");
  assert.equal(row("2026-08-24").status, "deficit");
  assert.equal(row("2026-08-25").status, "ok");
  assert.equal(row("2026-08-26").status, "deficit");
  assert.equal(row("2026-08-28").status, "excess");
});

/* ── M/N. seleção do motor 3C sobre o banco do seed ───────── */
check("M. FIFO de 60min sugere 18/08:40 + 20/08:20", () => {
  const fifo = allocateSpecialExcessFifo({ bank, destinationDate: "2026-08-26", requestedMinutes: 60 });
  assert.ok(!fifo.error, fifo.error);
  assert.equal(fifo.allocatedMinutes, 60);
  assert.equal(fifo.unfulfilledMinutes, 0);
  assert.deepEqual(fifo.allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 20 },
  ]);
});
check("N. manual: 28/08 (posterior ao destino) selecionável para 26/08", () => {
  const m = allocateSpecialExcessManual({
    bank,
    destinationDate: "2026-08-26",
    requestedAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
  });
  assert.equal(m.ok, true, m.error);
  assert.equal(m.allocatedMinutes, 30);
  assert.deepEqual(m.allocations, [{ originDate: "2026-08-28", minutes: 30 }]);
});

console.log(`\nSEED DEMONSTRAÇÃO 4.0 — OK (${passed} testes)`);
