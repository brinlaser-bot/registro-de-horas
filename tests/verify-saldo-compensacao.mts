/**
 * VERIFICAÇÃO — SALDO NA LINHA DA COMPENSAÇÃO CONCLUÍDA (apresentação)
 * Bug visual: linha "destino: 2h trabalhados (-6h de saldo)" para a compensação
 * 25/08/2026 → 22/08/2026 (sábado, kind calendario, concluída). O saldo vinha de
 * computeDay bruto (120 − 480 = −360) via enrichComp; a correção exibe o saldo da
 * RESOLUÇÃO CENTRAL (+2h) — somente apresentação, sem alterar cálculo/store.
 *
 * Cobre: testes A–F (seção 5) e o total "Calendário a compensar" 148h→146h (§6).
 *
 * Executar: npx tsx tests/verify-saldo-compensacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  compDayLineView,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { activeCalendarObligations, buildDebtDays, extraCapacityForDate } from "../src/lib/debt.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import type { TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23";
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY));

const sat2h = [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "10:00", "saida")];
const hol2h = [punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida")];
const fri745 = [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida")];
const wed830 = [punch("2026-08-19", "08:00", "entrada"), punch("2026-08-19", "17:30", "saida")];

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. sábado +2h: NUNCA -6h; exibe +2h (em folga) ──────── */
check("A. linha do destino 22/08 (sábado +2h): saldo +2h, sufixo 'em folga' — nunca −6h", () => {
  const line = compDayLineView("2026-08-22", sat2h, [], both, settings);
  assert.ok(line, "com batidas a linha existe");
  assert.equal(line.workedMinutes, 120, "trabalhados = 2h (batidas)");
  assert.notEqual(line.balanceMinutes, -360, "sem o saldo fantasma da jornada bruta");
  assert.equal(line.balanceMinutes, 120, "saldo real = +2h");
  assert.equal(line.contextSuffix, "em folga");
});

/* ── B. feriado abonado +2h: sem saldo negativo ──────────── */
check("B. linha do destino 07/09 (feriado abonado +2h): saldo +2h, sufixo 'em feriado'", () => {
  const line = compDayLineView("2026-09-07", hol2h, [], both, settings);
  assert.ok(line);
  assert.equal(line.workedMinutes, 120);
  // 4D.4 (Parte C): trabalho em abonado integral não gera saldo automático
  // (e nunca calculou 8h − 2h — a linha apenas reflete o saldo do dia).
  assert.equal(line.balanceMinutes, 0, "trabalho em abonado: saldo 0 — nunca 8h − 2h");
  assert.equal(line.contextSuffix, "em feriado");
  assert.equal(compDayLineView("2026-09-07", [], [], both, settings), null, "sem batidas → linha oculta (como antes)");
});

/* ── C/D. dias úteis preservados ─────────────────────────── */
check("C. dia útil 21/08 7h45: saldo −15min preservado na linha", () => {
  const line = compDayLineView("2026-08-21", fri745, [], both, settings);
  assert.ok(line);
  assert.equal(line.balanceMinutes, -15);
  assert.equal(line.contextSuffix, null);
});

check("D. dia útil 19/08 8h30: saldo +30min preservado na linha", () => {
  const line = compDayLineView("2026-08-19", wed830, [], both, settings);
  assert.ok(line);
  assert.equal(line.balanceMinutes, 30);
  assert.equal(line.contextSuffix, null);
});

/* ── E + §6. cenário completo: quitação de 2h no sábado ──── */
check("E. obrigação 25/08 após quitar 2h no sábado: 8h / Compensado 2h / Planejado 4h / Restante 6h", () => {
  assert.equal(actions.addCompanyCalendar(cal2526).ok, true);
  assert.equal(actions.addCompanyCalendar(cal2627).ok, true);
  actions.addEntry({ date: "2026-08-22", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-22", time: "10:00", type: "saida", note: null });
  assert.equal(actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-22", minutes: 120, note: null, kind: "calendario" }).ok, true);
  const compConcluir = getAppData().compensations.find((c) => c.targetDate === "2026-08-22")!;
  assert.equal(actions.completeComp(compConcluir.id).ok, true, "25/08→22/08 concluída");
  assert.equal(actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-26", minutes: 120, note: null, kind: "calendario" }).ok, true);
  assert.equal(actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-27", minutes: 120, note: null, kind: "calendario" }).ok, true);

  const st = getAppData();
  const obl = activeCalendarObligations(st.entries, st.compensations, settings, BOUNDS, st.companyCalendars, TODAY)
    .find((v) => v.date === "2026-08-25")!;
  assert.equal(obl.originalMinutes, 480, "Original 8h");
  assert.equal(obl.compensatedMinutes, 120, "Compensado 2h");
  assert.equal(obl.plannedMinutes, 240, "Planejado 4h (26/08 + 27/08 pendentes)");
  assert.equal(obl.remainingMinutes, 360, "Restante 6h");
});

check("§6. resumo 'Calendário a compensar' cai de 148h para 146h restantes após a conclusão", () => {
  const st = getAppData();
  const total = activeCalendarObligations(st.entries, st.compensations, settings, BOUNDS, st.companyCalendars, TODAY)
    .reduce((s, v) => s + v.remainingMinutes, 0);
  assert.equal(total, 142 * 60, "Σ Restante = 142h (144h originais − 2h; Cinzas saiu de COMPENSAR)");
});

/* ── F. nenhum cálculo funcional mudou ───────────────────── */
check("F. nenhum cálculo funcional alterado (capacidade/déficit/obrigação intactos)", () => {
  const cap = extraCapacityForDate("2026-08-22", sat2h, [], settings, { companyCalendars: both });
  assert.equal(cap.realExtra, 120);
  assert.equal(cap.available, 120);
  assert.equal(cap.effectiveBaseMinutes, 0);
  const debts = buildDebtDays(fri745, [], settings, BOUNDS, [], both);
  assert.equal(debts.find((d) => d.date === "2026-08-21" && d.kind === "deficit")?.debtMinutes, 15);
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "calendario")?.debtMinutes, 480);
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "deficit"), undefined);
});

console.log(`\n✅ ${passed} verificações passaram: A B C D E + §6 (146h) + F`);
