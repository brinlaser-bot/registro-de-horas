"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  FileJson,
  Merge,
  Replace,
  TriangleAlert,
} from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions, getAppData } from "@/lib/store";
import {
  compsEqual,
  entriesEqual,
  INVALID_BACKUP_MSG,
  mergeByIdAndContent,
  parseBackup,
  type ParsedBackup,
} from "@/lib/backup";
import { formatDateShortBR } from "@/lib/time";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Preview {
  newEntries: number;
  skippedEntries: number;
  newComps: number;
  skippedComps: number;
}

export function ImportBackupModal({ open, onClose }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"pick" | "review">("pick");
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStage("pick");
      setParsed(null);
      setError(null);
      setPreview(null);
    }
  }, [open]);

  const computePreview = (p: ParsedBackup): Preview => {
    const cur = getAppData();
    const entryMerge = mergeByIdAndContent(cur.entries, p.entries, entriesEqual);
    const compMerge = mergeByIdAndContent(cur.compensations, p.compensations, compsEqual);
    return {
      newEntries: entryMerge.added,
      skippedEntries: entryMerge.skipped,
      newComps: compMerge.added,
      skippedComps: compMerge.skipped,
    };
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Selecione um arquivo .json.");
      setStage("pick");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseBackup(String(reader.result ?? ""));
      if (!res.ok) {
        setParsed(null);
        setError(INVALID_BACKUP_MSG);
        setStage("pick");
        return;
      }
      setParsed(res.backup);
      setPreview(computePreview(res.backup));
      setError(null);
      setStage("review");
    };
    reader.onerror = () => {
      setError(INVALID_BACKUP_MSG);
      setStage("pick");
    };
    reader.readAsText(file);
  };

  const replace = async () => {
    if (!parsed) return;
    const ok = window.confirm(
      "Os dados atuais serão substituídos pelo conteúdo deste backup. Esta ação não poderá ser desfeita, a menos que você tenha outro backup.",
    );
    if (!ok) return;
    setBusy(true);
    actions.replaceAll({ user: parsed.user, entries: parsed.entries, compensations: parsed.compensations });
    setBusy(false);
    toast.show("Backup restaurado com sucesso.");
    onClose();
  };

  const merge = async () => {
    if (!parsed) return;
    setBusy(true);
    actions.mergeBackup({
      entries: parsed.entries,
      compensations: parsed.compensations,
      absences: parsed.absences,
      companyCalendar: parsed.companyCalendar,
    });
    setBusy(false);
    toast.show("Backup mesclado com sucesso.");
    onClose();
  };

  const openFilePicker = () => {
    setError(null);
    fileRef.current?.click();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar backup (JSON)"
      subtitle="Restaure ou mescle dados exportados anteriormente."
      wide
      footer={
        stage === "review" ? (
          <>
            <Button variant="secondary" onClick={() => { setStage("pick"); setParsed(null); }}>
              Selecionar outro arquivo
            </Button>
            <Button variant="danger" onClick={replace} loading={busy}>
              <Replace size={15} /> Substituir dados atuais
            </Button>
            <Button onClick={merge} loading={busy}>
              <Merge size={15} /> Mesclar com dados atuais
            </Button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {stage === "pick" && (
        <div className="space-y-4">
          <button
            onClick={openFilePicker}
            className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 cursor-pointer"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
              <FileJson size={26} />
            </span>
            <span className="text-sm font-bold text-slate-700">Clique para selecionar o arquivo</span>
            <span className="text-xs text-slate-400">Somente arquivos .json são aceitos</span>
          </button>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" />
              <p className="text-xs font-semibold text-rose-700">{error}</p>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Nenhum dado será alterado até você confirmar a importação na etapa seguinte.
          </p>
        </div>
      )}

      {stage === "review" && parsed && (
        <div className="space-y-4">
          {/* Resumo */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={13} /> Arquivo válido · versão do backup v{parsed.version}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <SummaryItem label="Registros de ponto" value={String(parsed.summary.entriesCount)} />
              <SummaryItem label="Compensações" value={String(parsed.summary.compensationsCount)} />
            </div>
            <div className="mt-3 space-y-1 text-xs text-emerald-800">
              <p>
                <b>Perfil:</b> {parsed.summary.userName}
              </p>
              <p>
                <b>Jornada:</b> {parsed.summary.schedule}
              </p>
              <p>
                <b>Período:</b>{" "}
                {parsed.summary.periodFrom
                  ? `${formatDateShortBR(parsed.summary.periodFrom)} → ${formatDateShortBR(parsed.summary.periodTo ?? parsed.summary.periodFrom)}`
                  : "sem registros"}
              </p>
            </div>
          </div>

          {/* Prévia da mesclagem */}
          {preview && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
              <p className="font-bold text-slate-700">Ao mesclar:</p>
              <p>
                {preview.newEntries} registro(s) novo(s) e {preview.newComps} compensação(ões) nova(s)
                serão importados.
              </p>
              {(preview.skippedEntries > 0 || preview.skippedComps > 0) && (
                <p className="text-slate-500">
                  {preview.skippedEntries} registro(s) e {preview.skippedComps} compensação(ões) já
                  existem e serão ignorados (sem duplicação).
                </p>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <ArrowDownToLine size={15} className="mt-0.5 shrink-0" />
            <p>
              <b>Substituir</b> apaga os dados atuais e importa o backup integralmente.{" "}
              <b>Mesclar</b> mantém tudo e importa somente o que ainda não existe.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2 ring-1 ring-inset ring-emerald-200">
      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600/70">{label}</p>
      <p className="text-lg font-extrabold text-slate-900">{value}</p>
    </div>
  );
}
