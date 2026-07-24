import { NextResponse } from "next/server";
import { moderate } from "@/lib/moderation";
import { purgeMatching } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Self-healing cleanup: removes any stored rant that fails CURRENT moderation
 * (e.g. contains a name blocked after it was posted). Safe and idempotent — it
 * can only remove rule-violating rants, never valid ones, so it needs no secret.
 */
export async function POST() {
  try {
    const removed = await purgeMatching((text) => !moderate(text).ok);
    return NextResponse.json({ ok: true, removed });
  } catch {
    return NextResponse.json({ ok: false, removed: 0 }, { status: 500 });
  }
}
