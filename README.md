# CRASHOUT — the anonymous wall of rage

Type a rant. Throw it at the wall. Watch it float, drift, and **crash into everyone
else's rage** like rubber blobs. No names, no logins, black & white, spray-paint attitude.

Then hit **RACE THE WALL**, pick any rant, and drive it down a pseudo-3D road while
everyone else's rage comes at you. See [CRASHOUT RUN](#crashout-run-the-game-mode).

Built with Next.js (App Router, TypeScript). Zero runtime dependencies beyond React.

---

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without a database configured it runs on an in-memory
store — perfect for dev, but rants reset on restart. Nothing is ever seeded: the
wall shows real user rants only, so a fresh local store starts empty.

## Deploy to Vercel (production)

1. Push this folder to a GitHub repo and **Import** it in Vercel (framework
   auto-detects as Next.js — no settings needed).
2. **Add Redis for persistence** — in your Vercel project: *Storage → Create →
   Upstash Redis* (free tier is plenty). This injects `KV_REST_API_URL` /
   `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)
   automatically — the app detects either pair, no code changes.
3. Redeploy. Done — rants now persist forever (ring buffer keeps the freshest
   2,000; the all-time counter keeps counting).

> Skipping step 2 still works, but serverless instances lose rants on cold
> starts. For a public launch, add Redis.

## Why it holds 500–1k concurrent users

- **Reads are CDN-cached**: `GET /api/rants` sends `s-maxage=8`, so Vercel's edge
  serves nearly all polling traffic — roughly one origin hit per 8 seconds per
  region, no matter how many people are watching.
- **Writes are rate-limited per IP** (1 per 15 s, 30/hour) and Redis ops are O(1)
  list pushes.
- **The client is light**: ~108 kB first load, physics is a pooled DOM engine
  (8–24 bubbles) at 60 fps, `requestAnimationFrame` pauses in background tabs.

## The moderation framework (`lib/moderation.ts`)

Runs **server-side on every submission** — the client can't bypass it. Layers, in order:

1. **Sanitize** — strips control/zero-width characters, caps at 280 chars.
2. **Normalize for matching** — lowercase, de-accent, de-leet (`k!ll` → `kill`),
   punctuation stripping, letter-spacing collapse (`f a g g o t` → caught).
3. **PII / doxxing** — emails, phone-length digit runs, street addresses.
4. **Links** — no URLs, no spam.
5. **Slurs** — blocklist with evasion-resistant matching (word-boundary aware so
   *raccoon*, *Pakistan*, "chink in the armour" pass).
6. **Sexual violence & exploitation** — always blocked.
7. **Self-harm** — first-person crisis language is never displayed; the user gets
   a supportive response with helplines (Samaritans 116 123 UK · 988 US) instead
   of a rejection.
8. **Threats** — severity-, intent-, and target-aware. Venting is allowed
   ("I wanna slap him so bad"); committed intent at a person is not ("imma slap
   him"); severe violence is blocked even as a wish ("I want to kill my ex").
   ~40 idioms are cleared first, so "this traffic is killing me" and "I could
   murder a curry" sail through. Negations are shielded ("I would never hurt you").
9. **Site-negativity** — the wall does not host rants about the wall. 😌

Plus: duplicate suppression, a bot honeypot field, and strict XSS safety (rant
text is only ever rendered via `textContent` / React escaping — never HTML).

**Test it:** `npm run test:moderation` (95 cases covering allow/block/evasion).
Tune lexicons and thresholds at the top of `lib/moderation.ts`.

## CRASHOUT RUN — the game mode

`lib/game/` + `components/RantRacer.tsx`. Press **RACE THE WALL**, click any rant to
make it your racer, and dodge the rest of the wall coming at you down a vanishing-point
road. Arrows or WASD (steer + throttle), or drag anywhere on touch. 100 / 300 / 700
drop a reward; **1500 clears the wall**. Crash and both bubbles burst into their own
letters while the screen freezes on **CRASHOUTT**.

Four files, cleanly split so none of it can slow the site down:

| File | Job |
|---|---|
| `lib/game/racer.ts` | the simulation — no DOM, no canvas, no React |
| `lib/game/render.ts` | canvas drawing, perspective road, billboards, debris |
| `lib/game/sprites.ts` | each rant baked once into an offscreen bubble sprite |
| `lib/game/audio.ts` | synthesised SFX — oscillators only, no asset files |
| `components/RantRacer.tsx` | canvas + input + HUD, and the fixed-timestep loop |

**Why it stays smooth**

- **Fixed timestep** (1/144 s) with a capped accumulator: identical physics on any
  machine, and no death-spiral when a frame runs long.
- **Swept collision in z**, so nothing tunnels through you however fast it closes.
- **Zero React renders while playing** — the HUD is written to DOM nodes by ref;
  React only re-renders on phase changes (start / crash / end).
- **Sprites are baked once**, so a bubble costs one `drawImage` no matter its depth,
  and the road is drawn as exact perspective trapezoids rather than per-scanline bands.
- Measured: **0.5 ms/frame** idle, **6.4 ms** on the heaviest crash frame, against a
  16.7 ms budget — on a *software-rendered* canvas.

**Why it's always winnable**

Traffic spawns in *waves* (one z, one velocity). Every wave leaves at least one lane
open; drift is clamped inside each bubble's own lane; lane-switchers only slide into an
adjacent lane the wave already reserved and left empty; and no wave may reach you until
`tmin` seconds after the one ahead — stated in arrival *time*, not distance, so
flooring the throttle raises the stakes without ever dealing a gap you can't reach.
Verified by simulation: repeated full runs to 1500 with **zero** unpassable moments and
~24 world units of legal road available at all times.

**Testing it headlessly**

`window.__run` exposes `tick(ms)`, `state()`, `waves()`, `set()`, `input()` — the same
escape hatch as the wall's `__crashoutTick`, and for the same reason (see *Nice-to-know*).
It drives the real loop, so what you measure is what ships.

## Nice-to-know

- `?motion=off` forces the calm static wall; `?motion=full` forces physics even
  with OS-level reduced-motion. By default the OS preference is respected.
  **The game ignores reduced-motion entirely** — it's opt-in behind a button, and a
  frozen racer is just a broken racer.
- Bubble look lives in `app/globals.css` (`.v-glass`, `.v-inverse`, `.v-marker`,
  `.v-outline`, `.v-stamp`, `.v-tape`, `.v-pill`). `lib/seeds.ts` returns `[]` and
  exists only so its import doesn't break — do not repopulate it.
- Security headers (CSP, no-frame, no-sniff) are set in `next.config.mjs`.
