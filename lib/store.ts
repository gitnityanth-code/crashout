/**
 * Rant storage. Two drivers:
 *  - Upstash Redis (REST) when the env vars exist — durable, serverless-safe,
 *    what production on Vercel should use (add the Upstash integration).
 *  - In-memory fallback — dev and keyless deploys. Survives HMR via globalThis,
 *    but NOT across serverless cold starts; the README explains the Redis setup.
 */
import { makeSeeds } from "./seeds";

export interface Rant {
  id: string;
  text: string;
  ts: number;
}

// v2 namespace = clean slate. Sample rants are display-only; the counter counts
// real user rants only, starting from zero.
const LIST_KEY = "crashout:rants:v2";
const TOTAL_KEY = "crashout:total:v2";
export const MAX_STORED = 2000; // ring buffer: the wall keeps the freshest rage
export const PAGE_SIZE = 300; // most recent rants served to clients

/* ---------------- Upstash REST driver ---------------- */

function redisCreds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisPipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const creds = redisCreds();
  if (!creds) throw new Error("no redis credentials");
  const res = await fetch(`${creds.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const rows = (await res.json()) as { result?: unknown; error?: string }[];
  const bad = rows.find((r) => r.error);
  if (bad) throw new Error(`redis: ${bad.error}`);
  return rows.map((r) => r.result);
}

/* ---------------- In-memory fallback ---------------- */

type MemoryState = { rants: Rant[]; total: number };

function memory(): MemoryState {
  const g = globalThis as typeof globalThis & { __crashoutStore?: MemoryState };
  if (!g.__crashoutStore) {
    const seeds = makeSeeds();
    g.__crashoutStore = { rants: [...seeds].reverse(), total: 0 };
  }
  return g.__crashoutStore;
}

/* ---------------- Public API ---------------- */

export function usingRedis(): boolean {
  return redisCreds() !== null;
}

export async function listRants(): Promise<{ rants: Rant[]; total: number }> {
  if (usingRedis()) {
    const [items, totalRaw, len] = (await redisPipeline([
      ["LRANGE", LIST_KEY, 0, PAGE_SIZE - 1],
      ["GET", TOTAL_KEY],
      ["LLEN", LIST_KEY],
    ])) as [string[], string | null, number];

    let rants = items
      .map((s) => {
        try {
          return JSON.parse(s) as Rant;
        } catch {
          return null;
        }
      })
      .filter((r): r is Rant => r !== null && typeof r.text === "string");

    // First visitor ever: plant the sample rants for display, but keep the real
    // rant counter at zero — the wall looks alive, "0 crashouts" is honest.
    if (len === 0) {
      const seeds = makeSeeds();
      await redisPipeline([
        ...seeds.map((s) => ["LPUSH", LIST_KEY, JSON.stringify(s)] as (string | number)[]),
        ["SET", TOTAL_KEY, 0],
      ]);
      rants = [...seeds].reverse();
      return { rants, total: 0 };
    }

    return { rants, total: Number(totalRaw ?? 0) };
  }

  const m = memory();
  return { rants: m.rants.slice(0, PAGE_SIZE), total: m.total };
}

export async function addRant(text: string): Promise<Rant> {
  const rant: Rant = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    ts: Date.now(),
  };

  if (usingRedis()) {
    await redisPipeline([
      ["LPUSH", LIST_KEY, JSON.stringify(rant)],
      ["LTRIM", LIST_KEY, 0, MAX_STORED - 1],
      ["INCR", TOTAL_KEY],
    ]);
  } else {
    const m = memory();
    m.rants.unshift(rant);
    if (m.rants.length > MAX_STORED) m.rants.length = MAX_STORED;
    m.total += 1;
  }
  return rant;
}

/** Case/spacing-insensitive duplicate check against the freshest rants. */
export async function isRecentDuplicate(text: string): Promise<boolean> {
  const canon = text.toLowerCase().replace(/\s+/g, " ").trim();
  const { rants } = await listRants();
  return rants
    .slice(0, 120)
    .some((r) => r.text.toLowerCase().replace(/\s+/g, " ").trim() === canon);
}
