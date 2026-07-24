/**
 * Per-IP rate limiting: one rant per BURST_WINDOW seconds, HOURLY_MAX per hour.
 * Redis-backed when available (correct across serverless instances); otherwise
 * a best-effort in-memory sliding window.
 */

const BURST_WINDOW_S = 15;
const HOURLY_MAX = 30;

function redisCreds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisCmd(cmd: (string | number)[]): Promise<unknown> {
  const creds = redisCreds();
  if (!creds) throw new Error("no redis");
  const res = await fetch(creds.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd.map(String)),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

type MemoryLimits = Map<string, number[]>;
function memoryLimits(): MemoryLimits {
  const g = globalThis as typeof globalThis & { __crashoutLimits?: MemoryLimits };
  if (!g.__crashoutLimits) g.__crashoutLimits = new Map();
  return g.__crashoutLimits;
}

export type LimitVerdict = { allowed: true } | { allowed: false; retryAfterS: number };

export async function checkRateLimit(ip: string): Promise<LimitVerdict> {
  if (redisCreds()) {
    try {
      const burstKey = `crashout:rl:b:${ip}`;
      const hourKey = `crashout:rl:h:${ip}`;
      const burst = (await redisCmd(["INCR", burstKey])) as number;
      if (burst === 1) await redisCmd(["EXPIRE", burstKey, BURST_WINDOW_S]);
      if (burst > 1) return { allowed: false, retryAfterS: BURST_WINDOW_S };
      const hourly = (await redisCmd(["INCR", hourKey])) as number;
      if (hourly === 1) await redisCmd(["EXPIRE", hourKey, 3600]);
      if (hourly > HOURLY_MAX) return { allowed: false, retryAfterS: 600 };
      return { allowed: true };
    } catch {
      // Redis hiccup: fail open (a missed rate limit beats a dead submit button).
      return { allowed: true };
    }
  }

  const now = Date.now();
  const limits = memoryLimits();
  const stamps = (limits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (stamps.some((t) => now - t < BURST_WINDOW_S * 1000)) {
    limits.set(ip, stamps);
    return { allowed: false, retryAfterS: BURST_WINDOW_S };
  }
  if (stamps.length >= HOURLY_MAX) {
    limits.set(ip, stamps);
    return { allowed: false, retryAfterS: 600 };
  }
  stamps.push(now);
  limits.set(ip, stamps);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (limits.size > 10_000) {
    for (const [k, v] of limits) {
      if (v.every((t) => now - t > 3600_000)) limits.delete(k);
    }
  }
  return { allowed: true };
}
