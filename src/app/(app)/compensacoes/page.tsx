"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Pencil,
  PlusCircle,
  Trash2,
  XCircle,
} from "lucide-react";
import { actions, enrichComp, settingsOf, useAppData, useIsClient } from "@/lib/store";
import { formatDateBR, formatDateShortBR, formatMinutes, todayString } from "@/lib/time";
import type { CompKind } from "@/lib/types";
import { canCompleteComp, extraCapacityForDate } from "@/lib/debt";
import { Badge, Button, EmptyState, Skeleton } from "@/components/ui";
import { CompensationForm } from "@/components/compensation-form";
import { useToast } from "@/components/toast";

export default function CompensacoesPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations } = useAppData();
  const settings = settingsOf(user);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const list = useMemo(
    () =>
      [...compensations]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => enrichComp(c, entries, settings)),
    [compensations, entries, settings],
  );

  const pendingEditing = editing !== null ? compensations.find((c) => c.id === editing) : null;

  const save = async (payload: {
    sourceDate: string;
    targetDate: string;
    minutes: number;
    note: string;
    status?: string;
    kind?: CompKind;
  }) => {
    if (pendingEditing) {
      const res = actions.updateComp(pendingEditing.id, {
        sourceDate: payload.sourceDate,
        targetDate: payload.targetDate,
        minutes: payload.minutes,
        note: payload.note || null,
        kind: payload.kind ?? (pendingEditing.kind ?? "excedente"),
        ...(payload.status ? { status: payload.status as "pendente" | "concluida" | "cancelada" } : {}),
      });
      if (!res.ok) throw new Error(res.error); // modal exibe a mensagem e permanece aberto
      toast.show("Compensação atualizada.");
    } else {
      const res = actions.addComp({
        sourceDate: payload.sourceDate,
        targetDate: payload.targetDate,
        minutes: payload.minutes,
        note: payload.note || null,
      });
      if (!res.ok) throw new Error(res.error);
      toast.show("Compensação criada!");
    }
    setModalOpen(false);
    setEditing(null);
  };

  const today = todayString();

  const setStatus = async (id: number, status: string) => {
    // Conclusão passa pela validação central (hora extra real + data alcançada)
    const res =
      status === "concluida"
        ? actions.completeComp(id)
        : actions.updateComp(id, { status: status as "pendente" | "concluida" | "cancelada" });
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível atualizar.", "error");
      return;
    }
    toast.show(status === "concluida" ? "Compensação concluída!" : "Compensação cancelada.");
  };

  const remove = async (id: number) => {
    if (!window.confirm("Excluir esta compensação?")) return;
    actions.deleteComp(id);
    toast.show("Compensação excluída.");
  };

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const pendentes = list.filter((c) => c.status === "pendente");
  const concluidas = list.filter((c) => c.status === "concluida");
  const pendingMinutes = pendentes.reduce((s, c) => s + c.minutes, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900">Compensações de horas</h2>
          <p className="text-sm text-slate-500">
            Excedentes acima do limite diário devem ser compensados em outros dias.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <PlusCircle size={15} /> Nova compensação
        </Button>
      </div>

      {pendentes.length > 0 && (
        <div className="flex flex-wrap gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700">
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeftRight size={15} /> {pendentes.length} pendente(s)
          </span>
          <span>·</span>
          <span>{formatMinutes(pendingMinutes)} a compensar</span>
          <span>·</span>
          <span className="text-indigo-500">{concluidas.length} já concluída(s)</span>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight size={26} />}
          title="Nenhuma compensação registrada"
          description="Quando um dia passar do limite de 10h, crie uma compensação para registrar as horas em outro dia."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <PlusCircle size={15} /> Criar primeira compensação
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-600/10">
                  <ArrowLeftRight size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-slate-900">
                    {formatMinutes(c.minutes)}{" "}
                    <span className="font-medium text-slate-400">
                      — {formatDateBR(c.sourceDate)} → {formatDateBR(c.targetDate)}
                    </span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {c.sourceDay && (
                      <span>
                        origem: <b>{formatMinutes(c.sourceDay.workedMinutes)}</b> trabalhados
                        {c.sourceDay.excessMinutes > 0 && (
                          <span className="text-rose-500">
                            ({formatMinutes(c.sourceDay.excessMinutes)} excedente)
                          </span>
                        )}
                      </span>
                    )}
                    {c.targetDay && (
                      <span>
                        destino: <b>{formatMinutes(c.targetDay.workedMinutes)}</b> trabalhados
                        {c.targetDay.balanceMinutes < 0 && (
                          <span className="text-amber-600">
                            ({formatMinutes(c.targetDay.balanceMinutes)} de saldo)
                          </span>
                        )}
                      </span>
                    )}
                    {c.note && <span className="italic">“{c.note}”</span>}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        (c.kind ?? "excedente") === "deficit"
                          ? "bg-emerald-50 text-emerald-700"
                          : (c.kind ?? "excedente") === "acordo"
                            ? "bg-violet-50 text-violet-700"
                            : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {(c.kind ?? "excedente") === "deficit"
                        ? "↗ hora extra"
                        : (c.kind ?? "excedente") === "acordo"
                          ? "⇄ acordo a compensar"
                          : "↘ sair mais cedo"}
                    </span>
                  </div>
                </div>
                {c.status === "pendente" && <Badge tone="indigo">Pendente</Badge>}
                {c.status === "concluida" && (
                  <Badge tone="emerald">
                    <CheckCircle2 size={12} /> Concluída
                  </Badge>
                )}
                {c.status === "cancelada" && <Badge tone="slate">Cancelada</Badge>}
                {c.status === "pendente" &&
                  (c.kind === "deficit" || c.kind === "acordo") &&
                  canCompleteComp(c, entries, compensations, settings, today).ok && (
                    <Badge tone="emerald">Meta de compensação atingida ✓</Badge>
                  )}
                <div className="flex items-center gap-1">
                  {c.status === "pendente" && (() => {
                    const isExtra = c.kind === "deficit" || c.kind === "acordo";
                    const check = isExtra
                      ? canCompleteComp(c, entries, compensations, settings, today)
                      : { ok: true };
                    return (
                      <>
                        {isExtra && !check.ok && (
                          <span className="mr-1 max-w-[240px] text-[11px] font-semibold text-amber-600">
                            {check.error}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={!check.ok}
                          onClick={() => setStatus(c.id, "concluida")}
                        >
                          <CheckCircle2 size={13} />
                          {isExtra && check.ok ? "Confirmar quitação" : "Concluir"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatus(c.id, "cancelada")}>
                          <XCircle size={13} /> Cancelar
                        </Button>
                      </>
                    );
                  })()}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(c.id);
                      setModalOpen(true);
                    }}
                    aria-label="Editar"
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(c.id)}
                    aria-label="Excluir"
                    className="!text-rose-500 hover:!bg-rose-50"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CompensationForm
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        editingId={editing}
        kind={pendingEditing?.kind ?? "excedente"}
        initial={
          pendingEditing
            ? {
                sourceDate: pendingEditing.sourceDate,
                targetDate: pendingEditing.targetDate,
                minutes: pendingEditing.minutes,
                note: pendingEditing.note ?? "",
                status: pendingEditing.status,
                kind: pendingEditing.kind,
              }
            : undefined
        }
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings, {
            excludeCompId: editing ?? undefined,
          })
        }
        onSave={save}
      />
    </div>
  );
}
