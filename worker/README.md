# BusSync calendar feed (Cloudflare Worker)

Serves `GET /cal.ics?d=<packed schedule>` as an iCalendar feed so Google, Apple, and Outlook can subscribe to a separate "BusSync" calendar.

It is stateless. The whole schedule is encoded in the link (see `../lib/feed.js`), and the Worker stores and logs nothing. Anyone with a link can read that schedule, so treat links as private.

## Deploy

```sh
cd worker
npm install
npx wrangler login     # opens a browser; sign in to your Cloudflare account
npx wrangler deploy    # prints https://bussync-cal.<your-subdomain>.workers.dev
```

The first deploy asks you to pick a `workers.dev` subdomain if you don't have one yet.

Then paste the printed URL into `FEED_ORIGIN` at the top of `../sidepanel/sidepanel.js` and reload the extension.

## Local testing

```sh
npx wrangler dev   # http://localhost:8787
```

Tests for the Worker run with the rest of the suite (`npm test` in the repo root).
