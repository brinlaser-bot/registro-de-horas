/**
 * VERIFICAÇÃO — UX REGISTROS (atalhos removidos + chips sem truncar + Seed 3.1)
 *
 *  A  Página Registros / DayCard NÃO renderiza atalhos de ponto
 *  B  Registro manual continua no card e abre o MESMO modal de sequência (3E.2)
 *  C  Mobile: "Entrada"/"Saída" inteiros; sem truncate; 2 colunas; sem overflow-x
 *  D  Desktop: batidas em fluxo horizontal/wrap
 *  E  Seed 4.0: restore determinístico; sem calendário/motivos; 7 datas demo
 *  F  Dia com 6 batidas (fixture própria): wrap no desktop, 2 colunas no mobile, editar/excluir
 *
 * Executar: npx tsx tests/verify-ux-registros.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildSeedData, SEED_VERSION } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import type { AppData, TimeEntry, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};

const snap = (d: AppData) => JSON.stringify(d);
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const dayCardSrc = srcOf("src/components/day-card.tsx");
const regsSrc = srcOf("src/app/(app)/registros/page.tsx");
const quickSrc = srcOf("src/components/quick-punch.tsx");

assert.equal(SEED_VERSION, "4.0");

check("A. Registros/DayCard não renderiza atalhos de ponto", () => {
  for (const src of [dayCardSrc, regsSrc]) {
    assert.ok(!src.includes("Entrada agora"), "sem Entrada agora");
    assert.ok(!src.includes("Saída agora"), "sem Saída agora");
    assert.ok(!src.includes("Almoço {settings.lunchStart}"), "sem Almoço 12:00");
    assert.ok(!src.includes("Volta {settings.lunchEnd}"), "sem Volta 13:00");
    assert.ok(!src.includes("Atalhos {"), "sem título Atalhos");
    assert.ok(!src.includes("shortcutsOpen"), "sem estado de accordion de atalhos");
  }
  assert.ok(quickSrc.includes("Entrada agora"), "Visão geral preserva Entrada agora");
  assert.ok(quickSrc.includes("Saída agora"), "Visão geral preserva Saída agora");
});

check("B. Registro manual continua no card e abre o MESMO modal de sequência (3E.2)", () => {
  assert.ok(dayCardSrc.includes("Adicionar batida"), "rótulo de inclusão");
  assert.ok(dayCardSrc.includes("setCorrectOpen(true)"), "botão abre o modal de sequência do dia");
  assert.ok(dayCardSrc.includes("CorrectPunchesModal"), "reaproveita o modal moderno existente");
  assert.ok(!dayCardSrc.includes("showAdd"), "formulário inline removido");
  // as regras existentes (tipo inferido pela sequência, origem manual,
  // observação opcional) vivem no modal reaproveitado:
  const modalSrc = srcOf("src/components/correct-punches-modal.tsx");
  assert.ok(modalSrc.includes("suggestedPunchTypeAt"), "posição cronológica define o tipo");
  assert.ok(modalSrc.includes('source: "manual"'));
  assert.ok(modalSrc.includes('label="Observação (opcional)"'), "observação opcional");
});

check("C. Mobile: Entrada/Saída inteiros, 2 colunas, sem overflow horizontal", () => {
  assert.ok(dayCardSrc.includes('e.type === "entrada" ? "Entrada" : "Saída"'));
  assert.ok(dayCardSrc.includes("shrink-0 whitespace-nowrap text-xs font-semibold text-slate-600"), "rótulo não encolhe nem trunca");
  assert.ok(!dayCardSrc.includes("min-w-0 truncate text-xs font-semibold text-slate-600"), "truncate removido do rótulo");
  assert.ok(!dayCardSrc.includes("Entr..."));
  assert.ok(dayCardSrc.includes("min-[360px]:grid-cols-2"), "2 colunas quando houver espaço");
  assert.ok(dayCardSrc.includes("overflow-x-hidden"), "sem scroll horizontal no grid");
  assert.ok(dayCardSrc.includes('aria-label="Editar"'));
  assert.ok(dayCardSrc.includes('aria-label="Excluir"'));
});

check("D. Desktop: batidas em fluxo horizontal com wrap", () => {
  assert.ok(dayCardSrc.includes("sm:flex sm:flex-wrap"), "flex + wrap no desktop");
  assert.ok(dayCardSrc.includes("sm:w-auto sm:min-w-[11.5rem]"), "chip não vira linha inteira");
  assert.ok(!dayCardSrc.includes("grid-cols-1 gap-1.5 sm:grid-cols-1"), "não voltou para 1 batida por linha");
});

check("E. Seed 4.0: restore 2x idêntico; sem calendário/motivos; 7 datas demo", () => {
  actions.reseed();
  const first = snap(getAppData());
  actions.reseed();
  assert.equal(snap(getAppData()), first);
  assert.equal(first, snap(buildSeedData()), "reseed === buildSeedData");

  const d = getAppData();
  assert.equal(d.companyCalendars, undefined, "sem calendário fictício");
  assert.equal((d.excessReasons ?? []).length, 0, "sem motivos legados no visual");
  assert.equal(d.compensations.length, 0);
  const dates = [...new Set(d.entries.map((e) => e.date))].sort();
  assert.deepEqual(
    dates,
    ["2026-08-18", "2026-08-20", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"],
  );
});

check("F. Dia com 6 batidas (fixture própria): 8h, wrap/2 colunas e editar/excluir no chip", () => {
  const punches: TimeEntry[] = [
    { id: 1, date: "2026-08-14", time: "08:00", type: "entrada", note: null },
    { id: 2, date: "2026-08-14", time: "10:00", type: "saida", note: null },
    { id: 3, date: "2026-08-14", time: "10:15", type: "entrada", note: null },
    { id: 4, date: "2026-08-14", time: "12:00", type: "saida", note: null },
    { id: 5, date: "2026-08-14", time: "13:00", type: "entrada", note: null },
    { id: 6, date: "2026-08-14", time: "17:15", type: "saida", note: null },
  ];
  const day = computeDay(punches, settings);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.segments.length, 3, "três pares → wrap em ~3 linhas no mobile");
  assert.ok(dayCardSrc.includes("sm:flex sm:flex-wrap"));
  assert.ok(dayCardSrc.includes("min-[360px]:grid-cols-2"));
  assert.ok(dayCardSrc.includes("group flex w-full min-w-0 flex-wrap items-center"), "chip compacto com wrap interno");
  assert.ok(dayCardSrc.includes('aria-label="Editar"'), "editar no mini-card");
  assert.ok(dayCardSrc.includes('aria-label="Excluir"'), "excluir no mini-card");
  assert.ok(dayCardSrc.includes('e.type === "entrada" ? "Entrada" : "Saída"'));
});

console.log(`\nUX REGISTROS — OK (${passed} testes)`);
