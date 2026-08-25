/**
 * VERIFICAÇÃO — HOTFIX: EXCEDENTE >10h EM REGISTROS + REGISTRAR FALTA
 *
 *  A–H  decomposição 2h regular + 1h especial; modal só na mutation;
 *       CTA Gerenciar excedente; motivo antigo sem loop.
 *  I–N  Registrar falta só com zero batidas e gate central.
 *
 * Executar: npx tsx tests/verify-excedente-registros.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { canRegisterFalta } from "../src/lib/faltas.ts";
import { dayCreditView, shouldPromptExcessReason } from "../src/lib/hour-bank.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
} as User;

const readFix = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const dayCardSrc = srcOf("src/components/day-card.tsx");
const quickSrc = srcOf("src/components/quick-punch.tsx");
const pageSrc = srcOf("src/app/(app)/page.tsx");
const registrosSrc = srcOf("src/app/(app)/registros/page.tsx");

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

/** 24/08/2026 (seg): 08:00→20:00 − 1h almoço = 11h. */
const day11h = () => [
  punch("2026-08-24", "08:00", "entrada"),
  punch("2026-08-24", "20:00", "saida"),
];
/** 24/08 até 18:20 = 9h20 (≤10h). */
const day920 = () => [
  punch("2026-08-24", "08:00", "entrada"),
  punch("2026-08-24", "18:20", "saida"),
];

const reset = (entries: TimeEntry[], comps: Compensation[] = []) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences: [],
    companyCalendars: both, faltas: [], excessReasons: [],
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. 11h → regularExtra 2h + specialExcess 1h ─────────────── */
check("A. base 8h / trabalhado 11h ⇒ regularExtra = 2h · specialExcess = 1h", () => {
  const entries = day11h();
  const day = computeDay(entries, settings);
  assert.equal(day.workedMinutes, 660, "11h trabalhadas");
  assert.equal(day.expectedMinutes, 480, "base 8h");
  assert.equal(day.excessMinutes, 60, "1h acima de 10h");
  assert.equal(day.registrableMinutes, 600, "No ponto = 10h");
  assert.equal(day.balanceMinutes, 180, "trabalhado − base ainda é +3h (fato bruto)");
  const v = dayCreditView("2026-08-24", entries, [], [], both, settings, []);
  assert.equal(v.regularExtra, 120, "crédito regular até o teto de 10h = +2h");
  assert.equal(v.excessSpecial, 60, "excedente especial = 1h");
  assert.notEqual(v.regularExtra, v.realizedPositive, "NÃO misturar +3h no crédito regular");
});

/* ── B. UI não rotula +3h como Saldo regular ─────────────────── */
check("B. Registros NÃO mostra 'Saldo regular' no dia >10h (usa Hora extra regular)", () => {
  assert.ok(dayCardSrc.includes('label="Hora extra regular"'), "rótulo Hora extra regular");
  assert.ok(dayCardSrc.includes("{showSplit ? ("), "split só com excedente especial");
  assert.ok(dayCardSrc.includes("creditView?.regularExtra"), "número vem da decomposição central");
  assert.ok(
    dayCardSrc.includes('label="Saldo regular"'),
    "Saldo regular permanece nos dias SEM excedente especial",
  );
  assert.ok(registrosSrc.includes("creditView={dayCreditView("), "Registros passa dayCreditView ao card");
});

/* ── C. +2h regular e 1h excedente separados ─────────────────── */
check("C. mostra +2h regular e 1h excedente separado", () => {
  assert.ok(dayCardSrc.includes("Excedente acima de 10h"), "faixa própria do excedente");
  assert.ok(dayCardSrc.includes("a realocar"), "1h a realocar");
  assert.ok(dayCardSrc.includes("creditView?.excessSpecial"), "excedente especial da fonte central");
  assert.ok(!dayCardSrc.includes("e compense"), "texto antigo de compensar em outro dia removido");
});

/* ── D. edição <=10h → >10h dispara o pedido de modal ────────── */
check("D. dia passa <=10h → >10h por edição sem motivo ⇒ shouldPrompt = true", () => {
  const before = computeDay(day920(), settings);
  assert.equal(before.excessMinutes, 0);
  assert.equal(before.open, false);
  const after = computeDay(day11h(), settings);
  assert.equal(after.excessMinutes, 60);
  assert.equal(
    shouldPromptExcessReason({
      beforeExcessMinutes: before.excessMinutes,
      beforeOpen: before.open,
      after,
      hasReason: false,
    }),
    true,
  );
  assert.ok(registrosSrc.includes("shouldPromptExcessReason"), "Registros usa o helper na mutation");
  assert.ok(pageSrc.includes("shouldPromptExcessReason"), "Visão geral usa o helper na mutation");
  assert.ok(registrosSrc.includes("onUpdateEntry"), "edição de batida passa pelo fluxo");
  assert.ok(pageSrc.includes("promptExcessReasonIfNeeded(target.date, before)"), "edição no QuickPunch dispara");
});

/* ── E. excedente antigo ao abrir: ⚠, sem loop de modal ──────── */
check("E. dia já >10h sem motivo ao abrir ⇒ ⚠ Motivo não informado; sem loop automático", () => {
  assert.ok(dayCardSrc.includes("⚠ Motivo não informado"), "faixa do excedente antigo");
  assert.ok(dayCardSrc.includes("Registrar motivo"), "botão manual no card");
  assert.ok(
    !registrosSrc.includes("useEffect(() => {\n    setReasonDate"),
    "Registros não abre modal em effect/render",
  );
  assert.ok(
    registrosSrc.includes("promptExcessReasonIfNeeded") && registrosSrc.includes("snapshotDay"),
    "disparo só após mutation (snapshot + helper)",
  );
  const alreadyClosed = computeDay(day11h(), settings);
  assert.equal(
    shouldPromptExcessReason({
      beforeExcessMinutes: 60,
      beforeOpen: false,
      after: alreadyClosed,
      hasReason: false,
    }),
    false,
    "já encerrado com excedente (usuário postergou) ⇒ NÃO reabre",
  );
});

/* ── F. motivo registrado ⇒ faixa mostra Motivo ──────────────── */
check("F. motivo registrado ⇒ faixa passa a mostrar motivo", () => {
  assert.ok(dayCardSrc.includes("Motivo: {excessReasonLabel(creditView.reason)}"), "mostra o motivo");
  reset(day11h());
  const ok = actions.setExcessReason({ date: "2026-08-24", reason: "atendimento-evento" });
  assert.equal(ok.ok, true, ok.error);
  const d = getAppData();
  const v = dayCreditView("2026-08-24", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.reason?.reason, "atendimento-evento");
  assert.equal(
    shouldPromptExcessReason({
      beforeExcessMinutes: 0,
      beforeOpen: true,
      after: v.day,
      hasReason: true,
    }),
    false,
    "com motivo já registrado o modal automático não abre",
  );
});

/* ── G. CTA antigo removido ──────────────────────────────────── */
check("G. CTA antigo 'Compensar horas' não aparece", () => {
  assert.ok(!dayCardSrc.includes("Compensar horas"), "botão antigo removido");
});

/* ── H. CTA Gerenciar excedente ──────────────────────────────── */
check("H. CTA 'Gerenciar excedente' aparece e aponta para Compensações", () => {
  assert.ok(dayCardSrc.includes("Gerenciar excedente"), "novo CTA");
  assert.ok(dayCardSrc.includes('/compensacoes#excedentes-prioridade'), "leva ao grupo de prioridade");
});

/* ── Destinações: 2h regular, 1h20 usado, 40min livre, 1h especial ── */
check("H2. 24/08 11h com 1h20 já destinadas ⇒ livre 40min; especial 1h fora do regular", () => {
  const comps: Compensation[] = [{
    id: 9, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 80,
    status: "concluida", note: null, kind: "deficit", createdAt: 1,
  }];
  const v = dayCreditView("2026-08-24", day11h(), comps, [], both, settings, []);
  assert.equal(v.regularExtra, 120);
  assert.equal(v.usedRegular, 80, "1h20 já destinadas no crédito regular");
  assert.equal(v.freeRegular, 40);
  assert.equal(v.excessSpecial, 60, "1h especial NÃO entra no crédito regular");
  assert.equal(v.freeSpecial, 60);
});

/* ── I. zero batidas + dia elegível ⇒ botão aparece ──────────── */
check("I. zero batidas + dia elegível ⇒ Registrar falta aparece", () => {
  assert.ok(quickSrc.includes("showRegistrarFalta"), "flag de render condicional");
  assert.ok(quickSrc.includes("today.entries.length === 0"), "exige zero batidas");
  assert.ok(quickSrc.includes("faltaGate?.ok"), "respeita o gate central");
  const gate = canRegisterFalta("2026-08-19", [], [], both, settings, []);
  assert.equal(gate.ok, true, "quarta útil sem batidas é elegível");
});

/* ── J/K. 1+ batidas ⇒ botão NÃO renderiza ───────────────────── */
check("J/K. 1 ou 2+ batidas ⇒ Registrar falta NÃO renderiza", () => {
  assert.ok(quickSrc.includes("today.entries.length > 0 ? ("), "chips no lugar do botão");
  assert.match(quickSrc, /showRegistrarFalta =\s*\n\s*today\.entries\.length === 0/, "oculto com qualquer batida");
  const one = [punch("2026-08-19", "08:00", "entrada")];
  assert.equal(canRegisterFalta("2026-08-19", one, [], both, settings, []).ok, false);
  const two = [...one, punch("2026-08-19", "12:00", "saida")];
  assert.equal(canRegisterFalta("2026-08-19", two, [], both, settings, []).ok, false);
});

/* ── L. remover todas as batidas ⇒ botão reaparece (condição) ── */
check("L. remover todas as batidas ⇒ Registrar falta reaparece", () => {
  reset([punch("2026-08-19", "08:00", "entrada"), punch("2026-08-19", "12:00", "saida")]);
  for (const e of [...getAppData().entries]) actions.deleteEntry(e.id);
  assert.equal(getAppData().entries.length, 0);
  const gate = canRegisterFalta("2026-08-19", getAppData().entries, [], both, settings, []);
  assert.equal(gate.ok, true, "dia de novo elegível após zerar batidas");
});

/* ── M. dia coberto ⇒ botão não aparece ──────────────────────── */
check("M. dia coberto por férias/abono/ausência incompatível ⇒ Registrar falta não aparece", () => {
  assert.ok(quickSrc.includes("faltaGate?.ok ?? true"), "cobertura incompatível oculta o botão");
  actions.replaceAll({
    user, entries: [], compensations: [],
    absences: [{
      id: 1, kind: "ferias", duration: "integral",
      startDate: "2026-08-17", endDate: "2026-08-21", createdAt: 1,
    }],
    companyCalendars: both, faltas: [],
  });
  const ferias = canRegisterFalta("2026-08-19", [], getAppData().absences, both, settings, []);
  assert.equal(ferias.ok, false);
  assert.match(ferias.error ?? "", /Férias|coberto/i);
  actions.replaceAll({ user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });
  const abono = actions.setAbono({ date: "2026-08-18", note: null });
  assert.equal(abono.ok, true);
  const onAbono = canRegisterFalta("2026-08-18", [], getAppData().absences, both, settings, []);
  assert.equal(onAbono.ok, false);
});

/* ── N. gate central continua rejeitando tentativa inválida ──── */
check("N. gate central continua rejeitando tentativa programática inválida", () => {
  reset([punch("2026-08-20", "08:00", "entrada")]);
  const res = actions.addFalta("2026-08-20");
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /registros de horário/);
  reset([]);
  const sat = actions.addFalta("2026-08-22");
  assert.equal(sat.ok, false);
  assert.match(sat.error ?? "", /folga/);
});

/* ── Estilo âmbar do botão ───────────────────────────────────── */
check("O. Registrar falta usa variante âmbar/laranja e fica no bloco das batidas", () => {
  assert.ok(quickSrc.includes('variant="warning"'), "variante warning (âmbar)");
  assert.ok(srcOf("src/components/ui.tsx").includes("bg-amber-500"), "warning = âmbar");
  assert.ok(quickSrc.includes("Mesmo bloco: chips das batidas"), "mesmo bloco dos chips");
});

/* ── Prioridade visual do excedente (recolhido + expandido) ── */
check("P. card expandido 11h ⇒ Hora extra regular +2h (não Saldo regular +3h)", () => {
  assert.ok(dayCardSrc.includes('label="Hora extra regular"'));
  assert.ok(dayCardSrc.includes("+{formatMinutes(creditView?.regularExtra ?? 0)} regular"), "recolhido: +2h regular");
  assert.ok(!dayCardSrc.includes("O excedente deve ser compensado em outro dia"), "texto antigo removido");
});

check("Q. card expandido mostra excedente separado e restante em destaque", () => {
  assert.ok(dayCardSrc.includes("⚠ Excedente acima de 10h"));
  assert.ok(dayCardSrc.includes("Restante a realocar"));
  assert.ok(dayCardSrc.includes("Original:"));
});

check("R. card recolhido mostra 1h excedente (ou o restante)", () => {
  assert.ok(dayCardSrc.includes("{formatMinutes(excessRemaining)} excedente"), "recolhido: ⚠ restante excedente");
});

check("S. excedente parcialmente utilizado ⇒ recolhido usa somente o restante", () => {
  const comps: Compensation[] = [{
    id: 11, sourceDate: "2026-08-24", targetDate: "2026-08-25", minutes: 40,
    status: "pendente", note: null, kind: "excedente", createdAt: 1,
  }];
  const v = dayCreditView("2026-08-24", day11h(), comps, [], both, settings, []);
  assert.equal(v.excessSpecial, 60);
  assert.equal(v.freeSpecial, 20, "restante 20min");
  assert.ok(dayCardSrc.includes("creditView?.freeSpecial"), "recolhido/expandido usam o restante central");
});

check("T. restante 0 ⇒ status Excedente tratado", () => {
  assert.ok(dayCardSrc.includes("✓ Excedente tratado") || dayCardSrc.includes("Excedente tratado ✓"));
  const comps: Compensation[] = [{
    id: 12, sourceDate: "2026-08-24", targetDate: "2026-08-25", minutes: 60,
    status: "pendente", note: null, kind: "excedente", createdAt: 1,
  }];
  const v = dayCreditView("2026-08-24", day11h(), comps, [], both, settings, []);
  assert.equal(v.freeSpecial, 0);
});

check("U. texto antigo 'excedente deve ser compensado em outro dia' não aparece", () => {
  assert.ok(!dayCardSrc.includes("excedente deve ser compensado em outro dia"));
  assert.ok(dayCardSrc.includes("Horas acima de 10h precisam ser realocadas"));
});

console.log(`\nEXCEDENTE REGISTROS + FALTA — OK (${passed} testes)`);
