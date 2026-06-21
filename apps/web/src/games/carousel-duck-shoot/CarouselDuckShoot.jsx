import { useRef, useEffect, useState } from "react";
import { attachTouchInput, drawTouchZones } from "../touch-input";

/**
 * Carousel Duck Shoot
 * ----------------------------------------------------------------------------
 * A side-view carnival shooting gallery. Ducks ride a carousel that we see
 * edge-on: the ones on the NEAR half of the turntable are large and sweep one
 * way, the ones on the FAR half are small and sweep the other way, wrapping
 * around the ends. You aim iron sights horizontally (A / D) and pull the
 * trigger (Space). Bullets are NOT hitscan — each is an integrated projectile
 * with launch velocity + gravity, so it takes real time to reach the band and
 * you have to LEAD a moving duck.
 *
 * Everything is drawn to a <canvas>; React just hosts it and shows the HUD.
 */

// ---- world constants --------------------------------------------------------
const W = 900;
const H = 560;
const CX = 450;          // carousel center x
const RX = 330;          // horizontal radius of the turntable
const DECK_CY = 238;     // center y of the deck ellipse on screen
const RY_DECK = 46;      // vertical radius of the deck ellipse (perspective)
const SCALE_FAR = 0.52;  // duck scale at the very back
const SCALE_NEAR = 1.12; // duck scale at the very front
const CANOPY_Y = 130;
const RETICLE_Y = 206;
const MUZZLE_Y = H - 58;

const N_DUCKS = 9;
const OMEGA = 0.6;        // carousel angular speed (rad/s)

const BULLET_V0 = 1180;   // launch speed (px/s, upward)
const GRAV = 1250;        // gravity (px/s^2) -> finite range + subtle arc
const BULLET_R = 4;

const MAG = 6;
const RELOAD_MS = 1100;
const SIGHT_SPEED = 540;   // px/s
const X_MIN = 70;
const X_MAX = W - 70;

const GOLD_CHANCE = 0.14;
const FALL_TIME = 0.7;     // s a hit duck takes to topple (then it stays down for good)

// scoring: clear the gallery, but every trigger pull costs you.
const DUCK_PTS = 100;
const GOLD_PTS = 300;
const SHOT_COST = 20;      // points deducted per bullet fired

// ---- tiny audio (synth blips, created on first shot so autoplay is allowed) -
function makeAudio() {
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { ctx = null; }
    }
    return ctx;
  };
  const blip = (type, freq, dur, vol, sweep = 0) => {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  };
  const noise = (dur, vol) => {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.buffer = buf;
    src.connect(g).connect(c.destination);
    src.start(t);
  };
  return {
    shot: () => { noise(0.09, 0.35); blip("square", 220, 0.06, 0.12, -120); },
    hit: () => { blip("square", 660, 0.08, 0.18, 240); blip("triangle", 990, 0.1, 0.12, 200); },
    gold: () => { blip("square", 784, 0.07, 0.18, 0); blip("square", 1175, 0.12, 0.16, 0); },
    empty: () => { blip("square", 140, 0.05, 0.1, 0); },
    reload: () => { blip("square", 300, 0.04, 0.1, 0); setTimeout(() => blip("square", 380, 0.05, 0.1, 0), 140); },
  };
}

// ---- helpers ----------------------------------------------------------------
function makeDucks() {
  const ducks = [];
  for (let i = 0; i < N_DUCKS; i++) {
    ducks.push({
      a0: (i / N_DUCKS) * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      hit: false,
      gone: false,
      fallT: 0,
      goneAt: 0,
      golden: Math.random() < GOLD_CHANCE,
    });
  }
  return ducks;
}

// position of a duck given its world angle
function duckPose(a) {
  const s = Math.sin(a);                       // >0 near, <0 far
  const t = (s + 1) / 2;                        // 0 far .. 1 near
  const x = CX + RX * Math.cos(a);
  const footY = DECK_CY + RY_DECK * s;
  const scale = SCALE_FAR + t * (SCALE_NEAR - SCALE_FAR);
  const face = s >= 0 ? -1 : 1;                 // near ducks drift left, face left
  return { x, footY, scale, face, s, t };
}

// ---- leaderboard ------------------------------------------------------------
// "" => offline mode: scores are saved per-browser in localStorage so the board
// still works standalone. Set this to your deployed Worker URL to use a shared
// online board, e.g. "https://games-leaderboard.<your-subdomain>.workers.dev".
const LEADERBOARD_API = "";
const GAME_ID = "carousel-duck-shoot";

const lbStore = {
  read(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } },
  write(key, v) { try { localStorage.setItem(key, JSON.stringify(v.slice(0, 100))); } catch {} },
};

async function lbGetTop({ period = "all", limit = 20 } = {}) {
  if (LEADERBOARD_API) {
    const r = await fetch(`${LEADERBOARD_API}/api/leaderboard/${GAME_ID}?period=${period}&limit=${limit}`);
    if (!r.ok) throw new Error(`leaderboard ${r.status}`);
    return (await r.json()).top || [];
  }
  return lbStore.read(`lb:${GAME_ID}:${period}`).slice(0, limit);
}

async function lbSubmit({ name, score }) {
  if (LEADERBOARD_API) {
    const r = await fetch(`${LEADERBOARD_API}/api/leaderboard/${GAME_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score }),
    });
    if (!r.ok) throw new Error(`leaderboard ${r.status}`);
    return r.json();
  }
  const key = `lb:${GAME_ID}:all`;
  const list = lbStore.read(key);
  const entry = { name: String(name).slice(0, 16), score: Math.floor(score), ts: Date.now() };
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const trimmed = list.slice(0, 100);
  lbStore.write(key, trimmed);
  const rank = trimmed.indexOf(entry) + 1;
  return { ok: true, rank: rank || null, qualified: rank > 0, top: trimmed.slice(0, 20) };
}

export default function CarouselDuckShoot() {
  const canvasRef = useRef(null);
  const G = useRef(null);
  const audio = useRef(null);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [hud, setHud] = useState({
    score: 0, hits: 0, shots: 0, ammo: MAG, reloading: false, reloadPct: 0, best: 0,
    roundOver: false, down: 0, total: N_DUCKS,
  });

  // keep a ref in sync so the loop reads the latest mute value
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // leaderboard state
  const [playerName, setPlayerName] = useState(() => {
    try { return localStorage.getItem("lb:name") || ""; } catch { return ""; }
  });
  const [nameDraft, setNameDraft] = useState("");
  const [board, setBoard] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [lbStatus, setLbStatus] = useState("idle"); // idle | loading | saving | saved | error
  const submittedRef = useRef(false);

  const submitScore = async (name) => {
    setLbStatus("saving");
    try {
      const res = await lbSubmit({ name, score: hud.score });
      setBoard(res.top || []);
      setMyRank(res.rank ?? null);
      setLbStatus("saved");
    } catch {
      setLbStatus("error");
      try { setBoard(await lbGetTop({ limit: 20 })); } catch { /* leave board as-is */ }
    }
  };

  const saveScore = () => {
    const name = (nameDraft || playerName).trim();
    if (!name) return;
    try { localStorage.setItem("lb:name", name); } catch {}
    setPlayerName(name);
    submitScore(name);
  };

  // on round completion: load the board, and auto-submit if we already know the name
  useEffect(() => {
    if (!hud.roundOver) { submittedRef.current = false; return; }
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (playerName) {
      submitScore(playerName);
    } else {
      setLbStatus("loading");
      lbGetTop({ limit: 20 })
        .then((top) => { setBoard(top); setLbStatus("idle"); })
        .catch(() => setLbStatus("error"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.roundOver]);

  // one-time game state
  if (!G.current) {
    G.current = {
      sightX: CX,
      keys: { left: false, right: false },
      bullets: [],
      feathers: [],
      ducks: makeDucks(),
      rot: 0,
      ammo: MAG,
      reloading: false,
      reloadEnd: 0,
      points: 0, hits: 0, shots: 0, best: 0,
      gunKick: 0, flash: 0, shake: 0,
      paused: false, roundOver: false,
    };
  }

  useEffect(() => {
    const isTouchDevice = () => "ontouchstart" in window;
    const canvas = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const g = G.current;
    let raf = 0;
    let last = performance.now();

    const snd = () => { if (!mutedRef.current && audio.current) return audio.current; return null; };

    // ---- input -------------------------------------------------------------
    const fire = () => {
      if (g.paused || g.roundOver) return;
      if (g.reloading) return;
      if (g.ammo <= 0) {
        snd()?.empty();
        startReload();
        return;
      }
      g.bullets.push({ x: g.sightX, y: MUZZLE_Y - 10, vx: 0, vy: -BULLET_V0, hit: false, py: MUZZLE_Y - 10 });
      g.ammo -= 1;
      g.shots += 1;
      g.gunKick = 1;
      g.flash = 1;
      snd()?.shot();
      if (g.ammo === 0) startReload();
    };

    const startReload = () => {
      if (g.reloading || g.ammo === MAG) return;
      g.reloading = true;
      g.reloadEnd = performance.now() + RELOAD_MS;
      snd()?.reload();
    };

    const onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (["a", "arrowleft"].includes(k)) g.keys.left = true;
      else if (["d", "arrowright"].includes(k)) g.keys.right = true;
      else if (k === " " || k === "spacebar") { if (!e.repeat) fire(); }
      else if (k === "r") startReload();
      else if (k === "p" || k === "escape") g.paused = !g.paused;
      if ([" ", "spacebar", "arrowleft", "arrowright", "a", "d"].includes(k)) e.preventDefault();
    };
    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (["a", "arrowleft"].includes(k)) g.keys.left = false;
      else if (["d", "arrowright"].includes(k)) g.keys.right = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- touch input -------------------------------------------------------
    let cleanupTouch = () => {};

    if (isTouchDevice() && canvas) {
      const touchZones = [
        { name: "◄", keyName: "left", x: 0, y: 0, w: W / 3, h: H },
        { name: "►", keyName: "right", x: (W * 2) / 3, y: 0, w: W / 3, h: H },
      ];
      const fireZone = { x: W / 3, y: H / 2, w: W / 3, h: H / 2 };
      let touchCleanup = attachTouchInput({
        canvas,
        zones: touchZones,
        onZoneChange: (update) => {
          Object.assign(g.keys, update);
        },
      });

      // Fire zone: tap to fire, don't hold.
      const handleFireTap = (e) => {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        for (const touch of e.changedTouches) {
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          if (x >= fireZone.x && x < fireZone.x + fireZone.w && y >= fireZone.y && y < fireZone.y + fireZone.h) {
            fire();
          }
        }
      };
      canvas.addEventListener("touchstart", handleFireTap, { passive: true });

      cleanupTouch = () => {
        touchCleanup();
        canvas.removeEventListener("touchstart", handleFireTap);
      };
    }


    // ---- update ------------------------------------------------------------
    const update = (dt, now) => {
      // sight movement
      const dir = (g.keys.right ? 1 : 0) - (g.keys.left ? 1 : 0);
      g.sightX += dir * SIGHT_SPEED * dt;
      g.sightX = Math.max(X_MIN, Math.min(X_MAX, g.sightX));

      // carousel spin
      g.rot += OMEGA * dt;

      // reload finish
      if (g.reloading && now >= g.reloadEnd) {
        g.reloading = false;
        g.ammo = MAG;
      }

      // decay fx
      g.gunKick = Math.max(0, g.gunKick - dt * 5);
      g.flash = Math.max(0, g.flash - dt * 6);
      g.shake = Math.max(0, g.shake - dt * 3);

      // ducks: topple when hit, then stay down permanently (no respawn)
      for (const d of g.ducks) {
        if (d.hit && !d.gone) {
          d.fallT += dt;
          if (d.fallT >= FALL_TIME) d.gone = true;
        }
      }

      // bullets: integrate + collide
      const live = [];
      for (const b of g.bullets) {
        b.py = b.y;
        b.vy += GRAV * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // collide with nearest eligible duck
        let best = null, bestY = -Infinity;
        for (const d of g.ducks) {
          if (d.hit) continue;
          const a = d.a0 + g.rot;
          const p = duckPose(a);
          const bob = Math.sin(now * 0.004 + d.phase) * 3 * p.scale;
          const cx = p.x;
          const cy = p.footY + bob - 26 * p.scale;
          const r = 24 * p.scale + BULLET_R;
          const dx = b.x - cx, dy = b.y - cy;
          if (dx * dx + dy * dy <= r * r && p.footY > bestY) {
            best = d; bestY = p.footY;
          }
        }
        if (best) {
          best.hit = true; best.fallT = 0; best.gone = false;
          g.points += best.golden ? GOLD_PTS : DUCK_PTS;
          g.hits += 1;
          g.shake = Math.min(1, g.shake + 0.45);
          const a = best.a0 + g.rot;
          const p = duckPose(a);
          spawnFeathers(p.x, p.footY - 24 * p.scale, best.golden);
          if (best.golden) snd()?.gold(); else snd()?.hit();
          continue; // bullet consumed
        }

        if (b.y < -30) continue;        // left through the top — a miss
        if (b.y > H + 40) continue;     // fell off the bottom
        live.push(b);
      }
      g.bullets = live;

      // feathers
      const f2 = [];
      for (const f of g.feathers) {
        f.vy += 900 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.vr * dt;
        f.life -= dt;
        if (f.life > 0) f2.push(f);
      }
      g.feathers = f2;

      // end of round: every duck cleared
      if (!g.roundOver && g.ducks.every((d) => d.gone)) {
        g.roundOver = true;
        const final = Math.max(0, g.points - g.shots * SHOT_COST);
        g.best = Math.max(g.best, final);
      }
    };

    const spawnFeathers = (x, y, golden) => {
      const n = 10 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 200;
        g.feathers.push({
          x, y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 120,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          life: 0.5 + Math.random() * 0.5,
          golden,
        });
      }
    };

    // ---- drawing -----------------------------------------------------------
    const drawBackground = (now) => {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#241544");
      sky.addColorStop(0.45, "#52306b");
      sky.addColorStop(0.8, "#9c4f74");
      sky.addColorStop(1, "#c4736a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // spotlight glow behind the carousel
      const glow = ctx.createRadialGradient(CX, DECK_CY - 60, 30, CX, DECK_CY - 60, 360);
      glow.addColorStop(0, "rgba(255,224,170,0.30)");
      glow.addColorStop(1, "rgba(255,224,170,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // string lights — two gentle swags
      for (let row = 0; row < 2; row++) {
        const baseY = 26 + row * 22;
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const y = baseY + Math.sin(x / 120 + row) * 10 + Math.sin(x / 38) * 4;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        const cols = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#ff9f1c"];
        for (let x = 18; x <= W; x += 46) {
          const y = baseY + Math.sin(x / 120 + row) * 10 + Math.sin(x / 38) * 4 + 7;
          const tw = 0.6 + 0.4 * Math.sin(now * 0.004 + x);
          const c = cols[(x / 46 | 0) % cols.length];
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.4 + 0.6 * tw;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // ground
      ctx.fillStyle = "#3b2418";
      ctx.fillRect(0, 470, W, H - 470);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo(CX, 470);
        ctx.lineTo(i * (W / 9), H);
        ctx.lineTo(i * (W / 9) + 20, H);
        ctx.fill();
      }
    };

    const drawDeck = () => {
      // turntable cylinder: a side band + the top ellipse
      ctx.fillStyle = "#5b3a2a";
      ctx.beginPath();
      ctx.ellipse(CX, DECK_CY + 18, RX + 24, RY_DECK, 0, 0, Math.PI);
      ctx.rect(CX - (RX + 24), DECK_CY, (RX + 24) * 2, 18);
      ctx.fill();

      const top = ctx.createLinearGradient(0, DECK_CY - RY_DECK, 0, DECK_CY + RY_DECK);
      top.addColorStop(0, "#a9743f");
      top.addColorStop(1, "#7a4f2c");
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.ellipse(CX, DECK_CY, RX + 24, RY_DECK, 0, 0, Math.PI * 2);
      ctx.fill();

      // gold trim
      ctx.strokeStyle = "#e6b34d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(CX, DECK_CY, RX + 24, RY_DECK, 0, 0, Math.PI * 2);
      ctx.stroke();
    };

    const drawPole = (x, footY, scale, golden) => {
      const top = footY - 150 * scale;
      const grad = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
      grad.addColorStop(0, "#6b5318");
      grad.addColorStop(0.5, "#f2d585");
      grad.addColorStop(1, "#6b5318");
      ctx.fillStyle = grad;
      const w = 3 * scale;
      ctx.fillRect(x - w / 2, top, w, footY - top);
    };

    const drawDuck = (d, now) => {
      const a = d.a0 + g.rot;
      const p = duckPose(a);
      drawPole(p.x, p.footY, p.scale, d.golden);   // empty poles keep riding
      if (d.gone) return;
      const bob = Math.sin(now * 0.004 + d.phase) * 3 * p.scale;

      ctx.save();
      ctx.translate(p.x, p.footY + bob);
      if (d.hit) {
        const k = Math.min(1, d.fallT / FALL_TIME);
        ctx.globalAlpha = 1 - k;
        ctx.rotate((p.face) * k * 1.4);
        ctx.translate(0, k * 30 * p.scale);
      }
      ctx.scale(p.face * p.scale, p.scale);

      const body = d.golden ? "#ffd24a" : "#f4c430";
      const belly = d.golden ? "#fff0b8" : "#ffe08a";
      if (d.golden) { ctx.shadowColor = "rgba(255,210,74,0.8)"; ctx.shadowBlur = 16; }

      // tail
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-18, -24); ctx.lineTo(-30, -30); ctx.lineTo(-18, -16);
      ctx.closePath(); ctx.fill();
      // body
      ctx.beginPath();
      ctx.ellipse(0, -22, 22, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      // belly
      ctx.fillStyle = belly;
      ctx.beginPath();
      ctx.ellipse(-2, -16, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // head
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(15, -44, 12, 0, Math.PI * 2);
      ctx.fill();
      // wing
      ctx.fillStyle = d.golden ? "#e9b53a" : "#e0ad26";
      ctx.beginPath();
      ctx.ellipse(-2, -22, 12, 9, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // beak
      ctx.fillStyle = "#ef8a2b";
      ctx.beginPath();
      ctx.moveTo(25, -46); ctx.lineTo(36, -43); ctx.lineTo(25, -40);
      ctx.closePath(); ctx.fill();
      // eye
      ctx.fillStyle = "#1b1b1b";
      ctx.beginPath(); ctx.arc(18, -47, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(18.7, -47.7, 0.8, 0, Math.PI * 2); ctx.fill();
      // feet
      ctx.strokeStyle = "#ef8a2b";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-4, 0);
      ctx.moveTo(6, -4); ctx.lineTo(6, 0); ctx.stroke();

      ctx.restore();
    };

    const drawCanopy = () => {
      const baseY = 150;            // where the dome meets the poles
      const rx = 250, ry = 82;      // squashed dome radii
      const apexY = baseY - ry;     // visual top of the dome (~68)
      const stripes = 12;

      // central pole (behind near ducks, in front of far ducks)
      ctx.fillStyle = "#caa24a";
      ctx.fillRect(CX - 5, baseY, 10, DECK_CY - baseY);

      // striped dome as alternating pie slices over the top semicircle
      ctx.save();
      ctx.translate(CX, baseY);
      for (let i = 0; i < stripes; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.ellipse(0, 0, rx, ry, 0,
          Math.PI + (i / stripes) * Math.PI,
          Math.PI + ((i + 1) / stripes) * Math.PI);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? "#d6483f" : "#f6efe2";
        ctx.fill();
      }
      ctx.restore();

      // scalloped fringe along the base
      ctx.fillStyle = "#f6efe2";
      for (let x = CX - rx; x <= CX + rx - 24; x += 24) {
        ctx.beginPath();
        ctx.arc(x + 12, baseY + 1, 12, 0, Math.PI);
        ctx.fill();
      }

      // finial + flag
      ctx.fillStyle = "#e6b34d";
      ctx.beginPath(); ctx.arc(CX, apexY - 6, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#e6b34d"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(CX, apexY - 13); ctx.lineTo(CX, apexY - 40); ctx.stroke();
      ctx.fillStyle = "#ef476f";
      ctx.beginPath();
      ctx.moveTo(CX, apexY - 40); ctx.lineTo(CX + 26, apexY - 33);
      ctx.lineTo(CX, apexY - 26); ctx.closePath(); ctx.fill();
    };

    const drawFeathers = () => {
      for (const f of g.feathers) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2));
        ctx.fillStyle = f.golden ? "#ffd24a" : "#f4c430";
        ctx.beginPath();
        ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const drawBullets = () => {
      for (const b of g.bullets) {
        // streak
        ctx.strokeStyle = "rgba(255,240,180,0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x, b.y - b.vy * 0.018);
        ctx.stroke();
        // head
        ctx.fillStyle = "#fff4c2";
        ctx.shadowColor = "rgba(255,220,120,0.9)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    const drawGunAndSights = () => {
      const x = g.sightX;
      const kick = g.gunKick * 9;

      // faint aim guide from muzzle up to reticle
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(x, MUZZLE_Y);
      ctx.lineTo(x, RETICLE_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // reticle ring at the band
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.lineWidth = 2;
      const r = 15;
      const gap = 0.5;
      for (let q = 0; q < 4; q++) {
        const a = q * (Math.PI / 2) + gap / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.arc(x, RETICLE_Y, r, a, a + (Math.PI / 2 - gap));
        ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x - 22, RETICLE_Y); ctx.lineTo(x - 8, RETICLE_Y);
      ctx.moveTo(x + 8, RETICLE_Y); ctx.lineTo(x + 22, RETICLE_Y);
      ctx.moveTo(x, RETICLE_Y - 22); ctx.lineTo(x, RETICLE_Y - 8); ctx.stroke();
      ctx.fillStyle = "rgba(255,80,80,0.9)";
      ctx.beginPath(); ctx.arc(x, RETICLE_Y, 1.6, 0, Math.PI * 2); ctx.fill();

      // gun barrel
      ctx.save();
      ctx.translate(x, kick);
      const barrel = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
      barrel.addColorStop(0, "#1c2230");
      barrel.addColorStop(0.5, "#566179");
      barrel.addColorStop(1, "#1c2230");
      ctx.fillStyle = barrel;
      ctx.fillRect(x - 13, MUZZLE_Y, 26, H - MUZZLE_Y + 10);
      // muzzle ring
      ctx.fillStyle = "#0c0f16";
      ctx.beginPath(); ctx.ellipse(x, MUZZLE_Y, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2a3142";
      ctx.beginPath(); ctx.ellipse(x, MUZZLE_Y, 7, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      // front sight blade
      ctx.fillStyle = "#2a3142";
      ctx.beginPath();
      ctx.moveTo(x - 3, MUZZLE_Y - 2); ctx.lineTo(x + 3, MUZZLE_Y - 2);
      ctx.lineTo(x + 2, MUZZLE_Y - 16); ctx.lineTo(x - 2, MUZZLE_Y - 16);
      ctx.closePath(); ctx.fill();
      // rear sight notch (two posts)
      const ry = MUZZLE_Y + 30;
      ctx.fillStyle = "#2a3142";
      ctx.fillRect(x - 13, ry, 7, 14);
      ctx.fillRect(x + 6, ry, 7, 14);
      ctx.restore();

      // muzzle flash
      if (g.flash > 0) {
        ctx.save();
        ctx.translate(x, MUZZLE_Y - 4 + kick);
        ctx.globalAlpha = g.flash;
        const fl = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
        fl.addColorStop(0, "rgba(255,255,220,0.95)");
        fl.addColorStop(0.5, "rgba(255,180,60,0.7)");
        fl.addColorStop(1, "rgba(255,120,0,0)");
        ctx.fillStyle = fl;
        for (let i = 0; i < 8; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(4, -8 - Math.random() * 14); ctx.lineTo(-4, -8);
          ctx.closePath(); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    };

    const render = (now) => {
      ctx.save();
      if (g.shake > 0) {
        ctx.translate((Math.random() - 0.5) * g.shake * 6, (Math.random() - 0.5) * g.shake * 6);
      }
      drawBackground(now);
      drawDeck();

      // partition ducks by depth so the centre pole occludes correctly
      const far = [], near = [];
      for (const d of g.ducks) {
        const s = Math.sin(d.a0 + g.rot);
        (s < 0 ? far : near).push({ d, footY: duckPose(d.a0 + g.rot).footY });
      }
      far.sort((p, q) => p.footY - q.footY);
      near.sort((p, q) => p.footY - q.footY);

      for (const { d } of far) drawDuck(d, now);
      drawCanopy();
      for (const { d } of near) drawDuck(d, now);

      drawFeathers();
      drawBullets();
      drawGunAndSights();
      ctx.restore();

      // Draw touch zones if on a touch device
      if (isTouchDevice()) {
        const touchZones = [
          { name: "◄", keyName: "left", x: 0, y: 0, w: W / 3, h: H },
          { name: "►", keyName: "right", x: (W * 2) / 3, y: 0, w: W / 3, h: H },
          { name: "FIRE", keyName: "fire", x: W / 3, y: H / 2, w: W / 3, h: H / 2 },
        ];
        drawTouchZones(ctx, touchZones, { filled: true, alpha: 0.08 });
      }
    };

    // ---- HUD sync (throttled) ---------------------------------------------
    let hudAcc = 0;
    const pushHud = (now) => {
      const reloadPct = g.reloading
        ? Math.max(0, Math.min(1, 1 - (g.reloadEnd - now) / RELOAD_MS))
        : 0;
      const score = Math.max(0, g.points - g.shots * SHOT_COST);
      const down = g.ducks.filter((d) => d.gone).length;
      setHud({
        score, hits: g.hits, shots: g.shots,
        ammo: g.ammo, reloading: g.reloading, reloadPct, best: g.best,
        roundOver: g.roundOver, down, total: g.ducks.length,
      });
    };

    // ---- main loop ---------------------------------------------------------
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (started && !g.paused && !g.roundOver) update(dt, now);
      render(now);

      hudAcc += dt;
      if (hudAcc > 0.08) { pushHud(now); hudAcc = 0; }

      if (g.paused) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 34px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Paused", W / 2, H / 2);
        ctx.font = "16px system-ui, sans-serif";
        ctx.fillText("press P or Esc to resume", W / 2, H / 2 + 30);
        ctx.textAlign = "left";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cleanupTouch();
    };
  }, [started]);

  const begin = () => {
    if (!audio.current) audio.current = makeAudio();
    setStarted(true);
  };

  const resetRound = () => {
    const g = G.current;
    g.ducks = makeDucks();
    g.bullets = []; g.feathers = [];
    g.points = 0; g.hits = 0; g.shots = 0;
    g.ammo = MAG; g.reloading = false; g.reloadEnd = 0;
    g.roundOver = false; g.flash = 0; g.gunKick = 0; g.shake = 0;
    submittedRef.current = false;
    setBoard([]); setMyRank(null); setLbStatus("idle"); setNameDraft("");
    setHud((h) => ({
      ...h, score: 0, hits: 0, shots: 0, ammo: MAG,
      reloading: false, reloadPct: 0, roundOver: false, down: 0,
    }));
  };

  const acc = hud.shots > 0 ? Math.round((hud.hits / hud.shots) * 100) : 0;

  // ---- styles -------------------------------------------------------------
  const wrap = {
    position: "relative", width: "100%", maxWidth: 900, margin: "0 auto",
    aspectRatio: `${W} / ${H}`, borderRadius: 16, overflow: "hidden",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)", userSelect: "none",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
  };
  const canvasStyle = { width: "100%", height: "100%", display: "block" };
  const hudBase = { position: "absolute", color: "#fff", pointerEvents: "none", textShadow: "0 2px 6px rgba(0,0,0,0.6)" };
  const pill = {
    display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px",
    background: "rgba(20,12,32,0.5)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999, backdropFilter: "blur(4px)", fontSize: 14,
  };

  return (
    <div style={{ background: "#140c20", padding: 16 }}>
      <div style={wrap}>
        <canvas ref={canvasRef} style={canvasStyle} />

        {/* top-left: score */}
        <div style={{ ...hudBase, top: 14, left: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.7 }}>SCORE</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{hud.score}</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>BEST {hud.best}</div>
        </div>

        {/* top-right: ducks remaining + accuracy */}
        <div style={{ ...hudBase, top: 14, right: 14, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div style={pill}>
            <span style={{ opacity: 0.7 }}>DUCKS</span>
            <b>{hud.total - hud.down}</b>
            <span style={{ opacity: 0.5 }}>/ {hud.total} left</span>
          </div>
          <div style={pill}>
            <span style={{ opacity: 0.7 }}>ACC</span>
            <b>{acc}%</b>
            <span style={{ opacity: 0.5 }}>· {hud.hits}/{hud.shots}</span>
          </div>
        </div>

        {/* bottom-left: ammo + reload */}
        <div style={{ ...hudBase, bottom: 14, left: 14 }}>
          {hud.reloading ? (
            <div style={pill}>
              <span style={{ opacity: 0.8 }}>RELOADING</span>
              <span style={{ width: 70, height: 6, background: "rgba(255,255,255,0.2)", borderRadius: 999, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${hud.reloadPct * 100}%`, background: "#ffd166" }} />
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 5 }}>
              {Array.from({ length: MAG }).map((_, i) => (
                <span key={i} style={{
                  width: 9, height: 22, borderRadius: 3,
                  background: i < hud.ammo ? "#ffd166" : "rgba(255,255,255,0.15)",
                  boxShadow: i < hud.ammo ? "0 0 6px rgba(255,209,102,0.7)" : "none",
                }} />
              ))}
            </div>
          )}
        </div>

        {/* bottom-right: controls + mute */}
        <div style={{ ...hudBase, bottom: 14, right: 14, textAlign: "right", display: "flex", gap: 8, alignItems: "center", fontSize: "clamp(12px, 2vw, 14px)" }}>
          <div style={pill}>
            <span style={{ opacity: 0.7 }}>aim</span> <b>A</b> <b>D</b> · <span style={{ opacity: 0.7 }}>fire</span> <b>Space</b> · <b>R</b> reload · <b>P</b> pause
          </div>
          <button
            onClick={() => setMuted((m) => !m)}
            style={{
              pointerEvents: "auto", cursor: "pointer", border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(20,12,32,0.6)", color: "#fff", borderRadius: 999,
              width: 34, height: 34, fontSize: 15,
            }}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>

        {/* start overlay */}
        {!started && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", textAlign: "center",
            background: "rgba(12,7,20,0.55)", backdropFilter: "blur(2px)", color: "#fff",
            fontFamily: "system-ui, sans-serif",
          }}>
            <div style={{ fontSize: 13, letterSpacing: 4, opacity: 0.7 }}>CARNIVAL GALLERY</div>
            <h1 style={{ fontSize: 46, margin: "6px 0 4px", fontWeight: 800 }}>Carousel Duck Shoot</h1>
            <p style={{ maxWidth: 470, opacity: 0.85, lineHeight: 1.5, margin: "0 0 22px" }}>
              Clear all {N_DUCKS} ducks — they don't come back. Bullets take time to fly,
              so <b>lead your target</b>, and every shot costs {SHOT_COST} points. Spend them wisely.
            </p>
            <div style={{ maxWidth: 470, fontSize: 13, lineHeight: 1.6, opacity: 0.75, margin: "0 0 24px", textAlign: "left", background: "rgba(255,255,255,0.05)", padding: 14, borderRadius: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Controls:</div>
              <div><b>A / D</b> or arrow keys – aim left/right</div>
              <div><b>Space</b> – fire</div>
              <div><b>R</b> – reload</div>
              <div><b>P</b> or Esc – pause</div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>On mobile: tap left/right zones to aim, tap FIRE button to shoot.</div>
            </div>
            <button
              onClick={begin}
              style={{
                cursor: "pointer", border: "none", borderRadius: 999, padding: "14px 40px",
                fontSize: 18, fontWeight: 700, color: "#241544",
                background: "linear-gradient(180deg,#ffe08a,#ffc94d)",
                boxShadow: "0 10px 30px rgba(255,201,77,0.4)",
              }}
            >
              Start shooting
            </button>
            <div style={{ marginTop: 18, fontSize: 13, opacity: 0.7 }}>
              A / D aim · Space trigger · R reload · 🦆 = {DUCK_PTS} · ✨ gold = {GOLD_PTS} · −{SHOT_COST}/shot
            </div>
          </div>
        )}

        {/* round complete */}
        {hud.roundOver && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", textAlign: "center",
            background: "rgba(12,7,20,0.72)", backdropFilter: "blur(3px)", color: "#fff",
            fontFamily: "system-ui, sans-serif", padding: 16, overflowY: "auto",
          }}>
            <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>GALLERY CLEARED</div>
            <h1 style={{ fontSize: 26, margin: "2px 0 0", fontWeight: 800 }}>Round complete</h1>
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.7, marginTop: 10 }}>SCORE</div>
            <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1 }}>{hud.score}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={pill}><span style={{ opacity: 0.7 }}>DUCKS</span> <b>{hud.hits}/{hud.total}</b></span>
              <span style={pill}><span style={{ opacity: 0.7 }}>BULLETS</span> <b>{hud.shots}</b></span>
              <span style={pill}><span style={{ opacity: 0.7 }}>ACC</span> <b>{acc}%</b></span>
            </div>

            {/* name entry — shown until a score is saved */}
            {lbStatus !== "saved" && lbStatus !== "saving" && (
              <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
                <input
                  value={nameDraft || playerName}
                  onChange={(e) => setNameDraft(e.target.value.slice(0, 16))}
                  onKeyDown={(e) => { if (e.key === "Enter") saveScore(); e.stopPropagation(); }}
                  placeholder="Your name"
                  maxLength={16}
                  style={{
                    padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 15, width: 160, outline: "none",
                  }}
                />
                <button
                  onClick={saveScore}
                  style={{
                    cursor: "pointer", border: "none", borderRadius: 10, padding: "10px 18px",
                    fontSize: 15, fontWeight: 700, color: "#241544",
                    background: "linear-gradient(180deg,#ffe08a,#ffc94d)",
                  }}
                >
                  Save score
                </button>
              </div>
            )}
            {lbStatus === "saving" && (
              <div style={{ marginTop: 18, fontSize: 14, opacity: 0.85 }}>Saving&hellip;</div>
            )}
            {lbStatus === "saved" && myRank && (
              <div style={{ marginTop: 16, fontSize: 16 }}>
                You're <b style={{ color: "#ffd166" }}>#{myRank}</b>
                {LEADERBOARD_API ? "" : "  (saved on this device)"}
              </div>
            )}
            {lbStatus === "error" && (
              <div style={{ marginTop: 16, fontSize: 13, color: "#ff9aa2" }}>
                Couldn't reach the leaderboard.
              </div>
            )}

            {/* the board */}
            <div style={{ marginTop: 16, width: "100%", maxWidth: 320 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.6, marginBottom: 6 }}>
                LEADERBOARD{LEADERBOARD_API ? "" : " · LOCAL"}
              </div>
              {lbStatus === "loading" ? (
                <div style={{ fontSize: 13, opacity: 0.7, padding: "12px 0" }}>Loading&hellip;</div>
              ) : board.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.6, padding: "12px 0" }}>No scores yet — be the first!</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {board.slice(0, 10).map((e, i) => {
                    const mine = myRank === i + 1;
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "6px 12px", borderRadius: 8, fontSize: 14,
                        background: mine ? "rgba(255,209,102,0.22)" : "rgba(255,255,255,0.05)",
                        border: mine ? "1px solid rgba(255,209,102,0.5)" : "1px solid transparent",
                      }}>
                        <span style={{ width: 22, textAlign: "right", opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: mine ? 700 : 400 }}>{e.name}</span>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{e.score}</b>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              onClick={resetRound}
              style={{
                cursor: "pointer", border: "none", borderRadius: 999, padding: "12px 36px",
                fontSize: 16, fontWeight: 700, color: "#241544", marginTop: 18,
                background: "linear-gradient(180deg,#ffe08a,#ffc94d)",
                boxShadow: "0 10px 30px rgba(255,201,77,0.4)",
              }}
            >
              Play again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
