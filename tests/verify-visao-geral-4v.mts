/**
 * VERIFICAÇÃO — ETAPA 4V: REFORMA VISUAL/ESTRUTURAL DA VISÃO GERAL (UI-ONLY).
 *
 * A Visão Geral volta a ser uma visão geral: saudação → Registro de hoje →
 * pendências relevantes → Resumo rápido (Saldo regular do período · Projeção
 * no ponto · BANCO [10+] DISPONÍVEL · [10+] gerado no período) → Dias
 * recentes — FIM. Blocos legados de gestão (compensações, realocação,
 * déficits a programar, hora extra programada) e o gráfico detalhado saem da
 * RENDERIZAÇÃO — nenhum motor/código é apagado. ZERO alteração de regras,
 * cálculos, store ou schema: a página apenas consome as fontes canônicas já
 * existentes (dayBalanceContribution · buildResumoPeriodView 3A/3F ·
 * buildSpecialExcessBank 3C).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-visao-geral-4v.mts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { getPointPeriod, listDaysBetween, getAnnualPointCycle } from "../src/lib/periods.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { recentDayStatusOf } from "../src/app/(app)/page.tsx";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const exists = (p: string) => existsSync(join(root, p));

const page = src("src/app/(app)/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Estado: seed canônico ── */
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
  specialExcessPlans: seed.specialExcessPlans ?? [],
});
const dd = () => getAppData();

/* ════════════════ TESTES 01–10 ════════════════ */

check("TESTE 01 DE 10 — Visão Geral mantém o Registro de hoje", () => {
  // Card único Ponto + Assistente, exatamente uma instância de cada:
  const q = page.indexOf("<QuickPunch");
  const s = page.indexOf("<SmartExit");
  const card = page.indexOf('title="Registro de hoje"');
  assert.ok(card > -1, "card 'Registro de hoje' presente");
  assert.ok(q > -1 && s > -1, "QuickPunch e SmartExit presentes");
  assert.equal(page.indexOf("<QuickPunch", q + 1), -1, "uma única instância do QuickPunch");
  assert.equal(page.indexOf("<SmartExit", s + 1), -1, "uma única instância do SmartExit");
  // Botões/ações já existentes permanecem ligados:
  for (const wiring of [
    "onAddEntry={onAddEntry}",
    "onUpdateEntry={onUpdateEntry}",
    "onDeleteEntry={onDeleteEntry}",
    "onRegisterFalta={registerFaltaHoje}",
    "onRemoveFalta={removeFaltaHoje}",
    "onSmartExit={smartExit}",
    "onConfirmComps={confirmComps}",
    "idle={todayIdle}",
  ]) {
    assert.ok(page.includes(wiring), `wiring preservado: ${wiring}`);
  }
  // A lógica do fluxo de batida não foi alterada (guardas §7/§10/§25 seguem na página):
  for (const guard of ["resolveFaltaConflict", "promptExcessReasonIfNeeded", "snapshotDay", "special-release-cancelled"]) {
    assert.ok(page.includes(guard), `lógica do Registro de hoje preservada: ${guard}`);
  }
  // O modal de motivo do excedente (§10) segue montado:
  assert.ok(page.includes("<ExcessReasonModal"), "modal do motivo do excedente preservado");
});

check("TESTE 02 DE 10 — Saldo factual do período presente, na MESMA fonte anterior", () => {
  // 4D: o card virou "Saldo factual do período" e a fonte é a derivação
  // canônica buildResumoPeriodView (a MESMA Σ de balanceContribution que o
  // memo anterior somava — igualdade provada abaixo e na suíte 4D).
  assert.ok(page.includes('label="Saldo factual do período"'), "indicador presente");
  assert.ok(page.includes("value={fmtSigned(resumoView.cards.regularBalanceMinutes)}"), "exibe o total da fonte canônica");
  assert.ok(page.includes("buildResumoPeriodView"), "fonte canônica na página");
  // Funcional: a soma da fonte anterior continua IGUAL à do Resumo (verdade canônica).
  const st = dd();
  const settings = settingsOf(st.user);
  const period = getPointPeriod("2026-08-30");
  let total = 0;
  for (const date of listDaysBetween(period.from, period.to)) {
    const cctx = companyDayContext(date, st.entries, st.absences, st.companyCalendars, settings);
    total += dayBalanceContribution(cctx, st.faltas, date, "2026-08-30");
  }
  const view = buildResumoPeriodView({
    period,
    today: "2026-08-30",
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings,
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
    uses: st.specialExcessUses ?? [],
    plans: st.specialExcessPlans ?? [],
  });
  assert.equal(total, view.cards.regularBalanceMinutes, "saldo do período = saldo regular canônico");
  // Linguagem factual (§9/§18) — sem crédito/débito/dívida na nova superfície:
  assert.ok(!/débito|dívida|crédito/i.test(page.slice(page.indexOf('label="Saldo factual do período"'), page.indexOf('label="Saldo projetado do período"') + 200)), "sem vocabulário de dívida no indicador");
});

check("TESTE 03 DE 10 — Saldo projetado do período presente, na MESMA fonte anterior", () => {
  // 4D: rótulo "Saldo projetado do período"; fonte inalterada (3A).
  assert.ok(page.includes('label="Saldo projetado do período"'), "indicador presente");
  assert.ok(page.includes("value={fmtSigned(projection.projectedBalanceMinutes)}"), "exibe a projeção derivada");
  // MESMA FONTE do Resumo (3A): buildResumoPeriodView — nenhum recálculo na página.
  assert.ok(page.includes("buildResumoPeriodView"));
  assert.ok(page.includes("resumoView.cards.projection"), "fonte = cards.projection da derivação canônica");
  assert.ok(page.includes("projection.appliedSpecialMinutes"), "subtexto usa o [10+] aplicado da fonte");
  // Funcional: a projeção consumida pela página é a MESMA do Resumo para o mesmo período.
  const st = dd();
  const settings = settingsOf(st.user);
  const period = getPointPeriod("2026-08-30");
  const view = buildResumoPeriodView({
    period,
    today: "2026-08-30",
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings,
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
    uses: st.specialExcessUses ?? [],
    plans: st.specialExcessPlans ?? [],
  });
  assert.ok(typeof view.cards.projection.projectedBalanceMinutes === "number", "projeção presente na fonte canônica");
  assert.ok(!page.includes("projectRealizedDayOfficial("), "a página NÃO chama o motor 3A diretamente (apenas apresenta)");
});

check("TESTE 04 DE 10 — BANCO [10+] DISPONÍVEL presente, sem fórmula paralela", () => {
  assert.ok(page.includes('label="BANCO [10+] DISPONÍVEL"'), "indicador presente");
  assert.ok(page.includes("value={formatMinutes(specialBank.availableMinutes)}"), "principal = availableMinutes");
  // Fonte canônica 3C — a MESMA do Resumo/3G: buildSpecialExcessBank.
  assert.ok(page.includes("buildSpecialExcessBank"));
  assert.ok(page.includes("plans: specialExcessPlans ?? []"), "disponível líquido de reservas ativas (4A)");
  // Sem matemática paralela escrita na página:
  assert.ok(!/generatedMinutes\s*-\s*usedMinutes/.test(page), "sem subtração paralela no componente");
  assert.ok(!page.includes("excessSpecialFreeTotal"), "sem métrica legado");
  // 4D (Parte E): sub secundário CURTO — somente "X reservados" quando > 0
  // (gerado histórico/utilizado vão para a futura Central):
  assert.ok(page.includes("reservados`"), "reservado condicional (>0) no sub");
  assert.ok(!page.includes("gerado · "), "sem gerado histórico no card da Visão Geral (4D Parte E)");
  // Funcional: o valor exibido é o do motor canônico.
  const st = dd();
  const b = buildSpecialExcessBank({
    cycle: getAnnualPointCycle("2026-08-30"),
    asOfDate: "2026-08-30",
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings: settingsOf(st.user),
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? "",
    uses: st.specialExcessUses ?? [],
    plans: st.specialExcessPlans ?? [],
  });
  assert.equal(b.availableMinutes, Math.max(0, b.generatedMinutes - b.usedMinutes - b.reservedMinutes), "identidade canônica (fórmula na lib, não na página)");
});

check("TESTE 05 DE 10 — [10+] gerado: factual, fora da VG (4D) e intacto no Resumo", () => {
  // 4D: o card de gerado saiu da Visão Geral (detalhe vai para a futura
  // Central); o valor factual segue canônico no Resumo:
  assert.ok(!page.includes('[10+] gerado no período'), "4D: fora da Visão Geral");
  // Funcional: o gerado do período é factual — igual à soma dos excessos diários
  // da classificação canônica (buildResumoDayRow, a MESMA de Registros/Resumo).
  const st = dd();
  const settings = settingsOf(st.user);
  const period = getPointPeriod("2026-08-30");
  let factual = 0;
  for (const date of listDaysBetween(period.from, period.to)) {
    factual += buildResumoDayRow({
      date,
      today: "2026-08-30",
      entries: st.entries,
      absences: st.absences,
      calendars: st.companyCalendars,
      settings,
      faltas: st.faltas,
      controlStartDate: st.user.controlStartDate ?? null,
    }).excessMinutes;
  }
  const view = buildResumoPeriodView({
    period,
    today: "2026-08-30",
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings,
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
    uses: st.specialExcessUses ?? [],
    plans: st.specialExcessPlans ?? [],
  });
  assert.equal(view.cards.specialGeneratedMinutes, factual, "[10+] gerado no período = soma factual dos excessos");
  const resumo4v = src("src/app/(app)/resumo/page.tsx");
  assert.ok(resumo4v.includes('[10+] gerado no período'), "Resumo mantém o indicador factual");
});

check("TESTE 06 DE 10 — Dias recentes presentes, classificação 3H intacta", () => {
  // Seção preservada (âncora usada pela verificação 3H):
  const start = page.indexOf("{/* Dias recentes */}");
  assert.ok(start > -1, "seção Dias recentes presente");
  const section = page.slice(start);
  assert.ok(section.includes("resumoFinancialFrozen"), "gate de congelamento na lista");
  assert.ok(section.includes('text-slate-300">—</span>'), "saldo neutro '—' para dia inválido");
  const excessGate = section.indexOf('row.status === "excess"');
  const helperCall = section.indexOf("recentDayStatusOf(");
  assert.ok(excessGate > -1 && helperCall > excessGate, "chip [10+] avaliado antes do fallback");
  assert.ok(section.includes("<ExcessTenBadge />"), "identificação [10+] preservada");
  assert.ok(!section.includes('<Badge tone="slate">ok</Badge>'), "sem 'ok' genérico");
  assert.ok(!page.includes('"Jornada abaixo do previsto"'), "sem vocabulário paralelo");
  // Helper 3H intacto e funcional:
  assert.ok(page.includes("export function recentDayStatusOf"));
  const st = dd();
  const settings = settingsOf(st.user);
  const row = buildResumoDayRow({
    date: "2026-08-27",
    today: "2026-08-30",
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings,
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
  });
  assert.deepEqual(recentDayStatusOf(row), { label: "Registro incompleto", tone: "amber" }, "incompleto nunca é 'ok'");
});

check("TESTE 07 DE 10 — Blocos legados removidos da renderização (motores intactos)", () => {
  // Removidos da RENDERIZAÇÃO da Visão Geral:
  for (const removido of [
    "<ExcessPanel",
    "Gestão de Excedentes",
    "Compensações pendentes",
    "Nova compensação",
    "Programar hora extra",
    "Realocar",
    "<CompensationForm",
    "<HourBankCard",
    "Previsão de horas a compensar",
    "Saldo negativo em aberto",
    "Gerenciar na Central",
  ]) {
    assert.ok(!page.includes(removido), `fora da Visão Geral: ${removido}`);
  }
  // Pendências RELEVANTES permanecem (registros pendentes, aviso âmbar):
  assert.ok(page.includes("Registros pendentes"), "aviso de registros pendentes preservado");
  assert.ok(page.includes("pendingPunchDatesInCycle"), "fonte de pendências existente preservada");
  // NENHUM motor/código legado foi apagado:
  for (const arquivo of [
    "src/components/excess-panel.tsx",
    "src/components/compensation-form.tsx",
    "src/components/hour-bank-card.tsx",
    "src/components/stacked-period-chart.tsx",
    "src/app/(app)/compensacoes/page.tsx",
  ]) {
    assert.ok(exists(arquivo), `componente/página legado preservado: ${arquivo}`);
  }
  // Vocabulário proibido (§18) ausente da página:
  for (const palavra of ["realocar", "dívida", "débito", "compensação pendente", "déficit sem programação", "programar hora extra"]) {
    assert.ok(!page.toLowerCase().includes(palavra), `sem '${palavra}' na Visão Geral`);
  }
});

check("TESTE 08 DE 10 — Gráfico detalhado sai da Visão Geral; componente permanece no Resumo", () => {
  assert.ok(!page.includes("StackedPeriodChart"), "gráfico não renderiza mais na Visão Geral");
  assert.ok(!page.includes("Barras empilhadas"), "sem card do gráfico na Visão Geral");
  // O componente não foi apagado e o Resumo continua usando:
  assert.ok(exists("src/components/stacked-period-chart.tsx"), "componente do gráfico preservado");
  const resumo = src("src/app/(app)/resumo/page.tsx");
  assert.ok(resumo.includes("StackedPeriodChart"), "Resumo segue renderizando o gráfico");
  assert.ok(resumo.includes('title="Barras empilhadas do período"'), "card do gráfico intacto no Resumo");
});

check("TESTE 09 DE 10 — Responsividade: composição compacta mobile, sem overflow horizontal", () => {
  // 4D: Situação do ciclo (3 cards empilhados no mobile / 3 colunas no
  // desktop) e pares de cards (período/frente) empilhados no mobile:
  const bloco = page.slice(page.indexOf("Ciclo {cycleSituation.cycle}"));
  assert.ok(/grid gap-2 sm:grid-cols-3 sm:gap-3/.test(bloco), "ciclo: empilhado no mobile / 3 colunas no desktop");
  assert.ok(/grid gap-2 sm:grid-cols-2 sm:gap-3/.test(bloco), "período/frente: empilhados no mobile / 2 colunas no desktop");
  // Registro de hoje empilha no mobile e divide colunas no desktop, sem estourar:
  assert.ok(page.includes("grid items-start gap-4 lg:grid-cols-2 lg:gap-5"), "Registro de hoje empilha no mobile");
  assert.ok(page.includes("min-w-0"), "filhos com min-w-0 (sem overflow)");
  // Sem larguras fixas em pixel e sem rolagem horizontal introduzida:
  assert.ok(!page.includes("w-["), "sem larguras arbitrárias");
  assert.ok(!page.includes("overflow-x"), "sem rolagem horizontal");
  // Raiz em coluna única (fluxo vertical curto):
  assert.ok(page.includes('className="flex flex-col gap-4 lg:gap-5"'), "página em coluna única");
  // Página terminando cedo: após Dias recentes só existe o modal §10:
  const fim = page.slice(page.indexOf("{/* Dias recentes */}"));
  assert.ok(fim.includes("<ExcessReasonModal"), "após Dias recentes: apenas o modal do motivo (§10)");
  assert.ok(!/Gestão|Compensações pendentes/.test(fim), "nenhum painel legado após Dias recentes");
});

check("TESTE 10 DE 10 — Barreira de domínio: nenhum arquivo de regra/cálculo alterado", () => {
  // 4C.1A: a barreira audita O COMMIT DA 4V (42cc14a) — a mesma garantia
  // (4V só tocou page.tsx + testes), agora permanente e imune a mudanças
  // legítimas de etapas posteriores na árvore de trabalho.
  let changed: string[] = [];
  try {
    changed = execSync("git show --name-only --pretty=format: 42cc14aa451aff9eee72d268f1b294b484bf2d05", { cwd: root, encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch { /* git indisponível: ignora */ }
  // Arquivos PROIBIDOS na 4V:
  const proibidos = changed.filter((f) =>
    f.startsWith("src/lib/") ||
    f === "src/lib/store.ts" ||
    f === "src/lib/backup.ts" ||
    f.startsWith("src/lib/special-excess-") ||
    f.startsWith("src/lib/resumo-") ||
    f === "src/lib/time.ts" ||
    f.startsWith("src/lib/seed") ||
    f.startsWith("src/lib/periods"),
  );
  assert.deepEqual(proibidos, [], "nenhum arquivo de store/domínio/fórmula/schema/backup alterado");
  // Tudo que mudou é apresentacional ou de teste:
  for (const f of changed) {
    const permitido =
      f === "src/app/(app)/page.tsx" ||
      f.startsWith("tests/");
    assert.ok(permitido, `arquivo alterado é UI/teste: ${f}`);
  }
  assert.ok(changed.includes("src/app/(app)/page.tsx"), "a reforma ocorreu em page.tsx (apresentação)");
  assert.ok(changed.length > 0, "commit 4V auditado");
});

console.log(`\n${passed}/10 verificações da Etapa 4V passaram.`);
if (passed !== 10) process.exit(1);
