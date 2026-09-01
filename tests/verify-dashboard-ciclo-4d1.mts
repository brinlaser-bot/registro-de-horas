/**
 * VERIFICAÇÃO — ETAPA 4D.1: CORREÇÃO SEMÂNTICA DO CALENDÁRIO + REFINO FINAL
 * DA VISÃO GERAL.
 *
 * Dois bugs semânticos da 4D corrigidos em src/lib/calendar-forecast.ts:
 *  (1) a obrigação de calendário DESAPARECIA na data (corte date > today) —
 *      a data do evento diz quando a folga ACONTECE, não quando a obrigação
 *      deixa de existir: ela persiste aberta (uncovered > 0) dentro do ciclo,
 *      seja futura, de hoje ou passada em aberto;
 *  (2) COMPENSAR EXPLÍCITO em sábado/domingo era descartado — fim de semana
 *      COMUM continua neutro, mas entrada do calendário é respeitada em
 *      qualquer dia, usando SOMENTE o horasACompensar importado.
 *
 * Além disso: indicador renomeado ("Obrigações de calendário a compensar"),
 * previsão = saldo projetado − obrigações em aberto, "Atenção agora" avisa
 * obrigação de hoje/passada aberta, ordem da VG com Registro de hoje no topo
 * (após saudação/atenção), cards compactos e grid desktop consistente em
 * Dias recentes. Factual/projetado [10+]/banco/Registro/Regras/Central
 * INTACTOS — sem buildDebtDays/hourBankSummary como fonte.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-dashboard-ciclo-4d1.mts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { buildCycleSituation } from "../src/lib/cycle-dashboard.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import type { CompanyCalendars, CalendarEntry } from "../src/lib/company-calendar.ts";
import type { Compensation, TimeEntry } from "../src/lib/types.ts";
import type { SpecialExcessUse } from "../src/lib/special-excess-use.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = src("src/app/(app)/page.tsx");
const forecastSrc = src("src/lib/calendar-forecast.ts");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Estado-base: HOJE = sexta 28/08/2026; passados 20/08 (excedente 20min)
 *    e 21/08 (curto 4h) ── */
const HOJE = "2026-08-28"; // sexta-feira
const CICLO = getAnnualPointCycle(HOJE); // "2026/2027"
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const ENTRIES: TimeEntry[] = [
  punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "19:20", "saida"), // excedente factual 20min
  punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "12:00", "saida"), // curto 240min
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

const cal1 = (entry: Omit<CalendarEntry, "id">): CompanyCalendars => [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: CICLO, version: 1, importedAt: "2026-05-01",
  entries: [{ ...entry, id: 1 }],
}];
const COMP8 = (date: string): Omit<CalendarEntry, "id"> => ({
  date, descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const USE_20: SpecialExcessUse = {
  id: "use-1", destinationDate: "2026-08-21",
  allocations: [{ originDate: "2026-08-20", minutes: 20 }],
  allocationStrategy: "fifo", status: "utilizado", createdAt: 1,
};
const fc = (calendars: CompanyCalendars | undefined, compensations: Compensation[] = [], today = HOJE) =>
  buildCalendarForecast({ calendars, compensations, cycle: CICLO, today });

/* ════════════════ TESTES 01–12 ════════════════ */

check("TESTE 01 DE 12 — COMPENSAR futuro aberto entra no total", () => {
  const f = fc(cal1(COMP8("2026-09-10")));
  assert.equal(f.openEventCount, 1);
  assert.equal(f.obligationMinutes, 480, "obrigação original 8h");
  assert.equal(f.uncoveredMinutes, 480, "sem cobertura: 8h em aberto");
  assert.equal(f.events[0]?.status, "future", "status temporal future");
  assert.equal(f.events[0]?.originalMinutes, 480, "originalMinutes derivado da entrada");
});

check("TESTE 02 DE 12 — COMPENSAR cuja data === today permanece no total", () => {
  const f = fc(cal1(COMP8(HOJE)));
  assert.equal(f.openEventCount, 1, "NÃO desaparece na data (bug 1 da 4D)");
  assert.equal(f.uncoveredMinutes, 480, "obrigação de hoje em aberto");
  assert.equal(f.events[0]?.status, "today", "status temporal today");
});

check("TESTE 03 DE 12 — COMPENSAR passado ainda aberto permanece no total", () => {
  const f = fc(cal1(COMP8("2026-08-20")));
  assert.equal(f.openEventCount, 1, "passada e aberta continua contabilizada");
  assert.equal(f.uncoveredMinutes, 480);
  assert.equal(f.events[0]?.status, "overdue", "status temporal overdue (passada em aberto)");
});

check("TESTE 04 DE 12 — COMPENSAR passado integralmente concluído sai do uncovered", () => {
  const concluida: Compensation = { id: 1, sourceDate: "2026-08-20", targetDate: "2026-08-21", minutes: 480, status: "concluida", kind: "calendario" };
  const f = fc(cal1(COMP8("2026-08-20")), [concluida]);
  assert.equal(f.concludedCoverageMinutes, 480, "cobertura concluída registrada");
  assert.equal(f.obligationMinutes, 480, "original permanece no histórico do ciclo");
  assert.equal(f.uncoveredMinutes, 0, "uncovered zerado");
  assert.equal(f.openEventCount, 0, "sai do total em aberto");
  assert.equal(f.events[0]?.status, "settled", "status settled (quitada)");
});

check("TESTE 05 DE 12 — Cobertura planejada NÃO reduz uncovered", () => {
  const pendente: Compensation = { id: 1, sourceDate: "2026-08-20", targetDate: "2026-08-21", minutes: 480, status: "pendente", kind: "calendario" };
  const f = fc(cal1(COMP8("2026-08-20")), [pendente]);
  assert.equal(f.plannedCoverageMinutes, 480, "planejada aparece separada");
  assert.equal(f.concludedCoverageMinutes, 0, "planejada não é quitação");
  assert.equal(f.uncoveredMinutes, 480, "leitura conservadora: só concluída reduz");
  assert.equal(f.openEventCount, 1);
  // Vínculo canônico preservado: kind="calendario" + sourceDate === data da obrigação.
  assert.ok(forecastSrc.includes('c.sourceDate !== date'), "cobertura específica por sourceDate");
  assert.ok(forecastSrc.includes('!== "calendario"'), "só kind calendario cobre obrigação de calendário");
});

check("TESTE 06 DE 12 — COMPENSAR explícito em sábado/domingo com horasACompensar > 0 é respeitado", () => {
  const f = fc(cal1(COMP8("2026-08-29"))); // 2026-08-29 é sábado
  assert.equal(f.openEventCount, 1, "entrada explícita do calendário vale no fim de semana (bug 2 da 4D)");
  assert.equal(f.uncoveredMinutes, 480, "obrigação = horasACompensar da entrada (nada inferido)");
  assert.equal(f.events[0]?.status, "future");
});

check("TESTE 07 DE 12 — Sábado/domingo comum permanece neutro", () => {
  const f = fc(cal1({
    date: "2026-08-30", descricao: "Abono", categoria: "Abono",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }));
  assert.equal(f.openEventCount, 0, "domingo sem COMPENSAR em aberto: neutro");
  assert.equal(f.uncoveredMinutes, 0);
  // E sem NENHUMA entrada também (fim de semana comum de verdade):
  const vazio = fc(undefined);
  assert.equal(vazio.openEventCount, 0);
  assert.equal(vazio.uncoveredMinutes, 0);
});

check("TESTE 08 DE 12 — Feriado/abono com 0h a compensar permanece neutro", () => {
  const f = fc(cal1({
    date: "2026-09-07", descricao: "Feriado Nacional", categoria: "Feriado Nacional",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }));
  assert.equal(f.openEventCount, 0);
  assert.equal(f.obligationMinutes, 0);
  assert.equal(f.uncoveredMinutes, 0);
  // COMPENSAR com horasACompensar <= 0 também é neutro:
  const f2 = fc(cal1({
    date: "2026-09-08", descricao: "Entrada zerada", categoria: "Compensação 4 Horas",
    tratamento: "COMPENSAR", horasACompensar: 0, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
  }));
  assert.equal(f2.openEventCount, 0, "COMPENSAR com 0h não gera obrigação");
});

check("TESTE 09 DE 12 — Previsão do ciclo = saldo projetado − total uncovered (futuro + hoje + passado aberto)", () => {
  const cals = cal1(COMP8("2026-08-20"));
  // Três obrigações: passada em aberto (20/08), hoje (28/08) e futura (10/09):
  cals[0].entries.push(
    { id: 2, ...COMP8(HOJE) },
    { id: 3, ...COMP8("2026-09-10") },
  );
  const f = fc(cals);
  assert.equal(f.openEventCount, 3);
  assert.equal(f.uncoveredMinutes, 1440, "8h + 8h + 8h em aberto");
  const sit = buildCycleSituation({
    today: HOJE, entries: st().entries, absences: st().absences,
    calendars: cals, settings, faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: [USE_20],
  });
  const previsao = sit.projectedBalanceMinutes - f.uncoveredMinutes;
  assert.equal(previsao, sit.projectedBalanceMinutes - 1440, "previsão usa o TOTAL (futuro+hoje+passado aberto)");
  // A página aplica a MESMA matemática e rotula PREVISÃO:
  assert.ok(page.includes("forecastBalanceMinutes = cycleSituation.projectedBalanceMinutes - forecast.uncoveredMinutes"), "previsão = projetado − obrigações em aberto (na página)");
  const frente = page.slice(page.indexOf("F. O QUE VEM PELA FRENTE"), page.indexOf('title="Dias recentes"'));
  assert.ok(frente.includes('label="Previsão do ciclo"'), "card rotulado PREVISÃO");
  assert.ok(!/saldo (factual|atual|realizado)/i.test(frente.slice(frente.indexOf("Previsão do ciclo"))), "nunca rotulada como saldo factual/atual/realizado");
});

check("TESTE 10 DE 12 — Isolamento absoluto do ciclo em 30/04", () => {
  const mk = (date: string, cs: string, ce: string): CompanyCalendars => [{
    id: `cal-${cs}`, cycleStart: cs, cycleEnd: ce, cycleLabel: cs.slice(0, 4),
    version: 1, importedAt: cs,
    entries: [{ id: 1, ...COMP8(date) }],
  }];
  const cals = [...mk("2026-04-30", "2025-05-01", "2026-04-30"), ...mk("2026-05-01", "2026-05-01", "2027-04-30")];
  const fev = buildCalendarForecast({ calendars: cals, compensations: [], cycle: "2025/2026", today: "2026-01-10" });
  assert.equal(fev.openEventCount, 1, "só 30/04 no ciclo 2025/2026");
  assert.equal(fev.events[0]?.date, "2026-04-30", "30/04 é limite absoluto incluso");
  const f27 = buildCalendarForecast({ calendars: cals, compensations: [], cycle: "2026/2027", today: "2026-01-10" });
  assert.equal(f27.openEventCount, 1, "o ciclo seguinte só enxerga 01/05");
  assert.equal(f27.events[0]?.date, "2026-05-01");
});

check("TESTE 11 DE 12 — Ordem da Visão Geral: saudação → atenção → Registro de hoje → ciclo → período → calendário/previsão → dias recentes", () => {
  const idx = (a: string) => {
    const i = page.indexOf(a);
    assert.ok(i > 0, `âncora presente: ${a}`);
    return i;
  };
  const saudacao = idx("Olá, {user.name}");
  const atencao = idx("B. ATENÇÃO AGORA");
  const registro = idx("C. REGISTRO DE HOJE");
  const ciclo = idx("D. SITUAÇÃO DO CICLO");
  const periodo = idx("E. PERÍODO ATUAL");
  const frente = idx("F. O QUE VEM PELA FRENTE");
  const recentes = idx('title="Dias recentes"');
  assert.ok(saudacao < atencao && atencao < registro, "saudação → atenção → Registro de hoje");
  assert.ok(registro < ciclo && ciclo < periodo, "Registro de hoje → Situação do ciclo → Período atual");
  assert.ok(periodo < frente && frente < recentes, "Período atual → O que vem pela frente → Dias recentes");
  // Parte B: indicador renomeado (obrigação não é só "futura" anymore):
  assert.ok(page.includes('label="Obrigações de calendário a compensar"'), "nomenclatura precisa do total");
  assert.ok(!page.includes("Impacto futuro do calendário"), "rótulo antigo removido");
  assert.ok(page.includes("Inclui obrigações futuras e ainda não concluídas"), "subtexto do total");
  assert.ok(!/déficit factual|saldo negativo atual|dívida factual/i.test(page), "sem vocabulário proibido");
  // Parte F: Atenção agora informa obrigação de hoje/passada aberta:
  assert.ok(page.includes("de calendário ainda a compensar"), "aviso de hoje");
  assert.ok(page.includes("de obrigação de calendário pendente"), "aviso de passada em aberto");
  assert.ok(page.includes("calendarTodayUncoveredMinutes > 0 || calendarOverdueUncoveredMinutes > 0"), "condicional (só quando existe)");
});

check("TESTE 12 DE 12 — Mobile de Dias recentes preservado + desktop em grid consistente + Central de Horas sem diff", () => {
  // MOBILE (aprovado na 4D): linha 1 = dia/data + horas; linha 2 = saldo + status:
  const recentes = page.slice(page.indexOf('title="Dias recentes"'));
  assert.ok(recentes.includes("sm:hidden"), "layout mobile próprio preservado");
  assert.ok(recentes.includes("Saldo{\" \"}"), "linha 2 com saldo preservada");
  assert.ok(recentes.includes("ExcessTenBadge"), "chip [10+] preservado");
  // DESKTOP: MESMAS colunas em todas as linhas (grid fixo):
  assert.ok(recentes.includes("sm:grid-cols-[7.5rem_9rem_1fr_9rem]"), "grid desktop consistente");
  assert.equal((recentes.match(/sm:grid-cols-\[7\.5rem_9rem_1fr_9rem\]/g) ?? []).length, 1, "uma única definição de colunas");
  assert.ok(recentes.includes("recentDayStatusOf"), "classificação 3H intacta");
  // Parte H: cards do dashboard compactos (ciclo 3 + período 2 + frente 2)
  // — recorte exato das três seções (o compact pré-existente do Registro de
  // hoje fica fora do recorte):
  const dash = page.slice(page.indexOf("D. SITUAÇÃO DO CICLO"), page.indexOf('title="Dias recentes"'));
  assert.equal((dash.match(/\n\s+compact\n/g) ?? []).length, 7, "7 StatCards compactos nas seções do dashboard");
  // Central de Horas sem diff (Parte L) e sem persistência nova (Parte M):
  const status = execSync("git status --porcelain", { cwd: root }).toString().split("\n");
  const tocados = status.filter((l) => l.trim().length > 0).map((l) => l.slice(3).trim());
  assert.ok(!tocados.some((f) => f.includes("compensacoes") || f.includes("central")), "Central de Horas sem diff");
  assert.ok(!tocados.some((f) => f.includes("src/lib/store.ts") || f.includes("backup.ts")), "store/backup intocados (100% derivado)");
  assert.ok(!tocados.some((f) => f.startsWith("src/lib/special-excess")), "libs de [10+] intocadas");
});

console.log(`\n${passed}/12 verificações da Etapa 4D.1 passaram.`);
if (passed !== 12) process.exit(1);
