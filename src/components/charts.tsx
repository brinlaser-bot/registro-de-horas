"use client";

import { formatMinutes, weekdayShort } from "@/lib/time";

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

/* ── Barra de progresso linear ──────────────────────────── */

export function ProgressBar({
  concluded,
  pending,
  total,
  height = 10,
}: {
  concluded: number;
  pending: number;
  total: number;
  height?: number;
}) {
  const scale = Math.max(total, concluded + pending, 1);
  const donePct = (concluded / scale) * 100;
  const planPct = (pending / scale) * 100;
  return (
    <div
      className="flex w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200"
      style={{ height }}
    >
      <div
        className="bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
        style={{ width: `${donePct}%` }}
      />
      <div
        className="bg-gradient-to-r from-amber-400 to-amber-300 transition-all duration-700"
        style={{ width: `${planPct}%` }}
      />
    </div>
  );
}

/* ── Barras simples por dia ─────────────────────────────── */

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
    </div>
  );
}

/* ── Barras EMPILHADAS (base / extra / excedente / compensado) ── */

export interface StackedDatum {
  date: string;
  label: string;
  workedMinutes: number;
  expectedMinutes: number;
  base: number;
  extra: number;
  excess: number;
  compensated: number;
}

const hatch = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgb(148 163 184) 0 4px, rgb(203 213 225) 4px 8px)",
};

export function StackedBarsChart({
  data,
  expected,
  cap,
  height = 200,
}: {
  data: StackedDatum[];
  expected: number; // base diária (min)
  cap: number; // limite diário (min)
  height?: number;
}) {
  // Escala: acompanha o maior valor exibido (trabalhado ou base + compensação)
  const maxVal = Math.max(
    expected * 1.25,
    ...data.map((d) => d.workedMinutes + d.compensated),
  );
  const pct = (m: number) => (m / maxVal) * 100;
  const basePct = pct(expected);
  const capPct = Math.min(100, pct(cap));

  return (
    <div>
      <div className="relative flex items-end justify-between gap-[3px]" style={{ height }}>
        {/* Linha da base (8h) */}
        <div
          className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-dashed border-slate-300"
          style={{ bottom: `${basePct}%` }}
        />
        <span
          className="pointer-events-none absolute right-0 z-20 -translate-y-1/2 rounded bg-white/80 px-1 text-[9px] font-bold text-slate-400"
          style={{ bottom: `${basePct}%` }}
        >
          base
        </span>
        {/* Linha do limite (10h) */}
        {capPct <= 100 && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-dotted border-rose-300"
            style={{ bottom: `${capPct}%` }}
          />
        )}

        {data.map((d) => {
          const total = d.base + d.extra + d.excess + d.compensated;
          const tooltip = `${weekdayShort(d.date).replace(".", "")} ${d.date.slice(8)}/${d.date.slice(5, 7)} · ${formatMinutes(d.workedMinutes)}` +
            (d.compensated > 0 ? ` (+${formatMinutes(d.compensated)} compensado)` : "");
          return (
            <div key={d.date} className="group relative flex h-full flex-1 items-end justify-center">
              {total === 0 ? (
                <div className="h-1 w-full max-w-[22px] rounded bg-slate-200" />
              ) : (
                <div className="flex w-full max-w-[22px] flex-col justify-end overflow-hidden rounded-t-[3px]">
                  {d.excess > 0 && (
                    <div className="w-full bg-rose-500" style={{ height: `${pct(d.excess) * (height / 100)}px` }} />
                  )}
                  {d.extra > 0 && (
                    <div className="w-full bg-amber-400" style={{ height: `${pct(d.extra) * (height / 100)}px` }} />
                  )}
                  {d.compensated > 0 && (
                    <div
                      className="w-full border-y border-dashed border-slate-400"
                      style={{ height: `${pct(d.compensated) * (height / 100)}px`, ...hatch }}
                    />
                  )}
                  {d.base > 0 && (
                    <div className="w-full bg-emerald-500" style={{ height: `${pct(d.base) * (height / 100)}px` }} />
                  )}
                </div>
              )}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block">
                {tooltip}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between gap-[3px]">
        {data.map((d) => (
          <span key={d.date} className="flex-1 text-center text-[9px] font-semibold text-slate-400">
            {d.label}
          </span>
        ))}
      </div>

      {/* Legenda */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Base (até {formatMinutes(expected)})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Extra no ponto ({formatMinutes(expected)}→{formatMinutes(cap)})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Excedente (dívida, &gt;{formatMinutes(cap)})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400"
            style={hatch}
          /> Horas compensadas
        </span>
      </div>
    </div>
  );
}
