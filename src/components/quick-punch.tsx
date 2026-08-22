"use client";

import { useEffect, useMemo, useState } from "react";
import { Coffee, LogIn, LogOut, RotateCcw, Timer, Trash2, Zap } from "lucide-react";
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
  /** Ex.: "Folga hoje" ou "Trabalho em folga" — apenas apresentação. */
  dayLabel?: string;
  onAddEntry: (p: { date: string; time: string; type: EntryType; note: string | null }) => Promise<void>;
  onDeleteEntry: (id: number) => Promise<void>;
}

export function QuickPunch({ today, todayStr, settings, dayLabel, onAddEntry, onDeleteEntry }: Props) {
  const toast = useToast();
  // Modo Agora (padrão): a batida usa a hora real do clique.
  // Modo Manual: o usuário editou o campo e a batida usa exatamente o horário digitado.
  const [mode, setMode] = useState<"now" | "manual">("now");
  const [manualTime, setManualTime] = useState("");
  const [clock, setClock] = useState(nowTimeString());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setClock(nowTimeString()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const suggested = useMemo(() => suggestType(today.entries), [today.entries]);

  const punch = async (type: EntryType, t?: string) => {
    if (busy) return;
    // Modo Agora: captura a hora REAL do momento do clique (não a hora exibida)
    const time = t ?? (mode === "now" ? nowTimeString() : manualTime);
    if (!time) {
      toast.show("Informe o horário ou use a hora atual.", "error");
      return;
    }
    setBusy(type + time);
    try {
      await onAddEntry({ date: todayStr, time, type, note: note.trim() || null });
      setNote("");
      toast.show(
        `${type === "entrada" ? "Entrada" : "Saída"} registrada às ${time}${mode === "now" ? " (hora atual)" : " (manual)"}.`,
      );
    } catch {
      toast.show("Não foi possível registrar. Tente novamente.", "error");
    } finally {
      setBusy(null);
    }
  };

  const useNow = () => {
    setMode("now");
    setClock(nowTimeString());
    toast.show("Modo Agora ativado: a próxima batida usará a hora real do clique.");
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
      subtitle={`${dayLabel ? `${dayLabel} · ` : ""}${today.entries.length === 0 ? "Nenhuma batida hoje ainda" : `${today.entries.length} batida(s) hoje`} · agora são ${clock}`}
      actions={
        <div className="flex items-center gap-2">
          {mode === "manual" && (
            <button
              onClick={useNow}
              title="Usar hora atual — volta ao Modo Agora"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
            >
              <RotateCcw size={12} /> Usar hora atual
            </button>
          )}
          <input
            type="time"
            value={mode === "now" ? clock : manualTime}
            onChange={(e) => {
              setMode("manual");
              setManualTime(e.target.value);
            }}
            className={`h-8 rounded-lg border px-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 ${
              mode === "manual" ? "border-amber-400 bg-amber-50" : "border-slate-300"
            }`}
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
              loading={busy !== null && busy.startsWith("entrada")}
              onClick={() => punch("entrada")}
              className="w-full"
            >
              <LogIn size={18} /> Entrada
            </Button>
            <Button
              variant="secondary"
              size="lg"
              loading={busy !== null && busy.startsWith("saida")}
              onClick={() => punch("saida")}
              className="w-full border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <LogOut size={18} /> Saída
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={mode === "now" ? "emerald" : "amber"}>
              {mode === "now" ? "Modo Agora — hora real do clique" : `Modo Manual — ${manualTime || "--:--"}`}
            </Badge>
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
