/**
 * VERIFICAÇÃO — ETAPA 4I.2: ESTABILIZAÇÃO FINAL DO “GUIA DO PONTO” (v1.0).
 *
 * Escopo FECHADO (somente apresentação / view model do Guia — NENHUM motor
 * financeiro, de consolidação, store ou schema tocado):
 *   A) card “Requer orientação manual” ([10+] utilizado + nenhuma batida
 *      real): o motivo é dito UMA vez — sem banner “Precisa de atenção”
 *      duplicado, sugestão compacta, todas as informações preservadas;
 *   B) período 100% anterior ao controlStartDate: estado principal
 *      “Fora do controle” — nunca “Pronto para consolidar”.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-guia-ponto-4i2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildPointGuideView,
  GUIDE_DEFAULT_MAX_EXIT,
  GUIDE_DEFAULT_MIN_ENTRY,
  GUIDE_MANUAL_NO_ANCHOR_MESSAGE,
  GUIDE_PERIOD_OUT_OF_CONTROL_LABEL,
  isPeriodOutOfControl,
} from "../src/lib/point-guide.ts";
import { getPointPeriod } from "../src/lib/periods.ts";
import { PERIOD_CONSOLIDATION_LABEL, periodConsolidationState } from "../src/lib/period-consolidation.ts";
import { addDays, formatMinutes, parseDate } from "../src/lib/time.ts";
import { settingsOf, actions, getAppData } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import type { Falta, TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (p: string) => readFileSync(join(root, p), "utf8");
const pageSrc = () => srcOf("src/app/(app)/guia-ponto/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ═══════════════════════════════════════════════════════════
 * FIXTURES (cenários reais da validação manual da 4I.1).
 * asOfDate canônico: 04/09/2026 (America/Sao_Paulo).
 * ═══════════════════════════════════════════════════════════ */

const HOJE = "2026-09-04";
const LIMITE = { minEntry: GUIDE_DEFAULT_MIN_ENTRY, maxExit: GUIDE_DEFAULT_MAX_EXIT };

let seq = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: seq++,
  date,
  time,
  type,
  note: null,
});
const dia = (date: string, times: string[]): TimeEntry[] =>
  times.map((t, i) => punch(date, t, i % 2 === 0 ? "entrada" : "saida"));

const reset = (
  entries: TimeEntry[],
  opts: { calendarEntries?: any[]; controlStart?: string } = {},
) => {
  seq = 1;
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: opts.controlStart ?? "2026-07-21" },
    entries,
    compensations: [],
    absences: [],
    faltas: [] as Falta[],
    companyCalendars:
      opts.calendarEntries && opts.calendarEntries.length > 0
        ? [{
            id: "2026-05-01",
            cycleStart: "2026-05-01",
            cycleEnd: "2027-04-30",
            cycleLabel: "2026/2027",
            version: 1,
            importedAt: "2026-05-01",
            entries: opts.calendarEntries,
          }]
        : undefined,
    excessReasons: [],
    specialExcessUses: [],
    specialExcessPlans: [],
    periodConsolidations: [],
    annualCycleClosures: [],
  });
};

const calEvento = (
  date: string,
  tratamento: string,
  horasACompensar: number,
  jornada: number,
  abonadas: number,
  descricao = "Evento calendário",
) => ({
  id: 1,
  date,
  descricao,
  categoria: tratamento === "ABONADO" ? "Feriado Nacional" : "Compensação 8 Horas",
  tratamento,
  horasACompensar,
  jornadaEsperadaHoras: jornada,
  horasAbonadas: abonadas,
  observacao: null,
});

const guia = (period: { from: string; to: string }, today: string = HOJE, limits = LIMITE) => {
  const d = getAppData();
  return buildPointGuideView({
    period,
    today,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate,
    uses: d.specialExcessUses ?? [],
    plans: d.specialExcessPlans ?? [],
    consolidations: d.periodConsolidations,
    limits,
  });
};

const rowDo = (v: ReturnType<typeof guia>, date: string) => {
  const row = v.days.find((x) => x.date === date);
  assert.ok(row, `dia ${date} presente no Guia`);
  return row;
};

const PERIODO_25_08 = { from: "2026-08-21", to: "2026-09-20" };
const PERIODO_ABRIL = { from: "2026-04-21", to: "2026-04-30" };

/** CASO REAL A — 25/08/2026 “Folga a compensar” (8h), NENHUMA batida,
 *  [10+] 30min utilizado; origens em 12/08 e 13/08. */
const setupCasoA = () => {
  reset([...dia("2026-08-12", ["07:30", "12:00", "13:00", "19:10"]), ...dia("2026-08-13", ["07:00", "12:00", "13:00", "19:00"])], {
    calendarEntries: [calEvento("2026-08-25", "COMPENSAR", 8, 0, 0, "Folga a compensar")],
    controlStart: "2026-07-21",
  });
  assert.ok(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE }).ok,
    "uso [10+] 30min criado (cenário da validação — motor inalterado)",
  );
  return rowDo(guia(PERIODO_25_08), "2026-08-25");
};

/** Trecho do JSX do card entre o cabeçalho do dia e a grade Batidas × Sugestão. */
const bannerBlock = () => {
  const page = pageSrc();
  const a = page.indexOf("{/* PRECISA DE ATENÇÃO");
  const b = page.indexOf("{/* Batidas reais × Sugestão */}");
  assert.ok(a > 0 && b > a, "estrutura do card preservada (banner antes da grade)");
  return page.slice(a, b);
};

/* ═══════════════════════════════════════════════════════════
 * T01–T12
 * ═══════════════════════════════════════════════════════════ */

check("T01 — [10+] sem batidas continua com badge “Requer orientação manual”", () => {
  const row = setupCasoA();
  assert.equal(row.situacao, "Requer orientação manual", "badge primário preservado");
  assert.equal(row.suggestion.kind, "manual", "kind canônico preservado");
  assert.equal(row.manualNoAnchor, true, "estado específico identificado no view model");
  assert.equal(row.attention, true, "continua contando como Atenção (filtro/contador inalterados)");
  assert.deepEqual(row.realPunches, [], "Nenhuma batida");
  assert.equal(row.jornadaRealMinutes, 0, "Jornada real 0min");
  const page = pageSrc();
  assert.ok(page.includes("{day.situacao}"), "badge do cabeçalho renderiza a situação");
  assert.ok(page.includes('day.attention ? "rose"'), "tom de atenção do badge preservado");
});

check("T02 — Nesse estado NÃO existe a caixa grande duplicada “PRECISA DE ATENÇÃO”", () => {
  const row = setupCasoA();
  assert.equal(row.showsAttentionBanner, false, "banner suprimido SOMENTE neste estado");
  const block = bannerBlock();
  assert.ok(block.includes("{day.showsAttentionBanner && ("), "banner condicionado ao flag do view model");
  assert.ok(!block.includes("{day.attention && ("), "banner não é mais disparado por attention bruto");
  assert.ok(block.includes("Precisa de atenção"), "banner continua existindo para os demais casos");
  // O motivo “Há horas [10+] aplicadas…” não é repetido no JSX do card.
  const page = pageSrc();
  assert.equal((page.match(/Há horas \[10\+\] aplicadas/g) ?? []).length, 0, "texto longo não é duplicado na página");
});

check("T03 — Sugestão contém o texto compacto “Sem batidas reais para ancorar uma sugestão automática”", () => {
  const row = setupCasoA();
  assert.equal(GUIDE_MANUAL_NO_ANCHOR_MESSAGE, "Sem batidas reais para ancorar uma sugestão automática.");
  const page = pageSrc();
  assert.ok(page.includes("day.manualNoAnchor\n                  ? GUIDE_MANUAL_NO_ANCHOR_MESSAGE"), "caixa de sugestão usa o texto compacto neste estado");
  assert.ok(page.includes('day.suggestion.message ?? "Sem orientação automática."'), "demais casos seguem com a mensagem canônica");
  // A mensagem canônica do motor de sugestão permanece intacta (só a apresentação mudou).
  assert.ok(row.suggestion.message!.includes("não existem batidas reais para ancorar"), "suggestion.message canônica preservada (4I T16)");
  assert.deepEqual(row.suggestion.punches, [], "nada inventado");
});

check("T04 — Saldo factual −8h permanece visível", () => {
  const row = setupCasoA();
  assert.equal(row.saldoRegularMinutes, -480);
  assert.equal(formatMinutes(row.saldoRegularMinutes), "-8h");
  const page = pageSrc();
  assert.ok(page.includes("Saldo factual:"), "linha “Saldo factual” no lado das batidas reais");
  assert.ok(
    page.includes('(day.specialUsedMinutes > 0 && day.suggestion.kind === "manual"))'),
    "condição showsSaldoFactual do caso manual preservada",
  );
});

check("T05 — Saldo projetado −7h30 permanece visível", () => {
  const row = setupCasoA();
  assert.equal(row.saldoProjetadoMinutes, -450);
  assert.equal(row.saldoProjetadoMinutes, row.projection.projectedBalanceMinutes, "eco da projeção 3A");
  assert.equal(formatMinutes(row.saldoProjetadoMinutes), "-7h30");
  const page = pageSrc();
  // Bloco compacto do estado manual sem âncora.
  const a = page.indexOf("{day.manualNoAnchor ? (");
  assert.ok(a > 0, "bloco compacto presente");
  const compact = page.slice(a, page.indexOf(") : (", a));
  assert.ok(compact.includes("Saldo projetado: <span className=\"tabular-nums\">{formatMinutes(day.saldoProjetadoMinutes)}</span>"), "saldo projetado no bloco compacto");
  // Demais casos: a linha original de saldo projetado continua existindo.
  assert.ok(page.includes("Saldo projetado: {formatMinutes(day.saldoProjetadoMinutes)}"), "linha original preservada para os outros casos");
});

check("T06 — Total no ponto 30min e ainda a representar 30min permanecem visíveis (2 linhas)", () => {
  const row = setupCasoA();
  assert.equal(row.totalNoPontoMinutes, 30, "projeção canônica");
  assert.equal(row.suggestion.remainingMinutes, 30, "ainda a representar");
  const page = pageSrc();
  const a = page.indexOf("{day.manualNoAnchor ? (");
  const compact = page.slice(a, page.indexOf(") : (", a));
  assert.ok(compact.includes("No ponto: <span className=\"tabular-nums\">{formatMinutes(day.totalNoPontoMinutes)}</span>"), "total no ponto no bloco compacto");
  assert.ok(compact.includes("· Ainda a representar:"), "ainda a representar na MESMA linha (compacto)");
  assert.ok(compact.includes("{formatMinutes(day.suggestion.remainingMinutes)}"), "valor ligado ao view model");
  assert.equal((compact.match(/<p className="break-words">/g) ?? []).length, 2, "exatamente 2 linhas de métricas");
  // Fora do estado compacto, “Total considerado no ponto” continua como antes.
  assert.ok(page.includes("Total considerado no ponto:"), "texto original preservado nos demais cards");
});

check("T07 — [10+] utilizado 30min e contexto COMPENSAR / obrigação 8h permanecem visíveis", () => {
  const row = setupCasoA();
  assert.equal(row.specialUsedMinutes, 30);
  assert.equal(row.specialAppliedMinutes, 30);
  assert.equal(row.calendarEntry?.tratamento, "COMPENSAR");
  assert.equal(row.calendarRequiredWorkMinutes, 480, "obrigação 8h");
  assert.equal(row.calendarEntry?.descricao, "Folga a compensar", "faixa de contexto: Folga a compensar — Calendário");
  const page = pageSrc();
  assert.ok(page.includes("[10+] utilizado: {formatMinutes(day.specialUsedMinutes)}"), "chip [10+] utilizado preservado");
  assert.ok(page.includes("Obrigação: {formatMinutes(day.calendarRequiredWorkMinutes)}"), "faixa de contexto com obrigação preservada");
  assert.ok(page.includes("Abrir em Registros") && page.includes("Ver no Resumo"), "links de leitura preservados");
});

check("T08 — Dia normal passado sem registro CONTINUA com banner de atenção (remoção não é global)", () => {
  setupCasoA();
  const v = guia(PERIODO_25_08);
  const semRegistro = rowDo(v, "2026-08-26"); // quarta útil, dentro do controle, sem batidas
  assert.equal(semRegistro.missingExpected, true);
  assert.equal(semRegistro.attention, true);
  assert.equal(semRegistro.manualNoAnchor, false);
  assert.equal(semRegistro.showsAttentionBanner, true, "banner mantido para pendência real");
  assert.equal(semRegistro.situacao, "Sem registro");
  // Registro incompleto (só entrada) também continua com o banner.
  reset([punch("2026-08-27", "08:00", "entrada")], { controlStart: "2026-07-21" });
  const incompleto = rowDo(guia(PERIODO_25_08), "2026-08-27");
  assert.equal(incompleto.attention, true);
  assert.equal(incompleto.showsAttentionBanner, true, "registro incompleto mantém o banner");
  // Sequência inconsistente (duas entradas) idem.
  reset([punch("2026-08-27", "08:00", "entrada"), punch("2026-08-27", "09:00", "entrada")], { controlStart: "2026-07-21" });
  const inconsistente = rowDo(guia(PERIODO_25_08), "2026-08-27");
  assert.equal(inconsistente.attention, true);
  assert.equal(inconsistente.showsAttentionBanner, true, "sequência inconsistente mantém o banner");
  // Invariante: showsAttentionBanner === attention && !manualNoAnchor em TODO o período.
  for (const d of v.days) assert.equal(d.showsAttentionBanner, d.attention && !d.manualNoAnchor, `invariante em ${d.date}`);
});

check("T09 — Período 21/04→30/04 com controlStartDate 21/07 é identificado como “Fora do controle”", () => {
  reset([], { controlStart: "2026-07-21" });
  const v = guia(PERIODO_ABRIL);
  assert.equal(isPeriodOutOfControl(PERIODO_ABRIL, "2026-07-21"), true, "period.to < controlStartDate");
  assert.equal(v.periodOutOfControl, true);
  assert.equal(v.periodFuture, false, "continua sendo período passado");
  assert.equal(v.stateLabel, GUIDE_PERIOD_OUT_OF_CONTROL_LABEL);
  assert.equal(v.stateLabel, "Fora do controle");
  // Dias vazios anteriores ao controle seguem neutros (4I.1) e fatos históricos seguem visíveis.
  assert.equal(rowDo(v, "2026-04-22").suggestion.kind, "out-of-control");
  reset(dia("2026-04-22", ["08:00", "12:00", "13:00", "17:00"]), { controlStart: "2026-07-21" });
  const hist = rowDo(guia(PERIODO_ABRIL), "2026-04-22");
  assert.deepEqual(hist.realPunches, ["08:00", "12:00", "13:00", "17:00"], "registro histórico real preservado");
  // Limites: período que TERMINA no controlStartDate ou depois NÃO é fora do controle.
  assert.equal(isPeriodOutOfControl({ from: "2026-06-21", to: "2026-07-20" }, "2026-07-21"), true);
  assert.equal(isPeriodOutOfControl({ from: "2026-06-21", to: "2026-07-21" }, "2026-07-21"), false);
  assert.equal(isPeriodOutOfControl({ from: "2026-07-21", to: "2026-08-20" }, "2026-07-21"), false);
  assert.equal(isPeriodOutOfControl(PERIODO_ABRIL, null), false, "sem controlStartDate → nunca fora do controle");
});

check("T10 — T09 NÃO mostra “Pronto para consolidar” (e o motor 4G segue intocado)", () => {
  reset([], { controlStart: "2026-07-21" });
  const v = guia(PERIODO_ABRIL);
  assert.ok(!v.stateLabel.includes("Pronto para consolidar"));
  assert.ok(!v.stateLabel.includes("Em andamento"));
  assert.ok(!v.stateLabel.includes("Consolidado"));
  // Causa: o motor 4G (compartilhado com o Resumo) classifica todo período
  // encerrado sem pendências como pronto-para-consolidar — ele NÃO é alterado.
  assert.equal(v.state, "pronto-para-consolidar", "id canônico do motor 4G inalterado");
  assert.equal(
    periodConsolidationState({ today: HOJE, periodStart: PERIODO_ABRIL.from, periodEnd: PERIODO_ABRIL.to, consolidations: [], blockedCount: 0 }),
    "pronto-para-consolidar",
    "periodConsolidationState intocado",
  );
  assert.equal(PERIOD_CONSOLIDATION_LABEL["pronto-para-consolidar"], "Pronto para consolidar", "rótulos do motor intocados");
  // Apresentação: badge 4G suprimido e badge “Fora do controle” exibido; resumo neutro sem CTA.
  const page = pageSrc();
  assert.ok(page.includes("{!view.periodFuture && !view.periodOutOfControl && ("), "badge 4G suprimido para período fora do controle");
  assert.ok(page.includes('<Badge tone="slate">{GUIDE_PERIOD_OUT_OF_CONTROL_LABEL}</Badge>'), "estado principal inequívoco");
  assert.ok(page.includes("{view.periodOutOfControl ? ("), "resumo superior neutro no lugar dos contadores");
  assert.ok(page.includes("Período fora do controle — anterior ao início do controle."), "texto neutro");
  assert.ok(!page.includes("Consolidar período"), "nenhum CTA de consolidação");
  assert.equal(srcOf("src/lib/period-consolidation.ts").includes("periodOutOfControl"), false, "motor de consolidação não conhece o conceito (só o Guia)");
});

check("T11 — Período atual e período consolidado dentro do controle mantêm seus estados", () => {
  reset([], { controlStart: "2026-07-21" });
  const atual = guia(getPointPeriod(HOJE)); // 21/08→20/09
  assert.equal(atual.periodOutOfControl, false);
  assert.equal(atual.periodFuture, false);
  assert.equal(atual.state, "em-andamento");
  assert.equal(atual.stateLabel, "Em andamento");
  // Período passado consolidado.
  const entries: TimeEntry[] = [];
  let cur = "2026-07-21";
  while (cur <= "2026-08-20") {
    const wd = parseDate(cur).getDay();
    if (wd !== 0 && wd !== 6) entries.push(...dia(cur, ["08:00", "12:00", "13:00", "17:00"]));
    cur = addDays(cur, 1);
  }
  reset(entries, { controlStart: "2026-07-01" });
  assert.ok(actions.consolidatePeriod({ periodStart: "2026-07-21", periodEnd: "2026-08-20", asOfDate: HOJE }).ok);
  const cons = guia({ from: "2026-07-21", to: "2026-08-20" });
  assert.equal(cons.periodOutOfControl, false);
  assert.equal(cons.state, "consolidado");
  assert.equal(cons.stateLabel, "Consolidado");
  assert.ok(cons.consolidation, "snapshot ativo preservado");
  // Período passado dentro do controle, sem pendências, NÃO consolidado: segue “Pronto para consolidar”.
  reset(entries, { controlStart: "2026-07-01" });
  const semCons = guia({ from: "2026-07-21", to: "2026-08-20" });
  assert.equal(semCons.periodOutOfControl, false);
  assert.equal(semCons.stateLabel, "Pronto para consolidar", "workflow real do controle preservado");
  // Período futuro segue “Período futuro” (4I.1).
  const fut = guia({ from: "2026-10-21", to: "2026-11-20" });
  assert.equal(fut.periodOutOfControl, false);
  assert.equal(fut.stateLabel, "Período futuro");
});

check("T12 — Cards e cabeçalho responsivos em 320/360/412 sem overflow problemático", () => {
  const page = pageSrc();
  // Compactação 4I.1 preservada.
  assert.ok(/<article className="rounded-2xl border border-slate-200 bg-white px-4 pt-4 pb-2\.5 shadow-sm">/.test(page), "padding do card preservado");
  assert.ok(page.includes("mt-2 grid gap-2.5 md:grid-cols-2"), "grade principal compacta");
  assert.ok(page.includes("mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2"), "ações logo após o conteúdo");
  // Bloco compacto do card manual: 2 linhas, espaçamento mínimo, texto quebrável.
  assert.ok(page.includes('<div className="mt-1 space-y-0.5 text-[11px] font-semibold text-emerald-800">'), "bloco compacto com espaçamento mínimo");
  // Resumo neutro do período fora do controle: fluido, quebrável.
  assert.ok(page.includes("flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-2.5"), "resumo neutro fluido");
  assert.ok(page.includes("min-w-0 flex-1 break-words text-xs font-bold text-slate-600"), "texto do resumo neutro quebra sem cortar");
  // Cabeçalho: badges quebram em linha (flex-wrap) sem largura fixa.
  assert.ok(page.includes('<div className="flex flex-wrap items-center gap-2">\n          <PeriodNavigator'), "linha do período com flex-wrap");
  assert.ok(page.includes("flex shrink-0 flex-wrap justify-end gap-1.5"), "badges do card quebram sem estourar");
  // Mobile 320/360/412: nada gera overflow horizontal.
  assert.ok(!page.includes("min-w-["), "nenhuma largura fixa mínima");
  assert.ok(!page.includes("overflow-x"), "nenhum scroll horizontal");
  assert.ok(!page.includes("w-screen"), "nenhuma largura de viewport");
  assert.ok(!page.includes("<table"), "layout em cards");
  assert.ok(!page.includes("whitespace-nowrap"), "nenhum texto proibido de quebrar");
  assert.ok(!page.includes('className="h-['), "sem altura fixa");
  assert.ok(page.includes("break-words") && page.includes("min-w-0"), "textos e colunas fluidos");
  assert.ok(page.includes("md:grid-cols-2"), "duas colunas só a partir de md");
  assert.ok(page.includes("inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold"), "botões acessíveis");
});

console.log(`\n4I.2 — ${passed}/12 verificações concluídas.`);
if (passed !== 12) process.exit(1);
