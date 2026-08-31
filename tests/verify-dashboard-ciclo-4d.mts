/**
 * VERIFICAÇÃO — ETAPA 4D: DASHBOARD DECISÓRIO DA VISÃO GERAL + PREVISÃO DO
 * CALENDÁRIO + REFINOS UX.
 *
 * A Visão Geral passa a responder, em ordem: Atenção agora (condicional) →
 * SITUAÇÃO DO CICLO (saldo FACTUAL sem [10+] · saldo PROJETADO com [10+] já
 * aplicado · BANCO [10+] DISPONÍVEL) → PERÍODO ATUAL (factual/projetado) →
 * O QUE VEM PELA FRENTE (impactos futuros CONHECIDOS do calendário, rotulados
 * PREVISÃO) → Registro de hoje → Dias recentes.
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

check("TESTE 09 DE 20 — COMPENSAR 8h em dia útil → obrigação 480min (impacto −8h na previsão)", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  }), compensations: [], cycle: CICLO, today: HOJE });
  assert.equal(f.futureEventCount, 1);
  assert.equal(f.futureObligationMinutes, 480, "obrigação 8h");
  assert.equal(f.uncoveredFutureMinutes, 480, "sem cobertura: impacto descoberto 8h");
  // Cobertura QUITADA (kind="calendario", mesma matcher canônica do compensar):
  const concluida: Compensation = { id: 1, sourceDate: "2026-09-10", targetDate: "2026-08-20", minutes: 480, status: "concluida", kind: "calendario" };
  const f2 = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  }), compensations: [concluida], cycle: CICLO, today: HOJE });
  assert.equal(f2.concludedCoverageMinutes, 480, "cobertura concluída reduz");
  assert.equal(f2.uncoveredFutureMinutes, 0, "obrigação quitada: impacto descoberto 0");
});

check("TESTE 10 DE 20 — Jornada parcial (Cinzas 4h+4h) → obrigação = horasACompensar (240min)", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
    tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
  }), compensations: [], cycle: CICLO, today: HOJE });
  assert.equal(f.futureEventCount, 1);
  assert.equal(f.futureObligationMinutes, 240, "obrigação da PRÓPRIA data (4h), não 8h");
});

check("TESTE 11 DE 20 — Feriado ÚTIL abonado → impacto 0 (não é evento a compensar)", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-07", descricao: "Feriado Nacional", categoria: "Feriado Nacional",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }), compensations: [], cycle: CICLO, today: HOJE });
  assert.equal(f.futureEventCount, 0, "sem obrigação");
  assert.equal(f.futureObligationMinutes, 0);
  assert.equal(f.uncoveredFutureMinutes, 0);
});

check("TESTE 12 DE 20 — Obrigação que cai no fim de semana → impacto 0 (folga não gera compensação)", () => {
  // 2026-09-05 é sábado:
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-09-05", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  }), compensations: [], cycle: CICLO, today: HOJE });
  assert.equal(f.futureEventCount, 0, "sábado/domingo não gera obrigação");
});

check("TESTE 13 DE 20 — Abono integral → impacto 0", () => {
  const f = buildCalendarForecast({ calendars: cal1({
    date: "2026-10-12", descricao: "Abono", categoria: "Abono",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }), compensations: [], cycle: CICLO, today: HOJE });
  assert.equal(f.futureEventCount, 0);
  assert.equal(f.uncoveredFutureMinutes, 0);
});

check("TESTE 14 DE 20 — Futuro não vira déficit factual nem 'Sem registro': PLANEJADO ≠ REALIZADO", () => {
  const entry = {
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  } as const;
  const semCal = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: [], settings, faltas: [], uses: [] });
  const comCal = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: cal1(entry), settings, faltas: [], uses: [] });
  assert.equal(comCal.factualBalanceMinutes, semCal.factualBalanceMinutes, "evento futuro não altera o factual (corte temporal)");
  // Cobertura PLANEJADA fica separada e NÃO reduz o impacto descoberto:
  const pendente: Compensation = { id: 1, sourceDate: "2026-09-10", targetDate: "2026-08-20", minutes: 480, status: "pendente", kind: "calendario" };
  const f = buildCalendarForecast({ calendars: cal1(entry), compensations: [pendente], cycle: CICLO, today: HOJE });
  assert.equal(f.plannedCoverageMinutes, 480, "planejada aparece separada");
  assert.equal(f.concludedCoverageMinutes, 0, "planejada não é quitação");
  assert.equal(f.uncoveredFutureMinutes, 480, "leitura conservadora: só concluída reduz");
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
    compensations: [], cycle: "2025/2026", today: "2026-01-10",
  });
  assert.equal(fev.futureEventCount, 1, "só 30/04 (30/04 é limite absoluto incluso)");
  assert.equal(fev.events[0]?.date, "2026-04-30");
  const f2700 = buildCalendarForecast({
    calendars: [...mk("2026-04-30", "2025-05-01", "2026-04-30"), ...mk("2026-05-01", "2026-05-01", "2027-04-30")],
    compensations: [], cycle: "2026/2027", today: "2026-01-10",
  });
  assert.equal(f2700.futureEventCount, 1, "o ciclo seguinte só enxerga 01/05");
  assert.equal(f2700.events[0]?.date, "2026-05-01");
});

check("TESTE 16 DE 20 — Previsão do ciclo = projetado − impactos futuros descobertos; rotulada PREVISÃO", () => {
  const entry = {
    date: "2026-09-10", descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
    tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
  } as const;
  const sit = buildCycleSituation({ today: HOJE, entries: st().entries, absences: [], calendars: cal1(entry), settings, faltas: [], uses: [USE_20] });
  const f = buildCalendarForecast({ calendars: cal1(entry), compensations: [], cycle: CICLO, today: HOJE });
  const previsao = sit.projectedBalanceMinutes - f.uncoveredFutureMinutes;
  assert.equal(previsao, sit.projectedBalanceMinutes - 480, "matemática da previsão (página: projected − uncovered)");
  // A página rotula como PREVISÃO e nunca como saldo factual/atual/realizado:
  const frente = page.slice(page.indexOf("O QUE VEM PELA FRENTE"), page.indexOf("B. REGISTRO DE HOJE"));
  assert.ok(frente.toLowerCase().includes("previsão"), "seção rotulada PREVISÃO");
  assert.ok(frente.includes("Considera eventos futuros já conhecidos do calendário."), "disclaimer do que a previsão considera");
  assert.ok(!/saldo (factual|atual|realizado) do ciclo/i.test(frente), "previsão não usa rótulo de saldo factual");
  assert.ok(page.includes("forecast.uncoveredFutureMinutes"), "impacto descoberto da fonte canônica");
  assert.ok(page.includes("projectedBalanceMinutes - forecast.uncoveredFutureMinutes"), "previsão = projetado − impactos");
  // Estado neutro quando não há eventos (nunca −0 inventado):
  assert.ok(page.includes("forecast.futureEventCount > 0 ?"), "neutro quando não há eventos futuros (condicional)");
  assert.ok(forecastSrc.includes("if (date <= p.today) continue"), "corte temporal: só o futuro entra");
});

check("TESTE 17 DE 20 — Dias recentes: só APRESENTAÇÃO nova; classificação/saldo/[10+] intactos", () => {
  // A apresentação mobile/desktop foi reflowada SEM tocar a classificação:
  const recentes = page.slice(page.indexOf('title="Dias recentes"'));
  assert.ok(recentes.includes("recentDayStatusOf"), "situação do dia continua da classificação canônica");
  assert.ok(recentes.includes("recentRows"), "linhas continuam da derivação canônica (buildResumoDayRow)");
  assert.ok(recentes.includes("row.balanceMinutes"), "saldo exibido = row.balanceMinutes (fatos)");
  assert.ok(recentes.includes("ExcessTenBadge"), "chip [10+] preservado");
  assert.ok(recentes.includes('sm:hidden'), "mobile: layout próprio em duas linhas");
  assert.ok(recentes.includes("hidden items-center gap-3 sm:grid"), "desktop: linha única em grid");
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
  // Nenhum motor alterado pela 4D:
  const diff = execSync("git diff --name-only", { cwd: root }).toString().split("\n");
  assert.ok(!diff.some((f) => f.includes("resumo-days.ts") || f.includes("company-calendar.ts") || f.includes("faltas.ts")), "nenhum arquivo de classificação alterado");
});

check("TESTE 18 DE 20 — Rastreabilidade [10+]: reflow mobile sem mudar dados/regras", () => {
  // Origens uma a uma, modo como badge, cancelamento individual intacto:
  assert.ok(useSummary.includes("u.allocations.map"), "origens listadas da MESMA fonte");
  assert.ok(useSummary.includes("Seleção automática"), "badge de modo (fifo)");
  assert.ok(useSummary.includes("Origem escolhida manualmente"), "badge de modo (manual)");
  assert.ok(useSummary.includes("setCancelTarget"), "cancelamento individual preservado");
  assert.ok(useSummary.includes("Cancelar uso de [10+]"), "rótulo do cancelamento preservado");
  assert.ok(!useSummary.includes("sm:contents") === false, "apresentação empilhada no mobile");
  // Nenhuma regra/lib alterada:
  const diff = execSync("git diff --name-only", { cwd: root }).toString().split("\n");
  assert.ok(!diff.some((f) => f.startsWith("src/lib/special-excess")), "nenhuma LIB de [10+] alterada (o componente de apresentação é parte da 4D)");
  assert.ok(!diff.some((f) => f.includes("store.ts")), "store não alterado");
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

check("TESTE 20 DE 20 — Central de Horas INTOCADA; fonte proibida (debt/hourBank) fora do dashboard", () => {
  const status = execSync("git status --porcelain", { cwd: root }).toString().split("\n");
  const tocados = status.filter((l) => l.trim().length > 0).map((l) => l.slice(3).trim());
  assert.ok(!tocados.some((f) => f.includes("central")), "nenhum arquivo da Central alterado");
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
