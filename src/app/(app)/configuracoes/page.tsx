"use client";

import { useEffect, useRef, useState } from "react";
import { Cake, Clock3, Database, Download, Info, Pencil, Save, Trash2, Upload, UserRound } from "lucide-react";
import {
  actions,
  getAppData,
  settingsOf,
  storageBytes,
  useAppData,
  useIsClient,
} from "@/lib/store";
import { buildBackupPayload } from "@/lib/backup";
import { abonoInCycle } from "@/lib/absences";
import { AbonoModal } from "@/components/abono-modal";
import {
  buildCompanyCalendar,
  CALENDAR_HEADER,
  cycleStatusOf,
  exportCompanyCalendarCsv,
  parseCompanyCalendarCsv,
  statsOf,
  type CalendarImportPreview,
  type CompanyCalendar,
} from "@/lib/company-calendar";
import { expectedMinutesOf, formatMinutes, todayString } from "@/lib/time";
import { Button, Card, ConfirmDialog, Input, Select, Skeleton, Toggle } from "@/components/ui";
import { ImportBackupModal } from "@/components/import-backup-modal";
import { useToast } from "@/components/toast";

export default function ConfiguracoesPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendars } = useAppData();

  const [profile, setProfile] = useState({ name: "", email: "", birthDate: "" });
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
  const [abonoOpen, setAbonoOpen] = useState(false);
  const [calPreview, setCalPreview] = useState<CalendarImportPreview | null>(null);
  /** De onde veio o arquivo em prévia: novo ciclo ou substituição de um ciclo específico. */
  const [importMode, setImportMode] = useState<{ type: "add" } | { type: "replace"; cycleStart: string }>({ type: "add" });
  const [showCalendarFor, setShowCalendarFor] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [controlStartDate, setControlStartDate] = useState("");
  const [busyControlStart, setBusyControlStart] = useState(false);
  // 4I — limites do Guia do Ponto (apresentação; defaults 08:00 / 17:45).
  const [guideMinEntry, setGuideMinEntry] = useState("08:00");
  const [guideMaxExit, setGuideMaxExit] = useState("17:45");
  const [busyGuide, setBusyGuide] = useState(false);
  const calendarFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mounted) return;
    setProfile({ name: user.name, email: user.email, birthDate: user.birthDate ?? "" });
    setSchedule({
      workStart: user.workStart,
      workEnd: user.workEnd,
      lunchStart: user.lunchStart,
      lunchEnd: user.lunchEnd,
      maxDailyMinutes: user.maxDailyMinutes,
      autoDeductLunch: user.autoDeductLunch,
    });
    setControlStartDate(user.controlStartDate ?? "");
    // 4I — valores salvos; dados antigos sem os campos usam os defaults.
    setGuideMinEntry(user.guideMinEntry ?? "08:00");
    setGuideMaxExit(user.guideMaxExit ?? "17:45");
  }, [mounted, user]);

  const saveProfile = async () => {
    if (profile.name.trim().length < 2) {
      toast.show("Informe seu nome.", "error");
      return;
    }
    setBusyProfile(true);
    await new Promise((r) => setTimeout(r, 250));
    actions.updateUser({
      name: profile.name.trim(),
      email: profile.email.trim().toLowerCase(),
      // Data LOCAL (yyyy-mm-dd) — alimenta o banner de aniversário e a sugestão do Abono.
      birthDate: profile.birthDate || null,
    });
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

  const saveControlStart = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(controlStartDate)) {
      toast.show("Informe uma data válida.", "error");
      return;
    }
    setBusyControlStart(true);
    await new Promise((r) => setTimeout(r, 250));
    actions.updateUser({ controlStartDate });
    setBusyControlStart(false);
    toast.show("Data de início do controle atualizada.");
  };

  /** 4I — salva os limites do Guia do Ponto (horários civis locais HH:MM). */
  const saveGuideLimits = async () => {
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRe.test(guideMinEntry) || !timeRe.test(guideMaxExit)) {
      toast.show("Informe horários válidos (HH:MM).", "error");
      return;
    }
    setBusyGuide(true);
    await new Promise((r) => setTimeout(r, 250));
    actions.updateUser({ guideMinEntry, guideMaxExit });
    setBusyGuide(false);
    toast.show("Limites do Guia do Ponto atualizados.");
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
    if (
      !window.confirm(
        "Restaurar os dados operacionais de exemplo? Seus registros atuais serão substituídos. Nome, e-mail e data de nascimento serão mantidos.",
      )
    )
      return;
    actions.reseed();
    toast.show("Dados de exemplo restaurados.");
  };

  const confirmClearAll = () => {
    actions.clearAll();
    setClearOpen(false);
    toast.show("Dados do controle apagados.");
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

  /** Exporta SOMENTE o ciclo informado (arquivo reimportável). */
  const exportCalendar = (calendar: CompanyCalendar) => {
    downloadText(
      `calendario-${calendar.cycleLabel}-meu-horario.csv`,
      exportCompanyCalendarCsv(calendar),
    );
    toast.show(`Calendário ${calendar.cycleLabel} exportado!`);
  };

  const pickCalendarFile = (mode: { type: "add" } | { type: "replace"; cycleStart: string }) => {
    setImportMode(mode);
    calendarFileRef.current?.click();
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

  const previewCycleExists =
    calPreview?.ok && calPreview.cycle
      ? (companyCalendars ?? []).some((c) => c.cycleStart === calPreview.cycle!.start)
      : false;
  const previewCycleMismatch =
    calPreview?.ok && importMode.type === "replace" && calPreview.cycle
      ? calPreview.cycle.start !== importMode.cycleStart
      : false;

  /** Confirmar importação de NOVO ciclo (nunca apaga ciclos anteriores). */
  const confirmCalendarImport = () => {
    if (!calPreview?.ok) return;
    const res = actions.addCompanyCalendar(buildCompanyCalendar(calPreview.entries));
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível adicionar.", "error");
      return;
    }
    setCalPreview(null);
    toast.show(`Calendário ${calPreview.cycle?.label ?? ""} importado com sucesso.`);
  };

  /** Substituir SOMENTE o calendário do ciclo detectado no arquivo. */
  const confirmCalendarReplace = () => {
    if (!calPreview?.ok) return;
    actions.replaceCompanyCalendar(buildCompanyCalendar(calPreview.entries));
    setCalPreview(null);
    toast.show(`Calendário ${calPreview.cycle?.label ?? ""} substituído com sucesso.`);
  };

  const removeCalendar = (calendar: CompanyCalendar) => {
    if (
      !window.confirm(
        `Excluir o calendário ${calendar.cycleLabel}?\n\nOs registros de ponto não serão apagados, mas as regras históricas de feriados, abonos e compensações desse ciclo deixarão de estar disponíveis.`,
      )
    )
      return;
    actions.removeCompanyCalendar(calendar.cycleStart);
    toast.show(`Calendário ${calendar.cycleLabel} removido.`);
  };

  const formatDateBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

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
  // MESMO evento do store reconhecido por Registros/Resumo/gráfico/backup
  const abonoDoCiclo = abonoInCycle(absences ?? [], todayString());

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
          <div className="sm:col-span-2">
            {/* Data LOCAL (sem fuso) — banner (somente visual) + sugestão interna do Abono. */}
            <Input
              label="Data de nascimento"
              type="date"
              className="sm:max-w-64"
              value={profile.birthDate}
              onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })}
            />
          </div>
        </div>

        {/* Abono de aniversário do ciclo — Definir/Alterar AQUI mesmo (modal),
            manipulando o mesmo evento do store que Registros/Resumo/gráfico/backup. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
            <Cake size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-500">
              Abono de aniversário do ciclo
            </p>
            {abonoDoCiclo ? (
              <p className="text-sm font-extrabold text-amber-800">
                Definido para {formatDateBR(abonoDoCiclo.startDate)} 🎂
              </p>
            ) : (
              <p className="text-sm font-semibold text-amber-700/80">
                Ainda não definido para este ciclo anual.
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setAbonoOpen(true)}>
            {abonoDoCiclo ? (
              <>
                <Pencil size={13} /> Alterar
              </>
            ) : (
              <>
                <Cake size={13} /> Definir
              </>
            )}
          </Button>
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

      {/* 4I — Guia do Ponto: limites APENAS de apresentação/sugestão. */}
      <Card
        title="Guia do Ponto"
        subtitle="Horários usados para montar sugestões de lançamento no sistema oficial"
        actions={
          <Button size="sm" onClick={saveGuideLimits} loading={busyGuide}>
            <Save size={14} /> Salvar
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Entrada mínima sugerida"
            type="time"
            value={guideMinEntry}
            onChange={(e) => setGuideMinEntry(e.target.value)}
          />
          <Input
            label="Saída máxima sugerida"
            type="time"
            value={guideMaxExit}
            onChange={(e) => setGuideMaxExit(e.target.value)}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Estes horários são usados apenas para montar sugestões de lançamento quando horas [10+] precisam
          ser representadas no sistema oficial. Eles não alteram suas batidas reais.
        </p>
      </Card>

      <Card
        title="Início do controle"
        subtitle="A partir desta data, o app passa a identificar dias de jornada sem registro ou justificativa."
        actions={
          <Button size="sm" onClick={saveControlStart} loading={busyControlStart}>
            <Save size={14} /> Salvar
          </Button>
        }
      >
        <Input
          label="Data de início do controle"
          type="date"
          className="sm:max-w-64"
          value={controlStartDate}
          onChange={(e) => setControlStartDate(e.target.value)}
        />
        <p className="mt-3 text-xs text-slate-500">
          Registros anteriores continuam podendo ser lançados manualmente.
        </p>
      </Card>

      {/* Calendários da empresa — um por ciclo anual (01/05 → 30/04) */}
      <Card
        title="Calendários da empresa"
        subtitle="Um calendário por ciclo anual: importar um novo ciclo NUNCA apaga os anteriores (100% localStorage)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => downloadText("modelo-calendario-meu-horario.csv", CALENDAR_HEADER + "\n")}>Baixar modelo vazio</Button>
            <Button size="sm" onClick={() => pickCalendarFile({ type: "add" })}>+ Adicionar calendário</Button>
          </div>
        }
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

        {(companyCalendars ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500">
            Nenhum calendário importado ainda.
          </p>
        ) : (
          <div className="space-y-4">
            {(companyCalendars ?? []).map((cal) => {
              const st = statsOf(cal.entries);
              const status = cycleStatusOf(cal, todayString());
              return (
                <div key={cal.cycleStart} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-extrabold uppercase tracking-wide text-slate-800">
                      Calendário {cal.cycleLabel}
                    </p>
                    <span className="text-xs font-medium text-slate-400">
                      {formatDateBR(cal.cycleStart)} → {formatDateBR(cal.cycleEnd)}
                    </span>
                    <span
                      className={`ml-auto inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        status === "atual"
                          ? "bg-emerald-100 text-emerald-700"
                          : status === "futuro"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {status === "atual" ? "Ciclo atual" : status === "futuro" ? "Ciclo futuro" : "Ciclo encerrado"}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Datas</p>
                      <p className="text-xl font-extrabold text-slate-900">{st.count}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">A compensar</p>
                      <p className="text-xl font-extrabold text-amber-600">{formatMinutes(st.totalCompensar)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Abonadas</p>
                      <p className="text-xl font-extrabold text-emerald-600">{formatMinutes(st.totalAbonado)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Importado em</p>
                      <p className="text-xs font-bold text-slate-700">{new Date(cal.importedAt).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setShowCalendarFor(showCalendarFor === cal.cycleStart ? null : cal.cycleStart)}>Ver calendário</Button>
                    <Button variant="secondary" size="sm" onClick={() => exportCalendar(cal)}>Exportar</Button>
                    <Button variant="secondary" size="sm" onClick={() => pickCalendarFile({ type: "replace", cycleStart: cal.cycleStart })}>Substituir</Button>
                    <Button variant="danger" size="sm" onClick={() => removeCalendar(cal)}>Excluir</Button>
                  </div>

                  {showCalendarFor === cal.cycleStart && (
                    <div className="mt-3 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white">
                      <table className="w-full min-w-[720px] text-xs">
                        <thead className="text-left text-slate-400"><tr><th className="p-2">Data</th><th>Descrição</th><th>Categoria</th><th>Tratamento</th><th>Compensar</th><th>Abonado</th><th>Obs.</th></tr></thead>
                        <tbody>
                          {cal.entries.map((e) => (
                            <tr key={e.date} className="border-t border-slate-100"><td className="p-2 font-bold">{e.date}</td><td>{e.descricao}</td><td>{e.categoria}</td><td>{e.tratamento}</td><td>{formatMinutes(e.horasACompensar*60)}</td><td>{formatMinutes(e.horasAbonadas*60)}</td><td>{e.observacao}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {calPreview && (
          <div className={`mt-4 rounded-xl border p-3 ${calPreview.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <p className={`text-sm font-bold ${calPreview.ok ? "text-emerald-700" : "text-rose-700"}`}>
              {calPreview.ok ? "Importação de calendário" : calPreview.error}
            </p>
            {calPreview.ok && (
              <>
                <p className="mt-1 text-xs text-emerald-700">
                  Ciclo detectado: <b>{calPreview.cycle?.label}</b> ({calPreview.cycle ? `${formatDateBR(calPreview.cycle.start)} → ${formatDateBR(calPreview.cycle.end)}` : ""})
                  {/* 4D.4 (Parte N): METADADO BRUTO do arquivo importado —
                      não é saldo atual nem obrigação recalculada. */}
                  {" · "}{calPreview.stats.count} datas · {formatMinutes(calPreview.stats.totalCompensar)} marcadas como COMPENSAR · {formatMinutes(calPreview.stats.totalAbonado)} abonadas
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

                {previewCycleMismatch ? (
                  <>
                    <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                      Este arquivo pertence ao ciclo {calPreview.cycle?.label}, mas você escolheu substituir outro ciclo.
                      Importe o arquivo correto ou cancele.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setCalPreview(null)}>Cancelar</Button>
                    </div>
                  </>
                ) : previewCycleExists && importMode.type === "add" ? (
                  <>
                    <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                      Já existe um calendário para o ciclo {calPreview.cycle?.label}. Nada será duplicado.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setCalPreview(null)}>Cancelar</Button>
                      <Button variant="danger" size="sm" onClick={confirmCalendarReplace}>Substituir calendário deste ciclo</Button>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setCalPreview(null)}>Cancelar</Button>
                    <Button size="sm" onClick={importMode.type === "replace" ? confirmCalendarReplace : confirmCalendarImport}>
                      {importMode.type === "replace" ? "Confirmar substituição" : "Confirmar importação"}
                    </Button>
                  </div>
                )}
              </>
            )}
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
          <Button variant="danger" size="sm" onClick={() => setClearOpen(true)}>
            <Trash2 size={14} /> Apagar todos os dados
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          O backup JSON contém os dados locais deste aplicativo neste navegador: perfil, jornada,
          registros, compensações, calendários, faltas e motivos. Ao limpar o cache/cookies do
          navegador, os registros são apagados — use o backup JSON ou o CSV do Resumo para manter
          uma cópia.
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
      {/* A ÚNICA interface de Definir/Alterar o Abono de aniversário */}
      <AbonoModal open={abonoOpen} onClose={() => setAbonoOpen(false)} />
      {clearOpen && (
        <ConfirmDialog
          open
          danger
          title="Apagar todos os dados?"
          confirmLabel="Apagar todos os dados"
          message="Isso excluirá definitivamente todos os registros, faltas, férias, afastamentos, compensações, excedentes, acordos e eventos de calendário salvos neste navegador. As configurações gerais serão mantidas."
          onClose={() => setClearOpen(false)}
          onConfirm={confirmClearAll}
        />
      )}
    </div>
  );
}
