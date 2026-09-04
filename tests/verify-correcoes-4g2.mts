/**
 * VERIFICAÇÃO — ETAPA 4G.2: CORREÇÕES FINAIS PÓS-VALIDAÇÃO DA CONSOLIDAÇÃO.
 *
 * Correções cobertas:
 *   1. "Cancelar uso de [10+]" NÃO aparece em destino consolidado (UI de
 *      leitura completa: minutos/origem/seleção/projeção/rastreabilidade
 *      continuam visíveis; guard do store intocado);
 *   1b. AUDITORIA: "Cancelar reserva"/"Liberar reserva" também saem do
 *       consolidado (controle mutável residual encontrado e corrigido);
 *   2. Navegador do período MOBILE: linha 1 = só navegação ([‹][21/07 → 20/08][›]);
 *      linha 2 = contexto (passado/atual/futuro + Ir para o período atual);
 *      desktop preservado; 320/360/412 sem overflow horizontal;
 *   3. Histórico de consolidações com TOGGLE completo (Ver/Ocultar + chevron;
 *      recolhido por padrão; estado só visual/local);
 *   4. RECONSOLIDAÇÃO com linguagem de nova revisão ("Consolidar novamente" +
 *      "Uma nova revisão será criada e a anterior permanecerá no histórico.");
 *   5. Registros reorganizado: navegação → filtros → banner → faixa-resumo →
 *      AÇÕES DO PERÍODO → atenções → dias;
 *   6. "Registrar falta" em Registros com a MESMA cor amarelo/laranja do
 *      "Registro de hoje" (variant=warning); Lançamento manual verde;
 *   7. "Abrir Resumo" preserva o período exibido (?data= + getPointPeriod —
 *      sem hardcode, sem segunda matemática 21→20);
 *   8. auditoria de links diretos (data=/escopo=ciclo preservados).
 *
 * Fixture (a MESMA da 4G/4G.1; HOJE (asOf) = 2026-08-25 ⇒ período
 * 21/07→20/08 ENCERRADO e consolidável):
 *   factual −30 · projeção +30 · [10+] usado 60 (origens 20/07)
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-correcoes-4g2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildResumoPeriodView, resumoPeriodPendencies } from "../src/lib/resumo-period-view.ts";
import {
  activeConsolidationForPeriod,
  consolidationLockForDate,
  periodConsolidationState,
} from "../src/lib/period-consolidation.ts";
import {
  PERIOD_CONTEXT_LABEL,
  getPointPeriod,
  pointPeriodContext,
  type PointPeriod,
} from "../src/lib/periods.ts";
import { buildBackupPayload, parseBackup, BACKUP_COLLECTIONS } from "../src/lib/backup.ts";
import type { TimeEntry, Falta } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = () => src("src/app/(app)/resumo/page.tsx");
const registros = () => src("src/app/(app)/registros/page.tsx");
const dayCard = () => src("src/components/day-card.tsx");
const navigator = () => src("src/components/period-navigator.tsx");
const useSummary = () => src("src/components/special-excess-use-summary.tsx");
const planSummary = () => src("src/components/special-excess-plan-summary.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixture 4G (idêntica à 4G/4G.1) ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const HOJE = "2026-08-25";
const PERIOD: PointPeriod = { from: "2026-07-21", to: "2026-08-20" };
const CALENDARIO = [
  {
    id: 1, cycleStart: "2026-05-01", cycleEnd: "2027-04-30", cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
    entries: [
      { id: 1, date: "2026-07-28", descricao: "Compensado", categoria: "Compensação 8 Horas", tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null },
      { id: 2, date: "2026-08-10", descricao: "Feriado", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null },
    ],
  },
];
const diaNeutro = (date: string): TimeEntry[] => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, "17:00", "saida"),
];
const CAUDA = ["2026-07-21", "2026-07-22", "2026-07-23", "2026-08-06", "2026-08-07", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
const batidasLimpo = () => [
  punch("2026-07-20", "07:00", "entrada"), punch("2026-07-20", "19:40", "saida"),
  punch("2026-07-24", "05:00", "entrada"), punch("2026-07-24", "09:00", "saida"), punch("2026-07-24", "10:00", "entrada"), punch("2026-07-24", "14:10", "saida"),
  ...diaNeutro("2026-07-27"), ...diaNeutro("2026-07-28"), ...diaNeutro("2026-07-30"),
  punch("2026-07-29", "05:00", "entrada"), punch("2026-07-29", "09:00", "saida"), punch("2026-07-29", "10:00", "entrada"), punch("2026-07-29", "12:20", "saida"),
  punch("2026-07-31", "08:00", "entrada"), punch("2026-07-31", "19:30", "saida"),
  punch("2026-08-03", "05:00", "entrada"), punch("2026-08-03", "09:00", "saida"), punch("2026-08-03", "10:00", "entrada"), punch("2026-08-03", "13:30", "saida"),
  punch("2026-08-04", "05:00", "entrada"), punch("2026-08-04", "09:00", "saida"), punch("2026-08-04", "10:00", "entrada"), punch("2026-08-04", "13:30", "saida"),
  ...diaNeutro("2026-08-05"),
].concat(CAUDA.flatMap(diaNeutro));
const reset = () => {
  nextId = 1;
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: "2026-05-01" },
    entries: batidasLimpo(),
    compensations: [], absences: [], faltas: [] as Falta[],
    companyCalendars: CALENDARIO,
    excessReasons: [
      { id: 1, date: "2026-07-20", reason: "demanda-urgente", customReason: null, observation: null, createdAt: 1722000000000, updatedAt: 1722000000000 },
      { id: 2, date: "2026-07-31", reason: "demanda-urgente", customReason: null, observation: null, createdAt: 1722000000000, updatedAt: 1722000000000 },
    ],
    specialExcessUses: [], specialExcessPlans: [],
  });
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-03", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-03" }).ok, "uso 03/08");
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-04", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-04" }).ok, "uso 04/08");
};
const st = () => getAppData();
const S = () => settingsOf(st().user);
const pend = () =>
  resumoPeriodPendencies({
    today: HOJE, period: PERIOD, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01", plans: st().specialExcessPlans ?? [],
  });
/** Consolida R1 (fixture limpa) e devolve a revisão ativa. */
const consolidarR1 = () => {
  reset();
  const r = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727300000000 });
  assert.ok(r.ok, `consolidação R1: ${!r.ok ? r.error : ""}`);
  return activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to)!;
};

/* ════════ CORREÇÃO 1 — "CANCELAR USO DE [10+]" FORA DO CONSOLIDADO ════════ */

check("TESTE 01 DE 18 — DayCard consolidado NÃO renderiza 'Cancelar uso de [10+]'", () => {
  const us = useSummary();
  // o botão de cancelamento (código JSX renderizável) existe UMA vez e está
  // cercado por !readOnly:
  assert.equal(us.split("onClick={() => setCancelTarget(u)}").length - 1, 1, "um único handler de cancelamento");
  assert.equal(us.split("{!readOnly && (").length - 1, 1, "um único gate de somente leitura");
  const gate = us.split("{!readOnly && (")[1];
  assert.ok(gate.includes("Cancelar uso de [10+]") && gate.includes("</Button>"), "o gate envolve o botão");
  assert.ok(gate.indexOf("Cancelar uso de [10+]") < gate.indexOf("</Button>"), "gate fecha depois do botão");
  // DayCard passa a prop DERIVADA do lock canônico (ro = consolidação ACTIVE):
  const dc = dayCard();
  assert.ok(dc.includes("readOnly={ro}"), "DayCard transmite somente leitura");
  const rs = registros();
  assert.ok(rs.includes("consolidated={consolidationLockForDate(periodConsolidations, date) !== null}"),
    "Registros deriva consolidated do lock por data (intacto)");
});

check("TESTE 02 DE 18 — Uso [10+] em consolidado mantém minutos/origem/seleção/projeção/rastreabilidade", () => {
  const us = useSummary();
  // NADA do bloco informativo foi escondido — a informação continua FORA de
  // qualquer gate de readOnly:
  assert.ok(us.includes("[10+] utilizado: <b className=\"tabular-nums\">{formatMinutes(view.usedActiveMinutes)}</b>"),
    "minutos utilizados visíveis");
  assert.ok(us.includes("Origens"), "origens visíveis");
  assert.ok(us.includes("u.allocations.map"), "allocations por origem visíveis (rastreabilidade)");
  assert.ok(us.includes('u.allocationStrategy === "fifo" ? "Seleção automática" : "Origem escolhida manualmente"'),
    "seleção automática/manual visível");
  assert.ok(us.includes("Projeção no ponto:"), "projeção visível");
  assert.ok(us.includes("Uso {i + 1} — {formatMinutes(m)}"), "detalhe por uso visível");
  // o gate de readOnly contém SOMENTE o botão (nenhuma informação dentro):
  const gate = us.split("{!readOnly && (")[1] ?? "";
  const gateBody = gate.split("\n                )}")[0];
  assert.ok(!gateBody.includes("Origens") && !gateBody.includes("Projeção"), "nenhuma informação dentro do gate");
  // o modal de confirmação permanece (usado fora de consolidado) e o doCancel
  // ganhou defesa extra readOnly:
  assert.ok(us.includes("title=\"Cancelar uso de [10+]\""), "modal de cancelamento preservado para fora do consolidado");
  assert.ok(us.includes("if (readOnly || !cancelTarget || busy) return;"), "doCancel bloqueado em readOnly (defesa extra)");
});

check("TESTE 03 DE 18 — Demais controles mutáveis conhecidos continuam ausentes no consolidado (auditoria [10+])", () => {
  const dc = dayCard();
  // gates 4G.1 preservados:
  assert.ok(dc.includes("!ro && !missingExpected && !historicalEmpty && !incompletePast && !inconsistent && ("),
    "Adicionar batida/Registrar intervalo sob !ro");
  assert.ok(dc.includes("{punchModal && !ro && ("), "modal mutável nunca abre do card consolidado");
  assert.ok(dc.includes("onOpen={!ro && specialExcess.canComplete && onCompleteJornada"), "Completar jornada com [10+] sob !ro");
  assert.ok(dc.includes("onResolvePlan={ro ? undefined : onResolvePlan}"), "Usar planejamento off");
  assert.ok(dc.includes("onPlan={ro ? undefined : onPlanSpecial}"), "Planejar mais off");
  assert.ok(dc.includes("{futureDay && !ro && onPlanSpecial &&"), "bloco 'Planejar uso de [10+]' sob !ro");
  assert.ok(dc.includes("{d.open && isToday && !punchPending && !ro && ("), "SmartExit sob !ro");
  assert.ok(dc.includes("{!futureDay && !abonoDay && !ro && ("), "editar intervalo sob !ro");
  // AUDITORIA 4G.2: "Cancelar reserva"/"Liberar reserva" era controle mutável
  // residual visível em consolidado — agora também cercado:
  const ps = planSummary();
  assert.ok(ps.includes("readOnly?: boolean"), "plan-summary com prop readOnly");
  assert.equal(ps.split("{!readOnly && (").length - 1, 1, "um único gate no plan-summary");
  const gatePlano = ps.split("{!readOnly && (")[1] ?? "";
  assert.ok(gatePlano.includes("setCancelTarget(p)") && gatePlano.includes("{cancelLabel}") && gatePlano.includes("</Button>"),
    "Cancelar reserva sob gate");
  assert.ok(ps.includes("if (readOnly || !cancelTarget || busy) return;"), "doCancel de reserva bloqueado em readOnly");
  assert.ok(dc.split("readOnly={ro}").length - 1 >= 2, "DayCard passa readOnly aos DOIS resumos [10+]");
  // cancelamento de falta continua sob !ro:
  assert.ok(dc.includes("{!ro && (\n                <div className=\"mt-2\">"), "Cancelar/Excluir falta sob !ro");
});

check("TESTE 04 DE 18 — Store continua recusando cancelamento de uso protegido (guard intocado)", () => {
  consolidarR1();
  // destino DENTRO do consolidado (03/08 ∈ 21/07→20/08):
  const uso = st().specialExcessUses!.find((u) => u.destinationDate === "2026-08-03")!;
  assert.equal(uso.status, "utilizado");
  const r = actions.cancelSpecialExcessUse({ id: uso.id });
  assert.ok(!r.ok, "cancelamento recusado");
  assert.equal(r.error, "Uso protegido por período consolidado.");
  assert.equal((st().specialExcessUses ?? []).find((u) => u.id === uso.id)!.status, "utilizado", "uso segue ativo");
  // FORA do consolidado o uso segue plenamente utilizável/cancelável
  // (o guard é por DESTINO, nunca geral): dia com déficit no período ATUAL.
  for (const [t, ty] of [["05:00", "entrada"], ["09:00", "saida"], ["10:00", "entrada"], ["13:30", "saida"]] as const) {
    assert.ok(actions.addEntry({ date: "2026-08-21", time: t, type: ty }).ok, `batida 21/08 ${t}`);
  }
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-21", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE }).ok,
    "uso com destino FORA do consolidado criado");
  const usoFora = st().specialExcessUses!.find((u) => u.destinationDate === "2026-08-21")!;
  const rFora = actions.cancelSpecialExcessUse({ id: usoFora.id });
  assert.ok(rFora.ok, "uso fora do consolidado segue cancelável");
  // e o uso protegido permanece "utilizado" no estado (nada mudou):
  assert.equal((st().specialExcessUses ?? []).find((u) => u.id === uso.id)!.status, "utilizado");
});

/* ════════ CORREÇÃO 2 — NAVEGADOR MOBILE (320/360/412) ════════ */

check("TESTE 05 DE 18 — Mobile: navegação em linha PRÓPRIA, separada do contexto", () => {
  const nav = navigator();
  // 4G.2.1 — estrutura SEM duplicação: container flex-wrap ÚNICO; o sub-bloco
  // de navegação ocupa a linha inteira no mobile (w-full) e libera contexto/
  // ação para a linha 2; no desktop (sm:w-auto sm:flex-nowrap) tudo volta à
  // linha única validada:
  assert.ok(nav.includes('className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap"'),
    "container único com wrap (linha 1 navegação / linha 2 contexto no mobile)");
  assert.ok(nav.includes('<div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">'),
    "navegação ocupa a linha inteira no mobile (w-full ⇒ contexto quebra p/ linha 2)");
  // LINHA 1 contém SOMENTE [‹][rótulo][›]:
  const linha1 = nav.split("{/* LINHA 1")[1]?.split("{/* CONTEXTO")[0] ?? "";
  assert.ok(linha1.includes('aria-label="Período anterior"') && linha1.includes('aria-label="Próximo período"'),
    "linha 1 = navegação");
  assert.ok(!linha1.includes("contextLabel") && !linha1.includes("onBackToCurrent"),
    "nenhum contexto/ação na linha 1");
  // 4G.2.1 — PROVA DE UNICIDADE: exatamente UM site JSX de contexto e UM de
  // retorno; NENHUM bloco equivalente escondido por utilitário responsivo:
  assert.equal(nav.split("{contextLabel && (").length - 1, 1, "contexto renderizado por UM ÚNICO bloco JSX");
  assert.equal(nav.split("{onBackToCurrent && (").length - 1, 1, "retorno renderizado por UM ÚNICO bloco JSX");
  assert.ok(!nav.includes("sm:hidden\">") || !nav.split("sm:hidden\">")[1]?.includes("contextLabel"),
    "sem bloco mobile duplicado de contexto");
  assert.ok(!nav.includes('hidden shrink-0 sm:inline-flex'), "sem cópia desktop escondida por hidden (causa da duplicação 4G.2)");
});

check("TESTE 06 DE 18 — Mobile: intervalo não quebra internamente e as setas não encolhem", () => {
  const nav = navigator();
  // datas em UMA linha, sem wrap interno; centro ocupa o restante; zero scroll:
  assert.ok(nav.includes("min-w-0 flex-1 overflow-hidden whitespace-nowrap rounded-xl border border-slate-300"),
    "box do período: flex-1 (centro ocupa o restante) + nowrap + overflow-hidden");
  // setas NUNCA encolhem:
  const linha1 = nav.split("{/* LINHA 1")[1]?.split("{/* CONTEXTO")[0] ?? "";
  assert.equal(linha1.split('className="shrink-0"').length - 1, 2, "duas setas shrink-0 (não encolhem)");
  // rótulos curto/completo preservados (mobile/desktop):
  assert.ok(nav.includes("<span className=\"sm:hidden\" title={fullLabel}>{shortLabel}</span>"), "mobile: rótulo curto");
  assert.ok(nav.includes("<span className=\"hidden sm:inline\">{fullLabel}</span>"), "desktop: rótulo completo");
});

check("TESTE 07 DE 18 — 'Período passado' ocorre UMA ÚNICA VEZ (4G.2.1)", () => {
  const nav = navigator();
  // UNICIDADE: um único badge renderiza o contexto — 'Período passado' é o
  // valor de PERIOD_CONTEXT_LABEL.past passado pelas páginas, e o componente
  // não tem NENHUMA segunda cópia (mobile/desktop):
  assert.equal(nav.split("<Badge tone=\"slate\"").length - 1, 1, "um único <Badge> de contexto no componente");
  assert.equal(nav.split("contextLabel &&").length - 1, 1, "um único gate de contexto");
  assert.ok(nav.split("{/* LINHA 1")[1]?.split("{/* CONTEXTO")[0] && !nav.split("{/* LINHA 1")[1]!.split("{/* CONTEXTO")[0].includes("Badge"),
    "badge fora da linha principal (fica na linha 2 via wrap)");
  // classificação canônica intacta (derivada em periods.ts):
  reset();
  const atual = getPointPeriod(HOJE);
  const passado = PERIOD;
  assert.equal(pointPeriodContext(passado, atual), "past");
  assert.equal(PERIOD_CONTEXT_LABEL.past, "Período passado");
  // páginas continuam passando a MESMA fonte única (uma vez cada):
  assert.ok(registros().includes("contextLabel={query || wantCycleScope ? undefined : PERIOD_CONTEXT_LABEL[contextoPeriodo]}"));
  assert.ok(page().includes("contextLabel={PERIOD_CONTEXT_LABEL[contextoPeriodo]}"));
  assert.equal(registros().split("contextLabel={").length - 1, 1, "Registros passa o contexto UMA vez");
  assert.equal(page().split("contextLabel={").length - 1, 1, "Resumo passa o contexto UMA vez");
});

check("TESTE 08 DE 18 — 'Período futuro' ocorre UMA ÚNICA VEZ (mesmo canal único)", () => {
  reset();
  const atual = getPointPeriod(HOJE);
  const futuro: PointPeriod = { from: "2026-09-21", to: "2026-10-20" };
  assert.equal(pointPeriodContext(futuro, atual), "future");
  assert.equal(PERIOD_CONTEXT_LABEL.future, "Período futuro");
  // passado OU futuro passam pelo MESMO (único) canal de contexto:
  const nav = navigator();
  assert.equal(nav.split("{contextLabel && (").length - 1, 1, "um único canal para passado/futuro");
  assert.ok(nav.includes("<Badge tone=\"slate\" className=\"shrink-0\">"), "badge único com shrink-0");
});

check("TESTE 09 DE 18 — ATUAL: 'Período atual' único e SEM botão de retorno", () => {
  const nav = navigator();
  // UM ÚNICO botão de retorno no componente (4G.2.1 — antes eram 2 cópias):
  assert.equal(nav.split('aria-label="Ir para o período atual"').length - 1, 1,
    "'Ir para o período atual' existe UMA única vez");
  assert.ok(nav.includes("{onBackToCurrent && ("), "botão condicionado à ação");
  // páginas passam undefined no período atual ⇒ NENHUM botão de retorno:
  assert.ok(page().includes("onBackToCurrent={viewingCurrentPeriod ? undefined : () => setPeriod(currentPeriod)}"),
    "Resumo: sem botão no período atual");
  reset();
  const atual = getPointPeriod(HOJE);
  assert.equal(pointPeriodContext(atual, atual), "current");
  assert.equal(PERIOD_CONTEXT_LABEL.current, "Período atual");
});

check("TESTE 10 DE 18 — 320/360/412 sem overflow horizontal estrutural; desktop preservado", () => {
  const nav = navigator();
  // corrente anti-overflow completa (mobile):
  assert.ok(nav.includes("flex w-full min-w-0 flex-wrap"), "container w-full + min-w-0 + wrap (linha 2 independente)");
  assert.ok(nav.includes('<div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">'), "linha 1: w-full + min-w-0");
  assert.ok(nav.includes("min-w-0 flex-1 overflow-hidden whitespace-nowrap"), "centro: flex-1 + min-w-0 + nowrap + clip");
  // ORÇAMENTO DE LARGURA (320px, pior caso, sem hardcode de datas):
  //   padding da página ≈ 32px ⇒ 288px úteis;
  //   setas 2×(~40px, shrink-0) + gaps 2×8px ≈ 96px;
  //   box do período ≈ 192px − px-3 (24px) ≈ 168px de texto;
  //   rótulo curto "21/07 → 20/08" = 13 glifos @ ~8px ≈ 104px < 168px ✔
  //   (períodos especiais "21/04 → 30/04" são ainda mais curtos; com overflow
  //   improvável, overflow-hidden corta — NUNCA gera scroll horizontal;
  //   na linha 2, badge+ação quebram ENTRE SI quando não couberem).
  const linha1 = nav.split("{/* LINHA 1")[1]?.split("{/* CONTEXTO")[0] ?? "";
  assert.ok(!linha1.includes("min-w-[") && !linha1.includes("w-["), "nenhuma largura fixa na linha 1");
  assert.equal(linha1.split('className="shrink-0"').length - 1, 2, "setas fora do cálculo flex (shrink-0)");
  // DESKTOP PRESERVADO (4G.2.1): sm:w-auto + sm:flex-nowrap ⇒ MESMA linha
  // única validada (navegação + badge + ação lado a lado):
  assert.ok(nav.includes("sm:w-auto sm:flex-nowrap"), "desktop: linha única sem wrap");
  assert.ok(nav.includes("sm:w-auto sm:flex-none"), "navegação volta a dividir a linha no desktop");
  assert.ok(nav.includes('<span className="hidden sm:inline">{fullLabel}</span>'), "desktop: rótulo completo");
});

/* ════════ CORREÇÃO 3 — HISTÓRICO COM TOGGLE COMPLETO ════════ */

check("TESTE 11 DE 18 — Histórico FECHADO mostra 'Ver histórico' (recolhido por padrão)", () => {
  const p = page();
  // recolhido por padrão, estado local (nunca persistido):
  assert.ok(p.includes("const [histOpen, setHistOpen] = useState(false);"), "recolhido por padrão (useState local)");
  assert.ok(!p.includes("localStorage"), "nada persistido");
  // título fixo + botão de abrir nos DOIS pontos de entrada:
  assert.equal(p.split("Histórico de consolidações").length - 1 >= 2, true, "título presente (linha própria + card)");
  const ternarios = p.split("{histOpen ? \"Ocultar histórico\" : \"Ver histórico\"}").length - 1;
  assert.equal(ternarios, 2, "banner consolidado E linha permanente usam o MESMO toggle");
  // linha permanente existe sempre que há revisões sem ACTIVE (4G.1 preservado):
  assert.ok(p.includes("revisoesDoPeriodo.length > 0 && !consolidacaoAtiva && ("),
    "linha 'Histórico de consolidações' acessível sem revisão ACTIVE");
  assert.ok(p.includes('<p className="text-sm font-bold text-slate-700">Histórico de consolidações</p>'),
    "título fixo da linha");
});

check("TESTE 12 DE 18 — Histórico ABERTO mostra 'Ocultar histórico' e recolhe ao clicar", () => {
  const p = page();
  // toggle real nos dois pontos de entrada (mesma ação):
  assert.equal(p.split("onClick={() => setHistOpen((v) => !v)}").length - 1, 2,
    "banner consolidado E linha permanente alternam abrir/recolher");
  // conteúdo do histórico só quando aberto; recolher remove:
  assert.ok(p.includes("{revisoesDoPeriodo.length > 0 && histOpen &&("), "card do histórico controlado por histOpen");
  // chevron indica o estado:
  assert.ok(p.includes("{histOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}"),
    "chevron no botão do histórico");
  // R1/R2 intocadas — o toggle é SOMENTE visual:
  consolidarR1();
  const antes = JSON.stringify(st().periodConsolidations);
  assert.equal(antes.includes('"revision":1'), true, "R1 existe");
  // (nenhuma action de toggle no store: setHistOpen é estado de componente)
  assert.ok(!src("src/lib/store.ts").includes("histOpen"), "store não conhece o estado visual do histórico");
});

/* ════════ CORREÇÃO 4 — LINGUAGEM DE NOVA REVISÃO ════════ */

check("TESTE 13 DE 18 — PRIMEIRA consolidação mantém 'Consolidar período'", () => {
  const p = page();
  // CTA do estado "pronto para consolidar" inalterado:
  assert.ok(p.includes('estadoPeriodo === "pronto-para-consolidar" && (\n          <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={() => setConsolidarOpen(true)}>\n            Consolidar período'),
    "CTA 'Consolidar período' no estado pronto");
  // modal dinâmico: primeiro ciclo usa 'Consolidar período':
  assert.ok(p.includes('title={reconsolidando ? "Consolidar novamente" : "Consolidar período"}'), "título dinâmico");
  assert.ok(p.includes("{reconsolidando ? \"Consolidar novamente\" : \"Consolidar período\"}"), "botão final dinâmico");
  // e na primeira consolidação reconsolidando é FALSE (estado ≠ reaberto):
  reset();
  const estado = periodConsolidationState({
    today: HOJE, periodStart: PERIOD.from, periodEnd: PERIOD.to,
    consolidations: st().periodConsolidations, blockedCount: pend().total,
  });
  assert.equal(estado, "pronto-para-consolidar");
  // comportamento: consolidar cria R1 normalmente (mecânica intocada):
  consolidarR1();
  assert.equal(activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to)!.revision, 1);
});

check("TESTE 14 DE 18 — RECONSOLIDAÇÃO deixa claro: nova revisão, anterior preservada no histórico", () => {
  const p = page();
  // texto curto e inequívoco (exigência literal da 4G.2):
  assert.ok(p.includes("Uma nova revisão será criada e a anterior permanecerá no histórico."),
    "texto de nova revisão presente");
  const trecho = p.split("Uma nova revisão será criada e a anterior permanecerá no histórico.")[0];
  assert.ok(trecho.includes("{reconsolidando && ("), "texto exibido SOMENTE na reconsolidação");
  // título e botão da reconsolidação:
  assert.ok(p.includes('"Consolidar novamente"'), "'Consolidar novamente' no título/botão");
  assert.ok(p.includes("const reconsolidando = estadoPeriodo === \"reaberto-para-ajustes\";"), "gatilho = estado reaberto");
  // mantém a lista de conferência e NUNCA usa 'fotografia':
  assert.ok(p.includes("Confira os dados antes de consolidar:"), "confira os dados preservado");
  assert.ok(!p.includes("fotografia"), "vocabulário 'fotografia' continua banido");
  // MECÂNICA (4G.1 intocada): R1 superseded preservada; R2 nova ACTIVE:
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, note: "ajuste 30/07", now: 1727301000000 });
  const saida = st().entries.find((e) => e.date === "2026-07-30" && e.time === "17:00")!;
  assert.ok(actions.updateEntry(saida.id, { time: "16:30" }).ok, "edição liberada após reabrir");
  const r2 = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  assert.ok(r2.ok);
  const lista = st().periodConsolidations!;
  assert.deepEqual(lista.map((c) => c.revision).sort((a, b) => a - b), [1, 2], "R1 + R2");
  assert.equal(lista.find((c) => c.revision === 1)!.status, "superseded", "R1 histórica (nunca sobrescrita)");
  assert.equal(activeConsolidationForPeriod(lista, PERIOD.from, PERIOD.to)!.revision, 2, "somente R2 ativa");
  // estado textual do novo modal reflete o gatilho correto:
  const estado = periodConsolidationState({
    today: HOJE, periodStart: PERIOD.from, periodEnd: PERIOD.to, consolidations: lista, blockedCount: pend().total,
  });
  assert.equal(estado, "consolidado");
});

/* ════════ CORREÇÕES 5/6 — ORDEM EM REGISTROS + COR SEMÂNTICA ════════ */

check("TESTE 15 DE 18 — Lançamento manual / Registrar falta ficam DEPOIS da faixa-resumo", () => {
  const r = registros();
  const idxNav = r.indexOf("<PeriodNavigator");
  const idxFiltros = r.indexOf(">\n            De\n"); // bloco de filtros (De/ATÉ)
  const idxBanner = r.indexOf("Período consolidado — registros protegidos. Reabra o período no Resumo para editar.");
  const idxFaixa = r.indexOf("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600");
  const idxAcoes = r.indexOf("E — AÇÕES DO PERÍODO"); // marcador do bloco E (único)
  const idxLancamento = r.indexOf("          Lançamento manual\n        </Button>");
  const idxFalta = r.indexOf("<Ban size={14} /> Registrar falta");
  const idxAtencoes = r.indexOf('<section aria-label="Atenção agora"');
  const idxDias = r.indexOf("listedDays.map(");
  assert.ok(idxNav > -1 && idxFiltros > idxNav, "A navegação antes de B filtros");
  assert.ok(idxBanner > idxFiltros, "C banner de consolidação depois dos filtros");
  assert.ok(idxFaixa > idxBanner, "D faixa-resumo depois do banner");
  assert.ok(idxAcoes > idxFaixa && idxLancamento > idxFaixa && idxFalta > idxFaixa,
    "E ações do período IMEDIATAMENTE abaixo da faixa-resumo");
  assert.ok(idxAtencoes > idxAcoes, "F atenções depois das ações");
  assert.ok(idxDias > idxAtencoes, "G lista dos dias por último");
  // comportamento funcional intacto (handlers/disabled originais):
  assert.ok(r.includes('onClick={() => setManualOpen(true)}'), "Lançamento manual abre o modal existente");
  assert.ok(r.includes("setFaltaInitialDate(null); setFaltaOpen(true);"), "Registrar falta abre o modal existente");
});

check("TESTE 16 DE 18 — 'Registrar falta' com cor amarelo/laranja (warning) e disabled em consolidado", () => {
  const r = registros();
  // MESMA variante do "Registro de hoje" (quick-punch):
  assert.ok(src("src/components/quick-punch.tsx").includes('<Button variant="warning" size="md" onClick={clickFalta}>'),
    "referência: Registro de hoje usa variant=warning");
  const bloco = r.split("E — AÇÕES DO PERÍODO")[1]?.split("<ManualEntryModal")[0] ?? "";
  // elemento EXATO do botão de falta (do <Button até o rótulo):
  const idxFaltaBtn = bloco.indexOf("<Ban size={14} /> Registrar falta");
  assert.ok(idxFaltaBtn > -1, "é o botão de falta");
  const faltaEl = bloco.slice(bloco.lastIndexOf("<Button", idxFaltaBtn), idxFaltaBtn);
  assert.ok(faltaEl.includes('variant="warning"'), "Registrar falta usa variant=warning (amarelo/laranja)");
  assert.ok(faltaEl.includes("disabled={!!lockBound}"), "falta disabled em consolidado");
  // Lançamento manual permanece VERDE (primary padrão — sem prop variant):
  const idxLancBtn = bloco.indexOf("          Lançamento manual\n        </Button>");
  assert.ok(idxLancBtn > -1, "botão Lançamento manual presente");
  const lancEl = bloco.slice(bloco.lastIndexOf("<Button", idxLancBtn), idxLancBtn);
  assert.ok(lancEl.includes('onClick={() => setManualOpen(true)}') && !lancEl.includes("variant="), "Lançamento manual sem override (primary/verde)");
  // consolidado: continua claramente desabilitado (preserva hover/focus/disabled do Button):
  assert.equal(bloco.split('disabled={!!lockBound}').length - 1, 2, "ambos desabilitam sob lock");
  // 4H.1 (SUPERADO): o title de lock foi centralizado em `tituloAcaoBloqueada`
  // (um único texto, usado pelos DOIS botões), que diferencia ciclo aberto
  // ("reabra no Resumo") de ciclo encerrado ("não pode mais ser alterado").
  assert.equal(bloco.split("title={lockBound ? tituloAcaoBloqueada : undefined}").length - 1, 2, "title de lock nos dois");
  assert.ok(r.includes("const tituloAcaoBloqueada = cicloEncerradoAqui"), "variável única do título de lock");
  assert.ok(r.includes('"Período consolidado — reabra o período no Resumo para editar."'), "texto do ciclo ABERTO preservado");
  assert.ok(r.includes('"Ciclo encerrado — este período não pode mais ser alterado."'), "texto do ciclo ENCERRADO presente");
  assert.ok(src("src/components/ui.tsx").includes("disabled:opacity-50 disabled:pointer-events-none"),
    "estados disabled/hover/focus preservados pelo Button base");
});

/* ════════ CORREÇÃO 7/8 — ABRIR RESUMO PRESERVA O PERÍODO + LINKS ════════ */

check("TESTE 17 DE 18 — 'Abrir Resumo' abre o MESMO período, genericamente (sem hardcode)", () => {
  const r = registros();
  // link carrega a própria data inicial do período exibido (genérico):
  assert.ok(r.includes("href={`/resumo?data=${period.from}`}"), "href com ?data= do período exibido");
  assert.ok(!/resumo\?data=20\d\d/.test(r), "nenhuma data hardcoded no link");
  const p = page();
  // Resumo lê o parâmetro e deriva com a MESMA matemática canônica:
  assert.ok(p.includes('searchParams.get("data")'), "Resumo lê ?data=");
  assert.ok(p.includes("const periodoInicial = dataParam ? getPointPeriod(dataParam) : getPointPeriod(todayString());"),
    "derivação única via getPointPeriod (nenhuma 2ª matemática 21→20)");
  assert.ok(!p.includes("ymd(") && !p.includes("addDays("), "Resumo não reconstrói período à mão");
  // comportamento canônico: qualquer data do período passado resolve o MESMO período:
  reset();
  const alvo = getPointPeriod("2026-07-21");
  assert.deepEqual(alvo, { from: "2026-07-21", to: "2026-08-20" });
  assert.deepEqual(getPointPeriod("2026-08-05"), alvo, "data intermediária ⇒ mesmo período (o do banner consolidado)");
  // o Resumo deriva contexto/histórico/revisão normalmente a partir do período:
  assert.ok(p.includes("activeConsolidationForPeriod(periodConsolidations, period.from, period.to)"), "revisão ACTIVE derivada");
  assert.ok(p.includes("onBackToCurrent={viewingCurrentPeriod ? undefined : () => setPeriod(currentPeriod)}"), "contexto passado ⇒ ação de retorno disponível");
});

check("TESTE 18 DE 18 — Regressão integrada: R1/R2, uma ACTIVE, backup, 4G 24/24, 4G.1 18/18, data=/escopo", () => {
  // R1/R2 + uma ACTIVE + snapshot intacto:
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, note: "x", now: 1727301000000 });
  assert.ok(actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 }).ok);
  const lista = st().periodConsolidations!;
  assert.deepEqual(lista.map((c) => c.revision).sort((a, b) => a - b), [1, 2]);
  assert.equal(lista.filter((c) => c.status === "active").length, 1, "somente uma ACTIVE");
  const r1 = lista.find((c) => c.revision === 1)!;
  assert.deepEqual({ factual: r1.factualBalanceMinutes, proj: r1.projectedBalanceMinutes, used: r1.specialExcessUsedMinutes, at: r1.consolidatedAt },
    { factual: -30, proj: 30, used: 60, at: 1727300000000 }, "snapshot R1 jamais recalculado");
  // backup/persistência: 10 coleções + round-trip das revisões:
  const parsed = parseBackup(JSON.stringify(buildBackupPayload(st())));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup!.periodConsolidations!.map((c) => c.revision).sort((a, b) => a - b), [1, 2]);
  assert.equal(BACKUP_COLLECTIONS.length, 11, "contrato com 11 coleções (4H adiciona annualCycleClosures)");
  // data=/escopo ciclo preservados em Registros (4D.5/4E.1):
  const r = registros();
  assert.ok(r.includes('searchParams.get("escopo")') && r.includes('"ciclo"'), "escopo=ciclo preservado");
  assert.ok(r.includes("/^\\d{4}-\\d{2}-\\d{2}$/.test(focusDateRaw)"), "data= validada preservada");
  assert.ok(r.includes("`/registros?situacao=${filtro}&escopo=ciclo${dates.length === 1 ? `&data=${dates[0]}` : \"\"}`") || r.includes("escopo=ciclo"), "faixas mantêm escopo+data");
  // suítes anteriores continuam verdes:
  for (const t of ["verify-consolidacao-4g", "verify-correcoes-4g1", "verify-resumo-4f", "verify-atencao-agora-4d5", "verify-filtro-situacao"]) {
    execSync(`TZ=America/Sao_Paulo ./node_modules/.bin/tsx tests/${t}.mts`, { cwd: root, stdio: "pipe" });
  }
});

console.log(`\n4G.2 — ${passed}/18 verificações concluídas.`);
if (passed !== 18) process.exit(1);
