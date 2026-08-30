/**
 * VERIFICAÇÃO — RODADA DE CONSOLIDAÇÃO
 * UX, rastreabilidade, duplo clique, excedentes, déficits e seed 3.1.
 *
 * Executar: npx tsx tests/verify-consolidacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dayContext, type Absence } from "../src/lib/absences.ts";
import {
  dayCreditView,
  deficitViews,
  previewAllocateSpecialExcess,
  specialExcessLedger,
  specialExcessStatusOf,
} from "../src/lib/hour-bank.ts";
import { buildLegacyDemoScenario } from "../src/lib/seed-data.ts";
import { actions, DUPLICATE_SUBMIT_MSG, getAppData } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import type { Compensation, ExcessReason, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const TODAY = "2026-08-25";

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const reason = (date: string): ExcessReason => ({
  id: nextId++, date, reason: "demanda-urgente",
  customReason: null, observation: null, createdAt: 1, updatedAt: 1,
});

/** 21/08: 08:00→16:45 = 7h45 → déficit 15min. */
const dayDef15 = () => [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida")];
/** 22/08 sábado +2h (capacidade para hora extra). */
const daySat2h = () => [punch("2026-08-22", "10:00", "entrada"), punch("2026-08-22", "12:00", "saida")];
/** 24/08: 08:00→20:00 − 1h almoço = 11h → regular 2h + especial 1h. */
const day11h = () => [punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "20:00", "saida")];

const reset = (
  entries: TimeEntry[],
  comps: Compensation[] = [],
  excessReasons: ExcessReason[] = [],
) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences: [],
    companyCalendars: undefined, faltas: [], excessReasons,
  });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };
const checkAsync = async (id: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`✔ ${id}`);
};

const formSrc = srcOf("src/components/compensation-form.tsx");
const allocSrc = srcOf("src/components/allocate-excess-modal.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");
const dayCardSrc = srcOf("src/components/day-card.tsx");
const pageSrc = srcOf("src/app/(app)/page.tsx");
const compsSrc = srcOf("src/app/(app)/compensacoes/page.tsx");
const storeSrc = srcOf("src/lib/store.ts");

/* ── A. Duplo clique: 1ª cria, 2ª idêntica é recusada ───────── */
check("A. addComp 2× idêntico: 1 criada + 1 recusada com DUPLICATE_SUBMIT_MSG", () => {
  reset([...dayDef15(), ...daySat2h()]);
  const payload = {
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 10,
    note: null, kind: "deficit" as const,
  };
  const r1 = actions.addComp(payload);
  const r2 = actions.addComp(payload);
  assert.equal(r1.ok, true, r1.error);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, DUPLICATE_SUBMIT_MSG);
  assert.equal(getAppData().compensations.length, 1);
});

/* ── B. Cinco cliques idênticos: só a primeira entra ────────── */
check("B. addComp 5× idêntico: uma compensação só", () => {
  reset([...dayDef15(), ...daySat2h()]);
  const payload = {
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 10,
    note: null, kind: "deficit" as const,
  };
  const results = [1, 2, 3, 4, 5].map(() => actions.addComp(payload));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok && r.error === DUPLICATE_SUBMIT_MSG).length, 4);
  assert.equal(getAppData().compensations.length, 1);
});

/* ── C. Criação distinta imediata NÃO é bloqueada ───────────── */
check("C. dois addComp distintos no mesmo instante passam", () => {
  reset([...dayDef15(), ...daySat2h()]);
  const a = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 5,
    note: null, kind: "deficit",
  });
  const b = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 8,
    note: null, kind: "deficit",
  });
  assert.equal(a.ok, true, a.error);
  assert.equal(b.ok, true, b.error);
  assert.equal(getAppData().compensations.length, 2);
});

/* ── D. Falha de validação NÃO trava o próximo envio ────────── */
check("D. addComp inválido não memoriza a chave; o seguinte válido passa", () => {
  reset([...dayDef15(), ...daySat2h()]);
  const bad = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 0,
    note: null, kind: "deficit",
  });
  assert.equal(bad.ok, false);
  const ok = actions.addComp({
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 10,
    note: null, kind: "deficit",
  });
  assert.equal(ok.ok, true, ok.error);
});

/* ── E. Depois da janela, o mesmo envio volta a ser aceito ──── */
await checkAsync("E. após 700ms o mesmo addComp não é tratado como duplo clique", async () => {
  reset([...dayDef15(), ...daySat2h()]);
  const payload = {
    sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 5,
    note: null, kind: "deficit" as const,
  };
  assert.equal(actions.addComp(payload).ok, true);
  await wait(700);
  assert.equal(actions.addComp(payload).ok, true);
  assert.equal(getAppData().compensations.length, 2);
});

/* ── F. allocateSpecialExcess também tem guarda ─────────────── */
check("F. allocateSpecialExcess 2× idêntico: 1 alocada", () => {
  reset([...dayDef15(), ...day11h()], [], [reason("2026-08-24")]);
  const p = { excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 };
  const r1 = actions.allocateSpecialExcess(p);
  const r2 = actions.allocateSpecialExcess(p);
  assert.equal(r1.ok, true, r1.error);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, DUPLICATE_SUBMIT_MSG);
  assert.equal(getAppData().compensations.filter((c) => c.portion === "especial").length, 1);
});

/* ── G. UI: inflight + Criando… / Alocando… / fecha no sucesso ─ */
check("G. formulário e modal: inflight, rótulos de busy, um toast, fecha no sucesso", () => {
  assert.ok(formSrc.includes("inflight"), "CompensationForm tem mutex de clique");
  assert.ok(formSrc.includes("Criando…"));
  assert.ok(formSrc.includes("Salvando…"));
  assert.ok(formSrc.includes("onClose()"), "fecha o modal após sucesso");
  assert.ok(formSrc.includes("inflight.current = true"));
  assert.ok(allocSrc.includes("inflight"), "AllocateExcessModal tem mutex");
  assert.ok(allocSrc.includes("Alocando…"));
  assert.ok(storeSrc.includes("DUPLICATE_SUBMIT_MSG"));
  assert.ok(storeSrc.includes("rememberCreate(createKey)"));
  assert.ok(!pageSrc.includes('toast.show("Compensação criada!")'), "pai da Visão geral sem toast extra");
  assert.ok(!compsSrc.includes('toast.show("Compensação criada!")'), "pai de Compensações sem toast extra");
});

/* ── H. Sobreposição A: orig15 plan10 alloc5 → libera 0 ─────── */
check("H. overlap A: orig 15 / conc 0 / plan 10 / alloc 5 → release 0, plannedAfter 10", () => {
  const planned: Compensation = {
    id: 1, sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const pre = previewAllocateSpecialExcess(
    "2026-08-24", "2026-08-21", 5,
    [...dayDef15(), ...day11h()], [planned], [], undefined, [],
    settings, [reason("2026-08-24")], TODAY,
  );
  assert.equal(pre.ok, true, pre.error);
  assert.equal(pre.plannedNow, 10);
  assert.equal(pre.plannedToRelease, 0);
  assert.equal(pre.plannedAfter, 10);
  assert.equal(pre.remainingDeficitAfter, 10);
  assert.equal(pre.compensatedAfter, 5);
});

/* ── I. Sobreposição B: plan 15 alloc 5 → libera 5 ──────────── */
check("I. overlap B: orig 15 / conc 0 / plan 15 / alloc 5 → release 5, plannedAfter 10", () => {
  const planned: Compensation = {
    id: 1, sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 15,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const pre = previewAllocateSpecialExcess(
    "2026-08-24", "2026-08-21", 5,
    [...dayDef15(), ...day11h()], [planned], [], undefined, [],
    settings, [reason("2026-08-24")], TODAY,
  );
  assert.equal(pre.ok, true, pre.error);
  assert.equal(pre.plannedToRelease, 5);
  assert.equal(pre.plannedAfter, 10);
  assert.equal(pre.remainingDeficitAfter, 10);
});

/* ── J. Sobreposição C: conc 5 plan 10 alloc 10 → libera 10 ─── */
check("J. overlap C: orig 15 / conc 5 / plan 10 / alloc 10 → release 10, plannedAfter 0", () => {
  const comps: Compensation[] = [
    {
      id: 1, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 5,
      status: "concluida", note: null, kind: "deficit", createdAt: 1,
    },
    {
      id: 2, sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 10,
      status: "pendente", note: null, kind: "deficit", createdAt: 2,
    },
  ];
  const pre = previewAllocateSpecialExcess(
    "2026-08-24", "2026-08-21", 10,
    [...dayDef15(), ...daySat2h(), ...day11h()], comps, [], undefined, [],
    settings, [reason("2026-08-24")], TODAY,
  );
  assert.equal(pre.ok, true, pre.error);
  assert.equal(pre.plannedToRelease, 10);
  assert.equal(pre.plannedAfter, 0);
  assert.equal(pre.remainingDeficitAfter, 0);
  assert.equal(pre.compensatedAfter, 15);
});

/* ── K. Prévia aparece para qualquer alocação válida (não só release) ─ */
check("K. preview do modal não exige plannedToRelease > 0", () => {
  assert.ok(allocSrc.includes("{preview && preview.ok && ("), "prévia em qualquer ok");
  assert.ok(!allocSrc.includes("preview.ok && preview.plannedToRelease > 0 && ("));
  assert.ok(allocSrc.includes("Prévia da alocação"));
  assert.ok(allocSrc.includes("Vai alocar agora:"));
  assert.ok(allocSrc.includes("Excedente disponível antes:"));
  assert.ok(allocSrc.includes("Excedente que restará:"));
  assert.ok(allocSrc.includes("Déficit em aberto antes:"));
  assert.ok(allocSrc.includes("Déficit em aberto depois:"));
  assert.ok(allocSrc.includes("Planejado atual:"));
  assert.ok(allocSrc.includes("Planejamento que será liberado:"));
  assert.ok(allocSrc.includes("Planejamento que continuará ativo:"));
  assert.ok(allocSrc.includes("Sem programação depois:"));
});

/* ── L. Registros (3E.2): o card NÃO exibe mais bloco de situação/quitação ──
 * O bloco "Situação do déficit" / "Como foi quitado" foi retirado da
 * experiência principal (spec §3/§4). A leitura do card agora é apenas
 * trabalhado + saldo regular; o motor legado de quitação (debt.ts) continua
 * coberto pelos checks de engine abaixo (M/N). */
check("L. day-card (3E.2): sem 'Situação do déficit'/'Como foi quitado' — só saldo regular", () => {
  assert.ok(!dayCardSrc.includes("Situação do déficit"));
  assert.ok(!dayCardSrc.includes("Como foi quitado"));
  assert.ok(!dayCardSrc.includes("✓ Déficit quitado"));
  assert.ok(!dayCardSrc.includes("Parcial · restam"));
  assert.ok(!dayCardSrc.includes("Em aberto ·"));
  assert.ok(!dayCardSrc.includes("quitacaoLine"), "lista de quitação saiu do card");
  assert.ok(dayCardSrc.includes("Saldo regular"), "card continua mostrando o saldo regular");
});

/* ── M. 21/08 seed: 15 quitados = 5 regular + 10 especial ───── */
check("M. 21/08 seed: déficit 15 quitado com 5 regular + 10 especial de 24/08", () => {
  const seed = buildLegacyDemoScenario();
  const [dv] = deficitViews(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars,
    seed.faltas, settings, { from: "2026-08-21", to: "2026-08-21" }, TODAY,
  );
  assert.equal(dv.originalMinutes, 15);
  assert.equal(dv.compensatedMinutes, 15);
  assert.equal(dv.openMinutes, 0);
  assert.equal(dv.status, "quitada");
  const fontes = seed.compensations.filter(
    (c) => c.sourceDate === "2026-08-21" && c.status === "concluida",
  );
  assert.deepEqual(
    fontes.map((c) => [c.minutes, c.portion, c.targetDate]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [[5, "regular", "2026-08-24"], [10, "especial", "2026-08-24"]],
  );
});

/* ── N. Gestão 24/08: 60 original / 10 realocado / 50 livre ─── */
check("N. 24/08 ledger especial = 60 / realizado 25 / livre 35 (planejado ≠ tratado)", () => {
  const seed = buildLegacyDemoScenario();
  const day = computeDay(seed.entries.filter((e) => e.date === "2026-08-24"), settings);
  assert.equal(day.workedMinutes, 660);
  assert.equal(day.excessMinutes, 60);
  const v = dayCreditView(
    "2026-08-24", seed.entries, seed.compensations, seed.absences,
    seed.companyCalendars, settings, seed.excessReasons,
  );
  assert.equal(v.regularExtra, 120);
  assert.equal(v.excessSpecial, 60);
  const led = specialExcessLedger("2026-08-24", seed.compensations, 60);
  assert.equal(led.original, 60);
  assert.equal(led.realized, 25);
  assert.equal(led.planned, 0);
  assert.equal(led.free, 35);
  assert.equal(led.status, "parcial");
  assert.ok(panelSrc.includes('label="Já realocado"'));
  assert.ok(panelSrc.includes('label="Ainda a realocar"'));
  assert.ok(panelSrc.includes("specialExcessLedger"));
});

/* ── O. Programado ≠ tratado; status derivados ──────────────── */
check("O. specialExcessStatusOf: livre / programado / parcial / tratado", () => {
  assert.equal(specialExcessStatusOf(45, 0, 0), "livre");
  assert.equal(specialExcessStatusOf(45, 0, 45), "programado");
  assert.equal(specialExcessStatusOf(60, 10, 0), "parcial");
  assert.equal(specialExcessStatusOf(30, 30, 0), "tratado");
  const seed = buildLegacyDemoScenario();
  assert.equal(specialExcessLedger("2026-08-18", seed.compensations, 45).status, "programado");
  assert.equal(specialExcessLedger("2026-08-17", seed.compensations, 30).status, "tratado");
  assert.equal(specialExcessLedger("2026-08-11", seed.compensations, 15).status, "livre");
  assert.ok(compsSrc.includes("Tratado ✓"));
  assert.ok(compsSrc.includes("Parcialmente realocado"));
  assert.ok(compsSrc.includes("Programado"));
  assert.ok(compsSrc.includes("Livre"));
  assert.ok(compsSrc.includes("Excedente do limite diário realocado"));
});

/* ── P. (3E.2) card sem motivo; página de compensações preserva ─ */
check("P. (3E.2) card sem fluxo de motivo; compensações preserva realizado ≠ programado", () => {
  assert.ok(!dayCardSrc.includes("onRegisterReason"), "card sem fluxo de motivo (3E.2)");
  assert.ok(!dayCardSrc.includes("Registrar motivo"), "botão de motivo fora do card (3E.2)");
  assert.ok(compsSrc.includes("{!v.reason && ("));
  assert.ok(compsSrc.includes("{v.reason && ("));
  assert.ok(compsSrc.includes("Realizado:"));
  assert.ok(compsSrc.includes("Programado:"));
});

/* ── Q. Saudação com falta; card HOJE idle ──────────────────── */
check("Q. saudação de falta e card HOJE idle = jornada não iniciada (sem −8h)", () => {
  assert.ok(pageSrc.includes("Falta registrada para hoje."));
  assert.ok(pageSrc.includes("jornada não iniciada"));
  assert.ok(pageSrc.includes("todayIdle"));
  assert.ok(pageSrc.includes("todayCtx.type === \"regular\""));
  assert.ok(pageSrc.includes("!faltaHoje"));
});

/* ── R. Abono: card só informativo; sem frase coberta ───────── */
check("R. Abono microajuste permanece: !abonoDay e sem 'Dia coberto pelo Abono'", () => {
  assert.ok(dayCardSrc.includes('const abonoDay = absence?.kind === "abono"'));
  assert.ok(!dayCardSrc.includes("Dia coberto pelo Abono"));
  assert.ok(
    dayCardSrc.includes("{!abonoDay && (") ||
      dayCardSrc.includes("{!abonoDay && !punchPending && (") ||
      dayCardSrc.includes("!futureDay && !abonoDay && ("),
    "guarda !abonoDay permanece no card",
  );
});

/* ── S. Acordo dispensado integral: 0 déficit / 0 saldo ─────── */
check("S. acordado-dispensado integral sem batidas = expected 0, déficit 0, saldo 0", () => {
  const absence: Absence = {
    id: 1, kind: "acordado", startDate: "2026-08-06", endDate: "2026-08-06",
    duration: "integral", treatment: "dispensado", note: null, createdAt: 1,
  };
  const ctx = dayContext("2026-08-06", [], [absence], settings);
  assert.equal(ctx.effectiveExpected, 0);
  assert.equal(ctx.adjustedDeficit, 0);
  assert.equal(ctx.adjustedBalance, 0);
  assert.equal(ctx.acordoMinutes, 0);
  assert.equal(ctx.justifiedMinutes, 480);
});

/* ── T. Seed 2.0 determinístico ─────────────────────────────── */
check("T. seed 3.1: datas fixas, calendário fictício, 20/08 quitado, 14/08 com 6 batidas", () => {
  const seed = buildLegacyDemoScenario();
  assert.ok((seed.companyCalendars?.length ?? 0) >= 1, "seed traz calendário fictício");
  assert.equal(seed.user.birthDate, "1989-08-23");
  assert.equal(seed.entries.some((e) => e.date === "2026-08-25"), false, "25/08 sem batidas");
  assert.ok(seed.entries.some((e) => e.date === "2026-08-24"));
  assert.ok(seed.entries.some((e) => e.date === "2026-08-07"));
  assert.equal(seed.entries.filter((e) => e.date === "2026-08-14").length, 6, "14/08 com 6 batidas");
  assert.ok(seed.entries.some((e) => e.date === "2026-09-07"), "07/09 futuro escrito direto");
  assert.ok(seed.entries.some((e) => e.date === "2026-09-03"), "03/09 registro futuro parcial");
  assert.ok(seed.entries.some((e) => e.date === "2026-04-29"), "29/04 ciclo anterior");
  assert.ok(seed.faltas.some((f) => f.date === "2026-08-31"), "falta prevista 31/08");
  assert.ok(seed.absences.some((a) => a.kind === "abono" && a.startDate === "2026-08-10"));
  assert.ok(seed.absences.some((a) => a.kind === "acordado" && a.startDate === "2026-08-06"));
  const semMotivo = seed.excessReasons?.filter((r) => r.date === "2026-08-11") ?? [];
  assert.equal(semMotivo.length, 0, "11/08 especial sem motivo");
  assert.ok(seed.excessReasons?.some((r) => r.date === "2026-08-24" && r.reason === "demanda-urgente"));
  const acordo = seed.compensations.find((c) => c.kind === "acordo" && c.sourceDate === "2026-08-06" && c.status === "concluida")!;
  assert.equal(acordo.minutes, 120, "acordo concluído cabe no teto de 10h de 07/08");
  assert.equal(acordo.status, "concluida");
  const d19 = deficitViews(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars, seed.faltas, settings,
    { from: "2026-08-19", to: "2026-08-19" }, TODAY,
  )[0];
  assert.equal(d19.originalMinutes, 30);
  assert.equal(d19.compensatedMinutes, 10);
  assert.equal(d19.plannedMinutes, 10);
  assert.equal(d19.openMinutes, 20);
  const d20 = deficitViews(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars, seed.faltas, settings,
    { from: "2026-08-20", to: "2026-08-20" }, TODAY,
  )[0];
  assert.equal(d20.originalMinutes, 15);
  assert.equal(d20.openMinutes, 0, "20/08 totalmente quitado");
});

reset([]);
console.log(`\nCONSOLIDAÇÃO — OK (${passed} testes)`);
