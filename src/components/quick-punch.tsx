"use client";

import { useEffect, useMemo, useState } from "react";
import { Coffee, LogIn, LogOut, Timer, Trash2, Zap } from "lucide-react";
import type { DayResult, WorkSettings } from "@/lib/types";
import type { EntryType } from "@/lib/time";
import { formatMinutes, nowTimeString } from "@/lib/time";
import { Badge, Button, Card } from "@/components/ui";
import { useToast } from "@/components/toast";

function suggestType(entries: { type: EntryType }[]): EntryType {
  const last = entries[entries.length - 1];
  if (!last) return "entrada";
  return last.type === "entrada" ? "saida" : "entrada";
}

interface Props {
  today: DayResult;
  todayStr: string;
  settings: WorkSettings;
  onAddEntry: (p: { date: string; time: string; type: EntryType; note: string | null }) => Promise<void>;
  onDeleteEntry: (id: number) => Promise<void>;
}

export function QuickPunch({ today, todayStr, settings, onAddEntry, onDeleteEntry }: Props) {
  const toast = useToast();
  const [clock, setClock] = useState(nowTimeString());
  const [time, setTime] = useState(nowTimeString());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setClock(nowTimeString()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const suggested = useMemo(() => suggestType(today.entries), [today.entries]);

  const punch = async (type: EntryType, t?: string) => {
    if (busy) return;
    setBusy(type + (t ?? ""));
    try {
      await onAddEntry({ date: todayStr, time: t ?? time, type, note: note.trim() || null });
      setNote("");
      toast.show(type === "entrada" ? "Entrada registrada!" : "Saída registrada!");
    } catch {
      toast.show("Não foi possível registrar. Tente novamente.", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    try {
      await onDeleteEntry(id);
      toast.show("Registro removido.");
    } catch {
      toast.show("Não foi possível remover.", "error");
    }
  };

  const balanceTone = today.balanceMinutes > 0 ? "emerald" : today.balanceMinutes < 0 ? "rose" : "slate";

  return (
    <Card
      title="Registro rápido"
      subtitle={`${today.entries.length === 0 ? "Nenhuma batida hoje ainda" : `${today.entries.length} batida(s) hoje`} · agora são ${clock}`}
      actions={
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-8 rounded-lg border border-slate-300 px-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
            aria-label="Horário do registro"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Observação (opcional)"
            className="hidden h-8 w-44 rounded-lg border border-slate-300 px-2 text-xs text-slate-700 outline-none focus:border-emerald-500 sm:block"
          />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        {/* Resumo do dia */}
        <div className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
          <Timer size={26} className="text-emerald-600" />
          <div>
            <p className="text-2xl font-extrabold tabular-nums text-slate-900">
              {formatMinutes(today.workedMinutes)}
            </p>
            <p className="text-xs text-slate-500">
              trabalhados · base {formatMinutes(today.expectedMinutes)}
            </p>
            <p className={`mt-0.5 text-xs font-bold ${balanceTone === "emerald" ? "text-emerald-600" : balanceTone === "rose" ? "text-rose-600" : "text-slate-500"}`}>
              saldo {today.balanceMinutes >= 0 ? "+" : ""}
              {formatMinutes(today.balanceMinutes)}
            </p>
          </div>
        </div>

        {/* Botões */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="primary"
              size="lg"
              loading={busy === "entrada"}
              onClick={() => punch("entrada")}
              className="w-full"
            >
              <LogIn size={18} /> Entrada
            </Button>
            <Button
              variant="secondary"
              size="lg"
              loading={busy === "saida"}
              onClick={() => punch("saida")}
              className="w-full border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <LogOut size={18} /> Saída
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Atalhos:
            </span>
            <Button variant="ghost" size="sm" onClick={() => punch("saida", settings.lunchStart)}>
              <Coffee size={13} /> Almoço {settings.lunchStart}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => punch("entrada", settings.lunchEnd)}>
              <Zap size={13} /> Volta {settings.lunchEnd}
            </Button>
            {suggested === "saida" ? (
              <Badge tone="indigo">Próximo: saída</Badge>
            ) : (
              <Badge tone="emerald">Próximo: entrada</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Linha do tempo de hoje */}
      {today.entries.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {today.entries.map((e) => (
              <span
                key={e.id}
                className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1.5 text-xs font-semibold text-slate-700 shadow-sm"
              >
                <span
                  className={`h-2 w-2 rounded-full ${e.type === "entrada" ? "bg-emerald-500" : "bg-indigo-500"}`}
                />
                {e.time} · {e.type === "entrada" ? "entrada" : "saída"}
                {e.note && <span className="text-slate-400">· {e.note}</span>}
                <button
                  onClick={() => remove(e.id)}
                  className="rounded-full p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 cursor-pointer"
                  aria-label="Remover registro"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
