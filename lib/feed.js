// Packs calendar events into a URL-safe string and back, for the stateless subscription feed.
// The extension encodes; the Cloudflare Worker (worker/) decodes, validates and serves the .ics.
// Nothing is stored server-side: the whole schedule lives in the link.
// Loaded as a classic script in the side panel, via require() in tests, and bundled into the Worker.
(function (root) {
  const VERSION = 1;
  const LIMITS = {
    param: 8000, // chars of the ?d= value
    inflated: 64 * 1024, // bytes after decompression (zip-bomb guard)
    events: 80,
    text: 500,
    name: 80,
    excludes: 20,
    spanDays: 200, // max length of a semester or break range
  };
  const DAY_RE = /^(?:M|T|W|Th|F|Sa|Su)+$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // --- base64url over bytes ---
  function toB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64url(str) {
    if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("bad encoding");
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Inflate, giving up as soon as the output passes `max` bytes.
  async function inflate(bytes, max) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new Error("payload too large");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  // events: from BusSyncCalendar.buildEvents; dates: { start, end, exclude }; name: calendar title.
  async function encodeFeed(events, dates, name) {
    const payload = {
      v: VERSION,
      n: name,
      d: [dates.start, dates.end, dates.exclude || []],
      e: events.map((ev) => [ev.kind === "bus" ? 1 : 0, ev.title, ev.location || "", ev.description || "", ev.url || "", ev.days.join(""), ev.start, ev.end]),
    };
    return toB64url(await deflate(new TextEncoder().encode(JSON.stringify(payload))));
  }

  const isMinute = (n) => Number.isInteger(n) && n >= 0 && n <= 1440;
  const str = (s, max) => {
    if (typeof s !== "string") throw new Error("expected text");
    return s.length > max ? s.slice(0, max) : s;
  };
  const dayDiff = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  function checkRange(a, b) {
    if (!DATE_RE.test(a) || !DATE_RE.test(b) || Number.isNaN(Date.parse(a)) || Number.isNaN(Date.parse(b))) throw new Error("bad date");
    const span = dayDiff(a, b);
    if (span < 0 || span > LIMITS.spanDays) throw new Error("bad date range");
  }

  // Strictly validates untrusted input; returns { name, dates, events } or throws.
  async function decodeFeed(param) {
    if (typeof param !== "string" || !param || param.length > LIMITS.param) throw new Error("missing or oversized feed");
    const json = new TextDecoder().decode(await inflate(fromB64url(param), LIMITS.inflated));
    const p = JSON.parse(json);
    if (!p || p.v !== VERSION || !Array.isArray(p.d) || !Array.isArray(p.e)) throw new Error("unsupported feed");

    const [start, end, exclude] = p.d;
    checkRange(start, end);
    if (!Array.isArray(exclude) || exclude.length > LIMITS.excludes) throw new Error("bad breaks");
    for (const r of exclude) {
      if (!Array.isArray(r) || r.length !== 2) throw new Error("bad break");
      checkRange(r[0], r[1]);
    }
    if (p.e.length > LIMITS.events) throw new Error("too many events");

    const events = p.e.map((row) => {
      if (!Array.isArray(row) || row.length !== 8) throw new Error("bad event");
      const [kind, title, location, description, url, days, s, e] = row;
      if (kind !== 0 && kind !== 1) throw new Error("bad kind");
      if (typeof days !== "string" || !DAY_RE.test(days)) throw new Error("bad days");
      if (!isMinute(s) || !isMinute(e) || e <= s) throw new Error("bad time");
      const link = str(url, LIMITS.text);
      return {
        kind: kind ? "bus" : "class",
        title: str(title, LIMITS.text),
        location: str(location, LIMITS.text),
        description: str(description, LIMITS.text),
        url: /^https:\/\//.test(link) ? link : "",
        days: days.match(/Th|Sa|Su|M|T|W|F/g),
        start: s,
        end: e,
      };
    });
    return { name: str(p.n || "BusSync", LIMITS.name), dates: { start, end, exclude }, events };
  }

  // Short, stable hash for event UIDs (FNV-1a).
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
  }

  // Link Google Calendar opens with an "Add this calendar?" prompt.
  function googleSubscribeUrl(feedUrl) {
    return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https:/, "webcal:"))}`;
  }

  const api = { VERSION, LIMITS, encodeFeed, decodeFeed, hash, googleSubscribeUrl };
  root.BusSyncFeed = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
