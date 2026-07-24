import type { Rant } from "./store";

// Starter rants so the wall is never empty. All timestamps are "the beginning".
const SEED_TEXTS: string[] = [
  "WHY does my laptop update the second I open it for something urgent",
  "group project = me and three ghosts",
  "I said 'you too' when the waiter said enjoy your meal. moving countries.",
  "my alarm has 7 snoozes because i have trust issues with myself",
  "adulthood is just emailing 'just following up on this!' until you die inside",
  "the printer works for EVERYONE except me. it can sense fear.",
  "£4.80 for a coffee and they still spelled my name wrong",
  "I rehearsed the argument in the shower and STILL lost it in real life",
  "my wifi dies exactly when i'm winning. every. single. time.",
  "'per my last email' is corporate for I WILL FLIP THIS DESK",
  "why is the fitted sheet ALWAYS the wrong way round. every time. EVERY TIME.",
  "screamed into my pillow and the pillow filed a complaint",
  "they scheduled a meeting that could've been a text message to cancel a meeting",
  "AAAAAAAAAAAAAAAAAAAAAAAA",
  "the self checkout said unexpected item. the unexpected item was my will to live leaving",
  "3 interviews, a personality test, and a 'task'. for minimum wage.",
  "my landlord painted over the mould and called it renovated",
  "everyone's a morning person until the group chat pings at 7am",
  "I'm not dramatic. the situation is dramatic. I'm reacting appropriately.",
  "bus was early ONCE in my life and it was the day i was late",
  "'we're a family here' = we will call you on your day off",
  "autocorrect changed my rage text to something polite. even my phone silences me",
  "the gym is full of people using the ONE machine i need. all of them. rotating.",
  "petition to make 'i don't know' an acceptable answer in meetings",
  "my houseplant died and it was fake",
  "charging my phone to 100% then unplugging it feels like my only achievement today",
  "the queue i chose stopped moving. the queue i left? gone. finished. instant.",
  "typed a whole paragraph, deleted it, sent 'ok'. growth.",
];

export function makeSeeds(): Rant[] {
  return SEED_TEXTS.map((text, i) => ({
    id: `seed-${i}`,
    text,
    ts: 0,
  }));
}
