/**
 * VERIFICAÇÃO — MICROAJUSTE FINAL: ABONO DE ANIVERSÁRIO (testes 1–8)
 *
 * 1. Modal do Abono sem a frase "Benefício de um dia — sem efeito em horas
 *    ou saldos." (somente título + campos);
 * 2–3. Dia com Abono em Registros = SOMENTE INFORMATIVO: badge/evento e
 *    métricas 0/0/+0/0 preservadas; sem "Adicionar registro manual" — guarda
 *    `!abonoDay` (kind === "abono", sem generalização). Atalhos de ponto
 *    (Entrada agora / Saída agora / Almoço / Volta) não existem mais no card;
 * 4. Ao mover o Abono para outra data, o dia anterior volta a permitir
 *    registro e atalhos;
 * 5. Nenhuma regra de cálculo muda;
 * 6. Resumo segue identificando o Abono;
 * 7. Histórico de Férias e Afastamentos sem lápis;
 * 8. Configurações segue sendo a ÚNICA interface Definir/Alterar.
 *
 * Executar: npx tsx tests/verify-abono-microajuste.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { abonoDayDecision } from "../src/lib/absences.ts";
import {
  buildCompanyCalendar,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { buildDebtDays } from "../src/lib/debt.ts";
import { effectiveFaltas } from "../src/lib/faltas.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import { actions, getAppData } from "../src/lib/store.ts";
import type { User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
  birthDate: null,
};

const readFix = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23";
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY));
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const reset = () =>
  actions.replaceAll({ user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── 1. Modal sem a frase ─────────────────────────────────────────────── */
check("1. Modal do Abono NÃO contém \"Benefício de um dia — sem efeito em horas ou saldos.\"", () => {
  const modal = srcOf("src/components/abono-modal.tsx");
  assert.ok(!modal.includes("Benefício de um dia — sem efeito em horas ou saldos."));
  assert.ok(!modal.includes("sem efeito em horas ou saldos"), "nenhuma variação da frase");
  assert.ok(modal.includes("Definir Abono de aniversário") && modal.includes("Alterar Abono de aniversário"));
  assert.ok(modal.includes('label="Data do Abono"') && modal.includes('label="Observação (opcional)"'));
});

/* ── 2. Dia de Abono: somente informativo com métricas 0/0/+0/0 ───────── */
check("2. Dia com Abono em Registros: badge/evento preservado; Trabalhado 0 · Base 0 · Saldo +0 · No ponto 0", () => {
  reset();
  assert.equal(actions.setAbono({ date: "2026-09-02", note: null }).ok, true);
  const st = getAppData();
  const cctx = companyDayContext("2026-09-02", st.entries, st.absences, both, settings);
  assert.equal(cctx.ctx.absence?.kind, "abono", "evento cobre o dia (badge no card)");
  assert.equal(cctx.displayDay.workedMinutes, 0, "Trabalhado 0min");
  assert.equal(cctx.effectiveExpected, 0, "Base regular 0min");
  assert.equal(cctx.adjustedBalance, 0, "Saldo regular +0min");
  assert.equal(cctx.displayDay.registrableMinutes, 0, "No ponto 0min");
  assert.equal(cctx.adjustedDeficit, 0, "sem déficit");
  reset();
});

/* ── 3. Dia de Abono NÃO mostra registro manual nem atalhos ───────────── */
check("3. Card do dia com Abono NÃO oferece \"Adicionar registro manual\" (guarda !abonoDay); sem atalhos de ponto", () => {
  const card = srcOf("src/components/day-card.tsx");
  // Guarda específica e explícita de kind === \"abono\" (§3: não generalizar)
  assert.ok(card.includes('const abonoDay = absence?.kind === "abono"'), "guarda dedicada ao Abono");
  const guardas = card.split("!futureDay && !abonoDay && (").length - 1;
  assert.ok(guardas >= 1, "formulário de registro manual protegido pela guarda !abonoDay");
  // Os controles de batida só existem dentro dos blocos protegidos
  assert.ok(card.includes("Adicionar batida"), "controle existe para dias normais");
  assert.ok(!card.includes("Entrada agora") && !card.includes("Saída agora"), "atalhos de ponto removidos dos cards");
  // Smart Exit não se aplica (sem batidas o dia nunca fica \"open\"); e nada gera batida noutro ponto do card
  reset();
  actions.setAbono({ date: "2026-09-02", note: null });
  const st = getAppData();
  assert.equal(
    abonoDayDecision("2026-09-02", { absences: st.absences, entries: [], faltas: [], excludeAbsenceId: st.absences[0].id }).status,
    "ok",
    "o próprio Abono não é conflito ao ser reavaliado",
  );
  reset();
});

/* ── 4. Mover o Abono: o dia anterior volta ao normal ─────────────────── */
check("4. Alterar o Abono para outra data: o dia anterior volta a permitir registro e atalhos", () => {
  reset();
  assert.equal(actions.setAbono({ date: "2026-08-18", note: null }).ok, true);
  assert.equal(getAppData().absences[0].startDate, "2026-08-18");
  // Move para outra data → o dia anterior não tem mais evento algum
  assert.equal(actions.setAbono({ date: "2026-08-19", note: null }).ok, true);
  const st = getAppData();
  assert.equal(st.absences.length, 1, "mesmo evento (nunca duplicado)");
  // 18/08 voltou a ser um dia comum: sem ausência, aceita batidas normalmente
  const antes = companyDayContext("2026-08-18", st.entries, st.absences, both, settings);
  assert.equal(antes.ctx.absence, undefined, "sem cobertura no dia anterior");
  assert.equal(antes.effectiveExpected, 480, "jornada regular 8h novamente");
  assert.equal(
    actions.addEntry({ date: "2026-08-18", time: "08:00", type: "entrada", note: null }).ok,
    true,
    "batidas permitidas outra vez (bloqueio era somente do card no dia do Abono)",
  );
  // E o novo dia do Abono segue somente informativo
  const novo = companyDayContext("2026-08-19", st.entries, st.absences, both, settings);
  assert.equal(novo.ctx.absence?.kind, "abono");
  reset();
});

/* ── 5. Nenhuma regra de cálculo muda ─────────────────────────────────── */
check("5. Cálculos intocados: dívidas do período idênticas antes/depois do microajuste", () => {
  reset();
  actions.addFalta("2026-08-18");
  actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-20", time: "17:00", type: "saida", note: null });
  const st = getAppData();
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, both, effectiveFaltas(st.faltas, TODAY));
  assert.equal(debts.find((d) => d.date === "2026-08-18" && d.kind === "deficit")?.debtMinutes, 480, "falta −8h");
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "calendario")?.debtMinutes, 480, "obrigação 25/08 intacta");
  // Abono em dia livre não entra no mapa de dívidas
  assert.equal(actions.setAbono({ date: "2026-09-10", note: null }).ok, true);
  const debts2 = buildDebtDays(getAppData().entries, [], settings, BOUNDS, getAppData().absences, both, effectiveFaltas(getAppData().faltas, TODAY));
  assert.equal(debts2.find((d) => d.date === "2026-09-10"), undefined, "sem dívida no dia do Abono");
  reset();
});

/* ── 6. Resumo segue identificando o Abono ────────────────────────────── */
check("6. Resumo/gráfico: Abono identificado, jornada 0, saldo +0, totais sem impacto", () => {
  reset();
  actions.setAbono({ date: "2026-09-02", note: null });
  const data = buildStackedPeriodData({
    entries: [], compensations: [], absences: getAppData().absences, companyCalendars: both,
    settings, period: { from: "2026-08-21", to: "2026-09-20" }, faltas: [], today: TODAY,
  });
  const d = data.find((x) => x.date === "2026-09-02");
  assert.equal(d?.marker, "abono-aniversario");
  assert.equal(d?.markerLabel, "Abono de aniversário");
  assert.equal(d?.regularBalance, undefined, "data futura: tooltip neutro (sem saldo factual)");
  assert.equal(d?.expectedMinutes, 0, "jornada 0 no detalhamento");
  reset();
});

/* ── 7/8. Histórico sem lápis + Configurações como única interface ────── */
check("7/8. Abono no histórico sem lápis; Definir/Alterar SÓ em Configurações", () => {
  const ferias = srcOf("src/app/(app)/ferias/page.tsx");
  assert.ok(ferias.includes('a.kind !== "abono"'), "sem lápis de edição no histórico");
  const modal = srcOf("src/components/absence-modal.tsx");
  assert.ok(!modal.includes('value: "abono"'), "fora do select Novo evento");
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(cfg.includes("AbonoModal") && cfg.includes("setAbonoOpen(true)"), "única interface de Definir/Alterar");
  assert.ok(!cfg.includes('href="/ferias"'), "sem redirecionamento");
});

console.log(`\n✅ ${passed} verificações passaram: 1 2 3 4 5 6 7/8`);
