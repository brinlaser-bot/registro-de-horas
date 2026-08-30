/**
 * VERIFICAÇÃO — ETAPA 1: SEPARAÇÃO [10+] vs SALDO REGULAR (fonte central)
 *
 * Regra: saldo regular = noPonto − baseEfetiva (NÃO trabalhadoReal − base),
 * onde noPonto = min(trabalhadoReal, limiteDiário). O excedente acima do
 * limite diário é [10+] separado e NUNCA entra no saldo regular.
 *
 *  A 10h30/base8 → no ponto 10h, saldo +2h, [10+] 30min (bug antigo: +2h30)
 *  B 11h30/base8 → no ponto 10h, saldo +2h, [10+] 1h30 (bug antigo: +3h30)
 *  C 10h/base8   → no ponto 10h, saldo +2h, [10+] 0
 *  D 8h30/base8  → saldo +30min
 *  E 7h30/base8  → saldo −30min
 *  F folga 11h   → saldo regular +10h, [10+] 1h; folga 6h → +6h
 *  G período 21/08→20/09 → saldo +2h e [10+] 30min
 *  H isolamento: Resumo/Visão/Registros/gráfico/API usam a MESMA regra central
 *  I regressões: sem registro, futuro, abono parcial, falta prevista,
 *    COMPENSAR, acordado-compensar, férias parcial, incompleto/inconsistente,
 *    intervalo automático, histórico/controlStartDate, fechamento anual,
 *    realocação/déficit intocados.
 *
 * Executar: npx tsx tests/verify-separacao-limite-diario.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dayContext, validateAbsence, type Absence } from "../src/lib/absences.ts";
import { buildCompanyCalendar, companyDayBalanceView, companyDayContext, parseCompanyCalendarCsv } from "../src/lib/company-calendar.ts";
import { actualExtraForDate, buildDebtDays, extraCapacityForDate } from "../src/lib/debt.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { dayCreditView } from "../src/lib/hour-bank.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { getPointPeriod, listDaysBetween } from "../src/lib/periods.ts";
import { actions, enrichComp, getAppData, settingsOf } from "../src/lib/store.ts";
import { computeDay, regularBalanceMinutes } from "../src/lib/time.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", ...settings, birthDate: null,
};
const TODAY = "2026-08-30";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(readFileSync(new URL("./fixtures/calendario-ficticio-2026-2027.csv", import.meta.url), "utf8"), settings).entries);

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
/** Dia com almoço explícito (08:00–12:00 + 13:00–saída). */
const day = (date: string, end: string) => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, end, "saida"),
];
/** Dia 7h30 (08–12 + 13–16:30). */
const day730 = (date: string) => day(date, "16:30");
/** Dia 8h30 (08–12 + 13–17:30). */
const day830 = (date: string) => day(date, "17:30");
/** Dia 10h (08–12 + 13–19:00). */
const day10h = (date: string) => day(date, "19:00");
/** Dia 10h30 (08–12 + 13–19:30). */
const day10h30 = (date: string) => day(date, "19:30");
/** Dia 11h30 (08–12 + 13–20:30). */
const day11h30 = (date: string) => day(date, "20:30");

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. 10h30 / base 8h ───────────────────────────────────── */
check("A. 10h30: fato bruto 630/600/30/150; derivado +2h; [10+] 30min; Trabalhado real preservado", () => {
  const date = "2026-08-25";
  const entries = day10h30(date);
  const dayF = computeDay(entries, settings);
  // FATO BRUTO (computeDay) — não é alterado nesta etapa:
  assert.equal(dayF.workedMinutes, 630, "trabalhado real 10h30");
  assert.equal(dayF.registrableMinutes, 600, "no ponto 10h");
  assert.equal(dayF.excessMinutes, 30, "[10+] 30min");
  assert.equal(dayF.balanceMinutes, 150, "fato bruto trabalhado−base = +2h30 (não é o saldo regular)");

  const ctx = dayContext(date, entries, [], settings);
  assert.equal(ctx.adjustedBalance, 120, "saldo regular = noPonto − base = +2h");
  const cctx = companyDayContext(date, entries, [], undefined, settings);
  assert.equal(cctx.regularBalance, 120);
  assert.equal(cctx.adjustedBalance, 120);
  assert.equal(cctx.displayDay.balanceMinutes, 120, "displayDay propaga o derivado");
  assert.equal(cctx.displayDay.workedMinutes, 630, "Trabalhado continua 10h30");
  const v = dayCreditView(date, entries, [], [], undefined, settings, []);
  assert.equal(v.regularExtra, 120, "crédito regular até o teto");
  assert.equal(v.excessSpecial, 30, "excedente especial separado");
  assert.equal(v.freeSpecial, 30);
});

/* ── B. 11h30 / base 8h ───────────────────────────────────── */
check("B. 11h30: derivado +2h; [10+] 1h30; gráfico extra 2h / excess 1h30", () => {
  const date = "2026-08-25";
  const entries = day11h30(date);
  const dayF = computeDay(entries, settings);
  assert.equal(dayF.workedMinutes, 690);
  assert.equal(dayF.excessMinutes, 90);
  assert.equal(dayF.registrableMinutes, 600);
  const cctx = companyDayContext(date, entries, [], undefined, settings);
  assert.equal(cctx.adjustedBalance, 120, "saldo regular = +2h (nunca +3h30)");
  const v = dayCreditView(date, entries, [], [], undefined, settings, []);
  assert.equal(v.regularExtra, 120);
  assert.equal(v.excessSpecial, 90);
  const bar = buildStackedPeriodData({
    entries, compensations: [], settings, period: { from: date, to: date }, today: TODAY,
  }).find((x) => x.date === date)!;
  assert.equal(bar.workedMinutes, 690);
  assert.equal(bar.extra, 120);
  assert.equal(bar.excess, 90);
  assert.equal(bar.regularBalance, 120, "tooltip do gráfico usa o saldo derivado");
});

/* ── C. 10h / base 8h ─────────────────────────────────────── */
check("C. 10h: no ponto 10h, saldo +2h, [10+] 0", () => {
  const date = "2026-08-25";
  const entries = day10h(date);
  const dayF = computeDay(entries, settings);
  assert.equal(dayF.workedMinutes, 600);
  assert.equal(dayF.excessMinutes, 0);
  assert.equal(dayF.registrableMinutes, 600);
  const cctx = companyDayContext(date, entries, [], undefined, settings);
  assert.equal(cctx.adjustedBalance, 120);
  assert.equal(cctx.adjustedDeficit, 0);
});

/* ── D. 8h30 → +30 ────────────────────────────────────────── */
check("D. 8h30: saldo +30min, [10+] 0", () => {
  const date = "2026-08-25";
  const cctx = companyDayContext(date, day830(date), [], undefined, settings);
  assert.equal(cctx.adjustedBalance, 30);
  assert.equal(cctx.ctx.day.excessMinutes, 0);
  assert.equal(dayContext(date, day830(date), [], settings).adjustedBalance, 30);
});

/* ── E. 7h30 → −30 ────────────────────────────────────────── */
check("E. 7h30: saldo −30min, déficit comum 30min", () => {
  const date = "2026-08-25";
  const cctx = companyDayContext(date, day730(date), [], undefined, settings);
  assert.equal(cctx.adjustedBalance, -30);
  assert.equal(cctx.adjustedDeficit, 30);
  const debts = buildDebtDays(day730(date), [], settings, { from: date, to: date }, [], undefined, [], TODAY);
  assert.ok(debts.some((d) => d.date === date && d.kind === "deficit" && d.debtMinutes === 30));
});

/* ── F. Folga: base 0, trabalho até o limite vira crédito ─── */
check("F. folga 11h: saldo regular +10h e [10+] 1h; folga 6h → +6h", () => {
  const date = "2026-08-22"; // sábado
  const e11 = day(date, "20:00"); // 08–12 + 13–20 = 11h
  const dayF = computeDay(e11, settings);
  assert.equal(dayF.workedMinutes, 660, "11h trabalhadas na folga");
  assert.equal(dayF.excessMinutes, 60, "[10+] 1h");
  const cctx = companyDayContext(date, e11, [], undefined, settings);
  assert.equal(cctx.type, "trabalho-folga");
  assert.equal(cctx.effectiveExpected, 0, "base da folga = 0");
  assert.equal(cctx.regularBalance, 600, "crédito regular até o teto de 10h");
  assert.equal(cctx.adjustedBalance, 600);
  assert.equal(cctx.displayDay.balanceMinutes, 600);
  assert.equal(cctx.displayDay.workedMinutes, 660, "Trabalhado real preservado (11h)");

  const e6 = day(date, "15:00"); // 08–12 + 13–15 = 6h
  const c6 = companyDayContext(date, e6, [], undefined, settings);
  assert.equal(c6.adjustedBalance, 360, "folga 6h → +6h");
  assert.equal(c6.ctx.day.excessMinutes, 0);
});

/* ── G. Período 21/08→20/09 (cenário manual, calendário isolado) ── */
check("G. período 21/08→20/09: 25/08 10h30 + 26/08 7h30 + 27/08 8h30 → saldo +2h e [10+] 30min", () => {
  const entries = [
    ...day10h30("2026-08-25"),
    ...day730("2026-08-26"),
    ...day830("2026-08-27"),
  ];
  const period = getPointPeriod(TODAY);
  assert.equal(period.from, "2026-08-21");
  assert.equal(period.to, "2026-09-20");
  let bal = 0, exc = 0, worked = 0;
  for (const date of listDaysBetween(period.from, period.to)) {
    const cctx = companyDayContext(date, entries, [], undefined, settings);
    bal += dayBalanceContribution(cctx, [], date, TODAY);
    exc += cctx.ctx.day.excessMinutes;
    worked += cctx.ctx.day.workedMinutes;
  }
  assert.equal(worked, 630 + 450 + 510, "trabalhado real somado (não é limitado)");
  assert.equal(bal, 120, "Saldo do período = +2h (25/08 +2h · 26/08 −30 · 27/08 +30)");
  assert.equal(exc, 30, "[10+] do período = 30min");
});

/* ── H. Isolamento: todas as superfícies consomem a regra central ── */
check("H. Resumo/Visão/Registros/gráfico/API/enriquecimentos usam a MESMA regra (10h30 → +2h)", () => {
  const date = "2026-08-25";
  const entries = day10h30(date);
  // Resumo do período (linha + agregação)
  const row = buildResumoDayRow({
    date, today: TODAY, entries, absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01",
  });
  assert.equal(row.balanceMinutes, 120, "linha do Resumo");
  assert.equal(row.balanceContribution, 120, "agregador do Resumo (Saldo do período)");
  assert.equal(row.registrableMinutes, 600);
  // Visão geral (page.tsx usa cctx.adjustedBalance para dias recentes)
  const cctx = companyDayContext(date, entries, [], undefined, settings);
  assert.equal(cctx.adjustedBalance, 120);
  // Registros (DayCard via companyDayBalanceView)
  assert.equal(companyDayBalanceView(cctx).adjustedBalance, 120);
  // Gráfico empilhado
  const bar = buildStackedPeriodData({
    entries, compensations: [], settings, period: { from: date, to: date }, today: TODAY,
  }).find((x) => x.date === date)!;
  assert.equal(bar.regularBalance, 120);
  assert.equal(bar.extra, 120);
  assert.equal(bar.excess, 30);
  // API dashboard (legacy) usa a resolução central
  const dash = srcOf("src/app/api/dashboard/route.ts");
  assert.ok(dash.includes("companyDayContext"), "rota usa a resolução central");
  assert.ok(dash.includes("adjustedBalance"), "rota usa o saldo derivado");
  // enrichComp / enrichCompensations: saldo do dia de destino derivado
  const comp: Compensation = {
    id: 1, sourceDate: "2026-08-21", targetDate: date, minutes: 60,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const ec = enrichComp(comp, entries, settings);
  assert.equal(ec.targetDay?.balanceMinutes, 120, "destino 10h30 → +2h (não +2h30)");
  // capacidade de hora extra REAL no destino 10h30 = 2h (não 2h30)
  const cap = extraCapacityForDate(date, entries, [], settings);
  assert.equal(cap.realExtra, 120);
  assert.equal(actualExtraForDate(date, entries, settings), 120);
});

/* ── I. Regressões ────────────────────────────────────────── */
check("I1. sem registro: contribuição 0 (nunca −8h); Sem registro preservado", () => {
  const date = "2026-08-26";
  const cctx = companyDayContext(date, [], [], undefined, settings);
  assert.equal(dayBalanceContribution(cctx, [], date, TODAY), 0);
  const row = buildResumoDayRow({
    date, today: TODAY, entries: [], absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01",
  });
  assert.equal(row.balanceContribution, 0);
  assert.equal(row.missingExpected, true, "Sem registro permanece Sem registro");
});

check("I2. futuro vazio e registro futuro: contribuição 0 (neutro)", () => {
  const date = "2026-09-05";
  const cctx = companyDayContext(date, [], [], undefined, settings);
  assert.equal(dayBalanceContribution(cctx, [], date, TODAY), 0, "futuro vazio neutro");
  const fut = companyDayContext(date, day10h30(date), [], undefined, settings);
  assert.equal(dayBalanceContribution(fut, [], date, TODAY), 0, "registro futuro não entra no realizado");
  assert.equal(fut.adjustedDeficit, 0);
});

check("I3. abono parcial (Cinzas 10/02/2027): base reduzida 4h; déficit comum sobre a jornada do evento", () => {
  const date = "2027-02-10";
  const cctx = companyDayContext(date, [], [], [cal2627], settings);
  assert.equal(cctx.calendarEntry?.tratamento, "ABONADO_PARCIAL");
  assert.equal(cctx.effectiveExpected, 240, "jornada do evento = 4h");
  assert.equal(cctx.adjustedBalance, -240, "déficit comum −4h");
  assert.equal(cctx.adjustedDeficit, 240);
  // 2h trabalhadas DENTRO da janela abonada não quitam a tarde
  const withMorning = [punch(date, "08:00", "entrada"), punch(date, "10:00", "saida")];
  const m = companyDayContext(date, withMorning, [], [cal2627], settings);
  assert.equal(m.workedInAbonoMinutes, 120);
  assert.equal(m.adjustedDeficit, 240, "2h de manhã NÃO quitam a jornada 13–17");
});

check("I4. falta prevista (futura) neutra; falta efetiva entra com o saldo do dia", () => {
  const futura = "2026-09-03";
  const cctxF = companyDayContext(futura, [], [], undefined, settings);
  assert.equal(dayBalanceContribution(cctxF, [{ id: 1, date: futura, createdAt: 1 }], futura, TODAY), 0, "falta prevista neutra");
  const efetiva = "2026-08-26";
  const cctxE = companyDayContext(efetiva, [], [], undefined, settings);
  assert.equal(
    dayBalanceContribution(cctxE, [{ id: 2, date: efetiva, createdAt: 1 }], efetiva, TODAY),
    -480,
    "falta efetiva sem batidas → −8h",
  );
});

check("I5. COMPENSAR (25/08 folga a compensar 8h): trabalho reduz a obrigação; só o surplus vira crédito até o teto", () => {
  const date = "2026-08-25";
  const w4 = [punch(date, "08:00", "entrada"), punch(date, "12:00", "saida")];
  assert.equal(companyDayContext(date, w4, [], [cal2627], settings).adjustedBalance, 0, "4h → crédito 0");
  const w1030 = day10h30(date);
  const c = companyDayContext(date, w1030, [], [cal2627], settings);
  assert.equal(c.regularBalance, 120, "10h30 → regular +2h");
  assert.equal(c.ctx.day.excessMinutes, 30, "[10+] 30min separado");
  assert.equal(c.adjustedDeficit, 0);
});

check("I6. acordado-compensar integral: cap no [10+]; 8h30 inalterado", () => {
  const abs: Absence = {
    id: 1, kind: "acordado", startDate: "2026-08-25", endDate: "2026-08-25",
    duration: "integral", treatment: "compensar", createdAt: 1,
  };
  assert.equal(dayContext("2026-08-25", day830("2026-08-25"), [abs], settings).adjustedBalance, 30, "8h30 → +30 (inalterado)");
  assert.equal(dayContext("2026-08-25", day10h30("2026-08-25"), [abs], settings).adjustedBalance, 120, "10h30 → +2h (nunca +2h30)");
  assert.equal(dayContext("2026-08-25", day11h30("2026-08-25"), [abs], settings).adjustedBalance, 120, "11h30 → +2h (nunca +3h30)");
});

check("I7. férias parcial (manhã ausente): base reduzida; cap no [10+]", () => {
  const abs: Absence = {
    id: 1, kind: "ferias", startDate: "2026-08-25", endDate: "2026-08-25",
    duration: "parcial", partialStart: "08:00", partialEnd: "12:00", createdAt: 1,
  };
  const date = "2026-08-25";
  const entries = [punch(date, "13:00", "entrada"), punch(date, "23:30", "saida")]; // 10h30 só à tarde
  const ctx = dayContext(date, entries, [abs], settings);
  assert.equal(ctx.effectiveExpected, 240, "base restante 4h");
  assert.equal(ctx.adjustedBalance, 360, "no ponto 10h − base 4h = +6h");
  assert.equal(ctx.day.excessMinutes, 30, "[10+] 30min separado");
});

check("I8. acordado-compensar parcial: sem dupla contagem (8h30 → +4h30 regular, acordo à parte)", () => {
  const abs: Absence = {
    id: 1, kind: "acordado", startDate: "2026-08-25", endDate: "2026-08-25",
    duration: "parcial", partialStart: "08:00", partialEnd: "12:00",
    treatment: "compensar", createdAt: 1,
  };
  const date = "2026-08-25";
  const entries = [punch(date, "13:00", "entrada"), punch(date, "17:30", "saida"), punch(date, "17:45", "entrada"), punch(date, "21:45", "saida")]; // 8h30
  const ctx = dayContext(date, entries, [abs], settings);
  assert.equal(ctx.acordoMinutes, 240, "acordo próprio 4h (dívida à parte)");
  assert.equal(ctx.adjustedBalance, 270, "tarde 8h30 − base 4h = +4h30 (nunca 540 da dupla contagem)");
  assert.equal(ctx.adjustedDeficit, 0);
  // Sem batidas: acordo 4h + déficit comum 4h — NUNCA 8h única (P.11 preservado)
  const noWork = dayContext(date, [], [abs], settings);
  assert.equal(noWork.adjustedBalance, -240);
  assert.equal(noWork.adjustedDeficit, 240);
  assert.equal(noWork.acordoMinutes, 240);
});

check("I9. incompleto/inconsistente: financeiro congelado (saldo 0)", () => {
  const date = "2026-08-27";
  const inconsistent = [punch(date, "08:00", "entrada"), punch(date, "13:00", "entrada"), punch(date, "17:00", "saida")];
  const dayF = computeDay(inconsistent, settings);
  assert.equal(dayF.consistent, false);
  assert.equal(dayF.financialPending, true);
  const ctx = dayContext(date, inconsistent, [], settings);
  assert.equal(ctx.adjustedBalance, 0, "inconsistente congela o financeiro");
  assert.equal(dayBalanceContribution(companyDayContext(date, inconsistent, [], undefined, settings), [], date, TODAY), 0);
  // incompleto (entrada sem saída no passado)
  const incomplete = [punch("2026-08-26", "08:00", "entrada")];
  const iDay = computeDay(incomplete, settings);
  assert.equal(iDay.open, true);
  const iCtx = dayContext("2026-08-26", incomplete, [], settings);
  assert.equal(iCtx.adjustedDeficit, 0, "aberto não gera déficit definitivo");
});

check("I10. intervalo automático: almoço descontado (08–17:30 → 8h30 → +30)", () => {
  const date = "2026-08-25";
  const entries = [punch(date, "08:00", "entrada"), punch(date, "17:30", "saida")];
  const dayF = computeDay(entries, settings);
  assert.equal(dayF.lunchDeductedMinutes, 60, "intervalo automático aplicado");
  assert.equal(dayF.workedMinutes, 510);
  assert.equal(companyDayContext(date, entries, [], undefined, settings).adjustedBalance, 30);
});

check("I11. histórico vazio anterior a controlStartDate: neutro; fechamento anual intacto", () => {
  const row = buildResumoDayRow({
    date: "2026-03-10", today: TODAY, entries: [], absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-04-01",
  });
  assert.equal(row.balanceContribution, 0, "histórico vazio neutro");
  const res = validateAbsence(
    { kind: "ferias", startDate: "2026-04-28", endDate: "2026-05-02", duration: "integral" },
    [], [], undefined,
  );
  assert.equal(res.ok, false, "férias não atravessam o fechamento anual (30/04)");
  assert.equal(res.code, "cross-cycle");
});

check("I12. realocação/déficit intocados: crédito realizado 10h30 → 2h regular; porção especial exige motivo", () => {
  const target = "2026-08-25";
  const source = "2026-08-21";
  // Origem com déficit 4h (08–12) para comportar a alocação; destino 10h30.
  const entries = [...day10h30(target), punch(source, "08:00", "entrada"), punch(source, "12:00", "saida")];
  const reset = () => actions.replaceAll({
    user, entries, compensations: [], absences: [],
    companyCalendars: undefined, faltas: [], excessReasons: [],
  });
  // 2h05 (2h regular + 5min da reserva especial) SEM motivo: rejeitado pelo motivo
  reset();
  const ok125 = actions.useRealizedCredit({ sourceDate: source, targetDate: target, minutes: 125 });
  assert.equal(ok125.ok, false, "porção especial exige motivo");
  assert.match(ok125.error ?? "", /Motivo não informado/);
  // Com motivo: 2h regular + 5min especial alocam (split preservado)
  const reason = actions.setExcessReason({ date: target, reason: "demanda-urgente" });
  assert.equal(reason.ok, true, reason.error);
  const okWithReason = actions.useRealizedCredit({ sourceDate: source, targetDate: target, minutes: 125 });
  assert.equal(okWithReason.ok, true, okWithReason.error);
  const d = getAppData();
  const created = d.compensations.filter((c) => c.status === "concluida");
  assert.equal(created.filter((c) => c.portion === "regular").reduce((s, c) => s + c.minutes, 0), 120);
  assert.equal(created.filter((c) => c.portion === "especial").reduce((s, c) => s + c.minutes, 0), 5);
  // 2h regulares SEM motivo: ok (não toca a reserva especial)
  reset();
  const ok120 = actions.useRealizedCredit({ sourceDate: source, targetDate: target, minutes: 120 });
  assert.equal(ok120.ok, true, ok120.error);
  assert.equal(getAppData().compensations.filter((c) => c.portion === "especial").length, 0);
});

/* ── Fonte única: regularBalanceMinutes ───────────────────── */
check("J. helper único regularBalanceMinutes é usado nas fontes centrais", () => {
  assert.equal(regularBalanceMinutes(630, 480, 600), 120);
  assert.equal(regularBalanceMinutes(690, 480, 600), 120);
  assert.equal(regularBalanceMinutes(660, 0, 600), 600);
  for (const rel of [
    "src/lib/absences.ts",
    "src/lib/company-calendar.ts",
    "src/lib/debt.ts",
    "src/lib/store.ts",
    "src/lib/compensations.ts",
  ]) {
    assert.ok(srcOf(rel).includes("regularBalanceMinutes"), `${rel} usa o helper único`);
  }
  // Seed 3.1: 24/08 (11h) e 28/08 (11h30) passam a +2h cada no Resumo
  const seed = buildSeedData();
  const s = settingsOf(seed.user);
  const c24 = companyDayContext("2026-08-24", seed.entries, seed.absences, seed.companyCalendars, s);
  assert.equal(c24.regularBalance, 120, "seed 24/08 11h → +2h");
  const c28 = companyDayContext("2026-08-28", seed.entries, seed.absences, seed.companyCalendars, s);
  assert.equal(c28.regularBalance, 120, "seed 28/08 11h30 → +2h");
  assert.equal(c28.ctx.day.excessMinutes, 90, "seed 28/08 [10+] 1h30 (30min realocados neste dia)");
});

console.log(`\nSEPARAÇÃO [10+] × SALDO REGULAR — OK (${passed} testes)`);
