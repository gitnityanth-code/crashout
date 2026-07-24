import type { Rant } from "./store";

// The wall is user-rants-only: no built-in sample/seed rants are planted any
// more. Everything shown on the wall is a real rant somebody submitted. This
// function is kept (returning an empty list) so existing imports keep working.
export function makeSeeds(): Rant[] {
  return [];
}
