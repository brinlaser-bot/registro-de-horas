/**
 * VERIFICAÇÃO — AJUSTES DE UX (seção 6)
 * 1. Compensações: "Calendário a compensar" RECOLHIDO por padrão (accordion);
 * 2. Visão geral: card "Calendário a compensar" REMOVIDO (só apresentação);
 * 3. Visão geral: "Últimos 14 dias" substituído por "Barras empilhadas do
 *    período" com a MESMA preparação/componente do Resumo.
 * UX/apresentação apenas — nenhuma regra de negócio alterada.
 *
 * Executar: npx tsx tests/verify-ux-ajustes.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { activeCalendarObligations } from "../src/lib/debt.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import { annualCycleBounds, getAnnualPointCycle, getPointPeriod } from "../src/lib/periods.ts";
import { todayString } from "../src/lib/time.ts";
import type { User, WorkSettings } from "../src/lib/types.ts";

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

const TODAY = "2026-08-23";
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY));
const reset = () =>
  actions.replaceAll({ user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. Compensações: seção recolhida por padrão + 19 obrigações/146h intactos ── */
check("A. Compensações: 'Calendário a compensar' inicia recolhido (estado local), lista sob demanda; obrigações intactas", () => {
  const src = srcOf("src/app/(app)/compensacoes/page.tsx");
  assert.match(src, /calOpen[^\n]*useState\(false\)|useState\(false\)/, "estado local inicia recolhido");
  assert.ok(src.includes("const [calOpen, setCalOpen] = useState(false)"), "padrão = recolhido");
  assert.ok(src.includes("Ver obrigações"), "botão de expandir");
  assert.ok(src.includes("{calOpen && ("), "lista SÓ aparece quando expandida");
  assert.ok(src.includes("obrigação(ões)"), "faixa-resumo mostra a contagem");
  assert.ok(src.includes("restantes"), "faixa-resumo mostra as horas restantes");
  // Nenhum dado recalculado/perdido: cenário 25/08 quitada 2h no sábado → 146h restantes
  reset();
  actions.addEntry({ date: "2026-08-22", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-22", time: "10:00", type: "saida", note: null });
  assert.equal(actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-22", minutes: 120, note: null, kind: "calendario" }).ok, true);
  const c = getAppData().compensations.find((x) => x.targetDate === "2026-08-22")!;
  assert.equal(actions.completeComp(c.id).ok, true);
  const st = getAppData();
  const obl = activeCalendarObligations(st.entries, st.compensations, settings, BOUNDS, st.companyCalendars, TODAY);
  assert.ok(obl.length > 0, "obrigações existem (contagem preservada)");
  assert.equal(obl.reduce((s, v) => s + v.remainingMinutes, 0), 142 * 60, "Σ Restante = 142h (144h − 2h; Cinzas saiu de COMPENSAR)");
  const o25 = obl.find((v) => v.date === "2026-08-25")!;
  assert.equal([o25.originalMinutes, o25.compensatedMinutes, o25.plannedMinutes, o25.remainingMinutes].join("/"), "480/120/0/360", "25/08: 8h/2h/0/6h");
});

/* ── B. Visão geral: sem card de calendário; dados preservados ── */
check("B. Visão geral: bloco 'Calendário a compensar' removido do ExcessPanel; dados intactos", () => {
  const excess = srcOf("src/components/excess-panel.tsx");
  assert.ok(!excess.includes('title="Calendário a compensar"'), "card de calendário removido da Visão geral");
  assert.ok(!excess.includes("calendarioDays"), "memos/lista do bloco removidos");
  assert.ok(!excess.includes('kind: "calendario"'), "sem atalho de obrigação de calendário");
  const home = srcOf("src/app/(app)/page.tsx");
  assert.ok(!home.includes('title="Calendário a compensar"'), "nenhum Card de calendário na Visão geral");
  reset();
  assert.equal(getAppData().companyCalendars?.length, 2, "companyCalendars preservados no store");
  const obl = activeCalendarObligations([], [], settings, BOUNDS, both, TODAY);
  assert.equal(obl.reduce((s, v) => s + v.remainingMinutes, 0), 144 * 60, "obrigações íntegras (144h sem quitação; Cinzas = ABONADO_PARCIAL)");
});

/* ── C. Gráfico: desde a 4V (reforma UI-only da Visão Geral) o gráfico
 * detalhado NÃO é mais renderizado na Visão Geral — pertence ao Resumo do
 * Período, que mantém o MESMO componente (requisito da 4V). ── */
check("C. Visão geral: sem 'Últimos 14 dias'; gráfico empilhado compartilhado com dados idênticos ao Resumo", () => {
  const home = srcOf("src/app/(app)/page.tsx");
  assert.ok(!home.includes("Últimos 14 dias"), "card antigo removido");
  assert.ok(!home.includes("BarsChart"), "gráfico antigo removido");
  assert.ok(!home.includes("StackedPeriodChart"), "4V: gráfico detalhado não renderiza mais na Visão Geral");
  const resumo = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(resumo.includes("StackedPeriodChart"), "Resumo usa o MESMO componente");
  assert.ok(!resumo.includes("StackedBarsChart"), "preparação não está duplicada no Resumo");

  // Dados funcionais: 21/08 com 08:00–16:45 (7h45) + excedente compensado 2h no dia
  reset();
  actions.addEntry({ date: "2026-08-21", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-21", time: "16:45", type: "saida", note: null });
  assert.equal(actions.addComp({ sourceDate: "2026-08-26", targetDate: "2026-08-21", minutes: 120, note: null, kind: "excedente", status: "concluida" }).ok, true);
  const st = getAppData();
  const period = getPointPeriod(TODAY); // período de ponto ATUAL (21→20), helper central
  assert.equal(period.from, "2026-08-21");
  assert.equal(period.to, "2026-09-20");
  const data = buildStackedPeriodData({
    entries: st.entries, compensations: st.compensations, absences: [],
    companyCalendars: st.companyCalendars, settings, period,
  });
  const d21 = data.find((d) => d.date === "2026-08-21")!;
  assert.equal(d21.workedMinutes, 465, "7h45 trabalhadas");
  assert.equal(d21.expectedMinutes, 480, "jornada efetiva 8h");
  assert.equal(d21.base, 465);
  assert.equal(d21.extra, 0);
  assert.equal(d21.excess, 0);
  assert.equal(d21.compensated, 15, "aplicado limitado ao saldo negativo do dia (igual à versão do Resumo)");
  assert.equal(d21.regularBalance, -15);
  assert.equal(data.find((d) => d.date === "2026-08-20"), undefined, "fora do período 21→20");
  const sat = data.find((d) => d.date === "2026-08-22")!;
  assert.equal([sat.marker, sat.workedMinutes, sat.expectedMinutes].join("/"), "folga/0/0", "sábado vazio = marcador Folga, barra zerada (igual ao Resumo)");
  assert.ok(data.find((d) => d.date === "2026-08-24"), "dia útil do período presente");
});

/* ── D. Resumo do período: versão completa intacta ── */
check("D. Resumo mantém o Card 'Barras empilhadas do período' completo (height 210)", () => {
  const resumo = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(resumo.includes('title="Barras empilhadas do período"'));
  assert.ok(resumo.includes("height={210}"), "versão completa preservada");
  // Builder agnóstico de período: respeita exatamente o par resolvido (inclui especiais do fechamento)
  const abril = buildStackedPeriodData({
    entries: [], compensations: [], absences: [], companyCalendars: both, settings,
    period: { from: "2026-04-21", to: "2026-04-30" },
  });
  assert.ok(abril.length > 0);
  assert.ok(abril.every((d) => d.date >= "2026-04-21" && d.date <= "2026-04-30"), "período 21/04→30/04 respeitado");
  const short = buildStackedPeriodData({
    entries: [], compensations: [], absences: [], companyCalendars: both, settings,
    period: { from: "2026-05-01", to: "2026-05-20" },
  });
  assert.ok(short.every((d) => d.date >= "2026-05-01" && d.date <= "2026-05-20"), "período 01/05→20/05 respeitado");
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

/* ── E. Regras sensíveis intactas (sanidade central) ── */
check("E. Falta prevista, batida futura bloqueada e 25/08 sem falta — nada de regra alterada", () => {
  reset();
  const FUT = futuraDeterministica();
  assert.equal(actions.addFalta(FUT).ok, true, "falta prevista continua permitida");
  const punch = actions.addEntry({ date: FUT, time: "08:00", type: "entrada", note: null });
  assert.equal(punch.ok, false, "batida futura continua bloqueada");
  assert.equal(punch.error, "Não é possível registrar horários em uma data futura.");
  // 25/08 continua obrigação de calendário (sem falta comum)
  const debts = activeCalendarObligations([], [], settings, BOUNDS, both, TODAY);
  assert.equal(debts.find((v) => v.date === "2026-08-25")?.originalMinutes, 480);
});

console.log(`\n✅ ${passed} verificações passaram: A B C D E`);
