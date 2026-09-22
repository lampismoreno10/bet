-- ============================================================
-- BET CRM — Schema database Supabase (PostgreSQL)
-- Esegui questo file nella SQL Editor di Supabase (Database -> SQL Editor).
--
-- Include:
--   - tabelle principali del dominio
--   - Row Level Security (RLS) per isolare i dati per utente
--   - indici e trigger di aggiornamento
--
-- Nota: i dati DEMO per testare l'interfaccia vivono nell'app
-- (src/lib/demo-data.ts) e NON vanno inseriti qui.
-- ============================================================

-- ---------- estensione ----------
create extension if not exists "uuid-ossp";

-- ---------- funzione trigger updated_at ----------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. MATCHES — eventi sportivi (partite)
-- ============================================================
create table if not exists public.matches (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  external_id text,
  competition text not null,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'finished')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. ANALYSES — analisi di una partita (mercato, quote, EV, stato)
-- ============================================================
create table if not exists public.analyses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  market text not null,
  selection text not null,
  analysis_odds numeric(6,2),
  bet365_odds numeric(6,2),
  estimated_probability numeric(5,4) check (estimated_probability between 0 and 1),
  fair_odds numeric(6,2),
  ev numeric(6,4),
  confidence smallint check (confidence between 0 and 100),
  risks text,
  state text not null default 'da_valutare'
    check (state in ('da_valutare', 'giocabile', 'scartata', 'giocata', 'chiusa')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. BETS — giocate effettuate
-- ============================================================
create table if not exists public.bets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  analysis_id uuid references public.analyses (id) on delete set null,
  market text not null,
  selection text not null,
  odds numeric(6,2) not null,
  closing_odds numeric(6,2),
  ev numeric(6,4),
  stake numeric(10,2) not null,
  status text not null default 'open'
    check (status in ('open', 'won', 'lost', 'void')),
  profit numeric(10,2) not null default 0,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4. ODDS_SNAPSHOTS — storico quote (predisposto per import futuri)
-- ============================================================
create table if not exists public.odds_snapshots (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  source text not null,          -- es. 'analysis', 'bet365', 'diretta'
  market text not null,
  selection text not null,
  odds numeric(6,2) not null,
  captured_at timestamptz not null default now()
);

-- ============================================================
-- 5. BUDGETS — budget mensile/annuale
-- ============================================================
create table if not exists public.budgets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_type text not null check (period_type in ('monthly', 'annual')),
  period text not null,          -- '2026-09' oppure '2026'
  amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, period_type, period)
);

-- ============================================================
-- 6. BANKROLL_TRANSACTIONS — movimenti di cassa
-- ============================================================
create table if not exists public.bankroll_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('deposit', 'withdrawal', 'bet', 'payout')),
  amount numeric(12,2) not null, -- positivo = entrata, negativo = uscita
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. MODEL_VERSIONS — versioni del modello statistico
-- ============================================================
create table if not exists public.model_versions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  parameters jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDICI
-- ============================================================
create index if not exists idx_matches_user_kickoff on public.matches (user_id, kickoff_at);
create index if not exists idx_analyses_user_state on public.analyses (user_id, state);
create index if not exists idx_analyses_match on public.analyses (match_id);
create index if not exists idx_bets_user_created on public.bets (user_id, created_at);
create index if not exists idx_bets_match on public.bets (match_id);
create index if not exists idx_odds_match on public.odds_snapshots (match_id, captured_at);
create index if not exists idx_bankroll_user_created on public.bankroll_transactions (user_id, created_at);

-- ---------- trigger updated_at su analyses ----------
drop trigger if exists set_analyses_updated_at on public.analyses;
create trigger set_analyses_updated_at
  before update on public.analyses
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY — isola i dati per utente autenticato
-- ============================================================
alter table public.matches enable row level security;
alter table public.analyses enable row level security;
alter table public.bets enable row level security;
alter table public.odds_snapshots enable row level security;
alter table public.budgets enable row level security;
alter table public.bankroll_transactions enable row level security;
alter table public.model_versions enable row level security;

-- Per ogni tabella: l'utente vede/modifica solo i propri record.
do $$
declare
  t text;
begin
  foreach t in array array[
    'matches', 'analyses', 'bets', 'odds_snapshots',
    'budgets', 'bankroll_transactions', 'model_versions'
  ] loop
    execute format('drop policy if exists "own_data_select" on public.%I', t);
    execute format('create policy "own_data_select" on public.%I for select using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own_data_insert" on public.%I', t);
    execute format('create policy "own_data_insert" on public.%I for insert with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own_data_update" on public.%I', t);
    execute format('create policy "own_data_update" on public.%I for update using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own_data_delete" on public.%I', t);
    execute format('create policy "own_data_delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end;
$$;
