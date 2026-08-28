/**
 * Preencher registros do dia (SEM REGISTRO → jornada completa atômica).
 * TZ=America/Sao_Paulo npx tsx tests/verify-preencher-dia.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { companyDayContext } from "../src/lib/company-calendar.ts";
import {
  FILL_INCOMPLETE_MSG,
  FILL_ORDER_MSG,
  FILL_OVERLAP_MSG,
  fillDayPreview,
  fillDayPunches,
  validateFillDayPeriods,
  validateFillDaySave,
} from "../src/lib/fill-day-records.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { isMissingExpectedRecord, missingExpectedRecordDates } from "../src/lib/missing-records.ts";
import { pendingPunchDates } from "../src/lib/pending-punches.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { DEFAULT_USER } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import type { Falta, TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = { ...DEFAULT_USER };
const cals = seedCompanyCalendars();
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const TODAY = "2026-08-28";
const WED = "2026-08-26";
const THU = "2026-08-27";
const TWO = { from: WED, to: THU };

function resetStore(entries: TimeEntry[] = [], faltas: Falta[] = []) {
  actions.replaceAll({
    user, entries, compensations: [], absences: [], companyCalendars: cals, faltas, excessReasons: [],
  });
}

function view(date: string, entries: TimeEntry[] = [], faltas: Falta[] = []) {
  return companyDayContext(date, entries, [], cals, S);
}

check("1. card Sem registro não possui Adicionar batida duplicado", () => {
  const card = srcOf("src/components/day-card.tsx");
  const banner = card.slice(card.indexOf("{missingExpected && ("), card.indexOf("{incompletePast && ("));
  assert.ok(!banner.includes("Adicionar batida"), "banner Sem registro sem Adicionar batida");
  assert.ok(card.includes("!missingExpected && ("), "barra inferior oculta em Sem registro");
  assert.ok(card.includes("Adicionar batida"), "outros estados preservam Adicionar batida");
});

check("2. card Sem registro possui Preencher registros do dia", () => {
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Preencher registros do dia"));
  assert.ok(card.includes("onFillDayRecords"));
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("Preencher registros do dia"));
  assert.ok(modal.includes("Salvar registros do dia"));
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("FillDayRecordsModal"));
});

check("3. abrir / montar o plano não altera o store", () => {
  resetStore();
  const before = JSON.stringify(getAppData().entries);
  const plan = validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(plan.ok, true);
  assert.equal(JSON.stringify(getAppData().entries), before);
  const punches = fillDayPunches(WED, [{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(punches.length, 2);
  assert.equal(JSON.stringify(getAppData().entries), before);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("validateFillDaySave"));
  assert.ok(modal.includes("actions.addEntries(v.punches)"));
  assert.ok(!modal.includes("actions.addEntry("));
});

check("4. preencher somente Entrada e não salvar: continua Sem registro", () => {
  resetStore();
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "" }]);
  assert.equal(v.ok, false);
  assert.equal(v.error, FILL_INCOMPLETE_MSG);
  assert.equal(getAppData().entries.length, 0);
  assert.equal(isMissingExpectedRecord(WED, TODAY, view(WED), []), true);
});

check("5. cancelar: continua Sem registro", () => {
  resetStore();
  validateFillDayPeriods([{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(getAppData().entries.length, 0);
  assert.equal(isMissingExpectedRecord(WED, TODAY, view(WED), []), true);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("Cancelar"));
  assert.ok(modal.includes("onClose"));
});

check("6. 08:00→17:00 mostra Permanência 9h, Intervalo automático 1h, Trabalhado 8h", () => {
  const p = fillDayPreview([{ entrada: "08:00", saida: "17:00" }], S);
  assert.equal(p.stay, 540);
  assert.equal(p.autoBreak, 60);
  assert.equal(p.net, 480);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("Permanência:"));
  assert.ok(modal.includes("Intervalo automático:"));
  assert.ok(modal.includes("Trabalhado:"));
});

check("7. salvar 08→17 persiste a jornada completa atomicamente", () => {
  resetStore();
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(v.ok, true);
  assert.equal(v.punches?.length, 2);
  const res = actions.addEntries(v.punches!);
  assert.equal(res.ok, true, res.error);
  const dayEntries = getAppData().entries.filter((e) => e.date === WED).sort((a, b) => a.time.localeCompare(b.time));
  assert.equal(dayEntries.length, 2);
  assert.equal(dayEntries[0].time, "08:00");
  assert.equal(dayEntries[0].type, "entrada");
  assert.equal(dayEntries[1].time, "17:00");
  assert.equal(dayEntries[1].type, "saida");
});

check("8. o dia vai diretamente Sem registro → Dia ok", () => {
  const entries = getAppData().entries.filter((e) => e.date === WED);
  const day = computeDay(entries, S);
  assert.equal(day.canFinalizeFinancialDay, true);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.financialPending, false);
  assert.equal(day.open, false);
  assert.equal(isMissingExpectedRecord(WED, TODAY, view(WED, entries), []), false);
  assert.equal(day.status, "ok");
});

check("9. nunca aparece Pendentes 1 nesse fluxo válido", () => {
  const entries = getAppData().entries;
  assert.equal(pendingPunchDates(entries, S, TODAY, TWO).length, 0);
});

check("10. 08→12 + 13→17: trabalhado 8h", () => {
  resetStore();
  const periods = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "13:00", saida: "17:00" },
  ];
  const v = validateFillDaySave(THU, periods);
  assert.equal(v.ok, true);
  assert.equal(v.punches?.length, 4);
  const res = actions.addEntries(v.punches!);
  assert.equal(res.ok, true, res.error);
  const day = computeDay(getAppData().entries.filter((e) => e.date === THU), S);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.canFinalizeFinancialDay, true);
});

check("11. intervalo explícito não recebe desconto automático extra", () => {
  const periods = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "13:00", saida: "17:00" },
  ];
  const p = fillDayPreview(periods, S);
  assert.equal(p.stay, 480);
  assert.equal(p.autoBreak, 0);
  assert.equal(p.net, 480);
  const day = computeDay(getAppData().entries.filter((e) => e.date === THU), S);
  assert.equal(day.lunchDeductedMinutes, 0);
  assert.equal(day.workedMinutes, 480);
});

check("12. saída anterior à entrada bloqueia salvar", () => {
  const v = validateFillDaySave(WED, [{ entrada: "17:00", saida: "08:00" }]);
  assert.equal(v.ok, false);
  assert.equal(v.error, FILL_ORDER_MSG);
});

check("13. períodos sobrepostos bloqueiam salvar", () => {
  const v = validateFillDaySave(WED, [
    { entrada: "08:00", saida: "13:00" },
    { entrada: "12:00", saida: "17:00" },
  ]);
  assert.equal(v.ok, false);
  assert.equal(v.error, FILL_OVERLAP_MSG);
});

check("14. filtro ?semRegistro=1 com 2 itens: resolver 1 mantém o outro", () => {
  resetStore();
  const before = missingExpectedRecordDates(TWO, TODAY, [], [], cals, S, []);
  assert.equal(before.length, 2);
  const v = validateFillDaySave(THU, [{ entrada: "08:00", saida: "17:00" }]);
  actions.addEntries(v.punches!);
  const after = missingExpectedRecordDates(TWO, TODAY, getAppData().entries, [], cals, S, []);
  assert.equal(after.length, 1);
  assert.equal(after[0], WED);
  assert.equal(pendingPunchDates(getAppData().entries, S, TODAY, TWO).length, 0);
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("wantMissing && missingCount === 0"));
});

check("15. resolver último item: missingCount chega a 0 (limpa ?semRegistro=1)", () => {
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  actions.addEntries(v.punches!);
  const after = missingExpectedRecordDates(TWO, TODAY, getAppData().entries, [], cals, S, []);
  assert.equal(after.length, 0);
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("wantMissing && missingCount === 0"));
  assert.ok(reg.includes('router.replace("/registros")'));
});

check("16. Dias com registro aumenta ao resolver", () => {
  const dates = [...new Set(getAppData().entries.filter((e) => e.date >= TWO.from && e.date <= TWO.to).map((e) => e.date))];
  assert.equal(dates.length, 2);
});

check("17. Sem registro diminui ao resolver", () => {
  resetStore();
  assert.equal(missingExpectedRecordDates(TWO, TODAY, [], [], cals, S, []).length, 2);
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  actions.addEntries(v.punches!);
  assert.equal(missingExpectedRecordDates(TWO, TODAY, getAppData().entries, [], cals, S, []).length, 1);
});

check("18. Banco só recalcula depois do salvamento válido", () => {
  resetStore();
  const emptyBank = hourBankSummary([], [], [], cals, [], [], S, { from: WED, to: WED }, TODAY);
  assert.equal(emptyBank.realizedBalance, 0);
  assert.equal(emptyBank.freeRegularTotal, 0);
  validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(getAppData().entries.length, 0);
  const stillEmpty = hourBankSummary(getAppData().entries, [], [], cals, [], [], S, { from: WED, to: WED }, TODAY);
  assert.equal(stillEmpty.realizedBalance, emptyBank.realizedBalance);
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "18:00" }]);
  actions.addEntries(v.punches!);
  const day = computeDay(getAppData().entries.filter((e) => e.date === WED), S);
  assert.equal(day.workedMinutes, 540);
  assert.equal(day.canFinalizeFinancialDay, true);
  const bank = hourBankSummary(getAppData().entries, [], [], cals, [], [], S, { from: WED, to: WED }, TODAY);
  assert.ok(bank.freeRegularTotal > 0, "crédito regular só aparece após persistir a jornada");
});

check("19. Registrar falta continua resolvendo Sem registro pelo fluxo existente", () => {
  resetStore();
  assert.equal(isMissingExpectedRecord(WED, TODAY, view(WED), []), true);
  const res = actions.addFalta(WED);
  assert.equal(res.ok, true, res.error);
  const faltas = getAppData().faltas;
  assert.equal(isMissingExpectedRecord(WED, TODAY, view(WED, [], faltas), faltas), false);
  const card = srcOf("src/components/day-card.tsx");
  assert.ok(card.includes("Registrar falta"));
  assert.ok(card.includes("onRegisterFalta"));
});

console.log(`\nPREENCHER DIA — OK (${passed} testes)`);
