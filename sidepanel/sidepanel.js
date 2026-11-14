(function () {
  const P = globalThis.BusSyncParse;
  const Planner = globalThis.BusSyncPlanner;
  const GUIDE_URL = "https://www.swarthmore.edu/tricollege-course-guide/tricollege-course-guide";

  const $cart = document.getElementById("cart");
  const $count = document.getElementById("cart-count");
  const $week = document.getElementById("week");
  const $home = document.getElementById("home");
  const $semester = document.getElementById("semester");
  const $semesterWrap = document.getElementById("semester-wrap");

  let trips = [];
  let cart = [];
  let settings = { homeCampus: "" };
  let activeSemester = ""; // chosen in the panel; not persisted

  // "spring_2027" -> "Spring 2027"
  const semesterLabel = (s) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()) : "Unknown semester");

  const label = (campus) => P.CAMPUS_LABELS[campus] || campus;
  const fmt = (m) => P.formatTime(m);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function meetingSummary(course) {
    if (course.timesText) return course.timesText;
    return "No meeting time listed";
  }

  function renderCart(plan, courses) {
    $cart.replaceChildren();
    $count.textContent = courses.length ? `(${courses.length})` : "";
    if (!courses.length) {
      $cart.append(
        el("li", { class: "empty" },
          "Use the ", el("strong", {}, "+ Add"), " buttons on the ",
          el("a", { href: GUIDE_URL, target: "_blank", rel: "noopener" }, "Tri-Co Course Guide"),
          " to add courses.")
      );
      return;
    }
    for (const c of plan.cart) {
      const others = plan.conflicts.get(c.id);
      const conflictNames = others ? [...others].map((id) => courses.find((x) => x.id === id)?.code).filter(Boolean) : [];
      const noTimes = !c.meetings.length;
      $cart.append(
        el("li", { class: "course" },
          el("div", { class: "course-main" },
            el("div", { class: "course-line" },
              conflictNames.length ? el("span", { class: "dot red", title: `Overlaps with ${conflictNames.join(", ")}` }) : null,
              el("a", { class: "code", href: c.url, target: "_blank", rel: "noopener" }, c.code),
              el("span", { class: "campus" }, label(c.campus))
            ),
            el("div", { class: "title" }, c.title),
            el("div", { class: "times" + (conflictNames.length ? " is-red" : "") }, meetingSummary(c)),
            noTimes ? el("div", { class: "note" }, "Not included in the bus plan.") : null,
            c.unparsedTimes?.length && !noTimes ? el("div", { class: "note" }, `Couldn't read: ${c.unparsedTimes.join("; ")}`) : null
          ),
          el("button", { class: "remove", type: "button", title: `Remove ${c.code}`, "aria-label": `Remove ${c.code}`, onclick: () => removeCourse(c.id) }, "Remove")
        )
      );
    }
  }

  function segmentText(seg) {
    return `${seg.route} ${fmt(seg.depart)} ${label(seg.from)} → ${fmt(seg.arrive)} ${label(seg.to)}`;
  }

  function slackText(leg) {
    const o = leg.option;
    const parts = [];
    if (leg.earliest != null) parts.push(`${o.depart - leg.earliest} min to reach the stop`);
    if (leg.latest != null) parts.push(`${leg.latest - o.arrive} min to reach class`);
    return parts.join(" · ");
  }

  function renderLeg(leg) {
    const lines = [];
    if (leg.option) {
      leg.option.segments.forEach((s, i) => lines.push(el("div", { class: "leg-trip" }, i ? "then " : "", segmentText(s))));
      lines.push(el("div", { class: "leg-sub" }, slackText(leg)));
    } else {
      const where = `${label(leg.from)} → ${label(leg.to)}`;
      if (leg.kind === "home") lines.push(el("div", { class: "leg-trip" }, `No bus home (${where}) after class`));
      else lines.push(el("div", { class: "leg-trip" }, `No bus ${where} gets you there in time`));
      const n = leg.nextAvailable;
      if (n) {
        const late = leg.latest != null ? n.arrive - leg.latest : 0;
        lines.push(el("div", { class: "leg-sub" },
          `Next: ${n.segments.map(segmentText).join(", then ")}` + (late > 0 ? ` (${late} min late)` : "")));
      }
    }
    const heading = { out: `From ${label(leg.from)}`, home: `Back to ${label(leg.to)}`, between: null }[leg.kind];
    return el("li", { class: `item leg ${leg.status}` },
      el("span", { class: `dot ${leg.status}` }),
      el("div", { class: "leg-body" }, heading ? el("div", { class: "leg-head" }, heading) : null, lines)
    );
  }

  function renderClass(item) {
    return el("li", { class: "item class" + (item.conflict ? " is-conflict" : "") },
      item.conflict ? el("span", { class: "dot red", title: "Overlaps with another class" }) : el("span", { class: "dot none" }),
      el("div", { class: "class-body" },
        el("div", { class: "class-time" + (item.conflict ? " is-red" : "") }, `${fmt(item.start)}–${fmt(item.end)}`),
        el("div", {}, el("strong", {}, item.course.code), " ", el("span", { class: "campus" }, label(item.course.campus))),
        el("div", { class: "title" }, item.course.title)
      )
    );
  }

  function renderWeek(plan) {
    $week.replaceChildren();
    for (const d of Planner.WEEKDAYS) {
      const { items } = plan.days[d];
      const list = el("ul", {});
      if (!items.length) list.append(el("li", { class: "empty" }, "No classes"));
      for (const item of items) list.append(item.type === "leg" ? renderLeg(item) : renderClass(item));
      $week.append(el("div", { class: "zebra day" }, el("h3", { class: "zebra-head" }, P.DAY_NAMES[d]), list));
    }
  }

  // Courses from different semesters never conflict, so plan one semester at a time.
  function renderSemesterPicker() {
    const semesters = [...new Set(cart.map((c) => c.semester || ""))];
    if (!semesters.includes(activeSemester)) {
      activeSemester = cart.length ? cart[cart.length - 1].semester || "" : "";
    }
    $semesterWrap.hidden = semesters.length < 2;
    $semester.replaceChildren(
      ...semesters.map((s) => {
        const n = cart.filter((c) => (c.semester || "") === s).length;
        return el("option", { value: s }, `${semesterLabel(s)} (${n})`);
      })
    );
    $semester.value = activeSemester;
  }

  function render() {
    renderSemesterPicker();
    const courses = cart.filter((c) => (c.semester || "") === activeSemester);
    const plan = Planner.planWeek(courses, trips, settings.homeCampus);
    $home.value = settings.homeCampus || "";
    renderCart(plan, courses);
    renderWeek(plan);
  }

  async function removeCourse(id) {
    const next = cart.filter((c) => c.id !== id);
    await chrome.storage.local.set({ cart: next });
  }

  $semester.addEventListener("change", () => {
    activeSemester = $semester.value;
    render();
  });

  $home.addEventListener("change", () => {
    settings = { ...settings, homeCampus: $home.value };
    chrome.storage.local.set({ settings });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.cart) {
      const prev = Array.isArray(changes.cart.oldValue) ? changes.cart.oldValue : [];
      cart = Array.isArray(changes.cart.newValue) ? changes.cart.newValue : [];
      // Jump to the semester of a course that was just added.
      const added = cart.find((c) => !prev.some((p) => p.id === c.id));
      if (added) activeSemester = added.semester || "";
    }
    if (changes.settings) settings = { homeCampus: "", ...(changes.settings.newValue || {}) };
    render();
  });

  async function init() {
    const [data, stored] = await Promise.all([
      fetch(chrome.runtime.getURL("data/buses.json")).then((r) => r.json()),
      chrome.storage.local.get(["cart", "settings"]),
    ]);
    trips = data.trips;
    cart = Array.isArray(stored.cart) ? stored.cart : [];
    settings = { homeCampus: "", ...(stored.settings || {}) };
    render();
  }

  render();
  init().catch((err) => {
    console.error(err);
    $week.prepend(el("p", { class: "note" }, "Couldn't load the bus timetable."));
  });
})();
