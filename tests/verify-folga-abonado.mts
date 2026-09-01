/**
 * VERIFICAÇÃO — DÉFICIT FANTASMA EM FOLGA + TRABALHO EM DIA ABONADO
 * Bug: sábado 22/08/2026 com 08:00–10:00 exibia "Déficit pendente: 6h" +
 * botão "Quitar com hora extra", porque atalhos/resumo de Registros chamavam
 * buildDebtDays SEM a resolução central (jornada bruta 8h: 480 − 120 = 360).
 *
 * Cobre: testes principais (seções 12/13/14), regra de hora positiva utilizável
 * em folga/abonado (seção 7) e regressões A–P (seção 15).
 *
 * Executar: npx tsx tests/verify-folga-abonado.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyCalendarForDate,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import {
  activeCalendarObligations,
  buildDebtDays,
  extraCapacityForDate,
  openDebtFor,
  suggestTargets,
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

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23"; // domingo, ciclo 2026–2027
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY));
const RANGE = { from: "2026-08-21", to: "2026-09-20" }; // período 21→20 vigente

/* Entradas dos cenários */
const sat2h = [punch("2026-08-22", "08:00", "entrada"), punch("2026-08-22", "10:00", "saida")];
const sun2h = [punch("2026-08-23", "08:00", "entrada"), punch("2026-08-23", "10:00", "saida")];
const hol2h = [punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida")];
const wed830 = [punch("2026-08-19", "08:00", "entrada"), punch("2026-08-19", "17:30", "saida")]; // 8h30
const fri745 = [punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida")]; // 7h45

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ══ §12 TESTE PRINCIPAL — SÁBADO COM 2H ═══════════════════ */
check("§12 sábado 22/08 08:00–10:00: Trabalho em folga, +2h, déficit comum 0, SEM banner/botão", () => {
  const c = companyDayContext("2026-08-22", sat2h, [], both, settings);
  assert.equal(c.type, "trabalho-folga");
  assert.equal(c.label, "Trabalho em folga");
  assert.equal(c.effectiveExpected, 0, "Base regular = 0");
  assert.equal(c.displayDay.workedMinutes, 120, "Trabalhado = 2h / No ponto = 2h");
  assert.equal(c.adjustedBalance, 120, "Saldo regular = +2h");
  assert.equal(c.adjustedDeficit, 0, "Déficit comum = 0");
  // O atalho do card consome buildDebtDays — SEMPRE com a resolução central
  const debts = buildDebtDays(sat2h, [], settings, RANGE, [], both);
  assert.equal(
    debts.find((d) => d.date === "2026-08-22" && d.kind === "deficit"),
    undefined,
    "sem déficit de 6h → 'Déficit pendente' e 'Quitar com hora extra' NÃO aparecem",
  );
});

check("§12 fonte única: mesmo SEM parâmetro de calendário buildDebtDays não inventa déficit de folga", () => {
  const debtsNoArg = buildDebtDays(sat2h, [], settings, RANGE, []); // assinatura antiga
  assert.equal(debtsNoArg.find((d) => d.date === "2026-08-22" && d.kind === "deficit"), undefined);
  assert.equal(openDebtFor(sat2h, [], settings, "2026-08-22", "deficit"), 0, "pré-preenchimento = 0");
  assert.equal(
    suggestTargets(sat2h, [], settings, "2026-08-25", TODAY).find((t) => t.date === "2026-08-22"),
    undefined,
    "sábado com saldo positivo NÃO é sugerido como destino de saldo negativo",
  );
});

/* ══ §13/§14 FERIADO ABONADO (07/09/2026) ══════════════════ */
check("§13a feriado abonado SEM trabalho: abonado 8h cumpre a obrigação (saldo 0, déficit 0)", () => {
  const c = companyDayContext("2026-09-07", [], [], both, settings);
  assert.equal(c.label, "Feriado — Independência do Brasil", "label do evento preservado");
  assert.equal(c.displayDay.workedMinutes, 0, "abonadas NÃO são horas trabalhadas");
  assert.equal(c.abonadasMinutes, 480);
  assert.equal(c.cargaConsiderada, 480);
  assert.equal(c.adjustedBalance, 0);
  assert.equal(c.adjustedDeficit, 0);
});

check("§13b/§14 feriado abonado COM 2h: trabalhado 2h, saldo 0 (4D.4), déficit 0, NÃO vira 10h", () => {
  const c = companyDayContext("2026-09-07", hol2h, [], both, settings);
  assert.equal(c.label, "Trabalho em feriado — Independência do Brasil", "mantém o feriado + indica o trabalho");
  assert.equal(c.displayDay.workedMinutes, 120, "trabalhado real = 2h (nunca 8h abonadas + 2h)");
  assert.equal(c.abonadasMinutes, 480, "abonado = 8h");
  assert.equal(c.cargaConsiderada, 480, "carga considerada = 8h (não 10h)");
  /* 4D.4 (Parte C): trabalho em dia TOTALMENTE abonado não gera saldo
   * automático — crédito 8h cumpre a jornada; política das horas pendente. */
  assert.equal(c.abonadoIntegral, true);
  assert.equal(c.adjustedBalance, 0, "saldo regular 0 (sem crédito automático — 4D.4)");
  assert.equal(c.adjustedDeficit, 0, "8h − 2h = 6h de déficit NUNCA");
  const debts = buildDebtDays(hol2h, [], settings, RANGE, [], both);
  assert.equal(debts.find((d) => d.date === "2026-09-07" && d.kind === "deficit"), undefined);
});

/* ══ §7 HORAS DE FOLGA/ABONADO ALIMENTAM HORA EXTRA ════════ */
check("§7 capacidade: 2h trabalhadas em sábado e em feriado abonado viram hora extra utilizável", () => {
  const capSat = extraCapacityForDate("2026-08-22", sat2h, [], settings, { companyCalendars: both });
  assert.equal(capSat.effectiveBaseMinutes, 0, "base efetiva da folga = 0");
  assert.equal(capSat.realExtra, 120, "hora extra real = +2h");
  assert.equal(capSat.available, 120);
  const capHol = extraCapacityForDate("2026-09-07", hol2h, [], settings, { companyCalendars: both });
  assert.equal(capHol.realExtra, 120);
  assert.equal(capHol.available, 120);
  // Comportamento de dia útil intacto (base 8h): 8h30 → 30min de extra
  const capWed = extraCapacityForDate("2026-08-19", wed830, [], settings);
  assert.equal(capWed.effectiveBaseMinutes, 480);
  assert.equal(capWed.realExtra, 30);
});

/* ══ §15 REGRESSÕES A–L (matemática diária) ════════════════ */
check("A. sábado vazio 29/08: esperado 0 / saldo 0 / déficit 0", () => {
  const c = companyDayContext("2026-08-29", [], [], both, settings);
  assert.equal(c.type, "folga");
  assert.equal(c.effectiveExpected, 0);
  assert.equal(c.adjustedBalance, 0);
  assert.equal(c.adjustedDeficit, 0);
});

check("B. sábado +2h (espelho do §12; resolução central) e C. domingo +2h", () => {
  assert.equal(companyDayContext("2026-08-22", sat2h, [], both, settings).adjustedBalance, 120);
  const c = companyDayContext("2026-08-23", sun2h, [], both, settings);
  assert.equal(c.type, "trabalho-folga");
  assert.equal(c.adjustedBalance, 120);
  assert.equal(c.adjustedDeficit, 0);
});

check("G. dia útil 21/08 7h45: déficit comum 15min PRESERVADO", () => {
  const debts = buildDebtDays(fri745, [], settings, RANGE, [], both);
  const d = debts.find((x) => x.date === "2026-08-21" && x.kind === "deficit");
  assert.ok(d, "deve existir o débito");
  assert.equal(d.debtMinutes, 15);
  assert.equal(d.remainingMinutes, 15, "banner/botão corretamente exibidos para o déficit real");
});

check("H. dia útil 19/08 8h30: saldo +30, sem déficit", () => {
  const c = companyDayContext("2026-08-19", wed830, [], both, settings);
  assert.equal(c.type, "regular");
  assert.equal(c.adjustedBalance, 30);
  assert.equal(c.adjustedDeficit, 0);
  assert.equal(c.displayDay.expectedMinutes, 480);
});

check("I. 25/08 folga a compensar: obrigação 8h / saldo factual −8h (4D.4) / uma única contribuição", () => {
  const c = companyDayContext("2026-08-25", [], [], both, settings);
  assert.equal(c.calendarioACompensar, 480);
  /* 4D.4 (Partes D/G/I): dia passado com evento explícito é fato suficiente —
   * folga integral realizada sem trabalho ⇒ −8h NO SALDO FACTUAL (não
   * "obrigação paralela": uma única contribuição; o resultado negativo é o
   * próprio saldo, e o déficit do dia é contra as 8h necessárias). */
  assert.equal(c.regularBalance, -480, "saldo factual −8h (0h de 8h)");
  assert.equal(c.adjustedBalance, -480);
  assert.equal(c.adjustedDeficit, 480, "déficit do dia = trabalho necessário não cumprido");
  const debts = buildDebtDays([], [], settings, RANGE, [], both);
  assert.ok(debts.find((d) => d.date === "2026-08-25" && d.kind === "calendario" && d.debtMinutes === 480), "obrigação original segue na Central (kind calendario)");
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "deficit"), undefined, "SEM dupla contagem: déficit comum não é criado para dia com evento COMPENSAR");
});

check("J. férias integral (10–14/08): déficit 0 em todos os dias", () => {
  const abs = [absence({ kind: "ferias", startDate: "2026-08-10", endDate: "2026-08-14" })];
  const debts = buildDebtDays([], [], settings, { from: "2026-08-10", to: "2026-08-14" }, abs, both);
  assert.equal(debts.filter((d) => d.kind === "deficit").length, 0, "férias nunca geram déficit");
});

check("K. saúde integral com atestado (17/08): déficit 0", () => {
  const abs = [absence({ kind: "saude", startDate: "2026-08-17", endDate: "2026-08-17", medicalCert: true })];
  const debts = buildDebtDays([], [], settings, { from: "2026-08-17", to: "2026-08-17" }, abs, both);
  assert.equal(debts.find((d) => d.date === "2026-08-17" && d.kind === "deficit"), undefined);
});

check("L. acordo a compensar (13/08) continua natureza própria, separado de déficit/calendário", () => {
  const abs = [absence({ kind: "acordado", startDate: "2026-08-13", endDate: "2026-08-13", treatment: "compensar" })];
  const debts = buildDebtDays([], [], settings, { from: "2026-08-01", to: "2026-08-31" }, abs, both);
  assert.ok(debts.find((d) => d.date === "2026-08-13" && d.kind === "acordo"), "obrigação de acordo própria");
  assert.equal(debts.find((d) => d.date === "2026-08-13" && d.kind === "deficit"), undefined, "déficit comum 0");
});

/* ══ §15 M–P + §7/§9/§16 (nível store, e2e) ════════════════ */
check("M/N. obrigações de calendário seguem visíveis e multi-calendário intacto", () => {
  assert.equal(actions.addCompanyCalendar(cal2526).ok, true);
  assert.equal(actions.addCompanyCalendar(cal2627).ok, true);
  const obls = activeCalendarObligations([], [], settings, BOUNDS, both, TODAY);
  const o25 = obls.find((v) => v.date === "2026-08-25");
  assert.ok(o25);
  assert.equal(o25.originalMinutes, 480);
  assert.equal(companyCalendarForDate("2026-08-25", both)?.cycleLabel, "2026–2027");
  assert.equal(companyCalendarForDate("2025-05-02", both)?.cycleLabel, "2025–2026");
});

check("O + §7 e2e: as 2h do sábado quitam 2h da obrigação 25/08 — e não podem ser reusadas", () => {
  actions.addEntry({ date: "2026-08-22", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-22", time: "10:00", type: "saida", note: null });
  // Planejar 2h da folga a compensar usando as +2h do sábado (mesmo ciclo)
  const r1 = actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-22", minutes: 120, note: null, kind: "calendario" });
  assert.equal(r1.ok, true, "capacidade da folga (2h reais) aceita a quitação");
  // Anti-reuso: as mesmas 2h não quitam acordo nem déficit ao mesmo tempo
  const r2 = actions.addComp({ sourceDate: "2026-08-13", targetDate: "2026-08-22", minutes: 60, note: null, kind: "acordo" });
  assert.equal(r2.ok, false, "hora positiva não pode ser usada duas vezes");
  const r3 = actions.addComp({ sourceDate: "2026-08-21", targetDate: "2026-08-22", minutes: 60, note: null, kind: "deficit" });
  assert.equal(r3.ok, false);
  // Concluir: validação central reconhece a hora extra real do sábado
  const comp = getAppData().compensations.find((c) => c.kind === "calendario")!;
  const rc = actions.completeComp(comp.id);
  assert.equal(rc.ok, true, rc.ok ? "" : rc.error);
  const obl = activeCalendarObligations(getAppData().entries, getAppData().compensations, settings, BOUNDS, getAppData().companyCalendars, TODAY)
    .find((v) => v.date === "2026-08-25")!;
  assert.equal(obl.compensatedMinutes, 120, "Compensado 2h via folga");
  assert.equal(obl.remainingMinutes, 360, "Restante 6h");
});

check("§9/§16 planejamentos 25/08→26/08 e 25/08→27/08 (2h cada) permanecem íntegros", () => {
  assert.equal(actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-26", minutes: 120, note: null, kind: "calendario" }).ok, true);
  assert.equal(actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-08-27", minutes: 120, note: null, kind: "calendario" }).ok, true);
  const obl = activeCalendarObligations(getAppData().entries, getAppData().compensations, settings, BOUNDS, getAppData().companyCalendars, TODAY)
    .find((v) => v.date === "2026-08-25")!;
  assert.equal(obl.originalMinutes, 480, "Original 8h");
  assert.equal(obl.compensatedMinutes, 120, "somente o concluído abate");
  assert.equal(obl.plannedMinutes, 240, "Planejado 4h");
  assert.equal(obl.remainingMinutes, 360, "Restante = Original − Compensado (planejado NÃO reduz)");
});

check("P. fechamento 30/04→01/05 segue isolado", () => {
  const n0 = getAppData().compensations.length;
  const r = actions.addComp({ sourceDate: "2026-08-25", targetDate: "2026-04-25", minutes: 60, note: null, kind: "calendario" });
  assert.equal(r.ok, false, "destino no ciclo anterior bloqueado");
  assert.equal(getAppData().compensations.length, n0);
});

console.log(`\n✅ ${passed} verificações passaram: §12/§13/§14 + §7 + A B C G H I J K L M N O P (D/E/F pelos §13) + §9/§16`);
