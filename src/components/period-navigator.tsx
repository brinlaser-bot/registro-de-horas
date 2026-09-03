"use client";

/**
 * 4G — NAVEGADOR DE PERÍODO COMPARTILHADO (Registros · Resumo).
 * MOBILE: [ ‹ ] [ 21/08 → 20/09 ] [ › ] — TODOS na mesma linha (controle
 * único; rótulo curto sem ano quando não há ambiguidade; label completo
 * preservado para acessibilidade). DESKTOP (sm+): rótulo completo do
 * período + setas, como antes.
 *
 * 4G.1 — CONTEXTO + AÇÃO SEPARADOS:
 *  · `contextLabel` é INFORMAÇÃO (Período passado/atual/futuro — derivado
 *    em periods.ts, nunca "anterior");
 *  · `onBackToCurrent` é AÇÃO: botão real "Ir para o período atual"
 *    (borda/hover/foco/cursor), exibido SOMENTE fora do período atual.
 *  A navegação [‹][rótulo][›] nunca quebra: o sub-bloco é nowrap e o
 *  contexto/botão quebram para a linha de baixo no mobile (flex-wrap).
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
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto" aria-label={fullLabel}>
      {/* Sub-bloco de navegação — NUNCA quebra (nowrap lógico via flex-none). */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <Button variant="secondary" size="sm" onClick={onPrev} aria-label="Período anterior" className="shrink-0">
          <ChevronLeft size={16} />
        </Button>
        <div className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-center text-sm font-extrabold text-slate-800 sm:flex-none sm:text-left">
          <span className="sm:hidden" title={fullLabel}>{shortLabel}</span>
          <span className="hidden sm:inline">{fullLabel}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={onNext} aria-label="Próximo período" className="shrink-0">
          <ChevronRight size={16} />
        </Button>
      </div>
      {contextLabel && (
        <Badge tone="slate" className="shrink-0">
          {contextLabel}
        </Badge>
      )}
      {onBackToCurrent && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onBackToCurrent}
          className="shrink-0 border-emerald-300 font-bold text-emerald-700 hover:bg-emerald-50"
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
