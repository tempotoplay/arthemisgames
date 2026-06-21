/**
 * Leaderboard client for the games collection.
 *
 * Set VITE_LEADERBOARD_API to your Worker URL (e.g. in a .env file:
 *   VITE_LEADERBOARD_API=https://games-leaderboard.<you>.workers.dev
 * ). If it's unset, the client transparently falls back to a per-browser
 * board stored in localStorage, so every game still has a working "high
 * scores" panel offline / in local dev.
 *
 * Entry shape: { name: string, score: number, ts: number }
 */

const API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_LEADERBOARD_API) ||
  "";

const BOARD_CAP = 100;

const local = {
  key: (gameId, period) => `lb:${gameId}:${period}`,
  read(gameId, period) {
    try {
      return JSON.parse(localStorage.getItem(this.key(gameId, period)) || "[]");
    } catch {
      return [];
    }
  },
  write(gameId, period, list) {
    try {
      localStorage.setItem(
        this.key(gameId, period),
        JSON.stringify(list.slice(0, BOARD_CAP)),
      );
    } catch {
      /* storage unavailable — ignore */
    }
  },
};

/** Fetch the top scores for a game. */
export async function getTop(gameId, { period = "all", limit = 20 } = {}) {
  if (API_BASE) {
    const res = await fetch(
      `${API_BASE}/api/leaderboard/${encodeURIComponent(gameId)}?period=${period}&limit=${limit}`,
    );
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    const data = await res.json();
    return data.top || [];
  }
  return local.read(gameId, period).slice(0, limit);
}

/** Submit a score. Returns { rank, qualified, top }. */
export async function submitScore(gameId, { name, score }) {
  if (API_BASE) {
    const res = await fetch(`${API_BASE}/api/leaderboard/${encodeURIComponent(gameId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score }),
    });
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    return res.json();
  }
  // local fallback
  const list = local.read(gameId, "all");
  const entry = { name: String(name).slice(0, 16), score: Math.floor(score), ts: Date.now() };
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const trimmed = list.slice(0, BOARD_CAP);
  local.write(gameId, "all", trimmed);
  const rank = trimmed.indexOf(entry) + 1;
  return { ok: true, rank: rank || null, qualified: rank > 0, top: trimmed.slice(0, 20) };
}
