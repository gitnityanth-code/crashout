"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Rant } from "@/lib/store";

export interface RantWallHandle {
  /** Fling a fresh rant into the field from (ox, oy) in viewport px. */
  spawn: (rant: Rant, ox: number, oy: number) => void;
}

interface Body {
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  baseVy: number;
  phase: number;
  wanderFreq: number;
  rot0: number;
  rotFreq: number;
  sqx: number;
  sqy: number;
  svx: number;
  svy: number;
  hover: boolean;
  hasText: boolean;
}

interface Zone {
  l: number;
  t: number;
  r: number;
  b: number;
}

const VARIANTS = ["v-glass", "v-glass", "v-pill", "v-inverse", "v-marker", "v-outline", "v-stamp", "v-tape"];

/** Personal space between bubbles, px. They bounce before they visually touch. */
const PAD = 18;
/** Extra breathing room around the logo and the rant form. */
const ZONE_PAD = 26;

const hashStr = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const sizeClass = (text: string) =>
  text.length < 42 ? "size-l" : text.length < 130 ? "size-m" : "size-s";

/** Rect-vs-rect overlap with padding; true if boxes (as centers+half sizes) intersect. */
const boxesOverlap = (
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
  pad: number
) =>
  Math.abs(ax - bx) < (aw + bw) / 2 + pad && Math.abs(ay - by) < (ah + bh) / 2 + pad;

const RantWall = forwardRef<RantWallHandle, { rants: Rant[] }>(function RantWall(
  { rants },
  ref
) {
  const [poolSize, setPoolSize] = useState(0);
  const [mode, setMode] = useState<"physics" | "static" | null>(null);
  const bodiesRef = useRef<(Body | null)[]>([]);
  const queueRef = useRef<Rant[]>([]);
  const queueIdxRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const spawnQueueRef = useRef<{ rant: Rant; ox: number; oy: number }[]>([]);

  queueRef.current = rants;

  useImperativeHandle(ref, () => ({
    spawn(rant, ox, oy) {
      spawnQueueRef.current.push({ rant, ox, oy });
    },
  }));

  // Sparse pool: only a handful of bubbles at a time — the rest of the archive
  // waits its turn offscreen. Phone ~4, tablet ~6, desktop ~9. No flooding.
  useEffect(() => {
    const computePool = () => {
      const w = window.innerWidth;
      setPoolSize(w < 640 ? 4 : w < 1100 ? 6 : 9);
    };
    computePool();
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(computePool, 350);
    };
    window.addEventListener("resize", onResize);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMode = () => {
      // ?motion=full / ?motion=off overrides the OS preference
      const override = new URLSearchParams(window.location.search).get("motion");
      if (override === "full") return setMode("physics");
      if (override === "off") return setMode("static");
      setMode(mq.matches ? "static" : "physics");
    };
    applyMode();
    mq.addEventListener?.("change", applyMode);
    return () => {
      mq.removeEventListener?.("change", applyMode);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
    };
  }, []);

  useEffect(() => {
    if (poolSize === 0 || mode === null) return;

    const assign = (b: Body, rant: Rant) => {
      b.textEl.textContent = rant.text;
      const variant = VARIANTS[hashStr(rant.id) % VARIANTS.length];
      b.el.className = `bubble live ${variant} ${sizeClass(rant.text)}${b.hover ? " front" : ""}`;
      b.w = b.el.offsetWidth;
      b.h = b.el.offsetHeight;
      b.hasText = true;
    };

    const nextRant = (): Rant | null => {
      const q = queueRef.current;
      if (q.length === 0) return null;
      const r = q[queueIdxRef.current % q.length]!;
      queueIdxRef.current++;
      return r;
    };

    const liveBodies = () => bodiesRef.current.filter((b): b is Body => b !== null);

    // No-fly zones: the logo block and the rant form stay clear of bubbles.
    let zones: Zone[] = [];
    const refreshZones = () => {
      zones = [];
      for (const sel of [".masthead", ".pill"]) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        zones.push({ l: r.left - ZONE_PAD, t: r.top - ZONE_PAD, r: r.right + ZONE_PAD, b: r.bottom + ZONE_PAD });
      }
    };
    refreshZones();

    const inZone = (cx: number, cy: number, w: number, h: number) =>
      zones.some(
        (z) =>
          cx + w / 2 > z.l && cx - w / 2 < z.r && cy + h / 2 > z.t && cy - h / 2 < z.b
      );

    /** Find a spot that overlaps neither placed bubbles nor the UI zones. */
    const findSpot = (
      b: Body,
      placed: Body[],
      W: number,
      H: number,
      yMin: number,
      yMax: number,
      tries: number
    ): { cx: number; cy: number } | null => {
      for (let i = 0; i < tries; i++) {
        const cx = Math.min(Math.max(Math.random() * W, b.w / 2 + 10), W - b.w / 2 - 10);
        const cy = yMin + Math.random() * (yMax - yMin);
        const onScreen = cy - b.h / 2 < H;
        if (onScreen && inZone(cx, cy, b.w, b.h)) continue;
        const collides = placed.some(
          (p) => p !== b && p.hasText && boxesOverlap(cx, cy, b.w, b.h, p.cx, p.cy, p.w, p.h, PAD)
        );
        if (!collides) return { cx, cy };
      }
      return null;
    };

    /* ---------------- static mode (prefers-reduced-motion) ---------------- */

    if (mode === "static") {
      let placed = false;

      const settle = () => {
        if (queueRef.current.length === 0) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        if (W < 60 || H < 60) return; // pane not laid out yet — retry later
        refreshZones();
        const done: Body[] = [];
        for (const b of liveBodies()) {
          const r = nextRant();
          if (!r) break;
          assign(b, r);
          const spot = findSpot(b, done, W, H, b.h / 2 + 10, H - b.h / 2 - 10, 40);
          if (!spot) {
            // no clean spot left — hide rather than pile up
            b.el.classList.remove("live");
            b.hasText = false;
            continue;
          }
          b.cx = spot.cx;
          b.cy = spot.cy;
          done.push(b);
          b.el.style.transform = `translate3d(${(b.cx - b.w / 2).toFixed(1)}px, ${(b.cy - b.h / 2).toFixed(1)}px, 0) rotate(${((hashStr(r.id) % 100) / 25 - 2).toFixed(2)}deg)`;
        }
        placed = done.length > 0;
      };

      // Even without motion, your own rant must land on the wall right away.
      const drainSpawns = () => {
        while (spawnQueueRef.current.length > 0) {
          const { rant } = spawnQueueRef.current.shift()!;
          const candidates = liveBodies().filter((b) => b.hasText);
          const victim = candidates[Math.floor(Math.random() * candidates.length)];
          if (!victim) break;
          assign(victim, rant);
          const W = window.innerWidth;
          const H = window.innerHeight;
          victim.cx = Math.min(Math.max(victim.cx, victim.w / 2 + 10), Math.max(W - victim.w / 2 - 10, victim.w / 2 + 10));
          victim.cy = Math.min(Math.max(victim.cy, victim.h / 2 + 10), Math.max(H - victim.h / 2 - 10, victim.h / 2 + 10));
          victim.el.style.transform = `translate3d(${(victim.cx - victim.w / 2).toFixed(1)}px, ${(victim.cy - victim.h / 2).toFixed(1)}px, 0) rotate(${((hashStr(rant.id) % 100) / 25 - 2).toFixed(2)}deg)`;
        }
      };

      settle();
      const iv = window.setInterval(() => {
        if (!placed) settle();
        drainSpawns();
      }, 600);
      const rotate = window.setInterval(() => {
        if (placed) settle();
      }, 14_000);
      const onResize = () => settle();
      window.addEventListener("resize", onResize);
      return () => {
        window.clearInterval(iv);
        window.clearInterval(rotate);
        window.removeEventListener("resize", onResize);
      };
    }

    /* ---------------- physics mode ---------------- */

    let raf = 0;
    let last = performance.now();
    let time = 0;
    let frame = 0;
    let initialized = false;

    const recycle = (b: Body, W: number, H: number) => {
      const r = nextRant();
      if (r) assign(b, r);
      // re-enter from below, in the least crowded column
      const others = liveBodies().filter((o) => o !== b && o.hasText && o.cy > H * 0.55);
      let bestX = Math.random() * W;
      let bestScore = -1;
      for (let i = 0; i < 6; i++) {
        const cand = Math.min(Math.max(Math.random() * W, b.w / 2 + 10), W - b.w / 2 - 10);
        const score = others.length
          ? Math.min(...others.map((o) => Math.abs(o.cx - cand)))
          : 1e9;
        if (score > bestScore) {
          bestScore = score;
          bestX = cand;
        }
      }
      b.cx = bestX;
      b.cy = H + b.h / 2 + 40 + Math.random() * 260;
      b.vx = 0;
      b.vy = b.baseVy;
      b.sqx = b.sqy = b.svx = b.svy = 0;
    };

    const initField = (): boolean => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (W < 60 || H < 60 || queueRef.current.length === 0) return false;
      refreshZones();
      const done: Body[] = [];
      for (const b of liveBodies()) {
        const r = nextRant();
        if (!r) break;
        assign(b, r);
        // spread across 1.7 screen heights: some visible now, the rest drift in
        const spot = findSpot(b, done, W, H, H * 0.06, H * 1.7, 30);
        b.cx = spot ? spot.cx : Math.min(Math.max(Math.random() * W, b.w / 2 + 10), W - b.w / 2 - 10);
        b.cy = spot ? spot.cy : H * 1.1 + Math.random() * H;
        done.push(b);
      }
      return true;
    };

    const stepCore = (dt: number) => {
      time += dt;
      frame++;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const bodies = liveBodies();

      if (!initialized) {
        initialized = initField();
        if (!initialized) return;
      }

      if (frame % 120 === 0) refreshZones(); // layout can shift (fonts, resize)

      // Fresh submissions burst in from the form.
      while (spawnQueueRef.current.length > 0) {
        const { rant, ox, oy } = spawnQueueRef.current.shift()!;
        let victim: Body | null = null;
        for (const b of bodies) {
          if (!victim || b.cy > victim.cy) victim = b; // lowest = least visible
        }
        if (!victim) break;
        assign(victim, rant);
        victim.cx = Math.min(Math.max(ox + (Math.random() * 60 - 30), victim.w / 2 + 8), W - victim.w / 2 - 8);
        victim.cy = oy;
        victim.vx = (Math.random() - 0.5) * 90;
        victim.vy = -170;
        victim.sqx = -0.3;
        victim.svx = 2.4;
      }

      const mouse = mouseRef.current;

      for (const b of bodies) {
        if (!b.hasText) continue;
        // wander + relax toward the upward drift
        b.vx += Math.sin(time * b.wanderFreq + b.phase) * 16 * dt;
        b.vx -= b.vx * 0.55 * dt;
        b.vy += (b.baseVy - b.vy) * 0.85 * dt;

        // the cursor is a gust of wind
        if (mouse.active) {
          const dx = b.cx - mouse.x;
          const dy = b.cy - mouse.y;
          const d2 = dx * dx + dy * dy;
          const R = 150;
          if (d2 < R * R) {
            const d = Math.sqrt(Math.max(d2, 900));
            const f = (1 - d / R) * 460;
            b.vx += (dx / d) * f * dt;
            b.vy += (dy / d) * f * dt;
          }
        }

        // the logo and the form deflect bubbles like force fields
        for (const z of zones) {
          const hw = b.w / 2;
          const hh = b.h / 2;
          const ox = Math.min(b.cx + hw, z.r) - Math.max(b.cx - hw, z.l);
          const oy = Math.min(b.cy + hh, z.b) - Math.max(b.cy - hh, z.t);
          if (ox <= 0 || oy <= 0) continue;
          const zcx = (z.l + z.r) / 2;
          const zcy = (z.t + z.b) / 2;
          if (ox < oy) {
            b.vx += Math.sign(b.cx - zcx || 1) * Math.min(ox, 70) * 11 * dt;
          } else {
            b.vy += Math.sign(b.cy - zcy || 1) * Math.min(oy, 70) * 11 * dt;
          }
          // gentle sideways bias so nothing camps beneath the form
          b.vx += Math.sign(b.cx - zcx || 1) * 26 * dt;
        }

        const speedScale = b.hover ? 0.1 : 1;
        b.cx += b.vx * speedScale * dt;
        b.cy += b.vy * speedScale * dt;

        // springy side walls
        const halfW = b.w / 2;
        if (b.cx - halfW < 6) {
          b.vx += (6 - (b.cx - halfW)) * 30 * dt;
          b.svx += 0.4 * dt * 60;
        } else if (b.cx + halfW > W - 6) {
          b.vx -= (b.cx + halfW - (W - 6)) * 30 * dt;
          b.svx += 0.4 * dt * 60;
        }

        // gone past the top → rejoin the flow from below with the next rant
        if (b.cy + b.h / 2 < -28) recycle(b, W, H);
      }

      // pairwise collisions: true rectangles + personal space, resolved along
      // the axis of least penetration — boxes bounce before they visually touch
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        if (!a.hasText) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const c = bodies[j]!;
          if (!c.hasText) continue;
          const dx = c.cx - a.cx;
          const dy = c.cy - a.cy;
          const ox = (a.w + c.w) / 2 + PAD - Math.abs(dx);
          const oy = (a.h + c.h) / 2 + PAD - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;

          let nx = 0;
          let ny = 0;
          let overlap: number;
          if (ox < oy) {
            nx = dx >= 0 ? 1 : -1;
            overlap = ox;
          } else {
            ny = dy >= 0 ? 1 : -1;
            overlap = oy;
          }

          // positional separation, mass-weighted by area
          const ma = a.w * a.h;
          const mc = c.w * c.h;
          const wa = mc / (ma + mc);
          const wc = ma / (ma + mc);
          const sep = overlap * 0.5;
          a.cx -= nx * sep * wa;
          a.cy -= ny * sep * wa;
          c.cx += nx * sep * wc;
          c.cy += ny * sep * wc;

          // bounce impulse if approaching
          const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rel < 0) {
            const jimp = -rel * 0.92 + 26;
            a.vx -= nx * jimp * wa;
            a.vy -= ny * jimp * wa;
            c.vx += nx * jimp * wc;
            c.vy += ny * jimp * wc;

            // rubber: squash along the hit axis, bulge the other way
            const impact = Math.min(Math.abs(rel) / 200, 1) * 0.55 + 0.12;
            if (nx !== 0) {
              a.svx -= impact * 2.6;
              a.svy += impact * 1.6;
              c.svx -= impact * 2.6;
              c.svy += impact * 1.6;
            } else {
              a.svy -= impact * 2.6;
              a.svx += impact * 1.6;
              c.svy -= impact * 2.6;
              c.svx += impact * 1.6;
            }
          }
        }
      }

      // integrate squash springs + hard speed cap + render
      for (const b of bodies) {
        if (!b.hasText) continue;
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > 240) {
          b.vx *= 240 / speed;
          b.vy *= 240 / speed;
        }

        b.svx += (-95 * b.sqx - 9.5 * b.svx) * dt;
        b.svy += (-95 * b.sqy - 9.5 * b.svy) * dt;
        b.sqx = Math.min(Math.max(b.sqx + b.svx * dt, -0.32), 0.32);
        b.sqy = Math.min(Math.max(b.sqy + b.svy * dt, -0.32), 0.32);

        const hoverBoost = b.hover ? 0.07 : 0;
        const sx = 1 + b.sqx + hoverBoost;
        const sy = 1 + b.sqy + hoverBoost;
        const rot = b.rot0 + Math.sin(time * b.rotFreq + b.phase) * 1.8 + b.vx * 0.012;

        b.el.style.transform = `translate3d(${(b.cx - b.w / 2).toFixed(2)}px, ${(b.cy - b.h / 2).toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      }
    };

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min((t - last) / 1000, 0.033);
      last = t;
      if (dt > 0) stepCore(dt);
    };

    const onPointerMove = (e: PointerEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
    };
    const onPointerLeave = () => {
      mouseRef.current.active = false;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerLeave, { passive: true });

    // Manual advance hook (headless verification / debugging).
    (window as Window & { __crashoutTick?: (ms: number) => void }).__crashoutTick = (ms) => {
      const steps = Math.max(1, Math.ceil(ms / 16.67));
      for (let i = 0; i < steps; i++) stepCore(0.01667);
    };

    raf = requestAnimationFrame((t) => {
      last = t;
      raf = requestAnimationFrame(step);
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerLeave);
      delete (window as Window & { __crashoutTick?: (ms: number) => void }).__crashoutTick;
    };
  }, [poolSize, mode]);

  const indices = useMemo(() => Array.from({ length: poolSize }, (_, i) => i), [poolSize]);

  return (
    <div className="wall" aria-hidden="true">
      {indices.map((i) => (
        <div
          key={i}
          className="bubble"
          ref={(el) => {
            if (!el) {
              bodiesRef.current[i] = null;
              return;
            }
            const textEl = el.querySelector<HTMLSpanElement>(".rant-text")!;
            bodiesRef.current[i] = {
              el,
              textEl,
              cx: -9999,
              cy: -9999,
              vx: 0,
              vy: 0,
              w: 100,
              h: 40,
              baseVy: -(20 + Math.random() * 26),
              phase: Math.random() * Math.PI * 2,
              wanderFreq: 0.3 + Math.random() * 0.6,
              rot0: (Math.random() - 0.5) * 5,
              rotFreq: 0.4 + Math.random() * 0.7,
              sqx: 0,
              sqy: 0,
              svx: 0,
              svy: 0,
              hover: false,
              hasText: false,
            };
          }}
          onPointerEnter={() => {
            const b = bodiesRef.current[i];
            if (b) {
              b.hover = true;
              b.el.classList.add("front");
            }
          }}
          onPointerLeave={() => {
            const b = bodiesRef.current[i];
            if (b) {
              b.hover = false;
              b.el.classList.remove("front");
            }
          }}
        >
          <span className="rant-text" />
        </div>
      ))}
    </div>
  );
});

export default RantWall;
