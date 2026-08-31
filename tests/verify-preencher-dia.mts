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
  FILL_SAIDA_MSG,
  fillDayPreview,
  fillDayPunches,
  fillDayUiState,
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
  assert.ok(modal.includes("specialActions.addEntries(v.punches)"), "3G: preencher dia passa pelo gate central de [10+]");
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

const untouched = [{ entrada: false, saida: false }];
const bothTouched = [{ entrada: true, saida: true }];

check("20. modal recém-aberto: Salvar desabilitado e sem mensagem agressiva", () => {
  const ui = fillDayUiState(WED, [{ entrada: "", saida: "" }], untouched);
  assert.equal(ui.canSave, false);
  assert.equal(ui.formError, null);
  assert.equal(ui.periodErrors[0]?.entrada, undefined);
  assert.equal(ui.periodErrors[0]?.saida, undefined);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("disabled={busy || !canSave}"));
  assert.ok(modal.includes("fillDayUiState"));
});

check("21. somente Entrada preenchida: botão continua desabilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "" }], [{ entrada: true, saida: false }]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.periodErrors[0]?.saida, undefined, "Saída ainda não tocada: sem mensagem");
});

check("22. somente Saída preenchida: botão continua desabilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "", saida: "17:00" }], [{ entrada: false, saida: true }]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.periodErrors[0]?.entrada, undefined);
});

check("23. 17:00→08:00: mensagem aparece sem clicar em Salvar", () => {
  const ui = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(ui.periodErrors[0]?.saida, FILL_ORDER_MSG);
  assert.equal(validateFillDaySave(WED, [{ entrada: "17:00", saida: "08:00" }]).error, FILL_ORDER_MSG);
});

check("24. 17:00→08:00: botão Salvar desabilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(ui.canSave, false);
});

check("25. corrigir para 17:00→18:00: erro some e Salvar habilita", () => {
  const bad = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(bad.canSave, false);
  const ok = fillDayUiState(WED, [{ entrada: "17:00", saida: "18:00" }], bothTouched);
  assert.equal(ok.canSave, true);
  assert.equal(ok.periodErrors[0]?.saida, undefined);
  assert.equal(ok.formError, null);
  const p = fillDayPreview([{ entrada: "17:00", saida: "18:00" }], S);
  assert.ok(p.stay > 0);
});

check("26. 08:00→17:00: botão habilitado e prévia 9h / 1h / 8h", () => {
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "17:00" }], bothTouched);
  assert.equal(ui.canSave, true);
  assert.equal(ui.formError, null);
  const p = fillDayPreview([{ entrada: "08:00", saida: "17:00" }], S);
  assert.equal(p.stay, 540);
  assert.equal(p.autoBreak, 60);
  assert.equal(p.net, 480);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("canSave && preview.stay > 0"));
});

check("27. períodos sobrepostos: mensagem reativa e Salvar desabilitado", () => {
  const periods = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "11:30", saida: "17:00" },
  ];
  const ui = fillDayUiState(WED, periods, [bothTouched[0], bothTouched[0]]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.formError, FILL_OVERLAP_MSG);
});

check("28. corrigir sobreposição: erro some e Salvar habilita", () => {
  const fixed = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "13:00", saida: "17:00" },
  ];
  const ui = fillDayUiState(WED, fixed, [bothTouched[0], bothTouched[0]]);
  assert.equal(ui.canSave, true);
  assert.equal(ui.formError, null);
});

check("29. cancelar/X continua sem persistir nada", () => {
  resetStore();
  fillDayUiState(WED, [{ entrada: "08:00", saida: "17:00" }], bothTouched);
  assert.equal(getAppData().entries.length, 0);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("onClose"));
  assert.ok(modal.includes('aria-label="Remover período"') || modal.includes("Cancelar"));
});

check("30. submit válido continua atômico", () => {
  resetStore();
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "17:00" }], bothTouched);
  assert.equal(ui.canSave, true);
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(v.punches?.length, 2);
  const res = actions.addEntries(v.punches!);
  assert.equal(res.ok, true, res.error);
  assert.equal(getAppData().entries.filter((e) => e.date === WED).length, 2);
  const modal = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(modal.includes("validateFillDaySave(date, periods)"));
  assert.ok(modal.includes("specialActions.addEntries(v.punches)"), "3G: preencher dia passa pelo gate central de [10+]");
});

check("31. nenhuma regressão no filtro ?semRegistro=1", () => {
  const reg = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes('searchParams.get("semRegistro") === "1"'));
  assert.ok(reg.includes("wantMissing && missingCount === 0"));
  resetStore();
  assert.equal(missingExpectedRecordDates(TWO, TODAY, [], [], cals, S, []).length, 2);
  const v = validateFillDaySave(THU, [{ entrada: "08:00", saida: "17:00" }]);
  actions.addEntries(v.punches!);
  assert.equal(missingExpectedRecordDates(TWO, TODAY, getAppData().entries, [], cals, S, []).length, 1);
});

check("32. Saída tocada e vazia mostra Informe a hora de saída", () => {
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "" }], [{ entrada: true, saida: true }]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.periodErrors[0]?.saida, FILL_SAIDA_MSG);
});

console.log(`\nPREENCHER DIA — OK (${passed} testes)`);
