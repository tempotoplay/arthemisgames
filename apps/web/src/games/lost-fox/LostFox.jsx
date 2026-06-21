import { useRef, useEffect, useState } from "react";
import { attachTouchInput, drawTouchZones } from "../touch-input";

/**
 * Lost Fox — a self-localization (orienteering) game.
 * ----------------------------------------------------------------------------
 * You're dropped on a procedurally generated map at a random position AND a
 * random heading. You can SEE only a limited patch around you (an egocentric,
 * top-down view that rotates so your heading always points UP), but you also
 * hold the full map (north-up, side panel) with every landmark and the treasure
 * marked — except YOU. The whole game is the orienteer's move: match the
 * landmarks you can see to the marked map, recover where you are *and which way
 * you're facing*, then walk to a spot you already knew.
 *
 * Recovering north is core. The map's river carries a flow arrow (a built-in
 * "direction marker"); turning the compass on (Assisted) hands you heading for
 * free. Score = energy left when you reach the treasure, so a confident, direct
 * solver beats a wanderer. Plant a flag where you think you are for a bonus.
 *
 * Slots into the games collection under the same GameModule contract:
 * default-exported component, id "lost-fox", score = remaining energy (+ flag).
 */

// ---- world constants --------------------------------------------------------
const WORLD = 2400;               // square world, units 0..WORLD on both axes
const SIGHT = 200;                // sight radius (world units) for ground detail
const MOVE_SPEED = 150;           // units / second
const TURN_RATE = 2.3;            // radians / second
const BUDGET_MULT = 1.7;          // energy budget = start→treasure distance × this
const WIN_RADIUS = 30;            // reach the treasure within this
const FLAG_TOL = WORLD * 0.06;    // how close a planted flag must be to count
const FLAG_BONUS = 400;

// view (egocentric) canvas
const VW = 560, VH = 560, VCX = VW / 2, VCY = VH / 2 + 16;
const VIEW_R = 252;               // sight circle radius in px
const SCALE = VIEW_R / SIGHT;     // world units -> px in the view
const RIM_R = 244;                // rim-indicator ring radius in px

// map canvas
const MW = 340, MH = 340, MPAD = 18;
const MINNER = MW - 2 * MPAD;

const LANDMARKS = ["lake", "forest", "tower", "rocks", "hill"];
const LM_LABEL = { lake: "Lake", forest: "Forest", tower: "Tower", rocks: "Rocks", hill: "Hill" };
const LM_RADIUS = { lake: 150, forest: 120, tower: 42, rocks: 78, hill: 132 };

// ---- seeded RNG -------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const todaySeed = () => {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

// ---- world generation -------------------------------------------------------
function genWorld(seed) {
  const rng = mulberry32(seed >>> 0);
  const rand = (lo, hi) => lo + rng() * (hi - lo);
  const lo = WORLD * 0.13, hi = WORLD * 0.87;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // landmarks with minimum spacing
  const landmarks = [];
  for (const type of LANDMARKS) {
    let p, tries = 0;
    do {
      p = { type, x: rand(lo, hi), y: rand(lo, hi), r: LM_RADIUS[type] };
      tries++;
    } while (tries < 80 && landmarks.some((q) => dist(p, q) < WORLD * 0.24));
    landmarks.push(p);
  }

  // a meandering river across the world (oriented feature)
  const a = rand(0, Math.PI * 2);
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const perp = { x: -d.y, y: d.x };
  const c = { x: WORLD / 2, y: WORLD / 2 };
  const half = WORLD * 0.72;
  const ph1 = rand(0, 6.28), ph2 = rand(0, 6.28), amp = WORLD * 0.07;
  const river = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const along = (t - 0.5) * 2 * half;
    const m = Math.sin(t * 6.28 + ph1) * amp + Math.sin(t * 12.5 + ph2) * amp * 0.4;
    const x = c.x + d.x * along + perp.x * m;
    const y = c.y + d.y * along + perp.y * m;
    river.push({ x: Math.max(40, Math.min(WORLD - 40, x)), y: Math.max(40, Math.min(WORLD - 40, y)) });
  }
  const flow = { x: river[river.length - 1].x - river[0].x, y: river[river.length - 1].y - river[0].y };

  // treasure away from landmarks
  let treasure, tries = 0;
  do {
    treasure = { x: rand(WORLD * 0.16, WORLD * 0.84), y: rand(WORLD * 0.16, WORLD * 0.84) };
    tries++;
  } while (tries < 120 && landmarks.some((q) => dist(treasure, q) < q.r + 90));

  // start: far from the treasure, not on a landmark
  let start, h, tries2 = 0;
  do {
    start = { x: rand(lo, hi), y: rand(lo, hi) };
    tries2++;
  } while (
    tries2 < 200 &&
    (dist(start, treasure) < WORLD * 0.45 ||
      landmarks.some((q) => dist(start, q) < q.r + 60))
  );
  h = rand(0, Math.PI * 2);

  return { seed, landmarks, river, flow, treasure, start, heading: h };
}

// ---- shared landmark icon (drawn the same in both views) --------------------
function drawLandmark(ctx, type, x, y, r, label) {
  ctx.save();
  ctx.translate(x, y);
  if (type === "lake") {
    ctx.fillStyle = "#2f6fd0";
    ctx.strokeStyle = "#1e4f9e";
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.72, 0.4, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.2, r * 0.4, r * 0.22, 0.4, 0, Math.PI * 2); ctx.fill();
  } else if (type === "forest") {
    for (const [dx, dy, s] of [[-0.45, 0.2, 0.7], [0.45, 0.25, 0.7], [0, -0.35, 1], [-0.2, -0.05, 0.85], [0.25, -0.1, 0.85]]) {
      ctx.fillStyle = "#256d2f";
      ctx.beginPath();
      ctx.moveTo(dx * r, dy * r - r * 0.7 * s);
      ctx.lineTo(dx * r - r * 0.42 * s, dy * r + r * 0.25 * s);
      ctx.lineTo(dx * r + r * 0.42 * s, dy * r + r * 0.25 * s);
      ctx.closePath(); ctx.fill();
    }
  } else if (type === "tower") {
    ctx.fillStyle = "#4b5563";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath(); ctx.rect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill();
  } else if (type === "rocks") {
    ctx.strokeStyle = "#5b6470";
    ctx.lineWidth = Math.max(1, r * 0.08);
    for (const [dx, dy, s] of [[-0.35, 0.1, 0.7], [0.3, 0.25, 0.6], [0.05, -0.25, 0.85]]) {
      ctx.fillStyle = "#9aa4b2";
      ctx.beginPath(); ctx.arc(dx * r, dy * r, r * 0.5 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  } else if (type === "hill") {
    for (const [rr, col] of [[1, "#cdaa7d"], [0.66, "#bb9466"], [0.34, "#a87f50"]]) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, r * rr, r * rr * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  if (label) {
    ctx.save();
    ctx.fillStyle = "#3a3326";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + r + 13);
    ctx.restore();
  }
}

function drawTreasure(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#8a5a14";
  ctx.beginPath(); ctx.rect(-r, -r * 0.55, r * 2, r * 1.25); ctx.fill();
  ctx.fillStyle = "#f3a712";
  ctx.beginPath(); ctx.rect(-r, -r * 0.55, r * 2, r * 0.5); ctx.fill();
  ctx.strokeStyle = "#5b3a0d"; ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath(); ctx.rect(-r, -r * 0.55, r * 2, r * 1.25); ctx.stroke();
  ctx.fillStyle = "#5b3a0d";
  ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export default function LostFox() {
  const viewRef = useRef(null);
  const mapRef = useRef(null);
  const G = useRef(null);
  const [seed, setSeed] = useState(() => todaySeed());
  const [started, setStarted] = useState(false);
  const [compass, setCompass] = useState(true);
  const compassRef = useRef(true);
  const [hud, setHud] = useState({
    energyPct: 100, used: 0, status: "playing", score: 0, best: 0,
    flagResult: "", revealed: false,
  });

  useEffect(() => { compassRef.current = compass; }, [compass]);

  // (re)build the world whenever the seed changes
  if (!G.current || G.current.world.seed !== seed) {
    const world = genWorld(seed);
    const budget = Math.hypot(world.start.x - world.treasure.x, world.start.y - world.treasure.y) * BUDGET_MULT;
    let best = 0;
    try { best = Number(localStorage.getItem("lf:best")) || 0; } catch {}
    G.current = {
      world, budget,
      px: world.start.x, py: world.start.y, phi: world.heading,
      energy: budget,
      keys: { f: false, l: false, r: false },
      status: "playing", score: 0, best,
      guess: null, flagLocked: false, flagResult: "", revealed: false,
    };
  }

  useEffect(() => {
    const isTouchDevice = () => "ontouchstart" in window;
    const view = viewRef.current, map = mapRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const [c, w, h] of [[view, VW, VH], [map, MW, MH]]) {
      c.width = w * dpr; c.height = h * dpr;
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const vctx = view.getContext("2d");
    const mctx = map.getContext("2d");
    const g = G.current;
    let raf = 0, last = performance.now();

    // ---- input -----------------------------------------------------------
    const onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (["w", "arrowup"].includes(k)) g.keys.f = true;
      else if (["a", "arrowleft"].includes(k)) g.keys.l = true;
      else if (["d", "arrowright"].includes(k)) g.keys.r = true;
      else if (k === "c") setCompass((v) => !v);
      else if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {}
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    };
    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (["w", "arrowup"].includes(k)) g.keys.f = false;
      else if (["a", "arrowleft"].includes(k)) g.keys.l = false;
      else if (["d", "arrowright"].includes(k)) g.keys.r = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- touch input -------------------------------------------------------
    let cleanupTouch = () => {};

    if (isTouchDevice() && view) {
      const touchZones = [
        { name: "←", keyName: "l", x: 0, y: VH - 60, w: 60, h: 60 },
        { name: "→", keyName: "r", x: VW - 60, y: VH - 60, w: 60, h: 60 },
        { name: "↑", keyName: "f", x: 30, y: 0, w: VW - 60, h: 60 },
      ];
      cleanupTouch = attachTouchInput({
        canvas: view,
        zones: touchZones,
        onZoneChange: (update) => Object.assign(g.keys, update),
      });
    }


    // click the map to set a position guess
    const onMapClick = (e) => {
      if (g.status !== "playing" || g.flagLocked) return;
      const rect = map.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width * MW;
      const fy = (e.clientY - rect.top) / rect.height * MH;
      const wx = ((fx - MPAD) / MINNER) * WORLD;
      const wy = WORLD - ((fy - MPAD) / MINNER) * WORLD;
      g.guess = { x: Math.max(0, Math.min(WORLD, wx)), y: Math.max(0, Math.min(WORLD, wy)) };
    };
    map.addEventListener("click", onMapClick);

    // ---- world<->screen transforms ---------------------------------------
    const toView = (wx, wy) => {
      const de = wx - g.px, dn = wy - g.py;
      const s = Math.sin(g.phi), c = Math.cos(g.phi);
      const fwd = de * s + dn * c;     // along heading
      const rgt = de * c - dn * s;     // to the right
      return { x: VCX + rgt * SCALE, y: VCY - fwd * SCALE, fwd, rgt };
    };
    const toMap = (wx, wy) => ({
      x: MPAD + (wx / WORLD) * MINNER,
      y: MPAD + ((WORLD - wy) / WORLD) * MINNER,
    });

    // ---- update -----------------------------------------------------------
    const update = (dt) => {
      if (g.status !== "playing") return;
      const turn = (g.keys.r ? 1 : 0) - (g.keys.l ? 1 : 0);
      g.phi += turn * TURN_RATE * dt;
      if (g.keys.f && g.energy > 0) {
        const step = MOVE_SPEED * dt;
        g.px += Math.sin(g.phi) * step;
        g.py += Math.cos(g.phi) * step;
        g.px = Math.max(0, Math.min(WORLD, g.px));
        g.py = Math.max(0, Math.min(WORLD, g.py));
        g.energy = Math.max(0, g.energy - step);
      }
      const dT = Math.hypot(g.px - g.world.treasure.x, g.py - g.world.treasure.y);
      if (dT < WIN_RADIUS) {
        g.status = "won";
        g.score = Math.floor(g.energy) + (g.flagResult === "good" ? FLAG_BONUS : 0);
        if (g.score > g.best) { g.best = g.score; try { localStorage.setItem("lf:best", String(g.best)); } catch {} }
      } else if (g.energy <= 0) {
        g.status = "lost"; g.score = 0;
      }
    };

    // ---- render: egocentric view -----------------------------------------
    const renderView = () => {
      vctx.clearRect(0, 0, VW, VH);
      // backdrop
      vctx.fillStyle = "#1a241c";
      vctx.fillRect(0, 0, VW, VH);

      vctx.save();
      vctx.beginPath(); vctx.arc(VCX, VCY, VIEW_R, 0, Math.PI * 2); vctx.clip();
      vctx.fillStyle = "#3f6b3c";
      vctx.fillRect(0, 0, VW, VH);

      // ground texture: a jittered grid of tufts within sight, transformed
      const g0 = 56;
      const minE = g.px - SIGHT, maxE = g.px + SIGHT, minN = g.py - SIGHT, maxN = g.py + SIGHT;
      for (let gx = Math.floor(minE / g0) * g0; gx <= maxE; gx += g0) {
        for (let gy = Math.floor(minN / g0) * g0; gy <= maxN; gy += g0) {
          const hsh = Math.sin(gx * 0.13 + gy * 0.27) * 43758.5453;
          const jx = (hsh - Math.floor(hsh) - 0.5) * g0 * 0.6;
          const jy = (Math.sin(gx * 0.31 + gy * 0.11) * 0.5) * g0 * 0.6;
          const p = toView(gx + jx, gy + jy);
          vctx.fillStyle = (hsh % 1 + 1) % 1 > 0.5 ? "#4a7a44" : "#356235";
          vctx.beginPath(); vctx.arc(p.x, p.y, 3, 0, Math.PI * 2); vctx.fill();
        }
      }

      // river (drawn fully; fog fades the far parts)
      vctx.strokeStyle = "#2f6fd0";
      vctx.lineWidth = 22 * SCALE;
      vctx.lineJoin = "round"; vctx.lineCap = "round";
      vctx.beginPath();
      g.world.river.forEach((pt, i) => {
        const p = toView(pt.x, pt.y);
        i === 0 ? vctx.moveTo(p.x, p.y) : vctx.lineTo(p.x, p.y);
      });
      vctx.stroke();

      // landmarks within sight: full icon at true position
      for (const lm of g.world.landmarks) {
        const p = toView(lm.x, lm.y);
        if (p.fwd * p.fwd + p.rgt * p.rgt < SIGHT * SIGHT) {
          drawLandmark(vctx, lm.type, p.x, p.y, lm.r * SCALE);
        }
      }

      // treasure appears when close
      const dT = Math.hypot(g.px - g.world.treasure.x, g.py - g.world.treasure.y);
      if (dT < SIGHT) {
        const p = toView(g.world.treasure.x, g.world.treasure.y);
        drawTreasure(vctx, p.x, p.y, 16);
      }
      vctx.restore();

      // fog: darken toward the sight edge
      const fog = vctx.createRadialGradient(VCX, VCY, VIEW_R * 0.6, VCX, VCY, VIEW_R);
      fog.addColorStop(0, "rgba(15,22,17,0)");
      fog.addColorStop(1, "rgba(12,16,18,0.92)");
      vctx.save();
      vctx.beginPath(); vctx.arc(VCX, VCY, VIEW_R, 0, Math.PI * 2); vctx.clip();
      vctx.fillStyle = fog; vctx.fillRect(0, 0, VW, VH);
      vctx.restore();

      // sight ring
      vctx.strokeStyle = "rgba(255,255,255,0.12)";
      vctx.lineWidth = 2;
      vctx.beginPath(); vctx.arc(VCX, VCY, VIEW_R, 0, Math.PI * 2); vctx.stroke();

      // rim indicators: distant landmarks visible "over the horizon" by bearing
      for (const lm of g.world.landmarks) {
        const de = lm.x - g.px, dn = lm.y - g.py;
        const dd = Math.hypot(de, dn);
        if (dd < SIGHT) continue;
        const beta = Math.atan2(de * Math.cos(g.phi) - dn * Math.sin(g.phi),
          de * Math.sin(g.phi) + dn * Math.cos(g.phi)); // rel. bearing from forward
        const rx = VCX + Math.sin(beta) * RIM_R;
        const ry = VCY - Math.cos(beta) * RIM_R;
        const dim = Math.max(0.45, 1 - (dd - SIGHT) / (WORLD * 0.9));
        vctx.globalAlpha = dim;
        drawLandmark(vctx, lm.type, rx, ry, 11, compassRef.current ? LM_LABEL[lm.type] : "");
        vctx.globalAlpha = 1;
      }

      // compass (assist): where is North relative to forward
      if (compassRef.current) {
        const bn = -g.phi;
        const nx = VCX + Math.sin(bn) * (RIM_R - 14);
        const ny = VCY - Math.cos(bn) * (RIM_R - 14);
        vctx.fillStyle = "#ef4444";
        vctx.beginPath();
        vctx.moveTo(nx + Math.sin(bn) * 12, ny - Math.cos(bn) * 12);
        vctx.lineTo(nx + Math.cos(bn) * 7, ny + Math.sin(bn) * 7);
        vctx.lineTo(nx - Math.cos(bn) * 7, ny - Math.sin(bn) * 7);
        vctx.closePath(); vctx.fill();
        vctx.fillStyle = "#fff";
        vctx.font = "700 14px system-ui, sans-serif";
        vctx.textAlign = "center"; vctx.textBaseline = "middle";
        vctx.fillText("N", VCX + Math.sin(bn) * (RIM_R - 32), VCY - Math.cos(bn) * (RIM_R - 32));
      }

      // the fox (you): an arrow pointing up = your heading
      vctx.save();
      vctx.translate(VCX, VCY);
      vctx.fillStyle = "#f97316";
      vctx.beginPath();
      vctx.moveTo(0, -13); vctx.lineTo(9, 10); vctx.lineTo(0, 5); vctx.lineTo(-9, 10);
      vctx.closePath(); vctx.fill();
      vctx.fillStyle = "#fff7ed";
      vctx.beginPath(); vctx.arc(0, -4, 2.4, 0, Math.PI * 2); vctx.fill();
      vctx.restore();
    };

    // ---- render: north-up reference map ----------------------------------
    const renderMap = () => {
      mctx.clearRect(0, 0, MW, MH);
      mctx.fillStyle = "#efe6cf";
      mctx.fillRect(0, 0, MW, MH);
      // grid
      mctx.strokeStyle = "rgba(120,100,60,0.18)";
      mctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const t = MPAD + (i / 6) * MINNER;
        mctx.beginPath(); mctx.moveTo(t, MPAD); mctx.lineTo(t, MPAD + MINNER); mctx.stroke();
        mctx.beginPath(); mctx.moveTo(MPAD, t); mctx.lineTo(MPAD + MINNER, t); mctx.stroke();
      }
      mctx.strokeStyle = "rgba(90,70,40,0.5)";
      mctx.lineWidth = 2;
      mctx.strokeRect(MPAD, MPAD, MINNER, MINNER);

      // river + flow arrow (the built-in direction marker)
      mctx.strokeStyle = "#3b82f6";
      mctx.lineWidth = 4; mctx.lineJoin = "round"; mctx.lineCap = "round";
      mctx.beginPath();
      g.world.river.forEach((pt, i) => {
        const p = toMap(pt.x, pt.y);
        i === 0 ? mctx.moveTo(p.x, p.y) : mctx.lineTo(p.x, p.y);
      });
      mctx.stroke();
      const mid = g.world.river[Math.floor(g.world.river.length / 2)];
      const mp = toMap(mid.x, mid.y);
      const fa = Math.atan2(-g.world.flow.y, g.world.flow.x); // flip y for screen
      mctx.save(); mctx.translate(mp.x, mp.y); mctx.rotate(fa);
      mctx.fillStyle = "#1d4ed8";
      mctx.beginPath(); mctx.moveTo(11, 0); mctx.lineTo(-3, -6); mctx.lineTo(-3, 6); mctx.closePath(); mctx.fill();
      mctx.restore();

      // landmarks
      for (const lm of g.world.landmarks) {
        const p = toMap(lm.x, lm.y);
        const r = Math.max(8, Math.min(16, lm.r * (MINNER / WORLD)));
        drawLandmark(mctx, lm.type, p.x, p.y, r, compassRef.current ? LM_LABEL[lm.type] : "");
      }

      // treasure (always marked)
      const tp = toMap(g.world.treasure.x, g.world.treasure.y);
      mctx.strokeStyle = "#b45309"; mctx.lineWidth = 3;
      mctx.beginPath();
      mctx.moveTo(tp.x - 7, tp.y - 7); mctx.lineTo(tp.x + 7, tp.y + 7);
      mctx.moveTo(tp.x + 7, tp.y - 7); mctx.lineTo(tp.x - 7, tp.y + 7);
      mctx.stroke();
      drawTreasure(mctx, tp.x, tp.y - 16, 7);

      // your guess flag
      if (g.guess) {
        const gp = toMap(g.guess.x, g.guess.y);
        mctx.strokeStyle = "#111"; mctx.lineWidth = 2;
        mctx.beginPath(); mctx.moveTo(gp.x, gp.y); mctx.lineTo(gp.x, gp.y - 18); mctx.stroke();
        mctx.fillStyle = g.flagResult === "good" ? "#16a34a" : "#dc2626";
        mctx.beginPath(); mctx.moveTo(gp.x, gp.y - 18); mctx.lineTo(gp.x + 13, gp.y - 14); mctx.lineTo(gp.x, gp.y - 10); mctx.closePath(); mctx.fill();
      }

      // reveal your true position once a flag lands (assist)
      if (g.revealed) {
        const pp = toMap(g.px, g.py);
        mctx.save(); mctx.translate(pp.x, pp.y); mctx.rotate(Math.atan2(Math.sin(g.phi), Math.cos(g.phi)));
        mctx.strokeStyle = "#f97316"; mctx.lineWidth = 2;
        mctx.beginPath(); mctx.moveTo(0, 0); mctx.lineTo(0, -16); mctx.stroke();
        mctx.fillStyle = "#f97316";
        mctx.beginPath(); mctx.arc(0, 0, 5, 0, Math.PI * 2); mctx.fill();
        mctx.restore();
      }

      // compass rose (decorative; map is north-up)
      mctx.fillStyle = "#5b4a2a";
      mctx.font = "700 12px system-ui, sans-serif";
      mctx.textAlign = "center"; mctx.textBaseline = "middle";
      mctx.fillText("N", MW - 22, 16);
      mctx.strokeStyle = "#5b4a2a"; mctx.lineWidth = 1.5;
      mctx.beginPath(); mctx.moveTo(MW - 22, 22); mctx.lineTo(MW - 22, 34); mctx.stroke();
    };

    // ---- loop -------------------------------------------------------------
    let hudAcc = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (started) update(dt);
      renderView();
      renderMap();

      // Draw touch zones if on a touch device
      if (isTouchDevice()) {
        const touchZones = [
          { name: "←", keyName: "l", x: 0, y: VH - 60, w: 60, h: 60 },
          { name: "→", keyName: "r", x: VW - 60, y: VH - 60, w: 60, h: 60 },
          { name: "↑", keyName: "f", x: 30, y: 0, w: VW - 60, h: 60 },
        ];
        drawTouchZones(vctx, touchZones, { filled: true, alpha: 0.1 });
      }

      hudAcc += dt;
      if (hudAcc > 0.1) {
        hudAcc = 0;
        setHud({
          energyPct: Math.round((g.energy / g.budget) * 100),
          used: Math.round(g.budget - g.energy),
          status: g.status, score: g.score, best: g.best,
          flagResult: g.flagResult, revealed: g.revealed,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cleanupTouch();
      map.removeEventListener("click", onMapClick);
    };
  }, [seed, started]);

  const plantFlag = () => {
    const g = G.current;
    if (!g.guess || g.flagLocked || g.status !== "playing") return;
    const err = Math.hypot(g.guess.x - g.px, g.guess.y - g.py);
    if (err < FLAG_TOL) {
      g.flagResult = "good"; g.flagLocked = true; g.revealed = true;
    } else {
      g.flagResult = `off by ${Math.round(err)}`;
    }
    setHud((h) => ({ ...h, flagResult: g.flagResult, revealed: g.revealed }));
  };

  const newMap = (s) => {
    setHud((h) => ({ ...h, status: "playing", score: 0, flagResult: "", revealed: false }));
    setStarted(true);
    setSeed(s);
  };

  // ---- styles -----------------------------------------------------------
  const pill = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px",
    background: "rgba(20,28,22,0.55)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999, fontSize: 13, color: "#fff",
  };
  const btn = {
    cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10,
    padding: "8px 14px", fontSize: 14, fontWeight: 600, color: "#fff",
    background: "rgba(255,255,255,0.08)",
  };
  const primary = {
    ...btn, color: "#14241c", border: "none",
    background: "linear-gradient(180deg,#9ae6b4,#48bb78)",
  };

  return (
    <div style={{ background: "#0f1713", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 940, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "center", flexDirection: window.innerWidth < 768 ? "column" : "row" }}>
          {/* egocentric view */}
          <div style={{ position: "relative", width: VW, maxWidth: "100%", flexShrink: 0 }}>
            <canvas ref={viewRef} style={{ width: "100%", height: "auto", display: "block", borderRadius: 14, background: "#0f1713" }} />

            {/* HUD over the view */}
            <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, pointerEvents: "none" }}>
              <span style={pill}>⚡ <b>{hud.energyPct}%</b></span>
              <span style={pill}>walked <b>{hud.used}</b></span>
            </div>
            <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
              <span style={pill}>best <b>{hud.best}</b></span>
            </div>

            {!started && (
              <div style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", textAlign: "center",
                background: "rgba(8,14,10,0.82)", borderRadius: 14, color: "#fff", padding: 20,
              }}>
                <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>ORIENTEERING</div>
                <h1 style={{ fontSize: 40, margin: "4px 0 6px", fontWeight: 800 }}>Lost Fox</h1>
                <p style={{ maxWidth: 430, opacity: 0.85, lineHeight: 1.5, margin: "0 0 18px" }}>
                  You're dropped somewhere on the map, facing a random way. You can see only
                  what's around you — but the full map shows every landmark and the treasure.
                  Match what you see to the map, work out where you are and which way is north,
                  then go dig it up.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  <button style={primary} onClick={() => { setCompass(true); setStarted(true); }}>
                    Start (with compass)
                  </button>
                  <button style={btn} onClick={() => { setCompass(false); setStarted(true); }}>
                    Start (no compass — harder)
                  </button>
                </div>
                <div style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
                  W / ↑ walk · A D / ← → turn · C toggle compass
                </div>
              </div>
            )}

            {(hud.status === "won" || hud.status === "lost") && (
              <div style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", textAlign: "center",
                background: "rgba(8,14,10,0.85)", borderRadius: 14, color: "#fff", padding: 20,
              }}>
                <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>
                  {hud.status === "won" ? "TREASURE FOUND" : "OUT OF ENERGY"}
                </div>
                <h1 style={{ fontSize: 30, margin: "4px 0 0", fontWeight: 800 }}>
                  {hud.status === "won" ? "Nicely navigated" : "Lost in the wild"}
                </h1>
                {hud.status === "won" && (
                  <>
                    <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.7, marginTop: 14 }}>SCORE</div>
                    <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1 }}>{hud.score}</div>
                    <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>energy left{hud.flagResult === "good" ? ` + ${FLAG_BONUS} flag bonus` : ""}</div>
                  </>
                )}
                <button style={{ ...primary, marginTop: 20 }} onClick={() => newMap(Math.floor(Math.random() * 1e9))}>
                  New map
                </button>
              </div>
            )}
          </div>

          {/* reference map + controls */}
          <div style={{ width: MW, maxWidth: "100%", flexShrink: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#cdb", marginBottom: 6 }}>YOUR MAP (north up)</div>
            <canvas ref={mapRef} style={{ width: "100%", height: "auto", display: "block", borderRadius: 10, cursor: "crosshair", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }} />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#9db5a3", lineHeight: 1.4 }}>
                Click the map where you think you are, then plant your flag — land it close to
                reveal your position.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={plantFlag}>Plant flag</button>
                <button style={btn} onClick={() => setCompass((v) => !v)}>
                  Compass: {compass ? "on" : "off"}
                </button>
                <button style={btn} onClick={() => newMap(Math.floor(Math.random() * 1e9))}>New map</button>
              </div>
              {hud.flagResult && hud.flagResult !== "good" && (
                <div style={{ fontSize: 13, color: "#fca5a5" }}>Flag {hud.flagResult} — try again.</div>
              )}
              {hud.flagResult === "good" && (
                <div style={{ fontSize: 13, color: "#86efac" }}>Found yourself! Position revealed (+{FLAG_BONUS}).</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
