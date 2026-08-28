"use client";

import { useRef, useState } from "react";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { formatDateBR, formatMinutes } from "@/lib/time";
import {
  fillDayPreview,
  fillDayUiState,
  validateFillDaySave,
  type FillPeriod,
  type FillTouched,
} from "@/lib/fill-day-records";
import { actions, settingsOf, useAppData } from "@/lib/store";

interface Props {
  date: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Modal contextual do card SEM REGISTRO.
 * Data travada. Estado 100% local até SALVAR REGISTROS DO DIA.
 * Validação reativa via fillDayUiState (mesma regra de validateFillDaySave).
 */
export function FillDayRecordsModal({ date, onClose, onSaved }: Props) {
  const { user } = useAppData();
  const settings = settingsOf(user);
  const [periods, setPeriods] = useState<FillPeriod[]>([{ entrada: "", saida: "" }]);
  const [touched, setTouched] = useState<FillTouched[]>([{ entrada: false, saida: false }]);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const ui = fillDayUiState(date, periods, touched);
  const preview = fillDayPreview(periods, settings);
  const canSave = ui.canSave;

  const markTouched = (index: number, field: "entrada" | "saida") => {
    setTouched((cur) => cur.map((t, j) => (j === index ? { ...t, [field]: true } : t)));
  };

  const save = () => {
    if (inflight.current || busy || !canSave) return;
    const v = validateFillDaySave(date, periods);
    if (!v.ok || !v.punches) return;
    inflight.current = true;
    setBusy(true);
    try {
      const res = actions.addEntries(v.punches);
      if (!res.ok) return;
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
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            type="button"
            onClick={save}
            loading={busy}
            disabled={busy || !canSave}
            aria-disabled={busy || !canSave}
          >
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

        {periods.map((p, i) => {
          const errs = ui.periodErrors[i] ?? {};
          return (
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
                      setTouched((cur) => cur.filter((_, j) => j !== i));
                    }}
                    aria-label="Remover período"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  id={`fill-entrada-${i}`}
                  label="Entrada"
                  type="time"
                  value={p.entrada}
                  error={errs.entrada}
                  aria-invalid={!!errs.entrada}
                  onBlur={() => markTouched(i, "entrada")}
                  onChange={(e) => {
                    markTouched(i, "entrada");
                    setPeriods((cur) => cur.map((x, j) => (j === i ? { ...x, entrada: e.target.value } : x)));
                  }}
                />
                <Input
                  id={`fill-saida-${i}`}
                  label="Saída"
                  type="time"
                  value={p.saida}
                  error={errs.saida}
                  aria-invalid={!!errs.saida}
                  onBlur={() => markTouched(i, "saida")}
                  onChange={(e) => {
                    markTouched(i, "saida");
                    setPeriods((cur) => cur.map((x, j) => (j === i ? { ...x, saida: e.target.value } : x)));
                  }}
                />
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setPeriods((cur) => [...cur, { entrada: "", saida: "" }]);
            setTouched((cur) => [...cur, { entrada: false, saida: false }]);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
        >
          <Plus size={14} /> Adicionar outro período
        </button>

        {canSave && preview.stay > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
            <p>Permanência: <b className="text-slate-800">{formatMinutes(preview.stay)}</b></p>
            {preview.autoBreak > 0 && (
              <p>Intervalo automático: <b className="text-slate-800">{formatMinutes(preview.autoBreak)}</b></p>
            )}
            <p>Trabalhado: <b className="text-slate-800">{formatMinutes(preview.net)}</b></p>
          </div>
        )}

        {ui.formError && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
            {ui.formError}
          </div>
        )}
      </div>
    </Modal>
  );
}
