/**
 * VERIFICAÇÃO — ETAPA 4H.2: REORGANIZAÇÃO DAS HORAS [10+] + FLUXO INVERSO
 * "DESTINAR HORAS" (origem → destino) SOBRE O MESMO MOTOR CANÔNICO.
 *
 * Cenário padrão (ciclo 2026/2027 aberto, asOf 03/09/2026):
 *   · 06/05: 7h30  → déficit 30min  (destino antigo, precisa MENOS que a origem)
 *   · 17/07: 6h    → déficit 120min (destino antigo, precisa MAIS que a origem de 28/08)
 *   · 24/07: 7h    → déficit 60min  (destino ANTERIOR à origem 24/08 (segunda) — mesmo ciclo)
 *   · 21/08: 7h    → déficit 60min  (dentro do período consolidável 21/08–20/09)
 *   · 24/08: 12h   → [10+] gerado 120min (origem A)
 *   · 28/08: 11h30 → [10+] gerado 90min  (origem B)
 *   · ciclo 2025/2026 encerrado: 90min TRANSPORTADAS (origem factual 28/04/2026)
 *
 * Regra-mãe intacta: o uso não altera factual; [10+] é camada operacional;
 * os DOIS fluxos (destino→origem e origem→destino) terminam no MESMO
 * SpecialExcessUse do motor 3B/3C/3D.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-destinar-horas-4h2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData } from "../src/lib/store.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import {
  carriedOutForDate,
  eligibleSpecialExcessDestinationsForOrigin,
  lotOperatesInCycle,
  maxDestinableMinutes,
} from "../src/lib/special-excess-destinations.ts";
import { carriedSlicesIntoCycle, dateFallsInClosedCycle } from "../src/lib/annual-cycle-closure.ts";
import { validateSpecialExcessUse, type SpecialExcessUse } from "../src/lib/special-excess-use.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import type { PeriodConsolidation } from "../src/lib/period-consolidation.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const ASOF = "2026-09-03";

let nextId = 1;
const p = (d: string, t: string, ty: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date: d, time: t, type: ty, note: null });

/** Ciclo 2025/2026 encerrado: 90min TRANSPORTADAS p/ 2026/2027 (origem factual 28/04/2026). */
const CARRIED_90 = {
  id: "acc-2025-2026", cycleLabel: "2025/2026", cycleStart: "2025-05-01", cycleEnd: "2026-04-30",
  status: "closed" as const, closedAt: 1, periodConsolidationIds: [] as number[],
  closingSpecialExcessMinutes: 90, disposition: "carried" as const, destinationCycleStart: "2026-05-01",
  sourceSlices: [{ originalOriginDate: "2026-04-28", minutes: 90, originCycle: "2025/2026", provenance: "Transportado do ciclo 2025/2026" }],
  note: null as string | null,
};

/** Consolidação ATIVA 21/08→20/09 (cobre 21/08, 24/08 e 28/08). */
const CONSOL_AGO: PeriodConsolidation = {
  id: 1, periodStart: "2026-08-21", periodEnd: "2026-09-20",
  cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  consolidatedAt: 1, revision: 1, status: "active",
  factualBalanceMinutes: 0, projectedBalanceMinutes: 0, regularPositiveMinutes: 0, regularNegativeMinutes: 0,
  trackedDays: 0, specialExcessUsedMinutes: 0, useIds: [], allocations: [],
  pendingCountAtConsolidation: 0, reopenedAt: null, reopenNote: null,
};

function baseEntries(openDay: string | null): TimeEntry[] {
  const list: TimeEntry[] = [
    // 06/05: 7h30 → falta 30min
    p("2026-05-06", "08:00", "entrada"), p("2026-05-06", "12:00", "saida"),
    p("2026-05-06", "13:00", "entrada"), p("2026-05-06", "16:30", "saida"),
    // 17/07: 6h → falta 120min
    p("2026-07-17", "08:00", "entrada"), p("2026-07-17", "12:00", "saida"),
    p("2026-07-17", "13:00", "entrada"), p("2026-07-17", "15:00", "saida"),
    // 24/07: 7h → falta 60min (ANTES da origem 24/08)
    p("2026-07-24", "08:00", "entrada"), p("2026-07-24", "12:00", "saida"),
    p("2026-07-24", "13:00", "entrada"), p("2026-07-24", "16:00", "saida"),
    // 21/08: 7h → falta 60min
    p("2026-08-21", "08:00", "entrada"), p("2026-08-21", "12:00", "saida"),
    p("2026-08-21", "13:00", "entrada"), p("2026-08-21", "16:00", "saida"),
    // 24/08: 12h → [10+] gerado 120min
    p("2026-08-24", "07:00", "entrada"), p("2026-08-24", "12:00", "saida"),
    p("2026-08-24", "13:00", "entrada"), p("2026-08-24", "20:00", "saida"),
    // 28/08: 11h30 → [10+] gerado 90min
    p("2026-08-28", "08:00", "entrada"), p("2026-08-28", "12:00", "saida"),
    p("2026-08-28", "13:00", "entrada"), p("2026-08-28", "20:30", "saida"),
  ];
  if (openDay) list.push(p(openDay, "08:00", "entrada")); // dia em aberto (só entrada)
  return list;
}

const state = (opts: { consols?: PeriodConsolidation[]; withClosure?: boolean; openDay?: string | null } = {}) => ({
  user: {
    id: 1, name: "t", email: "t@t",
    workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
    maxDailyMinutes: 600, autoDeductLunch: true, birthDate: null, controlStartDate: "2026-05-01",
  },
  entries: baseEntries(opts.openDay ?? null),
  compensations: [], absences: [], companyCalendars: undefined, faltas: [], excessReasons: [],
  specialExcessUses: [], specialExcessPlans: [],
  periodConsolidations: opts.consols ?? [],
  annualCycleClosures: opts.withClosure === false ? [] : [CARRIED_90],
});

const reset = (opts?: { consols?: PeriodConsolidation[]; withClosure?: boolean; openDay?: string | null }) => {
  nextId = 1;
  actions.replaceAll(state(opts) as never);
};

const CYC = () => getAnnualPointCycle("2026-09-03"); // 2026/2027
const st = () => getAppData();

const bankOf = (cycle = CYC()) =>
  buildSpecialExcessBank({
    cycle, asOfDate: ASOF, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S, faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
    carried: carriedSlicesIntoCycle(st().annualCycleClosures, cycle),
  });

const dests = () =>
  eligibleSpecialExcessDestinationsForOrigin({
    cycle: CYC(), asOfDate: ASOF, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S, faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
    periodConsolidations: st().periodConsolidations,
    annualCycleClosures: st().annualCycleClosures,
  });

const dayView = (date: string) =>
  buildSpecialExcessDayView({
    date, asOfDate: ASOF, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S, faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
    closures: st().annualCycleClosures,
  });

const row = (date: string) =>
  buildResumoDayRow({
    date, today: ASOF, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S, faltas: [], controlStartDate: "2026-05-01",
  });

/** O MESMO parâmetro que o modal "Destinar horas" emite (fluxo inverso). */
const destinar = (destDate: string, originDate: string, minutes: number) =>
  actions.createSpecialExcessUse({
    destinationDate: destDate, minutes, allocationStrategy: "manual",
    manualAllocations: [{ originDate, minutes }], asOfDate: ASOF,
  });

const central = () => src("src/app/(app)/compensacoes/page.tsx");
const registros = () => src("src/app/(app)/registros/page.tsx");
const dayCard = () => src("src/components/day-card.tsx");
const modalSrc = () => src("src/components/special-excess-destine-modal.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ════════ T01–T04 — nova área operacional da Central ════════ */

check("T01 — 'Horas [10+] disponíveis' substitui 'Origens do [10+]' na área operacional do ciclo aberto", () => {
  const c = central();
  assert.ok(c.includes(">Horas [10+] disponíveis</h3>"), "novo heading da área operacional");
  assert.ok(!c.includes(">Origens do [10+]</h3>"), "heading técnico 'Origens do [10+]' saiu da área operacional");
  assert.ok(c.includes("Horas [10+] totalmente destinadas"), "segundo bloco criado");
  assert.ok(c.includes('aria-label="Horas [10+] disponíveis"'), "seção A com identidade própria");
});

check("T02 — lote com available > 0 aparece em disponíveis (derivado do banco canônico)", () => {
  reset();
  const b = bankOf();
  const disponiveis = b.lots.filter((l) => l.availableMinutes > 0);
  assert.deepEqual(
    disponiveis.map((l) => l.originDate).sort(),
    ["2026-04-28", "2026-08-24", "2026-08-28"],
    "3 lotes com saldo (28/04 transportado + 24/08 + 28/08)",
  );
  const c = central();
  assert.ok(c.includes("const lotesDisponiveis = bank.lots.filter((l) => l.availableMinutes > 0);"), "seção A filtrada por availableMinutes > 0");
});

check("T03 — disponível é o valor de destaque do lote", () => {
  const c = central();
  const cardA = c.slice(c.indexOf("lotesDisponiveis.map"), c.indexOf("lotesTotalmenteDestinados.length > 0"));
  assert.ok(cardA.includes("text-lg font-extrabold tabular-nums text-indigo-600"), "disponível em destaque (tamanho/índigo)");
  assert.ok(cardA.includes("formatMinutes(lot.availableMinutes)"), "o valor em destaque é o disponível do lote");
  assert.ok(cardA.includes("disponíveis"), "rótulo 'disponíveis' junto ao valor");
});

check("T04 — Gerado/Utilizado/Reservado continuam visíveis como dados secundários", () => {
  const c = central();
  const cardA = c.slice(c.indexOf("lotesDisponiveis.map"), c.indexOf("lotesTotalmenteDestinados.length > 0"));
  assert.ok(cardA.includes('className="mt-1 text-xs font-medium text-slate-500"'), "estatísticas em linha secundária (text-xs)");
  assert.ok(cardA.includes("Gerado <b"), "Gerado visível (não factual → não esconde)");
  assert.ok(cardA.includes("Utilizado"), "Utilizado visível");
  assert.ok(cardA.includes("Reservado"), "Reservado visível");
  assert.ok(cardA.includes('formatMinutes(lot.generatedMinutes)'), "valores canônicos do lote (3C)");
});

/* ════════ T05–T08 — blocos disponíveis vs totalmente destinadas ════════ */

check("T05 — lote available=0 não aparece em disponíveis", () => {
  reset();
  // consome TODOS os 90min de 28/08 (destino 17/07 precisa 120 → aceita 90)
  assert.equal(destinar("2026-07-17", "2026-08-28", 90).ok, true);
  const b = bankOf();
  const lote = b.lots.find((l) => l.originDate === "2026-08-28")!;
  assert.equal(lote.availableMinutes, 0, "28/08 esgotado (90−90)");
  const disponiveis = b.lots.filter((l) => l.availableMinutes > 0);
  assert.ok(!disponiveis.some((l) => l.originDate === "2026-08-28"), "28/08 fora de 'disponíveis'");
  assert.deepEqual(disponiveis.map((l) => l.originDate).sort(), ["2026-04-28", "2026-08-24"]);
});

check("T06 — lote available=0 aparece em 'Horas [10+] totalmente destinadas'", () => {
  reset();
  assert.equal(destinar("2026-07-17", "2026-08-28", 90).ok, true);
  const b = bankOf();
  const totalmenteDestinados = b.lots.filter((l) => l.availableMinutes === 0);
  assert.deepEqual(totalmenteDestinados.map((l) => l.originDate), ["2026-08-28"], "28/08 no bloco B (100% comprometido)");
  const c = central();
  assert.ok(c.includes("const lotesTotalmenteDestinados = bank.lots.filter((l) => l.availableMinutes === 0);"), "seção B filtrada por availableMinutes === 0");
  assert.ok(c.includes("Totalmente destinado"), "selo do bloco B");
});

check("T07 — bloco totalmente destinadas inicia recolhido", () => {
  const c = central();
  const bloco = c.slice(c.indexOf("lotesTotalmenteDestinados.length > 0 && ("), c.indexOf("{/* Reservas em aberto"));
  assert.ok(bloco.includes('<details className="rounded-2xl border border-slate-200 bg-white">'), "bloco B em <details>");
  assert.ok(!bloco.includes("open"), "SEM atributo open ⇒ recolhido por padrão");
  assert.ok(bloco.includes("Horas [10+] totalmente destinadas ({lotesTotalmenteDestinados.length})"), "título com contagem");
});

check("T08 — cancelar reserva que devolve saldo move o lote de volta para disponíveis", () => {
  reset();
  // reserva ATIVA de 90min lastreada em 28/08 ⇒ available 0 (bloco B)
  const r = actions.createSpecialExcessPlan({
    destinationDate: "2026-09-15", minutes: 90, selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 90 }], asOfDate: ASOF,
  });
  assert.equal(r.ok, true, "reserva criada no motor canônico 4A");
  let lote = bankOf().lots.find((l) => l.originDate === "2026-08-28")!;
  assert.equal(lote.availableMinutes, 0, "reservado consome capacidade (90−0−90)");
  assert.ok(lote.reservedMinutes === 90, "reservado = 90");
  // classificações derivadas (a mesma expressão dos dois blocos na Central)
  assert.ok(!bankOf().lots.filter((l) => l.availableMinutes > 0).some((l) => l.originDate === "2026-08-28"), "está em 'totalmente destinadas'");
  // cancela a reserva ⇒ saldo volta ⇒ lote volta sozinho para 'disponíveis'
  const plano = st().specialExcessPlans![0];
  assert.equal(actions.cancelSpecialExcessPlan({ id: plano.id }).ok, true, "cancelamento pelo fluxo atual (sem rotina paralela)");
  lote = bankOf().lots.find((l) => l.originDate === "2026-08-28")!;
  assert.equal(lote.availableMinutes, 90, "saldo devolvido (derivado)");
  assert.ok(bankOf().lots.filter((l) => l.availableMinutes > 0).some((l) => l.originDate === "2026-08-28"), "lote volta para 'disponíveis' automaticamente");
  // classificação NÃO persistida: nenhum flag novo no store
  const storeSrc = src("src/lib/store.ts");
  assert.ok(!storeSrc.includes("totalmenteDestinad"), "nenhum campo persistido de classificação");
});

/* ════════ T09–T10 — botão Destinar horas na Central ════════ */

check("T09 — botão 'Destinar horas' aparece em origem operacional com available > 0", () => {
  const c = central();
  const cardA = c.slice(c.indexOf("lotesDisponiveis.map"), c.indexOf("lotesTotalmenteDestinados.length > 0"));
  assert.ok(cardA.includes("Destinar horas"), "botão presente nos lotes disponíveis");
  assert.ok(cardA.includes("setDestineLot(lot)"), "abre o modal com o lote pré-selecionado");
  assert.ok(c.includes("destineLot && ("), "modal renderizado com a origem fixa");
});

check("T10 — origem sem destino elegível mantém o lote e desabilita o botão com explicação", () => {
  reset({ withClosure: false });
  // cenou apenas uma origem (24/08, 120min) e um destino — remove os déficits
  actions.replaceAll({
    ...state({ withClosure: false }),
    entries: [p("2026-08-24", "07:00", "entrada"), p("2026-08-24", "12:00", "saida"), p("2026-08-24", "13:00", "entrada"), p("2026-08-24", "20:00", "saida")],
  } as never);
  const b = bankOf();
  assert.equal(b.lots.find((l) => l.originDate === "2026-08-24")!.availableMinutes, 120, "saldo existe");
  assert.equal(dests().length, 0, "nenhum dia elegível abaixo da base");
  const c = central();
  const cardA = c.slice(c.indexOf("lotesDisponiveis.map"), c.indexOf("lotesTotalmenteDestinados.length > 0"));
  assert.ok(cardA.includes("<Button size=\"sm\" variant=\"secondary\" disabled"), "botão DESABILITADO (lote não é escondido)");
  assert.ok(cardA.includes("Não há dias abaixo da base disponíveis para receber estas horas."), "mensagem compacta de explicação");
});

/* ════════ T11–T14 — modal origem→destino ════════ */

check("T11 — modal origem→destino fixa corretamente a origem selecionada", () => {
  const m = modalSrc();
  assert.ok(m.includes('title="Destinar horas [10+]"'), "título do modal");
  assert.ok(m.includes("subtitle={`Origem: ${formatDateShortBR(origin.originDate)} · ciclo ${bank.cycle}`"), "subtítulo com a origem");
  assert.ok(m.includes("Disponível nesta origem"), "saldo da origem fixa exposto");
  assert.ok(m.includes("manualAllocations: [{ originDate: origin.originDate, minutes }]"), "confirmação envia a ORIGEM FIXA (nunca outra)");
  assert.ok(!m.includes("setOrigin"), "a origem NÃO é editável no modal (fixa)");
});

check("T12 — lista apenas destinos realizados com remainingNeed > 0", () => {
  reset();
  // baseline: 4 dias realizados abaixo da base com necessidade restante
  assert.deepEqual(dests().map((d) => d.date), ["2026-05-06", "2026-07-17", "2026-07-24", "2026-08-21"]);
  // 1) dia em aberto (hoje-ish, só entrada) NUNCA entra — status in-progress
  reset({ openDay: "2026-09-02" });
  assert.deepEqual(dests().map((d) => d.date), ["2026-05-06", "2026-07-17", "2026-07-24", "2026-08-21"], "dia em andamento/incompleto excluído");
  // 2) necessidade totalmente coberta (remainingNeed = 0) sai da lista
  assert.equal(destinar("2026-05-06", "2026-08-24", 30).ok, true, "uso cobre os 30min de 06/05");
  assert.deepEqual(dests().map((d) => d.date), ["2026-07-17", "2026-07-24", "2026-08-21"], "06/05 (remainingNeed 0) sai da lista");
  const v = dayView("2026-05-06");
  assert.equal(v.remainingMinutes, 0, "necessidade restante zero (motor canônico)");
});

check("T13 — destino anterior à origem no mesmo ciclo pode aparecer (e ser confirmado)", () => {
  reset();
  const antes = dests().filter((d) => d.date < "2026-08-24").map((d) => d.date);
  assert.deepEqual(antes, ["2026-05-06", "2026-07-17", "2026-07-24", "2026-08-21"], "destinos ANTERIORES à origem 24/08 listados (inclusive 21/08)");
  // confirmação real: destino 24/07 < origem 28/08 (mesmo ciclo) é permitido
  const r = destinar("2026-07-24", "2026-08-28", 30);
  assert.equal(r.ok, true, "destino anterior à origem aceito (semântica 3B: origem posterior é válida)");
  const u = st().specialExcessUses!.at(-1)!;
  assert.equal(u.destinationDate, "2026-07-24");
  assert.equal(u.allocations[0].originDate, "2026-08-28");
});

check("T14 — destinos são ordenados do mais antigo para o mais recente", () => {
  reset();
  const dates = dests().map((d) => d.date);
  const sorted = [...dates].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(dates, sorted, "ordem ascendente (mais antigo primeiro)");
  assert.equal(dates[0], "2026-05-06", "o mais antigo fica no topo (prioridade visual)");
  const m = modalSrc();
  assert.ok(m.includes("destinos.map((d) =>"), "modal renderiza a lista na ordem do derivado (sem reordenar)");
});

/* ════════ T15–T18 — máximos e destinação parcial ════════ */

check("T15 — destino que precisa 120min aparece mesmo se a origem só tem 90min", () => {
  reset();
  const lot28 = bankOf().lots.find((l) => l.originDate === "2026-08-28")!;
  assert.equal(lot28.availableMinutes, 90, "origem 28/08 tem 90min");
  const d17 = dests().find((d) => d.date === "2026-07-17")!;
  assert.equal(d17.remainingNeedMinutes, 120, "destino 17/07 precisa 120min");
  assert.ok(dests().some((d) => d.date === "2026-07-17"), "destino MAIOR que a origem continua listado (nunca escondido)");
  const m = modalSrc();
  assert.ok(m.includes("você pode destinar até"), "explicação 'você pode destinar até X desta origem'");
});

check("T16 — máximo da operação no T15 é 90min (min da origem)", () => {
  reset();
  assert.equal(maxDestinableMinutes(90, 120), 90, "máx. = min(90 origem, 120 destino)");
  // store rejeita 95min da origem (só tem 90) e aceita 90
  const over = destinar("2026-07-17", "2026-08-28", 95);
  assert.equal(over.ok, false);
  assert.equal(over.code, "insufficient-special-balance", "95min > disponível da origem");
  assert.equal(destinar("2026-07-17", "2026-08-28", 90).ok, true, "90min = máximo, aceito");
  assert.equal(bankOf().lots.find((l) => l.originDate === "2026-08-28")!.availableMinutes, 0, "origem esgotada");
});

check("T17 — origem 120min + destino que precisa 30min limita a 30min", () => {
  reset();
  assert.equal(maxDestinableMinutes(120, 30), 30, "máx. = min(120 origem, 30 destino)");
  // 45min > necessidade do destino 06/05 (30) → rejeitado; 30min → ok
  const over = destinar("2026-05-06", "2026-08-24", 45);
  assert.equal(over.ok, false);
  assert.equal(over.code, "requested-exceeds-destination-need", "nunca ultrapassa a base/necessidade efetiva");
  assert.equal(destinar("2026-05-06", "2026-08-24", 30).ok, true, "30min = necessidade, aceito");
  // a origem mantém o resto (nunca cria hora extra artificial no destino)
  assert.equal(bankOf().lots.find((l) => l.originDate === "2026-08-24")!.availableMinutes, 90, "24/08 resta 90min");
  assert.equal(dayView("2026-05-06").remainingMinutes, 0, "destino completado (30−30)");
});

check("T18 — destinação parcial menor que o máximo é aceita", () => {
  reset();
  // origem 24/08 (120) → destino 24/07 (precisa 60): destinar 15min
  assert.equal(destinar("2026-07-24", "2026-08-24", 15).ok, true, "parcial 15min < máximo 60min");
  assert.equal(bankOf().lots.find((l) => l.originDate === "2026-08-24")!.availableMinutes, 105, "120−15");
  assert.equal(dayView("2026-07-24").remainingMinutes, 45, "destino ainda precisa 45min");
  const u = st().specialExcessUses!.at(-1)!;
  assert.equal(u.allocations[0].minutes, 15, "uso parcial persistido como uso comum");
});

/* ════════ T19–T21 — preview, motor único e equivalência ════════ */

check("T19 — preview preserva factual e altera somente a projeção", () => {
  reset();
  const antes = row("2026-07-24");
  assert.equal(antes.workedMinutes, 420);
  assert.equal(antes.registrableMinutes, 420);
  assert.equal(antes.balanceMinutes, -60);
  assert.equal(destinar("2026-07-24", "2026-08-28", 30).ok, true);
  const depois = row("2026-07-24");
  assert.equal(depois.workedMinutes, antes.workedMinutes, "jornada factual INALTERADA");
  assert.equal(depois.registrableMinutes, antes.registrableMinutes, "registrável inalterado");
  assert.equal(depois.balanceMinutes, antes.balanceMinutes, "saldo regular factual inalterado");
  const v = dayView("2026-07-24");
  assert.equal(v.projection!.workedMinutes, 450, "projeção do ponto: 420 + 30 (novo uso)");
  assert.equal(v.projection!.balanceMinutes, -30, "saldo projetado: −60 + 30");
  const m = modalSrc();
  assert.ok(m.includes("projectRealizedDayOfficial"), "preview usa o motor 3A (sem fórmula paralela)");
  assert.ok(m.includes("inalterada"), "preview exibe 'Jornada factual: inalterada'");
  assert.ok(m.includes("Projeção no ponto") && m.includes("Saldo projetado"), "linhas de projeção");
});

check("T20 — confirmação cria SpecialExcessUse/alocação no MESMO motor do fluxo destino→origem", () => {
  reset();
  // O modal confirma chamando EXATAMENTE a ação canônica 3D (fonte do componente):
  const m = modalSrc();
  assert.ok(m.includes("actions.createSpecialExcessUse({"), "mesma ação do fluxo atual (3D)");
  assert.ok(m.includes('allocationStrategy: "manual"'), "origem escolhida ⇒ estratégia manual");
  const mSemHeader = m.replace(/\/\*[\s\S]*?\*\//, ""); // descarta o cabeçalho (onde o motor é documentado)
  assert.equal((mSemHeader.match(/actions\./g) ?? []).length, 1, "única escrita do store no modal: createSpecialExcessUse (motor único)");
  // comportamento: o uso nasce no registro canônico e passa na validação 3B
  const r = destinar("2026-07-24", "2026-08-28", 30);
  assert.equal(r.ok, true);
  const u = st().specialExcessUses!.at(-1)!;
  assert.deepEqual(u.allocations, [{ originDate: "2026-08-28", minutes: 30 }], "allocation da origem fixa");
  assert.equal(u.allocationStrategy, "manual");
  assert.equal(u.status, "utilizado", "nasce 'utilizado' (modelo 3B)");
  assert.ok(validateSpecialExcessUse(u).ok, "registro estruturalmente válido (3B)");
});

check("T21 — resultado origem→destino é semanticamente equivalente ao fluxo destino→origem", () => {
  const normalizar = (u: SpecialExcessUse) => ({
    destinationDate: u.destinationDate,
    allocations: u.allocations.map((a) => ({ originDate: a.originDate, minutes: a.minutes, carried: a.carried })),
    allocationStrategy: u.allocationStrategy,
    status: u.status,
  });
  // A) fluxo atual: dia 24/07 → "Completar jornada com [10+]" → modo manual → origem 28/08, 30min
  reset();
  const a = actions.createSpecialExcessUse({
    destinationDate: "2026-07-24", minutes: 30, allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }], asOfDate: ASOF,
  });
  assert.equal(a.ok, true);
  const useA = st().specialExcessUses!.at(-1)!;
  const bankA = bankOf();
  const projA = dayView("2026-07-24").projection!;
  // B) fluxo inverso: origem 28/08 → "Destinar horas" → destino 24/07, 30min (MESMO parâmetro do modal T20)
  reset();
  const b = destinar("2026-07-24", "2026-08-28", 30);
  assert.equal(b.ok, true);
  const useB = st().specialExcessUses!.at(-1)!;
  const bankB = bankOf();
  const projB = dayView("2026-07-24").projection!;
  // equivalência: mesma origem, mesmo destino, mesmos minutos, mesma estratégia, mesma rastreabilidade
  assert.deepEqual(normalizar(useB), normalizar(useA), "registro persistido semanticamente equivalente");
  assert.equal(bankB.lots.find((l) => l.originDate === "2026-08-28")!.availableMinutes, bankA.lots.find((l) => l.originDate === "2026-08-28")!.availableMinutes, "mesmo saldo restante da origem");
  assert.equal(bankB.availableMinutes, bankA.availableMinutes, "mesmo banco do ciclo");
  assert.equal(projB.workedMinutes, projA.workedMinutes, "mesma projeção no ponto");
  assert.equal(projB.balanceMinutes, projA.balanceMinutes, "mesmo saldo projetado");
});

/* ════════ T22–T24 — consolidação e ciclo anual ════════ */

check("T22 — origem em período consolidado + ciclo aberto PODE Destinar horas", () => {
  reset({ consols: [CONSOL_AGO] });
  // 28/08 está dentro do período consolidado 21/08–20/09; o saldo do banco continua operacional
  assert.ok(dateFallsInClosedCycle(st().annualCycleClosures, "2026-08-28") === false, "ciclo anual AINDA aberto");
  assert.equal(bankOf().lots.find((l) => l.originDate === "2026-08-28")!.availableMinutes, 90, "saldo remanescente intacto");
  // store: origem consolidada NÃO é bloqueada (a consolidação protege o DESTINO, não a origem)
  const r = destinar("2026-07-24", "2026-08-28", 30);
  assert.equal(r.ok, true, "uso criado com origem em período consolidado (ciclo aberto)");
  // UI: o botão do card NÃO é gateado pela consolidação da origem (só ciclo aberto + saldo > 0)
  const card = dayCard();
  const bloco = card.slice(card.indexOf("specialOrigin && onDestineOrigin ? ("), card.indexOf(") : specialCarriedOut ? ("));
  assert.ok(bloco.includes("Destinar horas"), "botão no bloco de origem");
  assert.ok(!bloco.includes("consolidat"), "bloco NÃO consulta consolidação (ro não impede)");
  const reg = registros();
  assert.ok(reg.includes("const especialGate = !cicloEncerrado && loteOrigem && loteOrigem.availableMinutes > 0") ||
            reg.includes("!cicloEncerrado && loteOrigem && loteOrigem.availableMinutes > 0"), "gate = ciclo aberto + saldo (sem guarda de consolidação na origem)");
});

check("T23 — destino em período consolidado NÃO pode receber novo uso [10+]", () => {
  reset({ consols: [CONSOL_AGO] });
  // 21/08 está dentro do período consolidado → excluído da lista de destinos
  assert.ok(!dests().some((d) => d.date === "2026-08-21"), "21/08 consolidado fora dos elegíveis");
  assert.deepEqual(dests().map((d) => d.date), ["2026-05-06", "2026-07-17", "2026-07-24"], "demais destinos preservados");
  // store continua sendo a defesa real: confirmação direta é bloqueada
  const r = destinar("2026-08-21", "2026-08-24", 30);
  assert.equal(r.ok, false, "destino consolidado rejeitado no motor (4G intacto)");
  assert.equal(r.code, "consolidated");
});

check("T24 — origem em ciclo anual encerrado não mostra 'Destinar horas' em Registros", () => {
  reset();
  assert.equal(dateFallsInClosedCycle(st().annualCycleClosures, "2026-04-28"), true, "28/04 pertence ao ciclo 2025/2026 encerrado");
  const reg = registros();
  assert.ok(reg.includes("const cicloEncerrado = dateFallsInClosedCycle(annualCycleClosures, date);"), "card do dia detecta ciclo encerrado (fonte canônica 4H)");
  assert.ok(reg.includes("!cicloEncerrado && loteOrigem && loteOrigem.availableMinutes > 0"), "botão SOMENTE com ciclo aberto + saldo");
  // e o comportamento: mesmo que o lote tivesse saldo, ciclo encerrado ⇒ sem origem operacional
  const loteFicticio = { availableMinutes: 30 };
  const especialOrigin = !dateFallsInClosedCycle(st().annualCycleClosures, "2026-04-28") && loteFicticio && loteFicticio.availableMinutes > 0;
  assert.equal(especialOrigin, false, "gate do card: ciclo encerrado ⇒ null (sem botão)");
  // store concorda: ciclo encerrado bloqueia novo uso (mesma fronteira)
  const r = actions.createSpecialExcessUse({
    destinationDate: "2025-09-15", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF,
  });
  assert.equal(r.ok, false, "novo uso em ciclo encerrado bloqueado");
  assert.equal(r.code, "cycle-closed");
});

/* ════════ T25–T27 — transportado + DayCard origem ════════ */

check("T25 — saldo transportado é destinável pela Central do novo ciclo", () => {
  reset();
  const lotCarried = bankOf().lots.find((l) => l.originDate === "2026-04-28")!;
  assert.equal(lotCarried.availableMinutes, 90, "28/04 transportado operacional no ciclo 2026/2027");
  assert.ok(lotOperatesInCycle(lotCarried, CYC()), "lote opera no ciclo atual (transporte formal)");
  const r = destinar("2026-08-21", "2026-04-28", 30);
  assert.equal(r.ok, true, "destinação de saldo transportado no ciclo novo (4H.1)");
  const u = st().specialExcessUses!.at(-1)!;
  assert.equal(u.allocations[0].carried, true, "allocation marcada como transportada (motor canônico)");
  assert.equal(bankOf().lots.find((l) => l.originDate === "2026-04-28")!.availableMinutes, 60, "90−30");
  // Central: o lote transportado fica em 'disponíveis' com o botão (sem exclusão de carried)
  const c = central();
  const cardA = c.slice(c.indexOf("lotesDisponiveis.map"), c.indexOf("lotesTotalmenteDestinados.length > 0"));
  assert.ok(cardA.includes("Trazido · origem factual"), "lote transportado identificado como 'Trazido' (proveniência)");
  assert.ok(cardA.includes("Trazido do ciclo"), "contexto do ciclo de origem exibido");
  assert.ok(!cardA.includes("!lot.carried && <Button") && !cardA.includes("lot.carried ? (<Button"), "botão NÃO exclui lotes transportados");
});

check("T26 — card histórico da origem transportada (ciclo encerrado) não mostra 'Destinar horas' e mantém informação do transporte", () => {
  reset();
  const info = carriedOutForDate(st().annualCycleClosures, "2026-04-28");
  assert.ok(info !== null, "rastreabilidade do transporte derivada do fechamento");
  assert.equal(info!.minutes, 90, "90min transportadas de 28/04");
  assert.equal(info!.destinationCycleLabel, "2026/2027", "destino do transporte: novo ciclo");
  const reg = registros();
  assert.ok(reg.includes("carriedOutForDate(annualCycleClosures, date)"), "card do dia recebe a informação do transporte (derivada)");
  const card = dayCard();
  const idxCarried = card.indexOf(") : specialCarriedOut ? (");
  const ramoCarried = card.slice(idxCarried, idxCarried + 1600); // janela só do ramo carried (encerra em `) : null}`)
  assert.ok(ramoCarried.includes("transportadas para o ciclo"), "texto histórico do transporte no card antigo");
  assert.ok(ramoCarried.includes(") : null}"), "janela termina exatamente no fim do ramo (antes de qualquer outro JSX)");
  assert.ok(!ramoCarried.slice(0, ramoCarried.indexOf(") : null}")).includes("Destinar horas"), "SEM botão no card do ciclo encerrado");
  const ramoOrigin = card.slice(card.indexOf("specialOrigin && onDestineOrigin ? ("), card.indexOf(") : specialCarriedOut ? ("));
  assert.ok(ramoOrigin.includes("Destinar horas"), "botão só no ramo de origem operacional");
});

check("T27 — DayCard de origem do ciclo aberto com saldo disponível mostra 'Destinar horas' e abre o MESMO modal", () => {
  reset();
  const lote = bankOf().lots.find((l) => l.originDate === "2026-08-24")!;
  assert.equal(lote.availableMinutes, 120, "origem 24/08 com saldo no ciclo aberto");
  // simulação do gate do card (MESMA expressão da página):
  const especialOrigin = !dateFallsInClosedCycle(st().annualCycleClosures, "2026-08-24") && lote && lote.availableMinutes > 0;
  assert.equal(especialOrigin, true, "ciclo aberto + saldo ⇒ origem operacional");
  const card = dayCard();
  assert.ok(card.includes("[10+] gerado: <b"), "card mostra [10+] gerado");
  assert.ok(card.includes("[10+] disponível:"), "card mostra [10+] disponível");
  assert.ok(card.includes("Destinar horas"), "botão no DayCard da origem");
  assert.ok(card.includes("onClick={() => onDestineOrigin(d.date)}"), "abre o fluxo com o dia da origem");
  // MESMO componente da Central (um único modal, um único motor):
  const reg = registros();
  assert.ok(reg.includes('from "@/components/special-excess-destine-modal"'), "Registros importa o modal canônico");
  assert.ok(reg.includes("<SpecialExcessDestineModal"), "modal renderizado em Registros");
  const c = central();
  assert.ok(c.includes('from "@/components/special-excess-destine-modal"'), "Central importa o MESMO modal");
});

/* ════════ T28 — mobile (320/360/412) ════════ */

check("T28 — 320/360/412 sem overflow e modal utilizável", () => {
  const card = dayCard();
  const c = central();
  const m = modalSrc();
  const ui = src("src/components/ui.tsx");
  // 1) Cards de origem (Central e DayCard): flex-wrap + min-w-0; data curta (dd/mm)
  //    via formatDateShortBR; estatísticas quebram em linhas; botão w-full no
  //    mobile (não estoura) e sm:w-auto no desktop. ORÇAMENTO 320px:
  //      página ≈ 32px de padding ⇒ 288px úteis; data "28/07" ≈ 40px;
  //      "1h30 disponíveis" ≈ 110px; botão ocupa a linha inteira (w-full)
  //      quando não couber ao lado — wrap garante SEM scroll horizontal.
  const cardA = c.slice(c.indexOf("lotesDisponiveis.map"), c.indexOf("lotesTotalmenteDestinados.length > 0"));
  assert.ok(cardA.includes("flex flex-wrap items-start justify-between gap-x-4 gap-y-2"), "Central: header do lote com wrap (data | valor | ação)");
  assert.ok(cardA.includes("min-w-0"), "Central: coluna de data com min-w-0 (quebra sem estourar)");
  assert.ok(cardA.includes('className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"'), "botão w-full no mobile / auto no desktop");
  assert.ok(cardA.includes("formatDateShortBR(lot.originDate)"), "data curta dd/mm (não quebra de forma ruim)");
  assert.ok(!cardA.includes("w-[") && !cardA.includes("min-w-["), "Central: nenhuma largura fixa nos lotes");
  const blocoCard = card.slice(card.indexOf("specialOrigin && onDestineOrigin ? ("), card.indexOf(") : specialCarriedOut ? ("));
  assert.ok(blocoCard.includes("flex flex-wrap items-center justify-between gap-x-4 gap-y-2"), "DayCard: bloco origem com wrap");
  assert.ok(blocoCard.includes('className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"'), "DayCard: botão w-full no mobile");
  assert.ok(!blocoCard.includes("w-[") && !blocoCard.includes("min-w-["), "DayCard: sem largura fixa");
  // 2) Modal: lista de destinos legível (linhas com wrap), quantidade
  //    acessível (input full-width + atalhos que quebram), CTA acessível
  //    (w-full no mobile) e SCROLL INTERNO quando necessário — sem corte.
  assert.ok(m.includes("flex flex-wrap items-center justify-between gap-x-3 gap-y-1"), "linha de destino com wrap (data | falta)");
  assert.ok(m.includes("max-h-64 space-y-2 overflow-y-auto"), "lista de destinos com scroll interno (sem estourar o modal)");
  assert.ok(m.includes("QUICK_OPTIONS.filter((m) => m <= maxOp)"), "atalhos de quantidade filtrados pelo máximo (acessíveis)");
  assert.ok(m.includes('className="w-full !bg-violet-600 hover:!bg-violet-700 active:!bg-violet-800 sm:w-auto"'), "CTA w-full no mobile");
  assert.ok(!m.includes("w-screen") && !m.includes("overflow-x"), "modal sem vetor de scroll horizontal");
  // 3) O container do modal (ui.tsx) já dá o teto + scroll em qualquer viewport
  assert.ok(ui.includes("max-h-[92vh] overflow-y-auto"), "modal: altura máxima + scroll interno (320/360/412)");
  assert.ok(ui.includes("w-full rounded-t-2xl bg-white shadow-2xl sm:m-4"), "modal: largura total no mobile (bottom sheet)");
});

console.log(`\n4H.2 — ${passed}/28 verificações concluídas.`);
if (passed !== 28) process.exit(1);
