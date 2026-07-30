// @ts-nocheck
import { settings } from '../utils/Settings';

/**
 * AudioManager — all sounds synthesized via Web Audio API.
 * No external files required.
 *
 * Sounds:
 *   - wind loop    : low-pass filtered white noise, pitch/volume scales with speed
 *   - ski slide    : high-pass white noise burst when turning hard
 *   - collision    : short percussive thud
 *   - heart lost   : descending tone (sad ding)
 *   - yeti roar    : low rumble growl
 *   - game over    : wah-wah descending chord
 *   - boost whoosh : brief upward sweep on boost activation
 *   - jump         : quick upward blip
 *   - land         : soft thud
 */
export class AudioManager {
  constructor() {
    this._ctx       = null;
    this._ready     = false;
    this._muted     = false;
    this._stopped   = false;  // set to true on game over
    this._volume    = settings.get('sfxVolume');

    // Persistent nodes
    this._masterGain = null;
    this._windGain  = null;
    this._windNode  = null;
    this._windFilter = null;

    this._slideGain = null;
    this._slideNode = null;

    // Bind unlock to first user gesture
    this._unlock = this._unlock.bind(this);
    window.addEventListener('keydown',   this._unlock, { once: true });
    window.addEventListener('mousedown', this._unlock, { once: true });
    window.addEventListener('click',     this._unlock, { once: true });
  }

  // ── Init ─────────────────────────────────────────────────────────────
  _unlock() {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') this._ctx.resume();
      return;
    }
    try {
      this._ctx   = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._muted ? 0 : this._volume;
      this._masterGain.connect(this._ctx.destination);
      this._ready = true;
      this._stopped = false;
      this._buildWindLoop();
      this._buildSlideLoop();
      this._buildTensionLoop();
      this._buildAmbientLoop();
      this._buildReverb();
      this._buildMusicLayers();
    } catch (e) {
      console.warn('[Audio] Web Audio API not available:', e);
    }
  }

  unlock() {
    this._unlock();
  }

  get ctx() { return this._ctx; }

  // ── Wind loop (continuous, pitch + volume driven by speed) ────────────
  _buildWindLoop() {
    const ctx = this._ctx;

    // White noise source via ScriptProcessor (old but universal)
    const bufLen  = ctx.sampleRate * 2; // 2 s buffer
    const buf     = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data    = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;

    // Band-pass filter to shape wind character
    const filter       = ctx.createBiquadFilter();
    filter.type        = 'bandpass';
    filter.frequency.value = 300;
    filter.Q.value     = 0.8;

    const gain       = ctx.createGain();
    gain.gain.value  = 0;   // start silent

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain || ctx.destination);
    src.start();

    this._windFilter = filter;
    this._windGain   = gain;
    this._windNode   = src;
  }

  // ── Ski slide (short burst noise for lateral carving) ────────────────
  _buildSlideLoop() {
    const ctx = this._ctx;

    const bufLen = ctx.sampleRate;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src   = ctx.createBufferSource();
    src.buffer  = buf;
    src.loop    = true;

    const filter       = ctx.createBiquadFilter();
    filter.type        = 'highpass';
    filter.frequency.value = 2400;
    filter.Q.value     = 1.2;

    const gain       = ctx.createGain();
    gain.gain.value  = 0;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain || ctx.destination);
    src.start();

    this._slideGain = gain;
    this._slideNode = src;
  }

  // ── Yeti tension drone (continuous, fades in approaching trigger range) ──
  _buildTensionLoop() {
    const ctx = this._ctx;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 42;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 63; // slight beating against osc1 for unease

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 200;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc1.connect(filt);
    osc2.connect(filt);
    filt.connect(gain);
    gain.connect(this._masterGain || ctx.destination);
    osc1.start();
    osc2.start();

    this._tensionOsc1 = osc1;
    this._tensionOsc2 = osc2;
    this._tensionGain = gain;
  }

  /** intensity 0..1 - how close the player is to the yeti trigger threshold. */
  updateTension(intensity) {
    if (!this._ready || !this._tensionGain) return;
    const target = (this._muted || this._stopped) ? 0 : Math.max(0, Math.min(1, intensity)) * 0.22;
    this._tensionGain.gain.setTargetAtTime(target, this._ctx.currentTime, 0.6);
  }

  // ── Ambient pad (continuous, very low, brightens slightly with speed) ────
  _buildAmbientLoop() {
    const ctx = this._ctx;
    // Slowly cycled open-fifth voicings (no third, so each stays ambiguous
    // major/minor - "calm-but-moody") rather than one fixed chord held
    // forever, which read as a flat, monotone hum with no sense of motion.
    this._ambientChords = [
      [130.81, 196.0, 261.63],  // C3 G3 C4
      [110.0, 164.81, 220.0],   // A2 E3 A3
      [174.61, 261.63, 349.23], // F3 C4 F4
      [98.0, 146.83, 196.0],    // G2 D3 G3
    ];
    this._ambientChordIndex = 0;
    this._ambientChordTimer = 14 + Math.random() * 4;

    this._ambientOscs = this._ambientChords[0].map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 1 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 6;
      return osc;
    });

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    for (const osc of this._ambientOscs) {
      osc.connect(filt);
      osc.start();
    }
    filt.connect(gain);
    gain.connect(this._masterGain || ctx.destination);

    this._ambientFilter = filt;
    this._ambientGain = gain;
  }

  /** Glides the pad's oscillators to the next voicing every ~14-20s. */
  _updateAmbientChord(dt, now) {
    if (!this._ambientOscs) return;
    this._ambientChordTimer -= dt;
    if (this._ambientChordTimer > 0) return;
    this._ambientChordIndex = (this._ambientChordIndex + 1) % this._ambientChords.length;
    const chord = this._ambientChords[this._ambientChordIndex];
    this._ambientOscs.forEach((osc, i) => {
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(chord[i], now + 5);
    });
    this._ambientChordTimer = 14 + Math.random() * 6;
  }

  // ── Reverb send (canyon echo, cliffs biome only) ──────────────────────
  _buildReverb() {
    const ctx = this._ctx;
    const duration = 1.8;
    const length = Math.floor(ctx.sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.5;
    convolver.connect(wetGain);
    wetGain.connect(this._masterGain);
    // Ambient one-shots connect straight into the convolver for a fully-wet
    // canyon echo - deliberately not a general dry/wet send bus for every
    // sound, to avoid changing the feel of anything already tuned.
    this._reverbInput = convolver;
  }

  // ── Adaptive music (rhythmic layers over the ambient pad + tension drone) ─
  // A lookahead scheduler: notes are timestamped against the AudioContext's
  // own clock (not setTimeout firing time) so there's no drift, and it's
  // driven from the same per-frame updateContinuous/updateMusic call the
  // rest of continuous audio already uses rather than a separate timer.
  _buildMusicLayers() {
    const ctx = this._ctx;
    this._bassGain = ctx.createGain();
    this._bassGain.gain.value = 1;
    this._bassGain.connect(this._masterGain);

    this._arpGain = ctx.createGain();
    this._arpGain.gain.value = 1;
    this._arpGain.connect(this._masterGain);

    this._musicEnergy = 0;
    this._musicChainT = 0;
    this._musicBeat = 0;
    this._nextNoteTime = 0;
  }

  _playBassNote(time, beat, energy) {
    const notes = [65.41, 65.41, 98.0, 65.41]; // C2 C2 G2 C2 - under the ambient pad's C3/G3/C4
    const osc = this._ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = notes[beat % notes.length];

    const g = this._ctx.createGain();
    const peak = 0.16 * energy;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

    osc.connect(g);
    g.connect(this._bassGain);
    osc.start(time);
    osc.stop(time + 0.26);
  }

  _playArpNote(time, beat, chainT) {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 - bright, same key
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = notes[beat % notes.length];

    const g = this._ctx.createGain();
    const peak = 0.06 * chainT;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

    osc.connect(g);
    g.connect(this._arpGain);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  /**
   * @param {number} dt
   * @param {number} speed   - player speed m/s (0-28), same scale updateContinuous uses
   * @param {number} dangerT - 0-1, active-yeti proximity/danger (Game.ts's _yetiDangerT)
   * @param {number} chainT  - 0-1, jump-chain window remaining (Game.ts's _chainRemainingT)
   */
  updateMusic(dt, speed, dangerT, chainT) {
    if (!this._ready || this._muted || this._stopped) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    this._updateAmbientChord(dt, now);

    const speedNorm = Math.min((speed || 0) / 28, 1);
    const targetEnergy = Math.max(0, Math.min(1, speedNorm * 0.45 + (dangerT || 0) * 0.75 + (chainT || 0) * 0.5));
    const lerpT = Math.min(1, dt * 2);
    this._musicEnergy += (targetEnergy - this._musicEnergy) * lerpT;
    this._musicChainT += ((chainT || 0) - this._musicChainT) * lerpT;

    if (this._nextNoteTime < now) this._nextNoteTime = now;
    const bpm = 100 + this._musicEnergy * 40;
    const beatDur = 60 / bpm / 2; // 8th notes

    while (this._nextNoteTime < now + 0.12) {
      if (this._musicEnergy > 0.04) this._playBassNote(this._nextNoteTime, this._musicBeat, this._musicEnergy);
      if (this._musicChainT > 0.04) this._playArpNote(this._nextNoteTime, this._musicBeat, this._musicChainT);
      this._musicBeat++;
      this._nextNoteTime += beatDur;
    }
  }

  // ── Per-frame update driven by game state ─────────────────────────────
  /**
   * @param {number} speed      - player speed m/s (0–28)
   * @param {number} turnAngle  - |angle| 0–1.3 rad
   * @param {boolean} isAirborne
   */
  updateContinuous(speed, turnAngle, isAirborne) {
    if (!this._ready || this._muted || this._stopped) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Wind: volume 0.02 at rest → 0.28 at boost speed
    const speedNorm  = Math.min(speed / 28, 1);
    const windVol    = 0.02 + speedNorm * 0.26;
    const windFreq   = 180 + speedNorm * 600;
    this._windGain.gain.setTargetAtTime(isAirborne ? windVol * 1.4 : windVol, now, 0.15);
    this._windFilter.frequency.setTargetAtTime(windFreq, now, 0.1);

    // Slide: audible only when turning and on ground
    const turnNorm   = Math.min(Math.abs(turnAngle) / 1.32, 1); // 0..1
    const slideVol   = isAirborne ? 0 : turnNorm * turnNorm * 0.18 * speedNorm;
    this._slideGain.gain.setTargetAtTime(slideVol, now, 0.04);

    // Ambient pad: always faintly present, brightens a little with speed.
    // A slow filter LFO ("breathing") adds gentle motion on top of the
    // slow chord cycling in _updateAmbientChord, so it never sits dead
    // static even mid-chord.
    if (this._ambientGain) {
      const breathe = Math.sin(now * 0.15) * 90;
      this._ambientGain.gain.setTargetAtTime(0.05 + speedNorm * 0.03, now, 1.2);
      this._ambientFilter.frequency.setTargetAtTime(400 + speedNorm * 900 + breathe, now, 0.8);
    }
  }

  // ── One-shot helpers ──────────────────────────────────────────────────
  _gain(value, destination) {
    const g       = this._ctx.createGain();
    g.gain.value  = value;
    g.connect(destination || this._masterGain || this._ctx.destination);
    return g;
  }

  /** Stereo destination for a directional sound; pan is -1 (left) .. 1 (right). */
  _panned(pan = 0) {
    const dest = this._masterGain || this._ctx.destination;
    if (!pan) return dest;
    const panner = this._ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(dest);
    return panner;
  }

  _osc(type, freq, gainValue, when, duration, pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = when ?? ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type  = type;
    osc.frequency.value = freq;

    const g       = ctx.createGain();
    g.gain.setValueAtTime(gainValue, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(g);
    g.connect(this._panned(pan));
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  _noise(gainValue, when, duration, filterFreq = 800, filterType = 'bandpass', pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx    = this._ctx;
    const now    = when ?? ctx.currentTime;
    const bufLen = Math.ceil(ctx.sampleRate * (duration + 0.05));
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src    = ctx.createBufferSource();
    src.buffer   = buf;

    const filt   = ctx.createBiquadFilter();
    filt.type    = filterType;
    filt.frequency.value = filterFreq;

    const g      = ctx.createGain();
    g.gain.setValueAtTime(gainValue, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filt);
    filt.connect(g);
    g.connect(this._panned(pan));
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  // ── Public one-shot sounds ─────────────────────────────────────────────

  playCollision(pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Low thud
    this._osc('sine',   60, 0.5, now,        0.18, pan);
    this._osc('sine',   80, 0.3, now + 0.01, 0.12, pan);
    // Snow spray burst
    this._noise(0.35, now, 0.12, 600, 'bandpass', pan);
  }

  playHeartLost() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Descending "ouch" tones
    this._osc('sine', 420, 0.4, now,        0.12);
    this._osc('sine', 300, 0.4, now + 0.12, 0.14);
    this._osc('sine', 200, 0.3, now + 0.26, 0.18);
  }

  playJump() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Quick upward blip
    const osc        = ctx.createOscillator();
    osc.type         = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(520, now + 0.14);

    const g      = ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(g);
    g.connect(this._masterGain || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  playLand() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    this._osc('sine', 90, 0.35, now, 0.14);
    this._noise(0.2, now, 0.08, 400, 'bandpass');
  }

  playNearMiss(pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Quick, light "swish-ting" - kept low volume since this can fire often.
    const osc        = ctx.createOscillator();
    osc.type         = 'triangle';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(1500, now + 0.08);

    const g      = ctx.createGain();
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(g);
    g.connect(this._panned(pan));
    osc.start(now);
    osc.stop(now + 0.15);

    this._noise(0.06, now, 0.06, 3000, 'highpass', pan);
  }

  playJumpChain() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Short ascending two-note chime for a chained ramp jump.
    this._osc('sine', 520, 0.22, now, 0.12);
    this._osc('sine', 720, 0.26, now + 0.08, 0.16);
  }

  playBoost() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Wind-rush sweep
    const osc        = ctx.createOscillator();
    osc.type         = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.linearRampToValueAtTime(380, now + 0.3);

    const g      = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(g);
    g.connect(this._masterGain || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  playYetiRoar(pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Low rumble + growl
    const osc1       = ctx.createOscillator();
    osc1.type        = 'sawtooth';
    osc1.frequency.setValueAtTime(55, now);
    osc1.frequency.linearRampToValueAtTime(40, now + 0.6);

    const osc2       = ctx.createOscillator();
    osc2.type        = 'square';
    osc2.frequency.setValueAtTime(110, now);
    osc2.frequency.linearRampToValueAtTime(75, now + 0.5);

    const filt       = ctx.createBiquadFilter();
    filt.type        = 'lowpass';
    filt.frequency.value = 400;

    const g      = ctx.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc1.connect(filt);
    osc2.connect(filt);
    filt.connect(g);
    g.connect(this._panned(pan));
    osc1.start(now); osc1.stop(now + 0.85);
    osc2.start(now); osc2.stop(now + 0.85);

    // Add noise layer
    this._noise(0.3, now, 0.7, 180, 'bandpass', pan);
  }

  /** kind: 'blizzard' | 'icy' - fires once on entering that weather zone. */
  playWeatherShift(kind) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    if (kind === 'blizzard') {
      // Rising gust of wind - noise swell under a low descending whoosh.
      this._noise(0.22, now, 0.9, 900, 'bandpass');
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.linearRampToValueAtTime(90, now + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.16, now + 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc.connect(g);
      g.connect(this._masterGain || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.95);
    } else if (kind === 'icy') {
      // Bright glassy chime + a thin high crackle of noise.
      this._osc('triangle', 1400, 0.12, now, 0.5);
      this._osc('sine', 2100, 0.07, now + 0.05, 0.4);
      this._noise(0.05, now, 0.4, 5000, 'highpass');
    }
  }

  // ── Biome ambience (occasional, one-shot) ──────────────────────────────
  playBirdChirp(pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const chirps = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < chirps; i++) {
      const t = now + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200 + Math.random() * 600, t);
      osc.frequency.exponentialRampToValueAtTime(3000 + Math.random() * 500, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(g);
      g.connect(this._panned(pan));
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  playWindGust(pan = 0) {
    if (!this._ready || this._muted) return;
    const now = this._ctx.currentTime;
    this._noise(0.14, now, 2.2, 500, 'bandpass', pan);
    // Low resonant creak layered under the gust - reads as wind moving
    // trees rather than just air.
    this._noise(0.06, now + 0.15, 0.9, 200, 'bandpass', pan);
  }

  playCanyonEcho(pan = 0) {
    if (!this._ready || this._muted || !this._reverbInput) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g);
    g.connect(this._reverbInput);
    osc.start(now);
    osc.stop(now + 0.25);
    // Small dry click for attack, so it doesn't read as pure reverb tail.
    this._noise(0.08, now, 0.04, 1200, 'bandpass', pan);
  }

  /** Distant rockslide/avalanche rumble - a cliffs-biome alternate to the
   * canyon echo, no pitch sweep, longer low-frequency decay. */
  playDistantRumble(pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 38;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 140;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
    osc.connect(filt);
    filt.connect(g);
    g.connect(this._panned(pan));
    osc.start(now);
    osc.stop(now + 1.7);
    this._noise(0.16, now, 1.5, 220, 'lowpass', pan);
  }

  /**
   * biomeName: 'forest' | 'alpine' | 'cliffs' - fires an occasional ambient
   * cue and returns which one just fired ('bird' | 'wind' | 'echo' | null),
   * so callers can sync a matching visual (e.g. a bird crossing the sky).
   */
  updateAmbient(dt, biomeName) {
    if (!this._ready || this._muted || this._stopped) return null;
    this._ambientCueTimer = (this._ambientCueTimer ?? (6 + Math.random() * 8)) - dt;
    if (this._ambientCueTimer > 0) return null;
    this._ambientCueTimer = 6 + Math.random() * 8;
    const pan = Math.random() * 2 - 1;
    if (biomeName === 'forest') { this.playBirdChirp(pan); return 'bird'; }
    if (biomeName === 'alpine') { this.playWindGust(pan); return 'wind'; }
    if (biomeName === 'cliffs') {
      if (Math.random() < 0.5) this.playCanyonEcho(pan);
      else this.playDistantRumble(pan);
      return 'echo';
    }
    return null;
  }

  // ── Weather foley (occasional, tied to weather zones rather than biome) ──
  playIceCrack(pan = 0) {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    // Sharp high tick...
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2600 + Math.random() * 800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(g);
    g.connect(this._panned(pan));
    osc.start(now);
    osc.stop(now + 0.08);
    // ...followed by a quick low settling thump.
    this._osc('sine', 90, 0.12, now + 0.04, 0.1, pan);
    this._noise(0.05, now, 0.03, 4000, 'highpass', pan);
  }

  playBlizzardHowl() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(160, now + 1.4);
    osc.frequency.linearRampToValueAtTime(200, now + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.09, now + 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
    osc.connect(g);
    g.connect(this._masterGain || ctx.destination);
    osc.start(now);
    osc.stop(now + 2.9);
    this._noise(0.1, now, 2.5, 700, 'bandpass');
  }

  /** weather: { grip, fogIntensity } - the weather zone at the player's
   * current z (see shared/AuthoritativeSim.ts's getWeatherAtZ). Icy/blizzard
   * are orthogonal to biome, so this runs its own timer rather than piggy-
   * backing on updateAmbient's biome-cue timer. */
  updateWeatherFoley(dt, weather) {
    if (!this._ready || this._muted || this._stopped || !weather) return;

    if (weather.grip < 0.9) {
      this._iceCrackTimer = (this._iceCrackTimer ?? (5 + Math.random() * 4)) - dt;
      if (this._iceCrackTimer <= 0) {
        this._iceCrackTimer = 5 + Math.random() * 4;
        this.playIceCrack(Math.random() * 2 - 1);
      }
    } else {
      this._iceCrackTimer = null;
    }

    if (weather.fogIntensity >= 0.6) {
      this._blizzardHowlTimer = (this._blizzardHowlTimer ?? (8 + Math.random() * 6)) - dt;
      if (this._blizzardHowlTimer <= 0) {
        this._blizzardHowlTimer = 8 + Math.random() * 6;
        this.playBlizzardHowl();
      }
    } else {
      this._blizzardHowlTimer = null;
    }
  }

  playGameOver() {
    if (!this._ready || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Wah-wah descent
    const freqs = [440, 370, 310, 220, 165];
    freqs.forEach((f, i) => {
      const t = now + i * 0.22;
      this._osc('sine',   f,       0.35, t, 0.28);
      this._osc('square', f * 0.5, 0.10, t, 0.28);
    });
  }

  // ── Mute toggle ───────────────────────────────────────────────────────
  setMuted(muted) {
    this._muted = muted;
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setTargetAtTime(muted ? 0 : this._volume, this._ctx.currentTime, 0.08);
    }
    if (this._slideGain) {
      this._slideGain.gain.setTargetAtTime(0, this._ctx?.currentTime ?? 0, 0.05);
    }
  }

  get muted() { return this._muted; }

  setVolume(value) {
    this._volume = Math.max(0, Math.min(1, Number(value) || 0));
    if (this._masterGain && this._ctx && !this._muted) {
      this._masterGain.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.08);
    }
  }

  silenceContinuous() {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    if (this._windGain) this._windGain.gain.setTargetAtTime(0, now, 0.06);
    if (this._slideGain) this._slideGain.gain.setTargetAtTime(0, now, 0.04);
    if (this._tensionGain) this._tensionGain.gain.setTargetAtTime(0, now, 0.3);
    if (this._ambientGain) this._ambientGain.gain.setTargetAtTime(0, now, 0.3);
    if (this._bassGain) this._bassGain.gain.setTargetAtTime(0, now, 0.2);
    if (this._arpGain) this._arpGain.gain.setTargetAtTime(0, now, 0.2);
    this._musicEnergy = 0;
    this._musicChainT = 0;
  }

  /**
   * Immediately silence all continuous loops and block further one-shots.
   * Called on game over so nothing bleeds over the game-over chord.
   */
  stopAll() {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;

    // Ramp wind and slide to silence instantly
    if (this._windGain)  this._windGain.gain.setTargetAtTime(0,  now, 0.04);
    if (this._slideGain) this._slideGain.gain.setTargetAtTime(0, now, 0.02);
    if (this._tensionGain) this._tensionGain.gain.setTargetAtTime(0, now, 0.04);
    if (this._ambientGain) this._ambientGain.gain.setTargetAtTime(0, now, 0.15);
    // Cuts the gain bus immediately, so any bass/arp notes already scheduled
    // within updateMusic's ~120ms lookahead window don't bleed into silence.
    if (this._bassGain) this._bassGain.gain.setTargetAtTime(0, now, 0.03);
    if (this._arpGain) this._arpGain.gain.setTargetAtTime(0, now, 0.03);
    this._musicEnergy = 0;
    this._musicChainT = 0;

    // Block updateContinuous/updateMusic from re-opening them
    this._stopped = true;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────
  dispose() {
    try {
      this._windNode?.stop();
      this._slideNode?.stop();
      this._tensionOsc1?.stop();
      this._tensionOsc2?.stop();
      this._ambientOscs?.forEach(osc => osc.stop());
      this._ctx?.close();
    } catch (_) {}
    this._ready = false;
  }
}
