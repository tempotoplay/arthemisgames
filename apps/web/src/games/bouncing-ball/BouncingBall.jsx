import { useRef, useEffect, useState } from "react";

const isTouchDevice = () =>
  typeof window !== "undefined" &&
  ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0);

/**
 * Bouncing Ball — a tiny reaction game.
 * ----------------------------------------------------------------------------
 * A ball bounces around inside a square, reflecting off the four walls. Click
 * (or tap) the ball to score: every hit flips it to a new color, kicks it off
 * in a fresh random direction, and nudges its speed up a touch — so it keeps
 * getting harder. Miss and nothing happens; the round is a 30-second sprint to
 * land as many hits as you can.
 *
 * It's deliberately small and readable: a single canvas, one rAF loop, and a
 * circle-vs-point hit test. A nice sandbox for practicing tweaks — change the
 * physics, add gravity, spawn more balls, score combos, etc.
 *
 * Slots into the games collection under the GameModule contract:
 * default-exported component, id "bouncing-ball", score = hits in the round.
 */

// ---- constants --------------------------------------------------------------
const SIZE = 520;                 // logical canvas size (square), px
const WALL = 14;                  // inner wall thickness / play-area inset
const R = 26;                     // ball radius, px
const START_SPEED = 230;          // px / second
const SPEED_STEP = 14;            // speed added per successful hit
const MAX_SPEED = 620;            // cap so it stays (barely) catchable
const ROUND_TIME = 30;            // seconds per round

// Distinct, high-contrast ball colors; a hit always picks a *different* one.
const COLORS = [
  "#ff1900", "#f97316", "#facc15", "#22c55e",
  "#06b6d4", "#3b82f6", "#000000", "#ec4899",
];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// A fresh velocity vector at the given speed, biased away from near-horizontal
// or near-vertical so the motion stays lively after a click.
function randomVelocity(speed) {
  let a;
  do {
    a = rand(0, Math.PI * 2);
  } while (Math.abs(Math.sin(2 * a)) < 0.25); // avoid axis-aligned dullness
  return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
}

export default function BouncingBall() {
  const canvasRef = useRef(null);
  const G = useRef(null);
  const [started, setStarted] = useState(false);
  const [touch] = useState(isTouchDevice);
  const [hud, setHud] = useState({
    score: 0, best: 0, time: ROUND_TIME, status: "ready",
  });

  // (lazily) build the game state once.
  if (!G.current) {
    let best = 0;
    try { best = Number(localStorage.getItem("bb:best")) || 0; } catch {}
    const v = randomVelocity(START_SPEED);
    G.current = {
      x: SIZE / 2, y: SIZE / 2, ...v, speed: START_SPEED,
      color: COLORS[0], flash: 0,
      score: 0, best, time: ROUND_TIME, status: "ready",
    };
  }

  // reset positions/score for a new round
  const reset = () => {
    const g = G.current;
    const v = randomVelocity(START_SPEED);
    g.x = SIZE / 2; g.y = SIZE / 2;
    g.vx = v.vx; g.vy = v.vy; g.speed = START_SPEED;
    g.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    g.flash = 0; g.score = 0; g.time = ROUND_TIME; g.status = "playing";
    setHud((h) => ({ ...h, score: 0, time: ROUND_TIME, status: "playing" }));
  };

  const start = () => { setStarted(true); reset(); };

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = G.current;
    let raf = 0, last = performance.now();

    const lo = WALL + R, hi = SIZE - WALL - R;

    // ---- click / tap the ball -------------------------------------------
    const onPointerDown = (e) => {
      if (g.status !== "playing") return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width * SIZE;
      const my = (e.clientY - rect.top) / rect.height * SIZE;
      if (Math.hypot(mx - g.x, my - g.y) <= R + 4) {
        // hit! new color (always different), new direction, a little faster.
        let next = g.color;
        while (next === g.color) {
          next = COLORS[Math.floor(Math.random() * COLORS.length)];
        }
        g.color = next;
        g.speed = Math.min(MAX_SPEED, g.speed + SPEED_STEP);
        const v = randomVelocity(g.speed);
        g.vx = v.vx; g.vy = v.vy;
        g.flash = 1;
        g.score += 1;
        if (g.score > g.best) {
          g.best = g.score;
          try { localStorage.setItem("bb:best", String(g.best)); } catch {}
        }
      }
    };
    canvas.addEventListener("pointerdown", onPointerDown);

    // ---- update ----------------------------------------------------------
    const update = (dt) => {
      if (g.status !== "playing") return;

      g.x += g.vx * dt;
      g.y += g.vy * dt;

      // reflect off the four inner walls, clamping back inside.
      if (g.x < lo) { g.x = lo; g.vx = Math.abs(g.vx); }
      else if (g.x > hi) { g.x = hi; g.vx = -Math.abs(g.vx); }
      if (g.y < lo) { g.y = lo; g.vy = Math.abs(g.vy); }
      else if (g.y > hi) { g.y = hi; g.vy = -Math.abs(g.vy); }

      if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 4);

      g.time -= dt;
      if (g.time <= 0) {
        g.time = 0;
        g.status = "over";
      }
    };

    // ---- render ----------------------------------------------------------
    const render = () => {
      // backdrop
      ctx.fillStyle = "#10131a";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // the square arena
      ctx.fillStyle = "#171b26";
      ctx.fillRect(WALL, WALL, SIZE - 2 * WALL, SIZE - 2 * WALL);
      ctx.strokeStyle = "#39405a";
      ctx.lineWidth = 3;
      ctx.strokeRect(WALL + 1.5, WALL + 1.5, SIZE - 2 * WALL - 3, SIZE - 2 * WALL - 3);

      // the ball — with a click "flash" halo and a soft highlight.
      if (g.flash > 0) {
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.3 * g.flash;
        ctx.beginPath();
        ctx.arc(g.x, g.y, R + 14 * g.flash, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(g.x - R * 0.32, g.y - R * 0.32, R * 0.3, 0, Math.PI * 2);
      ctx.fill();
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
          time: Math.ceil(g.time), status: g.status,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
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
    ...btn, color: "#10131a", border: "none",
    background: "linear-gradient(180deg,#7dd3fc,#3b82f6)",
  };

  return (
    <div style={{ background: "#0c0e14", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: SIZE, margin: "0 auto" }}>
        <div style={{ position: "relative", width: "100%" }}>
          <canvas
            ref={canvasRef}
            style={{
              width: "100%", height: "auto", display: "block", borderRadius: 14,
              background: "#10131a", touchAction: "none", cursor: "pointer",
            }}
          />

          {/* HUD over the arena */}
          <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, pointerEvents: "none" }}>
            <span style={pill}>🎯 <b>{hud.score}</b></span>
            <span style={pill}>⏱ <b>{hud.time}s</b></span>
          </div>
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8, pointerEvents: "none" }}>
            <span style={pill}>best <b>{hud.best}</b></span>
          </div>

          {!started && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", textAlign: "center",
              background: "rgba(8,10,16,0.84)", borderRadius: 14, color: "#fff", padding: 20,
            }}>
              <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>REACTION</div>
              <h1 style={{ fontSize: "clamp(28px, 9vw, 40px)", margin: "4px 0 6px", fontWeight: 800 }}>Bouncing Ball</h1>
              <p style={{ maxWidth: "min(420px, 100%)", opacity: 0.85, lineHeight: 1.5, margin: "0 0 18px" }}>
                A ball bounces around the square. {touch ? "Tap" : "Click"} it to score —
                each hit changes its color, sends it off a new way, and speeds it up.
                Land as many as you can in {ROUND_TIME} seconds.
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
              <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>TIME</div>
              <h1 style={{ fontSize: 30, margin: "4px 0 0", fontWeight: 800 }}>Round over</h1>
              <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.7, marginTop: 14 }}>HITS</div>
              <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1 }}>{hud.score}</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>best {hud.best}</div>
              <button style={{ ...primary, marginTop: 20 }} onClick={reset}>Play again</button>
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", color: "#9aa3bd", opacity: 0.7, fontSize: 12, marginTop: 10 }}>
          {touch ? "Tap the moving ball to change its color and direction." : "Click the moving ball to change its color and direction."}
        </div>
      </div>
    </div>
  );
}
