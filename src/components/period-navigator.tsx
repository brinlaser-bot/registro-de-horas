"use client";

/**
 * 4G — NAVEGADOR DE PERÍODO COMPARTILHADO (Registros · Resumo).
 *
 * 4G.1 — CONTEXTO + AÇÃO SEPARADOS:
 *  · `contextLabel` é INFORMAÇÃO (Período passado/atual/futuro — derivado
 *    em periods.ts, nunca "anterior");
 *  · `onBackToCurrent` é AÇÃO: botão real "Ir para o período atual"
 *    (borda/hover/foco/cursor), exibido SOMENTE fora do período atual.
 *
 * 4G.2 — MOBILE SEM PERÍODO ESPREMIDO (validação manual 412px):
 *  LINHA 1 — APENAS NAVEGAÇÃO: [ ‹ ] [ 21/07 → 20/08 ] [ › ]
 *    · três blocos; datas em UMA linha (whitespace-nowrap no box);
 *    · setas NUNCA encolhem (shrink-0); centro ocupa o espaço restante
 *      (flex-1 min-w-0) — zero scroll horizontal;
 *  LINHA 2 — CONTEXTO (apenas mobile, pode quebrar entre si):
 *    [ Período passado/futuro ] [ ↩ Ir para o período atual ]
 *    (no período atual resta só o badge informativo).
 *  DESKTOP (sm+): layout único validado preservado — navegação + contexto +
 *    ação na MESMA linha.
 */
import { ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";

export function PeriodNavigator({
  fullLabel,
  shortLabel,
  onPrev,
  onNext,
  contextLabel,
  onBackToCurrent,
  trailing,
}: {
  /** Rótulo completo (desktop + acessibilidade): "Período do ponto: 21/08/2026 → 20/09/2026". */
  fullLabel: string;
  /** Rótulo curto do mobile: "21/08 → 20/09". */
  shortLabel: string;
  onPrev: () => void;
  onNext: () => void;
  /** 4G.1 — contexto INFORMATIVO do período exibido ("Período passado"…). */
  contextLabel?: string;
  /** 4G.1 — AÇÃO de retorno; passe somente quando o período exibido ≠ atual. */
  onBackToCurrent?: () => void;
  /** Extras (desktop à direita do rótulo; mobile em linha quando couber). */
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2"
      aria-label={fullLabel}
    >
      {/* LINHA 1 — SOMENTE NAVEGAÇÃO (mobile e desktop): sub-bloco que NUNCA
          quebra; setas shrink-0; centro flex-1 min-w-0 com nowrap. */}
      <div className="flex min-w-0 items-center gap-2 sm:flex-none">
        <Button variant="secondary" size="sm" onClick={onPrev} aria-label="Período anterior" className="shrink-0">
          <ChevronLeft size={16} />
        </Button>
        <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-center text-sm font-extrabold text-slate-800 sm:flex-none sm:text-left">
          <span className="sm:hidden" title={fullLabel}>{shortLabel}</span>
          <span className="hidden sm:inline">{fullLabel}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={onNext} aria-label="Próximo período" className="shrink-0">
          <ChevronRight size={16} />
        </Button>
      </div>
      {/* LINHA 2 — CONTEXTO (apenas mobile): informação + ação podem quebrar
          ENTRE SI, mas nunca dentro do box de datas. */}
      {(contextLabel || onBackToCurrent) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:hidden">
          {contextLabel && (
            <Badge tone="slate">
              {contextLabel}
            </Badge>
          )}
          {onBackToCurrent && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onBackToCurrent}
              className="border-emerald-300 font-bold text-emerald-700 hover:bg-emerald-50"
              aria-label="Ir para o período atual"
            >
              <Undo2 size={14} aria-hidden />
              <span>Ir para o período atual</span>
            </Button>
          )}
        </div>
      )}
      {/* DESKTOP (sm+) — contexto + ação na MESMA linha da navegação
          (layout único validado na 4G/4G.1, preservado). */}
      {contextLabel && (
        <Badge tone="slate" className="hidden shrink-0 sm:inline-flex">
          {contextLabel}
        </Badge>
      )}
      {onBackToCurrent && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onBackToCurrent}
          className="hidden shrink-0 border-emerald-300 font-bold text-emerald-700 hover:bg-emerald-50 sm:inline-flex"
          aria-label="Ir para o período atual"
        >
          <Undo2 size={14} aria-hidden />
          <span>Ir para o período atual</span>
        </Button>
      )}
      {trailing}
    </div>
  );
}
