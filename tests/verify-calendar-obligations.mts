/**
 * VERIFICAÇÃO — OBRIGAÇÕES DE CALENDÁRIO NA ABA COMPENSAÇÕES
 * Microcorreção: a obrigação do calendário (ex.: 25/08/2026, 8h COMPENSAR do
 * ciclo 2026–2027) deve aparecer em Compensações como "Calendário a compensar",
 * DERIVADA do calendário (nunca persistida automaticamente), com semântica
 * idêntica à do Acordo (só concluídas abatem o Restante).
 *
 * Cobre: teste principal (seção 11), compensação parcial (seção 8), Cinzas
 * (seção 9), ciclos encerrados (seção 10) e testes A–J (seção 12).
 *
 * Executar: npx tsx tests/verify-calendar-obligations.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  calendarCycleOf,
  companyCalendarForDate,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import {
  activeAcordos,
  activeCalendarObligations,
  buildDebtDays,
  extraCapacityForDate,
  usesHourExtra,
} from "../src/lib/debt.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const absence = (a: Partial<Absence> & Pick<Absence, "kind" | "startDate" | "endDate">): Absence => ({
  id: nextId++, duration: "integral", note: null, createdAt: 0, ...a,
});

/* ── Calendários (mesmos fixtures da suíte multi-calendário) ── */
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const p2526 = parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings);
const p2627 = parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings);
assert.equal(p2526.ok, true); assert.equal(p2627.ok, true);
const cal2526 = buildCompanyCalendar(p2526.entries);
const cal2627 = buildCompanyCalendar(p2627.entries);
const both = [cal2526, cal2627];

/* ── Contexto do cenário do bug report ── */
const TODAY = "2026-08-23"; // ciclo anual atual: 2026–2027
const CYCLE = getAnnualPointCycle(TODAY);
const BOUNDS = annualCycleBounds(CYCLE); // 2026-05-01 → 2027-04-30

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ══ TESTE PRINCIPAL (seção 11): 25/08/2026 aparece derivado ══ */
const oblsMain = activeCalendarObligations([], [], settings, BOUNDS, both, TODAY);
const ob25 = oblsMain.find((v) => v.date === "2026-08-25");

check("§11 principal: Card 'Calendário a compensar' 25/08/2026 → 8h/0/0/8h, ciclo 2026–2027, futura", () => {
  assert.ok(ob25, "obrigação de 25/08/2026 deve existir na derivação da aba Compensações");
  assert.equal(ob25.cycleLabel, "2026–2027");
  assert.equal(ob25.originalMinutes, 480, "Original = 8h");
  assert.equal(ob25.compensatedMinutes, 0, "Compensado = 0min");
  assert.equal(ob25.plannedMinutes, 0, "Planejado = 0min");
  assert.equal(ob25.remainingMinutes, 480, "Restante = 8h");
  assert.equal(ob25.future, true, "status Próxima/futura (data ainda não chegou)");
});

check("§11 contexto: ciclo do dia atual é 2026/2027 e a origem pertence ao mesmo ciclo", () => {
  assert.equal(CYCLE, "2026/2027");
  assert.equal(calendarCycleOf("2026-08-25").label, "2026–2027");
  assert.ok(ob25.date >= BOUNDS.from && ob25.date <= BOUNDS.to);
});

/* ── A. recarregar página: não duplica obrigação ───────────── */
check("A. derivação é pura e idempotente (recarregar não duplica); import não persiste dívida", () => {
  const again = activeCalendarObligations([], [], settings, BOUNDS, both, TODAY);
  assert.deepEqual(again, oblsMain, "duas derivações devem ser idênticas");
  // Importar calendários no store NÃO pode criar Compensation automaticamente
  assert.equal(getAppData().compensations.length, 0, "store começa sem compensações");
  assert.equal(actions.addCompanyCalendar(cal2526).ok, true);
  assert.equal(actions.addCompanyCalendar(cal2627).ok, true);
  assert.equal(getAppData().compensations.length, 0, "importar calendário NÃO cria dívida persistida");
});

/* ── B. substituir mesmo ciclo: não duplica ────────────────── */
check("B. substituir o calendário do ciclo não duplica obrigação (e atualiza a derivação)", () => {
  assert.equal(actions.replaceCompanyCalendar({ ...cal2627 }).ok, true);
  const cals = getAppData().companyCalendars ?? [];
  assert.equal(cals.filter((c) => c.cycleLabel === "2026–2027").length, 1, "um calendário por ciclo");
  const oblsB = activeCalendarObligations([], [], settings, BOUNDS, cals, TODAY);
  assert.equal(oblsB.filter((v) => v.date === "2026-08-25").length, 1, "uma única obrigação de 25/08");
  assert.equal(oblsB.length, 19, "19 obrigações derivadas no ciclo 2026–2027");
  assert.equal(oblsB.reduce((s, v) => s + v.originalMinutes, 0), 148 * 60, "148h a compensar no ciclo");
});

/* ── C. ciclo encerrado não aparece como ativo ─────────────── */
check("C. 02/05/2025 (ciclo 2025–2026 encerrado) NÃO é obrigação ativa; resta consultável no ciclo", () => {
  assert.equal(oblsMain.find((v) => v.date === "2025-05-02"), undefined, "não ativa em 23/08/2026");
  const oldBounds = annualCycleBounds(getAnnualPointCycle("2025-05-02"));
  const historical = activeCalendarObligations([], [], settings, oldBounds, both, TODAY);
  const oOld = historical.find((v) => v.date === "2025-05-02");
  assert.ok(oOld, "consultável dentro do ciclo histórico 2025–2026");
  assert.equal(oOld.originalMinutes, 480);
  assert.equal(oOld.cycleLabel, "2025–2026");
});

/* ── D. 25/08/2026 ativa (espelho do cenário do report) ────── */
check("D. 25/08/2026 presente como obrigação ATIVA no ciclo atual", () => {
  const d = buildDebtDays([], [], settings, BOUNDS, [], both).find(
    (x) => x.date === "2026-08-25" && x.kind === "calendario",
  );
  assert.ok(d, "buildDebtDays já a produzia");
  assert.equal(d.debtMinutes, 480);
  assert.ok(ob25, "a aba Compensações agora a consome");
});

/* ── E. Cinzas 10/02/2027 = 4h (não 8h) ────────────────────── */
check("E. 10/02/2027 (Cinzas): Original 4h (240min), não 8h", () => {
  const cinzas = oblsMain.find((v) => v.date === "2027-02-10");
  assert.ok(cinzas);
  assert.equal(cinzas.originalMinutes, 240, "jornada esperada 4h + obrigação 4h → Original 4h");
});

/* ── F. acordo antigo continua separado ────────────────────── */
check("F. acordo a compensar continua SEPARADO das obrigações de calendário", () => {
  const abs = [absence({ kind: "acordado", startDate: "2026-08-13", endDate: "2026-08-13", treatment: "compensar" })];
  const acordos = activeAcordos([], [], settings, BOUNDS, abs);
  assert.ok(acordos.find((a) => a.date === "2026-08-13"), "acordo aparece em Acordos");
  assert.equal(acordos.find((a) => a.date === "2026-08-25"), undefined, "calendário não vira acordo");
  const oblsF = activeCalendarObligations([], [], settings, BOUNDS, both, TODAY);
  assert.equal(oblsF.find((v) => v.date === "2026-08-13"), undefined, "acordo não vira obrigação de calendário");
});

/* ── G. déficit comum continua separado ────────────────────── */
check("G. déficit comum continua SEPARADO (e folga a compensar não gera déficit comum)", () => {
  const deficitEntries = [punch("2026-08-18", "08:00", "entrada"), punch("2026-08-18", "15:00", "saida")];
  const debt = buildDebtDays(deficitEntries, [], settings, BOUNDS, [], both);
  assert.ok(debt.find((d) => d.date === "2026-08-18" && d.kind === "deficit"), "déficit comum existe");
  assert.equal(
    debt.find((d) => d.date === "2026-08-25" && d.kind === "deficit"),
    undefined,
    "25/08: déficit comum = 0 (saldo regular 0, obrigação 8h — independentes)",
  );
  const oblsG = activeCalendarObligations(deficitEntries, [], settings, BOUNDS, both, TODAY);
  assert.equal(oblsG.find((v) => v.date === "2026-08-18"), undefined, "déficit não vira obrigação de calendário");
});

/* ── I. fechamento 30/04→01/05 preservado ──────────────────── */
check("I. compensação de calendário não atravessa o fechamento anual (30/04→01/05)", () => {
  const n0 = getAppData().compensations.length;
  const rFwd = actions.addComp({ sourceDate: "2026-08-25", targetDate: "2027-05-04", minutes: 60, note: null, kind: "calendario" });
  assert.equal(rFwd.ok, false, "destino no ciclo seguinte é bloqueado");
  const rBack = actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-04-20", minutes: 60, note: null, kind: "calendario" });
  assert.equal(rBack.ok, false, "destino no ciclo anterior é bloqueado");
  assert.equal(getAppData().compensations.length, n0, "nada persistido nas tentativas rejeitadas");
});

/* ── J. multi-calendário preservado ────────────────────────── */
check("J. resolução por data continua escolhendo o calendário do ciclo certo", () => {
  assert.equal(companyCalendarForDate("2026-08-25", both)?.cycleLabel, "2026–2027");
  assert.equal(companyCalendarForDate("2027-02-10", both)?.cycleLabel, "2026–2027");
  assert.equal(companyCalendarForDate("2025-05-02", both)?.cycleLabel, "2025–2026");
  assert.equal(usesHourExtra("calendario"), true);
  assert.equal(usesHourExtra("excedente"), false);
});

/* ── H. anti dupla quitação + §8 compensação parcial ───────── */
check("H. uma mesma hora positiva não quita calendário + acordo + déficit ao mesmo tempo", () => {
  // Dia com hora extra real: 08:00→19:00 = 10h trabalhadas (teto) → 2h extra, capacidade 2h
  actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-20", time: "19:00", type: "saida", note: null });
  const st = getAppData();
  const cap = extraCapacityForDate("2026-08-20", st.entries, st.compensations, settings);
  assert.equal(cap.realExtra, 120);
  assert.equal(cap.available, 120);

  const rCal = actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-20", minutes: 120, note: null, kind: "calendario" });
  assert.equal(rCal.ok, true, "1ª compensação (calendário) cabe na capacidade");
  const rAc = actions.addComp({ sourceDate: "2026-08-13", targetDate: "2026-08-20", minutes: 60, note: null, kind: "acordo" });
  assert.equal(rAc.ok, false, "mesma hora extra NÃO pode quitar acordo também");
  const rDef = actions.addComp({ sourceDate: "2026-08-18", targetDate: "2026-08-20", minutes: 60, note: null, kind: "deficit" });
  assert.equal(rDef.ok, false, "mesma hora extra NÃO pode quitar déficit também");
  assert.equal(getAppData().compensations.length, 1, "apenas a de calendário ficou");
});

check("§8 parcial: planejar 2h NÃO reduz Restante; concluir → Compensado 2h · Restante 6h", () => {
  const st = getAppData();
  const comp = st.compensations.find((c) => c.kind === "calendario")!;
  assert.equal(comp.status, "pendente");

  const derive = () =>
    activeCalendarObligations(getAppData().entries, getAppData().compensations, settings, BOUNDS, getAppData().companyCalendars, TODAY)
      .find((v) => v.date === "2026-08-25")!;

  const before = derive();
  assert.equal(before.originalMinutes, 480, "Original 8h");
  assert.equal(before.compensatedMinutes, 0, "Compensado 0");
  assert.equal(before.plannedMinutes, 120, "Planejado 2h");
  assert.equal(before.remainingMinutes, 480, "Restante continua 8h (planejado NÃO abate)");

  const rc = actions.completeComp(comp.id);
  assert.equal(rc.ok, true, rc.ok ? "" : rc.error);
  const after = derive();
  assert.equal(after.originalMinutes, 480);
  assert.equal(after.compensatedMinutes, 120, "Compensado 2h");
  assert.equal(after.plannedMinutes, 0, "Planejado 0");
  assert.equal(after.remainingMinutes, 360, "Restante 6h");
  assert.equal(after.future, true, "obrigação segue futura mesmo parcialmente quitada");
});

check("§5 quitação DEPOIS da data da folga, dentro do mesmo ciclo, é permitida", () => {
  const rAfter = actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-09-10", minutes: 60, note: null, kind: "calendario" });
  assert.equal(rAfter.ok, true, "26/08+ ainda é ciclo 2026–2027 → permitido");
  const ob = activeCalendarObligations(getAppData().entries, getAppData().compensations, settings, BOUNDS, getAppData().companyCalendars, TODAY)
    .find((v) => v.date === "2026-08-25")!;
  assert.equal(ob.compensatedMinutes, 120);
  assert.equal(ob.plannedMinutes, 60, "nova parcela planejada");
  assert.equal(ob.remainingMinutes, 360, "restante só reflete o concluído");
});

console.log(`\n✅ ${passed} verificações passaram: principal + §5/§8/§9/§10 + A B C D E F G H I J`);
