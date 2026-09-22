# Bet CRM

CRM per la gestione di un sistema di betting: partite candidate, analisi con
quote ed EV, giocate, report e statistiche.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS 3**
- **Supabase** (database PostgreSQL + autenticazione, con Row Level Security)

## Funzionalità

- **Dashboard "Oggi"** — elenco delle partite candidate con il dettaglio
  dell'analisi: mercato consigliato, quota di analisi, quota Bet365
  effettivamente giocata, probabilità stimata, quota equa, EV, affidabilità,
  rischi/motivazioni e stato (`Da valutare`, `Giocabile`, `Scartata`,
  `Giocata`, `Chiusa`).
- **"Segna come giocata"** — crea la giocata e la inserisce automaticamente
  nel report/archivio.
- **Archivio Giocate** — profitto/perdita, ROI, win rate, quota media,
  EV medio, CLV e drawdown.
- **Statistiche** — curva di profitto e breakdown per campionato, mercato e
  fascia di quota.
- **Budget** — budget mensile e annuale, bankroll e movimenti.
- **Modalità DEMO** — dati fittizi chiaramente etichettati, senza bisogno di
  configurare Supabase.

## Struttura del progetto

```
bet/
├── middleware.ts               # protezione rotte + refresh sessione
├── supabase/schema.sql         # schema, RLS, indici (da eseguire in Supabase)
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # redirect a /dashboard
│   │   ├── login/page.tsx      # accesso/registrazione
│   │   └── (dashboard)/
│   │       ├── layout.tsx      # shell autenticata (nav + header)
│   │       ├── actions.ts      # server action (segna giocata, chiudi giocata)
│   │       ├── dashboard/page.tsx
│   │       ├── matches/[id]/page.tsx
│   │       ├── archive/page.tsx
│   │       ├── stats/page.tsx
│   │       └── budget/page.tsx
│   ├── components/             # componenti UI riutilizzabili
│   ├── lib/
│   │   ├── config.ts           # modalità DEMO
│   │   ├── data.ts             # accesso dati (demo o Supabase)
│   │   ├── demo-data.ts        # dati fittizi DEMO
│   │   ├── format.ts           # formattatori (€, %, quote)
│   │   ├── stats.ts            # calcoli (ROI, EV, CLV, drawdown, grouping)
│   │   └── supabase/           # client browser e server
│   └── types/index.ts          # modello dati del dominio
├── .env.example
├── package.json
└── tailwind.config.ts
```

## Avvio rapido (modalità DEMO)

1. Installa le dipendenze:

   ```bash
   npm install
   ```

2. Avvia il server di sviluppo:

   ```bash
   npm run dev
   ```

3. Apri `http://localhost:3000`. Senza variabili Supabase configurate l'app
   parte automaticamente in **modalità DEMO** con dati fittizi etichettati.

## Configurazione Supabase (modalità reale)

1. Crea un progetto su [Supabase](https://supabase.com).
2. In **SQL Editor** esegui il contenuto di `supabase/schema.sql`: crea le
   tabelle e abilita la Row Level Security (ogni utente vede solo i propri
   dati).
3. Copia `.env.example` in `.env` e compila:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://tuo-progetto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=la-tua-anon-key
   NEXT_PUBLIC_DEMO_MODE=false
   ```

   > `.env` è già escluso dal versionamento (`.gitignore`).

4. Riavvia `npm run dev`, registrati da `/login` e inizia a usare i tuoi dati.

## Tabelle del database

`matches`, `analyses`, `bets`, `odds_snapshots`, `budgets`,
`bankroll_transactions`, `model_versions`.

- `odds_snapshots` è predisposto per lo storico delle quote.
- `model_versions` è predisposto per le versioni del modello statistico.
- Le colonne del DB sono in `snake_case`; il mapping verso il modello
  `camelCase` dell'app avviene in `src/lib/data.ts`.

## Import da fonti esterne (roadmap)

Il sistema è predisposto per importare partite, statistiche e quote da fonti
esterne (es. Diretta.it/API). I punti di aggancio previsti sono:

- `matches.external_id` per mappare le partite verso l'ID della fonte esterna;
- `odds_snapshots` per registrare lo storico delle quote;
- `model_versions` per tracciare le versioni del modello.

Al momento **non** vengono inventati dati reali: usa la modalità DEMO per i
test, oppure collega le tue fonti.

## Note sulla prima versione

- Quando segni una partita come "giocata", la giocata viene creata con importo
  `0` e stato "Aperta". Nell'archivio puoi impostare l'importo e chiudere
  l'esito (Vinta / Persa / Annullata), che calcola automaticamente il
  profitto.
- Il drawdown è calcolato sulla curva di profitto cumulato (non sul bankroll
  assoluto).

## Script disponibili

| Script              | Descrizione                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | avvia il server di sviluppo          |
| `npm run build`     | build di produzione                  |
| `npm run start`     | avvia la build di produzione         |
| `npm run typecheck` | controllo dei tipi TypeScript        |
