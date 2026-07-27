/**
 * Synthesised SFX. No audio files, no network, no CSP allowance needed —
 * everything is oscillators and one noise buffer.
 *
 * The context is created on the click that starts the race, so autoplay
 * policy is satisfied by construction.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  resume() {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);

        const len = Math.floor(this.ctx.sampleRate * 0.6);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.02);
    }
  }

  close() {
    try {
      this.ctx?.close();
    } catch {
      // already gone
    }
    this.ctx = null;
    this.master = null;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number
  ) {
    const c = this.ctx;
    const m = this.master;
    if (!c || !m || !this.enabled) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(m);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number, q: number) {
    const c = this.ctx;
    const m = this.master;
    if (!c || !m || !this.noise || !this.enabled) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(freq, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(m);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  go() {
    this.tone(220, 0.1, "square", 0.15);
    window.setTimeout(() => this.tone(330, 0.1, "square", 0.15), 130);
    window.setTimeout(() => this.tone(523, 0.22, "square", 0.18), 260);
  }

  crash() {
    this.burst(0.55, 0.5, 1800, 0.7);
    this.tone(160, 0.5, "sawtooth", 0.22, 42);
  }

  shield() {
    this.burst(0.2, 0.22, 2600, 3);
    this.tone(880, 0.24, "triangle", 0.14, 1500);
  }

  pickup() {
    this.tone(660, 0.09, "square", 0.16);
    window.setTimeout(() => this.tone(990, 0.09, "square", 0.16), 80);
    window.setTimeout(() => this.tone(1320, 0.16, "square", 0.14), 160);
  }

  milestone() {
    this.tone(392, 0.12, "square", 0.14);
    window.setTimeout(() => this.tone(523, 0.12, "square", 0.14), 110);
    window.setTimeout(() => this.tone(659, 0.12, "square", 0.14), 220);
    window.setTimeout(() => this.tone(784, 0.3, "square", 0.16), 330);
  }

  near() {
    this.burst(0.16, 0.14, 900, 1.2);
  }

  over() {
    this.tone(392, 0.18, "sawtooth", 0.16, 300);
    window.setTimeout(() => this.tone(294, 0.2, "sawtooth", 0.16, 220), 180);
    window.setTimeout(() => this.tone(196, 0.6, "sawtooth", 0.18, 90), 380);
  }

  win() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) =>
      window.setTimeout(() => this.tone(n, 0.28, "square", 0.16), i * 110)
    );
  }
}
