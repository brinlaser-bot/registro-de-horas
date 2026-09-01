/**
 * VERIFICAÇÃO — ETAPA 4D.4.1: TRABALHO EM QUALQUER DIA ABONADO.
 *
 * REGRA (usuário, política da empresa indefinida): QUALQUER evento
 * EXPLICITAMENTE ABONADO pelo calendário — dia útil, sábado, domingo ou
 * feriado de base ordinária 0 — com trabalho registrado:
 *  1. preserva integralmente as batidas;
 *  2. mostra Trabalhado = valor factual;
 *  3. preserva o tratamento abonado do calendário;
 *  4. NÃO transforma o trabalho em crédito regular automático;
 *  5. NÃO soma crédito de calendário + trabalho como saldo positivo;
 *  6. saldo financeiro conhecido permanece neutro (0);
 *  7. mostra a observação de política pendente no card.
 * O fato de um sábado comum permitir crédito por trabalho NÃO vence uma
 * entrada EXPLÍCITA de calendário ABONADO. Sem trabalho: dia útil abonado
 * ⇒ base 8h/crédito 8h/saldo 0; sábado/domingo abonado ⇒ saldo 0, sem
 * déficit e SEM inventar "8h abonadas" (o contrato legítimo representa 0h).
 * Sábado COMUM (sem abono) mantém a regra normal de fim de semana.
 *
 * Motivação (auditoria 4D.4.1 — CASO B, comportamento real): o ramo de
 * evento com horasAbonadas derivadas 0 (fim de semana) entregava saldo
 * +trabalho (crédito automático) e não exibia o aviso — corrigido
 * centralmente em companyDayContext (flag abonadoIntegral).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-abonado-trabalho-4d41.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { companyDayContext, type CompanyCalendars, type CalendarEntry } from "../src/lib/company-calendar.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true };
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const work2 = (d: string) => [punch(d, "08:00", "entrada"), punch(d, "10:00", "saida")]; // 2h

/** ABONADO explícito: `ha` = horas_abonadas (0 = fim de semana legítimo). */
const ABONADO = (d: string, ha: number): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Feriado — Adesão", categoria: "Feriado Estadual/Municipal",
  tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: ha, observacao: null,
});
const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Folga a compensar", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const CINZAS = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
  tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
});
const calOf = (entries: Omit<CalendarEntry, "id">[]): CompanyCalendars => [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
  entries: entries.map((e, i) => ({ ...e, id: i + 1 })),
}];

const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const reset = (entries: TimeEntry[] = [], calendars: CompanyCalendars = []) => {
  actions.replaceAll({
    user: seedUser, entries, compensations: [], absences: [], companyCalendars: calendars,
    faltas: [], excessReasons: [], specialExcessUses: [], specialExcessPlans: [],
  });
};
const st = () => getAppData();
const view = (date: string, entries: TimeEntry[], calendars: CompanyCalendars) =>
  companyDayContext(date, entries, st().absences, calendars, S());

/* 2026-08-15 é SÁBADO · 2026-08-17 é SEGUNDA-FEIRA. */
const SAB = "2026-08-15";
const SEG = "2026-08-17";

/* ════════════════ TESTES 01–06 ════════════════ */

check("TESTE 01 DE 06 — ABONADO de dia útil, 0h trabalhadas: base 8h · crédito 8h · saldo 0", () => {
  reset([], calOf([ABONADO(SEG, 8)]));
  const v = view(SEG, [], st().companyCalendars);
  assert.equal(v.referenceBaseMinutes, 480, "base de referência 8h");
  assert.equal(v.calendarCreditMinutes, 480, "crédito do calendário 8h");
  assert.equal(v.requiredWorkMinutes, 0, "nada a cumprir");
  assert.equal(v.abonadoIntegral, true);
  assert.equal(v.regularBalance, 0, "saldo 0 — abono cumpre a jornada, não soma no banco");
  assert.equal(v.adjustedDeficit, 0);
  assert.equal(dayBalanceContribution(v, st().faltas, SEG, "2026-08-20"), 0, "contribuição factual 0");
});

check("TESTE 02 DE 06 — ABONADO de dia útil COM trabalho: batidas preservadas, saldo neutro + aviso", () => {
  reset(work2(SEG), calOf([ABONADO(SEG, 8)]));
  const v = view(SEG, st().entries, st().companyCalendars);
  assert.equal(v.ctx.day.workedMinutes, 120, "batidas preservadas (Trabalhado = factual)");
  assert.equal(v.abonadasMinutes, 480, "tratamento abonado preservado");
  assert.equal(v.regularBalance, 0, "saldo neutro — NÃO soma crédito 8h + trabalho");
  assert.equal(v.abonadoIntegral, true);
  assert.equal(dayBalanceContribution(v, st().faltas, SEG, "2026-08-20"), 0, "sem crédito no factual");
  // Aviso de política pendente no card (fonte):
  const registros = src("src/app/(app)/registros/page.tsx");
  assert.ok(registros.includes("workedOnAbonadoIntegral: cctx.abonadoIntegral && cctx.ctx.day.workedMinutes > 0"), "flag do aviso presente");
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("Há trabalho registrado em um dia abonado"), "observação de política pendente");
  assert.ok(card.includes("O tratamento dessas horas depende da regra da empresa"), "texto completo da observação");
});

check("TESTE 03 DE 06 — ABONADO em sábado, 0h: saldo 0, sem déficit, SEM inventar 8h abonadas", () => {
  reset([], calOf([ABONADO(SAB, 0)])); // contrato importa 0h legítimas (fim de semana)
  const v = view(SAB, [], st().companyCalendars);
  assert.equal(v.abonadasMinutes, 0, "não inventar 8h abonadas");
  assert.equal(v.calendarCreditMinutes, 0);
  assert.equal(v.requiredWorkMinutes, 0, "evento ABONADO nunca exige trabalho");
  assert.equal(v.abonadoIntegral, true, "tratamento ABONADO neutro independe do dia da semana");
  assert.equal(v.regularBalance, 0, "saldo 0");
  assert.equal(v.adjustedDeficit, 0, "sem déficit");
  assert.equal(dayBalanceContribution(v, st().faltas, SAB, "2026-08-20"), 0);
});

check("TESTE 04 DE 06 — ABONADO em sábado COM trabalho: NÃO vira crédito + aviso (o bug 4D.4.1)", () => {
  reset(work2(SAB), calOf([ABONADO(SAB, 0)]));
  const v = view(SAB, st().entries, st().companyCalendars);
  assert.equal(v.ctx.day.workedMinutes, 120, "batidas preservadas");
  assert.equal(v.abonadoIntegral, true, "ABONADO explícito vence a regra comum do sábado");
  assert.equal(v.regularBalance, 0, "saldo neutro — trabalho NÃO vira crédito automático");
  assert.equal(dayBalanceContribution(v, st().faltas, SAB, "2026-08-20"), 0, "sem crédito no factual/ciclo");
  const row = buildResumoDayRow({
    date: SAB, today: "2026-08-20", entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null,
  });
  assert.equal(row.balanceMinutes, 0, "Resumo: saldo 0");
  assert.equal(row.status, "ok", "Resumo: dia de calendário abonado realizado é dia ok (nunca Sem registro)");
  // Mesmo caso com horasAbonadas explícitas 8h no arquivo (sábado):
  reset(work2(SAB), calOf([ABONADO(SAB, 8)]));
  const v8 = view(SAB, st().entries, st().companyCalendars);
  assert.equal(v8.regularBalance, 0, "crédito 8h + trabalho NÃO soma saldo positivo");
  assert.equal(v8.abonadoIntegral, true);
});

check("TESTE 05 DE 06 — Sábado COMUM (NÃO abonado) + trabalho: regra normal de fim de semana intacta", () => {
  reset(work2(SAB), []); // sem NENHUMA entrada de calendário
  const v = view(SAB, st().entries, []);
  assert.equal(v.calendarEntry, undefined);
  assert.equal(v.regularBalance, 120, "sábado comum: +2h de crédito (como sempre)");
  assert.equal(dayBalanceContribution(v, st().faltas, SAB, "2026-08-20"), 120, "crédito factual preservado");
  const row = buildResumoDayRow({
    date: SAB, today: "2026-08-20", entries: st().entries, absences: [],
    calendars: [], settings: S(), faltas: st().faltas, controlStartDate: null,
  });
  assert.equal(row.balanceMinutes, 120);
});

check("TESTE 06 DE 06 — COMPENSAR, Cinzas e [10+] permanecem intactos", () => {
  // COMPENSAR integral: 0h → −8h · 8h → 0 (semântica 4D.4 intocada):
  reset([], calOf([COMP8("2026-08-20")]));
  const c0 = view("2026-08-20", [], st().companyCalendars);
  assert.equal(c0.regularBalance, -480, "COMPENSAR integral 0h ⇒ −8h factual");
  const dia8 = [
    punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
    punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "17:00", "saida"),
  ];
  reset(dia8, calOf([COMP8("2026-08-20")]));
  assert.equal(view("2026-08-20", st().entries, st().companyCalendars).regularBalance, 0, "8h ⇒ 0");
  // Cinzas (parcial 4h+4h): 0h ⇒ −4h · 4h ⇒ 0:
  reset([], calOf([CINZAS("2026-02-10")]));
  const ciclo2526 = [{ ...CINZAS("2026-02-10"), id: 1 }];
  const calsCinzas: CompanyCalendars = [{
    id: "cal-2526", cycleStart: "2025-05-01", cycleEnd: "2026-04-30",
    cycleLabel: "2025/2026", version: 1, importedAt: "2025-05-01", entries: ciclo2526,
  }];
  const cz0 = companyDayContext("2026-02-10", [], [], calsCinzas, S());
  assert.equal(cz0.regularBalance, -240, "Cinzas 0h ⇒ −4h");
  const cz4 = companyDayContext("2026-02-10", [punch("2026-02-10", "08:00", "entrada"), punch("2026-02-10", "12:00", "saida")], [], calsCinzas, S());
  assert.equal(cz4.regularBalance, 0, "Cinzas 4h ⇒ 0");
  // [10+]: gate 4D.3 preservado — plano em ABONADO (sábado) rejeitado; dia comum aceito:
  reset([
    punch("2026-08-19", "07:00", "entrada"), punch("2026-08-19", "20:00", "saida"), // origem [10+]
  ], calOf([ABONADO("2026-09-12", 0)])); // ABONADO em sábado FUTURO (12/09/2026)
  assert.ok(actions.setExcessReason({ date: "2026-08-19", reason: "demanda-urgente" }).ok);
  const rAbonado = actions.createSpecialExcessPlan({ destinationDate: "2026-09-12", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rAbonado.ok, false);
  assert.equal(rAbonado.code, "destination-no-planning-capacity");
  const rOk = actions.createSpecialExcessPlan({ destinationDate: "2026-09-02", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.equal(rOk.ok, true, "fluxo normal [10+] intacto");
});

console.log(`\n${passed}/6 verificações da Etapa 4D.4.1 passaram.`);
if (passed !== 6) process.exit(1);
