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
 * 4G.2 — MOBILE SEM PERÍODO ESPREMIDO:
 *  LINHA 1 — APENAS NAVEGAÇÃO: [ ‹ ] [ 21/07 → 20/08 ] [ › ]
 *    (datas em UMA linha, setas NUNCA encolhem, zero scroll horizontal);
 *  LINHA 2 — CONTEXTO: [ Período passado/futuro ] [ ↩ Ir para o período
 *    atual ] (no período atual resta só o badge; pode quebrar ENTRE si).
 *
 * 4G.2.1 — UMA ÚNICA INSTÂNCIA de contexto/botão (correção da duplicação
 *  validada no mobile 412px): NÃO existem mais blocos JSX "mobile" e
 *  "desktop" equivalentes escondidos por utilitários responsivos — no CSS
 *  compilado, .inline-flex (classe base de Button/Badge) vinha DEPOIS de
 *  .hidden e vencia o esconderijo, renderizando o contexto DUAS VEZES.
 *  Agora existe UM badge e UM botão, e o POSICIONAMENTO vem do fluxo flex:
 *  no mobile o sub-bloco de navegação ocupa a linha inteira (w-full) e o
 *  contexto/ação quebram NATURALMENTE para a linha 2 (flex-wrap); no desktop
 *  (sm:w-auto sm:flex-nowrap) tudo volta para a linha única validada.
 *  Duplicação estruturalmente impossível.
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
      className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap"
      aria-label={fullLabel}
    >
      {/* LINHA 1 — SOMENTE NAVEGAÇÃO: no mobile ocupa a LINHA INTEIRA (w-full),
          empurrando contexto/ação para a linha 2; no desktop (sm:w-auto)
          volta a dividir a linha única validada. Setas shrink-0 (nunca
          encolhem); centro flex-1 min-w-0 com nowrap + overflow-hidden
          (zero scroll horizontal em 320/360/412). */}
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
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
      {/* CONTEXTO + AÇÃO — instância ÚNICA (4G.2.1): no mobile FORMAM a linha
          2 (quebra natural do flex-wrap; em 320px podem quebrar ENTRE si); no
          desktop seguem NA MESMA linha da navegação (layout 4G/4G.1). */}
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
