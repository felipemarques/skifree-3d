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
 *   - music        : generative pad + bass + melody + drums, see the
 *                     "Adaptive music" section below
 */

// ── Shared music theory ────────────────────────────────────────────────
// Every musical layer (pad, bass, melody) generates its notes from these
// instead of each owning its own hardcoded frequencies - previously the
// ambient pad cycled through 4 chords on its own timer while the bass/arp
// stayed hardcoded to C major regardless, so most chord changes put the pad
// and the "music" out of key with each other. Locking everything to one
// progression fixes that at the source.
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11]; // semitones from C, one octave

function degreeToMidi(degree, octave) {
  const len = MAJOR_SCALE_INTERVALS.length;
  const wrapped = ((degree % len) + len) % len;
  const octaveShift = Math.floor(degree / len);
  return 12 + MAJOR_SCALE_INTERVALS[wrapped] + (octave + octaveShift) * 12; // 12 = MIDI note C0
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Octave-folds a note into [low, high] - without this, a motif's fixed
// scale-degree offsets (e.g. root+7 for "an octave up") land in a
// noticeably different, chord-dependent register depending on how close
// that chord's own root sits to the top of the 7-note scale (e.g. root=A
// wraps an extra octave sooner than root=C does), so the same motif shape
// would sound a full octave brighter on some chords than others. Folding
// keeps the melody's register consistent across every chord in the
// progression.
function foldToRange(midi, low, high) {
  while (midi < low) midi += 12;
  while (midi > high) midi -= 12;
  return midi;
}

// I - vi - IV - V in C major (rootDegree = scale-degree index, 0-based:
// C D E F G A B). padFreqs keep the original hand-voiced open-fifth
// frequencies exactly (root/fifth/root-octave) - only the bass/melody below
// are new, derived from rootDegree so they always agree with this pad.
const PROGRESSION = [
  { rootDegree: 0, padFreqs: [130.81, 196.0, 261.63] },  // C  (C3 G3 C4)
  { rootDegree: 5, padFreqs: [110.0, 164.81, 220.0] },   // Am (A2 E3 A3)
  { rootDegree: 3, padFreqs: [174.61, 261.63, 349.23] }, // F  (F3 C4 F4)
  { rootDegree: 4, padFreqs: [98.0, 146.83, 196.0] },    // G  (G2 D3 G3)
];

// One short motif per progression chord, as scale-degree offsets from that
// chord's root (0=root, 2=third, 4=fifth, 7=octave, -3=degree below root) -
// transposes automatically via degreeToMidi, so it's always in key no
// matter which chord is current. Position advances continuously across the
// whole run rather than resetting at each phrase boundary, so it reads as
// one unfolding tune rather than a loop that visibly restarts every phrase.
const MELODY_MOTIFS = [
  [0, 2, 4, 7, 4, 2, 0, -3],
  [4, 2, 0, 2, 4, 7, 4, 0],
  [0, 4, 7, 4, 2, 0, -3, 0],
  [7, 4, 2, 0, 4, 7, 2, 0],
];

// Root-root-fifth-root - the same bass shape the original hardcoded
// C2/C2/G2/C2 loop used, now parametrized by whichever chord is current.
const BASS_DEGREE_OFFSETS = [0, 0, 4, 0];

const BARS_PER_CHORD = 8; // phrase length (in bars) before the progression advances
const STEPS_PER_BAR = 8;  // eighth notes per bar, 4/4 time

// Per-section layer gain targets - "sections" are how this stops being just
// "louder as energy rises" and starts changing texture: Calm has no
// rhythm section at all, Cruise adds bass + light hats, Chase is the full
// kit. Smoothly crossfaded (see updateMusic's setTargetAtTime calls) on top
// of note-scheduling itself being gated by section, so a transition is both
// inaudible-as-a-click and an actual arrangement change, not just a fade.
const SECTION_TARGETS = {
  calm:   { bass: 0, drums: 0,    melody: 0.55 },
  cruise: { bass: 1, drums: 0.55, melody: 0.85 },
  chase:  { bass: 1, drums: 1,    melody: 1 },
};

export class AudioManager {
  constructor() {
    this._ctx       = null;
    this._ready     = false;
    this._muted     = !!settings.get('muted');
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
    filter.frequency.value = 420; // matches updateContinuous's idle baseline below
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
  // Voicings for the same I-vi-IV-V progression the bass/melody/drums below
  // are locked to (see PROGRESSION above) - open-fifth voicings (no third,
  // so each stays ambiguous major/minor - "calm-but-moody"), unchanged from
  // before. What changed is *when* it moves to the next chord: previously
  // its own independent wall-clock timer, now the shared beat grid driven
  // from updateMusic() (_glidePadToChord), so it can never drift out of
  // sync with what the bass/melody/drums are doing.
  _buildAmbientLoop() {
    const ctx = this._ctx;
    this._ambientChordIndex = 0;

    this._ambientOscs = PROGRESSION[0].padFreqs.map((freq, i) => {
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

    // A perfectly static pitch and amplitude on a sustained sine/triangle
    // chord is the textbook definition of a flat electronic hum, no matter
    // which chord it's on or how "in key" it is - this is what a real
    // sustained pad/string patch always has and this pad didn't: a slow,
    // continuous vibrato (pitch) and tremolo (amplitude) so it breathes
    // instead of sitting dead still. One shared LFO oscillator modulates
    // both, connected as actual Web Audio param modulation (adds onto
    // whatever updateContinuous's gain/detune automation is doing) rather
    // than recomputed by hand every frame.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09; // ~11s cycle

    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 4; // cents
    lfo.connect(vibratoDepth);
    for (const osc of this._ambientOscs) vibratoDepth.connect(osc.detune);

    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0.018;
    lfo.connect(tremoloDepth);
    tremoloDepth.connect(gain.gain);

    lfo.start();
    this._ambientLfo = lfo;
    this._ambientTremoloDepth = tremoloDepth;

    // This swell gain stage (see _glidePadToChord) was meant to give the
    // pad a real amplitude arc instead of holding perfectly flat - but a
    // periodic rise-and-fall in a sustained tone every ~15-19s turned out
    // to just BE a cyclic engine-revving sound, not a fix for one. Every
    // volume/timing tweak on this layer kept getting reported back as "the
    // humming" - so instead of tuning it further, it's disconnected from
    // the output entirely (not deleted - _glidePadToChord/PROGRESSION still
    // drive it, and the bass/melody below still read chord identity from
    // the same source, they just don't need this audible for that). The
    // oscillators/LFO keep running so nothing else has to change, they're
    // just not connected to anything that reaches speakers.
    const swellGain = ctx.createGain();
    swellGain.gain.value = 0.001;

    for (const osc of this._ambientOscs) {
      osc.connect(filt);
      osc.start();
    }
    filt.connect(gain);
    gain.connect(swellGain);
    // Deliberately not connected to _masterGain/destination - see comment above.

    this._ambientFilter = filt;
    this._ambientGain = gain;
    this._ambientSwellGain = swellGain;
  }

  /** Glides the pad's oscillators to a new chord's voicing over ~5s, and
   * re-triggers its swell-in/hold/taper-out amplitude envelope for the new
   * phrase - called from updateMusic() when the shared beat grid advances
   * to a new chord. */
  _glidePadToChord(chordIndex, now) {
    if (!this._ambientOscs) return;
    this._ambientChordIndex = chordIndex;
    const chord = PROGRESSION[chordIndex % PROGRESSION.length].padFreqs;
    this._ambientOscs.forEach((osc, i) => {
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(chord[i], now + 5);
    });

    if (this._ambientSwellGain) {
      const bpm = 100 + this._musicEnergy * 40;
      const beatDur = 60 / bpm / 2;
      const phraseDur = BARS_PER_CHORD * STEPS_PER_BAR * beatDur;
      const swell = this._ambientSwellGain.gain;
      // Confirmed (by ear) this pad's own swell/chord-glide cycle was still
      // the source of a persistent hum even with movement added - a floor
      // of 25% between phrases was still audibly "always on". This now
      // actually goes quiet for a real stretch of each phrase (not just
      // quieter) so there's a genuine gap instead of a continuous tone that
      // merely varies in loudness: swell in (first ~15%), hold at peak
      // (until ~30%), fade down to near-silence by 50%, then stay
      // near-silent for the whole back half until the next chord's attack
      // fires. Peak itself lowered too (was 1.0) - on top of the base gain
      // cut in updateContinuous, so even the "on" phase is subtle rather
      // than loud-then-quiet.
      const attack = phraseDur * 0.15;
      const holdEnd = phraseDur * 0.3;
      const fadeEnd = phraseDur * 0.5;
      const peak = 0.55;
      swell.cancelScheduledValues(now);
      swell.setValueAtTime(Math.max(0.0001, swell.value), now);
      swell.linearRampToValueAtTime(peak, now + attack);
      swell.setValueAtTime(peak, now + holdEnd);
      swell.linearRampToValueAtTime(0.02, now + fadeEnd);
      swell.setValueAtTime(0.02, now + phraseDur);
    }
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

  // ── Adaptive music (melody + bass + drums over the ambient pad + tension
  // drone, all locked to one shared harmonic/rhythmic clock) ───────────────
  // A lookahead scheduler: notes are timestamped against the AudioContext's
  // own clock (not setTimeout firing time) so there's no drift, and it's
  // driven from the same per-frame updateContinuous/updateMusic call the
  // rest of continuous audio already uses rather than a separate timer.
  _buildMusicLayers() {
    const ctx = this._ctx;

    // Bass/melody/drums all feed one compressed music bus rather than
    // _masterGain directly, so the denser Chase section (bass + full kit +
    // melody at once) doesn't clip or turn to mush.
    this._musicBus = ctx.createDynamicsCompressor();
    this._musicBus.threshold.value = -18;
    this._musicBus.ratio.value = 3;
    this._musicBus.connect(this._masterGain);

    this._bassGain = ctx.createGain();
    this._bassGain.gain.value = 1;
    this._bassGain.connect(this._musicBus);

    this._melodyGain = ctx.createGain();
    this._melodyGain.gain.value = 1;
    this._melodyGain.connect(this._musicBus);

    this._drumGain = ctx.createGain();
    this._drumGain.gain.value = 1;
    this._drumGain.connect(this._musicBus);

    this._musicEnergy = 0;
    this._musicChainT = 0;
    this._musicStep = 0;
    this._nextNoteTime = 0;
    this._musicSection = 'calm';
    this._currentChordIndex = -1; // forces the first _glidePadToChord call
  }

  _playBassNote(time, step, chordIndex, energy) {
    const root = PROGRESSION[chordIndex % PROGRESSION.length].rootDegree;
    const degree = root + BASS_DEGREE_OFFSETS[step % BASS_DEGREE_OFFSETS.length];
    const osc = this._ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(degreeToMidi(degree, 2));

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

  _playMelodyNote(time, step, chordIndex, gainMult) {
    const root = PROGRESSION[chordIndex % PROGRESSION.length].rootDegree;
    const motif = MELODY_MOTIFS[chordIndex % MELODY_MOTIFS.length];
    const offset = motif[step % motif.length];
    const midi = foldToRange(degreeToMidi(root + offset, 5), 64, 86);
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(midi);
    // Slight per-note detune, same humanizing touch the ambient pad's
    // oscillators already use, so the lead doesn't sound like a flat test tone.
    osc.detune.value = (Math.random() - 0.5) * 8;

    const g = this._ctx.createGain();
    const peak = 0.07 * gainMult;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

    osc.connect(g);
    g.connect(this._melodyGain);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  _playKick(time, peak) {
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.09);

    const g = this._ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    osc.connect(g);
    g.connect(this._drumGain);
    osc.start(time);
    osc.stop(time + 0.17);
  }

  _playHat(time, peak) {
    const ctx = this._ctx;
    const duration = 0.045;
    const bufLen = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 6000;

    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    src.connect(filt);
    filt.connect(g);
    g.connect(this._drumGain);
    src.start(time);
    src.stop(time + duration + 0.02);
  }

  _playSnare(time, peak) {
    const ctx = this._ctx;
    const duration = 0.12;
    const bufLen = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1800;
    filt.Q.value = 0.7;

    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    src.connect(filt);
    filt.connect(g);
    g.connect(this._drumGain);
    src.start(time);
    src.stop(time + duration + 0.02);

    // Body tone under the noise so it reads as a snare hit, not just hiss.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 190;
    const og = ctx.createGain();
    og.gain.setValueAtTime(peak * 0.6, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    osc.connect(og);
    og.connect(this._drumGain);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  /** Which arrangement is active for a given smoothed energy level - uses
   * different thresholds to enter vs. leave each section (hysteresis) so it
   * doesn't flicker back and forth near a boundary. */
  _sectionForEnergy(energy, current) {
    if (current === 'chase') return energy < 0.35 ? (energy < 0.12 ? 'calm' : 'cruise') : 'chase';
    if (current === 'cruise') return energy >= 0.5 ? 'chase' : (energy < 0.1 ? 'calm' : 'cruise');
    return energy >= 0.5 ? 'chase' : (energy >= 0.18 ? 'cruise' : 'calm'); // current === 'calm'
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

    const speedNorm = Math.min((speed || 0) / 28, 1);
    const targetEnergy = Math.max(0, Math.min(1, speedNorm * 0.45 + (dangerT || 0) * 0.75 + (chainT || 0) * 0.5));
    const lerpT = Math.min(1, dt * 2);
    this._musicEnergy += (targetEnergy - this._musicEnergy) * lerpT;
    this._musicChainT += ((chainT || 0) - this._musicChainT) * lerpT;
    this._musicSection = this._sectionForEnergy(this._musicEnergy, this._musicSection);

    const targets = SECTION_TARGETS[this._musicSection];
    this._bassGain.gain.setTargetAtTime(targets.bass, now, 0.6);
    this._drumGain.gain.setTargetAtTime(targets.drums, now, 0.6);
    this._melodyGain.gain.setTargetAtTime(targets.melody, now, 0.6);

    if (this._nextNoteTime < now) this._nextNoteTime = now;
    const bpm = 100 + this._musicEnergy * 40;
    const beatDur = 60 / bpm / 2; // eighth notes

    while (this._nextNoteTime < now + 0.12) {
      const step = this._musicStep;
      const bar = Math.floor(step / STEPS_PER_BAR);
      const chordIndex = Math.floor(bar / BARS_PER_CHORD) % PROGRESSION.length;
      if (chordIndex !== this._currentChordIndex) this._glidePadToChord(chordIndex, this._nextNoteTime);

      const section = this._musicSection;
      const quarterStep = Math.floor(step / 2);
      const onQuarter = step % 2 === 0;

      if (section !== 'calm') {
        this._playBassNote(this._nextNoteTime, step, chordIndex, this._musicEnergy);
      }

      // Melody: sparse (every other step, i.e. quarter notes) at rest, full
      // eighth-note density once moving, brighter still during a jump-chain
      // window (the old chainT-gated arp's role).
      if (section !== 'calm' || onQuarter) {
        const chainBoost = this._musicChainT > 0.04 ? 1 + this._musicChainT * 1.4 : 1;
        this._playMelodyNote(this._nextNoteTime, step, chordIndex, (0.35 + this._musicEnergy * 0.65) * chainBoost);
      }

      if (section === 'chase' && onQuarter) {
        const beatInBar = quarterStep % 4;
        if (beatInBar === 0 || beatInBar === 2) this._playKick(this._nextNoteTime, 0.26);
        else this._playSnare(this._nextNoteTime, 0.16);
      }
      if (section === 'chase') {
        this._playHat(this._nextNoteTime, onQuarter ? 0.05 : 0.035);
      } else if (section === 'cruise' && onQuarter) {
        this._playHat(this._nextNoteTime, 0.02);
      }

      this._musicStep++;
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

    // Wind: volume 0.02 at rest → 0.28 at boost speed. Band-pass noise held
    // at a rock-steady ~180Hz (the old idle frequency) is exactly how a low
    // engine-idle rumble gets synthesized - raised into a higher, airier
    // register so idle wind reads as a soft hiss instead of a drone, and
    // the turbulence LFO below (added to the filter's cutoff, not a
    // separately-tracked value) keeps it from ever holding perfectly still,
    // which is the other half of what made it sound mechanical.
    const speedNorm  = Math.min(speed / 28, 1);
    const windVol    = 0.006 + speedNorm * 0.08; // was 0.012 + speedNorm*0.16 - halved again, still too present
    const windFreq   = 420 + speedNorm * 700;
    const turbulence = Math.sin(now * 0.6) * 35 + Math.sin(now * 1.7) * 18;
    this._windGain.gain.setTargetAtTime(isAirborne ? windVol * 1.4 : windVol, now, 0.15);
    this._windFilter.frequency.setTargetAtTime(windFreq + turbulence, now, 0.1);

    // Slide: audible only when turning and on ground
    const turnNorm   = Math.min(Math.abs(turnAngle) / 1.32, 1); // 0..1
    const slideVol   = isAirborne ? 0 : turnNorm * turnNorm * 0.012 * speedNorm; // was 0.18, 0.09, 0.05, 0.025 - halved again
    this._slideGain.gain.setTargetAtTime(slideVol, now, 0.04);

    // Ambient pad: always faintly present, brightens a little with speed.
    // A slow filter LFO ("breathing") adds gentle motion on top of the
    // slow chord cycling in _glidePadToChord, so it never sits dead
    // static even mid-chord.
    if (this._ambientGain) {
      const breathe = Math.sin(now * 0.15) * 90;
      this._ambientGain.gain.setTargetAtTime(0.016 + speedNorm * 0.01, now, 1.2); // was 0.035 + speedNorm*0.02 - halved again
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
   * biomeName: 'forest' | 'alpine' | 'cliffs' | 'glacier' - fires an
   * occasional ambient cue and returns which one just fired
   * ('bird' | 'wind' | 'echo' | 'crack' | null), so callers can sync a
   * matching visual (e.g. a bird crossing the sky).
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
    if (biomeName === 'glacier') { this.playIceCrack(pan); return 'crack'; }
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
    // The tremolo LFO connects additively onto _ambientGain.gain (real Web
    // Audio param modulation, not a value we set directly) - ramping the
    // base to 0 above doesn't silence it, it'd keep wobbling audibly around
    // 0 forever. Ramp its depth down too.
    if (this._ambientTremoloDepth) this._ambientTremoloDepth.gain.setTargetAtTime(0, now, 0.3);
    if (this._bassGain) this._bassGain.gain.setTargetAtTime(0, now, 0.2);
    if (this._melodyGain) this._melodyGain.gain.setTargetAtTime(0, now, 0.2);
    if (this._drumGain) this._drumGain.gain.setTargetAtTime(0, now, 0.2);
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
    // Same reasoning as silenceContinuous - the tremolo LFO modulates
    // _ambientGain.gain additively, so it needs its own ramp-to-0 or the
    // pad keeps faintly wobbling under the game-over chord.
    if (this._ambientTremoloDepth) this._ambientTremoloDepth.gain.setTargetAtTime(0, now, 0.15);
    // Cuts the gain buses immediately, so any bass/melody/drum notes already
    // scheduled within updateMusic's ~120ms lookahead window don't bleed
    // into silence.
    if (this._bassGain) this._bassGain.gain.setTargetAtTime(0, now, 0.03);
    if (this._melodyGain) this._melodyGain.gain.setTargetAtTime(0, now, 0.03);
    if (this._drumGain) this._drumGain.gain.setTargetAtTime(0, now, 0.03);
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
      this._ambientLfo?.stop();
      this._ctx?.close();
    } catch (_) {}
    this._ready = false;
  }
}
