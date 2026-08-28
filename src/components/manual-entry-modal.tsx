"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatMinutes, FUTURE_DATE_ERROR, isFutureDate, toMinutes, todayString } from "@/lib/time";
import { actions } from "@/lib/store";
import type { EntryType } from "@/lib/types";

export interface ManualPairData {
  date: string;
  entrada: string;
  saida: string;
  note: string;
}

interface Period {
  entrada: string;
  saida: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Prefill da data (ex.: card do dia). */
  initialDate?: string;
  /** Legado: um único par. Preferir persistência via store.addEntries. */
  onSave?: (data: ManualPairData) => void | Promise<void>;
}

/** Modal para lançar um dia completo (vários períodos) ou um intervalo. */
export function ManualEntryModal({ open, onClose, initialDate, onSave }: Props) {
  const toast = useToast();
  const today = todayString();
  const [date, setDate] = useState(initialDate || today);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"periodo" | "intervalo">("periodo");
  const [periods, setPeriods] = useState<Period[]>([{ entrada: "", saida: "" }]);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    if (open) {
      setDate(initialDate || today);
      setNote("");
      setMode("periodo");
      setPeriods([{ entrada: "", saida: "" }]);
      inflight.current = false;
      setBusy(false);
    }
  }, [open, today, initialDate]);

  const punchesOf = () => {
    const out: { date: string; time: string; type: EntryType; note: string | null; source: "manual" }[] = [];
    for (const p of periods) {
      if (!p.entrada || !p.saida) continue;
      if (mode === "intervalo") {
        out.push({ date, time: p.entrada, type: "saida", note: note.trim() || null, source: "manual" });
        out.push({ date, time: p.saida, type: "entrada", note: note.trim() || null, source: "manual" });
      } else {
        out.push({ date, time: p.entrada, type: "entrada", note: note.trim() || null, source: "manual" });
        out.push({ date, time: p.saida, type: "saida", note: note.trim() || null, source: "manual" });
      }
    }
    return out;
  };

  const duration = periods.reduce((s, p) => {
    if (p.entrada && p.saida && toMinutes(p.saida) > toMinutes(p.entrada)) {
      return s + (toMinutes(p.saida) - toMinutes(p.entrada));
    }
    return s;
  }, 0);

  const submit = async () => {
    if (inflight.current || busy) return;
    if (!date) return toast.show("Informe a data.", "error");
    if (isFutureDate(date, today)) return toast.show(FUTURE_DATE_ERROR, "error");
    for (const p of periods) {
      if (!p.entrada || !p.saida) {
        return toast.show("Informe entrada e saída de cada período.", "error");
      }
      if (toMinutes(p.saida) <= toMinutes(p.entrada)) {
        return toast.show("A hora de saída deve ser depois da entrada.", "error");
      }
    }
    inflight.current = true;
    setBusy(true);
    try {
      const punches = punchesOf();
      const res = actions.addEntries(punches);
      if (!res.ok) {
        toast.show(res.error ?? "Não foi possível salvar.", "error");
        return;
      }
      toast.show("Lançamento manual registrado!");
      onClose();
    } catch {
      toast.show("Não foi possível salvar.", "error");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar registro manual"
      subtitle="Lance um ou vários períodos do dia. A ordem de cadastro não importa — o sistema ordena pelo horário."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={busy}>
            <CalendarPlus size={15} /> Adicionar registros
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Data"
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          hint="Hoje ou qualquer data anterior — datas futuras não são permitidas."
        />

        <Select
          label="O que deseja registrar?"
          value={mode}
          onChange={(e) => setMode(e.target.value as "periodo" | "intervalo")}
        >
          <option value="periodo">Horário trabalhado</option>
          <option value="intervalo">Intervalo / pausa</option>
        </Select>

        {periods.map((p, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                {mode === "intervalo" ? `Intervalo ${i + 1}` : `Período ${i + 1}`}
              </p>
              {periods.length > 1 && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-rose-500 cursor-pointer"
                  onClick={() => setPeriods((cur) => cur.filter((_, j) => j !== i))}
                  aria-label="Remover período"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={mode === "intervalo" ? "Saída para intervalo" : "Hora de entrada"}
                type="time"
                value={mode === "intervalo" ? p.entrada : p.entrada}
                onChange={(e) =>
                  setPeriods((cur) => cur.map((x, j) => (j === i ? { ...x, entrada: e.target.value } : x)))
                }
              />
              <Input
                label={mode === "intervalo" ? "Retorno do intervalo" : "Hora de saída"}
                type="time"
                value={p.saida}
                onChange={(e) =>
                  setPeriods((cur) => cur.map((x, j) => (j === i ? { ...x, saida: e.target.value } : x)))
                }
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setPeriods((cur) => [...cur, { entrada: "", saida: "" }])}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
        >
          <Plus size={14} /> {mode === "intervalo" ? "Registrar intervalo" : "Adicionar período"}
        </button>

        {duration > 0 && (
          <p className="text-xs text-slate-500">
            Total trabalhado: <b className="text-slate-700">{formatMinutes(duration)}</b>
            {mode === "periodo" && ". O almoço automático só entra se não houver intervalo explícito na faixa de almoço."}
          </p>
        )}

        <Input
          label="Observação (opcional)"
          value={note}
          maxLength={160}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
