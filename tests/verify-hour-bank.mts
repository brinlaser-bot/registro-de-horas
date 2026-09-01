/**
 * VERIFICAÇÃO — BANCO DE HORAS + COMPENSAÇÕES SIMPLIFICADAS + EXCEDENTE >10H
 * (seção 35, testes A–X).
 *
 * Princípios cobertos:
 *  - REALIZADO ≠ PLANEJADO ≠ COMPENSADO: saldo realizado só muda com fatos;
 *  - compensação imediata com crédito já realizado (sem etapa Pendente artificial);
 *  - excedente >10h = reserva especial EXIGINDO motivo antes da realocação,
 *    com prioridade na quitação automática de déficits;
 *  - status derivados (Parcial/Atrasada), Registrar parcial e Reprogramar;
 *  - guardas de lastro (updateEntry/deleteEntry por ORIGEM e por DESTINO);
 *  - correções §20 (Nenhum déficit em aberto), §27/§28 (atalhos + mensagem
 *    contextual), §29 (Smart Exit sem +1h) e §30 (quitação só com jornada fechada).
 *
 * Executar: npx tsx tests/verify-hour-bank.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { canCompleteComp } from "../src/lib/debt.ts";
import {
  canAllocateExcess,
  creditUseSummary,
  dayCreditView,
  deficitViews,
  excessReasonLabel,
  futureCompStatus,
  hourBankSummary,
  planRealizedCreditUse,
} from "../src/lib/hour-bank.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import {
  insertPunchError,
  plannedExitTime,
  validatePunchSequence,
} from "../src/lib/time.ts";
import type {
  Compensation,
  ExcessReason,
  TimeEntry,
  User,
  WorkSettings,
} from "../src/lib/types.ts";

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

/** "Hoje" dos CENÁRIOS (lib pura recebe esse mesmo valor; datas ≤ ele são reais). */
const TODAY = "2026-08-24";
// Datas fixas úteis (fixture fictício 2026/2027):
//   19/08 qua · 20/08 qui · 21/08 sex · 22/08 sáb · 23/08 dom · 24/08 seg
//   (25/08 = COMPENSAR 8h no calendário; 15/08 = ABONADO — fora dos cenários)

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const reason = (date: string): ExcessReason => ({
  id: nextId++, date, reason: "necessidade-operacional",
  customReason: null, observation: null, createdAt: 1, updatedAt: 1,
});

/** 21/08 (sex): 08:00→16:45 = 7h45 → déficit 15min. */
const dayDef15 = () => [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida")];
/** 21/08 (sex): 08:00→12:00 (batida no almoço) = 4h → déficit 240min. */
const dayDef240 = () => [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "12:00", "saida")];
/** 20/08 (qui): 08:00→16:30 = 7h30 → déficit 30min. */
const dayDef30 = () => [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "16:30", "saida")];
/** 20/08 (qui): 08:00→15:00 = 6h → déficit 120min. */
const dayDef120 = () => [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "15:00", "saida")];
/** 19/08 (qua): 08:00→19:45 = 11h45 − 1h almoço = 10h45 → regular 120 + excedente 45. */
const dayExcess45 = () => [punch("2026-08-19", "08:00", "entrada"), punch("2026-08-19", "19:45", "saida")];

const reset = (
  entries: TimeEntry[],
  comps: Compensation[] = [],
  excessReasons: ExcessReason[] = [],
) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences: [],
    companyCalendars: both, faltas: [], excessReasons,
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. Banco de horas REAL: só fatos (21/08 −15, 22/08 +2h, 23/08 +1h) ── */
check("A. saldo realizado = −15min + 2h + 1h = +2h45; positivas livres 3h; déficit em aberto 15min", () => {
  const entries = [
    ...dayDef15(),
    punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "10:00", "saida"),
    punch("2026-08-23", "14:00", "entrada"), punch("2026-08-23", "15:00", "saida"),
  ];
  const range = { from: "2026-08-21", to: "2026-08-23" };
  const bank = hourBankSummary(entries, [], [], both, [], [], settings, range, "2026-08-23");
  assert.equal(bank.realizedBalance, 165, "−15 +120 +60 = +2h45");
  assert.equal(bank.freeRegularTotal, 180, "+2h +1h livres (déficit não gera crédito)");
  assert.equal(bank.openDeficitTotal, 15, "déficit original − concluído(0)");
  assert.equal(bank.excessSpecialFreeTotal, 0);
  assert.equal(bank.plannedTotal, 0);
});

/* ── B. Planejamento +10min NÃO altera o realizado ───────────── */
check("B. compensação PLANEJADA não muda saldo realizado nem quita déficit em aberto", () => {
  const entries = [
    ...dayDef15(),
    punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "10:00", "saida"),
    punch("2026-08-23", "14:00", "entrada"), punch("2026-08-23", "15:00", "saida"),
  ];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-27", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const range = { from: "2026-08-21", to: "2026-08-27" };
  const bank = hourBankSummary(entries, [comp], [], both, [], [], settings, range, TODAY);
  assert.equal(bank.realizedBalance, 165, "planejado NÃO altera o realizado");
  assert.equal(bank.plannedTotal, 10, "planejado é só informativo");
  assert.equal(bank.openDeficitTotal, 15, "planejado não quita o déficit em aberto");
  const [dv] = deficitViews(entries, [comp], [], both, [], settings, { from: "2026-08-01", to: "2026-08-31" }, "2026-08-23");
  assert.equal(dv.plannedMinutes, 10);
  assert.equal(dv.compensatedMinutes, 0);
  assert.equal(dv.openMinutes, 15);
  assert.equal(dv.unplannedMinutes, 5, "sem programação cai para 5 (10 já destinados)");
  assert.equal(dv.status, "pendente");
});

/* ── C. Crédito +20 cobre déficit −15 → concluída imediata, 5min livres ── */
check("C. usar horas livres quita −15 com +20: parcela CONCLUÍDA imediata (sem Pendente), 5min livres", () => {
  reset([...dayDef15(), punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "08:20", "saida")]);
  const res = actions.useRealizedCreditForDeficit("2026-08-21");
  assert.equal(res.ok, true, `quitação imediata falhou: ${res.error}`);
  assert.match(res.warning ?? "", /Déficit quitado/);
  const comps = getAppData().compensations;
  assert.equal(comps.length, 1, "uma única parcela criada");
  assert.equal(comps[0].status, "concluida", "nasce concluída — sem etapa Pendente artificial");
  assert.equal(comps[0].kind, "deficit");
  assert.equal(comps[0].sourceDate, "2026-08-21");
  assert.equal(comps[0].targetDate, "2026-08-22");
  assert.equal(comps[0].minutes, 15, "usa só o necessário (15), não os 20");
  const d = getAppData();
  const v = dayCreditView("2026-08-22", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.freeRegular, 5, "5min de crédito ainda livres no sábado");
  const bank = hourBankSummary(d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, d.excessReasons, settings,
    { from: "2026-08-21", to: "2026-08-22" }, TODAY);
  assert.equal(bank.realizedBalance, 5, "realizado inalterado pelo vínculo (−15+20)");
  assert.equal(bank.openDeficitTotal, 0, "déficit quitado");
});

/* ── D. Crédito +5 sobre déficit −15 → Parcial, 10min restantes ── */
check("D. aplicação PARCIAL (−15 com +5): usa 5, estado Parcial, 10min em aberto", () => {
  reset([...dayDef15(), punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "08:05", "saida")]);
  const res = actions.useRealizedCreditForDeficit("2026-08-21");
  assert.equal(res.ok, true, res.error);
  assert.match(res.warning ?? "", /Aplicação parcial/, "avisa que ficou saldo sem programação");
  const d = getAppData();
  assert.equal(d.compensations.length, 1);
  assert.equal(d.compensations[0].minutes, 5);
  assert.equal(d.compensations[0].status, "concluida");
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, settings,
    { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  assert.equal(dv.compensatedMinutes, 5);
  assert.equal(dv.openMinutes, 10, "10min ainda em aberto — NÃO é 'Nenhum déficit'");
  assert.equal(dv.status, "parcial", "estado final = Parcial (nunca 'Concluir parcial')");
});

/* ── E. 10h45 → crédito regular até o limite + reserva especial separada ── */
check("E. dia 10h45: regular 2h (até 10h) + excedente especial 45min em reserva separada", () => {
  const v = dayCreditView("2026-08-19", dayExcess45(), [], [], both, settings, []);
  assert.equal(v.day.workedMinutes, 645, "10h45 trabalhadas");
  assert.equal(v.realizedPositive, 165, "hora positiva total");
  assert.equal(v.regularExtra, 120, "até o limite de 10h = crédito regular");
  assert.equal(v.excessSpecial, 45, "acima de 10h = reserva especial");
  assert.equal(v.freeRegular, 120);
  assert.equal(v.freeSpecial, 45, "0 destinado → 45 livres na reserva");
});

/* ── F. Sem motivo → a parcela da reserva especial NÃO aloca ─── */
check("F. realocar excedente >10h SEM motivo é rejeitado (⚠ Motivo não informado)", () => {
  reset([...dayExcess45(), ...dayDef240()]);
  const gate = canAllocateExcess("2026-08-19", dayExcess45(), settings, []);
  assert.equal(gate.ok, false);
  assert.match(gate.error ?? "", /Motivo não informado/);
  // 125 = 120 regular + 5 da reserva especial → consumo da reserva exige motivo
  const res = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: "2026-08-19", minutes: 125 });
  assert.equal(res.ok, false, "não pode alocar a porção especial sem motivo");
  assert.match(res.error ?? "", /Motivo não informado/);
  // Dentro do crédito regular (até 10h) NÃO precisa de motivo
  const ok120 = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: "2026-08-19", minutes: 120 });
  assert.equal(ok120.ok, true, ok120.error);
  assert.equal(getAppData().compensations.filter((c) => c.status !== "cancelada").length, 1);
});

/* ── G. Motivo registrado → a reserva aloca; validações do modal/store ── */
check("G. motivo registrado libera a realocação; 'Outro' sem texto é rejeitado", () => {
  // continua o cenário F (120 já usados do crédito regular)
  const bad = actions.setExcessReason({ date: "2026-08-19", reason: "outro", customReason: "" });
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? "", /Informe o motivo/);
  const ok = actions.setExcessReason({ date: "2026-08-19", reason: "atendimento-evento", observation: "Feira" });
  assert.equal(ok.ok, true, ok.error);
  const d1 = getAppData();
  assert.equal(d1.excessReasons?.length, 1);
  assert.equal(excessReasonLabel(d1.excessReasons![0]), "Atendimento/evento");
  assert.equal(canAllocateExcess("2026-08-19", dayExcess45(), settings, d1.excessReasons).ok, true);
  // agora 10min da reserva especial alocam (regular já esgotado pelos 120)
  const used = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: "2026-08-19", minutes: 10 });
  assert.equal(used.ok, true, used.error);
  const d = getAppData();
  const v = dayCreditView("2026-08-19", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.usedSpecialViaTarget, 10, "10min vieram da reserva especial");
  assert.equal(v.freeSpecial, 35);
  assert.equal(v.freeRegular, 0);
  // edição do motivo (upsert por data, sem duplicar registro)
  const edit = actions.setExcessReason({ date: "2026-08-19", reason: "outro", customReason: "Plantão extraordinário" });
  assert.equal(edit.ok, true, edit.error);
  assert.equal(getAppData().excessReasons?.length, 1, "um registro por data");
  assert.match(excessReasonLabel(getAppData().excessReasons![0]), /Outro — Plantão extraordinário/);
});

/* ── H. Déficit 30 + excedente 45 → especial primeiro; concluído, 15 restantes ── */
check("H. quitação automática consome o EXCEDENTE >10h primeiro: 30 de 45, restam 15", () => {
  reset([...dayDef30(), ...dayExcess45()], [], [reason("2026-08-19")]);
  const res = actions.useRealizedCreditForDeficit("2026-08-20");
  assert.equal(res.ok, true, res.error);
  assert.match(res.warning ?? "", /Déficit quitado/);
  const comps = getAppData().compensations;
  assert.equal(comps.length, 1, "excedente sozinho cobriu o déficit");
  assert.equal(comps[0].minutes, 30);
  assert.equal(comps[0].targetDate, "2026-08-19");
  assert.equal(comps[0].status, "concluida");
  assert.match(comps[0].note ?? "", /excedente acima de 10h/i, "parcela marcada como uso da reserva");
  const d = getAppData();
  const v = dayCreditView("2026-08-19", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.freeSpecial, 15, "restam 15min da reserva especial");
  assert.equal(v.freeRegular, 120, "crédito regular intacto");
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, settings,
    { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  assert.equal(dv.status, "quitada");
  assert.equal(dv.openMinutes, 0);
});

/* ── I. Automática: especial acaba ANTES de tocar no regular ─── */
check("I. prioridade do plano: reserva especial (45) esgota primeiro; regular completa 75", () => {
  const plan = planRealizedCreditUse(
    "2026-08-20", 120, [...dayDef120(), ...dayExcess45()], [], [], both, settings,
    [reason("2026-08-19")], TODAY,
  );
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.parcels.length, 2);
  assert.deepEqual(
    plan.parcels.map((p) => [p.minutes, p.portion]),
    [[45, "especial"], [75, "regular"]],
    "especial primeiro, regular depois",
  );
  assert.match(creditUseSummary(plan.parcels), /2h/);

  reset([...dayDef120(), ...dayExcess45()], [], [reason("2026-08-19")]);
  const res = actions.useRealizedCreditForDeficit("2026-08-20");
  assert.equal(res.ok, true, res.error);
  const comps = getAppData().compensations;
  assert.deepEqual(
    comps.map((c: Compensation) => [c.minutes, c.note?.includes("10h") ? "especial" : "regular"]),
    [[45, "especial"], [75, "regular"]],
  );
  const d = getAppData();
  const v = dayCreditView("2026-08-19", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.freeSpecial, 0);
  assert.equal(v.freeRegular, 45);
});

/* ── J. 10min planejados NÃO são compensados ─────────────────── */
check("J. planejado ≠ compensado: parcela pendente mantém 15min em aberto", () => {
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-27", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const [dv] = deficitViews(dayDef15(), [comp], [], both, [], settings, { from: "2026-08-01", to: "2026-08-31" }, "2026-08-23");
  assert.equal(dv.compensatedMinutes, 0, "nada compensado ainda");
  assert.equal(dv.plannedMinutes, 10);
  assert.equal(dv.openMinutes, 15, "em aberto = original − CONCLUÍDO");
  assert.equal(dv.status, "pendente");
  assert.equal(dv.parcels[0].future.status, "pendente", "destino futuro → Pendente");
});

/* ── K. 5 concluídos + 10 planejados de 15 → Parcial, NUNCA 'Nenhum déficit' ── */
check("K. §20: 5 concluídos + 10 planejados (de 15) → 10 em aberto, Parcial, visível no painel", () => {
  const done: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 5,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  };
  const planned: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-27", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 2,
  };
  const entries = [...dayDef15(), punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "08:05", "saida")];
  const [dv] = deficitViews(entries, [done, planned], [], both, [], settings, { from: "2026-08-01", to: "2026-08-31" }, "2026-08-23");
  assert.equal(dv.compensatedMinutes, 5);
  assert.equal(dv.plannedMinutes, 10);
  assert.equal(dv.unplannedMinutes, 0, "sem programação = 0 (tudo destinado)");
  assert.equal(dv.openMinutes, 10, "§20: em aberto = 15 − 5 concluídos = 10 (planejado NÃO quita)");
  assert.equal(dv.status, "parcial");
  // §20 causa raiz do bug: o painel filtrava por remainingMinutes(0) → EmptyState errado
  const panel = srcOf("src/components/excess-panel.tsx");
  assert.ok(
    panel.includes("d.openMinutes > 0 && d.date <= today"),
    "painel lista déficits factuais em aberto do ciclo (planejado NÃO quita)",
  );
  assert.ok(
    panel.includes("já foram quitados"),
    "EmptyState só quando o déficit factual do ciclo foi quitado",
  );
});

/* ── L. Data chega com 6 de 10 realizados → Registrar parcial ── */
check("L. destino = hoje com 6min realizados de 10 → Parcial; Registrar parcial conclui 6 e mantém 4", () => {
  const entries = [
    ...dayDef15(),
    punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "17:06", "saida"), // 8h06 → +6
  ];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const fut = futureCompStatus(comp, entries, [comp], settings, TODAY, { companyCalendars: both });
  assert.equal(fut.status, "parcial");
  assert.equal(fut.realizedMinutes, 6);
  assert.equal(fut.remainingMinutes, 4);

  reset(entries, [comp]);
  const res = actions.registerPartialComp(comp.id);
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const original = d.compensations.find((c) => c.id === comp.id)!;
  assert.equal(original.minutes, 4, "resto continua PLANEJADO");
  assert.equal(original.status, "pendente");
  const partial = d.compensations.find((c) => c.id !== comp.id)!;
  assert.equal(partial.minutes, 6);
  assert.equal(partial.status, "concluida", "só a parte realizada conclui");
  const again = actions.registerPartialComp(comp.id);
  assert.equal(again.ok, false, "sem nova realização, nada a registrar");
  assert.match(again.error ?? "", /realização parcial/);
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, settings,
    { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  assert.equal(dv.compensatedMinutes, 6);
  assert.equal(dv.openMinutes, 9);
});

/* ── M. Data passa, 0 realizado → Atrasada; Reprogramar mantém o vínculo ── */
check("M. destino passado sem realização → Atrasada; reprogramar preserva id/vínculo (sem obrigação nova)", () => {
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const fut = futureCompStatus(comp, dayDef15(), [comp], settings, TODAY, { companyCalendars: both });
  assert.equal(fut.status, "atrasada", "22/08 já passou e nada foi realizado");
  assert.equal(fut.remainingMinutes, 10);

  reset(dayDef15(), [comp]);
  const res = actions.updateComp(comp.id, { targetDate: "2026-08-27" });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  assert.equal(d.compensations.length, 1, "mesma obrigação (nenhuma parcela nova)");
  assert.equal(d.compensations[0].id, comp.id, "mesmo id — vínculo mantido");
  assert.equal(d.compensations[0].targetDate, "2026-08-27");
  assert.equal(d.compensations[0].sourceDate, "2026-08-21");
  assert.equal(d.compensations[0].status, "pendente");
  const fut2 = futureCompStatus(d.compensations[0], d.entries, d.compensations, settings, TODAY, { companyCalendars: both });
  assert.equal(fut2.status, "pendente", "nova data futura destrava o atraso");
});

/* ── N. Edição que quebra o lastro do DESTINO (1h15 consumidas → 15min) ── */
check("N. §23: edição 09:15→08:15 no destino com 1h15 concluídas é BLOQUEADA", () => {
  const entries = [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "09:15", "saida")];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 75,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  };
  reset(entries, [comp]);
  const saidaId = entries[1].id;
  const res = actions.updateEntry(saidaId, { time: "08:15" });
  assert.equal(res.ok, false, "capacidade cairia de 75 para 15 com 75 usados");
  assert.equal(
    res.error,
    "Este registro sustenta compensações já concluídas. A alteração reduziria as horas utilizadas e não pode ser aplicada.",
  );
  const still = getAppData().entries.find((e) => e.id === saidaId)!;
  assert.equal(still.time, "09:15", "registro original preservado integralmente");
});

/* ── O. Edição que MANTÉM 1h15 → permitida ───────────────────── */
check("O. mover o bloco mantendo 1h15 (entrada 07:45, saída 09:00) é permitido", () => {
  const entries = [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "09:15", "saida")];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 75,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  };
  reset(entries, [comp]);
  const okStart = actions.updateEntry(entries[0].id, { time: "07:45" });
  assert.equal(okStart.ok, true, okStart.error);
  const okEnd = actions.updateEntry(entries[1].id, { time: "09:00" });
  assert.equal(okEnd.ok, true, okEnd.error);
  const d = getAppData();
  const v = dayCreditView("2026-08-22", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.day.workedMinutes, 75, "bloco deslocado manteve as 1h15");
});

/* ── P. Edição que AUMENTA para 1h20 → permitida ─────────────── */
check("P. aumentar a saída para 1h20 de capacidade (≥ 1h15 usadas) é permitido", () => {
  const entries = [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "09:15", "saida")];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 75,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  };
  reset(entries, [comp]);
  const res = actions.updateEntry(entries[1].id, { time: "09:20" });
  assert.equal(res.ok, true, res.error);
  const d = getAppData();
  const v = dayCreditView("2026-08-22", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.day.workedMinutes, 80);
  assert.equal(v.freeRegular, 5, "80 − 75 usados = 5 livres");
});

/* ── Q. Exclusão quebrando lastro → BLOQUEADA (origem E destino) ── */
check("Q. §25: deleteEntry bloqueia quando a batida sustenta compensação concluída", () => {
  const origin = dayDef240(); // déficit 240 sustenta a parcela concluída (origem)
  const target = [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "09:00", "saida")];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 60,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  };
  reset([...origin, ...target], [comp]);
  const l1 = getAppData().entries.length;
  const delOrigin = actions.deleteEntry(origin[1].id); // saída 12:00 → déficit some (dia aberto)
  assert.equal(delOrigin.ok, false, "origem: sem dívida para sustentar 60min concluídos");
  assert.match(delOrigin.error ?? "", /já sustenta uma compensação concluída/);
  const delTarget = actions.deleteEntry(target[1].id); // saída 09:00 → capacidade zero
  assert.equal(delTarget.ok, false, "destino: capacidade cairia abaixo dos 60min usados");
  assert.match(delTarget.error ?? "", /sustenta compensações já concluídas/);
  assert.equal(getAppData().entries.length, l1, "nada foi excluído");
});

/* ── R. Exclusão segura → permitida ──────────────────────────── */
check("R. exclusões seguras são permitidas (dia sem vínculo; e sobra ≥ consumido)", () => {
  const sunday = [punch("2026-08-23", "14:00", "entrada"), punch("2026-08-23", "14:30", "saida")];
  reset(sunday);
  const ok1 = actions.deleteEntry(sunday[1].id);
  assert.equal(ok1.ok, true, "dia sem compensações: exclusão livre");
  assert.equal(getAppData().entries.length, 1);

  const quad = [
    punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "09:00", "saida"),
    punch("2026-08-22", "10:00", "entrada"), punch("2026-08-22", "11:00", "saida"),
  ];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 60,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  };
  reset(quad, [comp]);
  const ok2 = actions.deleteEntry(quad[3].id); // sobra 08:00–09:00 = 60 = consumido
  assert.equal(ok2.ok, true, ok2.error);
  assert.equal(getAppData().entries.length, 3);
});

/* ── S. Atalho Volta 13:00 com dia fechado 08:00→18:20 NÃO renderiza ── */
check("S. §27: atalhos Almoço/Volta inválidos pela validação central não aparecem", () => {
  const closed = [punch(TODAY, "08:00", "entrada"), punch(TODAY, "18:20", "saida")];
  const volta = validatePunchSequence([...closed, { id: -2, date: TODAY, time: "13:00", type: "entrada", note: null }]);
  assert.equal(volta.ok, false, "Volta 13:00 criaria duas entradas → atalho oculto");
  const almoco = validatePunchSequence([...closed, { id: -1, date: TODAY, time: "12:00", type: "saida", note: null }]);
  assert.equal(almoco.ok, false, "Almoço 12:00 criaria duas saídas → atalho oculto");
  const src = srcOf("src/components/quick-punch.tsx");
  assert.ok(src.includes("canLunchShortcut") && src.includes("validatePunchSequence"), "simulação central antes de renderizar");
  assert.ok(src.includes("canBackShortcut"));
  assert.ok(src.includes("{canLunchShortcut && (") && src.includes("{canBackShortcut && ("), "render condicionado à validação");
});

/* ── T. Inserção programática no MEIO → rejeitada com mensagem contextual ── */
check("T. §28: addEntry 13:00 (entrada) no meio do dia → rejeitado com mensagem contextual; fim preserva alternância clássica", () => {
  reset([punch(TODAY, "08:00", "entrada"), punch(TODAY, "18:20", "saida")]);
  const res = actions.addEntry({ date: TODAY, time: "13:00", type: "entrada", note: null });
  assert.equal(res.ok, false);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /duas entradas consecutivas|sequência de batidas inválida/);
  // dia com ENTRADA ABERTA de verdade: mensagem clássica preservada
  const open = [punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"), punch(TODAY, "13:00", "entrada")];
  assert.equal(
    insertPunchError(open, { id: 999, date: TODAY, time: "15:00", type: "entrada", note: null }),
    "Já existe uma entrada aberta. A próxima batida deve ser uma saída.",
  );
});

/* ── U. Meta atingida + nova entrada → não prever 1h futura (§29) ── */
check("U. §29: meta já atingida no trecho aberto → saída sugerida = agora (sem +1h de almoço)", () => {
  const jornada = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
    punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:20", "saida"), // 8h20 fechados
    punch(TODAY, "20:00", "entrada"), // nova entrada com meta já cumprida
  ];
  const exit = plannedExitTime(jornada, settings, 480);
  assert.equal(exit, "20:00", "saída sugerida = agora — nunca 21:00 artificial");
  const smart = srcOf("src/components/smart-exit.tsx");
  assert.ok(smart.includes("Meta atingida — você já pode registrar a saída."), "orientação contextual");
  assert.ok(smart.includes("Agora"), "destaque mostra 'Agora' em vez de horário futuro");
});

/* ── V. Entrada aberta → quitação NÃO permitida (§30) ────────── */
check("V. §30: jornada do destino ABERTA → canCompleteComp rejeita (day-open)", () => {
  const entries = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"), punch(TODAY, "13:00", "entrada"),
  ];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: TODAY, minutes: 60,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const checkRes = canCompleteComp(comp, entries, [comp], settings, TODAY, { companyCalendars: both });
  assert.equal(checkRes.ok, false);
  assert.equal(checkRes.reason, "day-open");
  assert.match(checkRes.error ?? "", /registre a saída/);
  const smart = srcOf("src/components/smart-exit.tsx");
  assert.ok(smart.includes("Meta de compensação provisoriamente atingida"), "exibe meta provisória, não final");
  assert.ok(smart.includes("&& !day.open && ("), "botão Confirmar quitação oculto com entrada aberta");
});

/* ── W. Jornada FECHADA + meta atingida → quitação permitida ─── */
check("W. §30: jornada encerrada com hora extra real ≥ obrigação → concluir é permitido", () => {
  const entries = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
    punch(TODAY, "13:00", "entrada"), punch(TODAY, "18:00", "saida"), // 9h → +1h
  ];
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: TODAY, minutes: 60,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const lib = canCompleteComp(comp, entries, [comp], settings, TODAY, { companyCalendars: both });
  assert.equal(lib.ok, true, lib.error);
  reset(entries, [comp]);
  const res = actions.completeComp(comp.id);
  assert.equal(res.ok, true, res.error);
  assert.equal(getAppData().compensations[0].status, "concluida");
});

/** Data futura DETERMINÍSTICA para testes: derivada do RELÓGIO REAL em runtime
 * (hoje + offset), clampada ao fim do ciclo do fixture (2026/2027). Nunca
 * "vence" como as constantes absolutas (a antiga 2026-09-01 fixa foi alcançada
 * pelo relógio real e quebrou o teste). */
function futuraDeterministica(offsetDias = 30, limite = "2027-04-23"): string {
  const d = new Date(Date.now() + offsetDias * 86400000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return iso > limite ? limite : iso;
}

/* ── X. Crédito retroativo fechado → uso IMEDIATO (sem Pendente) ── */
check("X. quitação com crédito de dia já encerrado nasce CONCLUÍDA; destino futuro rejeitado", () => {
  reset([...dayDef15(), punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "08:40", "saida")]);
  const future = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: futuraDeterministica(), minutes: 15 });
  assert.equal(future.ok, false);
  assert.match(future.error ?? "", /dias já realizados/);
  const openDay = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: TODAY, minutes: 15 });
  assert.equal(openDay.ok, false);
  assert.match(openDay.error ?? "", /precisa estar encerrado/);
  const res = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 15 });
  assert.equal(res.ok, true, res.error);
  const comps = getAppData().compensations;
  assert.equal(comps.length, 1);
  assert.equal(comps[0].status, "concluida", "imediata — sem etapa Pendente artificial");
  assert.equal(comps[0].kind, "deficit");
  const d = getAppData();
  const [dv] = deficitViews(d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, settings,
    { from: "2026-08-01", to: "2026-08-31" }, TODAY);
  assert.equal(dv.status, "quitada");
  assert.equal(dv.openMinutes, 0);
});

reset([]);
console.log(`\n${passed}/24 verificações passaram ✔`);
