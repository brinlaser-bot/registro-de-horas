/**
 * ETAPA 4J — Proxy de sessão Supabase (Next 16: `proxy.ts` no lugar do
 * antigo `middleware.ts`).
 *
 * Responsabilidades:
 * 1. refresh persistente da sessão via cookies em TODA requisição
 *    (a sessão Supabase é a autoridade — nada de auth caseiro);
 * 2. proteção das rotas operacionais: sem sessão → redirect para /entrar;
 * 3. usuário autenticado em /entrar → redirect para /.
 *
 * O localStorage continua sendo a fonte de verdade operacional nesta
 * etapa (4K fará o sync). Este proxy NUNCA toca em dados locais.
 *
 * Em ambiente sem envs configuradas (ex.: build no sandbox Arena), o
 * proxy apenas repassa a requisição sem quebrar.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/entrar";

function supabaseEnvOf(): { url: string; publishableKey: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

function isLoginPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

/** Rotas de API passam pelo refresh de sessão, mas sem redirect de página. */
function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api");
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const env = supabaseEnvOf();
  if (!env) return response;

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh da sessão (renova tokens expirados via cookies).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (isApiRoute(pathname)) return response;

  if (isLoginPath(pathname)) {
    if (user) return NextResponse.redirect(new URL("/", request.url));
    return response;
  }

  // Todas as demais rotas de página do app operacional exigem sessão.
  if (!user) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
