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
    const freqs = [130.81, 196.0, 261.63]; // C3, G3, C4 - open, calm-but-moody

    this._ambientOscs = freqs.map((freq, i) => {
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
    if (this._ambientGain) {
      this._ambientGain.gain.setTargetAtTime(0.05 + speedNorm * 0.03, now, 1.2);
      this._ambientFilter.frequency.setTargetAtTime(400 + speedNorm * 900, now, 0.8);
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

    // Block updateContinuous from re-opening them
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
