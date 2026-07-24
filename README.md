# CRASHOUT — the anonymous wall of rage

Type a rant. Throw it at the wall. Watch it float, drift, and **crash into everyone
else's rage** like rubber blobs. No names, no logins, black & white, spray-paint attitude.

Built with Next.js (App Router, TypeScript). Zero runtime dependencies beyond React.

---

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without a database configured it runs on an in-memory
store (seeded with starter rants) — perfect for dev, but rants reset on restart.

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

**Test it:** `npm run test:moderation` (87 cases covering allow/block/evasion).
Tune lexicons and thresholds at the top of `lib/moderation.ts`.

## Nice-to-know

- `?motion=off` forces the calm static wall; `?motion=full` forces physics even
  with OS-level reduced-motion. By default the OS preference is respected.
- Bubble look lives in `app/globals.css` (`.v-glass`, `.v-inverse`, `.v-marker`,
  `.v-outline`, `.v-stamp`, `.v-tape`, `.v-pill`); starter rants in `lib/seeds.ts`.
- Security headers (CSP, no-frame, no-sniff) are set in `next.config.mjs`.
