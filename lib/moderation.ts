/**
 * CRASHOUT moderation framework.
 *
 * Philosophy: rage, cussing, frustration, despair, ALL-CAPS screaming — welcome.
 * Aimed harm — threats, slurs, sexual violence, doxxing, harassment — never stored,
 * never displayed. First-person crisis language gets a supportive response instead
 * of a rejection. Everything here is deterministic, dependency-free, and runs
 * server-side on every submission (the client mirrors it only for fast UX).
 */

export const MAX_RANT_LENGTH = 280;
export const MIN_RANT_LENGTH = 2;

export type RejectKind =
  | "empty"
  | "too-long"
  | "threat"
  | "slur"
  | "sexual-violence"
  | "self-harm"
  | "doxxing"
  | "link"
  | "site-hate";

export type ModerationResult =
  | { ok: true; text: string }
  | { ok: false; kind: RejectKind; message: string; support?: boolean };

const REJECTION_COPY: Record<RejectKind, string> = {
  empty: "Type the rage first.",
  "too-long": `${MAX_RANT_LENGTH} characters of pure rage, max. Distill it.`,
  threat: "Rage is welcome. Threats aren't. Scream it — don't aim it.",
  slur: "Not here. Slurs never make the wall.",
  "sexual-violence": "Hard no. That's beyond a crashout.",
  "self-harm":
    "Hey — this sounds heavier than a rant, and you matter more than any wall. " +
    "Talk to someone free, 24/7: Samaritans (UK) 116 123 · 988 (US) · findahelpline.com",
  doxxing: "No names with numbers, no addresses, no contacts. Rage stays anonymous.",
  link: "No links. Just feelings.",
  "site-hate": "Cute. The wall doesn't take shots at itself. Aim that rage at something real.",
};

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "+": "t", "€": "e", "£": "l",
};

/** Strips control/zero-width chars and collapses whitespace. Keeps case (ALLCAPS is the vibe). */
export function sanitizeForDisplay(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2060\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased, de-leeted, de-accented, punctuation → spaces. Basis for all matching. */
function normalize(raw: string): string {
  let s = raw.normalize("NFKC").toLowerCase();
  s = s.replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, "");
  s = s.normalize("NFD").replace(/[\u0300-\u036F]/g, "");
  s = s.replace(/[0134578@$!+€£]/g, (c) => LEET_MAP[c] ?? c);
  s = s.replace(/[^a-z\s]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** All non-letters removed — catches "f.a.g.g.o.t" style spacing evasion. */
function condense(normalized: string): string {
  return normalized.replace(/[^a-z]/g, "");
}

const collapseRuns = (s: string, keep: number) =>
  s.replace(new RegExp(`(.)\\1{${keep},}`, "g"), "$1".repeat(keep));

/* ------------------------------------------------------------------ */
/* Layer 1 — slurs (always blocked, no context saves them)             */
/* ------------------------------------------------------------------ */

// Safe for substring search on condensed text (letter sequences that do not
// occur inside benign English words).
const SLURS_SUBSTRING = [
  "nigger", "niggers", "nigga", "niggas", "faggot", "faggots", "tranny", "trannies",
  "wetback", "towelhead", "raghead", "shemale", "beaner", "beaners", "kike",
];

// Need word boundaries (their letters occur inside innocent words: raccoon,
// despicable, gobbledygook, Pakistan...).
const SLURS_BOUNDED = [
  "fag", "fags", "chink", "chinks", "spic", "spics", "coon", "coons", "paki", "pakis",
  "gook", "gooks", "dyke", "dykes", "retard", "retards", "retarded", "spaz",
];

// Idioms containing bounded-slur homographs — cleared before the slur pass.
const SLUR_IDIOMS = [/\bchinks? in (the|my|his|her|their) armou?r\b/g];

function hasSlur(normalized: string): boolean {
  const cleared = SLUR_IDIOMS.reduce((s, re) => s.replace(re, " "), normalized);

  const condensed = condense(cleared);
  // Raw + repeat-collapsed variants: "niiiggerr" → "nigger".
  const variants = new Set([condensed, collapseRuns(condensed, 2), collapseRuns(condensed, 1)]);
  for (const v of variants) {
    if (SLURS_SUBSTRING.some((slur) => v.includes(slur))) return true;
    // Double-letter slurs survive collapse-to-1 only in their collapsed form.
    if (v !== condensed && ["niger", "nigas", "fagot", "fagots"].some((c) => v.includes(c))) {
      return true;
    }
  }

  for (const token of cleared.split(" ")) {
    const tokenVariants = new Set([token, collapseRuns(token, 2)]);
    if (/(.)\1/.test(token)) tokenVariants.add(collapseRuns(token, 1));
    for (const t of tokenVariants) {
      if (SLURS_BOUNDED.includes(t)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Layer 2 — violence & threats (severity + intent + target aware)     */
/* ------------------------------------------------------------------ */

// Everyday hyperbole that contains violent verbs — cleared before threat scans.
const VIOLENCE_IDIOMS: RegExp[] = [
  /\b(is|are|was|were|it'?s|thats|keeps?|be|been)\s+killing\s+me\b/g,
  /\bkills?\s+me\b/g,
  /\bkilled\s+(it|that|the\s+game)\b/g,
  /\bkilling\s+(it|the\s+game)\b/g,
  /\b(could|can)\s+(kill|murder)\s+(for\s+)?(a|an|some)\s+\w+/g, // "could murder a curry"
  /\bdressed\s+to\s+kill\b/g,
  /\bto\s+die\s+for\b/g,
  /\bdying\s+(of|to|for)\b/g,
  /\bdie\s+of\s+(laughter|embarrassment|shame|cringe|boredom)\b/g,
  /\b(makes?|making|made)\s+me\s+(want\s+to|wanna)\s+die\b/g,
  /\bcould\s+die\s+(of|from)\b/g,
  /\bbeat\s+the\s+(traffic|odds|heat|clock|queue)\b/g,
  /\bbeats?\s+me\b/g,
  /\bdead\s+(tired|serious|inside|last)\b/g,
  /\bdrop\s+dead\s+gorgeous\b/g,
  /\bshoot\s+(me\s+a|us\s+a|over\s+a)\s+(message|text|email|dm)\b/g,
  /\bshot\s+in\s+the\s+dark\b/g,
  /\btake\s+a\s+stab\s+at\b/g,
  /\bstab\s+in\s+the\s+(dark|back)\b/g,
  /\bblew?\s+(up\s+(at|on|in)|my\s+mind)\b/g,
  /\bmind\s*=?\s*blown\b/g,
  /\bbombed\s+(the|that|my)\s+(test|exam|interview|presentation)\b/g,
  /\bhurts?\s+(me|my|so|like)\b/g,
  /\bpunch(ing)?\s+(a|the)\s+(wall|pillow|air)\b/g,
  /\bscreaming\s+into\s+(a|the|my)\s+(void|pillow)\b/g,
  /\bchoked\s+(on|up)\b/g,
  /\bburn(ed|t)?\s+(out|myself\s+out)\b/g,
  /\bnailed\s+it\b/g,
  /\bbeat(ing)?\s+(you|u|him|her|them|it|me|us)\s+(at|in|to)\b/g,
  /\bhit\s+(you|u|me|him|her|them|us)\s+(up|back|with)\b/g,
  /\bfight\s+(you|u|him|her|them|me)\s+(on|about|over|for)\b/g,
];

// Negation shields: "I would never hurt you" must not read as a threat.
const NEGATION = /\b(never|not|no\s+way|wouldnt|would\s+never|dont\s+want\s+to|didnt|wont\s+ever)\s+(\w+\s+){0,2}$/;

const SEVERE_VIOLENCE =
  "(kill|murder|stab|shoot|strangle|choke|drown|slit|slaughter|lynch|behead|execute|torture|bomb|shank|curb\\s*stomp)";
const MILD_VIOLENCE = "(punch|slap|smack|hit|fight|beat|deck|throttle|wring|hurt|harm)";
const PERSON_TARGET =
  "(you|u|ya|him|her|them|everyone|everybody|" +
  "(that|this|the)\\s+(guy|girl|man|woman|kid|dude|idiot|moron|fool)|" +
  "my\\s+(boss|ex|manager|teacher|professor|coworker|colleague|neighbou?r|landlord|roommate|flatmate|brother|sister|mum|mom|dad|friend|classmate)|" +
  "(his|her|their|your|ur)\\s+(face|head|neck|throat|skull)|" +
  "(a|the|some)\\s+(person|human|stranger))";
const INTENT = "(will|gonna|going\\s+to|about\\s+to|boutta|finna|shall|swear\\s+(i('?ll)?|to\\s+god\\s+i('?ll)?))";
const DESIRE = "(want\\s+to|wanna|would\\s+love\\s+to|wish\\s+i\\s+could|feel\\s+like|could\\s+(just\\s+)?)";

const THREAT_PATTERNS: RegExp[] = [
  // Severe violence: blocked whether it's intent OR desire, aimed at any person.
  new RegExp(`\\b(i|we|im|imma|ima|lets)\\s+(${INTENT}|${DESIRE})?\\s*${SEVERE_VIOLENCE}\\w*\\s+(\\w+\\s+)?${PERSON_TARGET}\\b`),
  new RegExp(`\\b${SEVERE_VIOLENCE}\\w*\\s+${PERSON_TARGET}\\b`),
  // Mild violence: blocked only as committed intent at a person ("imma slap him").
  new RegExp(`\\b(i|we|im|imma|ima)\\s+${INTENT}\\s+${MILD_VIOLENCE}\\w*\\s+(\\w+\\s+)?${PERSON_TARGET}\\b`),
  new RegExp(`\\bbeat\\s+the\\s+(shit|crap|hell|life|daylights)\\s+out\\s+of\\s+${PERSON_TARGET}\\b`),
  // Wishing death / harm on someone.
  /\b(you|u|he|she|they)\s+(all\s+)?(deserve|deserves)\s+to\s+(die|suffer|be\s+(shot|killed|hanged|hurt))\b/,
  /\b(i\s+)?hope\s+(you|u|he|she|they|(that|this|the)\s+\w+)\s+(\w+\s+)?(dies?|get(s)?\s+(killed|shot|stabbed|hurt|cancer))\b/,
  /\b(should|ought\s+to)\s+be\s+(shot|killed|hanged|executed|lynched|put\s+down)\b/,
  /\bput\s+a\s+bullet\s+(in|through)\b/,
  /\b(slit|cut)\s+(your|ur|his|her|their)\s+throat\b/,
  /\b(snap|break|wring)\s+(your|ur|his|her|their)\s+neck\b/,
  // Telling someone to die.
  /\bkys\b/,
  /\bkill\s+(your|ur)\s*sel(f|ves)\b/,
  /\b(unalive|off|neck|end|delete)\s+(your|ur)\s*sel(f|ves)\b/,
  /\bgo\s+(die|jump\s+off|hang\s+(your|ur)self)\b/,
  /\b(you|u)\s+should\s+(die|not\s+exist|be\s+dead)\b/,
  /\bdo\s+(us|the\s+world|everyone)\s+(all\s+)?a\s+favou?r\s+and\s+(die|disappear)\b/,
  // Menacing / stalking energy.
  /\bi\s+know\s+where\s+(you|u)\s+(live|work|sleep)\b/,
  /\b(ill|i\s+will|imma|ima)\s+(find|hunt|track)\s+(you|u)\s+down\b/,
  /\bwatch\s+(your|ur)\s+back\b/,
  // Mass violence: instant block, no context saves it.
  /\b(shoot|blow|bomb|burn)\s*(up)?\s+(a|the|my|this|that)?\s*(school|church|mosque|temple|synagogue|mall|office|building|place|store)\b/,
  /\bschool\s+shoot(er|ing)?\b/,
  /\b(bring|take)\s+a\s+(gun|knife|weapon|bomb)\s+to\b/,
  /\b(plant|make|build)\s+a\s+bomb\b/,
  // Cruelty to animals.
  new RegExp(`\\b(i|we|im|imma|ima)\\s+(${INTENT}|${DESIRE})\\s*(kill|hurt|kick|torture|poison)\\w*\\s+(a|the|my|that|this)?\\s*(dog|cat|puppy|kitten|animal|pet|bird|hamster)\\b`),
];

function clearIdioms(normalized: string): string {
  return VIOLENCE_IDIOMS.reduce((s, re) => s.replace(re, " ~ "), normalized);
}

function hasThreat(normalized: string): boolean {
  const cleared = clearIdioms(normalized);
  for (const re of THREAT_PATTERNS) {
    const m = re.exec(cleared);
    if (!m) continue;
    // Negation shield: look at what immediately precedes the match.
    const before = cleared.slice(0, m.index);
    if (NEGATION.test(before)) continue;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Layer 3 — sexual violence & exploitation (always blocked)           */
/* ------------------------------------------------------------------ */

const SEXUAL_VIOLENCE: RegExp[] = [
  /\brap(e|es|ed|ing|ist)\b/,
  /\bmolest(s|ed|ing|er)?\b/,
  /\bsexually\s+(assault|abuse)/,
  /\bsex\s+traffick/,
  /\b(child|kid|minor)\s*(porn|abuse\s+material)\b/,
  /\bcsam\b/,
  /\bgroom(ed|ing)\s+(a\s+)?(child|kid|minor)\b/,
  /\bpedo(phile|philia)?s?\b/,
  /\bnonce\b/,
];

const hasSexualViolence = (normalized: string) =>
  SEXUAL_VIOLENCE.some((re) => re.test(normalized));

/* ------------------------------------------------------------------ */
/* Layer 4 — self-harm (supportive response, never displayed)          */
/* ------------------------------------------------------------------ */

const SELF_HARM: RegExp[] = [
  /\bkill(ing)?\s+my\s*self\b/,
  /\bkms\b/,
  /\bkm\s*s\b/,
  /\b(unalive|off|end|delete|hurt|cut|harm)(ing)?\s+my\s*self\b/,
  /\bend(ing)?\s+(my|it)\s+(life|all)\b/,
  /\bsuicid(e|al)\b/,
  /\bself\s*harm(ing)?\b/,
  /\b(i|im)\s+(just\s+)?(want|wanna|ready)\s+to\s+(die|be\s+dead|disappear\s+forever|not\s+exist(\s+anymore)?)\b/,
  /\b(dont|do\s+not)\s+want\s+to\s+(be\s+alive|exist|live)\s*(anymore)?\b/,
  /\bno\s+reason\s+to\s+(live|keep\s+going|go\s+on)\b/,
  /\bbetter\s+off\s+(dead|without\s+me)\b/,
  /\b(nobody|no\s+one)\s+would\s+(care|notice)\s+if\s+i\s+(died|was\s+gone|disappeared)\b/,
];

function hasSelfHarm(normalized: string): boolean {
  const cleared = clearIdioms(normalized);
  return SELF_HARM.some((re) => re.test(cleared));
}

/* ------------------------------------------------------------------ */
/* Layer 5 — doxxing / PII / links / spam vectors                      */
/* ------------------------------------------------------------------ */

function hasLink(raw: string): boolean {
  // Mentioning the site's own name is not a link.
  const t = raw.replace(/crashout\s*\.\s*com/gi, " ");
  return /(https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co|uk|gg|xyz|app|dev|me|ly|info|biz|site|online|shop|store|link|click)(\/\S*)?\b)/i.test(
    t
  );
}

function hasPII(raw: string): boolean {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw)) return true; // email
  const digitRuns = raw.replace(/[\s().+-]/g, "").match(/\d{9,}/g); // phone-length digit runs
  if (digitRuns) return true;
  if (/\b(lives?|works?|stays?)\s+at\s+\d+/i.test(raw)) return true; // street address
  if (/\b(his|her|their)\s+(address|phone\s*(number)?|home)\s+is\b/i.test(raw)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Layer 6 — the wall doesn't rant about itself                        */
/* ------------------------------------------------------------------ */

const SITE_REF = "(crashout(\\s*\\.?\\s*com)?|this\\s+(site|website|app|page|wall)|the\\s+(site|website)\\s+itself|whoever\\s+(made|built|coded)\\s+this)";
const SITE_INSULT =
  "(sucks?|blows?|is\\s+(trash|garbage|shit|ass|terrible|awful|the\\s+worst|stupid|dumb|useless|pointless|cringe|mid|lame|broken|a\\s+scam)|" +
  "should\\s+(not\\s+exist|be\\s+deleted|be\\s+shut\\s+down)|is\\s+a\\s+waste)";

const SITE_HATE: RegExp[] = [
  new RegExp(`\\b${SITE_REF}\\s+(\\w+\\s+){0,3}${SITE_INSULT}`),
  new RegExp(`\\b(i\\s+)?(hate|despise|loathe)\\s+(\\w+\\s+){0,2}${SITE_REF}\\b`),
  new RegExp(`\\b(fuck|screw|damn)\\s+${SITE_REF}\\b`),
  new RegExp(`\\b(delete|shut\\s+down|take\\s+down|report)\\s+${SITE_REF}\\b`),
  new RegExp(`\\b${SITE_REF}\\s+is\\s+(so\\s+)?(bad|dogshit|horrible)\\b`),
];

const hasSiteHate = (normalized: string) => SITE_HATE.some((re) => re.test(normalized));

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

function reject(kind: RejectKind): ModerationResult {
  return { ok: false, kind, message: REJECTION_COPY[kind], support: kind === "self-harm" };
}

export function moderate(raw: string): ModerationResult {
  const display = sanitizeForDisplay(raw);

  if (display.length < MIN_RANT_LENGTH) return reject("empty");
  if (display.length > MAX_RANT_LENGTH) return reject("too-long");

  const normalized = normalize(display);

  if (hasPII(display)) return reject("doxxing");
  if (hasLink(display)) return reject("link");
  if (hasSlur(normalized)) return reject("slur");
  if (hasSexualViolence(normalized)) return reject("sexual-violence");
  if (hasSelfHarm(normalized)) return reject("self-harm");
  if (hasThreat(normalized)) return reject("threat");
  if (hasSiteHate(normalized)) return reject("site-hate");

  return { ok: true, text: display };
}
