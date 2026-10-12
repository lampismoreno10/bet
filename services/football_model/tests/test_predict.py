import json
import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from predict import InputError, analyze, historical_matches, validate_odds


class FakeModel:
    def __init__(self, goals_home, goals_away, teams_home, teams_away):
        assert len(goals_home) == len(goals_away) == len(teams_home) == len(teams_away)
        self.number = len(goals_home)

    def fit(self):
        pass

    def predict(self, home, away):
        return SimpleNamespace(
            home_win=0.50, draw=0.25, away_win=0.25,
            total_goals=lambda side, line: 0.60 if side == "under" else 0.40,
            btts_yes=0.55, btts_no=0.45,
        )


def dataset():
    matches = []
    teams = ["Roma", "Milan", "Inter", "Lazio"]
    for n in range(48):
        matches.append({
            "date": f"2026-0{1 + (n // 24)}-{1 + (n % 24):02d}",
            "team1": teams[n % 4],
            "team2": teams[(n + 1) % 4],
            "score": {"ft": [n % 3, (n + 1) % 3]},
        })
    matches.extend([
        {"date": "2026-10-21", "team1": "Roma", "team2": "Milan", "score": {"ft": [8, 0]}},
        {"date": "2026-01-05", "team1": "Roma", "team2": "Inter"},
    ])
    return {"matches": matches}


class PrototypeTests(unittest.TestCase):
    def test_no_future_results_or_unplayed_fixtures(self):
        self.assertEqual(len(historical_matches(dataset(), date(2026, 10, 20))), 48)

    def test_prediction_without_odds_never_claims_ev(self):
        result = analyze(dataset(), "Roma", "Milan", "2026-10-20", model_class=FakeModel)
        self.assertEqual(result["training"]["matches"], 48)
        self.assertAlmostEqual(result["markets"]["1X"]["estimated_probability"], .75)
        self.assertIsNone(result["markets"]["1X"]["estimated_ev"])
        self.assertIsNone(result["recommendation"])

    def test_ev_requires_explicit_snapshot(self):
        snapshot = {"bookmaker": "Bet365", "captured_at": "2026-10-12T14:00:00+02:00", "markets": {"1X": 1.5}}
        result = analyze(dataset(), "Roma", "Milan", "2026-10-20", snapshot, FakeModel)
        self.assertEqual(result["markets"]["1X"]["estimated_ev"], 0.125)
        self.assertFalse(result["odds_source"]["verified_live"])

    def test_rejects_imaginary_bookmaker(self):
        with self.assertRaises(InputError):
            validate_odds({"bookmaker": "Other", "captured_at": "2026-10-12T14:00:00+02:00", "markets": {"1X": 1.4}})

    def test_rejects_unknown_team(self):
        with self.assertRaises(InputError):
            analyze(dataset(), "Roma", "Missing", "2026-10-20", model_class=FakeModel)

    def test_rejects_future_training_only(self):
        with self.assertRaises(InputError):
            analyze(dataset(), "Roma", "Milan", "2026-01-01", model_class=FakeModel)

    def test_rejects_bad_odd(self):
        with self.assertRaises(InputError):
            validate_odds({"bookmaker": "Bet365", "captured_at": "2026-10-12T14:00:00+02:00", "markets": {"1X": float("nan")}})


if __name__ == "__main__":
    unittest.main()
