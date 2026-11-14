// Pure scheduling logic: course conflicts and bus legs per weekday.
// Loaded as a classic script in the side panel and via require() in tests.
(function (root) {
  const WEEKDAYS = ["M", "T", "W", "Th", "F"];
  const GREEN_ABOVE = 7; // slack > 7 min  -> feasible
  const YELLOW_FROM = 3; // 3..7 min       -> possibly feasible; < 3 -> not feasible
  const TRANSFER_HUB = "HC";

  function statusForSlack(slack) {
    if (slack > GREEN_ABOVE) return "green";
    if (slack >= YELLOW_FROM) return "yellow";
    return "red";
  }
  const STATUS_RANK = { green: 0, yellow: 1, red: 2 };

  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  // Map courseId -> Set of courseIds it overlaps with (any shared weekday).
  function findCourseConflicts(courses) {
    const conflicts = new Map();
    for (let i = 0; i < courses.length; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        const a = courses[i];
        const b = courses[j];
        const clash = a.meetings.some((ma) => b.meetings.some((mb) => ma.day === mb.day && overlaps(ma, mb)));
        if (!clash) continue;
        if (!conflicts.has(a.id)) conflicts.set(a.id, new Set());
        if (!conflicts.has(b.id)) conflicts.set(b.id, new Set());
        conflicts.get(a.id).add(b.id);
        conflicts.get(b.id).add(a.id);
      }
    }
    return conflicts;
  }

  // Order the cart chronologically, keeping each group of mutually
  // conflicting courses next to each other.
  function orderCart(courses, conflicts) {
    const firstMeeting = (c) => {
      let best = Infinity;
      for (const m of c.meetings) {
        const idx = WEEKDAYS.indexOf(m.day);
        const key = (idx < 0 ? 9 : idx) * 1440 + m.start;
        if (key < best) best = key;
      }
      return best;
    };
    const byId = new Map(courses.map((c) => [c.id, c]));
    const seen = new Set();
    const groups = [];
    for (const c of courses) {
      if (seen.has(c.id)) continue;
      const group = [];
      const stack = [c.id];
      seen.add(c.id);
      while (stack.length) {
        const id = stack.pop();
        group.push(byId.get(id));
        for (const other of conflicts.get(id) || []) {
          if (!seen.has(other) && byId.has(other)) {
            seen.add(other);
            stack.push(other);
          }
        }
      }
      group.sort((a, b) => firstMeeting(a) - firstMeeting(b));
      groups.push(group);
    }
    groups.sort((a, b) => firstMeeting(a[0]) - firstMeeting(b[0]));
    return groups.flat();
  }

  function tripsFor(trips, day, from, to) {
    return trips.filter((t) => t.from === from && t.to === to && t.days.includes(day));
  }

  // Direct trips plus one-transfer options through the hub.
  function routeOptions(trips, day, from, to) {
    const options = tripsFor(trips, day, from, to).map((t) => ({ segments: [t], depart: t.depart, arrive: t.arrive }));
    if (from !== TRANSFER_HUB && to !== TRANSFER_HUB) {
      const first = tripsFor(trips, day, from, TRANSFER_HUB);
      const second = tripsFor(trips, day, TRANSFER_HUB, to);
      for (const a of first) {
        // Earliest connecting departure from the hub.
        let best = null;
        for (const b of second) {
          if (b.depart >= a.arrive && (!best || b.depart < best.depart)) best = b;
        }
        if (best) options.push({ segments: [a, best], depart: a.depart, arrive: best.arrive });
      }
    }
    return options;
  }

  // earliest: when you can start walking to the stop (class end), null for "from home".
  // latest: when you must be in the next class, null for "to home".
  function planLeg(trips, day, from, to, earliest, latest) {
    const options = routeOptions(trips, day, from, to);
    const evaluated = [];
    for (const o of options) {
      const before = earliest == null ? Infinity : o.depart - earliest;
      const after = latest == null ? Infinity : latest - o.arrive;
      if (before < 0 || after < 0) continue;
      const slack = Math.min(before, after);
      evaluated.push({ ...o, slack, status: statusForSlack(slack) });
    }

    const base = { from, to, earliest, latest };
    if (!evaluated.length) {
      // Nothing fits: show the next bus anyway so the student sees how late they'd be.
      let next = null;
      if (earliest != null) {
        for (const o of options) if (o.depart >= earliest && (!next || o.arrive < next.arrive)) next = o;
      } else if (latest != null) {
        for (const o of options) if (o.arrive > latest && (!next || o.arrive < next.arrive)) next = o;
      }
      return { ...base, status: "red", option: null, nextAvailable: next };
    }

    evaluated.sort((x, y) => {
      const r = STATUS_RANK[x.status] - STATUS_RANK[y.status];
      if (r) return r;
      const seg = x.segments.length - y.segments.length;
      if (seg) return seg;
      if (earliest == null) return y.depart - x.depart; // morning: leave as late as possible
      if (latest == null) return x.depart - y.depart; // evening: first bus home
      return y.slack - x.slack || x.arrive - y.arrive; // between classes: most slack
    });
    const option = evaluated[0];
    return { ...base, status: option.status, option, nextAvailable: null };
  }

  // Returns { items } where items alternate classes and legs in time order.
  function planDay(courses, day, trips, homeCampus) {
    const meetings = [];
    for (const c of courses) {
      for (const m of c.meetings) {
        if (m.day === day) meetings.push({ course: c, start: m.start, end: m.end });
      }
    }
    meetings.sort((a, b) => a.start - b.start || a.end - b.end);
    const items = [];
    if (!meetings.length) return { items };

    const first = meetings[0];
    if (homeCampus && first.course.campus !== homeCampus) {
      items.push({ type: "leg", kind: "out", ...planLeg(trips, day, homeCampus, first.course.campus, null, first.start) });
    }
    for (let i = 0; i < meetings.length; i++) {
      const m = meetings[i];
      const conflict = meetings.some((o) => o !== m && overlaps(o, m));
      items.push({ type: "class", ...m, conflict });
      const next = meetings[i + 1];
      if (!next) break;
      if (next.course.campus === m.course.campus) continue;
      if (next.start < m.end) continue; // overlapping classes: shown as a conflict, no bus to plan
      items.push({ type: "leg", kind: "between", ...planLeg(trips, day, m.course.campus, next.course.campus, m.end, next.start) });
    }
    const last = meetings.reduce((a, b) => (b.end > a.end ? b : a));
    if (homeCampus && last.course.campus !== homeCampus) {
      items.push({ type: "leg", kind: "home", ...planLeg(trips, day, last.course.campus, homeCampus, last.end, null) });
    }
    return { items };
  }

  function planWeek(courses, trips, homeCampus) {
    const conflicts = findCourseConflicts(courses);
    const days = {};
    for (const d of WEEKDAYS) days[d] = planDay(courses, d, trips, homeCampus);
    return { conflicts, days, cart: orderCart(courses, conflicts) };
  }

  const api = { WEEKDAYS, statusForSlack, findCourseConflicts, orderCart, routeOptions, planLeg, planDay, planWeek };
  root.BusSyncPlanner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
