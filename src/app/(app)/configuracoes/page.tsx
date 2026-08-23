"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, Database, Download, Info, Save, Trash2, Upload, UserRound } from "lucide-react";
import {
  actions,
  getAppData,
  settingsOf,
  storageBytes,
  useAppData,
  useIsClient,
} from "@/lib/store";
import { buildBackupPayload } from "@/lib/backup";
import {
  buildCompanyCalendar,
  CALENDAR_HEADER,
  exportCompanyCalendarCsv,
  parseCompanyCalendarCsv,
  statsOf,
  type CalendarImportPreview,
} from "@/lib/company-calendar";
import { expectedMinutesOf, formatMinutes } from "@/lib/time";
import { Button, Card, Input, Select, Skeleton, Toggle } from "@/components/ui";
import { ImportBackupModal } from "@/components/import-backup-modal";
import { useToast } from "@/components/toast";

export default function ConfiguracoesPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations, companyCalendar } = useAppData();

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
  const [importOpen, setImportOpen] = useState(false);
  const [calPreview, setCalPreview] = useState<CalendarImportPreview | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarFileRef = useRef<HTMLInputElement>(null);

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
    const blob = new Blob([JSON.stringify(buildBackupPayload(getAppData()), null, 2)], {
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

  const downloadText = (filename: string, text: string) => {
    const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCalendar = () => {
    downloadText("calendario-meu-horario.csv", exportCompanyCalendarCsv(companyCalendar));
    toast.show("Calendário exportado!");
  };

  const importCalendarFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCompanyCalendarCsv(String(reader.result ?? ""), settingsOf(getAppData().user));
      setCalPreview(parsed);
      if (!parsed.ok) toast.show(parsed.error ?? "Calendário inválido.", "error");
    };
    reader.onerror = () => toast.show("Não foi possível ler o arquivo.", "error");
    reader.readAsText(file);
  };

  const confirmCalendarImport = () => {
    if (!calPreview?.ok) return;
    actions.setCompanyCalendar(buildCompanyCalendar(calPreview.entries));
    setCalPreview(null);
    toast.show("Calendário importado com sucesso.");
  };

  const removeCalendar = () => {
    if (!window.confirm("Excluir o calendário da empresa importado?")) return;
    actions.clearCompanyCalendar();
    toast.show("Calendário removido.");
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

      {/* Calendário da empresa */}
      <Card
        title="Calendário da empresa"
        subtitle="Importe feriados, abonos, folgas a compensar e recessos por CSV (100% localStorage)"
      >
        <input
          ref={calendarFileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importCalendarFile(f);
            e.target.value = "";
          }}
        />

        {companyCalendar ? (() => {
          const st = statsOf(companyCalendar.entries);
          return (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Datas</p>
                <p className="text-xl font-extrabold text-slate-900">{st.count}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">A compensar</p>
                <p className="text-xl font-extrabold text-amber-600">{formatMinutes(st.totalCompensar)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Abonadas</p>
                <p className="text-xl font-extrabold text-emerald-600">{formatMinutes(st.totalAbonado)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Importado em</p>
                <p className="text-xs font-bold text-slate-700">{new Date(companyCalendar.importedAt).toLocaleString("pt-BR")}</p>
              </div>
            </div>
          );
        })() : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500">
            Nenhum calendário importado ainda.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => downloadText("modelo-calendario-meu-horario.csv", CALENDAR_HEADER + "\n")}>Baixar modelo vazio</Button>
          <Button size="sm" onClick={() => calendarFileRef.current?.click()}>Importar calendário</Button>
          <Button variant="secondary" size="sm" disabled={!companyCalendar} onClick={() => setShowCalendar(!showCalendar)}>Ver calendário</Button>
          <Button variant="secondary" size="sm" disabled={!companyCalendar} onClick={exportCalendar}>Exportar calendário atual</Button>
          <Button variant="secondary" size="sm" onClick={() => calendarFileRef.current?.click()}>Substituir calendário</Button>
          <Button variant="danger" size="sm" disabled={!companyCalendar} onClick={removeCalendar}>Excluir calendário</Button>
        </div>

        {calPreview && (
          <div className={`mt-4 rounded-xl border p-3 ${calPreview.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <p className={`text-sm font-bold ${calPreview.ok ? "text-emerald-700" : "text-rose-700"}`}>
              {calPreview.ok ? "Importação do calendário" : calPreview.error}
            </p>
            {calPreview.ok && (
              <>
                <p className="mt-1 text-xs text-emerald-700">
                  {calPreview.stats.count} datas encontradas · {calPreview.stats.compensar} com obrigação · Total a compensar {formatMinutes(calPreview.stats.totalCompensar)} · Abonadas {formatMinutes(calPreview.stats.totalAbonado)}
                </p>
                <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-white/70 ring-1 ring-emerald-200">
                  <table className="w-full min-w-[640px] text-xs">
                    <thead className="text-left text-slate-400"><tr><th className="p-2">Data</th><th>Descrição</th><th>Categoria</th><th>Tratamento</th><th>Compensar</th><th>Abonado</th></tr></thead>
                    <tbody>
                      {calPreview.entries.slice(0, 80).map((e) => (
                        <tr key={e.date} className="border-t border-emerald-100">
                          <td className="p-2 font-bold">{e.date}</td><td>{e.descricao}</td><td>{e.categoria}</td><td>{e.tratamento}</td><td>{formatMinutes(e.horasACompensar * 60)}</td><td>{formatMinutes(e.horasAbonadas * 60)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setCalPreview(null)}>Cancelar</Button>
                  <Button size="sm" onClick={confirmCalendarImport}>Confirmar importação</Button>
                </div>
              </>
            )}
          </div>
        )}

        {showCalendar && companyCalendar && (
          <div className="mt-4 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="text-left text-slate-400"><tr><th className="p-2">Data</th><th>Descrição</th><th>Categoria</th><th>Tratamento</th><th>Compensar</th><th>Abonado</th><th>Obs.</th></tr></thead>
              <tbody>
                {companyCalendar.entries.map((e) => (
                  <tr key={e.date} className="border-t border-slate-100"><td className="p-2 font-bold">{e.date}</td><td>{e.descricao}</td><td>{e.categoria}</td><td>{e.tratamento}</td><td>{formatMinutes(e.horasACompensar*60)}</td><td>{formatMinutes(e.horasAbonadas*60)}</td><td>{e.observacao}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            <Download size={14} /> Exportar backup (JSON)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Importar backup (JSON)
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

      <ImportBackupModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
