import { useRef, useEffect, useState } from "react";

const isTouchDevice = () =>
  typeof window !== "undefined" &&
  ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0);

/**
 * Road Dash — a 3-lane dodging game.
 * ----------------------------------------------------------------------------
 * You drive a car up an endless 3-lane road. Slower cars and rocks come at you
 * from ahead; hop left/right between the lanes to thread the gaps. The longer
 * you survive the faster the road scrolls. One crash ends the run — score is
 * the distance covered.
 *
 * Controls: hold ←/→ (or A/D) on desktop, or hold the left/right half of the
 * road on touch. The car steers continuously — you can stop part-way between
 * lanes to thread the gap between two obstacles. Collisions are real AABB
 * overlaps (so clipping an obstacle while squeezing through counts).
 *
 * Deliberately small and readable, mirroring the other games: a single portrait
 * canvas, one rAF loop, row-based spawning that always leaves at least one lane
 * open so every situation is survivable.
 *
 * GameModule contract: default-exported component, id "road-dash",
 * score = distance covered (in metres).
 */

// ---- constants --------------------------------------------------------------
const W = 500;                    // logical canvas width, px (portrait)
const H = 800;                    // logical canvas height, px
const LANES = 3;
const LANE_W = W / LANES;         // 120
const laneX = (i) => LANE_W * i + LANE_W / 2;

const CAR_W = 60, CAR_H = 100;    // player car
const CAR_Y = H - 120;            // fixed vertical position of the player
const STEER_SPEED = 320;          // px / second the car slides while steering
const EDGE_PAD = 8;               // keep the car this far off the shoulders

const START_SPEED = 200;          // px / second the road scrolls
const SPEED_RAMP = 0.05;          // extra px/s of speed per px travelled
const MAX_SPEED = 400;            // speed cap

const SPAWN_GAP = 240;            // px of travel between obstacle rows
const OBSTACLE_CAR_OWN = 110;     // how fast rival cars drive (slows approach)

const CAR_COLORS = ["#ef4444", "#f59e0b", "#a855f7", "#10b981", "#ec4899", "#64748b"];

const RED = "#ef4444";            // red cars actively change lanes like the player
const RED_COMMIT = 280;           // red cars stop weaving once this close to the player

// The only obstacle layouts we ever spawn — 5 hand-picked rows that each leave
// at least one lane open. We additionally pick rows so each open lane is within
// one lane of the previous row's open lane, so the gap is always reachable in
// time and no run is ever a dead end.
const PATTERNS = [
  { blocked: [0],    free: [1, 2] }, // left blocked
  { blocked: [2],    free: [0, 1] }, // right blocked
  { blocked: [1],    free: [0, 2] }, // middle blocked
  { blocked: [0, 1], free: [2] },    // squeeze to the right lane
  { blocked: [1, 2], free: [0] },    // squeeze to the left lane
];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default function RoadDash() {
  const canvasRef = useRef(null);
  const G = useRef(null);
  const [started, setStarted] = useState(false);
  const [touch] = useState(isTouchDevice);
  const [hud, setHud] = useState({ score: 0, best: 0, speed: 0, status: "ready" });

  // (lazily) build the game state once.
  if (!G.current) {
    let best = 0;
    try { best = Number(localStorage.getItem("rd:best")) || 0; } catch {}
    G.current = {
      carX: W / 2, keyL: false, keyR: false, ptr: 0,
      obstacles: [], lastFree: [0, 1, 2],
      traveled: 0, speed: START_SPEED, scroll: 0, sinceSpawn: 0,
      score: 0, best, status: "ready",
    };
  }

  // reset for a new round
  const reset = () => {
    const g = G.current;
    g.carX = W / 2; g.keyL = false; g.keyR = false; g.ptr = 0;
    g.obstacles = []; g.lastFree = [0, 1, 2];
    g.traveled = 0; g.speed = START_SPEED; g.scroll = 0; g.sinceSpawn = SPAWN_GAP;
    g.score = 0; g.status = "playing";
    setHud((h) => ({ ...h, score: 0, speed: 0, status: "playing" }));
  };

  const start = () => { setStarted(true); reset(); };

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = G.current;
    let raf = 0, last = performance.now();

    // ---- input -----------------------------------------------------------
    // Continuous steering instead of lane snapping: hold a direction and the car
    // slides smoothly across the road, so you can park it part-way between lanes
    // and thread the gap between two obstacles. `g.keyL/keyR` track held keys,
    // `g.ptr` (-1/0/1) the side of the road being touched; the update loop reads
    // them each frame.
    const isLeft = (k) => k === "ArrowLeft" || k === "a" || k === "A";
    const isRight = (k) => k === "ArrowRight" || k === "d" || k === "D";
    const onKey = (e) => {
      if (isLeft(e.key)) { g.keyL = true; e.preventDefault(); }
      else if (isRight(e.key)) { g.keyR = true; e.preventDefault(); }
    };
    const onKeyUp = (e) => {
      if (isLeft(e.key)) g.keyL = false;
      else if (isRight(e.key)) g.keyR = false;
    };
    // Touch / mouse: steer toward whichever side of the road is held down.
    const steerToPointer = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width * W;
      g.ptr = mx < W / 2 ? -1 : 1;
    };
    const onPointerDown = (e) => {
      if (g.status !== "playing") return;
      canvas.setPointerCapture?.(e.pointerId);
      steerToPointer(e);
    };
    const onPointerMove = (e) => { if (g.ptr) steerToPointer(e); };
    const onPointerUp = () => { g.ptr = 0; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // ---- spawning --------------------------------------------------------
    // Spawn one of the 5 fixed PATTERNS. `g.lastFree` is the set of lanes the
    // player could actually be standing in by the time this row arrives. A lane
    // is "reachable" if it's within one lane step of one of those. We only spawn
    // patterns that open at least one reachable lane, and then carry forward ONLY
    // the reachable subset of the new open lanes as the next frontier — not every
    // free lane. Carrying all free lanes (the old bug) over-counted where the
    // player could be and let the sequence chain into dead ends two lanes away.
    // With the reachable subset there's always a single-step path forward, so the
    // run is survivable forever.
    const spawnRow = () => {
      const reachable = (f) => g.lastFree.some((pf) => Math.abs(f - pf) <= 1);
      const valid = PATTERNS.filter((p) => p.free.some(reachable));
      const pat = pick(valid.length ? valid : PATTERNS);
      for (const l of pat.blocked) {
        const isCar = Math.random() < 0.6;
        g.obstacles.push(
          isCar
            ? { lane: l, type: "car", x: laneX(l), y: -CAR_H, w: CAR_W, h: CAR_H, own: OBSTACLE_CAR_OWN, color: pick(CAR_COLORS), turnIn: rand(0.4, 1.2) }
            : { lane: l, type: "rock", x: laneX(l), y: -70, w: 66, h: 64, own: 0 },
        );
      }
      // Only the open lanes the player can reach in one step become the next
      // frontier. (Fall back to all free lanes in the degenerate case where none
      // were reachable, so the frontier never goes empty.)
      const nextFree = pat.free.filter(reachable);
      g.lastFree = nextFree.length ? nextFree : pat.free;
    };

    // ---- update ----------------------------------------------------------
    const carRect = () => ({ x: g.carX - CAR_W / 2, y: CAR_Y - CAR_H / 2, w: CAR_W, h: CAR_H });
    const overlap = (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const update = (dt) => {
      if (g.status !== "playing") return;

      g.speed = Math.min(MAX_SPEED, START_SPEED + g.traveled * SPEED_RAMP);
      const d = g.speed * dt;
      g.traveled += d;
      g.scroll = (g.scroll + d) % 80;
      g.score = Math.floor(g.traveled / 40);
      if (g.score > g.best) {
        g.best = g.score;
        try { localStorage.setItem("rd:best", String(g.best)); } catch {}
      }

      // continuous steering: slide toward the held direction, clamped to the road
      const steer = (g.keyR || g.ptr > 0 ? 1 : 0) - (g.keyL || g.ptr < 0 ? 1 : 0);
      g.carX += steer * STEER_SPEED * dt;
      const minX = CAR_W / 2 + EDGE_PAD, maxX = W - CAR_W / 2 - EDGE_PAD;
      g.carX = Math.max(minX, Math.min(maxX, g.carX));

      // move obstacles: rocks travel at full road speed, cars a bit slower
      for (const o of g.obstacles) o.y += (g.speed - o.own) * dt;

      // Red cars actively change lanes like the player. While still far up the
      // road they periodically pick an adjacent lane to switch into (never one
      // that's already occupied near them, so they don't ram other obstacles),
      // then slide toward that lane's centre at their OWN horizontal speed
      // (OBSTACLE_CAR_OWN) — the same pace they drive. They lock their lane once
      // within RED_COMMIT of the player, so by the time one reaches you its
      // position is settled and readable. Their lateral speed is far below the
      // player's STEER_SPEED, so a weaving red car is always out-manoeuvrable.
      for (const o of g.obstacles) {
        if (o.type !== "car" || o.color !== RED) continue;
        o.turnIn -= dt;
        if (o.turnIn <= 0 && o.y < CAR_Y - RED_COMMIT) {
          o.turnIn = rand(0.5, 1.3);
          const options = [o.lane - 1, o.lane + 1].filter((l) => l >= 0 && l < LANES);
          const open = options.filter((l) => !g.obstacles.some(
            (b) => b !== o && b.lane === l && Math.abs(b.y - o.y) < CAR_H * 1.6));
          if (open.length && Math.random() < 0.6) o.lane = pick(open);
        }
        // ease x toward the target lane centre at the car's own speed
        const dx = laneX(o.lane) - o.x;
        const step = OBSTACLE_CAR_OWN * dt;
        o.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
      }

      // Rival cars can't drive through stationary rocks. If a rock sits ahead of
      // a car in the same lane (rocks scroll faster, so they overtake the slower
      // cars), the car brakes and queues up one body-length behind it rather than
      // clipping through. Clamping the position each frame makes the car ride down
      // at the rock's speed while they touch, then resume once the rock is clear.
      for (const o of g.obstacles) {
        if (o.type !== "car") continue;
        for (const rk of g.obstacles) {
          if (rk.type !== "rock" || rk.lane !== o.lane || rk.y > o.y) continue;
          const minY = rk.y + rk.h / 2 + o.h / 2;
          if (o.y < minY) o.y = minY;
        }
      }

      // player collision (after braking has settled the obstacle positions)
      const car = carRect();
      for (const o of g.obstacles) {
        const r = { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h };
        if (overlap(car, r)) { g.status = "over"; g.crashX = o.x; g.crashY = o.y; }
      }
      g.obstacles = g.obstacles.filter((o) => o.y < H + 100);

      // spawn rows on a fixed travel cadence
      g.sinceSpawn += d;
      if (g.sinceSpawn >= SPAWN_GAP) { g.sinceSpawn = 0; spawnRow(); }
    };

    // ---- render ----------------------------------------------------------
    const drawCar = (x, y, w, h, color, glass) => {
      const rx = x - w / 2, ry = y - h / 2;
      // body
      ctx.fillStyle = color;
      roundRect(rx, ry, w, h, 12); ctx.fill();
      // cabin / windows
      ctx.fillStyle = glass;
      roundRect(rx + w * 0.16, ry + h * 0.16, w * 0.68, h * 0.26, 6); ctx.fill();
      roundRect(rx + w * 0.16, ry + h * 0.58, w * 0.68, h * 0.24, 6); ctx.fill();
      // wheels
      ctx.fillStyle = "#0b0d12";
      ctx.fillRect(rx - 4, ry + h * 0.18, 6, h * 0.22);
      ctx.fillRect(rx + w - 2, ry + h * 0.18, 6, h * 0.22);
      ctx.fillRect(rx - 4, ry + h * 0.62, 6, h * 0.22);
      ctx.fillRect(rx + w - 2, ry + h * 0.62, 6, h * 0.22);
    };

    function roundRect(x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    const render = () => {
      // road surface
      ctx.fillStyle = "#23262e";
      ctx.fillRect(0, 0, W, H);

      // grassy shoulders
      ctx.fillStyle = "#1a2a1c";
      ctx.fillRect(0, 0, 6, H);
      ctx.fillRect(W - 6, 0, 6, H);

      // dashed lane dividers, scrolling toward the player
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let l = 1; l < LANES; l++) {
        const x = LANE_W * l - 3;
        for (let y = -80 + g.scroll; y < H; y += 80) {
          ctx.fillRect(x, y, 6, 44);
        }
      }

      // obstacles
      for (const o of g.obstacles) {
        if (o.type === "car") {
          drawCar(o.x, o.y, o.w, o.h, o.color, "rgba(180,220,255,0.5)");
        } else {
          // rock — a lumpy grey blob
          ctx.fillStyle = "#6b7280";
          ctx.beginPath();
          ctx.ellipse(o.x, o.y, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#525a66";
          ctx.beginPath();
          ctx.ellipse(o.x - 8, o.y - 6, o.w / 4, o.h / 5, 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // player car (dim it once crashed)
      ctx.globalAlpha = g.status === "over" ? 0.5 : 1;
      drawCar(g.carX, CAR_Y, CAR_W, CAR_H, "#38bdf8", "rgba(8,18,30,0.7)");
      ctx.globalAlpha = 1;

      // crash burst
      if (g.status === "over" && g.crashX != null) {
        ctx.fillStyle = "rgba(255,180,40,0.9)";
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(g.crashX + Math.cos(a) * 22, g.crashY + Math.sin(a) * 22, 7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    // ---- loop ------------------------------------------------------------
    let hudAcc = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      render();

      hudAcc += dt;
      if (hudAcc > 0.1 || g.status === "over") {
        hudAcc = 0;
        setHud({
          score: g.score, best: g.best,
          speed: Math.round(g.speed / 6), status: g.status,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [started]);

  // ---- styles -----------------------------------------------------------
  const pill = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px",
    background: "rgba(20,24,36,0.7)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999, fontSize: 13, color: "#fff",
  };
  const btn = {
    cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10,
    padding: "8px 14px", fontSize: 14, fontWeight: 600, color: "#fff",
    background: "rgba(255,255,255,0.08)",
  };
  const primary = {
    ...btn, color: "#0c0e14", border: "none",
    background: "linear-gradient(180deg,#7dd3fc,#3b82f6)",
  };

  return (
    <div style={{ background: "#0c0e14", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: W, margin: "0 auto" }}>
        <div style={{ position: "relative", width: "100%" }}>
          <canvas
            ref={canvasRef}
            style={{
              width: "100%", height: "auto", display: "block", borderRadius: 14,
              background: "#23262e", touchAction: "none", cursor: "pointer",
            }}
          />

          {/* HUD over the road */}
          <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, pointerEvents: "none" }}>
            <span style={pill}>🏁 <b>{hud.score}m</b></span>
            <span style={pill}>🚗 <b>{hud.speed}</b></span>
          </div>
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8, pointerEvents: "none" }}>
            <span style={pill}>best <b>{hud.best}m</b></span>
          </div>

          {!started && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", textAlign: "center",
              background: "rgba(8,10,16,0.84)", borderRadius: 14, color: "#fff", padding: 20,
            }}>
              <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>ARCADE</div>
              <h1 style={{ fontSize: "clamp(28px, 9vw, 40px)", margin: "4px 0 6px", fontWeight: 800 }}>Road Dash</h1>
              <p style={{ maxWidth: "min(420px, 100%)", opacity: 0.85, lineHeight: 1.5, margin: "0 0 18px" }}>
                Dodge cars and rocks on a 3-lane road. {touch ? "Hold the left or right side" : "Hold ← / → (or A / D)"} to
                steer between them. It only gets faster — how far can you get?
              </p>
              <button style={primary} onClick={start}>Start</button>
            </div>
          )}

          {hud.status === "over" && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", textAlign: "center",
              background: "rgba(8,10,16,0.86)", borderRadius: 14, color: "#fff", padding: 20,
            }}>
              <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>CRASH</div>
              <h1 style={{ fontSize: 30, margin: "4px 0 0", fontWeight: 800 }}>Game over</h1>
              <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.7, marginTop: 14 }}>DISTANCE</div>
              <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1 }}>{hud.score}m</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>best {hud.best}m</div>
              <button style={{ ...primary, marginTop: 20 }} onClick={reset}>Play again</button>
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", color: "#9aa3bd", opacity: 0.7, fontSize: 12, marginTop: 10 }}>
          {touch ? "Hold the left or right half of the road to steer between obstacles." : "Hold ← / → or A / D to steer. Squeeze between the cars and rocks."}
        </div>
      </div>
    </div>
  );
}
