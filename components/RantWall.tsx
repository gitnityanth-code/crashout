"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { Rant } from "@/lib/store";

export interface RantWallHandle {
  /** Mark a freshly submitted rant so it bursts in from the form. */
  spawn: (rant: Rant) => void;
}

interface Body {
  id: string;
  el: HTMLDivElement | null;
  x: number; // world-space center
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  placed: boolean;
  measured: boolean;
  fresh: boolean;
  phase: number;
  wanderFreq: number;
  rot0: number;
  rotFreq: number;
  rot: number;
  sqx: number;
  sqy: number;
  svx: number;
  svy: number;
  hover: boolean;
}

/** Hard ceiling on simulated/rendered rants. Newest win. */
const MAX_BODIES = 300;
/** Extra world width beyond the viewport — 40% sideways travel. */
const WORLD_W_FACTOR = 1.4;
/** Anamorphic horizontal stretch in the wide global view. */
const ANAMORPHIC = 1.08;

const VARIANTS = [
  "v-glass",
  "v-glass",
  "v-pill",
  "v-inverse",
  "v-marker",
  "v-outline",
  "v-stamp",
  "v-tape",
];

const hashStr = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const sizeClass = (text: string) =>
  text.length < 42 ? "size-l" : text.length < 130 ? "size-m" : "size-s";

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

interface Props {
  rants: Rant[];
  globalView: boolean;
}

const RantWall = forwardRef<RantWallHandle, Props>(function RantWall(
  { rants, globalView },
  ref
) {
  const visible = rants.slice(0, MAX_BODIES);

  const bodiesRef = useRef<Map<string, Body>>(new Map());
  const orderRef = useRef<string[]>([]);
  const worldElRef = useRef<HTMLDivElement>(null);
  const wallElRef = useRef<HTMLDivElement>(null);
  const freshRef = useRef<Set<string>>(new Set());
  const globalViewRef = useRef(globalView);
  globalViewRef.current = globalView;

  // world + camera live in refs: physics must never trigger React renders
  const worldRef = useRef({ w: 1200, h: 800 });
  const camRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  // current (smoothed) and target view transform
  const viewRef = useRef({ tx: 0, ty: 0, sx: 1, sy: 1 });
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const dragRef = useRef({ on: false, px: 0, py: 0, moved: false });

  useImperativeHandle(ref, () => ({
    spawn(rant) {
      freshRef.current.add(rant.id);
    },
  }));

  /** Viewport-derived world size. ~10 rants fill a standard screen (6 on phones). */
  const recomputeWorld = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const n = Math.max(orderRef.current.length, 1);
    // how many rants a standard (non-global) screenful should hold
    const perScreen = vw < 640 ? 4.5 : 10;
    const w = vw * WORLD_W_FACTOR;
    const h = Math.max(vh, (n * vh) / (perScreen * WORLD_W_FACTOR));
    worldRef.current = { w, h };
    const el = worldElRef.current;
    if (el) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  }, []);

  /* ---------------- body lifecycle ---------------- */

  /**
   * Get-or-create a body. Must be callable from the ref callback: React attaches
   * refs BEFORE layout effects run, so the body has to exist at ref time or the
   * element handle is lost and the rant never joins the simulation.
   */
  const ensureBody = useCallback((id: string): Body => {
    const map = bodiesRef.current;
    const existing = map.get(id);
    if (existing) return existing;
    const seed = hashStr(id);
    const b: Body = {
      id,
      el: null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      w: 180,
      h: 54,
      placed: false,
      measured: false,
      fresh: freshRef.current.has(id),
      phase: (seed % 628) / 100,
      wanderFreq: 0.18 + ((seed >> 3) % 40) / 100,
      rot0: (((seed >> 5) % 100) / 100 - 0.5) * 4.4,
      rotFreq: 0.25 + ((seed >> 7) % 35) / 100,
      rot: 0,
      sqx: 0,
      sqy: 0,
      svx: 0,
      svy: 0,
      hover: false,
    };
    map.set(id, b);
    return b;
  }, []);

  // Drop bodies whose rants are gone; keep draw order in sync.
  const syncBodies = useCallback(() => {
    const map = bodiesRef.current;
    const ids = visible.map((r) => r.id);
    const idSet = new Set(ids);
    for (const id of [...map.keys()]) if (!idSet.has(id)) map.delete(id);
    for (const id of ids) ensureBody(id);
    orderRef.current = ids;
  }, [visible, ensureBody]);

  /** Rotation-aware half extents so bubbles bounce on real visual contact. */
  const halfExtents = (b: Body) => {
    const a = (b.rot * Math.PI) / 180;
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    return {
      hw: (b.w * ca + b.h * sa) / 2,
      hh: (b.w * sa + b.h * ca) / 2,
    };
  };

  // Measure freshly-mounted bubbles and drop them into the world.
  useLayoutEffect(() => {
    syncBodies();
    recomputeWorld();

    const map = bodiesRef.current;
    const order = orderRef.current;
    const { w: WW, h: WH } = worldRef.current;
    const vw = window.innerWidth;

    const unplaced: Body[] = [];
    order.forEach((id) => {
      const b = map.get(id);
      if (!b || !b.el) return;
      if (!b.measured) {
        b.w = b.el.offsetWidth || b.w;
        b.h = b.el.offsetHeight || b.h;
        b.measured = true;
      }
      if (!b.placed) unplaced.push(b);
    });
    if (unplaced.length === 0) return;

    // Jittered grid keyed to position in the archive: newest near the top.
    const avgW = 210;
    const cols = Math.max(2, Math.floor(WW / (avgW + 34)));
    const rows = Math.max(1, Math.ceil(order.length / cols));
    const cellW = WW / cols;
    const cellH = WH / rows;

    for (const b of unplaced) {
      const i = order.indexOf(b.id);
      if (b.fresh) {
        // burst in from the rant form (screen top-centre) into world space
        const v = viewRef.current;
        b.x = clamp(
          (vw / 2 - v.tx) / v.sx + (Math.random() - 0.5) * 90,
          b.w / 2 + 6,
          WW - b.w / 2 - 6
        );
        b.y = clamp((230 - v.ty) / v.sy, b.h / 2 + 6, WH - b.h / 2 - 6);
        b.vx = (Math.random() - 0.5) * 70;
        b.vy = 46;
        b.sqx = -0.26;
        b.svx = 2.1;
        freshRef.current.delete(b.id);
        b.fresh = false;
      } else {
        const col = i % cols;
        const row = Math.floor(i / cols);
        b.x = clamp(
          (col + 0.5) * cellW + (Math.random() - 0.5) * cellW * 0.45,
          b.w / 2 + 6,
          WW - b.w / 2 - 6
        );
        b.y = clamp(
          (row + 0.5) * cellH + (Math.random() - 0.5) * cellH * 0.45,
          b.h / 2 + 6,
          WH - b.h / 2 - 6
        );
        b.vx = (Math.random() - 0.5) * 16;
        b.vy = (Math.random() - 0.5) * 16;
      }
      b.placed = true;
    }
  });

  /* ---------------- input ---------------- */

  useEffect(() => {
    const wall = wallElRef.current;
    if (!wall) return;

    const onWheel = (e: WheelEvent) => {
      if (globalViewRef.current) return; // whole world already in frame
      e.preventDefault();
      const cam = camRef.current;
      const { w: WW, h: WH } = worldRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (e.shiftKey) cam.tx += e.deltaY;
      else {
        cam.tx += e.deltaX;
        cam.ty += e.deltaY;
      }
      cam.tx = clamp(cam.tx, 0, Math.max(0, WW - vw));
      cam.ty = clamp(cam.ty, 0, Math.max(0, WH - vh));
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY, active: true };
      const d = dragRef.current;
      if (!d.on || globalViewRef.current) return;
      const cam = camRef.current;
      const { w: WW, h: WH } = worldRef.current;
      cam.tx = clamp(cam.tx - (e.clientX - d.px), 0, Math.max(0, WW - window.innerWidth));
      cam.ty = clamp(cam.ty - (e.clientY - d.py), 0, Math.max(0, WH - window.innerHeight));
      d.px = e.clientX;
      d.py = e.clientY;
      d.moved = true;
    };
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".rant-form, .masthead, .ui-chrome")) return;
      dragRef.current = { on: true, px: e.clientX, py: e.clientY, moved: false };
      wall.classList.add("dragging");
    };
    const endDrag = () => {
      dragRef.current.on = false;
      wall.classList.remove("dragging");
    };
    const onPointerOut = () => {
      pointerRef.current.active = false;
    };

    wall.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    wall.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", endDrag, { passive: true });
    window.addEventListener("pointercancel", endDrag, { passive: true });
    window.addEventListener("pointerout", onPointerOut, { passive: true });
    return () => {
      wall.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      wall.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("pointerout", onPointerOut);
    };
  }, []);

  /* ---------------- simulation ---------------- */

  useEffect(() => {
    // `?motion=off` is the only thing that freezes the wall. An OS
    // reduced-motion preference gentles the drift instead of killing it —
    // a frozen wall reads as a broken page.
    const params = new URLSearchParams(window.location.search);
    const motion = params.get("motion");
    const frozen = motion === "off";
    const calm =
      motion === "full"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    recomputeWorld();
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        recomputeWorld();
        const { w: WW, h: WH } = worldRef.current;
        for (const b of bodiesRef.current.values()) {
          b.x = clamp(b.x, b.w / 2 + 6, WW - b.w / 2 - 6);
          b.y = clamp(b.y, b.h / 2 + 6, WH - b.h / 2 - 6);
        }
        const cam = camRef.current;
        cam.tx = clamp(cam.tx, 0, Math.max(0, WW - window.innerWidth));
        cam.ty = clamp(cam.ty, 0, Math.max(0, WH - window.innerHeight));
      }, 200);
    };
    window.addEventListener("resize", onResize);

    const drift = calm ? 0.32 : 1;
    let raf = 0;
    let last = performance.now();
    let time = 0;

    const stepCore = (dt: number) => {
      time += dt;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { w: WW, h: WH } = worldRef.current;
      const bodies: Body[] = [];
      for (const id of orderRef.current) {
        const b = bodiesRef.current.get(id);
        if (b && b.el && b.placed) bodies.push(b);
      }

      /* ---- camera: smooth follow, then resolve the view transform ---- */
      const cam = camRef.current;
      const view = viewRef.current;
      let targetTx: number;
      let targetTy: number;
      let targetSx: number;
      let targetSy: number;
      if (globalViewRef.current) {
        const z = Math.min(vw / (WW * ANAMORPHIC), vh / WH) * 0.94;
        targetSx = z * ANAMORPHIC;
        targetSy = z;
        targetTx = (vw - WW * targetSx) / 2;
        targetTy = (vh - WH * targetSy) / 2;
      } else {
        cam.x += (cam.tx - cam.x) * Math.min(1, 12 * dt);
        cam.y += (cam.ty - cam.y) * Math.min(1, 12 * dt);
        targetSx = 1;
        targetSy = 1;
        targetTx = -cam.x;
        targetTy = -cam.y;
      }
      const k = Math.min(1, 7 * dt);
      view.tx += (targetTx - view.tx) * k;
      view.ty += (targetTy - view.ty) * k;
      view.sx += (targetSx - view.sx) * k;
      view.sy += (targetSy - view.sy) * k;
      const worldEl = worldElRef.current;
      if (worldEl) {
        worldEl.style.transform = `translate3d(${view.tx.toFixed(2)}px, ${view.ty.toFixed(2)}px, 0) scale(${view.sx.toFixed(4)}, ${view.sy.toFixed(4)})`;
      }

      if (frozen || bodies.length === 0) return;

      /* ---- per-body forces ---- */
      const p = pointerRef.current;
      const pwx = (p.x - view.tx) / view.sx;
      const pwy = (p.y - view.ty) / view.sy;

      for (const b of bodies) {
        b.vx += Math.sin(time * b.wanderFreq + b.phase) * 7 * drift * dt;
        b.vy += Math.cos(time * b.wanderFreq * 0.85 + b.phase * 1.3) * 7 * drift * dt;
        // viscosity: keeps the field lazy instead of pinballing
        b.vx -= b.vx * 0.5 * dt;
        b.vy -= b.vy * 0.5 * dt;

        if (p.active && !calm && !b.hover) {
          const dx = b.x - pwx;
          const dy = b.y - pwy;
          const d2 = dx * dx + dy * dy;
          const R = 165;
          if (d2 < R * R) {
            const d = Math.sqrt(Math.max(d2, 400));
            const f = (1 - d / R) * 300;
            b.vx += (dx / d) * f * dt;
            b.vy += (dy / d) * f * dt;
          }
        }

        const speedScale = b.hover ? 0.12 : 1;
        b.x += b.vx * speedScale * dt;
        b.y += b.vy * speedScale * dt;

        // world walls — nothing ever leaves the archive
        const { hw, hh } = halfExtents(b);
        if (b.x - hw < 0) {
          b.x = hw;
          b.vx = Math.abs(b.vx) * 0.62 + 4;
          b.svx += 1.1;
        } else if (b.x + hw > WW) {
          b.x = WW - hw;
          b.vx = -Math.abs(b.vx) * 0.62 - 4;
          b.svx += 1.1;
        }
        if (b.y - hh < 0) {
          b.y = hh;
          b.vy = Math.abs(b.vy) * 0.62 + 4;
          b.svy += 1.1;
        } else if (b.y + hh > WH) {
          b.y = WH - hh;
          b.vy = -Math.abs(b.vy) * 0.62 - 4;
          b.svy += 1.1;
        }
      }

      /* ---- collisions: uniform grid broad phase, contact-exact narrow phase ---- */
      const CELL = 220;
      const grid = new Map<number, Body[]>();
      const cols = Math.max(1, Math.ceil(WW / CELL));
      for (const b of bodies) {
        const cx = clamp(Math.floor(b.x / CELL), 0, cols - 1);
        const cy = Math.max(0, Math.floor(b.y / CELL));
        const key = cy * cols + cx;
        const cell = grid.get(key);
        if (cell) cell.push(b);
        else grid.set(key, [b]);
      }

      const seen = new Set<Body>();
      for (const b of bodies) {
        const cx = clamp(Math.floor(b.x / CELL), 0, cols - 1);
        const cy = Math.max(0, Math.floor(b.y / CELL));
        seen.add(b);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || nx >= cols || ny < 0) continue;
            const cell = grid.get(ny * cols + nx);
            if (!cell) continue;
            for (const c of cell) {
              if (c === b || seen.has(c)) continue;

              const A = halfExtents(b);
              const B = halfExtents(c);
              const dx = c.x - b.x;
              const dy = c.y - b.y;
              // contact only — no padding, they must actually touch
              const ox2 = A.hw + B.hw - Math.abs(dx);
              const oy2 = A.hh + B.hh - Math.abs(dy);
              if (ox2 <= 0 || oy2 <= 0) continue;

              let nxn = 0;
              let nyn = 0;
              let overlap: number;
              if (ox2 < oy2) {
                nxn = dx >= 0 ? 1 : -1;
                overlap = ox2;
              } else {
                nyn = dy >= 0 ? 1 : -1;
                overlap = oy2;
              }

              const ma = b.w * b.h;
              const mc = c.w * c.h;
              const wa = mc / (ma + mc);
              const wc = ma / (ma + mc);
              const sep = overlap * 0.52;
              b.x -= nxn * sep * wa;
              b.y -= nyn * sep * wa;
              c.x += nxn * sep * wc;
              c.y += nyn * sep * wc;

              const rel = (c.vx - b.vx) * nxn + (c.vy - b.vy) * nyn;
              if (rel < 0) {
                const j = -rel * 0.9 + 12;
                b.vx -= nxn * j * wa;
                b.vy -= nyn * j * wa;
                c.vx += nxn * j * wc;
                c.vy += nyn * j * wc;

                if (!calm) {
                  const impact = Math.min(Math.abs(rel) / 170, 1) * 0.5 + 0.1;
                  if (nxn !== 0) {
                    b.svx -= impact * 2.3;
                    b.svy += impact * 1.4;
                    c.svx -= impact * 2.3;
                    c.svy += impact * 1.4;
                  } else {
                    b.svy -= impact * 2.3;
                    b.svx += impact * 1.4;
                    c.svy -= impact * 2.3;
                    c.svx += impact * 1.4;
                  }
                }
              }
            }
          }
        }
      }

      /* ---- integrate squash + render ---- */
      const cullPad = 160;
      for (const b of bodies) {
        const sp = Math.hypot(b.vx, b.vy);
        const cap = 150 * drift + 40;
        if (sp > cap) {
          b.vx *= cap / sp;
          b.vy *= cap / sp;
        }

        b.svx += (-90 * b.sqx - 9 * b.svx) * dt;
        b.svy += (-90 * b.sqy - 9 * b.svy) * dt;
        b.sqx = clamp(b.sqx + b.svx * dt, -0.26, 0.26);
        b.sqy = clamp(b.sqy + b.svy * dt, -0.26, 0.26);

        b.rot = b.rot0 + Math.sin(time * b.rotFreq + b.phase) * (calm ? 0.5 : 1.5);

        // skip DOM writes for bubbles far outside the frame (standard view only)
        if (!globalViewRef.current) {
          const sx0 = b.x * view.sx + view.tx;
          const sy0 = b.y * view.sy + view.ty;
          if (
            sx0 < -cullPad ||
            sx0 > vw + cullPad ||
            sy0 < -cullPad ||
            sy0 > vh + cullPad
          ) {
            if (b.el!.style.visibility !== "hidden") b.el!.style.visibility = "hidden";
            continue;
          }
        }
        if (b.el!.style.visibility === "hidden") b.el!.style.visibility = "";

        const boost = b.hover ? 0.06 : 0;
        b.el!.style.transform = `translate3d(${(b.x - b.w / 2).toFixed(2)}px, ${(b.y - b.h / 2).toFixed(2)}px, 0) rotate(${b.rot.toFixed(2)}deg) scale(${(1 + b.sqx + boost).toFixed(3)}, ${(1 + b.sqy + boost).toFixed(3)})`;
      }
    };

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min((t - last) / 1000, 0.032);
      last = t;
      if (dt > 0) stepCore(dt);
    };
    raf = requestAnimationFrame((t) => {
      last = t;
      raf = requestAnimationFrame(step);
    });

    (window as Window & { __crashoutTick?: (ms: number) => void }).__crashoutTick = (
      ms
    ) => {
      const n = Math.max(1, Math.ceil(ms / 16.67));
      for (let i = 0; i < n; i++) stepCore(0.01667);
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      delete (window as Window & { __crashoutTick?: (ms: number) => void })
        .__crashoutTick;
    };
  }, [recomputeWorld]);

  return (
    <div className={`wall${globalView ? " global" : ""}`} ref={wallElRef}>
      <div className="world" ref={worldElRef}>
        {visible.map((r) => (
          <div
            key={r.id}
            className={`bubble ${VARIANTS[hashStr(r.id) % VARIANTS.length]} ${sizeClass(r.text)}`}
            ref={(el) => {
              ensureBody(r.id).el = el;
            }}
            onPointerEnter={() => {
              const b = bodiesRef.current.get(r.id);
              if (b) {
                b.hover = true;
                b.el?.classList.add("front");
              }
            }}
            onPointerLeave={() => {
              const b = bodiesRef.current.get(r.id);
              if (b) {
                b.hover = false;
                b.el?.classList.remove("front");
              }
            }}
          >
            <span className="rant-text">{r.text}</span>
          </div>
        ))}
      </div>
      {globalView && <div className="anamorphic-veil" aria-hidden="true" />}
    </div>
  );
});

export default RantWall;
