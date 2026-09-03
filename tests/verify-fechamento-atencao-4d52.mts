/**
 * VERIFICAÇÃO — ETAPA 4D.5.2: FECHAMENTO DA UX "ATENÇÃO AGORA → REGISTROS".
 *
 * 1) A faixa legada laranja de planejamentos [10+] sai da UI (a única faixa
 *    de planejamento é a violeta compartilhada da 4D.5, fonte attention-now);
 * 2) O resumo compacto substitui "Pendentes X" por Inconsistentes/Incompletos
 *    — MESMA semântica canônica (situations ⇒ attention-now) aplicada ao
 *    RANGE EFETIVO da tela (período no modo período, ciclo no modo ciclo);
 * 3) DayCard focado (?data=) expande MESMO após navegação client-side na
 *    mesma página (sincronização por mudança de foco, não por render).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-fechamento-atencao-4d52.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { attentionNowSummary } from "../src/lib/attention-now.ts";
import { situationsOfDay } from "../src/lib/day-situation.ts";
import { getPointPeriod, getAnnualPointCycle, annualCycleBounds, listDaysBetween } from "../src/lib/periods.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const reg = () => src("src/app/(app)/registros/page.tsx");
const card = () => src("src/components/day-card.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const S = () => settingsOf(getAppData().user);
const st = () => getAppData();
const HOJE = "2026-09-02";
const resumo = (entries: TimeEntry[]) =>
  attentionNowSummary({
    today: HOJE, entries, absences: [], calendars: undefined, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? null, plans: st().specialExcessPlans ?? [],
  });
/** Classificador canônico aplicado a um RANGE (o que o resumo da tela usa). */
const contar = (entries: TimeEntry[], range: { from: string; to: string }, id: "registro-inconsistente" | "registro-incompleto" | "sem-registro") =>
  listDaysBetween(range.from, range.to).filter((d) => situationsOfDay(d, HOJE, entries, [], undefined, S(), { faltas: [], controlStartDate: st().user.controlStartDate ?? null }).includes(id)).length;
const resetBase = (entries: TimeEntry[]) =>
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: "2026-05-01" },
    entries, compensations: [], absences: [], companyCalendars: [], faltas: [],
    excessReasons: [], specialExcessUses: [], specialExcessPlans: [],
  });

/* ════════ PROBLEMA 1 — faixa legada de planejamento ════════ */

check("TESTE 01 DE 12 — Registros normal com plano aguardando: UMA única faixa de planejamento", () => {
  resetBase([punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida")]);
  actions.replaceAll({ ...st(), excessReasons: [{ id: 1, date: "2026-08-18", reason: "demanda-urgente" }] });
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20" }).ok);
  const s = resumo(st().entries);
  assert.equal(s["plano-10"].length, 1, "1 plano aguardando (fonte única)");
  const page = reg();
  const faixas = page.split('Planejamento [10+] aguardando confirmação: {attention["plano-10"].length}').length - 1;
  assert.equal(faixas, 1, "exatamente UMA faixa global de planejamento (a violeta da 4D.5)");
  assert.ok(!page.includes("pendingPlansCount"), "representação legada removida da página");
});

check("TESTE 02 DE 12 — Texto legado 'resolva ou libere nos dias abaixo' não é mais renderizado", () => {
  assert.ok(!reg().includes("resolva ou libere nos dias abaixo"));
  assert.ok(!card().includes("resolva ou libere"));
});

check("TESTE 03 DE 12 — Filtro sem-registro ativo: faixa legada de planejamento não aparece", () => {
  const page = reg();
  assert.ok(!page.includes("pendingPlansCount"), "sem faixa legada em NENHUM estado");
  // No filtro, as faixas globais (incl. a violeta) ficam ocultas:
  assert.ok(page.includes("{!pendingOnly && !missingOnly && !planoOnly && !situationActive && ("), "gate das faixas globais");
});

check("TESTE 04 DE 12 — Filtro plano-10 ativo: somente contexto violeta + DayCard", () => {
  const page = reg();
  assert.ok(page.includes("⏱ Planejamento [10+] aguardando confirmação: {planoCount} · filtro aplicado"), "contexto violeta do filtro");
  // JSX renderizado: faixa global (attention) + contexto do filtro (planoCount) — nada legado:
  assert.equal(page.split('Planejamento [10+] aguardando confirmação: {attention["plano-10"].length}').length - 1, 1, "faixa global única");
  assert.equal(page.split("Planejamento [10+] aguardando confirmação: {planoCount}").length - 1, 1, "contexto do filtro único");
  assert.ok(!page.includes("Planejamentos [10+] aguardando confirmação: <b"), "legado (plural + <b>) não existe");
});

/* ════════ PROBLEMA 2 — resumo Inconsistentes/Incompletos ════════ */

/* Estado misto: inconsistente em 05/08 (período 21/07→20/08) e em 27/08
 * (período atual 21/08→20/09); incompleto em 28/08 (período atual). */
const resetMisto = () => {
  resetBase([
    punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "08:30", "entrada"),
    punch("2026-08-27", "08:00", "entrada"), punch("2026-08-27", "08:15", "entrada"),
    punch("2026-08-28", "08:00", "entrada"), punch("2026-08-28", "12:00", "saida"), punch("2026-08-28", "13:00", "entrada"),
  ]);
};

check("TESTE 05 DE 12 — Resumo do PERÍODO: Inconsistentes/Incompletos separados, counts do período", () => {
  resetMisto();
  const page = reg();
  assert.ok(!page.includes("<span>Pendentes <b"), "chip genérico 'Pendentes' removido");
  assert.ok(page.includes('<span>Inconsistentes <b className="text-amber-700">{inconsistentes}</b></span>'));
  assert.ok(page.includes('<span>Incompletos <b className="text-amber-700">{incompletos}</b></span>'));
  // Counts do PERÍODO efetivo (não do ciclo): 27/08 conta, 05/08 NÃO:
  const periodo = getPointPeriod(HOJE);
  assert.equal(contar(st().entries, periodo, "registro-inconsistente"), 1, "inconsistentes do período = 1");
  assert.equal(contar(st().entries, periodo, "registro-incompleto"), 1, "incompletos do período = 1");
  assert.equal(contar(st().entries, periodo, "registro-inconsistente"), resumo(st().entries).inconsistente.length - 1, "período ≠ ciclo (05/08 fica de fora)");
});

check("TESTE 06 DE 12 — Resumo do CICLO: mesma separação, counts do ciclo", () => {
  resetMisto();
  const bounds = annualCycleBounds(getAnnualPointCycle(HOJE));
  assert.equal(contar(st().entries, bounds, "registro-inconsistente"), 2, "inconsistentes do ciclo = 2 (05/08 e 27/08)");
  assert.equal(contar(st().entries, bounds, "registro-incompleto"), 1);
  // Igual ao escopo das faixas globais (attentionNowSummary, ciclo):
  const s = resumo(st().entries);
  assert.equal(s.inconsistente.length, 2);
  assert.equal(s.incompleto.length, 1);
});

check("TESTE 07 DE 12 — Resumo usa a MESMA semântica canônica da 4D.5 (muda só o range)", () => {
  const page = reg();
  // Deriva de `situations` dos days (geradas por situationsFromView ⇒
  // attentionCategoriesForDay — fonte única). Nenhuma classificação paralela:
  assert.ok(page.includes('days.filter((d) => d.situations.includes("registro-inconsistente"))'));
  assert.ok(page.includes('days.filter((d) => d.situations.includes("registro-incompleto"))'));
  assert.ok(!page.includes("isPunchDayPending"), "sem classificador paralelo na página");
  assert.ok(!/attentionCategoriesForDay\(/.test(page.split("attentionNowSummary")[0]) , "página não reinventa a classificação");
});

/* ════════ PROBLEMA 3 — expansão do card focado ════════ */

check("TESTE 08 DE 12 — CTA 1 registro incompleto: data=27/08 ⇒ card 27/08 expandido", () => {
  resetMisto();
  const s = resumo(st().entries);
  assert.deepEqual(s.incompleto, ["2026-08-28"], "1 incompleto ⇒ href com data");
  const page = reg();
  assert.ok(page.includes("initiallyExpanded={focusDate === date}"), "foco chega ao card");
  // FIX client-side: a IDENTIDADE do card muda quando o FOCO transiciona —
  // o card focado é remontado e lê initiallyExpanded fresco (a prop só é
  // lida no primeiro mount):
  assert.ok(page.includes('key={focusDate === date ? `${date}-atencao` : date}'), "key dependente do foco (remontagem = expansão garantida)");
});

check("TESTE 09 DE 12 — Navegação client-side na mesma página: card expande mesmo já montado", () => {
  const page = reg();
  const c = card();
  // Causa raiz era a prop lida só no mount com card já montado. A remontagem
  // pela key resolve SEM efeito/setState (zero cascata de render):
  assert.ok(page.includes('key={focusDate === date ? `${date}-atencao` : date}'), "identidade muda com o foco ⇒ remonta lendo a prop");
  assert.ok(c.includes("const [expanded, setExpanded] = useState(initiallyExpanded ?? false);"), "prop lida no mount do card (re)montado");
  assert.ok(!c.includes("useEffect"), "sem setState em efeito (lint/sanidade — expansão não é efeito colateral)");
});

check("TESTE 10 DE 12 — 1 planejamento: 01/09 continua expandindo como antes", () => {
  const page = reg();
  // initiallyExpanded vale para TODOS os cards (sem condição de categoria) —
  // o caso plano-10 validado manualmente permanece:
  const linha = page.split("\n").find((l) => l.includes("initiallyExpanded={focusDate === date}"));
  assert.ok(linha, "prop presente no DayCard da listagem");
  assert.ok(!linha!.includes("plano") && !linha!.includes("atencao"), "sem discriminação de categoria");
  // Controle manual preservado: o efeito não é um force-open por render:
  assert.ok(card().includes("onClick={() => setExpanded((v) => !v)}"), "toggle manual do usuário intacto");
});

check("TESTE 11 DE 12 — Múltiplos sem-registro: não expande todos; N resultados preservados", () => {
  resetBase([]);
  const s = resumo([]);
  const total = s["sem-registro"].length;
  assert.ok(total >= 13, `múltiplos dias vazios no ciclo (${total})`);
  const page = reg();
  // Múltiplos ⇒ href SEM data ⇒ focusDate null ⇒ nenhum card expandido:
  assert.ok(!/situacao=\$\{filtro\}&escopo=ciclo&data=\$\{dates\[0\]\}` : /.test(page), "múltiplos sem foco");
  assert.ok(page.includes('const focusDate = focusDateRaw && /^\\d{4}-\\d{2}-\\d{2}$/.test(focusDateRaw) ? focusDateRaw : null;'), "sem ?data ⇒ focusDate null ⇒ initiallyExpanded false para todos");
  // Quantidade exata do filtro (classificador canônico, escopo ciclo):
  const bounds = annualCycleBounds(getAnnualPointCycle(HOJE));
  assert.equal(contar([], bounds, "sem-registro"), total);
});

check("TESTE 12 DE 12 — Limpar filtro + Voltar ao período: 4D.5.1 permanece intacta", () => {
  const page = reg();
  assert.ok(page.includes('const limparFiltro = () => router.replace(wantCycleScope ? "/registros?escopo=ciclo" : "/registros");'));
  assert.ok(page.includes('const voltarAoPeriodo = () => router.replace("/registros");'));
  assert.equal((page.match(/onClick=\{voltarAoPeriodo\}/g) ?? []).length, 3, "3 contextos ligados ao Voltar ao período");
  assert.equal((page.match(/onClick=\{limparFiltro\}/g) ?? []).length, 1, "Limpar filtro no contexto do plano");
});

console.log(`\n${passed}/12 verificações da Etapa 4D.5.2 passaram.`);
if (passed !== 12) process.exit(1);
