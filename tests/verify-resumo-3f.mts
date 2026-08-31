/**
 * VERIFICAÇÃO — ETAPA 3F: REFORMULAÇÃO DO RESUMO DO PERÍODO
 *
 * Números de referência (seed 4.0, período 21/08/2026 → 20/09/2026, asOf 30/08,
 * SEM uso [10+] ativo) — todos provados pelos motores reais, nada hardcodado:
 *
 *   24/08 7h30 (saldo −30min) · 25/08 8h (0) · 26/08 7h (−60min)
 *   27/08 incompleto (4h conhecidas, SEM contribuição financeira)
 *   28/08 10h30 (no ponto 10h, saldo +2h, [10+] gerado 30min)
 *
 *   SALDO REGULAR FACTUAL = +30min · [10+] GERADO NO PERÍODO = 30min
 *   BANCO ANUAL 2026/2027 = 130min (18/08 40 · 20/08 60 · 28/08 30), usado 0
 *   PROJEÇÃO SEM USOS = +30min
 *
 * Roteiro:
 *   A–H   base factual (sem uso)
 *   I–P   uso [10+] de 30min em 26/08 (3D) → factual intacto + projeção
 *   Q–Z   estrutura/linguagem do novo Resumo (sem compensações/realocado)
 *   AA    período que cruza 30/04 → bancos SEPARADOS por ciclo
 *   AB–AF CSV do novo schema
 *   AG–AS layout responsivo (tabela desktop × lista mobile, mesma derivação)
 *
 * Executar: npx tsx tests/verify-resumo-3f.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getPointPeriod } from "../src/lib/periods.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildResumoPeriodView, resumoDayPending, resumoProjectionVisible } from "../src/lib/resumo-period-view.ts";
import { resumoFinancialFrozen } from "../src/lib/resumo-days.ts";
import { formatMinutes, weekdayShort } from "../src/lib/time.ts";
import type { PointPeriod } from "../src/lib/periods.ts";
import type { ResumoDetailRow } from "../src/lib/resumo-period-view.ts";

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

function resetStore() {
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
}

function viewOf(period: PointPeriod = PERIOD) {
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
    uses: d.specialExcessUses ?? [],
  });
}

const page = src("src/app/(app)/resumo/page.tsx");
const viewSrc = src("src/lib/resumo-period-view.ts");
const chartSrc = src("src/components/stacked-period-chart.tsx");
const barsSrc = src("src/components/charts.tsx");
// 3F.1: a apresentacao mobile dos dias vive em proprio componente (mesma derivacao)
const rowSrc = src("src/components/resumo-day-row-mobile.tsx");

/** Mesmo mapping do exportCsv da página (mesma derivação `view.days`). */
function csvFields(r: ResumoDetailRow): (string | number)[] {
  const d = r.day;
  const frozen = resumoFinancialFrozen(d);
  const p = r.projection;
  return [
    d.date,
    weekdayShort(d.date),
    r.situation === "—" ? "" : r.situation,
    d.workedMinutes,
    d.expectedMinutes,
    frozen ? "" : d.balanceMinutes,
    frozen || d.entryCount <= 0 ? "" : d.registrableMinutes,
    r.specialGenerated,
    r.specialUsed,
    frozen ? "" : p.projectedWorkedMinutes,
    frozen ? "" : p.projectedBalanceMinutes,
  ];
}

/* ── A–H + AQ: base factual (seed 4.0, sem uso [10+]) ────────────────── */

resetStore();

check("A. saldo regular factual do período = +30min (motores reais)", () => {
  assert.equal(PERIOD.from, "2026-08-21");
  assert.equal(PERIOD.to, "2026-09-20");
  const v = viewOf();
  assert.equal(v.cards.regularBalanceMinutes, 30);
});

check("B. 27/08 incompleto: 4h conhecidas, SEM contribuição ao saldo e não projetável", () => {
  const v = viewOf();
  const r = v.days.find((x) => x.day.date === "2026-08-27");
  assert.ok(r, "linha 27/08 presente");
  assert.equal(r.day.status, "incomplete");
  assert.equal(r.day.workedMinutes, 240, "4h registradas = fato conhecido");
  assert.equal(r.day.balanceContribution, 0, "sem contribuição financeira ao saldo");
  assert.equal(r.projection.projectable, false, "3A não projeta dia financeiramente inválido");
  assert.ok(resumoFinancialFrozen(r.day), "financeiro congelado (—)");
});

check("C. horas registradas = 37h (inclui as 4h do dia pendente — fato registrado)", () => {
  const v = viewOf();
  assert.equal(v.cards.registeredMinutes, 2220, "37h = 450+480+420+240+630");
  assert.equal(v.cards.hasPendingRegisteredDays, true, "subtexto de dia pendente ativo");
});

check("D. [10+] gerado NO PERÍODO = 30min (≠ banco do ciclo)", () => {
  const v = viewOf();
  assert.equal(v.cards.specialGeneratedMinutes, 30);
});

check("E. banco anual 2026/2027 gerado = 130min (3C: 40+60+30, origens de período anterior entram)", () => {
  const v = viewOf();
  assert.equal(v.banks.length, 1);
  assert.equal(v.banks[0].cycle, "2026/2027");
  assert.equal(v.banks[0].bank.generatedMinutes, 130);
});

check("F. banco anual utilizado = 0 (sem uso ativo no seed)", () => {
  const v = viewOf();
  assert.equal(v.banks[0].bank.usedMinutes, 0);
});

check("G. banco anual disponível = 130min", () => {
  const v = viewOf();
  assert.equal(v.banks[0].bank.availableMinutes, 130);
});

check("H. projeção do período sem usos = +30min (3A; igual ao factual)", () => {
  const v = viewOf();
  assert.equal(v.cards.projection.factualBalanceMinutes, 30);
  assert.equal(v.cards.projection.appliedSpecialMinutes, 0);
  assert.equal(v.cards.projection.projectedBalanceMinutes, 30);
});

check("AQ. linha 28/08 identifica [10+] gerado = 30min", () => {
  const v = viewOf();
  const r = v.days.find((x) => x.day.date === "2026-08-28");
  assert.ok(r);
  assert.equal(r.specialGenerated, 30);
  assert.equal(r.specialUsed, 0);
});

/* ── I–P + AR + AB–AE: uso [10+] de 30min em 26/08 (action 3D) ───────── */

resetStore();
const created = actions.createSpecialExcessUse({
  destinationDate: "2026-08-26",
  minutes: 30,
  allocationStrategy: "fifo",
  asOfDate: ASOF,
});
assert.ok(created.ok, `criação do uso falhou: ${created.error}`);

check("I. uso ativo NÃO altera o saldo regular factual (continua +30min)", () => {
  const v = viewOf();
  assert.equal(v.cards.regularBalanceMinutes, 30);
});

check("J. projeção do período = +1h (factual +30 + 30min aplicado em 26/08)", () => {
  const v = viewOf();
  assert.equal(v.cards.projection.appliedSpecialMinutes, 30);
  assert.equal(v.cards.projection.projectedBalanceMinutes, 60);
});

check("K. banco anual utilizado = 30min", () => {
  const v = viewOf();
  assert.equal(v.banks[0].bank.usedMinutes, 30);
});

check("L. banco anual disponível = 1h40 (130 − 30)", () => {
  const v = viewOf();
  assert.equal(v.banks[0].bank.availableMinutes, 100);
});

check("M. linha 26/08: trabalhado 7h / saldo −1h intactos; projeção 7h30 / −30min", () => {
  const v = viewOf();
  const r = v.days.find((x) => x.day.date === "2026-08-26");
  assert.ok(r);
  assert.equal(r.day.workedMinutes, 420, "TRABALHADO = 7h (nunca reescrito)");
  assert.equal(r.day.balanceMinutes, -60, "saldo −1h intacto");
  assert.equal(r.projection.appliedSpecialMinutes, 30);
  assert.equal(r.projection.projectedWorkedMinutes, 450, "no ponto projetado 7h30");
  assert.equal(r.projection.projectedBalanceMinutes, -30, "saldo projetado −30min");
});

check("AR. 26/08 com uso: campo '[10+] usado' = 30min e projeção visível", () => {
  const v = viewOf();
  const r = v.days.find((x) => x.day.date === "2026-08-26");
  assert.ok(r);
  assert.equal(r.specialUsed, 30);
  assert.equal(r.specialGenerated, 0, "26/08 não gerou [10+] (só recebeu uso)");
  assert.ok(resumoProjectionVisible(r), "projeção agregando informação (aplicado > 0)");
});

check("AB. CSV exporta saldo regular factual (24/08 = −30min; 25/08 = 0min)", () => {
  const v = viewOf();
  const r24 = csvFields(v.days.find((x) => x.day.date === "2026-08-24")!);
  const r25 = csvFields(v.days.find((x) => x.day.date === "2026-08-25")!);
  assert.equal(r24[5], -30);
  assert.equal(r25[5], 0);
});

check("AC. CSV exporta [10+] gerado (28/08 = 30min)", () => {
  const v = viewOf();
  const r28 = csvFields(v.days.find((x) => x.day.date === "2026-08-28")!);
  assert.equal(r28[7], 30);
});

check("AD. CSV exporta [10+] utilizado (26/08 = 30min)", () => {
  const v = viewOf();
  const r26 = csvFields(v.days.find((x) => x.day.date === "2026-08-26")!);
  assert.equal(r26[8], 30);
});

check("AE. CSV exporta projeção (26/08: 7h30 no ponto / −30min de saldo projetado)", () => {
  const v = viewOf();
  const r26 = csvFields(v.days.find((x) => x.day.date === "2026-08-26")!);
  assert.equal(r26[9], 450);
  assert.equal(r26[10], -30);
});

/* ── N–P: cancelamento do uso devolve tudo (factual nunca mudou) ─────── */

const useId = (getAppData().specialExcessUses ?? []).find((u) => u.destinationDate === "2026-08-26")!.id;
const canceled = actions.cancelSpecialExcessUse({ id: useId });
assert.ok(canceled.ok, `cancelamento falhou: ${canceled.error}`);

check("N. após cancelar: saldo factual continua +30min", () => {
  const v = viewOf();
  assert.equal(v.cards.regularBalanceMinutes, 30);
});

check("O. após cancelar: projeção volta a +30min", () => {
  const v = viewOf();
  assert.equal(v.cards.projection.projectedBalanceMinutes, 30);
  assert.equal(v.cards.projection.appliedSpecialMinutes, 0);
});

check("P. após cancelar: banco disponível volta a 2h10 (130min)", () => {
  const v = viewOf();
  assert.equal(v.banks[0].bank.availableMinutes, 130);
});

check("AF. dia inválido (27/08) não recebe saldo/projeção inventados no CSV", () => {
  const v = viewOf();
  const r27 = csvFields(v.days.find((x) => x.day.date === "2026-08-27")!);
  assert.equal(r27[5], "", "saldo_regular vazio");
  assert.equal(r27[6], "", "no_ponto vazio");
  assert.equal(r27[9], "", "projecao no ponto vazia");
  assert.equal(r27[10], "", "saldo projetado vazio");
  assert.equal(r27[3], 240, "trabalhado (fato registrado) permanece");
});

/* ── Q–Z + AG–AN/AO/AP/AS: estrutura e linguagem do novo Resumo ──────── */

resetStore();

check("Q. não renderiza bloco principal 'Compensações' (nem Horas compensadas/pendentes)", () => {
  assert.ok(!page.includes('title="Compensações"'), "coluna Compensações fora do Resumo");
  assert.ok(!page.includes('label="Horas compensadas"'), "horas compensadas fora");
  assert.ok(!page.includes('label="Compensações pendentes"'), "compensações pendentes fora");
  assert.ok(!page.includes("acordoTotal"), "acordo a compensar fora");
});

check("R. não renderiza 'Realocado' / 'A realocar'", () => {
  assert.ok(!page.includes("Realocado"));
  assert.ok(!page.includes("A realocar"));
  assert.ok(!page.includes("periodExcessBook"), "book legado (hour-bank) fora do Resumo");
});

check("S. gráfico em modo factual: sem 'Horas compensadas' como camada principal", () => {
  assert.ok(page.includes("factualOnly"), "Resumo liga o modo factual");
  assert.ok(barsSrc.includes("{!factualOnly && d.compensated > 0 &&"), "camada compensada só no modo legado");
  assert.ok(barsSrc.includes("!factualOnly && (d.compensatedConcluded"), "tooltip de compensação só no modo legado");
  assert.ok(page.includes('title="Barras empilhadas do período"'), "card do gráfico preservado");
});

check("T. card [10+] usa linguagem 'gerado' (sem 'Excedente do período')", () => {
  assert.ok(page.includes('[10+] gerado no período'), "rótulo do card");
  assert.ok(page.includes("Excedente factual acima de 10h/dia."), "subtexto factual");
  assert.ok(!page.includes("Excedente do período [10+]"), "rótulo legado fora");
});

check("U. banco anual mostra Gerado / Utilizado / Disponível (3C)", () => {
  assert.ok(page.includes('title="Banco [10+]"'), "bloco separado e identificado");
  assert.ok(page.includes(`Ciclo {cycle}`), "ciclo nomeado no painel");
  for (const l of ["Gerado", "Utilizado", "Disponível"]) assert.ok(page.includes(`>${l}<`), `campo ${l}`);
  assert.ok(viewSrc.includes("buildSpecialExcessBank"), "fonte 3C na derivação");
});

check("V. composição do saldo mostra positivos / negativos / líquido (2A)", () => {
  assert.ok(page.includes('title="Composição do saldo regular"'));
  assert.ok(page.includes('label="Créditos regulares"'));
  assert.ok(page.includes('label="Jornadas abaixo da base"'));
  assert.ok(viewSrc.includes("summarizeRegularFacts"), "fonte 2A na derivação");
  const v = viewOf();
  assert.equal(v.composition.generatedCreditMinutes, 120, "créditos +2h (28/08)");
  assert.equal(v.composition.generatedDeficitMinutes, 90, "déficits 1h30 (24/08+26/08)");
  assert.equal(v.composition.netBalanceMinutes, 30);
});

check("W. detalhamento possui representação [10+] (tabela + mobile)", () => {
  assert.ok(page.includes(">[10+]</th>"), "coluna [10+] na tabela desktop");
  assert.ok(rowSrc.includes('label="[10+] gerado"'), "campo mobile gerado");
  assert.ok(rowSrc.includes('label="[10+] usado"'), "campo mobile usado");
});

check("X. detalhamento possui projeção (tabela + mobile)", () => {
  assert.ok(page.includes("Projeção**</th>"), "coluna Projeção na tabela desktop");
  assert.ok(rowSrc.includes('label="Projeção"'), "campo mobile Projeção");
});

check("Y. registro incompleto continua sem saldo financeiro (mobile: mensagem de pendencia)", () => {
  const v = viewOf();
  const r = v.days.find((x) => x.day.date === "2026-08-27")!;
  assert.equal(r.day.balanceContribution, 0);
  assert.ok(resumoDayPending(r), "dia pendente identificado");
  assert.ok(rowSrc.includes("Registro pendente. Os valores financeiros serão definidos após a correção."), "mensagem compacta do item mobile");
});

check("Z. legenda principal do gráfico não depende da linguagem legada de compensação", () => {
  assert.ok(barsSrc.includes('marker === "acordado-compensar"'), "filtro do marcador legado");
  assert.ok(barsSrc.includes('marker === "calendario-compensar"'), "filtro do marcador legado 2");
  assert.ok(barsSrc.includes('"[10+] acima de 10h"'), "legenda factual [10+]");
  assert.ok(barsSrc.includes('"Extra regular"'), "legenda factual extra");
  assert.ok(chartSrc.includes("if (!factualOnly) {"), "modos: legado só no modo legado");
});

check("AG. desktop possui tabela", () => {
  assert.ok(page.includes('hidden md:block'), "tabela visível em md+");
  assert.ok(page.includes('<table className="w-full text-sm">'), "tabela sem min-width (sem scroll forçado)");
});

check("AH. mobile possui representação alternativa própria (lista vertical)", () => {
  assert.ok(page.includes('<ul className="divide-y divide-slate-100 md:hidden">'), "lista mobile < md");
});

check("AI. mobile não depende de scroll horizontal para campos essenciais", () => {
  const mobileStart = page.indexOf('<ul className="divide-y divide-slate-100 md:hidden">');
  const mobileEnd = page.indexOf('mt-2 text-[11px] text-slate-400"', mobileStart);
  const mobile = page.slice(mobileStart, mobileEnd);
  assert.ok(!mobile.includes("overflow-x-auto"), "sem overflow-x no bloco mobile");
  assert.ok(!mobile.includes("min-w-"), "sem min-width no bloco mobile");
  assert.ok(!page.includes("min-w-[640px]"), "min-width antigo da tabela removido");
});

check("AJ. mobile possui Trabalhado", () => {
  assert.ok(rowSrc.includes('label="Trabalhado"'));
});

check("AK. mobile possui Jornada", () => {
  assert.ok(rowSrc.includes('label="Jornada"'));
});

check("AL. mobile possui Saldo regular", () => {
  assert.ok(rowSrc.includes('label="Saldo regular"'));
});

check("AM. mobile possui No ponto", () => {
  assert.ok(rowSrc.includes('label="No ponto"'));
});

check("AN. mobile possui [10+] quando aplicavel (gerado/usado)", () => {
  assert.ok(rowSrc.includes('label="[10+] gerado"'));
  assert.ok(rowSrc.includes('label="[10+] usado"'));
  const v = viewOf();
  assert.equal(v.days.find((x) => x.day.date === "2026-08-28")!.specialGenerated, 30, "28/08 renderiza '[10+] gerado'");
});

check("AO. mobile possui Projeção quando aplicável", () => {
  // sem uso: nenhuma projeção agregando informação → campo ausente (discreta)
  const v = viewOf();
  assert.ok(!v.days.some((r) => resumoProjectionVisible(r)), "sem uso: projeção discreta (—)");
  assert.ok(rowSrc.includes('label="Projeção"'), "campo presente no layout expandido (condicional)");
});

check("AP. registro incompleto no mobile não recebe valores financeiros inventados", () => {
  assert.ok(rowSrc.includes("resumoDayPending(row)"), "pendência identificada no item mobile");
  assert.ok(rowSrc.includes("resumoFinancialFrozen(d)"), "financeiro congelado identificado");
  assert.ok(rowSrc.includes("const expandable = !frozen || pending;"), "só dias relevantes (ou pendentes) são recolhíveis");
  const v = viewOf();
  const r = v.days.find((x) => x.day.date === "2026-08-27")!;
  assert.ok(resumoFinancialFrozen(r.day) && resumoDayPending(r), "27/08: pendência, não financeiro");
});

check("AS. desktop e mobile usam a MESMA derivação (view.days; sem cálculo paralelo)", () => {
  assert.ok(page.includes("buildResumoPeriodView"), "página consome a derivação única");
  assert.ok(viewSrc.includes("buildResumoDayRow"), "derivação ancorada na fonte central");
  assert.ok((page.match(/view\.days\.map/g) ?? []).length >= 2, "tabela e lista mapeiam a mesma view.days");
  assert.ok(!page.includes("specialExcessBook"), "sem engine legado hour-bank no Resumo");
  assert.ok(!page.includes("buildDebtDays"), "sem engine legado debt no Resumo");
  assert.ok(!viewSrc.includes("buildDebtDays") && !viewSrc.includes("specialExcessBook") && !viewSrc.includes("openDeficit"), "derivação limpa de legado");
});

/* ── AA: período que cruza 30/04 → bancos separados por ciclo ────────── */

check("AA. período 21/04→20/05 cruza 30/04: painéis SEPARADOS por ciclo anual", () => {
  const v = viewOf({ from: "2025-04-21", to: "2025-05-20" });
  assert.equal(v.banks.length, 2, "dois ciclos intersectados → dois painéis");
  assert.deepEqual(v.banks.map((b) => b.cycle), ["2024/2025", "2025/2026"]);
  assert.equal(v.banks[0].bank.generatedMinutes, 0);
  assert.equal(v.banks[1].bank.generatedMinutes, 0);
  // saldo [10+] NUNCA mescla ciclos: cada painel somou só os lotes do próprio ciclo
  for (const b of v.banks) {
    assert.equal(b.bank.generatedMinutes, b.bank.lots.reduce((s, l) => s + l.generatedMinutes, 0));
  }
});

console.log(`\n${passed}/45 verificações 3F passaram.`);
