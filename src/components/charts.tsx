"use client";

import { formatMinutes } from "@/lib/time";

/* ── Anel de progresso (SVG) ────────────────────────────── */

export function ProgressRing({
  value,
  max,
  size = 120,
  stroke = 10,
  tone = "emerald",
  label,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  tone?: "emerald" | "rose" | "amber" | "indigo";
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const colors: Record<string, string> = {
    emerald: "stroke-emerald-500",
    rose: "stroke-rose-500",
    amber: "stroke-amber-500",
    indigo: "stroke-indigo-500",
  };
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={`${colors[tone]} transition-all duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-extrabold tabular-nums text-slate-900">{formatMinutes(value)}</span>
        {label && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>}
      </div>
    </div>
  );
}

/* ── Barras por dia (div-based) ─────────────────────────── */

export interface BarDatum {
  label: string;
  value: number; // minutos trabalhados
  baseline: number; // base diária (min)
  cap: number; // limite da empresa (min)
  status: string;
}

export function BarsChart({ data, height = 140 }: { data: BarDatum[]; height?: number }) {
  const maxVal = Math.max(1, ...data.map((d) => d.value), Math.max(...data.map((d) => d.cap)) * 1.1);
  const baselinePct = (data[0]?.baseline ?? 0) / maxVal;

  const barColor = (status: string) => {
    if (status === "excess") return "bg-rose-500";
    if (status === "deficit") return "bg-amber-400";
    if (status === "in-progress") return "bg-indigo-400";
    return "bg-emerald-500";
  };

  return (
    <div>
      <div className="relative flex items-end justify-between gap-1" style={{ height }}>
        {/* Linha da base (8h) */}
        <div
          className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-dashed border-slate-300"
          style={{ bottom: `${baselinePct * 100}%` }}
          title="Base diária"
        />
        {data.map((d, i) => {
          const h = Math.max(2, (d.value / maxVal) * 100);
          return (
            <div key={i} className="group relative flex h-full flex-1 items-end justify-center">
              <div
                className={`w-full max-w-[26px] rounded-t-md transition-all duration-500 ${barColor(d.status)} ${d.value === 0 ? "h-1 rounded-md bg-slate-200" : ""}`}
                style={d.value > 0 ? { height: `${h}%` } : undefined}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block">
                {d.label} · {formatMinutes(d.value)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-1">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[10px] font-medium text-slate-400">
            {d.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Dentro da base
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-500" /> Acima do limite
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-amber-400" /> Abaixo da base
        </span>
        <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
          <span className="border-t-2 border-dashed border-slate-300" style={{ width: 18 }} /> Base diária
        </span>
      </div>
    </div>
  );
}
