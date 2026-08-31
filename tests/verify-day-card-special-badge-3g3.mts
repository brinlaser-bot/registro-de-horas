/**
 * VERIFICAÇÃO — CORREÇÃO PONTUAL 3G.3: DESTACAR [10+] APLICADO NO CARD DO DIA.
 *
 * Problema: o card de Registros não indicava no CABEÇALHO que o dia possuía
 * [10+] aplicado — o usuário via só "Abaixo da base / 7h30 / -30min" e podia
 * interpretar que o dia não tinha nenhuma decisão.
 *
 * CORREÇÃO (apenas apresentação):
 *  - badge violeta "[10+] aplicado · N" no cabeçalho do card, derivado
 *    DIRETAMENTE dos usos ativos (SpecialExcessDayView.usedActiveMinutes,
 *    motores 3A/3C) a cada render — sem estado visual persistido;
 *  - bloco expandido ganha "Projeção completada com [10+]" SOMENTE quando o
 *    uso total zera a necessidade (remainingMinutes === 0);
 *  - o factual NUNCA muda: status continua "Abaixo da base", saldo intacto.
 *
 * Casos: A sem uso → sem badge · B -30+30 → badge 30min · C parcial → sem
 * "completada" · D total → "Projeção completada" · E cancelar → badge some ·
 * F factual "Abaixo da base" · G saldo intacto · H destaque no cabeçalho ·
 * I bloco expandido preservado · J dias sem [10+] sem regressão.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-day-card-special-badge-3g3.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildResumoDayRow, resumoEventKind } from "../src/lib/resumo-days.ts";

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

function viewOf(date: string) {
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

const card = src("src/components/day-card.tsx");
const summary = src("src/components/special-excess-use-summary.tsx");

/* ── A–G: derivação real (day-view) alimentando o badge ──────────────── */

resetSeed();

check("A. 24/08 (-30min) SEM uso: usedActiveMinutes 0 → condição do badge é falsa", () => {
  const v = viewOf("2026-08-24");
  assert.equal(v.usedActiveMinutes, 0);
  const badgeVisible = v.usedActiveMinutes > 0; // mesma condição do card
  assert.equal(badgeVisible, false, "nenhum badge [10+] sem uso ativo");
});

check("B. 24/08 (-30min) + uso manual 30min → badge '[10+] aplicado · 30min'", () => {
  assert.ok(
    actions.createSpecialExcessUse({
      destinationDate: "2026-08-24",
      allocationStrategy: "manual",
      manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
      asOfDate: ASOF,
      now: 1000,
    }).ok,
  );
  const v = viewOf("2026-08-24");
  assert.equal(v.usedActiveMinutes, 30);
  assert.equal(v.remainingMinutes, 0);
  assert.equal(v.projection?.workedMinutes, 480, "projeção 8h");
  assert.equal(v.projection?.balanceMinutes, 0, "saldo projetado 0min");
});

check("C. parcial (26/08 -1h + uso 30): badge 30min e NÃO diz 'completada'", () => {
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1100 }).ok);
  const v = viewOf("2026-08-26");
  assert.equal(v.usedActiveMinutes, 30);
  assert.equal(v.remainingMinutes, 30, "restam 30min (uso PARCIAL)");
  assert.equal(v.projection?.workedMinutes, 450, "projeção 7h30");
  assert.equal(v.projection?.balanceMinutes, -30);
  // a linha "Projeção completada" é gated por remainingMinutes === 0:
  const showsCompleted = v.remainingMinutes === 0;
  assert.equal(showsCompleted, false, "uso parcial NÃO informa projeção completada");
});

check("D. total (26/08 + uso de 1h): badge 1h e 'Projeção completada com [10+]'", () => {
  const secondUse = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1200 });
  assert.ok(secondUse.ok, `segundo uso falhou: ${secondUse.error}`);
  const v = viewOf("2026-08-26");
  assert.equal(v.usedActiveMinutes, 60);
  assert.equal(v.remainingMinutes, 0, "necessidade zerada (uso TOTAL)");
  assert.equal(v.projection?.workedMinutes, 480, "projeção 8h");
  assert.equal(v.projection?.balanceMinutes, 0);
  assert.equal(v.remainingMinutes === 0, true, "bloco expandido pode mostrar 'Projeção completada com [10+]'");
});

check("E. cancelar o uso → usedActiveMinutes 0 → badge desaparece no próximo render", () => {
  const uses = getAppData().specialExcessUses ?? [];
  for (const u of uses.filter((x) => x.destinationDate === "2026-08-24")) {
    const res = actions.cancelSpecialExcessUse({ id: u.id, now: 1300 });
    assert.ok(res.ok);
  }
  const v = viewOf("2026-08-24");
  assert.equal(v.usedActiveMinutes, 0, "derivação direta: sem uso ativo, sem destaque");
  assert.equal(v.usedActiveMinutes > 0, false, "condição do badge falsa de novo");
  assert.ok(v.activeUses.every((u) => u.status === "cancelado"), "histórico preservado como cancelado");
});

check("F. factual NUNCA muda: 24/08 continua 'Jornada abaixo do previsto' (Abaixo da base)", () => {
  const d = getAppData();
  const v = viewOf("2026-08-24");
  assert.equal(v.eligible, true, "segue elegível/abaixo da base");
  assert.equal(v.factualBalanceMinutes, -30, "saldo factual intacto (G)");
  assert.equal(v.workedMinutes, 450, "trabalhado factual intacto");
  // status factual do Resumo para o dia (fonte do badge de situação do card):
  const kind = resumoEventKind(
    buildResumoDayRow({
      date: "2026-08-24",
      today: ASOF,
      entries: d.entries,
      absences: d.absences,
      calendars: d.companyCalendars,
      settings: settingsOf(d.user),
      faltas: d.faltas,
      controlStartDate: d.user.controlStartDate ?? null,
    }),
  );
  assert.equal(kind, "Jornada abaixo do previsto", "status factual permanece — sem 'Dia ok/Quitado/Compensado'");
});

/* ── H–J: estrutura do card ──────────────────────────────────────────── */

check("H. badge está no CABEÇALHO do card (antes do corpo expandível) e mostra '[10+] aplicado ·'", () => {
  const header = card.slice(card.indexOf("{/* Cabeçalho */}"), card.indexOf("{expanded && ("));
  assert.ok(header.includes("[10+] aplicado ·"), "destaque no cabeçalho/recolhido");
  assert.ok(header.includes("specialExcess.usedActiveMinutes > 0"), "condição: somente com uso ativo");
  assert.ok(header.includes('tone="violet"'), "chip violeta coerente com a identidade [10+]");
  assert.ok(header.includes("formatMinutes(specialExcess.usedActiveMinutes)"), "minutos derivados dos usos ativos");
});

check("I. bloco EXPANDIDO preservado + 'Projeção completada com [10+]' apenas no uso total", () => {
  assert.ok(card.includes("<SpecialExcessUseSummary"), "bloco detalhado atual mantido");
  assert.ok(summary.includes("Projeção completada com [10+]"), "linha nova no bloco expandido");
  assert.ok(summary.includes("view.remainingMinutes === 0"), "gated pelo uso TOTAL (parcial não mostra)");
  assert.ok(summary.includes("[10+] utilizado:"), "linha agregada original preservada");
  assert.ok(summary.includes("Origem:"), "detalhe por uso preservado");
  assert.ok(summary.includes("Cancelar uso"), "cancelamento individual preservado");
});

check("J. dias sem [10+] não sofrem regressão (condição exige uso ativo; nada de espaço vazio)", () => {
  // mesmo gate do card: sem uso ativo → nenhum elemento extra renderizado
  const v = viewOf("2026-08-24"); // uso cancelado no teste E
  assert.equal(v.usedActiveMinutes > 0, false);
  // e a derivação de um dia qualquer sem uso também é falsa:
  resetSeed();
  assert.equal(viewOf("2026-08-25").usedActiveMinutes, 0, "25/08 (dia ok) nunca ganha badge");
  assert.equal(viewOf("2026-08-24").usedActiveMinutes, 0, "24/08 sem uso não ganha badge");
});


/** A correção 3G.3 (commit fixado) não pode ter tocado estes arquivos. */
const FIX_SHA = "0f85f4ffee97d300171cdf9ce2c6110bb90325ce";
function changedInFix(rel: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", `${FIX_SHA}~1`, FIX_SHA, "--", rel], { cwd: root });
    return false;
  } catch (e) {
    if (e instanceof ReferenceError) throw e; // não engolir TDZ
    return true;
  }
}

check("Escopo. nenhuma mudança em motores/store/seed nesta correção", () => {
  for (const f of [
    "src/lib/special-excess-day-view.ts",
    "src/lib/special-excess-use.ts",
    "src/lib/official-projection.ts",
    "src/lib/special-excess-reconciliation.ts",
    "src/lib/store.ts",
    "src/lib/seed-data.ts",
    "src/components/special-excess-use-modal.tsx",
  ]) {
    assert.equal(changedInFix(f), false, `${f} fora do diff da correção 3G.3`);
  }
});

/* ── helpers ─────────────────────────────────────────────────────────── */


console.log(`\n${passed} verificações 3G.3 passaram.`);
