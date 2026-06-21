/**
 * Games leaderboard — one Cloudflare Worker, one Durable Object per game id.
 *
 * The Durable Object is the authority for each game's board: it is
 * single-threaded and strongly consistent, so ranks are always correct and
 * concurrent submissions can't race. Routing the request by game id
 * (`idFromName(gameId)`) gives every game its own isolated, serialized board
 * for free.
 *
 *   GET  /api/leaderboard/:gameId?period=all|daily&limit=20
 *          -> { top: Entry[] }
 *   POST /api/leaderboard/:gameId   body { name, score }
 *          -> { ok, rank, qualified, top }
 *
 * TRUST MODEL
 * -----------
 * A client-side game cannot prove its score, so these guards only deter casual
 * abuse: a per-game plausibility cap (MAX_SCORE), a per-IP rate limit, and name
 * sanitisation. For a board you can actually trust, make the server
 * authoritative: have the client send a seed + the recorded input stream and
 * re-simulate the run here, computing the score server-side. That validation
 * would live in `submit()` below, replacing the trust-the-client path.
 */

import { DurableObject } from "cloudflare:workers";

export interface Env {
  LEADERBOARD: DurableObjectNamespace<Leaderboard>;
  // optional: lock browser writes to one origin, e.g. "https://games.example.com"
  ALLOWED_ORIGIN?: string;
}

const BOARD_SIZE = 100;               // entries kept per board
const TOP_RETURNED = 20;              // entries returned to clients
const NAME_MAX = 16;
const MIN_SUBMIT_INTERVAL_MS = 1500;  // per-IP throttle
const DEFAULT_MAX_SCORE = 1_000_000;

// per-game plausibility caps — reject anything above. Tune as games are added.
const MAX_SCORE: Record<string, number> = {
  "carousel-duck-shoot": 3000,
};

const GAME_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Entry = { name: string; score: number; ts: number };

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(error: string, status: number, env: Env): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(req.url);
    const match = url.pathname.match(/^\/api\/leaderboard\/([^/]+)$/);
    if (!match) return jsonError("not_found", 404, env);

    const gameId = decodeURIComponent(match[1]);
    if (!GAME_ID_RE.test(gameId)) return jsonError("bad_game_id", 400, env);

    // forward to the per-game Durable Object, carrying the caller IP + game id
    const headers = new Headers(req.headers);
    headers.set("x-client-ip", req.headers.get("cf-connecting-ip") || "0.0.0.0");
    headers.set("x-game-id", gameId);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    const fwd = new Request(req.url, { method: req.method, headers, body });

    const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName(gameId));
    const res = await stub.fetch(fwd);

    // attach CORS to whatever the DO returned
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(env))) out.headers.set(k, v);
    return out;
  },
};

export class Leaderboard extends DurableObject<Env> {
  // in-memory per-IP throttle; resets if the DO is evicted, which is fine
  private rate = new Map<string, number>();

  private dayBucket(ts: number): string {
    return "d:" + new Date(ts).toISOString().slice(0, 10); // d:YYYY-MM-DD (UTC)
  }

  private async board(period: string): Promise<Entry[]> {
    return (await this.ctx.storage.get<Entry[]>("b:" + period)) ?? [];
  }

  private async insert(period: string, entry: Entry): Promise<number> {
    const list = await this.board(period);
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.ts - b.ts); // higher score wins; earlier breaks ties
    const trimmed = list.slice(0, BOARD_SIZE);
    await this.ctx.storage.put("b:" + period, trimmed);
    const rank = trimmed.indexOf(entry) + 1; // identity survives sort/slice
    return rank; // 0 == didn't make the board
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const gameId = req.headers.get("x-game-id") || "";

    if (req.method === "GET") {
      const period =
        url.searchParams.get("period") === "daily" ? this.dayBucket(Date.now()) : "all";
      const limit = Math.min(
        BOARD_SIZE,
        Math.max(1, Number(url.searchParams.get("limit")) || TOP_RETURNED),
      );
      const list = await this.board(period);
      return Response.json({ top: list.slice(0, limit) });
    }

    if (req.method === "POST") {
      const ip = req.headers.get("x-client-ip") || "0.0.0.0";
      const now = Date.now();
      if (now - (this.rate.get(ip) || 0) < MIN_SUBMIT_INTERVAL_MS) {
        return Response.json({ error: "rate_limited" }, { status: 429 });
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "bad_json" }, { status: 400 });
      }
      const b = body as { name?: unknown; score?: unknown };

      const name = sanitizeName(b.name);
      const score = Math.floor(Number(b.score));
      const cap = MAX_SCORE[gameId] ?? DEFAULT_MAX_SCORE;
      if (!name) return Response.json({ error: "bad_name" }, { status: 400 });
      if (!Number.isFinite(score) || score < 0 || score > cap) {
        return Response.json({ error: "bad_score" }, { status: 400 });
      }

      this.rate.set(ip, now);
      const entry: Entry = { name, score, ts: now };

      const rank = await this.insert("all", entry);
      await this.insert(this.dayBucket(now), entry); // also feed the daily board

      const top = (await this.board("all")).slice(0, TOP_RETURNED);
      return Response.json({ ok: true, rank: rank || null, qualified: rank > 0, top });
    }

    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "") // strip control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}
