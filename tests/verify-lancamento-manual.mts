/**
 * Validação reativa do modal Adicionar registro manual (Horário trabalhado).
 * Reusa fillDayUiState / validateFillDaySave — a mesma fonte do
 * Preencher registros do dia.
 * TZ=America/Sao_Paulo npx tsx tests/verify-lancamento-manual.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FILL_DUPLICATE_MSG,
  FILL_ORDER_MSG,
  FILL_OVERLAP_MSG,
  FILL_SAIDA_MSG,
  fillDayPreview,
  fillDayUiState,
  validateFillDaySave,
} from "../src/lib/fill-day-records.ts";
import { stayAndNetMinutes } from "../src/lib/breaks.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { DEFAULT_USER } from "../src/lib/seed-data.ts";
import { computeDay } from "../src/lib/time.ts";
import type { TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

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
const untouched = [{ entrada: false, saida: false }];
const bothTouched = [{ entrada: true, saida: true }];

function resetStore(entries: TimeEntry[] = []) {
  actions.replaceAll({
    user, entries, compensations: [], absences: [], companyCalendars: cals, faltas: [], excessReasons: [],
  });
}

check("1. Horário trabalhado vazio: Adicionar registros desabilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "", saida: "" }], untouched);
  assert.equal(ui.canSave, false);
  assert.equal(ui.formError, null);
  assert.equal(ui.periodErrors[0]?.entrada, undefined);
  assert.equal(ui.periodErrors[0]?.saida, undefined);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("fillDayUiState"));
  assert.ok(modal.includes("disabled={busy || !canSave}"));
  assert.ok(modal.includes("aria-disabled={busy || !canSave}"));
  assert.ok(modal.includes("Adicionar registros"));
});

check("2. somente Entrada: botão continua desabilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "" }], [{ entrada: true, saida: false }]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.periodErrors[0]?.saida, undefined, "Saída ainda não tocada: sem mensagem");
});

check("3. Saída tocada e vazia mostra Informe a hora de saída", () => {
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "" }], [{ entrada: true, saida: true }]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.periodErrors[0]?.saida, FILL_SAIDA_MSG);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("error={errs.saida}"));
  assert.ok(modal.includes("error={errs.entrada}"));
});

check("4. 17:00→08:00: mensagem aparece sem submit", () => {
  const ui = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(ui.periodErrors[0]?.saida, FILL_ORDER_MSG);
  assert.equal(validateFillDaySave(WED, [{ entrada: "17:00", saida: "08:00" }]).error, FILL_ORDER_MSG);
});

check("5. 17:00→08:00: botão Adicionar registros desabilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(ui.canSave, false);
});

check("6. corrigir para 17:00→18:00: mensagem some e botão habilita", () => {
  const bad = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(bad.canSave, false);
  const ok = fillDayUiState(WED, [{ entrada: "17:00", saida: "18:00" }], bothTouched);
  assert.equal(ok.canSave, true);
  assert.equal(ok.periodErrors[0]?.saida, undefined);
  assert.equal(ok.formError, null);
});

check("7. 08:00→17:00: sequência válida e botão habilitado", () => {
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "17:00" }], bothTouched);
  assert.equal(ui.canSave, true);
  assert.equal(ui.formError, null);
  const p = fillDayPreview([{ entrada: "08:00", saida: "17:00" }], S);
  assert.equal(p.stay, 540);
  assert.equal(p.autoBreak, 60);
  assert.equal(p.net, 480);
  const stay = stayAndNetMinutes([{ entrada: "08:00", saida: "17:00" }], S, "periodo");
  assert.equal(stay.stay, 540);
  assert.equal(stay.autoBreak, 60);
  assert.equal(stay.net, 480);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("canSave && stayNet.stay > 0 && mode === \"periodo\""));
  assert.ok(modal.includes("Permanência neste período"));
  assert.ok(modal.includes("Trabalho líquido estimado"));
});

check("8. dois períodos sobrepostos: mensagem inline e botão desabilitado", () => {
  const periods = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "11:30", saida: "17:00" },
  ];
  const ui = fillDayUiState(WED, periods, [bothTouched[0], bothTouched[0]]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.formError, FILL_OVERLAP_MSG);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes('role="alert"'));
  assert.ok(modal.includes("ui.formError"));
});

check("9. corrigir sobreposição: erro some e botão habilita", () => {
  const fixed = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "13:00", saida: "17:00" },
  ];
  const ui = fillDayUiState(WED, fixed, [bothTouched[0], bothTouched[0]]);
  assert.equal(ui.canSave, true);
  assert.equal(ui.formError, null);
});

check("10. erro de validação inline não depende de toast", () => {
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("fillDayUiState"));
  assert.ok(modal.includes("validateFillDaySave(date, periods)"));
  assert.ok(modal.includes("if (!v.ok) return;"));
  const orderToast = modal.indexOf('toast.show("A hora de saída deve ser depois da entrada."');
  const intervaloBranch = modal.indexOf('mode === "intervalo"');
  assert.ok(orderToast === -1 || orderToast > intervaloBranch, "toast de ordem só no fluxo Intervalo");
  const submitGuard = modal.indexOf("if (mode === \"periodo\" && !canSave) return;");
  assert.ok(submitGuard >= 0, "submit de Horário trabalhado não dispara com formulário inválido");
});

check("11. submit válido continua funcionando normalmente", () => {
  resetStore();
  const ui = fillDayUiState(WED, [{ entrada: "08:00", saida: "17:00" }], bothTouched);
  assert.equal(ui.canSave, true);
  const v = validateFillDaySave(WED, [{ entrada: "08:00", saida: "17:00" }]);
  assert.equal(v.ok, true);
  assert.equal(v.punches?.length, 2);
  const res = actions.addEntries([
    { date: WED, time: "08:00", type: "entrada", note: null, source: "manual" },
    { date: WED, time: "17:00", type: "saida", note: null, source: "manual" },
  ]);
  assert.equal(res.ok, true, res.error);
  const dayEntries = getAppData().entries.filter((e) => e.date === WED).sort((a, b) => a.time.localeCompare(b.time));
  assert.equal(dayEntries.length, 2);
  const day = computeDay(dayEntries, S);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.canFinalizeFinancialDay, true);
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("specialActions.addEntries(punches)"), "3G: lançamento manual passa pelo gate central de [10+]");
  assert.ok(modal.includes("onClose()"));
});

check("12. Preencher registros do dia permanece com a mesma validação", () => {
  const fill = srcOf("src/components/fill-day-records-modal.tsx");
  assert.ok(fill.includes("fillDayUiState"));
  assert.ok(fill.includes("validateFillDaySave(date, periods)"));
  assert.ok(fill.includes("Salvar registros do dia"));
  assert.ok(fill.includes("disabled={busy || !canSave}"));
  const empty = fillDayUiState(WED, [{ entrada: "", saida: "" }], untouched);
  assert.equal(empty.canSave, false);
  assert.equal(empty.formError, null);
  const order = fillDayUiState(WED, [{ entrada: "17:00", saida: "08:00" }], bothTouched);
  assert.equal(order.canSave, false);
  assert.equal(order.periodErrors[0]?.saida, FILL_ORDER_MSG);
  const ok = fillDayUiState(WED, [{ entrada: "08:00", saida: "17:00" }], bothTouched);
  assert.equal(ok.canSave, true);
});

check("13. horários duplicados usam a mensagem compartilhada", () => {
  const periods = [
    { entrada: "08:00", saida: "12:00" },
    { entrada: "12:00", saida: "17:00" },
  ];
  const ui = fillDayUiState(WED, periods, [bothTouched[0], bothTouched[0]]);
  assert.equal(ui.canSave, false);
  assert.equal(ui.formError, FILL_DUPLICATE_MSG);
});

check("14. modal Horário trabalhado reusa a mesma fonte, sem lógica paralela", () => {
  const modal = srcOf("src/components/manual-entry-modal.tsx");
  assert.ok(modal.includes("from \"@/lib/fill-day-records\""));
  assert.ok(modal.includes("fillDayUiState(date, periods, touched)"));
  assert.ok(!modal.includes("Informe entrada e saída de cada período.") || modal.includes('mode === "intervalo"'));
  void TODAY;
});

resetStore();
console.log(`\nLANÇAMENTO MANUAL — OK (${passed} testes)`);
