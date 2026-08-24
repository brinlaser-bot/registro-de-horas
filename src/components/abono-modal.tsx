"use client";

import { useState } from "react";
import { Cake, TriangleAlert } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import {
  abonoDayDecision,
  abonoInCycle,
  dayContext,
  suggestedAbonoDate,
} from "@/lib/absences";
import { acordoLinkedComps } from "@/lib/debt";
import { abonoDateAdvisory } from "@/lib/company-calendar";
import { formatDateBR, formatMinutes, todayString } from "@/lib/time";
import { actions, settingsOf, useAppData } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Definir/Alterar o Abono de aniversário — ÚNICA interface de manutenção
 * (Configurações). Sempre um único dia; a validação de conflitos é IMEDIATA
 * e usa a mesma verdade central do store (abonoDayDecision), nunca uma
 * lógica paralela simplificada.
 */
export function AbonoModal({ open, onClose }: Props) {
  const toast = useToast();
  const { user, entries, absences, faltas, compensations, companyCalendars } = useAppData();
  const settings = settingsOf(user);
  const today = todayString();
  const existing = abonoInCycle(absences, today);

  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmedReplace, setConfirmedReplace] = useState(false);

  // Reset controlado na abertura — padrão oficial "adjust state during render"
  // (evita setState síncrono dentro de useEffect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setConfirmedReplace(false);
      setNote(existing?.note ?? "");
      // Sugestão interna: aniversário do ciclo anual atual (a escolha é livre).
      setDate(existing?.startDate ?? suggestedAbonoDate(user.birthDate, today) ?? "");
    }
  }

  // Validação IMEDIATA da data escolhida — mesmas fontes centrais do store.
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const decision = hasDate
    ? abonoDayDecision(date, { absences, entries, faltas, excludeAbsenceId: existing?.id })
    : null;
  const advisory = hasDate && decision?.status === "ok"
    ? abonoDateAdvisory(date, companyCalendars)
    : null;

  // Regra especial §11: acordo "compensar posteriormente" pode ceder ao Abono
  const acordo = decision?.status === "replace-acordo" ? decision.acordo : null;
  const acordoMinutes = acordo ? dayContext(date, [], absences, settings).acordoMinutes : 0;
  const linkedActive = acordo
    ? acordoLinkedComps(compensations, acordo).filter((c) => c.status !== "cancelada")
    : [];
  const hasConcluded = linkedActive.some((c) => c.status === "concluida");
  const pendingCount = linkedActive.filter((c) => c.status === "pendente").length;

  const blocked =
    decision?.status === "blocked" || hasConcluded;
  const replaceNeedsConfirm = acordo !== null && !hasConcluded && !confirmedReplace;
  const canSave = hasDate && !blocked && !replaceNeedsConfirm;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      const res = actions.setAbono({
        date,
        note: note.trim() || null,
        replaceAcordo: confirmedReplace,
      });
      if (!res.ok) {
        toast.show(res.error ?? "Não foi possível salvar o Abono.", "error");
        return;
      }
      toast.show(
        existing
          ? `Abono de aniversário atualizado para ${formatDateBR(date)}.`
          : acordo
            ? `Abono de aniversário definido para ${formatDateBR(date)} — o afastamento acordado da data foi substituído.`
            : `Abono de aniversário definido para ${formatDateBR(date)}.`,
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Alterar Abono de aniversário" : "Definir Abono de aniversário"}
      subtitle="Benefício de um dia — sem efeito em horas ou saldos."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} loading={busy} disabled={!canSave}>
            <Cake size={15} /> {existing ? "Salvar nova data" : "Definir"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Data do Abono"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setConfirmedReplace(false); // nova data exige nova confirmação
          }}
        />

        {/* Avisos NÃO bloqueantes (folga / feriado abonado / folga a compensar) */}
        {advisory && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            {advisory}
          </p>
        )}

        {/* Conflitos bloqueantes (férias / saúde / dispensado / outro / falta / batidas) */}
        {decision?.status === "blocked" && (
          <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            {decision.error}
          </p>
        )}

        {/* §11 — acordo "compensar posteriormente": substituição nunca silenciosa */}
        {acordo && !hasConcluded && !confirmedReplace && (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-violet-800">
              Esta data possui um Afastamento acordado — compensar posteriormente de{" "}
              <b>{formatMinutes(acordoMinutes)}</b>. Ao usar o Abono de aniversário neste dia, o
              afastamento será substituído e a obrigação correspondente deixará de existir.
            </p>
            {pendingCount > 0 && (
              <p className="text-xs font-semibold text-amber-700">
                ⚠ Há {pendingCount} compensação(ões) pendente(s) vinculada(s) a este acordo —{" "}
                {pendingCount === 1 ? "ela será cancelada" : "elas serão canceladas"} junto com o
                acordo.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDate("");
                  setConfirmedReplace(false);
                }}
              >
                Escolher outra data
              </Button>
              <Button size="sm" onClick={() => setConfirmedReplace(true)}>
                <Cake size={13} /> Usar Abono nesta data
              </Button>
            </div>
          </div>
        )}
        {acordo && !hasConcluded && confirmedReplace && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
            Substituição confirmada — ao salvar, o afastamento acordado de{" "}
            <b>{formatMinutes(acordoMinutes)}</b> será substituído pelo Abono de aniversário.
          </p>
        )}

        {/* §11.3 CASO C: compensação concluída vinculada → nunca substituir */}
        {acordo && hasConcluded && (
          <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            Este afastamento já possui horas compensadas concluídas. O Abono não pode substituir
            automaticamente esse acordo porque existe histórico de compensação realizado.
          </p>
        )}

        <Input
          label="Observação (opcional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
