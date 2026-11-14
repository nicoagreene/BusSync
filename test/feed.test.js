const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const zlib = require("node:zlib");
const P = require("../lib/parse.js");
const Planner = require("../lib/planner.js");
const Cal = require("../lib/calendar.js");
const Feed = require("../lib/feed.js");
const semesters = require("../data/semesters.json");
const { trips } = require(path.join(__dirname, "..", "data", "buses.json"));

const course = (id, campus, line, title) => ({
  id, code: id, title: title || `Intro to ${id}`, campus, location: "Room 101", url: `https://www.swarthmore.edu/course-details?id=${id}`,
  meetings: P.parseMeetingLine(line),
});
const raw = (obj) => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj))).toString("base64url");

function sampleExport() {
  const courses = [
    course("CMSC105", "HC", "MWF 09:00am-09:50am"),
    course("PHIL101", "BMC", "MWF 11:00am-12:30pm"),
    course("HIST200", "SC", "TTh 01:15pm-02:45pm"),
    course("ECON101", "HC", "TTh 10:00am-11:30am"),
    course("BIOL201", "BMC", "M 02:00pm-05:00pm"),
    course("MATH215", "HC", "MWF 01:30pm-02:20pm"),
  ];
  const plan = Planner.planWeek(courses, trips, "HC");
  return { events: Cal.buildEvents(plan, "spring_2027").events, dates: semesters.spring_2027 };
}

test("encode/decode round trip keeps every event", async () => {
  const { events, dates } = sampleExport();
  const d = await Feed.encodeFeed(events, dates, "BusSync – Spring 2027");
  assert.match(d, /^[A-Za-z0-9_-]+$/);
  assert.ok(d.length < 4000, `link payload is ${d.length} chars`);
  const out = await Feed.decodeFeed(d);
  assert.equal(out.name, "BusSync – Spring 2027");
  assert.deepEqual(out.dates, dates);
  assert.equal(out.events.length, events.length);
  for (let i = 0; i < events.length; i++) {
    const { uid, ...rest } = events[i];
    assert.deepEqual(out.events[i], rest);
  }
});

test("decode rejects bad or hostile input", async () => {
  const ok = { v: 1, n: "x", d: ["2027-01-19", "2027-04-30", []], e: [[0, "A", "", "", "", "MWF", 600, 650]] };
  await Feed.decodeFeed(raw(ok)); // sanity
  const bad = [
    "",
    "not base64!",
    "A".repeat(Feed.LIMITS.param + 1),
    raw({ ...ok, v: 2 }),
    raw({ ...ok, d: ["2027-01-19", "2030-01-01", []] }), // span too long
    raw({ ...ok, d: ["2027-01-19", "2027-04-30", [["2027-02-01", "2029-01-01"]]] }),
    raw({ ...ok, e: [[0, "A", "", "", "", "MXF", 600, 650]] }),
    raw({ ...ok, e: [[0, "A", "", "", "", "M", 650, 600]] }),
    raw({ ...ok, e: [[2, "A", "", "", "", "M", 600, 650]] }),
    raw({ ...ok, e: Array(Feed.LIMITS.events + 1).fill(ok.e[0]) }),
    zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 32)).toString("base64url"), // zip bomb
  ];
  for (const d of bad) await assert.rejects(Feed.decodeFeed(d), `should reject ${d.slice(0, 40)}`);
});

test("decode drops non-https links and clips long text", async () => {
  const d = raw({ v: 1, n: "x", d: ["2027-01-19", "2027-04-30", []], e: [[0, "T".repeat(5000), "", "", "javascript:alert(1)", "Th", 600, 650]] });
  const { events } = await Feed.decodeFeed(d);
  assert.equal(events[0].url, "");
  assert.equal(events[0].title.length, Feed.LIMITS.text);
  assert.deepEqual(events[0].days, ["Th"]);
});

test("Google subscribe link uses webcal", () => {
  const u = Feed.googleSubscribeUrl("https://bussync-cal.example.workers.dev/cal.ics?d=abc");
  assert.equal(u, "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fbussync-cal.example.workers.dev%2Fcal.ics%3Fd%3Dabc");
});

test("worker serves the feed and rejects junk", async () => {
  const { default: worker } = await import("../worker/src/index.js");
  const { events, dates } = sampleExport();
  const d = await Feed.encodeFeed(events, dates, "BusSync – Spring 2027");

  const res = await worker.fetch(new Request(`https://w.example/cal.ics?d=${d}`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/calendar/);
  const ics = await res.text();
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, events.length);
  assert.match(ics, /X-WR-CALNAME:BusSync – Spring 2027/);
  const uids = ics.match(/^UID:.*$/gm);
  assert.equal(new Set(uids).size, uids.length);

  assert.equal((await worker.fetch(new Request("https://w.example/cal.ics?d=garbage"))).status, 400);
  assert.equal((await worker.fetch(new Request("https://w.example/cal.ics"))).status, 400);
  assert.equal((await worker.fetch(new Request("https://w.example/other"))).status, 404);
  assert.equal((await worker.fetch(new Request("https://w.example/cal.ics", { method: "POST" }))).status, 405);
});
