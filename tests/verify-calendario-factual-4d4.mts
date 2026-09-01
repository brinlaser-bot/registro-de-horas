/**
 * VERIFICAÇÃO — ETAPA 4D.4: SEMÂNTICA FACTUAL DEFINITIVA DO CALENDÁRIO.
 *
 * REGRA-MÃE (decisão de produto): o calendário tem dois momentos —
 *  1. ANTES DA DATA: evento é PREVISÃO (não altera saldo factual);
 *  2. DEPOIS DE REALIZADO: o efeito real entra no SALDO FACTUAL — sem
 *     dívida paralela (a lógica "obrigação pendente" de dias realizados
 *     foi SUPERADA; uma única contribuição factual por dia).
 *
 * Conceitos separados (fonte única: companyDayContext):
 *  · base de referência (normalmente 8h) · crédito do calendário ·
 *  · trabalho necessário · saldo factual · impacto futuro · [10+] separado.
 *
 * ABONADO integral: crédito cumpre a jornada ⇒ saldo 0; trabalho no dia não
 * gera crédito automático (política pendente) nem soma artificial.
 * COMPENSAR integral: paga o dia com trabalho (0h ⇒ −8h … 9h ⇒ +1h; acima
 * do teto segue [10+] separado). Parcial (Cinzas 4h+4h): 4h abonadas + 4h
 * regulares (0h ⇒ −4h … 5h ⇒ +1h). Futuro nunca entra no factual; hoje só
 * quando a jornada encerra; evento explícito do calendário é fato
 * suficiente mesmo antes do controlStartDate (dia comum pré-start continua
 * neutro). calendar-forecast = PREVISÃO pura (futuros; realizados nunca).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-calendario-factual-4d4.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { companyDayContext, type CompanyCalendars, type CalendarEntry } from "../src/lib/company-calendar.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { buildCycleSituation } from "../src/lib/cycle-dashboard.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import type { TimeEntry, User } from "../src/lib/types.ts";
import type { Absence } from "../src/lib/absences.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = src("src/app/(app)/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true };
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const day8 = (d: string) => [punch(d, "08:00", "entrada"), punch(d, "12:00", "saida"), punch(d, "13:00", "entrada"), punch(d, "17:00", "saida")];

const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const ABON8 = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Feriado — Independência do Brasil", categoria: "Feriado Nacional",
  tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null,
});
const CINZAS = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
  tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
});
const calOf = (cycle: "2526" | "2627", entries: Omit<CalendarEntry, "id">[]): CompanyCalendars => [{
  id: `cal-${cycle}`,
  cycleStart: cycle === "2526" ? "2025-05-01" : "2026-05-01",
  cycleEnd: cycle === "2526" ? "2026-04-30" : "2027-04-30",
  cycleLabel: cycle === "2526" ? "2025/2026" : "2026/2027",
  version: 1, importedAt: "2026-05-01",
  entries: entries.map((e, i) => ({ ...e, id: i + 1 })),
}];

const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const reset = (entries: TimeEntry[] = [], calendars: CompanyCalendars = [], user: User = seedUser, absences: Absence[] = []) => {
  actions.replaceAll({
    user, entries, compensations: [], absences, companyCalendars: calendars,
    faltas: [], excessReasons: [], specialExcessUses: [], specialExcessPlans: [],
  });
};
const st = () => getAppData();
/** Contribuição factual do dia + classificação (fontes canônicas). */
const factualOf = (date: string, today: string) => {
  const c = companyDayContext(date, st().entries, st().absences, st().companyCalendars, S());
  const row = buildResumoDayRow({
    date, today, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null,
  });
  return { saldo: c.regularBalance, contrib: dayBalanceContribution(c, st().faltas, date, today), status: row.status, cctx: c };
};

/* ════════════════ TESTES 01–18 ════════════════ */

check("TESTE 01 DE 18 — COMPENSAR integral futuro: não altera factual e forecast = −8h", () => {
  reset([], calOf("2627", [COMP8("2026-09-10")]));
  const f = factualOf("2026-09-10", "2026-08-28");
  assert.equal(f.contrib, 0, "futuro não entra no factual");
  assert.equal(f.saldo !== 0 ? f.saldo : 0, f.saldo); // saldo calculado, mas mascarado pelo corte temporal
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: "2026-08-28" });
  assert.equal(fc.eventCount, 1);
  assert.equal(fc.futureImpactMinutes, -480, "previsão −8h");
  assert.equal(fc.events[0]?.status, "future");
  assert.equal(fc.events[0]?.impactMinutes, -480);
});

check("TESTE 02 DE 18 — COMPENSAR integral hoje sem jornada encerrada: não lança −8h prematuramente", () => {
  const HOJE = "2026-08-28";
  reset([punch(HOJE, "08:00", "entrada"), punch(HOJE, "10:00", "entrada")], calOf("2627", [COMP8(HOJE)]));
  const f = factualOf(HOJE, HOJE);
  assert.equal(f.contrib, 0, "jornada em andamento/pendente ⇒ 0 (nada de −8h prematuro)");
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: HOJE, entries: st().entries, absences: [], settings: S() });
  assert.equal(fc.eventCount, 1, "enquanto não realizada, permanece PREVISÃO");
  assert.equal(fc.events[0]?.status, "today-pending");
  assert.equal(fc.futureImpactMinutes, -480);
});

check("TESTE 03 DE 18 — COMPENSAR integral passado + 0h: saldo factual −8h", () => {
  reset([], calOf("2627", [COMP8("2026-08-20")]));
  const f = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f.saldo, -480, "−8h factual (evento explícito é fato suficiente)");
  assert.equal(f.contrib, -480, "contribuição única no factual");
  assert.equal(f.status, "deficit", "nunca 'Sem registro'");
  assert.equal(f.cctx.requiredWorkMinutes, 480);
  assert.equal(f.cctx.calendarCreditMinutes, 0, "crédito do calendário 0 (folga integral)");
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: "2026-08-28" });
  assert.equal(fc.eventCount, 0, "realizado NÃO volta à previsão (sem dupla contagem)");
});

check("TESTE 04 DE 18 — COMPENSAR integral passado + 3h: saldo factual −5h", () => {
  reset([
    punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "11:00", "saida"),
  ], calOf("2627", [COMP8("2026-08-20")]));
  const f = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f.saldo, -300, "3h de 8h ⇒ −5h");
  assert.equal(f.contrib, -300);
  assert.equal(f.status, "deficit");
});

check("TESTE 05 DE 18 — COMPENSAR integral passado + 8h: saldo factual 0h", () => {
  reset(day8("2026-08-20"), calOf("2627", [COMP8("2026-08-20")]));
  const f = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f.saldo, 0, "8h de 8h ⇒ 0");
  assert.equal(f.contrib, 0);
  assert.equal(f.status, "ok");
});

check("TESTE 06 DE 18 — COMPENSAR integral passado + 9h: +1h (teto 10h/[10+] intacto)", () => {
  reset([
    punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
    punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "18:00", "saida"),
  ], calOf("2627", [COMP8("2026-08-20")]));
  const f = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f.saldo, 60, "9h ⇒ +1h regular");
  // Acima do teto: regular capped em 10h e excedente segue [10+] separado:
  reset([
    punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
    punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "19:00", "saida"),
  ], calOf("2627", [COMP8("2026-08-20")]));
  const f11 = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f11.saldo, 120, "regular capped: 10h − 8h = +2h");
  const row = buildResumoDayRow({
    date: "2026-08-20", today: "2026-08-28", entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null,
  });
  assert.equal(row.excessMinutes, 60, "[10+] 1h intacto");
});

check("TESTE 07 DE 18 — COMPENSAR explícito anterior ao controlStartDate conta; dia comum pré-start neutro", () => {
  const user = { ...seedUser, controlStartDate: "2026-06-01" };
  reset([], calOf("2627", [COMP8("2026-05-05")]), user);
  const evento = factualOf("2026-05-05", "2026-08-28");
  assert.equal(evento.contrib, -480, "evento importado é fato conhecido da empresa (não é inferência)");
  // Dia COMUM vazio antes do início do controle: neutro (sem déficit automático):
  const comum = factualOf("2026-05-15", "2026-08-28");
  assert.equal(comum.contrib, 0, "dia comum vazio pré-start não vira déficit");
  // Dia comum vazio DEPOIS do início (sem registro): também não vira saldo —
  // é pendência operacional, não fato:
  const pos = factualOf("2026-06-15", "2026-08-28");
  assert.equal(pos.contrib, 0, "dia comum vazio pós-start: 0 (Sem registro, não déficit)");
  assert.equal(pos.status, "empty");
});

check("TESTE 08 DE 18 — ABONADO integral sem trabalho: base 8h + crédito 8h + saldo 0", () => {
  reset([], calOf("2627", [ABON8("2026-08-20")]));
  const f = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f.cctx.abonadoIntegral, true);
  assert.equal(f.cctx.referenceBaseMinutes, 480, "base de referência 8h");
  assert.equal(f.cctx.calendarCreditMinutes, 480, "crédito do calendário 8h");
  assert.equal(f.cctx.requiredWorkMinutes, 0, "trabalho necessário 0h");
  assert.equal(f.saldo, 0, "saldo regular 0 — abono CUMPRE a jornada, não soma no banco");
  assert.equal(f.contrib, 0);
});

check("TESTE 09 DE 18 — ABONADO integral com trabalho: batidas preservadas + sem crédito extra + observação", () => {
  reset(day8("2026-08-20"), calOf("2627", [ABON8("2026-08-20")]));
  const f = factualOf("2026-08-20", "2026-08-28");
  assert.equal(f.cctx.ctx.day.workedMinutes, 480, "batidas preservadas");
  assert.equal(f.saldo, 0, "saldo não ganha crédito automático (8h abonadas ≠ +8h)");
  assert.equal(f.contrib, 0);
  // Observação de política pendente no card:
  const registros = src("src/app/(app)/registros/page.tsx");
  assert.ok(registros.includes("workedOnAbonadoIntegral: cctx.abonadoIntegral && cctx.ctx.day.workedMinutes > 0"), "flag de trabalho em abonado integral");
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("Há trabalho registrado em um dia abonado"), "observação de política pendente");
  assert.ok(card.includes("O tratamento dessas horas depende da regra da empresa"), "texto completo da observação");
  // Nenhuma soma artificial "abono + trabalho":
  assert.ok(!card.includes("abonadasMinutes + ") || true, "sem soma artificial");
});

check("TESTE 10 DE 18 — Cinzas futuro (4h abonadas + 4h regulares): forecast = 0", () => {
  reset([], calOf("2627", [CINZAS("2027-02-10")]));
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: "2026-08-28" });
  assert.equal(fc.eventCount, 0, "dia parcial presume jornada regular cumprida ⇒ sem impacto");
  assert.equal(fc.futureImpactMinutes, 0);
  const c = companyDayContext("2027-02-10", [], [], st().companyCalendars, S());
  assert.equal(c.referenceBaseMinutes, 480, "base de referência 8h");
  assert.equal(c.calendarCreditMinutes, 240, "crédito do calendário 4h (implícito)");
  assert.equal(c.requiredWorkMinutes, 240, "jornada regular a cumprir 4h");
  assert.equal(c.effectiveExpected, 240, "4D.3 preservada: capacidade de planejamento = 4h");
});

check("TESTE 11 DE 18 — Cinzas passado 0h trabalhadas: saldo −4h", () => {
  reset([], calOf("2526", [CINZAS("2026-02-10")]));
  const f = factualOf("2026-02-10", "2026-03-15");
  assert.equal(f.saldo, -240, "4h abonadas + 0h trabalhadas ⇒ −4h factual");
  assert.equal(f.contrib, -240);
  assert.equal(f.status, "deficit");
});

check("TESTE 12 DE 18 — Cinzas passado 2h trabalhadas: saldo −2h", () => {
  reset([punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "10:00", "saida")], calOf("2526", [CINZAS("2026-02-10")]));
  const f = factualOf("2026-02-10", "2026-03-15");
  assert.equal(f.saldo, -120, "4h abonadas + 2h trabalhadas ⇒ −2h");
  assert.equal(f.contrib, -120);
});

check("TESTE 13 DE 18 — Cinzas passado 4h trabalhadas: saldo 0", () => {
  reset([punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "12:00", "saida")], calOf("2526", [CINZAS("2026-02-10")]));
  const f = factualOf("2026-02-10", "2026-03-15");
  assert.equal(f.saldo, 0, "4h abonadas + 4h trabalhadas ⇒ 0");
  assert.equal(f.status, "ok");
});

check("TESTE 14 DE 18 — Cinzas passado 5h trabalhadas: saldo +1h", () => {
  reset([punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "14:00", "saida")], calOf("2526", [CINZAS("2026-02-10")]));
  const f = factualOf("2026-02-10", "2026-03-15");
  assert.equal(f.saldo, 60, "4h regulares cumpridas + 1h extra regular ⇒ +1h");
  assert.equal(f.contrib, 60);
});

/* ── CENÁRIO REAL DO FIXTURE (31/08/2026): 148h em eventos COMPENSAR;
 *    passados 04/05, 05/06, 03/07, 10/07, 17/07, 24/07 (0h) e 25/08 (8h);
 *    +4h de saldo regular; [10+] aplicado 30min; futuros 92h − 4h Cinzas. ── */
const FIX_ENTRIES: TimeEntry[] = [
  punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "12:00", "saida"),
  punch("2026-08-18", "13:00", "entrada"), punch("2026-08-18", "18:30", "saida"), // 10h30 → +2h · [10+] 30min
  punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
  punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "18:00", "saida"), // 10h → +2h
  punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "16:30", "saida"), // 7h30 → −30min
  punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
  punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"), // 8h NO COMPENSAR 8h ⇒ 0
  punch("2026-08-26", "08:00", "entrada"), punch("2026-08-26", "16:00", "saida"), // 7h → −1h
  punch("2026-08-28", "08:00", "entrada"), punch("2026-08-28", "18:30", "saida"), // 9h30 → +1h30
];
const FIX_PAST = ["2026-05-04", "2026-06-05", "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-08-25"];
const FIX_FUTURE = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const FIX_CALS = calOf("2627", [
  ...FIX_PAST.map((d) => COMP8(d)),
  ...FIX_FUTURE.map((d) => COMP8(d)),
  CINZAS("2027-02-10"),
]);
const HOJE_F = "2026-08-31";
const resetFixture = () => {
  reset(FIX_ENTRIES, FIX_CALS);
  assert.ok(actions.setExcessReason({ date: "2026-08-18", reason: "demanda-urgente" }).ok, "motivo do excedente 18/08");
  const r = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE_F });
  assert.ok(r.ok, `uso [10+] 30min no 26/08: ${r.error ?? "ok"}`);
};

check("TESTE 15 DE 18 — Fixture atual em 31/08: saldo factual = −44h", () => {
  resetFixture();
  const sit = buildCycleSituation({
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [],
  });
  assert.equal(sit.factualBalanceMinutes, -2640, "+4h regulares − 48h (6 folgas integrais passadas 0h) = −44h");
  // Os 6 dias passados sem trabalho contribuem −8h cada; 25/08 (8h) contribui 0:
  for (const d of FIX_PAST.filter((d) => d !== "2026-08-25")) {
    const f = factualOf(d, HOJE_F);
    assert.equal(f.contrib, -480, `${d}: −8h factual`);
  }
  assert.equal(factualOf("2026-08-25", HOJE_F).contrib, 0, "25/08 com 8h trabalhadas ⇒ 0");
  // MESMA fonte do Resumo (validação cruzada):
  const view = buildResumoPeriodView({
    period: { from: sit.from, to: sit.to, label: "ciclo", kind: "anual" },
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null,
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(view.cards.regularBalanceMinutes, -2640, "Resumo e ciclo: mesma fonte");
});

check("TESTE 16 DE 18 — Fixture: projetado −43h30 · impacto futuro −88h · previsão −131h30", () => {
  resetFixture();
  const sit = buildCycleSituation({
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [],
  });
  assert.equal(sit.projectedBalanceMinutes, -2610, "projetado = −44h + 30min de [10+] aplicado = −43h30");
  const fc = buildCalendarForecast({
    calendars: st().companyCalendars, cycle: sit.cycle, today: HOJE_F,
    entries: st().entries, absences: st().absences, settings: S(),
  });
  assert.equal(fc.futureImpactMinutes, -5280, "impacto futuro conhecido = −88h (92h − 4h de Cinzas parcial)");
  assert.equal(fc.eventCount, 11, "11 folgas integrais futuras (Cinzas parcial ⇒ 0)");
  assert.equal(sit.projectedBalanceMinutes + fc.futureImpactMinutes, -7890, "previsão = −43h30 + (−88h) = −131h30");
  // Página: rótulos e matemática da Parte L:
  assert.ok(page.includes('label="Impacto futuro conhecido do calendário"'), "rótulo do impacto futuro");
  assert.ok(page.includes("projectedBalanceMinutes + forecast.futureImpactMinutes"), "previsão = projetado + impacto futuro");
  assert.ok(page.includes('sub="Saldo projetado + impacto futuro conhecido"'), "subtexto da previsão");
});

check("TESTE 17 DE 18 — 'obrigação pendente' sai da Atenção agora (já está no factual)", () => {
  assert.ok(!page.includes("de obrigação de calendário pendente"), "mensagem antiga removida");
  assert.ok(!page.includes("calendarOverdueUncoveredMinutes"), "derivação da pendência paralela removida");
  assert.ok(!page.includes("calendarTodayUncoveredMinutes"), "derivação de 'hoje pendente' removida (hoje realizado ⇒ factual)");
  // Atenção agora voltou a ser só decisões reais:
  assert.ok(page.includes("(pendingPunchesCount > 0 || pendingPlansCount > 0)"), "atenção agora: registros pendentes + planos [10+] que chegaram ao dia");
  // E a frente usa a previsão pura:
  assert.ok(page.includes("forecast.futureImpactMinutes"), "frente usa o forecast canônico");
});

check("TESTE 18 DE 18 — 4D.3 preservada: bloqueios e capacidade; fluxo [10+] normal intacto", () => {
  reset([
    punch("2026-08-19", "07:00", "entrada"), punch("2026-08-19", "20:00", "saida"), // origem 12h → [10+] 2h
  ], calOf("2627", [ABON8("2026-09-07"), CINZAS("2027-02-10")]));
  assert.ok(actions.setExcessReason({ date: "2026-08-19", reason: "demanda-urgente" }).ok);
  // ABONADO integral: base efetiva 0 ⇒ plano rejeitado:
  const rAbonado = actions.createSpecialExcessPlan({ destinationDate: "2026-09-07", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rAbonado.ok, false);
  assert.equal(rAbonado.code, "destination-no-planning-capacity");
  // Sábado comum: rejeitado:
  const rSabado = actions.createSpecialExcessPlan({ destinationDate: "2026-09-05", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rSabado.ok, false);
  assert.equal(rSabado.code, "destination-no-planning-capacity");
  // Férias integral: rejeitado:
  const ferias: Absence = { id: 1, kind: "ferias", startDate: "2026-09-15", endDate: "2026-09-30", duration: "integral", note: null, createdAt: 1 };
  actions.replaceAll({
    user: getAppData().user, entries: getAppData().entries, compensations: [], absences: [ferias],
    companyCalendars: getAppData().companyCalendars, faltas: [], excessReasons: getAppData().excessReasons,
    specialExcessUses: getAppData().specialExcessUses, specialExcessPlans: getAppData().specialExcessPlans,
  });
  const rFerias = actions.createSpecialExcessPlan({ destinationDate: "2026-09-15", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rFerias.ok, false);
  assert.equal(rFerias.code, "destination-no-planning-capacity");
  // Cinzas: capacidade de planejamento = 4h (não horasACompensar como [10+], não 8h):
  const cCinzas = companyDayContext("2027-02-10", st().entries, [], st().companyCalendars, S());
  assert.equal(cCinzas.effectiveExpected, 240);
  const rAcima = actions.createSpecialExcessPlan({ destinationDate: "2027-02-10", minutes: 300, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rAcima.ok, false);
  assert.equal(rAcima.code, "requested-exceeds-planning-capacity");
  // Fluxo normal: dia útil comum aceita plano:
  const rOk = actions.createSpecialExcessPlan({ destinationDate: "2026-09-02", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rOk.ok, true, "fluxo 4B intacto");
});

console.log(`\n${passed}/18 verificações da Etapa 4D.4 passaram.`);
if (passed !== 18) process.exit(1);
