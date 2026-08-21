import { AppShell } from "@/components/app-shell";

// App 100% client-side: sem banco de dados, sem autenticação.
// Os dados ficam no localStorage do navegador (ver src/lib/store.ts).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
