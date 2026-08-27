/**
 * VERIFICAÇÃO — MULTI-CALENDÁRIO POR CICLO ANUAL (testes A–P da seção 21)
 * Executar: npx tsx tests/verify-multicalendar.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  calendarMonthlyTotals,
  companyBalanceContribution,
  companyCalendarForDate,
  companyDayContext,
  cycleStatusOf,
  normalizeCompanyCalendars,
  parseCompanyCalendarCsv,
  statsOf,
  type CompanyCalendar,
} from "../src/lib/company-calendar.ts";
import { buildDebtDays } from "../src/lib/debt.ts";
import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import type { Absence } from "../src/lib/absences.ts";
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
const csv2526 = read("calendario-sebrae-2025-2026.csv");
const csv2627 = read("calendario-ficticio-2026-2027.csv");
const p2526 = parseCompanyCalendarCsv(csv2526, settings);
const p2627 = parseCompanyCalendarCsv(csv2627, settings);
assert.equal(p2526.ok, true); assert.equal(p2627.ok, true);
const cal2526 = buildCompanyCalendar(p2526.entries);
const cal2627 = buildCompanyCalendar(p2627.entries);
const both = [cal2526, cal2627];

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. Migração do calendário único existente ─────────── */
check("A. migração companyCalendar → companyCalendars (37 datas/144h/100h — Cinzas = ABONADO_PARCIAL)", () => {
  // Formato ANTIGO persistido: objeto único sem campos de ciclo
  const legacy = { version: 1, importedAt: "2026-08-22T00:00:00.000Z", entries: p2526.entries };
  const migrated = normalizeCompanyCalendars(legacy);
  assert.equal(migrated?.length, 1);
  const c = migrated![0];
  assert.equal(c.cycleStart, "2025-05-01");
  assert.equal(c.cycleEnd, "2026-04-30");
  assert.equal(c.cycleLabel, "2025–2026");
  assert.equal(c.entries.length, 37);
  assert.equal(statsOf(c.entries).totalCompensar, 144 * 60);
  assert.equal(statsOf(c.entries).totalAbonado, 100 * 60);
});

/* ── B. Adicionar 2026–2027: os dois coexistem ─────────── */
check("B. importar 2026–2027 NÃO apaga 2025–2026 (store em memória)", () => {
  assert.equal(actions.addCompanyCalendar(cal2526).ok, true);
  assert.equal(actions.addCompanyCalendar(cal2627).ok, true);
  const cals = getAppData().companyCalendars ?? [];
  assert.equal(cals.length, 2, "devem existir OS DOIS");
  assert.deepEqual(cals.map((c) => c.cycleLabel), ["2025–2026", "2026–2027"]);
  assert.equal(statsOf(cals[0].entries).totalCompensar, 144 * 60);
  assert.equal(statsOf(cals[0].entries).totalAbonado, 100 * 60, "2025–2026 íntegro (Cinzas +4h abonadas)");
  assert.equal(statsOf(cals[1].entries).totalAbonado, 116 * 60, "2026–2027 = 116h abonadas (Cinzas ABONADO_PARCIAL 4h)");
  assert.equal(p2627.stats.compensar, 18, "2026–2027 = 18 obrigações");
  assert.equal(p2627.stats.totalCompensar, 144 * 60, "2026–2027 = 144h");
});

/* ── C/D. Seleção automática do calendário pela data ───── */
check("C/D. companyCalendarForDate e companyDayContext resolvem o ciclo pela data", () => {
  assert.equal(companyCalendarForDate("2025-05-02", both)?.cycleLabel, "2025–2026");
  assert.equal(companyCalendarForDate("2025-08-25", both)?.cycleLabel, "2025–2026");
  assert.equal(companyCalendarForDate("2026-08-25", both)?.cycleLabel, "2026–2027");
  assert.equal(companyCalendarForDate("2027-04-21", both)?.cycleLabel, "2026–2027");
  assert.equal(companyCalendarForDate("2027-05-01", both), undefined, "fora dos ciclos → nenhum");
  // 25/08/2026 → obrigação ativa 8h do ciclo 2026–2027
  const v = companyDayContext("2026-08-25", [], [], both, settings);
  assert.equal(v.label, "Folga a compensar — Calendário");
  assert.equal(v.calendarioACompensar, 480);
  assert.equal(v.adjustedDeficit, 0, "déficit comum 0");
  // 07/09/2026 Independência → 8h abonadas; 15/11/2026 domingo → 0h
  assert.equal(companyDayContext("2026-09-07", [], [], both, settings).abonadasMinutes, 480);
  const dom = companyDayContext("2026-11-15", [], [], both, settings);
  assert.equal(dom.abonadasMinutes, 0);
  assert.equal(dom.cargaConsiderada, 0);
  assert.equal(dom.adjustedBalance, 0);
  // 24/12/2026 Abono → 8h; 21/12/2026 Recesso → 8h a compensar; 10/02/2027 Cinzas = ABONO PARCIAL
  assert.equal(companyDayContext("2026-12-24", [], [], both, settings).abonadasMinutes, 480);
  assert.equal(companyDayContext("2026-12-21", [], [], both, settings).calendarioACompensar, 480);
  const cinzas = companyDayContext("2027-02-10", [], [], both, settings);
  assert.equal(cinzas.expectedRegular, 240);
  assert.equal(cinzas.calendarioACompensar, 0, "Cinzas não é COMPENSAR");
  assert.equal(cinzas.marker, "abono-parcial");
  assert.match(cinzas.label ?? "", /ABONO PARCIAL/);
});

/* ── E. Substituir 2026–2027 preserva 2025–2026 ────────── */
check("E. substituir ciclo 2026–2027 atinge SOMENTE esse ciclo", () => {
  const altered = buildCompanyCalendar(p2627.entries.slice(1)); // 36 datas
  assert.equal(actions.replaceCompanyCalendar(altered).ok, true);
  const cals = getAppData().companyCalendars ?? [];
  assert.equal(cals.length, 2);
  assert.equal(cals.find((c) => c.cycleLabel === "2025–2026")?.entries.length, 37, "2025–2026 intacto");
  assert.equal(cals.find((c) => c.cycleLabel === "2026–2027")?.entries.length, 36, "2026–2027 substituído");
  // restaura para os demais testes
  assert.equal(actions.replaceCompanyCalendar(cal2627).ok, true);
});

/* ── F. Excluir 2026–2027 preserva 2025–2026 ───────────── */
check("F. excluir 2026–2027 NÃO apaga 2025–2026", () => {
  assert.equal(actions.removeCompanyCalendar(cal2627.cycleStart).ok, true);
  let cals = getAppData().companyCalendars ?? [];
  assert.equal(cals.length, 1);
  assert.equal(cals[0].cycleLabel, "2025–2026");
  assert.equal(cals[0].entries.length, 37);
  assert.equal(actions.addCompanyCalendar(cal2627).ok, true); // recoloca p/ próximos testes
  cals = getAppData().companyCalendars ?? [];
  assert.equal(cals.length, 2);
});

/* ── G. Arquivo com dois ciclos: bloquear ──────────────── */
check("G. CSV com datas de dois ciclos é BLOQUEADO na importação", () => {
  const mixed = csv2526.trim() + "\n" + csv2627.trim().split("\n").slice(1).join("\n") + "\n";
  const r = parseCompanyCalendarCsv(mixed, settings);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /mais de um ciclo anual/);
  assert.match(r.error ?? "", /2025–2026/);
  assert.match(r.error ?? "", /2026–2027/);
});

/* ── H. Mesmo ciclo duplicado: não duplicar ────────────── */
check("H. importar ciclo já existente NÃO duplica (action recusa)", () => {
  const res = actions.addCompanyCalendar(buildCompanyCalendar(p2526.entries));
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /Já existe um calendário para o ciclo 2025–2026/);
  assert.equal((getAppData().companyCalendars ?? []).length, 2, "continua com 2, sem duplicata");
});

/* ── I. Backup antigo (companyCalendar único) compatível ─ */
check("I. backup antigo com companyCalendar único → coleção com 1 calendário", () => {
  const legacyBackup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    user,
    entries: [],
    compensations: [],
    absences: [],
    companyCalendar: { version: 1, importedAt: "2026-08-22T00:00:00.000Z", entries: p2526.entries },
  };
  const r = parseBackup(JSON.stringify(legacyBackup));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.backup.companyCalendars?.length, 1);
    assert.equal(r.backup.companyCalendars?.[0].cycleLabel, "2025–2026");
    assert.equal(statsOf(r.backup.companyCalendars![0].entries).totalCompensar, 144 * 60);
  }
});

/* ── J. Backup novo com dois ciclos: round-trip ─────────── */
check("J. backup v3 com dois ciclos: exporta → importa → mantém os dois", () => {
  const payload = buildBackupPayload({
    user, entries: [punch("2026-08-21", "08:00", "entrada")], compensations: [], absences: [],
    companyCalendars: both,
  });
  assert.equal(payload.version, 3);
  const r = parseBackup(JSON.stringify(payload));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.backup.companyCalendars?.length, 2);
    assert.equal(statsOf(r.backup.companyCalendars![0].entries).totalCompensar, 144 * 60);
    assert.equal(statsOf(r.backup.companyCalendars![1].entries).totalAbonado, 116 * 60);
    assert.equal(r.backup.entries.length, 1, "entries preservadas");
    assert.equal(r.backup.user.name, "Teste", "user preservado");
  }
});

/* ── K/L. Sábados preservados com multi-calendário ─────── */
check("K/L. sábado 22/08/2026: folga 0/0; sábado trabalhado: +4h", () => {
  const folga = companyDayContext("2026-08-22", [], [], both, settings);
  assert.equal(folga.type, "folga");
  assert.equal(folga.effectiveExpected, 0);
  assert.equal(folga.regularBalance, 0);
  const trab = companyDayContext("2026-08-15", [punch("2026-08-15", "08:00", "entrada"), punch("2026-08-15", "12:00", "saida")], [], both, settings);
  assert.equal(trab.type, "evento", "15/08/2026 é evento de calendário (Adesão do Pará, sábado)");
  assert.equal(trab.adjustedDeficit, 0);
  // sábado comum sem evento trabalhado:
  const trab2 = companyDayContext("2026-08-29", [punch("2026-08-29", "08:00", "entrada"), punch("2026-08-29", "12:00", "saida")], [], both, settings);
  assert.equal(trab2.type, "trabalho-folga");
  assert.equal(trab2.regularBalance, 240, "+4h");
});

/* ── M/N. Feriado útil saldo 0; calendário ≠ déficit ───── */
check("M/N. feriado útil saldo 0; obrigação calendário separada de déficit comum", () => {
  const v = companyDayContext("2026-09-07", [], [], both, settings);
  assert.equal(v.marker, "feriado");
  assert.equal(v.adjustedBalance, 0);
  assert.equal(v.adjustedDeficit, 0);
  const debts = buildDebtDays([], [], settings, { from: "2026-08-25", to: "2026-08-25" }, [], both);
  assert.deepEqual(debts.map((d) => [d.kind, d.debtMinutes]), [["calendario", 480]]);
});

/* ── O. Fechamento: obrigações isoladas por ciclo ──────── */
check("O. 30/04→01/05: obrigação não cruza ciclo; cada data usa seu calendário", () => {
  const ciclo2526 = annualCycleBounds(getAnnualPointCycle("2026-04-30"));
  const ciclo2627 = annualCycleBounds(getAnnualPointCycle("2026-05-01"));
  const d1 = buildDebtDays([], [], settings, ciclo2526, [], both).filter((d) => d.kind === "calendario");
  const d2 = buildDebtDays([], [], settings, ciclo2627, [], both).filter((d) => d.kind === "calendario");
  assert.equal(d1.some((d) => d.date === "2025-05-02"), true, "02/05/2025 no ciclo 2025–2026");
  assert.equal(d1.every((d) => d.date <= "2026-04-30"), true);
  assert.equal(d2.some((d) => d.date === "2026-08-25"), true, "25/08/2026 no ciclo 2026–2027");
  assert.equal(d2.some((d) => d.date === "2027-04-20"), true);
  assert.equal(d2.every((d) => d.date >= "2026-05-01" && d.date <= "2027-04-30"), true);
  const total = d1.reduce((s, d) => s + d.debtMinutes, 0) + d2.reduce((s, d) => s + d.debtMinutes, 0);
  assert.equal(total, (144 + 144) * 60, "soma das obrigações dos dois ciclos (Cinzas saiu de COMPENSAR)");
});

/* ── P. Registros/Resumo selecionam calendário pela data ── */
check("P. agregador central resolve o calendário certo por data (Registros/Resumo)", () => {
  assert.equal(companyBalanceContribution(companyDayContext("2026-09-07", [], [], both, settings)), 0, "feriado 2026–2027");
  assert.equal(companyBalanceContribution(companyDayContext("2025-05-01", [], [], both, settings)), 0, "feriado 2025–2026");
  assert.equal(cycleStatusOf(cal2526, "2026-08-22"), "encerrado");
  assert.equal(cycleStatusOf(cal2627, "2026-08-22"), "atual");
  assert.equal(cycleStatusOf(cal2627, "2026-04-01"), "futuro");
});

console.log(`\n✅ ${passed} verificações multi-calendário passaram (A–P)`);
