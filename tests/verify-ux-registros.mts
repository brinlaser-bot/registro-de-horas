/**
 * VERIFICAÇÃO — UX REGISTROS (atalhos removidos + chips sem truncar + Seed 3.1)
 *
 *  A  Página Registros / DayCard NÃO renderiza atalhos de ponto
 *  B  Registro manual continua no card (mobile/desktop) e o fluxo é o mesmo
 *  C  Mobile: "Entrada"/"Saída" inteiros; sem truncate; 2 colunas; sem overflow-x
 *  D  Desktop: batidas em fluxo horizontal/wrap
 *  E  Seed 3.1: 6 batidas em 14/08; restore determinístico; calendário + motivos
 *  F  Dia com 6 batidas: wrap no desktop, 2 colunas no mobile, editar/excluir
 *
 * Executar: npx tsx tests/verify-ux-registros.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildSeedData, SEED_VERSION } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import type { AppData, WorkSettings } from "../src/lib/types.ts";

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

assert.equal(SEED_VERSION, "3.1");

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

check("B. Registro manual continua no card e abre o mesmo fluxo", () => {
  assert.ok(dayCardSrc.includes("Adicionar batida"), "rótulo de inclusão");
  assert.ok(dayCardSrc.includes("setShowAdd(true)"));
  assert.ok(dayCardSrc.includes("suggestedPunchTypeAt"), "posição cronológica define o tipo");
  assert.ok(dayCardSrc.includes('source: "manual"'));
  assert.ok(dayCardSrc.includes("!futureDay && !abonoDay && (showAdd ?"), "guarda do formulário intacta");
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

check("E. Seed 3.1: 6 batidas, calendário, motivos, restore 2x idêntico", () => {
  actions.reseed();
  const first = snap(getAppData());
  actions.reseed();
  assert.equal(snap(getAppData()), first);
  assert.equal(first, snap(buildSeedData()), "reseed === buildSeedData");

  const d = getAppData();
  assert.equal((d.companyCalendars ?? []).length, 1, "calendário fictício presente");
  assert.equal((d.companyCalendars ?? [])[0].cycleStart, "2026-05-01");
  const byDate = new Map((d.excessReasons ?? []).map((r) => [r.date, r]));
  assert.equal(byDate.get("2026-08-24")?.reason, "demanda-urgente");
  assert.equal(byDate.get("2026-08-17")?.reason, "demanda-urgente");
  assert.equal(byDate.get("2026-08-18")?.reason, "atendimento-evento");
  assert.equal(byDate.has("2026-08-11"), false);
  assert.equal(d.entries.filter((e) => e.date === "2026-08-14").length, 6);
});

check("F. 14/08 com 6 batidas: 8h, wrap/2 colunas e editar/excluir no chip", () => {
  const seed = buildSeedData();
  const punches = seed.entries.filter((e) => e.date === "2026-08-14");
  assert.equal(punches.length, 6);
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
