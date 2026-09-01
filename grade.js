(function (root) {
  "use strict";

  // Open finding weights by HHSC risk. Corrected findings count at 1/4 of
  // the open weight so the mix numbers track harm, not volume.
  // The LETTER is absolute, not a ranking, and is not retuned to fill a quota:
  //   A = no High in 24 months
  //   F = an open High
  //   B/C = corrected Highs only (a pattern a parent can still see)
  var CORRECTED_DISCOUNT = 0.25;
  // An uncorrected High cannot have a mix that reads like an A/B under the F tile.
  var OPEN_HIGH_CAP = 79;
  // Two or more corrected Highs in 24 months is a pattern. Cap the mix at 89
  // so the letter stays in the B/C band: not an A, and not an F on fixes alone.
  // Ceiling only — do not raise a low mix.
  var CORRECTED_HIGH_PATTERN = 2;
  var CORRECTED_HIGH_CEILING = 89;
  var WINDOW_DAYS = 730;
  var YEAR_DAYS = 365;

  function daysAgo(raw) {
    if (!raw) return null;
    var d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function isUncorrected(d) {
    // Open = both correction dates missing. A due/reported corrected_date
    // with no date_correction_verified is NOT open. Do not proxy via
    // corrected_at_inspection. On the HHSC public feed, corrected_date is
    // almost always filled, so F / HIGH may be unreachable. That is accepted.
    return !(d && (d.corrected_date || d.date_correction_verified));
  }

  function isHigh(level) {
    return String(level || "") === "High";
  }

  function isMediumHigh(level) {
    var l = String(level || "");
    return l === "Medium High" || l.indexOf("Medium High") === 0;
  }

  function openWeight(level) {
    var l = String(level || "");
    if (l === "High") return 8;
    if (l === "Medium High" || l.indexOf("Medium High") === 0) return 5;
    if (l === "Medium") return 3;
    if (l === "Medium Low" || l.indexOf("Medium Low") === 0) return 2;
    if (l === "Low") return 1;
    return 0;
  }

  function activityDateMap(acts) {
    var map = {}, i, a, id;
    for (i = 0; i < (acts || []).length; i++) {
      a = acts[i];
      id = String((a && a.activity_id) || "");
      if (id && a.activity_date && !map[id]) map[id] = a.activity_date;
    }
    return map;
  }

  // Incident date: join activity_id → activity.activity_date. If the
  // deficiency row already carries activity_date, use that. A miss is
  // not "today" and is not in-window — grade up by skipping the row.
  function incidentWhen(d, acts) {
    if (d && d.activity_date) return d.activity_date;
    var aid = String((d && d.activity_id) || "");
    if (!aid) return null;
    if (acts && !Array.isArray(acts)) return acts[aid] || null;
    var i, a;
    for (i = 0; i < (acts || []).length; i++) {
      a = acts[i];
      if (String((a && a.activity_id) || "") === aid) return a.activity_date || null;
    }
    return null;
  }

  function inWindow(ageDays) {
    return ageDays != null && ageDays <= WINDOW_DAYS;
  }

  function riskHit(level, ageDays, uncorrected) {
    var full = openWeight(level);
    if (!full) return 0;
    if (!inWindow(ageDays)) return 0;
    var w = ageDays <= YEAR_DAYS ? full : full / 2;
    if (!uncorrected) w *= CORRECTED_DISCOUNT;
    return w;
  }

  function blankGrade(label) {
    return {
      letter: "—",
      score: null,
      cls: "g-Z",
      label: label,
      safety: 0,
      inspect: 0,
      capped: false,
      patternCapped: false,
      uncorrectedHigh: false
    };
  }

  function gradeOf(op, defs, acts) {
    defs = defs || [];
    acts = acts || [];
    if (!op) return blankGrade("Unknown");
    var closed = String(op.operation_status).toUpperCase() !== "Y" || String(op.temporarily_closed).toUpperCase() === "YES";
    if (closed) return blankGrade("Closed / inactive");
    var dates = activityDateMap(acts);
    var safety = 0, uncorrectedHigh = false, high24 = 0, i, d, age, open;
    for (i = 0; i < defs.length; i++) {
      d = defs[i];
      age = daysAgo(incidentWhen(d, dates));
      open = isUncorrected(d);
      safety -= riskHit(d.standard_risk_level, age, open);
      if (!inWindow(age)) continue;
      if (isHigh(d.standard_risk_level)) {
        high24 += 1;
        if (open) uncorrectedHigh = true;
      }
    }
    var inspect = 0, clean12 = 0, any24 = false;
    for (i = 0; i < acts.length; i++) {
      var a = acts[i];
      var aage = daysAgo(a.activity_date);
      if (aage == null || aage > WINDOW_DAYS) continue;
      any24 = true;
      var yes = String(a.violation_found || "").toUpperCase();
      yes = yes === "Y" || yes === "YES";
      if (aage <= YEAR_DAYS) {
        if (yes) inspect -= 2;
        else if (String(a.activity_type || "").toUpperCase() === "INSPECTION") clean12 += 1;
      } else if (yes) inspect -= 1;
    }
    inspect += Math.min(5, clean12);
    if (!any24) inspect -= 5;
    var raw = 100 + safety + inspect;
    var capped = false, patternCapped = false;
    if (uncorrectedHigh && raw > OPEN_HIGH_CAP) {
      raw = OPEN_HIGH_CAP;
      capped = true;
    }
    if (!uncorrectedHigh && high24 >= CORRECTED_HIGH_PATTERN && raw > CORRECTED_HIGH_CEILING) {
      raw = CORRECTED_HIGH_CEILING;
      patternCapped = true;
    }
    var score = Math.max(0, Math.min(100, Math.round(raw)));
    var letter;
    if (uncorrectedHigh) letter = "F";
    else if (high24 === 0) letter = "A";
    else letter = score >= 80 ? "B" : "C";
    return {
      letter: letter,
      score: score,
      cls: "g-" + letter,
      label: score + " / 100",
      safety: Math.round(safety),
      inspect: inspect,
      capped: capped,
      patternCapped: patternCapped,
      uncorrectedHigh: uncorrectedHigh
    };
  }

  function findingSnippet(d) {
    var s = String((d && d.standard_number_description) || "").replace(/\s+/g, " ").trim();
    if (s) {
      var cut = s.indexOf(" - ");
      if (cut !== -1) s = s.slice(cut + 3);
      var next = s.indexOf(" - ");
      if (next !== -1) s = s.slice(0, next);
    } else {
      s = String((d && d.narrative) || "").replace(/\s+/g, " ").trim();
      if (!s) return "";
      var stop = s.search(/[.!?]/);
      if (stop !== -1) s = s.slice(0, stop);
    }
    s = s.replace(/\s+/g, " ").trim();
    if (s.length > 48) {
      var t = s.slice(0, 48);
      var sp = t.lastIndexOf(" ");
      s = (sp > 24 ? t.slice(0, sp) : t).replace(/[.,;:]+$/, "") + "…";
    }
    return s;
  }

  function fmtMonth(raw) {
    if (!raw) return "";
    var d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
  }

  function lastInspectionClean(acts) {
    var best = null, bestAge = null, i, a, age;
    for (i = 0; i < (acts || []).length; i++) {
      a = acts[i];
      if (String((a && a.activity_type) || "").toUpperCase() !== "INSPECTION") continue;
      age = daysAgo(a.activity_date);
      if (age == null) continue;
      if (bestAge == null || age < bestAge) {
        bestAge = age;
        best = a;
      }
    }
    if (!best) return false;
    var v = String(best.violation_found || "").toUpperCase();
    return v === "N" || v === "NO";
  }

  function riskRank(level) {
    if (isHigh(level)) return 5;
    if (isMediumHigh(level)) return 4;
    var l = String(level || "");
    if (l === "Medium") return 3;
    if (l === "Medium Low" || l.indexOf("Medium Low") === 0) return 2;
    if (l === "Low") return 1;
    return 0;
  }

  function gradeDriver(g, defs, acts) {
    if (!g || g.letter === "—" || g.cls === "g-Z") return "Closed or inactive.";
    var dates = activityDateMap(acts);
    var openHighs = [], high24 = 0, i, d, age, when;
    for (i = 0; i < (defs || []).length; i++) {
      d = defs[i];
      if (!isHigh(d.standard_risk_level)) continue;
      when = incidentWhen(d, dates);
      age = daysAgo(when);
      if (!inWindow(age)) continue;
      high24 += 1;
      if (isUncorrected(d)) openHighs.push({ d: d, when: when, age: age });
    }
    if (openHighs.length) {
      openHighs.sort(function (a, b) {
        var rk = riskRank(b.d.standard_risk_level) - riskRank(a.d.standard_risk_level);
        if (rk) return rk;
        var ageA = a.age == null ? 99999 : a.age;
        var ageB = b.age == null ? 99999 : b.age;
        if (ageA !== ageB) return ageA - ageB;
        var fireA = /Annual Fire Inspection/i.test(String(a.d.standard_number_description || "")) ? 1 : 0;
        var fireB = /Annual Fire Inspection/i.test(String(b.d.standard_number_description || "")) ? 1 : 0;
        return fireA - fireB;
      });
      var worst = openHighs[0];
      var snippet = findingSnippet(worst.d);
      var month = fmtMonth(worst.when);
      if (snippet && month) return "Uncorrected High · " + snippet + " cited " + month + ".";
      if (snippet) return "Uncorrected High · " + snippet + ".";
      if (month) return "Uncorrected High · cited " + month + ".";
      return "Uncorrected High.";
    }
    if (high24) return high24 + " High in 24 mo · all corrected.";
    if (lastInspectionClean(acts)) return "No High in 24 months · last inspection clean.";
    return "No High in 24 months.";
  }

  function isScarDriver(text) {
    return / High in 24 mo · all corrected\.?$/.test(String(text || ""));
  }

  var api = {
    CORRECTED_DISCOUNT: CORRECTED_DISCOUNT,
    CORRECTED_HIGH_PATTERN: CORRECTED_HIGH_PATTERN,
    CORRECTED_HIGH_CEILING: CORRECTED_HIGH_CEILING,
    OPEN_HIGH_CAP: OPEN_HIGH_CAP,
    daysAgo: daysAgo,
    isUncorrected: isUncorrected,
    incidentWhen: incidentWhen,
    riskHit: riskHit,
    gradeOf: gradeOf,
    gradeDriver: gradeDriver,
    isScarDriver: isScarDriver,
    findingSnippet: findingSnippet
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.daysAgo = daysAgo;
    root.isUncorrected = isUncorrected;
    root.incidentWhen = incidentWhen;
    root.riskHit = riskHit;
    root.gradeOf = gradeOf;
    root.gradeDriver = gradeDriver;
    root.isScarDriver = isScarDriver;
    root.findingSnippet = findingSnippet;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
