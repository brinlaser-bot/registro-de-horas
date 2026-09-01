// ─────────────────────────────────────────────────────────────
// FONTE CENTRAL da sequência de batidas.
//
// Ordena por horário real, forma pares Entrada→Saída SEM pular órfãos,
// detecta inconsistência/incompletude/sobreposição e diz a próxima ação.
// NUNCA usa paridade (length % 2). computeDay, store, Smart Exit, UI
// e o lançamento manual devem consumir ESTE módulo.
// ─────────────────────────────────────────────────────────────
import type { EntryType, Segment, TimeEntryLike, WorkSettings } from "./time";

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function sortedPunchEntries<T extends TimeEntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id);
}

export type PunchIssueKind =
  | "orphan_entry"
  | "orphan_exit"
  | "consecutive_entries"
  | "consecutive_exits"
  | "overlap"
  | "duplicate_time"
  | "invalid_order"
  | "incomplete_past_day";

export interface PunchIssue {
  kind: PunchIssueKind;
  message: string;
  time?: string;
}

export interface PunchPair {
  start: string;
  end: string;
  minutes: number;
  entryId: number;
  exitId: number;
}

export interface PunchAnalysis {
  sorted: TimeEntryLike[];
  pairs: PunchPair[];
  orphanPunches: TimeEntryLike[];
  issues: PunchIssue[];
  isComplete: boolean;
  isConsistent: boolean;
  nextExpectedType: EntryType | null;
  workedMinutesConfirmed: number;
  canFinalizeFinancialDay: boolean;
}

function overlapMinutes(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** Análise pura da sequência de UM dia. */
export function analyzePunches(entries: TimeEntryLike[]): PunchAnalysis {
  const sorted = sortedPunchEntries(entries);
  const issues: PunchIssue[] = [];
  const pairs: PunchPair[] = [];
  const orphanPunches: TimeEntryLike[] = [];

  const times = new Map<string, number>();
  for (const e of sorted) {
    times.set(e.time, (times.get(e.time) ?? 0) + 1);
  }
  for (const [time, n] of times) {
    if (n > 1) {
      issues.push({ kind: "duplicate_time", message: `Há mais de uma batida no horário ${time}.`, time });
    }
  }

  if (sorted.length > 0 && sorted[0].type !== "entrada") {
    issues.push({
      kind: "orphan_exit",
      message: "A jornada precisa começar com uma entrada.",
      time: sorted[0].time,
    });
    orphanPunches.push(sorted[0]);
  }

  let open: TimeEntryLike | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.type === "entrada") {
      if (open) {
        issues.push({
          kind: "consecutive_entries",
          message: `Esta alteração criaria duas entradas consecutivas (${open.time} e ${e.time}). Escolha um horário compatível com as batidas existentes.`,
          time: e.time,
        });
        orphanPunches.push(open);
        open = e;
      } else {
        open = e;
      }
    } else {
      if (!open) {
        const prev = i > 0 ? sorted[i - 1] : null;
        issues.push({
          kind: prev?.type === "saida" ? "consecutive_exits" : "orphan_exit",
          message:
            prev?.type === "saida"
              ? `Esta alteração criaria duas saídas consecutivas (${prev.time} e ${e.time}). Escolha um horário compatível com as batidas existentes.`
              : `Há uma saída às ${e.time} sem entrada correspondente.`,
          time: e.time,
        });
        orphanPunches.push(e);
      } else {
        const mins = toMinutes(e.time) - toMinutes(open.time);
        if (mins <= 0) {
          issues.push({
            kind: "invalid_order",
            message: `A saída das ${e.time} não é posterior à entrada das ${open.time}.`,
            time: e.time,
          });
        } else {
          pairs.push({
            start: open.time,
            end: e.time,
            minutes: mins,
            entryId: open.id,
            exitId: e.id,
          });
        }
        open = null;
      }
    }
  }
  if (open) {
    issues.push({
      kind: "orphan_entry",
      message: `Existe uma entrada sem saída correspondente neste dia (${open.time}).`,
      time: open.time,
    });
    orphanPunches.push(open);
  }

  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a1 = toMinutes(pairs[i].start);
      const a2 = toMinutes(pairs[i].end);
      const b1 = toMinutes(pairs[j].start);
      const b2 = toMinutes(pairs[j].end);
      if (overlapMinutes(a1, a2, b1, b2) > 0) {
        issues.push({
          kind: "overlap",
          message: overlapMessage(pairs[i]),
          time: pairs[j].start,
        });
      }
    }
  }

  const blocking = issues.filter((i) => i.kind !== "orphan_entry");
  const isConsistent = blocking.length === 0;
  const isComplete = isConsistent && sorted.length > 0 && !open;
  const last = sorted[sorted.length - 1];
  const nextExpectedType: EntryType | null = !isConsistent
    ? null
    : !last
      ? "entrada"
      : last.type === "entrada"
        ? "saida"
        : "entrada";

  return {
    sorted,
    pairs,
    orphanPunches,
    issues,
    isComplete,
    isConsistent,
    nextExpectedType,
    workedMinutesConfirmed: pairs.reduce((s, p) => s + p.minutes, 0),
    canFinalizeFinancialDay: isComplete && isConsistent,
  };
}

function overlapMessage(a: PunchPair): string {
  return `Este período se sobrepõe ao registro existente de ${a.start} a ${a.end}. Escolha um intervalo que não se sobreponha aos registros existentes.`;
}

/** Próximo tipo esperado — só confia na sequência cronológica VALIDADA. */
export function nextExpectedPunchType(entries: TimeEntryLike[]): EntryType {
  return analyzePunches(entries).nextExpectedType ?? "entrada";
}

/**
 * Tipo coerente para inserir um horário na linha do tempo (NÃO é append).
 * Olha a última batida ESTRITAMENTE anterior ao horário.
 * Ex.: 08E 13E 17S + 12:00 → Saída (depois da 08E).
 */
export function suggestedPunchTypeAt(entries: TimeEntryLike[], time: string): EntryType {
  const before = sortedPunchEntries(entries).filter((e) => e.time < time);
  if (before.length === 0) return "entrada";
  return before[before.length - 1].type === "entrada" ? "saida" : "entrada";
}

export function sequenceErrorMessage(analysis: PunchAnalysis): string | undefined {
  if (analysis.isConsistent) return undefined;
  const overlap = analysis.issues.find((i) => i.kind === "overlap");
  if (overlap) return overlap.message;
  const consecE = analysis.issues.find((i) => i.kind === "consecutive_entries");
  if (consecE) return consecE.message;
  const consecS = analysis.issues.find((i) => i.kind === "consecutive_exits");
  if (consecS) {
    return consecS.message;
  }
  const twoS = analysis.issues.find((i) => i.kind === "orphan_exit" || i.kind === "consecutive_exits");
  if (twoS && analysis.sorted.some((e, i, arr) => i > 0 && e.type === "saida" && arr[i - 1].type === "saida")) {
    return "Esta alteração criaria duas saídas consecutivas. Escolha um horário compatível com as batidas existentes.";
  }
  return analysis.issues[0]?.message ?? "Essa alteração criaria uma sequência de batidas inválida.";
}

/**
 * Valida a sequência RESULTANTE após incluir `added` (substituição se o id já existir).
 * Sequência consistente — completa ou incompleta (termina em entrada) — é aceita.
 */
export function punchMutationError(
  dayEntries: TimeEntryLike[],
  added: TimeEntryLike | TimeEntryLike[],
): string | null {
  const extra = Array.isArray(added) ? added : [added];
  const ids = new Set(extra.map((e) => e.id));
  const finalList = [...dayEntries.filter((e) => !ids.has(e.id)), ...extra];
  const analysis = analyzePunches(finalList);
  if (analysis.isConsistent) return null;

  const last = analysis.sorted[analysis.sorted.length - 1];
  if (extra.length === 1 && last && extra[0].id === last.id) {
    if (analysis.issues.some((i) => i.kind === "consecutive_entries")) {
      return "Já existe uma entrada aberta. A próxima batida deve ser uma saída.";
    }
    if (analysis.issues.some((i) => i.kind === "consecutive_exits" || i.kind === "orphan_exit")) {
      return "A próxima batida deve ser uma entrada.";
    }
  }

  const newTimes = extra.map((e) => toMinutes(e.time));
  const newMin = Math.min(...newTimes);
  const newMax = Math.max(...newTimes);
  const existingPairs = analyzePunches(dayEntries.filter((e) => !ids.has(e.id))).pairs;
  for (const p of existingPairs) {
    if (overlapMinutes(toMinutes(p.start), toMinutes(p.end), newMin, newMax) > 0) {
      return `Este período se sobrepõe ao registro existente de ${p.start} a ${p.end}. Escolha um intervalo que não se sobreponha aos registros existentes.`;
    }
  }

  const bounds = suggestedWindow(dayEntries.filter((e) => !ids.has(e.id)), extra[0]);
  const msg = sequenceErrorMessage(analysis);
  if (bounds) return `${msg} ${bounds}`;
  return msg ?? null;
}

function suggestedWindow(existing: TimeEntryLike[], added: TimeEntryLike): string | null {
  const sorted = sortedPunchEntries(existing);
  if (sorted.length === 0) return null;
  const before = [...sorted].reverse().find((e) => e.time < added.time);
  const after = sorted.find((e) => e.time > added.time);
  if (before && after) {
    return `Esta ${added.type === "entrada" ? "Entrada" : "Saída"} deve ficar depois da ${before.type === "saida" ? "Saída" : "Entrada"} das ${before.time} e antes da ${after.type === "saida" ? "Saída" : "Entrada"} das ${after.time}.`;
  }
  return null;
}

/** Intervalo explícito que intersecta a faixa de almoço configurada. */
export function explicitLunchGapMinutes(
  pairs: PunchPair[],
  settings: WorkSettings,
): number | null {
  if (pairs.length < 1) return null;
  const ls = toMinutes(settings.lunchStart);
  const le = toMinutes(settings.lunchEnd);
  let best: number | null = null;
  const sorted = [...pairs].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = toMinutes(sorted[i].end);
    const gapEnd = toMinutes(sorted[i + 1].start);
    if (gapEnd <= gapStart) continue;
    if (overlapMinutes(gapStart, gapEnd, ls, le) > 0) {
      const dur = gapEnd - gapStart;
      if (best === null || dur > best) best = dur;
    }
  }
  return best;
}

/**
 * 4D.4.3 — Σ das pausas REAIS do dia: tempo entre cada SAÍDA e a PRÓXIMA
 * ENTRADA (gaps entre pares consecutivos). Esse tempo já está FORA dos
 * segmentos trabalhados — é pausa efetivamente representada pelas batidas.
 */
export function totalRealBreakMinutes(pairs: PunchPair[]): number {
  if (pairs.length < 2) return 0;
  const sorted = [...pairs].sort((a, b) => a.start.localeCompare(b.start));
  let total = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = toMinutes(sorted[i].end);
    const gapEnd = toMinutes(sorted[i + 1].start);
    if (gapEnd > gapStart) total += gapEnd - gapStart;
  }
  return total;
}

/** Deve aplicar o fallback de 1h de almoço? */
export function shouldAutoDeductLunch(
  analysis: PunchAnalysis,
  settings: WorkSettings,
): boolean {
  if (!settings.autoDeductLunch || analysis.sorted.length === 0) return false;
  if (explicitLunchGapMinutes(analysis.pairs, settings) !== null) return false;
  const ls = toMinutes(settings.lunchStart);
  const le = toMinutes(settings.lunchEnd);
  const first = toMinutes(analysis.sorted[0].time);
  const last = toMinutes(analysis.sorted[analysis.sorted.length - 1].time);
  if (!(first <= ls && last >= le)) return false;
  const spansLunch = analysis.pairs.some((p) => toMinutes(p.start) <= ls && toMinutes(p.end) >= le);
  return spansLunch || (analysis.pairs.length === 0 && analysis.isConsistent);
}

export function lunchDeductionOf(analysis: PunchAnalysis, settings: WorkSettings): number {
  // Política existente preservada: pausa real DENTRO da faixa de almoço
  // neutraliza o fallback por completo.
  if (explicitLunchGapMinutes(analysis.pairs, settings) !== null) return 0;
  if (!shouldAutoDeductLunch(analysis, settings)) return 0;
  /* 4D.4.3 — REGRA CANÔNICA: tempo entre SAÍDA e PRÓXIMA ENTRADA já é tempo
   * não trabalhado (ficou fora dos segmentos). O intervalo automático é
   * FALLBACK para pausa NÃO representada pelas batidas — deduz apenas o que
   * falta para completar a pausa mínima, NUNCA o mesmo período duas vezes:
   *   autoIntervalRemaining = max(0, exigido − já representado pelos gaps). */
  const required = Math.max(0, toMinutes(settings.lunchEnd) - toMinutes(settings.lunchStart));
  return Math.max(0, required - totalRealBreakMinutes(analysis.pairs));
}

export function segmentsOf(pairs: PunchPair[]): Segment[] {
  return pairs.map((p) => ({ start: p.start, end: p.end, minutes: p.minutes }));
}

export function formatClockHint(time: string): string {
  return time;
}
