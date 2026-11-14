const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/parse.js");
const Planner = require("../lib/planner.js");
const Cal = require("../lib/calendar.js");
const semesters = require("../data/semesters.json");

const course = (id, campus, lines, extra) => ({
  id, code: id, title: `${id} title`, campus, location: "Room 1", url: `https://example.edu/${id}`,
  meetings: lines.flatMap((l) => P.parseMeetingLine(l)), ...extra,
});
const trip = (from, to, depart, arrive, days) => ({ route: "Blue Bus", from, to, depart, arrive, days });
const spring = { start: "2027-01-19", end: "2027-04-30", exclude: [["2027-03-05", "2027-03-14"]] };
const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0, 0));

const unfold = (ics) => ics.replace(/\r\n /g, "");
const vevents = (ics) => unfold(ics).split("BEGIN:VEVENT").slice(1);

test("one recurring event per meeting pattern", () => {
  const a = course("A", "HC", ["MWF 10:00am-10:50am"]);
  const b = course("B", "HC", ["TTh 01:00pm-02:30pm", "W 07:00pm-09:00pm"]);
  const plan = Planner.planWeek([a, b], [], "HC");
  const { events } = Cal.buildEvents(plan, "spring_2027");
  const classes = events.filter((e) => e.kind === "class");
  assert.equal(classes.length, 3);
  const mwf = classes.find((e) => e.uid.includes("-A-"));
  assert.deepEqual(mwf.days, ["M", "W", "F"]);
  assert.equal(mwf.title, "A: A title");
  assert.equal(mwf.location, "Room 1, Haverford");

  const ics = Cal.toICS([mwf], spring, { now: NOW });
  assert.match(unfold(ics), /RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270501T035959Z/);
});

test("same bus on several days merges; red legs are skipped", () => {
  const a = course("A", "HC", ["MWF 09:00am-09:50am"]);
  const b = course("B", "BMC", ["MWF 11:00am-11:50am"]);
  const c = course("C", "BMC", ["T 09:00am-09:50am"]);
  // 10:20 Hav→BMC arrives 10:30; no bus at all on Tuesday morning.
  const trips = [trip("HC", "BMC", 620, 630, ["M", "W", "F"]), trip("BMC", "HC", 720, 730, ["M", "W", "F"])];
  const plan = Planner.planWeek([a, b, c], trips, "HC");
  const { events, skipped } = Cal.buildEvents(plan, "spring_2027");
  const bus = events.filter((e) => e.kind === "bus");
  const out = bus.find((e) => e.title === "🚌 Blue Bus Haverford → Bryn Mawr");
  assert.deepEqual(out.days, ["M", "W", "F"]);
  assert.equal(out.start, 620);
  assert.match(out.description, /30 min to reach the stop · 30 min until class/);
  assert.ok(skipped.some((s) => s.day === "T" && s.from === "HC" && s.to === "BMC"));

  // UIDs are stable across runs.
  const again = Cal.buildEvents(plan, "spring_2027").events.map((e) => e.uid);
  assert.deepEqual(events.map((e) => e.uid), again);
  assert.equal(new Set(again).size, again.length);
});

test("first occurrence, EXDATE for break, Eastern time", () => {
  const ev = { uid: "x@bussync", kind: "class", title: "X", days: ["M", "F"], start: 600, end: 650, description: "", location: "", url: "" };
  const lines = unfold(Cal.toICS([ev], spring, { now: NOW })).split("\r\n");
  // Jan 19 2027 is a Tuesday, so the first M/F class is Friday Jan 22.
  assert.ok(lines.includes("DTSTART;TZID=America/New_York:20270122T100000"));
  assert.ok(lines.includes("DTEND;TZID=America/New_York:20270122T105000"));
  assert.ok(lines.includes("EXDATE;TZID=America/New_York:20270305T100000,20270308T100000,20270312T100000"));
  assert.ok(lines.includes("BEGIN:VTIMEZONE"));
});

test("UNTIL uses the right UTC offset in winter", () => {
  const ev = { uid: "y@bussync", kind: "class", title: "Y", days: ["F"], start: 600, end: 650, description: "", location: "", url: "" };
  const ics = unfold(Cal.toICS([ev], semesters.fall_2026, { now: NOW }));
  assert.match(ics, /UNTIL=20261212T045959Z/); // Dec 11 23:59:59 EST
});

test("text escaping, folding, CRLF", () => {
  assert.equal(Cal.escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const long = "SUMMARY:" + "🚌".repeat(40);
  const folded = Cal.fold(long);
  for (const line of folded.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(folded.replace(/\r\n /g, ""), long);

  const ev = { uid: "z@bussync", kind: "class", title: "Hello, world; ok", days: ["T"], start: 600, end: 650, description: "line1\nline2", location: "", url: "javascript:alert(1)" };
  const ics = Cal.toICS([ev], spring, { now: NOW });
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "only CRLF line endings");
  assert.match(ics, /SUMMARY:Hello\\, world\\; ok/);
  assert.match(ics, /DESCRIPTION:line1\\nline2/);
  assert.ok(!ics.includes("URL:"), "non-http URLs are dropped");
});

test("scraped text is capped", () => {
  const big = course("A", "HC", ["M 10:00am-10:50am"], { title: "x".repeat(2000) });
  const { events } = Cal.buildEvents(Planner.planWeek([big], [], ""), "spring_2027");
  assert.ok(events[0].title.length <= 500);
});

test("semester file has valid ranges", () => {
  for (const [key, s] of Object.entries(semesters)) {
    if (key.startsWith("_")) continue;
    assert.match(key, /^(fall|spring)_\d{4}$/);
    assert.ok(s.start < s.end, key);
    for (const [a, b] of s.exclude) assert.ok(s.start <= a && a <= b && b <= s.end, `${key} ${a}-${b}`);
  }
});
