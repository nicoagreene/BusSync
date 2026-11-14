// BusSync calendar feed: GET /cal.ics?d=<packed schedule> -> text/calendar.
// Stateless: decodes the schedule from the link, renders it, stores and logs nothing.
import Cal from "../../lib/calendar.js";
import Feed from "../../lib/feed.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'",
};

function text(body, status, extra) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra } });
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") return text("Method not allowed\n", 405, { Allow: "GET, HEAD" });
    const url = new URL(request.url);
    if (url.pathname === "/") return text("BusSync calendar feed. Add a subscription from the BusSync extension.\n", 200);
    if (url.pathname !== "/cal.ics") return text("Not found\n", 404);

    const param = url.searchParams.get("d");
    let feed;
    try {
      feed = await Feed.decodeFeed(param);
    } catch {
      return text("Invalid calendar link\n", 400);
    }
    const id = Feed.hash(param);
    const events = feed.events.map((ev, i) => ({ ...ev, uid: `bussync-${id}-${i}@bussync` }));
    const ics = Cal.toICS(events, feed.dates, { name: feed.name });
    return new Response(request.method === "HEAD" ? null : ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="bussync.ics"',
        // The link fully determines the content, so it can be cached for a long time.
        "Cache-Control": "public, max-age=604800, immutable",
        ...SECURITY_HEADERS,
      },
    });
  },
};
