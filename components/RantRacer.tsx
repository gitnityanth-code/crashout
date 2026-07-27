"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Rant } from "@/lib/store";
import { Sfx } from "@/lib/game/audio";
import { Input, MILESTONES, Phase, Racer, RewardKind, Z_PLAYER, makeCam } from "@/lib/game/racer";
import { RenderCtx, fontFamilies, makeNoise, render } from "@/lib/game/render";
import { Sprite, fontsReady, makeSprite, makeTrafficSprites } from "@/lib/game/sprites";

/** physics substep — small enough that the render residual is invisible */
const STEP = 1 / 144;
const BEST_KEY = "crashout:run:best";

interface Props {
  rant: Rant;
  traffic: Rant[];
  onExit: () => void;
}

const readBest = () => {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeBest = (v: number) => {
  try {
    window.localStorage.setItem(BEST_KEY, String(Math.round(v)));
  } catch {
    // private mode — the run still counts, it just isn't remembered
  }
};

/** Each milestone band gets an equal slice of the bar so early progress reads. */
function barPct(score: number) {
  let lo = 0;
  for (let i = 0; i < MILESTONES.length; i++) {
    const hi = MILESTONES[i];
    if (score < hi) return ((i + (score - lo) / (hi - lo)) / MILESTONES.length) * 100;
    lo = hi;
  }
  return 100;
}

export default function RantRacer({ rant, traffic, onExit }: Props) {
  // Frozen at mount: the wall keeps polling behind us and a fresh array
  // identity must never tear down a race in progress.
  const [playerText] = useState(() => rant.text);
  const [pool] = useState(() => {
    const t = traffic.map((r) => r.text).filter((x) => x && x !== rant.text);
    return (t.length ? t : [rant.text]).slice(0, 18);
  });

  const [booted, setBooted] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(true);
  const [coarse, setCoarse] = useState(false);
  const [best, setBest] = useState(0);
  const [result, setResult] = useState({
    score: 0,
    dodges: 0,
    crashes: 0,
    rewards: [] as RewardKind[],
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const racerRef = useRef<Racer | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const inputRef = useRef<Input>({
    left: false,
    right: false,
    up: false,
    down: false,
    touchX: null,
  });
  const pausedRef = useRef(false);
  const soundRef = useRef(true);
  const phaseRef = useRef<Phase>("ready");
  const bestRef = useRef(0);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  // HUD nodes are written to directly — the game loop never re-renders React
  const scoreRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const levelRef = useRef<HTMLSpanElement>(null);
  const livesRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const buffRef = useRef<HTMLDivElement>(null);

  /* ---------------- controls (stable, used from inside the loop) ---------------- */

  const togglePause = useCallback(() => {
    if (racerRef.current?.s.phase !== "running") return;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  const begin = useCallback(() => {
    const r = racerRef.current;
    if (!r || r.s.phase !== "ready") return;
    sfxRef.current?.resume();
    sfxRef.current?.setEnabled(soundRef.current);
    pausedRef.current = false;
    setPaused(false);
    r.start();
  }, []);

  const restart = useCallback(() => {
    const r = racerRef.current;
    if (!r) return;
    sfxRef.current?.resume();
    sfxRef.current?.setEnabled(soundRef.current);
    r.reset();
    r.start();
    pausedRef.current = false;
    setPaused(false);
    phaseRef.current = "running";
    setPhase("running");
  }, []);

  const toggleSound = useCallback(() => {
    soundRef.current = !soundRef.current;
    sfxRef.current?.setEnabled(soundRef.current);
    setSound(soundRef.current);
  }, []);

  useEffect(() => {
    try {
      setCoarse(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      setCoarse(false);
    }
  }, []);

  /* ---------------- boot: sprites, engine, loop ---------------- */

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let dispose = () => {};

    bestRef.current = readBest();
    setBest(bestRef.current);

    (async () => {
      await fontsReady();
      // The effect may already have been torn down (StrictMode double-mounts).
      // Everything past this point is synchronous, so this is the only gap.
      if (!alive) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;

      const sfx = new Sfx(soundRef.current);
      sfxRef.current = sfx;

      const playerSprite: Sprite = makeSprite(playerText, "player");
      const sprites = makeTrafficSprites(pool);

      let cam = makeCam(window.innerWidth, window.innerHeight);
      const racer = new Racer({
        cam,
        sprites,
        texts: pool,
        playerSprite,
        playerText,
        sfx,
      });
      racerRef.current = racer;

      const rc: RenderCtx = { ctx, cam, noise: null, dpr: 1, ...fontFamilies() };

      const fit = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cam = makeCam(w, h);
        rc.cam = cam;
        rc.dpr = dpr;
        rc.noise = makeNoise(ctx);
        racer.resize(cam);
      };
      fit();

      let resizeT = 0;
      const onResize = () => {
        window.clearTimeout(resizeT);
        resizeT = window.setTimeout(fit, 120);
      };
      // A `resize` event isn't always enough: mobile browsers hide the URL bar
      // without firing one reliably, and embedded panes may not fire it at all.
      // Watching the element itself catches every case.
      const ro =
        typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
      ro?.observe(canvas.parentElement ?? canvas);

      /* ---- keyboard ---- */
      const inp = inputRef.current;
      const L = ["ArrowLeft", "KeyA"];
      const R = ["ArrowRight", "KeyD"];
      const U = ["ArrowUp", "KeyW"];
      const D = ["ArrowDown", "KeyS"];
      const SWALLOW = new Set([...L, ...R, ...U, ...D, "Space", "Enter"]);

      const setKey = (code: string, on: boolean) => {
        if (L.includes(code)) inp.left = on;
        else if (R.includes(code)) inp.right = on;
        else if (U.includes(code)) inp.up = on;
        else if (D.includes(code)) inp.down = on;
        else return false;
        inp.touchX = null; // keys win over a stale drag
        return true;
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (SWALLOW.has(e.code)) e.preventDefault();
        if (e.repeat) return;
        if (setKey(e.code, true)) return;

        const ph = racer.s.phase;
        if (e.code === "Escape") {
          if (ph === "running" && !pausedRef.current) togglePause();
          else exitRef.current();
        } else if (e.code === "KeyP") {
          togglePause();
        } else if (e.code === "KeyM") {
          toggleSound();
        } else if (e.code === "KeyR") {
          if (ph !== "ready") restart();
        } else if (e.code === "Space" || e.code === "Enter") {
          if (ph === "ready") begin();
          else if (ph === "over" || ph === "won") restart();
          else if (pausedRef.current) togglePause();
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (SWALLOW.has(e.code)) e.preventDefault();
        setKey(e.code, false);
      };

      /* ---- drag steering: relative, so a thumb never covers the bubble ---- */
      let dragging = false;
      let engaged = false;
      let anchorPx = 0;
      let anchorX = 0;
      const gain = () => (Z_PLAYER / cam.focal) * 1.45;

      const onDown = (e: PointerEvent) => {
        dragging = true;
        engaged = false;
        anchorPx = e.clientX;
        anchorX = racer.s.player.x;
        canvas.setPointerCapture?.(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        const d = e.clientX - anchorPx;
        // a stray click shouldn't pin the steering
        if (!engaged && Math.abs(d) < 5) return;
        engaged = true;
        inp.touchX = anchorX + d * gain();
      };
      const onUp = () => {
        dragging = false;
        engaged = false;
        inp.touchX = null;
      };

      const idle = () => {
        inp.left = inp.right = inp.up = inp.down = false;
        inp.touchX = null;
        dragging = false;
        engaged = false;
        if (racer.s.phase === "running" && !pausedRef.current) togglePause();
      };
      const onVisibility = () => {
        if (document.visibilityState === "hidden") idle();
      };

      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onUp, { passive: true });
      window.addEventListener("blur", idle);
      document.addEventListener("visibilitychange", onVisibility);

      dispose = () => {
        ro?.disconnect();
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", idle);
        document.removeEventListener("visibilitychange", onVisibility);
        window.clearTimeout(resizeT);
      };

      /* ---- HUD, written straight to the DOM ---- */
      let lastScore = -1;
      let lastLives = -1;
      let lastLevel = -1;
      let lastSpeed = -1;
      let lastBuff = " ";

      const syncHud = () => {
        const s = racer.s;
        const sc = Math.floor(s.score);
        if (sc !== lastScore) {
          lastScore = sc;
          if (scoreRef.current) scoreRef.current.textContent = String(sc);
          if (barRef.current) barRef.current.style.width = `${barPct(s.score).toFixed(2)}%`;
        }
        const sp = Math.round(s.speed * 0.62);
        if (sp !== lastSpeed) {
          lastSpeed = sp;
          if (speedRef.current) speedRef.current.textContent = String(sp);
        }
        if (s.lives !== lastLives) {
          lastLives = s.lives;
          const host = livesRef.current;
          if (host) {
            host.replaceChildren();
            for (let i = 0; i < 3; i++) {
              const d = document.createElement("i");
              d.className = i < s.lives ? "life on" : "life";
              host.appendChild(d);
            }
          }
        }
        if (s.level !== lastLevel) {
          lastLevel = s.level;
          if (levelRef.current) levelRef.current.textContent = String(s.level + 1);
        }
        const buff = [
          s.player.shield ? "SHIELD" : "",
          s.slomo > 0 ? `SLO-MO ${s.slomo.toFixed(1)}` : "",
          s.multT > 0 ? `SCORE ×2 ${Math.ceil(s.multT)}` : "",
        ]
          .filter(Boolean)
          .join("  ·  ");
        if (buff !== lastBuff) {
          lastBuff = buff;
          if (buffRef.current) buffRef.current.textContent = buff;
        }
      };

      /** Phase transitions: end-of-run bookkeeping, then hand it to React. */
      const syncPhase = () => {
        const s = racer.s;
        if (s.phase === phaseRef.current) return;
        phaseRef.current = s.phase;
        if (s.phase === "over" || s.phase === "won") {
          const sc = Math.floor(s.score);
          if (sc > bestRef.current) {
            bestRef.current = sc;
            writeBest(sc);
            setBest(sc);
          }
          setResult({
            score: sc,
            dodges: s.dodges,
            crashes: s.crashes,
            rewards: [...s.rewards],
          });
        }
        setPhase(s.phase);
      };

      /* ---- the loop ---- */
      let last = performance.now();
      let acc = 0;

      const frame = (t: number) => {
        raf = requestAnimationFrame(frame);
        let dt = (t - last) / 1000;
        last = t;
        if (!Number.isFinite(dt) || dt < 0) dt = 0;
        if (dt > 0.25) dt = 0.25; // back from a hidden tab / a long GC

        if (!pausedRef.current) {
          acc += dt;
          let n = 0;
          while (acc >= STEP && n < 12) {
            racer.step(STEP, inp);
            acc -= STEP;
            n++;
            if (racer.s.phase !== "running") {
              acc = 0;
              break;
            }
          }
          if (n >= 12) acc = 0; // never spiral on a slow machine
          racer.stepFx(dt);
        }

        render(rc, racer.s, sprites, playerSprite);
        syncHud();
        syncPhase();
      };
      raf = requestAnimationFrame((t) => {
        last = t;
        raf = requestAnimationFrame(frame);
      });

      /**
       * Headless test hook. This machine's browser pane reports
       * prefers-reduced-motion + hidden, so rAF never fires there and the game
       * can't be verified by watching it. This advances the simulation
       * deterministically instead, exactly as the loop would.
       */
      const dbg = window as Window & {
        __run?: Record<string, unknown>;
      };
      dbg.__run = {
        tick(ms: number, over?: Partial<Input>) {
          if (over) Object.assign(inp, over);
          const n = Math.max(1, Math.ceil(ms / 1000 / STEP));
          for (let i = 0; i < n; i++) {
            racer.step(STEP, inp);
            racer.stepFx(STEP);
          }
          render(rc, racer.s, sprites, playerSprite);
          syncHud();
          syncPhase();
        },
        start: () => racer.start(),
        reset: () => racer.reset(),
        set: (patch: Record<string, unknown>) => Object.assign(racer.s, patch),
        input: (over: Partial<Input>) => Object.assign(inp, over),
        state: () => {
          const s = racer.s;
          return {
            phase: s.phase,
            score: s.score,
            level: s.level,
            lives: s.lives,
            speed: s.speed,
            playerX: s.player.x,
            waves: s.waves.length,
            letters: s.letters.length,
            crashes: s.crashes,
            dodges: s.dodges,
            rewards: [...s.rewards],
          };
        },
        waves: () =>
          racer.s.waves.map((w) => ({
            z: w.z,
            vz: w.vz,
            ghost: w.ghosting ? w.ghost : 1,
            reward: w.reward,
            items: w.items
              .filter((o) => !o.dead)
              .map((o) => ({ lane: o.lane, x: o.x, w: o.w })),
          })),
        cam: () => ({ ...cam }),
      };

      const prevDispose = dispose;
      dispose = () => {
        prevDispose();
        delete dbg.__run;
      };

      setBooted(true);
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      dispose();
      sfxRef.current?.close();
      sfxRef.current = null;
      racerRef.current = null;
    };
  }, [playerText, pool, begin, restart, togglePause, toggleSound]);

  const ended = phase === "over" || phase === "won";

  return (
    <div className="racer" role="application" aria-label="Crashout Run">
      <canvas ref={canvasRef} className="racer-canvas" />

      {/* ---------------- HUD ---------------- */}
      <div className={`racer-hud${phase === "ready" || ended ? " dim" : ""}`}>
        <div className="hud-tl">
          <span className="hud-label">SCORE</span>
          <span className="hud-score" ref={scoreRef}>
            0
          </span>
          <span className="hud-best">BEST {best}</span>
        </div>

        <div className="hud-tr">
          <div className="hud-lives" ref={livesRef}>
            <i className="life on" />
            <i className="life on" />
            <i className="life on" />
          </div>
          <span className="hud-label">
            LEVEL <b ref={levelRef}>1</b>
          </span>
          <span className="hud-label">
            <b ref={speedRef}>0</b> KPH
          </span>
        </div>

        <div className="hud-buffs" ref={buffRef} />

        <div className="hud-bar">
          <div className="hud-bar-fill" ref={barRef} />
          {MILESTONES.map((m, i) => (
            <span
              key={m}
              className="hud-tick"
              style={{ left: `${((i + 1) / MILESTONES.length) * 100}%` }}
            >
              {m}
            </span>
          ))}
        </div>
      </div>

      {/* ---------------- the crash freeze ---------------- */}
      {phase === "crash" && (
        <div className="crash-card" aria-live="assertive">
          <span className="crash-word">CRASHOUTT</span>
          <span className="crash-sub">that one hurt</span>
        </div>
      )}

      {/* ---------------- start card ---------------- */}
      {phase === "ready" && (
        <div className="racer-card">
          <span className="rc-kicker">GAME MODE</span>
          <h2 className="rc-title">CRASHOUT RUN</h2>
          <p className="rc-lead">your racer</p>
          <blockquote className="rc-rant">{playerText}</blockquote>
          <div className="rc-keys">
            <span>
              <b>A</b><b>D</b> or <b>←</b><b>→</b> &nbsp;steer
            </span>
            <span>
              <b>W</b><b>S</b> or <b>↑</b><b>↓</b> &nbsp;throttle
            </span>
            <span>
              <b>P</b> pause · <b>M</b> mute · <b>ESC</b> quit
            </span>
            {coarse && <span className="rc-touch">or drag anywhere to steer</span>}
          </div>
          <div className="rc-row">
            <button className="rc-go" onClick={begin} disabled={!booted}>
              {booted ? "START" : "LOADING…"}
            </button>
            <button className="rc-quiet" onClick={onExit}>
              back to the wall
            </button>
          </div>
          <p className="rc-note">dodge everyone else&apos;s rage. 1500 clears the wall.</p>
        </div>
      )}

      {/* ---------------- pause ---------------- */}
      {paused && phase === "running" && (
        <div className="racer-card small">
          <h2 className="rc-title">PAUSED</h2>
          <div className="rc-row">
            <button className="rc-go" onClick={togglePause}>
              RESUME
            </button>
            <button className="rc-quiet" onClick={onExit}>
              quit
            </button>
          </div>
        </div>
      )}

      {/* ---------------- end cards ---------------- */}
      {ended && (
        <div className="racer-card">
          <span className="rc-kicker">{phase === "won" ? "1500 — CLEARED" : "RUN OVER"}</span>
          <h2 className={`rc-title${phase === "won" ? " win" : ""}`}>
            {phase === "won" ? "WALL CLEARED" : "YOU CRASHED OUT"}
          </h2>
          <div className="rc-stats">
            <div>
              <b>{result.score}</b>
              <span>SCORE</span>
            </div>
            <div>
              <b>{result.dodges}</b>
              <span>NEAR MISSES</span>
            </div>
            <div>
              <b>{result.crashes}</b>
              <span>CRASHES</span>
            </div>
            <div>
              <b>{best}</b>
              <span>BEST</span>
            </div>
          </div>
          {result.rewards.length > 0 && (
            <div className="rc-rewards">
              {result.rewards.map((r, i) => (
                <span key={`${r}-${i}`} className="rc-badge">
                  {r}
                </span>
              ))}
            </div>
          )}
          <div className="rc-row">
            <button className="rc-go" onClick={restart}>
              RUN IT BACK
            </button>
            <button className="rc-quiet" onClick={onExit}>
              back to the wall
            </button>
          </div>
        </div>
      )}

      {/* ---------------- chrome ---------------- */}
      <div className="racer-chrome">
        <button className="rc-mini" onClick={toggleSound} aria-pressed={sound}>
          {sound ? "SOUND ON" : "SOUND OFF"}
        </button>
        {phase === "running" && (
          <button className="rc-mini" onClick={togglePause}>
            {paused ? "RESUME" : "PAUSE"}
          </button>
        )}
        <button className="rc-mini" onClick={onExit}>
          QUIT
        </button>
      </div>
    </div>
  );
}
