const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const P = require("../lib/parse.js");
const Planner = require("../lib/planner.js");
const { trips } = require(path.join(__dirname, "..", "data", "buses.json"));

const t = (s) => P.parseClock(s);
const course = (id, campus, line) => ({ id, code: id, title: id, campus, meetings: line ? P.parseMeetingLine(line) : [] });

test("parseDays handles guide variants", () => {
  assert.deepEqual(P.parseDays("MWF"), ["M", "W", "F"]);
  assert.deepEqual(P.parseDays("TTh"), ["T", "Th"]);
  assert.deepEqual(P.parseDays("TTH"), ["T", "Th"]);
  assert.deepEqual(P.parseDays("TTHTH"), ["T", "Th"]);
  assert.deepEqual(P.parseDays("MTH"), ["M", "Th"]);
});

test("parseMeetingLine", () => {
  assert.deepEqual(P.parseMeetingLine("MWF 02:10pm-03:00pm"), [
    { day: "M", start: 850, end: 900 },
    { day: "W", start: 850, end: 900 },
    { day: "F", start: 850, end: 900 },
  ]);
  assert.equal(P.parseMeetingLine("TBA"), null);
  assert.equal(P.formatTime(t("12:05pm")), "12:05p");
});

test("course conflicts are detected and grouped together in the cart", () => {
  const a = course("A", "HC", "MWF 10:00am-10:50am");
  const b = course("B", "HC", "TTh 09:00am-10:20am");
  const c = course("C", "BMC", "W 10:30am-12:00pm");
  const conflicts = Planner.findCourseConflicts([a, b, c]);
  assert.deepEqual([...conflicts.get("A")], ["C"]);
  assert.ok(!conflicts.has("B"));
  const order = Planner.orderCart([b, c, a], conflicts).map((x) => x.id);
  assert.ok(Math.abs(order.indexOf("A") - order.indexOf("C")) === 1, `A and C adjacent in ${order}`);
});

test("slack thresholds", () => {
  assert.equal(Planner.statusForSlack(10), "green");
  assert.equal(Planner.statusForSlack(9), "yellow");
  assert.equal(Planner.statusForSlack(5), "yellow");
  assert.equal(Planner.statusForSlack(4), "red");
});

test("Monday HC 10:00-10:20 then BMC 11:00: Blue Bus 10:50a (from HC) is not enough, 10:30a is", () => {
  // HC->BMC Monday: 10:30a->10:45a and 10:50a->11:00a.
  const leg = Planner.planLeg(trips, "M", "HC", "BMC", t("10:20am"), t("11:00am"));
  assert.equal(leg.option.depart, t("10:30am"));
  assert.equal(leg.option.slack, 10);
  assert.equal(leg.status, "green");
});

test("no bus fits -> red with the next bus shown", () => {
  // Class ends 10:50 at HC, next class 11:00 at BMC: 10:50 bus arrives 11:00, slack 0 -> red.
  const leg = Planner.planLeg(trips, "M", "HC", "BMC", t("10:50am"), t("11:00am"));
  assert.equal(leg.status, "red");
  const leg2 = Planner.planLeg(trips, "M", "HC", "BMC", t("10:55am"), t("11:00am"));
  assert.equal(leg2.status, "red");
  assert.equal(leg2.option, null);
  assert.ok(leg2.nextAvailable);
});

test("planDay builds home legs and between-class legs", () => {
  const swat = course("SWAT1", "SC", "MWF 10:30am-11:20am");
  const hav = course("HAV1", "HC", "MWF 01:30pm-02:20pm");
  const { items } = Planner.planDay([swat, hav], "M", trips, "BMC");
  const kinds = items.map((i) => (i.type === "leg" ? `leg:${i.kind}` : `class:${i.course.id}`));
  assert.deepEqual(kinds, ["leg:out", "class:SWAT1", "leg:between", "class:HAV1", "leg:home"]);
  const out = items[0];
  assert.equal(out.option.segments[0].from, "BMC");
  assert.ok(out.option.arrive <= t("10:30am"));
});

test("same-campus classes need no bus; TBA courses are ignored", () => {
  const a = course("A", "HC", "M 09:00am-09:50am");
  const b = course("B", "HC", "M 10:00am-10:50am");
  const tba = course("TBA", "SC", null);
  const { items } = Planner.planDay([a, b, tba], "M", trips, "HC");
  assert.deepEqual(items.map((i) => i.type), ["class", "class"]);
});

test("BMC->SC can use a transfer through HC", () => {
  const opts = Planner.routeOptions(trips, "T", "BMC", "SC");
  assert.ok(opts.some((o) => o.segments.length === 2 && o.segments[0].to === "HC"));
  assert.ok(opts.some((o) => o.segments.length === 1));
});

test("overlapping classes on different campuses get no bus leg between them", () => {
  const a = course("A", "HC", "M 10:00am-11:00am");
  const b = course("B", "SC", "M 10:30am-11:30am");
  const { items } = Planner.planDay([a, b], "M", trips, "");
  assert.deepEqual(items.map((i) => i.type), ["class", "class"]);
  assert.ok(items.every((i) => i.conflict));
});
