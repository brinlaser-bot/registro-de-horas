"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<{ show: (message: string, type?: ToastType) => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 size={18} className="text-emerald-500" />,
  error: <XCircle size={18} className="text-rose-500" />,
  info: <Info size={18} className="text-sky-500" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = "success") => {
      counter.current += 1;
      const id = counter.current;
      setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
      window.setTimeout(() => dismiss(id), 3800);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
          >
            <span className="mt-0.5 shrink-0">{icons[t.type]}</span>
            <p className="flex-1 text-sm font-medium text-slate-700">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="text-slate-400 transition-colors hover:text-slate-600 cursor-pointer"
              aria-label="Fechar"
            >
              <Info size={14} className="hidden" />
              <span className="text-xs font-bold">✕</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
