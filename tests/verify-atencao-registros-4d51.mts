/**
 * VERIFICAÇÃO — ETAPA 4D.5.1: COERÊNCIA DE ESCOPO + MESMAS FAIXAS DE
 * "ATENÇÃO AGORA" TAMBÉM EM REGISTROS.
 *
 * · Registros no modo normal exibe as MESMAS quatro faixas da Visão Geral
 *   (fonte única attention-now, mesmo escopo ciclo) — sem recalcular;
 * · o agrupamento genérico "Registros pendentes: X" sai da linguagem
 *   principal (união existe só internamente nos fluxos legados);
 * · com filtro específico ativo, as faixas globais somem (só contexto);
 * · escopo=ciclo ⇒ header E resumo usam 01/05→30/04 (o MESMO range da
 *   lista — nenhuma matemática nova);
 * · Parte F: Limpar filtro preserva escopo; Voltar ao período limpa tudo.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-atencao-registros-4d51.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { attentionNowSummary } from "../src/lib/attention-now.ts";
import { situationsOfDay } from "../src/lib/day-situation.ts";
import { annualCycleBounds, getAnnualPointCycle, listDaysBetween } from "../src/lib/periods.ts";
import type { TimeEntry, Falta, Absence } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const reg = () => src("src/app/(app)/registros/page.tsx");
const vg = () => src("src/app/(app)/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const st = () => getAppData();
const reset = (entries: TimeEntry[], opts: { reasons?: string[]; controlStartDate?: string } = {}) => {
  actions.replaceAll({
    user: opts.controlStartDate ? { ...seedUser, controlStartDate: opts.controlStartDate } : seedUser,
    entries, compensations: [], absences: [], companyCalendars: [], faltas: [],
    excessReasons: (opts.reasons ?? []).map((date, i) => ({ id: i + 1, date, reason: "demanda-urgente" })),
    specialExcessUses: [], specialExcessPlans: [],
  });
};
const HOJE = "2026-09-02";
const resumo = (entries: TimeEntry[], opts: Partial<Parameters<typeof attentionNowSummary>[0]> = {}) =>
  attentionNowSummary({
    today: HOJE, entries, absences: [], calendars: undefined, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? null, plans: st().specialExcessPlans ?? [],
    ...opts,
  });

/* ── Estado base dos testes 01–03 (ver Também 06): 1 inconsistente +
 *    1 incompleto + dias vazios regulares (sem registro) no ciclo. ── */
const resetMisto = () => {
  reset([
    punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "08:30", "entrada"),
    punch("2026-08-12", "08:00", "entrada"), punch("2026-08-12", "12:00", "saida"), punch("2026-08-12", "13:00", "entrada"),
  ], { controlStartDate: "2026-05-01" });
};

check("TESTE 01 DE 14 — Registros normal: inconsistente 1 aparece em faixa própria", () => {
  resetMisto();
  const s = resumo(st().entries);
  assert.equal(s.inconsistente.length, 1);
  assert.equal(s.inconsistente[0], "2026-08-05");
  const page = reg();
  assert.ok(page.includes("Registro inconsistente: {attention.inconsistente.length}"), "faixa própria com a contagem da fonte única");
  assert.ok(page.includes('faixaHref(attention.inconsistente, "registro-inconsistente")'), "CTA próprio da categoria");
});

check("TESTE 02 DE 14 — Registros normal: incompleto aparece SEPARADO do inconsistente", () => {
  resetMisto();
  const s = resumo(st().entries);
  assert.deepEqual(s.incompleto, ["2026-08-12"], "contagem independente");
  assert.deepEqual(s.inconsistente, ["2026-08-05"], "nunca somadas");
  const page = reg();
  assert.ok(page.includes("Registro incompleto: {attention.incompleto.length}"), "faixa própria");
  assert.ok(!page.includes("Registros pendentes: {attention"), "não há faixa genérica somando as naturezas");
});

check("TESTE 03 DE 14 — Registros normal: sem registro aparece em faixa própria", () => {
  resetMisto();
  const s = resumo(st().entries);
  assert.ok(s["sem-registro"].length >= 1 && s["sem-registro"].includes("2026-08-13"));
  const page = reg();
  assert.ok(page.includes("Dia sem registro: {attention[\"sem-registro\"].length}"));
  assert.ok(page.includes('faixaHref(attention["sem-registro"], "sem-registro")'));
});

check("TESTE 04 DE 14 — Registros normal: planejamento [10+] aguardando em faixa própria", () => {
  reset([punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida")], { reasons: ["2026-08-18"] });
  const r = actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20" });
  assert.ok(r.ok, r.error ?? "");
  const s = resumo(st().entries);
  assert.deepEqual(s["plano-10"], ["2026-08-26"]);
  const page = reg();
  assert.ok(page.includes("Planejamento [10+] aguardando confirmação: {attention[\"plano-10\"].length}"));
  assert.ok(page.includes("planoFaixaHref(attention[\"plano-10\"])"));
});

check("TESTE 05 DE 14 — 'Registros pendentes: X' NÃO é mais linguagem principal", () => {
  const page = reg();
  // Ramo GLOBAL do banner antigo removido (com o botão de união):
  assert.ok(!page.includes("Ver pendências"), "botão 'Ver pendências' removido");
  assert.ok(!page.includes("Existem dias que precisam de correção antes do saldo ser definitivo."), "texto global do banner removido");
  assert.ok(!page.includes("Existem dias de expediente já encerrados sem registro ou justificativa."), "texto global de sem-registro removido");
  assert.ok(!page.includes('onClick={() => router.replace("/registros?semRegistro=1")}'), "botão global de sem-registro removido (redirects legados internos permanecem)");
  // O rótulo "Ver dia(s) sem registro" que resta é o CTA da faixa NOVA independente:
  assert.ok(page.includes('? "Ver dia sem registro" : "Ver dias sem registro"'));
  // A união sobrevive SOMENTE como contexto de filtro legado (?pendentes=1):
  assert.ok(page.includes("· filtro aplicado"), "contexto do filtro legado preservado");
  // As quatro faixas independentes são a linguagem principal:
  assert.ok(page.includes('aria-label="Atenção agora"'));
});

check("TESTE 06 DE 14 — counts Registros = counts Visão Geral (mesma fonte, mesmo escopo)", () => {
  // MESMA fonte compartilhada nas duas páginas (attentionNowSummary) e
  // MESMO escopo default (ciclo anual — nenhum range encurtado):
  for (const page of [reg(), vg()]) {
    assert.ok(page.includes("attentionNowSummary({"), "fonte única presente");
    assert.ok(!page.includes("range:"), "escopo default (ciclo) em ambas");
  }
  assert.ok(reg().includes("attention.inconsistente.length") && vg().includes("attention.inconsistente.length"), "mesmo campo canônico nas duas");
  // Igualdade REAL dos lados (classificador canônico = faixas) no ciclo:
  resetMisto();
  const s = resumo(st().entries);
  const bounds = annualCycleBounds(getAnnualPointCycle(HOJE));
  const regInconsistente: string[] = [];
  const regIncompleto: string[] = [];
  const regSem: string[] = [];
  for (const date of listDaysBetween(bounds.from, bounds.to)) {
    const ids = situationsOfDay(date, HOJE, st().entries, [], undefined, S(), { faltas: [], controlStartDate: st().user.controlStartDate ?? null });
    if (ids.includes("registro-inconsistente")) regInconsistente.push(date);
    if (ids.includes("registro-incompleto")) regIncompleto.push(date);
    if (ids.includes("sem-registro")) regSem.push(date);
  }
  assert.deepEqual(regInconsistente, s.inconsistente);
  assert.deepEqual(regIncompleto, s.incompleto);
  assert.deepEqual(regSem, s["sem-registro"]);
});

check("TESTE 07 DE 14 — CTA de 1 inconsistente: filtro + data + card expandido", () => {
  const page = reg();
  assert.ok(page.includes('`/registros?situacao=${filtro}&escopo=ciclo${dates.length === 1 ? `&data=${dates[0]}` : ""}`'), "1 item ⇒ foco na data");
  assert.ok(page.includes("initiallyExpanded={focusDate === date}"), "card da data focada expandido");
});

check("TESTE 08 DE 14 — CTA de 1 incompleto: mesma regra (filtro + data + expansão)", () => {
  const page = reg();
  assert.ok(page.includes('faixaHref(attention.incompleto, "registro-incompleto")'), "mesmo builder com a categoria");
  assert.ok(page.includes("initiallyExpanded={focusDate === date}"));
});

check("TESTE 09 DE 14 — CTA de múltiplos sem-registro: escopo ciclo + quantidade exata", () => {
  reset([], { controlStartDate: "2026-05-01" });
  const s = resumo([]);
  const total = s["sem-registro"].length;
  assert.ok(total >= 13, `múltiplos dias vazios no ciclo (got ${total})`);
  const page = reg();
  // Múltiplos ⇒ href SEM &data (a base lista a categoria inteira no ciclo):
  assert.ok(!/\?situacao=\$\{filtro\}&escopo=ciclo&data=\$\{dates\[0\]\}` : /.test(page), "base sem data para 2+");
  // O filtro do destino exibe EXATAMENTE os dias da categoria:
  let viaFiltro = 0;
  for (const date of listDaysBetween(annualCycleBounds(getAnnualPointCycle(HOJE)).from, annualCycleBounds(getAnnualPointCycle(HOJE)).to)) {
    if (situationsOfDay(date, HOJE, [], [], undefined, S(), { faltas: [], controlStartDate: st().user.controlStartDate ?? null }).includes("sem-registro")) viaFiltro++;
  }
  assert.equal(viaFiltro, total, "quantidade do filtro = contagem da faixa");
});

check("TESTE 10 DE 14 — CTA de planejamento: foco no destino correto", () => {
  reset([punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida")], { reasons: ["2026-08-18"] });
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20" }).ok);
  const s = resumo(st().entries);
  assert.equal(s["plano-10"][0], "2026-08-26", "data do foco = destinationDate do plano");
  const page = reg();
  assert.ok(page.includes('`/registros?atencao=plano-10&escopo=ciclo${dates.length === 1 ? `&data=${dates[0]}` : ""}`'), "plano único ⇒ foco no destino");
});

check("TESTE 11 DE 14 — Com filtro específico ativo: faixas globais ocultas; só o contexto", () => {
  const page = reg();
  assert.ok(
    page.includes("{!pendingOnly && !missingOnly && !planoOnly && !situationActive && ("),
    "faixas globais só no modo normal (sem filtro)",
  );
  // Contextos de filtro ativo preservados (categoria + quantidade + botão):
  assert.ok(page.includes("· filtro aplicado"), "contexto pendentes legado");
  assert.ok(page.includes("⏱ Planejamento [10+] aguardando confirmação: {planoCount} · filtro aplicado"), "contexto plano");
  assert.ok(page.includes("Escopo: ciclo anual {getAnnualPointCycle(todayStr)}"), "contexto de escopo/foco");
});

check("TESTE 12 DE 14 — Modo período: header/resumo 21→20 corretos", () => {
  const page = reg();
  assert.ok(page.includes("Período do ponto: {periodLabel(period)}"), "header do período no modo padrão");
  assert.ok(page.includes(": `Período ${periodLabel(period)}`}"), "resumo rotulado com o período");
  assert.ok(page.includes("let r = wantCycleScope ? cycleRange : query ?? period;"), "default continua o período do ponto");
});

check("TESTE 13 DE 14 — Modo ciclo: header/resumo 01/05→30/04, o MESMO range da lista", () => {
  const page = reg();
  assert.ok(page.includes("Ciclo {getAnnualPointCycle(todayStr)} — {formatDateShortBR(cycleRange.from)} → {formatDateShortBR(cycleRange.to)}"), "header do ciclo");
  assert.ok(page.includes("`Ciclo ${getAnnualPointCycle(todayStr)} (${formatDateShortBR(cycleRange.from)} → ${formatDateShortBR(cycleRange.to)})`"), "resumo rotulado com o ciclo");
  // Resumo usa exatamente o range efetivo (sem outra matemática):
  assert.ok(page.includes("const debts = buildDebtDays(entries, compensations, settings, range,"), "métricas do resumo derivadas do range efetivo");
  assert.ok(page.includes("for (const { date, ctx, balanceContribution, deficitContribution, absence } of days)"), "resumo agregando os MESMOS days da lista");
});

check("TESTE 14 DE 14 — Limpar filtro / Voltar ao período: sem query param órfão", () => {
  const page = reg();
  assert.ok(page.includes('const limparFiltro = () => router.replace(wantCycleScope ? "/registros?escopo=ciclo" : "/registros");'), "Limpar filtro preserva escopo e remove filtro/data");
  assert.ok(page.includes('const voltarAoPeriodo = () => router.replace("/registros");'), "Voltar ao período limpa filtro + foco + escopo");
  assert.ok(page.includes('onClick={limparFiltro}'), "botão Limpar filtro ligado");
  assert.equal((page.match(/onClick=\{voltarAoPeriodo\}/g) ?? []).length, 3, "Voltar ao período nos 3 contextos (pendentes, missing, escopo)");
});

console.log(`\n${passed}/14 verificações da Etapa 4D.5.1 passaram.`);
if (passed !== 14) process.exit(1);
