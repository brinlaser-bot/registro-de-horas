/**
 * VERIFICAÇÃO — RODADA PEQUENA DE REFINAMENTOS DE UX
 *
 *  A  nomenclatura: "factual" some da UI visível
 *  B  CTA "Usar horas livres" removido; store intacto
 *  C  ações de déficit: Usar excedente disponível primeiro, mesma linha no desktop
 *  D  bloco "Previsão de horas a compensar" (informativo)
 *  E  "Ver detalhes" só expande; sem CTAs de Compensações no bloco
 *  F  modal: só capacidade do dia + máximo da operação
 *  G  nomenclatura de excedente (Realocar / a realocar / limite diário)
 *  H  tooltip do gráfico: Programado ≠ Compensado; barra inalterada
 *
 * Executar: npx tsx tests/verify-ux-refino.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { appliedOnDate } from "../src/lib/debt.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

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

const reset = (entries: TimeEntry[] = [], comps: Compensation[] = []) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences: [],
    companyCalendars: undefined, faltas: [], excessReasons: [],
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const bankSrc = srcOf("src/components/hour-bank-card.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");
const dayCardSrc = srcOf("src/components/day-card.tsx");
const formSrc = srcOf("src/components/compensation-form.tsx");
const allocSrc = srcOf("src/components/allocate-excess-modal.tsx");
const compsSrc = srcOf("src/app/(app)/compensacoes/page.tsx");
const chartSrc = srcOf("src/components/charts.tsx");
const stackedSrc = srcOf("src/components/stacked-period-chart.tsx");
const storeSrc = srcOf("src/lib/store.ts");

/* ── A. "factual" some da UI visível ─────────────────────── */
check("A. UI visível não usa a palavra 'factual'; déficits em aberto", () => {
  assert.ok(!allocSrc.includes("Déficit factual"));
  assert.ok(!allocSrc.includes("Restante factual"));
  assert.ok(!bankSrc.includes("Soma factual"));
  assert.ok(!panelSrc.includes("factuais ainda em aberto"));
  assert.ok(!formSrc.includes("factual"));
  assert.ok(!dayCardSrc.includes("factual"));
  assert.ok(allocSrc.includes("Déficit em aberto"));
  assert.ok(allocSrc.includes("Déficits em aberto") || allocSrc.includes("déficit em aberto"));
  assert.ok(panelSrc.includes("déficits ainda em aberto") || panelSrc.includes("Nenhum déficit em aberto"));
  assert.ok(bankSrc.includes("Déficits em aberto"));
});

/* ── B. CTA Usar horas livres removido; store permanece ─── */
check("B. CTA 'Usar horas livres' some da UI; useRealizedCreditForDeficit permanece", () => {
  assert.ok(!panelSrc.includes("Usar horas livres"));
  assert.ok(!panelSrc.includes("applyRealizedCredit"));
  assert.ok(!dayCardSrc.includes("Usar horas livres"));
  assert.ok(!compsSrc.includes("Usar horas livres"));
  assert.ok(storeSrc.includes("useRealizedCreditForDeficit"), "função do store intacta");
  reset([
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida"),
    punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "08:20", "saida"),
  ]);
  const res = actions.useRealizedCreditForDeficit("2026-08-21");
  assert.equal(res.ok, true, res.error);
  assert.equal(getAppData().compensations[0].status, "concluida");
});

/* ── C. Ações de déficit na mesma linha (desktop) ────────── */
check("C. desktop: Usar excedente disponível primeiro, mesma linha; mobile pode empilhar", () => {
  assert.ok(panelSrc.includes("Usar excedente disponível"));
  assert.ok(dayCardSrc.includes("Usar excedente disponível"));
  const panelIdx = panelSrc.indexOf("Usar excedente disponível");
  const extraIdx = panelSrc.indexOf("Programar hora extra", panelIdx);
  assert.ok(panelIdx > 0 && extraIdx > panelIdx, "Usar excedente disponível vem antes de Programar hora extra no painel");
  assert.ok(panelSrc.includes("sm:flex-row"), "painel empilha no mobile / mesma linha no desktop");
  assert.ok(dayCardSrc.includes("sm:flex-row"), "card do dia: mesma linha no desktop");
  const cardBlock = dayCardSrc.slice(
    dayCardSrc.indexOf("Usar excedente disponível") - 400,
    dayCardSrc.indexOf("Usar excedente disponível") + 400,
  );
  assert.ok(cardBlock.includes("sm:flex-row"));
});

/* ── D. Previsão de horas a compensar ────────────────────── */
check("D. bloco previsao: título, Até 30/04, origens; sem Já programado / cobertura", () => {
  assert.ok(bankSrc.includes("Previsão de horas a compensar"));
  assert.ok(bankSrc.includes("Até {formatDateBR(annualCycleClose(getAnnualPointCycle(today)))}"));
  assert.ok(bankSrc.includes("não altera o saldo realizado"));
  assert.ok(!bankSrc.includes("Total previstas:"));
  assert.ok(bankSrc.includes("previstas"));
  assert.ok(bankSrc.includes("Origem da previsão"));
  assert.ok(bankSrc.includes("Calendário"));
  assert.ok(bankSrc.includes("Faltas"));
  assert.ok(bankSrc.includes("Registros futuros"));
  assert.ok(bankSrc.includes("Acordos futuros"));
  assert.ok(bankSrc.includes("flex-wrap items-center gap-x-1.5"));
  assert.ok(!bankSrc.includes("Já programado:"));
  assert.ok(!bankSrc.includes("Ainda sem cobertura"));
  assert.ok(!bankSrc.includes("Compromissos futuros do ciclo"));
});

/* ── E. Ver detalhes só expande; sem CTAs de Compensações ── */
check("E. Ver detalhes só expande/recolhe; sem Abrir Compensações no bloco", () => {
  assert.ok(bankSrc.includes("Ver detalhes"));
  assert.ok(bankSrc.includes("Ocultar detalhes"));
  assert.ok(bankSrc.includes("setFutureOpen"));
  assert.ok(!bankSrc.includes("Abrir Compensações"));
  assert.ok(!bankSrc.includes("detalhes e ações na página"));
  assert.ok(bankSrc.includes("Calendário da empresa"));
  assert.ok(bankSrc.includes("formatDateShortBR(l.date)"));
  assert.ok(!bankSrc.includes("sem cobertura"));
});

/* ── F. Modal: capacidade do dia + máximo da operação ────── */
check("F. CompensationForm: Capacidade disponível + Máximo nesta operação; redundâncias sumiram", () => {
  assert.ok(formSrc.includes("Capacidade disponível no dia"));
  assert.ok(formSrc.includes("Máximo nesta operação"));
  assert.ok(formSrc.includes("Ainda sem programação"));
  assert.ok(!formSrc.includes("Capacidade até o limite de 10h"));
  assert.ok(!formSrc.includes("Já planejado neste dia"));
});

/* ── G. Nomenclatura do excedente ────────────────────────── */
check("G. Realocar excedente; 35min a realocar; Excedente do limite diário a realocar", () => {
  assert.ok(dayCardSrc.includes("Realocar excedente"));
  assert.ok(!dayCardSrc.includes("Alocar excedente"));
  assert.ok(panelSrc.includes("Realocar excedente"));
  assert.ok(!panelSrc.includes("Alocar excedente"));
  assert.ok(compsSrc.includes("Realocar excedente"));
  assert.ok(!compsSrc.includes("Alocar excedente"));
  assert.ok(allocSrc.includes("Realocar excedente"));
  assert.ok(dayCardSrc.includes("{formatMinutes(excessRemaining)} a realocar"));
  assert.ok(compsSrc.includes("Excedente do limite diário a realocar"));
  assert.ok(!compsSrc.includes("Excedente >10h a realocar") && !compsSrc.includes("Excedente &gt;10h a realocar"));
  assert.ok(dayCardSrc.includes("Horas acima de 10h precisam ser realocadas"));
  assert.ok(dayCardSrc.includes("w-full sm:w-auto"), "botões de excedente full-width no mobile");
  assert.ok(dayCardSrc.includes("sm:flex-row sm:flex-wrap sm:items-center"), "ações de déficit na mesma linha no desktop");
  const guardas = dayCardSrc.split("!futureDay && !abonoDay && (").length - 1;
  assert.ok(guardas >= 1, "registro manual permanece atrás da guarda !abonoDay");
  assert.ok(dayCardSrc.includes("sm:flex sm:flex-wrap"), "batidas em fluxo horizontal no desktop");
  assert.ok(dayCardSrc.includes("min-[360px]:grid-cols-2"), "mobile: preferência por 2 colunas");
  assert.ok(dayCardSrc.includes("sm:w-auto sm:min-w-[11.5rem]"), "chip não ocupa 100% no desktop");
  assert.ok(dayCardSrc.includes("Registro manual"));
  assert.ok(dayCardSrc.includes("Adicionar registro manual"));
  assert.ok(!dayCardSrc.includes("shortcutsOpen"), "accordion de atalhos removido");
  assert.ok(!dayCardSrc.includes("Entrada agora"), "atalho de ponto saiu dos cards");
  assert.ok(!dayCardSrc.includes("Atalhos {"), "título Atalhos removido dos cards");
  assert.ok(dayCardSrc.includes("sm:hidden"));
});

/* ── H. Tooltip: programado ≠ compensado; barra inalterada ─ */
check("H. tooltip: pendente = Programado para hoje; concluído = Compensado no dia; barra = appliedOnDate", () => {
  assert.ok(chartSrc.includes("Programado para hoje:"));
  assert.ok(chartSrc.includes("Compensado no dia:"));
  assert.ok(chartSrc.includes("compensatedPending"));
  assert.ok(chartSrc.includes("compensatedConcluded"));
  assert.ok(stackedSrc.includes("appliedOnDate(compensations, d.date)"));
  assert.ok(stackedSrc.includes("pendingForTarget"));

  const period = { from: "2026-08-21", to: "2026-09-20" };
  const pending: Compensation = {
    id: 1, sourceDate: "2026-08-21", targetDate: TODAY, minutes: 45,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const dataIdle = buildStackedPeriodData({
    entries: [], compensations: [pending], settings, period, today: TODAY,
  });
  const hoje = dataIdle.find((d) => d.date === TODAY)!;
  assert.equal(hoje.tooltipTone, "idle");
  assert.equal(hoje.compensatedPending, 45);
  assert.equal(hoje.compensatedConcluded, 0);
  assert.equal(hoje.compensated, Math.max(0, Math.min(appliedOnDate([pending], TODAY), Math.max(0, hoje.expectedMinutes - hoje.workedMinutes))));

  const done: Compensation = { ...pending, id: 2, status: "concluida" };
  const dataDone = buildStackedPeriodData({
    entries: [
      punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "17:00", "saida"),
    ],
    compensations: [done], settings, period, today: TODAY,
  });
  const hojeDone = dataDone.find((d) => d.date === TODAY)!;
  assert.equal(hojeDone.compensatedConcluded, 45);
  assert.equal(hojeDone.compensatedPending, 0);
});

reset([]);
console.log(`\nUX REFINO — OK (${passed} testes)`);
