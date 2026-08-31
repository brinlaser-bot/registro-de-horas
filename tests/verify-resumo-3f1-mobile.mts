/**
 * VERIFICAÇÃO — ETAPA 3F.1: DETALHAMENTO DIÁRIO RECOLHÍVEL NO MOBILE
 *
 * O item mobile de cada dia financeiramente relevante (ou com registro
 * pendente) passa a ser RECOLHÍVEL: padrão FECHADO, múltiplos dias abertos,
 * estado local (Set<string>), sem persistência. Dias simples (folga/feriado/
 * sem registro/futuro) permanecem linhas compactas, sem expansão.
 *
 * APRESENTAÇÃO SOMENTE: a mesma derivação da 3F (resumo-period-view) alimenta
 * a tabela desktop, o item mobile e o CSV — nenhum cálculo novo aqui.
 *
 * As provas de interação usam renderização real (react-dom/server) do
 * componente mobile com linhas REAIS da seed 4.0 (asOf 30/08, período
 * 21/08→20/09) + toggleDayOpen puro + asserções de estrutura da página.
 *
 * Roteiro:
 *   A–F   item recolhível, padrão fechado, abrir/fechar, múltiplos, aria
 *   G–M   layouts: normal / déficit / [10+] gerado / [10+] usado
 *   N–Q   incompleto / folga / sem registro / futuro
 *   R–V   desktop intacto, sem accordion no desktop, sem cálculo novo,
 *         mesma derivação, sem scroll horizontal
 *
 * Executar: npx tsx tests/verify-resumo-3f1-mobile.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getPointPeriod } from "../src/lib/periods.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { ResumoDayRowMobile, toggleDayOpen } from "../src/components/resumo-day-row-mobile.tsx";
import type { PointPeriod } from "../src/lib/periods.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";
const seed = buildSeedData();
const settings = settingsOf(seed.user);
const PERIOD = getPointPeriod(ASOF);

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

const page = src("src/app/(app)/resumo/page.tsx");
const rowSrc = src("src/components/resumo-day-row-mobile.tsx");

function viewOf(period: PointPeriod = PERIOD, uses?: { id: string }[] | null) {
  const d = getAppData();
  return buildResumoPeriodView({
    period,
    today: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings,
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate ?? null,
    uses: uses === undefined ? d.specialExcessUses ?? [] : uses,
  });
}

// view inicial a partir da seed (sem uso) — linhas REAIS
const view = buildResumoPeriodView({
  period: PERIOD,
  today: ASOF,
  entries: seed.entries,
  absences: seed.absences,
  calendars: seed.companyCalendars,
  settings,
  faltas: seed.faltas,
  controlStartDate: seed.user.controlStartDate ?? null,
  uses: seed.specialExcessUses ?? [],
});
const byDate = (d: string) => view.days.find((r) => r.day.date === d)!;

function renderRow(row: ReturnType<typeof byDate>, open: boolean): string {
  return renderToStaticMarkup(createElement(ResumoDayRowMobile, { row, open, onToggle: () => {} }));
}

/* ── A–F: item recolhível, padrão fechado, abrir/fechar, múltiplos, aria ── */

check("A. mobile possui item recolhível por dia relevante", () => {
  assert.ok(page.includes("<ResumoDayRowMobile"), "página usa o item recolhível na lista mobile");
  assert.ok(page.includes("view.days.map((r) => ("), "cada dia de view.days vira um item");
  assert.ok(rowSrc.includes("type=\"button\""), "botão real (área de toque)");
  assert.ok(rowSrc.includes("aria-expanded={open}"), "aria-expanded ligado ao estado");
  assert.ok(rowSrc.includes("aria-controls={detailId}"), "aria-controls aponta o detalhe");
  assert.ok(rowSrc.includes("ChevronDown"), "indicador visual de expansão");
});

check("B. itens começam FECHADOS (Set vazio; sem auto-expansão)", () => {
  assert.ok(page.includes("useState<Set<string>>(new Set())"), "estado inicial vazio = tudo recolhido");
  assert.ok(!page.includes("new Set(["), "nenhuma exceção automática de abertura");
  const html = renderRow(byDate("2026-08-25"), false);
  assert.ok(!html.includes("<dl"), "recolhido: grid financeiro não renderizado");
  assert.ok(html.includes('aria-expanded="false"'));
});

check("C. pode abrir um dia", () => {
  const set = toggleDayOpen(new Set<string>(), "2026-08-25");
  assert.ok(set.has("2026-08-25"), "toggle adiciona a data");
  const html = renderRow(byDate("2026-08-25"), true);
  assert.ok(html.includes("<dl"), "expandido: grid renderizado");
  assert.ok(html.includes('aria-expanded="true"'));
});

check("D. pode fechar novamente", () => {
  let set = toggleDayOpen(new Set<string>(), "2026-08-25");
  set = toggleDayOpen(set, "2026-08-25");
  assert.ok(!set.has("2026-08-25"), "segundo toque fecha");
  assert.equal(toggleDayOpen(new Set<string>(), "a").size, 1);
  assert.equal(toggleDayOpen(toggleDayOpen(new Set<string>(), "a"), "a").size, 0);
});

check("E. pode manter mais de um dia aberto (sem accordion de um-só)", () => {
  let set = new Set<string>();
  set = toggleDayOpen(set, "2026-08-25");
  set = toggleDayOpen(set, "2026-08-26");
  set = toggleDayOpen(set, "2026-08-28");
  assert.ok(set.has("2026-08-25") && set.has("2026-08-26") && set.has("2026-08-28"), "três dias abertos ao mesmo tempo (sem substituir o conjunto)");
});

check("F. aria-expanded acompanha o estado", () => {
  assert.ok(renderRow(byDate("2026-08-25"), false).includes('aria-expanded="false"'));
  assert.ok(renderRow(byDate("2026-08-25"), true).includes('aria-expanded="true"'));
  assert.ok(page.includes("open={openDays.has(r.day.date)}"), "estado da página dirige cada item");
  assert.ok(page.includes("toggleDayOpen(prev, r.day.date)"), "toggle por data, imutável");
});

/* ── G–M: layouts por tipo de dia ─────────────────────────────────────── */

check("G. 25/08 recolhido: informação principal compacta (8h · 0min · Ok)", () => {
  const html = renderRow(byDate("2026-08-25"), false);
  assert.ok(html.includes("25/08"), "data visível");
  assert.ok(html.includes(">Ok<"), "badge visível");
  assert.ok(html.includes(">8h<"), "trabalhado compacto");
  assert.ok(html.includes(">0min<"), "saldo compacto");
  assert.ok(!html.includes(">Trabalhado<"), "labels do grid só quando expandido");
});

check("H. 26/08 recolhido: 7h / -1h", () => {
  const html = renderRow(byDate("2026-08-26"), false);
  assert.ok(html.includes(">7h<"), "trabalhado");
  assert.ok(html.includes(">-1h<"), "saldo negativo");
  assert.ok(html.includes(">Jornada abaixo do previsto<"), "situação visível");
});

check("I. 26/08 expandido: Trabalhado 7h · Jornada 8h · Saldo -1h · No ponto 7h", () => {
  const html = renderRow(byDate("2026-08-26"), true);
  assert.ok(html.includes(">Trabalhado<") && html.includes(">7h<"));
  assert.ok(html.includes(">Jornada<") && html.includes(">8h<"));
  assert.ok(html.includes(">Saldo regular<") && html.includes(">-1h<"));
  assert.ok(html.includes(">No ponto<") && html.includes(">7h<"));
});

check("J. 28/08 recolhido deixa claro [10+] gerado +30min (sem precisar expandir)", () => {
  const html = renderRow(byDate("2026-08-28"), false);
  assert.ok(html.includes("[10+] +30min"), "chip de gerado no cabeçalho");
  assert.ok(html.includes(">10h30<"), "trabalhado");
  assert.ok(html.includes(">+2h<"), "saldo");
  assert.ok(html.includes(">Acima do limite [10+]<"), "badge");
});

check("K. 28/08 expandido mantém Gerado separado (sem 'usado' quando não há)", () => {
  const html = renderRow(byDate("2026-08-28"), true);
  assert.ok(html.includes(">[10+] gerado<"), "campo gerado");
  assert.ok(html.includes(">+30min<"), "valor gerado");
  assert.ok(!html.includes("[10+] usado"), "conceitos não misturados");
});

// ── uso [10+] de 30min em 26/08 (action 3D, como na 3F) ────────────────
actions.replaceAll({
  user: seed.user,
  entries: seed.entries,
  compensations: seed.compensations,
  absences: seed.absences,
  companyCalendars: seed.companyCalendars,
  faltas: seed.faltas,
  excessReasons: seed.excessReasons,
  specialExcessUses: seed.specialExcessUses ?? [],
});
const created = actions.createSpecialExcessUse({
  destinationDate: "2026-08-26",
  minutes: 30,
  allocationStrategy: "fifo",
  asOfDate: ASOF,
});
assert.ok(created.ok, `criação do uso falhou: ${created.error}`);
const r26WithUse = viewOf().days.find((r) => r.day.date === "2026-08-26")!;

check("L. 26/08 com uso de 30min: recolhido indica [10+] usado", () => {
  assert.equal(r26WithUse.specialUsed, 30, "derivação registra o uso no destino");
  const html = renderRow(r26WithUse, false);
  assert.ok(html.includes("[10+] usado 30min"), "chip de uso no cabeçalho");
  assert.ok(html.includes(">7h<") && html.includes(">-1h<"), "fatos seguem os números principais");
  assert.ok(!html.includes("[10+] +"), "26/08 não gerou — sem chip de gerado");
});

check("M. 26/08 expandido com uso: [10+] usado 30min + Projeção 7h30 / -30min", () => {
  const html = renderRow(r26WithUse, true);
  assert.ok(html.includes(">[10+] usado<") && html.includes(">30min<"));
  assert.ok(html.includes(">Projeção<") && html.includes(">7h30 / -30min<"), "projeção 3A, sem reescrever fatos");
  assert.ok(html.includes(">Trabalhado<") && html.includes(">7h<"), "trabalhado continua 7h");
  assert.ok(html.includes(">Saldo regular<") && html.includes(">-1h<"), "saldo continua -1h");
});

/* ── N–Q: pendência / folga / sem registro / futuro ──────────────────── */

check("N. registro incompleto: sem números financeiros inventados (recolhido e expandido)", () => {
  const r27 = byDate("2026-08-27");
  const htmlC = renderRow(r27, false);
  assert.ok(htmlC.includes(">Pendente<"), "indicador compacto quando recolhido");
  assert.ok(!htmlC.includes(">4h<"), "trabalhado não aparece como número financeiro");
  assert.ok(!htmlC.includes("Saldo regular") && !htmlC.includes("No ponto"));
  const htmlO = renderRow(r27, true);
  assert.ok(htmlO.includes("Registro pendente. Os valores financeiros serão definidos após a correção."));
  assert.ok(!htmlO.includes("Saldo regular") && !htmlO.includes("No ponto") && !htmlO.includes("Projeção") && !htmlO.includes("[10+]"), "expandido: só a mensagem");
});

check("O. Folga permanece compacta (linha fixa, sem expansão)", () => {
  const r29 = byDate("2026-08-29");
  assert.equal(r29.situation, "Folga");
  const html = renderRow(r29, true);
  assert.ok(html.includes(">Folga<"), "badge");
  assert.ok(!html.includes("<button"), "sem item expandível");
  assert.ok(!html.includes("aria-expanded"));
  assert.ok(!html.includes("Trabalhado") && !html.includes("Jornada"), "sem campos vazios de preenchimento");
});

check("P. Sem registro permanece compacto (não vira dívida)", () => {
  const r21 = byDate("2026-08-21");
  assert.equal(r21.situation, "Sem registro");
  const html = renderRow(r21, true);
  assert.ok(html.includes(">Sem registro<"));
  assert.ok(!html.includes("<button"));
  assert.ok(!html.includes("-8h") && !html.includes("-480"), "sem saldo inventado");
});

check("Q. futuro permanece compacto (lista navegável até 20/09)", () => {
  const r02 = byDate("2026-09-02");
  const html = renderRow(r02, true);
  assert.ok(!html.includes("<button"), "futuro sem ocorrência não vira card expansível");
  assert.ok(!html.includes("Trabalhado"));
});

/* ── R–V: desktop intacto, sem cálculo novo, mesma derivação, layout ─── */

check("R. desktop continua TABELA (colunas e TOTAL intactos)", () => {
  assert.ok(page.includes("hidden md:block"), "tabela em md+");
  assert.ok(page.includes('<table className="w-full text-sm">'));
  assert.ok(page.includes(">[10+]</th>"));
  assert.ok(page.includes("Projeção**</th>"));
  assert.ok(page.includes("<td className=\"py-3 pr-3\">Total</td>"), "linha TOTAL");
});

check("S. desktop não ganha accordion", () => {
  const dStart = page.indexOf("hidden md:block");
  const dEnd = page.indexOf('<ul className="divide-y divide-slate-100 md:hidden">');
  const desktop = page.slice(dStart, dEnd);
  assert.ok(!desktop.includes("aria-expanded"), "sem accordion no trecho desktop");
  assert.ok(!desktop.includes("ResumoDayRowMobile"), "item mobile só na lista mobile");
  assert.ok(!desktop.includes("openDays"));
});

check("T. nenhum cálculo novo é criado no componente mobile", () => {
  for (const f of [
    "computeDay", "balanceContribution", "projectRealized", "buildSpecialExcessBank",
    "summarizeRegularFacts", "stackedSegments", "appliedOnDate", "buildDebtDays",
  ]) {
    assert.ok(!rowSrc.includes(f), `componente não contem '${f}'`);
  }
  // o componente só consome campos da derivação (row.*/d = row.day)
  assert.ok(rowSrc.includes("const d = row.day;"));
  assert.ok(rowSrc.includes("row.specialGenerated"));
  assert.ok(rowSrc.includes("row.specialUsed"));
  assert.ok(rowSrc.includes("row.projection."));
});

check("U. mesma derivação resumo-period-view alimenta os dois layouts", () => {
  assert.ok(page.includes("buildResumoPeriodView"), "página consome a derivação única");
  assert.ok(page.includes("row={r}"), "item mobile recebe a MESMA row da tabela");
  const viewSrc = src("src/lib/resumo-period-view.ts");
  assert.ok(viewSrc.includes("buildResumoDayRow"), "derivação ancora na fonte central");
  assert.ok(!rowSrc.includes("buildResumoDayRow"), "componente não recalcula — só apresenta");
});

check("V. sem scroll horizontal obrigatório (320/375/390/430px)", () => {
  const mStart = page.indexOf('<ul className="divide-y divide-slate-100 md:hidden">');
  const mEnd = page.indexOf('mt-2 text-[11px] text-slate-400"', mStart);
  const mobile = page.slice(mStart, mEnd);
  assert.ok(!mobile.includes("overflow-x"), "lista mobile sem overflow-x");
  assert.ok(!mobile.includes("min-w-["), "sem min-width fixo na lista mobile");
  assert.ok(!rowSrc.includes("overflow-x"), "item mobile sem overflow-x");
  assert.ok(!rowSrc.includes("min-w-["), "sem min-width fixo no item (apenas min-w-0 de encolhimento)");
  // valores mais longos cabem em metade de 320px (~150px) com text-sm
  assert.ok(rowSrc.includes("text-sm font-extrabold tabular-nums"), "tamanho de fonte estável (sem redução)");
});

console.log(`\n${passed}/22 verificações 3F.1 passaram.`);
