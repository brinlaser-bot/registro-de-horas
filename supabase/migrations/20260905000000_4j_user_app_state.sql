-- ETAPA 4J — Fundação Supabase: tabela mínima da futura camada de nuvem.
--
-- ATENÇÃO: esta migration ainda NÃO foi aplicada no Supabase remoto.
-- Ela precisa ser aplicada manualmente pelo responsável via SQL Editor
-- do Supabase (Arena NÃO executa migration remota nesta etapa).
--
-- Modelo intencionalmente mínimo (JSONB): o Meu Horário já possui estado
-- rico com IDs estáveis e BACKUP v3. A ETAPA 4K definirá o envelope e a
-- estratégia de sync. O campo `revision` prepara o controle otimista de
-- concorrência da 4K (nesta 4J nenhum dado operacional é enviado).
--
-- Realtime: NÃO habilitado (sem publication/subscription nesta v1.0).

-- ── Tabela ─────────────────────────────────────────────────────────────
create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  payload_version integer not null default 1,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── RLS obrigatório ────────────────────────────────────────────────────
alter table public.user_app_state enable row level security;

-- Nenhum usuário anônimo pode acessar estados (Data API com
-- "Automatically expose new tables" desabilitado: concessões explícitas).
revoke all on table public.user_app_state from anon;
revoke all on table public.user_app_state from public;

-- Concede EXPLICITAMENTE somente ao papel authenticated o necessário.
grant select, insert, update, delete on table public.user_app_state to authenticated;

-- ── Policies de owner (um usuário nunca lê/modifica o row de outro) ────
drop policy if exists "user_app_state_select_owner" on public.user_app_state;
create policy "user_app_state_select_owner"
  on public.user_app_state
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_app_state_insert_owner" on public.user_app_state;
create policy "user_app_state_insert_owner"
  on public.user_app_state
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_app_state_update_owner" on public.user_app_state;
create policy "user_app_state_update_owner"
  on public.user_app_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_app_state_delete_owner" on public.user_app_state;
create policy "user_app_state_delete_owner"
  on public.user_app_state
  for delete
  to authenticated
  using (auth.uid() = user_id);
