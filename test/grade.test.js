#!/usr/bin/env node
"use strict";

function daysAgoFromNow(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function daysAgo(raw) {
  if (!raw) return null;
  var d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function defWhen(d) {
  return (d && (d.date_correction_verified || d.corrected_date)) || null;
}
function isUncorrected(d) {
  return !(d && (d.corrected_date || d.date_correction_verified));
}
function riskHit(level, ageDays) {
  var l = String(level || "");
  var full = 0;
  if (l === "High") full = 8;
  else if (l === "Medium High" || l.indexOf("Medium High") === 0) full = 5;
  else if (l === "Medium") full = 3;
  else if (l === "Medium Low" || l.indexOf("Medium Low") === 0) full = 2;
  else if (l === "Low") full = 1;
  if (!full) return 0;
  if (ageDays == null) return full;
  if (ageDays <= 365) return full;
  if (ageDays <= 730) return full / 2;
  return 0;
}
function gradeOf(op, defs, acts) {
  defs = defs || [];
  acts = acts || [];
  if (!op) return { letter: "—", score: null, cls: "g-Z", label: "Unknown", safety: 0, inspect: 0, capped: false, uncorrectedHigh12: false };
  var closed = String(op.operation_status).toUpperCase() !== "Y" || String(op.temporarily_closed).toUpperCase() === "YES";
  if (closed) return { letter: "—", score: null, cls: "g-Z", label: "Closed / inactive", safety: 0, inspect: 0, capped: false, uncorrectedHigh12: false };
  var safety = 0, uncorrectedHigh12 = false, i;
  for (i = 0; i < defs.length; i++) {
    var d = defs[i];
    var age = daysAgo(defWhen(d));
    safety -= riskHit(d.standard_risk_level, age);
    if (String(d.standard_risk_level) === "High" && isUncorrected(d) && (age == null || age <= 365)) uncorrectedHigh12 = true;
  }
  var inspect = 0, clean12 = 0, any24 = false;
  for (i = 0; i < acts.length; i++) {
    var a = acts[i];
    var aage = daysAgo(a.activity_date);
    if (aage == null || aage > 730) continue;
    any24 = true;
    var yes = String(a.violation_found || "").toUpperCase();
    yes = yes === "Y" || yes === "YES";
    if (aage <= 365) {
      if (yes) inspect -= 2;
      else if (String(a.activity_type || "").toUpperCase() === "INSPECTION") clean12 += 1;
    } else if (yes) inspect -= 1;
  }
  inspect += Math.min(5, clean12);
  if (!any24) inspect -= 5;
  var raw = 100 + safety + inspect;
  var capped = false;
  if (uncorrectedHigh12 && raw > 79) { raw = 79; capped = true; }
  var score = Math.max(0, Math.min(100, Math.round(raw)));
  var letter = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  return { letter: letter, score: score, cls: "g-" + letter, label: score + " / 100", safety: Math.round(safety), inspect: inspect, capped: capped, uncorrectedHigh12: uncorrectedHigh12 };
}

function gradeDriver(g, defs, acts) {
  if (!g || g.letter === "—" || g.cls === "g-Z") return (g && g.label) || "Closed or inactive.";
  var high12 = 0, high24 = 0, openHigh = 0, any24 = false, i;
  for (i = 0; i < (defs || []).length; i++) {
    var d = defs[i];
    if (String(d.standard_risk_level) !== "High") continue;
    var age = daysAgo(defWhen(d));
    if (age != null && age > 730) continue;
    high24 += 1;
    if (age == null || age <= 365) {
      high12 += 1;
      if (isUncorrected(d)) openHigh += 1;
    }
  }
  for (i = 0; i < (acts || []).length; i++) {
    var aage = daysAgo(acts[i].activity_date);
    if (aage != null && aage <= 730) any24 = true;
  }
  if (g.uncorrectedHigh12 || openHigh) return "Uncorrected High this year.";
  if (high12) return "High finding in the last 12 months.";
  if (high24) return "High finding in the last 24 months.";
  if (!any24) return "No inspections in 24 months.";
  if (!high24) return "No High in 24 months.";
  return "Findings in the last 24 months.";
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

var cleanActs = [{ activity_date: daysAgoFromNow(30), activity_type: "INSPECTION", violation_found: "N" }];
var a = gradeOf(open, [], cleanActs);
assert(a.letter === "A", "clean recent inspection is A, got " + a.letter + " " + a.score);
assert(a.capped === false, "clean file is not capped");
assert(gradeDriver(a, [], cleanActs) === "No High in 24 months.", "A driver: " + gradeDriver(a, [], cleanActs));

var openHigh = [{ standard_risk_level: "High", date_correction_verified: null, corrected_date: null }];
var f = gradeOf(open, openHigh, cleanActs);
assert(f.uncorrectedHigh12 === true, "open High this year flags uncorrectedHigh12");
assert(f.capped === true, "uncorrected High caps the file");
assert(f.score === 79, "cap is 79, got " + f.score);
assert(f.letter === "C", "79 is a C, got " + f.letter);
assert(gradeDriver(f, openHigh, cleanActs) === "Uncorrected High this year.", "F/C driver: " + gradeDriver(f, openHigh, cleanActs));

var withStars = gradeOf(open, openHigh, cleanActs);
assert(withStars.score === 79, "stars are not in gradeOf; score stays 79");
assert(!("reviews" in withStars), "no reviews column on the grade object");

var inactive = gradeOf(closed, [], cleanActs);
assert(inactive.letter === "—", "inactive has no letter");

var oldHigh = [{ standard_risk_level: "High", corrected_date: daysAgoFromNow(800) }];
var old = gradeOf(open, oldHigh, cleanActs);
assert(old.uncorrectedHigh12 === false, "High older than 24 months is ignored for the cap");
assert(old.capped === false, "old High does not cap");

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall grade tests passed");
