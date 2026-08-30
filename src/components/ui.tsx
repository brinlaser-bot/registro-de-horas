"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Loader2, X } from "lucide-react";

/* ── Button ─────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle" | "warning";
type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm shadow-emerald-600/20",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/20",
  subtle: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200",
  warning: "bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700 shadow-sm shadow-amber-500/20",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ── Inputs ─────────────────────────────────────────────── */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, className = "", id, ...rest }: InputProps) {
  return (
    <label className={`block ${className}`} htmlFor={id}>
      {label && (
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={`w-full h-10 rounded-xl border bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 ${
          error
            ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100"
            : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-100"
        }`}
        {...rest}
      />
      {error ? (
        <span className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export function Select({ label, hint, className = "", id, children, ...rest }: SelectProps) {
  return (
    <label className={`block ${className}`} htmlFor={id}>
      {label && (
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      <select
        id={id}
        className="w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        {...rest}
      >
        {children}
      </select>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/* ── Badge ──────────────────────────────────────────────── */

type BadgeTone = "emerald" | "rose" | "amber" | "slate" | "indigo" | "sky" | "violet";

const badgeTones: Record<BadgeTone, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  rose: "bg-rose-50 text-rose-700 ring-rose-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/25",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export function Badge({ tone = "slate", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Badge visual "10+" — NÃO significa "+10 horas"; só marca o limite diário. */
export function ExcessTenBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Horas trabalhadas além do limite diário de 10h"
      className={`inline-flex items-center rounded px-1 py-px text-[10px] font-extrabold leading-none tracking-tight text-rose-700 ring-1 ring-inset ring-rose-600/30 bg-rose-50 ${className}`}
    >
      10+
    </span>
  );
}

/* ── Card ───────────────────────────────────────────────── */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  padded = true,
  compact = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Menor padding/gap do cabeçalho e do corpo — sem reduzir controles. */
  compact?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header
          className={`flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 ${
            compact ? "px-4 py-2.5 lg:px-5 lg:py-3" : "px-5 py-4"
          }`}
        >
          <div>
            {title && <h2 className="text-sm font-bold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? (compact ? "p-3 lg:p-4" : "p-5") : ""}>{children}</div>
    </section>
  );
}

/* ── Modal ──────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative z-10 m-0 w-full rounded-t-2xl bg-white shadow-2xl sm:m-4 sm:rounded-2xl ${
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        } max-h-[92vh] overflow-y-auto`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4 rounded-b-2xl">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ── Feedback ───────────────────────────────────────────── */

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

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-emerald-600 ${className}`} size={20} />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ── StatCard ───────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  sub,
  tone = "slate",
  icon,
  onClick,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "emerald" | "rose" | "amber" | "slate" | "indigo" | "violet";
  icon?: ReactNode;
  onClick?: () => void;
  /** Menor padding vertical e gap interno — ícone e número permanecem iguais. */
  compact?: boolean;
}) {
  const tones: Record<string, string> = {
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    amber: "text-amber-600",
    indigo: "text-indigo-600",
    violet: "text-violet-700",
    slate: "text-slate-900",
  };
  const iconTones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-600/10",
    rose: "bg-rose-50 text-rose-600 ring-rose-600/10",
    amber: "bg-amber-50 text-amber-600 ring-amber-600/10",
    indigo: "bg-indigo-50 text-indigo-600 ring-indigo-600/10",
    violet: "bg-violet-50 text-violet-700 ring-violet-600/10",
    slate: "bg-slate-100 text-slate-600 ring-slate-500/10",
  };
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${
        compact ? "px-3 py-2.5" : "p-4"
      } ${onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        {icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${iconTones[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`${compact ? "mt-0.5" : "mt-1.5"} text-2xl font-extrabold tabular-nums tracking-tight ${tones[tone]}`}>{value}</p>
      {sub && <div className={`${compact ? "mt-0.5" : "mt-1"} text-xs text-slate-500`}>{sub}</div>}
    </div>
  );
}

/* ── Toggle ─────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm text-slate-700">{message}</div>
    </Modal>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left cursor-pointer"
    >
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-emerald-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}
