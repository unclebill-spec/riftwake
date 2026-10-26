export class AudioBus {
  ctx: AudioContext | null = null;
  master = 0.7;
  music = 0.42;
  sfx = 0.7;
  private musicGain: GainNode | null = null;
  private nextNote = 0;
  private step = 0;
  private started = false;

  ensure(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.04 * this.master * this.music;
      this.musicGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.started = true;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.master = master;
    this.music = music;
    this.sfx = sfx;
    if (this.musicGain) this.musicGain.gain.value = 0.045 * master * music;
  }

  tick(): void {
    if (!this.ctx || !this.musicGain || !this.started || this.music <= 0.01 || this.master <= 0.01) return;
    const now = this.ctx.currentTime;
    if (now < this.nextNote) return;
    const scale = [110, 130.81, 146.83, 164.81, 196, 164.81, 146.83, 130.81];
    const freq = scale[this.step % scale.length] ?? 110;
    this.step += 1;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq / (this.step % 8 < 4 ? 2 : 1);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.9, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(now);
    osc.stop(now + 0.45);
    this.nextNote = now + 0.48;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || this.sfx <= 0.01 || this.master <= 0.01) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const peak = gain * this.master * this.sfx;
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  shoot(kind: string): void {
    if (kind === "beam") this.tone(740, 0.09, "sawtooth", 0.03);
    else if (kind === "wave") this.tone(280, 0.12, "triangle", 0.04);
    else if (kind === "fire") this.tone(420, 0.07, "square", 0.03);
    else if (kind === "ice") this.tone(880, 0.06, "sine", 0.035);
    else if (kind === "water") this.tone(360, 0.08, "triangle", 0.035);
    else this.tone(620, 0.05, "square", 0.03);
  }

  hit(): void {
    this.tone(160, 0.05, "sawtooth", 0.04);
  }

  hurt(): void {
    this.tone(90, 0.16, "square", 0.07);
  }

  pickup(): void {
    this.tone(660, 0.07, "triangle", 0.05);
    this.tone(880, 0.09, "sine", 0.03);
  }

  rage(): void {
    this.tone(196, 0.2, "sawtooth", 0.06);
  }

  portal(): void {
    this.tone(220, 0.28, "triangle", 0.06);
  }

  die(): void {
    this.tone(70, 0.35, "sawtooth", 0.08);
  }
}
