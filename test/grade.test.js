#!/usr/bin/env node
"use strict";

var g = require("../grade.js");
var gradeOf = g.gradeOf;
var gradeDriver = g.gradeDriver;
var isUncorrected = g.isUncorrected;
var incidentWhen = g.incidentWhen;
var riskHit = g.riskHit;

function daysAgoFromNow(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

var open = { operation_status: "Y", temporarily_closed: "NO" };
var closed = { operation_status: "N", temporarily_closed: "NO" };

function act(id, days, type, viol) {
  return {
    activity_id: id,
    activity_date: daysAgoFromNow(days),
    activity_type: type || "INSPECTION",
    violation_found: viol == null ? "N" : viol
  };
}
function def(opts) {
  return {
    activity_id: opts.id,
    standard_risk_level: opts.level || "High",
    standard_number_description: opts.desc || "",
    narrative: opts.narr || "",
    corrected_date: opts.corr || null,
    date_correction_verified: opts.ver || null,
    corrected_at_inspection: opts.at || "N"
  };
}

var cleanActs = [act("clean-1", 30, "INSPECTION", "N")];
var a = gradeOf(open, [], cleanActs);
assert(a.letter === "A", "clean recent inspection is A, got " + a.letter + " " + a.score);
assert(a.capped === false, "clean file is not capped");
assert(a.uncorrectedHigh === false, "clean file has no open High");
assert(gradeDriver(a, [], cleanActs) === "No High in 24 months · last inspection clean.", "clean driver: " + gradeDriver(a, [], cleanActs));

var smokeWhen = daysAgoFromNow(20);
var openHighDefs = [def({
  id: "h1",
  level: "High",
  desc: "746.3707 - Smoking, cigarettes, tobacco"
})];
var openHighActs = [
  act("h1", 20, "INSPECTION", "Y"),
  act("clean-1", 30, "INSPECTION", "N")
];
openHighActs[0].activity_date = smokeWhen;
var f = gradeOf(open, openHighDefs, openHighActs);
assert(f.uncorrectedHigh === true, "open High this year flags uncorrectedHigh");
assert(f.letter === "F", "open High is F, got " + f.letter);
assert(f.cls === "g-F", "open High uses the F tile");
var openDriver = gradeDriver(f, openHighDefs, openHighActs);
assert(openDriver.indexOf("Uncorrected High ·") === 0, "open High driver starts Uncorrected High ·, got " + openDriver);
assert(openDriver.indexOf("Smoking") !== -1, "open High driver names the finding: " + openDriver);
assert(/cited [A-Z][a-z]{2} \d{4}\.$/.test(openDriver), "open High driver cites month: " + openDriver);

var withStars = gradeOf(open, openHighDefs, openHighActs);
assert(withStars.letter === "F", "stars are not in gradeOf; open High stays F");
assert(!("reviews" in withStars), "no reviews column on the grade object");

var inactive = gradeOf(closed, [], cleanActs);
assert(inactive.letter === "—", "inactive has no letter");
assert(gradeDriver(inactive, [], cleanActs) === "Closed or inactive.", "closed driver: " + gradeDriver(inactive, [], cleanActs));

var oldHigh = [def({ id: "old", level: "High", corr: daysAgoFromNow(10), ver: daysAgoFromNow(10), at: "N" })];
var oldActs = [act("old", 800, "INSPECTION", "Y")].concat(cleanActs);
var old = gradeOf(open, oldHigh, oldActs);
assert(old.uncorrectedHigh === false, "High older than 24 months is ignored for the cap");
assert(old.capped === false, "old High does not cap");
assert(old.letter === "A", "High older than 24 months is no High, so A, got " + old.letter);

// Corrected High does not force F, even as a pile.
var manyCorrected = [];
var manyActs = [act("insp-clean", 40, "INSPECTION", "N")];
for (var n = 0; n < 10; n++) {
  var id = "ch" + n;
  manyCorrected.push(def({
    id: id,
    level: "High",
    desc: "746.1003(1) - Director Responsibilities - Operate in Compliance",
    corr: daysAgoFromNow(20),
    ver: daysAgoFromNow(15),
    at: "N"
  }));
  manyActs.push(act(id, 60, "INSPECTION", "Y"));
}
var pile = gradeOf(open, manyCorrected, manyActs);
assert(pile.uncorrectedHigh === false, "corrected Highs do not set uncorrectedHigh");
assert(pile.capped === false, "corrected Highs do not apply an open-High cap");
assert(pile.letter !== "F" && pile.letter !== "D", "corrected Highs alone cannot be F/D, got " + pile.letter);
assert(pile.letter === "B" || pile.letter === "C", "10 corrected Highs sit in B/C, got " + pile.letter + " " + pile.score);
assert(pile.score <= 89, "corrected-High ceiling keeps the file off A, score " + pile.score);
var twoHighActs = [act("th1", 20, "INSPECTION", "N"), act("th2", 25, "INSPECTION", "N")];
var twoHigh = [
  def({ id: "th1", level: "High", ver: daysAgoFromNow(4), at: "N" }),
  def({ id: "th2", level: "High", ver: daysAgoFromNow(4), at: "N" })
];
var twoG = gradeOf(open, twoHigh, twoHighActs);
assert(twoG.letter === "B", "two corrected Highs with a clean file cap at B, got " + twoG.letter + " " + twoG.score);
assert(twoG.patternCapped === true && twoG.score === 89, "explicit 89 ceiling, score " + twoG.score + " patternCapped " + twoG.patternCapped);
var pileDriver = gradeDriver(pile, manyCorrected, manyActs);
assert(pileDriver === "10 High in 24 mo · all corrected.", "corrected pattern driver: " + pileDriver);
assert(g.isScarDriver(pileDriver) === true, "corrected-High driver is the scar line");
assert(g.isScarDriver("No High in 24 months · last inspection clean.") === false, "clean driver is not the scar");
assert(g.isScarDriver("Uncorrected High · Smoking cited Aug 2026.") === false, "open High driver is not the scar");

// One corrected High is still a High — A requires none.
var one = [def({ id: "one", level: "High", corr: daysAgoFromNow(5), ver: daysAgoFromNow(4), at: "Y" })];
var oneActs = [act("one", 10, "INSPECTION", "N")];
var oneG = gradeOf(open, one, oneActs);
assert(oneG.letter === "B" || oneG.letter === "C", "a single corrected High is not A, got " + oneG.letter + " " + oneG.score);
assert(oneG.letter !== "A" && oneG.letter !== "F", "any High in 24 months is not A; corrected is not F");
assert(oneG.patternCapped === false, "one corrected High is not the pattern ceiling");

// Incident-date recency, not correction-date recency.
var staleIncident = [def({
  id: "stale",
  level: "High",
  corr: daysAgoFromNow(5),
  ver: daysAgoFromNow(3),
  at: "N"
})];
var staleActs = [act("stale", 800, "INSPECTION", "Y")].concat(cleanActs);
var staleG = gradeOf(open, staleIncident, staleActs);
assert(staleG.letter === "A", "old incident / recent correction is out of the 24-month window, got " + staleG.letter);
assert(incidentWhen(staleIncident[0], staleActs).indexOf(staleActs[0].activity_date.slice(0, 10)) === 0
  || incidentWhen(staleIncident[0], staleActs) === staleActs[0].activity_date,
  "incidentWhen joins activity_id to activity_date");
assert(riskHit("High", 800, false) === 0, "incident older than 24 months is 0");
assert(riskHit("High", null, true) === 0, "missing incident date is not treated as in-window");

var recentIncident = [
  def({ id: "fresh1", level: "High", corr: daysAgoFromNow(800), ver: daysAgoFromNow(5), at: "N" }),
  def({ id: "fresh2", level: "High", corr: daysAgoFromNow(800), ver: daysAgoFromNow(5), at: "N" })
];
var recentActs = [act("fresh1", 10, "INSPECTION", "N"), act("fresh2", 12, "INSPECTION", "N")];
var recentG = gradeOf(open, recentIncident, recentActs);
assert(recentG.safety < 0, "recent incident stays in the window even if correction is old, safety " + recentG.safety);
assert(recentG.letter === "B" || recentG.letter === "C", "two recent corrected Highs are a pattern, got " + recentG.letter);
assert(gradeDriver(recentG, recentIncident, recentActs) === "2 High in 24 mo · all corrected.", "recent-incident driver: " + gradeDriver(recentG, recentIncident, recentActs));

// Join miss: no activity_id match → skip (grade up), do not treat as today.
var orphan = [def({ id: "missing-act", level: "High", at: "N" })];
var orphanG = gradeOf(open, orphan, cleanActs);
assert(orphanG.uncorrectedHigh === false, "join miss does not count as an open High");
assert(orphanG.letter === "A", "join miss grades up, got " + orphanG.letter);

// Open = both correction dates missing. Unverified (corrected_date only) is not open.
assert(isUncorrected({ standard_risk_level: "High" }) === true,
  "missing both correction dates is open");
assert(isUncorrected({ standard_risk_level: "High", corrected_date: daysAgoFromNow(-20), corrected_at_inspection: "N" }) === false,
  "corrected_date without verification is not open");
assert(isUncorrected({ standard_risk_level: "High", date_correction_verified: daysAgoFromNow(2) }) === false,
  "date_correction_verified closes the finding");
assert(isUncorrected({ standard_risk_level: "High", corrected_at_inspection: "Y" }) === true,
  "corrected_at_inspection is not an open/closed proxy");

// Unverified High (corrected_date present, verified missing) is corrected, not F.
var unverifiedHigh = [def({
  id: "uv",
  level: "High",
  desc: "746.5101(a) - Annual Fire Inspection",
  corr: daysAgoFromNow(10),
  at: "N"
})];
var unverifiedActs = [act("uv", 10, "INSPECTION", "Y")];
var uvG = gradeOf(open, unverifiedHigh, unverifiedActs);
assert(uvG.uncorrectedHigh === false, "unverified is not open High");
assert(uvG.letter !== "F", "unverified High is not F, got " + uvG.letter);
assert(uvG.letter === "B" || uvG.letter === "C", "unverified High sits in B/C, got " + uvG.letter);
assert(gradeDriver(uvG, unverifiedHigh, unverifiedActs) === "1 High in 24 mo · all corrected.",
  "unverified driver: " + gradeDriver(uvG, unverifiedHigh, unverifiedActs));

// Open High gate: both dates missing. Unverified-as-open is forbidden. Corrected High never forces F.
var harshDefs = [def({ id: "prob", level: "High", desc: "745.8641 - Requirements during probation" })];
var harshActs = [act("prob", 15, "INSPECTION", "Y")];
var harsh = gradeOf(open, harshDefs, harshActs);
assert(harsh.uncorrectedHigh === true, "open High gate is on");
assert(harsh.letter === "F", "open High is F, got " + harsh.letter);
var harshDriver = gradeDriver(harsh, harshDefs, harshActs);
assert(harshDriver.indexOf("Requirements during probation") !== -1, "open High driver uses finding text: " + harshDriver);

// Volume of corrected Mediums cannot produce F/D.
var meds = [];
var medActs = [act("m-clean", 20, "INSPECTION", "N")];
for (var m = 0; m < 40; m++) {
  meds.push(def({ id: "m" + m, level: "Medium", ver: daysAgoFromNow(8), at: "N" }));
  medActs.push(act("m" + m, 40, "INSPECTION", "Y"));
}
var medG = gradeOf(open, meds, medActs);
assert(medG.letter === "A", "no High in 24 months is A even with a pile of Mediums, got " + medG.letter);
assert(medG.letter !== "F", "no High at all is never F");

// Smell checks: open High must be F; no High must not be F.
assert(gradeOf(open, openHighDefs, openHighActs).letter === "F", "smell: open High is F");
assert(gradeOf(open, [], cleanActs).letter !== "F", "smell: clean file is not F");

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall grade tests passed");
