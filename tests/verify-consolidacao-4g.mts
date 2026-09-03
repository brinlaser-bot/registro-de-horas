/**
 * VERIFICAÇÃO — ETAPA 4G: CONSOLIDAÇÃO SEGURA DO PERÍODO + REABERTURA COM
 * HISTÓRICO + REFINOS MOBILE.
 *
 * A consolidação CONGELA a fotografia do resultado considerado no oficial
 * (NUNCA transforma projeção em factual), exige ação explícita (sem
 * fechamento automático), protege por guard NO MOTOR (a UI não é segurança)
 * e preserva histórico por revisions (somente uma ACTIVE, nunca sobrescrita,
 * SEM carry-over factual para o próximo período).
 *
 * Fixture (base 4F deslocada em −28 dias — TODOS os dias ficam no passado
 * real, imunes ao relógio da máquina; hoje (asOf) = 2026-08-25 ⇒ período
 * 21/07/2026 → 20/08/2026 ENCERRADO; controlStartDate 2026-05-01):
 *   20/07 07:00–19:40 ⇒ +2h regular · [10+] +1h40 (origem, FORA do período)
 *   24/07 05:00–09:00 + 10:00–14:10 ⇒ +10min
 *   28/07 COMPENSAR integral + 08:00–17:00 ⇒ 8h, saldo 0
 *   29/07 05:00–09:00 + 10:00–12:20 ⇒ −1h40
 *   31/07 08:00–19:30 ⇒ +2h regular · [10+] +30min
 *   03/08 e 04/08 05:00–09:00 + 10:00–13:30 ⇒ −30min cada (destinos de uso)
 *   05/08 08:00–12:00 + 13:00–17:00 ⇒ 8h, saldo 0 (dia completo)
 *   10/08 ABONADO (feriado — neutro, sem batida)
 *   Demais dias úteis do período: neutros (08:00–12:00 + 13:00–17:00)
 *   BASE: 27/07 incompleto (08:00, 12:00, 13:00) · 30/07 sem registro
 *   LIMPO: 27/07 e 30/07 completos ⇒ 0 pendências
 *   Usos: 03/08 30min (fifo, asOf 02/08) · 04/08 30min (fifo, asOf 03/08)
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-consolidacao-4g.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import {
  buildResumoPeriodView,
  resumoPeriodPendencies,
  resumoSpecialPeriodMovement,
} from "../src/lib/resumo-period-view.ts";
import {
  activeConsolidationForPeriod,
  consolidationLockForDate,
  consolidationLockCoveringRange,
  periodConsolidationState,
  PERIOD_CONSOLIDATION_LABEL,
} from "../src/lib/period-consolidation.ts";
import { getPointPeriod, getAnnualPointCycle, annualCycleBounds } from "../src/lib/periods.ts";
import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { BACKUP_COLLECTIONS } from "../src/lib/backup.ts";
import type { TimeEntry, Falta } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = () => src("src/app/(app)/resumo/page.tsx");
const registros = () => src("src/app/(app)/registros/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Fixture Backup B (4G) ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const HOJE = "2026-08-25";
const PERIOD = { from: "2026-07-21", to: "2026-08-20" };
const CALENDARIO = [
  {
    id: 1, cycleStart: "2026-05-01", cycleEnd: "2027-04-30", cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
    entries: [
      { id: 1, date: "2026-07-28", descricao: "Compensado", categoria: "Compensação 8 Horas", tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null },
      { id: 2, date: "2026-08-10", descricao: "Feriado", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null },
    ],
  },
];
const diaNeutro = (date: string): TimeEntry[] => [
  punch(date, "08:00", "entrada"), punch(date, "12:00", "saida"),
  punch(date, "13:00", "entrada"), punch(date, "17:00", "saida"),
];
/** BASE: 27/07 incompleto + 30/07 sem registro; demais dias úteis completos. */
const batidasBase = () => [
  punch("2026-07-20", "07:00", "entrada"), punch("2026-07-20", "19:40", "saida"),
  punch("2026-07-24", "05:00", "entrada"), punch("2026-07-24", "09:00", "saida"), punch("2026-07-24", "10:00", "entrada"), punch("2026-07-24", "14:10", "saida"),
  punch("2026-07-27", "08:00", "entrada"), punch("2026-07-27", "12:00", "saida"), punch("2026-07-27", "13:00", "entrada"),
  ...diaNeutro("2026-07-28"),
  punch("2026-07-29", "05:00", "entrada"), punch("2026-07-29", "09:00", "saida"), punch("2026-07-29", "10:00", "entrada"), punch("2026-07-29", "12:20", "saida"),
  punch("2026-07-31", "08:00", "entrada"), punch("2026-07-31", "19:30", "saida"),
  punch("2026-08-03", "05:00", "entrada"), punch("2026-08-03", "09:00", "saida"), punch("2026-08-03", "10:00", "entrada"), punch("2026-08-03", "13:30", "saida"),
  punch("2026-08-04", "05:00", "entrada"), punch("2026-08-04", "09:00", "saida"), punch("2026-08-04", "10:00", "entrada"), punch("2026-08-04", "13:30", "saida"),
  ...diaNeutro("2026-08-05"),
].concat(CAUDA.flatMap(diaNeutro));
/** Dias úteis do período sem batida própria (08-10 é ABONADO — neutro). */
const CAUDA = ["2026-07-21", "2026-07-22", "2026-07-23", "2026-08-06", "2026-08-07", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
/** LIMPO: 27/07 e 30/07 completos ⇒ 0 pendências bloqueantes. */
const batidasLimpo = () => batidasBase()
  .filter((e) => e.date !== "2026-07-27")
  .concat([...diaNeutro("2026-07-27"), ...diaNeutro("2026-07-30")]);
const reset = (batidas: TimeEntry[]) => {
  nextId = 1;
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: "2026-05-01" },
    entries: batidas,
    compensations: [], absences: [], faltas: [] as Falta[],
    companyCalendars: CALENDARIO,
    excessReasons: [
      { id: 1, date: "2026-07-20", reason: "demanda-urgente", customReason: null, observation: null, createdAt: 1722000000000, updatedAt: 1722000000000 },
      { id: 2, date: "2026-07-31", reason: "demanda-urgente", customReason: null, observation: null, createdAt: 1722000000000, updatedAt: 1722000000000 },
    ],
    specialExcessUses: [], specialExcessPlans: [],
  });
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-03", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-03" }).ok, "uso 03/08");
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-04", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-04" }).ok, "uso 04/08");
};
const resetLimpo = () => reset(batidasLimpo());
/** Consolida a fixture limpa (rev. 1) e devolve o snapshot ativo. */
const consolidarLimpo = () => {
  resetLimpo();
  const r = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727300000000 });
  assert.ok(r.ok, `consolidação limpa: ${!r.ok ? r.error : ""}`);
  return activeConsolidationForPeriod(getAppData().periodConsolidations, PERIOD.from, PERIOD.to)!;
};
const st = () => getAppData();
const S = () => settingsOf(st().user);
const view = () =>
  buildResumoPeriodView({
    period: PERIOD, today: HOJE, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
const pend = () =>
  resumoPeriodPendencies({
    today: HOJE, period: PERIOD, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01", plans: st().specialExcessPlans ?? [],
  });
const movement = () =>
  resumoSpecialPeriodMovement({
    period: PERIOD, today: HOJE, cycle: getAnnualPointCycle(HOJE), entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
const MSG_PERIODO = "Período consolidado — reabra o período no Resumo para editar.";
const MSG_USO = "Uso protegido por período consolidado.";
const MSG_CALENDARIO = "Este calendário altera um período consolidado. Reabra o período antes de modificar essas datas.";

/* ════════ ESTADOS DERIVADOS (sem status manual) ════════ */

check("TESTE 01 DE 24 — Período atual (today ≤ fim, sem consolidação) ⇒ Em andamento", () => {
  reset(batidasBase());
  const estado = periodConsolidationState({
    today: "2026-08-01", periodStart: PERIOD.from, periodEnd: PERIOD.to,
    consolidations: st().periodConsolidations, blockedCount: pend().total,
  });
  assert.equal(estado, "em-andamento");
  assert.equal(PERIOD_CONSOLIDATION_LABEL[estado], "Em andamento");
  // Nunca há fechamento automático: mesmo com pendências, passar do dia só encerra temporalmente.
  const p = page();
  assert.ok(p.includes("PERIOD_CONSOLIDATION_LABEL"), "rótulos da máquina de estados na página");
  assert.ok(!p.includes("fecharPeríodo") && !p.includes("setPeriodoFechado"), "nenhum fechamento manual");
});

check("TESTE 02 DE 24 — Encerrado com 2 pendências bloqueantes ⇒ estado + consolidação recusada", () => {
  reset(batidasBase());
  assert.equal(periodConsolidationState({
    today: HOJE, periodStart: PERIOD.from, periodEnd: PERIOD.to,
    consolidations: st().periodConsolidations, blockedCount: pend().total,
  }), "encerrado-com-pendencias");
  assert.equal(pend().total, 2, "27/07 incompleto + 30/07 sem registro (resto do período neutro; 10/08 ABONADO nunca pende)");
  assert.ok(pend().incompleto.includes("2026-07-27"));
  assert.ok(pend()["semRegistro"].includes("2026-07-30"));
  assert.equal(pend()["semRegistro"].length, 1);
  const r = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE });
  assert.ok(!r.ok);
  assert.equal(r.error, "Resolva as pendências antes de consolidar este período.");
  assert.equal(activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to), null, "nada consolidado");
});

check("TESTE 03 DE 24 — Encerrado sem pendências ⇒ Pronto para consolidar + CTA só com periodEnd < today", () => {
  resetLimpo();
  assert.equal(pend().total, 0);
  assert.equal(periodConsolidationState({
    today: HOJE, periodStart: PERIOD.from, periodEnd: PERIOD.to,
    consolidations: st().periodConsolidations, blockedCount: 0,
  }), "pronto-para-consolidar");
  const p = page();
  assert.ok(p.includes('estadoPeriodo === "pronto-para-consolidar" && ('), "CTA condicional");
  assert.ok(p.includes("Consolidar período"), "CTA de consolidação");
  assert.ok(p.includes("Resolva as pendências antes de consolidar este período."), "mensagem com pendências");
  assert.ok(p.includes("Revisar em Registros"), "CTA Revisar em Registros");
});

check("TESTE 04 DE 24 — Cada pendência bloqueia: inconsistente · incompleto · sem-registro · plano [10+]", () => {
  // (a) INCONSISTENTE — Entrada→Entrada em 26/08 (classificador canônico 4D.5)
  reset(
    batidasLimpo()
      .filter((e) => e.date !== "2026-07-29")
      .concat([punch("2026-07-29", "05:00", "entrada"), punch("2026-07-29", "06:00", "entrada")]),
  );
  assert.ok(pend().inconsistente.includes("2026-07-29"));
  assert.ok(pend().total > 0, "inconsistente presente");
  assert.ok(!actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE }).ok);
  // (b) INCOMPLETO — 27/07 aberto (fixture base)
  reset(batidasBase());
  assert.ok(pend().incompleto.includes("2026-07-27"));
  assert.ok(!actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE }).ok);
  // (c) SEM-REGISTRO — 27/07 vazio
  reset(batidasBase().filter((e) => e.date !== "2026-07-27"));
  assert.ok(pend()["semRegistro"].includes("2026-07-27"));
  assert.ok(!actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE }).ok);
  // (d) PLANO [10+] com destino já CHEGADO dentro do período
  resetLimpo();
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-08-06", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-01" }).ok, "plano futuro em 01/08");
  assert.ok(pend()["plano10"].length > 0, "plano chegou ⇒ bloqueante");
  assert.ok(!actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE }).ok);
});

/* ════════ FOTOGRAFIA (snapshot NUNCA vira factual) ════════ */

check("TESTE 05 DE 24 — Consolidar NÃO altera o saldo factual (−30min antes = depois)", () => {
  resetLimpo();
  const antes = view().cards.regularBalanceMinutes;
  const nEntries = st().entries.length;
  consolidarLimpo();
  assert.equal(antes, -30);
  assert.equal(view().cards.regularBalanceMinutes, -30, "factual intacto após consolidar");
  assert.equal(st().entries.length, nEntries, "nenhuma batida criada/alterada");
  assert.equal(activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to)!.factualBalanceMinutes, -30);
});

check("TESTE 06 DE 24 — Snapshot preserva o RESULTADO considerado no ponto (+30min)", () => {
  const c = consolidarLimpo();
  assert.equal(c.projectedBalanceMinutes, 30, "−30 factual + 1h de [10+] utilizado");
  assert.equal(view().cards.projection.projectedBalanceMinutes, 30, "mesma fonte da tela");
  const p = page();
  assert.ok(p.includes('"Resultado consolidado no ponto"'), "substitui Projeção no ponto quando consolidado");
  assert.ok(p.includes("consolidado em ${formatDateTimeBR(consolidacaoAtiva.consolidatedAt)}"), "data/hora da consolidação");
});

check("TESTE 07 DE 24 — Snapshot guarda useIds + allocations + contagens (rastreabilidade)", () => {
  const c = consolidarLimpo();
  assert.equal(c.specialExcessUsedMinutes, 60, "30 + 30 usados no período");
  assert.equal(movement().usedMinutes, 60, "mesma fonte canônica");
  assert.equal(c.useIds.length, 2, "os dois usos com destino no período");
  assert.deepEqual(
    c.allocations.map((a) => ({ originDate: a.originDate, minutes: a.minutes })).sort((x, y) => x.originDate.localeCompare(y.originDate)),
    [{ originDate: "2026-07-20", minutes: 30 }, { originDate: "2026-07-20", minutes: 30 }],
    "fifo 3C: origens em 20/07 (fora do período — utilização, não geração)",
  );
  assert.equal(c.trackedDays, 22, "dias com registro (9 dias próprios + 13 da cauda neutra)");
  assert.deepEqual({ factual: c.factualBalanceMinutes, positivas: c.regularPositiveMinutes, negativas: c.regularNegativeMinutes }, { factual: -30, positivas: 130, negativas: 160 });
  assert.equal(c.pendingCountAtConsolidation, 0);
  assert.equal(c.revision, 1);
  assert.equal(c.status, "active");
});

/* ════════ GUARDS NO MOTOR (a UI não é a segurança) ════════ */

check("TESTE 08 DE 24 — Consolidado bloqueia add/edit/delete de batidas do período (guard no motor)", () => {
  consolidarLimpo();
  const rAdd = actions.addEntry({ date: "2026-07-22", time: "08:00", type: "entrada" });
  assert.ok(!rAdd.ok && rAdd.error === MSG_PERIODO, `addEntry: ${rAdd.error ?? "ok"}`);
  const alvo = st().entries.find((e) => e.date === "2026-07-29" && e.time === "05:00")!;
  const rUpd = actions.updateEntry(alvo.id, { time: "05:30" });
  assert.ok(!rUpd.ok && rUpd.error === MSG_PERIODO, `updateEntry: ${rUpd.error ?? "ok"}`);
  const rDel = actions.deleteEntry(alvo.id);
  assert.ok(!rDel.ok && rDel.error === MSG_PERIODO, `deleteEntry: ${rDel.error ?? "ok"}`);
});

check("TESTE 09 DE 24 — Consolidado bloqueia lançamento manual retroativo, falta e afastamento no período", () => {
  consolidarLimpo();
  const rManual = actions.addEntry({ date: "2026-07-30", time: "07:00", type: "entrada" });
  assert.ok(!rManual.ok && rManual.error === MSG_PERIODO, "lançamento manual retroativo");
  const rFalta = actions.addFalta("2026-07-30");
  assert.ok(!rFalta.ok && rFalta.error === MSG_PERIODO, `falta: ${rFalta.error ?? "ok"}`);
  const rAbs = actions.addAbsence({ kind: "ferias", startDate: "2026-07-22", endDate: "2026-07-23", duration: "integral", note: null });
  assert.ok(!rAbs.ok && rAbs.error === MSG_PERIODO, "afastamento intersectando o período");
});

check("TESTE 10 DE 24 — Uso com destino consolidado NÃO cancela nem muda de destino; origem factual preservada", () => {
  consolidarLimpo();
  const uso = st().specialExcessUses!.find((u) => u.destinationDate === "2026-08-03")!;
  const rCancel = actions.cancelSpecialExcessUse({ id: uso.id });
  assert.ok(!rCancel.ok && rCancel.error === MSG_USO, `cancelar: ${rCancel.error ?? "ok"}`);
  const rMove = actions.updateSpecialExcessUse({ id: uso.id, patch: { destinationDate: "2026-08-25" } });
  assert.ok(!rMove.ok && rMove.error === MSG_USO, "mudar destino de uso consolidado");
  // origem factual permanece a mesma história real:
  assert.equal(st().entries.filter((e) => e.date === "2026-07-20").length, 2, "batidas de 20/07 intactas");
});

check("TESTE 11 DE 24 — Saldo [10+] DISPONÍVEL segue utilizável no ciclo (não congela o banco inteiro)", () => {
  consolidarLimpo();
  // após a consolidação restam 40min em 20/07 (100 − 60 usados): novo uso FORA do período consolidado é válido.
  // (dia destino no PRÓXIMO período, com jornada factual abaixo da base — elegível)
  for (const [h, t] of [["05:00", "entrada"], ["09:00", "saida"], ["10:00", "entrada"], ["12:30", "saida"]] as const) {
    assert.ok(actions.addEntry({ date: "2026-08-21", time: h, type: t }).ok, `batida 21/08 ${h}`);
  }
  const r = actions.createSpecialExcessUse({ destinationDate: "2026-08-21", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-22" });
  assert.ok(r.ok, `uso em 21/08: ${!r.ok ? r.error : ""}`);
  const novo = st().specialExcessUses!.find((u) => u.destinationDate === "2026-08-21")!;
  assert.deepEqual(novo.allocations.map((a) => a.originDate), ["2026-07-20"], "continua consumindo a origem real");
  // …mas destino DENTRO do consolidado continua bloqueado:
  const r2 = actions.createSpecialExcessUse({ destinationDate: "2026-08-03", minutes: 10, allocationStrategy: "fifo", asOfDate: "2026-08-22" });
  assert.ok(!r2.ok && r2.error === MSG_USO);
});

check("TESTE 12 DE 24 — Planos futuros permanecem gerenciáveis; destino em consolidado é bloqueado", () => {
  consolidarLimpo();
  const rPlano = actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-25" });
  assert.ok(rPlano.ok, `reserva futura: ${!rPlano.ok ? rPlano.error : ""}`);
  const rCancel = actions.cancelSpecialExcessPlan({ id: st().specialExcessPlans![0].id });
  assert.ok(rCancel.ok, "cancelamento de reserva futura segue normal");
  const rRetro = actions.createSpecialExcessPlan({ destinationDate: "2026-08-03", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-01" });
  assert.ok(!rRetro.ok && rRetro.error === MSG_PERIODO, "reserva retroativa em consolidado");
});

check("TESTE 13 DE 24 — Calendário: mudança de SIGNIFICADO em data consolidada é bloqueada (comparação canônica)", () => {
  consolidarLimpo();
  const atual = st().companyCalendars![0];
  // (a) trocar 28/07 de COMPENSAR 8h → 6h muda o contexto do consolidado ⇒ bloqueado
  const alterado = { ...atual, entries: atual.entries.map((e) => e.date === "2026-07-28" ? { ...e, horasACompensar: 6 } : e) };
  const rAlt = actions.replaceCompanyCalendar(alterado);
  assert.ok(!rAlt.ok && rAlt.error === MSG_CALENDARIO, `alterar: ${rAlt.error ?? "ok"}`);
  // (b) substituição IDÊNTICA (mesmo significado canônico) prossegue
  assert.ok(actions.replaceCompanyCalendar(atual).ok, "mesmo calendário não é conflito");
  // (c) remover o calendário com datas consolidadas ⇒ bloqueado
  const rDel = actions.removeCompanyCalendar(atual.cycleStart);
  assert.ok(!rDel.ok && rDel.error === MSG_CALENDARIO, "remover calendário consolidado");
  // (d) importar NOVO ciclo contendo data consolidada ⇒ bloqueado
  const novoCiclo = { ...atual, id: 2, cycleStart: "2026-02-01", cycleEnd: "2027-01-31", cycleLabel: "2026/2027-especial", entries: [{ ...atual.entries[0], id: 10 }] };
  const rAdd = actions.addCompanyCalendar(novoCiclo);
  assert.ok(!rAdd.ok && rAdd.error === MSG_CALENDARIO, "novo calendário cobrindo data consolidada");
});

/* ════════ REABERTURA · REVISIONS · HISTÓRICO ════════ */

check("TESTE 14 DE 24 — Reabrir: ativa vira superseded (histórico preservado), desbloqueia, revision intacta", () => {
  const c1 = consolidarLimpo();
  const r = actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, note: "corrigir 26/08", now: 1727301000000 });
  assert.ok(r.ok);
  const depois = st().periodConsolidations!;
  assert.equal(depois.length, 1, "nada excluído");
  const rev = depois[0];
  assert.equal(rev.id, c1.id);
  assert.equal(rev.status, "superseded");
  assert.equal(rev.consolidatedAt, c1.consolidatedAt, "consolidatedAt preservado");
  assert.equal(rev.revision, 1, "revision intacta");
  assert.equal(rev.reopenedAt, 1727301000000);
  assert.equal(rev.reopenNote, "corrigir 26/08");
  assert.equal(activeConsolidationForPeriod(depois, PERIOD.from, PERIOD.to), null, "sem ativa");
  // desbloqueia:
  const alvo = st().entries.find((e) => e.date === "2026-07-29" && e.time === "05:00")!;
  assert.ok(actions.updateEntry(alvo.id, { time: "05:10" }).ok, "edição liberada após reabrir");
  const p = page().replace(/\s+/g, " ");
  assert.ok(p.includes("Reabrir permite alterar registros e decisões deste período. A consolidação atual permanecerá no histórico, mas deixará de ser o resultado ativo."), "texto fixo da confirmação");
});

check("TESTE 15 DE 24 — Nova consolidação após reabrir ⇒ revision 2; nenhuma revisão sobrescrita", () => {
  consolidarLimpo();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  const r2 = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  assert.ok(r2.ok);
  const lista = st().periodConsolidations!;
  assert.equal(lista.length, 2, "duas revisões preservadas");
  assert.deepEqual(lista.map((c) => c.revision).sort((a, b) => a - b), [1, 2]);
  assert.equal(lista[0].consolidatedAt, 1727300000000, "rev. 1 intocada");
});

check("TESTE 16 DE 24 — Somente UMA revisão ACTIVE por período", () => {
  consolidarLimpo();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  const ativas = st().periodConsolidations!.filter((c) => c.status === "active");
  assert.equal(ativas.length, 1);
  assert.equal(ativas[0].revision, 2);
  // reconsolidar sem reabrir é recusado (já existe ativa):
  const r = actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE });
  assert.ok(!r.ok && r.error === "Este período já está consolidado.");
});

check("TESTE 17 DE 24 — SEM carry-over: resultado consolidado NÃO vira factual do próximo período", () => {
  consolidarLimpo();
  const proximo = { from: "2026-08-21", to: "2026-09-20" };
  const viewProx = buildResumoPeriodView({
    period: proximo, today: HOJE, entries: st().entries, absences: [], calendars: st().companyCalendars,
    settings: S(), faltas: [], controlStartDate: "2026-05-01",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(viewProx.cards.regularBalanceMinutes, 0, "novo período começa do zero (sem arrastar −30/+30)");
  assert.equal(st().entries.filter((e) => e.date >= PERIOD.from && e.date <= PERIOD.to).length, 86, "história real do período anterior intacta");
  assert.equal(activeConsolidationForPeriod(st().periodConsolidations, PERIOD.from, PERIOD.to)!.factualBalanceMinutes, -30, "snapshot anterior permanece −30");
});

/* ════════ BACKUP · FACTUAL vs CONSOLIDADO · UI ════════ */

check("TESTE 18 DE 24 — Backup ANTIGO (sem periodConsolidations) parseia para [] (v3 aceito)", () => {
  resetLimpo();
  const payload = buildBackupPayload(st());
  const antigo = JSON.parse(JSON.stringify(payload));
  delete (antigo as Record<string, unknown>).periodConsolidations;
  const parsed = parseBackup(JSON.stringify(antigo));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup!.periodConsolidations, []);
});

check("TESTE 19 DE 24 — Round-trip do backup preserva revisions/statuses (10ª coleção no contrato)", () => {
  consolidarLimpo();
  actions.reopenPeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, now: 1727301000000 });
  actions.consolidatePeriod({ periodStart: PERIOD.from, periodEnd: PERIOD.to, asOfDate: HOJE, now: 1727302000000 });
  const payload = buildBackupPayload(st());
  const parsed = parseBackup(JSON.stringify(payload));
  assert.ok(parsed.ok);
  const lista = parsed.backup!.periodConsolidations!;
  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map((c) => c.revision).sort((a, b) => a - b), [1, 2]);
  assert.equal(lista.filter((c) => c.status === "active").length, 1);
  assert.equal(BACKUP_COLLECTIONS.includes("periodConsolidations"), true, "coleção no contrato");
});

check("TESTE 20 DE 24 — Factual e consolidado são leituras SEPARADAS (factual ≠ consolidado sempre evidente)", () => {
  const c = consolidarLimpo();
  assert.equal(c.factualBalanceMinutes, -30);
  assert.equal(c.projectedBalanceMinutes, 30);
  assert.notEqual(c.factualBalanceMinutes, c.projectedBalanceMinutes);
  // card SALDO FACTUAL permanece na página; consolidado é card próprio:
  const p = page();
  assert.ok(p.includes('label="Saldo factual"'), "card Saldo factual preservado");
  assert.ok(p.includes("consolidacaoAtiva.factualBalanceMinutes"), "factual do card lê snapshot quando consolidado");
  assert.ok(p.includes("Período consolidado"), "banner discreto");
  assert.ok(p.includes("Ver histórico") && p.includes("Reabrir período"), "CTAs do banner");
});

check("TESTE 21 DE 24 — Lock em Registros NÃO esconde dados: banner + DayCards visíveis, botões desabilitados", () => {
  const r = registros();
  assert.ok(r.includes("Período consolidado — registros protegidos. Reabra o período no Resumo para editar."), "banner de lock");
  // 4G.2 (SUPERADO): "Abrir Resumo" agora PRESERVA o período exibido via
  // ?data= com a própria data inicial do período (getPointPeriod deriva no
  // Resumo — sem hardcode e sem segunda matemática 21→20).
  assert.ok(r.includes("href={`/resumo?data=${period.from}`}") && r.includes("Abrir Resumo"), "CTA Abrir Resumo preserva o período (4G.2)");
  assert.ok(r.includes("listedDays.map("), "DayCards seguem renderizados");
  assert.ok(!/if \(lockBound\) return/.test(r), "lock nunca esconde a lista");
  assert.ok(r.includes("disabled={!!lockBound}"), "Lançamento manual/Falta desabilitados sob lock");
  assert.ok(r.includes("consolidationLockCoveringRange(periodConsolidations, period.from, period.to)"), "lock canônico cobrindo o range");
});

check("TESTE 22 DE 24 — Nav mobile [‹][21/08 → 20/09][›] numa linha (320/360/412); desktop preserva rótulo completo", () => {
  const nav = src("src/components/period-navigator.tsx");
  const p = page();
  const r = registros();
  // 4G.2 (SUPERADO): container agora é COLUNA no mobile (linha 1 = só
  // navegação; linha 2 = contexto) e linha única no desktop (sm:flex-row).
  assert.ok(nav.includes('className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2"'), "controle único (4G.2: linha 1 só navegação no mobile)");
  assert.ok(nav.includes('aria-label={fullLabel}'), "aria-label completo");
  assert.ok(nav.includes('aria-label="Período anterior"') && nav.includes('aria-label="Próximo período"'), "setas acessíveis");
  assert.ok(nav.includes("<span className=\"sm:hidden\" title={fullLabel}>{shortLabel}</span>"), "mobile: rótulo curto");
  assert.ok(nav.includes("<span className=\"hidden sm:inline\">{fullLabel}</span>"), "desktop: rótulo completo");
  assert.ok(p.includes("shortLabel={`${period.from.slice(8)}/${period.from.slice(5, 7)} → ${period.to.slice(8)}/${period.to.slice(5, 7)}`}") || r.includes("slice(8)"), "21/08 → 20/09 (ano ocultável)");
  assert.ok(p.includes("fullLabel={`Período do ponto: ${periodLabel(period)}`}"), "desktop preserva 'Período do ponto: …'");
  assert.ok(r.includes("<PeriodNavigator") && p.includes("<PeriodNavigator"), "componente compartilhado nas duas telas");
  // Registros: Lançamento manual/Registrar falta em linha separada no mobile
  assert.ok(r.includes("flex w-full flex-wrap gap-2 sm:w-auto"), "linha própria no mobile");
  // Resumo: status não quebra o controle (badge fora do box de navegação)
  assert.ok(p.includes('fullLabel={`Período do ponto: ${periodLabel(period)}`}\n            shortLabel='), "estrutura única");
});

check("TESTE 23 DE 24 — Gráfico mobile: todas as barras, sem scroll, eixo X com marcos derivados; desktop intocado", () => {
  const charts = src("src/components/charts.tsx");
  // helper puro: primeiro + último + passos regulares (nada de datas fixas)
  const kept = mobileAxisKeptIndexesForTest(31);
  assert.ok(kept.has(0) && kept.has(30), "primeiro e último sempre");
  assert.ok(kept.size <= 7, "densidade reduzida (≈5 marcos)");
  assert.ok(kept.has(6) && kept.has(24), "marcos regulares derivados (passo ≈ 1/5)");
  assert.ok(charts.includes("export function mobileAxisKeptIndexes"), "helper exportado (puro)");
  assert.ok(!/hardcode|2026-08-21|2026-09-20/.test(charts.split("mobileAxisKeptIndexes")[1]?.split("export function StackedBarsChart")[0] ?? ""), "sem data fixa");
  // spans não-kept: hidden sm:block (desktop mantém TODOS os rótulos)
  assert.ok(charts.includes('className={showOnMobile ? "" : "hidden sm:block"}'), "rótulo oculto só abaixo de sm");
  assert.ok(charts.includes('showOnMobile ? "" : " hidden sm:block"'), "ícones seguem o mesmo keep-set");
  // barras/tooltip/legenda/aria intactos:
  assert.ok(charts.includes("group-hover"), "tooltip por hover preservado");
  assert.ok(charts.includes("aria-"), "acessibilidade preservada");
  assert.ok(!charts.includes("overflow-x-auto"), "sem scroll horizontal");
});

check("TESTE 24 DE 24 — Sentinelas: 4F · 4E.1/Central · Registros · banco · calendário · backup · seed", () => {
  const p = page();
  // 4F — cards e grade preservados:
  assert.ok(p.includes('grid grid-cols-2 gap-3 lg:grid-cols-4') || p.includes("grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4"), "cards 2×2 / desktop 4");
  assert.ok(p.includes("Como o período se formou"), "card de composição");
  assert.ok(p.includes('href={`/registros?escopo=ciclo&data=${d.date}`}') || p.includes("escopo=ciclo&data="), "CTA Ver dia 4E.1");
  // Central — forecast canônico intocado:
  const central = src("src/lib/central-view.ts");
  assert.ok(central.includes("buildCalendarForecast"), "Central segue no motor canônico");
  const comp = src("src/app/(app)/compensacoes/page.tsx");
  assert.ok(comp.includes("Consolidado"), "badge de rastreabilidade na Central");
  // Banco [10+] e calendário — motores intactos:
  assert.ok(src("src/lib/special-excess-bank.ts").includes("export function buildSpecialExcessBank"), "banco [10+] intacto");
  assert.ok(src("src/lib/company-calendar.ts").includes("export function parseCompanyCalendarCsv"), "calendário intacto");
  // Seed/backup:
  assert.ok(src("src/lib/seed-data.ts").includes("periodConsolidations: []"), "seed com coleção vazia");
  assert.equal(BACKUP_COLLECTIONS.length, 10, "contrato com 10 coleções");
});

/* helper de teste usa a MESMA função pura do componente (import dinâmico evita acoplamento de bundler): */
import { mobileAxisKeptIndexes as mobileAxisKeptIndexesForTest } from "../src/components/charts.tsx";
console.log(`\n4G — ${passed}/24 verificações concluídas.`);
