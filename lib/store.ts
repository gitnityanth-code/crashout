/**
 * Rant storage. Two drivers:
 *  - Upstash Redis (REST) when the env vars exist — durable, serverless-safe,
 *    what production on Vercel should use (add the Upstash integration).
 *  - In-memory fallback — dev and keyless deploys. Survives HMR via globalThis,
 *    but NOT across serverless cold starts; the README explains the Redis setup.
 */
export interface Rant {
  id: string;
  text: string;
  ts: number;
}

// v2 namespace = clean slate. The wall is user-rants-only: nothing is planted,
// and the counter counts real user rants only, starting from zero.
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
    // Empty wall until real users rant — no seeds.
    g.__crashoutStore = { rants: [], total: 0 };
  }
  return g.__crashoutStore;
}

/* ---------------- Public API ---------------- */

export function usingRedis(): boolean {
  return redisCreds() !== null;
}

export async function listRants(): Promise<{ rants: Rant[]; total: number }> {
  if (usingRedis()) {
    const [items, totalRaw] = (await redisPipeline([
      ["LRANGE", LIST_KEY, 0, PAGE_SIZE - 1],
      ["GET", TOTAL_KEY],
    ])) as [string[], string | null];

    // Nothing is ever planted: an empty list simply means nobody has ranted yet.
    const rants = items
      .map((s) => {
        try {
          return JSON.parse(s) as Rant;
        } catch {
          return null;
        }
      })
      .filter((r): r is Rant => r !== null && typeof r.text === "string");

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

/**
 * Removes every stored rant whose text matches `isBad`, keeping order for the
 * survivors and decrementing the real-rant counter. Used to retroactively scrub
 * rants that violate rules added after they were posted (e.g. a blocked name).
 * Returns how many were removed.
 */
export async function purgeMatching(isBad: (text: string) => boolean): Promise<number> {
  if (usingRedis()) {
    const [items] = (await redisPipeline([["LRANGE", LIST_KEY, 0, -1]])) as [string[]];
    const survivors = items
      .map((s) => {
        try {
          return JSON.parse(s) as Rant;
        } catch {
          return null;
        }
      })
      .filter((r): r is Rant => r !== null && typeof r.text === "string" && !isBad(r.text));
    const removed = items.length - survivors.length;
    if (removed === 0) return 0;

    // Rebuild the list preserving newest-first order (LPUSH oldest→newest).
    const cmds: (string | number)[][] = [["DEL", LIST_KEY]];
    for (let i = survivors.length - 1; i >= 0; i--) {
      cmds.push(["LPUSH", LIST_KEY, JSON.stringify(survivors[i])]);
    }
    cmds.push(["DECRBY", TOTAL_KEY, removed]);
    await redisPipeline(cmds);
    return removed;
  }

  const m = memory();
  const before = m.rants.length;
  m.rants = m.rants.filter((r) => !isBad(r.text));
  const removed = before - m.rants.length;
  m.total = Math.max(0, m.total - removed);
  return removed;
}

/**
 * Removes every stored rant left over from the old built-in sample set (ids
 * prefixed "seed-"), so the wall shows only real user submissions. Deliberately
 * does NOT touch TOTAL_KEY: seed rants were display-only and were never counted
 * as real rants, so decrementing would corrupt the counter.
 * Returns how many were removed.
 */
export async function purgeSeeds(): Promise<number> {
  const isSeed = (r: Rant) => typeof r.id === "string" && r.id.startsWith("seed-");

  if (usingRedis()) {
    const [items] = (await redisPipeline([["LRANGE", LIST_KEY, 0, -1]])) as [string[]];
    const survivors = items
      .map((s) => {
        try {
          return JSON.parse(s) as Rant;
        } catch {
          return null;
        }
      })
      .filter((r): r is Rant => r !== null && typeof r.text === "string" && !isSeed(r));
    const removed = items.length - survivors.length;
    if (removed === 0) return 0;

    // Rebuild the list preserving newest-first order (LPUSH oldest→newest).
    // No DECRBY here — the counter never included seeds.
    const cmds: (string | number)[][] = [["DEL", LIST_KEY]];
    for (let i = survivors.length - 1; i >= 0; i--) {
      cmds.push(["LPUSH", LIST_KEY, JSON.stringify(survivors[i])]);
    }
    await redisPipeline(cmds);
    return removed;
  }

  const m = memory();
  const before = m.rants.length;
  m.rants = m.rants.filter((r) => !isSeed(r));
  return before - m.rants.length;
}

/** Case/spacing-insensitive duplicate check against the freshest rants. */
export async function isRecentDuplicate(text: string): Promise<boolean> {
  const canon = text.toLowerCase().replace(/\s+/g, " ").trim();
  const { rants } = await listRants();
  return rants
    .slice(0, 120)
    .some((r) => r.text.toLowerCase().replace(/\s+/g, " ").trim() === canon);
}
