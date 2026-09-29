// Tiny synthesised sound effects. No assets to load; everything is WebAudio noise and sines.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
  }

  /** Must be called from a user gesture (the Deploy click). */
  unlock() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(1.5);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** distance-based volume, 0..1 */
  gainFor(distance) {
    return Math.max(0.08, 1 - distance / 60);
  }

  burst({ duration, filterFrom, filterTo, volume, thump }) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, now);
    filter.frequency.exponentialRampToValueAtTime(filterTo, now + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + duration);

    if (thump) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(thump, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + duration * 0.8);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(volume * 0.9, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.8);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + duration);
    }
  }

  shot(distance) {
    this.burst({ duration: 0.22, filterFrom: 2200, filterTo: 300, volume: 0.7 * this.gainFor(distance), thump: 140 });
  }

  hit(distance) {
    this.burst({ duration: 0.12, filterFrom: 3500, filterTo: 800, volume: 0.35 * this.gainFor(distance) });
  }

  clang(distance) {
    this.burst({ duration: 0.18, filterFrom: 5000, filterTo: 1200, volume: 0.5 * this.gainFor(distance), thump: 420 });
  }

  explosion(distance) {
    this.burst({ duration: 0.9, filterFrom: 1200, filterTo: 80, volume: 1.0 * this.gainFor(distance), thump: 90 });
  }
}
