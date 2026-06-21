# Design brief — Games collection (origin seed)

This `origin/` directory is **frozen reference material**: the working prototypes
and the decisions that seed the project. Treat it as read-only. The real project
is built *around* it, porting from it — never editing it in place.

## Goal

A personal collection of small, client-side browser games (canvas + React),
published as one site. Two games so far: **Carousel Duck Shoot** and **Lost Fox**.

## Stack & hosting (decided)

- **Build:** Vite + React + TypeScript.
- **Routing:** React Router. Gallery at `/`; each game lazy-loaded at `/games/:id`
  (code-split, loaded only when visited).
- **Repo:** **public** GitHub repo. (Client games ship their JS to the browser
  anyway, so public source exposes nothing extra — provided no secret lives in it,
  and none does.)
- **Hosting:** static delivery. Cloudflare Pages is the recommended host (fast CDN,
  per-PR previews); GitHub Pages also works now that the repo is public. Either
  serves the built static site for free.

## v1 posture: static-only, no backend

The first version ships **static, with no leaderboard service**. High scores still
work per-browser: `leaderboardClient.js` (and each game) falls back to
`localStorage` when no API URL is configured, so every game has a working "best
score" with zero backend.

The leaderboard backend (`leaderboard/`) is kept in this seed as **deferred**
reference for later. When you want a shared online board, deploy that Worker and
set `VITE_LEADERBOARD_API` — no game code changes (the client swaps from the
localStorage fallback to the online board automatically).

## Game contract

Each game is a module exposing metadata plus a code-split component:

- `id` — stable, lowercase `[a-z0-9-]`; also the (future) leaderboard key.
- `title`, `description`, optional `thumbnail`.
- `load` — dynamic import of a default-exported React component.

Games render inside a shared frame. Adding a game = drop a folder under
`apps/web/src/games/` + one registry entry.

## Carousel Duck Shoot  (id: `carousel-duck-shoot`)

- Side-view carousel: near ducks large and sweep left, far ducks small and sweep
  right, wrapping around the ends; empty poles keep riding once cleared.
- Iron sights move horizontally (A/D), Space fires, R reloads, P pauses.
- Bullets are **physics projectiles** (launch velocity + gravity), so you must
  lead a moving duck — not hitscan.
- **No respawn.** The round ends when all 9 ducks are down.
- **Score = points from ducks − 20 per bullet fired** (floored at 0). Duck = 100,
  gold = 300. Future leaderboard cap `MAX_SCORE = 3000`.
- Source: `CarouselDuckShoot.jsx`; standalone preview `index.html`.

## Lost Fox  (id: `lost-fox`)  — self-localization / orienteering

- Procedurally generated flat world (seeded; default a per-day seed for a fair
  shared daily map later). You're placed at a random position AND random heading.
- **Egocentric view** (left): top-down but rotated so your heading is always UP,
  with a limited sight radius (fog beyond it). Distant landmarks show as rim
  indicators at their true bearing, so you can take bearings to triangulate.
- **Reference map** (right): north-up, all landmarks + the treasure marked — but
  not you. The challenge is overlaying your rotated, partial view onto it.
- **Recovering north is core.** Hint ladder: hardest = point landmarks only
  (recover heading from the geometry between them); medium = the map's river
  carries a flow arrow (a built-in "direction marker"); assisted = a compass in
  the egocentric view gives heading for free. The compass goes in the *view*, not
  the map (the map is north-up by convention; the unknown is *your* heading).
- Controls: W/↑ walk, A D / ← → turn, C toggles compass. Click the map to plant a
  flag where you think you are — within tolerance gives a bonus and reveals you.
- **Win** by reaching the treasure. **Score = energy left** when you arrive
  (+400 flag bonus). A direct solver beats a wanderer; running out of energy ends
  the run.
- Source: `LostFox.jsx`; standalone preview `lost-fox.html`.

## Conventions

- TypeScript strict. No secrets in client code.
- The standalone `*.html` wrappers are **previews only** (CDN React + in-browser
  Babel, pinned to the classic JSX runtime so they run from `file://`). The real
  build is Vite, which compiles ahead of time — no in-browser Babel.
- When porting a game, **preserve mechanics, scoring, physics, and visuals
  exactly** — only adding types (and, later, swapping the inlined leaderboard
  client for the shared module) should change.
