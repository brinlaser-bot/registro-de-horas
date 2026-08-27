/**
 * VERIFICAÇÃO — Recuperação da Parte 4 (Calendário da empresa)
 * cobrindo os testes obrigatórios A–U + regra de sábado/domingo.
 * Executar: npx tsx tests/verify-part4.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  calendarMonthlyTotals,
  companyBalanceContribution,
  companyDayContext,
  parseCompanyCalendarCsv,
  statsOf,
  type CompanyCalendar,
} from "../src/lib/company-calendar.ts";
import { dayContext, type Absence } from "../src/lib/absences.ts";
import { buildDebtDays, extraCapacityForDate } from "../src/lib/debt.ts";
import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { computeDay, expectedMinutesOf } from "../src/lib/time.ts";
import {
  annualCycleClose,
  getAnnualPointCycle,
  listDaysBetween,
  nextCycleStart,
  sameAnnualCycle,
} from "../src/lib/periods.ts";
import { buildExitPlan } from "../src/components/smart-exit.tsx";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
};

const user: User = {
  id: 1,
  name: "Teste Parte 4",
  email: "t@t.com",
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
};

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++,
  date,
  time,
  type,
  note: null,
});
const day4 = (date: string): TimeEntry[] => [
  punch(date, "08:00", "entrada"),
  punch(date, "12:00", "saida"),
];
const fullDay = (date: string, end = "17:00"): TimeEntry[] => [
  punch(date, "08:00", "entrada"),
  punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"),
  punch(date, end, "saida"),
];
const comp = (
  kind: Compensation["kind"],
  sourceDate: string,
  targetDate: string,
  minutes: number,
): Compensation => ({
  id: nextId++,
  sourceDate,
  targetDate,
  minutes,
  status: "pendente",
  note: null,
  createdAt: Date.now(),
  kind,
});
const absence = (a: Partial<Absence> & Pick<Absence, "kind" | "startDate" | "endDate">): Absence => ({
  id: nextId++,
  duration: "integral",
  createdAt: Date.now(),
  ...a,
});

// Fixture → calendário importado
const csv = readFileSync(new URL("./fixtures/calendario-sebrae-2025-2026.csv", import.meta.url), "utf8");
const preview = parseCompanyCalendarCsv(csv, settings);
assert.equal(preview.ok, true, `CSV inválido: ${preview.error}`);
const cal: CompanyCalendar = buildCompanyCalendar(preview.entries);
const CALS: CompanyCalendar[] = [cal];

const cctx = (date: string, entries: TimeEntry[] = [], absences: Absence[] = [], calendars: CompanyCalendar[] | undefined = CALS) =>
  companyDayContext(date, entries, absences, calendars, settings);

const results: string[] = [];
const check = (id: string, fn: () => void) => {
  fn();
  results.push(id);
  console.log(`✔ ${id}`);
};

/* ── A. Fixture: 37 datas ─────────────────────────────── */
check("A. fixture: 37 datas", () => {
  assert.equal(preview.stats.count, 37);
  assert.equal(cal.entries.length, 37);
});

/* ── B. Total calendário: 148h + conferência mensal ───── */
check("B. total a compensar: 144h (Cinzas saiu de COMPENSAR) + mensal", () => {
  assert.equal(preview.stats.totalCompensar, 144 * 60);
  assert.equal(statsOf(cal.entries).totalCompensar, 144 * 60);
  const monthly = calendarMonthlyTotals(cal.entries);
  const expected: Record<string, number> = {
    "2025-05": 8, "2025-06": 8, "2025-07": 32, "2025-08": 8,
    "2025-09": 0, "2025-10": 0, "2025-11": 8, "2025-12": 40,
    "2026-01": 16, "2026-02": 8, "2026-03": 0, "2026-04": 16,
  };
  let total = 0;
  for (const [m, h] of Object.entries(expected)) {
    assert.equal(monthly[m] ?? 0, h * 60, `mês ${m}`);
    total += h;
  }
  assert.equal(total, 144);
});

/* ── C. Abonadas: 96h derivadas + 19 datas com obrigação ─ */
check("C. abonadas: 100h (Cinzas ABONADO_PARCIAL 4h) + 18 COMPENSAR", () => {
  assert.equal(preview.stats.compensar, 18);
  assert.equal(preview.stats.abonados, 19);
  assert.equal(preview.stats.totalAbonado, 100 * 60);
});

/* ── D. Dezembro: 40h ──────────────────────────────────── */
check("D. dezembro: 40h", () => {
  assert.equal(calendarMonthlyTotals(cal.entries)["2025-12"], 40 * 60);
});

/* ── E. Cinzas: esperado 4h + obrigação 4h ─────────────── */
check("E. cinzas: ABONO PARCIAL 08–12 + jornada 13–17; sem COMPENSAR", () => {
  const v = cctx("2026-02-18");
  assert.equal(v.expectedRegular, 240);
  assert.equal(v.calendarioACompensar, 0);
  assert.equal(v.marker, "abono-parcial");
  assert.equal(v.label, "ABONO PARCIAL — CALENDÁRIO");
  assert.equal(v.effectiveExpected, 240);
});

/* ── F. Sábado sem batidas: folga + Smart Exit sem 17:00 ─ */
check("F. sábado 22/08/2026: Folga, esperado 0, saldo 0, Smart Exit sem 17:00", () => {
  const v = cctx("2026-08-22"); // sábado
  assert.equal(v.isWeekend, true);
  assert.equal(v.type, "folga");
  assert.equal(v.marker, "folga");
  assert.equal(v.effectiveExpected, 0, "esperado 0min");
  assert.equal(v.regularBalance, 0, "saldo 0");
  assert.equal(v.adjustedDeficit, 0, "déficit 0");
  assert.equal(v.displayDay.expectedMinutes, 0);
  assert.equal(v.displayDay.balanceMinutes, 0);
  const plan = buildExitPlan(v.displayDay, settings, [], 17 * 60, "2026-08-22", v.effectiveExpected);
  assert.equal(plan.state, "no-punch");
  assert.notEqual(plan.plannedExit, "17:00", "Smart Exit não pode prever 17:00 em folga");
  // Com base (effectiveExpected) = 0, a UI de no-punch exibe "Hoje é folga" sem horário previsto.
});

/* ── G. Sábado com 08:00–12:00: trabalho em folga +4h ──── */
check("G. sábado com 08:00–12:00: trabalho em folga, esperado 0, saldo +4h", () => {
  const date = "2026-08-15"; // sábado
  const v = cctx(date, day4(date));
  assert.equal(v.type, "trabalho-folga");
  assert.equal(v.marker, "trabalho-folga");
  assert.equal(v.displayDay.workedMinutes, 240);
  assert.equal(v.expectedRegular, 0);
  assert.equal(v.regularBalance, 240, "saldo = +4h");
  assert.equal(v.adjustedDeficit, 0);
});

/* ── H. Feriado útil: 8h abonadas, saldo 0 ─────────────── */
check("H. feriado útil (01/05/2025): trabalhado 0, abonado 8h, carga 8h, saldo 0", () => {
  const v = cctx("2025-05-01");
  assert.equal(v.displayDay.workedMinutes, 0);
  assert.equal(v.expectedRegular, 0);
  assert.equal(v.abonadasMinutes, 480);
  assert.equal(v.cargaConsiderada, 480);
  assert.equal(v.regularBalance, 0);
  assert.equal(v.marker, "feriado");
  assert.match(v.label ?? "", /^Feriado — Dia do Trabalho/);
});

/* ── I. Feriado em fim de semana: 0h abonadas ──────────── */
check("I. feriado em sábado (15/11/2025): abonado 0, carga 0", () => {
  const v = cctx("2025-11-15");
  assert.equal(v.isWeekend, true);
  assert.equal(v.marker, "feriado");
  assert.equal(v.abonadasMinutes, 0);
  assert.equal(v.cargaConsiderada, 0);
});

/* ── J. Calendário a compensar: kind "calendario" ──────── */
check("J. obrigação de calendário gera kind \"calendario\" (recesso 12/2025)", () => {
  const days = buildDebtDays([], [], settings, { from: "2025-12-22", to: "2025-12-23" }, [], CALS);
  const calDays = days.filter((d) => d.kind === "calendario");
  assert.equal(calDays.length, 2);
  assert.deepEqual(calDays.map((d) => d.debtMinutes), [480, 480]);
  const otherKinds = days.filter((d) => d.kind !== "calendario");
  assert.equal(otherKinds.length, 0, "saldo regular/déficit comum permanecem 0");
  // Sem calendário importado, nada muda:
  assert.equal(buildDebtDays([], [], settings, { from: "2025-12-22", to: "2025-12-23" }).length, 0);
});

/* ── K. Acordo antigo: kind "acordo" preservado ────────── */
check("K. acordo antigo: kind \"acordo\" inalterado (sem calendário)", () => {
  const abs = [absence({ kind: "acordado", startDate: "2025-08-06", endDate: "2025-08-06", treatment: "compensar" })];
  const days = buildDebtDays([], [], settings, { from: "2025-08-06", to: "2025-08-06" }, abs);
  assert.equal(days.length, 1);
  assert.equal(days[0].kind, "acordo");
  assert.equal(days[0].debtMinutes, 480);
});

/* ── L. Hora positiva não quita duas obrigações ────────── */
check("L. consumo único: deficit + acordo + calendario disputam a mesma hora extra", () => {
  const date = "2025-08-07"; // quinta, 9h trabalhadas → 1h extra real
  const entries = fullDay(date, "18:00");
  const cap0 = extraCapacityForDate(date, entries, [], settings);
  assert.equal(cap0.realExtra, 60);
  assert.equal(cap0.available, 60);
  // Obrigação de déficit consome → nada sobra para a de calendário:
  const cap1 = extraCapacityForDate(date, entries, [comp("deficit", "2025-08-05", date, 60)], settings);
  assert.equal(cap1.available, 0);
  // Idem com ordem inversa (calendário consome):
  const cap2 = extraCapacityForDate(date, entries, [comp("calendario", "2025-12-22", date, 60)], settings);
  assert.equal(cap2.available, 0);
  // E com acordo:
  const cap3 = extraCapacityForDate(date, entries, [comp("acordo", "2025-08-06", date, 60)], settings);
  assert.equal(cap3.alreadyAllocated, 60);
  assert.equal(cap3.available, 0);
});

/* ── M. Férias: saldo 0 ────────────────────────────────── */
check("M. férias integral (11/08/2025): saldo 0, sem déficit", () => {
  const abs = [absence({ kind: "ferias", startDate: "2025-08-11", endDate: "2025-08-11" })];
  const v = cctx("2025-08-11", [], abs);
  assert.equal(v.type, "evento");
  assert.equal(v.effectiveExpected, 0);
  assert.equal(v.adjustedBalance, 0);
  assert.equal(v.adjustedDeficit, 0);
});

/* ── N. Saúde parcial: saldo 0 ─────────────────────────── */
check("N. saúde parcial 13:00–17:00 + manhã trabalhada (12/08/2025): saldo 0", () => {
  const date = "2025-08-12";
  const abs = [absence({ kind: "saude", startDate: date, endDate: date, duration: "parcial", partialStart: "13:00", partialEnd: "17:00", medicalCert: true })];
  const v = cctx(date, day4(date), abs, undefined);
  assert.equal(v.effectiveExpected, 240);
  assert.equal(v.regularBalance, 0);
  assert.equal(v.adjustedDeficit, 0);
});

/* ── O. Déficit real: −15min ────────────────────────────── */
check("O. déficit real: −15min (13/08/2025)", () => {
  const date = "2025-08-13";
  const entries = [
    punch(date, "08:00", "entrada"), punch(date, "11:45", "saida"),
    punch(date, "13:00", "entrada"), punch(date, "17:00", "saida"),
  ];
  const v = cctx(date, entries, [], undefined);
  assert.equal(v.displayDay.workedMinutes, 465);
  assert.equal(v.regularBalance, -15);
  assert.equal(v.adjustedDeficit, 15);
});

/* ── P. Saldo positivo: +30min ─────────────────────────── */
check("P. saldo positivo: +30min (14/08/2025)", () => {
  const date = "2025-08-14";
  const v = cctx(date, fullDay(date, "17:30"), [], undefined);
  assert.equal(v.regularBalance, 30);
  const ctx = dayContext(date, fullDay(date, "17:30"), [], settings);
  assert.equal(ctx.adjustedBalance, 30, "matemática de saldo regular inalterada");
});

/* ── Q. Smart Exit dia útil: 08:37 → 17:37 ─────────────── */
check("Q. smart exit dia útil com entrada 08:37 → saída prevista 17:37", () => {
  const date = "2026-08-21"; // sexta-feira
  const entries = [punch(date, "08:37", "entrada")];
  const day = computeDay(entries, settings, 9 * 60);
  const plan = buildExitPlan(day, settings, [], 9 * 60, date);
  assert.equal(plan.plannedExit, "17:37");
  assert.equal(plan.state, "planned");
});

/* ── R. Fechamento anual: 30/04 → 01/05 isolado ────────── */
check("R. fechamento anual 30/04→01/05: obrigação de calendário não cruza ciclo", () => {
  assert.equal(sameAnnualCycle("2026-04-30", "2026-05-01"), false);
  assert.equal(annualCycleClose(getAnnualPointCycle("2026-04-30")), "2026-04-30");
  assert.equal(nextCycleStart(getAnnualPointCycle("2026-04-30")), "2026-05-01");
  // Obrigação de 20/04/2026 existe só no ciclo anterior:
  const antes = buildDebtDays([], [], settings, { from: "2026-04-01", to: "2026-04-30" }, [], CALS);
  assert.deepEqual(antes.filter((d) => d.kind === "calendario").map((d) => d.date), ["2026-04-02", "2026-04-20"]);
  const depois = buildDebtDays([], [], settings, { from: "2026-05-01", to: "2026-05-31" }, [], CALS);
  assert.equal(depois.filter((d) => d.kind === "calendario").length, 0);
});

/* ── S. Backup antigo sem calendário: continua válido ──── */
check("S. backup v1/antigo sem calendário importa normalmente", () => {
  const old = {
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    entries: day4("2025-08-15").map((e) => ({ ...e })),
    compensations: [],
  };
  const r = parseBackup(JSON.stringify(old));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.backup.companyCalendars, undefined);
    assert.deepEqual(r.backup.absences, []);
    assert.equal(r.backup.entries.length, 2);
  }
});

/* ── T. Backup com calendário: restaura calendário ─────── */
check("T. backup com calendário: ida e volta preserva as 37 datas/148h", () => {
  const payload = buildBackupPayload({ user, entries: [], compensations: [], absences: [], companyCalendars: CALS });
  const r = parseBackup(JSON.stringify(payload));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.backup.companyCalendars?.length, 1);
    assert.equal(r.backup.companyCalendars?.[0].entries.length, 37);
    assert.equal(statsOf(r.backup.companyCalendars![0].entries).totalCompensar, 144 * 60);
    assert.equal(statsOf(r.backup.companyCalendars![0].entries).totalAbonado, 100 * 60);
  }
});

/* ── U. Registros e Resumo: mesmo saldo regular ────────── */
check("U. saldo regular idêntico em Registros e Resumo para o mesmo período", () => {
  // Cenário misto: dia normal +30, dia −15, sábado trabalhado +4h, feriado útil, cinzas sem batidas, férias
  const abs = [absence({ kind: "ferias", startDate: "2025-08-11", endDate: "2025-08-11" })];
  const entries = [
    ...fullDay("2025-08-14", "17:30"),
    punch("2025-08-13", "08:00", "entrada"), punch("2025-08-13", "11:45", "saida"),
    punch("2025-08-13", "13:00", "entrada"), punch("2025-08-13", "17:00", "saida"),
    ...day4("2025-08-16"), // sábado trabalhado
  ];
  const range = { from: "2025-08-11", to: "2025-08-17" };

  // Como o Resumo agrega: todos os dias do período
  const saldoResumo = listDaysBetween(range.from, range.to)
    .map((d) => companyBalanceContribution(cctx(d, entries, abs)))
    .reduce((s, v) => s + v, 0);

  // Como Registros agrega: apenas datas com dados explícitos (batidas/ausência/calendário)
  const dates = new Set<string>();
  for (const e of entries) if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
  for (const a of abs) dates.add(a.startDate);
  for (const e of cal.entries) if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
  const saldoRegistros = [...dates]
    .map((d) => companyBalanceContribution(cctx(d, entries, abs)))
    .reduce((s, v) => s + v, 0);

  assert.equal(saldoRegistros, saldoResumo, "agregador central divergiu");
  assert.equal(saldoResumo, +30 - 15 + 240, "saldo esperado do cenário: +4h15min");
  // Dias sem dados e fins de semana sem batidas não geram saldo artificial:
  assert.equal(companyBalanceContribution(cctx("2025-08-12", entries, abs)), 0);
  assert.equal(companyBalanceContribution(cctx("2025-08-17", entries, abs)), 0);
});

console.log(`\n✅ ${results.length}/21 verificações passaram: ${results.map((r) => r.split(".")[0]).join(" ")}`);
