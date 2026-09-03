"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  DAY_SITUATION_GROUPS,
  situationChip,
  type DaySituationId,
} from "@/lib/day-situation";

interface Props {
  selected: DaySituationId[];
  onChange: (next: DaySituationId[]) => void;
}

/** 4E.1 — Dropdown compacto com multiseleção, à prova de viewport:
 *  · painel FIXED com posição calculada a partir do trigger e PRESA dentro
 *    da área útil da tela (nunca ultrapassa a viewport, sem scroll
 *    horizontal da página) — largura ≤ min(w-72, 100vw − 2×margem);
 *  · reposiciona em scroll/resize enquanto aberto;
 *  · fecha por: clique/touch FORA, seleção ("Todos os dias"), novo clique no
 *    trigger (alterna) e Escape (devolve o foco ao trigger);
 *  · checkboxes (multisseleção) permanecem com o painel aberto para permitir
 *    combinar situações — a remoção unitária fica nos chips ("Situação do
 *    dia:") e "Todos os dias" limpa e fecha;
 *  · acessibilidade preservada: trigger é <button> com aria-expanded/
 *    aria-haspopup, opções são <label><input type="checkbox"> nativos.
 * Não aplica regra financeira. */
const PANEL_MAX_W = 288; // w-72
const VIEWPORT_MARGIN = 8;

/** 4E.1 — Caixa do painel (pura, testável): presa à área útil da viewport.
 *  Largura = min(PANEL_MAX_W, vw − 2×margem); left = clamp(left do trigger,
 *  margem, vw − margem − largura). Nunca ultrapassa a viewport. */
export function daySituationPanelBox(
  trigger: { left: number; bottom: number },
  vw: number,
): { top: number; left: number; width: number } {
  const width = Math.min(PANEL_MAX_W, vw - VIEWPORT_MARGIN * 2);
  const left = Math.max(VIEWPORT_MARGIN, Math.min(trigger.left, vw - VIEWPORT_MARGIN - width));
  return { top: trigger.bottom + 6, left, width };
}

export function DaySituationFilter({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** Posição do painel presa à área útil da viewport (com margem lateral). */
  const positionFromTrigger = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(daySituationPanelBox({ left: r.left, bottom: r.bottom }, window.innerWidth));
  };

  const toggleOpen = () => {
    if (!open) positionFromTrigger();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const reposition = () => positionFromTrigger();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const toggle = (id: DaySituationId) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
      <span id="day-situation-filter-label">Situação do dia</span>
      <button
        type="button"
        ref={triggerRef}
        onClick={toggleOpen}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="day-situation-filter-panel"
        className="mt-0.5 flex h-9 w-56 max-w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold normal-case tracking-normal text-slate-700 outline-none"
      >
        <span className="truncate">
          {selected.length === 0 ? "Todos os dias" : `${selected.length} selecionada${selected.length === 1 ? "" : "s"}`}
        </span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && pos && (
        <div
          id="day-situation-filter-panel"
          ref={panelRef}
          role="group"
          aria-labelledby="day-situation-filter-label"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
          }}
          className="z-50 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setOpen(false); // seleção ⇒ fecha
            }}
            className={`mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold cursor-pointer ${
              selected.length === 0 ? "bg-emerald-50 text-emerald-800" : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            Todos os dias
          </button>
          {DAY_SITUATION_GROUPS.map((group) => (
            <div key={group.title} className="mt-1 border-t border-slate-100 pt-1.5">
              <p className="px-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                {group.title}
              </p>
              {group.options.map((opt) => {
                const on = selected.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(opt.id)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DaySituationChips({
  selected,
  found,
  onRemove,
}: {
  selected: DaySituationId[];
  found: number;
  onRemove: (id: DaySituationId) => void;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
      <span className="font-extrabold uppercase tracking-wider text-slate-400">Situação do dia:</span>
      {selected.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onRemove(id)}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-200 cursor-pointer"
        >
          {situationChip(id)} <X size={11} />
        </button>
      ))}
      <span className="ml-auto font-semibold text-slate-600">
        {found} {found === 1 ? "dia encontrado" : "dias encontrados"}
      </span>
    </div>
  );
}
