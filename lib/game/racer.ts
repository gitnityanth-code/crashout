/**
 * CRASHOUT RUN — the simulation.
 *
 * Pure logic: no DOM, no canvas, no React. `render.ts` draws whatever this
 * produces and `RantRacer.tsx` feeds it input. Keeping it separate is what
 * keeps React out of the 60fps path entirely.
 *
 * WORLD MODEL
 * -----------
 * A pinhole camera sits at (camX, camH, 0) looking down +z. The road is the
 * y=0 plane, ROAD_W wide, split into LANES lanes. The player is pinned at
 * z = Z_PLAYER and steers along x. Traffic spawns at Z_FAR and travels toward
 * the camera; screen size falls out of the projection, so a bubble genuinely
 * grows as it closes on you.
 *
 * THE PASSABILITY INVARIANT
 * -------------------------
 * Traffic spawns in *waves*: a set of bubbles sharing one z and one velocity,
 * so nothing inside a wave can drift into anything else inside it. Every wave
 * leaves at least one lane free; drift is clamped inside a bubble's own lane;
 * lane-switchers only ever move between lanes their wave already blocks; and a
 * wave can never close within Z_MIN_SEP of the wave ahead — it queues up
 * behind it like real traffic.
 *
 * Together those rules mean that at any instant, in any slice of road, there
 * is a gap at least one full lane wide. Difficulty can ramp as hard as it
 * likes and the game stays honestly winnable.
 */

import type { Sprite } from "./sprites";
import type { Sfx } from "./audio";

/* ------------------------------------------------------------------ *
 * geometry
 * ------------------------------------------------------------------ */

export const ROAD_W = 240;
export const LANES = 4;
export const LANE_W = ROAD_W / LANES;
export const Z_PLAYER = 90;
export const Z_FAR = 940;
export const Z_DESPAWN = 30;
/** absolute floor on wave separation, so packs never visually merge */
export const Z_MIN_SEP = 120;
/** hard cap so a backed-up queue can't grow without bound */
const MAX_WAVES = 10;

const HORIZON_F = 0.33;
const PLAYER_ROW_F = 0.845;

export const OBS_W = 46;
export const PLAYER_W = 38;
/** billboards have no thickness, so give them a nominal depth to collide with */
const OBS_D = 20;
const PLAYER_D = 22;
/** how far a bubble floats above the tarmac */
export const HOVER = 7;
/**
 * Top lateral speed and how hard you get there. Crossing the entire road
 * (202 units) takes ~0.9s flat out, which has to fit inside the smallest
 * gap between wave arrivals — see `tmin` in the level table.
 */
const STEER_MAX = 260;
const STEER_ACCEL = 1200;

export const MILESTONES = [100, 300, 700, 1500];
export const REWARDS = ["SHIELD", "SLO-MO", "DOUBLE"] as const;
export type RewardKind = (typeof REWARDS)[number];

export interface Cam {
  W: number;
  H: number;
  cx: number;
  horizonY: number;
  focal: number;
  /** camH * focal, pre-multiplied: ground row = horizonY + camHF / z */
  camHF: number;
}

export function makeCam(W: number, H: number): Cam {
  const roadPx = Math.min(W * 0.84, H * 0.95);
  const focal = (roadPx * Z_PLAYER) / ROAD_W;
  return {
    W,
    H,
    cx: W / 2,
    horizonY: H * HORIZON_F,
    focal,
    camHF: (PLAYER_ROW_F - HORIZON_F) * H * Z_PLAYER,
  };
}

/** ground row on screen for a distance z */
export const groundY = (cam: Cam, z: number) => cam.horizonY + cam.camHF / z;
/** px-per-world-unit at distance z */
export const scaleAt = (cam: Cam, z: number) => cam.focal / z;

export const laneCenter = (lane: number) => -ROAD_W / 2 + (lane + 0.5) * LANE_W;

/* ------------------------------------------------------------------ *
 * level tuning — each band is faster, denser and less predictable
 * ------------------------------------------------------------------ */

interface Level {
  base: number;
  max: number;
  gap: [number, number];
  blocked: [number, number];
  /** lateral wander, in lane widths */
  drift: number;
  /** chance a wave contains a lane-switcher */
  jink: number;
  /** how wildly wave speeds vary from the player's, as a fraction */
  vary: [number, number];
  /**
   * Minimum seconds between one wave reaching you and the next. This is the
   * fairness knob: it must exceed the time to cross the whole road, or the
   * game can deal a gap you physically cannot reach.
   */
  tmin: number;
}

/**
 * Speeds are set so a wave takes roughly 4–7 seconds to travel the 850 units
 * from the horizon to the player at level 1, tightening to 2–6 by level 4.
 * That window is the whole game: it's how long you get to read a wall of rage
 * and pick your gap.
 */
const LEVELS: Level[] = [
  { base: 175, max: 235, gap: [1.95, 2.55], blocked: [1, 1], drift: 0, jink: 0, vary: [-0.12, 0.3], tmin: 1.75 },
  { base: 210, max: 285, gap: [1.5, 2.1], blocked: [1, 2], drift: 0.055, jink: 0.12, vary: [-0.22, 0.4], tmin: 1.55 },
  { base: 255, max: 345, gap: [1.2, 1.75], blocked: [2, 3], drift: 0.085, jink: 0.3, vary: [-0.3, 0.48], tmin: 1.4 },
  { base: 300, max: 410, gap: [0.95, 1.45], blocked: [2, 3], drift: 0.1, jink: 0.45, vary: [-0.38, 0.55], tmin: 1.25 },
];

/** tuned so a clean run to 1500 lands a little over two minutes */
const SCORE_RATE = 0.025;
export const TOP_SPEED = 410;

export const levelFor = (score: number) =>
  score < MILESTONES[0] ? 0 : score < MILESTONES[1] ? 1 : score < MILESTONES[2] ? 2 : 3;

/* ------------------------------------------------------------------ *
 * entities
 * ------------------------------------------------------------------ */

export interface Obstacle {
  lane: number;
  x: number;
  /** index into Racer.sprites, or -1 for a reward token */
  sprite: number;
  text: string;
  w: number;
  h: number;
  drift: number;
  driftF: number;
  phase: number;
  /** lane to slide into, or -1. Always a lane this wave already blocks. */
  jinkTo: number;
  jinkZ: number;
  jinkT: number;
  jinkFrom: number;
  dead: boolean;
}

export interface Wave {
  z: number;
  prevZ: number;
  vz: number;
  items: Obstacle[];
  reward: RewardKind | null;
  /** counts 1 → 0 while fading out after a crash; no longer collides */
  ghost: number;
  ghosting: boolean;
  scored: boolean;
}

export interface Letter {
  ch: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  max: number;
  size: number;
  dark: boolean;
}

export interface Flash {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  big: boolean;
}

export type Phase = "ready" | "running" | "crash" | "over" | "won";

export interface Player {
  x: number;
  vx: number;
  lean: number;
  inv: number;
  shield: boolean;
}

export interface RacerState {
  phase: Phase;
  time: number;
  score: number;
  lives: number;
  level: number;
  speed: number;
  travel: number;
  player: Player;
  waves: Wave[];
  letters: Letter[];
  flashes: Flash[];
  rewards: RewardKind[];
  milestone: number;
  crashT: number;
  banner: { big: string; sub: string; life: number; max: number } | null;
  shake: number;
  camX: number;
  roll: number;
  bob: number;
  mult: number;
  multT: number;
  slomo: number;
  nextWave: number;
  dodges: number;
  crashes: number;
  /** 1 → 0 across the crash, drives the white blowout */
  flashWhite: number;
}

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** absolute steer target in world x from touch/drag, or null for keys */
  touchX: number | null;
}

/**
 * Debris budget. A crash sprays both bubbles, so the real peak is
 * 2 × LETTERS_PER_BURST; the cap only bites if something goes strange. Rotated,
 * alpha-blended glyphs are the most expensive thing the renderer does, and
 * these numbers keep even the worst frame in single-digit milliseconds on a
 * software canvas.
 */
const MAX_LETTERS = 240;
const LETTERS_PER_BURST = 64;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** how fast a wave is closing on the player, never zero or negative */
const approachOf = (vz: number, speed: number) => Math.max(20, speed - vz);

/**
 * The earliest z a wave may occupy while sitting behind `ahead`.
 *
 * Spacing traffic by distance isn't enough: a fast wave behind a slow one
 * arrives sooner than the gap suggests, and can deal you a lane change you
 * physically can't make. So the rule is stated in arrival *time* — this wave
 * may not reach the player until `tmin` after the one ahead does — with a
 * distance floor on top so packs never visually merge. Because it scales with
 * the player's own speed, flooring the throttle raises the stakes without ever
 * making the road unfair.
 */
function minZBehind(ahead: Wave, backVz: number, speed: number, tmin: number) {
  const tAhead = Math.max(0, ahead.z - Z_PLAYER) / approachOf(ahead.vz, speed);
  return Math.max(
    ahead.z + Z_MIN_SEP,
    Z_PLAYER + (tAhead + tmin) * approachOf(backVz, speed)
  );
}

export class Racer {
  s: RacerState;
  cam: Cam;
  sprites: Sprite[];
  texts: string[];
  playerSprite: Sprite;
  playerText: string;
  private sfx: Sfx | null;

  constructor(opts: {
    cam: Cam;
    sprites: Sprite[];
    texts: string[];
    playerSprite: Sprite;
    playerText: string;
    sfx: Sfx | null;
  }) {
    this.cam = opts.cam;
    this.sprites = opts.sprites;
    this.texts = opts.texts;
    this.playerSprite = opts.playerSprite;
    this.playerText = opts.playerText;
    this.sfx = opts.sfx;
    this.s = this.blank();
  }

  private blank(): RacerState {
    return {
      phase: "ready",
      time: 0,
      score: 0,
      lives: 3,
      level: 0,
      speed: LEVELS[0].base,
      travel: 0,
      player: { x: laneCenter(1), vx: 0, lean: 0, inv: 0, shield: false },
      waves: [],
      letters: [],
      flashes: [],
      rewards: [],
      milestone: 0,
      crashT: 0,
      banner: null,
      shake: 0,
      camX: 0,
      roll: 0,
      bob: 0,
      mult: 1,
      multT: 0,
      slomo: 0,
      nextWave: 1.2,
      dodges: 0,
      crashes: 0,
      flashWhite: 0,
    };
  }

  reset() {
    this.s = this.blank();
  }

  start() {
    this.s.phase = "running";
    this.banner("GO", "dodge the rage", 1.1);
    this.sfx?.go();
  }

  resize(cam: Cam) {
    this.cam = cam;
  }

  private banner(big: string, sub: string, life: number) {
    this.s.banner = { big, sub, life, max: life };
  }

  private lvl(): Level {
    return LEVELS[this.s.level];
  }

  /* ---------------- spawning ---------------- */

  /**
   * Build a wave: pick which lanes to block (always leaving one free), give it
   * a velocity, and drop it in at the back of the queue.
   */
  private spawnWave(reward: RewardKind | null) {
    const s = this.s;
    if (s.waves.length >= MAX_WAVES) return;
    const L = this.lvl();

    const lanes = [0, 1, 2, 3];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }

    const count = reward
      ? 1
      : clamp(Math.round(rand(L.blocked[0] - 0.49, L.blocked[1] + 0.49)), 1, LANES - 1);
    const chosen = lanes.slice(0, count);

    const items: Obstacle[] = [];
    if (reward) {
      items.push({
        lane: chosen[0],
        x: laneCenter(chosen[0]),
        sprite: -1,
        text: reward,
        w: 30,
        h: 30,
        drift: 0,
        driftF: 0,
        phase: 0,
        jinkTo: -1,
        jinkZ: 0,
        jinkT: 0,
        jinkFrom: chosen[0],
        dead: false,
      });
    } else {
      /*
       * Lane switchers. A switcher slides into a lane that this wave has
       * *reserved but left empty*, and only ever into an adjacent one.
       *
       * Both of those matter. An empty destination means it never lands on top
       * of another bubble; an adjacent one means its path can't sweep through
       * the free lane sitting between two blocked ones. Reserving the spare
       * costs an obstacle, so a switching wave is thinner but far less
       * predictable — which is the trade the later levels want.
       */
      let jinker = -1;
      let spare = -1;
      if (Math.random() < L.jink && chosen.length <= LANES - 2) {
        const options: [number, number][] = [];
        for (const lane of chosen) {
          for (const d of [-1, 1]) {
            const t = lane + d;
            if (t < 0 || t >= LANES || chosen.includes(t)) continue;
            // must still leave a lane open once the spare is reserved
            if (LANES - chosen.length - 1 < 1) continue;
            options.push([lane, t]);
          }
        }
        if (options.length) {
          [jinker, spare] = options[Math.floor(Math.random() * options.length)];
        }
      }
      for (const lane of chosen) {
        const si = this.sprites.length ? Math.floor(Math.random() * this.sprites.length) : 0;
        const spr = this.sprites[si];
        const jinkTo = lane === jinker ? spare : -1;
        items.push({
          lane,
          x: laneCenter(lane),
          sprite: si,
          text: this.texts[si] ?? "CRASH",
          w: OBS_W,
          h: spr ? (OBS_W * spr.coreH) / spr.coreW : 16,
          drift: L.drift * LANE_W * rand(0.5, 1),
          driftF: rand(0.5, 1.2),
          phase: rand(0, Math.PI * 2),
          jinkTo,
          jinkZ: rand(430, 640),
          jinkT: 0,
          jinkFrom: lane,
          dead: false,
        });
      }
    }

    // wave velocity along +z. Below the player's speed it closes on you; the
    // spread is what makes traffic arrive at genuinely unpredictable rates.
    const vary = reward ? ([0.1, 0.3] as const) : L.vary;
    const vz = s.speed * rand(vary[0], vary[1]);

    let z = Z_FAR;
    for (const w of s.waves) z = Math.max(z, minZBehind(w, vz, s.speed, L.tmin));
    // the road ahead is already full — skip rather than build a backlog
    if (!reward && z > Z_FAR + 600) return;

    s.waves.push({ z, prevZ: z, vz, items, reward, ghost: 0, ghosting: false, scored: false });
  }

  /* ---------------- main step (fixed timestep) ---------------- */

  step(dt: number, input: Input) {
    const s = this.s;
    if (s.phase !== "running") return;

    const L = this.lvl();
    s.time += dt;

    /* --- speed --- */
    const target = input.down ? L.base * 0.72 : input.up ? L.max : L.base;
    const rate = input.down ? 6 : 1.6;
    s.speed += (target - s.speed) * Math.min(1, rate * dt);
    s.speed = clamp(s.speed, L.base * 0.7, L.max);
    s.travel += s.speed * dt;

    /* --- steering: momentum, not teleporting --- */
    const p = s.player;
    const edge = ROAD_W / 2 - PLAYER_W / 2;
    if (input.touchX !== null) {
      const want = clamp(input.touchX, -edge, edge);
      p.vx += (want - p.x) * 60 * dt;
      p.vx *= 1 - Math.min(1, 8 * dt);
    } else {
      const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      if (dir !== 0) p.vx += dir * STEER_ACCEL * dt;
      else p.vx *= 1 - Math.min(1, 6.5 * dt);
    }
    p.vx = clamp(p.vx, -STEER_MAX, STEER_MAX);
    p.x += p.vx * dt;

    if (p.x < -edge) {
      p.x = -edge;
      p.vx = Math.abs(p.vx) * 0.25;
      s.shake = Math.max(s.shake, 3);
    } else if (p.x > edge) {
      p.x = edge;
      p.vx = -Math.abs(p.vx) * 0.25;
      s.shake = Math.max(s.shake, 3);
    }
    p.lean += (clamp(p.vx / STEER_MAX, -1, 1) - p.lean) * Math.min(1, 8 * dt);
    if (p.inv > 0) p.inv -= dt;

    /* --- camera rides with the player: most of the 3D feel lives here --- */
    s.camX += (p.x * 0.34 - s.camX) * Math.min(1, 5 * dt);
    s.roll += (-p.lean * 0.03 - s.roll) * Math.min(1, 5 * dt);
    s.bob = Math.sin(s.time * 5.5) * 1.2 * (s.speed / L.max);

    /* --- power-up timers --- */
    if (s.multT > 0) {
      s.multT -= dt;
      if (s.multT <= 0) s.mult = 1;
    }
    if (s.slomo > 0) s.slomo -= dt;

    /* --- traffic --- */
    const slow = s.slomo > 0 ? 0.45 : 1;
    for (const w of s.waves) {
      w.prevZ = w.z;
      w.z += (w.vz - s.speed * slow) * dt;
      if (w.ghosting) w.ghost -= dt * 1.7;
    }

    // queue discipline, near → far: nothing may crowd the wave ahead
    s.waves.sort((a, b) => a.z - b.z);
    for (let i = 1; i < s.waves.length; i++) {
      const ahead = s.waves[i - 1];
      const back = s.waves[i];
      const need = minZBehind(ahead, back.vz, s.speed, L.tmin);
      if (back.z < need) {
        // hold station. Position is clamped, not velocity — once the road
        // clears it resumes its own speed, so a jam never becomes permanent.
        back.z = need;
        back.prevZ = Math.max(back.prevZ, back.z);
      }
    }

    for (const w of s.waves) {
      for (const o of w.items) {
        if (o.dead) continue;
        let x = laneCenter(o.lane);
        if (o.jinkTo >= 0 && (o.jinkT > 0 || w.z < o.jinkZ)) {
          o.jinkT = Math.min(1, o.jinkT + dt * 1.15);
          const e = o.jinkT * o.jinkT * (3 - 2 * o.jinkT); // smoothstep
          x = laneCenter(o.jinkFrom) + (laneCenter(o.jinkTo) - laneCenter(o.jinkFrom)) * e;
          if (o.jinkT >= 1) {
            o.lane = o.jinkTo;
            o.jinkFrom = o.jinkTo;
            o.jinkTo = -1;
            o.jinkT = 0;
          }
        }
        // drift is clamped inside the lane, so a free lane stays fully free
        const room = Math.max(0, (LANE_W - o.w) / 2);
        o.x = x + clamp(Math.sin(s.time * o.driftF + o.phase) * o.drift, -room, room);
      }
    }

    if (this.collide()) return; // crashed — state already switched

    for (let i = s.waves.length - 1; i >= 0; i--) {
      const w = s.waves[i];
      if (w.z < Z_DESPAWN || (w.ghosting && w.ghost <= 0)) s.waves.splice(i, 1);
    }

    /* --- spawn cadence: faster driving means denser traffic --- */
    s.nextWave -= dt * (s.speed / L.base);
    if (s.nextWave <= 0) {
      this.spawnWave(null);
      s.nextWave = rand(L.gap[0], L.gap[1]);
    }

    /* --- score, levels, milestones --- */
    s.score += s.speed * SCORE_RATE * s.mult * dt;
    const lv = levelFor(s.score);
    if (lv !== s.level) {
      s.level = lv;
      s.nextWave = Math.min(s.nextWave, 0.9);
    }
    while (s.milestone < MILESTONES.length && s.score >= MILESTONES[s.milestone]) {
      const idx = s.milestone;
      s.milestone++;
      if (idx < REWARDS.length) {
        this.spawnWave(REWARDS[idx]);
        this.banner(`LEVEL ${idx + 2}`, `${REWARDS[idx]} INCOMING`, 2.1);
        this.sfx?.milestone();
      } else {
        s.phase = "won";
        s.banner = null;
        s.flashWhite = 1;
        this.sfx?.win();
        this.explodeText(this.playerText, this.cam.cx, this.cam.H * 0.5, 1.6, false);
      }
    }
  }

  /* ---------------- collision ---------------- */

  /** @returns true if the run ended this step */
  private collide(): boolean {
    const s = this.s;
    const p = s.player;
    const zEnter = Z_PLAYER + (OBS_D + PLAYER_D) / 2;
    const zExit = Z_PLAYER - (OBS_D + PLAYER_D) / 2;

    for (const w of s.waves) {
      // swept interval test in z: cannot tunnel, however fast the wave moves
      const lo = Math.min(w.prevZ, w.z);
      const hi = Math.max(w.prevZ, w.z);
      const inBand = hi >= zExit && lo <= zEnter;
      const cleared = !w.scored && w.z < zExit;
      if (!inBand && !cleared) continue;

      for (const o of w.items) {
        if (o.dead) continue;
        const gapX = Math.abs(o.x - p.x);
        const touch = (o.w + PLAYER_W) / 2;

        if (w.reward) {
          if (inBand && gapX < touch && !w.ghosting) {
            o.dead = true;
            this.takeReward(w.reward);
          }
          continue;
        }

        if (inBand && gapX < touch && !w.ghosting && p.inv <= 0) {
          this.crash(o, w);
          return true;
        }
        if (cleared && !w.ghosting) {
          if (gapX < touch * 1.5) {
            s.score += 8 * s.mult;
            s.dodges++;
            this.flash("NICE +8", false);
            this.sfx?.near();
          } else {
            s.score += 2 * s.mult;
          }
        }
      }
      if (cleared) w.scored = true;
    }
    return false;
  }

  private takeReward(kind: RewardKind) {
    const s = this.s;
    s.rewards.push(kind);
    this.sfx?.pickup();
    if (kind === "SHIELD") {
      s.player.shield = true;
      this.flash("SHIELD UP", true);
    } else if (kind === "SLO-MO") {
      s.slomo = 5;
      this.flash("SLO-MO", true);
    } else {
      s.mult = 2;
      s.multT = 14;
      this.flash("SCORE ×2", true);
    }
  }

  private crash(o: Obstacle, w: Wave) {
    const s = this.s;
    const p = s.player;

    // burn the shield first — a crash you paid for isn't a crash
    if (p.shield) {
      p.shield = false;
      p.inv = 1.6;
      s.shake = 14;
      s.slomo = Math.max(s.slomo, 1.2);
      o.dead = true;
      this.flash("SHIELD BURNED", true);
      this.sfx?.shield();
      this.explodeObstacle(o, w, 0.8);
      return;
    }

    s.crashes++;
    s.lives--;
    s.phase = "crash";
    s.crashT = 1.5;
    s.shake = 30;
    s.flashWhite = 1;
    s.mult = 1;
    s.multT = 0;
    s.slomo = 0;
    this.sfx?.crash();

    // both bubbles come apart, letter by letter
    this.explodeObstacle(o, w, 1);
    const ps = scaleAt(this.cam, Z_PLAYER);
    const spr = this.playerSprite;
    const pw = PLAYER_W * ps;
    const ph = (pw * spr.coreH) / spr.coreW;
    this.explodeText(
      this.playerText,
      this.cam.cx + (p.x - s.camX) * ps,
      groundY(this.cam, Z_PLAYER) - HOVER * ps - ph / 2,
      Math.max(0.9, pw / 150),
      true
    );
    o.dead = true;
  }

  /** Fade the road clear so you never respawn straight into a wall. */
  private clearAhead() {
    for (const w of this.s.waves) {
      if (w.z < 480 && !w.ghosting) {
        w.ghosting = true;
        w.ghost = 1;
      }
    }
  }

  private explodeObstacle(o: Obstacle, w: Wave, power: number) {
    const cam = this.cam;
    const z = Math.max(w.z, 40);
    const sc = scaleAt(cam, z);
    const sx = cam.cx + (o.x - this.s.camX) * sc;
    const h = o.h * sc;
    this.explodeText(
      o.text,
      sx,
      groundY(cam, z) - HOVER * sc - h / 2,
      Math.max(0.8, (o.w * sc) / 150) * power,
      false
    );
  }

  /** Blow a string apart into individual letters, in screen space. */
  explodeText(text: string, cx: number, cy: number, power: number, dark: boolean) {
    const s = this.s;
    const chars = [...text].filter((c) => c.trim().length > 0).slice(0, LETTERS_PER_BURST);
    const n = chars.length;
    if (n === 0) return;
    const spread = 44 * power;

    for (let i = 0; i < n; i++) {
      if (s.letters.length >= MAX_LETTERS) s.letters.shift();
      const a = (i / n) * Math.PI * 2 + rand(-0.35, 0.35);
      const sp = rand(110, 470) * power;
      s.letters.push({
        ch: chars[i],
        x: cx + Math.cos(a) * rand(0, spread),
        y: cy + Math.sin(a) * rand(0, spread * 0.6),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(70, 280) * power,
        rot: rand(-Math.PI, Math.PI),
        vrot: rand(-9, 9),
        life: rand(1.4, 2.6),
        max: 2.6,
        // integer sizes on purpose: the renderer groups glyphs by size so
        // `ctx.font` is parsed a dozen times a frame instead of 400
        size: Math.round(rand(13, 27) * Math.min(1.7, power)),
        dark,
      });
    }
  }

  flash(text: string, big: boolean) {
    const s = this.s;
    if (s.flashes.length > 14) s.flashes.shift();
    s.flashes.push({
      text,
      x: this.cam.cx + rand(-40, 40),
      y: this.cam.H * (big ? 0.42 : 0.66),
      life: big ? 1.5 : 0.95,
      max: big ? 1.5 : 0.95,
      big,
    });
  }

  /* ---------------- effects + phase timers (these always run) ---------------- */

  stepFx(dt: number) {
    const s = this.s;
    const H = this.cam.H;

    for (let i = s.letters.length - 1; i >= 0; i--) {
      const l = s.letters[i];
      l.life -= dt;
      if (l.life <= 0) {
        s.letters.splice(i, 1);
        continue;
      }
      l.vy += 640 * dt;
      l.vx *= 1 - Math.min(1, 0.9 * dt);
      l.vy *= 1 - Math.min(1, 0.35 * dt);
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.rot += l.vrot * dt;
      // one bounce off the floor so they scatter instead of vanishing
      if (l.y > H - 6 && l.vy > 0) {
        l.y = H - 6;
        l.vy *= -0.36;
        l.vx *= 0.7;
        l.vrot *= 0.5;
      }
    }

    for (let i = s.flashes.length - 1; i >= 0; i--) {
      const f = s.flashes[i];
      f.life -= dt;
      f.y -= 46 * dt;
      if (f.life <= 0) s.flashes.splice(i, 1);
    }

    if (s.banner) {
      s.banner.life -= dt;
      if (s.banner.life <= 0) s.banner = null;
    }

    s.shake *= 1 - Math.min(1, 3.4 * dt);
    if (s.shake < 0.05) s.shake = 0;
    if (s.flashWhite > 0) s.flashWhite = Math.max(0, s.flashWhite - dt * 2.6);

    if (s.phase === "crash") {
      s.crashT -= dt;
      if (s.crashT <= 0) {
        if (s.lives <= 0) {
          s.phase = "over";
          this.sfx?.over();
        } else {
          s.phase = "running";
          s.player.inv = 2;
          s.player.vx = 0;
          s.speed = LEVELS[s.level].base * 0.8;
          this.clearAhead();
          s.nextWave = Math.max(s.nextWave, 1.2);
          this.banner(`${s.lives} LEFT`, "back on it", 1.2);
        }
      }
    }
  }
}
