-- ============================================================
-- 003 — Operazioni: analisi automatica e aggiornamento risultati
-- ============================================================
-- Da eseguire nella SQL Editor di Supabase DOPO 002_fixture_sync.sql.
-- NON distruttiva: usa solo ALTER ... ADD COLUMN IF NOT EXISTS e
-- CREATE TABLE IF NOT EXISTS, quindi può essere rieseguita senza errori
-- e non tocca i dati già presenti.
-- ============================================================

-- ------------------------------------------------------------
-- 1. MATCHES — campi per analisi e risultati
--    league_id/season/home_team_id/away_team_id servono alla pipeline
--    di analisi (recupero statistiche, H2H, classifica, infortuni).
--    home_score/away_score servono a "Aggiorna risultati".
-- ------------------------------------------------------------
alter table public.matches
  add column if not exists league_id int,
  add column if not exists season int,
  add column if not exists home_team_id int,
  add column if not exists away_team_id int,
  add column if not exists home_score int,
  add column if not exists away_score int;

create index if not exists idx_matches_user_status
  on public.matches (user_id, status);

-- ------------------------------------------------------------
-- 2. ANALYSES — provenienza dell'analisi e motivazioni strutturate
-- ------------------------------------------------------------
alter table public.analyses
  add column if not exists source text not null default 'manual',
  add column if not exists reasons jsonb;

-- Una sola analisi per partita (per utente): evita che la pipeline di
-- analisi (o un doppio click) crei analisi duplicate.
alter table public.analyses
  drop constraint if exists analyses_user_match_key;
alter table public.analyses
  add constraint analyses_user_match_key unique (user_id, match_id);

-- ------------------------------------------------------------
-- 3. ANALYSIS_RUNS — log delle operazioni di analisi automatica
--    (per tenere traccia di candidate, analisi create, richieste API
--    consumate e chiamate a DeepSeek)
-- ------------------------------------------------------------
create table if not exists public.analysis_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sync_date date not null default current_date,
  candidates_found int not null default 0,
  analyzed int not null default 0,
  analyses_created int not null default 0,
  requests_used int not null default 0,
  deepseek_calls int not null default 0,
  status text not null default 'ok'
    check (status in ('ok', 'error', 'partial')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_analysis_runs_user_created
  on public.analysis_runs (user_id, created_at desc);

-- ------------------------------------------------------------
-- 4. RLS su analysis_runs
-- ------------------------------------------------------------
alter table public.analysis_runs enable row level security;

do $$
declare
  t text := 'analysis_runs';
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
