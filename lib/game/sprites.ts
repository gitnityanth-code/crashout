/**
 * Rant bubbles, baked once into offscreen canvases.
 *
 * The racer draws every bubble hundreds of times a second at wildly different
 * depths. Re-running text wrapping + rounded rects + gradients every frame
 * would be the single biggest cost in the game, so each rant becomes a sprite
 * exactly once and the loop is reduced to one drawImage per bubble.
 *
 * Sprites are rasterised at SS× logical size so they stay crisp when a bubble
 * rushes past the camera.
 */

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** full canvas size in logical px — includes the glow padding */
  fullW: number;
  fullH: number;
  /** the visual box inside the canvas: what collides and casts a shadow */
  coreW: number;
  coreH: number;
  padX: number;
  padY: number;
}

/** supersample factor — sprites are drawn small and occasionally huge */
const SS = 2.4;
/** logical width of a bubble's core box before perspective scaling */
const CORE_W = 190;
const PAD = 26;

const FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** next/font only exposes its generated family through a CSS variable. */
function famFrom(varName: string): string {
  if (typeof document === "undefined") return FALLBACK;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return v ? `${v}, ${FALLBACK}` : FALLBACK;
}

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const raw of words) {
    // a single monster word still has to fit — chop it
    let word = raw;
    while (ctx.measureText(word).width > maxW && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxW) cut--;
      if (lines.length >= maxLines - 1) break;
      if (line) {
        lines.push(line);
        line = "";
        if (lines.length >= maxLines) break;
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;

    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === 0) lines.push("…");

  // ellipsis the last line if we ran out of room
  const consumed = lines.join(" ");
  if (consumed.length < text.replace(/\s+/g, " ").trim().length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

export type SpriteKind = "glass" | "outline" | "inverse" | "stamp" | "player";

interface Look {
  fill: string | null;
  stroke: string | null;
  strokeW: number;
  radius: number;
  text: string;
  font: (size: number) => string;
  size: number;
  upper: boolean;
  track: number;
  glow: number;
  bold: boolean;
}

function look(kind: SpriteKind): Look {
  const bodyFam = famFrom("--font-body");
  const dispFam = famFrom("--font-display");
  switch (kind) {
    case "outline":
      return {
        fill: "rgba(0,0,0,0.72)",
        stroke: "rgba(255,255,255,0.92)",
        strokeW: 2.6,
        radius: 13,
        text: "#ffffff",
        font: (s) => `600 ${s}px ${bodyFam}`,
        size: 15,
        upper: false,
        track: 0,
        glow: 16,
        bold: false,
      };
    case "inverse":
      return {
        fill: "#ffffff",
        stroke: null,
        strokeW: 0,
        radius: 6,
        text: "#000000",
        font: (s) => `700 ${s}px ${bodyFam}`,
        size: 15,
        upper: false,
        track: 0,
        glow: 22,
        bold: true,
      };
    case "stamp":
      return {
        fill: "rgba(0,0,0,0.55)",
        stroke: "rgba(255,255,255,0.85)",
        strokeW: 3,
        radius: 2,
        text: "#ffffff",
        font: (s) => `400 ${s}px ${dispFam}`,
        size: 12.5,
        upper: true,
        track: 0.9,
        glow: 14,
        bold: false,
      };
    case "player":
      return {
        fill: "#ffffff",
        stroke: null,
        strokeW: 0,
        radius: 11,
        text: "#000000",
        font: (s) => `700 ${s}px ${bodyFam}`,
        size: 14.5,
        upper: false,
        track: 0,
        glow: 34,
        bold: true,
      };
    default:
      return {
        fill: "rgba(255,255,255,0.10)",
        stroke: "rgba(255,255,255,0.55)",
        strokeW: 1.6,
        radius: 17,
        text: "#ffffff",
        font: (s) => `500 ${s}px ${bodyFam}`,
        size: 15,
        upper: false,
        track: 0,
        glow: 18,
        bold: false,
      };
  }
}

/** Bake one rant into a sprite. */
export function makeSprite(text: string, kind: SpriteKind): Sprite {
  const L = look(kind);
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = L.font(L.size);

  const innerW = CORE_W - 26;
  const body = L.upper ? text.toUpperCase() : text;
  const maxLines = kind === "player" ? 4 : 3;
  const lines = wrap(measure, body, innerW - L.track * 6, maxLines);

  const lineH = L.size * 1.34;
  const coreH = Math.round(lines.length * lineH + 21);
  const coreW = CORE_W;
  const fullW = coreW + PAD * 2;
  const fullH = coreH + PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(fullW * SS);
  canvas.height = Math.ceil(fullH * SS);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SS, SS);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const x = PAD;
  const y = PAD;

  // outer glow — sold as light bleeding off a sticker
  if (L.glow > 0) {
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = L.glow;
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    rrect(ctx, x, y, coreW, coreH, L.radius);
    ctx.fill();
    ctx.restore();
  }

  if (L.fill) {
    if (kind === "glass") {
      const g = ctx.createLinearGradient(x, y, x + coreW * 0.7, y + coreH);
      g.addColorStop(0, "rgba(255,255,255,0.15)");
      g.addColorStop(0.55, "rgba(255,255,255,0.045)");
      g.addColorStop(1, "rgba(255,255,255,0.02)");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = L.fill;
    }
    rrect(ctx, x, y, coreW, coreH, L.radius);
    ctx.fill();
  }

  if (L.stroke) {
    ctx.strokeStyle = L.stroke;
    ctx.lineWidth = L.strokeW;
    rrect(
      ctx,
      x + L.strokeW / 2,
      y + L.strokeW / 2,
      coreW - L.strokeW,
      coreH - L.strokeW,
      L.radius
    );
    ctx.stroke();
    if (kind === "stamp") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      rrect(ctx, x + 5.5, y + 5.5, coreW - 11, coreH - 11, 1);
      ctx.stroke();
    }
  }

  // top specular edge, the same trick the site's glass bubbles use
  if (kind === "glass" || kind === "outline") {
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + L.radius, y + 1.2);
    ctx.lineTo(x + coreW - L.radius, y + 1.2);
    ctx.stroke();
  }

  // player gets a keyline + a tab so you never lose yourself in traffic
  if (kind === "player") {
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.5;
    rrect(ctx, x + 4, y + 4, coreW - 8, coreH - 8, L.radius - 3);
    ctx.stroke();
  }

  ctx.fillStyle = L.text;
  ctx.font = L.font(L.size);
  const startY = y + (coreH - lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((ln, i) => {
    const ty = startY + i * lineH;
    if (L.track > 0) {
      // manual letter-spacing: ctx.letterSpacing isn't safe to rely on yet
      const chars = [...ln];
      const total =
        chars.reduce((a, c) => a + ctx.measureText(c).width, 0) +
        L.track * (chars.length - 1);
      let cx = x + coreW / 2 - total / 2;
      ctx.textAlign = "left";
      for (const c of chars) {
        ctx.fillText(c, cx, ty);
        cx += ctx.measureText(c).width + L.track;
      }
      ctx.textAlign = "center";
    } else {
      ctx.fillText(ln, x + coreW / 2, ty);
    }
  });

  return { canvas, fullW, fullH, coreW, coreH, padX: PAD, padY: PAD };
}

const TRAFFIC_KINDS: SpriteKind[] = [
  "glass",
  "glass",
  "outline",
  "stamp",
  "inverse",
  "outline",
];

export function makeTrafficSprites(texts: string[], limit = 18): Sprite[] {
  const out: Sprite[] = [];
  for (let i = 0; i < Math.min(texts.length, limit); i++) {
    out.push(makeSprite(texts[i], TRAFFIC_KINDS[i % TRAFFIC_KINDS.length]));
  }
  return out;
}

/** Fonts must be resolved before rasterising or sprites bake the fallback. */
export async function fontsReady(): Promise<void> {
  try {
    if (typeof document !== "undefined" && document.fonts) {
      await document.fonts.ready;
    }
  } catch {
    // font loading API missing — system fallback is fine
  }
}
