// Shared helpers for course-guide text and times.
// Loaded as a classic script (content script + side panel) and via require() in tests.
(function (root) {
  const WEEKDAYS = ["M", "T", "W", "Th", "F"];
  const DAY_NAMES = { M: "Monday", T: "Tuesday", W: "Wednesday", Th: "Thursday", F: "Friday", Sa: "Saturday", Su: "Sunday" };
  const CAMPUS_LABELS = { HC: "Hav", BMC: "BMC", SC: "Swat" };
  const COLLEGE_PARAM_TO_CAMPUS = { haverford: "HC", bryn_mawr: "BMC", swarthmore: "SC" };

  // "MWF" -> ["M","W","F"]; "TTH"/"TTh"/"TTHTH" -> ["T","Th"].
  function parseDays(str) {
    const days = [];
    const re = /TH|SA|SU|M|T|W|F|R|S|U/gi;
    let m;
    while ((m = re.exec(str))) {
      const tok = m[0].toUpperCase();
      const day = { TH: "Th", R: "Th", SA: "Sa", S: "Sa", SU: "Su", U: "Su" }[tok] || tok;
      if (!days.includes(day)) days.push(day);
    }
    return days;
  }

  // "02:10pm" / "2:10 pm" -> minutes since midnight.
  function parseClock(str) {
    const m = /^\s*(\d{1,2})(?::(\d\d))?\s*([ap])\.?m?\.?\s*$/i.exec(str);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const pm = m[3].toLowerCase() === "p";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return h * 60 + min;
  }

  // "MWF 02:10pm-03:00pm" -> [{day,start,end}, ...]; null if unparseable.
  function parseMeetingLine(line) {
    const m = /^\s*([A-Za-z]+)\s+(\d{1,2}(?::\d\d)?\s*[ap]\.?m?\.?)\s*-\s*(\d{1,2}(?::\d\d)?\s*[ap]\.?m?\.?)\s*$/i.exec(line);
    if (!m) return null;
    const days = parseDays(m[1]);
    const start = parseClock(m[2]);
    const end = parseClock(m[3]);
    if (!days.length || start == null || end == null) return null;
    return days.map((day) => ({ day, start, end }));
  }

  // minutes -> "10:35a" (bus style) or "10:35am" (long).
  function formatTime(min, long) {
    const m = ((min % 1440) + 1440) % 1440;
    let h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    const suffix = h >= 12 ? "p" : "a";
    h = h % 12 || 12;
    return `${h}:${mm}${suffix}${long ? "m" : ""}`;
  }

  const api = {
    WEEKDAYS,
    DAY_NAMES,
    CAMPUS_LABELS,
    COLLEGE_PARAM_TO_CAMPUS,
    parseDays,
    parseClock,
    parseMeetingLine,
    formatTime,
  };
  root.BusSyncParse = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
