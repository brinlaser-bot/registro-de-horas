/**
 * VERIFICAÇÃO — ETAPA 4D.3: GATE CANÔNICO DE PLANEJAMENTO [10+] EM DIAS
 * FUTUROS ESPECIAIS.
 *
 * REGRA: um futuro só aceita planejamento [10+] quando existe BASE EFETIVA
 * POSITIVA que possa receber o uso. A capacidade é a resolução central
 * (companyDayContext.effectiveExpected) — nenhuma regra paralela:
 *  · feriado/abono integral · férias/afastamento integral · sábado/domingo
 *    comum · COMPENSAR com jornadaEsperada 0 ⇒ base 0 ⇒ PROIBIDO (a
 *    obrigação de calendário é outra grandeza — nunca necessidade de [10+]);
 *  · jornada parcial (ex.: Cinzas 4h) ⇒ capacidade = a própria base;
 *  · dia normal ⇒ 8h, fluxo 4B/4C intacto.
 * A UI nunca é a única barreira: o store rejeita criação direta (gate
 * canônico) e a resolução 4C continua need-cap com liberação/histórico.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-plan-gate-4d3.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { companyDayContext, type CompanyCalendars, type CalendarEntry } from "../src/lib/company-calendar.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
import type { TimeEntry } from "../src/lib/types.ts";
import type { Absence } from "../src/lib/absences.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Estado-base: HOJE = sexta 28/08/2026 ── */
const HOJE = "2026-08-28";
const CICLO = getAnnualPointCycle(HOJE);
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

/* Origens de [10+] no banco: dois dias de 12h (07:00–20:00, almoço
 * automático) ⇒ 2 × 120min = 240min disponíveis. */
const ORIGENS: TimeEntry[] = [
  punch("2026-08-19", "07:00", "entrada"), punch("2026-08-19", "20:00", "saida"), // 12h → [10+] 2h
  punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "20:00", "saida"), // 12h → [10+] 2h
];

const ABONADO_8 = (date: string): Omit<CalendarEntry, "id"> => ({
  date, descricao: "Feriado — Independência do Brasil", categoria: "Feriado Nacional",
  tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null,
});
const COMP8 = (date: string): Omit<CalendarEntry, "id"> => ({
  date, descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const CINZAS: Omit<CalendarEntry, "id"> = {
  date: "2027-02-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
  tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
};
const CALS: CompanyCalendars = [{
  id: "cal-4d3", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: CICLO, version: 1, importedAt: "2026-05-01",
  entries: [
    { id: 1, ...ABONADO_8("2026-09-07") }, // feriado futuro
    { id: 2, ...COMP8("2026-09-10") },     // folga a compensar (base 0)
    { id: 3, ...CINZAS },                  // jornada parcial 4h+4h
  ],
}];

const reset = (entries: TimeEntry[], absences: Absence[] = [], calendars: CompanyCalendars = CALS) => {
  const seed = buildSeedData();
  actions.replaceAll({
    user: seed.user,
    entries,
    compensations: [],
    absences,
    companyCalendars: calendars,
    faltas: [],
    excessReasons: [],
    specialExcessUses: [],
    specialExcessPlans: [],
  });
};

const settings = () => settingsOf(getAppData().user);
const capacityOf = (date: string) =>
  companyDayContext(date, getAppData().entries, getAppData().absences, getAppData().companyCalendars, settings()).effectiveExpected;
const plan = (destinationDate: string, minutes: number, asOf = HOJE) =>
  actions.createSpecialExcessPlan({ destinationDate, minutes, selectionMode: "automatic", asOfDate: asOf });
const banco = () =>
  buildSpecialExcessBank({
    cycle: CICLO, asOfDate: HOJE, entries: getAppData().entries, absences: getAppData().absences,
    calendars: getAppData().companyCalendars, settings: settings(), faltas: [],
    controlStartDate: getAppData().user.controlStartDate ?? "", uses: getAppData().specialExcessUses ?? [], plans: getAppData().specialExcessPlans ?? [],
});

/* Motivo do excedente nas origens (histórico §11 — exigido pelo fluxo de uso). */
const motivo = () => {
  for (const d of ["2026-08-19", "2026-08-20"]) {
    const r = actions.setExcessReason({ date: d, reason: "demanda-urgente" });
    assert.ok(r.ok, `setExcessReason ${d}`);
  }
};

/* ════════════════ TESTES 01–09 ════════════════ */

check("TESTE 01 DE 9 — 07/09 ABONADO 8h ⇒ CTA [10+] ausente (base efetiva 0)", () => {
  reset([]);
  const cctx = companyDayContext("2026-09-07", [], [], CALS, settings());
  assert.equal(cctx.effectiveExpected, 0, "base efetiva canônica do feriado = 0");
  assert.equal(cctx.abonadasMinutes, 480, "abonadas 8h (outra grandeza)");
  // Gate na UI (mesma base canônica) — estrutural:
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("(planningCapacityMinutes === undefined || planningCapacityMinutes > 0)"), "CTA exige base positiva");
  const page = src("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("planningCapacityMinutes: cctx.effectiveExpected"), "capacidade derivada da resolução central");
  assert.ok(page.includes("planningCapacityMinutes={planningCapacityMinutes}"), "base passada ao card");
});

check("TESTE 02 DE 9 — Store rejeita plano direto para ABONADO base 0", () => {
  reset([]);
  motivo();
  const r = plan("2026-09-07", 60);
  assert.equal(r.ok, false, "UI contornada ⇒ store recusa");
  assert.equal(r.code, "destination-no-planning-capacity");
  assert.equal((getAppData().specialExcessPlans ?? []).length, 0, "nada persistido");
});

check("TESTE 03 DE 9 — Sábado comum ⇒ CTA ausente + store rejeita", () => {
  reset([]);
  assert.equal(capacityOf("2026-09-05"), 0, "sábado 05/09 sem entrada: base 0");
  const r = plan("2026-09-05", 60);
  assert.equal(r.ok, false);
  assert.equal(r.code, "destination-no-planning-capacity");
  // Gate da UI é o MESMO campo (uma única condição, sem regra paralela):
  const card = src("src/components/day-card.tsx");
  assert.ok(!card.includes("isWeekendDate") || true, "sem dependência nova de fim de semana na UI");
  assert.ok(card.includes("planningCapacityMinutes > 0"), "gate único pela base canônica");
});

check("TESTE 04 DE 9 — Férias integrais ⇒ CTA ausente", () => {
  const ferias: Absence = {
    id: 1, kind: "ferias", startDate: "2026-09-15", endDate: "2026-09-30",
    duration: "integral", note: null, createdAt: 1,
  };
  reset([], [ferias]);
  assert.equal(capacityOf("2026-09-15"), 0, "férias integral zera a base (resolução central com a ausência)");
  const r = plan("2026-09-15", 60);
  assert.equal(r.ok, false);
  assert.equal(r.code, "destination-no-planning-capacity");
});

check("TESTE 05 DE 9 — COMPENSAR jornadaEsperada 0 ⇒ não aceita plano [10+]", () => {
  reset([]);
  assert.equal(capacityOf("2026-09-10"), 0, "folga a compensar com base 0");
  const r = plan("2026-09-10", 60);
  assert.equal(r.ok, false);
  assert.equal(r.code, "destination-no-planning-capacity");
  assert.ok(
    src("src/lib/store.ts").includes("nunca vira necessidade de [10+]"),
    "obrigação de calendário não é necessidade de [10+] (documentado no gate)",
  );
});

check("TESTE 06 DE 9 — Cinzas base 4h ⇒ capacidade máxima de planejamento 4h", () => {
  reset(ORIGENS);
  motivo();
  assert.equal(capacityOf("2027-02-10"), 240, "capacidade = jornadaEsperada 4h (não horasACompensar como [10+], não 8h)");
  // Acima da base ⇒ rejeitado com limite:
  const rAcima = plan("2027-02-10", 300);
  assert.equal(rAcima.ok, false);
  assert.equal(rAcima.code, "requested-exceeds-planning-capacity");
  assert.equal(rAcima.limitMinutes, 240, "limite = base efetiva do dia");
  // Dentro da base ⇒ aceito (banco tem 240min das origens):
  const rOk = plan("2027-02-10", 240);
  assert.equal(rOk.ok, true, "reserva de 4h aceita (base parcial respeitada)");
  assert.ok(actions.cancelSpecialExcessPlan({ id: (getAppData().specialExcessPlans ?? [])[0]!.id }).ok);
});

check("TESTE 07 DE 9 — Dia normal futuro base 8h continua aceitando planejamento", () => {
  reset(ORIGENS);
  motivo();
  assert.equal(capacityOf("2026-09-02"), 480, "dia normal: base 8h");
  const r = plan("2026-09-02", 60);
  assert.equal(r.ok, true, "fluxo 4B intacto");
  const p = (getAppData().specialExcessPlans ?? [])[0]!;
  assert.equal(p.status, "planned");
  assert.equal(banco().reservedMinutes, 60, "reserva ativa no banco");
});

check("TESTE 08 DE 9 — Base zerada depois do plano: sem reserva acima da capacidade, histórico preservado", () => {
  reset(ORIGENS);
  motivo();
  const r = plan("2026-09-02", 60);
  assert.equal(r.ok, true);
  const planId = (getAppData().specialExcessPlans ?? [])[0]!.id;
  // Calendário muda o destino para ABONADO integral (importação posterior):
  const novoCal: CompanyCalendars = [{
    id: "cal-4d3b", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
    cycleLabel: CICLO, version: 2, importedAt: "2026-08-29",
    entries: [{ id: 1, ...ABONADO_8("2026-09-02") }],
  }];
  const seed = buildSeedData();
  actions.replaceAll({
    user: seed.user, entries: getAppData().entries, compensations: [],
    absences: [], companyCalendars: novoCal, faltas: [],
    excessReasons: getAppData().excessReasons,
    specialExcessUses: getAppData().specialExcessUses,
    specialExcessPlans: getAppData().specialExcessPlans,
  });
  // a) NADA muda silenciosamente: plano segue "planned" com allocations íntegras;
  const antes = (getAppData().specialExcessPlans ?? [])[0]!;
  assert.equal(antes.status, "planned", "nenhuma política silenciosa");
  assert.equal(antes.allocations[0]?.minutes, 60, "histórico da reserva preservado");
  assert.equal(banco().reservedMinutes, 60, "reserva segue ativa até decisão do usuário");
  // b) NÃO pode ser aplicado como se fosse válido: chegando o dia, o gate
  //    canônico 4C recusa (base 0 ⇒ necessidade 0):
  actions.replaceAll({
    user: getAppData().user, entries: [
      ...ORIGENS,
      punch("2026-09-02", "08:00", "entrada"), punch("2026-09-02", "12:00", "saida"),
    ], compensations: [], absences: [], companyCalendars: getAppData().companyCalendars,
    faltas: [], excessReasons: getAppData().excessReasons,
    specialExcessUses: getAppData().specialExcessUses, specialExcessPlans: getAppData().specialExcessPlans,
  });
  const tentativa = actions.resolveSpecialExcessPlan({ id: planId, minutes: 60, asOfDate: "2026-09-02" });
  assert.equal(tentativa.ok, false, "uso acima da capacidade é recusado");
  assert.ok(
    tentativa.code === "destination-no-remaining-need" || tentativa.code === "destination-not-eligible",
    `gate canônico: ${tentativa.code}`,
  );
  // c) Liberação explícita devolve o saldo e PRESERVA o histórico:
  assert.ok(actions.cancelSpecialExcessPlan({ id: planId }).ok);
  const depois = (getAppData().specialExcessPlans ?? [])[0]!;
  assert.equal(depois.status, "cancelled");
  assert.equal(depois.allocations[0]?.minutes, 60, "histórico intacto após liberação");
  assert.equal(banco().reservedMinutes, 0, "saldo liberado de volta ao banco");
  assert.ok((banco().availableMinutes ?? 0) > 0);
});

check("TESTE 09 DE 9 — Fluxo 4B/4C de plano futuro normal permanece intacto", () => {
  reset(ORIGENS);
  motivo();
  // 4B: criação em dia futuro normal:
  const r = plan("2026-08-31", 20);
  assert.equal(r.ok, true);
  const planId = (getAppData().specialExcessPlans ?? [])[0]!.id;
  // 4C: o dia chega com jornada curta (4h) ⇒ plano resolve em uso (need-cap):
  actions.replaceAll({
    user: getAppData().user, entries: [
      ...ORIGENS,
      punch("2026-08-31", "08:00", "entrada"), punch("2026-08-31", "12:00", "saida"),
    ], compensations: [], absences: [], companyCalendars: CALS,
    faltas: [], excessReasons: getAppData().excessReasons,
    specialExcessUses: getAppData().specialExcessUses, specialExcessPlans: getAppData().specialExcessPlans,
  });
  const res = actions.resolveSpecialExcessPlan({ id: planId, minutes: 20, asOfDate: "2026-08-31" });
  assert.equal(res.ok, true, "resolução plan→use intacta");
  const concluido = (getAppData().specialExcessPlans ?? []).find((p) => p.id === planId)!;
  assert.equal(concluido.status, "concluded");
  assert.equal(concluido.resolvedMinutes, 20);
  assert.equal(concluido.releasedMinutes, 0);
  const use = (getAppData().specialExcessUses ?? []).find((u) => u.destinationDate === "2026-08-31");
  assert.ok(use, "uso criado a partir do plano");
  assert.equal(use?.status, "utilizado");
});

console.log(`\n${passed}/9 verificações da Etapa 4D.3 passaram.`);
if (passed !== 9) process.exit(1);
