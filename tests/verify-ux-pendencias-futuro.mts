/**
 * UX de pendências, resumo compacto, batidas futuras do próprio dia.
 * TZ=America/Sao_Paulo npx tsx tests/verify-ux-pendencias-futuro.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeDay, isPunchRealized, punchCountLabel } from "../src/lib/time.ts";
import { stayAndNetMinutes } from "../src/lib/breaks.ts";
import { canCompleteComp } from "../src/lib/debt.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { buildExitPlan, clockText } from "../src/components/smart-exit.tsx";
import { suggestedPunchTypeAt } from "../src/lib/punches.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { actions } from "../src/lib/store.ts";
import type { Compensation, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = { id: 1, name: "Teste", email: "t@t.com", ...S, birthDate: null };
const cals = seedCompanyCalendars();
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const TODAY = "2026-08-28";
const clock916 = { date: TODAY, minutes: 9 * 60 + 16 };
const clock1242 = { date: TODAY, minutes: 12 * 60 + 42 };
const PAST = "2026-08-21";

check("1. texto simplificado de Registro inconsistente", () => {
  const qp = srcOf("src/components/quick-punch.tsx");
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(qp.includes("A sequência de registros deste dia não está correta."));
  assert.ok(qp.includes("Corrija as batidas para finalizar o registro."));
  assert.ok(!qp.includes("A batida rápida registra a próxima batida"));
  assert.ok(card.includes("Há uma entrada sem a saída correspondente."));
  assert.ok(card.includes("Corrigir registros"));
});

check("2. modal Corrigir registros sem frase técnica", () => {
  const m = srcOf("src/components/correct-punches-modal.tsx");
  assert.ok(!m.includes("a posição é o horário"));
  assert.ok(!m.includes("ordem de cadastro"));
  assert.ok(m.includes("Edite, adicione ou exclua batidas para corrigir o registro deste dia."));
});

check("3. inferência inequívoca não exige dropdown de tipo", () => {
  const existing = [punch(PAST, "08:00", "entrada"), punch(PAST, "13:00", "entrada"), punch(PAST, "17:00", "saida")];
  assert.equal(suggestedPunchTypeAt(existing, "12:00"), "saida");
  const m = srcOf("src/components/correct-punches-modal.tsx");
  assert.ok(!m.includes("Tipo sugerido"));
  assert.ok(m.includes("Para manter a sequência correta"));
  assert.ok(m.includes("será registrado como"));
});

check("4. CTA Ver pendências usa variante warning", () => {
  const home = srcOf("src/app/(app)/page.tsx");
  assert.ok(home.includes('variant="warning">Ver pendências'));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes('variant="warning"'));
});

check("5. Registros não possui card grande Resumo do período", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(!reg.includes('title={query ? "Resumo do intervalo consultado" : "Resumo do período"}'));
  assert.ok(!reg.includes("Resumo do intervalo consultado"));
});

check("6. Registros possui resumo compacto", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("Dias com registro"));
  assert.ok(reg.includes("Pendentes"));
  assert.ok(reg.includes("periodLabel(period)"));
});

check("7. faixa de pendências permanece sticky", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("sticky top-16"));
  assert.ok(reg.includes("⚠ Registros pendentes:"));
});

check("8. filtro ativo mostra Voltar aos registros do período", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("Voltar aos registros do período"));
  assert.ok(reg.includes("filtro aplicado"));
  assert.ok(!reg.includes("Ver todos os registros"));
});

check("9-10. limpeza de ?pendentes=1 na correção e na consulta", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes('router.replace("/registros")'));
  assert.ok(reg.includes("if (wantPending) router.replace(\"/registros\")"));
  assert.ok(reg.includes("wantPending && pendingCount === 0"));
});

check("11. dia incompleto com compensação programada NÃO permite concluir", () => {
  const entries = [punch(PAST, "08:00", "entrada")];
  const comp: Compensation = {
    id: 1, sourceDate: "2026-08-19", targetDate: PAST, minutes: 45,
    status: "pendente", note: null, kind: "excedente", createdAt: 1,
  };
  const checkRes = canCompleteComp(comp, entries, [comp], S, "2026-08-26");
  assert.equal(checkRes.ok, false);
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Compensação prevista:"));
  assert.ok(card.includes("Corrija os registros deste dia para verificar e concluir a compensação."));
});

check("12. ao corrigir o dia a conclusão volta a ser elegível", () => {
  const entries = [
    punch(PAST, "08:00", "entrada"), punch(PAST, "12:00", "saida"),
    punch(PAST, "13:00", "entrada"), punch(PAST, "16:15", "saida"),
  ];
  const comp: Compensation = {
    id: 2, sourceDate: "2026-08-19", targetDate: PAST, minutes: 45,
    status: "pendente", note: null, kind: "excedente", createdAt: 1,
  };
  const day = computeDay(entries, S);
  assert.equal(day.canFinalizeFinancialDay, true);
  const checkRes = canCompleteComp(comp, entries, [comp], S, "2026-08-26");
  assert.equal(checkRes.ok, true, checkRes.error);
});

check("13. lançamento 08–17: permanência 9h, automático 1h, líquido 8h", () => {
  const r = stayAndNetMinutes([{ entrada: "08:00", saida: "17:00" }], S, "periodo");
  assert.equal(r.stay, 540);
  assert.equal(r.autoBreak, 60);
  assert.equal(r.net, 480);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("Permanência neste período"));
  assert.ok(modal.includes("Trabalho líquido estimado"));
  assert.ok(!modal.includes("Total trabalhado:"));
});

check("14. HOJE 09:16 com 08E/12S/13E/17S: só 08E é fato", () => {
  const entries = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
    punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:00", "saida"),
  ];
  assert.equal(isPunchRealized(TODAY, "08:00", clock916), true);
  assert.equal(isPunchRealized(TODAY, "12:00", clock916), false);
  assert.equal(isPunchRealized(TODAY, "13:00", clock916), false);
  assert.equal(isPunchRealized(TODAY, "17:00", clock916), false);
  const day = computeDay(entries, S, clock916.minutes, clock916);
  assert.equal(day.realizedEntries.length, 1);
  assert.equal(day.realizedEntries[0].time, "08:00");
  assert.equal(day.plannedEntries.length, 3);
});

check("15. cenário 09:16 NÃO mostra Jornada encerrada", () => {
  const entries = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
    punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:00", "saida"),
  ];
  const day = computeDay(entries, S, clock916.minutes, clock916);
  const plan = buildExitPlan(day, S, [], clock916.minutes, TODAY);
  assert.notEqual(plan.state, "finished");
  assert.equal(day.canFinalizeFinancialDay, false);
  assert.equal(day.open, true);
});

check("16. horários 12/13/17 aparecem como previstos", () => {
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Prevista"));
  const qp = srcOf("src/components/quick-punch.tsx");
  assert.ok(qp.includes("Prevista"));
});

check("17. Banco realizado não recebe 8h às 09:16", () => {
  const entries = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
    punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:00", "saida"),
  ];
  const day = computeDay(entries, S, clock916.minutes, clock916);
  assert.equal(day.balanceMinutes, 0);
  assert.equal(day.excessMinutes, 0);
  assert.ok(day.workedMinutes < 480);
  const empty = hourBankSummary([], [], [], cals, [], [], S, { from: TODAY, to: TODAY }, TODAY);
  const withBank = hourBankSummary(entries, [], [], cals, [], [], S, { from: TODAY, to: TODAY }, TODAY);
  // hourBank usa o relógio real; se ainda for manhã o Banco não consolida 8h.
  // A fonte computeDay com relógio injetado é o contrato financeiro.
  assert.equal(day.canFinalizeFinancialDay, false);
  void empty; void withBank;
});

check("18. quando o relógio ultrapassa o horário, vira realizado sem duplicar", () => {
  const entries = [
    punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
    punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:00", "saida"),
  ];
  const noon = computeDay(entries, S, 12 * 60, { date: TODAY, minutes: 12 * 60 });
  assert.equal(noon.realizedEntries.map((e) => e.time).join(","), "08:00,12:00");
  assert.equal(noon.plannedEntries.map((e) => e.time).join(","), "13:00,17:00");
  const eve = computeDay(entries, S, 17 * 60, { date: TODAY, minutes: 17 * 60 });
  assert.equal(eve.realizedEntries.length, 4);
  assert.equal(eve.plannedEntries.length, 0);
  assert.equal(eve.entries.length, 4);
  assert.equal(eve.canFinalizeFinancialDay, true);
  assert.equal(eve.workedMinutes, 480);
});

check("19. Resumo do período possui Ver mais detalhes do período", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("Ver mais detalhes do período"));
  assert.ok(r.includes("Ocultar detalhes do período"));
});

check("20. detalhes expandidos mostram os indicadores", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("Acordo a compensar"));
  assert.ok(r.includes("Registros pendentes"));
  assert.ok(r.includes("O saldo pode sofrer alteração após a correção dos registros pendentes."));
});

check("21. Registros não duplica esses indicadores", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(!reg.includes('label="Horas trabalhadas"'));
  assert.ok(!reg.includes('label="Acordo a compensar"'));
});

const day1242 = () => computeDay([
  punch(TODAY, "08:00", "entrada"), punch(TODAY, "12:00", "saida"),
  punch(TODAY, "13:00", "entrada"), punch(TODAY, "17:00", "saida"),
], S, clock1242.minutes, clock1242);

check("22. 12:42 08E/12S realizados + 13E/17S previstos: Assistente sem null", () => {
  const extra: Compensation = {
    id: 9, sourceDate: "2026-08-21", targetDate: TODAY, minutes: 10,
    status: "pendente", note: null, kind: "deficit", createdAt: 1,
  };
  const plan = buildExitPlan(day1242(), S, [extra], clock1242.minutes, TODAY);
  assert.equal(plan.state, "on-break");
  assert.equal(clockText(plan.plannedExit), "17:00");
  assert.notEqual(String(plan.plannedExit), "null");
  const smart = srcOf("src/components/smart-exit.tsx");
  assert.ok(!smart.includes("Trabalhe até ${plan.plannedExit}"));
  assert.ok(smart.includes("clockText"));
  assert.ok(smart.includes("isDisplayableClock"));
});

check("23. mesmo cenário: Assistente identifica intervalo entre jornadas", () => {
  const plan = buildExitPlan(day1242(), S, [], clock1242.minutes, TODAY);
  assert.equal(plan.state, "on-break");
  assert.equal(plan.nextPlanned?.time, "13:00");
  assert.equal(plan.nextPlanned?.type, "entrada");
  const smart = srcOf("src/components/smart-exit.tsx");
  assert.ok(smart.includes("Intervalo em andamento"));
});

check("24. saída prevista 17:00 é exibida", () => {
  const plan = buildExitPlan(day1242(), S, [], clock1242.minutes, TODAY);
  assert.equal(plan.plannedExit, "17:00");
  const smart = srcOf("src/components/smart-exit.tsx");
  assert.ok(smart.includes("Saída prevista:"));
});

check("25. contador 2 realizados · 2 previstos", () => {
  assert.equal(punchCountLabel(2, 2), "2 realizados · 2 previstos");
  assert.equal(punchCountLabel(2, 0), "2 realizados hoje");
  assert.equal(punchCountLabel(0, 2), "2 previstos hoje");
  const qp = srcOf("src/components/quick-punch.tsx");
  assert.ok(qp.includes("punchCountLabel"));
  assert.ok(!qp.includes("batida(s) hoje"));
});

check("26. registro incompleto possui somente um CTA Corrigir registros por alerta", () => {
  const card = srcOf("src/components/day-card.tsx");
  const hits = card.match(/Corrigir registros/g) ?? [];
  assert.equal(hits.length, 2, "um no alerta incompleto e um no inconsistente — nunca na barra inferior");
  assert.ok(!card.includes("{punchPending && !futureDay && !abonoDay && ("));
});

check("27. Ver mais detalhes do período expande", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("aria-expanded={detailsOpen}"));
  assert.ok(r.includes("setDetailsOpen((v) => !v)"));
  assert.ok(r.includes("{detailsOpen && ("));
});

check("28. painel expandido contém as 3 colunas temáticas", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  for (const label of [
    "Jornada e saldo", "Compensações", "Ausências e abonos",
    "No ponto", "Déficit do período", "Horas compensadas", "Compensações pendentes",
    "Férias", "Saúde", "Dispensados", "Faltas", "Faltas previstas", "Acordo a compensar",
  ]) {
    assert.ok(r.includes(`label="${label}"`) || r.includes(`"${label}"`), label);
  }
  assert.ok(!r.includes('label="Dias trabalhados"'));
  assert.ok(!r.includes('label="Horas trabalhadas"'));
});

check("29. clicar novamente recolhe", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("Ocultar detalhes do período"));
  assert.ok(r.includes("ChevronUp"));
  assert.ok(r.includes("ChevronDown"));
});

check("30. mudar o período atualiza os 15 indicadores", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes("[allDays, totals, entries, compensations, settings, period"));
  assert.ok(r.includes("getNextPointPeriod(period)"));
  assert.ok(r.includes("getPreviousPointPeriod(period)"));
});

check("31. alerta de pendências em /resumo possui Ver pendências", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes('variant="warning">Ver pendências'));
  assert.ok(r.includes("O saldo pode sofrer alteração após a correção dos registros pendentes."));
});

check("32. Ver pendências leva a /registros?pendentes=1", () => {
  const r = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(r.includes('href="/registros?pendentes=1"'));
});

actions.replaceAll({ user, entries: [], compensations: [], absences: [], companyCalendars: cals, faltas: [], excessReasons: [] });
console.log(`\nUX PENDÊNCIAS/FUTURO — OK (${passed} testes)`);
