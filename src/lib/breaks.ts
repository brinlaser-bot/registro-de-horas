// ─────────────────────────────────────────────────────────────
// POLÍTICA CENTRAL de intervalo.
//
// A obrigação do dia (effectiveExpected) decide se há intervalo de 1h —
// nunca o horário isolado da primeira entrada ("começou às 13h ≠ meia jornada").
// Intervalo explícito (Saída→Entrada) SEMPRE substitui o automático.
// O automático NÃO é batida persistida: só visual/cálculo derivado.
// ─────────────────────────────────────────────────────────────
import { analyzePunches, shouldAutoDeductLunch, type PunchAnalysis } from "./punches";
import { fromMinutes, toMinutes, type DerivedBreak, type TimeEntryLike, type WorkSettings } from "./time";

/** ~4h: jornadas curtas (ex.: ABONO PARCIAL 13–17) não exigem intervalo de 1h. */
export const SHORT_DAY_MINUTES = 4 * 60;
export const CONTINUOUS_BEFORE_BREAK = 4 * 60;

export function breakRequiredForExpected(effectiveExpected: number, settings: WorkSettings): boolean {
  if (!settings.autoDeductLunch) return false;
  return effectiveExpected > SHORT_DAY_MINUTES;
}

export function lunchDurationMinutes(settings: WorkSettings): number {
  return Math.max(0, toMinutes(settings.lunchEnd) - toMinutes(settings.lunchStart));
}

/** Permanência bruta vs trabalho líquido estimado no lançamento manual. */
export function stayAndNetMinutes(
  periods: Array<{ entrada: string; saida: string }>,
  settings: WorkSettings,
  mode: "periodo" | "intervalo",
): { stay: number; autoBreak: number; net: number } {
  const stay = periods.reduce((s, p) => {
    if (!p.entrada || !p.saida) return s;
    const d = toMinutes(p.saida) - toMinutes(p.entrada);
    return d > 0 ? s + d : s;
  }, 0);
  if (mode === "intervalo" || stay <= 0) return { stay, autoBreak: 0, net: stay };
  const filled = periods.filter((p) => p.entrada && p.saida && toMinutes(p.saida) > toMinutes(p.entrada));
  if (filled.length !== 1) return { stay, autoBreak: 0, net: stay };
  const brk = lunchDurationMinutes(settings);
  if (!settings.autoDeductLunch || brk <= 0) return { stay, autoBreak: 0, net: stay };
  const first = toMinutes(filled[0].entrada);
  const last = toMinutes(filled[0].saida);
  const ls = toMinutes(settings.lunchStart);
  const le = toMinutes(settings.lunchEnd);
  if (first <= ls && last >= le) return { stay, autoBreak: brk, net: Math.max(0, stay - brk) };
  return { stay, autoBreak: 0, net: stay };
}

/** Marca visual do intervalo automático (NÃO é punch real). */
export function derivedAutomaticBreak(
  analysis: PunchAnalysis,
  settings: WorkSettings,
  effectiveExpected: number,
): DerivedBreak | null {
  if (!breakRequiredForExpected(effectiveExpected, settings)) return null;
  if (!shouldAutoDeductLunch(analysis, settings)) return null;
  const minutes = lunchDurationMinutes(settings);
  if (minutes <= 0) return null;
  const first = analysis.sorted[0];
  if (!first) return null;
  const startMin = toMinutes(first.time) + CONTINUOUS_BEFORE_BREAK;
  const endMin = startMin + minutes;
  return {
    start: fromMinutes(startMin),
    end: fromMinutes(endMin),
    minutes,
    source: "automatic_break",
  };
}

/** Previsão (jornada aberta válida): ainda não cria Saída. */
export function predictedBreakWindow(
  entries: TimeEntryLike[],
  settings: WorkSettings,
  effectiveExpected: number,
): DerivedBreak | null {
  if (!breakRequiredForExpected(effectiveExpected, settings)) return null;
  const analysis = analyzePunches(entries);
  if (!analysis.isConsistent || analysis.sorted.length === 0) return null;
  if (analysis.pairs.length >= 1) {
    // Já há gap explícito ou pares — a previsão de "ainda vai sair para intervalo" some.
    const first = analysis.sorted[0];
    const last = analysis.sorted[analysis.sorted.length - 1];
    if (last.type === "saida") return derivedAutomaticBreak(analysis, settings, effectiveExpected);
    if (analysis.pairs.length >= 1 && first) {
      // Ainda aberto após um par: intervalo já ocorreu.
      return null;
    }
  }
  const first = analysis.sorted[0];
  if (first.type !== "entrada") return null;
  const minutes = lunchDurationMinutes(settings);
  if (minutes <= 0) return null;
  const startMin = toMinutes(first.time) + CONTINUOUS_BEFORE_BREAK;
  return {
    start: fromMinutes(startMin),
    end: fromMinutes(startMin + minutes),
    minutes,
    source: "automatic_break",
  };
}
