/**
 * TESTE DE INTEGRAÇÃO DA PÁGINA REGISTROS (microcorreção do saldo -8h)
 * Reproduz a MESMA transformação da UI:
 *   registros/page.tsx → days map → DayCard (balanceView/displayDay) → Resumo do período
 * Executar: npx tsx tests/verify-registros-integration.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyBalanceContribution,
  companyDayBalanceView,
  companyDayContext,
  companyDeficitContribution,
  parseCompanyCalendarCsv,
  type CompanyCalendar,
} from "../src/lib/company-calendar.ts";
import { buildDebtDays } from "../src/lib/debt.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Compensation, TimeEntry, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
};

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

const csv = readFileSync(new URL("./fixtures/calendario-sebrae-2025-2026.csv", import.meta.url), "utf8");
const parsed = parseCompanyCalendarCsv(csv, settings);
assert.equal(parsed.ok, true);
const cal: CompanyCalendar = buildCompanyCalendar(parsed.entries);
const CALS: CompanyCalendar[] = [cal];

/* ═══ Réplica EXATA da transformação da página Registros ═══ */

function pageDay(
  date: string,
  entries: TimeEntry[],
  absences: Absence[],
  calendars: CompanyCalendar[] | undefined,
) {
  // 1:1 com o days map de registros/page.tsx
  const cctx = companyDayContext(date, entries, absences, calendars, settings);
  return {
    date,
    ctx: cctx.ctx,
    calendarLabel: cctx.label,
    balanceView: companyDayBalanceView(cctx), // → prop balanceView do DayCard
    displayDay: cctx.displayDay,              // → prop result do DayCard
    balanceContribution: companyBalanceContribution(cctx),
    deficitContribution: companyDeficitContribution(cctx),
    absence: absences.find((a) => date >= a.startDate && date <= a.endDate),
    cctx,
  };
}

/** Réplica do agregador "Resumo do período" de Registros (por ciclo anual). */
function registrosPeriodSummary(
  range: { from: string; to: string },
  entries: TimeEntry[],
  absences: Absence[],
  calendars: CompanyCalendar[] | undefined,
) {
  const dates = new Set<string>();
  for (const e of entries) if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
  for (const a of absences) {
    let cur = a.startDate;
    while (cur <= a.endDate) { if (cur >= range.from && cur <= range.to) dates.add(cur); cur = addDay(cur); }
  }
  for (const e of (calendars ?? []).flatMap((c) => c.entries)) if (e.date >= range.from && e.date <= range.to) dates.add(e.date);

  const byCycle = new Map<string, { balance: number; deficit: number }>();
  for (const date of dates) {
    const d = pageDay(date, entries, absences, calendars);
    const cycle = getAnnualPointCycle(date);
    const s = byCycle.get(cycle) ?? { balance: 0, deficit: 0 };
    s.balance += d.balanceContribution;
    s.deficit += d.deficitContribution;
    byCycle.set(cycle, s);
  }
  return byCycle;
}
function addDay(d: string): string {
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/* ═══ Casos de aceite (seções 5–10 e 15) ═══ */

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

check("§5 Tiradentes 21/04/2026: card saldo 0, abonado 8h, carga 8h; período déficit 0 e saldo 0", () => {
  const d = pageDay("2026-04-21", [], [], CALS);
  assert.equal(d.calendarLabel, "Feriado — Tiradentes");
  assert.equal(d.displayDay.workedMinutes, 0, "trabalhado 0min");
  assert.equal(d.cctx.abonadasMinutes, 480, "abonado 8h");
  assert.equal(d.cctx.cargaConsiderada, 480, "carga considerada 8h");
  assert.equal(d.balanceView.effectiveExpected, 0);
  assert.equal(d.balanceView.adjustedBalance, 0, "card saldo NUNCA -8h");
  assert.equal(d.balanceView.adjustedDeficit, 0, "card déficit 0");
  const per = registrosPeriodSummary({ from: "2026-04-21", to: "2026-04-30" }, [], [], CALS);
  const ciclo = per.get(getAnnualPointCycle("2026-04-21"))!;
  assert.equal(ciclo.deficit, 0, "Tiradentes NÃO adiciona 8h ao déficit do período");
  assert.equal(ciclo.balance, 0, "saldo do período = 0");
});

check("§6 Dia do Trabalho 01/05/2025: abonado integral ⇒ saldo 0, déficit 0 (4D.4)", () => {
  const d = pageDay("2025-05-01", [], [], CALS);
  assert.equal(d.calendarLabel, "Feriado — Dia do Trabalho");
  assert.equal(d.cctx.abonadasMinutes, 480);
  assert.equal(d.cctx.cargaConsiderada, 480);
  assert.equal(d.balanceView.adjustedBalance, 0, "crédito 8h cumpre a jornada (nunca -8h)");
  assert.equal(d.balanceView.adjustedDeficit, 0);
  const per = registrosPeriodSummary({ from: "2025-04-21", to: "2025-05-20" }, [], [], CALS);
  /* 4D.4 (Partes D/G/I): no período há UMA folga a compensar passada sem
   * trabalho (02/05) — −8h FACTUAL (evento explícito é fato suficiente;
   * não é "Sem registro" nem obrigação paralela). */
  assert.equal(per.get(getAnnualPointCycle("2025-05-01"))!.deficit, 480);
});

check("§7 Folga a compensar 02/05/2025: saldo factual −8h, déficit do dia 8h, obrigação calendário 8h na Central", () => {
  const d = pageDay("2025-05-02", [], [], CALS);
  assert.equal(d.calendarLabel, "Folga a compensar — Calendário");
  assert.equal(d.balanceView.effectiveExpected, 0, "jornada esperada regular 0");
  /* 4D.4 (Parte D): folga integral realizada sem trabalho ⇒ saldo −8h
   * (uma única contribuição factual — nunca saldo 0 + obrigação paralela). */
  assert.equal(d.balanceView.adjustedBalance, -480, "saldo factual −8h");
  assert.equal(d.deficitContribution, 480, "déficit do dia = 8h necessárias não trabalhadas");
  const debts = buildDebtDays([], [], settings, { from: "2025-05-02", to: "2025-05-02" }, [], CALS);
  assert.deepEqual(
    debts.map((x) => [x.kind, x.debtMinutes]),
    [["calendario", 480]],
    "obrigação original segue na Central (SEM dupla contagem: sem kind deficit)",
  );
});

check("§8 Sábado com evento 10/05/2025: tudo 0, label preservado (nunca -8h)", () => {
  const d = pageDay("2025-05-10", [], [], CALS);
  assert.equal(d.calendarLabel, "Feriado — Aniversário do SEBRAE/PA");
  assert.equal(d.cctx.isWeekend, true);
  assert.equal(d.displayDay.workedMinutes, 0);
  assert.equal(d.balanceView.effectiveExpected, 0);
  assert.equal(d.cctx.abonadasMinutes, 0);
  assert.equal(d.cctx.cargaConsiderada, 0);
  assert.equal(d.balanceView.adjustedBalance, 0);
  assert.equal(d.balanceView.adjustedDeficit, 0);
  const per = registrosPeriodSummary({ from: "2025-04-21", to: "2025-05-20" }, [], [], CALS);
  /* 4D.4: mesmo período da §6 — a folga 02/05 passada sem trabalho é −8h
   * factual (o sábado 10/05 em si continua tudo 0). */
  assert.equal(per.get(getAnnualPointCycle("2025-05-10"))!.deficit, 480);
});

check("§9a Feriado em domingo 07/09/2025: tudo 0", () => {
  const d = pageDay("2025-09-07", [], [], CALS);
  assert.equal(d.calendarLabel, "Feriado — Independência do Brasil");
  assert.equal(d.cctx.isWeekend, true);
  assert.equal(d.cctx.abonadasMinutes, 0);
  assert.equal(d.cctx.cargaConsiderada, 0);
  assert.equal(d.balanceView.adjustedBalance, 0);
  assert.equal(d.deficitContribution, 0);
});

check("§9b Abono em dia útil 24/12/2025: abonado 8h, carga 8h, saldo 0, déficit 0", () => {
  const d = pageDay("2025-12-24", [], [], CALS);
  assert.equal(d.calendarLabel, "Abono — Abonado");
  assert.equal(d.displayDay.workedMinutes, 0);
  assert.equal(d.cctx.abonadasMinutes, 480);
  assert.equal(d.cctx.cargaConsiderada, 480);
  assert.equal(d.balanceView.adjustedBalance, 0);
  assert.equal(d.deficitContribution, 0);
});

check("§9c Recesso 22/12/2025: saldo factual −8h (4D.4), obrigação original 8h na Central", () => {
  const d = pageDay("2025-12-22", [], [], CALS);
  assert.match(d.calendarLabel ?? "", /^Recesso de final de ano/);
  assert.equal(d.balanceView.effectiveExpected, 0);
  /* 4D.4 (Parte D): recesso integral passado sem trabalho ⇒ −8h factual
   * (uma única contribuição; a obrigação original segue na Central). */
  assert.equal(d.balanceView.adjustedBalance, -480);
  assert.equal(d.deficitContribution, 480);
  const debts = buildDebtDays([], [], settings, { from: "2025-12-22", to: "2025-12-22" }, [], CALS);
  assert.deepEqual(debts.map((x) => x.kind), ["calendario"]);
  assert.equal(debts[0].debtMinutes, 480);
});

check("§9d Cinzas 18/02/2026: ABONO PARCIAL 08–12; jornada 13–17; manhã não quita a tarde", () => {
  const manha = [punch("2026-02-18", "08:00", "entrada"), punch("2026-02-18", "12:00", "saida")];
  const d = pageDay("2026-02-18", manha, [], CALS);
  assert.equal(d.calendarLabel, "ABONO PARCIAL — CALENDÁRIO");
  assert.equal(d.balanceView.effectiveExpected, 240, "jornada da tarde 4h");
  assert.equal(d.deficitContribution, 240, "trabalho na janela abonada NÃO quita a tarde");
  const debts = buildDebtDays(manha, [], settings, { from: "2026-02-18", to: "2026-02-18" }, [], CALS);
  assert.equal(debts.find((x) => x.kind === "calendario"), undefined, "sem obrigação COMPENSAR");
  const tarde = [punch("2026-02-18", "13:00", "entrada"), punch("2026-02-18", "17:00", "saida")];
  const dTarde = pageDay("2026-02-18", tarde, [], CALS);
  assert.equal(dTarde.deficitContribution, 0);
  const d2 = pageDay("2026-02-18", [], [], CALS);
  assert.equal(d2.balanceView.adjustedDeficit, 240, "sem trabalho na tarde = déficit 4h");
  assert.notEqual(d2.balanceView.adjustedDeficit, 480);
});

check("§10 Igualdade card↔resumo: saldo diário agregado === resumo; déficit diário === resumo", () => {
  // Cenário misto num período: dia normal +30, dia −15, feriado (01/05), fds trabalhado +4h
  const entries = [
    punch("2025-05-05", "08:00", "entrada"), punch("2025-05-05", "12:00", "saida"),
    punch("2025-05-05", "13:00", "entrada"), punch("2025-05-05", "17:30", "saida"), // +30
    punch("2025-05-06", "08:00", "entrada"), punch("2025-05-06", "11:45", "saida"),
    punch("2025-05-06", "13:00", "entrada"), punch("2025-05-06", "17:00", "saida"), // −15
    punch("2025-05-03", "08:00", "entrada"), punch("2025-05-03", "12:00", "saida"), // sábado +4h
  ];
  const range = { from: "2025-04-21", to: "2025-05-20" };
  const dates = new Set<string>(entries.map((e) => e.date));
  for (const e of cal.entries) if (e.date >= range.from && e.date <= range.to) dates.add(e.date);

  let sumBalance = 0, sumDeficit = 0;
  for (const date of dates) {
    const d = pageDay(date, entries, [], CALS);
    // card do dia coerente com a resolução central:
    assert.equal(d.balanceView.adjustedBalance, d.cctx.adjustedBalance);
    sumBalance += d.balanceContribution;
    sumDeficit += d.deficitContribution;
  }
  const per = registrosPeriodSummary(range, entries, [], CALS);
  const ciclo = per.get(getAnnualPointCycle("2025-05-01"))!;
  assert.equal(ciclo.balance, sumBalance, "saldo: resumo === soma dos cards");
  assert.equal(ciclo.deficit, sumDeficit, "déficit: resumo === soma dos cards");
  // sanidade do valor: +30 −15 +240 (fds) +0 (01/05 abonado) −480 (02/05 folga
  // compensar passada sem trabalho — 4D.4: fato suficiente) = −225min
  assert.equal(sumBalance, -225);
  // déficit: 15min reais + 8h da folga 02/05 (déficit do dia = necessário não cumprido)
  assert.equal(sumDeficit, 495);
});

check("§15 Resumo do período principal usa a mesma resolução central (resumo/page.tsx)", () => {
  // resumo/page.tsx: balanceTotal = Σ companyBalanceContribution(companyDayContext(...))
  // sobre TODOS os dias de listDaysBetween — dias vazios/fds contribuem 0.
  const range = { from: "2026-04-21", to: "2026-04-30" };
  const resumoBalance = [];
  let d = new Date(`${range.from}T12:00:00`);
  let total = 0;
  while (true) {
    const p = (n: number) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    if (date > range.to) break;
    resumoBalance.push(companyBalanceContribution(companyDayContext(date, [], [], CALS, settings)));
    total = resumoBalance.reduce((s, v) => s + v, 0);
    d.setDate(d.getDate() + 1);
  }
  assert.equal(total, 0, "Resumo do período 21/04→30/04/2026 sem batidas = 0, sem -8h");
});

console.log(`\n✅ ${passed} verificações de integração passaram`);
