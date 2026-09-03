/**
 * VERIFICAÇÃO — ETAPA 3F.1: DETALHAMENTO DO PERÍODO RECOLHÍVEL
 * (atualizada pela ETAPA 4F — SUPERADO o accordion por dia da 3F.1;
 *  expectativas atualizadas com justificativa: a reforma 4F autorizada do
 *  Resumo substituiu a tabela desktop + accordion mobile por UMA área
 *  "Detalhamento do período" recolhível com linhas compactas únicas —
 *  trabalhado/saldo/projeção/[10+] sempre visíveis por dia, jornada e
 *  "no ponto" permanecem EM REGISTROS via CTA "Ver dia").
 *
 * Escopo: APRESENTAÇÃO do detalhamento do Resumo.
 *   - área RECOLHIDA por padrão (estado 100% local, nunca persistido);
 *   - linha compacta por dia relevante: data · situação · trabalhado ·
 *     saldo factual · projeção (só quando agrega) · [10+] (quando houver)
 *     · pendência (quando houver) · CTA "Ver dia";
 *   - os valores vêm EXATAMENTE da derivação 3F (ResumoDetailRow) —
 *     NENHUM cálculo novo no componente;
 *   - ordem cronológica crescente 21→20 (4F).
 *
 * Números de referência (seed 4.0, período 21/08/2026 → 20/09/2026, asOf
 * 30/08 — mesmos da 3F):
 *   25/08 ter  [Ok]                        8h    0min
 *   26/08 qua  [Jornada abaixo do prev.]   7h   -1h
 *   27/08 qui  [Registro incompleto]       Pendente (financeiro congelado)
 *   28/08 sex  [Acima do limite [10+]]    10h30  +2h   [10+] +30min
 *   29/08 sáb  [Folga]                     fora (dia quieto)
 *   01/09 ter  futuro vazio                linha compacta
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-resumo-3f1-mobile.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getPointPeriod } from "../src/lib/periods.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import {
  buildResumoPeriodView,
  resumoDayPending,
  resumoProjectionVisible,
  type ResumoDetailRow,
} from "../src/lib/resumo-period-view.ts";
import { resumoEventKind, resumoFinancialFrozen, buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { formatMinutes, weekdayShort } from "../src/lib/time.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";
const seed = buildSeedData();
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

function viewOf() {
  const d = getAppData();
  return buildResumoPeriodView({
    period: PERIOD,
    today: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate ?? null,
    uses: d.specialExcessUses ?? [],
  });
}

const dayOf = (v: ReturnType<typeof buildResumoPeriodView>, date: string): ResumoDetailRow => {
  const r = v.days.find((x) => x.day.date === date);
  assert.ok(r, `linha ${date} presente no detalhamento`);
  return r;
};

const page = src("src/app/(app)/resumo/page.tsx");

/** 4F — fonte da linha compacta (componente único do detalhamento). */
const detalhe = page.slice(page.indexOf("function PeriodDayRow"));
/** Área recolhível do detalhamento (botão + portão do estado). */
const area = page.slice(page.indexOf("const [detailsOpen, setDetailsOpen] = useState(false);"), page.indexOf("function PeriodDayRow"));

/* ── Estrutura recolhível (A–E) ──────────────────────────────────────── */

check("A. detalhamento começa RECOLHIDO por padrão (estado local inicia fechado)", () => {
  assert.ok(area.includes("useState(false)"), "estado inicia em false (recolhido)");
  const openGate = area.indexOf("{detailsOpen && (");
  assert.ok(openGate > -1, "conteúdo condicionado ao estado aberto");
  assert.ok(page.includes("view.days.map((r) => ("), "linhas ficam DENTRO do bloco aberto");
  assert.ok(!page.includes("localStorage"), "estado não é persistido");
});

check("B. tocar no cabeçalho ABRE o detalhamento (botão com handler de toggle)", () => {
  assert.ok(area.includes("<button"), "cabeçalho é um <button> (toca/teclado)");
  assert.ok(area.includes('type="button"'));
  assert.ok(/onClick=\{\(\) => setDetailsOpen\(\(v\) => !v\)\}/.test(area), "mesmo handler alterna aberto/fechado");
});

check("C. tocar novamente FECHA (um único ponto de alternância, sem states paralelos)", () => {
  assert.equal((page.match(/setDetailsOpen\(/g) ?? []).length, 1, "única chamada de setDetailsOpen é o toggle");
  assert.ok(area.includes("useState(false)"), "sem segundo estado que reabra por outro caminho");
});

check("D. um componente de linha por dia (mesma derivação, sem estado compartilhado)", () => {
  assert.ok(page.includes("<PeriodDayRow key={r.day.date} row={r} />"), "um componente por dia");
  assert.ok(!page.includes("useState<Set"), "nenhum estado compartilhado de dias abertos");
});

check("E. botão acessível: aria-expanded + chevron indica aberto/fechado", () => {
  assert.ok(area.includes("aria-expanded={detailsOpen}"), "aria-expanded ligado ao MESMO estado que abre o corpo");
  assert.ok(area.includes("ChevronUp") && area.includes("ChevronDown"), "chevron indica aberto/fechado");
  assert.ok(area.includes("w-full"), "cabeçalho ocupa a largura toda (área de toque)");
});

/* ── Linha compacta (F–L) — MESMA derivação 3F ───────────────────────── */

resetStore();
const v0 = viewOf();

check("F. 25/08 mostra ter 25/08 [Ok] 8h 0min (valores da derivação 3F)", () => {
  const r = dayOf(v0, "2026-08-25");
  assert.equal(resumoEventKind(r.day), "Ok");
  assert.equal(weekdayShort(r.day.date).replace(".", ""), "ter");
  assert.equal(r.day.workedMinutes, 480, "trabalhado 8h");
  assert.equal(r.day.balanceMinutes, 0, "saldo 0");
  // a linha compacta renderiza EXATAMENTE esses campos:
  assert.ok(detalhe.includes("formatMinutes(d.workedMinutes)"), "trabalhado na linha");
  assert.ok(detalhe.includes("fmtSigned(d.balanceMinutes)"), "saldo na linha");
  assert.ok(detalhe.includes("{row.situation !== \"—\" && <Badge tone=\"slate\">{row.situation}</Badge>}"), "situação na linha");
  assert.equal(`${formatMinutes(r.day.workedMinutes)}`, "8h");
  assert.equal(`${r.day.balanceMinutes > 0 ? "+" : ""}${formatMinutes(r.day.balanceMinutes)}`, "0min");
});

check("G. 26/08 mostra qua 26/08 [Jornada abaixo do previsto] 7h -1h", () => {
  const r = dayOf(v0, "2026-08-26");
  assert.equal(resumoEventKind(r.day), "Jornada abaixo do previsto");
  assert.equal(weekdayShort(r.day.date).replace(".", ""), "qua");
  assert.equal(r.day.workedMinutes, 420, "trabalhado 7h");
  assert.equal(r.day.balanceMinutes, -60, "saldo -1h");
  assert.equal(formatMinutes(r.day.balanceMinutes), "-1h");
});

check("H. 4F: jornada e 'no ponto' NÃO são duplicados no Resumo — ficam em Registros (Ver dia)", () => {
  const r = dayOf(v0, "2026-08-26");
  // valores continuam na derivação (nada foi recalculado nem perdido):
  assert.equal(r.day.expectedMinutes, 480, "Jornada 8h na derivação");
  assert.equal(r.day.registrableMinutes, 420, "No ponto 7h na derivação");
  // a linha compacta NÃO renderiza esses campos (Resumo não duplica Registros):
  assert.ok(!detalhe.includes("d.expectedMinutes"), "jornada fora da linha");
  assert.ok(!detalhe.includes("d.registrableMinutes"), "no ponto fora da linha");
  assert.ok(detalhe.includes('href={`/registros?escopo=ciclo&data=${d.date}`'), "CTA Ver dia leva os fatos completos");
});

check("I. 28/08 mostra [10+] gerado +30min (nada importante de [10+] escondido)", () => {
  const r = dayOf(v0, "2026-08-28");
  assert.equal(r.specialGenerated, 30);
  assert.ok(detalhe.includes("[10+] gerado {formatMinutes(row.specialGenerated)}"), "[10+] gerado visível na linha");
  assert.ok(detalhe.includes("text-violet-600"));
});

check("J. 28/08 preserva os detalhes da 3F (10h30 / +2h / no ponto 10h / [10+] 30min)", () => {
  const r = dayOf(v0, "2026-08-28");
  assert.equal(resumoEventKind(r.day), "Acima do limite [10+]");
  assert.equal(r.day.workedMinutes, 630, "Trabalhado 10h30");
  assert.equal(r.day.balanceMinutes, 120, "Saldo regular +2h");
  assert.equal(r.day.registrableMinutes, 600, "No ponto 10h");
  assert.equal(r.specialGenerated, 30, "[10+] gerado 30min");
  assert.ok(resumoFinancialFrozen(r.day) === false, "dia válido: detalhamento financeiro liberado");
});

/* ── [10+] usado + projeção (K, L) — uso de 30min em 26/08 ───────────── */

resetStore();
const created = actions.createSpecialExcessUse({
  destinationDate: "2026-08-26",
  minutes: 30,
  allocationStrategy: "fifo",
  asOfDate: ASOF,
});
assert.ok(created.ok, `criação do uso falhou: ${created.error}`);
const v1 = viewOf();

check("K. dia com [10+] USADO mostra indicação compacta: [10+] usado 30min", () => {
  const r = dayOf(v1, "2026-08-26");
  assert.equal(r.specialUsed, 30);
  assert.equal(r.specialGenerated, 0, "26/08 só recebeu uso, não gerou");
  assert.ok(detalhe.includes("usado {formatMinutes(row.specialUsed)}"), "[10+] usado visível na linha");
  assert.equal(formatMinutes(r.specialUsed), "30min");
});

check("L. mostra a projeção correta (26/08: -30min projetado) — factual NUNCA reescrito", () => {
  const r = dayOf(v1, "2026-08-26");
  assert.ok(resumoProjectionVisible(r), "projeção agregando informação");
  assert.equal(r.projection.appliedSpecialMinutes, 30);
  assert.equal(r.projection.projectedWorkedMinutes, 450, "no ponto projetado 7h30");
  assert.equal(r.projection.projectedBalanceMinutes, -30, "saldo projetado -30min");
  // factual NUNCA é reescrito pela projeção:
  assert.equal(r.day.workedMinutes, 420);
  assert.equal(r.day.balanceMinutes, -60);
  assert.ok(detalhe.includes("showProj &&"), "Projeção só quando agrega informação (regra 3F)");
  assert.ok(detalhe.includes("row.projection.projectedBalanceMinutes"));
});

/* ── Incompleto / estados simples (M–P) ──────────────────────────────── */

resetStore();
const v2 = viewOf();

check("M. 27/08 incompleto: mostra 'Pendente' e NÃO ganha saldo inventado", () => {
  const r = dayOf(v2, "2026-08-27");
  assert.ok(resumoDayPending(r), "dia pendente identificado (regra 3F)");
  assert.ok(resumoFinancialFrozen(r.day), "financeiro congelado");
  assert.equal(r.day.balanceContribution, 0, "sem contribuição ao saldo");
  assert.equal(r.projection.projectable, false, "sem projeção inventada");
  // linha: selo 'Pendente' + valores congelados como "—" (nenhum número inventado):
  assert.ok(detalhe.includes('pendente && <Badge tone="amber">Pendente</Badge>'), "selo compacto 'Pendente'");
  assert.ok(detalhe.includes('frozen ? "—"'), "valores congelados viram — (nunca 0min artificial)");
});

check("N. Folga é linha compacta (sem números como dívida; situação preservada)", () => {
  const r = dayOf(v2, "2026-08-29");
  assert.equal(resumoEventKind(r.day), "Folga");
  assert.ok(resumoFinancialFrozen(r.day) && !resumoDayPending(r), "dia congelado sem pendência");
  // 4F: dia quieto (fim de semana sem fatos) não aparece como linha de apuração;
  // quando aparece (com evento), os valores congelados continuam em "—".
  assert.ok(detalhe.includes('frozen ? "—" : formatMinutes(d.workedMinutes)'), "trabalhado congelado em —");
});

check("O. Sem registro permanece sem dívida inventada", () => {
  const semRegistro = buildResumoDayRow({
    date: "2026-08-26",
    today: "2026-08-29",
    entries: [],
    absences: [],
    calendars: undefined,
    settings: settingsOf(seed.user),
    faltas: [],
    controlStartDate: "2026-08-01",
  });
  assert.equal(resumoEventKind(semRegistro), "Sem registro");
  assert.ok(resumoFinancialFrozen(semRegistro), "congelado → sem valor financeiro");
  assert.equal(semRegistro.balanceContribution, 0, "nenhuma dívida inventada");
});

check("P. futuro vazio permanece compacto (sem dívida e sem campos inventados)", () => {
  const r = dayOf(v2, "2026-09-01");
  assert.equal(resumoEventKind(r.day), "—");
  assert.ok(resumoFinancialFrozen(r.day), "futuro é congelado (—)");
  assert.ok(!resumoDayPending(r));
  assert.equal(r.day.balanceContribution, 0, "nenhum saldo inventado");
});

/* ── Estrutura única + mesma derivação (Q–T) ─────────────────────────── */

check("Q. 4F: UMA lista compacta para desktop e mobile (sem tabela horizontal)", () => {
  assert.ok(!page.includes("<table"), "sem tabela (spec 4F: nunca tabela horizontal)");
  assert.ok(area.includes("view.days.map((r) => ("), "lista mapeia view.days");
});

check("R. linha compacta sem estado e sem accordion próprio", () => {
  assert.ok(!detalhe.includes("useState"), "linha sem estado");
  assert.ok(!detalhe.includes("aria-expanded"), "linha sem accordion");
  assert.ok(!detalhe.includes("<button"), "linha sem botão de expandir (tudo visível)");
});

check("S. MESMA derivação alimenta o detalhamento (view.days; zero fonte paralela)", () => {
  assert.ok(page.includes("<PeriodDayRow key={r.day.date} row={r} />"), "linha recebe a derivação 3F");
  assert.ok(detalhe.includes("{ row }: { row: ResumoDetailRow }"), "item consome ResumoDetailRow");
  assert.ok(!page.includes("specialExcessBook") && !page.includes("buildDebtDays"), "sem engine legado no Resumo");
});

check("T. NENHUM cálculo novo no componente (só formatação dos campos da 3F)", () => {
  assert.ok(!/\bMath\./.test(detalhe), "sem Math.* no item");
  assert.ok(!/\.reduce\(/.test(detalhe), "sem agregação no item");
  assert.ok(!/\+\s*(d|row)\.(worked|balance|expected|registrable|special)/.test(detalhe), "sem aritmética sobre os minutos");
  assert.ok(!/(?<![-\w])(600|480|420|240|630)\b/.test(detalhe), "sem constantes de negócio");
  for (const forbidden of ["maxDailyMinutes", "companyDayContext", "buildResumoDayRow", "summarizeRegularFacts", "projectRealized"]) {
    assert.ok(!detalhe.includes(forbidden), `sem motor de cálculo no item: ${forbidden}`);
  }
  // só formata/formatadores existentes:
  assert.ok(detalhe.includes("formatMinutes(") && detalhe.includes("fmtSigned("));
});

/* ── Responsividade 320–430px (estrutural) ───────────────────────────── */

check("Responsivo. sem scroll horizontal; linha quebra; grid 2×2 nos cards principais", () => {
  assert.ok(!detalhe.includes("overflow-x-auto"), "sem rolagem horizontal no item");
  assert.ok(!detalhe.includes("min-w-["), "sem largura mínima forçada");
  assert.ok(detalhe.includes("flex-wrap"), "badge/números quebram linha em 320px");
  assert.ok(page.includes('grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4'), "cards principais em 2×2 no mobile (4F)");
  assert.ok(area.includes("w-full"), "cabeçalho ocupa a largura toda (área de toque)");
});

/* ── Persistência proibida (estado só local) ─────────────────────────── */

check("Estado local: item não usa store nem persistência (nada em localStorage)", () => {
  assert.ok(!detalhe.includes("actions."), "item não dispara ações do store");
  assert.ok(!detalhe.includes("useAppData"), "item não consome o store");
  assert.ok(!page.includes("localStorage") && !page.includes("sessionStorage"), "sem persistência");
});

console.log(`\n${passed}/22 verificações 3F.1 passaram.`);
if (passed !== 22) process.exit(1);
