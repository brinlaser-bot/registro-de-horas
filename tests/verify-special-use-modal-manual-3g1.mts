/**
 * VERIFICAÇÃO — CORREÇÃO PONTUAL 3G.1: RESTANTE NO MODO MANUAL DO [10+].
 *
 * BUG: no modal "Completar jornada com [10+] → Manual", o indicador
 * "Ainda pode completar neste dia" mostrava o restante ANTES da seleção
 * (view.remainingMinutes) mesmo depois de o usuário selecionar origens —
 * ex.: need 30 + selecionado 30 continuava mostrando "30min".
 *
 * CORREÇÃO (derivação de apresentação, sem fórmula financeira paralela):
 *   remainingAfterSelection = max(remainingMinutes − selectedTotal, 0)
 * onde remainingMinutes é o MESMO valor já derivado pelo day-view
 * (special-excess-day-view) e selectedTotal é a soma das seleções do
 * formulário. A projeção (motor 3A) não é alterada.
 *
 * Casos A–H (need = restante antes da nova seleção):
 *   A. 30/0 → 30 · B. 30/15 → 15 · C. 30/30 → 0 + "completa a jornada"
 *   D. 60/30 → 30 · E. 60/60 → 0 · F/G. reagir a desmarcar/alterar
 *   H. nunca negativo
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-use-modal-manual-3g1.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { manualRemainingAfterSelection } from "../src/components/special-excess-use-modal.tsx";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { formatMinutes } from "../src/lib/time.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

function resetSeed() {
  const seed = buildSeedData();
  actions.replaceAll({
    user: seed.user,
    entries: seed.entries,
    compensations: seed.compensations,
    absences: seed.absences,
    companyCalendars: seed.companyCalendars,
    faltas: seed.faltas,
    excessReasons: seed.excessReasons,
    specialExcessUses: seed.specialExcessUses ?? [],
  });
}

function dayViewOf(date: string) {
  const d = getAppData();
  return buildSpecialExcessDayView({
    date,
    asOfDate: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate ?? null,
    uses: d.specialExcessUses ?? [],
  });
}

/** A correção 3G.1 (commit fixado) não pode ter tocado estes arquivos. */
const FIX_SHA = "0775e6a1dbfac96015d6f1d85aff043add71342e";
function changedInFix(rel: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", `${FIX_SHA}~1`, FIX_SHA, "--", rel], { cwd: root });
    return false;
  } catch {
    return true;
  }
}

/* ── Casos A–E: a derivação pura sobre o restante do day-view ────────── */

check("A. need 30, selecionado 0 → ainda pode completar 30min", () => {
  assert.equal(manualRemainingAfterSelection(30, 0), 30);
  assert.equal(formatMinutes(manualRemainingAfterSelection(30, 0)), "30min");
});

check("B. need 30, selecionado 15 → ainda pode completar 15min", () => {
  assert.equal(manualRemainingAfterSelection(30, 15), 15);
});

check("C. need 30, selecionado 30 → restante 0 (a seleção completa a jornada)", () => {
  assert.equal(manualRemainingAfterSelection(30, 30), 0);
});

check("D. need 60, selecionado 30 → ainda pode completar 30min", () => {
  assert.equal(manualRemainingAfterSelection(60, 30), 30);
});

check("E. need 60, selecionado 60 → restante 0", () => {
  assert.equal(manualRemainingAfterSelection(60, 60), 0);
});

check("F/G. derivação reage ao estado do formulário (desmarcar/alterar quantidade)", () => {
  // F: desmarcar origem → selectedTotal cai → restante sobe IMEDIATAMENTE
  //    (recalculado a cada render a partir de manualSel, sem cache):
  assert.equal(manualRemainingAfterSelection(30, 30), 0);
  assert.equal(manualRemainingAfterSelection(30, 0), 30, "desmarcou tudo → volta a 30");
  // G: alterar quantidade → restante acompanha o novo total:
  assert.equal(manualRemainingAfterSelection(60, 45), 15);
  assert.equal(manualRemainingAfterSelection(60, 30), 30);
});

check("H. nunca negativo (seleção acima da necessidade é travada em 0)", () => {
  assert.equal(manualRemainingAfterSelection(30, 45), 0);
  assert.equal(manualRemainingAfterSelection(0, 10), 0);
  for (const selected of [0, 5, 15, 30, 45, 60, 120]) {
    const r = manualRemainingAfterSelection(30, selected);
    assert.ok(r >= 0, `restante ${r} nunca é negativo`);
    assert.ok(r <= 30, "restante nunca excede a necessidade");
  }
});

/* ── Integração: need vem do MESMO day-view que o modal consome ──────── */

resetSeed();

check("Integração. restante + seleção reproduzem o cenário do bug (24/08: 30/0 e 30/30)", () => {
  const view = dayViewOf("2026-08-24");
  assert.equal(view.remainingMinutes, 30, "need antes da seleção (cenário do bug: 7h30 → 30min)");
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 0), 30, "sem seleção: 30min (comportamento correto preservado)");
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 30), 0, "28/08→30min selecionado: restante 0 (BUG corrigido)");
  assert.equal(view.maxUsableMinutes, 30);
});

resetSeed();

check("Integração. dia com uso parcial (26/08 após uso de 30): restante reagrupa corretamente", () => {
  assert.ok(
    actions.createSpecialExcessUse({
      destinationDate: "2026-08-26",
      minutes: 30,
      allocationStrategy: "fifo",
      asOfDate: ASOF,
      now: 1000,
    }).ok,
  );
  const view = dayViewOf("2026-08-26");
  assert.equal(view.remainingMinutes, 30, "faltam 30min após o primeiro uso");
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 15), 15);
  assert.equal(manualRemainingAfterSelection(view.remainingMinutes, 30), 0);
});

/* ── Estrutural: modal usa a derivação e a mensagem de jornada completa ── */

check("Modal. rodapé manual usa manualRemainingAfterSelection + mensagem 'Esta seleção completa a jornada.'", () => {
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(
    modal.includes("manualRemainingAfterSelection(view.remainingMinutes, manualTotal)"),
    "derivação aplicada no rodapé manual",
  );
  assert.ok(
    !modal.includes('{formatMinutes(view.remainingMinutes)}</b>\n              </span>\n            </div>'),
    "valor antigo (sem descontar a seleção) removido",
  );
  assert.ok(modal.includes("Esta seleção completa a jornada."), "mensagem quando a seleção completa a jornada");
  assert.ok(modal.includes("Math.max(0, remainingMinutes - selectedTotal)"), "nunca negativo (max 0)");
  assert.ok(modal.includes("projectRealizedDayOfficial"), "projeção segue no motor 3A (intocada)");
});

check("Escopo. motores/banco/reconciliação/store/seed fora do diff desta correção", () => {
  const dayView = src("src/lib/special-excess-day-view.ts");
  assert.ok(
    dayView.includes("const remainingMinutes = Math.max(neededMinutes - usedActiveMinutes, 0);"),
    "day-view inalterado (fonte do need)",
  );
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(!modal.includes("neededToBase"), "sem fórmula de need paralela no modal");
  for (const f of [
    "src/lib/special-excess-bank.ts",
    "src/lib/special-excess-use.ts",
    "src/lib/official-projection.ts",
    "src/lib/special-excess-reconciliation.ts",
    "src/lib/store.ts",
  ]) {
    assert.equal(changedInFix(f), false, `${f} não foi alterado na correção 3G.1`);
  }
});

console.log(`\n${passed} verificações 3G.1 passaram.`);
