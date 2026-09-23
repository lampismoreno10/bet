-- ============================================================
-- 004 — Giocate uniche per analisi + bookmaker della quota reale
-- ============================================================
-- Da eseguire nella SQL Editor di Supabase DOPO 003_operations.sql.
--
-- Contenuto:
--   1. unicità su bets(user_id, analysis_id): impedisce di registrare due
--      giocate per la stessa analisi (doppio click, retry, chiamate
--      concorrenti o cron). Sul database BET attuale NON risultano
--      duplicati, quindi il vincolo si applica senza pulizia dati.
--   2. colonna analyses.bookmaker: nome del bookmaker della quota REALE
--      usata per calcolare EV e quota giocabile.
--
-- Idempotente e non distruttiva: può essere rieseguita senza errori.
-- ============================================================

-- ------------------------------------------------------------
-- 0. CONTROLLO PREVENTIVO (facoltativo, da eseguire per primo)
--    Deve restituire zero righe. Se restituisce righe, NON procedere:
--    significa che esistono giocate duplicate da riconciliare a mano.
-- ------------------------------------------------------------
-- select user_id, analysis_id, count(*) as giocate
-- from public.bets
-- where analysis_id is not null
-- group by user_id, analysis_id
-- having count(*) > 1;

-- ------------------------------------------------------------
-- 1. Nessuna giocata duplicata per la stessa analisi
--    Indice unico PARZIALE: le giocate senza analisi (analysis_id null)
--    restano possibili, perché non c'è nulla da deduplicare.
-- ------------------------------------------------------------
create unique index if not exists bets_user_analysis_key
  on public.bets (user_id, analysis_id)
  where analysis_id is not null;

-- ------------------------------------------------------------
-- 2. Bookmaker della quota reale (Bet365 oppure il bookmaker scelto)
-- ------------------------------------------------------------
alter table public.analyses
  add column if not exists bookmaker text;

-- ------------------------------------------------------------
-- 3. Verifica finale (facoltativa)
-- ------------------------------------------------------------
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public' and tablename = 'bets';
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'analyses'
-- order by ordinal_position;
