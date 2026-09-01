/**
 * VERIFICAÇÃO — ALOCAÇÃO IMEDIATA DO EXCEDENTE + ASSISTENTE CONTEXTUAL + FALTA
 *
 *  A–M  alocação do excedente especial já realizado (não o modal futuro);
 *  N–Q  Assistente de jornada com base 0 (não é "meta atingida");
 *  R–Y  estado destacado de falta no Registro de hoje.
 *
 * Executar: npx tsx tests/verify-alocar-assistente-falta.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import {
  ALLOCATE_CROSS_CYCLE_MSG,
  ALLOCATE_NO_REASON_MSG,
  dayCreditView,
  deficitViews,
  eligibleDeficitsForSpecialAllocation,
  hourBankSummary,
  maxAllocatableSpecial,
  previewAllocateSpecialExcess,
  releaseOverlappingPlanned,
} from "../src/lib/hour-bank.ts";
import { annualCycleBounds, getAnnualPointCycle, sameAnnualCycle } from "../src/lib/periods.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { buildExitPlan } from "../src/components/smart-exit.tsx";
import { computeDay } from "../src/lib/time.ts";
import type { Compensation, ExcessReason, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";
import type { Absence } from "../src/lib/absences.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

const readFix = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-24";

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const reason = (date: string, code: ExcessReason["reason"] = "atendimento-evento"): ExcessReason => ({
  id: nextId++, date, reason: code, customReason: null, observation: null, createdAt: 1, updatedAt: 1,
});

/** 21/08 (sex): 08:00→16:45 = 7h45 → déficit 15min. */
const dayDef15 = () => [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida")];
/** 20/08 (qui): 08:00→16:30 = 7h30 → déficit 30min. */
const dayDef30 = () => [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "16:30", "saida")];
/** 24/08 (seg): 08:00→20:00 − 1h almoço = 11h → regular 2h + especial 1h. */
const day11h = () => [punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "20:00", "saida")];
/** 22/08 (sáb): 5min — lastro da parcela concluída de 5min. */
const daySat5 = () => [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "08:05", "saida")];

const concluded5 = (): Compensation => ({
  id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 5,
  status: "concluida", note: null, kind: "deficit", createdAt: 1,
});
const planned10 = (): Compensation => ({
  id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-27", minutes: 10,
  status: "pendente", note: null, kind: "deficit", createdAt: 2,
});

const reset = (
  entries: TimeEntry[],
  comps: Compensation[] = [],
  excessReasons: ExcessReason[] = [],
  faltas: { id: number; date: string; createdAt: number }[] = [],
  absences: Absence[] = [],
) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences,
    companyCalendars: both, faltas, excessReasons,
  });

const panelSrc = srcOf("src/components/excess-panel.tsx");
const formSrc = srcOf("src/components/compensation-form.tsx");
const allocSrc = srcOf("src/components/allocate-excess-modal.tsx");
const smartSrc = srcOf("src/components/smart-exit.tsx");
const quickSrc = srcOf("src/components/quick-punch.tsx");
const pageSrc = srcOf("src/app/(app)/page.tsx");
const dayCardSrc = srcOf("src/components/day-card.tsx");
const registrosSrc = srcOf("src/app/(app)/registros/page.tsx");
const compensacoesSrc = srcOf("src/app/(app)/compensacoes/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. Causa raiz: "Compensar agora" abria o modal futuro ── */
check("A. botão de excedente NÃO abre CompensationForm (sair mais cedo); rótulo Realocar excedente", () => {
  assert.ok(!panelSrc.includes('openFor(d.date, "excedente")'), "excedente não chama openFor futuro");
  assert.ok(!panelSrc.includes("Compensar agora"), "rótulo antigo removido");
  assert.ok(panelSrc.includes("Realocar excedente"), "novo rótulo");
  assert.ok(panelSrc.includes("AllocateExcessModal"), "modal próprio no painel");
  assert.ok(formSrc.includes("Nova compensação de horas"), "modal futuro permanece para programar");
  assert.ok(formSrc.includes("sair mais cedo"), "copy futuro intacto no formulário antigo");
  assert.ok(!allocSrc.includes("sair mais cedo"), "fluxo novo não fala em sair mais cedo");
  assert.ok(!allocSrc.includes("entrar mais tarde"), "fluxo novo não fala em entrar mais tarde");
  assert.ok(allocSrc.includes("Realocar excedente"));
});

/* ── B. Modal próprio lista déficits factuais ─────────────── */
check("B. modal próprio: origem + déficits com openMinutes > 0 (planejado NÃO quita)", () => {
  assert.ok(allocSrc.includes("eligibleDeficitsForSpecialAllocation"));
  assert.ok(!allocSrc.includes("2000-01-01"), "não varre todos os ciclos desde 2000");
  assert.ok(allocSrc.includes("Em aberto:"));
  assert.ok(allocSrc.includes("Máximo alocável agora") || allocSrc.includes("Máximo alocável neste déficit"));
  const entries = [...dayDef15(), ...daySat5(), ...day11h()];
  const comps = [concluded5(), planned10()];
  const views = deficitViews(entries, comps, [], both, [], settings, { from: "2026-08-01", to: TODAY }, TODAY);
  const d21 = views.find((d) => d.date === "2026-08-21")!;
  assert.equal(d21.originalMinutes, 15);
  assert.equal(d21.compensatedMinutes, 5);
  assert.equal(d21.plannedMinutes, 10);
  assert.equal(d21.openMinutes, 10, "factual restante = original − concluído");
});

/* ── C. Teto = min(especial livre, restante factual) ─────── */
check("C. teto da alocação = min(60 especial, 10 factual) = 10 — nunca sugere 60 para 10", () => {
  const entries = [...dayDef15(), ...daySat5(), ...day11h()];
  const comps = [concluded5(), planned10()];
  const reasons = [reason("2026-08-24")];
  const cap = maxAllocatableSpecial(
    "2026-08-24", "2026-08-21", entries, comps, [], both, [], settings, reasons, TODAY,
  );
  assert.equal(cap.freeSpecial, 60);
  assert.equal(cap.openDeficit, 10);
  assert.equal(cap.max, 10);
  const over = previewAllocateSpecialExcess(
    "2026-08-24", "2026-08-21", 60, entries, comps, [], both, [], settings, reasons, TODAY,
  );
  assert.equal(over.ok, false, "60 > teto 10");
  assert.match(over.error ?? "", /10min/);
  assert.ok(allocSrc.includes("Math.min(credit.freeSpecial, selected.openMinutes)") || allocSrc.includes("Math.min(credit.freeSpecial, d.openMinutes)"));
});

/* ── D. Sem motivo → bloqueia ────────────────────────────── */
check("D. sem motivo do excedente: recusa com a mensagem central", () => {
  const entries = [...dayDef15(), ...day11h()];
  const pre = previewAllocateSpecialExcess(
    "2026-08-24", "2026-08-21", 10, entries, [], [], both, [], settings, [], TODAY,
  );
  assert.equal(pre.ok, false);
  assert.equal(pre.error, ALLOCATE_NO_REASON_MSG);
  reset([...dayDef15(), ...day11h()]);
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.error, ALLOCATE_NO_REASON_MSG);
});

/* ── E. Consome SOMENTE especial (regular intacto) ───────── */
check("E. alocação consome só a reserva especial; crédito regular não é tocado", () => {
  reset([...dayDef15(), ...daySat5(), ...day11h()], [concluded5(), planned10()], [reason("2026-08-24")]);
  const before = getAppData();
  const v0 = dayCreditView("2026-08-24", before.entries, before.compensations, before.absences, both, settings, before.excessReasons);
  assert.equal(v0.freeRegular, 120);
  assert.equal(v0.freeSpecial, 60);
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const created = d.compensations.filter((c) => c.portion === "especial" && c.status === "concluida" && c.targetDate === "2026-08-24" && c.minutes === 10);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, "deficit");
  assert.equal(created[0].portion, "especial");
  assert.equal(created[0].status, "concluida");
  assert.equal(created[0].sourceDate, "2026-08-21");
  assert.equal(created[0].targetDate, "2026-08-24");
  assert.equal(created[0].minutes, 10);
  const v = dayCreditView("2026-08-24", d.entries, d.compensations, d.absences, both, settings, d.excessReasons);
  assert.equal(v.freeRegular, 120, "regular livre intacto");
  assert.equal(v.usedRegular, 0);
  assert.equal(v.freeSpecial, 50);
  assert.equal(v.usedSpecialViaTarget, 10);
});

/* ── F. Cenário 21/08 + 24/08: planejado sobreposto é liberado ── */
check("F. 21/08 orig 15 / conc 5 / plan 10 → alocar 10 ⇒ conc 15, plan 0, especial 50", () => {
  reset([...dayDef15(), ...daySat5(), ...day11h()], [concluded5(), planned10()], [reason("2026-08-24")]);
  const plannedId = getAppData().compensations.find((c) => c.status === "pendente")!.id;
  const concludedId = getAppData().compensations.find((c) => c.status === "concluida")!.id;
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 });
  assert.equal(res.ok, true, res.error);
  assert.match(res.warning ?? "", /10min alocados/);
  const d = getAppData();
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, both, d.faltas, settings, { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  assert.equal(dv.date, "2026-08-21");
  assert.equal(dv.compensatedMinutes, 15);
  assert.equal(dv.openMinutes, 0);
  assert.equal(dv.plannedMinutes, 0);
  assert.equal(dv.status, "quitada");
  const planned = d.compensations.find((c) => c.id === plannedId)!;
  assert.equal(planned.status, "cancelada", "parcela planejada cancelada (não apagada)");
  const stillConcluded = d.compensations.find((c) => c.id === concludedId)!;
  assert.equal(stillConcluded.status, "concluida");
  assert.equal(stillConcluded.minutes, 5);
});

/* ── G. Alocação PARCIAL reduz o planejado, não cancela o restante necessário ── */
check("G. alocar 5 de 10 em aberto: conc 10, open 5, planejado reduzido para 5", () => {
  reset([...dayDef15(), ...daySat5(), ...day11h()], [concluded5(), planned10()], [reason("2026-08-24")]);
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 5 });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, both, d.faltas, settings, { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  assert.equal(dv.compensatedMinutes, 10);
  assert.equal(dv.openMinutes, 5);
  assert.equal(dv.plannedMinutes, 5, "planejado não pode exceder o restante");
  assert.equal(dv.status, "parcial");
  const planned = d.compensations.find((c) => c.targetDate === "2026-08-27")!;
  assert.equal(planned.status, "pendente");
  assert.equal(planned.minutes, 5);
});

/* ── H. Histórico: nunca cancela concluídas nem outros déficits ── */
check("H. parcela concluída e déficit de 20/08 permanecem intactos", () => {
  const otherPlanned: Compensation = {
    id: nextId++, sourceDate: "2026-08-20", targetDate: "2026-08-28", minutes: 20,
    status: "pendente", note: null, kind: "deficit", createdAt: 9,
  };
  reset(
    [...dayDef30(), ...dayDef15(), ...daySat5(), ...day11h()],
    [concluded5(), planned10(), otherPlanned],
    [reason("2026-08-24")],
  );
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const other = d.compensations.find((c) => c.sourceDate === "2026-08-20")!;
  assert.equal(other.status, "pendente");
  assert.equal(other.minutes, 20);
  const views = deficitViews(d.entries, d.compensations, d.absences, both, d.faltas, settings, { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  const d20 = views.find((v) => v.date === "2026-08-20")!;
  assert.equal(d20.openMinutes, 30);
  assert.equal(d20.plannedMinutes, 20);
});

/* ── I. Saldo realizado NÃO muda; batidas intactas ───────── */
check("I. saldo realizado inalterado; batidas de 21/08 e 24/08 iguais", () => {
  const entries = [...dayDef15(), ...daySat5(), ...day11h()];
  reset(entries, [concluded5(), planned10()], [reason("2026-08-24")]);
  const range = { from: "2026-08-21", to: "2026-08-24" };
  const before = hourBankSummary(getAppData().entries, getAppData().compensations, [], both, [], getAppData().excessReasons, settings, range, TODAY);
  const punchesBefore = getAppData().entries.map((e) => `${e.date}|${e.time}|${e.type}`).sort();
  actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 });
  const after = hourBankSummary(getAppData().entries, getAppData().compensations, [], both, [], getAppData().excessReasons, settings, range, TODAY);
  assert.equal(after.freeRegularTotal, before.freeRegularTotal, "crédito regular intacto");
  assert.equal(after.openNegativeTotal, before.openNegativeTotal - 10, "dívida cai 10min (10+ realocado)");
  const punchesAfter = getAppData().entries.map((e) => `${e.date}|${e.time}|${e.type}`).sort();
  assert.deepEqual(punchesAfter, punchesBefore);
});

/* ── J. Prévia avisa o planejado sobreposto ──────────────── */
check("J. preview.plannedToRelease = 10; modal exibe o aviso de liberação", () => {
  const entries = [...dayDef15(), ...daySat5(), ...day11h()];
  const comps = [concluded5(), planned10()];
  const pre = previewAllocateSpecialExcess(
    "2026-08-24", "2026-08-21", 10, entries, comps, [], both, [], settings, [reason("2026-08-24")], TODAY,
  );
  assert.equal(pre.ok, true, pre.error);
  assert.equal(pre.plannedNow, 10);
  assert.equal(pre.plannedToRelease, 10);
  assert.equal(pre.remainingDeficitAfter, 0);
  assert.equal(pre.remainingSpecialAfter, 50);
  assert.ok(allocSrc.includes("Planejamento que será liberado"));
  assert.ok(allocSrc.includes("Este déficit possui"));
});

/* ── K. releaseOverlappingPlanned: mais recentes primeiro; só pendentes ── */
check("K. libera as pendentes mais novas; concluídas fora da lista", () => {
  const comps: Compensation[] = [
    { id: 1, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 5, status: "concluida", note: null, kind: "deficit", createdAt: 1 },
    { id: 2, sourceDate: "2026-08-21", targetDate: "2026-08-26", minutes: 8, status: "pendente", note: null, kind: "deficit", createdAt: 2 },
    { id: 3, sourceDate: "2026-08-21", targetDate: "2026-08-27", minutes: 8, status: "pendente", note: null, kind: "deficit", createdAt: 3 },
    { id: 4, sourceDate: "2026-08-20", targetDate: "2026-08-28", minutes: 30, status: "pendente", note: null, kind: "deficit", createdAt: 4 },
  ];
  const { comps: next, released } = releaseOverlappingPlanned(comps, "2026-08-21", 5);
  assert.equal(released, 11, "16 planejados − 5 permitidos = 11 liberados");
  assert.equal(next.find((c) => c.id === 1)!.status, "concluida");
  assert.equal(next.find((c) => c.id === 3)!.status, "cancelada", "mais nova cancelada primeiro");
  assert.equal(next.find((c) => c.id === 2)!.minutes, 5);
  assert.equal(next.find((c) => c.id === 2)!.status, "pendente");
  assert.equal(next.find((c) => c.id === 4)!.status, "pendente", "outro déficit intacto");
});

/* ── L. UI: Compensações/painel preservam; Registros (3E.2) sem o botão ── */
check("L. (3E.2) Realocar excedente segue em Compensações e painel; fora do card Registros", () => {
  assert.ok(!dayCardSrc.includes("onAllocateExcess"), "card sem callback legado (3E.2)");
  assert.ok(!dayCardSrc.includes("Realocar excedente"), "CTA legado fora do card (3E.2)");
  assert.ok(!registrosSrc.includes("AllocateExcessModal"), "Registros não monta o modal legado (3E.2)");
  assert.ok(compensacoesSrc.includes("Realocar excedente"));
  assert.ok(compensacoesSrc.includes("AllocateExcessModal"));
  assert.ok(panelSrc.includes("setAllocateDate(d.date)"));
});

/* ── M. useRealizedCredit NÃO é o fluxo deste card (regular-first) ── */
check("M. fluxo do card NÃO usa useRealizedCredit (que gastaria regular primeiro)", () => {
  assert.ok(!allocSrc.includes("useRealizedCredit"));
  assert.ok(allocSrc.includes("allocateSpecialExcess"));
  const storeSrc = srcOf("src/lib/store.ts");
  assert.ok(storeSrc.includes("portion: \"especial\""));
  assert.ok(storeSrc.includes("Alocado EXCEDENTE DO LIMITE DIÁRIO [10+] (realizado)") || storeSrc.includes("Alocado excedente"));
});

/* ── N. Smart Exit BASE 0 vazio: sem Meta / Jornada padrão / 17:00 ── */
check("N. sábado vazio: buildExitPlan no-punch; UI de folga sem meta/jornada padrão", () => {
  const v = companyDayContext("2026-08-22", [], [], both, settings);
  assert.equal(v.effectiveExpected, 0);
  const plan = buildExitPlan(v.displayDay, settings, [], 17 * 60, "2026-08-22", v.effectiveExpected);
  assert.equal(plan.state, "no-punch");
  assert.notEqual(plan.plannedExit, "17:00");
  assert.ok(smartSrc.includes("Não há jornada obrigatória"));
  assert.ok(smartSrc.includes("Hoje é <b>folga</b>"));
  assert.ok(smartSrc.includes("offDuty"));
  assert.ok(smartSrc.includes("punchBlocked"));
});

/* ── O. BASE 0 aberto: Trabalho em folga, sem Meta 0 / Agora / Jornada padrão ── */
check("O. UI de ponto aberto em folga: Sem meta de jornada hoje + Registrar saída agora", () => {
  assert.ok(smartSrc.includes("Sem meta de jornada hoje"));
  assert.ok(smartSrc.includes("Trabalho em folga"));
  assert.ok(smartSrc.includes("Registrar saída agora"));
  // o caminho weekday de meta-atingida continua existindo (não removido)
  assert.ok(smartSrc.includes("Jornada padrão"));
  assert.ok(smartSrc.includes("Meta atingida — você já pode registrar a saída."));
  // mas o short-circuit de base 0 vem ANTES do caminho goal-reached
  const offIdx = smartSrc.indexOf("BASE 0");
  const goalIdx = smartSrc.indexOf('plan.state === "goal-reached"');
  assert.ok(offIdx > 0 && goalIdx > offIdx, "short-circuit de base 0 precede o caminho de meta atingida");
});

/* ── P. BASE 0 encerrado: Trabalho em folga encerrado + crédito ── */
check("P. UI de folga encerrada e crédito; feriado/Abono/Férias não viram Trabalho em folga", () => {
  assert.ok(smartSrc.includes("Trabalho em folga encerrado ✓"));
  const sat = companyDayContext(
    "2026-08-22",
    [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "10:00", "saida")],
    [],
    both,
    settings,
  );
  assert.equal(sat.type, "trabalho-folga");
  assert.equal(sat.adjustedBalance, 120);
  const ferias: Absence = {
    id: 1, kind: "ferias", startDate: "2026-08-24", endDate: "2026-08-24",
    duration: "integral", note: null, createdAt: 1,
  };
  const f = companyDayContext("2026-08-24", [], [ferias], both, settings);
  assert.equal(f.effectiveExpected, 0);
  assert.notEqual(f.type, "trabalho-folga");
  assert.ok(pageSrc.includes("punchBlocked"));
  assert.ok(pageSrc.includes('todayCtx.marker === "abono"'));
  assert.ok(smartSrc.includes("punchBlocked"));
});

/* ── Q. buildExitPlan financeiro de dia útil intacto ─────── */
check("Q. dia útil 08:37 → saída 17:37 (buildExitPlan inalterado)", () => {
  const date = "2026-08-21";
  const entries = [punch(date, "08:37", "entrada")];
  const day = computeDay(entries, settings, 9 * 60);
  const plan = buildExitPlan(day, settings, [], 9 * 60, date);
  assert.equal(plan.plannedExit, "17:37");
  assert.equal(plan.state, "planned");
  assert.equal(plan.targetMinutes, 480);
});

/* ── R. 0 batidas + gate ok → Registrar falta âmbar ──────── */
check("R. zero batidas + gate ok → botão âmbar Registrar falta (inalterado)", () => {
  assert.ok(quickSrc.includes("showRegistrarFalta"));
  assert.ok(quickSrc.includes('variant="warning"'));
  assert.ok(quickSrc.includes("Registrar falta"));
  assert.ok(quickSrc.includes("today.entries.length === 0"));
});

/* ── S. 1+ batidas → botão some; zerar batidas o devolve ─── */
check("S. com batidas o botão some; condição exige zero batidas", () => {
  assert.match(quickSrc, /showRegistrarFalta =\s*\n\s*today\.entries\.length === 0/);
  assert.ok(quickSrc.includes("today.entries.length > 0 ? ("));
});

/* ── T. Falta registrada: banner substitui os controles ──── */
check("T. banner ⚠ FALTA REGISTRADA HOJE substitui os controles de ponto", () => {
  assert.ok(quickSrc.includes("⚠ FALTA REGISTRADA HOJE"));
  assert.ok(quickSrc.includes("O déficit gerado corresponde à jornada prevista para este dia."));
  assert.ok(quickSrc.includes("if (faltaRegistrada)"));
  const earlyIdx = quickSrc.indexOf("if (faltaRegistrada)");
  const punchIdx = quickSrc.indexOf('nextIsEntrada ? "Registrar entrada"');
  assert.ok(earlyIdx > 0 && punchIdx > earlyIdx, "early-return da falta antes dos botões de ponto");
});

/* ── U. Déficit da falta vem da jornada efetiva, nunca 8h fixas ── */
check("U. Déficit gerado usa jornadaMinutes (resolução central)", () => {
  assert.ok(quickSrc.includes("Déficit gerado:"));
  assert.ok(quickSrc.includes("formatMinutes(jornadaMinutes)"));
  assert.ok(pageSrc.includes("jornadaMinutes={todayCtx.effectiveExpected}"));
  assert.ok(!quickSrc.includes("Déficit gerado: 8h") && !quickSrc.includes('"8h"'));
});

/* ── V. Excluir falta no banner; Assistente tem estado próprio ── */
check("V. Excluir falta no banner; Assistente mostra Falta registrada (sem previsão)", () => {
  assert.ok(quickSrc.includes("Excluir falta"));
  assert.ok(pageSrc.includes("onRemoveFalta={removeFaltaHoje}"));
  assert.ok(smartSrc.includes("Falta registrada"));
  assert.ok(smartSrc.includes("Não há previsão de saída"));
  assert.ok(pageSrc.includes("faltaRegistrada={!!faltaHoje}"));
  const faltaIdx = smartSrc.indexOf("if (faltaRegistrada)");
  const metaIdx = smartSrc.indexOf("Meta:");
  assert.ok(faltaIdx > 0 && faltaIdx < metaIdx, "estado de falta precede Meta/Faltam/saída prevista");
});

/* ── W. Ordem da Visão geral preservada (desktop/mobile) ─── */
check("W. 4D.1 ordem: saudação → Registro de hoje → … → O que vem pela frente → Dias recentes", () => {
  // 4V: a página virou fluxo único (sem classes order-*). 4D.1: o Registro
  // de hoje (ação mais imediata) fica logo após saudação/atenção.
  const saudacao = pageSrc.indexOf("Olá, {user.name}");
  const registro = pageSrc.indexOf('title="Registro de hoje"');
  // Âncora precisa: comentário F. da seção (não o texto do cabeçalho).
  const frente = pageSrc.indexOf("F. O QUE VEM PELA FRENTE");
  const recentes = pageSrc.indexOf('title="Dias recentes"');
  assert.ok(saudacao > 0 && saudacao < registro, "saudação antes do Registro de hoje");
  assert.ok(registro > 0 && registro < frente, "4D.1: Registro de hoje antes de Ciclo/Período/frente");
  assert.ok(frente > 0 && frente < recentes, "4D.1: frente antes de Dias recentes");
});

/* ── X. Store: alocar sem alterar useRealizedCreditForDeficit ── */
check("X. useRealizedCreditForDeficit permanece especial-então-regular (outro fluxo)", () => {
  const hb = srcOf("src/lib/hour-bank.ts");
  assert.ok(hb.includes("PRIORIDADE (§8): primeiro a RESERVA ESPECIAL"));
  reset([...dayDef30(), ...day11h()], [], [reason("2026-08-24")]);
  const auto = actions.useRealizedCreditForDeficit("2026-08-20");
  assert.equal(auto.ok, true, auto.error);
  const comps = getAppData().compensations;
  assert.equal(comps[0].portion, "especial");
  assert.equal(comps[0].minutes, 30);
});

/* ── Y. Compensação futura (Programar hora extra) intacta ── */
check("Y. Programar hora extra segue no CompensationForm; ciclo 30/04 intacto", () => {
  assert.ok(panelSrc.includes("openFor(d.date, d.kind)") || panelSrc.includes('openFor(d.date, "deficit")'));
  assert.ok(panelSrc.includes("Programar hora extra"));
  const storeSrc = srcOf("src/lib/store.ts");
  assert.ok(storeSrc.includes("validateCompCycle(p.deficitDate, p.excessDate)"));
  reset([...dayDef15()]);
  const cross = actions.addComp({
    sourceDate: "2026-04-28", targetDate: "2026-05-06", minutes: 60, note: null, kind: "deficit",
  });
  assert.equal(cross.ok, false);
  assert.equal(cross.code, "cross-cycle");
});

/* ── ciclo.A–H. filtro pelo MESMO ciclo anual da origem ──── */
const prevCycleDay = () => [punch("2026-02-18", "08:00", "entrada"), punch("2026-02-18", "10:00", "saida")];
const closeDay = () => [punch("2026-04-29", "08:00", "entrada"), punch("2026-04-29", "16:45", "saida")];

check("ciclo.A. origem 24/08/2026 — déficit 18/02/2026 NÃO é elegível (ciclo anterior)", () => {
  const entries = [...prevCycleDay(), ...dayDef15(), ...daySat5(), ...day11h()];
  const list = eligibleDeficitsForSpecialAllocation(
    "2026-08-24", entries, [], [], both, [], settings, TODAY,
  );
  assert.equal(list.some((d) => d.date === "2026-02-18"), false);
  assert.equal(sameAnnualCycle("2026-08-24", "2026-02-18"), false);
});

check("ciclo.B. origem 24/08/2026 — déficit 29/04/2026 NÃO é elegível (ciclo anterior)", () => {
  const entries = [...closeDay(), ...dayDef15(), ...daySat5(), ...day11h()];
  const list = eligibleDeficitsForSpecialAllocation(
    "2026-08-24", entries, [], [], both, [], settings, TODAY,
  );
  assert.equal(list.some((d) => d.date === "2026-04-29"), false);
  assert.equal(sameAnnualCycle("2026-08-24", "2026-04-29"), false);
  assert.equal(getAnnualPointCycle("2026-04-29"), "2025/2026");
  assert.equal(getAnnualPointCycle("2026-08-24"), "2026/2027");
});

check("ciclo.C. origem 24/08/2026 — déficit 21/08/2026 É elegível (mesmo ciclo)", () => {
  const entries = [...prevCycleDay(), ...closeDay(), ...dayDef15(), ...daySat5(), ...day11h()];
  const list = eligibleDeficitsForSpecialAllocation(
    "2026-08-24", entries, [concluded5(), planned10()], [], both, [], settings, TODAY,
  );
  const d21 = list.find((d) => d.date === "2026-08-21");
  assert.ok(d21, "21/08 deve aparecer");
  assert.equal(sameAnnualCycle("2026-08-24", "2026-08-21"), true);
});

check("ciclo.D. 21/08 orig 15 / conc 5 / plan 10 → open 10 · max alocável 10", () => {
  const entries = [...dayDef15(), ...daySat5(), ...day11h()];
  const comps = [concluded5(), planned10()];
  const list = eligibleDeficitsForSpecialAllocation(
    "2026-08-24", entries, comps, [], both, [], settings, TODAY,
  );
  const d21 = list.find((d) => d.date === "2026-08-21")!;
  assert.equal(d21.originalMinutes, 15);
  assert.equal(d21.compensatedMinutes, 5);
  assert.equal(d21.plannedMinutes, 10);
  assert.equal(d21.openMinutes, 10);
  const cap = maxAllocatableSpecial(
    "2026-08-24", "2026-08-21", entries, comps, [], both, [], settings, [reason("2026-08-24")], TODAY,
  );
  assert.equal(cap.freeSpecial, 60);
  assert.equal(cap.max, 10, "nunca 60min para um restante factual de 10");
});

check("ciclo.E. planejado 10 aparece informativamente e NÃO reduz o restante factual", () => {
  assert.ok(allocSrc.includes("Planejado:"));
  const entries = [...dayDef15(), ...daySat5(), ...day11h()];
  const comps = [concluded5(), planned10()];
  const [dv] = deficitViews(entries, comps, [], both, [], settings, { from: "2026-08-21", to: "2026-08-21" }, TODAY);
  assert.equal(dv.plannedMinutes, 10);
  assert.equal(dv.openMinutes, 10, "open = original − concluído; planejado não quita");
});

check("ciclo.F. ação central rejeita alocação cross-cycle com mensagem clara", () => {
  reset([...prevCycleDay(), ...day11h()], [], [reason("2026-08-24")]);
  const res = actions.allocateSpecialExcess({
    excessDate: "2026-08-24", deficitDate: "2026-02-18", minutes: 10,
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "cross-cycle");
  assert.equal(res.error, ALLOCATE_CROSS_CYCLE_MSG);
  const pre = previewAllocateSpecialExcess(
    "2026-08-24", "2026-04-29", 10,
    [...closeDay(), ...day11h()], [], [], both, [], settings, [reason("2026-08-24")], TODAY,
  );
  assert.equal(pre.ok, false);
  assert.equal(pre.error, ALLOCATE_CROSS_CYCLE_MSG);
});

check("ciclo.G. mesmo ciclo continua alocando normalmente (21/08 ← 24/08)", () => {
  reset([...dayDef15(), ...daySat5(), ...day11h()], [concluded5(), planned10()], [reason("2026-08-24")]);
  const res = actions.allocateSpecialExcess({ excessDate: "2026-08-24", deficitDate: "2026-08-21", minutes: 10 });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, both, d.faltas, settings, { from: "2026-08-21", to: "2026-08-21" }, TODAY);
  assert.equal(dv.openMinutes, 0);
  assert.equal(dv.compensatedMinutes, 15);
});

check("ciclo.H. 30/04 permanece barreira absoluta; ordem = Dias com saldo negativo", () => {
  const bounds = annualCycleBounds(getAnnualPointCycle("2026-08-24"));
  assert.equal(bounds.from, "2026-05-01");
  assert.equal(bounds.to, "2027-04-30");
  const hb = srcOf("src/lib/hour-bank.ts");
  assert.ok(hb.includes("annualCycleBounds(getAnnualPointCycle(excessDate))"));
  assert.ok(hb.includes(".reverse()") || hb.includes("b.date.localeCompare(a.date)"), "mais recente primeiro");
  assert.ok(panelSrc.includes("negativeBalanceViews") || panelSrc.includes(").reverse()"), "painel Dias com saldo negativo");
  reset([...dayDef15()]);
  const cross = actions.addComp({
    sourceDate: "2026-04-28", targetDate: "2026-05-06", minutes: 60, note: null, kind: "deficit",
  });
  assert.equal(cross.ok, false);
  assert.equal(cross.code, "cross-cycle");
});

reset([]);
console.log(`\nALOCAR + ASSISTENTE + FALTA — OK (${passed} testes)`);
