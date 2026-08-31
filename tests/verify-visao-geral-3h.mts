/**
 * VERIFICAÇÃO — ETAPA 3H: COERÊNCIA NA VISÃO GERAL ANTES DO PLANEJAMENTO [10+].
 *
 * Correção 01 — BANCO [10+]: o bloco "Banco de horas" exibia o excedente
 * GERADO (legado) como valor principal, sugerindo disponibilidade maior que
 * a real. Agora o valor principal é o DISPONÍVEL do banco anual do ciclo
 * (fonte canônica 3C — buildSpecialExcessBank, a mesma do Resumo e da
 * reconciliação 3G/3G.4), com "gerado · utilizado" como secundária.
 *
 * Correção 02 — DIAS RECENTES: a lista mostrava "ok" genérico e "+0min"
 * para dia inválido. Agora usa a classificação CANÔNICA (buildResumoDayRow
 * — a mesma de Registros/Resumo): Registro incompleto/inconsistente com
 * saldo neutro "—", "Abaixo da base" para dia válido abaixo da base (mesmo
 * com [10+] aplicado — a projeção NÃO reescreve o factual), "Dia ok" apenas
 * para dia válido, e o chip [10+] preservado no excesso.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-visao-geral-3h.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildResumoDayRow, resumoEventKind, resumoFinancialFrozen } from "../src/lib/resumo-days.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { recentDayStatusOf } from "../src/app/(app)/page.tsx";
import { getAnnualPointCycle } from "../src/lib/periods.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";
const DEST_CYCLE = getAnnualPointCycle(ASOF);

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

const d = () => getAppData();

function bank() {
  const dd = d();
  return buildSpecialExcessBank({
    cycle: DEST_CYCLE,
    asOfDate: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? "",
    uses: dd.specialExcessUses ?? [],
  });
}

function rowOf(date: string) {
  const dd = d();
  return buildResumoDayRow({
    date,
    today: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
  });
}

const punchId = (date: string, time: string): number => {
  const e = d().entries.find((x) => x.date === date && x.time === time);
  assert.ok(e, `batida ${date} ${time} presente`);
  return e.id;
};

/* ════════ TESTE 01 — Banco anual 70/60/10 → principal = 10min ════════ */

resetSeed();
// zera 20/08 (gerava 60) SEM usos → só a geração muda
assert.ok(actions.updateEntry(punchId("2026-08-20", "19:00"), { time: "16:00" }, { now: 10 }).ok);
// usos FIFO (gate persistente limita cada destino à sua necessidade):
// 26/08 usa 30 (18/08) + 24/08 usa 30 (18/08 10 + 28/08 20) = 1h utilizado
assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 900 }).ok);
assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("TESTE 01 DE 8. banco anual 1h10 gerado · 1h utilizado · 10min disponível (fonte 3C)", () => {
  const b = bank();
  assert.deepEqual([b.generatedMinutes, b.usedMinutes, b.availableMinutes], [70, 60, 10]);
  // a fonte canônica é a MESMA do Resumo/3G (3C) — nada de engine legado no valor:
  const card = src("src/components/hour-bank-card.tsx");
  assert.ok(card.includes("buildSpecialExcessBank"), "fonte canônica 3C no componente");
  assert.ok(card.includes("BANCO [10+] DISPONÍVEL"), "valor principal = disponível");
  assert.ok(card.includes("value={formatMinutes(specialBank.availableMinutes)}"), "principal = availableMinutes");
  assert.ok(card.includes(`${"${formatMinutes(specialBank.generatedMinutes)}"} gerado · ${"${formatMinutes(specialBank.usedMinutes)}"} utilizado`.replaceAll("${", "${")), "secundária gerado · utilizado");
  assert.ok(!card.includes("value={formatMinutes(bank.excessSpecialFreeTotal)}"), "valor antigo (legado) removido do principal");
});

/* ════════ TESTE 02 — cancelar o uso → 1h10 disponível, mesma fonte ════════ */

check("TESTE 02 DE 8. cancelar os usos (1h total) → disponível 1h10 SEM matemática paralela", () => {
  for (const u of d().specialExcessUses ?? []) {
    assert.ok(actions.cancelSpecialExcessUse({ id: u.id, now: 2000 }).ok);
  }
  const b = bank();
  assert.deepEqual([b.generatedMinutes, b.usedMinutes, b.availableMinutes], [70, 0, 70], "1h10 disponível");
  // o componente NÃO recalcula (nenhum "gerado - utilizado" escrito na UI):
  const card = src("src/components/hour-bank-card.tsx");
  assert.ok(!/generatedMinutes\s*-\s*usedMinutes/.test(card), "sem subtração paralela no componente");
  assert.ok(!card.includes("excessSpecialFreeTotal"), "métrica legado fora do bloco [10+]");
});

/* ════════ TESTE 03 — dia INCOMPLETO em Dias recentes ════════ */

resetSeed();

check("TESTE 03 DE 8. 27/08 incompleto: não é 'ok', mostra 'Registro incompleto' e saldo neutro '—'", () => {
  const row = rowOf("2026-08-27");
  assert.equal(row.status, "incomplete");
  assert.equal(resumoEventKind(row), "Registro incompleto");
  assert.ok(resumoFinancialFrozen(row), "financeiro congelado");
  assert.equal(row.workedMinutes, 240, "4h registradas continuam visíveis (fato)");
  const st = recentDayStatusOf(row);
  assert.deepEqual(st, { label: "Registro incompleto", tone: "amber" });
  assert.notEqual(st.label, "Dia ok");
  // a lista renderiza "—" quando congelado (nunca +0min definitivo):
  const page = src("src/app/(app)/page.tsx");
  const list = page.slice(page.indexOf('{/* Dias recentes */}'), page.indexOf("<CompensationForm"));
  assert.ok(list.includes("resumoFinancialFrozen"), "gate de congelamento na lista");
  assert.ok(list.includes('text-slate-300">—</span>'), "saldo neutro '—' para dia inválido");
});

/* ════════ TESTE 04 — dia válido ABAIXO DA BASE ════════ */

check("TESTE 04 DE 8. 24/08 (7h30/-30min): 'Abaixo da base' — nunca 'ok'", () => {
  const row = rowOf("2026-08-24");
  assert.equal(row.status, "deficit");
  assert.equal(resumoFinancialFrozen(row), false, "dia válido: saldo definido");
  assert.equal(row.balanceMinutes, -30);
  const st = recentDayStatusOf(row);
  assert.deepEqual(st, { label: "Abaixo da base", tone: "amber" });
  assert.notEqual(st.label, "Dia ok");
});

/* ════════ TESTE 05 — ABAIXO DA BASE com [10+] aplicado (projeção completa) ════════ */

assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 3000 }).ok);

check("TESTE 05 DE 8. 26/08 (7h/-1h) com [10+] 1h: continua 'Abaixo da base' — projeção não reescreve", () => {
  const row = rowOf("2026-08-26");
  assert.equal(row.status, "deficit", "factual permanece");
  assert.equal(row.workedMinutes, 420, "trabalhado factual 7h intacto");
  assert.equal(row.balanceMinutes, -60, "saldo factual -1h intacto");
  const st = recentDayStatusOf(row);
  assert.equal(st.label, "Abaixo da base");
  assert.notEqual(st.label, "Dia ok");
  // a projeção com o uso ativo é 8h/0 — e NÃO aparece na lista como estado:
  assert.equal(bank().usedMinutes, 60);
});

/* ════════ TESTE 06 — dia normal de 8h ════════ */

check("TESTE 06 DE 8. 25/08 (8h/0): 'Dia ok'", () => {
  const row = rowOf("2026-08-25");
  assert.equal(row.status, "ok");
  assert.equal(row.balanceMinutes, 0);
  assert.deepEqual(recentDayStatusOf(row), { label: "Dia ok", tone: "emerald" });
});

/* ════════ TESTE 07 — dia válido 9h30 (+1h30) ════════ */

assert.ok(actions.updateEntry(punchId("2026-08-25", "17:00"), { time: "18:30" }, { now: 4000 }).ok);

check("TESTE 07 DE 8. 25/08 (9h30/+1h30): continua dia válido/ok com saldo positivo", () => {
  const row = rowOf("2026-08-25");
  assert.equal(row.workedMinutes, 570, "9h30");
  assert.equal(row.balanceMinutes, 90, "+1h30");
  assert.equal(row.status, "ok", "9h30 < 10h: segue dia válido");
  assert.deepEqual(recentDayStatusOf(row), { label: "Dia ok", tone: "emerald" });
});

/* ════════ TESTE 08 — dia ACIMA DE 10h preserva [10+] ════════ */

check("TESTE 08 DE 8. 28/08 (10h30/+2h/[10+] 30min): chip [10+] preservado, nunca 'ok' plano", () => {
  const row = rowOf("2026-08-28");
  assert.equal(row.status, "excess");
  assert.equal(row.balanceMinutes, 120, "regular limitado a +2h");
  assert.equal(row.excessMinutes, 30, "[10+] gerado 30min");
  // na lista, excess é tratado ANTES do helper (chip [10+] existente):
  const page = src("src/app/(app)/page.tsx");
  const list = page.slice(page.indexOf('{/* Dias recentes */}'), page.indexOf("<CompensationForm"));
  const excessGate = list.indexOf('row.status === "excess"');
  const helperCall = list.indexOf("recentDayStatusOf(");
  assert.ok(excessGate > -1 && helperCall > excessGate, "chip [10+] avaliado antes do fallback");
  assert.ok(list.includes("<ExcessTenBadge />"), "identificação [10+] preservada");
  // o "ok" genérico antigo foi removido:
  assert.ok(!list.includes('<Badge tone="slate">ok</Badge>'), "sem 'ok' genérico para todo dia sem excesso");
});

/* ════════ Estrutural: fonte única + responsividade preservada ════════ */

check("Estrutural. classificação canônica única (buildResumoDayRow) alimentando Dias recentes", () => {
  const page = src("src/app/(app)/page.tsx");
  assert.ok(page.includes("buildResumoDayRow({"), "classificação central no memo dos recentes");
  assert.ok(page.includes("export function recentDayStatusOf"), "helper puro reutilizável/testável");
  assert.ok(!page.includes('"Jornada abaixo do previsto"'), "sem vocabulário paralelo na Visão Geral");
  // Row ganhou sub-linha discreta (mobile: flex-wrap existente preservado)
  const card = src("src/components/hour-bank-card.tsx");
  assert.ok(card.includes("sub?: React.ReactNode"), "sub-linha opcional no Row");
  assert.ok(card.includes("mt-0.5 text-[11px] font-medium text-slate-500"), "secundária discreta");
});

console.log(`\n${passed} verificações 3H passaram.`);
