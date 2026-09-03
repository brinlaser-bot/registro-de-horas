"use client";

/**
 * 4G — NAVEGADOR DE PERÍODO COMPARTILHADO (Registros · Resumo).
 * MOBILE: [ ‹ ] [ 21/08 → 20/09 ] [ › ] — TODOS na mesma linha (controle
 * único; rótulo curto sem ano quando não há ambiguidade; label completo
 * preservado para acessibilidade). DESKTOP (sm+): rótulo completo do
 * período + setas, como antes.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";

export function PeriodNavigator({
  fullLabel,
  shortLabel,
  onPrev,
  onNext,
  trailing,
}: {
  /** Rótulo completo (desktop + acessibilidade): "Período do ponto: 21/08/2026 → 20/09/2026". */
  fullLabel: string;
  /** Rótulo curto do mobile: "21/08 → 20/09". */
  shortLabel: string;
  onPrev: () => void;
  onNext: () => void;
  /** Extras (desktop à direita do rótulo; mobile em linha quando couber). */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto" aria-label={fullLabel}>
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
      {trailing}
    </div>
  );
}
