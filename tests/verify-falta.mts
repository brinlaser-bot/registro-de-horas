/**
 * VERIFICAÇÃO — FALTA INTEGRAL (seção 19, testes A–T)
 * A falta é uma ocorrência de PONTO registrada manualmente (nunca automática):
 *  - déficit = JORNADA EFETIVA do dia pela resolução central (Cinzas 4h → 4h,
 *    nunca 8h fixas);
 *  - falta futura = "Falta prevista": não gera déficit/saldo/dívida até a data
 *    (date <= hoje, derivado — sem job/timer);
 *  - dia útil vazio com falta efetiva: −8h; fim de semana, abonado, folga a
 *    compensar, férias/afastamento integral e dia com batidas: BLOQUEADOS;
 *  - exclusão nunca deixa compensação órfã; backup v3 persiste faltas e segue
 *    retrocompatível com v1/v2/v3 (campo opcional).
 *
 * Executar: npx tsx tests/verify-falta.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyCalendar,
  companyCalendarForDate,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import {
  activeAcordos,
  buildDebtDays,
} from "../src/lib/debt.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { BACKUP_VERSION, buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import {
  canRegisterFalta,
  countEffectiveFaltas,
  effectiveFaltas,
  faltaConfirmText,
  faltaStatusOf,
} from "../src/lib/faltas.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { TimeEntry, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
};

let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({
  id: nextId++, date, time, type, note: null,
});
const absence = (a: Partial<Absence> & Pick<Absence, "kind" | "startDate" | "endDate">): Absence => ({
  id: nextId++, duration: "integral", note: null, createdAt: 0, ...a,
});

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23"; // domingo
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY)); // 2026-05-01 → 2027-04-30

/** Reinicia o store global com os dois calendários (isolamento entre testes). */
const reset = () =>
  actions.replaceAll({
    user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [],
  });
const debtsNow = () => {
  const st = getAppData();
  return buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, effectiveFaltas(st.faltas, TODAY));
};

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── A. dia útil com falta → déficit de 8h ───────────────── */
check("A. dia útil 18/08 sem batidas + falta → Trabalhado 0 / Base 8h / déficit 8h; resumo conta 1 falta", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  const st = getAppData();
  const d = debtsNow().find((x) => x.date === "2026-08-18" && x.kind === "deficit");
  assert.ok(d, "a falta efetiva gerou um dia de déficit");
  assert.equal(d.workedMinutes, 0);
  assert.equal(d.expectedMinutes, 480);
  assert.equal(d.debtMinutes, 480, "déficit = jornada efetiva (8h)");
  assert.equal(d.remainingMinutes, 480);
  const cctx = companyDayContext("2026-08-18", [], st.absences, both, settings);
  assert.equal(cctx.adjustedBalance, -480, "saldo do dia = −8h");
  assert.equal(cctx.adjustedDeficit, 480);
  assert.equal(countEffectiveFaltas(st.faltas, BOUNDS, TODAY), 1, "resumo: Faltas: 1 dia");
});

/* ── §15-guard. exclusão bloqueada com compensação vinculada ─ */
check("§15. falta com compensação ativa de déficit na mesma data → exclusão bloqueada (nunca órfã)", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-19").ok, true);
  const faltaId = getAppData().faltas[0].id;
  const comp = actions.addComp({
    sourceDate: "2026-08-19", targetDate: "2026-08-26", minutes: 60, note: null, kind: "deficit",
  });
  assert.equal(comp.ok, true, "compensação de hora extra vinculada ao déficit da falta");
  const blocked = actions.removeFalta(faltaId);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "linked-compensations");
  assert.match(blocked.error ?? "", /Cancele-as primeiro/);
  assert.equal(getAppData().faltas.length, 1, "falta preservada enquanto há compensação ativa");
  // Cancela a compensação → exclusão liberada
  assert.equal(actions.updateComp(getAppData().compensations[0].id, { status: "cancelada" }).ok, true);
  assert.equal(actions.removeFalta(faltaId).ok, true);
  assert.equal(getAppData().faltas.length, 0);
  assert.equal(debtsNow().find((x) => x.date === "2026-08-19" && x.kind === "deficit"), undefined);
});

/* ── B. falta futura = prevista (saldo 0, sem déficit) ────── */
check("B. falta 28/08 (futura) = 'Falta prevista': não afeta saldo/déficit nem o resumo de faltas", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-28").ok, true);
  assert.equal(faltaStatusOf("2026-08-28", TODAY), "prevista");
  const st = getAppData();
  assert.equal(effectiveFaltas(st.faltas, TODAY).length, 0, "prevista não entra nas efetivas");
  assert.equal(debtsNow().find((x) => x.date === "2026-08-28"), undefined, "sem dívida ativa");
  assert.equal(countEffectiveFaltas(st.faltas, BOUNDS, TODAY), 0, "resumo conta só efetivas");
  const txt = faltaConfirmText("2026-08-28", 480, TODAY);
  assert.match(txt, /Registrar falta em 28\/08\/2026\?/);
  assert.match(txt, /Falta prevista/);
  assert.match(txt, /ainda não afetará o saldo/);
  const txtEf = faltaConfirmText("2026-08-18", 480, TODAY);
  assert.match(txtEf, /Jornada prevista: 8h/);
  assert.match(txtEf, /Será gerado um déficit de 8h/);
});

/* ── C. data chegou → vira efetiva sozinha (sem job) ──────── */
check("C. falta prevista 28/08 vista em 28/08: vira efetiva com déficit de 8h (vigência derivada)", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-28").ok, true);
  const st = getAppData();
  assert.equal(faltaStatusOf("2026-08-28", "2026-08-28"), "efetiva", "date <= hoje");
  assert.equal(faltaStatusOf("2026-08-28", "2026-08-30"), "efetiva");
  const eff = effectiveFaltas(st.faltas, "2026-08-28");
  assert.equal(eff.length, 1);
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, eff);
  assert.equal(debts.find((x) => x.date === "2026-08-28" && x.kind === "deficit")?.debtMinutes, 480);
});

/* ── D. dia com 4h trabalhadas: falta bloqueada; déficit natural 4h ── */
check("D. 24/08 com 08:00–12:00 (4h): falta BLOQUEADA; déficit natural de 4h pelas horas trabalhadas", () => {
  const e = [punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "12:00", "saida")];
  const gate = canRegisterFalta("2026-08-24", e, [], both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(
    gate.error,
    "Este dia possui registros de horário. O déficit será calculado automaticamente pelas horas trabalhadas.",
  );
  const d = buildDebtDays(e, [], settings, BOUNDS, [], both).find((x) => x.date === "2026-08-24" && x.kind === "deficit");
  assert.equal(d?.debtMinutes, 240, "déficit = 8h − 4h trabalhadas");
});

/* ── E/F. sábado e domingo bloqueados ─────────────────────── */
check("E. sábado 29/08: falta bloqueada (folga sem jornada a cumprir)", () => {
  const gate = canRegisterFalta("2026-08-29", [], [], both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, "Esta data é uma folga e não possui jornada a cumprir.");
  assert.equal(actions.addFalta("2026-08-29").ok, false, "store reforça o bloqueio");
});
check("F. domingo 30/08: falta bloqueada (folga sem jornada a cumprir)", () => {
  const gate = canRegisterFalta("2026-08-30", [], [], both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, "Esta data é uma folga e não possui jornada a cumprir.");
});

/* ── G. feriado integralmente abonado bloqueado ───────────── */
check("G. 07/09 (Independência, ABONADO): falta bloqueada — dia abonado pelo calendário", () => {
  const gate = canRegisterFalta("2026-09-07", [], [], both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, "Esta data está integralmente abonada pelo calendário — não há falta a registrar.");
});

/* ── H. feriado abonado +2h = +2h (sem falta, sem déficit) ── */
check("H. 07/09 abonado com 08:00–10:00: saldo +2h, déficit 0, falta segue bloqueada", () => {
  const e = [punch("2026-09-07", "08:00", "entrada"), punch("2026-09-07", "10:00", "saida")];
  const cctx = companyDayContext("2026-09-07", e, [], both, settings);
  assert.equal(cctx.type, "evento", "feriado abonado com trabalho é 'evento' (label do feriado)");
  assert.equal(cctx.effectiveExpected, 0);
  assert.equal(cctx.adjustedBalance, 120, "+2h utilizáveis");
  assert.equal(cctx.adjustedDeficit, 0);
  assert.equal(buildDebtDays(e, [], settings, BOUNDS, [], both).find((x) => x.date === "2026-09-07"), undefined);
  assert.equal(canRegisterFalta("2026-09-07", e, [], both, settings, []).ok, false);
});

/* ── I. folga a compensar bloqueada (obrigação própria) ───── */
check("I. 25/08 (folga a compensar 8h): falta bloqueada; obrigação de calendário intacta, sem déficit comum", () => {
  const gate = canRegisterFalta("2026-08-25", [], [], both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(
    gate.error,
    "Esta data já possui obrigação própria do calendário (a compensar) — não é gerada falta comum.",
  );
  const debts = buildDebtDays([], [], settings, BOUNDS, [], both);
  assert.equal(debts.find((x) => x.date === "2026-08-25" && x.kind === "calendario")?.debtMinutes, 480);
  assert.equal(debts.find((x) => x.date === "2026-08-25" && x.kind === "deficit"), undefined);
});

/* ── J. férias bloqueiam ──────────────────────────────────── */
check("J. 11/08 dentro de férias integrais 10–14/08: falta bloqueada", () => {
  const absences = [absence({ kind: "ferias", startDate: "2026-08-10", endDate: "2026-08-14" })];
  const gate = canRegisterFalta("2026-08-11", [], absences, both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, "Este dia já está coberto por Férias (integral).");
});

/* ── K. saúde integral bloqueia ───────────────────────────── */
check("K. 17/08 com afastamento por saúde integral (atestado): falta bloqueada", () => {
  const absences = [absence({ kind: "saude", startDate: "2026-08-17", endDate: "2026-08-17", medicalCert: true })];
  const gate = canRegisterFalta("2026-08-17", [], absences, both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, "Este dia já está coberto por Afastamento por saúde (integral).");
});

/* ── L. acordo a compensar preserva obrigação própria ─────── */
check("L. 13/08 acordado-compensar integral: falta bloqueada; acordo 8h intacto, SEM dupla obrigação", () => {
  const absences = [absence({ kind: "acordado", startDate: "2026-08-13", endDate: "2026-08-13", treatment: "compensar" })];
  const gate = canRegisterFalta("2026-08-13", [], absences, both, settings, []);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, "Este dia já está coberto por Afastamento acordado — compensar posteriormente (integral).");
  const debts = buildDebtDays([], [], settings, BOUNDS, absences, both);
  assert.equal(debts.find((x) => x.date === "2026-08-13" && x.kind === "acordo")?.debtMinutes, 480);
  assert.equal(debts.find((x) => x.date === "2026-08-13" && x.kind === "deficit"), undefined);
  const acordos = activeAcordos([], [], settings, BOUNDS, absences);
  assert.equal(acordos.length, 1);
  assert.equal(acordos[0].originalMinutes, 480);
});

/* ── M. jornada reduzida (Cinzas 4h): falta de 4h, NUNCA 8h ─ */
check("M. Cinzas 10/02/2027 (jornada 4h): falta aceita com 4h; déficit 4h + obrigação 4h, nunca 8h", () => {
  const gate = canRegisterFalta("2027-02-10", [], [], both, settings, []);
  assert.equal(gate.ok, true);
  assert.equal(gate.jornadaMinutes, 240, "jornada efetiva = 4h do evento, nunca 8h");
  reset();
  assert.equal(actions.addFalta("2027-02-10").ok, true);
  const st = getAppData();
  assert.equal(effectiveFaltas(st.faltas, TODAY).length, 0, "10/02/2027 é futura: prevista hoje");
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, effectiveFaltas(st.faltas, "2027-02-10"));
  const deficit = debts.find((x) => x.date === "2027-02-10" && x.kind === "deficit");
  const cal = debts.find((x) => x.date === "2027-02-10" && x.kind === "calendario");
  assert.equal(deficit?.debtMinutes, 240, "falta efetiva = 4h (jornada reduzida)");
  assert.notEqual(deficit?.debtMinutes, 480, "NUNCA a fórmula paralela de 8h");
  assert.equal(cal?.debtMinutes, 240, "obrigação do calendário (4h) coexiste sem duplicar");
});

/* ── N. dia cheio com batidas: falta bloqueada ────────────── */
check("N. 20/08 com jornada completa registrada: falta bloqueada", () => {
  const e = [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "12:00", "saida"), punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "17:00", "saida")];
  const gate = canRegisterFalta("2026-08-20", e, [], both, settings, []);
  assert.equal(gate.ok, false);
  assert.match(gate.error ?? "", /registros de horário/);
});

/* ── O. falta + nova batida → remover falta antes ─────────── */
check("O. falta 18/08: excluir e bater o ponto no mesmo dia — gate passa a bloquear (sem falta+trabalho juntos)", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  const faltaId = getAppData().faltas[0].id;
  // Fluxo da UI (§16): confirmada a remoção → remove falta → registra a batida
  // (data <= hoje: batida futura é proibida pela regra absoluta de ponto)
  assert.equal(actions.removeFalta(faltaId).ok, true, "sem compensação vinculada: remoção livre");
  assert.equal(getAppData().faltas.length, 0);
  const punch = actions.addEntry({ date: "2026-08-18", time: "08:00", type: "entrada", note: null });
  assert.equal(punch.ok, true);
  const st = getAppData();
  assert.equal(canRegisterFalta("2026-08-18", st.entries, st.absences, st.companyCalendars, settings, st.faltas).ok, false);
});

/* ── P. excluir falta sem compensação: déficit desaparece ─── */
check("P. excluir falta 18/08 (sem compensação vinculada): déficit some do mapa do período", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  assert.ok(debtsNow().find((x) => x.date === "2026-08-18" && x.kind === "deficit"));
  assert.equal(actions.removeFalta(getAppData().faltas[0].id).ok, true);
  assert.equal(debtsNow().find((x) => x.date === "2026-08-18"), undefined, "déficit derivado sumiu junto");
  assert.equal(countEffectiveFaltas(getAppData().faltas, BOUNDS, TODAY), 0);
});

/* ── Q. nunca duplicar (add duplo + merge de backup) ──────── */
check("Q. falta nunca duplica: segundo add na mesma data rejeitado; merge de backup deduplica", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  const dup = actions.addFalta("2026-08-18");
  assert.equal(dup.ok, false);
  assert.equal(dup.error, "Já existe uma falta registrada para este dia.");
  assert.equal(getAppData().faltas.length, 1);
  // "Recarregar"/restaurar com os mesmos dados não cria cópia
  const atual = getAppData().faltas[0];
  actions.mergeBackup({
    entries: [], compensations: [], faltas: [{ id: 999, date: atual.date, createdAt: atual.createdAt }],
  });
  assert.equal(getAppData().faltas.length, 1, "mesmo conteúdo na mesma data = mesmo registro");
});

/* ── R. backup round-trip + retrocompatibilidade ──────────── */
check("R. backup v3: persiste faltas (inclusive previstas) no round-trip; backup antigo sem o campo funciona", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  assert.equal(actions.addFalta("2026-08-28").ok, true);
  assert.equal(BACKUP_VERSION, 3, "versão preservada (campo opcional, sem nova versão)");
  const payload = buildBackupPayload(getAppData());
  assert.equal(payload.faltas?.length, 2, "faltas + previstas entram no payload");
  const parsed = parseBackup(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(
      parsed.backup.faltas.map((f) => f.date).sort(),
      ["2026-08-18", "2026-08-28"],
    );
  }
  // Backup antigo (v1/v2/v3) sem "faltas" → padrão [], sem erro
  const legacy = JSON.stringify({
    version: 2, exportedAt: "2025-01-01T00:00:00.000Z", user,
    entries: [], compensations: [], absences: [],
  });
  const parsedLegacy = parseBackup(legacy);
  assert.equal(parsedLegacy.ok, true);
  if (parsedLegacy.ok) assert.deepEqual(parsedLegacy.backup.faltas, []);
});

/* ── S. multi-calendário: gate resolve o calendário do ciclo ─ */
check("S. gate usa o calendário do ciclo da data (20/11/2025 abonado no 2025–2026; falta comum ok no 2026–2027)", () => {
  assert.equal(companyCalendarForDate("2025-11-20", both)?.cycleStart, "2025-05-01");
  assert.equal(companyCalendarForDate("2026-08-25", both)?.cycleStart, "2026-05-01");
  const old = canRegisterFalta("2025-11-20", [], [], both, settings, []);
  assert.equal(old.ok, false, "Consciência Negra (ABONADO, ciclo 2025–2026) bloqueia");
  assert.match(old.error ?? "", /abonada pelo calendário/);
  const novo = canRegisterFalta("2026-08-18", [], [], both, settings, []);
  assert.equal(novo.ok, true);
  assert.equal(novo.jornadaMinutes, 480);
  const semCal = canRegisterFalta("2026-08-18", [], [], undefined, settings, []);
  assert.equal(semCal.ok, true, "sem calendário, dia útil comum aceita falta");
});

/* ── T. fechamento anual 30/04 intacto (barreira cross-cycle) ─ */
check("T. fechamento anual: compensação atravessando 30/04 segue rejeitada (cross-cycle)", () => {
  reset();
  const res = actions.addComp({
    sourceDate: "2026-04-28", targetDate: "2026-05-06", minutes: 60, note: null, kind: "deficit",
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "cross-cycle");
});

console.log(`\n✅ ${passed} verificações passaram: A §15 B C D E F G H I J K L M N O P Q R S T`);
