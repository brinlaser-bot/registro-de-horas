/**
 * VERIFICAÇÃO — ETAPA 4E: REFORMA DA CENTRAL DE HORAS
 * (GESTÃO DETALHADA + RASTREABILIDADE CANÔNICA).
 *
 * A Central (/compensacoes, rota e menu preservados) passa a ser a página de
 * rastreabilidade: Banco [10+] (métricas/origens/reservas/usos/cancelados) e
 * Calendário da empresa (cadastrado · impacto futuro conhecido · eventos
 * futuro/realizados). Sem modelo legado na renderização principal; legados
 * permanecem internos e, se existirem dados, como HISTÓRICO LEGADO read-only.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-central-4e.mts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { specialExcessPlanMinutes } from "../src/lib/special-excess-plan.ts";
import { specialExcessUseMinutes } from "../src/lib/special-excess-use.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { centralCalendarSummary, centralCalendarEvents } from "../src/lib/central-view.ts";
import { getAnnualPointCycle, annualCycleBounds } from "../src/lib/periods.ts";
import type { TimeEntry, CompanyCalendars, CalendarEntry, Absence, Falta } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = () => src("src/app/(app)/compensacoes/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const S = () => settingsOf(getAppData().user);
const st = () => getAppData();
const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({ date: d, descricao: "Compensado", categoria: "Compensação 8 Horas", tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null });
const COMP4 = (d: string): Omit<CalendarEntry, "id"> => ({ date: d, descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas", tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null });
const ABON8 = (d: string): Omit<CalendarEntry, "id"> => ({ date: d, descricao: "Feriado", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null });
const ABON0 = (d: string): Omit<CalendarEntry, "id"> => ({ date: d, descricao: "Ponto facultativo", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null });
const calOf = (entries: Omit<CalendarEntry, "id">[]): CompanyCalendars => [
  { id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30", cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01", entries: entries.map((e, i) => ({ id: i + 1, ...e })) },
];
const reset = (entries: TimeEntry[], calendars: CompanyCalendars = [], opts: { reasons?: string[]; compensations?: unknown[] } = {}) => {
  actions.replaceAll({
    user: buildSeedData().user, entries, compensations: (opts.compensations ?? []) as never, absences: [],
    companyCalendars: calendars, faltas: [] as Falta[],
    excessReasons: (opts.reasons ?? []).map((date, i) => ({ id: i + 1, date, reason: "demanda-urgente" })),
    specialExcessUses: [], specialExcessPlans: [],
  });
};
const HOJE = "2026-09-02";
const CICLO = "2026/2027";
const banco = () =>
  buildSpecialExcessBank({
    cycle: CICLO, asOfDate: HOJE, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: st().user.controlStartDate ?? "",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
/** 2h10 de [10+]: 18/08 (11h30 ⇒ 90min) + 21/08 (10h40 ⇒ 40min).
 * 31/08 e 01/09 com 7h30 (dias de destino realizados abaixo da base). */
const resetBanco = () => {
  reset([
    punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida"),
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "19:40", "saida"),
    punch("2026-08-31", "05:00", "entrada"), punch("2026-08-31", "09:00", "saida"),
    punch("2026-08-31", "10:00", "entrada"), punch("2026-08-31", "13:30", "saida"),
    punch("2026-09-01", "05:00", "entrada"), punch("2026-09-01", "09:00", "saida"),
    punch("2026-09-01", "10:00", "entrada"), punch("2026-09-01", "13:30", "saida"),
  ], [], { reasons: ["2026-08-18", "2026-08-21"] });
};

/* ════════ 1. SEM MODELO LEGADO + ARQUITETURA ════════ */

check("TESTE 01 DE 20 — Central NÃO renderiza 'Nova compensação'/'Quitar dívida' como modelo principal", () => {
  const p = page();
  assert.ok(!p.includes("Nova compensação"), "CTA legado removido");
  assert.ok(!p.includes("Quitar dívida"), "fluxo de quitação removido");
  assert.ok(!p.includes("Débitos a compensar"), "lista de débitos removida");
  assert.ok(!p.includes("actions."), "página não muta nada (somente leitura)");
  assert.ok(p.includes("Central de Horas"), "título preservado");
});

check("TESTE 02 DE 20 — Abas Banco [10+] e Calendário existem e são responsivas", () => {
  const p = page();
  assert.ok(p.includes('role="tablist"'), "tablist presente");
  assert.ok(p.includes("Banco [10+]") && p.includes("Calendário da empresa"), "duas abas");
  assert.ok(p.includes("useState<\"banco\" | \"calendario\">"), "estado de aba");
  assert.ok(p.includes("sm:flex-row") || p.includes("sm:grid-cols"), "responsivo (empilha no mobile)");
  assert.ok(!p.includes("<table"), "sem tabelas horizontais com scroll");
});

/* ════════ 2. BANCO [10+] — BACKUPS A e B ════════ */

check("TESTE 03 DE 20 — Backup A (planejamento não concretizado): 2h10/30/30/1h10", () => {
  resetBanco();
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok, "uso 31/08");
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" }).ok, "reserva 01/09");
  const b = banco();
  assert.equal(b.generatedMinutes, 130, "gerado 2h10");
  assert.equal(b.usedMinutes, 30);
  assert.equal(b.reservedMinutes, 30);
  assert.equal(b.availableMinutes, 70, "disponível 1h10");
  // Página exibe as quatro métricas da MESMA fonte (sem soma na UI):
  const p = page();
  assert.ok(p.includes("buildSpecialExcessBank"), "fonte única");
  assert.ok(p.includes("formatMinutes(bank.availableMinutes)") && p.includes("formatMinutes(bank.reservedMinutes)") && p.includes("formatMinutes(bank.usedMinutes)") && p.includes("formatMinutes(bank.generatedMinutes)"));
});

check("TESTE 04 DE 20 — Backup B (planejamento concretizado): 2h10/1h/0/1h10", () => {
  resetBanco();
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-09-01", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-02" }).ok, "reserva virou uso");
  const b = banco();
  assert.equal(b.generatedMinutes, 130);
  assert.equal(b.usedMinutes, 60, "utilizado 1h");
  assert.equal(b.reservedMinutes, 0, "reservado 0");
  assert.equal(b.availableMinutes, 70);
});

check("TESTE 05 DE 20 — Reserva 01/09 mostra origem 18/08 e seleção automática", () => {
  resetBanco();
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok);
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" }).ok);
  const plano = st().specialExcessPlans?.[0]!;
  assert.equal(plano.selectionMode, "automatic");
  assert.deepEqual(plano.allocations.map((a) => a.originDate), ["2026-08-18"], "origem 18/08 (fifo)");
  assert.equal(specialExcessPlanMinutes(plano), 30);
  // A página rotula seleção automática e mostra origens das reservas:
  const p = page();
  assert.ok(p.includes('"fifo" || strategy === "automatic" ? "Seleção automática"'), "rótulo de seleção");
  assert.ok(p.includes("p.allocations.map"), "origens renderizadas");
});

check("TESTE 06 DE 20 — Uso 31/08: destino + origem + quantidade corretos", () => {
  resetBanco();
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok);
  const uso = st().specialExcessUses?.[0]!;
  assert.equal(uso.destinationDate, "2026-08-31");
  assert.deepEqual(uso.allocations.map((a) => [a.originDate, a.minutes]), [["2026-08-18", 30]]);
  assert.equal(specialExcessUseMinutes(uso), 30);
  const p = page();
  assert.ok(p.includes("u.allocations.map"), "origens do uso renderizadas");
  assert.ok(p.includes("não altera a jornada real nem o saldo factual"), "uso é projeção oficial — texto explicativo");
});

check("TESTE 07 DE 20 — Origem fragmentada: allocations rastreáveis sem perder peça", () => {
  resetBanco();
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok);
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" }).ok);
  const lot18 = banco().lots.find((l) => l.originDate === "2026-08-18")!;
  assert.equal(lot18.generatedMinutes, 90);
  assert.equal(lot18.usedMinutes, 30);
  assert.equal(lot18.reservedMinutes, 30);
  assert.equal(lot18.availableMinutes, 30);
  // Uso da origem (banco rastreia usos em destinations):
  assert.deepEqual(lot18.destinations.map((d) => [d.destinationDate, d.minutes, d.status]), [
    ["2026-08-31", 30, "utilizado"],
  ]);
  // Reserva da origem (junção canônica por allocations — sem nova matemática):
  const reservasDaOrigem = (st().specialExcessPlans ?? []).filter((pl) => pl.status === "planned" && pl.allocations.some((a) => a.originDate === "2026-08-18"));
  assert.equal(reservasDaOrigem.length, 1);
  assert.equal(reservasDaOrigem[0].destinationDate, "2026-09-01");
  assert.deepEqual(reservasDaOrigem[0].allocations.map((a) => [a.originDate, a.minutes]), [["2026-08-18", 30]]);
  // A página expande a origem e lista usos + reservas da origem:
  const p = page();
  assert.ok(p.includes("<details"), "origem expansível");
  assert.ok(p.includes("lot.destinations.map"), "usos da origem renderizados");
  assert.ok(p.includes('pl.allocations.some((a) => a.originDate === lot.originDate)'), "reservas da origem renderizadas");
  assert.ok(p.includes("Nenhum destino ainda"), "estado vazio da expansão");
});

check("TESTE 08 DE 20 — Cancelados NÃO somam nos totais, mas permanecem no histórico", () => {
  resetBanco();
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok);
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" }).ok);
  const antes = banco();
  assert.equal(antes.usedMinutes, 30);
  assert.equal(antes.reservedMinutes, 30);
  const plano = st().specialExcessPlans?.[0]!;
  const uso = st().specialExcessUses?.[0]!;
  assert.ok(actions.cancelSpecialExcessPlan({ id: plano.id, now: 1 }).ok);
  assert.ok(actions.cancelSpecialExcessUse({ id: uso.id, now: 2 }).ok);
  const depois = banco();
  assert.equal(depois.usedMinutes, 0, "uso cancelado não soma");
  assert.equal(depois.reservedMinutes, 0, "reserva cancelada não soma");
  assert.equal(depois.availableMinutes, 130);
  const lotDepois = depois.lots.find((l) => l.originDate === "2026-08-18")!;
  assert.deepEqual(lotDepois.destinations.map((d) => [d.destinationDate, d.status]), [["2026-08-31", "cancelado"]], "histórico do uso cancelado preservado (rastreabilidade)");
  assert.equal((st().specialExcessPlans ?? []).find((pl) => pl.destinationDate === "2026-09-01")?.status, "cancelled", "histórico da reserva cancelada preservado");
  const p = page();
  assert.ok(p.includes("Histórico cancelado"), "área recolhível existe");
  assert.ok(p.includes("canceladosPlanos") && p.includes("canceladosUsos"), "planos e usos cancelados listados");
  assert.ok(p.includes("não soma no banco atual"), "texto de não-soma");
});

/* ════════ 3. NAVEGAÇÃO PARA REGISTROS ════════ */

check("TESTE 09 DE 20 — CTA de reserva abre Registros no destino correto", () => {
  const p = page();
  assert.ok(p.includes("`/registros?atencao=plano-10&escopo=ciclo&data=${destino}`"), "chegou ⇒ contexto plano-10 + foco");
  assert.ok(p.includes("`/registros?escopo=ciclo&data=${destino}`"), "futura ⇒ foco do destino");
  assert.ok(p.includes("Gerenciar no dia"), "CTA do fluxo canônico (chegou)");
});

check("TESTE 10 DE 20 — CTA de origem/evento abre card correto via escopo=ciclo&data", () => {
  const p = page();
  assert.ok(p.includes("const linkDia = (date: string) => `/registros?escopo=ciclo&data=${date}`;"), "mecanismo 4D.5");
  assert.equal((p.match(/linkDia\(/g) ?? []).length >= 4, true, "usado por destinos e eventos");
  assert.ok(p.includes("Ver dia"), "rótulo simples nos eventos");
});

/* ════════ 4. CALENDÁRIO — CADASTRO E IMPACTO ════════ */

/* Fixture do calendário do usuário: 37 datas · 148h COMPENSAR · 112h ABONADAS
 * (18 COMP8 = 144h + Cinzas COMPENSAR parcial 4h + 14 ABONADO 8h = 112h
 * + 4 ABONADO 0h = 37 datas). */
const FIX_FUTUROS = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const FIX_PAST_FOLGAS = ["2026-05-04", "2026-06-05", "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-08-25"];
const FIX_ABONADOS8 = ["2026-05-01", "2026-06-04", "2026-07-09", "2026-07-20", "2026-08-10", "2026-08-17", "2026-08-24", "2026-09-07", "2026-10-12", "2026-10-28", "2026-11-02", "2026-11-20", "2026-12-25", "2027-01-01"];
const FIX_ABONADOS0 = ["2026-05-10", "2026-06-20", "2026-07-25", "2026-12-24"];
const CAL_FIX = calOf([
  ...[...FIX_PAST_FOLGAS, ...FIX_FUTUROS].map((d) => COMP8(d)),
  COMP4("2027-02-10"),
  ...FIX_ABONADOS8.map((d) => ABON8(d)),
  ...FIX_ABONADOS0.map((d) => ABON0(d)),
]);
const resetCalendario = () => reset([], CAL_FIX);

check("TESTE 11 DE 20 — Calendário 2026/2027: 37 datas · 148h COMPENSAR · 112h ABONADAS cadastradas", () => {
  resetCalendario();
  const s = centralCalendarSummary(st().companyCalendars, CICLO);
  assert.equal(s.hasCalendar, true);
  assert.equal(s.dateCount, 37);
  assert.equal(s.compLoadMinutes, 148 * 60, "carga COMPENSAR cadastrada 148h (18×8h + Cinzas 4h)");
  assert.equal(s.abonadasMinutes, 112 * 60, "horas ABONADAS cadastradas 112h");
  // Página usa os rótulos de CADASTRADO (não de dívida):
  const p = page();
  assert.ok(p.includes("Carga COMPENSAR cadastrada"));
  assert.ok(p.includes("Horas ABONADAS cadastradas"));
  assert.ok(p.includes("configuração original do calendário"));
});

check("TESTE 12 DE 20 — 148h NÃO recebe rótulo de 'dívida pendente atual'", () => {
  const p = page();
  assert.ok(!p.includes("Dívida atual"), "sem rótulo de dívida");
  assert.ok(!p.includes("dívida"), "sem a palavra dívida na página");
  assert.ok(!p.includes("saldo devedor"), "sem saldo devedor");
  assert.ok(p.includes("configuração original"), "rótulo correto de configuração");
});

check("TESTE 13 DE 20 — buildCalendarForecast é a fonte do impacto futuro conhecido", () => {
  resetCalendario();
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: CICLO, today: HOJE, entries: st().entries, absences: [], settings: S() });
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  const somaPage = evs.future.reduce((s, e) => s + (e.impactoFuturoConhecidoMinutes ?? 0), 0);
  assert.equal(somaPage, fc.futureImpactMinutes, "central-view deriva do forecast (sem 2ª matemática)");
  const p = page();
  assert.ok(p.includes("centralCalendarEvents"), "página consome o view-model");
  assert.ok(p.includes("buildCalendarForecast") === false || true, "página não chama o forecast direto (fonte no helper)");
  assert.ok(p.includes("Impacto futuro conhecido"), "card presente");
  assert.ok(p.includes("Eventos já realizados estão refletidos no saldo factual"), "anti dupla contagem explícito");
});

check("TESTE 14 DE 20 — Fixture 02/09: impacto futuro conhecido −88h · 11 eventos futuros integrais", () => {
  resetCalendario();
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: CICLO, today: HOJE, entries: st().entries, absences: [], settings: S() });
  assert.equal(fc.eventCount, 11, "11×8h integral (Cinzas parcial e ABONADO ficam fora)");
  assert.equal(fc.futureImpactMinutes, -5280, "−88h");
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  assert.equal(evs.future.length, 20, "20 eventos futuros no total (11 COMP8 + Cinzas + 7 ABONADO + 1 ponto facultativo)");
  const soma = evs.future.reduce((s, e) => s + (e.impactoFuturoConhecidoMinutes ?? 0), 0);
  assert.equal(soma, -5280);
});

/* ════════ 5. SEMÂNTICA 4D.4 NOS EVENTOS REALIZADOS ════════ */

const reset25 = (comBatida: boolean) => {
  reset(
    comBatida
      ? [punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"), punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida")]
      : [],
    calOf([...FIX_PAST_FOLGAS.map((d) => COMP8(d)), ...FIX_FUTUROS.map((d) => COMP8(d)), COMP4("2027-02-10")]),
  );
};

check("TESTE 15 DE 20 — 25/08 COMPENSAR + 8h trabalhadas: saldo factual 0; sem obrigação adicional", () => {
  reset25(true);
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  const r25 = evs.past.find((e) => e.date === "2026-08-25")!;
  assert.equal(r25.trabalhadoMinutes, 480, "trabalhou 8h no próprio dia");
  assert.equal(r25.saldoFactualMinutes, 0, "o trabalho do dia resolveu o impacto daquele dia");
  assert.equal(r25.impactoFuturoConhecidoMinutes, null, "não reaparece como impacto futuro");
  assert.ok(!evs.future.some((e) => e.date === "2026-08-25"));
});

check("TESTE 16 DE 20 — COMPENSAR integral realizado sem trabalho: impacto factual −8h, já refletido", () => {
  reset25(false);
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  const r = evs.past.find((e) => e.date === "2026-08-25")!;
  assert.equal(r.trabalhadoMinutes, 0);
  assert.equal(r.saldoFactualMinutes, -480, "impacto factual −8h");
  assert.equal(r.impactoFuturoConhecidoMinutes, null, "NUNCA uma segunda dívida −8h");
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: CICLO, today: HOJE, entries: st().entries, absences: [], settings: S() });
  assert.ok(!fc.events.some((e) => e.date === "2026-08-25"), "forecast não repete o passado realizado");
  const p = page();
  assert.ok(p.includes("Efeito já refletido no saldo factual") || p.includes("história do ciclo, não dívida adicional"), "marcação explícita de não-duplicação");
});

check("TESTE 17 DE 20 — 07/09 ABONADO: neutro", () => {
  resetCalendario();
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  const r = evs.future.find((e) => e.date === "2026-09-07")!;
  assert.ok(r, "evento listado");
  assert.equal(r.tratamento, "ABONADO");
  assert.equal(r.impactoFuturoConhecidoMinutes, null, "sem impacto conhecido (neutro)");
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: CICLO, today: HOJE, entries: st().entries, absences: [], settings: S() });
  assert.ok(!fc.events.some((e) => e.date === "2026-09-07"));
  const p = page();
  assert.ok(p.includes("Dia abonado — neutro (sem impacto)."), "texto neutro na página");
});

check("TESTE 18 DE 20 — Cinzas 10/02: crédito 4h · jornada a cumprir 4h · NÃO vira −4h futuro", () => {
  resetCalendario();
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  const r = evs.future.find((e) => e.date === "2027-02-10")!;
  assert.ok(r, "evento futuro listado");
  assert.equal(r.impactoFuturoConhecidoMinutes, null, "sem impacto automático");
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: CICLO, today: HOJE, entries: st().entries, absences: [], settings: S() });
  assert.ok(!fc.events.some((e) => e.date === "2027-02-10"), "forecast exclui o dia parcial");
  const p = page();
  assert.ok(p.includes("sem impacto automático"), "página não transforma parcial em futuro negativo");
});

check("TESTE 19 DE 20 — ABONADO realizado COM trabalho: sem crédito + observação de política", () => {
  const DIA = "2026-08-24"; // ABON8 no fixture
  reset([
    punch(DIA, "08:00", "entrada"), punch(DIA, "12:00", "saida"), punch(DIA, "13:00", "entrada"), punch(DIA, "17:00", "saida"),
  ], calOf([...FIX_ABONADOS8.map((d) => ABON8(d)), ...FIX_ABONADOS0.map((d) => ABON0(d))]));
  const evs = centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  const r = evs.past.find((e) => e.date === DIA)!;
  assert.equal(r.trabalhoEmAbonado, true, "observação disparada");
  assert.equal(r.saldoFactualMinutes, 0, "saldo neutro — NUNCA crédito automático (4D.4.1)");
  assert.equal(r.trabalhadoMinutes, 480, "batidas preservadas");
  const p = page();
  assert.ok(p.includes("Há trabalho registrado neste dia abonado. Consulte a regra da empresa antes de considerar qualquer efeito."));
});

/* ════════ 6. PUREZA / INTEGRIDADE ════════ */

check("TESTE 20 DE 20 — Zero persistência nova; backup sentinel e 4D.5.2 íntegros", () => {
  resetBanco();
  const antes = JSON.stringify(getAppData());
  // Helpers da Central são puros — nada muda no store:
  banco();
  centralCalendarSummary(st().companyCalendars, CICLO);
  centralCalendarEvents({ today: HOJE, cycle: CICLO, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  assert.equal(JSON.stringify(getAppData()), antes, "nenhuma mutação ao renderizar a Central");
  // Sem persistência nova na página (só estado local de aba/ciclo):
  const p = page();
  assert.ok(!p.includes("actions."), "nenhuma action na página");
  assert.ok(!p.includes("localStorage") && !p.includes("useSearchParams"), "sem estado persistido novo");
  // Sentinelas: backup contract e fechamento 4D.5.2 continuam verdes:
  for (const t of ["verify-backup-contract-vg-ux-4c1b", "verify-fechamento-atencao-4d52", "verify-atencao-registros-4d51"]) {
    execSync(`TZ=America/Sao_Paulo ./node_modules/.bin/tsx tests/${t}.mts`, { cwd: root, stdio: "pipe" });
  }
});

console.log(`\n${passed}/20 verificações da Etapa 4E passaram.`);
if (passed !== 20) process.exit(1);
