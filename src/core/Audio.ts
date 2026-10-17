/**
 * All game audio, synthesised with the Web Audio API: no sound files to download.
 *
 * Music: public-domain carols (Jingle Bells, Deck the Halls, We Wish You a Merry Christmas,
 * God Rest Ye Merry Gentlemen) played by a small step sequencer with bell, bass, pad and
 * sleigh-bell voices. SFX: short synthesised one-shots.
 *
 * Browsers only allow audio after a user gesture, so call `audio.unlock()` from a tap/click.
 */

export type MusicTrack = 'village' | 'game' | 'cellar' | 'none';
export type Sfx =
  | 'click' | 'step' | 'jump' | 'discover' | 'ornament' | 'enter'
  | 'throw' | 'hit' | 'golden' | 'bad' | 'tick' | 'go'
  | 'catch' | 'magic' | 'rotate' | 'whistle' | 'deliver' | 'crash'
  | 'pick' | 'build' | 'blueprint' | 'chest' | 'spotted'
  | 'dice' | 'hop' | 'gift' | 'star' | 'fanfare' | 'fail' | 'firework';

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midi = (n: string) => {
  const m = /^([A-G]#?)(-?\d)$/.exec(n)!;
  return NOTE[m[1]] + (Number(m[2]) + 1) * 12;
};
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Chord → MIDI notes (root position, around C3–C4). */
const CHORDS: Record<string, string[]> = {
  C: ['C3', 'E3', 'G3'], F: ['F3', 'A3', 'C4'], G: ['G3', 'B3', 'D4'], G7: ['G3', 'B3', 'F4'], D: ['D3', 'F#3', 'A3'],
  D7: ['D3', 'F#3', 'C4'], Am: ['A3', 'C4', 'E4'], Em: ['E3', 'G3', 'B3'], E: ['E3', 'G#3', 'B3'], B7: ['B2', 'D#3', 'A3'],
  Dm: ['D3', 'F3', 'A3'],
};

interface Song {
  bpm: number;
  beatsPerBar: number;
  /** "NOTE:beats" tokens, "R:beats" for rests. Bars are just for readability. */
  melody: string;
  /** One chord per bar. */
  chords: string[];
  /** Voice for the tune. */
  lead: 'bell' | 'celesta';
  sleigh: boolean;
  /** Lower everything (cellar). */
  dark?: boolean;
}

const SONGS: Record<string, Song> = {
  jingle: {
    bpm: 132, beatsPerBar: 4, lead: 'bell', sleigh: true,
    melody: `E5:1 E5:1 E5:2 | E5:1 E5:1 E5:2 | E5:1 G5:1 C5:1.5 D5:0.5 | E5:4 |
             F5:1 F5:1 F5:1.5 F5:0.5 | F5:1 E5:1 E5:1 E5:0.5 E5:0.5 | E5:1 D5:1 D5:1 E5:1 | D5:2 G5:2 |
             E5:1 E5:1 E5:2 | E5:1 E5:1 E5:2 | E5:1 G5:1 C5:1.5 D5:0.5 | E5:4 |
             F5:1 F5:1 F5:1.5 F5:0.5 | F5:1 E5:1 E5:1 E5:0.5 E5:0.5 | G5:1 G5:1 F5:1 D5:1 | C5:4`,
    chords: ['C', 'C', 'C', 'C', 'F', 'C', 'D7', 'G', 'C', 'C', 'C', 'C', 'F', 'C', 'G7', 'C'],
  },
  deck: {
    bpm: 120, beatsPerBar: 4, lead: 'celesta', sleigh: true,
    melody: `G5:1.5 F5:0.5 E5:1 D5:1 | C5:1 D5:1 E5:1 C5:1 | D5:0.5 E5:0.5 F5:0.5 D5:0.5 E5:1.5 D5:0.5 | C5:1 B4:1 C5:2 |
             G5:1.5 F5:0.5 E5:1 D5:1 | C5:1 D5:1 E5:1 C5:1 | D5:0.5 E5:0.5 F5:0.5 D5:0.5 E5:1.5 D5:0.5 | C5:1 B4:1 C5:2 |
             D5:1.5 E5:0.5 F5:1 D5:1 | E5:1.5 F5:0.5 G5:1 D5:1 | E5:0.5 F#5:0.5 G5:1 A5:0.5 B5:0.5 C6:1 | B5:1 A5:1 G5:2 |
             G5:1.5 F5:0.5 E5:1 D5:1 | C5:1 D5:1 E5:1 C5:1 | A5:0.5 A5:0.5 A5:0.5 A5:0.5 G5:1.5 F5:0.5 | E5:1 D5:1 C5:2`,
    chords: ['C', 'C', 'G7', 'C', 'C', 'C', 'G7', 'C', 'G', 'C', 'D', 'G', 'C', 'C', 'F', 'C'],
  },
  wish: {
    bpm: 150, beatsPerBar: 3, lead: 'bell', sleigh: true,
    melody: `R:2 G4:1 | C5:1 C5:0.5 D5:0.5 C5:0.5 B4:0.5 | A4:1 A4:1 A4:1 | D5:1 D5:0.5 E5:0.5 D5:0.5 C5:0.5 | B4:1 G4:1 G4:1 |
             E5:1 E5:0.5 F5:0.5 E5:0.5 D5:0.5 | C5:1 A4:1 G4:0.5 G4:0.5 | A4:1 D5:1 B4:1 | C5:3`,
    chords: ['C', 'C', 'F', 'D7', 'G', 'C', 'F', 'G7', 'C'],
  },
  godrest: {
    bpm: 84, beatsPerBar: 4, lead: 'celesta', sleigh: false, dark: true,
    melody: `E4:1 E4:1 B4:1 B4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 E4:1 F#4:1 G4:1 | A4:1 B4:3 |
             E4:1 E4:1 B4:1 B4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 E4:1 F#4:1 G4:1 | A4:1 B4:3 |
             B4:1 C5:1 A4:1 B4:1 | C5:1 D5:1 E5:1 B4:1 | A4:1 G4:1 E4:1 F#4:1 | G4:2 E4:2`,
    chords: ['Em', 'Em', 'D', 'B7', 'Em', 'Em', 'D', 'B7', 'Em', 'Am', 'D', 'Em'],
  },
};

const PLAYLISTS: Record<Exclude<MusicTrack, 'none'>, string[]> = {
  village: ['jingle', 'deck'],
  game: ['wish', 'jingle'],
  cellar: ['godrest'],
};

interface Ev {
  beat: number;
  midi: number;
  beats: number;
}

function parseMelody(src: string): { events: Ev[]; length: number } {
  const events: Ev[] = [];
  let beat = 0;
  for (const tok of src.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    const [n, d] = tok.split(':');
    const beats = Number(d);
    if (n !== 'R') events.push({ beat, midi: midi(n), beats });
    beat += beats;
  }
  return { events, length: beat };
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private musicOn = true;
  private sfxOn = true;
  private volume = 0.8;

  private track: MusicTrack = 'none';
  private playlistIndex = 0;
  private song: Song | null = null;
  private parsed: { events: Ev[]; length: number } | null = null;
  private songStart = 0;
  private nextEvent = 0;
  private nextBeat = 0;
  private timer: number | null = null;

  get ready() {
    return !!this.ctx;
  }

  /** Create/resume the AudioContext. Must be called from a user gesture (tap, click, key). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyLevels();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) void this.ctx?.suspend();
        else void this.ctx?.resume();
      });
      if (this.track !== 'none') this.startTrack(this.track);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  configure(o: { music?: boolean; sfx?: boolean; volume?: number }) {
    if (o.music !== undefined) this.musicOn = o.music;
    if (o.sfx !== undefined) this.sfxOn = o.sfx;
    if (o.volume !== undefined) this.volume = o.volume;
    this.applyLevels();
  }

  private applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.sfxOn ? 0.75 : 0, t, 0.05);
  }

  // ---------------------------------------------------------------- music

  music(track: MusicTrack) {
    if (track === this.track) return;
    this.track = track;
    if (this.ctx) this.startTrack(track);
  }

  private startTrack(track: MusicTrack) {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
    if (track === 'none' || !this.ctx) return;
    this.playlistIndex = 0;
    this.loadSong(this.ctx.currentTime + 0.3);
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  private loadSong(at: number) {
    if (this.track === 'none') return;
    const list = PLAYLISTS[this.track];
    this.song = SONGS[list[this.playlistIndex % list.length]];
    this.playlistIndex++;
    this.parsed = parseMelody(this.song.melody);
    this.songStart = at;
    this.nextEvent = 0;
    this.nextBeat = 0;
  }

  /** Look-ahead scheduler: queue every note that starts in the next ~150 ms. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.song || !this.parsed) return;
    const spb = 60 / this.song.bpm;
    const horizon = ctx.currentTime + 0.15;
    const { events, length } = this.parsed;
    while (this.nextEvent < events.length && this.songStart + events[this.nextEvent].beat * spb < horizon) {
      const e = events[this.nextEvent++];
      const t = this.songStart + e.beat * spb;
      if (this.song.lead === 'bell') this.bell(hz(e.midi), t, Math.min(e.beats * spb * 1.6, 1.4), 0.32, this.musicBus);
      else this.celesta(hz(e.midi), t, Math.min(e.beats * spb * 1.4, 1.2), 0.3, this.musicBus);
    }
    // Accompaniment, one beat at a time: oom-pah bass, a soft pad each bar, sleigh bells on the off-beats.
    while (this.nextBeat < length && this.songStart + this.nextBeat * spb < horizon) {
      const b = this.nextBeat++;
      const t = this.songStart + b * spb;
      const bar = Math.floor(b / this.song.beatsPerBar);
      const inBar = b % this.song.beatsPerBar;
      const chord = (CHORDS[this.song.chords[bar] ?? 'C'] ?? CHORDS.C).map(midi);
      const dark = this.song.dark ? -12 : 0;
      this.bass(hz(chord[inBar % 2 === 0 ? 0 : 2] - 12 + dark), t, spb * 0.9);
      if (inBar === 0) this.pad(chord.map((m) => hz(m + dark)), t, spb * this.song.beatsPerBar);
      if (this.song.sleigh) {
        this.sleigh(t + spb / 2, 0.05);
        if (inBar % 2 === 1) this.sleigh(t, 0.07);
      }
    }
    if (this.songStart + length * spb < ctx.currentTime + 0.1) this.loadSong(this.songStart + (length + this.song.beatsPerBar) * spb);
  }

  // ---------------------------------------------------------------- voices

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** FM bell: sine carrier modulated at 3.5× with a fast-decaying index. */
  private bell(f: number, t: number, dur: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    modGain.gain.setValueAtTime(f * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
    mod.connect(modGain).connect(car.frequency);
    this.env(g, t, vol, 0.005, dur);
    car.connect(g).connect(out);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private celesta(f: number, t: number, dur: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    for (const [mult, v] of [[1, 1], [2, 0.25], [4, 0.08]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * mult;
      this.env(g, t, vol * v, 0.004, dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private bass(f: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    this.env(g, t, 0.28, 0.01, dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(freqs: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.musicBus);
    for (const f of freqs) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private sleigh(t: number, vol: number) {
    this.noiseHit(t, 0.08, 'highpass', 7000, vol, this.musicBus);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, out: AudioNode, sweepTo?: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(f: number, t: number, dur: number, vol: number, type: OscillatorType = 'sine', glideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    this.env(g, t, vol, 0.005, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- sound effects

  /** Play a one-shot. `pitch` scales frequency (e.g. rising pitch for catch streaks). */
  sfx(name: Sfx, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime + 0.005;
    const out = this.sfxBus;
    const p = pitch;
    switch (name) {
      case 'click': this.tone(880 * p, t, 0.05, 0.12, 'triangle'); break;
      case 'step': this.noiseHit(t, 0.09, 'lowpass', 900 * p, 0.12, out, 300); break;
      case 'jump': this.tone(300, t, 0.18, 0.12, 'triangle', 700); break;
      case 'discover': [72, 76, 79, 84].forEach((m, i) => this.bell(hz(m), t + i * 0.08, 0.9, 0.18, out)); break;
      case 'ornament': [79, 83, 86, 91, 95].forEach((m, i) => this.bell(hz(m), t + i * 0.07, 1.2, 0.2, out)); break;
      case 'enter': this.noiseHit(t, 0.45, 'bandpass', 400, 0.18, out, 3000, 2); break;
      case 'throw': this.noiseHit(t, 0.22, 'bandpass', 600, 0.22, out, 2400, 3); break;
      case 'hit':
        this.noiseHit(t, 0.25, 'lowpass', 1800, 0.35, out, 300);
        this.tone(160, t, 0.15, 0.25, 'sine', 70);
        break;
      case 'golden': [84, 88, 91].forEach((m, i) => this.bell(hz(m), t + i * 0.06, 0.8, 0.22, out)); break;
      case 'bad':
        this.tone(140, t, 0.25, 0.18, 'square', 90);
        this.tone(148, t, 0.25, 0.12, 'square', 95);
        break;
      case 'tick': this.tone(1200, t, 0.06, 0.1, 'square'); break;
      case 'go': this.tone(1568, t, 0.25, 0.14, 'square'); break;
      case 'catch': this.bell(hz(76) * p, t, 0.35, 0.22, out); break;
      case 'magic': [72, 76, 79, 83, 86, 91].forEach((m, i) => this.bell(hz(m), t + i * 0.05, 0.6, 0.15, out)); break;
      case 'rotate':
        this.noiseHit(t, 0.05, 'bandpass', 2500, 0.25, out, undefined, 4);
        this.tone(520, t, 0.06, 0.08, 'triangle');
        break;
      case 'whistle': {
        for (const f of [880, 1108]) {
          const o = ctx.createOscillator();
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          const g = ctx.createGain();
          o.frequency.value = f;
          lfo.frequency.value = 6;
          lg.gain.value = 12;
          lfo.connect(lg).connect(o.frequency);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.09, t + 0.06);
          g.gain.setValueAtTime(0.09, t + 0.5);
          g.gain.linearRampToValueAtTime(0.0001, t + 0.75);
          o.connect(g).connect(out);
          o.start(t);
          lfo.start(t);
          o.stop(t + 0.8);
          lfo.stop(t + 0.8);
        }
        this.noiseHit(t, 0.7, 'bandpass', 2000, 0.05, out, undefined, 1);
        break;
      }
      case 'deliver': [76, 79, 84].forEach((m, i) => this.bell(hz(m), t + i * 0.09, 1, 0.22, out)); break;
      case 'crash':
        this.noiseHit(t, 0.6, 'lowpass', 3000, 0.4, out, 200);
        this.tone(90, t, 0.4, 0.3, 'sine', 40);
        break;
      case 'pick': this.tone(660 * p, t, 0.08, 0.12, 'triangle', 990 * p); break;
      case 'build':
        for (let i = 0; i < 3; i++) {
          this.noiseHit(t + i * 0.12, 0.08, 'bandpass', 3200, 0.35, out, undefined, 6);
          this.tone(1900, t + i * 0.12, 0.12, 0.08, 'square', 1700);
        }
        [72, 76, 79, 84].forEach((m, i) => this.bell(hz(m), t + 0.4 + i * 0.07, 0.9, 0.2, out));
        break;
      case 'blueprint': this.noiseHit(t, 0.3, 'highpass', 2000, 0.12, out, 6000); break;
      case 'chest':
        this.noiseHit(t, 0.25, 'bandpass', 500, 0.2, out, 900, 3);
        [79, 83, 86].forEach((m, i) => this.bell(hz(m), t + 0.15 + i * 0.07, 0.8, 0.2, out));
        break;
      case 'spotted':
        for (const f of [110, 116.5, 155]) this.tone(f, t, 0.6, 0.12, 'sawtooth', f * 0.8);
        break;
      case 'dice':
        for (let i = 0; i < 6; i++) this.noiseHit(t + i * 0.07 + Math.random() * 0.03, 0.04, 'bandpass', 2500 + Math.random() * 1500, 0.3, out, undefined, 5);
        break;
      case 'hop': this.tone(500 * p, t, 0.08, 0.1, 'triangle', 800 * p); break;
      case 'gift': [72, 79, 84].forEach((m, i) => this.bell(hz(m), t + i * 0.06, 0.6, 0.2, out)); break;
      case 'star': this.bell(hz(84) * p, t, 1.2, 0.25, out); break;
      case 'fanfare': [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => this.bell(hz(m), t + i * 0.08, 1.4, 0.18, out)); break;
      case 'fail': [67, 64, 60].forEach((m, i) => this.celesta(hz(m), t + i * 0.18, 0.6, 0.18, out)); break;
      case 'firework':
        this.noiseHit(t, 0.5, 'highpass', 1500, 0.12, out, 400);
        this.noiseHit(t + 0.4, 0.8, 'lowpass', 2500, 0.3, out, 200);
        break;
    }
  }
}

export const audio = new AudioEngine();
