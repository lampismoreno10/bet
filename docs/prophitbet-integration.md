# ProphitBet → BET: importazione CSV sperimentale

Origine: https://github.com/kochlisGit/ProphitBet-Soccer-Bets-Predictor
Licenza dell'app originale: MIT (Vasileios Kochliaridis).
Fonte verificata: src/gui/windows/models/fixtures.py e src/preprocessing/utils/target.py.

Questa prima integrazione NON include il motore Python nel runtime Vercel:
legge realmente i CSV generati da ProphitBet v2 e mostra previsioni nel browser.
Non modifica Supabase, database, analisi, budget, cron o produzione.

## Uso

1. Installa ProphitBet v2 separatamente su PC Windows in un ambiente Python
   isolato. La documentazione upstream preferisce Python 3.11.
2. Crea il campionato e addestra un modello per Result (1/X/2).
3. In Predict Fixtures scegli una data, genera pronostici, seleziona le righe
   e premi Export: crea un CSV con colonne Home Team, Away Team, 1, X, 2,
   Predicted, Prob(1), Prob(X), Prob(2).
4. Facoltativo: addestra un modello U/O-2.5 ed esporta il CSV con Prob(U),
   Prob(O). È l'unico mercato U/O supportato upstream.
5. In BET apri /prophitbet, scegli la data delle partite e importa i CSV
   (anche entrambi nello stesso passaggio).

I file vengono elaborati SOLO nel browser e persi al ricaricamento.
Le previsioni sulla stessa data/partita/mercato dell'import successivo
sostituiscono le precedenti. Non ci sono salvataggi o API esterne.

## Analisi

1X = Prob(1)+Prob(X), X2 = Prob(X)+Prob(2), 12 = Prob(1)+Prob(2).
La quota equa mostrata è 1/probabilità modello, NON una quota reale.
La doppia sperimentale usa due partite distinte, una probabilità singola
minima del 65% e quota equa combinata da 1,70 a 2,00.
Se nessuna coppia soddisfa la regola, mostra NO BET.

Senza prezzi bookmaker reali non è possibile stimare l'EV, quindi
non viene suggerita alcuna scommessa economicamente conveniente.

## Limiti e verifiche

La data non è nel CSV esportato; va indicata manualmente. Matching squadra/data
è euristico, non è un ID partita verificato. Non caricare come previsioni
automatiche in Supabase. L'indipendenza degli eventi non è verificata.
La qualità predittiva del modello richiede ancora backtest. No retraining
o caricamento dei modelli Python automatico in BET.

Dopo aver eseguito un checkout della branch, eseguire con Node 24:

- node --no-warnings scripts/prophitbet-test.ts
- npm run typecheck
- npm test
- npm run build

Stato: branch di revisione, non unire in main finché test e verifica
con un CSV reale non sono completati.
