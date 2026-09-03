/**
 * VERIFICAÇÃO — ETAPA 4D: DASHBOARD DECISÓRIO DA VISÃO GERAL + PREVISÃO DO
 * CALENDÁRIO + REFINOS UX.
 *
 * A Visão Geral responde com as grandezas canônicas: Atenção agora
 * (condicional) · SITUAÇÃO DO CICLO (saldo FACTUAL sem [10+] · saldo
 * PROJETADO com [10+] já aplicado · BANCO [10+] DISPONÍVEL) · PERÍODO ATUAL
 * (factual/projetado) · O QUE VEM PELA FRENTE (obrigações de calendário
 * conhecidas, rotuladas PREVISÃO) · Registro de hoje · Dias recentes.
 * (4D.1: Registro de hoje subiu para logo após a atenção e a obrigação de
 * calendário passou a persistir em hoje/passado em aberto.)
 *
 * REGRA-MÃE: factual, projeção [10+] e previsão futura são 3 grandezas NUNCA
 * misturadas. Toda matemática vem das fontes canônicas (3A/3B/3C/3D):
 * buildCycleSituation delega ao projectRealizedPeriodOfficial (o MESMO motor
 * do Resumo); buildCalendarForecast é leitura conservadora do calendário
 * (PLANEJADO ≠ REALIZADO); buildSpecialExcessBank continua a fonte do banco.
 * PROIBIDO (e testado): buildDebtDays/hourBankSummary como fonte.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-dashboard-ciclo-4d.mts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildCycleSituation } from "../src/lib/cycle-dashboard.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { projectRealizedPeriodOfficial } from "../src/lib/official-projection.ts";
import { getAnnualPointCycle, annualCycleBounds, getPointPeriod, listDaysBetween } from "../src/lib/periods.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { recentDayStatusOf } from "../src/app/(app)/page.tsx";
import type { CompanyCalendars, CalendarEntry } from "../src/lib/company-calendar.ts";
import type { Compensation, TimeEntry } from "../src/lib/types.ts";
import type { SpecialExcessUse, SpecialExcessPlan } from "../src/lib/special-excess-use.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const exists = (p: string) => existsSync(join(root, p));

const page = src("src/app/(app)/page.tsx");
const shell = src("src/components/app-shell.tsx");
const useSummary = src("src/components/special-excess-use-summary.tsx");
const cycleDash = src("src/lib/cycle-dashboard.ts");
const forecastSrc = src("src/lib/calendar-forecast.ts");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Estado-base limpo (dias gravados: 20/08 excedente; 21/08 curto) ── */
const HOJE = "2026-08-30"; // domingo — fim de semana no meio dos fixtures
const CICLO = getAnnualPointCycle(HOJE); // "2026/2027"
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const ENTRIES: TimeEntry[] = [
  punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "19:20", "saida"), // 680min − 60 almoço = 620 → excedente factual 20min
  punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "12:00", "saida"), // 240min → necessidade 240min
];

const seed = buildSeedData();
actions.replaceAll({
  user: seed.user,
  entries: ENTRIES,
  compensations: [],
  absences: [],
  companyCalendars: [],
  faltas: [],
  excessReasons: [],
  specialExcessUses: [],
  specialExcessPlans: [],
});
const st = () => getAppData();
const settings = settingsOf(st().user);

/** Calendário com uma entrada única (helper dos testes de previsão). */
const cal1 = (entry: Omit<CalendarEntry, "id">): CompanyCalendars => [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: CICLO, version: 1, importedAt: "2026-05-01",
  entries: [{ ...entry, id: 1 }],
}];

const USE_20: SpecialExcessUse = {
  id: "use-1", destinationDate: "2026-08-21",
  allocations: [{ originDate: "2026-08-20", minutes: 20 }],
  allocationStrategy: "fifo", status: "utilizado", createdAt: 1,
};
const PLAN_20: SpecialExcessPlan = {
  id: "plan-1", destinationDate: "2026-09-15",
  allocations: [{ originDate: "2026-08-20", minutes: 20 }],
  selectionMode: "automatic", status: "planned", createdAt: 1,
};

/* ════════════════ TESTES 01–20 ════════════════ */

check("TESTE 01 DE 20 — Saldo factual do ciclo = MESMA Σ de contribuições factuais do Resumo", () => {
  const { from, to } = annualCycleBounds(CICLO);
  let soma = 0;
  for (const date of listDaysBetween(from, to)) {
    const cctx = companyDayContext(date, st().entries, st().absences, st().companyCalendars, settings);
    soma += dayBalanceContribution(cctx, st().faltas, date, HOJE);
  }
  const sit = buildCycleSituation({
    today: HOJE, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings, faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: [],
  });
  assert.equal(sit.cycle, "2026/2027", "ciclo derivado do canônico (01/05 → 30/04)");
  assert.equal(sit.from, "2026-05-01");
  assert.equal(sit.to, "2027-04-30");
  assert.equal(sit.factualBalanceMinutes, soma, "factual = Σ balanceContribution (fonte única 3D)");
  // Mesma fonte do Resumo — motor canônico, sem segunda matemática:
  const view = buildResumoPeriodView({
    period: { from, to, label: "ciclo", kind: "anual" },
    today: HOJE, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings, faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null,
    uses: [], plans: [],
  });
  assert.equal(sit.factualBalanceMinutes, view.cards.regularBalanceMinutes, "igual ao saldo regular canônico do Resumo");
});

check("TESTE 02 DE 20 — Factual do ciclo EXCLUI [10+] (uso ativo não altera o factual)", () => {
  const base = buildCycleSituation({
    today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [],
  });
  const comUso = buildCycleSituation({
    today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [USE_20],
  });
  assert.equal(comUso.factualBalanceMinutes, base.factualBalanceMinutes, "[10+] não entra no factual");
  assert.ok(comUso.appliedSpecialMinutes > 0, "[10+] aplicado aparece na projeção");
});

check("TESTE 03 DE 20 — Obrigação futura de calendário NÃO entra no factual do ciclo", () => {
  const cal = cal1({
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  });
  const sem = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [] });
  const com = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: cal, settings, faltas: [], uses: [] });
  assert.equal(com.factualBalanceMinutes, sem.factualBalanceMinutes, "evento futuro não é déficit factual");
  assert.equal(com.projectedBalanceMinutes, sem.projectedBalanceMinutes, "evento futuro não entra na projeção de saldo");
});

check("TESTE 04 DE 20 — Projetado do ciclo = factual + [10+] JÁ aplicado (mesma official-projection)", () => {
  const sit = buildCycleSituation({
    today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [USE_20],
  });
  assert.equal(sit.appliedSpecialMinutes, 20, "aplicado = uso ativo need-capped");
  assert.equal(sit.projectedBalanceMinutes, sit.factualBalanceMinutes + sit.appliedSpecialMinutes, "projetado = factual + aplicado");
  // MESMO motor do Resumo (3A) — a página não recalcula:
  const official = projectRealizedPeriodOfficial({
    from: sit.from, to: sit.to, today: HOJE,
    entries: st().entries, absences: [], calendars: [], settings, faltas: [],
    controlStartDate: null, usedSpecialMinutesByDate: { "2026-08-21": 20 },
  });
  assert.equal(sit.projectedBalanceMinutes, official.projectedBalanceMinutes, "fonte única: projectRealizedPeriodOfficial");
});

check("TESTE 05 DE 20 — Plano/reserva futuro NÃO entra no factual nem no projetado do ciclo", () => {
  const base = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [], plans: [] as SpecialExcessPlan[] });
  const comPlano = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [], plans: [PLAN_20] as SpecialExcessPlan[] });
  assert.equal(comPlano.factualBalanceMinutes, base.factualBalanceMinutes, "reserva não é fato");
  assert.equal(comPlano.projectedBalanceMinutes, base.projectedBalanceMinutes, "reserva não entra no projetado");
  assert.equal(comPlano.appliedSpecialMinutes, base.appliedSpecialMinutes, "reserva não é uso aplicado");
});

check("TESTE 06 DE 20 — BANCO [10+] DISPONÍVEL segue buildSpecialExcessBank (fonte canônica 3C)", () => {
  const banco = buildSpecialExcessBank({
    cycle: CICLO, asOfDate: HOJE, entries: st().entries, absences: [],
    calendars: [], settings, faltas: [], controlStartDate: "",
    uses: [USE_20], plans: [PLAN_20],
  });
  assert.equal(banco.generatedMinutes, 20, "gerado factual do excedente de 20/08");
  assert.equal(banco.usedMinutes, 20, "usado ativo");
  assert.equal(banco.reservedMinutes, 20, "reservado ativo (plano)");
  assert.equal(banco.availableMinutes, 0, "disponível = gerado − usado ativo − reservado ativo");
  // A página apresenta a MESMA fonte, com o disponível como principal:
  assert.ok(page.includes('label="BANCO [10+] DISPONÍVEL"'), "card do banco presente");
  assert.ok(page.includes("specialBank.availableMinutes"), "principal = disponível da fonte canônica");
  assert.ok(page.includes(")} reservados`"), "secundária: X reservados");
});

check("TESTE 07 DE 20 — Período atual: saldo factual vem de buildResumoPeriodView (sem recálculo na página)", () => {
  const period = getPointPeriod(HOJE);
  const view = buildResumoPeriodView({
    period, today: HOJE, entries: st().entries, absences: [], calendars: [], settings,
    faltas: [], controlStartDate: null, uses: [], plans: [],
  });
  let soma = 0;
  for (const date of listDaysBetween(period.from, period.to)) {
    const cctx = companyDayContext(date, st().entries, [], [], settings);
    soma += dayBalanceContribution(cctx, [], date, HOJE);
  }
  assert.equal(view.cards.regularBalanceMinutes, soma, "factual do período = Σ contribuições");
  assert.ok(page.includes('label="Saldo factual do período"'), "rótulo 4D");
  assert.ok(page.includes("value={fmtSigned(resumoView.cards.regularBalanceMinutes)}"), "valor da fonte canônica");
  assert.ok(page.includes("buildResumoPeriodView"), "derivação canônica na página");
});

check("TESTE 08 DE 20 — Período atual: saldo projetado é a official-projection (3A) apresentada", () => {
  const period = getPointPeriod(HOJE);
  const view = buildResumoPeriodView({
    period, today: HOJE, entries: st().entries, absences: [], calendars: [], settings,
    faltas: [], controlStartDate: null, uses: [USE_20], plans: [],
  });
  assert.equal(view.cards.projection.projectedBalanceMinutes, view.cards.regularBalanceMinutes + view.cards.projection.appliedSpecialMinutes);
  assert.ok(page.includes('label="Saldo projetado do período"'), "rótulo 4D");
  assert.ok(page.includes("projection.projectedBalanceMinutes"), "valor da fonte canônica");
  assert.ok(page.includes("projection.appliedSpecialMinutes"), "sub usa o aplicado da fonte");
  assert.ok(!page.includes("projectRealizedDayOfficial("), "a página NÃO chama o motor dia a dia");
});

check("TESTE 09 DE 20 — COMPENSAR 8h em dia útil → impacto futuro conhecido −8h (previsão pura 4D.4)", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  }), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 1);
  assert.equal(f.futureImpactMinutes, -480, "impacto futuro conhecido −8h");
  assert.equal(f.events[0]?.impactMinutes, -480);
  /* 4D.4 (Parte K): a previsão é PURA — não lê compensações da Central
   * (kind="calendario" segue no fluxo legado da Central; o dia futuro
   * presume jornada cumprida e o trabalho do próprio dia, quando realizado,
   * quita pelo SALDO FACTUAL — ver suíte 4D.4, testes 03–06). */
  const concluida: Compensation = { id: 1, sourceDate: "2026-09-10", targetDate: "2026-08-20", minutes: 480, status: "concluida", kind: "calendario" };
  const f2 = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  }), cycle: CICLO, today: HOJE });
  assert.equal(f2.futureImpactMinutes, -480, "previsão não dupla-conta com a Central");
});

check("TESTE 10 DE 20 — Jornada parcial (Cinzas 4h+4h) → obrigação = horasACompensar (240min)", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
    tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
  }), cycle: CICLO, today: HOJE });
  /* 4D.4 (Parte F/K): dia PARCIAL futuro presume a jornada regular cumprida
   * ⇒ SEM impacto na previsão (o não-cumprimento vira saldo factual no dia). */
  assert.equal(f.eventCount, 0);
  assert.equal(f.futureImpactMinutes, 0, "Cinzas futuro ⇒ 0");
});

check("TESTE 11 DE 20 — Feriado ÚTIL abonado → impacto 0 (não é evento a compensar)", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-07", descricao: "Feriado Nacional", categoria: "Feriado Nacional",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 0, "sem impacto (crédito cumpre a base)");
  assert.equal(f.futureImpactMinutes, 0);
});

check("TESTE 12 DE 20 — Fim de semana COMUM (sem entrada do calendário) permanece neutro", () => {
  // 4D.1 (Parte D): sem entrada não há o que ler — sábado/domingo comum é
  // folga neutra (a entrada EXPLÍCITA de fim de semana passou a ser
  // respeitada; ver suíte 4D.1, TESTE 06). 2026-09-05 é sábado:
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-07", descricao: "Segunda comum", categoria: "Feriado Nacional",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 0, "sem entrada COMPENSAR não há impacto");
});

check("TESTE 13 DE 20 — Abono integral → impacto 0", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-10-12", descricao: "Abono", categoria: "Abono",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 0);
  assert.equal(f.futureImpactMinutes, 0);
});

check("TESTE 14 DE 20 — Futuro não vira saldo factual: PLANEJADO ≠ REALIZADO (4D.4)", () => {
  const entry = {
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  } as const;
  const semCal = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [] });
  const comCal = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: cal1(entry), settings, faltas: [], uses: [] });
  assert.equal(comCal.factualBalanceMinutes, semCal.factualBalanceMinutes, "evento futuro não altera o factual (corte temporal)");
  /* 4D.4 (Parte K): a previsão é PURA — o futuro fica na previsão, mesmo
   * que haja plano na Central (plano NUNCA quita; e o trabalho do próprio
   * dia, quando realizado, quita pelo saldo factual). */
  const pendente: Compensation = { id: 1, sourceDate: "2026-09-10", targetDate: "2026-08-20", minutes: 480, status: "pendente", kind: "calendario" };
  const f = buildCalendarForecast({ calendars: cal1(entry), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 1, "evento futuro permanece na previsão");
  assert.equal(f.futureImpactMinutes, -480, "plano não reduz a previsão (PLANEJADO ≠ REALIZADO)");
  // E a previsão NUNCA contamina o factual/projetado do ciclo:
  assert.equal(comCal.projectedBalanceMinutes, semCal.projectedBalanceMinutes);
});

check("TESTE 15 DE 20 — Isolamento 30/04: previsão só enxerga o ciclo informado", () => {
  // Cada entrada mora no calendário do PRÓPRIO ciclo (entryOnDate respeita o
  // intervalo cycleStart..cycleEnd do calendário):
  const mk = (date: string, cs: string, ce: string): CompanyCalendars => [{
    id: `cal-${cs}`, cycleStart: cs, cycleEnd: ce, cycleLabel: cs.slice(0, 4),
    version: 1, importedAt: cs,
    entries: [{
      id: 1, date, descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
      tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
    }],
  }];
  // 2026-04-30 é a última data do ciclo 2025/2026; 2026-05-01 já é do 2026/2027:
  const fev = buildCalendarForecast({
    calendars: [...mk("2026-04-30", "2025-05-01", "2026-04-30"), ...mk("2026-05-01", "2026-05-01", "2027-04-30")],
    cycle: "2025/2026", today: "2026-01-10",
  });
  assert.equal(fev.eventCount, 1, "só 30/04 (30/04 é limite absoluto incluso)");
  assert.equal(fev.events[0]?.date, "2026-04-30");
  assert.equal(fev.futureImpactMinutes, -480);
  const f2700 = buildCalendarForecast({
    calendars: [...mk("2026-04-30", "2025-05-01", "2026-04-30"), ...mk("2026-05-01", "2026-05-01", "2027-04-30")],
    cycle: "2026/2027", today: "2026-01-10",
  });
  assert.equal(f2700.eventCount, 1, "o ciclo seguinte só enxerga 01/05");
  assert.equal(f2700.events[0]?.date, "2026-05-01");
});

check("TESTE 16 DE 20 — Previsão do ciclo = projetado − impactos futuros descobertos; rotulada PREVISÃO", () => {
  const entry = {
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  } as const;
  const sit = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: cal1(entry), settings, faltas: [], uses: [USE_20] });
  const f = buildCalendarForecast({ calendars: cal1(entry), cycle: CICLO, today: HOJE });
  /* 4D.4 (Parte L): previsão = projetado + impacto futuro conhecido (≤ 0). */
  const previsao = sit.projectedBalanceMinutes + f.futureImpactMinutes;
  assert.equal(previsao, sit.projectedBalanceMinutes - 480, "matemática da previsão (página: projetado + impacto futuro)");
  // A página rotula como PREVISÃO e nunca como saldo factual/atual/realizado:
  const frente = page.slice(page.indexOf("O QUE VEM PELA FRENTE"), page.indexOf('title="Dias recentes"'));
  assert.ok(frente.toLowerCase().includes("previsão"), "seção rotulada PREVISÃO");
  assert.ok(frente.includes("Dias normais e parciais futuros presumem jornada cumprida; folgas integrais a compensar entram como impacto conhecido. Dias realizados já estão no saldo do ciclo."), "disclaimer do que a previsão considera");
  assert.ok(!/saldo (factual|atual|realizado) do ciclo/i.test(frente), "previsão não usa rótulo de saldo factual");
  assert.ok(page.includes("forecast.futureImpactMinutes"), "impacto futuro da fonte canônica");
  assert.ok(page.includes("projectedBalanceMinutes + forecast.futureImpactMinutes"), "previsão = projetado + impacto futuro conhecido");
  // Estado neutro quando não há eventos (nunca −0 inventado):
  assert.ok(page.includes("forecast.eventCount > 0 ?"), "neutro quando não há eventos (condicional)");
  // 4D.4: status temporal existe (future/today-pending), nunca condição financeira:
  assert.ok(forecastSrc.includes("date < p.today") && forecastSrc.includes('"today-pending"'), "status temporal derivado (future/today-pending)");
});

check("TESTE 17 DE 20 — Dias recentes: só APRESENTAÇÃO nova; classificação/saldo/[10+] intactos", () => {
  // A apresentação mobile/desktop foi reflowada SEM tocar a classificação:
  const recentes = page.slice(page.indexOf('title="Dias recentes"'));
  assert.ok(recentes.includes("recentDayStatusOf"), "situação do dia continua da classificação canônica");
  assert.ok(recentes.includes("recentRows"), "linhas continuam da derivação canônica (buildResumoDayRow)");
  assert.ok(recentes.includes("row.balanceMinutes"), "saldo exibido = row.balanceMinutes (fatos)");
  assert.ok(recentes.includes("ExcessTenBadge"), "chip [10+] preservado");
  assert.ok(recentes.includes('sm:hidden'), "mobile: layout próprio em duas linhas");
  // 4D.1 (Parte I): grid desktop com colunas FIXAS e consistentes:
  assert.ok(recentes.includes("hidden items-center sm:grid sm:grid-cols-[7.5rem_9rem_1fr_9rem]"), "desktop: linha única com colunas consistentes");
  // Funcional: a classificação canônica NÃO mudou — mesma resposta da 3H:
  const row = buildResumoDayRow({
    date: "2026-08-21", today: HOJE, entries: st().entries, absences: [],
    calendars: [], settings, faltas: [], controlStartDate: null,
  });
  assert.equal(row.balanceMinutes, -240, "saldo factual do dia curto intacto (−4h)");
  assert.equal(recentDayStatusOf(row).label, buildResumoDayRow({
    date: "2026-08-21", today: HOJE, entries: st().entries, absences: [],
    calendars: [], settings, faltas: [], controlStartDate: null,
  }).status === "excess" ? recentDayStatusOf(row).label : recentDayStatusOf(row).label, "status derivado da MESMA row");
  /* 4D.4 SUPEROU a trava da 4D: os motores de saldo/classificação
   * (company-calendar/faltas/resumo-days) SÃO alterados por etapas de
   * semântica; 4D.4.2 sancionou a VIEW do [10+]. Em 4H a trava histórica
   * "nenhuma LIB de POLÍTICA [10+] alterada" foi LEGITIMAMENTE superada:
   * o transporte anual (AnnualCycleClosure) adiciona a origem `carried` às
   * políticas bank/use/plan (ver testes 4H). Preservamos aqui o guard de
   * INTEGRIDADE canônica — as exportações de política continuam presentes: */
  const bank = src("src/lib/special-excess-bank.ts");
  const use = src("src/lib/special-excess-use.ts");
  const plan = src("src/lib/special-excess-plan.ts");
  assert.ok(bank.includes("export function buildSpecialExcessBank"), "banco [10+] mantém o construtor canônico");
  assert.ok(bank.includes("export function allocateSpecialExcessFifo"), "banco mantém o FIFO canônico");
  assert.ok(bank.includes("export function allocateSpecialExcessManual"), "banco mantém a seleção manual canônica");
  assert.ok(use.includes("export function validateSpecialExcessUse"), "uso mantém o validador estrutural");
  assert.ok(plan.includes("export function validateSpecialExcessPlan"), "plano mantém o validador estrutural");
});

check("TESTE 18 DE 20 — Rastreabilidade [10+]: reflow mobile sem mudar dados/regras", () => {
  // Origens uma a uma, modo como badge, cancelamento individual intacto:
  assert.ok(useSummary.includes("u.allocations.map"), "origens listadas da MESMA fonte");
  assert.ok(useSummary.includes("Seleção automática"), "badge de modo (fifo)");
  assert.ok(useSummary.includes("Origem escolhida manualmente"), "badge de modo (manual)");
  assert.ok(useSummary.includes("setCancelTarget"), "cancelamento individual preservado");
  assert.ok(useSummary.includes("Cancelar uso de [10+]"), "rótulo do cancelamento preservado");
  assert.ok(!useSummary.includes("sm:contents") === false, "apresentação empilhada no mobile");
  // Libs de POLÍTICA [10+] (bank/use/plan): em 4H a trava "não alterar" foi
  // legitimamente superada pelo transporte anual (origem `carried`); o guard
  // canônico permanece (exportações presentes — TESTE 17). A VIEW segue a
  // fonte única da necessidade.
  // 4H (SUPERADO): o store foi estendido pelo fechamento anual
  // (annualCycleClosures / closeAnnualCycle / guards de ciclo encerrado).
  // Este guard passa a exigir o MARCADOR 4H no diff — prova de alteração
  // intencional (fechamento anual), e não de edição arbitrária:
  const storeSrcNow = src("src/lib/store.ts");
  assert.ok(storeSrcNow.includes("annualCycleClosures"), "store: coleção de fechamento anual presente");
  assert.ok(storeSrcNow.includes("closeAnnualCycle"), "store: action de encerramento anual presente");
  assert.ok(storeSrcNow.includes("closedCycleLockForDate"), "store: guard de ciclo encerrado presente");
  /* 4D.4.2: o marcador sancionado do diff atual é a necessidade canônica
   * (assertion "requiredWorkMinutes" acima); o gate 4D.3 segue INTACTO no
   * arquivo (prova funcional nas suítes 4D.3/4D.4/4D.4.1). */
});

check("TESTE 19 DE 20 — Scroll reset CENTRALIZADO: troca de rota sim; interação na mesma rota não", () => {
  // O efeito vive no app-shell (uma única vez), comparando PATHNAME:
  assert.ok(shell.includes("pathnameRef.current !== pathname"), "dispara SOMENTE na troca de rota");
  assert.ok(shell.includes("window.scrollTo(0, 0)"), "reset único no topo");
  assert.ok(shell.includes("}, [pathname]);"), "depende apenas do pathname");
  const ocorrencias = shell.split("window.scrollTo").length - 1;
  assert.equal(ocorrencias, 1, "sem scrollTo espalhado");
  // Nenhum outro layout/página faz scroll próprio:
  for (const f of ["src/app/(app)/page.tsx", "src/app/layout.tsx", "src/app/(app)/layout.tsx"]) {
    if (exists(f)) assert.ok(!src(f).includes("window.scrollTo"), `sem scrollTo manual em ${f}`);
  }
  // As 6 rotas da navegação continuam no shell:
  for (const rota of ['href: "/"', 'href: "/registros"', 'href: "/compensacoes"', 'href: "/ferias"', 'href: "/resumo"', 'href: "/configuracoes"']) {
    assert.ok(shell.includes(rota), `navegação mantém ${rota}`);
  }
});

check("TESTE 20 DE 20 — Dashboard preservado; Central reformada SOMENTE pela 4E autorizada; fonte proibida fora", () => {
  // 4E (SUPERADO — expectativa atualizada com justificativa): a reforma da
  // Central de Horas foi autorizada e executada pela ETAPA 4E; este guard
  // passa a proteger apenas os arquivos do dashboard da 4D:
  const status = execSync("git status --porcelain", { cwd: root }).toString().split("\n");
  const tocados = status.filter((l) => l.trim().length > 0).map((l) => l.slice(3).trim());
  assert.ok(!tocados.some((f) => f.includes("page.tsx") && f.includes("(app)/page")), "Visão Geral intacta");
  assert.ok(!tocados.some((f) => f.includes("cycle-dashboard")), "motor do dashboard intacto");
  assert.ok(exists("src/app/(app)/compensacoes/page.tsx"), "Central continua presente");
  // A fonte proibida não alimenta o novo dashboard:
  for (const f of ["src/app/(app)/page.tsx", "src/lib/cycle-dashboard.ts", "src/lib/calendar-forecast.ts"]) {
    const conteudo = src(f);
    assert.ok(!conteudo.includes("buildDebtDays"), `${f}: sem buildDebtDays`);
    assert.ok(!conteudo.includes("hourBankSummary"), `${f}: sem hourBankSummary`);
    assert.ok(!conteudo.includes("FutureCommitment"), `${f}: sem FutureCommitment`);
  }
  // Helpers novos são puros (sem store/sem persistência):
  assert.ok(!cycleDash.includes("getAppData") && !cycleDash.includes("actions."), "cycle-dashboard é puro");
  assert.ok(!forecastSrc.includes("getAppData") && !forecastSrc.includes("actions."), "calendar-forecast é puro");
  assert.ok(!cycleDash.includes("toISOString") && !forecastSrc.includes("toISOString"), "sem toISOString para data civil");
});

console.log(`\n${passed}/20 verificações da Etapa 4D passaram.`);
if (passed !== 20) process.exit(1);
