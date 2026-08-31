/**
 * VERIFICAÇÃO — ETAPA 3F.1: DETALHAMENTO DIÁRIO RECOLHÍVEL NO MOBILE
 *
 * Escopo: APRESENTAÇÃO mobile (< md) do "Detalhamento diário" do Resumo.
 *   - dias relevantes RECOLHIDOS por padrão; toque abre/fecha (estado 100%
 *     local da interface, um estado por dia, vários abertos simultâneos);
 *   - cabeçalho recolhido identifica o dia (dia da semana, data, situação,
 *     trabalhado/saldo e [10+] gerado/usado — nada importante de [10+]
 *     fica escondido);
 *   - expandido mostra EXATAMENTE os mesmos valores já derivados pela 3F
 *     (ResumoDetailRow) — NENHUM cálculo novo no componente;
 *   - estados simples (Folga / Sem registro / futuro vazio) continuam em
 *     linha única compacta, sem accordion e sem dívida inventada;
 *   - DESKTOP (md+) permanece tabela, sem accordion.
 *
 * Números de referência (seed 4.0, período 21/08/2026 → 20/09/2026, asOf
 * 30/08 — mesmos da 3F):
 *   25/08 ter  [Ok]                        8h    0min
 *   26/08 qua  [Jornada abaixo do prev.]   7h   -1h
 *   27/08 qui  [Registro incompleto]       Pendente (financeiro congelado)
 *   28/08 sex  [Acima do limite [10+]]    10h30  +2h   [10+] +30min
 *   29/08 sáb  [Folga]                     linha compacta
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

/** Fonte do componente mobile 3F.1 (do início até o próximo helper). */
const mobile = page.slice(page.indexOf("function DetailRowMobile"), page.indexOf("function DetailField"));
const desktopBlock = page.slice(page.indexOf('<div className="hidden md:block">'), page.indexOf("{/* MOBILE"));

/* ── Estrutura do accordion mobile (A–E) ─────────────────────────────── */

check("A. dias mobile começam RECOLHIDOS por padrão (estado local inicia fechado)", () => {
  assert.ok(mobile.includes("useState(false)"), "estado do item inicia em false (recolhido)");
  // conteúdo expandido só existe sob o portão do estado:
  const openGate = mobile.indexOf("{open && (");
  assert.ok(openGate > -1, "corpo condicionado ao estado aberto");
  assert.ok(mobile.indexOf('label="Trabalhado"') > openGate, "campos detalhados ficam DENTRO do bloco aberto");
  assert.ok(!page.includes("localStorage"), "estado não é persistido");
});

check("B. tocar no cabeçalho ABRE o dia (cabeçalho é botão com handler de toggle)", () => {
  assert.ok(mobile.includes("<button"), "cabeçalho do dia é um <button> (toca/teclado)");
  assert.ok(mobile.includes('type="button"'));
  assert.ok(/onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/.test(mobile), "mesmo handler alterna aberto/fechado");
});

check("C. tocar novamente FECHA (um único ponto de alternância, sem states paralelos)", () => {
  assert.equal((mobile.match(/setOpen\(/g) ?? []).length, 1, "única chamada de setOpen é o toggle");
  assert.ok(mobile.includes("useState(false)"), "sem segundo estado que reabra por outro caminho");
});

check("D. permite VÁRIOS dias abertos ao mesmo tempo (estado POR dia, não compartilhado)", () => {
  // estado vive DENTRO do componente de UM dia → instâncias independentes
  assert.ok(mobile.includes("const [open, setOpen] = useState(false)"), "estado declarado no item do dia");
  assert.ok(page.includes("{view.days.map((r) => (\n                <DetailRowMobile key={r.day.date} row={r} />"), "um componente por dia");
  assert.ok(!page.includes("useState<Set"), "nenhum estado compartilhado de dias abertos");
});

check("E. botão acessível: aria-expanded + aria-controls + chevron + área de toque", () => {
  assert.ok(mobile.includes("aria-expanded={open}"), "aria-expanded ligado ao MESMO estado que abre o corpo");
  assert.ok(mobile.includes("aria-controls={`resumo-dia-${d.date}-conteudo`}", ), "botão referencia o painel");
  assert.ok(mobile.includes("id={`resumo-dia-${d.date}-conteudo`}", ), "painel com id correspondente");
  assert.ok(mobile.includes("rotate-180") && mobile.includes("open ? \"rotate-180\""), "chevron indica aberto/fechado");
  assert.ok(mobile.includes("min-h-[44px]"), "área de toque confortável");
  assert.ok(mobile.includes("ChevronDown"), "indicador visual (⌄)");
});

/* ── Cabeçalho recolhido (F, G, I, K) — MESMA derivação 3F ───────────── */

resetStore();
const v0 = viewOf();

check("F. 25/08 recolhido mostra ter 25/08 [Ok] 8h 0min (valores da derivação 3F)", () => {
  const r = dayOf(v0, "2026-08-25");
  assert.equal(resumoEventKind(r.day), "Ok");
  assert.equal(weekdayShort(r.day.date).replace(".", ""), "ter");
  assert.equal(r.day.workedMinutes, 480, "trabalhado 8h");
  assert.equal(r.day.balanceMinutes, 0, "saldo 0");
  // o cabeçalho recolhido renderiza EXATAMENTE esses campos:
  const head = mobile.slice(mobile.indexOf("<button"), mobile.indexOf("{open && ("));
  assert.ok(head.includes("formatMinutes(d.workedMinutes)"), "trabalhado no recolhido");
  assert.ok(head.includes("fmtSigned(d.balanceMinutes)"), "saldo no recolhido");
  assert.ok(head.includes("<ResumoEventBadge"), "situação no recolhido");
  assert.equal(`${formatMinutes(r.day.workedMinutes)}`, "8h");
  assert.equal(`${r.day.balanceMinutes > 0 ? "+" : ""}${formatMinutes(r.day.balanceMinutes)}`, "0min");
});

check("G. 26/08 recolhido mostra qua 26/08 [Jornada abaixo do previsto] 7h -1h", () => {
  const r = dayOf(v0, "2026-08-26");
  assert.equal(resumoEventKind(r.day), "Jornada abaixo do previsto");
  assert.equal(weekdayShort(r.day.date).replace(".", ""), "qua");
  assert.equal(r.day.workedMinutes, 420, "trabalhado 7h");
  assert.equal(r.day.balanceMinutes, -60, "saldo -1h");
  assert.equal(formatMinutes(r.day.balanceMinutes), "-1h");
});

check("H. 26/08 EXPANDIDO mostra Trabalhado / Jornada / Saldo regular / No ponto", () => {
  const r = dayOf(v0, "2026-08-26");
  // valores expandidos = mesmos da derivação 3F (nada recalculado):
  assert.equal(r.day.workedMinutes, 420, "Trabalhado 7h");
  assert.equal(r.day.expectedMinutes, 480, "Jornada 8h");
  assert.equal(r.day.balanceMinutes, -60, "Saldo regular -1h");
  assert.equal(r.day.registrableMinutes, 420, "No ponto 7h");
  // o corpo aberto traz exatamente esses campos:
  const body = mobile.slice(mobile.indexOf("{open && ("));
  for (const label of ["Trabalhado", "Jornada", "Saldo regular", "No ponto"]) {
    assert.ok(body.includes(`label="${label}"`), `campo expandido: ${label}`);
  }
  assert.ok(body.includes("d.workedMinutes") && body.includes("d.expectedMinutes") && body.includes("d.balanceMinutes") && body.includes("d.registrableMinutes"));
});

check("I. 28/08 recolhido mostra [10+] gerado +30min (nada importante de [10+] escondido)", () => {
  const r = dayOf(v0, "2026-08-28");
  assert.equal(r.specialGenerated, 30);
  const head = mobile.slice(mobile.indexOf("<button"), mobile.indexOf("{open && ("));
  assert.ok(head.includes("[10+] +{formatMinutes(row.specialGenerated)}"), "[10+] gerado visível no RECOLHIDO");
  assert.ok(head.includes("text-violet-600"));
});

check("J. 28/08 EXPANDIDO preserva os detalhes da 3F (10h30 / +2h / no ponto 10h / [10+] 30min)", () => {
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

check("K. dia com [10+] USADO mostra indicação compacta no recolhido: [10+] usado 30min", () => {
  const r = dayOf(v1, "2026-08-26");
  assert.equal(r.specialUsed, 30);
  assert.equal(r.specialGenerated, 0, "26/08 só recebeu uso, não gerou");
  const head = mobile.slice(mobile.indexOf("<button"), mobile.indexOf("{open && ("));
  assert.ok(head.includes("[10+] usado {formatMinutes(row.specialUsed)}"), "[10+] usado visível no RECOLHIDO");
  assert.equal(formatMinutes(r.specialUsed), "30min");
});

check("L. EXPANDIDO mostra a projeção correta (26/08: 7h30 no ponto / -30min projetado)", () => {
  const r = dayOf(v1, "2026-08-26");
  assert.ok(resumoProjectionVisible(r), "projeção agregando informação");
  assert.equal(r.projection.appliedSpecialMinutes, 30);
  assert.equal(r.projection.projectedWorkedMinutes, 450, "no ponto projetado 7h30");
  assert.equal(r.projection.projectedBalanceMinutes, -30, "saldo projetado -30min");
  // factual NUNCA é reescrito pela projeção:
  assert.equal(r.day.workedMinutes, 420);
  assert.equal(r.day.balanceMinutes, -60);
  const body = mobile.slice(mobile.indexOf("{open && ("));
  assert.ok(body.includes("showProj &&"), "Projeção só quando agrega informação (regra 3F)");
  assert.ok(body.includes("label=\"Projeção\""));
  assert.ok(body.includes("row.projection.projectedWorkedMinutes") && body.includes("row.projection.projectedBalanceMinutes"));
});

/* ── Incompleto / estados simples (M–P) ──────────────────────────────── */

resetStore();
const v2 = viewOf();

check("M. 27/08 incompleto: recolhido mostra 'Pendente' e expandido NÃO ganha saldo inventado", () => {
  const r = dayOf(v2, "2026-08-27");
  assert.ok(resumoDayPending(r), "dia pendente identificado (regra 3F)");
  assert.ok(resumoFinancialFrozen(r.day), "financeiro congelado");
  assert.equal(r.day.balanceContribution, 0, "sem contribuição ao saldo");
  assert.equal(r.projection.projectable, false, "sem projeção inventada");
  // recolhido: apenas 'Pendente' (sem números no ramo do pendente)
  const head = mobile.slice(mobile.indexOf("<button"), mobile.indexOf("{open && ("));
  const headPending = head.slice(head.indexOf("{pending ? ("), head.indexOf(") : ("));
  assert.ok(headPending.includes(">Pendente</span>"), "selo compacto 'Pendente' no recolhido");
  assert.ok(!headPending.includes("fmtSigned(") && !headPending.includes("formatMinutes("), "nenhum número no cabeçalho do pendente");
  // expandido: mensagem consolidada, sem campos financeiros
  const openBlock = mobile.slice(mobile.indexOf("{open && ("));
  const pendingBody = openBlock.slice(openBlock.indexOf("{pending ? ("), openBlock.indexOf(") : !frozen ? ("));
  assert.ok(pendingBody.includes("Registro pendente. Os valores financeiros serão definidos após a correção."), "mensagem consolidada");
  assert.ok(!pendingBody.includes("label=") && !pendingBody.includes("<dl"), "nenhum campo financeiro no pendente");
});

check("N. Folga permanece linha compacta (sem accordion, sem traços)", () => {
  const r = dayOf(v2, "2026-08-29");
  assert.equal(resumoEventKind(r.day), "Folga");
  assert.ok(resumoFinancialFrozen(r.day) && !resumoDayPending(r), "cai na linha compacta");
  // a linha compacta vem ANTES do accordion e não tem botão/chevron/aria:
  const simpleIdx = mobile.indexOf("if (frozen && !pending)");
  const buttonIdx = mobile.indexOf("<button");
  assert.ok(simpleIdx > -1 && buttonIdx > simpleIdx, "retorno compacto precede o accordion");
  const simple = mobile.slice(simpleIdx, buttonIdx);
  assert.ok(!simple.includes("<button") && !simple.includes("aria-") && !simple.includes("Chevron"), "compacta: sem botão, sem aria, sem chevron");
  assert.ok(simple.includes("<ResumoEventBadge"), "mantém a situação [Folga]");
});

check("O. Sem registro permanece compacto e sem dívida inventada", () => {
  // dia ÚTIL passado sem nenhum registro/justificativa → 'Sem registro':
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
  assert.ok(resumoFinancialFrozen(semRegistro), "congelado → linha compacta (sem accordion)");
  assert.equal(semRegistro.balanceContribution, 0, "nenhuma dívida inventada");
});

check("P. futuro vazio permanece compacto (sem dívida e sem campos inventados)", () => {
  const r = dayOf(v2, "2026-09-01");
  assert.equal(resumoEventKind(r.day), "—");
  assert.ok(resumoFinancialFrozen(r.day), "futuro é congelado (—)");
  assert.ok(!resumoDayPending(r));
  assert.equal(r.day.balanceContribution, 0, "nenhum saldo inventado");
});

/* ── Desktop inalterado + mesma derivação (Q–T) ──────────────────────── */

check("Q. desktop continua TABELA (md+), sem alterações de estrutura", () => {
  assert.ok(page.includes('<div className="hidden md:block">'), "tabela em md+");
  assert.ok(page.includes('<table className="w-full text-sm">'));
  assert.ok(page.includes("Projeção**</th>") && page.includes(">[10+]</th>"), "colunas históricas preservadas");
});

check("R. desktop NÃO ganha accordion (nenhum botão/aria dentro do bloco da tabela)", () => {
  assert.ok(!desktopBlock.includes("<button"), "tabela sem botões");
  assert.ok(!desktopBlock.includes("aria-expanded"), "tabela sem accordion");
  const rowDesktop = page.slice(page.indexOf("function DetailRowDesktop"), page.indexOf("function DetailRowMobile"));
  assert.ok(!rowDesktop.includes("aria-expanded") && !rowDesktop.includes("<button"), "linha desktop sem accordion");
  assert.ok(!rowDesktop.includes("useState"), "linha desktop sem estado");
});

check("S. MESMA derivação alimenta desktop e mobile (view.days; zero fonte paralela)", () => {
  // tabela desktop E lista mobile mapeiam a MESMA view.days (3F):
  const mobileList = page.slice(page.indexOf('<ul className="divide-y divide-slate-100 md:hidden">'), page.indexOf("mt-2 text-[11px] text-slate-400"));
  assert.ok(desktopBlock.includes("view.days.map"), "tabela mapeia view.days");
  assert.ok(mobileList.includes("view.days.map"), "lista mobile mapeia view.days");
  assert.ok(page.includes("<DetailRowMobile key={r.day.date} row={r} />"), "mobile recebe a linha da derivação 3F");
  assert.ok(mobile.includes("row: { row: ResumoDetailRow }") || mobile.includes("{ row }: { row: ResumoDetailRow }"), "item consome ResumoDetailRow");
  assert.ok(!page.includes("specialExcessBook") && !page.includes("buildDebtDays"), "sem engine legado no Resumo");
});

check("T. NENHUM cálculo novo no componente mobile (só formatação dos campos da 3F)", () => {
  assert.ok(!/\bMath\./.test(mobile), "sem Math.* no item mobile");
  assert.ok(!/\.reduce\(/.test(mobile), "sem agregação no item mobile");
  assert.ok(!/\+\s*(d|row)\.(worked|balance|expected|registrable|special)/.test(mobile), "sem aritmética sobre os minutos");
  assert.ok(!/(?<![-\w])(600|480|420|240|630)\b/.test(mobile.replace(/min-h-\[44px\]/, "").replace(/-\[44px\]/g, "")), "sem constantes de negócio");
  for (const forbidden of ["maxDailyMinutes", "companyDayContext", "buildResumoDayRow", "summarizeRegularFacts", "projectRealized"]) {
    assert.ok(!mobile.includes(forbidden), `sem motor de cálculo no item: ${forbidden}`);
  }
  // só formata/formatadores existentes:
  assert.ok(mobile.includes("formatMinutes(") && mobile.includes("fmtSigned("));
});

/* ── Responsividade 320–430px (estrutural) ───────────────────────────── */

check("Responsivo. mobile < md sem scroll horizontal; cabeçalho quebra linha; grid 2 colunas", () => {
  assert.ok(page.includes('<ul className="divide-y divide-slate-100 md:hidden">'), "lista mobile só abaixo de md");
  assert.ok(!mobile.includes("overflow-x-auto"), "sem rolagem horizontal no item");
  assert.ok(!mobile.includes("min-w-["), "sem largura mínima forçada");
  assert.ok(mobile.includes("flex-wrap"), "badge/números quebram linha em 320px");
  assert.ok(mobile.includes("grid-cols-2"), "detalhes expandidos em grid compacto");
  assert.ok(mobile.includes("w-full"), "cabeçalho ocupa a largura toda (área de toque)");
});

/* ── Persistência proibida (estado só local) ─────────────────────────── */

check("Estado local: item não usa store nem persistência (nada em localStorage)", () => {
  assert.ok(!mobile.includes("actions."), "item não dispara ações do store");
  assert.ok(!mobile.includes("useAppData"), "item não consome o store");
  assert.ok(!mobile.includes("localStorage") && !mobile.includes("sessionStorage"), "sem persistência");
});

console.log(`\n${passed}/22 verificações 3F.1 passaram.`);
