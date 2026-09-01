/**
 * VERIFICAÇÃO — ETAPA 4D.4.3.1: INTERVALO AUTOMÁTICO É SOMENTE FALLBACK.
 * NUNCA MÍNIMO, COMPLEMENTO OU LIMITE.
 *
 * Regra definitiva do produto:
 *   if existePeloMenosUmGapExplícitoEntrePares:
 *       deduçãoAutomática = 0   (respeita EXATAMENTE o(s) intervalo(s) real(is))
 *   else:
 *       deduçãoAutomática = intervaloAutomáticoPadrão (fallback integral)
 *
 * A fórmula da 4D.4.3 — max(0, exigido − intervaloReal) — está SUPERADA:
 * intervalo real de 30min vale 30min (não completa para 1h); de 1h vale 1h;
 * de 1h30 vale 1h30 (não reduz nem compensa); múltiplos gaps valem a soma.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-intervalo-fallback-4d431.mts
 */
import assert from "node:assert/strict";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { computeDay, plannedExitTime } from "../src/lib/time.ts";
import { analyzePunches, lunchDeductionOf, totalRealBreakMinutes, explicitLunchGapMinutes } from "../src/lib/punches.ts";
import { companyDayContext, type CompanyCalendars, type CalendarEntry } from "../src/lib/company-calendar.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildCycleSituation } from "../src/lib/cycle-dashboard.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import type { TimeEntry } from "../src/lib/types.ts";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true };
const CLK_DIA = (date: string) => ({ date, minutes: 23 * 60 }); // fim da noite: dia realizado
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });

const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const st = () => getAppData();
const reset = (entries: TimeEntry[], calendars: CompanyCalendars = [], opts: { reasons?: string[] } = {}) => {
  actions.replaceAll({
    user: seedUser, entries, compensations: [], absences: [], companyCalendars: calendars,
    faltas: [], excessReasons: (opts.reasons ?? []).map((date, i) => ({ id: i + 1, date, reason: "demanda-urgente" })),
    specialExcessUses: [], specialExcessPlans: [],
  });
};
const dia = (entries: TimeEntry[], d: string) => computeDay(entries, SETTINGS, undefined, CLK_DIA(d));

/* ════════════════ CASO A — fallback (par único) ════════════════ */

check("TESTE 01 DE 10 — Par único 08:00–17:00 ⇒ fallback 1h ⇒ trabalhado 8h", () => {
  const d = "2026-08-20";
  const day = dia([punch(d, "08:00", "entrada"), punch(d, "17:00", "saida")], d);
  assert.equal(day.workedMinutes, 480, "bruto 9h − fallback 1h = 8h (regra consolidada)");
  assert.equal(day.lunchDeductedMinutes, 60, "fallback integral da faixa");
  assert.equal(day.registrableMinutes, 480);
});

check("TESTE 02 DE 10 — Par único 08:00–18:15 ⇒ fallback 1h ⇒ trabalhado 9h15", () => {
  const d = "2026-08-20";
  const day = dia([punch(d, "08:00", "entrada"), punch(d, "18:15", "saida")], d);
  assert.equal(day.workedMinutes, 555, "bruto 10h15 − fallback 1h = 9h15");
  assert.equal(day.lunchDeductedMinutes, 60);
});

/* ════════════════ CASOS B/C/D — intervalo real manda ════════════════ */

check("TESTE 03 DE 10 — Intervalo real 30min (08–12 / 12:30–17) ⇒ trabalhado 8h30 · auto 0 (NÃO completa p/ 1h)", () => {
  const d = "2026-08-20";
  const entries = [punch(d, "08:00", "entrada"), punch(d, "12:00", "saida"), punch(d, "12:30", "entrada"), punch(d, "17:00", "saida")];
  assert.equal(totalRealBreakMinutes(analyzePunches(entries).pairs), 30, "intervalo real: 30min (informação)");
  const day = dia(entries, d);
  assert.equal(day.workedMinutes, 510, "4h + 4h30 = 8h30 — intervalo real respeitado");
  assert.equal(day.lunchDeductedMinutes, 0, "auto 0 — não completa para 1h, não desconta mais 30min");
});

check("TESTE 04 DE 10 — Intervalo real 1h (05–09 / 10–13:30) ⇒ trabalhado 7h30 · auto 0", () => {
  const d = "2026-09-01";
  const entries = [punch(d, "05:00", "entrada"), punch(d, "09:00", "saida"), punch(d, "10:00", "entrada"), punch(d, "13:30", "saida")];
  const day = dia(entries, d);
  assert.equal(day.workedMinutes, 450, "4h + 3h30 = 7h30 (cenário real de 01/09/2026)");
  assert.equal(day.lunchDeductedMinutes, 0, "auto 0 — o intervalo real de 1h já está representado");
});

check("TESTE 05 DE 10 — Intervalo real 1h30 (08–12 / 13:30–18) ⇒ trabalhado 8h30 · auto 0 (NÃO reduz p/ 1h)", () => {
  const d = "2026-08-20";
  const entries = [punch(d, "08:00", "entrada"), punch(d, "12:00", "saida"), punch(d, "13:30", "entrada"), punch(d, "18:00", "saida")];
  assert.equal(totalRealBreakMinutes(analyzePunches(entries).pairs), 90, "intervalo real: 1h30 (informação)");
  const day = dia(entries, d);
  assert.equal(day.workedMinutes, 510, "4h + 4h30 = 8h30 — segmentos intactos");
  assert.equal(day.lunchDeductedMinutes, 0, "auto 0 — não reduz o intervalo a 1h, não compensa 30min");
});

/* ════════════════ CASO E — múltiplos intervalos ════════════════ */

check("TESTE 06 DE 10 — Múltiplos gaps 15min + 1h + 20min ⇒ total real 1h35 · auto 0 · trabalhado = soma exata", () => {
  const d = "2026-08-20";
  const entries = [
    punch(d, "08:00", "entrada"), punch(d, "10:00", "saida"),
    punch(d, "10:15", "entrada"), punch(d, "12:00", "saida"),
    punch(d, "13:00", "entrada"), punch(d, "15:00", "saida"),
    punch(d, "15:20", "entrada"), punch(d, "17:00", "saida"),
  ];
  assert.equal(totalRealBreakMinutes(analyzePunches(entries).pairs), 95, "total real 1h35 (informação)");
  const day = dia(entries, d);
  assert.equal(day.workedMinutes, 445, "2h + 1h45 + 2h + 1h40 = 7h25 — soma exata dos segmentos");
  assert.equal(day.lunchDeductedMinutes, 0, "auto 0 — não adiciona mais 1h");
  assert.equal(day.segments.length, 4, "4 segmentos reais");
});

/* ════════════════ PARTE C — "Registrar intervalo" ════════════════ */

check("TESTE 07 DE 10 — 'Registrar intervalo' de 35min valem EXATAMENTE 35min (sem complemento)", () => {
  reset([]);
  // Mesma action do fluxo do card/modal (addEntry): intervalo 12:00→12:35:
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null }).ok);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "12:00", type: "saida", note: null }).ok);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "12:35", type: "entrada", note: null }).ok);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "17:00", type: "saida", note: null }).ok);
  const entries = st().entries;
  assert.equal(totalRealBreakMinutes(analyzePunches(entries).pairs), 35, "pausa registrada: exatamente 35min");
  const day = computeDay(entries, S(), undefined, CLK_DIA("2026-08-20"));
  assert.equal(day.workedMinutes, 505, "4h + 4h25 = 8h25 — 35min valem 35min");
  assert.equal(day.lunchDeductedMinutes, 0, "auto 0 — sem completar para 1h");
});

/* ════════════════ PARTE E — gap fora da faixa 12–13 ════════════════ */

check("TESTE 08 DE 10 — Gap fora da faixa 12–13 continua sendo intervalo explícito ⇒ auto 0", () => {
  const d = "2026-09-01";
  const entries = [punch(d, "05:00", "entrada"), punch(d, "09:00", "saida"), punch(d, "10:00", "entrada"), punch(d, "13:30", "saida")];
  // O gap 09:00–10:00 NÃO toca a faixa 12:00–13:00 — ainda assim é intervalo real:
  assert.equal(explicitLunchGapMinutes(analyzePunches(entries).pairs, SETTINGS), null, "não intersecta a faixa (irrelevante para a dedução)");
  assert.equal(lunchDeductionOf(analyzePunches(entries), SETTINGS), 0, "auto 0 mesmo fora da faixa");
  // E com NENHUM par cruzando a janela também: gap 30min ⇒ auto 0:
  const e2 = [punch(d, "06:00", "entrada"), punch(d, "09:00", "saida"), punch(d, "09:30", "entrada"), punch(d, "11:00", "saida")];
  assert.equal(lunchDeductionOf(analyzePunches(e2), SETTINGS), 0);
  assert.equal(dia(e2, d).workedMinutes, 270, "3h + 1h30 = 4h30 — segmentos exatos");
});

/* ════════════════ PARTE F — cenário 01/09 (fixture do usuário) ════════════════ */

/* Fixture 4D.4.3: 18/08 11h30 (regular capped +2h · [10+] 1h30) · 20/08 10h
 * · 24/08 7h · 25/08 8h na folga · 26/08 7h (destino do [10+] aplicado)
 * · 28/08 10h30 · 01/09 05–09 / 10–13:30 · uso 30min aplicado em 26/08 ·
 * reserva 30min para 01/09 · folgas passadas 6×8h · futuras 11×8h + Cinzas. */
const FIX_PAST_FOLGAS = ["2026-05-04", "2026-06-05", "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24"];
const FIX_FUTUROS = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Compensado", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const FIX_CALS: CompanyCalendars = [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
  entries: [
    ...[...FIX_PAST_FOLGAS, "2026-08-25"].map((d, i) => ({ id: i + 1, ...COMP8(d) })),
    ...FIX_FUTUROS.map((d, i) => ({ id: 30 + i, ...COMP8(d) })),
    { id: 50, date: "2027-02-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas", tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null },
  ],
}];
const HOJE_F = "2026-09-02"; // 01/09 já realizado
const resetFixture = () => {
  const entries: TimeEntry[] = [
    punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida"),
    punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
    punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "18:00", "saida"),
    punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "12:00", "saida"),
    punch("2026-08-24", "13:00", "entrada"), punch("2026-08-24", "16:00", "saida"),
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"),
    punch("2026-08-26", "08:00", "entrada"), punch("2026-08-26", "16:00", "saida"),
    punch("2026-08-28", "08:00", "entrada"), punch("2026-08-28", "12:00", "saida"),
    punch("2026-08-28", "13:00", "entrada"), punch("2026-08-28", "19:00", "saida"),
    punch("2026-09-01", "05:00", "entrada"), punch("2026-09-01", "09:00", "saida"),
    punch("2026-09-01", "10:00", "entrada"), punch("2026-09-01", "13:30", "saida"),
  ];
  reset(entries, FIX_CALS, { reasons: ["2026-08-18"] });
  const uso = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-28" });
  assert.ok(uso.ok, `uso aplicado 30min: ${uso.error ?? "ok"}`);
  const plano = actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.ok(plano.ok, `reserva 30min p/ 01/09: ${plano.error ?? "ok"}`);
};

check("TESTE 09 DE 10 — 01/09 fixture: 7h30 / −30min · ciclo factual −44h30 · projetado −44h · reserva 30min intacta", () => {
  resetFixture();
  // Dia 01/09:
  const cctx = companyDayContext("2026-09-01", st().entries, st().absences, st().companyCalendars, S());
  assert.equal(cctx.ctx.day.workedMinutes, 450, "Trabalhado 7h30");
  assert.equal(cctx.ctx.day.lunchDeductedMinutes, 0, "auto 0 (intervalo real 1h)");
  assert.equal(cctx.regularBalance, -30, "saldo factual do dia −30min");
  // Necessidade real do destino = 30min (não 1h30):
  const view = buildSpecialExcessDayView({
    date: "2026-09-01", asOfDate: HOJE_F, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? null,
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(view.eligible, true);
  assert.equal(view.remainingMinutes, 30, "necessidade do destino 30min");
  // Reserva [10+]: continua reservada até confirmação — nada auto-aplicado:
  const plano = st().specialExcessPlans?.find((p) => p.destinationDate === "2026-09-01");
  assert.equal(plano?.status, "planned", "reserva 30min intacta (aguardando confirmação)");
  assert.deepEqual(
    (st().specialExcessUses ?? []).filter((u) => u.status === "utilizado").map((u) => u.destinationDate),
    ["2026-08-26"],
    "nenhum uso automático em 01/09",
  );
  // Ciclo antes da resolução:
  const sit = buildCycleSituation({
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(sit.factualBalanceMinutes, -2670, "factual −44h30");
  assert.equal(sit.projectedBalanceMinutes, -2640, "projetado −44h");
  const bank = buildSpecialExcessBank({
    cycle: "2026/2027", asOfDate: HOJE_F, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? "",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(bank.reservedMinutes, 30, "reserva segue reservada");
});

check("TESTE 10 DE 10 — Smart Exit / Registros / Resumo / calendário / [10+] permanecem coerentes", () => {
  resetFixture();
  // Smart Exit: previsão de saída intacta (08:00 + 8h + almoço = 17:00):
  assert.equal(plannedExitTime([punch("2026-09-03", "08:00", "entrada")], SETTINGS, 480), "17:00");
  // Registros/Resumo: contribuição factual −30min (fonte única computeDay):
  const cctx = companyDayContext("2026-09-01", st().entries, st().absences, st().companyCalendars, S());
  assert.equal(dayBalanceContribution(cctx, st().faltas, "2026-09-01", HOJE_F), -30);
  const row = buildResumoDayRow({ date: "2026-09-01", today: HOJE_F, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  assert.equal(row.balanceMinutes, -30);
  // Calendário 4D.4 intocado: impacto futuro −88h (11×8h; Cinzas parcial ⇒ 0):
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: HOJE_F, entries: st().entries, absences: [], settings: S() });
  assert.equal(fc.futureImpactMinutes, -5280);
  assert.equal(fc.eventCount, 11);
  // Previsão do ciclo: projetado + impacto futuro = −44h − 88h = −132h:
  const sit = buildCycleSituation({
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(sit.projectedBalanceMinutes + fc.futureImpactMinutes, -7920);
  // [10+] 4D.3 intocado: plano em dia especial (folga 04/09, base 0) rejeitado:
  const rGate = actions.createSpecialExcessPlan({ destinationDate: "2026-09-04", minutes: 30, selectionMode: "automatic", asOfDate: HOJE_F });
  assert.equal(rGate.ok, false);
  assert.equal(rGate.code, "destination-no-planning-capacity");
});

console.log(`\n${passed}/10 verificações da Etapa 4D.4.3.1 passaram.`);
if (passed !== 10) process.exit(1);
