# Arthemis Games

A small collection of client-side browser games (canvas + React), published as
one static site. Two games so far: **Carousel Duck Shoot** and **Lost Fox**.

🎮 **Live:** https://tempotoplay.github.io/arthemisgames/

## Layout

```
apps/web/                     the published site (Vite + React + React Router)
  src/
    main.tsx                  app entry — BrowserRouter wired to the Pages base path
    App.tsx                   routes: gallery at /, games at /games/:id
    registry.ts               the game registry — metadata + code-split loaders
    pages/                    Gallery + GamePage
    games/
      carousel-duck-shoot/    one folder per game
      lost-fox/
origin/                       frozen reference seed (DESIGN.md + prototypes) — do not edit
  leaderboard/                deferred Cloudflare Worker backend (not deployed in v1)
.github/workflows/deploy.yml  builds apps/web and deploys to GitHub Pages
```

`origin/` is the original design brief and standalone prototypes; see
[origin/DESIGN.md](origin/DESIGN.md). The site under `apps/web/` is ported from
it, preserving each game's mechanics, scoring, and visuals.

## Run it locally

All commands run from `apps/web`. Install once:

```bash
cd apps/web
npm install
```

**Dev server** (hot reload — use this while editing):

```bash
npm run dev
```

Then open `http://localhost:5173/arthemisgames/`. The `/arthemisgames/` path
matters — the base path is applied in dev too, so `http://localhost:5173/` on its
own shows nothing. Edits to the games or any source reload instantly. Stop with
`Ctrl-C`. The two games are also reachable directly at
`…/arthemisgames/games/carousel-duck-shoot` and `…/games/lost-fox`.

**Preview the production build** (closest mirror of what GitHub Pages serves —
minified, code-split, real asset URLs):

```bash
npm run build      # outputs to apps/web/dist
npm run preview    # serves the build at http://localhost:4173/arthemisgames/
```

Use the dev server day to day; reach for `preview` to sanity-check the real build
before relying on a deploy.

**Other scripts:** `npm run typecheck` runs `tsc --noEmit`.

Each game is lazy-loaded (code-split), so its JS is only fetched when its route
is visited. Adding a game = drop a folder under `apps/web/src/games/` and add one
entry to [apps/web/src/registry.ts](apps/web/src/registry.ts).

### Mobile touch input

Both games auto-detect touch and overlay control buttons on mobile. On desktop,
keyboard input (Carousel: A/D + Space; Lost Fox: W/A/D + C) works as intended.

- **Carousel Duck Shoot:** Left / Right aim buttons (3rds of the width), Fire button
  (bottom center). Tap to fire or tap-and-hold left/right to sweep aim.
- **Lost Fox:** Turn Left / Right buttons (bottom corners), Walk Forward button (top
  center). Navigation is touch-friendly and works in landscape or portrait.

Touch zones are visible as light overlays when a game is running on a touch device.

## Deploying

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which builds `apps/web` and publishes it to GitHub Pages. After the first-time
setup below, **every push to `main` redeploys automatically** — no manual steps.

### First-time setup (once per repo)

1. **Give your push credential the Workflows permission.** Pushing
   `.github/workflows/*` requires it. For a fine-grained PAT: *GitHub Settings →
   Developer settings → Personal access tokens → Fine-grained tokens →* your
   token *→ Repository permissions → Workflows → Read and write*. (Editing a
   fine-grained token's permissions keeps the same token value, so your existing
   Git credential keeps working.) Classic PATs need the `workflow` scope.
2. **Enable Pages.** Repo *Settings → Pages → Build and deployment →
   Source = **GitHub Actions***. (Requires repo admin.) Until this is set, the
   workflow's build passes but its deploy step fails with
   *"Ensure GitHub Pages has been enabled."*
3. **Re-run the deploy** if the first run failed before Pages was enabled:
   *Actions tab → the failed run → "Re-run failed jobs"* — or just push again.

The site is served from a project subpath (`/arthemisgames/`); Vite's `base` in
[apps/web/vite.config.ts](apps/web/vite.config.ts) handles that. For a custom
domain (served from `/`), build with `BASE_PATH=/ npm run build`.

## Leaderboard (deferred)

v1 is static-only: high scores live per-browser in `localStorage`, so every game
has a working "best score" with no backend. The Cloudflare Worker in
`origin/leaderboard/` is kept as reference for a future shared online board.
