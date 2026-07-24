// Static, deterministic background layers: grain, glows, matrix drips,
// ghost graffiti words, spray splats. Seeded PRNG keeps SSR and client
// output identical (Math.random() here would break hydration).

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xc4a5);

const DRIPS = Array.from({ length: 14 }, () => ({
  left: `${(rand() * 100).toFixed(2)}%`,
  duration: `${(7 + rand() * 9).toFixed(2)}s`,
  delay: `${(-rand() * 16).toFixed(2)}s`,
  opacity: 0.05 + rand() * 0.09,
}));

const WORDS = [
  { text: "LET IT OUT", top: "12%", left: "-4%", size: "11vw", tilt: "-8deg" },
  { text: "SCREAM", top: "58%", left: "58%", size: "13vw", tilt: "5deg" },
  { text: "RAGE", top: "74%", left: "6%", size: "15vw", tilt: "-5deg" },
  { text: "BREATHE", top: "34%", left: "66%", size: "8vw", tilt: "-10deg" },
  { text: "OUT LOUD", top: "88%", left: "44%", size: "9vw", tilt: "3deg" },
];

const SPLATS = Array.from({ length: 7 }, () => ({
  top: `${(6 + rand() * 88).toFixed(1)}%`,
  left: `${(3 + rand() * 92).toFixed(1)}%`,
  scale: 0.8 + rand() * 1.7,
  rot: `${Math.round(rand() * 360)}deg`,
}));

export default function BackgroundFX() {
  return (
    <div className="fx" aria-hidden="true">
      <div className="fx-glow tl" />
      <div className="fx-glow br" />
      {WORDS.map((w) => (
        <span
          key={w.text}
          className="fx-word"
          style={{
            top: w.top,
            left: w.left,
            fontSize: w.size,
            ["--tilt" as string]: w.tilt,
          }}
        >
          {w.text}
        </span>
      ))}
      {DRIPS.map((d, i) => (
        <span
          key={i}
          className="fx-drip"
          style={{
            left: d.left,
            animationDuration: d.duration,
            animationDelay: d.delay,
            opacity: d.opacity,
          }}
        />
      ))}
      {SPLATS.map((s, i) => (
        <span
          key={i}
          className="fx-splat"
          style={{ top: s.top, left: s.left, transform: `scale(${s.scale}) rotate(${s.rot})` }}
        />
      ))}
      <div className="fx-grain" />
    </div>
  );
}
