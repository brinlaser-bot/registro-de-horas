"use client";

import { useEffect, useState } from "react";
import { Ban, Coffee, LogIn, LogOut, Pencil, Timer, Trash2, Zap } from "lucide-react";
import type { DayResult, WorkSettings } from "@/lib/types";
import type { EntryType, TimeEntryLike } from "@/lib/time";
import { formatMinutes, nextPunchType, nowTimeString } from "@/lib/time";
import type { FaltaGate } from "@/lib/faltas";
import { Badge, Button, Card, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";

interface Props {
  today: DayResult;
  todayStr: string;
  settings: WorkSettings;
  /** Ex.: "Folga hoje" ou "Trabalho em folga" — apenas apresentação. */
  dayLabel?: string;
  onAddEntry: (p: {
    date: string;
    time: string;
    type: EntryType;
    note: string | null;
  }) => Promise<{ ok: boolean } | undefined>;
  /** §8 Editar batida (horário/observação — tipo é fixo no modal). */
  onUpdateEntry: (
    id: number,
    patch: { time?: string; note?: string | null },
  ) => Promise<{ ok: boolean } | undefined>;
  onDeleteEntry: (id: number) => Promise<void>;
  /** §11 Falta de hoje já registrada → a ação vira "Excluir falta". */
  faltaRegistrada?: boolean;
  /** Gate central (canRegisterFalta) de hoje — inválido → toast com o motivo. */
  faltaGate?: FaltaGate;
  onRegisterFalta?: () => Promise<void> | void;
  onRemoveFalta?: () => Promise<void> | void;
}

export function QuickPunch({
  today,
  todayStr,
  settings,
  dayLabel,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  faltaRegistrada,
  faltaGate,
  onRegisterFalta,
  onRemoveFalta,
}: Props) {
  const toast = useToast();
  // §6.2 Campo de horário MANUAL permanece: vazio → segue o relógio; quando o
  // usuário digita, o botão principal usa exatamente o horário do campo.
  const [manualTime, setManualTime] = useState("");
  const [clock, setClock] = useState(nowTimeString());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntryLike | null>(null);
  const [editForm, setEditForm] = useState({ time: "", note: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setClock(nowTimeString()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  /* §5/§7: a próxima ação vem SEMPRE da última batida CRONOLÓGICA do dia
   * (fonte central nextPunchType) — nunca da posição no array de lançamento. */
  const next = nextPunchType(today.entries);

  const punch = async (type: EntryType, time: string) => {
    if (busy) return;
    if (!time) {
      toast.show("Informe o horário.", "error");
      return;
    }
    setBusy(type + time);
    try {
      const res = await onAddEntry({ date: todayStr, time, type, note: note.trim() || null });
      // Página/store rejeitaram (sequência, data futura, conflito de falta…)
      // → o erro já foi exibido; NÃO emitir confirmação.
      if (!res?.ok) return;
      setNote("");
      setManualTime(""); // volta a seguir o relógio após registrar
      toast.show(`${type === "entrada" ? "Entrada" : "Saída"} registrada às ${time}.`);
    } catch {
      toast.show("Não foi possível registrar. Tente novamente.", "error");
    } finally {
      setBusy(null);
    }
  };

  /** §6.1 "Registrar entrada/saída": usa o horário do campo (ou o relógio). */
  const punchField = () => punch(next, manualTime || clock);
  /** §6.1 "Entrada agora/Saída agora": hora local real do clique (+ obs. atual). */
  const punchNow = () => punch(next, nowTimeString());

  const startEdit = (e: TimeEntryLike) => {
    setEditForm({ time: e.time, note: e.note ?? "" });
    setEditing(e);
  };

  const saveEdit = async () => {
    if (!editing || saving) return;
    if (!editForm.time) {
      toast.show("Informe o horário.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await onUpdateEntry(editing.id, {
        time: editForm.time,
        note: editForm.note.trim() || null,
      });
      // Validação rejeitou (sequência final / compensação concluída) → a página
      // já exibiu o motivo e o modal PERMANECE aberto, sem alterar o registro.
      if (!res?.ok) return;
      toast.show("Registro atualizado.");
      setEditing(null);
    } catch {
      toast.show("Não foi possível editar. Tente novamente.", "error");
    } finally {
      setSaving(false);
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

  /** §11 "Registrar falta" — SEMPRE hoje; gate inválido → toast com o motivo central. */
  const clickFalta = () => {
    if (faltaGate && !faltaGate.ok) {
      toast.show(faltaGate.error ?? "Não é possível registrar falta nesta data.", "error");
      return;
    }
    void onRegisterFalta?.();
  };

  const balanceTone = today.balanceMinutes > 0 ? "emerald" : today.balanceMinutes < 0 ? "rose" : "slate";
  const nextIsEntrada = next === "entrada";

  return (
    <Card
      title="Registro rápido"
      subtitle={`${dayLabel ? `${dayLabel} · ` : ""}${today.entries.length === 0 ? "Nenhuma batida hoje ainda" : `${today.entries.length} batida(s) hoje`} · agora são ${clock}`}
      actions={
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={manualTime || clock}
            onChange={(e) => setManualTime(e.target.value)}
            className={`h-8 rounded-lg border px-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 ${
              manualTime ? "border-amber-400 bg-amber-50" : "border-slate-300"
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

        {/* §5.2 Botão principal DINÂMICO: muda automaticamente para a próxima
            ação — entrada (verde) quando o dia está fechado/vazio, saída
            (vermelha) quando há uma entrada aberta. */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <Button
              variant={nextIsEntrada ? "primary" : "danger"}
              size="lg"
              loading={busy !== null}
              onClick={punchField}
              className="w-full"
            >
              {nextIsEntrada ? <LogIn size={18} /> : <LogOut size={18} />}
              {nextIsEntrada ? "Registrar entrada" : "Registrar saída"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              loading={busy !== null}
              onClick={punchNow}
              title="Registra imediatamente com a hora local atual"
            >
              {nextIsEntrada ? <Zap size={17} /> : <LogOut size={17} />}
              {nextIsEntrada ? "Entrada agora" : "Saída agora"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {nextIsEntrada ? (
              <Badge tone="emerald">Próximo: entrada</Badge>
            ) : (
              <Badge tone="indigo">Próximo: saída</Badge>
            )}
            {/* Almoço/Volta seguem a MESMA alternância: só aparecem quando são
                o próximo tipo esperado (a validação central rejeitaria). */}
            {!nextIsEntrada && (
              <Button variant="ghost" size="sm" onClick={() => punch("saida", settings.lunchStart)}>
                <Coffee size={13} /> Almoço {settings.lunchStart}
              </Button>
            )}
            {nextIsEntrada && today.entries.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => punch("entrada", settings.lunchEnd)}>
                <Zap size={13} /> Volta {settings.lunchEnd}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Linha do tempo de hoje — chips com Editar (lápis) + Excluir (lixeira) */}
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
                {e.edited && <span className="text-slate-400">· editado</span>}
                <button
                  onClick={() => startEdit(e)}
                  className="rounded-full p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                  aria-label="Editar registro"
                >
                  <Pencil size={12} />
                </button>
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

      {/* §11 Ação secundária e discreta: "Registrar falta" — SEMPRE hoje (sem
          seletor de data). Gate central inválido (batidas, folga, abonado,
          Abono…) → toast com a mensagem central; nunca esconder a ação. */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        {faltaRegistrada ? (
          <p className="flex items-center gap-2 text-xs text-slate-400">
            <Ban size={12} className="text-rose-500" />
            Falta registrada hoje — o déficit corresponde à jornada efetiva do dia.
            <button
              type="button"
              className="font-semibold text-rose-500 underline-offset-2 hover:underline cursor-pointer"
              onClick={() => void onRemoveFalta?.()}
            >
              Excluir falta
            </button>
          </p>
        ) : (
          <Button variant="ghost" size="sm" onClick={clickFalta}>
            <Ban size={13} /> Registrar falta
          </Button>
        )}
      </div>

      {/* §8 Modal de edição — tipo FIXO (no título); edita Horário + Observação. */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Editar ${editing.type === "entrada" ? "entrada" : "saída"}` : "Editar registro"}
        subtitle="O tipo da batida não pode ser alterado."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} loading={saving}>
              Salvar alteração
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Horário"
            type="time"
            value={editForm.time}
            onChange={(ev) => setEditForm((f) => ({ ...f, time: ev.target.value }))}
          />
          <Input
            label="Observação"
            value={editForm.note}
            placeholder="Opcional"
            onChange={(ev) => setEditForm((f) => ({ ...f, note: ev.target.value }))}
          />
        </div>
      </Modal>
    </Card>
  );
}
