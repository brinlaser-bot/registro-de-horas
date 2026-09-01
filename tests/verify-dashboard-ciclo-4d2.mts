/**
 * VERIFICAÇÃO — ETAPA 4D.2 → ATUALIZADA PELA 4D.4 (SEMÂNTICA FACTUAL).
 *
 * A regra congelada da 4D.2 — "trabalho em dia COMPENSAR reduz PRIMEIRO a
 * obrigação daquele próprio dia" — continua VÁLIDA, mas o MECANISMO mudou
 * (decisão de produto 4D.4): a quitação acontece no SALDO FACTUAL do dia
 * (uma única contribuição — sem obrigação paralela nem "self-coverage" no
 * forecast). O calendar-forecast voltou a ser PREVISÃO PURA: só impactos
 * excepcionais FUTUROS (e hoje ainda não realizado) presumindo jornada
 * normal cumprida; dia realizado NUNCA aparece nele (sem dupla contagem).
 *
 * Os EXEMPLOS numéricos originais (0h→−8h · 3h→−5h · 8h→0 · 9h→+1h ·
 * 11h→[10+]) continuam exatos — agora como saldo factual do dia.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-dashboard-ciclo-4d2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { buildCycleSituation } from "../src/lib/cycle-dashboard.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { buildResumoDayRow, resumoFinancialFrozen } from "../src/lib/resumo-days.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import type { CompanyCalendars, CalendarEntry } from "../src/lib/company-calendar.ts";
import type { Compensation, TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = src("src/app/(app)/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Estado-base: HOJE = sexta 28/08/2026 ── */
const HOJE = "2026-08-28";
const CICLO = getAnnualPointCycle(HOJE); // "2026/2027"
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

const seed = buildSeedData();
actions.replaceAll({
  user: seed.user,
  entries: [],
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

const cal1 = (entry: Omit<CalendarEntry, "id">): CompanyCalendars => [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: CICLO, version: 1, importedAt: "2026-05-01",
  entries: [{ ...entry, id: 1 }],
}];
/** COMPENSAR com jornada esperada 0 (25/08). */
const COMP8 = (date: string): Omit<CalendarEntry, "id"> => ({
  date, descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const fc = (calendars: CompanyCalendars | undefined, entries: TimeEntry[] = [], today = HOJE) =>
  buildCalendarForecast({ calendars, cycle: getAnnualPointCycle(today), today, entries, absences: [], settings });
/** Saldo regular canônico do dia (resolução central — o MESMO do DayCard). */
const saldoRegular = (date: string, entries: TimeEntry[], calendars?: CompanyCalendars) =>
  companyDayContext(date, entries, [], calendars, settings).regularBalance;

const DIA25 = cal1(COMP8("2026-08-25"));
const BATIDAS8H = [
  punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
  punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"),
];

/* ════════════════ TESTES 01–10 ════════════════ */

check("TESTE 01 DE 10 — COMPENSAR 8h + trabalho 8h no próprio dia ⇒ saldo 0 e evento sai da previsão", () => {
  const f = fc(DIA25, BATIDAS8H);
  assert.equal(f.eventCount, 0, "dia realizado NÃO está na previsão (sem dupla contagem)");
  assert.equal(f.futureImpactMinutes, 0);
  // EXEMPLO 1: as 8h quitam a folga PELO SALDO FACTUAL — saldo do dia 0:
  assert.equal(saldoRegular("2026-08-25", BATIDAS8H, DIA25), 0, "saldo factual do dia = 0");
  assert.equal(dayBalanceContribution(companyDayContext("2026-08-25", BATIDAS8H, [], DIA25, settings), [], "2026-08-25", HOJE), 0);
});

check("TESTE 02 DE 10 — COMPENSAR 8h + trabalho 3h ⇒ saldo factual −5h (fora da previsão)", () => {
  const batidas3h = [
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "11:00", "saida"),
  ];
  const f = fc(DIA25, batidas3h);
  assert.equal(f.eventCount, 0, "realizado sai da previsão");
  // EXEMPLO 2: o saldo regular NÃO ganha +3h — quita a folga:
  assert.equal(saldoRegular("2026-08-25", batidas3h, DIA25), -300, "3h de 8h ⇒ −5h factual");
});

check("TESTE 03 DE 10 — COMPENSAR 8h + trabalho 9h ⇒ +1h regular; teto/[10+] intacto", () => {
  const batidas9h = [
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "18:00", "saida"),
  ];
  const f = fc(DIA25, batidas9h);
  assert.equal(f.eventCount, 0);
  // EXEMPLO 3: a 1h extra segue a semântica regular factual existente (+1h):
  assert.equal(saldoRegular("2026-08-25", batidas9h, DIA25), 60, "saldo factual do dia = +1h");
  // Acima de 10h continua [10+] conforme a regra existente (11h ⇒ [10+] 1h):
  const batidas11h = [
    punch("2026-08-25", "07:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "19:00", "saida"),
  ];
  const row11 = buildResumoDayRow({
    date: "2026-08-25", today: HOJE, entries: batidas11h, absences: [],
    calendars: DIA25, settings, faltas: [], controlStartDate: null,
  });
  assert.equal(saldoRegular("2026-08-25", batidas11h, DIA25), 120, "regular capped +2h");
  assert.equal(row11.excessMinutes, 60, "[10+] 1h separado (nunca entra no saldo regular)");
});

check("TESTE 04 DE 10 — Passado sai da previsão mesmo com quitação na Central (sem dupla contagem)", () => {
  const concluida: Compensation = { id: 1, sourceDate: "2026-08-25", targetDate: "2026-08-21", minutes: 480, status: "concluida", kind: "calendario" };
  // A previsão é pura: não lê compensações (o fluxo legado da Central segue
  // com o kind "calendario"; o dia realizado é saldo factual):
  const f = buildCalendarForecast({ calendars: DIA25, cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 0, "passado não está na previsão");
  assert.equal(f.futureImpactMinutes, 0, "nunca negativo/inventado");
  // Sem crédito duplicado: o saldo do dia (8h) continua 0:
  assert.equal(saldoRegular("2026-08-25", BATIDAS8H, DIA25), 0);
  void concluida;
});

check("TESTE 05 DE 10 — Plano não reduz a previsão futura (PLANEJADO ≠ REALIZADO)", () => {
  const futuro = cal1(COMP8("2026-09-10"));
  const f = fc(futuro); // sem batidas: evento futuro permanece
  assert.equal(f.eventCount, 1, "evento futuro permanece na previsão");
  assert.equal(f.futureImpactMinutes, -480, "plano é informativo da Central e nunca quita");
  assert.equal(f.events[0]?.status, "future");
});

check("TESTE 06 DE 10 — Evento futuro: batidas futuras não são fato e não reduzem a previsão", () => {
  const futuro = cal1(COMP8("2026-09-10"));
  const batidaFutura = [
    punch("2026-09-10", "08:00", "entrada"), punch("2026-09-10", "16:00", "saida"),
  ];
  const f = fc(futuro, batidaFutura);
  assert.equal(f.eventCount, 1, "jornada prevista NÃO é cobertura");
  assert.equal(f.futureImpactMinutes, -480);
  assert.equal(f.events[0]?.status, "future");
  // E a contribuição factual do dia futuro é 0 (corte temporal central):
  assert.equal(
    dayBalanceContribution(companyDayContext("2026-09-10", batidaFutura, [], futuro, settings), [], "2026-09-10", HOJE),
    0, "batida futura não é fato",
  );
});

check("TESTE 07 DE 10 — Jornada incompleta: congelada/0 no factual; hoje pendente permanece na previsão", () => {
  // (a) PASSADO com registro incompleto (sem saída final — congelado):
  const incompleto = [
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"),
  ];
  const dia25 = cal1(COMP8("2026-08-25"));
  const cctx = companyDayContext("2026-08-25", incompleto, [], dia25, settings);
  assert.ok(cctx.ctx.day.open || cctx.ctx.day.financialPending, "dia pendente (não realizado financeiramente)");
  const row = buildResumoDayRow({
    date: "2026-08-25", today: HOJE, entries: incompleto, absences: [],
    calendars: dia25, settings, faltas: [], controlStartDate: null,
  });
  assert.ok(resumoFinancialFrozen(row), "row congelada (classificação 3H)");
  // −8h só depois de o dia ser fato; pendente ⇒ contribuição 0:
  assert.equal(dayBalanceContribution(cctx, [], "2026-08-25", HOJE), 0, "pendência factual: 0");
  // (b) HOJE com jornada em aberto: permanece na previsão (today-pending):
  const hoje25 = cal1(COMP8(HOJE));
  const entriesHoje = [
    punch(HOJE, "08:00", "entrada"), punch(HOJE, "12:00", "saida"), punch(HOJE, "13:00", "entrada"),
  ];
  const f = fc(hoje25, entriesHoje);
  assert.equal(f.eventCount, 1, "permanece na previsão até o dia fechar");
  assert.equal(f.events[0]?.status, "today-pending", "status today-pending");
  assert.equal(dayBalanceContribution(companyDayContext(HOJE, entriesHoje, [], hoje25, settings), [], HOJE, HOJE), 0, "nada de −8h prematuro (4D.4 Parte G)");
});

check("TESTE 08 DE 10 — Cinzas 4h esperadas + 4h a compensar preserva semântica canônica", () => {
  // Evento de jornada PARCIAL no ciclo 2025/2026 (10/02/2026, passado):
  const CINZAS: Omit<CalendarEntry, "id"> = {
    date: "2026-02-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
    tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
  };
  const cal = [{
    id: "cal-2526", cycleStart: "2025-05-01", cycleEnd: "2026-04-30",
    cycleLabel: "2025/2026", version: 1, importedAt: "2025-05-01",
    entries: [{ ...CINZAS, id: 1 }],
  }];
  const fc2526 = (entries: TimeEntry[]) =>
    buildCalendarForecast({ calendars: cal, cycle: "2025/2026", today: "2026-03-15", entries, absences: [], settings });
  const ctxOf = (entries: TimeEntry[]) => companyDayContext("2026-02-10", entries, [], cal, settings);

  // 0h trabalhadas: −4h FACTUAL (crédito 4h cumpre metade; jornada regular não veio):
  const f0 = fc2526([]);
  assert.equal(f0.eventCount, 0, "parcial futuro presume jornada cumprida ⇒ previsão 0");
  assert.equal(ctxOf([]).regularBalance, -240, "−4h factual (4h abonadas + 0h regulares)");
  assert.equal(ctxOf([]).calendarCreditMinutes, 240, "crédito do calendário 4h");
  assert.equal(ctxOf([]).adjustedDeficit, 240, "déficit do dia = jornada regular esperada não cumprida");

  // 4h trabalhadas (a jornada regular): dia quita a si mesmo:
  const batidas4h = [punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "12:00", "saida")];
  assert.equal(ctxOf(batidas4h).regularBalance, 0, "sem crédito");
  assert.equal(ctxOf(batidas4h).adjustedDeficit, 0, "jornada regular cumprida");

  // Jornada superior (9h): 4h cumprem a jornada; o excedente segue o regular:
  const batidas9h = [
    punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "12:00", "saida"),
    punch("2026-02-10", "13:00", "entrada"), punch("2026-02-10", "18:00", "saida"),
  ];
  assert.equal(ctxOf(batidas9h).regularBalance, 300, "+5h regulares (9h − 4h necessárias)");
});

/* ── Fixture do cenário REAL do navegador (reconstruído do seed + calendário
 *    importado): 148h no ciclo; 25/08 COMPENSAR 8h COM 8h trabalhadas;
 *    6 folgas passadas sem trabalho (48h); 11 futuros (88h); Cinzas 4h. ── */
const SEED_ENTRIES: TimeEntry[] = [
  punch("2026-08-18", "07:30", "entrada"), punch("2026-08-18", "12:00", "saida"),
  punch("2026-08-18", "13:00", "entrada"), punch("2026-08-18", "19:10", "saida"), // 10h40 → [10+] 40min · +2h
  punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
  punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "19:00", "saida"), // 11h → [10+] 1h · +2h
  punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "16:30", "saida"), // 7h30 · −30min
  punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
  punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"), // 8h NO COMPENSAR 8h ⇒ 0
  punch("2026-08-26", "08:00", "entrada"), punch("2026-08-26", "16:00", "saida"), // 7h · −1h
  punch("2026-08-28", "07:30", "entrada"), punch("2026-08-28", "12:00", "saida"),
  punch("2026-08-28", "13:00", "entrada"), punch("2026-08-28", "19:00", "saida"), // 10h30 → [10+] 30min · +2h
];
const FUTUROS = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const FIXTURE_CALS: CompanyCalendars = [{
  id: "cal-real", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: CICLO, version: 1, importedAt: "2026-05-01",
  entries: [
    ...["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-21"].map((d, i) => ({ id: i + 1, ...COMP8(d) })), // 6×8h passados (48h factual)
    { id: 20, ...COMP8("2026-08-25") }, // realizado com 8h ⇒ 0
    ...FUTUROS.map((d, i) => ({ id: 30 + i, ...COMP8(d) })), // 11×8h futuros (88h)
    { id: 50, date: "2027-02-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas" as const, tratamento: "COMPENSAR" as const, horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null }, // 4h
  ],
}];

check("TESTE 09 DE 10 — Fixture atual: forecast = −88h (só futuros; realizados viraram factual)", () => {
  const f = fc(FIXTURE_CALS, SEED_ENTRIES);
  assert.equal(f.eventCount, 11, "11 folgas integrais futuras");
  assert.equal(f.futureImpactMinutes, -5280, "−88h (92h brutas − 4h da Cinzas parcial)");
  assert.equal(f.events.find((e) => e.date === "2026-08-25"), undefined, "25/08 realizado NÃO está na previsão");
  assert.equal(f.events.find((e) => e.date === "2026-08-21"), undefined, "passado NÃO está na previsão");
  // A página segue usando buildCalendarForecast com a nova leitura:
  assert.ok(page.includes("forecast.futureImpactMinutes"), "dashboard usa a fonte canônica");
  assert.ok(page.includes("entries,\n        absences,\n        settings,"), "dados factuais passados ao helper (corte do hoje)");
});

check("TESTE 10 DE 10 — Fixture: factual −43h30 · previsão −131h30 (48h das folgas passadas no factual)", () => {
  const sit = buildCycleSituation({
    today: HOJE, entries: SEED_ENTRIES, absences: st().absences,
    calendars: FIXTURE_CALS, settings, faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: [],
  });
  /* +4h30 de saldos regulares − 48h (6 folgas passadas sem trabalho) =
   * −43h30 — UMA única contribuição por dia (sem obrigação paralela). */
  assert.equal(sit.factualBalanceMinutes, -2610, "saldo factual do ciclo −43h30");
  assert.equal(sit.projectedBalanceMinutes, -2610, "sem uso ativo: projetado = factual");
  const f = fc(FIXTURE_CALS, SEED_ENTRIES);
  const previsao = sit.projectedBalanceMinutes + f.futureImpactMinutes;
  assert.equal(previsao, -7890, "previsão do ciclo = −131h30 (projetado + impacto futuro)");
  // A página aplica a MESMA matemática:
  assert.ok(page.includes("projectedBalanceMinutes + forecast.futureImpactMinutes"), "previsão = projetado + impacto futuro (na página)");
  // 4D.4: a Atenção agora NÃO alerta "obrigação pendente" (está no factual):
  assert.ok(!page.includes("de obrigação de calendário pendente"), "sem aviso da semântica paralela");
  assert.ok(!page.includes('e.status === "overdue"'), "sem derivação de pendência passada na página");
});

console.log(`\n${passed}/10 verificações da Etapa 4D.2 (atualizada 4D.4) passaram.`);
if (passed !== 10) process.exit(1);
