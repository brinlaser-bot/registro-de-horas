"use client";

import { useRef, useState } from "react";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { formatDateBR, formatMinutes } from "@/lib/time";
import { fillDayPreview, validateFillDaySave, type FillPeriod } from "@/lib/fill-day-records";
import { actions, settingsOf, useAppData } from "@/lib/store";

interface Props {
  date: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Modal contextual do card SEM REGISTRO.
 * Data travada. Estado 100% local até SALVAR REGISTROS DO DIA.
 * Montado só quando aberto (sem useEffect) para não criar lint novo.
 */
export function FillDayRecordsModal({ date, onClose, onSaved }: Props) {
  const { user } = useAppData();
  const settings = settingsOf(user);
  const [periods, setPeriods] = useState<FillPeriod[]>([{ entrada: "", saida: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const preview = fillDayPreview(periods, settings);

  const save = () => {
    if (inflight.current || busy) return;
    const v = validateFillDaySave(date, periods);
    if (!v.ok || !v.punches) {
      setError(v.error ?? "Complete os horários deste dia antes de salvar.");
      return;
    }
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = actions.addEntries(v.punches);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      onSaved();
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Preencher registros do dia"
      subtitle={formatDateBR(date)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} loading={busy} disabled={busy}>
            <CalendarPlus size={15} /> Salvar registros do dia
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs font-medium text-slate-600">
          Informe os horários deste dia. Os registros serão salvos somente quando a
          sequência estiver completa e válida.
        </p>

        {periods.map((p, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Período {i + 1}
              </p>
              {periods.length > 1 && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-rose-500 cursor-pointer"
                  onClick={() => {
                    setPeriods((cur) => cur.filter((_, j) => j !== i));
                    setError(null);
                  }}
                  aria-label="Remover período"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Entrada"
                type="time"
                value={p.entrada}
                onChange={(e) => {
                  setError(null);
                  setPeriods((cur) => cur.map((x, j) => (j === i ? { ...x, entrada: e.target.value } : x)));
                }}
              />
              <Input
                label="Saída"
                type="time"
                value={p.saida}
                onChange={(e) => {
                  setError(null);
                  setPeriods((cur) => cur.map((x, j) => (j === i ? { ...x, saida: e.target.value } : x)));
                }}
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => {
            setError(null);
            setPeriods((cur) => [...cur, { entrada: "", saida: "" }]);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
        >
          <Plus size={14} /> Adicionar outro período
        </button>

        {preview.stay > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
            <p>Permanência: <b className="text-slate-800">{formatMinutes(preview.stay)}</b></p>
            {preview.autoBreak > 0 && (
              <p>Intervalo automático: <b className="text-slate-800">{formatMinutes(preview.autoBreak)}</b></p>
            )}
            <p>Trabalhado: <b className="text-slate-800">{formatMinutes(preview.net)}</b></p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
