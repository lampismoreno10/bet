-- ============================================================
-- 002 — Importazione partite da API-Football
-- ============================================================
-- Da eseguire nella SQL Editor di Supabase (DOPO schema.sql).
--
-- Aggiunge:
--   1. un vincolo di unicità su (user_id, external_id) per poter fare
--      upsert ed evitare partite duplicate sullo stesso evento esterno;
--   2. la tabella api_sync_runs per tracciare quante chiamate API sono
--      state consumate ad ogni sincronizzazione (controllo quota giornaliera).
--
-- È idempotente: può essere rieseguito senza errori.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Deduplica: una sola riga per (utente, partita esterna)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_user_external_key'
  ) then
    alter table public.matches
      add constraint matches_user_external_key unique (user_id, external_id);
  end if;
end $$;

-- Aiuta la ricerca delle partite importate (con external_id valorizzato)
create index if not exists idx_matches_user_external
  on public.matches (user_id, external_id)
  where external_id is not null;

-- ------------------------------------------------------------
-- 2. Log delle sincronizzazioni con API-Football
-- ------------------------------------------------------------
create table if not exists public.api_sync_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'api-football',
  sync_date date not null,
  requests_used int not null default 0,
  requests_limit int,
  requests_remaining int,
  fixtures_found int not null default 0,
  fixtures_imported int not null default 0,
  fixtures_inserted int not null default 0,
  status text not null default 'ok'
    check (status in ('ok', 'error', 'quota_exceeded')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_sync_runs_user_created
  on public.api_sync_runs (user_id, created_at desc);

-- Se la tabella esisteva già da una versione precedente, aggiungi la colonna.
alter table public.api_sync_runs
  add column if not exists fixtures_inserted int not null default 0;

-- ------------------------------------------------------------
-- 3. RLS: ogni utente vede solo le proprie sincronizzazioni
-- ------------------------------------------------------------
alter table public.api_sync_runs enable row level security;

do $$
declare
  t text := 'api_sync_runs';
begin
  execute format('drop policy if exists "own_data_select" on public.%I', t);
  execute format('create policy "own_data_select" on public.%I for select using (auth.uid() = user_id)', t);

  execute format('drop policy if exists "own_data_insert" on public.%I', t);
  execute format('create policy "own_data_insert" on public.%I for insert with check (auth.uid() = user_id)', t);

  execute format('drop policy if exists "own_data_update" on public.%I', t);
  execute format('create policy "own_data_update" on public.%I for update using (auth.uid() = user_id)', t);

  execute format('drop policy if exists "own_data_delete" on public.%I', t);
  execute format('create policy "own_data_delete" on public.%I for delete using (auth.uid() = user_id)', t);
end $$;
