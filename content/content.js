// Adds "+ Add" buttons to each course row on Tri-Co Course Guide search results.
(function () {
  const P = globalThis.BusSyncParse;
  const BUTTON_CLASS = "bussync-add";

  function linkParams(row) {
    const a = row.querySelector('a[href*="course-details?"]');
    if (!a) return null;
    return new URL(a.href, location.href).searchParams;
  }

  // Value of the <dd> following a <dt> whose text starts with label.
  function field(row, label) {
    for (const dt of row.querySelectorAll("dt")) {
      if (dt.textContent.trim().toLowerCase().startsWith(label.toLowerCase())) {
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName !== "DD") dd = dd.nextElementSibling;
        return dd;
      }
    }
    return null;
  }

  function parseCourseRow(row) {
    const params = linkParams(row);
    if (!params || !params.get("id")) return null;
    const campus = P.COLLEGE_PARAM_TO_CAMPUS[params.get("college")];
    if (!campus) return null;

    const idDd = field(row, "ID");
    const titleDd = field(row, "Title");
    const timesDd = field(row, "Days and Times");
    const locationDd = field(row, "Location");

    const lines = timesDd
      ? [...timesDd.querySelectorAll("div")].map((d) => d.textContent.trim()).filter(Boolean)
      : [];
    if (timesDd && !lines.length && timesDd.textContent.trim()) lines.push(timesDd.textContent.trim());
    const meetings = [];
    const unparsed = [];
    for (const line of lines) {
      const parsed = P.parseMeetingLine(line);
      if (parsed) meetings.push(...parsed);
      else unparsed.push(line);
    }

    return {
      id: params.get("id"),
      code: idDd ? idDd.textContent.trim() : params.get("id"),
      title: titleDd ? titleDd.textContent.trim() : "",
      campus,
      semester: params.get("semester") || "",
      location: locationDd ? locationDd.textContent.trim() : "",
      timesText: lines.join("; "),
      unparsedTimes: unparsed,
      meetings,
      url: new URL(row.querySelector('a[href*="course-details?"]').href, location.href).href,
    };
  }

  async function getCart() {
    const { cart } = await chrome.storage.local.get("cart");
    return Array.isArray(cart) ? cart : [];
  }

  function setButtonState(btn, inCart) {
    btn.textContent = inCart ? "✓ Added" : "+ Add";
    btn.classList.toggle("is-added", inCart);
    btn.title = inCart ? "In your BusSync cart (click to remove)" : "Add to BusSync cart";
  }

  // Cart writes are queued so rapid clicks don't overwrite each other.
  let writeQueue = Promise.resolve();
  function toggle(course) {
    writeQueue = writeQueue
      .then(async () => {
        const cart = await getCart();
        const idx = cart.findIndex((c) => c.id === course.id);
        if (idx >= 0) cart.splice(idx, 1);
        else cart.push(course);
        await chrome.storage.local.set({ cart });
      })
      .catch(console.error);
    return writeQueue;
  }

  async function inject() {
    const rows = document.querySelectorAll("#block-tricocourseguidesearchresults table tbody tr");
    if (!rows.length) return;
    const ids = new Set((await getCart()).map((c) => c.id));
    for (const row of rows) {
      if (row.querySelector("." + BUTTON_CLASS)) continue;
      const course = parseCourseRow(row);
      if (!course) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BUTTON_CLASS;
      btn.dataset.courseId = course.id;
      setButtonState(btn, ids.has(course.id));
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggle(course);
      });
      const cell = row.querySelector("td") || row;
      cell.appendChild(btn);
    }
  }

  async function syncButtons() {
    const ids = new Set((await getCart()).map((c) => c.id));
    for (const btn of document.querySelectorAll("." + BUTTON_CLASS)) {
      setButtonState(btn, ids.has(btn.dataset.courseId));
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.cart) syncButtons();
  });

  inject();
  const results = document.getElementById("block-tricocourseguidesearchresults") || document.body;
  new MutationObserver(() => inject()).observe(results, { childList: true, subtree: true });
})();
