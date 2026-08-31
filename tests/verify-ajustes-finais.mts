/**
 * VERIFICAÇÃO — AJUSTES FINAIS (gráfico, max operação, inverso, ciclo, compromissos)
 *
 * Executar: npx tsx tests/verify-ajustes-finais.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { type Absence } from "../src/lib/absences.ts";
import { maxOperationMinutes } from "../src/lib/debt.ts";
import {
  deficitViews,
  eligibleSpecialSourcesForDeficit,
  futureCommitmentsSummary,
  hasEligibleSpecialExcessInCycle,
} from "../src/lib/hour-bank.ts";
import { buildLegacyDemoScenario } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";
import type { CompanyCalendars } from "../src/lib/company-calendar.ts";

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

const reset = (entries: TimeEntry[], comps: Compensation[] = [], faltas: { id: number; date: string; createdAt: number }[] = []) =>
  actions.replaceAll({
    user, entries, compensations: comps, absences: [],
    companyCalendars: undefined, faltas, excessReasons: [],
  });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const chartSrc = srcOf("src/components/charts.tsx");
const stackedSrc = srcOf("src/components/stacked-period-chart.tsx");
const formSrc = srcOf("src/components/compensation-form.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");
const dayCardSrc = srcOf("src/components/day-card.tsx");
const pageSrc = srcOf("src/app/(app)/page.tsx");
const regsSrc = srcOf("src/app/(app)/registros/page.tsx");
const bankSrc = srcOf("src/components/hour-bank-card.tsx");
const compsSrc = srcOf("src/app/(app)/compensacoes/page.tsx");

const period = { from: "2026-08-21", to: "2026-09-20" };

/* ── A. Gráfico: HOJE idle e futuro neutros ───────────────── */
check("A. gráfico: HOJE idle e futuro sem saldo negativo factual", () => {
  const entries = [
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "17:00", "saida"),
    punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida"),
  ];
  const data = buildStackedPeriodData({
    entries, compensations: [], settings, period, today: TODAY,
  });
  const hoje = data.find((d) => d.date === TODAY);
  assert.ok(hoje, "25/08 entra no gráfico (dia útil vazio)");
  assert.equal(hoje!.tooltipTone, "idle");
  assert.equal(hoje!.regularBalance, undefined, "HOJE idle: sem saldo −8h");
  assert.equal(hoje!.workedMinutes, 0);

  const vazio = data.find((d) => d.date === "2026-08-26");
  assert.ok(vazio, "26/08 (futuro vazio) permanece no gráfico");
  assert.equal(vazio!.tooltipTone, "future");
  assert.equal(vazio!.regularBalance, undefined, "futuro vazio: sem −8h");

  const fut = data.find((d) => d.date === "2026-09-07");
  assert.ok(fut);
  assert.equal(fut!.tooltipTone, "future");
  assert.equal(fut!.regularBalance, undefined, "registro futuro: sem saldo negativo");
  assert.equal(fut!.predictedWorked, 120);
  assert.equal(fut!.workedMinutes, 0, "trabalhado realizado = 0");

  assert.ok(chartSrc.includes("Jornada não iniciada"));
  assert.ok(chartSrc.includes("Sem registro realizado"));
  assert.ok(!chartSrc.includes("Excedente (dívida"));
  assert.ok(stackedSrc.includes("tooltipTone"));
});

/* ── B. Máximo da operação ────────────────────────────────── */
check("B. maxOperation = min(unplanned, capacidade do dia)", () => {
  assert.equal(maxOperationMinutes(5, 100), 5);
  assert.equal(maxOperationMinutes(240, 600), 240);
  assert.equal(maxOperationMinutes(360, 120), 120);
  assert.ok(formSrc.includes("Máximo nesta operação"));
  assert.ok(formSrc.includes("Capacidade disponível no dia"));
  assert.ok(formSrc.includes("Ainda sem programação"));
  assert.ok(!formSrc.includes("Máximo disponível para esta compensação"));
});

/* ── C. Prefill acordo ────────────────────────────────────── */
check("C. prefill = min(unplanned, capacidade) ao abrir/trocar data", () => {
  assert.ok(formSrc.includes("prefillOf"));
  assert.ok(formSrc.includes("maxOperationMinutes(unplanned, capAvail)"));
  assert.equal(maxOperationMinutes(240, 600), 240);
});

/* ── D. Fluxo inverso (3E.2: motor intacto; fora do card Registros) ── */
check("D. (3E.2) motor do fluxo inverso intacto; card Registros sem o botão legado", () => {
  const seed = buildLegacyDemoScenario();
  const srcs = eligibleSpecialSourcesForDeficit(
    "2026-08-19", seed.entries, seed.compensations, seed.absences,
    seed.companyCalendars, settings, seed.excessReasons, TODAY,
  );
  assert.ok(srcs.some((v) => v.date === "2026-08-24" && v.freeSpecial === 35), "origens elegíveis seguem calculadas");
  assert.ok(hasEligibleSpecialExcessInCycle(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars, settings, seed.excessReasons, TODAY,
  ), "ciclo com elegível segue detectado");
  // 3E.2: o botão legado saiu da experiência principal de Registros
  assert.ok(!dayCardSrc.includes("Usar excedente disponível"));
  assert.ok(!dayCardSrc.includes("onUseAvailableExcess"));
  assert.ok(!regsSrc.includes("AllocateExcessModal"), "Registros não monta mais o modal legado");
});

/* ── E. Ciclo anual em Dias com saldo negativo ────────────── */
check("E. ciclo anual: 20/08 aparece; futuro não; quitado some; 100% planejado = Programado", () => {
  const seed = buildLegacyDemoScenario();
  const cycle = { from: "2026-05-01", to: "2027-04-30" };
  const views = deficitViews(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars,
    seed.faltas, settings, cycle, TODAY,
  );
  assert.ok(views.some((d) => d.date === "2026-08-19" && d.openMinutes > 0), "19/08 (período anterior) no ciclo");
  assert.ok(!views.some((d) => d.date > TODAY), "futuro não entra como déficit factual");
  const d21 = views.find((d) => d.date === "2026-08-21");
  assert.ok(!d21 || d21.openMinutes === 0, "21/08 quitado não é pendência");

  reset([
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida"),
  ], [{
    id: 1, sourceDate: "2026-08-21", targetDate: "2026-08-28", minutes: 15,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  }]);
  const [planned] = deficitViews(
    getAppData().entries, getAppData().compensations, [], undefined, [], settings,
    { from: "2026-08-21", to: "2026-08-21" }, TODAY,
  );
  assert.equal(planned.openMinutes, 15);
  assert.equal(planned.unplannedMinutes, 0);
  assert.ok(panelSrc.includes("cycleBounds"));
  assert.ok(panelSrc.includes("Programado"));
  assert.ok(panelSrc.includes("d.openMinutes > 0 && d.date <= today"));
});

/* ── F. Compromissos futuros ──────────────────────────────── */
check("F. compromissos futuros: calendário, falta, registro previsto; vazio não entra", () => {
  const calendars: CompanyCalendars = [{
    id: "2026-05-01", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
    cycleLabel: "2026–2027", version: 1, importedAt: "2026-05-01",
    entries: [{
      id: 1, date: "2026-09-10", descricao: "Folga a compensar",
      categoria: "FOLGA", tratamento: "COMPENSAR",
      horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
    }],
  }];
  const abs: Absence[] = [{
    id: 1, kind: "acordado", startDate: "2026-09-15", endDate: "2026-09-15",
    duration: "integral", treatment: "compensar", note: null, createdAt: 1,
  }];
  const entries = [
    punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida"),
  ];
  const faltas = [{ id: 1, date: "2026-08-31", createdAt: 1 }];
  const sum = futureCommitmentsSummary(entries, [], abs, calendars, faltas, settings, TODAY);
  assert.ok(sum.calendarMinutes >= 480, "calendário COMPENSAR futuro entra");
  assert.ok(sum.faltaMinutes >= 480, "falta prevista entra");
  assert.ok(sum.acordoMinutes >= 480, "acordo futuro entra");
  assert.equal(sum.otherMinutes, 360, "07/09 08:00–10:00 → déficit previsto 6h");
  assert.ok(!sum.lines.some((l) => l.date === "2026-08-26"), "dia futuro vazio NÃO entra");
  assert.ok(bankSrc.includes("Previsão de horas a compensar"));
  assert.ok(!bankSrc.includes("Ainda sem cobertura"));
  assert.ok(!bankSrc.includes("Compromissos futuros do ciclo"));
  assert.ok(bankSrc.includes("não altera o saldo realizado"));

  const planned: Compensation = {
    id: 9, sourceDate: "2026-09-10", targetDate: "2026-09-12", minutes: 180,
    status: "pendente", note: null, kind: "calendario", createdAt: 1,
  };
  const covered = futureCommitmentsSummary(entries, [planned], abs, calendars, faltas, settings, TODAY);
  const cal = covered.lines.find((l) => l.kind === "calendario" && l.date === "2026-09-10")!;
  assert.equal(cal.plannedMinutes, 180);
  assert.equal(cal.uncoveredMinutes, 300, "planejado reduz cobertura, não duplica obrigação");
});

/* ── G. Nomenclatura ──────────────────────────────────────── */
check("G. UI não usa '+10h' / 'Excedentes acima de 10h' como rótulo", () => {
  assert.ok(!pageSrc.includes('Badge tone="rose">+10h'));
  assert.ok(!pageSrc.includes("Excedentes acima de 10h"));
  assert.ok(pageSrc.includes("ExcessTenBadge"));
  assert.ok(compsSrc.includes("Excedente do limite diário"));
  assert.ok(!compsSrc.includes("Excedentes acima de 10h"));
  assert.ok(chartSrc.includes("Excedente do limite diário"));
  assert.ok(!dayCardSrc.includes("Realocado:"), "faixa legada fora do card (3E.2)");
  assert.ok(!dayCardSrc.includes("Alocado:"));
});

/* ── H. Excluir falta sem confirm ─────────────────────────── */
check("H. Excluir falta: sem window.confirm; toast Falta excluída", () => {
  assert.ok(!pageSrc.includes("Excluir a falta de"));
  assert.ok(pageSrc.includes('toast.show("Falta excluída")'));
  assert.ok(!dayCardSrc.includes("Excluir a falta de"));
  assert.ok(dayCardSrc.includes("busyFalta"));
  reset([]);
  assert.equal(actions.addFalta("2026-08-25").ok, true);
  const id = getAppData().faltas[0].id;
  assert.equal(actions.removeFalta(id).ok, true);
});

/* ── I. Card (3E.2) sem faixa legada; ExcessPanel da Visão geral intacto ── */
check("I. card (3E.2) sem faixa legada de excedente; ExcessPanel da Visão geral intacto", () => {
  assert.ok(!dayCardSrc.includes("flex w-full flex-col gap-2 sm:ml-auto"), "faixa legada removida (3E.2)");
  assert.ok(!dayCardSrc.includes("EXCEDENTE DO LIMITE DIÁRIO"), "faixa legada removida (3E.2)");
  assert.ok(pageSrc.includes("Acordo a compensar") === false || !pageSrc.includes('title="Acordos a compensar"'),
    "Visão geral sem card duplicado de acordos");
  assert.ok(!pageSrc.includes('title="Acordos a compensar"'));
  assert.ok(panelSrc.includes('title="Acordo a compensar"'), "mantém o card útil no ExcessPanel");
  // 4V: a lista de compensações pendentes saiu da Visão Geral; os tipos de
  // compensação seguem renderizados na Central de Horas.
  assert.ok(compsSrc.includes('k === "acordo"'), "4V: tipos de compensação na Central de Horas");
});

reset([]);
console.log(`\nAJUSTES FINAIS — OK (${passed} testes)`);
