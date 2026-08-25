/**
 * VERIFICAÇÃO — HOTFIX + UX: BANCO REALIZADO (futuro ≠ realizado) +
 * CARD HOJE (base efetiva) + REGISTRO DE HOJE UNIFICADO (§17–§19).
 *
 * Regra temporal central: date <= today. Batidas cadastradas em data futura
 * permanecem no dataset, mas antes da data não entram em saldo realizado,
 * crédito livre, quitação imediata — e voltam a contar quando a data chega.
 *
 * Executar: npx tsx tests/verify-banco-realizado-hotfix.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { hourBankSummary, isRealizedDate } from "../src/lib/hour-bank.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import { getPointPeriod } from "../src/lib/periods.ts";
import { listDaysBetween } from "../src/lib/periods.ts";
import { buildExitPlan } from "../src/components/smart-exit.tsx";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

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

const pageSrc = srcOf("src/app/(app)/page.tsx");
const quickSrc = srcOf("src/components/quick-punch.tsx");
const smartSrc = srcOf("src/components/smart-exit.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");

/** Marco temporal do cenário (§1): tudo ≤ 25/08 já aconteceu. */
const TODAY = "2026-08-25";
const PERIOD = getPointPeriod(TODAY); // 2026-08-21 → 2026-09-20 (21→20 oficial)

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

/** §1/§20 Dataset do cenário manual — preservado entre os testes. */
const scenario = () => {
  nextId = 1;
  const entries = [
    // 21/08 sex: 08:00→16:45 = 7h45 → −15min
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida"),
    // 22/08 sáb: +2h
    punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "10:00", "saida"),
    // 23/08 dom: +1h
    punch("2026-08-23", "14:00", "entrada"), punch("2026-08-23", "15:00", "saida"),
    // 24/08 seg: 08:00→18:20 = 9h20 → +1h20
    punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "18:20", "saida"),
    // 25/08: "Folga a compensar — Calendário" (0 batidas)
    // 07/09 FUTURO (feriado abonado): +2h cadastradas — NÃO é fato em 25/08
    punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida"),
  ];
  actions.replaceAll({ user, entries, compensations: [], absences: [], companyCalendars: both, faltas: [], excessReasons: [] });
};

/** Soma "estilo Visão geral" (Saldo do período) — mesma fonte central. */
const visaoBalance = (today: string) => {
  const st = getAppData();
  let sum = 0;
  for (const date of listDaysBetween(PERIOD.from, PERIOD.to)) {
    const cctx = companyDayContext(date, st.entries, st.absences, st.companyCalendars, settings);
    sum += dayBalanceContribution(cctx, st.faltas, date, today);
  }
  return sum;
};

const bank = (today: string) => {
  const st = getAppData();
  return hourBankSummary(st.entries, st.compensations, st.absences, st.companyCalendars, st.faltas, st.excessReasons, settings, PERIOD, today);
};

/** Destina todas as horas positivas realizadas (22/08+23/08+24/08 = 260min). */
const destinacoesCompletas = (): Compensation[] => [
  { id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 120, status: "concluida", note: null, kind: "deficit", createdAt: 1 },
  { id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-23", minutes: 60, status: "concluida", note: null, kind: "deficit", createdAt: 2 },
  { id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 80, status: "concluida", note: null, kind: "deficit", createdAt: 3 },
];

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. §1.1 Saldo realizado em 25/08 NÃO inclui 07/09 ─────── */
check("A. 25/08: Saldo realizado = +4h05 (−15 +2h +1h +1h20 +0) — 07/09 futuro de fora", () => {
  scenario();
  assert.equal(PERIOD.from, "2026-08-21");
  assert.equal(PERIOD.to, "2026-09-20", "período oficial 21→20 cobre 07/09");
  const b = bank(TODAY);
  assert.equal(b.realizedBalance, 245, "−15 + 120 + 60 + 80 + 0 = +4h05 (NÃO +6h05)");
  assert.equal(visaoBalance(TODAY), 245, "Saldo do período (Visão) CONCORDA com o banco (§3)");
});

/* ── B. §1.1 07/09 +2h NÃO entra nas horas positivas livres ── */
check("B. 07/09 fora das horas positivas regulares livres em 25/08 (0min com destinações)", () => {
  scenario();
  const livreSemDestino = bank(TODAY).freeRegularTotal;
  assert.equal(livreSemDestino, 260, "+2h +1h +1h20 realizados — nunca 6h20 (com o futuro)");
  const st = getAppData();
  actions.replaceAll({ ...st, compensations: destinacoesCompletas() });
  assert.equal(bank(TODAY).freeRegularTotal, 0, "créditos realizados destinados → 0min livres (§1.1)");
});

/* ── C. §2 07/09 NÃO pode ser fonte de quitação imediata ───── */
check("C. useRealizedCredit com crédito de 07/09 (futuro) ⇒ rejeitado em 25/08", () => {
  scenario();
  const res = actions.useRealizedCredit({ sourceDate: "2026-08-21", targetDate: "2026-09-07", minutes: 15 });
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /dias já realizados/);
  assert.equal(getAppData().compensations.length, 0, "nenhuma parcela criada");
  assert.equal(isRealizedDate("2026-09-07", TODAY), false, "predicado central reconhece o futuro");
  assert.equal(isRealizedDate("2026-08-24", TODAY), true);
});

/* ── D. Chegando 07/09, as 2h passam a ser fato realizado ──── */
check("D. today avança para 07/09 ⇒ as 2h entram no realizado e no crédito normalmente", () => {
  scenario();
  assert.equal(bank("2026-09-07").realizedBalance, 365, "+4h05 + 2h = +6h05 (agora é fato)");
  const st = getAppData();
  actions.replaceAll({ ...st, compensations: destinacoesCompletas() });
  assert.equal(bank("2026-09-07").freeRegularTotal, 120, "só sobram as 2h de 07/09 livres");
});

/* ── E. Planejado futuro segue só no campo Planejado ───────── */
check("E. compensação futura (21/08→28/08) entra em Planejado, sem tocar o Saldo realizado", () => {
  scenario();
  const comp: Compensation = {
    id: nextId++, sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 4,
  };
  actions.replaceAll({ ...getAppData(), compensations: [comp] });
  const b = bank(TODAY);
  assert.equal(b.plannedTotal, 10, "Planejado visível");
  assert.equal(b.realizedBalance, 245, "realizado intocado (PLANEJADO ≠ REALIZADO)");
  assert.equal(b.openDeficitTotal, 15, "déficit continua em aberto até realizar");
});

/* ── F. §4 Card HOJE com base efetiva 0 (COMPENSAR 25/08) ──── */
check("F. card HOJE: base efetiva 0min e saldo +0min em 25/08 (mesa jornada do Registro rápido)", () => {
  const cctx = companyDayContext("2026-08-25", [], [], both, settings);
  assert.equal(cctx.effectiveExpected, 0, "base efetiva central = 0min");
  assert.equal(cctx.displayDay.expectedMinutes, 0);
  assert.equal(cctx.displayDay.balanceMinutes, 0, "saldo +0min — nunca −8h");
  assert.match(pageSrc, /label="Hoje"[\s\S]*?todayCtx\.effectiveExpected/, "StatCard HOJE consome a base efetiva central");
  assert.ok(!pageSrc.includes("expectedMinutesOf"), "fallback 8h (0 falsy) removido da causa raiz");
});

/* ── G. §18 Registro rápido e card HOJE: MESMA base efetiva ── */
check("G. Registro rápido e card HOJE compartilham displayDay/base efetiva (fonte única)", () => {
  assert.ok(pageSrc.includes("today={t}"), "Ponto recebe o mesmo displayDay do contexto");
  assert.ok(quickSrc.includes("base {formatMinutes(today.expectedMinutes)}"), "Registro rápido mostra a base do displayDay");
  const cctx = companyDayContext("2026-08-25", [], [], both, settings);
  assert.equal(cctx.displayDay.expectedMinutes, cctx.effectiveExpected, "displayDay = base efetiva (0) — mesma fonte");
  assert.ok(pageSrc.includes("effectiveExpected={todayCtx.effectiveExpected}"), "Assistente também recebe a base efetiva");
});

/* ── H. §19 Layout: UM card; QuickPunch dentro, antes do banco ── */
check("H. Registro de hoje: ponto+assistente em UM card único, antes do Banco de horas", () => {
  assert.ok(pageSrc.includes('title="Registro de hoje"'), "card unificado existe");
  const q = pageSrc.indexOf("<QuickPunch");
  const s = pageSrc.indexOf("<SmartExit");
  const card = pageSrc.indexOf('title="Registro de hoje"');
  const banco = pageSrc.indexOf("<HourBankCard");
  const stats = pageSrc.indexOf('label="Hoje"');
  assert.equal(pageSrc.indexOf("<QuickPunch", q + 1), -1, "uma única instância (§7: sem duplicar componentes)");
  assert.equal(pageSrc.indexOf("<SmartExit", s + 1), -1);
  assert.ok(stats < card && card < q && q < s && s < banco, "indicadores → Registro de hoje → Banco de horas (§8)");
  assert.ok(pageSrc.includes(">Ponto<") || pageSrc.includes("\n              Ponto\n"), "área Ponto rotulada");
  assert.ok(pageSrc.includes("Assistente de jornada"), "área Assistente rotulada");
  assert.ok(quickSrc.includes("embedded"), "QuickPunch em modo embutido (sem Card duplo)");
  assert.ok(smartSrc.includes("embedded"), "SmartExit em modo embutido");
});

/* ── I. §19 SmartExit reage às batidas (estados centrais) ──── */
check("I. Assistente reage: sem entrada → no-punch; entrada aberta → planned; saída → finished", () => {
  const empty = buildExitPlan(computeDay([], settings), settings, [], 15 * 60, "2026-08-25", 480);
  assert.equal(empty.state, "no-punch");
  assert.match(smartSrc, /Registre sua/, "no-punch orienta registrar a entrada");
  assert.match(smartSrc, /Hoje é <b>folga<b|b>folga<\/b>|Hoje é/, "folga (base 0) tem mensagem própria");
  const open = buildExitPlan(
    computeDay([{ id: 1, date: "2026-08-24", time: "08:00", type: "entrada", note: null }], settings, 15 * 60),
    settings, [], 15 * 60, "2026-08-24", 480,
  );
  assert.equal(open.state, "planned", "em andamento dentro do planejado");
  const closed = buildExitPlan(
    computeDay(
      [{ id: 1, date: "2026-08-24", time: "08:00", type: "entrada", note: null },
       { id: 2, date: "2026-08-24", time: "18:20", type: "saida", note: null }],
      settings,
    ),
    settings, [], 19 * 60, "2026-08-24", 480,
  );
  assert.equal(closed.state, "finished");
});

/* ── J. §19 Editar/excluir batida recalcula o Assistente ───── */
check("J. excluir a saída ⇒ Assistente volta de 'encerrada' para 'em andamento' (recalc via store)", () => {
  scenario();
  const st = getAppData();
  const saida = st.entries.find((e) => e.date === "2026-08-24" && e.type === "saida")!;
  assert.equal(
    buildExitPlan(computeDay(st.entries.filter((e) => e.date === "2026-08-24"), settings), settings, [], 19 * 60, "2026-08-24", 480).state,
    "finished",
  );
  assert.equal(actions.deleteEntry(saida.id).ok, true, "exclusão segura permitida");
  const after = getAppData();
  assert.notEqual(
    buildExitPlan(computeDay(after.entries.filter((e) => e.date === "2026-08-24"), settings, 15 * 60), settings, [], 15 * 60, "2026-08-24", 480).state,
    "finished",
    "assistente recalcula com as batidas atuais",
  );
});

/* ── K/L. §19 Estados finais compactos e em andamento ──────── */
check("K. dia encerrado ⇒ Assistente mostra 'Jornada encerrada' de forma compacta", () => {
  assert.ok(smartSrc.includes("Jornada encerrada"), "badge/estado preservado");
  assert.match(smartSrc, /Jornada encerrada com/, "texto compacto com trabalhadas e saldo do dia");
});
check("L. entrada aberta ⇒ Assistente em 'Jornada em andamento' (nunca 'encerrada')", () => {
  assert.ok(smartSrc.includes("Jornada em andamento"), "badge em todos os estados de ponto aberto");
  assert.ok(smartSrc.includes("Saída planejada: ") || smartSrc.includes("saída planejada"), "previsão preservada");
  assert.ok(smartSrc.includes("Meta atingida — você já pode registrar a saída."), "§11: correção da meta atingida preservada");
});

/* ── M. §13 Cabeçalho contextual pela fonte central ────────── */
check("M. folga 25/08 ⇒ subtítulo do card = 'Folga a compensar — Calendário' (fonte central)", () => {
  const cctx = companyDayContext("2026-08-25", [], [], both, settings);
  assert.equal(cctx.label, "Folga a compensar — Calendário");
  assert.match(pageSrc, /subtitle=\{todayCtx\.label \?\? `Jornada regular · base /, "subtitle usa a MESMA fonte central, sem reclassificar");
});

/* ── N. §5 Rótulo: Excedente do período (não 'do mês') ─────── */
check("N. Gestão de excedentes: rótulo atualizado para 'Excedente do período'", () => {
  assert.ok(panelSrc.includes('label="Excedente do período"'), "rótulo alinhado ao período oficial 21→20");
  assert.ok(!panelSrc.includes("Excedente do mês"), "rótulo antigo removido");
});

console.log(`\n${passed}/14 verificações passaram ✔`);
