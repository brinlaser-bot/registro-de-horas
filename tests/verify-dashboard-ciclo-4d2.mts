/**
 * VERIFICAÇÃO — ETAPA 4D.2: INTEGRAR TRABALHO NO PRÓPRIO DIA À COBERTURA DO
 * CALENDÁRIO.
 *
 * REGRA CONGELADA: "Trabalho em dia COMPENSAR reduz PRIMEIRO a obrigação
 * daquele próprio dia." A cobertura self é DERIVADA da resolução central
 * (companyDayContext: compensarSurplus = max(0, min(worked,10h) − obrigação)
 * é o crédito regular; o restante do teto consumiu a obrigação) — nenhuma
 * fórmula paralela. Proteção contra dupla cobertura:
 * covered = min(original, self + concluída externa). Planejado não reduz.
 * Futuro não possui self (batida futura proibida); jornada aberta/pendente
 * não cobre. Saldo factual/projetado [10+]/banco/Central INTACTOS.
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
const fc = (calendars: CompanyCalendars | undefined, compensations: Compensation[] = [], entries: TimeEntry[] = [], today = HOJE) =>
  buildCalendarForecast({ calendars, compensations, cycle: getAnnualPointCycle(today), today, entries, absences: [], settings });
/** Saldo regular canônico do dia (resolução central — o MESMO do DayCard). */
const saldoRegular = (date: string, entries: TimeEntry[], calendars?: CompanyCalendars) =>
  companyDayContext(date, entries, [], calendars, settings).regularBalance;

const DIA25 = cal1(COMP8("2026-08-25"));
const BATIDAS8H = [
  punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
  punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"),
];

/* ════════════════ TESTES 01–10 ════════════════ */

check("TESTE 01 DE 10 — COMPENSAR 8h + trabalho 8h no próprio dia ⇒ uncovered 0", () => {
  const f = fc(DIA25, [], BATIDAS8H);
  assert.equal(f.openEventCount, 0, "obrigação quitada pelo próprio dia");
  assert.equal(f.obligationMinutes, 480, "original 8h");
  assert.equal(f.selfWorkedCoverageMinutes, 480, "self = 8h (derivada do contexto canônico)");
  assert.equal(f.coveredMinutes, 480);
  assert.equal(f.uncoveredMinutes, 0);
  assert.equal(f.events[0]?.status, "settled", "quitada");
  // EXEMPLO 1: as 8h NÃO viram crédito regular — saldo do dia continua 0:
  assert.equal(saldoRegular("2026-08-25", BATIDAS8H, DIA25), 0, "saldo regular do dia = 0");
});

check("TESTE 02 DE 10 — COMPENSAR 8h + trabalho 3h ⇒ uncovered 5h", () => {
  const batidas3h = [
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "11:00", "saida"),
  ];
  const f = fc(DIA25, [], batidas3h);
  assert.equal(f.selfWorkedCoverageMinutes, 180, "self = 3h");
  assert.equal(f.uncoveredMinutes, 300, "5h em aberto");
  assert.equal(f.openEventCount, 1);
  assert.equal(f.events[0]?.status, "overdue", "passada e aberta");
  // EXEMPLO 2: o saldo regular NÃO ganha +3h:
  assert.equal(saldoRegular("2026-08-25", batidas3h, DIA25), 0, "saldo regular do dia = 0");
});

check("TESTE 03 DE 10 — COMPENSAR 8h + trabalho 9h ⇒ só 8h cobrem a obrigação", () => {
  const batidas9h = [
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "18:00", "saida"),
  ];
  const f = fc(DIA25, [], batidas9h);
  assert.equal(f.selfWorkedCoverageMinutes, 480, "somente 8h cobrem (nada de crédito duplo)");
  assert.equal(f.uncoveredMinutes, 0);
  // EXEMPLO 3: a 1h extra segue a semântica regular factual existente (+1h):
  assert.equal(saldoRegular("2026-08-25", batidas9h, DIA25), 60, "saldo regular do dia = +1h");
  // Acima de 10h continua [10+] conforme a regra existente (11h ⇒ [10+] 1h):
  const batidas11h = [
    punch("2026-08-25", "07:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "19:00", "saida"),
  ];
  const row11 = buildResumoDayRow({
    date: "2026-08-25", today: HOJE, entries: batidas11h, absences: [],
    calendars: DIA25, settings, faltas: [], controlStartDate: null,
  });
  assert.equal(row11.excessMinutes, 60, "[10+] intacto acima do teto");
  assert.equal(fc(DIA25, [], batidas11h).selfWorkedCoverageMinutes, 480, "self continua 8h");
});

check("TESTE 04 DE 10 — Trabalho próprio + concluída externa nunca cobrem acima do original", () => {
  const concluida: Compensation = { id: 1, sourceDate: "2026-08-25", targetDate: "2026-08-21", minutes: 480, status: "concluida", kind: "calendario" };
  const f = fc(DIA25, [concluida], BATIDAS8H);
  assert.equal(f.selfWorkedCoverageMinutes, 480, "self 8h");
  assert.equal(f.concludedExternalCoverageMinutes, 480, "histórico externo preservado INTEIRO (mesmo excedentário)");
  assert.equal(f.coveredMinutes, 480, "cobertura CAPADA no original");
  assert.equal(f.uncoveredMinutes, 0, "nunca negativo");
  // Sem crédito duplicado: o saldo regular do dia continua 0:
  assert.equal(saldoRegular("2026-08-25", BATIDAS8H, DIA25), 0);
});

check("TESTE 05 DE 10 — Planejada não reduz uncovered", () => {
  const pendente: Compensation = { id: 1, sourceDate: "2026-08-25", targetDate: "2026-08-21", minutes: 480, status: "pendente", kind: "calendario" };
  const f = fc(DIA25, [pendente]); // sem batidas: self 0
  assert.equal(f.selfWorkedCoverageMinutes, 0);
  assert.equal(f.plannedCoverageMinutes, 480, "planejada só informativa");
  assert.equal(f.concludedExternalCoverageMinutes, 0);
  assert.equal(f.uncoveredMinutes, 480, "não reduz");
});

check("TESTE 06 DE 10 — Evento futuro não possui selfWorkedCoverage", () => {
  const futuro = cal1(COMP8("2026-09-10"));
  const batidaFutura = [
    punch("2026-09-10", "08:00", "entrada"), punch("2026-09-10", "16:00", "saida"),
  ];
  const f = fc(futuro, [], batidaFutura);
  assert.equal(f.selfWorkedCoverageMinutes, 0, "batida futura é proibida/não realizada");
  assert.equal(f.uncoveredMinutes, 480, "jornada prevista NÃO é cobertura");
  assert.equal(f.events[0]?.status, "future");
});

check("TESTE 07 DE 10 — Jornada incompleta/inconsistente não reduz obrigação", () => {
  // Registro incompleto (sem saída final — dia financeiramente congelado):
  const incompleto = [
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"),
  ];
  const cctx = companyDayContext("2026-08-25", incompleto, [], DIA25, settings);
  assert.ok(cctx.ctx.day.open || cctx.ctx.day.financialPending, "dia pendente (não realizado financeiramente)");
  const row = buildResumoDayRow({
    date: "2026-08-25", today: HOJE, entries: incompleto, absences: [],
    calendars: DIA25, settings, faltas: [], controlStartDate: null,
  });
  assert.ok(resumoFinancialFrozen(row), "row congelada (classificação 3H)");
  const f = fc(DIA25, [], incompleto);
  assert.equal(f.selfWorkedCoverageMinutes, 0, "só jornada financeiramente VÁLIDA cobre");
  assert.equal(f.uncoveredMinutes, 480, "obrigação permanece integral");
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
    buildCalendarForecast({ calendars: cal, compensations: [], cycle: "2025/2026", today: "2026-03-15", entries, absences: [], settings });
  const ctxOf = (entries: TimeEntry[]) => companyDayContext("2026-02-10", entries, [], cal, settings);

  // 0h trabalhadas: nada cobre; déficit comum 0 (a dívida é a obrigação):
  const f0 = fc2526([]);
  assert.equal(f0.selfWorkedCoverageMinutes, 0);
  assert.equal(f0.uncoveredMinutes, 240, "4h em aberto");
  assert.equal(ctxOf([]).regularBalance, 0, "saldo regular 0");
  assert.equal(ctxOf([]).adjustedDeficit, 240, "jornada regular esperada 4h exibida como déficit do dia");

  // 4h trabalhadas (a jornada regular): obrigação própria coberta pelo dia:
  const batidas4h = [punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "12:00", "saida")];
  const f4 = fc2526(batidas4h);
  assert.equal(f4.selfWorkedCoverageMinutes, 240, "4h consumiram a obrigação própria");
  assert.equal(f4.uncoveredMinutes, 0);
  assert.equal(ctxOf(batidas4h).regularBalance, 0, "sem crédito");
  assert.equal(ctxOf(batidas4h).adjustedDeficit, 0, "jornada regular cumprida");

  // Jornada superior (9h): 4h cobrem a obrigação; o excedente segue o regular:
  const batidas9h = [
    punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "12:00", "saida"),
    punch("2026-02-10", "13:00", "entrada"), punch("2026-02-10", "18:00", "saida"),
  ];
  const f9 = fc2526(batidas9h);
  assert.equal(f9.selfWorkedCoverageMinutes, 240, "só a obrigação própria é coberta (nada duplicado)");
  assert.equal(f9.uncoveredMinutes, 0);
  assert.equal(ctxOf(batidas9h).regularBalance, 300, "+5h regulares (semântica canônica do contexto)");
});

/* ── Fixture do cenário REAL do navegador (reconstruído do seed + calendário
 *    importado): obrigações 148h no ciclo; 25/08 COMPENSAR 8h COM 8h
 *    trabalhadas; projetado do ciclo +4h30. ── */
const SEED_ENTRIES: TimeEntry[] = [
  punch("2026-08-18", "07:30", "entrada"), punch("2026-08-18", "12:00", "saida"),
  punch("2026-08-18", "13:00", "entrada"), punch("2026-08-18", "19:10", "saida"), // 10h40 → [10+] 40min · +2h
  punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
  punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "19:00", "saida"), // 11h → [10+] 1h · +2h
  punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "16:30", "saida"), // 7h30 · −30min
  punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
  punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"), // 8h NO COMPENSAR 8h
  punch("2026-08-26", "08:00", "entrada"), punch("2026-08-26", "16:00", "saida"), // 7h · −1h
  punch("2026-08-28", "07:30", "entrada"), punch("2026-08-28", "12:00", "saida"),
  punch("2026-08-28", "13:00", "entrada"), punch("2026-08-28", "19:00", "saida"), // 10h30 → [10+] 30min · +2h
];
const COMP8_ON = (date: string): Omit<CalendarEntry, "id"> => COMP8(date);
const FUTUROS = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const FIXTURE_CALS: CompanyCalendars = [{
  id: "cal-real", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: CICLO, version: 1, importedAt: "2026-05-01",
  entries: [
    ...["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-21"].map((d, i) => ({ id: i + 1, ...COMP8_ON(d) })), // 6×8h passados em aberto (48h)
    { id: 20, ...COMP8_ON("2026-08-25") }, // 8h self-coberta
    ...FUTUROS.map((d, i) => ({ id: 30 + i, ...COMP8_ON(d) })), // 11×8h futuros (88h)
    { id: 50, date: "2027-02-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas" as const, tratamento: "COMPENSAR" as const, horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null }, // 4h
  ],
}];

check("TESTE 09 DE 10 — Fixture atual: 148h originais − 8h do dia 25/08 = 140h descobertas", () => {
  const f = fc(FIXTURE_CALS, [], SEED_ENTRIES);
  assert.equal(f.obligationMinutes, 8880, "148h de obrigações originais no ciclo");
  assert.equal(f.selfWorkedCoverageMinutes, 480, "8h do próprio 25/08 cobrem a obrigação do dia");
  assert.equal(f.uncoveredMinutes, 8400, "140h descobertas (148h − 8h)");
  const ev25 = f.events.find((e) => e.date === "2026-08-25");
  assert.equal(ev25?.selfWorkedCoverageMinutes, 480);
  assert.equal(ev25?.uncoveredMinutes, 0, "25/08 sai do descoberto");
  assert.equal(ev25?.status, "settled");
  // A página segue usando buildCalendarForecast (nada recalculado nela):
  assert.ok(page.includes("forecast.uncoveredMinutes"), "dashboard usa a fonte canônica");
  assert.ok(page.includes("entries,\n        absences,\n        settings,"), "dados factuais passados ao helper (4D.2)");
});

check("TESTE 10 DE 10 — Dashboard: +4h30 − 140h = −135h30 e pendência passada = 48h", () => {
  const sit = buildCycleSituation({
    today: HOJE, entries: SEED_ENTRIES, absences: [],
    calendars: FIXTURE_CALS, settings, faltas: [],
    controlStartDate: st().user.controlStartDate ?? null, uses: [],
  });
  assert.equal(sit.projectedBalanceMinutes, 270, "saldo projetado do ciclo +4h30");
  const f = fc(FIXTURE_CALS, [], SEED_ENTRIES);
  assert.equal(f.uncoveredMinutes, 8400, "140h de calendário a compensar");
  const previsao = sit.projectedBalanceMinutes - f.uncoveredMinutes;
  assert.equal(previsao, -8130, "previsão do ciclo = −135h30");
  // Atenção agora: pendências passadas abertas caem de 56h para 48h:
  const overdue = f.events.filter((e) => e.status === "overdue").reduce((s, e) => s + e.uncoveredMinutes, 0);
  assert.equal(overdue, 2880, "48h passadas em aberto (antes da correção seriam 56h)");
  const todayUncovered = f.events.filter((e) => e.status === "today").reduce((s, e) => s + e.uncoveredMinutes, 0);
  assert.equal(todayUncovered, 0);
  // A página deriva a Atenção agora dos status do MESMO helper:
  assert.ok(page.includes('e.status === "overdue"'), "atenção agora usa o status canônico");
  assert.ok(page.includes('e.status === "today"'), "atenção agora usa o status canônico (hoje)");
  assert.ok(page.includes("de obrigação de calendário pendente"), "linguagem correta da pendência passada");
});

console.log(`\n${passed}/10 verificações da Etapa 4D.2 passaram.`);
if (passed !== 10) process.exit(1);
