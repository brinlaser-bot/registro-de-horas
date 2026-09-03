/**
 * VERIFICAÇÃO — ETAPA 3E.2: LIMPEZA E PADRONIZAÇÃO VISUAL DA PÁGINA REGISTROS
 *
 * Cobre o roteiro A–U da etapa (sem reimplementar regra de negócio:
 * projeção/saldo/banco derivam dos motores 3A/3B/3C; aqui a UI só exibe):
 *
 *   A  card deficit NÃO tem bloco "Situação do déficit"
 *   B  day-card NÃO contém "Como foi quitado"
 *   C  day-card NÃO contém "Programar hora extra"
 *   D  day-card NÃO contém "Em aberto" / "Déficit quitado" / "Parcial · restam"
 *   E  dia >10h: colapsado mostra [10+] gerado; nunca "a realocar" / "Excedente tratado"
 *   F  rodapé "No ponto" factual (sem "precisam ser realocadas")
 *   G  NÃO existe formulário inline de adição (showAdd / "Observação (opcional)" no card)
 *   H  "Adicionar batida" abre o MESMO modal moderno já existente (CorrectPunchesModal)
 *   I  registro incompleto (27/08) → MESMO caminho de modal (sem gate especial)
 *   J  dia com déficit (24/08 / 26/08) → MESMO caminho de modal (sem gate de deficit)
 *   K  modal de batida mantém data, horário, observação, confirmar e cancelar
 *   L  modal [10+] — campo automático tem unidade "min" explícita
 *   M  modal [10+] — campos manuais têm unidade "min" explícita
 *   N  1º uso: cabeçalho sem número duplicado ("Ainda pode completar" só com uso ativo)
 *   O  uso parcial: falta original + já utilizado + ainda pode completar
 *   P  preview 2º uso diferencia "Novo uso" × "Total [10+] após confirmar"
 *   Q  projeção do preview vem do motor 3A (420 + 60 → 480 / 0)
 *   R  após uso: trabalhado/saldo factual do card seguem inalterados (motor real)
 *   S  cancelamento devolve o saldo ao banco [10+] (ação 3D real)
 *   T  nenhuma action legada de compensação no novo fluxo visual (day-card/modal/summary)
 *   U  seed 4.0 atual é suficiente para o roteiro manual
 *   V  dia incompleto/inconsistente: única ação operacional = "Corrigir registros"
 *   W  dia deficit válido (26/08) e dia ok (25/08) não sofrem regressão do gate
 *   X  o modal resolve o incompleto: a MESMA chamada do modal completa o 27/08
 *   Y  o gate não introduz action/fluxo legado novo
 *
 *   C1  dia inválido: conteúdo expandido = card de correção (gate invalidStructure)
 *   C2  batidas permanecem intactas nos dados (card de correção é só visual)
 *   C3  modal modo 'correct': título/subtexto de correção preservados
 *   C4  modal modo 'add': título 'Adicionar batida' + subtexto curto
 *   C5  banner verde genérico só no modo 'correct'; feedback específico preservado
 *   C6  batidas existentes visíveis nos dois modos (sem versão reduzida)
 *   C7  inferência intacta: 08E/12S/13E + 17:00 → 'saida' (motor)
 *   C8  fluxo completo incompleto → correção → card volta ao normal automaticamente
 *   C9  dia deficit válido (26/08): card normal — déficit ≠ registro inválido
 *   C10 'Adicionar batida' → MESMO modal em modo 'add' (1 instância no card)
 *   C11 inferência intacta: dia válido (26/08) + 17:00 → 'entrada' (motor)
 *   C12 nenhuma action duplicada no modal (addEntry/addEntries/deleteEntry = 1x)
 *   C13 sem estado persistido de 'modo correção' (gate derivado, 1 state novo)
 *   C14 cabeçalho/badge 'Pendente' do dia inválido preservado
 *
 * Executar: npx tsx tests/verify-registros-3e2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { projectRealizedDayOfficial } from "../src/lib/official-projection.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { computeDay } from "../src/lib/time.ts";
import type { TimeEntryLike } from "../src/lib/time.ts";
import { isIncompletePastPunch } from "../src/lib/compensar.ts";
import { suggestedPunchTypeAt } from "../src/lib/punches.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const dayCard = src("src/components/day-card.tsx");
const page = src("src/app/(app)/registros/page.tsx");
const correctModal = src("src/components/correct-punches-modal.tsx");
const useModal = src("src/components/special-excess-use-modal.tsx");
const summary = src("src/components/special-excess-use-summary.tsx");

const ASOF = "2026-08-30";

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── A–F: card deficit / >10h / rodapé sem linguagem legada ──── */

check("A. card deficit: sem bloco 'Situação do déficit'", () => {
  assert.ok(!dayCard.includes("Situação do déficit"));
});

check("B. day-card: sem 'Como foi quitado'", () => {
  assert.ok(!dayCard.includes("Como foi quitado"));
});

check("C. day-card: sem 'Programar hora extra'", () => {
  assert.ok(!dayCard.includes("Programar hora extra"));
});

check("D. day-card: sem 'Em aberto' / 'Déficit quitado' / 'Parcial · restam'", () => {
  assert.ok(!dayCard.includes("Em aberto"));
  assert.ok(!dayCard.includes("Déficit quitado"));
  assert.ok(!dayCard.includes("Parcial · restam"));
});

check("E. dia >10h: [10+] gerado no colapsado; nunca 'a realocar'/'Excedente tratado'", () => {
  assert.ok(!dayCard.includes("a realocar"));
  assert.ok(!dayCard.includes("A realocar"));
  assert.ok(!dayCard.includes("Excedente tratado"));
  assert.ok(dayCard.includes("[10+] +")); // header colapsado (violeta)
  assert.ok(dayCard.includes("[10+] gerado")); // métrica expandida
});

check("F. rodapé 'No ponto' factual: sem 'precisam ser realocadas'", () => {
  assert.ok(!dayCard.includes("precisam ser realocadas"));
  assert.ok(dayCard.includes("separado no banco [10+]"));
});

/* ── G–K: "Adicionar batida" unificado no modal moderno ──────── */

check("G. sem formulário inline de adição no card (showAdd removido)", () => {
  assert.ok(!dayCard.includes("showAdd"));
  assert.ok(!dayCard.includes('label="Observação (opcional)"'));
  assert.ok(!dayCard.includes("suggestedPunchTypeAt"));
});

check("H. 'Adicionar batida' abre o MESMO modal existente (CorrectPunchesModal)", () => {
  assert.ok(dayCard.includes("Adicionar batida"));
  // CTAs de correção nos banners (2, modo "correct") + botão "Adicionar batida" (1, modo "add")
  const opens = (dayCard.match(/setPunchModal\("(correct|add)"\)/g) ?? []).length;
  assert.ok(opens >= 3, `esperava >= 3 setPunchModal(...), veio ${opens}`);
  assert.ok(dayCard.includes("<CorrectPunchesModal"));
});

/**
 * I/J/V. O botão "Adicionar batida" vive no bloco do dia com registros,
 * gateado por `!missingExpected && !historicalEmpty && !incompletePast && !inconsistent`
 * (e internamente por `!futureDay && !abonoDay`). Dia incompleto/inconsistente:
 * única ação operacional = "Corrigir registros". Dia deficit VÁLIDO (24/08/26/08):
 * o gate é apenas estrutural — a ação é preservada.
 */
const addBtnSegment = (() => {
  // 4G.1 (SUPERADO — expectativa atualizada com justificativa): o bloco de
  // adição ganhou a condição !ro (consolidado = somente leitura; em card
  // consolidado NENHUM controle mutável é oferecido — os guards do motor
  // continuam sendo a defesa real).
  const start = dayCard.indexOf(
    "{!ro && !missingExpected && !historicalEmpty && !incompletePast && !inconsistent && (",
  );
  const btn = dayCard.indexOf("Adicionar batida", start);
  assert.ok(start > 0 && btn > start, "bloco do card com registros não encontrado");
  return dayCard.slice(start, btn);
})();

check("I. registro incompleto (27/08): ações de adição ocultas — só 'Corrigir registros'", () => {
  // regra V: dia incompleto esconde o bloco de adição (única ação = Corrigir registros,
  // que abre o MESMO modal — asserção do banner no check V)
  assert.ok(addBtnSegment.includes("!incompletePast"), "gate de incompleto esconde as ações de adição");
  assert.ok(!/punchPending/.test(addBtnSegment));
});

check("J. dia com déficit válido (24/08/26/08): 'Adicionar batida' preservada (gate só estrutural)", () => {
  assert.ok(!/deficit/i.test(addBtnSegment), "gate não referencia deficit");
  assert.ok(!/specialExcess/.test(addBtnSegment), "gate não referencia [10+]");
  assert.ok(!/shortcuts/i.test(addBtnSegment), "gate não referencia acordos legados");
  // a página não monta nenhum modal extra para esses dias: só o do próprio card
  assert.ok(!page.includes("initialPunchDate"));
});

check("K. modal de batida mantém data, horário, observação, confirmar e cancelar", () => {
  assert.ok(correctModal.includes("formatDateBR(date)")); // data no subtítulo
  assert.ok(correctModal.includes('label="Horário"'));
  assert.ok(correctModal.includes('label="Observação (opcional)"'));
  assert.ok(/Adicionar/.test(correctModal)); // confirmar (com tipo inferido)
  assert.ok(correctModal.includes("Fechar")); // cancelar/fechar
  // regra existente preservada: tipo inferido pela sequência
  assert.ok(correctModal.includes("suggestedPunchTypeAt"));
});

/* ── L–P: modal [10+] — unidade "min" e cabeçalho/preview ───── */

check("L. campo automático [10+] tem unidade 'min' explícita", () => {
  const idx = useModal.indexOf("Quanto deseja utilizar?");
  assert.ok(idx > 0);
  const seg = useModal.slice(idx, idx + 700);
  assert.ok(seg.includes(">min<"), "sufixo 'min' ausente no campo automático");
});

check("M. campos manuais [10+] têm unidade 'min' explícita", () => {
  const count = (useModal.match(/>min</g) ?? []).length;
  assert.ok(count >= 2, `esperava >= 2 sufixos 'min' (auto + manual), veio ${count}`);
});

check("N. 1º uso: cabeçalho sem número duplicado", () => {
  // 'Ainda pode completar' só aparece no cabeçalho quando já há uso ativo
  const headerEnd = useModal.indexOf("{/* Modo */}");
  const header = useModal.slice(0, headerEnd);
  const apcIdx = header.indexOf("Ainda pode completar");
  assert.ok(apcIdx > 0, "'Ainda pode completar' ausente (esperado, guardado por uso ativo)");
  const guard = header.slice(Math.max(0, apcIdx - 260), apcIdx);
  assert.ok(guard.includes("view.usedActiveMinutes > 0"), "'Ainda pode completar' não é guardado por uso ativo");
  // 1º uso mostra apenas "Falta para completar a jornada"
  assert.ok(header.includes('"Falta para completar a jornada"'));
});

check("O. uso parcial: falta original + já utilizado + ainda pode completar", () => {
  assert.ok(useModal.includes("Falta original"));
  assert.ok(useModal.includes("Já utilizado neste dia"));
  assert.ok(useModal.includes("Ainda pode completar"));
});

check("P. preview 2º uso: 'Novo uso' × 'Total [10+] após confirmar'", () => {
  assert.ok(useModal.includes("Novo uso [10+]"));
  assert.ok(useModal.includes("Total [10+] após confirmar"));
  // total = uso ativo + novo uso (soma exata — projeção segue do motor 3A)
  assert.ok(useModal.includes("view.usedActiveMinutes + selectedTotal"));
  // 1º uso: linha de total omitida (novo = total)
  const previewStart = useModal.indexOf("Como ficará na projeção do ponto");
  const preview = useModal.slice(previewStart, previewStart + 2500);
  const totalIdx = preview.indexOf("Total [10+] após confirmar");
  const guard = preview.slice(Math.max(0, totalIdx - 300), totalIdx);
  assert.ok(guard.includes("view.usedActiveMinutes > 0"), "linha 'Total' não é guardada por uso ativo");
});

/* ── Q–S: motores reais (3A/3B/3C/3D) com o seed 4.0 ────────── */

const seed = buildSeedData();
const settings = settingsOf(seed.user);
const bankArgs = {
  cycle: getAnnualPointCycle("2026-08-26"),
  asOfDate: ASOF,
  entries: seed.entries,
  absences: seed.absences,
  calendars: seed.companyCalendars,
  settings,
  faltas: seed.faltas,
  controlStartDate: seed.user.controlStartDate ?? "",
  uses: seed.specialExcessUses ?? [],
};

check("Q. projeção do preview vem do motor 3A (26/08: 7h + 60min → 8h / 0)", () => {
  const p = projectRealizedDayOfficial({
    date: "2026-08-26",
    factualWorkedMinutes: 420,
    factualRegistrableMinutes: 420,
    factualRegularBalanceMinutes: -60,
    effectiveBaseMinutes: 480,
    financialValid: true,
    realized: true,
    usedSpecialMinutes: 60,
  });
  assert.equal(p.projectedWorkedMinutes, 480);
  assert.equal(p.projectedBalanceMinutes, 0);
});

const dayView26 = (uses: ReturnType<typeof getAppData>["specialExcessUses"]) =>
  buildSpecialExcessDayView({
    date: "2026-08-26",
    asOfDate: ASOF,
    entries: seed.entries,
    absences: seed.absences,
    calendars: seed.companyCalendars,
    settings,
    faltas: seed.faltas,
    controlStartDate: seed.user.controlStartDate ?? null,
    uses: uses ?? [],
  });

check("R. após uso: trabalhado/saldo factual do card seguem inalterados", () => {
  const before = dayView26(seed.specialExcessUses ?? []);
  assert.equal(before.workedMinutes, 420);
  assert.equal(before.factualBalanceMinutes, -60);

  // estado real: hidrata o seed e cria um uso de 60min (26/08)
  actions.replaceAll({
    user: seed.user,
    entries: seed.entries,
    compensations: seed.compensations,
    absences: seed.absences,
    companyCalendars: seed.companyCalendars,
    faltas: seed.faltas,
    excessReasons: seed.excessReasons,
    specialExcessUses: seed.specialExcessUses,
  });
  const r = actions.createSpecialExcessUse({
    destinationDate: "2026-08-26",
    minutes: 60,
    allocationStrategy: "fifo",
    asOfDate: ASOF,
  });
  assert.ok(r.ok, `uso não criado: ${r.error}`);
  const uses = getAppData().specialExcessUses ?? [];
  assert.equal(uses.length, 1);

  const after = dayView26(uses);
  assert.equal(after.workedMinutes, before.workedMinutes, "trabalhado mudou após o uso");
  assert.equal(after.factualBalanceMinutes, before.factualBalanceMinutes, "saldo factual mudou após o uso");
  assert.equal(after.usedActiveMinutes, 60);
  assert.equal(after.remainingMinutes, 0);
});

check("S. cancelamento devolve o saldo ao banco [10+] (ação 3D)", () => {
  const bankBefore = buildSpecialExcessBank({ ...bankArgs, uses: [] });
  assert.equal(bankBefore.availableMinutes, 130);

  // estado atual do check R: 1 uso ativo de 60min (FIFO 18/08:40 + 20/08:20)
  const bankWithUse = buildSpecialExcessBank({
    ...bankArgs,
    uses: getAppData().specialExcessUses ?? [],
  });
  assert.equal(bankWithUse.availableMinutes, 70);

  const useId = (getAppData().specialExcessUses ?? [])[0]?.id;
  assert.ok(useId, "uso não encontrado no estado");
  const rc = actions.cancelSpecialExcessUse({ id: useId, now: 2_000_000 });
  assert.ok(rc.ok, `cancelamento falhou: ${rc.error}`);

  const bankAfter = buildSpecialExcessBank({
    ...bankArgs,
    uses: getAppData().specialExcessUses ?? [],
  });
  assert.equal(bankAfter.availableMinutes, 130, "saldo disponível não voltou a 130min");
  // uso fica rastreável como cancelado (nunca excluído)
  const kept = (getAppData().specialExcessUses ?? []).find((u) => u.id === useId);
  assert.equal(kept?.status, "cancelado");
});

/* ── T: nenhuma action legada de compensação no novo fluxo ──── */

const LEGACY_FORBIDDEN_IN_DAY_CARD = [
  "onCreateComp",
  "onCapComp",
  "openComp(",
  "onUseAvailableExcess",
  "onAllocateExcess",
  "onRegisterReason",
  "CompensationForm",
  "Revisar compensação",
  "Concluir compensação",
  "Usar excedente disponível",
  "Gerenciar excedente",
  "Realocar excedente",
  "Registrar motivo",
  "Alterar motivo",
  "planRealizedCreditUse",
  "useRealizedCredit",
  "actions.addComp",
  "actions.updateComp",
  "actions.deleteComp",
];

check("T1. day-card: zero wiring legado de compensação no fluxo principal", () => {
  for (const s of LEGACY_FORBIDDEN_IN_DAY_CARD) {
    assert.ok(!dayCard.includes(s), `day-card ainda contém '${s}'`);
  }
});

check("T2. modal/summary [10+]: zero engine legado (hour-bank/debt/compensar)", () => {
  for (const f of [useModal, summary]) {
    assert.ok(!f.includes('from "@/lib/hour-bank"'), "import legado hour-bank");
    assert.ok(!f.includes('from "@/lib/debt"'), "import legado debt");
    assert.ok(!f.includes("actions.addComp"), "action legada addComp");
    assert.ok(!f.includes("actions.updateComp"), "action legada updateComp");
    assert.ok(!f.includes("actions.deleteComp"), "action legada deleteComp");
    assert.ok(!f.includes("allocateSpecialExcess("), "action legada allocateSpecialExcess");
  }
});

check("T3. página Registros: wiring legado removido (shortcuts/creditView/motivos/alocação)", () => {
  assert.ok(!page.includes("shortcutsByDate"), "shortcutsByDate ainda existe");
  assert.ok(!page.includes("cycleHasSpecial"), "cycleHasSpecial ainda existe");
  assert.ok(!page.includes("promptExcessReasonIfNeeded"), "prompt de motivo ainda existe");
  assert.ok(!page.includes("ExcessReasonModal"), "ExcessReasonModal ainda referenciado");
  assert.ok(!page.includes("AllocateExcessModal"), "AllocateExcessModal ainda referenciado");
  assert.ok(!page.includes("compensarObligationOnDate"), "compensarObligationOnDate ainda referenciado");
  assert.ok(!page.includes("hasAvailableSpecialExcess"), "prop legado ainda passada");
});

/* ── U: seed 4.0 suficiente para o roteiro manual ───────────── */

check("U. seed 4.0 cobre o roteiro manual (27/08, 24/08, 26/08, 28/08, banco 130)", () => {
  const dates = new Set(seed.entries.map((e) => e.date));
  for (const d of ["2026-08-24", "2026-08-26", "2026-08-27", "2026-08-28"]) {
    assert.ok(dates.has(d), `dia ${d} ausente do seed`);
  }
  assert.deepEqual(seed.specialExcessUses ?? [], [], "seed deve iniciar sem usos");
  assert.equal(seed.compensations.length, 0, "seed não deve ter compensações legadas");
  const bank = buildSpecialExcessBank({ ...bankArgs, uses: [] });
  assert.equal(bank.generatedMinutes, 130);
  assert.equal(bank.availableMinutes, 130);
});

/* ── V–Y: gate visual — dia incompleto/inconsistente só corrige ── */

/** Condição do bloco de ações de adição do card (Adicionar batida / Registrar intervalo). */
const addGate = (() => {
  // 4G.1 (SUPERADO): o gate do bloco de adição ganhou a condição !ro antes.
  const start = dayCard.indexOf("{!ro && !missingExpected && !historicalEmpty &&");
  assert.ok(start > 0, "bloco de ações de adição do card não encontrado");
  return dayCard.slice(start, start + 110);
})();

check("V. dia incompleto/inconsistente: única ação operacional = 'Corrigir registros'", () => {
  // o bloco inteiro (Adicionar batida + Registrar intervalo) fica atrás do gate
  assert.ok(addGate.includes("!incompletePast"), "gate de dia incompleto nas ações de adição");
  assert.ok(addGate.includes("!inconsistent"), "gate de dia inconsistente nas ações de adição");
  // cada estado oferece 'Corrigir registros' no banner (caminho operacional único)
  const inconsistentAt = dayCard.indexOf("{inconsistent && (");
  const incompleteBanner = dayCard.slice(dayCard.indexOf("{incompletePast && ("), inconsistentAt);
  assert.ok(incompleteBanner.includes("Corrigir registros"), "banner incompleto → Corrigir registros");
  assert.ok(incompleteBanner.includes('setPunchModal("correct")'), "banner incompleto abre o modal (modo correct)");
  const inconsistentBanner = dayCard.slice(inconsistentAt, dayCard.indexOf("{specialExcess && ("));
  assert.ok(inconsistentBanner.includes("Corrigir registros"), "banner inconsistente → Corrigir registros");
  assert.ok(inconsistentBanner.includes('setPunchModal("correct")'), "banner inconsistente abre o modal (modo correct)");
});

check("W. dia deficit válido (26/08) e dia ok (25/08): gate não afeta (sem regressão)", () => {
  // o gate referencia apenas estados estruturais — nunca deficit/saldo
  assert.ok(!/deficit/i.test(addGate), "gate não referencia deficit");
  assert.ok(!/balance/i.test(addGate), "gate não referencia saldo");
  // engine real com o seed 4.0:
  const day26 = computeDay(seed.entries.filter((e) => e.date === "2026-08-26"), settings);
  assert.ok(day26.balanceMinutes < 0, "26/08 é deficit válido");
  assert.equal(day26.open, false, "26/08 encerrado");
  assert.equal(day26.consistent, true, "26/08 consistente");
  assert.equal(isIncompletePastPunch("2026-08-26", day26.open, ASOF), false, "26/08 não é incompleto");
  const day25 = computeDay(seed.entries.filter((e) => e.date === "2026-08-25"), settings);
  assert.equal(day25.balanceMinutes, 0, "25/08 ok");
  assert.equal(day25.open, false, "25/08 encerrado");
  assert.equal(day25.consistent, true, "25/08 consistente");
  assert.equal(isIncompletePastPunch("2026-08-25", day25.open, ASOF), false, "25/08 não é incompleto");
  // → !incompletePast && !inconsistent passam → ações normais permanecem
});

check("X. modal resolve o incompleto: a MESMA chamada do modal completa o 27/08", () => {
  actions.replaceAll({
    user: seed.user,
    entries: seed.entries,
    compensations: seed.compensations,
    absences: seed.absences,
    companyCalendars: seed.companyCalendars,
    faltas: seed.faltas,
    excessReasons: seed.excessReasons,
    specialExcessUses: seed.specialExcessUses,
  });
  const e27 = getAppData().entries.filter((e) => e.date === "2026-08-27");
  // o modal infere o tipo pela sequência (suggestedPunchTypeAt) e chama actions.addEntry
  const type = suggestedPunchTypeAt(e27, "17:00");
  assert.equal(type, "saida", "sequência 08E/12S/13E infere SAÍDA às 17:00");
  const res = actions.addEntry({ date: "2026-08-27", time: "17:00", type, note: null, source: "manual" });
  assert.ok(res.ok, `adição falhou: ${res.error}`);
  const day = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-27"), settings);
  assert.equal(day.consistent, true, "dia consistente após a correção");
  assert.equal(day.open, false, "dia encerrado após a correção");
  assert.equal(day.workedMinutes, 480, "8h após a correção");
  // gate liberado: o dia voltou a ser válido → ações normais reaparecem
  assert.equal(isIncompletePastPunch("2026-08-27", day.open, ASOF), false);
});

check("Y. gate não introduz action/fluxo legado novo", () => {
  for (const s of LEGACY_FORBIDDEN_IN_DAY_CARD) {
    assert.ok(!dayCard.includes(s), `day-card contém '${s}'`);
  }
  assert.ok(!dayCard.includes('from "@/lib/hour-bank"'), "import legado hour-bank");
  assert.ok(!dayCard.includes('from "@/lib/debt"'), "import legado debt");
});

/* ────────────────────────────────────────────────────────────────────────
 * C1–C14. CORREÇÃO FINAL DE UX: card de correção + modal com dois contextos
 * ──────────────────────────────────────────────────────────────────────── */

const quickSrcFinal = src("src/components/quick-punch.tsx");

check("C1. dia inválido: conteúdo expandido = card de correção (gate invalidStructure)", () => {
  assert.ok(dayCard.includes("const invalidStructure = incompletePast || inconsistent;"), "gate estrutural no day-card");
  const tern = dayCard.indexOf("{invalidStructure ? (");
  const elseAt = dayCard.indexOf(") : (", tern);
  assert.ok(tern > -1 && elseAt > tern, "ternário correção/normal na seção expandida");
  const corr = dayCard.slice(tern, elseAt);
  const normal = dayCard.slice(elseAt);
  // branch de correção: somente banners + CTA
  assert.ok(corr.includes("Registro incompleto") && corr.includes("Registro inconsistente"), "banners na branch de correção");
  assert.equal((corr.match(/Corrigir registros/g) ?? []).length, 2, "um CTA por banner");
  for (const hidden of ["Trabalhado", "d.segments.map", "No ponto", "Adicionar batida", "Registrar intervalo", "separado no banco [10+]", "<SmartExit"]) {
    assert.ok(!corr.includes(hidden), `branch de correção NÃO contém: ${hidden}`);
  }
  // branch normal: layout completo preservado
  for (const keep of ["Trabalhado", "d.segments.map", "No ponto", "Adicionar batida", "Registrar intervalo", "<SmartExit"]) {
    assert.ok(normal.includes(keep), `branch normal PRESERVA: ${keep}`);
  }
});

check("C2. batidas permanecem intactas nos dados (card de correção é só visual)", () => {
  actions.replaceAll({
    user: seed.user,
    entries: seed.entries,
    compensations: seed.compensations,
    absences: seed.absences,
    companyCalendars: seed.companyCalendars,
    faltas: seed.faltas,
    excessReasons: seed.excessReasons,
    specialExcessUses: seed.specialExcessUses,
  });
  const e27 = getAppData().entries.filter((e) => e.date === "2026-08-27");
  assert.deepEqual(
    e27.map((e) => [e.time, e.type]),
    [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"]],
    "as 3 batidas originais do 27/08 seguem nos dados"
  );
  const tern = dayCard.indexOf("{invalidStructure ? (");
  const corr = dayCard.slice(tern, dayCard.indexOf(") : (", tern));
  assert.ok(!/actions\./.test(corr), "branch de correção não chama nenhuma action do store");
});

check("C3. modal modo 'correct': título e subtexto de correção preservados", () => {
  assert.ok(correctModal.includes('title={mode === "correct" ? "Corrigir registros" : "Adicionar batida"}'), "título condicional por mode");
  assert.ok(correctModal.includes("Edite, adicione ou exclua batidas para corrigir o registro deste dia."), "subtexto de correção preservado");
});

check("C4. modal modo 'add': título 'Adicionar batida' + subtexto curto sem linguagem de correção", () => {
  assert.ok(correctModal.includes("Adicione uma nova batida a este dia."), "subtexto curto de adição");
  const at = correctModal.indexOf("Adicione uma nova batida a este dia.");
  const ctx = correctModal.slice(at, at + 120);
  assert.ok(!/corrigir/i.test(ctx), "subtexto 'add' sem linguagem de 'corrigir'");
});

check("C5. banner verde genérico só no modo 'correct'; feedback específico preservado", () => {
  const green = correctModal.indexOf("Sequência válida. O saldo deste dia será recalculado.");
  assert.ok(green > -1, "banner verde preservado");
  const guard = correctModal.indexOf('{mode === "correct" &&');
  assert.ok(guard > -1, "guard do modo 'correct' presente");
  const end = correctModal.indexOf(") : null)}", green);
  assert.ok(end > green, "bloco de banners fechado");
  const region = correctModal.slice(guard, end);
  assert.ok(region.includes("Sequência válida"), "banner verde dentro do guard do modo correct");
  assert.ok(!region.includes("analysis.sorted"), "listagem de batidas fora do bloco de banners");
  assert.ok(correctModal.includes("Para manter a sequência correta"), "hint específico de inferência preservado nos dois modos");
});

check("C6. batidas existentes visíveis nos DOIS modos (sem versão reduzida)", () => {
  assert.ok(correctModal.includes("analysis.sorted.map"), "listagem de batidas existente");
  assert.ok(correctModal.includes('aria-label="Excluir"'), "exclusão preservada");
  assert.ok(correctModal.includes("Registrar intervalo"), "intervalo preservado");
  assert.ok(correctModal.includes('label="Observação (opcional)"'), "observação preservada");
  assert.ok(correctModal.includes('label="Horário"'), "horário preservado");
  // 'mode' só atua em 3 pontos: título, subtexto e guard do banner
  const modeCount = (correctModal.match(/mode === /g) ?? []).length;
  assert.equal(modeCount, 3, `esperava 3 usos de 'mode' (título/subtexto/banner), veio ${modeCount}`);
});

check("C7. inferência intacta: 08E/12S/13E + 17:00 → 'saida' (motor)", () => {
  const e27: TimeEntryLike[] = [
    { id: 1, date: "2026-08-27", time: "08:00", type: "entrada", note: null },
    { id: 2, date: "2026-08-27", time: "12:00", type: "saida", note: null },
    { id: 3, date: "2026-08-27", time: "13:00", type: "entrada", note: null },
  ];
  assert.equal(suggestedPunchTypeAt(e27, "17:00"), "saida", "dia incompleto infere SAÍDA");
  assert.equal(suggestedPunchTypeAt([], "08:00"), "entrada", "primeira batida do dia infere ENTRADA");
});

check("C8. fluxo completo: correção completa o 27/08 e o card volta ao normal automaticamente", () => {
  actions.replaceAll({
    user: seed.user,
    entries: seed.entries,
    compensations: seed.compensations,
    absences: seed.absences,
    companyCalendars: seed.companyCalendars,
    faltas: seed.faltas,
    excessReasons: seed.excessReasons,
    specialExcessUses: seed.specialExcessUses,
  });
  const e27 = getAppData().entries.filter((e) => e.date === "2026-08-27");
  const type = suggestedPunchTypeAt(e27, "17:00");
  assert.equal(type, "saida");
  const res = actions.addEntry({ date: "2026-08-27", time: "17:00", type, note: null, source: "manual" });
  assert.ok(res.ok, `adição falhou: ${res.error}`);
  const day = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-27"), settings);
  assert.equal(day.consistent, true);
  assert.equal(day.open, false);
  assert.equal(day.workedMinutes, 480, "8h após a correção");
  // gate liberado: invalidStructure === false → layout normal volta, sem estado persistido
  const invalidStructure = isIncompletePastPunch("2026-08-27", day.open, ASOF) || (!day.consistent && day.workedMinutes > 0);
  assert.equal(invalidStructure, false, "card volta automaticamente ao layout normal");
});

check("C9. dia deficit válido (26/08): card normal — déficit abaixo da base ≠ registro inválido", () => {
  const e26 = getAppData().entries.filter((e) => e.date === "2026-08-26");
  assert.equal(e26.length, 4, "batidas do 26/08 intactas");
  const day = computeDay(e26, settings);
  assert.equal(day.consistent, true, "26/08 consistente");
  assert.equal(day.open, false, "26/08 encerrado");
  const invalidStructure = isIncompletePastPunch("2026-08-26", day.open, ASOF) || (!day.consistent && e26.length > 0);
  assert.equal(invalidStructure, false, "déficit abaixo da base NÃO é erro estrutural");
});

check("C10. 'Adicionar batida' (dia válido) → MESMO modal em modo 'add'; 1 instância; quick-punch ok", () => {
  assert.ok(dayCard.includes('onClick={() => setPunchModal("add")}'), "botão de adição abre com intenção 'add'");
  assert.equal((dayCard.match(/<CorrectPunchesModal/g) ?? []).length, 1, "UM único modal no day-card");
  assert.ok(dayCard.includes("mode={punchModal}"), "mesma instância recebe o mode do caller");
  assert.equal((quickSrcFinal.match(/<CorrectPunchesModal/g) ?? []).length, 2, "ponto rápido reaproveita o mesmo modal");
  assert.ok(quickSrcFinal.includes('mode="correct"'), "ponto rápido mantém modo 'correct' (botão de correção)");
});

check("C11. inferência intacta: dia válido (26/08) + 17:00 → 'entrada' (motor)", () => {
  const e26 = getAppData().entries.filter((e) => e.date === "2026-08-26");
  assert.equal(suggestedPunchTypeAt(e26, "17:00"), "entrada", "dia encerrado + 17:00 infere ENTRADA");
  assert.ok(correctModal.includes('Adicionar ${suggested === "entrada" ? "entrada" : "saída"}'), "rótulo do botão segue a inferência");
});

check("C12. nenhuma action duplicada no modal; sem motor financeiro novo na UI de batidas (3G: chamadas via provider com confirmação)", () => {
  // 3G: os actions de batida passam pelo gate central de liberação [10+]
  // (useSpecialPunchActions) — a garantia é a MESMA: uma única chamada de
  // store por operação, zero motor de cálculo na UI.
  assert.equal((correctModal.match(/punches\.addEntry\(/g) ?? []).length, 1, "addEntry única (via provider 3G)");
  assert.equal((correctModal.match(/punches\.addEntries\(/g) ?? []).length, 1, "addEntries (intervalo) única (via provider 3G)");
  assert.equal((correctModal.match(/punches\.deleteEntry\(/g) ?? []).length, 1, "deleteEntry única (via provider 3G)");
  assert.ok(correctModal.includes('useSpecialPunchActions'), "gate 3G presente");
  assert.ok(correctModal.includes('special-release-cancelled'), "aborto silencioso ao Voltar");
  for (const f of [dayCard, correctModal]) {
    assert.ok(!f.includes('from "@/lib/official-projection"'), "sem import de projeção na UI de batidas");
    assert.ok(!f.includes('from "@/lib/special-excess-bank"'), "sem import de banco na UI de batidas");
    assert.ok(!f.includes('from "@/lib/hour-bank"') && !f.includes('from "@/lib/debt"'), "sem motor legado novo");
  }
});

check("C13. sem estado persistido de 'modo correção': gate derivado, 1 único state novo", () => {
  assert.ok(dayCard.includes('useState<"correct" | "add" | null>(null)'), "state de intenção do modal");
  assert.ok(!dayCard.includes("correctOpen"), "state antigo removido");
  assert.ok(!dayCard.includes("correctMode") && !dayCard.includes("correctionMode"), "sem state extra de modo");
  assert.ok(dayCard.includes("const invalidStructure = incompletePast || inconsistent;"), "gate derivado dos dados (recomputado por render)");
});

check("C14. cabeçalho do dia inválido preservado (badge/status 'Pendente')", () => {
  const headEnd = dayCard.indexOf("{expanded && (");
  assert.ok(headEnd > -1);
  const head = dayCard.slice(0, headEnd);
  assert.ok(head.includes("Pendente"), "badge 'Pendente' vive no header (fora do gate)");
  assert.ok(head.includes("Registro incompleto") || head.includes("incompleto"), "estado do dia visível no header");
});

console.log(`\n${passed}/41 verificações 3E.2 passaram.`);
