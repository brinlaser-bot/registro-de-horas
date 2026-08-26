"use client";

import { useEffect, useState } from "react";
import { Ban, Coffee, LogIn, LogOut, Pencil, Timer, Trash2, Zap } from "lucide-react";
import type { DayResult, WorkSettings } from "@/lib/types";
import type { EntryType, TimeEntryLike } from "@/lib/time";
import { formatMinutes, nextPunchType, nowTimeString, validatePunchSequence } from "@/lib/time";
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
  onDeleteEntry: (id: number) => Promise<{ ok: boolean } | undefined>;
  /** §11 Falta de hoje já registrada → a ação vira "Excluir falta". */
  faltaRegistrada?: boolean;
  /** Jornada efetiva do dia (resolução central) — déficit da falta, nunca 8h fixas. */
  jornadaMinutes?: number;
  /** Gate central (canRegisterFalta) de hoje — inválido → toast com o motivo. */
  faltaGate?: FaltaGate;
  onRegisterFalta?: () => Promise<void> | void;
  onRemoveFalta?: () => Promise<void> | void;
  /**
   * §7 REGISTRO DE HOJE: modo embutido — renderiza SOMENTE o conteúdo (sem o
   * Card/título próprios) para compor o card unificado da Visão geral junto
   * do Assistente de jornada. Nenhuma lógica/funcionalidade muda (§10).
   */
  embedded?: boolean;
  /** Jornada regular vazia (sem falta): mostra "jornada não iniciada" em vez de saldo −8h. */
  idle?: boolean;
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
  jornadaMinutes,
  faltaGate,
  onRegisterFalta,
  onRemoveFalta,
  embedded = false,
  idle = false,
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
      const res = await onDeleteEntry(id);
      // Bloqueado pela guarda central (compensação concluída) → a página já
      // exibiu o motivo; não emitir confirmação de remoção.
      if (!res?.ok) return;
      toast.show("Registro removido.");
    } catch {
      toast.show("Não foi possível remover.", "error");
    }
  };

  /** §11 "Registrar falta" — só com ZERO batidas e gate central ok.
   *  Com batidas o botão NÃO renderiza (o gate continua protegendo o store). */
  const showRegistrarFalta =
    today.entries.length === 0 && !faltaRegistrada && (faltaGate?.ok ?? true);
  const clickFalta = () => {
    if (faltaGate && !faltaGate.ok) {
      toast.show(faltaGate.error ?? "Não é possível registrar falta nesta data.", "error");
      return;
    }
    void onRegisterFalta?.();
  };

  const balanceTone = today.balanceMinutes > 0 ? "emerald" : today.balanceMinutes < 0 ? "rose" : "slate";
  const nextIsEntrada = next === "entrada";

  /* §27 Atalhos Almoço/Volta: simulam a batida pela validação central ANTES
   * de renderizar — um atalho que criaria sequência inválida (ex.: "Volta
   * 13:00" depois de uma saída 18:20) NUNCA aparece. */
  const canLunchShortcut =
    !nextIsEntrada &&
    validatePunchSequence([
      ...today.entries,
      { id: -1, date: todayStr, time: settings.lunchStart, type: "saida" as const, note: null },
    ]).ok;
  const canBackShortcut =
    nextIsEntrada &&
    today.entries.length > 0 &&
    validatePunchSequence([
      ...today.entries,
      { id: -2, date: todayStr, time: settings.lunchEnd, type: "entrada" as const, note: null },
    ]).ok;

  // Campos de horário/observação — no Card próprio vão no cabeçalho; no modo
  // embutido (Registro de hoje) aparecem na faixa compacta de contexto.
  // Observação permanece visível no mobile (item funcional — não some).
  const headerFields = (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
      <input
        type="time"
        value={manualTime || clock}
        onChange={(e) => setManualTime(e.target.value)}
        className={`h-8 shrink-0 rounded-lg border px-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 ${
          manualTime ? "border-amber-400 bg-amber-50" : "border-slate-300"
        }`}
        aria-label="Horário do registro"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Observação (opcional)"
        className="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-xs text-slate-700 outline-none focus:border-emerald-500 sm:w-44 sm:flex-none"
      />
    </div>
  );

  /* Falta já registrada: substitui os controles de ponto (horário, observação,
   * Registrar entrada/saída, agora, Próximo, chips, Registrar falta) pelo
   * estado destacado — mesmo espaço, sem inflar o card. */
  if (faltaRegistrada) {
    const banner = (
      <div className="flex flex-col gap-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 ring-1 ring-rose-200 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-rose-700">
            <Ban size={16} className="shrink-0" aria-hidden />
            ⚠ FALTA REGISTRADA HOJE
          </p>
          <p className="mt-1 text-xs font-medium text-rose-800">
            O déficit gerado corresponde à jornada prevista para este dia.
          </p>
          {jornadaMinutes != null && jornadaMinutes > 0 && (
            <p className="mt-0.5 text-xs text-rose-700">
              Déficit gerado: <b>{formatMinutes(jornadaMinutes)}</b>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 !text-rose-600 hover:!bg-rose-100"
          onClick={() => void onRemoveFalta?.()}
        >
          <Trash2 size={13} /> Excluir falta
        </Button>
      </div>
    );
    if (embedded) return <div>{banner}</div>;
    return (
      <Card title="Registro rápido" subtitle={`${dayLabel ? `${dayLabel} · ` : ""}Falta registrada hoje`}>
        {banner}
      </Card>
    );
  }

  const body = (
    <>
      {/* §12 faixa de contexto compacta — só no modo embutido (o Card próprio
          já carrega a mesma informação no subtítulo, sem duplicar). */}
      {embedded && (
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {today.entries.length === 0 ? "Nenhuma batida hoje ainda" : `${today.entries.length} batida(s) hoje`}
            {" · agora são "}{clock}
          </p>
          {headerFields}
        </div>
      )}
      <div className={`grid ${embedded ? "gap-2.5" : "gap-4"} sm:grid-cols-[auto_1fr]`}>
        {/* Resumo do dia */}
        <div className={`flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/70 ${embedded ? "px-3 py-2" : "p-4"}`}>
          <Timer size={26} className="text-emerald-600" />
          <div>
            <p className="text-2xl font-extrabold tabular-nums text-slate-900">
              {formatMinutes(today.workedMinutes)}
            </p>
            <p className="text-xs text-slate-500">
              trabalhados · base {formatMinutes(today.expectedMinutes)}
            </p>
            {idle ? (
              <p className="mt-0.5 text-xs font-bold text-slate-500">jornada não iniciada</p>
            ) : (
              <p className={`mt-0.5 text-xs font-bold ${balanceTone === "emerald" ? "text-emerald-600" : balanceTone === "rose" ? "text-rose-600" : "text-slate-500"}`}>
                saldo {today.balanceMinutes >= 0 ? "+" : ""}
                {formatMinutes(today.balanceMinutes)}
              </p>
            )}
          </div>
        </div>

        {/* §5.2 Botão principal DINÂMICO: muda automaticamente para a próxima
            ação — entrada (verde) quando o dia está fechado/vazio, saída
            (vermelha) quando há uma entrada aberta. */}
        <div className={`flex flex-col ${embedded ? "gap-2" : "gap-3"}`}>
          <div className={`grid grid-cols-1 ${embedded ? "gap-2" : "gap-3"} sm:grid-cols-[1fr_auto]`}>
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
            {/* §27 Almoço/Volta só renderizam quando a inserção é válida pela
                validação central de sequência (simulação acima). */}
            {canLunchShortcut && (
              <Button variant="ghost" size="sm" onClick={() => punch("saida", settings.lunchStart)}>
                <Coffee size={13} /> Almoço {settings.lunchStart}
              </Button>
            )}
            {canBackShortcut && (
              <Button variant="ghost" size="sm" onClick={() => punch("entrada", settings.lunchEnd)}>
                <Zap size={13} /> Volta {settings.lunchEnd}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mesmo bloco: chips das batidas OU Registrar falta (zero batidas).
          Com 1+ batidas o botão NÃO renderiza. Sem batidas e gate ok → âmbar.
          Cobertura incompatível (férias/abono/…) → o bloco some.
          Falta já registrada substitui este bloco inteiro (banner acima). */}
      {(today.entries.length > 0 || showRegistrarFalta) && (
        <div className={`${embedded ? "mt-2.5 pt-2.5" : "mt-4 pt-4"} border-t border-slate-100`}>
          {today.entries.length > 0 ? (
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
          ) : (
            <Button variant="warning" size="md" onClick={clickFalta}>
              <Ban size={15} /> Registrar falta
            </Button>
          )}
        </div>
      )}

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
    </>
  );

  // §7/§12 Modo embutido: sem Card/título próprios (o card "Registro de hoje"
  // provê o cabeçalho único) — conteúdo e lógica idênticos.
  if (embedded) return <div>{body}</div>;

  return (
    <Card
      title="Registro rápido"
      subtitle={`${dayLabel ? `${dayLabel} · ` : ""}${today.entries.length === 0 ? "Nenhuma batida hoje ainda" : `${today.entries.length} batida(s) hoje`} · agora são ${clock}`}
      actions={headerFields}
    >
      {body}
    </Card>
  );
}
