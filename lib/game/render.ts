/**
 * CRASHOUT RUN — the renderer.
 *
 * Draws whatever `racer.ts` produced. White and black only, same as the wall.
 *
 * The road is drawn as exact perspective trapezoids between stripe boundaries
 * rather than per-scanline bands: the boundaries come straight out of the
 * projection, so stripes shrink continuously into the horizon and nothing ever
 * pops or shimmers, at a fraction of the fill cost.
 */

import {
  Cam,
  HOVER,
  LANE_W,
  LANES,
  Letter,
  PLAYER_W,
  ROAD_W,
  RacerState,
  TOP_SPEED,
  Z_FAR,
  Z_PLAYER,
  groundY,
  scaleAt,
} from "./racer";
import type { Sprite } from "./sprites";

const STRIPE = 26;
const RUMBLE = 13;
const POST_EVERY = 78;
const POST_H = 34;
const POST_X = ROAD_W / 2 + 30;

const FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  cam: Cam;
  noise: CanvasPattern | null;
  /** device pixel ratio baked into the context's base transform */
  dpr: number;
  dispFam: string;
  bodyFam: string;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function fontFamilies() {
  const get = (n: string) => {
    const v =
      typeof document !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue(n).trim()
        : "";
    return v ? `${v}, ${FALLBACK}` : FALLBACK;
  };
  return { dispFam: get("--font-display"), bodyFam: get("--font-body") };
}

/** One repeating noise tile, built once per resize. */
export function makeNoise(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const n = document.createElement("canvas");
  n.width = 128;
  n.height = 128;
  const nc = n.getContext("2d");
  if (!nc) return null;
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 40 + Math.random() * 215;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  return ctx.createPattern(n, "repeat");
}

const roadX = (cam: Cam, x: number, camX: number, z: number) =>
  cam.cx + ((x - camX) * cam.focal) / z;

function quad(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.lineTo(dx, dy);
  ctx.closePath();
  ctx.fill();
}

/* ------------------------------------------------------------------ */

function drawSky(r: RenderCtx, s: RacerState) {
  const { ctx, cam } = r;
  const hy = cam.horizonY;

  const g = ctx.createLinearGradient(0, 0, 0, hy);
  g.addColorStop(0, "#000000");
  g.addColorStop(0.72, "#050505");
  g.addColorStop(1, "#131313");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.W, hy + 1);

  // bloom sitting on the vanishing point
  const vx = cam.cx - s.camX * 0.06;
  const bloom = ctx.createRadialGradient(vx, hy, 0, vx, hy, cam.W * 0.42);
  bloom.addColorStop(0, "rgba(255,255,255,0.16)");
  bloom.addColorStop(0.4, "rgba(255,255,255,0.05)");
  bloom.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, cam.W, hy + 2);

  // spray-dot starfield, deterministic so it never crawls
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  for (let i = 0; i < 46; i++) {
    const sx = ((i * 173.13) % 1000) / 1000;
    const sy = ((i * 91.7) % 1000) / 1000;
    const px = ((sx * cam.W * 1.4 - s.camX * 0.8 - cam.W * 0.2) % cam.W + cam.W) % cam.W;
    ctx.fillRect(px, sy * hy * 0.86, 1.4, 1.4);
  }

  // ghost graffiti on the skyline
  const words: [string, number, number, number][] = [
    ["CRASHOUT", 0.16, 0.30, 0.10],
    ["NO BRAKES", 0.62, 0.50, 0.17],
    ["LET IT OUT", 0.30, 0.68, 0.24],
  ];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const [w, fx, fy, par] of words) {
    ctx.font = `400 ${Math.round(cam.H * 0.085)}px ${r.dispFam}`;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    ctx.strokeText(w, cam.W * fx - s.camX * par, hy * (0.28 + fy * 0.6));
  }
  ctx.restore();

  // horizon line
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.fillRect(0, hy - 0.5, cam.W, 1);
}

function drawRoad(r: RenderCtx, s: RacerState) {
  const { ctx, cam } = r;
  const camX = s.camX;
  const travel = s.travel;

  // z at (just past) the bottom edge of the screen
  const zNear = Math.max(38, cam.camHF / (cam.H * 1.08 - cam.horizonY));
  const zFar = Z_FAR + 90;

  const mStart = Math.floor((zNear + travel) / STRIPE);
  const mEnd = Math.ceil((zFar + travel) / STRIPE);

  const half = ROAD_W / 2;
  const laneXs: number[] = [];
  for (let i = 1; i < LANES; i++) laneXs.push(-half + i * LANE_W);

  for (let m = mStart; m < mEnd; m++) {
    let z0 = m * STRIPE - travel;
    let z1 = (m + 1) * STRIPE - travel;
    if (z1 <= zNear || z0 >= zFar) continue;
    z0 = Math.max(z0, zNear);
    z1 = Math.min(z1, zFar);
    if (z1 - z0 < 0.001) continue;

    const y0 = groundY(cam, z0);
    const y1 = groundY(cam, z1);
    const l0 = roadX(cam, -half, camX, z0);
    const r0 = roadX(cam, half, camX, z0);
    const l1 = roadX(cam, -half, camX, z1);
    const r1 = roadX(cam, half, camX, z1);
    const alt = ((m % 2) + 2) % 2 === 0;

    // tarmac
    ctx.fillStyle = alt ? "rgba(255,255,255,0.052)" : "rgba(255,255,255,0.024)";
    quad(ctx, l0, y0, r0, y0, r1, y1, l1, y1);

    // rumble strips
    const rl0 = roadX(cam, -half - RUMBLE, camX, z0);
    const rl1 = roadX(cam, -half - RUMBLE, camX, z1);
    const rr0 = roadX(cam, half + RUMBLE, camX, z0);
    const rr1 = roadX(cam, half + RUMBLE, camX, z1);
    ctx.fillStyle = alt ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.10)";
    quad(ctx, rl0, y0, l0, y0, l1, y1, rl1, y1);
    quad(ctx, r0, y0, rr0, y0, rr1, y1, r1, y1);

    // lane dashes, on every other stripe
    if (alt) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (const lx of laneXs) {
        const a0 = roadX(cam, lx - 0.9, camX, z0);
        const b0 = roadX(cam, lx + 0.9, camX, z0);
        const a1 = roadX(cam, lx - 0.9, camX, z1);
        const b1 = roadX(cam, lx + 0.9, camX, z1);
        quad(ctx, a0, y0, b0, y0, b1, y1, a1, y1);
      }
    }
  }

  // posts flying past — the strongest speed cue there is
  const pStart = Math.floor((zNear + travel) / POST_EVERY);
  const pEnd = Math.ceil((zFar + travel) / POST_EVERY);
  for (let m = pStart; m < pEnd; m++) {
    const z = m * POST_EVERY - travel;
    if (z < zNear || z > zFar) continue;
    const sc = scaleAt(cam, z);
    const gy = groundY(cam, z);
    const h = POST_H * sc;
    const w = Math.max(1, 4 * sc);
    const a = clamp((Z_FAR - z) / 400 + 0.25, 0, 0.85);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    const lx = roadX(cam, -POST_X, camX, z);
    const rx = roadX(cam, POST_X, camX, z);
    ctx.fillRect(lx - w / 2, gy - h, w, h);
    ctx.fillRect(rx - w / 2, gy - h, w, h);
    // a crossbar so they read as structure, not confetti
    ctx.fillRect(lx - w * 1.6, gy - h, w * 3.2, Math.max(1, w * 0.7));
    ctx.fillRect(rx - w * 1.6, gy - h, w * 3.2, Math.max(1, w * 0.7));
  }
}

/** Soft pool of light under a floating bubble — sells the levitation. */
function shadowPool(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  alpha: number
) {
  const rx = Math.max(2, w * 0.55);
  const ry = Math.max(1.2, w * 0.15);
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(255,255,255,${(0.3 * alpha).toFixed(3)})`);
  g.addColorStop(0.55, `rgba(255,255,255,${(0.09 * alpha).toFixed(3)})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a bubble sprite as a billboard standing on the road, with a lean
 * proportional to how far off-axis it is. That lean is what makes a flat
 * sprite read as a real object seen through a wide lens.
 */
function billboard(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  spr: Sprite,
  sx: number,
  bottomY: number,
  worldW: number,
  sc: number,
  alpha: number,
  extraRot = 0
) {
  const pxPerSprite = (worldW * sc) / spr.coreW;
  const coreWpx = spr.coreW * pxPerSprite;
  const coreHpx = spr.coreH * pxPerSprite;
  if (coreWpx < 1.5 || alpha <= 0.01) return;

  const lean = ((sx - cam.cx) / (cam.W * 0.5)) * 0.11;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, bottomY);
  if (extraRot) ctx.rotate(extraRot);
  // shear: points above the base slide outward with height
  ctx.transform(1, 0, lean, 1, 0, 0);
  ctx.drawImage(
    spr.canvas,
    -coreWpx / 2 - spr.padX * pxPerSprite,
    -coreHpx - spr.padY * pxPerSprite,
    spr.fullW * pxPerSprite,
    spr.fullH * pxPerSprite
  );
  ctx.restore();
}

function drawRewardToken(
  r: RenderCtx,
  s: RacerState,
  x: number,
  z: number,
  label: string
) {
  const { ctx, cam } = r;
  const sc = scaleAt(cam, z);
  const sx = roadX(cam, x, s.camX, z);
  const gy = groundY(cam, z);
  const size = 30 * sc;
  if (size < 2) return;
  const cy = gy - (HOVER + 20) * sc - Math.sin(s.time * 3) * 4 * sc;
  const spin = Math.cos(s.time * 3.4);
  const a = clamp((Z_FAR - z) / 240 + 0.2, 0, 1);

  shadowPool(ctx, sx, gy, size * 1.1, a);

  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(sx, cy);
  ctx.scale(Math.max(0.14, Math.abs(spin)), 1);

  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = size * 0.7;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.62);
  ctx.lineTo(size * 0.5, 0);
  ctx.lineTo(0, size * 0.62);
  ctx.lineTo(-size * 0.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.3);
  ctx.lineTo(size * 0.24, 0);
  ctx.lineTo(0, size * 0.3);
  ctx.lineTo(-size * 0.24, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (size > 14) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `400 ${Math.round(size * 0.34)}px ${r.dispFam}`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.fillText(label, sx, cy + size * 1.05);
    ctx.restore();
  }
}

function drawTraffic(r: RenderCtx, s: RacerState, sprites: Sprite[]) {
  const { ctx, cam } = r;
  // painter's algorithm: far to near
  const order = [...s.waves].sort((a, b) => b.z - a.z);

  for (const w of order) {
    if (w.z <= 1) continue;
    const fade = w.ghosting ? Math.max(0, w.ghost) : 1;
    if (fade <= 0) continue;
    const sc = scaleAt(cam, w.z);
    const gy = groundY(cam, w.z);
    const depthA = clamp((Z_FAR - w.z) / 240 + 0.18, 0, 1);

    for (const o of w.items) {
      if (o.dead) continue;
      if (w.reward) {
        drawRewardToken(r, s, o.x, w.z, o.text);
        continue;
      }
      const spr = sprites[o.sprite];
      if (!spr) continue;
      const sx = roadX(cam, o.x, s.camX, w.z);
      const alpha = depthA * fade;
      shadowPool(ctx, sx, gy, o.w * sc, alpha);
      billboard(ctx, cam, spr, sx, gy - HOVER * sc, o.w, sc, alpha);
    }
  }
}

function drawPlayer(r: RenderCtx, s: RacerState, spr: Sprite) {
  const { ctx, cam } = r;
  const p = s.player;
  const sc = scaleAt(cam, Z_PLAYER);
  const sx = roadX(cam, p.x, s.camX, Z_PLAYER);
  const gy = groundY(cam, Z_PLAYER);

  // blink through the invulnerability window
  const blink = p.inv > 0 && Math.floor(s.time * 14) % 2 === 0;

  shadowPool(ctx, sx, gy, PLAYER_W * sc, 1);

  if (p.shield) {
    const rr = PLAYER_W * sc * 0.95;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${(0.35 + Math.sin(s.time * 7) * 0.2).toFixed(3)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(sx, gy - (HOVER + 16) * sc, rr, rr * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (!blink) {
    billboard(
      ctx,
      cam,
      spr,
      sx,
      gy - HOVER * sc,
      PLAYER_W,
      sc,
      1,
      p.lean * 0.075
    );
  }

  // thrust streaks behind the bubble
  const t = s.speed / TOP_SPEED;
  ctx.save();
  ctx.globalAlpha = 0.25 + t * 0.4;
  ctx.fillStyle = "#ffffff";
  for (let i = -1; i <= 1; i += 2) {
    const w = 2.4 * sc;
    const h = (12 + t * 30) * sc * (0.6 + Math.random() * 0.7);
    ctx.fillRect(sx + i * PLAYER_W * 0.3 * sc - w / 2, gy - HOVER * sc * 0.4, w, h);
  }
  ctx.restore();
}

function drawSpeedLines(r: RenderCtx, s: RacerState) {
  const { ctx, cam } = r;
  const t = clamp((s.speed - 200) / 220, 0, 1);
  if (t <= 0.02) return;
  const vx = cam.cx - s.camX * 0.06;
  const vy = cam.horizonY;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${(t * 0.22).toFixed(3)})`;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + s.time * 0.35;
    const r0 = cam.W * (0.34 + ((i * 37) % 100) / 320);
    const r1 = r0 + cam.W * (0.1 + t * 0.16);
    ctx.beginPath();
    ctx.moveTo(vx + Math.cos(a) * r0, vy + Math.sin(a) * r0 * 0.8);
    ctx.lineTo(vx + Math.cos(a) * r1, vy + Math.sin(a) * r1 * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** reused across frames so the hot path allocates nothing */
const letterBuckets = new Map<number, Letter[]>();

/**
 * Exploded letters, grouped by size.
 *
 * Setting `ctx.font` re-parses the whole shorthand — including the long
 * next/font family list — and with a few hundred glyphs on screen that alone
 * cost ~75ms a frame. Sizes are integers (see `explodeText`) so a whole
 * explosion collapses into a handful of font switches.
 */
function drawLetters(r: RenderCtx, s: RacerState) {
  const { ctx } = r;
  if (s.letters.length === 0) return;

  for (const arr of letterBuckets.values()) arr.length = 0;
  for (const l of s.letters) {
    let arr = letterBuckets.get(l.size);
    if (!arr) {
      arr = [];
      letterBuckets.set(l.size, arr);
    }
    arr.push(l);
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const [size, group] of letterBuckets) {
    if (group.length === 0) continue;
    ctx.font = `700 ${size}px ${r.bodyFam}`;
    const tile = size * 0.86;
    for (const l of group) {
      ctx.globalAlpha = clamp(l.life / 0.8, 0, 1);
      ctx.setTransform(r.dpr, 0, 0, r.dpr, l.x * r.dpr, l.y * r.dpr);
      ctx.rotate(l.rot);
      if (l.dark) {
        // a chip off the white player sticker: white tile, black ink
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-tile / 2, -size * 0.6, tile, size * 1.2);
        ctx.fillStyle = "#000000";
      } else {
        ctx.fillStyle = "#ffffff";
      }
      ctx.fillText(l.ch, 0, 0);
    }
  }
  ctx.restore(); // puts the base dpr transform back
}

function drawFlashes(r: RenderCtx, s: RacerState) {
  const { ctx } = r;
  if (s.flashes.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of s.flashes) {
    const k = f.life / f.max;
    const a = clamp(k * 1.6, 0, 1);
    const size = f.big ? 30 : 17;
    ctx.globalAlpha = a;
    ctx.font = `400 ${size}px ${r.dispFam}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

function drawOverlay(r: RenderCtx, s: RacerState) {
  const { ctx, cam } = r;

  // vignette
  const g = ctx.createRadialGradient(
    cam.cx,
    cam.H * 0.52,
    cam.H * 0.28,
    cam.cx,
    cam.H * 0.52,
    Math.max(cam.W, cam.H) * 0.78
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.W, cam.H);

  if (r.noise) {
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = "overlay";
    ctx.translate(Math.random() * 128, Math.random() * 128);
    ctx.fillStyle = r.noise;
    ctx.fillRect(-128, -128, cam.W + 256, cam.H + 256);
    ctx.restore();
  }

  if (s.flashWhite > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(s.flashWhite * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, cam.W, cam.H);
  }
}

/* ------------------------------------------------------------------ */

export function render(
  r: RenderCtx,
  s: RacerState,
  sprites: Sprite[],
  playerSprite: Sprite
) {
  const { ctx, cam } = r;
  ctx.clearRect(0, 0, cam.W, cam.H);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, cam.W, cam.H);

  ctx.save();
  // camera roll + crash shake wrap the whole world, not the HUD
  if (s.roll !== 0) {
    ctx.translate(cam.cx, cam.horizonY);
    ctx.rotate(s.roll);
    ctx.translate(-cam.cx, -cam.horizonY);
  }
  if (s.shake > 0.05) {
    ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
  }
  ctx.translate(0, s.bob);

  drawSky(r, s);
  drawRoad(r, s);
  drawSpeedLines(r, s);
  drawTraffic(r, s, sprites);
  if (s.phase !== "over" && s.phase !== "won") drawPlayer(r, s, playerSprite);
  ctx.restore();

  drawLetters(r, s);
  drawFlashes(r, s);
  drawOverlay(r, s);
}
