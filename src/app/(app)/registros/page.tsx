"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { actions, settingsOf, useAppData, useIsClient } from "@/lib/store";
import { computeDay, formatMinutes, monthKey, todayString, type EntryType } from "@/lib/time";
import type { DayResult, WorkSettings } from "@/lib/types";
import { DayCard } from "@/components/day-card";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";

export default function RegistrosPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations } = useAppData();
  const [month, setMonth] = useState(monthKey(todayString()));

  const settings: WorkSettings = settingsOf(user);

  const days: DayResult[] = useMemo(() => {
    const byDate = new Map<string, DayResult["entries"]>();
    for (const e of entries) {
      if (!e.date.startsWith(month)) continue;
      byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    }
    return [...byDate.entries()]
      .map(([date, list]) => {
        const res = computeDay(list, settings);
        res.date = date;
        return res;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, month, settings]);

  const summary = useMemo(
    () =>
      days.reduce(
        (acc, d) => {
          acc.tracked += 1;
          acc.worked += d.workedMinutes;
          acc.balance += d.balanceMinutes;
          acc.excess += d.excessMinutes;
          return acc;
        },
        { tracked: 0, worked: 0, balance: 0, excess: 0 },
      ),
    [days],
  );

  const addEntry = async (p: { date: string; time: string; type: EntryType; note: string | null }) => {
    actions.addEntry(p);
  };

  const updateEntry = async (
    id: number,
    patch: { time?: string; type?: EntryType; note?: string | null },
  ) => {
    actions.updateEntry(id, patch);
  };

  const deleteEntry = async (id: number) => {
    actions.deleteEntry(id);
  };

  const completeComp = async (id: number) => {
    actions.completeComp(id);
    toast.show("Compensação concluída!");
  };

  const createComp = async (payload: { sourceDate: string; targetDate: string; minutes: number; note: string }) => {
    actions.addComp({ ...payload, note: payload.note || null });
  };

  const changeMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controles do mês */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => changeMonth(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </Button>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
          />
          <Button variant="secondary" size="sm" onClick={() => changeMonth(1)} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </Button>
          {month !== monthKey(todayString()) && (
            <Button variant="ghost" size="sm" onClick={() => setMonth(monthKey(todayString()))}>
              Hoje
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label="Dias" value={String(summary.tracked)} />
          <Chip label="Trabalhado" value={formatMinutes(summary.worked)} />
          <Chip
            label="Saldo"
            value={`${summary.balance >= 0 ? "+" : ""}${formatMinutes(summary.balance)}`}
            tone={summary.balance >= 0 ? "emerald" : summary.balance < 0 ? "rose" : "slate"}
          />
        </div>
      </div>

      {days.length === 0 ? (
        <EmptyState
          icon={<Clock3 size={26} />}
          title="Nenhum registro neste mês"
          description="Registre entradas e saídas no painel inicial ou adicione manualmente nos dias abaixo."
          action={<Button onClick={() => setMonth(monthKey(todayString()))}>Ir para o mês atual</Button>}
        />
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <DayCard
              key={d.date}
              result={d}
              settings={settings}
              compsForDate={compensations.filter((c) => c.targetDate === d.date)}
              onAddEntry={addEntry}
              onUpdateEntry={updateEntry}
              onDeleteEntry={deleteEntry}
              onCompleteComp={completeComp}
              onCreateComp={createComp}
            />
          ))}
        </div>
      )}

      <Card padded={false} className="bg-slate-900 !border-slate-800">
        <div className="grid gap-4 px-5 py-4 text-xs text-slate-300 sm:grid-cols-3">
          <p>
            <span className="font-bold text-emerald-400">Base diária:</span> 8h (jornada com 1h de
            almoço descontada automaticamente).
          </p>
          <p>
            <span className="font-bold text-rose-400">Limite da empresa:</span>{" "}
            {formatMinutes(settings.maxDailyMinutes)} por dia. O que passar disso é excedente e
            precisa ser compensado.
          </p>
          <p>
            <span className="font-bold text-indigo-400">No ponto:</span> é o total que você pode
            lançar no sistema da empresa, limitado ao máximo diário.
          </p>
        </div>
      </Card>

    </div>
  );
}

function Chip({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "emerald" | "rose" }) {
  const tones = {
    slate: "text-slate-700 bg-white border-slate-200",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    rose: "text-rose-700 bg-rose-50 border-rose-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${tones[tone]}`}>
      <span className="font-medium opacity-60">{label}</span> {value}
    </span>
  );
}
