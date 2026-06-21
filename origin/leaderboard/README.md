# Games leaderboard (Cloudflare Worker + Durable Object)

A shared, ranked leaderboard for the games collection. One Worker, one Durable
Object **per game id** — single-threaded and strongly consistent, so ranks are
always correct and concurrent submits can't race. SQLite-backed, which is the
Durable Object variant that runs on Cloudflare's **free** plan.

## Endpoints

```
GET  /api/leaderboard/:gameId?period=all|daily&limit=20   -> { top: [{name, score, ts}] }
POST /api/leaderboard/:gameId   body { name, score }       -> { ok, rank, qualified, top }
```

## Deploy

```bash
cd leaderboard
npm i -D wrangler
npx wrangler deploy        # first run opens a browser to log in to Cloudflare
```

Wrangler prints a URL like `https://games-leaderboard.<your-subdomain>.workers.dev`.
Test it:

```bash
curl -s "https://games-leaderboard.<you>.workers.dev/api/leaderboard/carousel-duck-shoot"
# -> {"top":[]}
```

## Point the games at it

- **Standalone game / index.html:** set `LEADERBOARD_API` near the top of
  `CarouselDuckShoot.jsx` to your Worker URL, then regenerate `index.html`.
  Leaving it `""` keeps scores local to the browser (still fully functional).
- **Vite collection:** use `leaderboardClient.js` and set an env var:

  ```
  # .env
  VITE_LEADERBOARD_API=https://games-leaderboard.<you>.workers.dev
  ```

  ```js
  import { getTop, submitScore } from "./leaderboardClient.js";
  const { rank, top } = await submitScore("carousel-duck-shoot", { name, score });
  ```

## Adding a game

1. Pick a stable `gameId` (lowercase, `[A-Za-z0-9_-]`).
2. Add a plausibility cap in `MAX_SCORE` in `src/index.ts` (rejects absurd scores).
3. Call `submitScore(gameId, {...})` / `getTop(gameId)` from the game. Each id
   gets its own isolated board automatically.

## Anti-abuse and the trust model

A purely client-side game can't *prove* its score. Built-in guards deter casual
abuse only:

- **Per-game score cap** (`MAX_SCORE`) — rejects implausible values.
- **Per-IP rate limit** — one submission per ~1.5s.
- **Name sanitisation** — control chars stripped, length clamped.
- Optionally set `ALLOWED_ORIGIN` in `wrangler.toml` to restrict browser writes
  to your published site.

For a board you can actually trust, make the server authoritative: have the
client send a seed plus the recorded input stream, and re-simulate the run
inside `submit()` to compute the score server-side. That's the right upgrade
once a board is competitive enough to be worth cheating.

## Notes

- Daily boards reset by UTC date (`period=daily`); the `all` board is permanent.
- Boards keep the top 100; clients are served the top 20 by default.
- Storage uses the Durable Object key-value API, which works on SQLite-backed
  classes — no schema to manage.
