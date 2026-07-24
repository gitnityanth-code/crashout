import { NextResponse } from "next/server";
import { moderate } from "@/lib/moderation";
import { purgeMatching, purgeSeeds } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Self-healing cleanup. Two passes:
 *  1. removes any stored rant that fails CURRENT moderation (e.g. contains a
 *     name blocked after it was posted);
 *  2. removes leftover built-in sample rants ("seed-*") so the wall shows only
 *     real user submissions.
 * Safe and idempotent — it can only remove rule-violating or seeded rants,
 * never valid user ones, so it needs no secret.
 */
export async function POST() {
  try {
    const removed = await purgeMatching((text) => !moderate(text).ok);
    const seedsRemoved = await purgeSeeds();
    return NextResponse.json({ ok: true, removed, seedsRemoved });
  } catch {
    return NextResponse.json({ ok: false, removed: 0, seedsRemoved: 0 }, { status: 500 });
  }
}
