"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions } from "@/lib/store";
import { EXCESS_REASON_OPTIONS } from "@/lib/hour-bank";
import { formatDateBR, formatMinutes } from "@/lib/time";
import type { ExcessReason, ExcessReasonCode } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Data do dia encerrado com jornada acima de 10h. */
  date: string;
  /** Total trabalhado no dia (para o texto do modal). */
  workedMinutes: number;
  /** Minutos acima do limite diário (a realocar). */
  excessMinutes: number;
  /** Motivo já registrado (edição) — undefined = ainda não informado. */
  existing?: ExcessReason;
  /** Chamado após salvar com sucesso. */
  onSaved?: () => void;
}

/**
 * Modal de MOTIVO DO EXCEDENTE acima de 10h (§10). Obrigatório para destinar
 * a reserva especial; pode ser fechado sem salvar (o dia exibe "⚠ Motivo não
 * informado") — nunca trava a consulta do app.
 */
export function ExcessReasonModal({ open, onClose, date, workedMinutes, excessMinutes, existing, onSaved }: Props) {
  const toast = useToast();
  const [reason, setReason] = useState<ExcessReasonCode>(existing?.reason ?? "demanda-urgente");
  const [customReason, setCustomReason] = useState(existing?.customReason ?? "");
  const [observation, setObservation] = useState(existing?.observation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (reason === "outro" && !customReason.trim()) {
      setError("Informe o motivo.");
      return;
    }
    setBusy(true);
    try {
      const res = actions.setExcessReason({
        date,
        reason,
        customReason: customReason.trim() || null,
        observation: observation.trim() || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível registrar o motivo.");
        return; // modal permanece aberto
      }
      setError(null);
      toast.show("Motivo do excedente registrado. A reserva já pode ser realocada.");
      onSaved?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Excedente do limite diário identificado"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Depois
          </Button>
          <Button onClick={save} loading={busy}>
            Registrar motivo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-rose-500" />
          <p className="text-sm text-rose-700">
            Em <b>{formatDateBR(date)}</b> você trabalhou <b>{formatMinutes(workedMinutes)}</b>.
            Excedente a realocar: <b>{formatMinutes(excessMinutes)}</b> (acima do limite de 10h).
          </p>
        </div>

        <Select
          label="Motivo do excedente *"
          value={reason}
          onChange={(ev) => {
            setReason(ev.target.value as ExcessReasonCode);
            setError(null);
          }}
        >
          {EXCESS_REASON_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </Select>

        {reason === "outro" && (
          <Input
            label="Informe o motivo *"
            value={customReason}
            placeholder="Descreva o motivo do excedente"
            error={error ?? undefined}
            onChange={(ev) => {
              setCustomReason(ev.target.value);
              setError(null);
            }}
          />
        )}

        <Input
          label="Observação (opcional)"
          value={observation}
          placeholder="Detalhes adicionais"
          onChange={(ev) => setObservation(ev.target.value)}
        />

        {error && reason !== "outro" && <p className="text-xs font-semibold text-rose-600">{error}</p>}

        <p className="text-[11px] text-slate-400">
          O motivo é obrigatório para realocar este excedente, mas você pode registrar depois.
          Enquanto não for informado, o dia exibirá “⚠ Motivo não informado”.
        </p>
      </div>
    </Modal>
  );
}
