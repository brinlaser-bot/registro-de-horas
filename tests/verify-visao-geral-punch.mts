/**
 * VERIFICAÇÃO — VISÃO GERAL + REGISTRO RÁPIDO + EDIÇÃO DE BATIDAS
 * (testes A–V da rodada)
 *
 *  - Visão geral/Resumo/Registros somam a MESMA contribuição central
 *    (dayBalanceContribution): sábado/domingo/abonado trabalhado = crédito,
 *    falta prevista = 0 até chegar; cenário canônico ⇒ +4h50 nas três telas;
 *  - Smart Exit: ponto aberto ⇒ "Jornada em andamento"; última saída ⇒
 *    "Jornada encerrada"; excluir a saída ⇒ volta a "em andamento";
 *  - Registro rápido: botão principal dinâmico (Registrar entrada verde /
 *    Registrar saída vermelho), "Entrada/Saída agora" com a hora local;
 *  - Sequência central: alternância Entrada/Saída validada no RESULTADO
 *    FINAL ordenado (addEntry/updateEntry rejeitam quebra);
 *  - Edição: mesmo id + flag edited + recálculo; edição que invalida
 *    compensação concluída é bloqueada (histórico preservado);
 *  - "Registrar falta" dentro do Registro rápido (gate central);
 *  - "Déficit do período" (era "do mês") e card de Abono sem textos extras.
 *
 * Executar: npx tsx tests/verify-visao-geral-punch.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyBalanceContribution,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { dayBalanceContribution, canRegisterFalta, faltaStatusOf } from "../src/lib/faltas.ts";
import { getPointPeriod, listDaysBetween } from "../src/lib/periods.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import {
  computeDay,
  formatMinutes,
  nextPunchType,
  nowTimeString,
  sortedPunchEntries,
  validatePunchSequence,
} from "../src/lib/time.ts";
import { dayContext } from "../src/lib/absences.ts";
import { buildExitPlan } from "../src/components/smart-exit.tsx";
import type { TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
  birthDate: "1990-08-18",
} as User;

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const pageSrc = src("app/(app)/page.tsx");
const resumoSrc = src("app/(app)/resumo/page.tsx");
const registrosSrc = src("app/(app)/registros/page.tsx");
const quickSrc = src("components/quick-punch.tsx");
const smartSrc = src("components/smart-exit.tsx");
const panelSrc = src("components/excess-panel.tsx");
const dayCardSrc = src("components/day-card.tsx");
const uiSrc = src("components/ui.tsx");

const TODAY = "2026-08-23"; // domingo — mesmo marco das demais suítes

const reset = (faltas: { id: number; date: string; createdAt: number }[] = []) =>
  actions.replaceAll({
    user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas,
  });

/** SOMA DA VISÃO GERAL (após a correção): mesma fonte central do Resumo. */
const visaoGeralBalance = (period: { from: string; to: string }, today: string) => {
  const st = getAppData();
  let sum = 0;
  for (const date of listDaysBetween(period.from, period.to)) {
    const cctx = companyDayContext(date, st.entries, st.absences, st.companyCalendars, settings);
    sum += dayBalanceContribution(cctx, st.faltas, date, today);
  }
  return sum;
};

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ══ Cenário canônico (+4h50): 21/08 −15 · 22/08 sáb +120 · 23/08 dom +60 ·
      24/08 +5 · falta PREVISTA 31/08 = 0 · 07/09 ABONADO trabalhado +120 ══ */
const mountScenario = () => {
  nextId = 1;
  actions.replaceAll({
    user,
    entries: [
      punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "16:45", "saida"),
      punch("2026-08-22", "10:00", "entrada"), punch("2026-08-22", "12:00", "saida"),
      punch("2026-08-23", "09:00", "entrada"), punch("2026-08-23", "10:00", "saida"),
      punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "12:30", "saida"),
      punch("2026-08-24", "14:10", "entrada"), punch("2026-08-24", "17:45", "saida"),
      punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida"),
    ],
    compensations: [],
    absences: [],
    companyCalendars: both,
    faltas: [{ id: 1, date: "2026-08-31", createdAt: 1 }], // futura ⇒ prevista
  });
};

/* ── A. Saldo do período: Visão geral = Resumo = +4h50 ─────── */
check("A. cenário canônico ⇒ Saldo do período +4h50 (290min) nas três telas — mesma fonte central", () => {
  mountScenario();
  const period = getPointPeriod(TODAY); // 2026-08-21 → 2026-09-20
  assert.equal(period.from, "2026-08-21");
  assert.equal(period.to, "2026-09-20");
  const total = visaoGeralBalance(period, TODAY);
  assert.equal(total, 290, `saldo do período = ${formatMinutes(total)}`);
  assert.equal(formatMinutes(total), "4h50");
  // Bug original documentado: soma diária "trabalhado − 8h" sem calendário
  // (só dias com batidas) dava −19h10 para o mesmo cenário.
  const st = getAppData();
  let naive = 0;
  for (const d of ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-09-07"]) {
    naive += dayContext(d, st.entries, [], settings).adjustedBalance;
  }
  assert.equal(naive, -1150, "a fórmula antiga daria −19h10 (o bug relatado)");
  // Estrutural: as TRÊS telas consomem dayBalanceContribution (fonte única).
  for (const [name, s] of [["Visão geral", pageSrc], ["Resumo", resumoSrc], ["Registros", registrosSrc]] as const) {
    assert.ok(s.includes("dayBalanceContribution(cctx, faltas"), `${name} usa a contribuição central`);
  }
  assert.ok(pageSrc.includes("listDaysBetween(period.from, period.to)"), "Visão geral percorre TODOS os dias do período");
});

/* ── B. Sábado trabalhado entra como crédito (+2h) ─────────── */
check("B. 22/08 (sábado) com 2h ⇒ +2h na Visão geral (nunca −6h)", () => {
  mountScenario();
  const st = getAppData();
  const cctx = companyDayContext("2026-08-22", st.entries, st.absences, st.companyCalendars, settings);
  assert.equal(cctx.regularBalance, 120);
  assert.equal(companyBalanceContribution(cctx), 120);
  assert.equal(dayBalanceContribution(cctx, st.faltas, "2026-08-22", TODAY), 120);
  // fórmula antiga (worked − 480) documentava o −6h relatado
  assert.equal(computeDay(st.entries.filter((e) => e.date === "2026-08-22"), settings).balanceMinutes, -360);
});

/* ── C. Domingo trabalhado entra como crédito (+1h) ────────── */
check("C. 23/08 (domingo) com 1h ⇒ +1h (nunca −7h)", () => {
  mountScenario();
  const st = getAppData();
  const cctx = companyDayContext("2026-08-23", st.entries, st.absences, st.companyCalendars, settings);
  assert.equal(cctx.regularBalance, 60);
  assert.equal(dayBalanceContribution(cctx, st.faltas, "2026-08-23", TODAY), 60);
  assert.equal(computeDay(st.entries.filter((e) => e.date === "2026-08-23"), settings).balanceMinutes, -420);
});

/* ── D. Falta PREVISTA não afeta o saldo antes da data ─────── */
check("D. falta prevista 31/08 ⇒ contribuição 0 até chegar; efetiva ⇒ −jornada", () => {
  mountScenario();
  const st = getAppData();
  const cctx = companyDayContext("2026-08-31", st.entries, st.absences, st.companyCalendars, settings);
  assert.equal(faltaStatusOf("2026-08-31", TODAY), "prevista");
  assert.equal(dayBalanceContribution(cctx, st.faltas, "2026-08-31", TODAY), 0, "prevista mascarada");
  assert.equal(dayBalanceContribution(cctx, st.faltas, "2026-08-31", "2026-08-31"), -480, "efetiva conta");
});

/* ── E. 3 batidas (entrada aberta) ⇒ Jornada em andamento ──── */
check("E. e 08:00 · s 12:30 · e 14:10 ⇒ Smart Exit em andamento (não 'encerrada')", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "12:30", type: "saida", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "14:10", type: "entrada", note: null }).ok, true);
  const day = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-21"), settings, 15 * 60);
  const plan = buildExitPlan(day, settings, [], 15 * 60, "2026-08-21");
  assert.equal(plan.state, "planned"); // saída planejada 17:40 > agora 15:00
  assert.notEqual(plan.state, "finished");
  assert.ok(smartSrc.includes("Jornada em andamento"), "badge exibido nos estados de ponto aberto");
});

/* ── F. Registrar a saída ⇒ Jornada encerrada ──────────────── */
check("F. saídas 17:45 ⇒ Smart Exit 'Jornada encerrada' (finished)", () => {
  // continua do cenário E
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "17:45", type: "saida", note: null }).ok, true);
  const day = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-21"), settings, 18 * 60);
  const plan = buildExitPlan(day, settings, [], 18 * 60, "2026-08-21");
  assert.equal(plan.state, "finished");
  assert.ok(smartSrc.includes("Jornada encerrada"));
});

/* ── G. Excluir a saída ⇒ volta para Jornada em andamento ──── */
check("G. excluir a saída ⇒ Smart Exit volta a 'Jornada em andamento'", () => {
  const saida = getAppData().entries.find((e) => e.date === "2026-08-21" && e.type === "saida" && e.time === "17:45");
  assert.ok(saida);
  actions.deleteEntry(saida!.id);
  const day = computeDay(getAppData().entries.filter((e) => e.date === "2026-08-21"), settings, 15 * 60);
  const plan = buildExitPlan(day, settings, [], 15 * 60, "2026-08-21");
  assert.equal(plan.state, "planned");
});

/* ── H. Sem batidas ⇒ próxima é Entrada (verde + Entrada agora) ── */
check("H. zero batidas ⇒ 'Registrar entrada' (verde) + 'Entrada agora'", () => {
  assert.equal(nextPunchType([]), "entrada");
  assert.ok(quickSrc.includes('"Registrar entrada"'), "rótulo Registrar entrada");
  assert.ok(quickSrc.includes('"Entrada agora"'), "rótulo Entrada agora");
  assert.ok(quickSrc.includes('nextIsEntrada ? "primary" : "danger"'), "verde=primary / vermelho=danger");
  assert.ok(uiSrc.includes("bg-emerald-600"), "primary = verde");
});

/* ── I. Entrada aberta ⇒ próxima é Saída (vermelho + Saída agora) ── */
check("I. entrada aberta ⇒ 'Registrar saída' (vermelho) + 'Saída agora'", () => {
  assert.equal(nextPunchType([punch("2026-08-21", "08:00", "entrada")]), "saida");
  assert.ok(quickSrc.includes('"Registrar saída"'), "rótulo Registrar saída");
  assert.ok(quickSrc.includes('"Saída agora"'), "rótulo Saída agora");
  assert.ok(uiSrc.includes("bg-rose-600"), "danger = vermelho");
});

/* ── J. Após saída (dia fechado) ⇒ volta para Entrada ──────── */
check("J. dia fechado (e+s) ⇒ próxima batida volta a ser entrada", () => {
  assert.equal(
    nextPunchType([punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "17:00", "saida")]),
    "entrada",
  );
});

/* ── K. Entrada quando a próxima é Saída ⇒ store rejeita ───── */
check("K. addEntry entrada com entrada aberta ⇒ rejeitado: 'Já existe uma entrada aberta…'", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "08:00", type: "entrada", note: null }).ok, true);
  const res = actions.addEntry({ date: "2026-08-21", time: "09:00", type: "entrada", note: null });
  assert.equal(res.ok, false);
  assert.equal(res.code, "sequence");
  assert.equal(res.error, "Já existe uma entrada aberta. A próxima batida deve ser uma saída.");
  assert.equal(getAppData().entries.length, 1, "nada foi salvo");
});

/* ── L. Duas saídas seguidas ⇒ rejeitado; §7.1 resultado final ordenado ── */
check("L. duas saídas ⇒ 'A próxima batida deve ser uma entrada.'; validação é do resultado final ordenado", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "12:00", type: "saida", note: null }).ok, true);
  const res = actions.addEntry({ date: "2026-08-21", time: "13:00", type: "saida", note: null });
  assert.equal(res.ok, false);
  assert.equal(res.code, "sequence");
  assert.equal(res.error, "A próxima batida deve ser uma entrada.");
  // §7.1: a validação NUNCA usa a ordem de lançamento — histórico válido
  // lançado fora de ordem passa (resultado final ordenado alterna e/s/e/s).
  const lancadasForaDeOrdem: TimeEntry[] = [
    { id: 1, date: "2026-08-21", time: "17:00", type: "saida", note: null },
    { id: 2, date: "2026-08-21", time: "08:00", type: "entrada", note: null },
    { id: 3, date: "2026-08-21", time: "12:30", type: "saida", note: null },
    { id: 4, date: "2026-08-21", time: "14:10", type: "entrada", note: null },
  ];
  assert.equal(validatePunchSequence(lancadasForaDeOrdem).ok, true);
  assert.deepEqual(sortedPunchEntries(lancadasForaDeOrdem).map((e) => e.time), ["08:00", "12:30", "14:10", "17:00"]);
});

/* ── M. "Registrar saída" com o campo 17:30 ⇒ salva 17:30 ──── */
check("M. batida usa EXATAMENTE o horário do campo (saída 17:30 salva como 17:30)", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-21", time: "17:30", type: "saida", note: null }).ok, true);
  const saida = getAppData().entries.find((e) => e.type === "saida");
  assert.equal(saida?.time, "17:30");
  assert.ok(quickSrc.includes("punch(next, manualTime || clock)"), "botão principal usa o campo");
});

/* ── N. "Saída agora" ⇒ hora local real do clique ──────────── */
check("N. 'Entrada/Saída agora' registra a hora LOCAL atual (nowTimeString)", () => {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  assert.equal(nowTimeString(), `${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
  assert.match(nowTimeString(), /^\d{2}:\d{2}$/);
  assert.ok(quickSrc.includes("punch(next, nowTimeString())"), "botão agora usa a hora real do clique");
  assert.ok(!quickSrc.includes("Usar hora atual"), "botão redundante 'Usar hora atual' removido");
});

/* ── O. Editar 08:00 → 08:10: mesmo id + edited + recálculo ── */
check("O. edição 08:00→08:10 preserva o id, marca edited e recalcula o dia", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-18", time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-18", time: "17:00", type: "saida", note: null }).ok, true);
  const entrada = getAppData().entries.find((e) => e.type === "entrada")!;
  const id = entrada.id;
  const res = actions.updateEntry(id, { time: "08:10" });
  assert.equal(res.ok, true);
  const after = getAppData().entries.find((e) => e.id === id)!;
  assert.equal(after.id, id, "mesmo registro (id preservado)");
  assert.equal(after.time, "08:10");
  assert.equal(after.edited, true, "flag de editado");
  const st = getAppData();
  const cctx = companyDayContext("2026-08-18", st.entries, st.absences, st.companyCalendars, settings);
  assert.equal(cctx.ctx.day.workedMinutes, 470, "08:10–17:00 − 1h almoço");
});

/* ── P. Edição que quebra a sequência final ⇒ rejeitada ────── */
check("P. edição s 12:30 → 07:30 (sequência final inválida) ⇒ rejeitada, registro preservado", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-19", time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-19", time: "12:30", type: "saida", note: null }).ok, true);
  const saida = getAppData().entries.find((e) => e.type === "saida")!;
  const res = actions.updateEntry(saida.id, { time: "07:30" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "sequence");
  // §28 (rodada Banco de Horas): edição que RETROCEDE na linha do tempo
  // (saída antes da entrada) é uma inserção inválida NO MEIO — mensagem
  // contextual com sugestão de horário compatível; as mensagens clássicas
  // ficam para a verdadeira entrada aberta (teste K, preservado).
  assert.equal(
    res.error,
    "Esse horário criaria uma sequência de batidas inválida. Escolha um horário compatível com os registros existentes. Escolha um horário posterior à entrada das 08:00.",
  );
  assert.equal(getAppData().entries.find((e) => e.id === saida.id)!.time, "12:30", "original intacto");
});

/* ── Q. Edição que invalida compensação CONCLUÍDA ⇒ bloqueada ── */
check("Q. reduzir horas que sustentam comp. concluída ⇒ bloqueada/concluída preservada", () => {
  nextId = 1;
  actions.replaceAll({
    user, absences: [], companyCalendars: both, faltas: [],
    // 08:00–12:00 (batida no almoço, sem desconto) = 4h úteis → déficit 240
    entries: [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "12:00", "saida")],
    compensations: [{
      id: 9, sourceDate: "2026-08-20", targetDate: "2026-08-21", minutes: 240,
      status: "concluida", note: null, kind: "deficit", createdAt: 1,
    }],
  });
  const saida = getAppData().entries.find((e) => e.type === "saida")!;
  const res = actions.updateEntry(saida.id, { time: "16:00" }); // déficit cairia 240 → 60
  assert.equal(res.ok, false);
  assert.equal(res.code, "concluded-history");
  assert.equal(
    res.error,
    "Este horário já sustenta uma compensação concluída. A alteração reduziria as horas utilizadas e não pode ser aplicada automaticamente.",
  );
  assert.equal(getAppData().entries.find((e) => e.id === saida.id)!.time, "12:00", "batida preservada");
  assert.equal(getAppData().compensations[0].status, "concluida", "histórico concluído preservado");
  assert.equal(getAppData().compensations[0].minutes, 240);
  // edição que NÃO reduz as horas (só observação) continua permitida
  assert.equal(actions.updateEntry(saida.id, { note: "correção" }).ok, true);
});

/* ── R. Hoje sem batidas: Registrar falta ⇒ efetiva ────────── */
check("R. Registrar falta em dia útil sem batidas ⇒ salva (efetiva) via store", () => {
  reset();
  const res = actions.addFalta("2026-08-19"); // quarta, dia útil, sem batidas
  assert.equal(res.ok, true);
  assert.equal(getAppData().faltas.length, 1);
  assert.equal(faltaStatusOf("2026-08-19", "2026-08-24"), "efetiva");
  assert.ok(quickSrc.includes("Registrar falta"), "ação discreta dentro do Registro rápido");
  assert.ok(pageSrc.includes("onRegisterFalta={registerFaltaHoje}"), "sempre hoje (sem seletor de data)");
});

/* ── S. Hoje com batidas ⇒ Registrar falta bloqueado ───────── */
check("S. Registrar falta em dia COM batidas ⇒ bloqueado com a mensagem central", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null }).ok, true);
  const res = actions.addFalta("2026-08-20");
  assert.equal(res.ok, false);
  assert.equal(
    res.error,
    "Este dia possui registros de horário. O déficit será calculado automaticamente pelas horas trabalhadas.",
  );
});

/* ── T. Sábado / abonado / Abono ⇒ gate central bloqueia ───── */
check("T. Registrar falta em sábado, dia abonado e dia de Abono ⇒ gate central bloqueia", () => {
  reset();
  const sat = actions.addFalta("2026-08-22"); // sábado
  assert.equal(sat.ok, false);
  assert.ok((sat.error ?? "").includes("folga"));
  const abon = actions.addFalta("2026-09-07"); // ABONADO pelo calendário
  assert.equal(abon.ok, false);
  assert.ok((abon.error ?? "").includes("abonad"));
  // Dia de Abono de aniversário (cobertura integral) — gate central também bloqueia
  const abono = actions.setAbono({ date: "2026-08-18", note: null });
  assert.equal(abono.ok, true);
  const onAbono = actions.addFalta("2026-08-18");
  assert.equal(onAbono.ok, false);
  assert.ok((onAbono.error ?? "").includes("coberto"));
  // e o gate central (canRegisterFalta) é o MESMO usado pelo botão do QuickPunch
  const gate = canRegisterFalta("2026-08-22", getAppData().entries, [], getAppData().companyCalendars, settings, getAppData().faltas);
  assert.equal(gate.ok, false);
});

/* ── U. Card do dia de Abono: somente informativo ──────────── */
check("U. card de Abono: informativo ('Abono de aniversário · dia integral'), sem controles/texto extra", () => {
  assert.ok(dayCardSrc.includes("Abono de aniversário"));
  assert.ok(dayCardSrc.includes("dia integral"));
  assert.ok(dayCardSrc.includes("!abonoDay && ("), "controles e rodapé seguem ocultos no dia de Abono");
  assert.ok(
    (dayCardSrc.match(/!abonoDay/g) ?? []).length >= 2,
    "formulário, atalhos e rodapé protegidos pelo guarda !abonoDay",
  );
});

/* ── V. Textos explicativos do Abono removidos ─────────────── */
check("V. removidos: 'Dia coberto pelo Abono…' e o rodapé '* No ponto…' no dia de Abono", () => {
  assert.ok(!dayCardSrc.includes("Dia coberto pelo Abono"), "parágrafo explicativo removido");
  assert.ok(dayCardSrc.includes('* "No ponto" é o total'), "rodapé existe nos demais dias");
  const footnote = dayCardSrc.indexOf('* "No ponto" é o total');
  const guard = dayCardSrc.lastIndexOf("{!abonoDay && (", footnote);
  assert.ok(guard !== -1 && guard > footnote - 400, "rodapé envolvido pelo guarda {!abonoDay && (…)}");
  // §13: rótulo corrigido (o cálculo do painel NÃO foi alterado)
  assert.ok(panelSrc.includes("Déficit do período"), "rótulo renomeado");
  assert.ok(!panelSrc.includes("Déficit do mês"), "rótulo antigo removido");
});

console.log(`\nVISÃO GERAL + REGISTRO RÁPIDO + EDIÇÃO — OK (${passed} testes)`);
