# Bet CRM

CRM per la gestione di un sistema di betting: partite candidate, analisi con
**quote reali** ed EV verificato, giocate, settlement automatico, report e
statistiche.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS 3**
- **Supabase** (PostgreSQL + Auth, con Row Level Security)
- **OpenFootball / football.json** — fonte statistica primaria (CC0)
- **API-Football** (api-sports.io) — sync, risultati, quote reali, fallback
- **DeepSeek** — raccomandazione di mercato

## Architettura delle fonti

| Dato | Fonte | Costo |
| --- | --- | --- |
| Partite in calendario | API-Football `/fixtures?date=` | 1 richiesta/giorno sincronizzato |
| Risultati finali | API-Football `/fixtures?ids=` | 1 richiesta per blocco di 20 partite |
| Statistiche stagionali | **OpenFootball** (dataset statico) | 1 fetch HTTP per lega per esecuzione |
| Contesto per competizioni non coperte | API-Football `/predictions?fixture=` | 1 richiesta per partita (solo se serve) |
| **Quote reali** | API-Football `/odds?fixture=` | **1 richiesta per partita** |
| Raccomandazione | DeepSeek | 1 chiamata per partita |

### OpenFootball: competizioni realmente coperte

Dataset 2026/27 **verificati** (HTTP 200 + struttura controllata) e configurati
in un unico punto (`src/lib/sports/openfootball.ts`, `OPENFOOTBALL_DATASETS`):

| `league_id` | Competizione | Partite | Giocate* | Squadre |
| --- | --- | --- | --- | --- |
| 135 | Serie A | 380 | 50 | 20 |
| 39 | Premier League | 380 | 45 | 20 |
| 40 | Championship | 552 | 88 | 24 |
| 140 | La Liga | 380 | 64 | 20 |
| 78 | Bundesliga | 306 | 33 | 18 |
| 61 | Ligue 1 | 306 | 41 | 18 |

\* alla data della verifica.

**Serie B (136) NON è coperta**: `2026-27/it.2.json` non esiste nel repository
(HTTP 404). Come tutte le altre competizioni in whitelist (Champions, Europa,
Conference, Mondiale, qualificazioni, Nations League, Copa América), usa il
**fallback** `/predictions`.

Per ogni squadra OpenFootball calcola localmente: ultime 5 partite, V/N/P,
gol fatti/subiti, medie gol, forma casa/trasferta, Over 1.5, Over 2.5,
Under 4.5, BTTS, oltre a **classifica, punti e differenza reti** calcolati dai
risultati giocati. Nulla viene inventato: se una squadra non è riconosciuta la
partita resta in attesa.

## Flusso di "Analizza partite"

```
1. candidate        partite in whitelist, scheduled/live, senza analisi,
                    ordinate per kickoff, tagliate a MAX_ANALYSIS_PER_RUN (8)
2. contesto         OpenFootball (1 fetch per lega, con cache)
                    └─ se la lega non è coperta o la squadra non è nota: /predictions (1 req)
3. quote reali      /odds (1 req per partita) → SOLO mercati ammessi
4. DeepSeek         riceve il contesto E le quote reali
5. validazione      il mercato scelto deve esistere nelle quote reali
6. salvataggio      bookmakerOdds/EV presi dal DATO API, mai dal modello
```

### Mercati ammessi (automaticamente liquidabili)

`1X`, `X2`, `12`, `Over/Under 1.5`, `Over/Under 2.5`, `Over/Under 4.5`,
`BTTS sì/no`.

**Esclusi di proposito**: corner, cartellini, Multigol e in generale i mercati
che richiedono statistiche aggiuntive o non sono rappresentabili senza
ambiguità. Una selezione ambigua (es. "Over 4.5" dei *corner*) **non** viene
mai mappata sul mercato dei gol.

### Regola tassativa sulle quote

- il modello **non** riceve né restituisce `bookmakerOdds` ed `ev`;
- `bookmakerOdds` è preso dall'API; se il mercato scelto non ha quota reale:
  `bookmakerOdds = null`, `ev = null`, `state = "da_valutare"`, `confidence <= 50`;
- `fairOdds = 1 / estimatedProbability` (sempre calcolabile);
- `state = "giocabile"` richiede EV positivo sulla quota reale;
- bookmaker preferito: **Bet365**, altrimenti scelta deterministica (id più basso).

## Limiti del piano Free API-Football

100 richieste/giorno · 10 richieste/minuto · quote pre-match incluse.

- **Throttle centralizzato** (`src/lib/sports/throttle.ts`): chiamate
  sequenziali, intervallo minimo ~6,8 s, nessun `Promise.all` sulle chiamate
  esterne, nessun retry aggressivo.
- Quota letta dagli header (`x-ratelimit-requests-limit`,
  `x-ratelimit-requests-remaining`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`).
- **Riserva giornaliera** (`API_DAILY_RESERVE = 20`): sotto quella soglia le
  nuove analisi si fermano invece di esaurire la quota.
- Su **429** la parte API si interrompe e l'esito è `partial`.

### Richieste API stimate per run

| Scenario (8 candidate) | Sync | Contesto | Quote | **Totale** |
| --- | --- | --- | --- | --- |
| Tutte coperte da OpenFootball | 2 | 0 | 8 | **~10** |
| Nessuna coperta (fallback) | 2 | 8 | 8 | **~18** |

Il vecchio schema da **49 richieste per 8 partite** è stato rimosso.

## Automazione giornaliera

`vercel.json` pianifica **una sola esecuzione al giorno**:

```
0 6 * * *  →  /api/cron/daily
```

Il job (`src/app/api/cron/daily/route.ts`) esegue in ordine:

1. aggiorna i risultati delle partite precedenti (+ settlement automatico)
2. sincronizza le partite (oggi + domani)
3. trova le candidate in whitelist
4. raccoglie il contesto statistico
5. raccoglie le quote reali
6. interroga DeepSeek
7. salva le analisi

È protetto da `CRON_SECRET` (`Authorization: Bearer <secret>`): senza il
segreto risponde `401`, senza `SUPABASE_SERVICE_ROLE_KEY` risponde `503`.
Nessuna chiave è esposta al client.

> ⚠️ **Durata**: il job fa più chiamate sequenziali (~10-18 richieste + 8
> chiamate DeepSeek) e può duperare i 60 s di esecuzione tipici dei piani
> Vercel Hobby. La route dichiara `maxDuration = 300`. Se il piano non lo
> consente, il job si interrompe a metà lasciando le partite non analizzate
> in attesa per la run successiva (nessun dato corrotto).

## Settlement automatico

Quando "Aggiorna risultati" trova una partita **finita**, oltre a punteggio e
stato chiude automaticamente tutte le giocate **aperte** di quella partita
usando **solo il risultato finale**:

- `won` / `lost` calcolati dal mercato;
- `profit` = `stake × (odds − 1)` se vinta, `−stake` se persa;
- `settled_at` valorizzato; `analysis.state = "chiusa"`;
- se il mercato non è riconosciuto la giocata **resta aperta** e il problema
  viene segnalato: non si indovina mai;
- **nessun settlement doppio**: si parte solo da `status = 'open'`.

Il settlement gira in una passata separata su tutte le giocate aperte, così
recupera anche gli esiti non liquidati in una run precedente.

## Database e migrazioni

Tabelle: `matches`, `analyses`, `bets`, `odds_snapshots`, `budgets`,
`bankroll_transactions`, `model_versions`, `api_sync_runs`, `analysis_runs`.
Tutte con RLS attiva (`auth.uid() = user_id`).

Da eseguire in ordine nella SQL Editor di Supabase:

1. `supabase/schema.sql`
2. `supabase/migrations/002_fixture_sync.sql`
3. `supabase/migrations/003_operations.sql`
4. **`supabase/migrations/004_unique_bet_and_bookmaker.sql`** — unicità
   `bets(user_id, analysis_id)` + colonna `analyses.bookmaker`

La migration 004 è idempotente e contiene in testa la query di controllo dei
duplicati (deve restituire zero righe). Il codice è tollerante se non è ancora
stata applicata: senza la colonna `bookmaker` salva comunque il resto.

## Variabili d'ambiente

Vedi `.env.example`. Nessuna chiave ha il prefisso `NEXT_PUBLIC_`.

| Variabile | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo** job cron (bypassa la RLS) |
| `SPORTS_API_KEY` | API-Football (sync, risultati, quote, fallback) |
| `DEEPSEEK_API_KEY` | raccomandazione di mercato |
| `ADMIN_EMAILS` | email autorizzate, separate da virgola |
| `MAX_ANALYSIS_PER_RUN` | candidate per run (default 8) |
| `CRON_SECRET` | segreto del job giornaliero |
| `CRON_USER_ID` | UUID dell'utente su cui opera il job |
| `NEXT_PUBLIC_DEMO_MODE` | forza i dati fittizi |

**Admin**: in produzione una `ADMIN_EMAILS` vuota significa **nessun admin**.
Solo fuori produzione (sviluppo) una whitelist vuota abilita tutti.

## Test e verifica

```bash
npm test          # 51 self-test mirati (nessuna rete, nessuna dipendenza)
npm run typecheck # tsc --noEmit
npm run build     # build di produzione
```

I test coprono: EV con quota reale e EV null senza quota, validazione quote,
parsing delle quote API-Football (inclusi corner/1° tempo scartati), settlement
1X/X2/12, Over/Under 1.5-2.5-4.5, BTTS, profitto, rate-limit e riserva,
aggregazione e classifica OpenFootball, risoluzione dei nomi squadra (alias,
ambiguità, accenti), copertura dataset vs fallback, vincolo anti-duplicato.

Sono scritti in TypeScript ed eseguiti direttamente da Node 24 (`node
scripts/self-test.ts`): nessun framework e nessuna dipendenza aggiuntiva.

## Script disponibili

| Script | Descrizione |
| --- | --- |
| `npm run dev` | server di sviluppo |
| `npm run build` | build di produzione |
| `npm run start` | avvia la build |
| `npm run typecheck` | controllo dei tipi |
| `npm test` | self-test mirati |

## Struttura

```
bet/
├── middleware.ts                    # protezione rotte + refresh sessione
├── vercel.json                      # cron giornaliero
├── scripts/self-test.ts             # test mirati
├── supabase/
│   ├── schema.sql
│   └── migrations/00{2,3,4}_*.sql
└── src/
    ├── app/
    │   ├── api/cron/daily/route.ts  # job giornaliero (CRON_SECRET)
    │   └── (dashboard)/
    │       ├── actions.ts           # giocate, partite, analisi manuale
    │       ├── analysis-actions.ts  # pipeline + settlement automatico
    │       ├── sync-actions.ts      # import partite
    │       └── budget-actions.ts
    ├── components/                  # UI
    └── lib/
        ├── ai/deepseek.ts           # prompt + validazione risposta
        ├── auth/admin-context.ts    # contesto admin (sessione o cron)
        ├── sports/
        │   ├── markets.ts           # mercati, parsing quote, EV
        │   ├── throttle.ts          # rate limit centralizzato
        │   ├── api-football.ts      # client API-Football
        │   ├── openfootball.ts      # dataset + statistiche + resolver
        │   └── leagues.ts           # whitelist competizioni
        ├── supabase/{client,server,admin}.ts
        ├── analysis.ts              # filtro candidate
        ├── data.ts                  # accesso dati (demo o Supabase)
        └── stats.ts                 # ROI, EV, CLV, drawdown
```

## Note

- Le statistiche **non** vengono mai inventate: se una squadra non è
  riconosciuta, o la fonte non è disponibile, la partita resta in attesa e il
  nome non risolto compare negli errori dell'operazione.
- Le competizioni fuori whitelist non vengono toccate: restano in attesa.
- La modalità DEMO è chiaramente etichettata e non richiede configurazione.
