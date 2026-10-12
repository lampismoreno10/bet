# BET – Penaltyblog (prototipo offline)

Questa directory aggiunge il motore statistico Python [penaltyblog](https://github.com/martineastwood/penaltyblog) al repository BET, **senza cambiare il sito Next.js, il cron, le quote o il database**. Non c'è deploy né integrazione con la pipeline live.

## Installazione (Windows PowerShell)

```powershell
cd services/football_model
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Su Mac/Linux: `python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`. L'installazione richiede connessione Internet, Python compatibile e un ambiente isolato.

## Esecuzione

Scaricare il JSON OpenFootball della lega/stagione voluta, per esempio il dataset di Serie A 2026/27 già citato in `src/lib/sports/openfootball.ts`. Il prototipo **non** scarica automaticamente dati, quindi non consuma chiamate API-Football.

```powershell
.\.venv\Scripts\python.exe predict.py --dataset "C:\percorso\it.1.json" --home "NOME_ESATTO_SQUADRA_CASA" --away "NOME_ESATTO_SQUADRA_OSPITE" --kickoff 2026-10-20
```

Il nome delle squadre deve corrispondere esattamente al campo `team1`/`team2` del JSON (non agli alias API-Football). Vengono utilizzati solo i risultati giocati prima della data indicata. Minimi conservativi: almeno 40 gare di campionato e 4 gare per squadra. Se manca storico sufficiente: errore esplicito, nessuna previsione inventata.

Opzione quote **inserite manualmente**:

```powershell
.\.venv\Scripts\python.exe predict.py --dataset "C:\percorso\it.1.json" --home "NOME_CASA" --away "NOME_OSPITE" --kickoff 2026-10-20 --odds bet365-example.json
```

Il file è un **esempio fittizio, non una quota reale**. Non utilizzare come fonte per scommettere. Il codice verifica la sintassi e l'etichetta Bet365, **non** l'origine, l'identità della partita, la disponibilità live o la scadenza della quota. L'EV prodotto è solo sperimentale.

Il mercato UNDER_3_5 è calcolato dal prototipo ma non è gestito dalla pipeline attuale BET. Non integrare finché non esistono parsing quote e settlement coerenti.

## Test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

I test usano un fake model deterministico, così la validazione della logica offline è possibile anche prima dell'installazione della libreria.

## Limiti prima della produzione

1. Verificare che penaltyblog 1.13.1 si installi ed esegua sul sistema target.
2. Eseguire test reali di fitting, backtest walk-forward, calibrazione e verifica out-of-sample.
3. Mappare in modo sicuro gli ID API-Football ai nomi OpenFootball.
4. Procurare snapshot reali e tempestivi Bet365 con provenienza verificabile (mai inventare quote).
5. Decidere come eseguire Python separatamente da Vercel/Next.js, con limiti di risorse e autenticazione.
6. Confrontare il nuovo modello con il flusso DeepSeek attuale senza forzare schedine.

**Stato:** solo codice di sperimentazione. Nessuna modifica alla produzione e nessun consiglio di giocata automatico.
