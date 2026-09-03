/**
 * VERIFICAÇÃO — ETAPA 4F: REFORMA DO RESUMO DO PERÍODO
 * (APURAÇÃO DO PERÍODO 21→20 + LEITURA FACTUAL/PROJETADA).
 *
 * O Resumo responde: como ficou meu período, saldo factual, projeção
 * considerando [10+] já utilizado, o que gerou positivo/negativo, quanto
 * [10+] nasceu/foi usado no período, pendências e calendário do período.
 * Leitura/apuração — nunca uma Central operacional.
 *
 * Fixture (Backup B determinístico, hoje = 2026-09-02,
 * período 21/08/2026 → 20/09/2026, controlStartDate 2026-05-01):
 *   18/08 07:00–19:40  ⇒ +2h regular · [10+] +1h40 (motivo) — FORA do período
 *   21/08 05:00–09:00 + 10:00–14:10 ⇒ +10min
 *   24/08 08:00–12:00 + 13:00 (aberto) ⇒ registro INCOMPLETO (congelado)
 *   25/08 COMPENSAR integral + 08:00–17:00 ⇒ 8h trabalhadas, saldo 0
 *   26/08 05:00–09:00 + 10:00–12:20 ⇒ −1h40
 *   27/08 sem registro ⇒ pendência "sem registro" (nada inventado)
 *   28/08 08:00–19:30 ⇒ 10h30 ⇒ +2h regular · [10+] +30min (motivo)
 *   31/08 05:00–09:00 + 10:00–13:30 ⇒ 7h30 ⇒ −30min (destino de uso)
 *   01/09 05:00–09:00 + 10:00–13:30 ⇒ 7h30 ⇒ −30min (destino de uso)
 *   02/09 hoje em andamento (não é pendência) · 07/09 ABONADO (neutro)
 *   Usos: 31/08 30min (fifo, asOf 01/09) · 01/09 30min (fifo, asOf 02/09)
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-resumo-4f.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildResumoPeriodView, resumoPeriodPendencies, resumoSpecialPeriodMovement, resumoCalendarPeriodRows } from "../src/lib/resumo-period-view.ts";
import { resumoFinancialFrozen } from "../src/lib/resumo-days.ts";
import { getPointPeriod, periodLabel } from "../src/lib/periods.ts";
import type { TimeEntry, Falta } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = () => src("src/app/(app)/resumo/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixture Backup B ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const HOJE = "2026-09-02";
const resetB = () => {
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: "2026-05-01" },
    entries: [
      punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:40", "saida"),
      punch("2026-08-21", "05:00", "entrada"), punch("2026-08-21", "09:00", "saida"), punch("2026-08-21", "10:00", "entrada"), punch("2026-08-21", "14:10", "saida"),
      punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "12:00", "saida"), punch("2026-08-24", "13:00", "entrada"),
      punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"), punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"),
      punch("2026-08-26", "05:00", "entrada"), punch("2026-08-26", "09:00", "saida"), punch("2026-08-26", "10:00", "entrada"), punch("2026-08-26", "12:20", "saida"),
      punch("2026-08-28", "08:00", "entrada"), punch("2026-08-28", "19:30", "saida"),
      punch("2026-08-31", "05:00", "entrada"), punch("2026-08-31", "09:00", "saida"), punch("2026-08-31", "10:00", "entrada"), punch("2026-08-31", "13:30", "saida"),
      punch("2026-09-01", "05:00", "entrada"), punch("2026-09-01", "09:00", "saida"), punch("2026-09-01", "10:00", "entrada"), punch("2026-09-01", "13:30", "saida"),
    ],
    compensations: [], absences: [], faltas: [] as Falta[],
    companyCalendars: [{
      id: 1, cycleStart: "2026-05-01", cycleEnd: "2027-04-30", cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
      entries: [
        { id: 1, date: "2026-08-25", descricao: "Compensado", categoria: "Compensação 8 Horas", tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null },
        { id: 2, date: "2026-09-07", descricao: "Independência do Brasil", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null },
      ],
    }],
    excessReasons: [{ id: 1, date: "2026-08-18", reason: "demanda-urgente" }, { id: 2, date: "2026-08-28", reason: "demanda-urgente" }],
    specialExcessUses: [], specialExcessPlans: [],
  });
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok, "uso 31/08");
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-09-01", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-02" }).ok, "uso 01/09");
};
const st = () => getAppData();
const S = () => settingsOf(st().user);
const PERIOD = getPointPeriod(HOJE);
const view = () =>
  buildResumoPeriodView({
    period: PERIOD, today: HOJE, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
const pend = () =>
  resumoPeriodPendencies({
    today: HOJE, period: PERIOD, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01", plans: st().specialExcessPlans ?? [],
  });
const movement = () =>
  resumoSpecialPeriodMovement({
    period: PERIOD, today: HOJE, cycle: "2026/2027", entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });

/* ════════ ESCOPO E CABEÇALHO ════════ */

check("TESTE 01 DE 18 — Resumo usa o período do ponto 21→20 (navegação preservada)", () => {
  assert.deepEqual({ from: PERIOD.from, to: PERIOD.to }, { from: "2026-08-21", to: "2026-09-20" });
  assert.equal(periodLabel(PERIOD), "21/08/2026 → 20/09/2026");
  const p = page();
  assert.ok(p.includes("<h1"), "título na página");
  assert.ok(p.includes("Resumo do período"), "título");
  assert.ok(p.includes("Veja como o período se formou, o saldo factual e a projeção considerando o uso do [10+]."), "subtítulo");
  // 4G (SUPERADO): rótulo completo preservado via PeriodNavigator.fullLabel;
  // status temporal derivou para periodConsolidationState (5 estados, sem manual).
  assert.ok(p.includes("Período do ponto: ${periodLabel(period)}"), "período exibido (fullLabel do navegador)");
  assert.ok(p.includes("getPreviousPointPeriod(period)") && p.includes("getNextPointPeriod(period)"), "navegação anterior/próximo preservada");
  assert.ok(p.includes("periodConsolidationState("), "status temporal derivado (máquina 4G)");
  assert.ok(!p.includes("setPeriodoFechado") && !p.includes("fecharPeríodo"), "status nunca é fechamento manual");
});

/* ════════ BLOCO 1 — VISÃO DO PERÍODO ════════ */

check("TESTE 02 DE 18 — Backup B: saldo factual do período = −30min (sem [10+])", () => {
  resetB();
  assert.equal(view().cards.regularBalanceMinutes, -30);
  const p = page();
  assert.ok(p.includes('label="Saldo factual"'), "card Saldo factual");
  assert.ok(p.includes("cards.regularBalanceMinutes"), "fonte canônica na página");
});

check("TESTE 03 DE 18 — Backup B: projeção no ponto = +30min (helper canônico confirma)", () => {
  resetB();
  const v = view();
  assert.equal(v.cards.projection.projectedBalanceMinutes, 30, "−30min factual + 1h de [10+] utilizado");
  assert.equal(v.cards.projection.appliedSpecialMinutes, 60);
  const p = page();
  assert.ok(p.includes('label="Projeção no ponto"'));
  assert.ok(p.includes("considera [10+] já utilizado"), "texto do card");
  assert.ok(p.includes("sem ajustes [10+] aplicados"), "texto quando projeção = factual");
});

check("TESTE 04 DE 18 — Backup B: dias com registro = 7 (definição canônica)", () => {
  resetB();
  assert.equal(view().totals.trackedDays, 7);
  assert.ok(page().includes('label="Dias com registro"'));
});

check("TESTE 05 DE 18 — Backup B: pendências 0 inconsistente / 1 incompleto / 1 sem registro", () => {
  resetB();
  const p = pend();
  assert.deepEqual(p.inconsistente, []);
  assert.deepEqual(p.incompleto, ["2026-08-24"]);
  assert.deepEqual(p.semRegistro, ["2026-08-27"]);
  assert.deepEqual(p.plano10, [], "com Backup B: plano 01/09 concluído ⇒ 0 aguardando");
});

check("TESTE 06 DE 18 — Pendências de apuração totais = 2 (card + BLOCO 5)", () => {
  resetB();
  assert.equal(pend().total, 2);
  const p = page();
  assert.ok(p.includes('label="Pendências de apuração"'), "card do BLOCO 1");
  assert.ok(p.includes("Nenhuma pendência de apuração neste período."), "estado vazio exato");
  assert.ok(p.includes("Pendências do período"), "BLOCO 5 (só quando houver)");
  assert.ok(p.includes("{pend.total > 0 && ("), "gate do BLOCO 5");
});

check("TESTE 07 DE 18 — Dia incompleto não inventa efeito financeiro", () => {
  resetB();
  const r24 = view().days.find((d) => d.day.date === "2026-08-24")!;
  assert.equal(r24.day.status, "incomplete");
  assert.equal(r24.day.balanceContribution, 0, "contribuição 0 (congelado)");
  assert.equal(resumoFinancialFrozen(r24.day), true, "financeiro congelado (—)");
  const comp = view().composition;
  assert.equal(comp.generatedCreditMinutes + comp.generatedDeficitMinutes > 0, true);
  assert.ok(page().includes("Dias pendentes não entram no saldo até que possam ser apurados corretamente."), "nota da apuração");
});

check("TESTE 08 DE 18 — Dia sem registro não inventa −8h regular", () => {
  resetB();
  const r27 = view().days.find((d) => d.day.date === "2026-08-27")!;
  assert.equal(r27.day.missingExpected, true);
  assert.equal(r27.day.entryCount, 0);
  assert.equal(r27.day.balanceContribution, 0, "nenhum déficit inventado");
  assert.equal(resumoFinancialFrozen(r27.day), true);
});

/* ════════ BLOCO 3 — [10+] NESTE PERÍODO ════════ */

check("TESTE 09 DE 18 — [10+] gerado no período = 30min (origem 28/08)", () => {
  resetB();
  assert.equal(movement().generatedMinutes, 30);
  const p = page();
  assert.ok(p.includes("Gerado no período"), "bloco de movimentação");
  assert.ok(p.includes("[10+] neste período"), "título do bloco");
  assert.ok(p.includes("Nenhuma movimentação [10+] neste período."), "estado vazio exato");
});

check("TESTE 10 DE 18 — [10+] utilizado no período = 1h (destinos 31/08 + 01/09)", () => {
  resetB();
  assert.equal(movement().usedMinutes, 60);
  assert.equal(movement().usesWithDestination, 2);
  assert.ok(page().includes("Utilizado no período"));
});

check("TESTE 11 DE 18 — Origem 18/08 usada em 01/09: utilização do período, não geração", () => {
  resetB();
  const m = movement();
  const uso0109 = st().specialExcessUses?.find((u) => u.destinationDate === "2026-09-01")!;
  assert.deepEqual(uso0109.allocations.map((a) => a.originDate), ["2026-08-18"], "origem fora do período");
  assert.equal(m.usedMinutes, 60, "os 30min de 01/09 CONTAM como utilizado no período");
  assert.equal(m.generatedMinutes, 30, "…mas NÃO contam como gerado no período (18/08 fora)");
  assert.equal(m.usesOriginOutsidePeriod, true, "nota informativa de origem fora");
  assert.ok(page().includes("Parte do utilizado tem origem em outro período do mesmo ciclo"), "texto informativo");
  assert.ok(page().includes('href="/compensacoes"'), "CTA Ver detalhes na Central de Horas");
  assert.ok(page().includes("Ver detalhes na Central de Horas"));
});

check("TESTE 12 DE 18 — Reservado para o período = 0 (reserva com destino fora não conta)", () => {
  resetB();
  assert.equal(movement().reservedMinutes, 0);
  // Reforço: reserva com destino FORA do período não entra no recorte do período…
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-24", minutes: 30, selectionMode: "automatic", asOfDate: HOJE }).ok);
  const m = movement();
  assert.equal(m.reservedMinutes, 0, "destino 24/09 está fora de 21/08→20/09");
  // …mas é reservado no CICLO (a Central mostra):
  assert.equal(st().specialExcessPlans?.[0].destinationDate, "2026-09-24");
  const p = page();
  assert.ok(p.includes("Reservado para o período"), "campo do bloco");
  assert.ok(p.includes("reservas em aberto com destino no período"), "subtexto");
});

/* ════════ BLOCO 4 — CALENDÁRIO NO PERÍODO ════════ */

check("TESTE 13 DE 18 — 25/08 COMPENSAR integral: 8h trabalhadas, saldo factual 0, sem obrigação duplicada", () => {
  resetB();
  const cal = resumoCalendarPeriodRows({
    today: HOJE, cycle: "2026/2027", period: PERIOD, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: "2026-05-01",
  });
  const e25 = cal.realized.find((e) => e.date === "2026-08-25")!;
  assert.equal(e25.trabalhadoMinutes, 480, "trabalhado 8h");
  assert.equal(e25.saldoFactualMinutes, 0, "saldo factual do dia 0");
  assert.equal(e25.baseReferenciaMinutes, 480, "base 8h");
  assert.equal(e25.creditoCalendarioMinutes, 0, "crédito 0");
  assert.equal(e25.jornadaACumprirMinutes, 480, "jornada a cumprir 8h");
  assert.equal(e25.impactoFuturoConhecidoMinutes, null, "não reaparece como impacto futuro");
  assert.equal(view().days.find((d) => d.day.date === "2026-08-25")!.day.balanceContribution, 0, "sem obrigação adicional no factual");
  assert.ok(page().includes("Efeito já refletido no saldo factual."), "texto do realizado");
});

check("TESTE 14 DE 18 — 07/09 ABONADO: neutro (base 8h · crédito 8h · jornada 0 · impacto 0)", () => {
  resetB();
  const cal = resumoCalendarPeriodRows({
    today: HOJE, cycle: "2026/2027", period: PERIOD, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: "2026-05-01",
  });
  const e07 = cal.future.find((e) => e.date === "2026-09-07")!;
  assert.equal(e07.tratamento, "ABONADO");
  assert.equal(e07.baseReferenciaMinutes, 480);
  assert.equal(e07.creditoCalendarioMinutes, 480);
  assert.equal(e07.jornadaACumprirMinutes, 0);
  assert.equal(e07.impactoFuturoConhecidoMinutes, null, "neutro");
  const p = page();
  assert.ok(p.includes("Dia abonado — neutro (sem impacto)."), "texto neutro");
  assert.ok(p.includes("Calendário da empresa no período"), "título do bloco");
  assert.ok(p.includes("Não há calendário da empresa disponível para este ciclo."), "estado vazio exato");
});

/* ════════ BLOCO 6 — DETALHAMENTO + NAVEGAÇÃO ════════ */

check("TESTE 15 DE 18 — Detalhamento do período em ordem cronológica crescente (21→20)", () => {
  resetB();
  const dates = view().days.map((d) => d.day.date);
  assert.equal(dates[0], "2026-08-21");
  assert.deepEqual(dates, [...dates].sort((a, b) => a.localeCompare(b)), "crescente");
  assert.ok(dates.includes("2026-08-27") && dates.includes("2026-08-25"), "dias relevantes presentes");
  const p = page();
  assert.ok(p.includes("Detalhamento do período"), "área recolhível");
  assert.ok(p.includes("const [detailsOpen, setDetailsOpen] = useState(false)"), "recolhido por padrão");
});

check("TESTE 16 DE 18 — CTA “Ver dia” usa data= e o foco global da 4E.1", () => {
  const p = page();
  assert.ok(p.includes('href={`/registros?escopo=ciclo&data=${d.date}`}'), "CTA do detalhamento");
  assert.ok(p.includes("Ver dia"), "rótulo");
  // o mecanismo de foco da 4E.1 continua no destino:
  const reg = src("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("document.getElementById(`dia-card-${focusDate}`)"), "scroll de foco intacto");
  assert.ok(reg.includes("key={focusDate === date ? `${date}-atencao` : date}"), "remount 4D.5.2 intacto");
  // pendências também usam data= quando há exatamente 1 item:
  assert.ok(p.includes("c.dates.length === 1 ? `${c.hrefBase}&data=${c.dates[0]}` : c.hrefBase"), "CTA único item com data=");
});

/* ════════ RESPONSIVIDADE ════════ */

check("TESTE 17 DE 18 — Mobile: cards principais 2×2, sem overflow horizontal", () => {
  const p = page();
  assert.ok(p.includes("grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4"), "2×2 no mobile · 4 em linha no desktop");
  const bloco = p.slice(p.indexOf("grid grid-cols-2"), p.indexOf("Como o período se formou"));
  assert.ok(bloco.includes('label="Saldo factual"'), "linha 1, coluna 1: Saldo factual");
  assert.ok(bloco.includes('label="Projeção no ponto"'), "linha 1, coluna 2: Projeção no ponto");
  assert.ok(bloco.includes('label="Dias com registro"'), "linha 2, coluna 1: Dias com registro");
  assert.ok(bloco.includes('label="Pendências de apuração"'), "linha 2, coluna 2: Pendências");
  assert.ok(!p.includes("<table"), "sem tabela horizontal no mobile");
  assert.ok(!p.includes("overflow-x-auto") && !p.includes("min-w-["), "sem scroll horizontal");
  assert.ok(p.includes("flex flex-wrap items-center justify-between"), "linhas do detalhamento quebram em 320px");
});

/* ════════ PUREZA + INTEGRIDADE ════════ */

check("TESTE 18 DE 18 — Zero persistência nova; números do ciclo; sentinelas íntegros", () => {
  resetB();
  // Ciclo (Backup B): gerado 2h10 · usado 1h · reservado 0 · disponível 1h10
  const m = movement();
  assert.equal(m.generatedMinutes + 100, 130, "gerado do ciclo 2h10 (100 de 18/08 + 30 de 28/08)");
  assert.equal(m.usedMinutes, 60, "usado 1h");
  assert.equal(m.reservedMinutes, 0, "reservado 0");
  // A página não muta nada no RENDER (leitura/apuração). 4G (SUPERADO): as
  // únicas actions são consolidatePeriod/reopenPeriod, disparadas EXPLICITAMENTE
  // pelos botões de confirmação — nunca em efeito/render automático.
  const p = page();
  const usosActions = p.split("actions.").length - 1;
  assert.equal(usosActions, 2, "actions apenas em consolidar/reabrir (confirmação explícita)");
  assert.ok(p.includes("actions.consolidatePeriod(") && p.includes("actions.reopenPeriod("), "consolidação/reabertura explícitas");
  assert.ok(!p.includes("localStorage") && !p.includes("useSearchParams"), "sem persistência/URL-state novo");
  const antes = JSON.stringify(st());
  view(); pend(); movement();
  assert.equal(JSON.stringify(st()), JSON.parse(JSON.stringify(antes)) && antes, "helpers 100% puros");
  // Sentinelas das etapas anteriores continuam verdes:
  for (const t of ["verify-backup-contract-vg-ux-4c1b", "verify-fechamento-atencao-4d52", "verify-central-4e", "verify-central-4e1"]) {
    execSync(`TZ=America/Sao_Paulo ./node_modules/.bin/tsx tests/${t}.mts`, { cwd: root, stdio: "pipe" });
  }
});

console.log(`\n${passed}/18 verificações da Etapa 4F passaram.`);
if (passed !== 18) process.exit(1);
