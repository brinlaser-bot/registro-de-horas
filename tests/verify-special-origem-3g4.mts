/**
 * VERIFICAÇÃO — CORREÇÃO 3G.4: ORIGEM [10+] REDUZIDA/ELIMINADA EM USO.
 *
 * BUG (teste manual real): a origem 28/08 gerava 30min de [10+]; um uso
 * MANUAL 28/08→30min completava 24/08; ao EDITAR 28/08 (10h30→10h), a
 * geração caiu a 0, MAS o uso ativo continuou referenciando a origem
 * sem lastro (badge, projeção e banco violavam a integridade).
 *
 * CORREÇÃO (extensão do fluxo 3G, sem segundo motor):
 *  - cada edição de batida reconcilia usos ativos cujas ORIGENS afetadas
 *    perderam geração (critério determinístico: uso mais antigo primeiro);
 *  - MANUAL: mantém só o lastro (nunca troca origem); parcial → original
 *    cancelado + versão ativa reconciliada (histórico preservado);
 *  - AUTOMÁTICO: preserva o TOTAL redistribuindo pelo FIFO (3C) quando
 *    há lastro; sem lastro suficiente, reduz;
 *  - tudo no MESMO mutate da edição (atômico) + aviso curto (warning);
 *  - gate persistente de destino (3G) e histórico continuam intactos.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-special-origem-3g4.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildResumoDayRow, resumoEventKind } from "../src/lib/resumo-days.ts";
import { projectRealizedDayOfficial, isProjectableDayStatus } from "../src/lib/official-projection.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ASOF = "2026-08-30";
const NOW = 2_000;

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
const uses = () => d().specialExcessUses ?? [];
const activeMinutesTo = (date: string) =>
  uses().filter((u) => u.status === "utilizado" && u.destinationDate === date).reduce((s, u) => s + u.allocations.reduce((k, a) => k + a.minutes, 0), 0);

function bankOf(date: string) {
  const dd = d();
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(date),
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

function dayViewOf(date: string) {
  const dd = d();
  return buildSpecialExcessDayView({
    date,
    asOfDate: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
    uses: dd.specialExcessUses ?? [],
  });
}

function projectionOf(date: string) {
  const dd = d();
  const row = buildResumoDayRow({
    date,
    today: ASOF,
    entries: dd.entries,
    absences: dd.absences,
    calendars: dd.companyCalendars,
    settings: settingsOf(dd.user),
    faltas: dd.faltas,
    controlStartDate: dd.user.controlStartDate ?? null,
  });
  return {
    row,
    proj: projectRealizedDayOfficial({
      date,
      factualWorkedMinutes: row.workedMinutes,
      factualRegistrableMinutes: row.registrableMinutes,
      factualRegularBalanceMinutes: row.balanceContribution,
      effectiveBaseMinutes: row.expectedMinutes,
      financialValid: isProjectableDayStatus(row.status),
      realized: true,
      usedSpecialMinutes: activeMinutesTo(date),
    }),
  };
}

const punchId = (date: string, time: string): number => {
  const e = d().entries.find((x) => x.date === date && x.time === time);
  assert.ok(e, `batida ${date} ${time} presente`);
  return e.id;
};

/** Uso MANUAL 28/08→min para o destino informado. */
const createManual28 = (destinationDate: string, minutes: number, now: number) =>
  actions.createSpecialExcessUse({
    destinationDate,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes }],
    asOfDate: ASOF,
    now,
  });

/** Reduz a geração de 28/08 editando a saída final 19:00 (10h30 → alvo). */
function edit28FinalExit(time: string, now = NOW) {
  return actions.updateEntry(punchId("2026-08-28", "19:00"), { time }, { now });
}

/* ════════ TESTE 01 — origem manual ELIMINADA (cenário exato do bug) ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok, "uso manual criado");

check("T01.a estado inicial: 28/08 gera 30 · 24/08 usa 30 · banco 130/30/100", () => {
  assert.equal(bankOf("2026-08-28").lots.find((l) => l.originDate === "2026-08-28")?.generatedMinutes, 30);
  assert.equal(activeMinutesTo("2026-08-24"), 30);
  const bank = bankOf("2026-08-24");
  assert.deepEqual([bank.generatedMinutes, bank.usedMinutes, bank.availableMinutes], [130, 30, 100]);
});

check("T01.b editar 28/08 (10h30→10h) APLICA a reconciliação no mesmo mutate + avisa", () => {
  const res = edit28FinalExit("18:30");
  assert.equal(res.ok, true, `edição falhou: ${res.error}`);
  assert.ok(res.warning?.includes("30min"), "feedback curto (§10): 30min deixaram de estar disponíveis");
});

check("T01.c 24/08: uso ativo 0 · projeção 7h30/-30 · volta a permitir completar", () => {
  assert.equal(activeMinutesTo("2026-08-24"), 0);
  const { proj } = projectionOf("2026-08-24");
  assert.equal(proj.appliedSpecialMinutes, 0);
  assert.equal(proj.projectedWorkedMinutes, 450, "projeção 7h30");
  assert.equal(proj.projectedBalanceMinutes, -30, "saldo projetado -30min");
  const view = dayViewOf("2026-08-24");
  assert.equal(view.eligible, true, "seguir elegível");
  assert.equal(view.canComplete, true, "'Completar jornada com [10+]' disponível de novo");
});

check("T01.d banco íntegro: 28/08 gera 0 · usado 0 · disponível 100 (1h40)", () => {
  assert.equal(bankOf("2026-08-28").lots.find((l) => l.originDate === "2026-08-28")?.generatedMinutes, 0);
  const bank = bankOf("2026-08-24");
  assert.deepEqual([bank.generatedMinutes, bank.usedMinutes, bank.availableMinutes], [100, 0, 100]);
  assert.equal(bank.overusedMinutes, 0, "nenhuma allocation sem lastro");
});

check("T01.e histórico preservado: uso original CANCELADO com allocations + motivo", () => {
  const original = uses().find((u) => u.id === "seu-1")!;
  assert.equal(original.status, "cancelado");
  assert.deepEqual(original.allocations, [{ originDate: "2026-08-28", minutes: 30 }], "allocation antiga auditável");
  assert.equal(original.cancelledAt, NOW);
  assert.ok(original.note?.includes("Reconciliado"), "motivo registrado (append não destrutivo)");
});

check("T01.f factual intocado: 24/08 continua 'Abaixo da base' com 7h30/-30min", () => {
  const { row } = projectionOf("2026-08-24");
  assert.equal(row.workedMinutes, 450);
  assert.equal(row.balanceMinutes, -30);
  assert.equal(resumoEventKind(row), "Jornada abaixo do previsto");
  // sem troca silenciosa de origem (manual): nenhum uso ativo novo apontando 18/08 ou 20/08
  assert.equal(activeMinutesTo("2026-08-24"), 0);
});

/* ════════ TESTE 02 — redução PARCIAL manual (30 → 10) ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok);

check("T02. parcial manual: origem 30→10 mantém 10 ativos · 20 saem · histórico preservado", () => {
  const res = edit28FinalExit("18:40"); // 4h30 + 5h40 = 10h10 → geração 10min
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const gen = bankOf("2026-08-28").lots.find((l) => l.originDate === "2026-08-28")?.generatedMinutes ?? 0;
  assert.equal(gen, 10);
  assert.equal(activeMinutesTo("2026-08-24"), 10, "somente o lastro permanece ativo");
  const original = uses().find((u) => u.id === "seu-1")!;
  assert.equal(original.status, "cancelado", "original preservado no histórico");
  assert.deepEqual(original.allocations, [{ originDate: "2026-08-28", minutes: 30 }], "histórico dos 30min originais");
  const reconciled = uses().find((u) => u.status === "utilizado")!;
  assert.deepEqual(reconciled.allocations, [{ originDate: "2026-08-28", minutes: 10 }], "MESMA origem manual (nunca troca)");
  assert.ok(res.warning?.includes("10min") && res.warning?.includes("20min"), "aviso parcial: o que fica e o que sai");
});

/* ════════ TESTE 03 — origem manual AUMENTA (30 → 60): não aumenta uso ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok);

check("T03. origem aumenta (10h30→11h): uso permanece 30 · 30min extra ficam disponíveis", () => {
  const res = edit28FinalExit("19:30"); // 5h+6h30=... worked 11h30 → [10+] 1h30
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  assert.equal(activeMinutesTo("2026-08-24"), 30, "uso NÃO aumenta automaticamente");
  const bank = bankOf("2026-08-24");
  assert.ok(bank.availableMinutes > 100, "geração extra disponível no banco");
  assert.equal(res.warning, undefined, "nada a avisar: nada foi ajustado");
});

/* ════════ TESTE 04 — origem SEM usos: só banco recalcula ════════ */

resetSeed();

check("T04. origem reduzida sem nenhum uso: nenhuma reconciliação, nenhum aviso", () => {
  const res = edit28FinalExit("18:30");
  assert.equal(res.ok, true);
  assert.equal(res.warning, undefined);
  assert.equal(uses().length, 0);
  const bank = bankOf("2026-08-24");
  assert.deepEqual([bank.generatedMinutes, bank.usedMinutes, bank.availableMinutes], [100, 0, 100]);
});

/* ════════ TESTE 05 — origem AUTOMÁTICA eliminada COM saldo alternativo ════════ */

resetSeed();
// zera 18/08 E 20/08 ANTES do uso (sem usos → nenhuma reconciliação, sem aviso)
const saida18 = d().entries.filter((e) => e.date === "2026-08-18" && e.type === "saida").at(-1)!;
const saida20 = d().entries.filter((e) => e.date === "2026-08-20" && e.type === "saida").at(-1)!;
assert.ok(actions.updateEntry(saida18.id, { time: "17:00" }, { now: 10 }).ok);
assert.ok(actions.updateEntry(saida20.id, { time: "16:00" }, { now: 11 }).ok);
// uso automático (FIFO) 30min → única origem com geração: 28/08
assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("T05. FIFO: origem perde geração, mas total 30 é preservado redistribuindo pelo FIFO", () => {
  const before = uses().find((u) => u.status === "utilizado")!;
  assert.deepEqual(before.allocations, [{ originDate: "2026-08-28", minutes: 30 }]);
  // restaura 18/08 (edição NÃO afeta o uso: origem dele é 28/08)
  assert.ok(actions.updateEntry(saida18.id, { time: "19:10" }, { now: 20 }).ok);
  assert.equal(activeMinutesTo("2026-08-24"), 30);
  // elimina 28/08 → FIFO redistribui para a origem válida mais antiga (18/08)
  const res = edit28FinalExit("18:30", 2000);
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const after = uses().find((u) => u.id === before.id)!;
  const newTotal = after.allocations.reduce((s, a) => s + a.minutes, 0);
  assert.equal(newTotal, 30, "TOTAL do uso automático preservado");
  assert.equal(after.status, "utilizado", "mesmo uso (in-place), nenhum novo uso criado");
  assert.equal(after.id, before.id, "id preservado");
  assert.equal(after.createdAt, 1000, "createdAt preservado");
  assert.deepEqual(after.allocations, [{ originDate: "2026-08-18", minutes: 30 }], "FIFO: mais antiga válida");
  assert.equal(activeMinutesTo("2026-08-24"), 30);
  const bank = bankOf("2026-08-24");
  // neste cenário 20/08 segue zerado: gerado = 18/08 (40) apenas
  assert.deepEqual([bank.generatedMinutes, bank.usedMinutes, bank.availableMinutes], [40, 30, 10]);
  assert.equal(bank.overusedMinutes, 0);
  assert.ok(res.warning?.includes("redistribu"), "aviso de redistribuição (fluxo automático)");
});

/* ════════ TESTE 06 — origem AUTOMÁTICA eliminada SEM saldo suficiente ════════ */

resetSeed();
// elimina 18/08 e 20/08 do banco (gera 0, sem usos → sem reconciliação)
for (const t of ["2026-08-18", "2026-08-20"]) {
  const last = d().entries.filter((e) => e.date === t && e.type === "saida").at(-1);
  assert.ok(actions.updateEntry(last!.id, { time: "16:00" }, { now: 10 }).ok, `redução de ${t}`);
}
// uso FIFO 30 → única origem com geração: 28/08
assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-24", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);

check("T06. sem lastro suficiente: total cai para o respaldado · projeção regride · histórico", () => {
  const gen28 = bankOf("2026-08-28").lots.find((l) => l.originDate === "2026-08-28")?.generatedMinutes ?? 0;
  assert.equal(gen28, 30);
  // reduz 28/08 → 0: restam 0 válidos no ciclo
  const res = edit28FinalExit("18:30", 2000);
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  assert.equal(activeMinutesTo("2026-08-24"), 0, "nada permanece ativo sem lastro");
  const original = uses().find((u) => u.id === "seu-1")!;
  assert.equal(original.status, "cancelado", "uso reduzido preservado no histórico");
  assert.equal(original.allocations.length, 1, "allocation original auditável");
  assert.ok(original.note?.includes("Reconciliado"), "motivo registrado");
  const { proj } = projectionOf("2026-08-24");
  assert.equal(proj.projectedBalanceMinutes, -30, "projeção regride para o factual");
  const bank = bankOf("2026-08-24");
  assert.equal(bank.overusedMinutes, 0, "integridade: nenhum excesso ativo");
});

/* ════════ TESTE 07 — UMA origem abastece MÚLTIPLOS usos (60 → 40) ════════ */

resetSeed();
// prepara 18/08 gerando 60: entrada 07:00 saída final 18:00 (10h + 1h? já é 60 no seed: 40)... 
// 18/08 no seed gera 40. Para 60: entrada 07:00→ saída 19:00. Simples: reduzir para 40 (sem edit) —
// usamos o próprio 20/08 (60) editado para 40 e dois usos manuais de 30/30 sobre ele.
check("T07. origem 60 abastece 2 usos (30+30); cai p/ 40 → ativo da origem = 40 (mais antigo primeiro)", () => {
  // 20/08 gera 60 no seed. Edita para 40: saída 19:00 → 18:40 (worked 10h40 → [10+] 40min)
  const saida20 = punchId("2026-08-20", "19:00");
  assert.ok(actions.createSpecialExcessUse({
    destinationDate: "2026-08-24",
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: 1000,
  }).ok, "uso A (mais antigo)");
  assert.ok(actions.createSpecialExcessUse({
    destinationDate: "2026-08-26",
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
    asOfDate: ASOF,
    now: 2000,
  }).ok, "uso B (mais novo)");
  const res = actions.updateEntry(saida20, { time: "18:40" }, { now: 3000 }); // 60 → 40
  assert.equal(res.ok, true, `falhou: ${res.error}`);
  const gen = bankOf("2026-08-20").lots.find((l) => l.originDate === "2026-08-20")?.generatedMinutes ?? 0;
  assert.equal(gen, 40);
  const ativosDaOrigem = uses()
    .filter((u) => u.status === "utilizado")
    .flatMap((u) => u.allocations.filter((a) => a.originDate === "2026-08-20").map((a) => a.minutes))
    .reduce((s, m) => s + m, 0);
  assert.equal(ativosDaOrigem, 40, "total ativo na origem = geração (nunca 60)");
  const usoA = uses().find((u) => u.createdAt === 1000)!;
  assert.equal(usoA.status, "utilizado", "uso mais ANTIGO permanece");
  assert.deepEqual(usoA.allocations, [{ originDate: "2026-08-20", minutes: 30 }], "critério existente (3G): mais antigo preserva a parcela inteira");
  const usoBOriginal = uses().find((u) => u.createdAt === 2000)!;
  assert.equal(usoBOriginal.status, "cancelado", "B original preservado no histórico");
  assert.deepEqual(usoBOriginal.allocations, [{ originDate: "2026-08-20", minutes: 30 }], "histórico dos 30min de B");
  const bAtivo = uses()
    .filter((u) => u.status === "utilizado" && u.id !== usoA.id)
    .flatMap((u) => u.allocations)
    .filter((a) => a.originDate === "2026-08-20")
    .reduce((s, a) => s + a.minutes, 0);
  assert.equal(bAtivo, 10, "uso mais novo mantém só o lastro restante (versão reconciliada)");
});

/* ════════ TESTE 08 — reconciliado parcial + cancelamento manual depois ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok);
assert.ok(edit28FinalExit("18:55", 2000).ok); // 10h25 → [10+] 25min → parcial

check("T08. após reconciliação parcial, cancelar o restante: zero ativo · banco correto · sem duplicação", () => {
  const reconciled = uses().find((u) => u.status === "utilizado")!;
  assert.ok(reconciled, "versão ativa reconciliada existe");
  const res = actions.cancelSpecialExcessUse({ id: reconciled.id, now: 5000 });
  assert.equal(res.ok, true, `cancelamento falhou: ${res.error}`);
  assert.equal(activeMinutesTo("2026-08-24"), 0);
  const bank = bankOf("2026-08-24");
  assert.equal(bank.usedMinutes, 0, "nada como utilizado");
  assert.equal(uses().filter((u) => u.status === "utilizado").length, 0);
  assert.ok(uses().length >= 2, "histórico completo (original + reconciliado cancelado)");
});

/* ════════ TESTE 09 — edição ABORTADA (Voltar) ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok);
// destino 26/08 com uso: editar 26/08 (7h→8h) EXIGE confirmação 3G (release)
assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1500 }).ok);

check("T09. 1ª chamada que exigiria reconciliação NÃO persiste; 'Voltar' mantém TUDO", () => {
  const res = actions.updateEntry(punchId("2026-08-26", "16:00"), { time: "17:00" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "special-release-required");
  // snapshot antes do "Continuar": nada mudou
  assert.equal(punchId("2026-08-26", "16:00") !== 0, true);
  const e16 = d().entries.find((e) => e.id === punchId("2026-08-26", "16:00"));
  assert.equal(e16?.time, "16:00", "jornada antiga preservada");
  assert.equal(activeMinutesTo("2026-08-24"), 30, "usos preservados");
  assert.equal(activeMinutesTo("2026-08-26"), 60, "allocations preservadas");
  const bank = bankOf("2026-08-24");
  assert.equal(bank.usedMinutes, 90, "banco idêntico (30+60)");
});

/* ════════ TESTE 10 — atomicidade em FALHA ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok);

check("T10. falha de validação (sequência) → NEM jornada NEM [10+] mudam (nada parcial)", () => {
  const res = actions.updateEntry(punchId("2026-08-28", "19:00"), { time: "10:00" }); // sequência inválida
  assert.equal(res.ok, false);
  assert.equal(res.code, "sequence");
  assert.ok(d().entries.find((e) => e.date === "2026-08-28" && e.time === "19:00"), "batida original intacta");
  assert.equal(activeMinutesTo("2026-08-24"), 30, "uso intacto");
  assert.equal(uses().filter((u) => u.status === "cancelado").length, 0, "nenhuma reconciliação executada");
  const bank = bankOf("2026-08-24");
  assert.deepEqual([bank.generatedMinutes, bank.usedMinutes], [130, 30], "banco idêntico");
});

/* ════════ INVARIANTES + regressões A–H ════════ */

resetSeed();
assert.ok(createManual28("2026-08-24", 30, 1000).ok);
assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1500 }).ok);

check("R-B/C. destino: necessidade diminui devolve (gate) · aumenta NÃO consome mais", () => {
  // B: 26/08 7h→8h exige confirmação e devolve 60 (3G — gate, não silencioso)
  const gated = actions.updateEntry(punchId("2026-08-26", "16:00"), { time: "17:00" });
  assert.equal(gated.code, "special-release-required");
  assert.ok(gated.specialReleases?.[0].releaseMinutes === 60);
  // C: 24/08 7h30→7h (need 30→60): origem 24/08 não tem geração; uso NÃO aumenta
  const res = actions.updateEntry(punchId("2026-08-24", "16:30"), { time: "16:00" });
  assert.equal(res.ok, true);
  assert.equal(activeMinutesTo("2026-08-24"), 30, "nunca consome mais sozinho");
});

resetSeed();
check("R-D/E/F/G. FIFO · manual · origem posterior · >10h seguem intactos (regressão estrutural)", () => {
  // G: 28/08 10h30 → regular +2h, [10+] 30min (geração acima do teto)
  const lot28 = bankOf("2026-08-28").lots.find((l) => l.originDate === "2026-08-28")!;
  assert.equal(lot28.generatedMinutes, 30);
  // F: origem posterior (28/08 > 24/08) válida no mesmo ciclo:
  assert.ok(createManual28("2026-08-24", 30, 1000).ok);
  // D/E: FIFO automático e manual continuam (cobertos pelas suítes 3C/3G.2 — aqui: smoke)
  const res = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: ASOF, now: 2000 });
  assert.equal(res.ok, true, `FIFO automático: ${res.error}`);
});

resetSeed();
check("R-H. dia que CONSUMIA [10+] passa a GERAR: 3G gate devolve + geração correta", () => {
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 60, allocationStrategy: "fifo", asOfDate: ASOF, now: 1000 }).ok);
  // 26/08 editado p/ 10h30 (gera 30 e deixa de precisar): gate 3G + reconciliação de origem coexistem
  const gated = actions.updateEntry(punchId("2026-08-26", "16:00"), { time: "19:30" });
  assert.equal(gated.code, "special-release-required", "gate de destino segue ativo");
  const ok = actions.updateEntry(punchId("2026-08-26", "16:00"), { time: "19:30" }, { specialReleaseConfirmed: true, now: 4000 });
  assert.equal(ok.ok, true, `falhou: ${ok.error}`);
  assert.equal(activeMinutesTo("2026-08-26"), 0, "uso antigo devolvido (não é mais necessário)");
  const bank = bankOf("2026-08-26");
  const gen26 = bank.lots.find((l) => l.originDate === "2026-08-26")?.generatedMinutes ?? 0;
  assert.equal(gen26, 30, "nova geração calculada corretamente");
});

/* ════════ Estrutural: wiring/serialização ════════ */

check("Estrutural. gate central no store; aviso propagado via res.warning; toast no provider", () => {
  const store = src("src/lib/store.ts");
  assert.ok(store.includes("reconcileSpecialOrigins"), "reconciliação de origem no fluxo 3G");
  assert.ok(store.includes("withWarnings"), "warning anexado ao resultado");
  for (const call of ["addEntry", "addEntries", "updateEntry", "deleteEntry"]) {
    const fn = store.slice(store.indexOf(`  ${call}(`));
    assert.ok(fn.includes("reconcileSpecialOrigins("), `${call} reconcilia origens`);
  }
  const provider = src("src/components/special-release-confirm.tsx");
  assert.ok(provider.includes("res.warning") && provider.includes("toast.show"), "feedback §10 na UI");
  // serialização: nota é campo existente — JSON roundtrip preserva histórico
  const original = uses()[0];
  assert.deepEqual(JSON.parse(JSON.stringify(original)), original, "histórico serializável (sem campos novos)");
});

console.log(`\n${passed} verificações 3G.4 passaram.`);
