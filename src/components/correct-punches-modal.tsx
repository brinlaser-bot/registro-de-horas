"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { analyzePunches, suggestedPunchTypeAt } from "@/lib/punches";
import { FUTURE_DATE_ERROR, formatDateBR, isFutureDate, toMinutes, todayString, type TimeEntryLike } from "@/lib/time";
import { actions } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  date: string;
  entries: TimeEntryLike[];
}

/** Editor da sequência RESULTANTE do dia — posição pelo HORÁRIO. */
export function CorrectPunchesModal({ open, onClose, date, entries }: Props) {
  const toast = useToast();
  const today = todayString();
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [intOut, setIntOut] = useState("");
  const [intIn, setIntIn] = useState("");
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const analysis = analyzePunches(entries);
  const suggested = time ? suggestedPunchTypeAt(entries, time) : null;

  const addOne = async () => {
    if (inflight.current || busy) return;
    if (!time) return toast.show("Informe o horário.", "error");
    if (isFutureDate(date, today)) return toast.show(FUTURE_DATE_ERROR, "error");
    inflight.current = true;
    setBusy(true);
    try {
      const chosen = suggestedPunchTypeAt(entries, time);
      const res = actions.addEntry({ date, time, type: chosen, note: note.trim() || null, source: "manual" });
      if (!res.ok) {
        toast.show(res.error ?? "Não foi possível salvar.", "error");
        return;
      }
      toast.show(`${chosen === "entrada" ? "Entrada" : "Saída"} às ${time} registrada.`);
      setTime("");
      setNote("");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  const addInterval = async () => {
    if (inflight.current || busy) return;
    if (!intOut || !intIn) return toast.show("Informe saída e retorno do intervalo.", "error");
    if (toMinutes(intIn) <= toMinutes(intOut)) return toast.show("O retorno deve ser depois da saída.", "error");
    inflight.current = true;
    setBusy(true);
    try {
      const res = actions.addEntries([
        { date, time: intOut, type: "saida", note: note.trim() || null, source: "manual" },
        { date, time: intIn, type: "entrada", note: note.trim() || null, source: "manual" },
      ]);
      if (!res.ok) {
        toast.show(res.error ?? "Não foi possível salvar o intervalo.", "error");
        return;
      }
      toast.show("Intervalo registrado.");
      setIntOut("");
      setIntIn("");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  const remove = (id: number) => {
    const res = actions.deleteEntry(id);
    if (!res.ok) toast.show(res.error ?? "Não foi possível excluir.", "error");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Corrigir registros"
      subtitle={formatDateBR(date)}
      footer={
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Edite, adicione ou exclua batidas para corrigir o registro deste dia.
        </p>
        {!analysis.isConsistent ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            A sequência de registros deste dia não está correta. Corrija as batidas para finalizar o registro.
          </p>
        ) : !analysis.isComplete && entries.length > 0 ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Há uma entrada sem a saída correspondente. Corrija as batidas para finalizar o registro.
          </p>
        ) : analysis.isComplete ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            Sequência válida. O saldo deste dia será recalculado.
          </p>
        ) : null}

        <ul className="space-y-1.5">
          {analysis.sorted.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-sm">
              <span className={`h-2 w-2 rounded-full ${e.type === "entrada" ? "bg-emerald-500" : "bg-indigo-500"}`} />
              <span className="font-extrabold tabular-nums">{e.time}</span>
              <span className="text-slate-600">{e.type === "entrada" ? "Entrada" : "Saída"}</span>
              <button type="button" className="ml-auto text-slate-400 hover:text-rose-500 cursor-pointer" onClick={() => remove(e.id)} aria-label="Excluir">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          {entries.length === 0 && <p className="text-xs text-slate-400">Nenhuma batida neste dia.</p>}
        </ul>

        <div className="rounded-xl border border-dashed border-slate-300 p-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Adicionar batida</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Input label="Horário" type="time" className="w-32" value={time} onChange={(e) => setTime(e.target.value)} />
            <Input label="Observação (opcional)" className="min-w-[160px] flex-1" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" loading={busy} onClick={addOne}>
              <Plus size={13} /> {suggested ? `Adicionar ${suggested === "entrada" ? "entrada" : "saída"}` : "Adicionar"}
            </Button>
          </div>
          {time && suggested && (
            <p className="mt-1 text-[11px] text-slate-500">
              Para manter a sequência correta, {time} será registrado como <b>{suggested === "entrada" ? "Entrada" : "Saída"}</b>.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-slate-300 p-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Registrar intervalo</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Input label="Saída para intervalo" type="time" value={intOut} onChange={(e) => setIntOut(e.target.value)} />
            <Input label="Retorno do intervalo" type="time" value={intIn} onChange={(e) => setIntIn(e.target.value)} />
          </div>
          <Button size="sm" className="mt-2" loading={busy} onClick={addInterval}>Salvar intervalo</Button>
        </div>
      </div>
    </Modal>
  );
}
