// Moderation framework test suite. Run: npm run test:moderation
// Node 24 strips TS types natively, so we import the .ts module directly.
import { moderate } from "../lib/moderation.ts";

const ALLOW = [
  "I HATE MONDAYS SO MUCH",
  "my boss is a complete asshole and i'm done pretending he isn't",
  "this traffic is killing me I swear",
  "I could murder a curry right now",
  "AAAAAAAAAAHHHHHHHH",
  "fuck this entire week honestly",
  "I want to scream into the void until my lungs give out",
  "my landlord raised rent AGAIN. eat the rich",
  "I bombed my exam and my mum won't stop comparing me to my cousin",
  "i wanna slap him so bad but i won't",
  "punching a wall rn (metaphorically)",
  "found a chink in the armour of my five year plan: i have no plan",
  "dressed to kill tonight and nowhere to go",
  "group projects hurt me more than any breakup",
  "finally beat the traffic and STILL late",
  "deadlines are killing me slowly",
  "i could die of embarrassment after that meeting",
  "I killed it in the interview and still got rejected???",
  "my feet are killing me after this shift",
  "this homework makes me want to die of boredom",
  "i would never hurt you but this rage is eating me alive",
  "i will beat him at chess if it's the last thing i do",
  "i'll fight them on this stupid parking fine forever",
  "raccoon stole my sandwich and my dignity",
  "pakistan lost and i am NOT okay",
  "that referee decision was despicable",
  "corporate emails are pure gobbledygook",
  "WHY is printer ink more expensive than gold",
  "crashout.com is my new therapy",
  "screaming crying throwing up my wifi died mid-interview",
  "shoot me a message when the world starts making sense",
  "customer service kept me on hold for 3 HOURS",
];

const EXPECT = {
  threat: [
    "i will kill you",
    "im gonna stab my boss tomorrow",
    "I want to kill my ex",
    "kys",
    "kill yourself",
    "k!ll y0urself",
    "you deserve to die",
    "hope you get killed",
    "i know where you live",
    "im gonna shoot up the school",
    "put a bullet in his head",
    "imma beat the shit out of that guy",
    "i will hurt you",
    "i'll slit your throat",
    "someone should snap his neck",
    "do us all a favour and die",
    "watch your back tomorrow",
    "he should be shot for this",
    "i wanna strangle my coworker",
    "lets bring a knife to school",
  ],
  slur: [
    "you're a faggot",
    "f a g g o t",
    "n1gger",
    "niiiggerrr",
    "what a retard",
    "shes a dyke and i hate her",
    "bunch of p@kis",
  ],
  "sexual-violence": ["i'll rape you", "he's a pedophile", "groomed a child"],
  "self-harm": [
    "i want to die",
    "im gonna kill myself",
    "kms",
    "no reason to live anymore",
    "everyone would be better off without me",
    "i dont want to be alive anymore",
    "thinking about ending it all",
  ],
  doxxing: [
    "call me on 07911123456",
    "he lives at 42 Elm Street go get him",
    "email me at john@example.com",
    "her phone number is 9876543210",
  ],
  link: [
    "check out https://spam.example",
    "go to www.freestuff.com now",
    "visit mysite.xyz/free-money",
  ],
  "site-hate": [
    "this site sucks",
    "crashout is trash",
    "fuck crashout",
    "i hate this website so much",
    "whoever made this site is stupid",
    "crashout.com is a scam",
    "this wall is pointless and dumb",
  ],
  "too-long": ["a".repeat(300)],
  empty: ["", " ", "x"],
};

let pass = 0;
let fail = 0;
const failures = [];

for (const text of ALLOW) {
  const r = moderate(text);
  if (r.ok) pass++;
  else {
    fail++;
    failures.push(`ALLOW FAILED [${r.kind}]: "${text}"`);
  }
}

for (const [kind, texts] of Object.entries(EXPECT)) {
  for (const text of texts) {
    const r = moderate(text);
    if (!r.ok && r.kind === kind) pass++;
    else {
      fail++;
      const got = r.ok ? "allowed" : r.kind;
      failures.push(`BLOCK FAILED (want ${kind}, got ${got}): "${text.slice(0, 60)}"`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
for (const f of failures) console.log("  ✗ " + f);
process.exit(fail === 0 ? 0 : 1);
