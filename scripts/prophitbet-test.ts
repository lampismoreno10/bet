import assert from "node:assert/strict";
import { parseProphitBetCsv, buildProphitBetPicks, buildProphitBetDouble } from "../src/lib/sports/prophitbet.ts";

const csv = [
"Home Team,Away Team,1,X,2,Predicted,Prob(1),Prob(X),Prob(2)",
"Roma,Milan,1.9,3.4,4.0,H,0.60,0.15,0.25",
"Inter,Lazio,1.4,4.4,7.0,H,0.55,0.18,0.27"
].join("\n");
const imported = parseProphitBetCsv(csv, "result.csv", "2026-10-20");
assert.equal(imported.predictions.length, 2);
assert.equal(imported.warnings.length, 0);
const picks = buildProphitBetPicks(imported.predictions);
assert.equal(picks.find(p => p.homeTeam === "Roma" && p.market === "1X")?.probability, 0.75);
const double = buildProphitBetDouble(picks);
assert.ok(double);
assert.notEqual(double.picks[0].fixtureKey, double.picks[1].fixtureKey);
assert.ok(double.combinedFairOdds >= 1.70 && double.combinedFairOdds <= 2.0);
const goals = parseProphitBetCsv(
"Home Team,Away Team,1,X,2,Predicted,Prob(U),Prob(O)\nRoma,Milan,1.9,3.4,4.0,U,0.73,0.27",
"goals.csv", "2026-10-20");
assert.equal(goals.predictions[0].probabilities.under25, 0.73);
const bad = parseProphitBetCsv(csv.replace("0.60,0.15,0.25", "0.9,0.9,0.9"), "bad.csv", "2026-10-20");
assert.equal(bad.predictions.length, 1);
assert.equal(bad.warnings.length, 1);
assert.equal(buildProphitBetDouble(picks.filter(p => p.fixtureKey.includes("roma"))), null);
assert.throws(() => parseProphitBetCsv(csv, "x.csv", "2026-02-30"));
console.log("ProphitBet CSV bridge tests passed");
