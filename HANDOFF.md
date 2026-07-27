# CRASHOUT — Project Handoff

> **Paste this whole file into a new thread as context.** It is the complete
> end-to-end state of the project as of **27 July 2026**. Nothing else is needed.

---

## 1. What this is

**CRASHOUT** is a live, public, anonymous rant wall. Users type a rant, throw it at
the wall, and it becomes a floating physics bubble that drifts and bounces off other
people's rants. Pure black & white, spray-paint / graffiti / street-art aesthetic.
No accounts, no names, no logins — rants are never attributed to anyone.

The site now has **two modes**: the wall itself, and **CRASHOUT RUN** — a pseudo-3D
vertical racer where you pick a rant off the wall and drive it through everyone
else's rage. Fully documented in **§17**; read that before touching `lib/game/`.

- **Live site:** https://crashout-uk.vercel.app
- **GitHub repo:** https://github.com/gitnityanth-code/crashout (public, branch `main`)
- **Local project root:** `C:\Users\gorre\OneDrive\Desktop\Crashout site`
- **Owner:** nityanth (`gorrepatinityanth@gmail.com`), GitHub user `gitnityanth-code`
- **Vercel team slug:** `gorrepatinityanth-6142s-projects`, project name `crashout`
- **Status:** fully built, deployed, working. Real users are already posting.

**Environment:** Windows 11, PowerShell (Bash tool also available), Node v24.16.0,
npm 11.13.0. Project sits inside a OneDrive-synced folder (see Gotchas).

---

## 2. Tech stack

- **Next.js 15.5.21** (App Router) + **React 19** + **TypeScript** (strict)
- **Zero runtime dependencies** beyond React/Next — no Tailwind, no framer-motion,
  no matter.js. The physics engine, moderation, and storage layer are all hand-rolled.
- **Storage:** Upstash Redis (REST API) with an in-memory fallback
- **Hosting:** Vercel, auto-deploys on every push to `main`
- **Fonts:** `next/font/google` — Archivo Black (display), Permanent Marker (scrawl),
  Space Grotesk (body)

---

## 3. Complete file map

```
C:\Users\gorre\OneDrive\Desktop\Crashout site\
├── HANDOFF.md                       ← this file
├── README.md                        Deploy + moderation docs
├── package.json                     scripts: dev, build, start, lint, test:moderation
├── tsconfig.json                    strict TS, "@/*" path alias → project root
├── next.config.mjs                  security headers incl. strict CSP
├── .gitignore                       ignores node_modules, .next, .claude/settings.local.json
├── next-env.d.ts                    (generated)
│
├── app\
│   ├── layout.tsx                   fonts, metadata, favicon (/logo.png)
│   ├── page.tsx                     renders <CrashoutApp/>
│   ├── globals.css                  ★ ENTIRE design system (~18 KB, all visuals)
│   └── api\rants\
│       ├── route.ts                 GET (list) + POST (submit, moderated, rate-limited)
│       └── purge\route.ts           POST — self-healing cleanup (see §7)
│
├── components\
│   ├── CrashoutApp.tsx              app shell, state, polling, view + mode switching
│   ├── RantWall.tsx                 ★ THE PHYSICS ENGINE (~20 KB) — world + camera
│   ├── RantForm.tsx                 glassy input pill, honeypot, verdict toast
│   ├── RantRacer.tsx                ★ THE GAME shell — canvas, input, HUD, loop (§17)
│   ├── Logo.tsx                     wordmark w/ animated gradient (luminance mask)
│   └── BackgroundFX.tsx             grain, glows, matrix drips, ghost words, splats
│
├── lib\
│   ├── moderation.ts                ★ MODERATION FRAMEWORK (~16 KB, 9 layers)
│   ├── store.ts                     Redis/in-memory storage + purge helpers
│   ├── ratelimit.ts                 per-IP limiting (1 per 15s, 30/hour)
│   ├── seeds.ts                     returns [] — kept only so imports don't break
│   └── game\                        ★ CRASHOUT RUN — the racer (§17)
│       ├── racer.ts                 the simulation: no DOM, no canvas, no React
│       ├── render.ts                canvas renderer: road, billboards, debris
│       ├── sprites.ts               each rant baked once into an offscreen sprite
│       └── audio.ts                 synthesised SFX, oscillators only, no assets
│
├── scripts\
│   └── moderation.test.mjs          95-case test suite (npm run test:moderation)
│
├── public\
│   └── logo.png                     the wordmark (also used as a CSS luminance mask)
│
├── .claude\
│   ├── launch.json                  preview configs: "crashout-prod", "crashout-dev"
│   └── settings.local.json          (gitignored, machine-local)
│
└── [reference images — user-supplied, kept for design reference]
    ├── crashout logo.png            the spray-paint CRASHOUT wordmark
    ├── rant box.jpg                 glassy dark pill → became the rant input
    ├── rant bubbles.jpg             glassy rounded rect → became .v-glass bubbles
    └── reference for crashout . com logo.jpg   "SKEWED" spray type inspiration
```

★ = the three files that matter most. Read those first.

---

## 4. THE PHYSICS ENGINE — `components/RantWall.tsx`

This is the heart of the site and the most intricate file. **Read it fully before
touching it.**

### Architecture: persistent world + camera

Every rant is a **permanent body** in a **world space** larger than the screen.
Nothing is ever recycled, expired, or timed out — every user's rant persists.

- **World width** = `viewportWidth × 1.4` → exactly **40% sideways** scroll room
  (`WORLD_W_FACTOR = 1.4`)
- **World height** = grows with rant count so a standard screenful holds ~10 rants
  on desktop, ~4.5 on mobile (`perScreen` in `recomputeWorld()`)
- **Camera** shows a section of the world. The `.world` div gets a single
  `translate3d(...) scale(...)` transform; bubbles are positioned in world coords.
- `MAX_BODIES = 300` — hard ceiling on simulated/rendered rants, newest win.

### Two view modes

| Mode | Behaviour |
|---|---|
| **Standard** | zoom 1:1, camera pans. Scroll wheel / drag / touch to roam down and 40% sideways. Clamped exactly at world edges. |
| **Global** | Zooms out to fit the **entire** world — every rant visible at once. Anamorphic wide-angle look via `ANAMORPHIC = 1.08` horizontal stretch + `.anamorphic-veil` vignette. Panning disabled (nothing to pan to). |

Toggled by the **GLOBAL VIEW** button (bottom-right). Camera transform is lerped
each frame, so switching modes is a smooth zoom, not a jump.

### Collisions — contact-exact

- **Broad phase:** uniform spatial grid (`CELL = 220`), 3×3 neighbourhood checks.
  Scales fine as the archive grows.
- **Narrow phase:** rotation-aware half-extents (`halfExtents()`), **zero padding**.
  Bubbles bounce only on real visual contact. Verified: closest approach 4.4px,
  **zero overlap ever**.
- Resolution: minimum-penetration axis, mass-weighted by area, plus a rubber
  squash/stretch spring (`sqx/sqy/svx/svy`) so impacts deform the bubble.

### Motion

Lazy free-float: per-body sine wander + viscosity damping. Cursor acts as a gust
that repels bubbles within 165px (works in both views — hovering interacts).
Hovering a bubble slows it to 12% speed so it's readable. Bubbles bounce off
world walls. Speed is capped.

### Performance

- Off-camera bubbles skip DOM writes and get `visibility:hidden` (standard view only;
  global view renders everything).
- Physics never triggers React re-renders — world/camera/bodies all live in refs.
- `window.__crashoutTick(ms)` is a **headless test hook**: advances the simulation
  deterministically without rAF. Essential for verification (see §9).

### ⚠️ Two bugs that were fixed here — do not reintroduce

1. **`prefers-reduced-motion` must NOT freeze the wall.** The owner's Windows has
   animation effects disabled, so Chrome reports `reduce`. The old code dropped into
   a static mode → bubbles faded in, froze, then teleport-reshuffled every 14s. That
   was the "moves 2 seconds then glitches and stops" bug. **Now reduced-motion only
   *gentles* the drift** (`calm` flag: 32% speed, no cursor gusts, no squash). Only
   the explicit `?motion=off` URL param freezes it.
2. **React ref/lifecycle ordering.** React attaches refs *before* layout effects run.
   Bodies must therefore be created lazily inside the ref callback via
   `ensureBody(id)` — if you create them in an effect instead, `b.el` is never
   assigned and rants silently never join the simulation.

### URL overrides
`?motion=full` forces full physics · `?motion=off` freezes the wall

---

## 5. THE MODERATION FRAMEWORK — `lib/moderation.ts`

Runs **server-side on every submission** (`app/api/rants/route.ts`). The client
cannot bypass it. Dependency-free and deterministic.

**Design philosophy:** rage, profanity, despair, ALL-CAPS screaming are *welcome* —
that is the entire point of the site. Only **aimed harm** is blocked.

### Layers, in order (first match wins)

| # | Layer | Behaviour |
|---|---|---|
| 0 | **Sanitize** | strip control/zero-width chars, cap at 280 chars, min 2 |
| 1 | **Normalize** | lowercase, de-accent, de-leet (`k!ll`→`kill`), strip punctuation, collapse letter-spacing (`f a g g o t` caught) |
| 2 | **Blocked name** | 🔒 see below — highest priority |
| 3 | **PII/doxxing** | emails, phone-length digit runs, street addresses |
| 4 | **Links** | any URL or bare domain (the site's own name is exempt) |
| 5 | **Slurs** | blocklist + evasion-resistant matching; word-boundary aware so *raccoon*, *Pakistan*, "chink in the armour" pass |
| 6 | **Sexual violence** | always blocked |
| 7 | **Self-harm** | ⚠️ NOT a rejection — returns a **supportive** message with helplines (Samaritans 116 123 UK · 988 US). `support: true` flag renders a different, gentler toast. |
| 8 | **Threats** | severity × intent × target aware (below) |
| 9 | **Site-negativity** | the wall refuses rants about itself (owner's explicit request, said with a "hehehe") |

### Threat detection nuance (the clever part)
- ~40 **idioms cleared first**, so "this traffic is killing me", "I could murder a
  curry", "dressed to kill", "my feet are killing me" all pass.
- **Negation shield**: "I would never hurt you" passes.
- **Severity split**: severe violence (kill/stab/shoot…) is blocked even as a *wish*
  ("I want to kill my ex"). Mild violence (slap/punch…) is blocked only as *committed
  intent at a person* ("imma slap him") — venting ("i wanna slap him so bad but i
  won't") passes.

### 🔒 The blocked name — `nityanth` (HARD REQUIREMENT)
The owner's explicit rule: **nothing referencing "nityanth" may ever appear on the
site, in any form.** Implemented at `lib/moderation.ts:321-338`:
- `BLOCKED_NAME_SEQUENCES` matched against *condensed* text, so casing, leet
  (`n1ty4nth`), spacing (`n i t y a n t h`), punctuation (`n.i.t.y.a.n.t.h`),
  letter-stretching (`niiityaaanth`), and embedding (`xnityanth123`) are all caught.
  Includes misspellings (`nithyanth`, `nityant`) and the reversed spelling.
- `BLOCKED_NAME_SCRIPTS` matches **Telugu** (నిత్యంత్) and **Devanagari** (नित्यंत).
- Reject kind is `"name"`.

**Important nuance the owner clarified:** the slur *kojja* and general profanity are
**fine** — the site keeps its rage. The rule is *only* about the name. A rant reading
"Nityanth kojjjaaa" was removed solely because of the name, not the profanity.

### Tests
`npm run test:moderation` → **95 cases, all passing.** Covers allow-cases,
every block category, and evasion attempts. Add a case whenever you touch the file.

### ⚠️ Known limitation (be honest about this with the owner)
Structural protections (the name block incl. native scripts, links, emails, phone
numbers, addresses) work in **any language**. But the *meaning-based* layers
(threats, slurs, self-harm) use **English word-lexicons** — a threat written in
French or Hindi would not be caught by those layers. The owner asked for multilingual
semantic understanding; delivering it properly needs an **AI moderation API call**,
which the site's strict CSP (`connect-src 'self'`) currently forbids by design.
That is a real, scoped next step — **it has not been done.**

---

## 6. Storage — `lib/store.ts`

Two drivers, auto-detected:
1. **Upstash Redis (REST)** when env vars exist — production
2. **In-memory** fallback — local dev (empty on every restart)

```ts
const LIST_KEY  = "crashout:rants:v2";
const TOTAL_KEY = "crashout:total:v2";
MAX_STORED = 2000;  // ring buffer, freshest rants kept
PAGE_SIZE  = 300;   // served per request
```

**Env vars** (auto-injected by the Vercel↔Upstash integration; code accepts either pair):
`KV_REST_API_URL` / `KV_REST_API_TOKEN` **or** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
Upstash DB is named **`crashout-redis`** (free tier, 500K commands/month).

### 🔑 The version-suffix wipe trick
`:v2` is deliberate. **To wipe the wall cleanly, bump the key suffix to `:v3` and
deploy** — old keys are orphaned and ignored, no console access or credentials needed.
This is the established, safe reset procedure.

### Key functions
- `listRants()` → `{ rants, total }`. **Nothing is ever seeded/planted.**
- `addRant(text)` → LPUSH + LTRIM + INCR
- `purgeMatching(isBad)` → removes rants failing a predicate, decrements counter
- `purgeSeeds()` → removes legacy `seed-*` rants, **deliberately does not touch the
  counter** (seeds were never counted as real rants)
- `isRecentDuplicate(text)`

**No sample/seed rants exist any more.** `lib/seeds.ts` returns `[]`. The wall shows
only genuine user submissions; if empty, `CrashoutApp` renders a
"NOTHING ON THE WALL YET / be the first to crash out" state.

---

## 7. API

### `GET /api/rants`
Returns `{ rants: Rant[], total: number }` where `Rant = { id, text, ts }`.
Cached `s-maxage=8, stale-while-revalidate=60` — the CDN absorbs polling so the
site handles 500–1k concurrent viewers on ~1 origin hit per 8s per region.
Client polls every 10s, pausing when the tab is hidden.

### `POST /api/rants`
Body `{ text: string, tag?: string }` (`tag` = honeypot; if filled, a bot is
silently given a fake success). Pipeline: size cap → honeypot → **moderation** →
duplicate check → **rate limit** → store.

⚠️ **Rate limiting runs AFTER moderation on purpose** — a rejected rant must not
burn the user's cooldown.

Rejections return **HTTP 200** with `{ ok:false, kind, message, support }` —
moderation is a product feature, not a server error.

### `POST /api/rants/purge`
Self-healing cleanup, **idempotent and safe, needs no secret** (it can only ever
remove rule-violating or legacy-seed rants, never valid ones). Two passes:
1. removes stored rants that fail *current* moderation — this is how rants are
   retroactively scrubbed when a new rule is added
2. removes legacy `seed-*` rants

Returns `{ ok, removed, seedsRemoved }`.
Call it after deploying any moderation rule change:
```bash
curl -X POST https://crashout-uk.vercel.app/api/rants/purge
```

### Rate limits (`lib/ratelimit.ts`)
1 rant per **15s**, **30/hour** per IP. Redis-backed in prod (correct across
serverless instances), in-memory locally. **Fails open** on a Redis hiccup — a
missed rate-limit beats a dead submit button.

---

## 8. Design system — `app/globals.css`

Strictly **white (`#fff`) and black (`#000`)**. No other colours. Ever.

- **Logo** (`components/Logo.tsx`): the supplied PNG is used as a CSS
  **luminance mask**, with an animated white↔black gradient sweeping *through* the
  letterforms (`@keyframes ink-sweep`), plus halo pulse, slow sway, and a "UK" sticker.
  Falls back to the plain PNG where masking is unsupported.
- **Bubble variants** (assigned deterministically by hashing the rant id):
  `.v-glass` (×2 weight), `.v-pill`, `.v-inverse`, `.v-marker`, `.v-outline`,
  `.v-stamp`, `.v-tape`. Size class by text length: `.size-l` / `.size-m` / `.size-s`.
- **Background** (`BackgroundFX.tsx`): film grain (SVG turbulence), corner glows,
  falling "matrix" drips, giant ghost graffiti words (LET IT OUT / SCREAM / RAGE /
  BREATHE / OUT LOUD), spray splats. Uses a **seeded PRNG** — `Math.random()` here
  would break SSR hydration.
- **Bubble sizing** was deliberately reduced: ~19% of screen width on desktop,
  `max-width: 54vw` on mobile. The owner explicitly said earlier sizes were too big.
- **No-fly zones**: the physics engine keeps bubbles away from the logo and the rant
  form so text never smears behind the input's backdrop blur.

---

## 9. How to run, test, verify

```bash
npm install
npm run dev              # or: npm run build && npm run start
npm run test:moderation  # 95 cases — MUST stay green
```

### ⚠️ Verification gotcha (important)
The in-app browser pane on this machine reports `prefers-reduced-motion: true` and
`visibility: hidden`, so **rAF does not fire and screenshots often fail**
("pane not displayed"). Do **not** conclude the site is broken from that.

**Verify with `javascript_tool` probes + the tick hook instead:**
```js
window.__crashoutTick(30000);   // advance 30 simulated seconds deterministically
```
Then assert on `.bubble` transforms, `getBoundingClientRect()` overlaps,
`.world` size/transform, visibility counts. Use `?motion=full` to force physics.

### Seeding local test data
The local store starts empty and the rate limit is 1/15s. Bypass it by posting with
distinct `X-Forwarded-For` headers (`clientIp()` reads that header):
```js
fetch('/api/rants', { method:'POST',
  headers:{'Content-Type':'application/json','X-Forwarded-For':'10.0.0.'+i},
  body: JSON.stringify({ text: '...' }) })
```

### Last verified measurements (all green)
- **0 stall frames** across 60+ simulated seconds, desktop *and* mobile, with
  reduced-motion ON
- **0 overlaps**; closest bubble approach **4.4px** (true contact-then-bounce)
- Sideways pan **exactly 40%**; vertical/horizontal clamping exact at world edges
- Visible per screen: **11–13 desktop**, **~6 mobile**
- Global view renders **24/24** rants, all within viewport, anamorphic stretch active
- `npm run build` clean; **95/95** moderation tests pass

---

## 10. Deployment

Auto-deploys on every push to `main`. Nothing manual.

```bash
git add -A
git commit -m "..."
git push origin main      # → Vercel builds & deploys in ~40s
```

Then, if moderation rules changed, run the purge (§7).

**Git identity is configured locally** (`user.name=nityanth`,
`user.email=gorrepatinityanth@gmail.com`) and **credentials are cached** — pushes
work without prompts. If a Git Credential Manager dialog ever appears, it must be
completed in a real interactive terminal; a background/non-interactive push will
hang and fail with "terminal prompts disabled".

**Custom domain (not done yet):** the owner intends to buy **crashout.com** later.
When they do: Vercel project → Settings → Domains → Add, point registrar DNS at
Vercel, HTTPS is automatic. The `.vercel.app` URL keeps working.

---

## 11. Commit history

```
917e421  Rework wall: persistent world + camera, contact-exact collisions, global view, no seeds
a7561de  Optimize bubble field: edge-fade into/out of archive + robust pool sizing (4/6/9)
edd63ea  Add self-healing purge endpoint to scrub rants that violate new rules
41e2a60  Block founder name in all forms/scripts; cap wall at 4/6/9 bubbles to stop flooding
eeeb496  Clean slate: sample rants are display-only, real counter starts at 0
afaa1ee  Redeploy: connect Upstash Redis for persistent rants
8bfb8d9  Untrack local Claude settings
2951ad9  CRASHOUT v1 — anonymous rant wall
```
Working tree is **clean** as of handoff (before HANDOFF.md is committed).

Note: commits `a7561de` and `41e2a60` describe a bubble-pool/edge-fade approach that
`917e421` **replaced** with the world+camera model. The current architecture is
§4 — ignore the older approach described in those messages.

---

## 12. Owner's preferences & working style (learned over the build)

- **Wants speed and decisiveness.** Do the work, verify it, report plainly. Don't
  narrate options you're not taking.
- **Will push back if something isn't actually fixed** — and is usually right.
  Verify claims in the browser before saying something works.
- **Prefers you drive the tooling**, but will click buttons when asked (logins,
  OAuth approvals, anything credential-related — those are correctly the owner's to click).
- Watches usage budget; says so explicitly ("only 10% left"). Be economical.
- Aesthetic direction: *rebellion, revolution, satisfaction, graffiti, street art,
  spray paint.* Slick, dope, bug-free. Black and white only.
- **Do NOT reintroduce sample/seed rants.** Explicitly rejected: "i want only user
  rants to be there."

---

## 13. Open items / possible next steps

Nothing is broken. These are opportunities, not debts:

1. **Multilingual semantic moderation** — the real known gap (§5). Needs an AI
   moderation API + a CSP `connect-src` allowance. The biggest genuine improvement.
2. **Custom domain** `crashout.com` when purchased (§10).
3. **Mobile touch tuning** — pinch-to-zoom between standard and global view would be
   a natural gesture; currently it's the button.
4. **Real-device testing** — verified via automation and DOM probes on desktop and a
   375×812 emulated viewport, but not on a physical phone. **This now includes the
   racer (§17)**, whose steering feel and touch-drag gain are the parts most worth
   trying with real thumbs.
4b. **A leaderboard for CRASHOUT RUN** — best score is `localStorage` only today.
   A shared board would need a new key namespace and its own rate limiting.
5. **Load testing** — architecture is designed for 500–1k concurrent (CDN-cached
   reads, O(1) Redis writes) but has not been load-tested under real traffic.
6. **`MAX_BODIES = 300`** — if the archive grows huge, consider DOM virtualization in
   global view; currently every body in the cap gets a DOM node.

---

## 14. Gotchas (things that will bite you)

- **OneDrive + `.next`**: builds intermittently fail with
  `EINVAL: invalid argument, readlink '.next\diagnostics\framework.json'`.
  Fix: `Remove-Item -Recurse -Force .next` and rebuild. It's the folder sync, not the code.
- **Browser pane reports reduced-motion + hidden** → rAF doesn't run, screenshots
  fail. Use `__crashoutTick` (§9).
- **Never use `$home` as a PowerShell variable** — it's read-only and the assignment
  silently kills the rest of the line.
- **CSP is strict** (`connect-src 'self'`) — any external API call needs
  `next.config.mjs` updated first, deliberately.
- **`lib/seeds.ts` must keep existing** and exporting `makeSeeds()` (returning `[]`)
  so imports don't break.
- **Physics must never call `setState`** — it would re-render at 60fps. Everything
  lives in refs.
- Local dev store is **in-memory and empty** on restart — that is correct, not a bug.

---

## 15. Current live state (27 July 2026)

- **13 real user rants** on the wall, counter reads 13 (grew 7→13 during the last
  session — real people are using it)
- **0** sample/seed rants (all 28 legacy ones purged from production)
- **0** rants containing the blocked name
- Site returns HTTP 200, API healthy, Redis persistence confirmed working
- Latest deploy: `917e421`, Ready

---

## 16. Suggested opening message for the new thread

> I'm continuing work on CRASHOUT, my anonymous rant wall — it's live at
> https://crashout-uk.vercel.app and the code is at
> `C:\Users\gorre\OneDrive\Desktop\Crashout site`.
> Read `HANDOFF.md` in that folder first — it's the complete project context
> (architecture, the physics engine, the racing game mode, the moderation
> framework, deploy process, gotchas, and open items). Then [YOUR REQUEST HERE].

---

## 17. CRASHOUT RUN — the game mode

Added **27 July 2026**. A pseudo-3D vertical racer built into the site. Press
**RACE THE WALL** (bottom right) → the wall slows to a crawl and every bubble
becomes clickable → click one and it becomes your racer.

Everything lives in `lib/game/` + `components/RantRacer.tsx`. **It shares nothing
with the wall's physics engine** (§4) — different problem, different code. The wall
was left alone apart from three small additions: a `pickMode` prop, a `paused` prop,
and an `onPick` callback.

### The loop

Traffic (other people's rants) comes at you down a four-lane road. Steer with
**A/D** or **←/→**, throttle with **W/S** or **↑/↓**, or drag anywhere on touch.
**P** pause · **M** mute · **R** restart · **ESC** quit. Three lives.

- Crossing **100 / 300 / 700** unlocks a reward that spawns on the track to collect:
  **SHIELD** (eats one crash), **SLO-MO** (5s), **SCORE ×2** (14s).
- **1500 ends the run** — `WALL CLEARED`.
- Crash → both bubbles burst into their own individual letters, the world freezes,
  **CRASHOUTT** slams onto the middle of the screen for 1.5s, then you respawn with
  the road ahead faded clear and 2s of invulnerability.
- Near misses pay **+8** and flash `NICE`; a clean pass pays +2.

### The world model

A pinhole camera at `(camX, camH, 0)` looks down `+z`. The road is the `y=0` plane,
`ROAD_W = 240` units wide, 4 lanes. The player is pinned at `z = Z_PLAYER (90)` and
steers along `x`; traffic spawns at `Z_FAR (940)` and closes on you. Screen size falls
straight out of the projection, so a bubble genuinely grows as it approaches:

```
scale     = focal / z
screenX   = cx + (x - camX) * scale
groundRow = horizonY + camHF / z
```

`makeCam()` derives `focal` and `camHF` from the viewport, so the road always fills
~84% of the screen and the horizon always sits at 33% — desktop or phone.

The "3D" is sold by: camera lateral offset that slides the road as you steer, camera
roll on hard turns, billboard shear proportional to off-axis distance, light pools
under floating bubbles, posts and rumble strips flying past, atmospheric fade into the
horizon, and speed lines from the vanishing point.

### 🔒 The passability invariant (do not break this)

Traffic spawns in **waves** — a set of bubbles sharing one `z` and one velocity, so
nothing inside a wave can drift into anything else inside it. Four rules together
guarantee the road is *always* driveable:

1. Every wave leaves **at least one lane free**.
2. **Drift is clamped inside a bubble's own lane** — a free lane stays fully free.
3. **Lane switchers** only slide into an *adjacent* lane the wave has already
   reserved **and left empty**. Adjacent, so the path can't sweep through a free lane
   sitting between two blocked ones; empty, so it can't land on another bubble.
   Reserving the spare costs an obstacle, so switching waves are thinner.
4. **No wave may reach you until `tmin` seconds after the wave ahead does.**

Rule 4 is the important one and it was learned the hard way. Spacing traffic by
*distance* is not enough: a fast wave behind a slow one arrives sooner than the gap
suggests, and the game deals you a lane change you physically cannot make. Measured at
one point: **444 units/s of lateral movement required against a 260 cap.** The rule is
now stated in arrival *time* (`minZBehind()` in `racer.ts`), which also means flooring
the throttle raises the stakes without ever making the road unfair.

`tmin` per level is **1.75 / 1.55 / 1.4 / 1.25s**; crossing the entire road flat out
takes ~0.9s, so there is real margin at every difficulty.

**Verified by simulation** (see below): repeated full runs to 1500 with **zero**
unpassable moments and ~24 world units of legal road available at every instant.

### Levels

Four bands (`LEVELS` in `racer.ts`), switching at the milestones. Each one raises
base/max speed, tightens the spawn gap, blocks more lanes, and widens `vary` — how
far a wave's own velocity strays from yours, which is what makes arrival rates genuinely
unpredictable rather than merely fast. Lane-switching starts at level 2 and reaches
45% of waves by level 4.

| Lvl | Score | Speed | Lanes blocked | Switchers | `tmin` |
|---|---|---|---|---|---|
| 1 | 0–100 | 175→235 | 1 | — | 1.75s |
| 2 | 100–300 | 210→285 | 1–2 | 12% | 1.55s |
| 3 | 300–700 | 255→345 | 2–3 | 30% | 1.4s |
| 4 | 700–1500 | 300→410 | 2–3 | 45% | 1.25s |

### Why it doesn't stutter

- **Fixed timestep** of `1/144s` with a capped accumulator (max 12 substeps, then the
  accumulator is dropped) — identical physics on any machine, no death spiral.
- **Swept interval collision in `z`** — nothing tunnels through you however fast it
  closes. Not a point-in-box test; don't "simplify" it into one.
- **Zero React renders while playing.** The HUD is written to DOM nodes via refs;
  React re-renders only on phase changes. Same rule as the wall: never `setState` at
  60fps.
- **Sprites baked once** (`sprites.ts`) — a bubble costs one `drawImage` at any depth.
- **Road as exact perspective trapezoids** between stripe boundaries, not per-scanline
  bands: ~36 quads instead of ~270, and stripes shrink continuously into the horizon
  so nothing ever pops or shimmers.
- Auto-pauses on blur / tab hide; `dt` is clamped at 0.25s so returning from a hidden
  tab never teleports the world.

**Measured** (919×868, software-rendered canvas): **0.5 ms/frame** idle at level 4,
**6.4 ms** on the heaviest crash frame, against a 16.7 ms budget. Mobile geometry
(375×812 @ dpr 2): **1.5 ms**.

### ⚠️ One trap already hit here

Letter debris is the most expensive thing the renderer draws. Sizes are **integers on
purpose** and `drawLetters()` **groups glyphs by size** — setting `ctx.font` re-parses
the whole shorthand including the long `next/font` family list, and doing that per
glyph cost **~75 ms/frame**. Keep the grouping. Debris is capped at 64 chars per burst,
240 letters total.

### Testing it headlessly

Same problem as the wall (§9): this machine's browser pane reports reduced-motion and
`visibility: hidden`, so rAF never fires and screenshots fail. `RantRacer` therefore
exposes `window.__run` while mounted:

```js
__run.tick(ms, inputOverride)  // advance deterministically + render + sync HUD
__run.state()                  // phase, score, level, lives, speed, playerX, …
__run.waves()                  // live wave list: z, vz, ghost, per-item lane + x
__run.set(patch)               // Object.assign onto engine state
__run.input({left,right,up,down,touchX})
__run.start() / __run.reset() / __run.cam()
```

It drives the **same** `syncPhase`/`syncHud` path as the real loop, so what you measure
is what ships. The oracle-bot audit used to verify the invariant is worth re-running
after any change to spawning: drive toward the nearest wave's free lane with a
predictive (damped) controller and assert `violations === 0`.

> A bang-bang controller oscillates around the target and crashes — that's the *bot*
> being bad, not the game. Use `target - (x + vx * 0.16)` as the error term.

### Reduced motion

The wall gentles itself under `prefers-reduced-motion`; **the game ignores it entirely.**
It is opt-in behind a button, the canvas *is* the content, and a frozen racer just
reads as broken. Only the CSS entry/slam animations are shortened.
