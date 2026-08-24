"use client";

import { useEffect, useState } from "react";
import { Cake, CalendarPlus, Scissors, TriangleAlert } from "lucide-react";
import { Button, Input, Modal, Select, Toggle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { suggestedAbonoDate, type Absence, type AbsenceKind, type AbsenceTreatment } from "@/lib/absences";
import { abonoDateAdvisory } from "@/lib/company-calendar";
import { formatDateBR, todayString } from "@/lib/time";
import { settingsOf, useAppData } from "@/lib/store";
import type { AbsenceSplit } from "@/lib/absences";

export type AbsenceDraft = Omit<Absence, "id" | "createdAt">;

/** Resultado verdadeiro do save — o fluxo de tela depende dele (Parte B). */
export type AbsenceSaveOutcome = { ok: boolean; split?: AbsenceSplit };

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: AbsenceDraft & { id?: number };
  onSave: (draft: AbsenceDraft, editingId?: number) => Promise<AbsenceSaveOutcome>;
}

const KIND_OPTIONS: Array<{ value: AbsenceKind; label: string }> = [
  { value: "ferias", label: "Férias" },
  { value: "saude", label: "Afastamento por saúde / atestado" },
  { value: "acordado", label: "Afastamento acordado" },
  { value: "abono", label: "Abono de aniversário 🎂" },
  { value: "outro", label: "Outro afastamento justificado" },
];

export function AbsenceModal({ open, onClose, initial, onSave }: Props) {
  const toast = useToast();
  const { user, companyCalendars } = useAppData();
  const settings = settingsOf(user);
  const today = todayString();
  const [draft, setDraft] = useState<AbsenceDraft>({
    kind: "ferias",
    startDate: "",
    endDate: "",
    duration: "integral",
  });
  const [editingId, setEditingId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  // Fluxo de divisão no fechamento anual (30/04)
  const [pendingSplit, setPendingSplit] = useState<{ draft: AbsenceDraft; split: AbsenceSplit } | null>(null);

  useEffect(() => {
    if (open) {
      setPendingSplit(null);
      setEditingId(initial?.id);
      setDraft({
        kind: initial?.kind ?? "ferias",
        startDate: initial?.startDate ?? "",
        endDate: initial?.endDate ?? "",
        duration: initial?.duration ?? "integral",
        partialStart: initial?.partialStart,
        partialEnd: initial?.partialEnd,
        medicalCert: initial?.medicalCert,
        treatment: initial?.treatment,
        note: initial?.note ?? null,
      });
    }
  }, [open, initial]);

  const submit = async (d: AbsenceDraft, id?: number) => {
    setBusy(true);
    try {
      const res = await onSave(d, id);
      if (res && res.split) {
        // Evento atravessa o fechamento anual: aguarda decisão do usuário
        setPendingSplit({ draft: d, split: res.split });
        return;
      }
      // Falha real (conflito/validação — ex.: férias atravessando 30/04):
      // permanece no formulário para o usuário corrigir as datas (Parte A).
      if (!res?.ok) return;
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /** Salva somente a parte até 30/04 (só avança se o save real funcionar). */
  const saveFirstOnly = async () => {
    if (!pendingSplit) return;
    setBusy(true);
    try {
      const res = await onSave(
        { ...pendingSplit.draft, startDate: pendingSplit.split.first.startDate, endDate: pendingSplit.split.first.endDate },
        editingId,
      );
      // Parte B: primeiro trecho falhou → SEM toast de sucesso, SEM fechar;
      // permanece na decisão e o erro real já foi exibido pela página.
      if (!res?.ok) return;
      toast.show("Evento salvo até o fechamento anual (30/04).");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /** Salva até 30/04 e abre NOVO formulário com o período restante sugerido. */
  const saveFirstAndPrepareSecond = async () => {
    if (!pendingSplit) return;
    setBusy(true);
    try {
      const res = await onSave(
        { ...pendingSplit.draft, startDate: pendingSplit.split.first.startDate, endDate: pendingSplit.split.first.endDate },
        editingId,
      );
      // Parte B: primeiro trecho falhou → SEM toast de sucesso e NÃO abre a
      // segunda etapa; permanece no fluxo atual com o erro real.
      if (!res?.ok) return;
      // Novo registro independente: novo id (sem editingId), vida própria
      setEditingId(undefined);
      setDraft({
        ...pendingSplit.draft,
        startDate: pendingSplit.split.second.startDate,
        endDate: pendingSplit.split.second.endDate,
      });
      setPendingSplit(null);
      toast.show("Primeiro período salvo. Revise e confirme o período do próximo ciclo.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Tela de decisão da divisão no fechamento anual ── */
  if (pendingSplit) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Período atravessa o fechamento anual"
        subtitle="O fechamento anual ocorre em 30/04. Este período precisa ser dividido em dois registros independentes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingSplit(null)}>Voltar</Button>
            <Button variant="secondary" onClick={saveFirstOnly} loading={busy}>
              <Scissors size={14} /> Salvar somente até 30/04
            </Button>
            <Button onClick={saveFirstAndPrepareSecond} loading={busy}>
              <CalendarPlus size={14} /> Salvar até 30/04 e adicionar período restante
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-700">
            <p className="font-bold">Até o fechamento (ciclo {pendingSplit.draft.startDate.slice(0, 4)})</p>
            <p>
              {formatDateBR(pendingSplit.split.first.startDate)} →{" "}
              {formatDateBR(pendingSplit.split.first.endDate)}
            </p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-slate-700">
            <p className="font-bold">No próximo ciclo</p>
            <p>
              {formatDateBR(pendingSplit.split.second.startDate)} →{" "}
              {formatDateBR(pendingSplit.split.second.endDate)}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Os dois registros são <b>independentes</b>: IDs, ciclos, saldos e compensações próprios.
            Editar ou excluir um não afeta o outro. O segundo só será salvo após sua confirmação.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editingId ? "Editar evento" : "Novo evento — Férias e Afastamentos"}
      subtitle="Eventos reais do histórico de jornada. Não é permitido atravessar o fechamento anual (30/04)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => submit(draft, editingId)} loading={busy}>
            <CalendarPlus size={15} /> {editingId ? "Salvar alterações" : "Adicionar evento"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Tipo"
          value={draft.kind}
          onChange={(e) => {
            const kind = e.target.value as AbsenceKind;
            if (kind === "abono") {
              // Abono de aniversário: sempre dia inteiro; se houver nascimento,
              // a data do aniversário do ciclo é SUGERIDA (escolha livre — J1).
              const sug = suggestedAbonoDate(user.birthDate, today);
              setDraft((d) => ({
                ...d,
                kind,
                duration: "integral",
                treatment: undefined,
                partialStart: undefined,
                partialEnd: undefined,
                startDate: d.startDate || sug || "",
                endDate: d.endDate || sug || "",
              }));
            } else {
              setDraft((d) => ({ ...d, kind }));
            }
          }}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Data inicial"
            type="date"
            value={draft.startDate}
            onChange={(e) =>
              setDraft({
                ...draft,
                startDate: e.target.value,
                // Abono = um único dia: a data final acompanha a inicial
                endDate: draft.kind === "abono" ? e.target.value : draft.endDate || e.target.value,
              })
            }
          />
          {draft.kind === "abono" ? (
            /* Abono de aniversário: benefício de UM único dia */
            <Input
              label="Data final"
              type="date"
              value={draft.endDate}
              disabled
              title="O Abono de aniversário é de um único dia"
            />
          ) : (
            <Input
              label="Data final"
              type="date"
              value={draft.endDate}
              min={draft.startDate}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            />
          )}
        </div>

        {/* Abono: identidade própria, sempre dia inteiro; sugestão/aviso de data */}
        {draft.kind === "abono" && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
              <Cake size={14} /> Abono de aniversário — dia inteiro, jornada 0h, saldo neutro
              (um por ciclo anual).
            </p>
            {user.birthDate ? (
              <p className="text-[11px] text-amber-700">
                Sugestão: aniversário do ciclo ({formatDateBR(suggestedAbonoDate(user.birthDate, today) ?? draft.startDate)}) —
                você pode escolher <b>qualquer data do ciclo</b>; a distância do aniversário não bloqueia.
              </p>
            ) : (
              <p className="text-[11px] text-amber-700">
                Cadastre sua <b>Data de nascimento</b> em Configurações para receber a sugestão automática.
              </p>
            )}
            {draft.startDate && abonoDateAdvisory(draft.startDate, companyCalendars) && (
              <p className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-800">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                {abonoDateAdvisory(draft.startDate, companyCalendars)}
              </p>
            )}
          </div>
        )}

        {draft.kind !== "abono" && (
          <Select
            label="Duração"
            value={draft.duration}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value as "integral" | "parcial" })}
          >
            <option value="integral">Dia inteiro (todos os dias do período)</option>
            <option value="parcial">Parcial (horário específico)</option>
          </Select>
        )}

        {draft.duration === "parcial" && (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Hora inicial"
              type="time"
              value={draft.partialStart ?? ""}
              onChange={(e) => setDraft({ ...draft, partialStart: e.target.value })}
            />
            <Input
              label="Hora final"
              type="time"
              value={draft.partialEnd ?? ""}
              onChange={(e) => setDraft({ ...draft, partialEnd: e.target.value })}
            />
          </div>
        )}

        {draft.kind === "saude" && (
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <Toggle
              checked={draft.medicalCert ?? false}
              onChange={(v) => setDraft({ ...draft, medicalCert: v })}
              label="Atestado apresentado"
              description="Apenas informativo — nenhum dado de diagnóstico é solicitado."
            />
          </div>
        )}

        {draft.kind === "acordado" && (
          <Select
            label="Como tratar as horas deste afastamento? (obrigatório)"
            value={draft.treatment ?? ""}
            onChange={(e) => setDraft({ ...draft, treatment: e.target.value as AbsenceTreatment })}
          >
            <option value="" disabled>Selecione…</option>
            <option value="dispensado">Horas dispensadas — não precisam ser compensadas</option>
            <option value="compensar">Compensar posteriormente</option>
          </Select>
        )}

        <Input
          label="Observação (opcional)"
          value={draft.note ?? ""}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </div>
    </Modal>
  );
}
