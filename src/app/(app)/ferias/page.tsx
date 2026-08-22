"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, CheckCircle2, Pencil, Trash2, Umbrella } from "lucide-react";
import { actions, settingsOf, useAppData, useIsClient } from "@/lib/store";
import {
  absenceLabel,
  dayContext,
  type Absence,
} from "@/lib/absences";
import { acordoViewOf, buildDebtDays } from "@/lib/debt";
import { getAnnualPointCycle } from "@/lib/periods";
import { countWeekdays, } from "@/lib/periods";
import { formatDateBR, formatMinutes, todayString } from "@/lib/time";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { AbsenceModal, type AbsenceDraft } from "@/components/absence-modal";
import { useToast } from "@/components/toast";

export default function FeriasPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations, absences } = useAppData();
  const settings = settingsOf(user);
  const today = todayString();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<(Absence & { id: number }) | undefined>();

  // Acordos a compensar por dia de origem (para exibir original/compensado/restante)
  const acordoByDate = useMemo(() => {
    const debts = buildDebtDays(entries, compensations, settings, undefined, absences);
    const map = new Map<string, { total: number; done: number; remaining: number }>();
    for (const d of debts) {
      if (d.kind !== "acordo") continue;
      // Regra do acordo: apenas compensações concluídas abatem o restante
      const view = acordoViewOf(d);
      map.set(d.date, {
        total: view.originalMinutes,
        done: view.compensatedMinutes,
        remaining: view.remainingMinutes,
      });
    }
    return map;
  }, [entries, compensations, settings, absences]);

  const groups = useMemo(() => {
    const emAndamento = absences.filter((a) => a.startDate <= today && a.endDate >= today);
    const proximos = absences.filter((a) => a.startDate > today);
    const encerrados = absences.filter((a) => a.endDate < today);
    return { emAndamento, proximos, encerrados };
  }, [absences, today]);

  const save = async (draft: AbsenceDraft, editingId?: number) => {
    if (editingId !== undefined) {
      const res = actions.updateAbsence(editingId, draft);
      if (!res.ok) {
        if (res.split) return { split: res.split };
        toast.show(res.error ?? "Não foi possível salvar.", "error");
        return { split: res.split };
      }
      if (res.warning) toast.show(res.warning, "info");
      toast.show("Evento atualizado.");
      return;
    }
    const res = actions.addAbsence(draft);
    if (!res.ok) {
      if (res.split) return { split: res.split };
      toast.show(res.error ?? "Não foi possível salvar.", "error");
      return { split: res.split };
    }
    if (res.warning) toast.show(res.warning, "info");
    toast.show("Evento adicionado.");
  };

  const remove = (a: Absence) => {
    const linked = compensations.filter(
      (c) => c.sourceDate >= a.startDate && c.sourceDate <= a.endDate,
    );
    const msg =
      linked.length > 0
        ? `Este evento possui ${linked.length} compensação(ões) relacionada(s). O histórico das compensações será PRESERVADO, mas as horas deixarão de ser justificadas. Excluir mesmo assim?`
        : "Excluir este evento?";
    if (!window.confirm(msg)) return;
    const res = actions.deleteAbsence(a.id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível excluir.", "error");
      return;
    }
    if (res.warning) toast.show(res.warning, "info");
    toast.show("Evento excluído.");
  };

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  const renderCard = (a: Absence) => {
    const days = countWeekdays(a.startDate, a.endDate);
    const acordo =
      a.kind === "acordado" && a.treatment === "compensar"
        ? (() => {
            let total = 0, done = 0, remaining = 0;
            let cur = a.startDate;
            while (cur <= a.endDate) {
              const v = acordoByDate.get(cur);
              if (v) { total += v.total; done += v.done; remaining += v.remaining; }
              const d = new Date(`${cur}T12:00:00`);
              d.setDate(d.getDate() + 1);
              const p = (n: number) => String(n).padStart(2, "0");
              cur = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
            }
            return { total, done, remaining };
          })()
        : null;

    return (
      <li key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-200">
            <Umbrella size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-slate-900">{absenceLabel(a)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatDateBR(a.startDate)} → {formatDateBR(a.endDate)} · {days} dia(s) útil(eis) ·
              ciclo {getAnnualPointCycle(a.startDate)}
              {a.duration === "parcial" && ` · parcial ${a.partialStart}–${a.partialEnd}`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {a.kind === "saude" && (
                <Badge tone={a.medicalCert ? "emerald" : "amber"}>
                  {a.medicalCert ? "Atestado apresentado" : "Atestado não apresentado"}
                </Badge>
              )}
              {a.kind === "acordado" && a.treatment === "dispensado" && (
                <Badge tone="sky">Horas dispensadas</Badge>
              )}
              {a.note && <span className="text-xs italic text-slate-400">“{a.note}”</span>}
            </div>
            {acordo && acordo.total > 0 && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Original: <b>{formatMinutes(acordo.total)}</b> · Compensado:{" "}
                <b className="text-emerald-600">{formatMinutes(acordo.done)}</b> · Restante:{" "}
                <b className="text-amber-600">{formatMinutes(acordo.remaining)}</b>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(a);
                setModalOpen(true);
              }}
              aria-label="Editar"
            >
              <Pencil size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove(a)}
              aria-label="Excluir"
              className="!text-rose-500 hover:!bg-rose-50"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </li>
    );
  };

  const section = (title: string, list: Absence[], empty: string) => (
    <Card title={title}>
      {list.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-3">{list.map(renderCard)}</ul>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
            Férias e Afastamentos
          </h2>
          <p className="text-sm text-slate-500">
            Eventos reais do histórico de jornada — não geram déficit nem dívida (exceto acordo a
            compensar).
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setModalOpen(true);
          }}
        >
          <CalendarPlus size={15} /> Novo evento
        </Button>
      </div>

      {absences.length === 0 ? (
        <EmptyState
          icon={<Umbrella size={26} />}
          title="Nenhum evento registrado"
          description="Cadastre férias, afastamentos por saúde, afastamentos acordados ou outros afastamentos justificados."
          action={
            <Button onClick={() => { setEditing(undefined); setModalOpen(true); }}>
              <CalendarPlus size={15} /> Adicionar o primeiro evento
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {section("Em andamento", groups.emAndamento, "Nenhum evento em andamento hoje.")}
          {section("Próximos", groups.proximos, "Nenhum evento futuro cadastrado.")}
          {section("Encerrados", groups.encerrados, "Nenhum evento encerrado.")}
        </div>
      )}

      <AbsenceModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(undefined);
        }}
        initial={editing}
        onSave={save}
      />
    </div>
  );
}
