"use client";

/**
 * ETAPA 4J — Ação discreta de logout.
 *
 * Usa supabase.auth.signOut() e redireciona para /entrar.
 * É apenas logout da conta: NUNCA apaga dados operacionais locais.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.replace("/entrar");
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      aria-label="Sair da conta"
      className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:opacity-60 ${className}`}
    >
      {busy ? "Saindo…" : "Sair"}
    </button>
  );
}
