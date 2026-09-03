// ─────────────────────────────────────────────────────────────
// ETAPA 4H — FECHAMENTO ANUAL DO CICLO (MODELO DE DOMÍNIO PURO).
//
// O ciclo anual (01/05 → 30/04) é uma unidade FORMAL de fechamento.
// Depois que o ciclo terminou (today > cycleEnd), a usuária decide
// MANUALMENTE "Encerrar ciclo". Esse fechamento é DEFINITIVO:
//  - bloqueia toda mutação em datas do ciclo (períodos não podem ser
//    reabertos, batidas/usos/reservas/calendário do ciclo são imutáveis);
//  - exige uma decisão explícita sobre o saldo [10+] final:
//      · nenhum saldo  → disposition "none";
//      · liquidar      → "liquidated" (não reutilizado no próximo ciclo);
//      · transportar   → "carried"   (vira saldo operacional no ciclo
//                          seguinte, preservando a origem cronológica).
//
// NENHUMA transação comum atravessa o fechamento (30/04): uso/reserva/
// planejamento diretos entre ciclos continuam PROIBIDOS. O ÚNICO mecanismo
// legítimo de passagem é este fechamento → "Transportar".
//
// O transporte NUNCA é automático e NÃO reinventa o saldo: carrega apenas o
// que REALMENTE restou, e uma origem já transportada que restar no próximo
// fechamento volta a exigir nova decisão (liquidar/transportar) — sempre
// preservando a data/origem cronológica ORIGINAL.
//
// Persistência: coleção `annualCycleClosures` em AppData (backup v4).
// Este arquivo é DERIVAÇÃO PURA/estrutura — a decisão e a escrita ficam no
// store (actions), que também é a fronteira de bloqueio definitivo do ciclo.
// ─────────────────────────────────────────────────────────────

export type AnnualClosureDisposition = "none" | "liquidated" | "carried";

/** Uma fatia do saldo [10+] final de um ciclo no fechamento.
 *  Para origem FACTUAL do próprio ciclo, originalOriginDate == o dia que
 *  gerou. Para saldo TRANSPORTADO de ciclos anteriores que restou e é
 *  novamente destinado, originalOriginDate preserva o dia FACTUAL original
 *  (nunca reinicia a "idade" em 01/05) e originCycle é o ciclo onde o [10+]
 *  nasceu de fato. */
export interface AnnualCycleClosureSourceSlice {
  /** Dia FACTUAL original que gerou este [10+] (YYYY-MM-DD). */
  originalOriginDate: string;
  /** Minutos desta fatia (só o que realmente restou). */
  minutes: number;
  /** Ciclo anual em que este [10+] nasceu de fato (origem cronológica). */
  originCycle: string;
  /** Proveniência legível (humana) do transporte/liquidação. */
  provenance: string;
}

export interface AnnualCycleClosure {
  /** id canônico ex.: "acc-2026-2027". */
  id: string;
  /** Rótulo do ciclo encerrado ex.: "2026/2027". */
  cycleLabel: string;
  cycleStart: string; // 01/05/AAAA
  cycleEnd: string; // 30/04/AAAA
  /** Sempre "closed" — não existe reabertura de ciclo nesta etapa. */
  status: "closed";
  /** Epoch ms do encerramento. */
  closedAt: number;
  /** ids das consolidações de período ativas no fechamento. */
  periodConsolidationIds: number[];
  /** Saldo [10+] final destinado (Σ sourceSlices; 0 quando disposition none). */
  closingSpecialExcessMinutes: number;
  disposition: AnnualClosureDisposition;
  /** Quando carried: cicloStart do ciclo destino (01/05 do ano seguinte). */
  destinationCycleStart?: string;
  sourceSlices: AnnualCycleClosureSourceSlice[];
  /** Observação opcional (ex.: contexto humano). */
  note?: string | null;
}

/* ── Rótulo do ciclo anual ─────────────────────────────── */
/** "2026/2027" a partir de um 01/05 de ciclo (ex.: annualCycleBounds). */
export function cycleLabelFromStart(cycleStart: string): string {
  const y = Number(cycleStart.slice(0, 4));
  return `${y}/${y + 1}`;
}

/** Rótulo do ciclo ANTERIOR a um rótulo. */
export function previousCycleLabel(label: string): string {
  const y = Number(label.split("/")[0]);
  return `${y - 1}/${y}`;
}

/** Rótulo do ciclo SEGUINTE a um rótulo. */
export function nextCycleLabel(label: string): string {
  const y = Number(label.split("/")[0]);
  return `${y + 1}/${y + 2}`;
}

/** Primeira data (01/05) do ciclo seguinte ao rótulo informado. */
export function nextCycleStartFromLabel(label: string): string {
  const y = Number(label.split("/")[0]);
  return `${y + 1}-05-01`;
}

/** id canônico do fechamento de um ciclo. */
export function closureIdOf(label: string): string {
  return `acc-${label.replace("/", "-")}`;
}

/** Fechamento registrado para o ciclo (por rótulo), se houver. */
export function closureForCycle(
  closures: AnnualCycleClosure[] | undefined,
  label: string,
): AnnualCycleClosure | null {
  return (closures ?? []).find((c) => c.cycleLabel === label) ?? null;
}

/** true quando o ciclo (por rótulo) já foi formalmente encerrado. */
export function cycleIsClosed(
  closures: AnnualCycleClosure[] | undefined,
  label: string,
): boolean {
  return closureForCycle(closures, label) !== null;
}

/**
 * Fatias TRANSPORTADAS que ficam operacionais num ciclo DESTINO.
 * Fonte: o fechamento do ciclo ANTERIOR com disposition "carried".
 * Devolve as fatias com origem cronológica ORIGINAL (o dia factual em que
 * nasceram), prontas para lastrear usos/reservas/FIFO no ciclo novo.
 */
export function carriedSlicesIntoCycle(
  closures: AnnualCycleClosure[] | undefined,
  destLabel: string,
): AnnualCycleClosureSourceSlice[] {
  const prev = closureForCycle(closures, previousCycleLabel(destLabel));
  if (!prev || prev.disposition !== "carried") return [];
  // start do PRÓPRIO ciclo destino (ex.: "2026/2027" → 2026-05-01). NOTE:
  // nextCycleStartFromLabel devolve o start do ciclo SEGUINTE ao rótulo —
  // não é o que aqui queremos.
  const y = Number(destLabel.split("/")[0]);
  const destStart = `${y}-05-01`;
  if (prev.destinationCycleStart && prev.destinationCycleStart !== destStart) return [];
  return prev.sourceSlices.map((s) => ({ ...s }));
}

/** Bloqueia? Determina se qualquer data cai em ciclo formalmente encerrado. */
export function dateFallsInClosedCycle(
  closures: AnnualCycleClosure[] | undefined,
  date: string,
): boolean {
  return (closures ?? []).some((c) => c.status === "closed" && date >= c.cycleStart && date <= c.cycleEnd);
}

/** Ordena fechamentos por ciclo (ascendente) para exibição. */
export function sortedClosures(closures: AnnualCycleClosure[] | undefined): AnnualCycleClosure[] {
  return (closures ?? []).slice().sort((a, b) => (a.cycleStart < b.cycleStart ? -1 : 1));
}
