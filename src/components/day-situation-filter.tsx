"use client";

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

/** Dropdown compacto com multiseleção. Não aplica regra financeira. */
export function DaySituationFilter({ selected, onChange }: Props) {
  const toggle = (id: DaySituationId) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
      Situação do dia
      <details className="relative mt-0.5">
        <summary className="flex h-9 w-56 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold normal-case tracking-normal text-slate-700 outline-none [&::-webkit-details-marker]:hidden">
          <span className="truncate">
            {selected.length === 0 ? "Todos os dias" : `${selected.length} selecionada${selected.length === 1 ? "" : "s"}`}
          </span>
          <ChevronDown size={14} className="shrink-0 text-slate-400" />
        </summary>
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <button
            type="button"
            onClick={() => onChange([])}
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
      </details>
    </label>
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
