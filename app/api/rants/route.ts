import { NextRequest, NextResponse } from "next/server";
import { moderate, MAX_RANT_LENGTH } from "@/lib/moderation";
import { addRant, isRecentDuplicate, listRants } from "@/lib/store";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "anon";
}

/** GET /api/rants — the wall. CDN-cached so heavy polling stays off the function. */
export async function GET() {
  try {
    const { rants, total } = await listRants();
    return NextResponse.json(
      { rants, total },
      {
        headers: {
          "Cache-Control": "public, s-maxage=8, stale-while-revalidate=60",
        },
      }
    );
  } catch {
    return NextResponse.json({ rants: [], total: 0 }, { status: 500 });
  }
}

/** POST /api/rants — submit a rant. Moderation runs HERE, always, regardless of client. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, kind: "too-long", message: `${MAX_RANT_LENGTH} characters of pure rage, max.` },
      { status: 413 }
    );
  }

  let body: { text?: unknown; tag?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, kind: "bad-request", message: "That didn't parse. Try again." },
      { status: 400 }
    );
  }

  // Honeypot: invisible field real humans never fill. Bots get a fake yes.
  if (typeof body.tag === "string" && body.tag.length > 0) {
    return NextResponse.json({ ok: true, rant: null });
  }

  if (typeof body.text !== "string") {
    return NextResponse.json(
      { ok: false, kind: "bad-request", message: "Type the rage first." },
      { status: 400 }
    );
  }

  const verdict = moderate(body.text);
  if (!verdict.ok) {
    // 200 with ok:false — moderation is a feature, not a server error.
    return NextResponse.json({
      ok: false,
      kind: verdict.kind,
      message: verdict.message,
      support: verdict.support ?? false,
    });
  }

  if (await isRecentDuplicate(verdict.text)) {
    return NextResponse.json({
      ok: false,
      kind: "duplicate",
      message: "You already threw that one at the wall. Fresh rage only.",
    });
  }

  // Rate-limited AFTER moderation: a rejected rant shouldn't burn your cooldown.
  const limit = await checkRateLimit(clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        kind: "rate-limit",
        message: "Easy, champ. Breathe. One crashout at a time.",
        retryAfterS: limit.retryAfterS,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterS) } }
    );
  }

  try {
    const rant = await addRant(verdict.text);
    return NextResponse.json({ ok: true, rant });
  } catch {
    return NextResponse.json(
      { ok: false, kind: "server", message: "The wall flinched. Try again." },
      { status: 500 }
    );
  }
}
