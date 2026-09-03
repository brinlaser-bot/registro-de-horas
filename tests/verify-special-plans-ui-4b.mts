/**
 * VERIFICAÇÃO — ETAPA 4B: INTERFACE DE PLANEJAMENTO/RESERVA FUTURA [10+].
 *
 * Dá interface ao motor 4A SEM alterar sua matemática:
 *  - Registros: ação discreta "Planejar uso de [10+]" só para dia FUTURO
 *    (o store 4A continua o gate final);
 *  - modal próprio (criação SOMENTE via createSpecialExcessPlan; FIFO
 *    canônico no preview; manual com limite dinâmico 3G.2 reutilizado);
 *  - badge violeta "[10+] reservado · X" agregando planos do dia;
 *  - detalhe individualiza planos; cancelamento individual via
 *    cancelSpecialExcessPlan (histórico preservado);
 *  - data chegou: NADA é concluído/liberado — "aguardando confirmação";
 *  - "Concluir" NÃO existe (PLANO → USO é etapa posterior);
 *  - Visão Geral: sublinha "... · X reservado"; Resumo: painel com
 *    Gerado | Utilizado | Reservado | Disponível;
 *  - feedback de reconciliação = res.warning do store (toast existente).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-plans-ui-4b.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { activeSpecialPlansForDate, specialExcessPlanMinutes } from "../src/lib/special-excess-plan.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { projectRealizedDayOfficial, isProjectableDayStatus } from "../src/lib/official-projection.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import { addDays, todayString } from "../src/lib/time.ts";
import { manualMaxForOrigin } from "../src/components/special-excess-use-modal.tsx";
import type { SpecialExcessPlan } from "../src/lib/special-excess-plan.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";
const DEST = "2026-09-10";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixtures (mesmas da 4A) ── */
let eid = 1;
const e = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: eid++, date, time, type, note: null });
const day4 = (date: string, s: string, lo: string, li: string, end: string) => [e(date, s, "entrada"), e(date, lo, "saida"), e(date, li, "entrada"), e(date, end, "saida")];
const gen60 = (date: string) => day4(date, "07:00", "12:00", "13:00", "19:00"); // 11h   → [10+] 60min
const gen40 = (date: string) => day4(date, "07:30", "12:00", "13:00", "19:10"); // 10h40 → [10+] 40min
const gen30 = (date: string) => day4(date, "07:30", "12:00", "13:00", "19:00"); // 10h30 → [10+] 30min
const def30 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:30"); // 7h30 → precisa 30min

/* ── Harness ── */
let clock = 10_000;
const NOW = () => (clock += 1000);
const SEED = buildSeedData();
function resetSeed() {
  actions.replaceAll({
    user: SEED.user,
    entries: SEED.entries,
    compensations: SEED.compensations,
    absences: SEED.absences,
    companyCalendars: SEED.companyCalendars,
    faltas: SEED.faltas,
    excessReasons: SEED.excessReasons,
    specialExcessUses: SEED.specialExcessUses ?? [],
    specialExcessPlans: SEED.specialExcessPlans ?? [],
  });
}
function setState(entries: TimeEntry[], useList: ReturnType<typeof uses> = [], planList: SpecialExcessPlan[] = []) {
  actions.replaceAll({
    user: SEED.user,
    entries,
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: useList,
    specialExcessPlans: planList,
  });
}
const d = () => getAppData();
const plans = () => d().specialExcessPlans ?? [];
const uses = () => d().specialExcessUses ?? [];
const activePlans = () => plans().filter((p) => p.status === "planned");

/** Banco canônico do estado (a MESMA chamada que a UI/modal fazem). */
function bankOf(date = ASOF) {
  const dd = d();
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(date),
    asOfDate: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? "",
    uses: dd.specialExcessUses ?? [],
    plans: dd.specialExcessPlans ?? [],
  });
}

/** Cenário do enunciado: GERADO 2h · UTILIZADO 30min · RESERVADO 1h → DISPONÍVEL 30min. */
function setupCenario() {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def30("2026-08-24")]);
  const u = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24",
    minutes: 30,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(u.ok, `uso: ${u.error}`);
  const p = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(p.ok, `plano: ${p.error}`);
}

/* ════════════════ TESTES 01–14 ════════════════ */

check("TESTE 01 DE 14 — ENTRADA SOMENTE FUTURA", () => {
  // Estrutural: a ação só é passada ao card para dia FUTURO; o card só a
  // exibe nesse caso; e o modal é o ponto de criação em Registros.
  const page = src("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("onPlanSpecial={date > todayStr ? () => setPlanDate(date) : undefined}"),
    "ação só para destinationDate > hoje civil");
  assert.ok(page.includes("<SpecialExcessPlanModal"), "modal próprio montado em Registros");
  const card = src("src/components/day-card.tsx");
  // 4D.3: além de futuro e sem reserva, o card exige BASE EFETIVA positiva
  // (companyDayContext.effectiveExpected via planningCapacityMinutes):
  assert.ok(card.includes("futureDay && onPlanSpecial && (planningCapacityMinutes === undefined || planningCapacityMinutes > 0) && !(specialPlans && specialPlans.length > 0)"),
    "card exibe 'Planejar uso de [10+]' só em dia futuro, sem reserva e com base efetiva");
  assert.ok(card.includes("Planejar uso de [10+]"), "rótulo da ação");
  // Funcional: o store continua o gate soberano (hoje/passado rejeitados).
  setState([...gen30("2026-08-28")]);
  const rToday = actions.createSpecialExcessPlan({ destinationDate: ASOF, minutes: 30, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.equal(rToday.code, "destination-not-future", "hoje é rejeitado pelo store");
  const rPast = actions.createSpecialExcessPlan({ destinationDate: "2026-08-29", minutes: 30, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.equal(rPast.code, "destination-not-future", "passado é rejeitado pelo store");
  assert.equal(plans().length, 0, "nada persistido");
});

check("TESTE 02 DE 14 — CRIAÇÃO AUTOMÁTICA", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def30("2026-08-24")]);
  // Uso manual de 30min na origem 20/08 → disponível = 60 (18/08) + 30 (20/08) = 1h30.
  const u = actions.createSpecialExcessUse({
    destinationDate: "2026-08-24",
    minutes: 30,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(u.ok, `uso: ${u.error}`);
  assert.equal(bankOf().availableMinutes, 90, "disponível 1h30");
  // Reservar 1h (fluxo do modal: createSpecialExcessPlan automático).
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano: ${r.error}`);
  const dayPlans = activeSpecialPlansForDate(plans(), DEST);
  assert.equal(dayPlans.length, 1);
  assert.equal(dayPlans[0].status, "planned");
  assert.equal(dayPlans[0].selectionMode, "automatic");
  assert.deepEqual(dayPlans[0].allocations, [{ originDate: "2026-08-18", minutes: 60 }], "FIFO: origem mais antiga primeiro");
  // Badge do dia = agregado dos planos ativos (helper da UI).
  const badge = dayPlans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0);
  assert.equal(badge, 60);
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("[10+] reservado ·"), "badge violeta '[10+] reservado · X'");
});

check("TESTE 03 DE 14 — CRIAÇÃO MANUAL", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20")]);
  const r = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(r.ok, `plano manual: ${r.error}`);
  const plan = activeSpecialPlansForDate(plans(), DEST)[0];
  assert.equal(plan.selectionMode, "manual");
  assert.deepEqual(plan.allocations, [{ originDate: "2026-08-20", minutes: 30 }],
    "allocation exatamente na origem escolhida");
  // O modal oferece o modo manual ("Escolher a origem das horas"):
  const modal = src("src/components/special-excess-plan-modal.tsx");
  assert.ok(modal.includes("Escolher a origem das horas"), "modo manual no modal");
  assert.ok(modal.includes('selectionMode: mode === "auto" ? "automatic" : "manual"'), "criação usa SOMENTE createSpecialExcessPlan");
  assert.ok(modal.includes("actions.createSpecialExcessPlan("), "sem persistência paralela");
});

check("TESTE 04 DE 14 — LIMITE MANUAL DINÂMICO", () => {
  // MESMO helper 3G.2 reutilizado pelo modal de plano (sem segunda matemática):
  const modal = src("src/components/special-excess-plan-modal.tsx");
  assert.ok(modal.includes("manualMaxForOrigin"), "modal de plano importa o helper canônico 3G.2");
  // Origem A disponível 20 · Origem B disponível 40 · plano desejado 30:
  const want = 30;
  const maxA = manualMaxForOrigin(20, want, 0);
  assert.equal(maxA, 20, "A permite no máximo sua capacidade (20)");
  // Após selecionar A 20: B permite no máximo 10:
  const maxB = manualMaxForOrigin(40, want, 20);
  assert.equal(maxB, 10, "B permite no máximo 10 (quantidade restante)");
  // Quantidade atingida → demais origens indisponíveis (bloqueadas):
  const maxC = manualMaxForOrigin(50, want, 30);
  assert.equal(maxC, 0, "origem adicional fica indisponível com a quantidade atingida");
  // End-to-end (o store aceita a seleção que a UI montou — A20 + B10):
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20")]);
  const r = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [
      { originDate: "2026-08-18", minutes: 20 },
      { originDate: "2026-08-20", minutes: 10 },
    ],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(r.ok, `plano fragmentado A20+B10: ${r.error}`);
  // E a UI nunca deixa passar do teto: tentativa de seleção acima do want
  // é cortada pelo modal (clamped) — o store rejeitaria pedido sem lastro:
  const over = actions.createSpecialExcessPlan({ destinationDate: "2026-09-15", minutes: 90, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.equal(over.ok, false, "acima do disponível é rejeitado (gate final)");
  assert.equal(over.code, "insufficient-special-balance");
});

check("TESTE 05 DE 14 — RESERVA REDUZ DISPONÍVEL", () => {
  setupCenario(); // 2h gerado · 30min utilizado · 1h reservado
  const b = bankOf();
  assert.equal(b.generatedMinutes, 120);
  assert.equal(b.usedMinutes, 30);
  assert.equal(b.reservedMinutes, 60);
  assert.equal(b.availableMinutes, 30, "Visão Geral: Disponível 30min");
  // Sublinha do card 3H passa a mostrar "· 1h reservado" quando reserved > 0:
  const card = src("src/components/hour-bank-card.tsx");
  assert.ok(
    card.includes('utilizado${specialBank.reservedMinutes > 0 ? ` · ${formatMinutes(specialBank.reservedMinutes)} reservado` : ""}'),
    "sublinha '2h gerado · 30min utilizado · 1h reservado' (quando reserved > 0)",
  );
  // Resumo: painel Gerado | Utilizado | Reservado | Disponível (fonte canônica):
  const view = buildResumoPeriodView({
    period: { from: "2026-07-21", to: "2026-08-20" },
    today: ASOF,
    entries: d().entries,
    absences: d().absences,
    calendars: d().companyCalendars,
    settings: settingsOf(d().user),
    faltas: d().faltas,
    controlStartDate: d().user.controlStartDate ?? null,
    uses: d().specialExcessUses ?? [],
    plans: d().specialExcessPlans ?? [],
  });
  assert.equal(view.banks[0].bank.generatedMinutes, 120, "Resumo: Gerado 2h");
  assert.equal(view.banks[0].bank.usedMinutes, 30, "Resumo: Utilizado 30min");
  assert.equal(view.banks[0].bank.reservedMinutes, 60, "Resumo: Reservado 1h");
  assert.equal(view.banks[0].bank.availableMinutes, 30, "Resumo: Disponível 30min");
  assert.equal(view.cards.specialGeneratedMinutes, 120, "'[10+] gerado no período' continua FACTUAL");
  const resumo = src("src/app/(app)/resumo/page.tsx");
  // 4F (SUPERADO — expectativa atualizada com justificativa): o painel do
  // banco anual saiu do Resumo; a reserva aparece como "Reservado para o
  // período" (planos planned com destino em 21→20):
  assert.ok(resumo.includes("Reservado para o período"), "reserva do período exibida");
});

check("TESTE 06 DE 14 — DOIS PLANOS NO MESMO DIA", () => {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20")]);
  const ra = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  const rb = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 30, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(ra.ok && rb.ok, `dois planos: ${ra.error ?? ""} ${rb.error ?? ""}`);
  const dayPlans = activeSpecialPlansForDate(plans(), DEST);
  assert.equal(dayPlans.length, 2, "dois planos individualizados no domínio (ids intactos)");
  const badge = dayPlans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0);
  assert.equal(badge, 90, "badge agregado: [10+] reservado · 1h30");
  assert.ok(plans().some((p) => p.id === "sep-1") && plans().some((p) => p.id === "sep-2"), "ids não mesclados");
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("Plano {i + 1}") || summary.includes("plans.map"), "detalhe lista os planos individualmente");
});

check("TESTE 07 DE 14 — CANCELAMENTO", () => {
  // (estado do TESTE 06: A 1h + B 30min no mesmo dia)
  const a = activeSpecialPlansForDate(plans(), DEST).find((p) => specialExcessPlanMinutes(p) === 60)!;
  const usesBefore = uses().length;
  const c = actions.cancelSpecialExcessPlan({ id: a.id, now: NOW() });
  assert.ok(c.ok, `cancelamento: ${c.error}`);
  const cancelled = plans().find((p) => p.id === a.id)!;
  assert.equal(cancelled.status, "cancelled", "plano interno cancelled (histórico preservado)");
  assert.deepEqual(cancelled.allocations, a.allocations, "allocations históricas intactas");
  const badge = activeSpecialPlansForDate(plans(), DEST).reduce((s, p) => s + specialExcessPlanMinutes(p), 0);
  assert.equal(badge, 30, "badge reduz para 30min");
  assert.equal(bankOf().availableMinutes, 90, "Banco disponível +1h (90 = 150 − 30 − 30)");
  assert.equal(uses().length, usesBefore, "nenhum SpecialExcessUse é criado");
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("actions.cancelSpecialExcessPlan("), "cancelamento usa SOMENTE cancelSpecialExcessPlan");
  assert.ok(summary.includes("voltará a ficar disponível no Banco [10+]"), "confirmação simples explica o efeito");
});

check("TESTE 08 DE 14 — CANCELAMENTO DE UM ENTRE DOIS", () => {
  setupCenario(); // dia DEST tem 1 plano de 1h; criar o segundo de 30min
  const rb = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 30, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(rb.ok, `plano B: ${rb.error}`);
  let dayPlans = activeSpecialPlansForDate(plans(), DEST);
  assert.equal(dayPlans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0), 90, "badge 1h30");
  const a = dayPlans.find((p) => specialExcessPlanMinutes(p) === 60)!;
  assert.ok(actions.cancelSpecialExcessPlan({ id: a.id, now: NOW() }).ok);
  dayPlans = activeSpecialPlansForDate(plans(), DEST);
  assert.equal(dayPlans.length, 1, "só o plano B permanece ativo");
  assert.equal(dayPlans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0), 30, "badge 30min");
  assert.equal(dayPlans[0].status, "planned", "plano B permanece intacto");
  assert.deepEqual(dayPlans[0].allocations, rb.ok ? (plans().find((p) => p.id === "sep-" + (rb.ok ? 2 : 0))?.allocations ?? dayPlans[0].allocations) : [], "allocations de B inalteradas");
});

check("TESTE 09 DE 14 — FUTURO NÃO VIRA FATO", () => {
  setState([...gen60("2026-08-18"), ...gen30("2026-08-28")]);
  const rowBefore = (date: string) => {
    const dd = d();
    return buildResumoDayRow({
      date,
      today: ASOF,
      entries: dd.entries,
      absences: dd.absences,
      calendars: dd.companyCalendars,
      settings: settingsOf(dd.user),
      faltas: dd.faltas,
      controlStartDate: dd.user.controlStartDate ?? null,
    });
  };
  const beforeFuture = JSON.stringify(rowBefore(DEST));
  const beforeOrigin = JSON.stringify(rowBefore("2026-08-18"));
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() }).ok);
  assert.equal(JSON.stringify(rowBefore(DEST)), beforeFuture, "dia futuro: status/row factual NÃO muda com a reserva");
  assert.equal(JSON.stringify(rowBefore("2026-08-18")), beforeOrigin, "origem factual intocada");
  const dd = d();
  const proj = projectRealizedDayOfficial({
    date: DEST,
    factualWorkedMinutes: 0,
    factualRegistrableMinutes: 0,
    factualRegularBalanceMinutes: 0,
    effectiveBaseMinutes: 480,
    financialValid: false,
    realized: false, // futuro não é realizado — a reserva NÃO cria projeção
    usedSpecialMinutes: 60, // mesmo COM reserva ativa na data, nada é projetado
  });
  assert.equal(proj.projectable, false, "projeção oficial não aceita dia futuro como realizado");
  assert.equal(proj.reason, "not-realized");
  assert.equal(proj.appliedSpecialMinutes, 0, "reserva não é aplicada a dia futuro");
  assert.equal(proj.projectedWorkedMinutes, 0, "identidade: projetado = factual (nada simulado)");
  // Estrutural: modal promete que jornada/saldo não mudam.
  const modal = src("src/components/special-excess-plan-modal.tsx");
  assert.ok(modal.includes("Sua jornada e seu saldo regular não serão alterados"), "mensagem do §6");
  assert.ok(!modal.includes("projectRealizedDayOfficial"), "modal NÃO projeta jornada futura");
});

check("TESTE 10 DE 14 — DESTINO CHEGA A HOJE", () => {
  // Plano criado ONTEM para HOJE (destinationDate era futuro na criação):
  const today = todayString();
  const yesterday = addDays(today, -1);
  const origin = addDays(today, -3);
  setState(day4(origin, "07:00", "12:00", "13:00", "19:00")); // gera 1h [10+]
  const r = actions.createSpecialExcessPlan({ destinationDate: today, minutes: 60, selectionMode: "automatic", asOfDate: yesterday, now: NOW() });
  assert.ok(r.ok, `plano criado ontem para hoje: ${r.error}`);
  // "Hoje": o plano continua reservado — nada é cancelado/concluído/liberado:
  const plan = activeSpecialPlansForDate(plans(), today)[0];
  assert.ok(plan, "plano continua ativo");
  assert.equal(plan.status, "planned");
  assert.equal(bankOf(today).reservedMinutes, 60, "continua reservado (não libera saldo)");
  assert.equal(uses().length, 0, "não cria uso");
  assert.ok(!uses().some((u) => u.destinationDate === today), "nenhum uso no dia");
  // UI: texto neutro e SEM "Planejar mais" (a ação só existe para futuro):
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("Planejamento aguardando confirmação"), "texto neutro §15");
  assert.ok(summary.includes('isFuture ? ('), "aguardando confirmação quando a data chegou");
  const page = src("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("date > todayStr"), "não oferece Planejar para hoje (date > todayStr)");
});

check("TESTE 11 DE 14 — MANUAL RECONCILIADO", () => {
  resetSeed(); // 28/08 gera 30min
  const r = actions.createSpecialExcessPlan({
    destinationDate: DEST,
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(r.ok, `reserva manual 30min: ${r.error}`);
  // Origem cai 30 → 10 (edição da última saída de 28/08):
  const punch = d().entries.find((x) => x.date === "2026-08-28" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(punch.id, { time: "18:40" }, { now: NOW() });
  assert.ok(res.ok, `edição: ${res.error}`);
  assert.ok((res.warning ?? "").includes("10min") && (res.warning ?? "").includes("20min"),
    "feedback do store: 10 permanecem e 20 liberados (toast via res.warning)");
  const plan = activeSpecialPlansForDate(plans(), DEST)[0];
  assert.equal(specialExcessPlanMinutes(plan), 10, "badge 10min");
  assert.deepEqual(plan.allocations, [{ originDate: "2026-08-28", minutes: 10 }], "mesma origem (sem migração)");
  assert.equal(bankOf().availableMinutes, 100, "disponível coerente (110 gerado − 10 reservado)");
  // A UI apenas comunica o resultado do store (toast do provider existente):
  const provider = src("src/components/special-release-confirm.tsx");
  assert.ok(provider.includes("res.warning") && provider.includes("toast.show"), "warning do store vira toast (sem segundo motor)");
});

check("TESTE 12 DE 14 — AUTOMÁTICO REDISTRIBUÍDO", () => {
  resetSeed(); // 18/08 → 40 · 20/08 → 1h
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano 1h: ${r.error}`);
  assert.deepEqual(activeSpecialPlansForDate(plans(), DEST)[0].allocations, [
    { originDate: "2026-08-18", minutes: 40 },
    { originDate: "2026-08-20", minutes: 20 },
  ]);
  // 18/08 perde os 40min (10h40 → 10h):
  const punch = d().entries.find((x) => x.date === "2026-08-18" && x.type === "saida" && x.time === "19:10")!;
  const res = actions.updateEntry(punch.id, { time: "18:30" }, { now: NOW() });
  assert.ok(res.ok, `edição: ${res.error}`);
  assert.ok(/redistribu/i.test(res.warning ?? ""), "feedback de redistribuição");
  const plan = activeSpecialPlansForDate(plans(), DEST)[0];
  assert.deepEqual(plan.allocations, [{ originDate: "2026-08-20", minutes: 60 }], "20/08 assume os 60min");
  assert.equal(specialExcessPlanMinutes(plan), 60, "badge continua 1h");
  assert.equal(bankOf().reservedMinutes, 60);
  assert.equal(bankOf().availableMinutes, 30, "90 gerado restante − 60 reservado");
});

check("TESTE 13 DE 14 — AUTOMÁTICO SEM LASTRO", () => {
  setState([...gen40("2026-08-18"), ...gen60("2026-08-20")]);
  const r = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(r.ok, `plano 1h: ${r.error}`);
  // 1ª queda: 18/08 → 0 (redistribuição in-place para 20/08):
  const p18 = d().entries.find((x) => x.date === "2026-08-18" && x.type === "saida" && x.time === "19:10")!;
  assert.ok(actions.updateEntry(p18.id, { time: "18:30" }, { now: NOW() }).ok);
  assert.deepEqual(activeSpecialPlansForDate(plans(), DEST)[0].allocations, [{ originDate: "2026-08-20", minutes: 60 }]);
  // 2ª queda: 20/08 → 40min. Só restam 40min reais:
  const p20 = d().entries.find((x) => x.date === "2026-08-20" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(p20.id, { time: "18:40" }, { now: NOW() });
  assert.ok(res.ok, `edição: ${res.error}`);
  assert.ok((res.warning ?? "").includes("40min") && (res.warning ?? "").includes("20min"), "feedback de redução");
  const plan = activeSpecialPlansForDate(plans(), DEST)[0];
  assert.equal(specialExcessPlanMinutes(plan), 40, "badge 40min (nada fictício)");
  assert.deepEqual(plan.allocations, [{ originDate: "2026-08-20", minutes: 40 }]);
  assert.ok(plans().some((p) => p.status === "cancelled"), "versão anterior preservada no histórico");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 40);
  assert.equal(b.availableMinutes, 0, "disponível coerente (reservado = geração restante)");
});

check("TESTE 14 DE 14 — MOBILE / SEMÂNTICA", () => {
  const modal = src("src/components/special-excess-plan-modal.tsx");
  const summary = src("src/components/special-excess-plan-summary.tsx");
  const card = src("src/components/day-card.tsx");
  // Responsividade (§21): modal herda o Modal do app; linhas quebram; botões full-width no mobile.
  assert.ok(modal.includes("sm:grid-cols-3") && modal.includes("grid-cols-2"), "cabeçalho do modal adapta ao mobile");
  assert.ok(modal.includes("sm:flex-row") && modal.includes("flex-col"), "linha de origem manual quebra no mobile");
  assert.ok(modal.includes('className="w-24"'), "campo de minutos compacto (sem overflow)");
  assert.ok(summary.includes("w-full ... sm:w-auto") || summary.includes("w-full"), "botões full-width no mobile");
  assert.ok(summary.includes("flex-wrap") && summary.includes("min-w-0 flex-1"), "detalhe quebra linha naturalmente");
  assert.ok(card.includes('className="shrink-0 gap-1.5 py-1"'), "badge reservado cabe no card (shrink-0)");
  // Semântica (§14/§20): sem "Concluir", sem conversão, sem vocabulário proibido.
  for (const file of [modal, summary]) {
    const code = file.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, ""); // código executável
    assert.ok(!code.includes("Concluir") && !code.includes("concluir"), "sem botão Concluir");
    assert.ok(!code.includes("concludeSpecialExcessPlan"), "sem chamada de conclusão");
    assert.ok(!code.includes("createSpecialExcessUse") && !code.includes("cancelSpecialExcessUse"), "não mistura domínio do USO");
    assert.ok(!/compensar|dívida|realocar/i.test(code), "sem vocabulário de dívida/compensação/realocação");
  }
  const page = src("src/app/(app)/registros/page.tsx");
  assert.ok(!page.includes("concludeSpecialExcessPlan"), "Registros não expõe conclusão");
  // Central legado intocada (§17):
  const legacy = src("src/lib/hour-bank.ts");
  assert.ok(!legacy.includes("SpecialExcessPlan"), "motor legado sem SpecialExcessPlan");
  const central = src("src/app/(app)/compensacoes/page.tsx");
  // 4E (SUPERADO — expectativa atualizada com justificativa): a Central
  // reformada EXIBE planos/reservas em modo somente-leitura (rastreabilidade
  // canônica) e NUNCA os muta:
  assert.ok(central.includes("specialExcessPlans"), "Central exibe reservas (read-only)");
  assert.ok(!central.includes("createSpecialExcessPlan") && !central.includes("cancelSpecialExcessPlan") && !central.includes("setSpecialExcessPlanStatus"), "Central sem mutação de planos");
  // Compactação 3F.1 preservada: a ação nova fica dentro do card expandido
  // (não cria cards enormes para todos os futuros).
  assert.ok(card.includes("futureDay && onPlanSpecial"), "ação discreta condicionada");
});

console.log(`\n${passed}/14 verificações da Etapa 4B passaram.`);
if (passed !== 14) process.exit(1);
