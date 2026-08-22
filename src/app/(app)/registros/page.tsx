"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { actions, getAppData, settingsOf, useAppData, useIsClient } from "@/lib/store";
import {
  computeDay,
  formatDateShortBR,
  formatMinutes,
  monthKey,
  nowMinutesLocal,
  todayString,
  type EntryType,
} from "@/lib/time";
import type { CompKind, DayResult, WorkSettings } from "@/lib/types";
import { checkSourceOverflow } from "@/lib/debt";
import { DayCard } from "@/components/day-card";
import { ManualEntryModal, type ManualPairData } from "@/components/manual-entry-modal";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";

export default function RegistrosPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations } = useAppData();
  const [month, setMonth] = useState(monthKey(todayString()));
  const [manualOpen, setManualOpen] = useState(false);
  const todayStr = todayString();

  const settings: WorkSettings = settingsOf(user);

  // Atualiza a cada 30s para manter o assistente de saída em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const nowMinutes = nowMinutesLocal();

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

  /** Após criar/editar/excluir um registro, verifica se alguma compensação
   *  vinculada ficou acima do novo excedente/déficit do dia. */
  const reconcileDay = (date: string) => {
    const snap = getAppData();
    const s = settingsOf(snap.user);
    const day = computeDay(snap.entries.filter((e) => e.date === date), s);
    const deficit = Math.max(0, day.expectedMinutes - day.workedMinutes);
    const ov = checkSourceOverflow(snap.compensations, date, day.excessMinutes, deficit);
    if (ov.excessOverflow > 0) {
      toast.show(
        `Atenção: ${formatMinutes(ov.excessOverflow)} de compensação ficou acima do novo excedente do dia ${formatDateShortBR(date)}. Abra o dia para ajustar.`,
        "info",
      );
    }
    if (ov.deficitOverflow > 0) {
      toast.show(
        `Atenção: ${formatMinutes(ov.deficitOverflow)} de compensação ficou acima do novo déficit do dia ${formatDateShortBR(date)}. Abra o dia para ajustar.`,
        "info",
      );
    }
  };

  const addEntry = async (p: { date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }) => {
    actions.addEntry(p);
    reconcileDay(p.date);
  };

  const updateEntry = async (
    id: number,
    patch: { time?: string; type?: EntryType; note?: string | null },
  ) => {
    const target = entries.find((e) => e.id === id);
    actions.updateEntry(id, patch);
    if (target) reconcileDay(target.date);
  };

  const deleteEntry = async (id: number) => {
    const target = entries.find((e) => e.id === id);
    actions.deleteEntry(id);
    if (target) reconcileDay(target.date);
  };

  const completeComp = async (id: number) => {
    actions.completeComp(id);
    toast.show("Compensação concluída!");
  };

  const createComp = async (payload: { sourceDate: string; targetDate: string; minutes: number; note: string }) => {
    const res = actions.addComp({ ...payload, note: payload.note || null });
    if (!res.ok) throw new Error(res.error); // modal exibe a mensagem e permanece aberto
  };

  const capComp = async (date: string, kind: CompKind, maxMinutes: number) => {
    actions.capCompensationsForSource(date, kind, maxMinutes);
    toast.show("Compensação ajustada para manter consistência.");
  };

  /** Lança um par entrada/saída manual (hoje ou data anterior). */
  const addManualPair = async (data: ManualPairData) => {
    actions.addEntry({ date: data.date, time: data.entrada, type: "entrada", note: data.note || null, source: "manual" });
    actions.addEntry({ date: data.date, time: data.saida, type: "saida", note: data.note || null, source: "manual" });
    setMonth(monthKey(data.date));
    reconcileDay(data.date);
    toast.show("Lançamento manual registrado!");
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
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setManualOpen(true)}>
            <CalendarPlus size={14} /> Adicionar registro manual
          </Button>
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
              allComps={compensations}
              nowMinutes={nowMinutes}
              isToday={d.date === todayStr}
              onAddEntry={addEntry}
              onUpdateEntry={updateEntry}
              onDeleteEntry={deleteEntry}
              onCompleteComp={completeComp}
              onCreateComp={createComp}
              onCapComp={capComp}
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

      <ManualEntryModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSave={addManualPair}
      />
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
