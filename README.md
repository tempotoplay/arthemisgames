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

## Develop

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to apps/web/dist
npm run preview    # serve the production build
```

Each game is lazy-loaded (code-split), so its JS is only fetched when its route
is visited. Adding a game = drop a folder under `apps/web/src/games/` and add one
entry to [apps/web/src/registry.ts](apps/web/src/registry.ts).

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the site and
publishes it to GitHub Pages. **One-time setup:** in the repo,
*Settings → Pages → Build and deployment → Source = GitHub Actions*.

The site is served from a project subpath (`/arthemisgames/`); Vite's `base` in
[apps/web/vite.config.ts](apps/web/vite.config.ts) handles that. For a custom
domain (served from `/`), build with `BASE_PATH=/ npm run build`.

## Leaderboard (deferred)

v1 is static-only: high scores live per-browser in `localStorage`, so every game
has a working "best score" with no backend. The Cloudflare Worker in
`origin/leaderboard/` is kept as reference for a future shared online board.
