import type { ComponentType, LazyExoticComponent } from "react";
import { lazy } from "react";

/**
 * The game contract (see origin/DESIGN.md). Each game is a code-split module:
 * its component is only fetched when the game route is actually visited.
 */
export interface GameMeta {
  /** stable, lowercase [a-z0-9-]; also the leaderboard key. */
  id: string;
  title: string;
  description: string;
  /** accent color used for the gallery card. */
  accent: string;
}

export interface GameModule extends GameMeta {
  Component: LazyExoticComponent<ComponentType>;
}

export const games: GameModule[] = [
  {
    id: "carousel-duck-shoot",
    title: "Carousel Duck Shoot",
    description:
      "A side-view carnival gallery. Lead the ducks riding the turntable — bullets are real projectiles with gravity, not hitscan.",
    accent: "#ffc94d",
    Component: lazy(
      () => import("./games/carousel-duck-shoot/CarouselDuckShoot.jsx"),
    ),
  },
  {
    id: "lost-fox",
    title: "Lost Fox",
    description:
      "An orienteering puzzle. Dropped at a random spot and heading, match your rotating egocentric view to the north-up map and find the treasure.",
    accent: "#7fd1a8",
    Component: lazy(() => import("./games/lost-fox/LostFox.jsx")),
  },
];

export const gameById = (id: string | undefined) =>
  games.find((g) => g.id === id);
