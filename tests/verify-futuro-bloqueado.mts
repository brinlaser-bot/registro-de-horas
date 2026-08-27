/**
 * VERIFICAÇÃO — REGRA ABSOLUTA: NENHUMA BATIDA EM DATA FUTURA (seção 8, A–J)
 * Registro de ponto só pode existir em date <= hoje. A proteção é CENTRAL
 * (store + helper de data local) — a UI apenas reflete a regra.
 * Falta prevista continua permitida no futuro; a regra é exclusiva de batidas.
 *
 * Executar: npx tsx tests/verify-futuro-bloqueado.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { buildDebtDays } from "../src/lib/debt.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { canRegisterFalta, effectiveFaltas } from "../src/lib/faltas.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import {
  addDays,
  FUTURE_DATE_ERROR,
  isFutureDate,
  todayString,
} from "../src/lib/time.ts";
import type { User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

// Datas derivadas do relógio real — NÃO usar "ontem" cego: a data pode ser
// folga/abonado/COMPENSAR no calendário e o gate de falta recusa.
const HOJE = todayString();
const FUT = addDays(HOJE, 8);
const FUT2 = addDays(HOJE, 31);
function pickFaltaDate(from: string, step: 1 | -1): string {
  let d = addDays(from, step);
  for (let i = 0; i < 120; i++) {
    if (canRegisterFalta(d, [], [], both, settings, []).ok) return d;
    d = addDays(d, step);
  }
  throw new Error("nenhum dia elegível para falta no intervalo");
}
const PASSADO = pickFaltaDate(HOJE, -1);
const FUT_FALTA = pickFaltaDate(HOJE, 1);
const BOUNDS = annualCycleBounds(getAnnualPointCycle(HOJE));

const reset = () =>
  actions.replaceAll({ user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. card futuro: nenhum controle de ponto é renderizado ─ */
check(`A. card futuro (${FUT}): DayCard sem formulário/atalhos/Smart Exit — card vira somente leitura`, () => {
  assert.equal(isFutureDate(FUT), true);
  assert.equal(isFutureDate(HOJE), false, "hoje NUNCA é futuro");
  // Tripwire de UI: o JSX condiciona os controles de batida a !futureDay
  const src = readFileSync(new URL("../src/components/day-card.tsx", import.meta.url), "utf8");
  const guards = src.match(/!futureDay/g) ?? [];
  assert.ok(src.includes("const futureDay = isFutureDate(d.date)"), "guarda central no card");
  assert.ok(guards.length >= 1, "formulário de registro manual condicionado a !futureDay");
  assert.ok(src.includes("d.open && isToday"), "Smart Exit só no dia local de hoje");
  // E qualquer caminho programático cai na proteção do store (B)
  reset();
  assert.equal(actions.addEntry({ date: FUT, time: "08:00", type: "entrada", note: null }).ok, false);
});

/* ── B. tentativa programática de batida futura: rejeitada ── */
check("B. addEntry em data futura: rejeitado com a mensagem central; nada é gravado", () => {
  reset();
  for (const type of ["entrada", "saida"] as const) {
    for (const src of ["live", "manual"] as const) {
      const before = getAppData().entries.length;
      const res = actions.addEntry({ date: FUT, time: "08:00", type, note: null, source: src });
      assert.equal(res.ok, false);
      assert.equal(res.code, "invalid");
      assert.equal(res.error, "Não é possível registrar horários em uma data futura.");
      assert.equal(getAppData().entries.length, before, "rejeição não modifica o estado");
    }
  }
  assert.equal(actions.addEntry({ date: FUT2, time: "17:00", type: "saida", note: null }).ok, false);
});

/* ── C. modal geral: data máxima = hoje e bloqueio central ── */
check("C. lançamento manual geral: max=hoje (data local) e par de batidas futuras rejeitado", () => {
  const src = readFileSync(new URL("../src/components/manual-entry-modal.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("max={today}"), "input date com max = hoje");
  assert.ok(src.includes("FUTURE_DATE_ERROR"), "modal usa a mensagem central");
  assert.ok(src.includes("isFutureDate("), "modal usa o helper central");
  reset();
  const r1 = actions.addEntry({ date: FUT, time: "08:00", type: "entrada", note: null, source: "manual" });
  const r2 = actions.addEntry({ date: FUT, time: "12:00", type: "saida", note: null, source: "manual" });
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false);
  assert.equal(getAppData().entries.length, 0, "par manual futuro não gravou nada");
});

/* ── D. hoje: batida continua permitida ───────────────────── */
check("D. hoje: batida (entrada/saída, live/manual) continua permitida", () => {
  reset();
  assert.equal(actions.addEntry({ date: HOJE, time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: HOJE, time: "12:00", type: "saida", note: null, source: "manual" }).ok, true);
  assert.equal(getAppData().entries.length, 2);
});

/* ── E. data passada: lançamento manual continua permitido ── */
check(`E. passado (${PASSADO}): lançamento manual entrada+saída continua permitido`, () => {
  reset();
  assert.equal(isFutureDate(PASSADO), false);
  assert.equal(actions.addEntry({ date: PASSADO, time: "08:00", type: "entrada", note: null, source: "manual" }).ok, true);
  assert.equal(actions.addEntry({ date: PASSADO, time: "17:00", type: "saida", note: null, source: "manual" }).ok, true);
  assert.equal(getAppData().entries.length, 2);
});

/* ── F. falta prevista futura: continua válida e com saldo 0 ─ */
check(`F. falta prevista em ${FUT_FALTA}: registrável, saldo 0, sem déficit/dívida`, () => {
  reset();
  assert.equal(actions.addFalta(FUT_FALTA).ok, true, "Falta prevista PODE ser futura");
  const st = getAppData();
  assert.equal(effectiveFaltas(st.faltas, HOJE).length, 0, "prevista não é efetiva");
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, effectiveFaltas(st.faltas, HOJE));
  assert.equal(debts.find((d) => d.date === FUT_FALTA), undefined, "sem déficit/saldo antes da data");
});

/* ── G. falta efetiva passada: continua gerando déficit ───── */
check(`G. falta efetiva ${PASSADO}: déficit = jornada efetiva do dia (sem regressão)`, () => {
  reset();
  assert.equal(actions.addFalta(PASSADO).ok, true);
  const st = getAppData();
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, effectiveFaltas(st.faltas, HOJE));
  const d = debts.find((x) => x.date === PASSADO && x.kind === "deficit");
  assert.ok(d, "déficit da falta efetiva");
  assert.equal(d.debtMinutes, companyDayContext(PASSADO, [], [], both, settings).effectiveExpected);
});

/* ── H. futuro bloqueia ANTES do conflito com falta (§7) ──── */
check("H. falta prevista + batida futura: erro de DATA FUTURA (nunca o diálogo de conflito)", () => {
  reset();
  assert.equal(actions.addFalta(FUT_FALTA).ok, true);
  const res = actions.addEntry({ date: FUT_FALTA, time: "08:00", type: "entrada", note: null });
  assert.equal(res.ok, false);
  assert.equal(res.error, FUTURE_DATE_ERROR, "bloqueio de data futura precede qualquer conflito com falta");
  // Data PASSADA com falta: o guard de futuro NÃO dispara — o fluxo de
  // confirmação de falta (UI, resolveFaltaConflict) segue disponível.
  assert.equal(isFutureDate(PASSADO), false);
});

/* ── I. sábado/abonado/calendário: nenhuma regressão ──────── */
check("I. sábado +2h, feriado abonado +2h e obrigação 25/08 (8h) intactos", () => {
  const sat = [
    { id: 1, date: "2026-08-22", time: "08:00", type: "entrada" as const, note: null },
    { id: 2, date: "2026-08-22", time: "10:00", type: "saida" as const, note: null },
  ];
  assert.equal(companyDayContext("2026-08-22", sat, [], both, settings).adjustedBalance, 120, "sábado +2h");
  const hol = [
    { id: 3, date: "2026-09-07", time: "08:00", type: "entrada" as const, note: null },
    { id: 4, date: "2026-09-07", time: "10:00", type: "saida" as const, note: null },
  ];
  assert.equal(companyDayContext("2026-09-07", hol, [], both, settings).adjustedBalance, 120, "abonado +2h");
  const debts = buildDebtDays([], [], settings, annualCycleBounds(getAnnualPointCycle("2026-08-23")), [], both);
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "calendario")?.debtMinutes, 480, "obrigação 25/08 = 8h");
});

/* ── J. edição: nunca move registro para data futura ──────── */
check("J. updateEntry: patch com data futura rejeitado (histórico preservado); edição normal segue", () => {
  reset();
  assert.equal(actions.addEntry({ date: PASSADO, time: "08:00", type: "entrada", note: null }).ok, true);
  const entry = getAppData().entries[0];
  const res = actions.updateEntry(entry.id, { date: FUT });
  assert.equal(res.ok, false);
  assert.equal(res.error, FUTURE_DATE_ERROR);
  const after = getAppData().entries[0];
  assert.equal(after.date, PASSADO, "data original preservada");
  // Edição histórica continua funcionando (hora e data passada/hoje)
  assert.equal(actions.updateEntry(entry.id, { time: "09:30" }).ok, true);
  assert.equal(getAppData().entries[0].time, "09:30");
  assert.equal(actions.updateEntry(entry.id, { date: HOJE }).ok, true, "mover para hoje é permitido");
  assert.equal(getAppData().entries[0].date, HOJE);
});

console.log(`\n✅ ${passed} verificações passaram: A B C D E F G H I J`);
