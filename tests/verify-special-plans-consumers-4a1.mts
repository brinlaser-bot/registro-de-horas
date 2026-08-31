/**
 * VERIFICAÇÃO — ETAPA 4A.1: AUDITORIA/CORREÇÃO DOS CONSUMIDORES DO BANCO [10+].
 *
 * A 4A estabeleceu DISPONÍVEL = GERADO − UTILIZADO ATIVO − RESERVADO ATIVO,
 * mas consumidores do motor continuavam chamando buildSpecialExcessBank SEM
 * plans — superfícies que exibem "disponível" podiam ignorar reservas ativas.
 *
 * Correções (classe A — capacidade/disponibilidade para operação):
 *  - day-view 3E (canComplete/maxUsable/lotes) + modal de uso + Registros;
 *  - card 3H da Visão Geral (BANCO [10+] DISPONÍVEL);
 *  - Resumo (painel "Disponível" via buildResumoPeriodView);
 *  - store 3G.4: FIFO de recomposição de USO não consome minuto reservado.
 * Mantidos sem plans (classe B — geração factual): genByOrigin das
 * reconciliações. Legado (classe C): hour-bank.ts/Central — verdade própria
 * do modelo legado, não consome o banco 3C/4A (relatado).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-plans-consumers-4a1.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
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
const gen60 = (date: string) => day4(date, "07:00", "12:00", "13:00", "19:00"); // 11h  → [10+] 60min
const def30 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:30"); // 7h30 → precisa 30min
const def60 = (date: string) => day4(date, "08:00", "12:00", "13:00", "16:00"); // 7h   → precisa 60min
const def150 = (date: string) => day4(date, "08:00", "12:00", "13:00", "14:30"); // 5h30 → precisa 150min

/* ── Harness ── */
let clock = 10_000;
const NOW = () => (clock += 1000);
const SEED = buildSeedData();
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

/** O MESMO banco canônico que o card 3H da Visão Geral computa (uses + plans do estado). */
function cardBank() {
  const dd = d();
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(ASOF),
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

/**
 * Cenário do enunciado: GERADO 2h (18/08 + 20/08 de 1h cada),
 * UTILIZADO 30min (uso FIFO em 24/08), RESERVADO 1h (plano FIFO 10/09).
 * DISPONÍVEL correto: 30min.
 */
function setupCenario() {
  setState([...gen60("2026-08-18"), ...gen60("2026-08-20"), ...def30("2026-08-24")]);
  const u = actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(u.ok, `uso: ${u.error}`);
  const p = actions.createSpecialExcessPlan({ destinationDate: DEST, minutes: 60, selectionMode: "automatic", asOfDate: ASOF, now: NOW() });
  assert.ok(p.ok, `plano: ${p.error}`);
}

/* ════════════════ TESTES 01–06 ════════════════ */

check("TESTE 01 DE 6 — VISÃO GERAL: BANCO [10+] DISPONÍVEL = 30min (2h gerado, 30min usado, 1h reservado)", () => {
  setupCenario();
  // Funcional: o card computa o banco canônico com uses+plans do estado.
  const b = cardBank();
  assert.equal(b.generatedMinutes, 120, "gerado 2h");
  assert.equal(b.usedMinutes, 30, "utilizado 30min");
  assert.equal(b.reservedMinutes, 60, "reservado 1h");
  assert.equal(b.availableMinutes, 30, "DISPONÍVEL = 30min (não 1h30)");
  // Estrutural: o card 3H recebe plans e exibe availableMinutes do motor.
  const card = src("src/components/hour-bank-card.tsx");
  assert.ok(card.includes("specialExcessPlans = []"), "card aceita plans (default [])");
  assert.ok(card.includes("plans: specialExcessPlans"), "memo do card usa a fonte canônica com plans");
  assert.ok(card.includes("value={formatMinutes(specialBank.availableMinutes)}"), "principal = availableMinutes do motor");
  assert.ok(!card.includes("reservado") || !/reservado: \d/.test(card), "sem card/texto 'Reservado' novo (§4: só o número correto)");
  // 4V: o card HourBankCard saiu da Visão Geral (reforma UI-only); a página
  // alimenta a FONTE CANÔNICA diretamente (buildSpecialExcessBank 3C e
  // buildResumoPeriodView 3A) — o DISPONÍVEL continua líquido de planos ativos.
  const page = src("src/app/(app)/page.tsx");
  assert.ok(page.includes("plans: specialExcessPlans ?? []"), "4V: Visão Geral passa specialExcessPlans à fonte canônica");
  assert.ok(page.includes("buildSpecialExcessBank"), "4V: BANCO [10+] da Visão Geral usa o motor canônico 3C");
});

check("TESTE 02 DE 6 — CANCELAR O PLANO DE 1h: DISPONÍVEL VOLTA A 1h30", () => {
  // (estado do TESTE 01)
  const plan = activePlans()[0];
  const c = actions.cancelSpecialExcessPlan({ id: plan.id, now: NOW() });
  assert.ok(c.ok, `cancelamento: ${c.error}`);
  const b = cardBank();
  assert.equal(b.generatedMinutes, 120);
  assert.equal(b.usedMinutes, 30);
  assert.equal(b.reservedMinutes, 0, "reserva cancelada não reserva mais");
  assert.equal(b.availableMinutes, 90, "DISPONÍVEL = 1h30");
});

check("TESTE 03 DE 6 — CONCLUIR O PLANO (semântica 4A): deixa de reservar, DISPONÍVEL 1h30, nenhum uso criado", () => {
  setupCenario(); // cenário limpo do enunciado
  const usesBefore = uses().length;
  const plan = activePlans()[0];
  const cc = actions.concludeSpecialExcessPlan({ id: plan.id, now: NOW() });
  assert.ok(cc.ok, `conclusão: ${cc.error}`);
  const b = cardBank();
  assert.equal(b.reservedMinutes, 0, "plano concluded não conta em reserved");
  assert.equal(b.availableMinutes, 90, "DISPONÍVEL = 1h30");
  assert.equal(uses().length, usesBefore, "NENHUM SpecialExcessUse é criado");
  assert.equal(plans().find((p2) => p2.id === plan.id)!.status, "concluded");
});

check("TESTE 04 DE 6 — 'GERADO NO PERÍODO' CONTINUA FACTUAL; day-view/Resumo líquidam reserva no disponível", () => {
  setupCenario();
  // Resumo (Central/Resumo — buildResumoPeriodView): card "gerado no PERÍODO"
  // é geração FACTUAL (sem descontar reserva); painel "Disponível" líquida.
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
  assert.equal(view.cards.specialGeneratedMinutes, 120, "gerado no período continua 2h (factual)");
  assert.equal(view.banks[0].bank.generatedMinutes, 120, "painel: gerado 2h");
  assert.equal(view.banks[0].bank.reservedMinutes, 60, "painel: reservado 1h");
  assert.equal(view.banks[0].bank.availableMinutes, 30, "painel 'Disponível' = 30min (corrigido)");
  // day-view 3E (capacidade para novo uso): disponível/lotes consideram reserva.
  const dd = d();
  setState([...dd.entries, ...def30("2026-08-26")], dd.specialExcessUses ?? [], dd.specialExcessPlans ?? []); // novo destino deficit 30
  const dv = buildSpecialExcessDayView({
    date: "2026-08-26",
    asOfDate: ASOF,
    entries: d().entries,
    absences: d().absences,
    calendars: d().companyCalendars,
    settings: settingsOf(d().user),
    faltas: d().faltas,
    controlStartDate: d().user.controlStartDate ?? null,
    uses: d().specialExcessUses ?? [],
    plans: d().specialExcessPlans ?? [],
  });
  assert.equal(dv.bankAvailableMinutes, 30, "day-view: disponível do banco = 30min (não 1h30)");
  assert.equal(dv.maxUsableMinutes, 30, "capacidade máxima utilizável = 30min");
  assert.equal(dv.lots.length, 1, "só a origem com saldo NÃO reservado aparece para o modo manual");
  assert.equal(dv.lots[0].originDate, "2026-08-20", "18/08 está totalmente usado+reservado");
  assert.equal(dv.lots[0].availableMinutes, 30);
  assert.ok(dv.canComplete, "ainda há capacidade real para completar 30min");
});

check("TESTE 05 DE 6 — GATE DO STORE: nenhuma action de uso consome minuto reservado", () => {
  setupCenario(); // disponível 30min
  // destino deficit real com necessidade ≥ 60min para o gate de saldo (26/08 = 7h):
  const before = d();
  setState([...before.entries, ...def60("2026-08-26")], before.specialExcessUses ?? [], before.specialExcessPlans ?? []);
  // (a) criação FIFO acima do disponível líquido → rejeitada.
  const over = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 0 as unknown as number, allocationStrategy: "fifo", asOfDate: ASOF });
  assert.equal(over.ok, false, "sanidade: pedido 0 é inválido");
  const r60 = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.equal(r60.ok, false, "uso de 1h é rejeitado (só 30min livres)");
  assert.equal(r60.code, "insufficient-special-balance");
  assert.equal(r60.available, 30, "gate informa o disponível LÍQUIDO (30min, não 1h30)");
  const r30 = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(r30.ok, `uso de 30min (dentro do líquido) é aceito: ${r30.error}`);
  const lastUse = uses()[uses().length - 1];
  assert.deepEqual(lastUse.allocations, [{ originDate: "2026-08-20", minutes: 30 }], "FIFO não toca minuto reservado (18/08)");
  // (b) reconciliação FIFO de USO (3G.4) também não rouba reserva (correção 4A.1):
  setState([
    ...gen60("2026-08-18"), // A: 60min
    ...day4("2026-08-21", "07:00", "12:00", "13:00", "20:30"), // B: 12h30 → 150min [10+]
    ...def150("2026-08-26"), // destino com necessidade de 150min
  ]);
  const useBig = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 150, allocationStrategy: "fifo", asOfDate: ASOF, now: NOW() });
  assert.ok(useBig.ok, `uso 150: ${useBig.error}`);
  assert.deepEqual(uses()[0].allocations, [
    { originDate: "2026-08-18", minutes: 60 },
    { originDate: "2026-08-21", minutes: 90 },
  ]);
  const planB = actions.createSpecialExcessPlan({
    destinationDate: "2026-09-15",
    minutes: 30,
    selectionMode: "manual",
    manualAllocations: [{ originDate: "2026-08-21", minutes: 30 }],
    asOfDate: ASOF,
    now: NOW(),
  });
  assert.ok(planB.ok, `plano reserva 30 dos 60 livres de B: ${planB.error}`);
  // A perde a geração (11h → 10h): FIFO de recomposição do USO não pode
  // tomar os 30 reservados em B (sem a correção o uso recomporia B150 e
  // usado+reservado = 180 > geração 150). Com a correção: uso → B120.
  const punchA = d().entries.find((x) => x.date === "2026-08-18" && x.type === "saida" && x.time === "19:00")!;
  const res = actions.updateEntry(punchA.id, { time: "18:00" }, { now: NOW() });
  assert.ok(res.ok, `edição de A: ${res.error}`);
  const bigFinal = uses().find((u2) => u2.status === "utilizado" && u2.allocations.every((a2) => a2.originDate === "2026-08-21"));
  assert.ok(bigFinal, "uso reconciliado ativo");
  assert.equal(bigFinal!.allocations.reduce((s, a2) => s + a2.minutes, 0), 120, "uso fica com 120 — NÃO consome os 30 reservados");
  const bank = cardBank();
  assert.equal(bank.generatedMinutes, 150);
  assert.equal(bank.usedMinutes, 120);
  assert.equal(bank.reservedMinutes, 30, "reserva intacta (usado+reservado = geração)");
  assert.equal(bank.availableMinutes, 0);
});

check("TESTE 06 DE 6 — AUDITORIA ESTRUTURAL: nenhum consumidor 'disponível' ignora plans sem justificativa", () => {
  // Classe A — capacidade/disponibilidade para operação (devem passar plans):
  const dayView = src("src/lib/special-excess-day-view.ts");
  assert.ok(dayView.includes("plans?: SpecialExcessPlan[]"), "day-view: input plans");
  assert.ok(dayView.includes("plans: args.plans ?? []"), "day-view: motor canônico recebe plans");
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(modal.includes("plans: specialExcessPlans ?? []"), "modal de uso: plans no day-view");
  const registros = src("src/app/(app)/registros/page.tsx");
  assert.ok(registros.includes("plans: specialExcessPlans ?? []"), "Registros: banco por ciclo com plans");
  const periodView = src("src/lib/resumo-period-view.ts");
  assert.ok(periodView.includes("plans?: SpecialExcessPlan[]"), "Resumo: input plans");
  assert.ok(periodView.includes("plans,"), "Resumo: motor canônico recebe plans");
  const resumoPage = src("src/app/(app)/resumo/page.tsx");
  assert.ok(resumoPage.includes("plans: specialExcessPlans ?? []"), "Resumo página: passa plans");
  const card = src("src/components/hour-bank-card.tsx");
  assert.ok(card.includes("plans: specialExcessPlans"), "card 3H: plans no memo");
  const store = src("src/lib/store.ts");
  assert.ok(
    store.includes("plans: (d.specialExcessPlans ?? []).filter((pl) => pl.status === \"planned\")"),
    "store 3D/3G.4: gate e FIFO de usos consideram reservas ativas",
  );
  // Classe B — geração factual (plans [] explícito + justificativa documentada):
  const genByOriginCount = (store.match(/plans: \[\],/g) ?? []).length;
  assert.ok(genByOriginCount >= 2, `genByOrigin das reconciliações com plans [] explícito (${genByOriginCount})`);
  assert.ok(store.includes("CLASSE B (4A.1)"), "justificativa classe B documentada no store");
  // Classe C — legado (hour-bank.ts não conhece o modelo novo; relatado):
  const legacy = src("src/lib/hour-bank.ts");
  assert.ok(!legacy.includes("SpecialExcessPlan"), "motor legado separado do banco 3C/4A (Central — redesenho futuro)");
  // Nenhum componente calcula fórmula paralela (§7):
  assert.ok(!card.includes("generatedMinutes -"), "card não recalcula fórmula fora do motor");
  assert.ok(!modal.includes("- reservedMinutes"), "modal não recalcula fórmula fora do motor");
});

console.log(`\n${passed}/6 verificações da Etapa 4A.1 passaram.`);
if (passed !== 6) process.exit(1);
