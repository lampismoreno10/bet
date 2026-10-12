#!/usr/bin/env python3
"""Offline Poisson prototype for BET. No writes, API calls, or automatic bets."""

import argparse
from collections import Counter
from datetime import date, datetime
import json
import math
from pathlib import Path
import sys

MIN_LEAGUE_MATCHES = 40
MIN_TEAM_MATCHES = 4
SUPPORTED_MARKETS = (
    "1X", "X2", "12", "OVER_1_5", "UNDER_1_5",
    "OVER_2_5", "UNDER_2_5", "UNDER_3_5",
    "OVER_4_5", "UNDER_4_5", "BTTS_YES", "BTTS_NO",
)


class InputError(ValueError):
    """Source data are missing, incompatible or not sufficiently reliable."""


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as source:
        return json.load(source)


def _date(value):
    if not isinstance(value, str) or len(value) != 10:
        raise InputError("La data deve essere nel formato YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise InputError("Data non valida: " + value) from exc


def _goal(value):
    return type(value) is int and 0 <= value <= 50


def historical_matches(dataset, cutoff):
    """Use only valid final scores STRICTLY before kickoff (no future leakage)."""
    if not isinstance(dataset, dict) or not isinstance(dataset.get("matches"), list):
        raise InputError("Dataset OpenFootball non valido: manca matches[].")

    completed = []
    for item in dataset["matches"]:
        if not isinstance(item, dict):
            continue
        home, away, raw_date = item.get("team1"), item.get("team2"), item.get("date")
        score = item.get("score")
        ft = score.get("ft") if isinstance(score, dict) else None
        if not (isinstance(home, str) and home.strip()
                and isinstance(away, str) and away.strip() and home != away
                and isinstance(raw_date, str) and len(raw_date) == 10
                and isinstance(ft, list) and len(ft) == 2
                and _goal(ft[0]) and _goal(ft[1])):
            continue
        try:
            played_on = date.fromisoformat(raw_date)
        except ValueError:
            continue
        if played_on < cutoff:
            completed.append((played_on, home, away, ft[0], ft[1]))

    completed.sort(key=lambda match: match[0])
    return completed


def validate_odds(raw):
    """Manual Bet365 snapshot: identity/date verified as format, NOT against Bet365."""
    if not isinstance(raw, dict) or raw.get("bookmaker") != "Bet365":
        raise InputError("Per BET sono ammesse solo quote dichiarate Bet365.")
    timestamp = raw.get("captured_at")
    if not isinstance(timestamp, str):
        raise InputError("Manca captured_at (timestamp con fuso orario).")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InputError("captured_at non valido.") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InputError("captured_at deve contenere il fuso orario.")

    markets = raw.get("markets")
    if not isinstance(markets, dict):
        raise InputError("Manca markets nell'istantanea delle quote.")
    for code, odd in markets.items():
        if code not in SUPPORTED_MARKETS:
            raise InputError("Mercato non riconosciuto: " + str(code))
        if type(odd) not in (int, float) or not math.isfinite(odd) or odd <= 1:
            raise InputError("Quota non valida per " + code)
    return raw


def _safe_probability(value, code):
    number = float(value)
    if not math.isfinite(number) or number < -1e-8 or number > 1 + 1e-8:
        raise RuntimeError("Probabilita non valida per " + code)
    return min(1.0, max(0.0, number))


def analyze(dataset, home, away, kickoff, odds=None, model_class=None):
    cutoff = _date(kickoff)
    if not isinstance(home, str) or not home.strip():
        raise InputError("Squadra di casa mancante.")
    if not isinstance(away, str) or not away.strip() or home == away:
        raise InputError("Squadra ospite mancante o uguale a quella di casa.")
    if odds is not None:
        validate_odds(odds)

    played = historical_matches(dataset, cutoff)
    if len(played) < MIN_LEAGUE_MATCHES:
        raise InputError(
            f"Storico insufficiente: {len(played)} partite, minimo {MIN_LEAGUE_MATCHES}."
        )
    counts = Counter(team for _, h, a, _, _ in played for team in (h, a))
    for team in (home, away):
        if counts[team] < MIN_TEAM_MATCHES:
            raise InputError(
                f"Squadra non riconosciuta o con poche partite: {team} "
                f"({counts[team]} risultati; minimo {MIN_TEAM_MATCHES}). "
                "Usare il nome ESATTO nel dataset OpenFootball."
            )

    if model_class is None:
        try:
            from penaltyblog.models import PoissonGoalsModel
        except ImportError as exc:
            raise InputError(
                "Penaltyblog non installato. Installare requirements.txt "
                "in un ambiente Python isolato."
            ) from exc
        model_class = PoissonGoalsModel

    model = model_class(
        [m[3] for m in played],
        [m[4] for m in played],
        [m[1] for m in played],
        [m[2] for m in played],
    )
    model.fit()
    prediction = model.predict(home, away)

    values = {
        "1X": prediction.home_win + prediction.draw,
        "X2": prediction.draw + prediction.away_win,
        "12": prediction.home_win + prediction.away_win,
        "OVER_1_5": prediction.total_goals("over", 1.5),
        "UNDER_1_5": prediction.total_goals("under", 1.5),
        "OVER_2_5": prediction.total_goals("over", 2.5),
        "UNDER_2_5": prediction.total_goals("under", 2.5),
        "UNDER_3_5": prediction.total_goals("under", 3.5),
        "OVER_4_5": prediction.total_goals("over", 4.5),
        "UNDER_4_5": prediction.total_goals("under", 4.5),
        "BTTS_YES": prediction.btts_yes,
        "BTTS_NO": prediction.btts_no,
    }
    outcome = {}
    for code, raw_probability in values.items():
        probability = _safe_probability(raw_probability, code)
        odd = odds["markets"].get(code) if odds else None
        outcome[code] = {
            "estimated_probability": round(probability, 6),
            "fair_odds": round(1 / probability, 2) if probability > 0 else None,
            "bet365_odds_unverified": odd,
            "estimated_ev": round(probability * odd - 1, 4) if odd else None,
            "supported_by_bet_today": code != "UNDER_3_5",
        }

    return {
        "status": "offline_experiment_not_for_automatic_betting",
        "model": "penaltyblog.PoissonGoalsModel",
        "fixture": {"home_team": home, "away_team": away, "kickoff_date": kickoff},
        "training": {
            "matches": len(played),
            "teams": len(counts),
            "latest_result_date": played[-1][0].isoformat(),
        },
        "odds_source": (
            {"bookmaker": "Bet365", "captured_at": odds["captured_at"],
             "verified_live": False} if odds else None
        ),
        "markets": outcome,
        "recommendation": None,
        "warning": (
            "Stime NON calibrate o validate con backtest. "
            "Le quote, quando fornite, NON sono verificate automaticamente. "
            "Nessuna schedina generata; nessun salvataggio su BET."
        ),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Prototipo Penaltyblog offline, senza modificare BET."
    )
    parser.add_argument("--dataset", required=True, help="JSON originale OpenFootball")
    parser.add_argument("--home", required=True, help="Nome squadra ESATTO in OpenFootball")
    parser.add_argument("--away", required=True, help="Nome squadra ESATTO in OpenFootball")
    parser.add_argument("--kickoff", required=True, help="Data fixture YYYY-MM-DD")
    parser.add_argument("--odds", help="Snapshot Bet365 manuale, JSON opzionale")
    args = parser.parse_args()

    try:
        data = read_json(args.dataset)
        odds = read_json(args.odds) if args.odds else None
        result = analyze(data, args.home, args.away, args.kickoff, odds)
    except (InputError, OSError, json.JSONDecodeError, RuntimeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
