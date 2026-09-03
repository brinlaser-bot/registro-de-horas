/**
 * VERIFICAÇÃO — ETAPA 4G.1: CORREÇÕES PÓS-VALIDAÇÃO DA CONSOLIDAÇÃO
 * (SOMENTE LEITURA REAL NA UI + RECONSOLIDAÇÃO + HISTÓRICO + CONTEXTO).
 *
 * Correções cobertas:
 *   1. DayCard consolidado = SOMENTE LEITURA (nenhum controle mutável);
 *   2. camada visual "🔒 Consolidado" DERIVADA da revisão ACTIVE;
 *   3. faixas globais de Atenção ocultas no período histórico;
 *   4. histórico visível também em "Reaberto para ajustes";
 *   5. reconsolidação ⇒ nova revisão (R1 jamais sobrescrita, uma ACTIVE);
 *   6. textos "Confira os dados antes de consolidar" / toast / modal;
 *   7. contexto passado/atual/futuro + botão "Ir para o período atual";
 *   8. guard canônico em setExcessReason (metadado da origem [10+]).
 *
 * Fixture (a mesma da 4G — deslocada em −28 dias, TODOS os dias no passado
 * real; HOJE (asOf) = 2026-08-25 ⇒ período 21/07→20/08 ENCERRADO):
 *   factual −30 · projeção +30 · [10+] usado 60 (origens 20/07)
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-correcoes-4g1.mts
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
} from "../src/lib/period-consolidation.ts";
import {
  PERIOD_CONTEXT_LABEL,
  pointPeriodContext,
  getPointPeriod,
} from "../src/lib/periods.ts";
import { buildBackupPayload, parseBackup, BACKUP_COLLECTIONS } from "../src/lib/backup.ts";
import type { TimeEntry, Falta } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = () => src("src/app/(app)/resumo/page.tsx");
const registros = () => src("src/app/(app)/registros/page.tsx");
const dayCard = () => src("src/components/day-card.tsx");
const navigator = () => src("src/components/period-navigator.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixture 4G (deslocada; idêntica à verify-consolidacao-4g) ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const HOJE = "2026-08-25";
const PERIOD = { from: "2026-07-21", to: "2026-08-20" };
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
/** Consolida R1 (fixture limpa) e devolve a revisão ativa. */
const consolidarR1 = () => {
  reset();
  const r = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727300000000 });
  assert.ok(r.ok, `consolidação R1: ${!r.ok ? r.error : ""}`);
  return activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to)!;
};
const MSG_PERIODO = "Período consolidado — reabra o período no Resumo para editar.";

/* ════════ CORREÇÃO 1 — CONSOLIDADO = SOMENTE LEITURA NA UI ════════ */

check("TESTE 01 DE 18 — DayCard consolidado não oferece Adicionar batida/Registrar intervalo", () => {
  const dc = dayCard();
  // o bloco inteiro de mutação de batidas é cercado por !ro:
  assert.ok(dc.includes("!ro && !missingExpected && !historicalEmpty && !incompletePast && !inconsistent && (\n          <div className=\"mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center\">"),
    "bloco 'Adicionar batida'/'Registrar intervalo' sob !ro");
  assert.ok(dc.includes('<Plus size={14} /> Adicionar batida'), "controle existe (e só existe no bloco cercado)");
  assert.ok(dc.includes("<Plus size={14} /> Registrar intervalo"), "Registrar intervalo no mesmo bloco");
  assert.ok(dc.includes("{punchModal && !ro && ("), "modal mutável nunca abre a partir de card consolidado");
  // Registros deriva a prop da consolidação ACTIVE (sem estado persistido):
  const r = registros();
  assert.ok(r.includes("consolidated={consolidationLockForDate(periodConsolidations, date) !== null}"),
    "prop derivada do lock canônico por data");
});

check("TESTE 02 DE 18 — Batidas continuam visíveis, sem editar/excluir", () => {
  const dc = dayCard();
  // os chips de batida ficam FORA de qualquer !ro (dados sempre visíveis);
  // o grupo editar/excluir é cercado por !ro:
  const idxEditar = dc.indexOf('aria-label="Editar"');
  const idxExcluir = dc.indexOf('aria-label="Excluir"');
  assert.ok(idxEditar > 0 && idxExcluir > idxEditar, "chips com ações editar/excluir");
  assert.ok(dc.slice(idxEditar - 700, idxEditar).includes("{!ro && ("), "editar sob !ro");
  assert.ok(dc.includes('{!ro && (\n                    <div className="ml-auto flex shrink-0 items-center opacity-100'),
    "grupo editar/excluir das batidas sob !ro");
  const chips = dc.slice(dc.indexOf("{d.entries.map((e) =>"), dc.indexOf("Rodapé explicativo"));
  assert.ok(chips.includes("{e.time}"), "horário das batidas renderizado incondicionalmente (dados visíveis)");
  assert.ok(chips.includes('e.type === "entrada" ? "Entrada" : "Saída"'), "tipo das batidas visível");
  // expandir/recolher permanece: o cabeçalho-button não recebe !ro:
  const header = dc.slice(dc.indexOf("{/* Cabeçalho */}"), dc.indexOf("{/* Cabeçalho */}") + 400);
  assert.ok(header.includes("setExpanded((v) => !v)") && !header.includes("ro"), "expandir/recolher sempre permitido");
});

check("TESTE 03 DE 18 — Dia consolidado com [10+] não oferece Completar/Cancelar uso", () => {
  const dc = dayCard();
  assert.ok(dc.includes("onOpen={!ro && specialExcess.canComplete && onCompleteJornada ? () => onCompleteJornada(d.date) : undefined}"),
    "Completar jornada/mais com [10+] sem onOpen em consolidado");
  assert.ok(dc.includes("onResolvePlan={ro ? undefined : onResolvePlan}"), "Usar planejamento/Cancelar reserva off");
  assert.ok(dc.includes("onPlan={ro ? undefined : onPlanSpecial}"), "Planejar mais off");
  assert.ok(dc.includes("{futureDay && !ro && onPlanSpecial &&"), "bloco 'Planejar uso de [10+]' sob !ro");
  assert.ok(dc.includes('{!ro && (\n                <div className="mt-2">\n                  <Button\n                    size="sm"\n                    variant="ghost"\n                    className="!text-rose-600 hover:!bg-rose-100"'),
    "Cancelar/Excluir falta sob !ro");
  // demais ações que alteram o dia:
  assert.ok(dc.includes("{d.open && isToday && !punchPending && !ro && ("), "SmartExit (mutação) sob !ro");
  const corretos = dc.split("Corrigir registros").length - 1;
  assert.equal(corretos, 2, "somente os 2 CTAs de correção no arquivo");
  assert.ok(dc.split("!ro").length - 1 >= 13, "todas as ações mutáveis cercadas por !ro (13 pontos mapeados)");
});

check("TESTE 04 DE 18 — Guards do motor continuam rejeitando mutação chamada diretamente", () => {
  consolidarR1();
  // add/delete de batida:
  const rAdd = actions.addEntry({ date: "2026-07-22", time: "07:00", type: "entrada" });
  assert.ok(!rAdd.ok && rAdd.error === MSG_PERIODO, "addEntry recusado");
  const alvo = st().entries.find((e) => e.date === "2026-07-29" && e.time === "05:00")!;
  const rDel = actions.deleteEntry(alvo.id);
  assert.ok(!rDel.ok && rDel.error === MSG_PERIODO, "deleteEntry recusado");
  // cancelamento de uso [10+] com destino consolidado:
  const uso = st().specialExcessUses!.find((u) => u.destinationDate === "2026-08-03")!;
  const rUse = actions.cancelSpecialExcessUse({ id: uso.id });
  assert.ok(!rUse.ok && rUse.error === "Uso protegido por período consolidado.", "cancelSpecialExcessUse recusado");
  // 4G.1 — metadado da origem [10+] (motivo do excedente em 31/07, DENTRO do
  // período consolidado — origem do [10+] que formou o fechamento):
  const rReason = actions.setExcessReason({ date: "2026-07-31", reason: "reuniao-prolongada" });
  assert.ok(!rReason.ok && rReason.code === "consolidated" && rReason.error === MSG_PERIODO,
    "setExcessReason (motivo da origem) recusado em data consolidada");
  // fora do consolidado, o motivo segue editável (comportamento intacto —
  // inclusive a origem 20/07, que fica FORA do período consolidado):
  const rReasonFora = actions.setExcessReason({ date: "2026-07-20", reason: "reuniao-prolongada" });
  assert.ok(rReasonFora.ok, "origem fora do consolidado segue editável");
  const rReason2 = actions.setExcessReason({ date: "2026-08-25", reason: "outro", customReason: "cobertura" });
  assert.ok(rReason2.ok, "setExcessReason fora de consolidado segue livre");
});

/* ════════ CORREÇÃO 2 — IDENTIDADE VISUAL DO DIA CONSOLIDADO ════════ */

check("TESTE 05 DE 18 — Indicador visual 'Consolidado' sem perder a situação semântica", () => {
  const dc = dayCard();
  assert.ok(dc.includes("<Lock size={12}"), "ícone de cadeado");
  assert.ok(dc.includes("<span>Consolidado</span>"), "badge 'Consolidado'");
  assert.ok(dc.includes('{ro && (\n              <Badge tone="violet" className="shrink-0 gap-1 py-1">'), "badge DERIVADO de ro (consolidação ACTIVE)");
  // cores semânticas preservadas (situuação dominante continua):
  assert.ok(dc.includes('return <Badge tone="rose">Acima do limite</Badge>;'), "vermelho = problema");
  assert.ok(dc.includes('return <Badge tone="amber">Abaixo da base</Badge>;'), "laranja = abaixo da base");
  assert.ok(dc.includes('return <Badge tone="emerald">Dia ok</Badge>;'), "verde = dia ok");
  assert.ok(dc.includes("[10+] aplicado · {formatMinutes(specialExcess.usedActiveMinutes)}"), "roxo [10+] preservado");
  // borda suavemente diferenciada (camada discreta):
  assert.ok(dc.includes('border-violet-300" : ""'), "borda violeta discreta em consolidado");
});

check("TESTE 06 DE 18 — Ao reabrir, o indicador visual desaparece (deriva da ACTIVE)", () => {
  consolidarR1();
  const alvo = st().entries.find((e) => e.date === "2026-07-29" && e.time === "05:00")!;
  assert.equal(consolidationLockForDate(st().periodConsolidations, alvo.date) !== null, true,
    "sob ACTIVE: lock ⇒ card renderizaria o indicador");
  assert.ok(actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 }).ok, "reabre");
  assert.equal(consolidationLockForDate(st().periodConsolidations, alvo.date), null,
    "sem ACTIVE: lock = null ⇒ indicador some automaticamente (nada persistido)");
  const dc = dayCard();
  assert.ok(!dc.includes("localStorage"), "nenhuma persistência no card");
  assert.ok(!/useState[^)]*onsolidat/.test(dc), "nenhum useState de consolidação (visual 100% derivado)");
  assert.ok(dc.includes("const ro = consolidated;"), "ro = prop derivada (lock ACTIVE), nunca estado");
  const r = registros();
  assert.ok(r.includes("consolidated={consolidationLockForDate(periodConsolidations, date) !== null}"),
    "derivação por render: reabrir ⇒ prop false ⇒ camada visual removida");
});

/* ════════ CORREÇÃO 3 — ATENÇÃO GLOBAL EM PERÍODO HISTÓRICO ════════ */

check("TESTE 07 DE 18 — Período histórico não mostra Atenção global como se fosse do período", () => {
  const r = registros();
  assert.ok(r.includes("!historicalPeriodView && !pendingOnly && !missingOnly && !planoOnly && !situationActive && ("),
    "faixas globais ocultas quando o período exibido ≠ atual");
  assert.ok(r.includes('const historicalPeriodView = !wantCycleScope && !query && contextoPeriodo !== "current";'),
    "modo histórico = período do ponto ≠ período atual (ciclo/consulta preservam regra própria)");
});

check("TESTE 08 DE 18 — Período atual mantém a Atenção normalmente", () => {
  const r = registros();
  assert.ok(r.includes("const contextoPeriodo = pointPeriodContext(period, getPointPeriod(todayStr));"),
    "contexto derivado da mesma fonte única");
  assert.ok(r.includes('attentionNowSummary({'), "fonte canônica das faixas intacta");
  assert.ok(r.includes('<section aria-label="Atenção agora"'), "seção das faixas existe");
  // no período atual: historicalPeriodView = false ⇒ faixas renderizam como sempre
  reset();
  assert.equal(pointPeriodContext(getPointPeriod(HOJE), getPointPeriod(HOJE)), "current");
  assert.equal(pend().total, 0, "fixture limpa: 0 pendências (resumo do período coerente com faixas ocultas/mostradas)");
});

/* ════════ CORREÇÃO 4 — HISTÓRICO EM "REABERTO PARA AJUSTES" ════════ */

check("TESTE 09 DE 18 — R1 permanece visível no histórico durante Reaberto para ajustes", () => {
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, note: "corrigir 29/07", now: 1727301000000 });
  const lista = st().periodConsolidations!;
  assert.equal(lista.length, 1, "R1 preservada no estado");
  assert.equal(lista[0].status, "superseded");
  assert.equal(lista[0].reopenedAt, 1727301000000);
  assert.equal(lista[0].reopenNote, "corrigir 29/07");
  // UI: histórico acessível SEM revisão ACTIVE (toggle próprio), não só pelo banner:
  const p = page().replace(/\s+/g, " ");
  // 4G.2 (SUPERADO): a linha "Histórico de consolidações" ficou PERMANENTE
  // (toggle completo Ver/Ocultar) — a condição perdeu o "!histOpen"; o acesso
  // sem ACTIVE continua garantido e o conteúdo segue controlado por histOpen.
  assert.ok(p.includes("revisoesDoPeriodo.length > 0 && !consolidacaoAtiva && ("),
    "acesso ao histórico quando não existe ACTIVE (4G.2: linha permanente com toggle)");
  assert.ok(p.includes("Histórico de consolidações"), "título do histórico");
  // item exibe Reaberta + reopenedAt + motivo:
  const item = page().replace(/\s+/g, " ");
  assert.ok(item.includes('c.status === "active" ? (') && item.includes('Reaberta{c.reopenedAt ? ` em ${formatDateTimeBR(c.reopenedAt)}` : ""}'),
    "status Reaberta com data de reabertura");
  assert.ok(item.includes("Motivo da reabertura: {c.reopenNote}"), "motivo exibido quando houver");
});

check("TESTE 10 DE 18 — R1 preserva factual/projeção/[10+]/timestamps", () => {
  consolidarR1();
  const r1 = st().periodConsolidations![0];
  assert.deepEqual(
    { factual: r1.factualBalanceMinutes, proj: r1.projectedBalanceMinutes, used: r1.specialExcessUsedMinutes, at: r1.consolidatedAt, rev: r1.revision },
    { factual: -30, proj: 30, used: 60, at: 1727300000000, rev: 1 },
  );
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  const r1depois = st().periodConsolidations![0];
  assert.equal(r1depois.consolidatedAt, 1727300000000, "consolidatedAt intocado pela reabertura");
  assert.equal(r1depois.revision, 1, "revision intacta");
  assert.deepEqual(
    { factual: r1depois.factualBalanceMinutes, proj: r1depois.projectedBalanceMinutes, used: r1depois.specialExcessUsedMinutes },
    { factual: -30, proj: 30, used: 60 },
    "snapshot histórico NUNCA é recalculado nem apagado",
  );
});

/* ════════ CORREÇÃO 5 — RECONSOLIDAÇÃO APÓS REABERTURA ════════ */

check("TESTE 11 DE 18 — Reaberto + 0 pendências oferece 'Consolidar novamente'", () => {
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  // alteração válida (17:00 → 16:30 do dia neutro 30/07) e 0 pendências:
  const saida = st().entries.find((e) => e.date === "2026-07-30" && e.time === "17:00")!;
  assert.ok(actions.updateEntry(saida.id, { time: "16:30" }).ok, "edição liberada após reabrir");
  assert.equal(pend().total, 0, "0 pendências bloqueantes");
  const p = page().replace(/\s+/g, " ");
  assert.ok(p.includes('estadoPeriodo === "reaberto-para-ajustes" && pend.total === 0 && ('),
    "CTA condicional do estado reaberto");
  assert.ok(p.includes("Consolidar novamente"), "CTA de reconsolidação");
  // reaberto COM pendências ⇒ aviso + Revisar em Registros (não CTA):
  assert.ok(p.includes('estadoPeriodo === "reaberto-para-ajustes" && pend.total > 0 && ('), "ramo com pendências");
  assert.ok(p.includes("Resolva as pendências antes de consolidar novamente este período."), "aviso específico");
});

check("TESTE 12 DE 18 — Nova consolidação cria R2 sem sobrescrever R1", () => {
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  const saida = st().entries.find((e) => e.date === "2026-07-30" && e.time === "17:00")!;
  actions.updateEntry(saida.id, { time: "16:30" });
  // factual/projeção recalcularam (eco do exemplo validado: 17:00→16:30 ⇒ −30min):
  const v = view();
  assert.equal(v.cards.regularBalanceMinutes, -60, "factual recalculado após edição");
  assert.equal(v.cards.projection.projectedBalanceMinutes, 0, "projeção recalculada");
  const r2 = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  assert.ok(r2.ok, `reconsolidação: ${!r2.ok ? r2.error : ""}`);
  const lista = st().periodConsolidations!;
  assert.equal(lista.length, 2, "R1 e R2 coexistem");
  const antiga = lista.find((c) => c.revision === 1)!;
  const nova = lista.find((c) => c.revision === 2)!;
  assert.deepEqual(
    { factual: antiga.factualBalanceMinutes, proj: antiga.projectedBalanceMinutes, used: antiga.specialExcessUsedMinutes },
    { factual: -30, proj: 30, used: 60 },
    "R1 intocada (factual/resultado/[10+] do fechamento original)",
  );
  assert.deepEqual(
    { factual: nova.factualBalanceMinutes, proj: nova.projectedBalanceMinutes },
    { factual: -60, proj: 0 },
    "R2 registra o novo estado",
  );
  assert.equal(antiga.status, "superseded", "R1 continua SUPERSEDED/REOPENED");
  assert.equal(antiga.reopenedAt, 1727301000000, "R1 mantém reopenedAt");
});

check("TESTE 13 DE 18 — Somente R2 fica ACTIVE", () => {
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  const ativas = st().periodConsolidations!.filter((c) => c.status === "active");
  assert.equal(ativas.length, 1);
  assert.equal(ativas[0].revision, 2);
  assert.equal(activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to)!.revision, 2);
});

/* ════════ CORREÇÃO 6 — TEXTOS DA CONSOLIDAÇÃO ════════ */

check("TESTE 14 DE 18 — Modal usa 'Confira os dados antes de consolidar'", () => {
  const p = page().replace(/\s+/g, " ");
  assert.ok(p.includes("Confira os dados antes de consolidar:"), "título da lista de dados");
  assert.ok(
    p.includes("Seu saldo factual continuará mostrando o que realmente aconteceu na jornada. Ao consolidar, o resultado no ponto será registrado e os dados deste período ficarão protegidos contra alterações."),
    "texto explicativo do modal preservando o significado",
  );
});

check("TESTE 15 DE 18 — Não resta texto 'fotografia salva' nem 'A fotografia exata'", () => {
  const p = page();
  assert.ok(!p.includes("fotografia"), "nenhuma ocorrência de 'fotografia' na página do Resumo");
  assert.ok(p.includes("Período consolidado e registrado no histórico."), "novo toast/texto");
  const dc = dayCard();
  assert.ok(!dc.includes("fotografia"), "DayCard sem o vocabulário antigo");
});

/* ════════ CORREÇÃO 7 — CONTEXTO DO PERÍODO EXIBIDO ════════ */

check("TESTE 16 DE 18 — PeriodNavigator identifica passado/atual/futuro (derivação única)", () => {
  const atual = getPointPeriod(HOJE); // 21/08→20/09 (período de HOJE=25/08)
  const passado = { from: "2026-07-21", to: "2026-08-20" }; // fixture consolidada
  const futuro = { from: "2026-09-21", to: "2026-10-20" };
  assert.equal(pointPeriodContext(atual, atual), "current");
  assert.equal(pointPeriodContext(passado, atual), "past");
  assert.equal(pointPeriodContext(futuro, atual), "future");
  // vários períodos para trás CONTINUA passado (nunca "anterior"):
  const muitoAntes = { from: "2025-02-21", to: "2025-03-20" };
  assert.equal(pointPeriodContext(muitoAntes, atual), "past");
  assert.equal(PERIOD_CONTEXT_LABEL.past, "Período passado");
  assert.equal(PERIOD_CONTEXT_LABEL.current, "Período atual");
  assert.equal(PERIOD_CONTEXT_LABEL.future, "Período futuro");
  const nav = navigator();
  assert.ok(nav.includes("contextLabel"), "prop informativa no navegador");
});

check("TESTE 17 DE 18 — 'Ir para o período atual' é botão real, só fora do atual, em Registros/Resumo", () => {
  const nav = navigator();
  assert.ok(nav.includes("Ir para o período atual"), "rótulo da ação");
  assert.ok(nav.includes('aria-label="Ir para o período atual"'), "acessibilidade");
  assert.ok(nav.includes("<Undo2 size={14}"), "ícone de retorno");
  // botão REAL (Button com variant/secondary — borda/background/hover/foco):
  // 4G.2 (SUPERADO em estrutura, preservado em significado) → 4G.2.1: o botão
  // de retorno existe em UMA ÚNICA instância JSX (a duplicação mobile/desktop
  // escondida por CSS foi eliminada) — segue botão REAL, renderizado SOMENTE
  // quando a página passa a ação (fora do atual).
  assert.ok(nav.includes('onClick={onBackToCurrent}') && nav.split('aria-label="Ir para o período atual"').length - 1 === 1,
    "botão real de retorno em instância ÚNICA (4G.2.1), só fora do atual");
  assert.ok(nav.includes("{onBackToCurrent && ("), "renderiza somente quando a página passa a ação");
  // páginas passam undefined no período atual (botão some):
  const p = page();
  assert.ok(p.includes("onBackToCurrent={viewingCurrentPeriod ? undefined : () => setPeriod(currentPeriod)}"),
    "Resumo: botão só fora do atual");
  const r = registros();
  assert.ok(r.includes("onBackToCurrent={"), "Registros usa o mesmo botão");
  assert.ok(r.includes("samePointPeriodCurrent"), "Registros deriva 'atual' da MESMA fonte (sem 2ª matemática)");
  assert.ok(r.includes("contextLabel={query || wantCycleScope ? undefined : PERIOD_CONTEXT_LABEL[contextoPeriodo]}"),
    "contexto informativo em Registros");
  assert.ok(p.includes("contextLabel={PERIOD_CONTEXT_LABEL[contextoPeriodo]}"), "contexto informativo no Resumo");
  // navegador aprovado preservado:
  // 4G.2 (SUPERADO) → 4G.2.1: container único com wrap (coluna natural no
  // mobile via w-full+wrap; linha única no desktop via sm:flex-nowrap).
  assert.ok(nav.includes('className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap"'), "controle único (4G.2.1)");
  assert.ok(nav.includes('aria-label="Período anterior"') && nav.includes('aria-label="Próximo período"'), "setas preservadas");
});

/* ════════ SENTINELAS ════════ */

check("TESTE 18 DE 18 — Backup/revisions/4G/4F/4E.1 e sentinelas permanecem íntegros", () => {
  // persistência intacta: 10ª coleção, parse antigo → [], round-trip de revisions:
  consolidarR1();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  const parsed = parseBackup(JSON.stringify(buildBackupPayload(st())));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup!.periodConsolidations!.map((c) => c.revision).sort((a, b) => a - b), [1, 2]);
  assert.equal(BACKUP_COLLECTIONS.length, 10, "nenhuma coleção nova criada");
  // sem schema novo além do existente:
  assert.ok(src("src/lib/types.ts").includes("periodConsolidations?"), "mesmo campo opcional da 4G");
  assert.ok(src("src/lib/seed-data.ts").includes("periodConsolidations: []"), "seed intocada");
  // suítes das etapas anteriores continuam verdes:
  for (const t of ["verify-consolidacao-4g", "verify-resumo-4f", "verify-central-4e1", "verify-backup-contract-vg-ux-4c1b"]) {
    execSync(`TZ=America/Sao_Paulo ./node_modules/.bin/tsx tests/${t}.mts`, { cwd: root, stdio: "pipe" });
  }
});

console.log(`\n4G.1 — ${passed}/18 verificações concluídas.`);
if (passed !== 18) process.exit(1);
