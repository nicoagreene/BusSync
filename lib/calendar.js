// Turns a planWeek() result into recurring calendar events and an .ics file.
// Pure: no DOM or chrome.* APIs. Loaded as a classic script in the side panel and via require() in tests.
(function (root) {
  const TZID = "America/New_York";
  const ICS_DAY = { M: "MO", T: "TU", W: "WE", Th: "TH", F: "FR", Sa: "SA", Su: "SU" };
  const JS_DAY = { Su: 0, M: 1, T: 2, W: 3, Th: 4, F: 5, Sa: 6 };
  const DAY_ORDER = ["M", "T", "W", "Th", "F", "Sa", "Su"];
  const CAMPUS_NAMES = { HC: "Haverford", BMC: "Bryn Mawr", SC: "Swarthmore" };
  const MAX_TEXT = 500; // scraped course-guide text is capped before it goes anywhere

  const label = (campus) => CAMPUS_NAMES[campus] || campus;
  const clip = (s) => (s && s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s || "");
  const sortDays = (days) => [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

  // 45 -> "45 min", 60 -> "1 hr", 85 -> "1 hr 25 min"
  function duration(min) {
    if (min <= 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }

  // "15 min to reach the stop · 10 min until class"
  function slackText(leg) {
    const o = leg.option;
    const parts = [];
    if (leg.earliest != null) parts.push(`${duration(o.depart - leg.earliest)} to reach the stop`);
    if (leg.latest != null) parts.push(`${duration(leg.latest - o.arrive)} until class`);
    return parts.join(" · ");
  }

  // Neutral events, shared by the .ics export and (later) Google Calendar sync.
  // Returns { events, skipped } where skipped lists bus legs with no workable bus.
  function buildEvents(plan, semester) {
    const events = [];

    for (const c of plan.cart) {
      const patterns = new Map(); // "start-end" -> Set(days)
      for (const m of c.meetings) {
        const key = `${m.start}-${m.end}`;
        if (!patterns.has(key)) patterns.set(key, new Set());
        patterns.get(key).add(m.day);
      }
      for (const [key, days] of patterns) {
        const [start, end] = key.split("-").map(Number);
        const sorted = sortDays(days);
        events.push({
          uid: `bussync-${semester}-${c.id}-${sorted.join("")}-${start}-${end}@bussync`,
          kind: "class",
          title: clip(c.title ? `${c.code}: ${c.title}` : c.code),
          location: clip(c.location ? `${c.location}, ${label(c.campus)}` : label(c.campus)),
          description: clip([c.url, "Added by BusSync"].filter(Boolean).join("\n")),
          url: c.url || "",
          days: sorted,
          start,
          end,
        });
      }
    }

    const buses = new Map(); // identical segment + note on several days -> one recurring event
    const skipped = [];
    for (const day of Object.keys(plan.days)) {
      for (const item of plan.days[day].items) {
        if (item.type !== "leg") continue;
        if (!item.option) {
          skipped.push({ day, from: item.from, to: item.to, kind: item.kind });
          continue;
        }
        const segs = item.option.segments;
        segs.forEach((s, i) => {
          const notes = [];
          if (segs.length > 1) notes.push(i === 0 ? `Transfer at ${label(s.to)} to continue to ${label(segs[segs.length - 1].to)}` : `Connection from ${label(segs[0].from)}`);
          const slack = slackText(item);
          if (slack) notes.push(slack);
          if (item.status === "yellow") notes.push("Tight connection");
          const description = [...notes, "Added by BusSync"].join("\n");
          const key = [s.route, s.from, s.to, s.depart, s.arrive, description].join("|");
          if (!buses.has(key)) {
            buses.set(key, {
              kind: "bus",
              title: `${s.route} ${label(s.from)} → ${label(s.to)}`,
              location: `${label(s.from)} bus stop`,
              description,
              url: "",
              days: [],
              start: s.depart,
              end: Math.max(s.arrive, s.depart + 1),
              route: s.route,
              from: s.from,
              to: s.to,
            });
          }
          const ev = buses.get(key);
          if (!ev.days.includes(day)) ev.days.push(day);
        });
      }
    }
    // Name each bus event by everything that defines it, so the UID stays stable across exports.
    const busUidCount = new Map();
    for (const ev of buses.values()) {
      ev.days = sortDays(ev.days);
      const base = `bussync-${semester}-bus-${ev.route}-${ev.from}-${ev.to}-${ev.start}-${ev.days.join("")}`.replace(/[^A-Za-z0-9-]/g, "");
      const n = (busUidCount.get(base) || 0) + 1;
      busUidCount.set(base, n);
      ev.uid = `${base}${n > 1 ? `-${n}` : ""}@bussync`;
      delete ev.route;
      delete ev.from;
      delete ev.to;
      events.push(ev);
    }

    events.sort((a, b) => DAY_ORDER.indexOf(a.days[0]) - DAY_ORDER.indexOf(b.days[0]) || a.start - b.start);
    return { events, skipped };
  }

  // --- Dates (calendar dates as UTC midnights, so the host time zone never matters) ---

  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
  const ymd = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");
  const hms = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;

  // First date on or after `from` that falls on one of `days`.
  function firstOccurrence(from, days, until) {
    const wanted = new Set(days.map((d) => JS_DAY[d]));
    for (let d = from; d <= until; d = addDays(d, 1)) if (wanted.has(d.getUTCDay())) return d;
    return null;
  }

  // US Eastern: DST from 2nd Sunday of March to 1st Sunday of November.
  function easternOffsetHours(date) {
    const y = date.getUTCFullYear();
    const nthSunday = (month, n) => {
      const first = new Date(Date.UTC(y, month, 1));
      return addDays(first, ((7 - first.getUTCDay()) % 7) + 7 * (n - 1));
    };
    return date >= nthSunday(2, 2) && date < nthSunday(10, 1) ? 4 : 5;
  }

  // Each class day that falls inside a break range.
  function excludedDates(days, first, until, exclude) {
    const wanted = new Set(days.map((d) => JS_DAY[d]));
    const out = [];
    for (const [a, b] of exclude || []) {
      for (let d = parseDate(a); d <= parseDate(b); d = addDays(d, 1)) {
        if (d >= first && d <= until && wanted.has(d.getUTCDay())) out.push(d);
      }
    }
    return out.sort((x, y) => x - y);
  }

  // Timing for one event in a semester, or null if it never happens.
  // Used by toICS and by Google Calendar sync.
  function schedule(ev, dates) {
    const startDate = parseDate(dates.start);
    const until = parseDate(dates.end);
    const first = firstOccurrence(startDate, ev.days, until);
    if (!first) return null;
    // UNTIL must be UTC when DTSTART has a TZID: end of the last day, Eastern time.
    const untilUtc = new Date(addDays(until, 1).getTime() + easternOffsetHours(until) * 3600000 - 1000);
    const untilStr = untilUtc.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    return {
      first,
      rrule: `RRULE:FREQ=WEEKLY;BYDAY=${ev.days.map((d) => ICS_DAY[d]).join(",")};UNTIL=${untilStr}`,
      exdates: excludedDates(ev.days, first, until, dates.exclude),
      localStart: `${ymd(first)}T${hms(ev.start)}`,
      localEnd: `${ymd(first)}T${hms(ev.end)}`,
    };
  }

  // --- ICS text ---

  function escapeText(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  // Fold to 75 octets per line without splitting a multi-byte character.
  function fold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = "";
    let bytes = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      const limit = out.length ? 74 : 75; // continuation lines start with a space
      if (bytes + n > limit) {
        out.push(cur);
        cur = "";
        bytes = 0;
      }
      cur += ch;
      bytes += n;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  const VTIMEZONE = [
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  // dates: { start: "YYYY-MM-DD", end: "YYYY-MM-DD", exclude: [["YYYY-MM-DD","YYYY-MM-DD"], ...] }
  function toICS(events, dates, opts) {
    const now = (opts && opts.now) || new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BusSync//Tri-Co bus planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    if (opts && opts.name) lines.push(`X-WR-CALNAME:${escapeText(opts.name)}`);
    lines.push(`X-WR-TIMEZONE:${TZID}`, ...VTIMEZONE);
    for (const ev of events) {
      const s = schedule(ev, dates);
      if (!s) continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${ev.uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${s.localStart}`,
        `DTEND;TZID=${TZID}:${s.localEnd}`,
        s.rrule
      );
      if (s.exdates.length) lines.push(`EXDATE;TZID=${TZID}:${s.exdates.map((d) => `${ymd(d)}T${hms(ev.start)}`).join(",")}`);
      lines.push(`SUMMARY:${escapeText(ev.title)}`);
      if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
      if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
      if (/^https?:\/\//.test(ev.url)) lines.push(`URL:${ev.url}`);
      lines.push(`CATEGORIES:${ev.kind === "bus" ? "Bus" : "Class"}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  const api = { TZID, duration, slackText, buildEvents, schedule, toICS, escapeText, fold, parseDate, easternOffsetHours };
  root.BusSyncCalendar = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
