"use client";

import { useEffect, useState } from "react";
import { Clock3, Database, Info, Save, Trash2, Upload, UserRound } from "lucide-react";
import {
  actions,
  getAppData,
  settingsOf,
  storageBytes,
  useAppData,
  useIsClient,
} from "@/lib/store";
import { expectedMinutesOf, formatMinutes } from "@/lib/time";
import { Button, Card, Input, Select, Skeleton, Toggle } from "@/components/ui";
import { useToast } from "@/components/toast";

export default function ConfiguracoesPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations } = useAppData();

  const [profile, setProfile] = useState({ name: "", email: "" });
  const [schedule, setSchedule] = useState({
    workStart: "08:00",
    workEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    maxDailyMinutes: 600,
    autoDeductLunch: true,
  });
  const [busyProfile, setBusyProfile] = useState(false);
  const [busySchedule, setBusySchedule] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    setProfile({ name: user.name, email: user.email });
    setSchedule({
      workStart: user.workStart,
      workEnd: user.workEnd,
      lunchStart: user.lunchStart,
      lunchEnd: user.lunchEnd,
      maxDailyMinutes: user.maxDailyMinutes,
      autoDeductLunch: user.autoDeductLunch,
    });
  }, [mounted, user]);

  const saveProfile = async () => {
    if (profile.name.trim().length < 2) {
      toast.show("Informe seu nome.", "error");
      return;
    }
    setBusyProfile(true);
    await new Promise((r) => setTimeout(r, 250));
    actions.updateUser({ name: profile.name.trim(), email: profile.email.trim().toLowerCase() });
    setBusyProfile(false);
    toast.show("Perfil atualizado!");
  };

  const saveSchedule = async () => {
    setBusySchedule(true);
    await new Promise((r) => setTimeout(r, 250));
    actions.updateUser(schedule);
    setBusySchedule(false);
    toast.show("Jornada atualizada!");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(getAppData(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meu-horario-backup.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.show("Backup exportado!");
  };

  const reseed = () => {
    if (!window.confirm("Substituir tudo pelos dados de exemplo? Seus registros atuais serão perdidos.")) return;
    actions.reseed();
    toast.show("Dados de exemplo restaurados.");
  };

  const clearAll = () => {
    if (!window.confirm("Apagar todos os registros e compensações? Essa ação não pode ser desfeita.")) return;
    actions.clearAll();
    toast.show("Todos os dados foram apagados.");
  };

  if (!mounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const settings = settingsOf(user);
  const expected = expectedMinutesOf(settings);

  return (
    <div className="space-y-6">
      {/* Perfil */}
      <Card
        title="Perfil"
        subtitle="Seus dados (app de uso pessoal — sem login)"
        actions={
          <Button size="sm" onClick={saveProfile} loading={busyProfile}>
            <Save size={14} /> Salvar perfil
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome completo" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          <Input label="E-mail" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
        </div>
      </Card>

      {/* Jornada */}
      <Card
        title="Jornada de trabalho"
        subtitle="Regras usadas no cálculo de horas e compensações"
        actions={
          <Button size="sm" onClick={saveSchedule} loading={busySchedule}>
            <Save size={14} /> Salvar jornada
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Início da jornada" type="time" value={schedule.workStart} onChange={(e) => setSchedule({ ...schedule, workStart: e.target.value })} />
          <Input label="Fim da jornada" type="time" value={schedule.workEnd} onChange={(e) => setSchedule({ ...schedule, workEnd: e.target.value })} />
          <Input label="Início do almoço" type="time" value={schedule.lunchStart} onChange={(e) => setSchedule({ ...schedule, lunchStart: e.target.value })} />
          <Input label="Fim do almoço" type="time" value={schedule.lunchEnd} onChange={(e) => setSchedule({ ...schedule, lunchEnd: e.target.value })} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Select
            label="Limite diário da empresa (máx. registrável no ponto)"
            value={schedule.maxDailyMinutes}
            onChange={(e) => setSchedule({ ...schedule, maxDailyMinutes: Number(e.target.value) })}
          >
            <option value={480}>8h</option>
            <option value={540}>9h</option>
            <option value={600}>10h (padrão)</option>
            <option value={660}>11h</option>
            <option value={720}>12h</option>
          </Select>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Base diária calculada</p>
            <p className="mt-0.5 text-lg font-extrabold text-slate-900">
              {formatMinutes(expected)}
              <span className="ml-2 text-xs font-semibold text-slate-400">
                por dia ({schedule.workStart}–{schedule.workEnd} com almoço descontado)
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 px-4 py-3">
          <Toggle
            checked={schedule.autoDeductLunch}
            onChange={(v) => setSchedule({ ...schedule, autoDeductLunch: v })}
            label="Descontar almoço automaticamente"
            description="Se não houver batida entre o início e o fim do almoço, o intervalo é descontado das horas do dia."
          />
        </div>
      </Card>

      {/* Dados */}
      <Card
        title="Dados"
        subtitle="Tudo fica salvo apenas no seu navegador (localStorage) — nada vai para servidores"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Registros de ponto</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{entries.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Compensações</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{compensations.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Armazenado</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">
              {(storageBytes() / 1024).toFixed(1)}
              <span className="text-sm font-semibold text-slate-400"> KB</span>
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={exportJson}>
            <Upload size={14} /> Exportar backup (JSON)
          </Button>
          <Button variant="secondary" size="sm" onClick={reseed}>
            <Database size={14} /> Restaurar dados de exemplo
          </Button>
          <Button variant="danger" size="sm" onClick={clearAll}>
            <Trash2 size={14} /> Apagar todos os dados
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          Ao limpar o cache/cookies do navegador, os registros são apagados — use o backup JSON ou o
          CSV do Resumo para manter uma cópia.
        </p>
      </Card>

      {/* Regras */}
      <Card title="Como o cálculo funciona" subtitle="Resumo das regras da empresa aplicadas no app">
        <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50/70 p-3">
            <Clock3 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <p>
              <b className="text-emerald-700">Base diária de 8h.</b> Horas trabalhadas acima da base
              geram <b>saldo positivo</b> (crédito); abaixo, <b>saldo negativo</b> (débito).
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-rose-50/70 p-3">
            <Info size={16} className="mt-0.5 shrink-0 text-rose-600" />
            <p>
              <b className="text-rose-700">Limite de 10h/dia.</b> O que ultrapassar o limite não pode
              ser registrado no ponto e vira <b>excedente</b> para compensar em outro dia.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-indigo-50/70 p-3">
            <UserRound size={16} className="mt-0.5 shrink-0 text-indigo-600" />
            <p>
              <b className="text-indigo-700">Compensação.</b> Registre o excedente em um dia mais
              leve (saindo mais cedo ou entrando mais tarde) e marque a compensação como concluída.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-amber-50/70 p-3">
            <Info size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p>
              <b className="text-amber-700">Almoço.</b> Bata o ponto ao sair (12:00) e voltar (13:00).
              Se esquecer, o app desconta 1h automaticamente (se ativado).
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
