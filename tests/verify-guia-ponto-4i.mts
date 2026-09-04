/**
 * VERIFICAÇÃO — ETAPA 4I: NOVA PÁGINA “GUIA DO PONTO”.
 *
 * Visão única READ-ONLY para alimentar o sistema oficial: batidas reais +
 * batidas sugeridas, sempre ancoradas nos motores canônicos (buildResumoDayRow,
 * companyDayContext, attention-now, buildSpecialExcessBank, SpecialExcessUse/
 * Plan e projectRealizedDayOfficial). O helper de sugestão é DERIVADO: não
 * recalcula saldo, necessidade, [10+], projeção nem consolidação.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-guia-ponto-4i.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildPointGuideView,
  guideLimitsOf,
  GUIDE_DEFAULT_MAX_EXIT,
  GUIDE_DEFAULT_MIN_ENTRY,
  isValidCivilTime,
} from "../src/lib/point-guide.ts";
import { getPointPeriod, getPreviousPointPeriod, getNextPointPeriod } from "../src/lib/periods.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { BACKUP_VERSION, buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { addDays, parseDate, toMinutes } from "../src/lib/time.ts";
import type { Falta, TimeEntry, User } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (p: string) => readFileSync(join(root, p), "utf8");
const pageSrc = () => srcOf("src/app/(app)/guia-ponto/page.tsx");
const configSrc = () => srcOf("src/app/(app)/configuracoes/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ═══════════════════════════════════════════════════════════
 * FIXTURES — ciclo 2026/2027 (01/05/2026→30/04/2027).
 * Origens de [10+] ANTES dos destinos para o banco existir no corte:
 *   · 10/08 07:30–19:10 → 10h40 ⇒ [10+] 40min
 *   · 11/08 07:00–19:00 → 11h   ⇒ [10+] 60min  (total 100min)
 * ═══════════════════════════════════════════════════════════ */

const HOJE = "2026-08-25";
const PERIODO = { from: "2026-08-01", to: "2026-08-20" };

let seq = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: seq++,
  date,
  time,
  type,
  note: null,
});

const origens = (): TimeEntry[] => [
  punch("2026-08-10", "07:30", "entrada"),
  punch("2026-08-10", "12:00", "saida"),
  punch("2026-08-10", "13:00", "entrada"),
  punch("2026-08-10", "19:10", "saida"),
  punch("2026-08-11", "07:00", "entrada"),
  punch("2026-08-11", "12:00", "saida"),
  punch("2026-08-11", "13:00", "entrada"),
  punch("2026-08-11", "19:00", "saida"),
];

/** Dias com pares explícitos (times em sequência entrada/saída/…). */
const dia = (date: string, times: string[]): TimeEntry[] =>
  times.map((t, i) => punch(date, t, i % 2 === 0 ? "entrada" : "saida"));

const reset = (
  entries: TimeEntry[],
  opts: { calendarEntries?: any[]; controlStart?: string } = {},
) => {
  seq = 1;
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: opts.controlStart ?? "2026-05-01" },
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

const limiteDefault = { minEntry: GUIDE_DEFAULT_MIN_ENTRY, maxExit: GUIDE_DEFAULT_MAX_EXIT };

const guia = (
  period: { from: string; to: string },
  today: string,
  limits = limiteDefault,
) => {
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

const calEvento = (date: string, tratamento: string, horasACompensar: number, jornada: number, abonadas: number, descricao = "Evento calendário") => ({
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

/* ═══════════════════════════════════════════════════════════
 * T01–T36
 * ═══════════════════════════════════════════════════════════ */

check("T01 — Rota /guia-ponto existe e menu mostra “Guia do Ponto”", () => {
  const page = pageSrc();
  assert.ok(page.includes("GUIA DO PONTO"), "título da página presente");
  assert.ok(page.includes("Veja suas batidas e o que considerar ao lançar o período no sistema oficial."), "descrição curta presente");
  const shell = srcOf("src/components/app-shell.tsx");
  assert.ok(shell.includes('href: "/guia-ponto"'), "rota no menu lateral");
  assert.ok(shell.includes('label: "Guia do Ponto"'), "nome visível no menu lateral");
});

check("T02 — Período usa boundaries canônicos, inclusive 21/04→30/04 e 01/05→20/05", () => {
  const page = pageSrc();
  assert.ok(page.includes("from \"@/lib/periods\""), "helpers de período importados");
  assert.ok(page.includes("getPointPeriod") && page.includes("getPreviousPointPeriod") && page.includes("getNextPointPeriod"), "navegação usa os helpers canônicos");
  assert.deepEqual(getPointPeriod("2026-04-21"), { from: "2026-04-21", to: "2026-04-30" }, "21/04→30/04");
  assert.deepEqual(getPointPeriod("2026-05-05"), { from: "2026-05-01", to: "2026-05-20" }, "01/05→20/05");
  assert.deepEqual(getPreviousPointPeriod({ from: "2026-05-01", to: "2026-05-20" }), { from: "2026-04-21", to: "2026-04-30" }, "anterior especial");
  assert.deepEqual(getNextPointPeriod({ from: "2026-04-21", to: "2026-04-30" }), { from: "2026-05-01", to: "2026-05-20" }, "seguinte especial");
});

check("T03 — Dia normal mostra todas as batidas reais", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "13:00", "17:00"])]);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.realPunches, ["08:00", "12:00", "13:00", "17:00"], "todas as 4 batidas reais");
  assert.equal(row.punchCount, 4);
  assert.equal(row.jornadaRealMinutes, 480);
});

check("T04 — Dia normal sugere exatamente as mesmas batidas", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "13:00", "17:00"])]);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.suggestion.kind, "same");
  assert.deepEqual(row.suggestion.punches, ["08:00", "12:00", "13:00", "17:00"]);
  assert.equal(row.suggestion.remainingMinutes, 0);
});

check("T05 — Dia 7h30 + [10+]30 estende última saída em 30min quando há capacidade", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "13:00", "16:30"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok, "uso 30min criado");
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.situacao, "[10+] utilizado");
  assert.equal(row.suggestion.kind, "addition");
  assert.deepEqual(row.suggestion.punches, ["08:00", "12:00", "13:00", "17:00"], "última saída 16:30→17:00");
  assert.equal(row.totalNoPontoMinutes, 480, "total 8h na projeção canônica");
});

check("T06 — 08:45–12 /13–17 + [10+]45 → 17:45", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:45", "12:00", "13:00", "17:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 45, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.suggestion.punches, ["08:45", "12:00", "13:00", "17:45"]);
  assert.equal(row.totalNoPontoMinutes, 480);
});

check("T07 — 09:15–12 /13–17:45 + [10+]30 → primeira entrada 08:45", () => {
  reset([...origens(), ...dia("2026-08-12", ["09:15", "12:00", "13:00", "17:45"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.suggestion.punches, ["08:45", "12:00", "13:00", "17:45"], "saída no teto ⇒ antecipa entrada");
  assert.equal(row.totalNoPontoMinutes, 480);
});

check("T08 — Com saída máxima 17:30, 08:45–12 /13–17 +45 → 08:30 / … /17:30", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:45", "12:00", "13:00", "17:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 45, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE, { minEntry: "08:00", maxExit: "17:30" }), "2026-08-12");
  assert.deepEqual(row.suggestion.punches, ["08:30", "12:00", "13:00", "17:30"], "+30 saída +15 entrada");
  assert.equal(row.suggestion.representableMinutes, 45);
});

check("T09 — Primeira entrada nunca é sugerida antes do limite configurado", () => {
  reset([...origens(), ...dia("2026-08-12", ["09:30", "12:00", "13:00", "17:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE, { minEntry: "09:00", maxExit: "17:00" }), "2026-08-12");
  assert.deepEqual(row.suggestion.punches, ["09:00", "12:00", "13:00", "17:00"]);
  assert.ok(toMinutes(row.suggestion.punches[0]) >= toMinutes("09:00"), "nunca antes do limite");
});

check("T10 — Última saída nunca é estendida além do limite configurado", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:50", "12:00", "13:00", "16:50"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 60, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE, { minEntry: "08:00", maxExit: "17:20" }), "2026-08-12");
  assert.equal(toMinutes(row.suggestion.punches[3]), toMinutes("17:20"), "clamp no teto de saída");
  assert.ok(toMinutes(row.suggestion.punches[3]) <= toMinutes("17:20"), "nunca além do limite");
  assert.equal(row.suggestion.remainingMinutes, 0);
});

check("T11 — Batida REAL anterior à entrada mínima não é empurrada para frente", () => {
  reset([...origens(), ...dia("2026-08-12", ["07:45", "12:00", "13:00", "16:15"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.suggestion.punches[0], "07:45", "entrada real preservada");
  assert.deepEqual(row.suggestion.punches, ["07:45", "12:00", "13:00", "16:45"]);
});

check("T12 — Batida REAL posterior à saída máxima não é reduzida por causa da configuração", () => {
  reset([...origens(), ...dia("2026-08-12", ["10:00", "12:00", "13:00", "18:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.suggestion.punches[3], "18:00", "saída real posterior ao teto mantida");
  assert.equal(row.suggestion.punches[0], "09:30", "capacidade usada na entrada");
  assert.equal(row.realPunches[3], "18:00", "batida real intacta");
});

check("T13 — Se limites não comportam todo [10+], mostra “Ajuste manual necessário”", () => {
  reset([...origens(), ...dia("2026-08-12", ["09:00", "12:00", "13:00", "17:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE, { minEntry: "09:00", maxExit: "17:15" }), "2026-08-12");
  assert.equal(row.suggestion.kind, "manual", "orientação manual");
  assert.ok(row.suggestion.message.includes("Ajuste manual necessário"), "mensagem exata");
  assert.equal(row.suggestion.remainingMinutes, 15, "sobra 15min");
  assert.equal(row.suggestion.representableMinutes, 15, "representável 15min");
  assert.equal(row.specialUsedMinutes, 30, "total [10+] utilizado exposto");
  assert.ok(row.attention, "PRECISA DE ATENÇÃO");
});

check("T14 — No T13 não inventa intervalo nem novas batidas intermediárias", () => {
  reset([...origens(), ...dia("2026-08-12", ["09:00", "12:00", "13:00", "17:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE, { minEntry: "09:00", maxExit: "17:15" }), "2026-08-12");
  assert.equal(row.suggestion.punches.length, 4, "mesmo nº de batidas (nenhuma nova)");
  assert.deepEqual(row.suggestion.punches.slice(1, 3), ["12:00", "13:00"], "intervalo real 12→13 preservado");
  assert.deepEqual(row.realPunches, ["09:00", "12:00", "13:00", "17:00"], "batidas reais intocadas");
});

check("T15 — [10+] utilizado sem nenhuma batida real não cria par fictício", () => {
  reset(origens(), {
    calendarEntries: [calEvento("2026-08-12", "COMPENSAR", 8, 0, 0)],
  });
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-13" }).ok, "uso 30min em folga a compensar");
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.realPunches, [], "Nenhuma batida");
  assert.equal(row.specialUsedMinutes, 30);
  assert.deepEqual(row.suggestion.punches, [], "nenhum par 08:00–08:30 inventado");
  assert.equal(row.suggestion.kind, "manual");
  assert.equal(row.situacao, "Requer orientação manual", "status §13");
});

check("T16 — T15 mostra projeção oficial e orientação manual", () => {
  reset(origens(), {
    calendarEntries: [calEvento("2026-08-12", "COMPENSAR", 8, 0, 0)],
  });
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-13" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.totalNoPontoMinutes, 30, "projeção canônica 30min");
  assert.equal(row.specialAppliedMinutes, 30);
  assert.ok(row.suggestion.message.includes("não existem batidas reais para ancorar"), "orientação textual §13");
  assert.ok(row.attention, "Requer orientação manual");
});

check("T17 — Dia >10h mostra jornada real completa e [10+] gerado", () => {
  reset([...origens(), ...dia("2026-08-12", ["07:00", "12:00", "13:00", "19:30"])]);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.jornadaRealMinutes, 690, "11h30 reais");
  assert.equal(row.specialGeneratedMinutes, 90, "[10+] gerado 1h30");
  assert.equal(row.situacao, "Acima do limite [10+]");
});

check("T18 — 07–12 /13–19:30 → sugestão 07–12 /13–18 para total 10h", () => {
  reset([...origens(), ...dia("2026-08-12", ["07:00", "12:00", "13:00", "19:30"])]);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.suggestion.kind, "origin-reduction");
  assert.deepEqual(row.suggestion.punches, ["07:00", "12:00", "13:00", "18:00"], "reduz apenas a última saída");
  assert.equal(row.totalNoPontoMinutes, 600, "10h no ponto (projeção canônica)");
});

check("T19 — T18 não altera a jornada real persistida", () => {
  reset([...origens(), ...dia("2026-08-12", ["07:00", "12:00", "13:00", "19:30"])]);
  const before = getAppData().entries.filter((e) => e.date === "2026-08-12").map((e) => ({ time: e.time, type: e.type }));
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.realPunches, ["07:00", "12:00", "13:00", "19:30"], "batidas reais do Guia intactas");
  const after = getAppData().entries.filter((e) => e.date === "2026-08-12").map((e) => ({ time: e.time, type: e.type }));
  assert.deepEqual(after, before, "store não foi alterado pela leitura");
});

check("T20 — Dia entre 8h e 10h mantém batidas reais na sugestão", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "13:00", "18:00"])]);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.situacao, "Normal");
  assert.deepEqual(row.suggestion.punches, ["08:00", "12:00", "13:00", "18:00"], "9h reais mantidas");
  assert.equal(row.totalNoPontoMinutes, 540);
});

check("T21 — Dia abaixo da base sem [10+] mantém batidas reais e saldo negativo informativo", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "13:00", "16:30"])]);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.situacao, "Abaixo da base");
  assert.deepEqual(row.suggestion.punches, ["08:00", "12:00", "13:00", "16:30"]);
  assert.equal(row.saldoRegularMinutes, -30, "saldo −30min informativo");
  assert.equal(row.saldoLabel, "-30min");
  assert.ok(row.ready, "continua PRONTO para lançar (§20)");
});

check("T22 — Registro incompleto fica “Precisa de atenção” e sem sugestão inventada", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "13:00"])]);
  const row = rowDo(guia(PERIODO, "2026-08-13"), "2026-08-12");
  assert.equal(row.status, "incomplete");
  assert.ok(row.attention, "PRECISA DE ATENÇÃO");
  assert.deepEqual(row.attentionCategories, ["incompleto"]);
  assert.deepEqual(row.suggestion.punches, [], "nada inventado");
  assert.equal(row.suggestion.kind, "attention");
});

check("T23 — Dia passado sem registro não recebe batidas inventadas", () => {
  reset(origens());
  const row = rowDo(guia(PERIODO, "2026-08-13"), "2026-08-12");
  assert.equal(row.situacao, "Sem registro");
  assert.ok(row.attention);
  assert.deepEqual(row.suggestion.punches, [], "nenhum par inventado");
  assert.equal(row.jornadaRealMinutes, 0);
});

check("T24 — Plano/reserva [10+] futuro não cria jornada/sugestão realizada", () => {
  reset(origens());
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-08-31", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-25" }).ok, "reserva futura criada");
  const row = rowDo(guia({ from: "2026-08-21", to: "2026-09-20" }, HOJE), "2026-08-31");
  assert.equal(row.specialReservedMinutes, 30, "[10+] reservado/planejado exposto");
  assert.equal(row.situacao, "Planejado — aguarde a realização do dia.");
  assert.equal(row.suggestion.kind, "future");
  assert.deepEqual(row.suggestion.punches, [], "nenhuma batida sugerida futura");
  assert.equal(row.jornadaRealMinutes, 0, "sem jornada realizada");
});

check("T25 — ABONADO usa tratamento canônico e não inventa batidas", () => {
  reset(origens(), {
    calendarEntries: [calEvento("2026-08-12", "ABONADO", 0, 0, 8, "Feriado")],
  });
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.situacao, "Abonado — Calendário");
  assert.equal(row.calendarCreditMinutes, 480, "crédito conforme motor atual");
  assert.equal(row.calendarAbonadoIntegral, true);
  assert.equal(row.suggestion.kind, "calendar");
  assert.deepEqual(row.suggestion.punches, [], "sem batidas inventadas");
  assert.ok(row.suggestion.message.includes("abonado pelo calendário"), "orientação textual");
});

check("T26 — COMPENSAR sem trabalho preserva obrigação canônica; sem batidas inventadas", () => {
  reset(origens(), {
    calendarEntries: [calEvento("2026-08-12", "COMPENSAR", 8, 0, 0)],
  });
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.situacao, "Folga a compensar");
  assert.equal(row.calendarRequiredWorkMinutes, 480, "obrigação factual 8h");
  assert.equal(row.saldoRegularMinutes, -480, "saldo canônico −480");
  assert.deepEqual(row.suggestion.punches, [], "nada inventado");
  assert.equal(row.jornadaRealMinutes, 0);
});

check("T27 — Calendário parcial preserva crédito/base efetiva canônica", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00"])], {
    calendarEntries: [calEvento("2026-08-12", "COMPENSAR", 4, 4, 0, "Cinzas")],
  });
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.equal(row.calendarRequiredWorkMinutes, 240, "jornada a cumprir 4h");
  assert.equal(row.calendarCreditMinutes, 240, "crédito calendário 4h");
  assert.equal(row.calendarParcial, true);
  assert.equal(row.situacao, "Calendário — parcial");
  assert.deepEqual(row.suggestion.punches, ["08:00", "12:00"], "batidas reais preservadas");
  assert.equal(row.saldoRegularMinutes, 0, "base efetiva cumprida");
});

check("T28 — Intervalos explícitos reais permanecem exatamente iguais na sugestão", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "12:00", "12:30", "16:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.suggestion.punches, ["08:00", "12:00", "12:30", "16:30"], "intervalo 12:00→12:30 intacto");
  assert.equal(toMinutes(row.suggestion.punches[2]) - toMinutes(row.suggestion.punches[1]), 30, "gap 30min preservado");
});

check("T29 — Múltiplos intervalos reais permanecem iguais", () => {
  reset([...origens(), ...dia("2026-08-12", ["08:00", "10:00", "10:30", "12:00", "13:30", "16:30"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const row = rowDo(guia(PERIODO, HOJE), "2026-08-12");
  assert.deepEqual(row.suggestion.punches, ["08:00", "10:00", "10:30", "12:00", "13:30", "17:00"], "apenas a última saída muda");
  assert.equal(row.realPunches[5], "16:30", "real intacto");
});

check("T30 — Configurações têm defaults 08:00 e 17:45", () => {
  assert.equal(GUIDE_DEFAULT_MIN_ENTRY, "08:00");
  assert.equal(GUIDE_DEFAULT_MAX_EXIT, "17:45");
  const semCampos = {} as User;
  assert.deepEqual(guideLimitsOf(semCampos), { minEntry: "08:00", maxExit: "17:45" }, "dados antigos sem campos");
  assert.ok(isValidCivilTime("08:00") && isValidCivilTime("23:59"), "horários civis válidos");
  assert.ok(!isValidCivilTime("24:00") && !isValidCivilTime("8:00") && !isValidCivilTime(""), "inválidos rejeitados");
  const cfg = configSrc();
  assert.ok(cfg.includes("Entrada mínima sugerida") && cfg.includes("Saída máxima sugerida"), "campos rotulados");
  assert.ok(cfg.includes('guideMinEntry') && cfg.includes('guideMaxExit'), "persistência nos dois campos");
});

check("T31 — Alterar Configurações afeta somente geração de sugestão, não jornada real", () => {
  reset([...origens(), ...dia("2026-08-12", ["09:30", "12:00", "13:00", "17:00"])]);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-12", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-12" }).ok);
  const v1 = guia(PERIODO, HOJE, { minEntry: "08:00", maxExit: "17:45" });
  const v2 = guia(PERIODO, HOJE, { minEntry: "09:00", maxExit: "17:00" });
  const r1 = rowDo(v1, "2026-08-12");
  const r2 = rowDo(v2, "2026-08-12");
  assert.notDeepEqual(r1.suggestion.punches, r2.suggestion.punches, "sugestão muda com os limites");
  assert.equal(r1.jornadaRealMinutes, r2.jornadaRealMinutes, "jornada real inalterada");
  assert.deepEqual(r1.realPunches, r2.realPunches, "batidas reais inalteradas");
  assert.equal(r1.totalNoPontoMinutes, r2.totalNoPontoMinutes, "projeção canônica inalterada");
});

check("T32 — Backup v3 antigo sem novos campos importa usando defaults", () => {
  const userAntigo = {
    id: 1,
    name: "Maria Helena",
    email: "meu@horario.com",
    workStart: "08:00",
    workEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    maxDailyMinutes: 600,
    autoDeductLunch: true,
    controlStartDate: "2026-05-01",
  };
  const v3 = { version: 3, exportedAt: "2026-01-01T00:00:00.000Z", user: userAntigo, entries: [], compensations: [], absences: [] };
  const parsed = parseBackup(JSON.stringify(v3));
  assert.ok(parsed.ok, "backup v3 antigo válido");
  if (!parsed.ok) return;
  assert.deepEqual(guideLimitsOf(parsed.backup.user), { minEntry: "08:00", maxExit: "17:45" }, "defaults na importação");
  assert.equal(parsed.backup.version, 3);
});

check("T33 — Backup exportado após configuração preserva os dois horários, sem bump de BACKUP_VERSION", () => {
  const data = buildSeedData();
  data.user.guideMinEntry = "08:30";
  data.user.guideMaxExit = "18:15";
  const payload = buildBackupPayload(data);
  assert.equal(payload.version, BACKUP_VERSION, "sem bump");
  assert.equal(payload.version, 3, "BACKUP_VERSION = 3");
  assert.equal(payload.user.guideMinEntry, "08:30", "entrada mínima preservada");
  assert.equal(payload.user.guideMaxExit, "18:15", "saída máxima preservada");
  const round = parseBackup(JSON.stringify(payload));
  assert.ok(round.ok, "reimportação válida");
  if (round.ok) {
    assert.equal(round.backup.user.guideMinEntry, "08:30");
    assert.equal(round.backup.user.guideMaxExit, "18:15");
  }
});

check("T34 — Guia não chama ações mutáveis do store para editar jornada/[10+]/calendário", () => {
  const page = pageSrc();
  assert.ok(!page.includes("actions."), "nenhum action do store invocado");
  assert.ok(!page.includes("import { actions"), "actions não importado");
  for (const name of ["addEntry", "updateUser", "createSpecialExcessUse", "cancelSpecialExcessUse", "createSpecialExcessPlan", "cancelSpecialExcessPlan", "consolidatePeriod", "reopenPeriod", "replaceAll", "addCompanyCalendar", "removeCompanyCalendar", "registerFalta", "addAbsence"]) {
    assert.ok(!page.includes(name), `nenhum ${name} na página`);
  }
  assert.ok(page.includes("/registros?data="), "link de leitura para Registros");
  assert.ok(page.includes("/resumo?data="), "link de leitura para Resumo");
});

check("T35 — Período consolidado aparece como Consolidado e permanece read-only", () => {
  // Período 21/07→20/08 completo (todos os dias úteis lançados) → consolidável.
  const entries: TimeEntry[] = [];
  let cur = "2026-07-21";
  while (cur <= "2026-08-20") {
    const day = parseDate(cur).getDay();
    if (day !== 0 && day !== 6) {
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
  assert.ok(actions.consolidatePeriod({ periodStart: "2026-07-21", periodEnd: "2026-08-20", asOfDate: HOJE }).ok, "consolidação ok");
  const v = guia({ from: "2026-07-21", to: "2026-08-20" }, HOJE);
  assert.equal(v.state, "consolidado");
  assert.equal(v.stateLabel, "Consolidado");
  assert.ok(v.consolidation, "snapshot ativo presente");
  assert.ok(v.days.every((d) => d.consolidated), "badge Consolidado em todos os dias");
  const page = pageSrc();
  assert.ok(page.includes("PERIOD_CONSOLIDATION_LABEL"), "estado vem do motor 4G");
  assert.ok(page.includes("Consolidado"), "rótulo visível");
  assert.ok(!page.includes("Consolidar período") && !page.includes("Reabrir período") && !page.includes("reabrir"), "nenhuma ação de consolidação/reabertura no Guia");
});

check("T36 — Estrutura mobile 320/360/412 sem overflow horizontal problemático", () => {
  const page = pageSrc();
  assert.ok(!page.includes("min-w-["), "nenhuma largura fixa mínima");
  assert.ok(!page.includes("w-screen"), "nenhuma largura de viewport");
  assert.ok(!page.includes("overflow-x"), "nenhum vetor de scroll horizontal");
  assert.ok(!page.includes("<table"), "nenhuma tabela larga (cards)",
  );
  assert.ok(page.includes("flex flex-wrap gap-1.5"), "batidas quebram em linhas (chips)");
  assert.ok(page.includes("break-words"), "textos quebram sem cortar");
  assert.ok(page.includes("md:grid-cols-2"), "lado a lado apenas a partir de md (mobile em coluna)");
  assert.ok(page.includes("flex flex-wrap items-center gap-2"), "filtros cabem no mobile");
  assert.ok(page.includes("min-w-0"), "colunas fluidas com min-w-0");
});

console.log(`\n4I — ${passed}/36 verificações concluídas.`);
if (passed !== 36) process.exit(1);
