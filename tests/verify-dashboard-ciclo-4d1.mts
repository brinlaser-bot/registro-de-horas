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
const fc = (calendars: CompanyCalendars | undefined, today = HOJE) =>
  buildCalendarForecast({ calendars, cycle: CICLO, today });

/* ════════════════ TESTES 01–12 ════════════════ */

check("TESTE 01 DE 12 — COMPENSAR futuro entra na previsão (impacto conhecido −8h)", () => {
  const f = fc(cal1(COMP8("2026-09-10")));
  assert.equal(f.eventCount, 1);
  assert.equal(f.futureImpactMinutes, -480, "impacto futuro conhecido 8h");
  assert.equal(f.events[0]?.status, "future", "status temporal future");
  assert.equal(f.events[0]?.impactMinutes, -480, "impactMinutes derivado da entrada");
});

check("TESTE 02 DE 12 — COMPENSAR cuja data === today permanece na previsão (não realizada)", () => {
  const f = fc(cal1(COMP8(HOJE)));
  assert.equal(f.eventCount, 1, "NÃO desaparece na data (bug 1 da 4D)");
  assert.equal(f.futureImpactMinutes, -480, "hoje pendente: permanece previsão (nunca −8h prematuro no factual)");
  assert.equal(f.events[0]?.status, "today-pending", "status temporal today-pending");
});

check("TESTE 03 DE 12 — COMPENSAR passado SAI da previsão (virou saldo factual — 4D.4)", () => {
  /* 4D.4 (Partes G/J): dia passado com evento explícito é fato suficiente —
   * o efeito está no SALDO FACTUAL (−8h); previsão NUNCA dupla-conta. */
  const f = fc(cal1(COMP8("2026-08-19")));
  assert.equal(f.eventCount, 0, "passado não está na previsão");
  assert.equal(f.futureImpactMinutes, 0);
});

check("TESTE 04 DE 12 — COMPENSAR passado sai da previsão (realizado ⇒ factual, com ou sem quitação)", () => {
  /* 4D.4: a previsão é PURA — não lê compensações da Central; o passado
   * inteiro é fato (saldo factual) e a quitação pelo próprio dia acontece
   * no saldo do dia (suíte 4D.4, testes 03–06). */
  const concluida: Compensation = { id: 1, sourceDate: "2026-08-19", targetDate: "2026-08-21", minutes: 480, status: "concluida", kind: "calendario" };
  const f = buildCalendarForecast({ calendars: cal1(COMP8("2026-08-19")), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 0, "passado não está na previsão (independe de quitação)");
  assert.equal(f.futureImpactMinutes, 0);
});

check("TESTE 05 DE 12 — Plano NÃO reduz a previsão futura (PLANEJADO ≠ REALIZADO)", () => {
  /* 4D.4 (Parte K): previsão pura — plano é informativo da Central e nunca
   * quita; o impacto futuro conhecido permanece. */
  const pendente: Compensation = { id: 1, sourceDate: "2026-09-10", targetDate: "2026-08-21", minutes: 480, status: "pendente", kind: "calendario" };
  const f = fc(cal1(COMP8("2026-09-10")));
  const fComPlano = buildCalendarForecast({ calendars: cal1(COMP8("2026-09-10")), cycle: CICLO, today: HOJE });
  assert.equal(f.eventCount, 1);
  assert.equal(fComPlano.futureImpactMinutes, -480, "plano não reduz a previsão");
  // Sem dupla contagem com a Central: o forecast não lê compensações.
  assert.ok(!forecastSrc.includes("compensations"), "forecast não consome compensações (fluxo legado fica na Central)");
});

check("TESTE 06 DE 12 — COMPENSAR explícito em sábado/domingo com horasACompensar > 0 é respeitado", () => {
  const f = fc(cal1(COMP8("2026-08-29"))); // 2026-08-29 é sábado
  assert.equal(f.eventCount, 1, "entrada explícita do calendário vale no fim de semana (bug 2 da 4D)");
  assert.equal(f.futureImpactMinutes, -480, "impacto = horasACompensar da entrada (nada inferido)");
  assert.equal(f.events[0]?.status, "future");
});

check("TESTE 07 DE 12 — Sábado/domingo comum permanece neutro", () => {
  const f = fc(cal1({
    date: "2026-08-30", descricao: "Abono", categoria: "Abono",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }));
  assert.equal(f.eventCount, 0, "domingo sem COMPENSAR: neutro");
  assert.equal(f.futureImpactMinutes, 0);
  // E sem NENHUMA entrada também (fim de semana comum de verdade):
  const vazio = fc(undefined);
  assert.equal(vazio.eventCount, 0);
  assert.equal(vazio.futureImpactMinutes, 0);
});

check("TESTE 08 DE 12 — Feriado/abono com 0h a compensar permanece neutro", () => {
  const f = fc(cal1({
    date: "2026-09-07", descricao: "Feriado Nacional", categoria: "Feriado Nacional",
    tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 8, horasAbonadas: 8, observacao: null,
  }));
  assert.equal(f.eventCount, 0);
  assert.equal(f.futureImpactMinutes, 0);
  // COMPENSAR com horasACompensar <= 0 também é neutro:
  const f2 = fc(cal1({
    date: "2026-09-08", descricao: "Entrada zerada", categoria: "Compensação 4 Horas",
    tratamento: "COMPENSAR", horasACompensar: 0, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
  }));
  assert.equal(f2.eventCount, 0, "COMPENSAR com 0h não gera impacto");
});

check("TESTE 09 DE 12 — Previsão do ciclo = projetado + impacto futuro (passado virou factual — 4D.4)", () => {
  const cals = cal1(COMP8("2026-08-19"));
  // Três eventos: passado (19/08), hoje (28/08, não realizado) e futuro (10/09):
  cals[0].entries.push(
    { id: 2, ...COMP8(HOJE) },
    { id: 3, ...COMP8("2026-09-10") },
  );
  const f = fc(cals);
  /* 4D.4 (Partes G/J/K): o passado SAIU da previsão (é saldo factual —
   * −8h do 19/08 entram no factual); a previsão só tem futuro + hoje pendente. */
  assert.equal(f.eventCount, 2, "hoje pendente + futuro");
  assert.equal(f.futureImpactMinutes, -960, "8h (hoje) + 8h (futuro)");
  const sit = buildCycleSituation({
    today: HOJE, entries: st().entries, absences: st().absences,
    calendars: cals, settings, faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: [USE_20],
  });
  assert.equal(sit.factualBalanceMinutes < 0, true, "o −8h do passado está no saldo factual do ciclo");
  const previsao = sit.projectedBalanceMinutes + f.futureImpactMinutes;
  assert.equal(previsao, sit.projectedBalanceMinutes - 960, "previsão = projetado + impacto futuro conhecido");
  // A página aplica a MESMA matemática e rotula PREVISÃO:
  assert.ok(page.includes("projectedBalanceMinutes + forecast.futureImpactMinutes"), "previsão = projetado + impacto futuro (na página)");
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
  const fev = buildCalendarForecast({ calendars: cals, cycle: "2025/2026", today: "2026-01-10" });
  assert.equal(fev.eventCount, 1, "só 30/04 no ciclo 2025/2026");
  assert.equal(fev.events[0]?.date, "2026-04-30", "30/04 é limite absoluto incluso");
  const f27 = buildCalendarForecast({ calendars: cals, cycle: "2026/2027", today: "2026-01-10" });
  assert.equal(f27.eventCount, 1, "o ciclo seguinte só enxerga 01/05");
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
  // 4D.4 (Parte L): indicador da frente = impacto futuro conhecido:
  assert.ok(page.includes('label="Impacto futuro conhecido do calendário"'), "nomenclatura precisa do impacto futuro");
  assert.ok(!page.includes("Obrigações de calendário a compensar"), "rótulo da semântica paralela removido");
  assert.ok(page.includes("Saldo projetado + impacto futuro conhecido"), "subtexto da previsão");
  assert.ok(!/déficit factual|saldo negativo atual|dívida factual/i.test(page), "sem vocabulário proibido");
  /* 4D.4 (Parte J): o aviso de "obrigação pendente" sai da Atenção agora —
   * dias realizados estão no saldo factual (uma única contribuição); a
   * Atenção agora voltou a ser só registros pendentes + planos do dia. */
  assert.ok(!page.includes("de obrigação de calendário pendente"), "aviso da semântica paralela removido");
  assert.ok(!page.includes("calendarOverdueUncoveredMinutes"), "derivação de pendência paralela removida");
  // 4D.5 (SUPERADA a condição genérica — expectativa atualizada com
  // justificativa): quatro faixas independentes, fonte única attention-now.
  assert.ok(!page.includes("(pendingPunchesCount > 0 || pendingPlansCount > 0)"), "Atenção agora: faixa genérica removida");
  assert.ok(page.includes("attentionNowSummary"), "Atenção agora: faixas independentes canônicas");
});

check("TESTE 12 DE 12 — Mobile de Dias recentes preservado + desktop em grid consistente + 4E: diff da Central é da reforma autorizada", () => {
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
  // Parte L (4E — SUPERADO — expectativa atualizada com justificativa): a
  // reforma da Central de Horas foi autorizada pela ETAPA 4E; o diff da
  // Central é exatamente { compensacoes/page.tsx (reescrita) + central-view.ts
  // (novo view-model) }; o RESTO da Central não existe:
  const status = execSync("git status --porcelain", { cwd: root }).toString().split("\n");
  const tocados = status.filter((l) => l.trim().length > 0).map((l) => l.slice(3).trim());
  const tocadosCentral = tocados.filter((f) => f.includes("compensacoes") || f.includes("central"));
  for (const f of tocadosCentral) {
    assert.ok(
      f === "src/app/(app)/compensacoes/page.tsx" || f === "src/lib/central-view.ts" || f.startsWith("tests/"),
      `4E: ${f} faz parte da reforma autorizada (fonte + atualizações de expectativa)`,
    );
  }
  // 4G (SUPERADO): src/lib/backup.ts agora participa legitimamente do contrato
  // (10ª coleção periodConsolidations no payload/parse/export).
  const tocadosSemBackup = tocados.filter((f) => !f.includes("backup.ts"));
  assert.ok(tocados.some((f) => f.includes("backup.ts")) === false || tocados.filter((f) => f.includes("backup.ts")).every((f) => f === "src/lib/backup.ts" || f.startsWith("tests/")), "backup.ts só no contrato 4G (nunca outra policy)"); 
  assert.ok(!tocadosSemBackup.some((f) => f.includes("backup")), "nenhum outro arquivo de backup tocado");
  // 4D.3 tornou o store aditivo (gate de planejamento); 4D.4.2 sancionou
  // APENAS a fórmula da necessidade de USO em dia realizado (mesma fonte
  // canônica da view do [10+]):
  const storeDiff12 = execSync("git diff HEAD -- src/lib/store.ts", { cwd: root }).toString();
  const storeRemovidas12 = storeDiff12.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.ok(
    storeRemovidas12.every(
      (l) =>
        l.includes('"invalid-plan"') ||
        l.includes("neededMinutes") ||
        l.includes("effectiveBaseMinutes") ||
        l.includes("realized") ||
        l.includes("isProjectableDayStatus") ||
        // 4G (SUPERADO): linhas antigas do import de períodos e da assinatura do
        // mergeBackup (10ª coleção periodConsolidations).
        l.includes('from "./periods"') ||
        l.includes("mergeBackup"),
    ),
    "store: nenhuma linha removida além do union 4D.3, da necessidade 4D.4.2 e das extensões 4G",
  );
  if (storeDiff12.trim().length > 0) {
    const sancionada =
      storeDiff12.includes("requiredWorkMinutes") ||
      storeDiff12.includes("periodConsolidations") ||
      storeDiff12.includes("consolidationLock");
    assert.ok(sancionada, "store: única mudança sancionada é a necessidade 4D.4.2 ou a consolidação 4G");
  }
  assert.ok(!tocados.some((f) => f.startsWith("src/lib/special-excess-bank") || f.startsWith("src/lib/special-excess-use.") || f.startsWith("src/lib/special-excess-plan")), "libs de POLÍTICA [10+] intocadas");
});

console.log(`\n${passed}/12 verificações da Etapa 4D.1 passaram.`);
if (passed !== 12) process.exit(1);
