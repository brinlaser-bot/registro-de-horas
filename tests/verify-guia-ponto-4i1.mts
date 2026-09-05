/**
 * VERIFICAÇÃO — ETAPA 4I.1: CORREÇÕES PÓS-VALIDAÇÃO DO “GUIA DO PONTO”.
 *
 * Escopo (somente view model / apresentação do Guia — NENHUM motor
 * financeiro tocado):
 *   · COMPENSAR passado sem batidas: fato canônico já existe (0min +
 *     saldo factual negativo do buildResumoDayRow) — nunca “aguardando
 *     registro real / antes do fato”; futuro e HOJE em andamento preservam
 *     a semântica temporal (nunca déficit prematuro);
 *   · FORA DO CONTROLE + sem registro: orientação neutra (nada a
 *     aguardar, nada inventado);
 *   · PERÍODO FUTURO: nunca “Período futuro” + “Em andamento” juntos
 *     (motor 4G compartilhado permanece intocado);
 *   · [10+] utilizado sem batidas reais: mantém “Requer orientação
 *     manual” e passa a expor saldo factual/saldo projetado CANÔNICOS;
 *   · dia >10h ([10+] gerado): texto distinto do caso “recebe [10+]”;
 *   · filtros Todos/Prontos/Atenção preservados; cards compactados sem
 *     overflow em 320/360/412.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-guia-ponto-4i1.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildPointGuideView,
  GUIDE_DEFAULT_MAX_EXIT,
  GUIDE_DEFAULT_MIN_ENTRY,
} from "../src/lib/point-guide.ts";
import { getPointPeriod } from "../src/lib/periods.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { addDays, formatMinutes, parseDate } from "../src/lib/time.ts";
import { settingsOf, actions, getAppData } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import type { Falta, TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (p: string) => readFileSync(join(root, p), "utf8");
const pageSrc = () => srcOf("src/app/(app)/guia-ponto/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ═══════════════════════════════════════════════════════════
 * FIXTURES (cenários reais da validação manual da 4I).
 * asOfDate canônico desta etapa: 04/09/2026 (America/Sao_Paulo).
 * ═══════════════════════════════════════════════════════════ */

const HOJE = "2026-09-04";
const LIMITE = { minEntry: GUIDE_DEFAULT_MIN_ENTRY, maxExit: GUIDE_DEFAULT_MAX_EXIT };

let seq = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: seq++,
  date,
  time,
  type,
  note: null,
});

/** Pares explícitos (entrada/saída alternando). */
const dia = (date: string, times: string[]): TimeEntry[] =>
  times.map((t, i) => punch(date, t, i % 2 === 0 ? "entrada" : "saida"));

const reset = (
  entries: TimeEntry[],
  opts: { calendarEntries?: any[]; controlStart?: string } = {},
) => {
  seq = 1;
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: opts.controlStart ?? "2026-07-21" },
    entries,
    compensations: [],
    absences: [],
    faltas: [] as Falta[],
    companyCalendars:
      opts.calendarEntries && opts.calendarEntries.length > 0
        ? [{
            id: "2026-05-01",
            cycleStart: "2026-05-01",
            cycleEnd: "2027-04-30",
            cycleLabel: "2026/2027",
            version: 1,
            importedAt: "2026-05-01",
            entries: opts.calendarEntries,
          }]
        : undefined,
    excessReasons: [],
    specialExcessUses: [],
    specialExcessPlans: [],
    periodConsolidations: [],
    annualCycleClosures: [],
  });
};

const calEvento = (
  date: string,
  tratamento: string,
  horasACompensar: number,
  jornada: number,
  abonadas: number,
  descricao = "Evento calendário",
) => ({
  id: 1,
  date,
  descricao,
  categoria: tratamento === "ABONADO" ? "Feriado Nacional" : "Compensação 8 Horas",
  tratamento,
  horasACompensar,
  jornadaEsperadaHoras: jornada,
  horasAbonadas: abonadas,
  observacao: null,
});

const guia = (period: { from: string; to: string }, today: string = HOJE, limits = LIMITE) => {
  const d = getAppData();
  return buildPointGuideView({
    period,
    today,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate,
    uses: d.specialExcessUses ?? [],
    plans: d.specialExcessPlans ?? [],
    consolidations: d.periodConsolidations,
    limits,
  });
};

const rowDo = (v: ReturnType<typeof guia>, date: string) => {
  const row = v.days.find((x) => x.date === date);
  assert.ok(row, `dia ${date} presente no Guia`);
  return row;
};

/** Cenário-âncora da validação: 25/08/2026 (terça), “Folga a compensar”,
 *  8h de obrigação, NENHUMA batida, asOf 04/09/2026. */
const setupCompensarPassado = (extraEntries: TimeEntry[] = []) =>
  reset([...dia("2026-08-12", ["07:30", "12:00", "13:00", "19:10"]), ...dia("2026-08-13", ["07:00", "12:00", "13:00", "19:00"]), ...extraEntries], {
    calendarEntries: [calEvento("2026-08-25", "COMPENSAR", 8, 0, 0, "Folga a compensar")],
    controlStart: "2026-07-21",
  });

const PERIODO_25_08 = { from: "2026-08-21", to: "2026-09-20" };

/* ═══════════════════════════════════════════════════════════
 * T01–T20
 * ═══════════════════════════════════════════════════════════ */

check("T01 — 25/08 passado COMPENSAR sem batidas NÃO contém “Aguardando registro real”", () => {
  setupCompensarPassado();
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  assert.ok(row.suggestion.message, "mensagem presente");
  assert.ok(!row.suggestion.message!.includes("Aguardando registro real"), "nunca “Aguardando registro real” em dia já passado");
  assert.ok(!row.suggestion.message!.includes("antes do fato"), "nunca “antes do fato” em dia realizado");
  assert.ok(row.suggestion.message!.includes("Folga a compensar realizada sem batidas"), "texto claro de folga realizada");
  assert.equal(row.suggestion.kind, "compensar-realized", "precedência temporal explícita no view model");
});

check("T02 — COMPENSAR passado mostra a obrigação canônica de 8h", () => {
  setupCompensarPassado();
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  assert.equal(row.calendarRequiredWorkMinutes, 480, "obrigação 8h vem do calendário (motor canônico)");
  assert.ok(row.suggestion.message!.includes("obrigação de 8h"), "obrigação citada na orientação");
  assert.equal(row.situacao, "Folga a compensar", "situação primária preservada");
});

check("T03 — COMPENSAR passado sem trabalho mostra jornada real 0min", () => {
  setupCompensarPassado();
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  assert.equal(row.jornadaRealMinutes, 0, "0min trabalhados (fato)");
  assert.equal(row.factRealized, true, "dia tem fato suficiente (evento canônico realizado)");
  const page = pageSrc();
  assert.ok(
    page.includes("hasFacts || day.factRealized ? formatMinutes(day.jornadaRealMinutes)"),
    "card exibe jornada real do dia realizado mesmo sem batidas (0min, nunca “—” de espera)",
  );
});

check("T04 — COMPENSAR passado mostra saldo factual −8h usando o valor canônico", () => {
  setupCompensarPassado();
  const d = getAppData();
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  // Valor EXATO do motor (buildResumoDayRow) — o Guia não recalcula saldo.
  const canon = buildResumoDayRow({
    date: "2026-08-25",
    today: HOJE,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate,
  });
  assert.equal(row.saldoRegularMinutes, canon.balanceMinutes, "espelho do saldo canônico");
  assert.equal(row.saldoRegularMinutes, -480, "−8h factual");
  assert.equal(formatMinutes(row.saldoRegularMinutes), "-8h", "apresentação −8h");
  const page = pageSrc();
  assert.ok(page.includes("Saldo factual:"), "linha “Saldo factual” presente no card");
  assert.ok(page.includes("day.suggestion.kind === \"compensar-realized\""), "linha exibida pela situação canônica");
  assert.ok(!row.attention, "Guia não cria pendência onde o fato já existe");
});

check("T05 — COMPENSAR passado sem batidas não inventa horários", () => {
  setupCompensarPassado();
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  assert.deepEqual(row.realPunches, [], "nenhuma batida real");
  assert.deepEqual(row.suggestion.punches, [], "nenhuma batida sugerida/inventada");
  assert.ok(!/08:00|17:45/.test(row.suggestion.message!), "mensagem não sugere par fictício nos limites");
});

check("T06 — COMPENSAR futuro continua sem déficit factual antecipado", () => {
  reset([], {
    calendarEntries: [calEvento("2026-09-15", "COMPENSAR", 8, 0, 0, "Folga a compensar futura")],
    controlStart: "2026-07-21",
  });
  const row = rowDo(guia(PERIODO_25_08), "2026-09-15");
  assert.equal(row.realized, false, "dia ainda não aconteceu (date <= today é o corte canônico)");
  assert.equal(row.past, false, "data futura jamais “encerrada”");
  assert.equal(row.suggestion.kind, "future", "precedência A) do §12 preservada");
  assert.equal(row.suggestion.message, "Futuro não é realizado — aguarde a realização do dia.");
  assert.equal(row.saldoRegularMinutes, 0, "sem déficit factual antecipado");
  assert.deepEqual(row.suggestion.punches, [], "sem batidas sugeridas para o futuro");
  assert.equal(row.jornadaRealMinutes, 0);
  assert.equal(row.totalNoPontoMinutes, 0, "projeção não é inflada antes do fato");
});

check("T07 — Dia atual em andamento não ganha déficit prematuro", () => {
  reset([], {
    calendarEntries: [calEvento("2026-09-04", "COMPENSAR", 8, 0, 0, "Folga a compensar hoje")],
    controlStart: "2026-07-21",
  });
  const row = rowDo(guia(PERIODO_25_08), "2026-09-04");
  assert.equal(row.past, false, "HOJE não é “passado encerrado” — precedência B) do §12");
  assert.notEqual(row.suggestion.kind, "compensar-realized", "não aplica o texto de folga realizada em dia em curso");
  assert.equal(row.saldoRegularMinutes, 0, "guarda canônico calendarEventPendingToday: saldo 0, nunca −8h prematuro");
  assert.equal(row.saldoLabel, "0min", "apresentação neutra em andamento");
  assert.ok(!row.suggestion.message!.includes("Folga a compensar realizada sem batidas"));
  assert.deepEqual(row.suggestion.punches, [], "nada inventado antes do fim do dia");
});

check("T08 — Dia passado normal sem registro continua “Precisa de atenção”", () => {
  setupCompensarPassado();
  // 26/08/2026 (quarta) dentro do controle, dia útil, sem batidas e sem calendário.
  const row = rowDo(guia(PERIODO_25_08), "2026-08-26");
  assert.equal(row.missingExpected, true, "classificador canônico 4D.5 preservado");
  assert.ok(row.attention, "C) do §12: passado normal sem registro continua atenção");
  assert.equal(row.situacao, "Sem registro");
  assert.ok(row.suggestion.message!.includes("Sem registro — resolva o fato antes de uma orientação de lançamento."), "texto canônico preservado");
});

check("T09 — Fora do controle + sem registro NÃO contém “Aguardando registro real”", () => {
  reset([], { controlStart: "2026-07-21" });
  const v = guia({ from: "2026-04-21", to: "2026-04-30" });
  for (const date of ["2026-04-21", "2026-04-22"]) {
    const row = rowDo(v, date);
    assert.ok(row.suggestion.message, "mensagem presente");
    assert.ok(!row.suggestion.message!.includes("Aguardando registro real"), `${date} não “aguarda” um fato que o controle não cobre`);
    assert.ok(!row.suggestion.message!.includes("antes do fato"), `${date} não usa a semântica de espera em passado fora do controle`);
    assert.equal(row.suggestion.kind, "out-of-control", `${date}: precedência E) explícita`);
  }
});

check("T10 — Fora do controle + sem registro mostra orientação neutra", () => {
  reset([], { controlStart: "2026-07-21" });
  const row = rowDo(guia({ from: "2026-04-21", to: "2026-04-30" }), "2026-04-22");
  assert.equal(row.suggestion.message, "Fora do controle — nenhuma orientação de lançamento necessária.");
  assert.equal(row.situacao, "Fora do controle", "classificação primária já correta é preservada");
  assert.equal(row.missingExpected, false, "não vira “Sem registro”");
});

check("T11 — Fora do controle não inventa déficit/batidas/obrigação (e fato histórico é preservado)", () => {
  reset(dia("2026-04-22", ["08:00", "12:00", "13:00", "17:00"]), { controlStart: "2026-07-21" });
  const v = guia({ from: "2026-04-21", to: "2026-04-30" });
  const vazio = rowDo(v, "2026-04-21");
  assert.deepEqual(vazio.realPunches, [], "sem batida inventada");
  assert.deepEqual(vazio.suggestion.punches, [], "sem orientação de lançamento fabricada");
  assert.equal(vazio.calendarRequiredWorkMinutes, 0, "sem obrigação inventada (faixa de calendário não é exibida)");
  assert.equal(vazio.calendarCreditMinutes, 0, "sem crédito inventado");
  assert.equal(vazio.calendarLabel, null, "sem rótulo de calendário fabricado");
  assert.equal(vazio.status, "empty", "classificação canônica preservada (via resumoTableStatus)");
  assert.equal(vazio.factRealized, false, "sem fato: card mostra “Jornada real: —”, nunca 0h de jornada fabricada");
  assert.equal(vazio.jornadaRealMinutes, 0, "0min trabalhados é o fato; o Guia não cria déficit próprio");
  assert.equal(vazio.totalNoPontoMinutes, 0, "projeção do Guia não antecipa nada fora do controle");
  assert.equal(vazio.specialAppliedMinutes, 0, "nenhum uso/inversão de [10+] criado pela exibição");
  assert.equal(vazio.attention, false, "NÃO é “Precisa de atenção” só por estar vazio antes do controlStartDate");
  assert.equal(vazio.missingExpected, false, "pendência não inventada");
  // Apresentação: a linha “Saldo factual” é restrita às situações em que o
  // FATO canônico existe (compensar realizado / manual sem âncora) — nunca
  // para fora do controle.
  const page = pageSrc();
  assert.ok(
    page.includes("(day.suggestion.kind === \"compensar-realized\" ||"),
    "Saldo factual exibido SOMENTE por situação factual explícita",
  );
  // Registro histórico real ANTES do início do controle continua exibível.
  const historico = rowDo(v, "2026-04-22");
  assert.deepEqual(historico.realPunches, ["08:00", "12:00", "13:00", "17:00"], "fatos existentes preservados");
  assert.equal(historico.jornadaRealMinutes, 480);
  assert.equal(historico.suggestion.kind, "same", "orientação normal do dia histórico intacta");
});

check("T12 — [10+] 30min usado em COMPENSAR passado sem batidas mantém orientação manual", () => {
  setupCompensarPassado();
  assert.ok(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE }).ok,
    "uso 30min criado (motor inalterado — só o cenário da validação manual)",
  );
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  assert.equal(row.situacao, "Requer orientação manual", "F) do §12 preservado");
  assert.equal(row.suggestion.kind, "manual");
  assert.equal(row.specialUsedMinutes, 30);
  assert.equal(row.totalNoPontoMinutes, 30, "total considerado no ponto: 30min (projeção canônica)");
  assert.equal(row.suggestion.remainingMinutes, 30, "ainda a representar: 30min");
  assert.ok(row.attention);
  assert.ok(!row.suggestion.message!.includes("Aguardando registro real"));
});

check("T13 — T12 expõe saldo factual −8h e saldo projetado −7h30 vindos da projeção canônica", () => {
  setupCompensarPassado();
  assert.ok(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE }).ok,
  );
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  // Espelhos dos motores: factual = buildResumoDayRow.balanceMinutes;
  // projetado = projectRealizedDayOfficial.projectedBalanceMinutes. Nada é
  // recalculado no Guia.
  assert.equal(row.saldoRegularMinutes, -480, "saldo factual canônico");
  assert.equal(row.saldoProjetadoMinutes, row.projection.projectedBalanceMinutes, "saldo projetado é ECO da projeção 3A");
  assert.equal(row.saldoProjetadoMinutes, -450, "−7h30");
  assert.equal(formatMinutes(row.saldoRegularMinutes), "-8h");
  assert.equal(formatMinutes(row.saldoProjetadoMinutes), "-7h30");
  const page = pageSrc();
  assert.ok(page.includes("Saldo factual:"), "linha de saldo factual no card");
  assert.ok(page.includes("Saldo projetado: {formatMinutes(day.saldoProjetadoMinutes)}"), "linha de saldo projetado ligada ao espelho canônico");
});

check("T14 — T12 não cria par fictício de batidas", () => {
  setupCompensarPassado();
  assert.ok(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-25", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE }).ok,
  );
  const row = rowDo(guia(PERIODO_25_08), "2026-08-25");
  assert.deepEqual(row.realPunches, [], "nenhuma batida real inventada");
  assert.deepEqual(row.suggestion.punches, [], "nenhum par 08:00–08:30 sugerido");
  assert.deepEqual(
    getAppData().entries.filter((e) => e.date === "2026-08-25"),
    [],
    "leitura do Guia não persiste batida alguma (read-only)",
  );
});

check("T15 — Período futuro NÃO mostra “Período futuro” + “Em andamento” simultaneamente", () => {
  reset([], { controlStart: "2026-07-21" });
  const v = guia({ from: "2026-10-21", to: "2026-11-20" });
  assert.equal(v.periodFuture, true, "período 21/10→20/11 é futuro em 04/09");
  assert.equal(v.stateLabel, "Período futuro", "rótulo único e equivalente");
  assert.ok(!v.stateLabel.includes("Em andamento"), "contradição eliminada");
  // Motor 4G intocado: o ID canônico do estado permanece o que o motor deriva
  // (a correção é SOMENTE de apresentação na camada do Guia).
  assert.equal(typeof v.state, "string");
  const page = pageSrc();
  assert.ok(page.includes("!view.periodFuture &&"), "badge de estado 4G é suprimido para período futuro");
  assert.ok(page.includes("PERIOD_CONSOLIDATION_LABEL"), "estado continua derivado do motor 4G (nunca status manual)");
});

check("T16 — Período atual continua mostrando “Em andamento”", () => {
  reset([], { controlStart: "2026-07-21" });
  const v = guia(getPointPeriod(HOJE)); // 21/08→20/09 com today 04/09
  assert.equal(v.periodFuture, false);
  assert.equal(v.state, "em-andamento", "sem pendências bloqueantes e hoje dentro do período");
  assert.equal(v.stateLabel, "Em andamento");
});

check("T17 — Período passado consolidado continua mostrando “Consolidado”", () => {
  const entries: TimeEntry[] = [];
  let cur = "2026-07-21";
  while (cur <= "2026-08-20") {
    const wd = parseDate(cur).getDay();
    if (wd !== 0 && wd !== 6) {
      entries.push(
        punch(cur, "08:00", "entrada"),
        punch(cur, "12:00", "saida"),
        punch(cur, "13:00", "entrada"),
        punch(cur, "17:00", "saida"),
      );
    }
    cur = addDays(cur, 1);
  }
  reset(entries, { controlStart: "2026-07-01" });
  assert.ok(
    actions.consolidatePeriod({ periodStart: "2026-07-21", periodEnd: "2026-08-20", asOfDate: HOJE }).ok,
    "consolidação ok",
  );
  const v = guia({ from: "2026-07-21", to: "2026-08-20" });
  assert.equal(v.periodFuture, false);
  assert.equal(v.state, "consolidado", "motor 4G inalterado");
  assert.equal(v.stateLabel, "Consolidado");
});

check("T18 — Dia >10h: texto do excedente retirado ≠ dia que RECEBE [10+]", () => {
  setupCompensarPassado([
    ...dia("2026-08-26", ["07:00", "12:00", "13:00", "19:30"]), // 11h30 → [10+] gerado 1h30
    ...dia("2026-08-27", ["08:00", "12:00", "13:00", "16:30"]), // 7h30 → recebe 30min
  ]);
  assert.ok(
    actions.createSpecialExcessUse({ destinationDate: "2026-08-27", minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE }).ok,
  );
  const v = guia(PERIODO_25_08);
  const acima = rowDo(v, "2026-08-26");
  assert.equal(acima.suggestion.kind, "origin-reduction", "dia >10h: última saída reduzida");
  assert.deepEqual(acima.suggestion.punches, ["07:00", "12:00", "13:00", "18:00"]);
  assert.equal(acima.suggestion.representableMinutes, 90, "1h30 fora da sugestão");
  const recebe = rowDo(v, "2026-08-27");
  assert.equal(recebe.suggestion.kind, "addition", "dia abaixo da base com [10+] utilizado");
  assert.equal(recebe.suggestion.representableMinutes, 30);
  // Os dois textos distintos na apresentação (as duas situações nunca se misturam).
  const page = pageSrc();
  assert.ok(page.includes("Excedente [10+] fora da sugestão:"), "G) texto claro para excedente RETIRADO");
  assert.ok(page.includes("Representado nas batidas sugeridas:"), "texto mantido para [10+] REPRESENTADO na sugestão");
  assert.ok(page.includes("day.suggestion.kind === \"origin-reduction\""), "distinção feita por kind, sem ambiguidade");
});

check("T19 — Filtros continuam exatamente Todos / Prontos / Atenção (nomes e lógica)", () => {
  const page = pageSrc();
  assert.ok(page.includes('["todos", "Todos"]'), "Todos preservado");
  assert.ok(page.includes('["prontos", "Prontos"]'), "Prontos preservado");
  assert.ok(page.includes('["atencao", "Atenção"]'), "Atenção preservado");
  assert.ok(page.includes('if (filter === "prontos") return d.realized && d.ready;'), "lógica Prontos inalterada");
  assert.ok(page.includes('if (filter === "atencao") return d.realized && d.attention;'), "lógica Atenção inalterada");
  // Sem novos filtros nem persistência de preferência.
  const filterCount = (page.match(/\["(todos|prontos|atencao)",/g) ?? []).length;
  assert.equal(filterCount, 3, "exatamente três filtros");
});

check("T20 — Cards compactados sem overflow em 320/360/412 e ações acessíveis", () => {
  const page = pageSrc();
  // Compactação: padding inferior do card reduzido, faixa contextual e ações coladas ao conteúdo.
  assert.ok(/<article className="rounded-2xl border border-slate-200 bg-white px-4 pt-4 pb-2\.5 shadow-sm">/.test(page), "padding-bottom do card compactado (p-4 → px-4 pt-4 pb-2.5)");
  assert.ok(page.includes("mt-2 grid gap-2.5 md:grid-cols-2"), "gap principal→contexto compactado");
  assert.ok(page.includes("mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-slate-50 px-3 py-1.5"), "faixa de contexto compacta (folga/abonado/feriado/crédito)");
  assert.ok(page.includes("mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2"), "botões sobem (margem/padding da área de ações reduzidos)");
  assert.ok(!page.includes("mt-3 flex flex-wrap gap-2 border-t"), " corredor vazio acima dos botões removido");
  // Mesma compactação nos blocos de atenção e [10+].
  assert.ok(page.includes("mt-2 flex items-start gap-2 rounded-xl border border-rose-300"), "faixa de atenção compactada");
  assert.ok(page.includes("mt-2 flex flex-wrap gap-1.5"), "chips [10+] colados ao conteúdo");
  // Mobile 320/360/412: nada pode gerar overflow horizontal.
  assert.ok(!page.includes("min-w-["), "nenhuma largura fixa mínima");
  assert.ok(!page.includes("overflow-x"), "nenhum scroll horizontal");
  assert.ok(!page.includes("w-screen"), "nenhuma largura de viewport");
  assert.ok(!page.includes("<table"), "layout em cards, não tabela larga");
  assert.ok(!/<article[^>]*h\[-/.test(page) && !page.includes('className="h-['), "card sem altura fixa (quebra natural do texto)");
  assert.ok(page.includes("break-words"), "textos quebram linha sem cortar");
  assert.ok(page.includes("min-w-0"), "colunas fluidas encolhíveis (sem cortar badges)");
  assert.ok(page.includes("flex flex-wrap gap-1.5"), "chips quebram em linhas");
  assert.ok(page.includes("md:grid-cols-2"), "duas colunas apenas a partir de md");
  // Ações continuam presentes e acessíveis.
  assert.ok(page.includes("Abrir em Registros"), "ação de leitura 1 presente");
  assert.ok(page.includes("Ver no Resumo"), "ação de leitura 2 presente");
  assert.ok(page.includes("inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold"), "botões mantêm área de toque e contraste após compactação");
});

console.log(`\n4I.1 — ${passed}/20 verificações concluídas.`);
if (passed !== 20) process.exit(1);
