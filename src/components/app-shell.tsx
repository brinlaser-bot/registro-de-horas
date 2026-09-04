"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarClock,
  Clock3,
  LayoutDashboard,
  Menu,
  Settings,
  Umbrella,
  X,
} from "lucide-react";
import { useAppData, useIsClient } from "@/lib/store";

const NAV = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/registros", label: "Registros", icon: CalendarClock },
  { href: "/compensacoes", label: "Central de Horas", icon: ArrowLeftRight },
  { href: "/guia-ponto", label: "Guia do Ponto", icon: BookOpen },
  { href: "/ferias", label: "Férias e Afastamentos", icon: Umbrella },
  { href: "/resumo", label: "Resumo do período", icon: BarChart3 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

function titleFor(pathname: string): string {
  const item = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)));
  return item?.label ?? "Visão geral";
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const mounted = useIsClient();
  const { user } = useAppData();

  /* 4D (PARTE L) — reset de scroll CENTRALIZADO na navegação: toda troca de
   * rota (Visão geral, Registros, Central, Férias, Resumo, Configurações)
   * abre no topo, desktop e mobile. Efeito disparado SOMENTE na TROCA de
   * pathname — expandir/recolher card, abrir modal ou interagir na mesma
   * rota não muda a rota e portanto nunca reseta o scroll. */
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname;
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Marca */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/40">
          <Clock3 size={20} />
        </div>
        <div>
          <p className="text-sm font-extrabold tracking-tight text-white">Meu Horário</p>
          <p className="text-[11px] font-medium text-slate-400">Uso pessoal</p>
        </div>
      </div>

      {/* Navegação */}
      <nav className="mt-2 flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <item.icon size={18} />
              {item.label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            </Link>
          );
        })}
      </nav>

      {/* Usuário */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-extrabold text-white">
            {mounted ? initials(user.name) : "…"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">
              {mounted ? user.name : "Carregando…"}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {mounted ? user.email : ""}
            </p>
          </div>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            Você
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 bg-slate-900 lg:block">{sidebar}</aside>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-slate-900 shadow-2xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 cursor-pointer"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden cursor-pointer"
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">
              {titleFor(pathname)}
            </h1>
            <div className="ml-auto hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 sm:flex">
              <Clock3 size={13} className="text-emerald-600" />
              {today}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
