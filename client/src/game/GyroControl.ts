// @ts-nocheck
import { settings } from '../utils/Settings';

/**
 * Tilt-to-steer input for mobile. Wraps the DeviceOrientationEvent API and
 * reports a normalized (x, y, active) vector through the same shape as
 * Joystick.tsx's setJoystickVector, so Input.ts's existing analog-axis
 * pipeline (turn curve, speed mapping) handles gyro and touch-joystick
 * input identically - see Input.ts's _externalAxis().
 *
 * iOS 13+ Safari gates raw orientation data behind an explicit permission
 * prompt that MUST be triggered by a user gesture (a tap) - start() is only
 * ever called from Game.ts's start()/applySettingsLive(), both of which run
 * synchronously inside a click handler chain (Start Game / Settings' Save
 * button), satisfying that requirement. Android and desktop browsers have
 * no such gate and start receiving events immediately.
 */

// Degrees of tilt (relative to wherever the phone was held when gyro mode
// started) that map to full -1..1 deflection - tuned for a comfortable
// wrist tilt rather than requiring the phone held perfectly flat/vertical.
// Exact feel is unverified on real hardware; adjust if steering feels too
// twitchy (raise) or too sluggish (lower).
const TILT_RANGE_DEG = 22;

export function isGyroSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export function needsGyroPermission() {
  return isGyroSupported() && typeof DeviceOrientationEvent.requestPermission === 'function';
}

function screenAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return window.orientation;
  }
  return 0;
}

// deviceorientation's beta/gamma are always relative to the phone's
// physical enclosure, not however the page is currently rotated on screen -
// this game is played in landscape (see OrientationGate.tsx), so without
// remapping by the live screen rotation, tilting the phone left/right would
// read as pitch instead of roll (or the reverse) depending on which way the
// player rotated into landscape.
function remapTilt(beta, gamma, angle) {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { roll: -beta, pitch: gamma };
    case 180:
      return { roll: -gamma, pitch: -beta };
    case 270:
      return { roll: beta, pitch: -gamma };
    default:
      return { roll: gamma, pitch: beta };
  }
}

export class GyroControl {
  constructor() {
    this._onOrientation = this._onOrientation.bind(this);
    this._baseline = null;
    this._onVector = null;
    this._listening = false;
  }

  /**
   * Begins listening and reports normalized (x, y, active) vectors to
   * onVector on every reading. Resolves once listening has started, not
   * once the first reading arrives - the calibration baseline is whatever
   * angle the phone happens to be at on that first real event, not a fixed
   * "flat" reference. Rejects if unsupported or permission is denied.
   */
  async start(onVector) {
    if (!isGyroSupported()) throw new Error('unsupported');
    this._onVector = onVector;
    if (needsGyroPermission()) {
      let result;
      try {
        result = await DeviceOrientationEvent.requestPermission();
      } catch (e) {
        throw new Error('denied');
      }
      if (result !== 'granted') throw new Error('denied');
    }
    this._baseline = null;
    window.addEventListener('deviceorientation', this._onOrientation);
    this._listening = true;
  }

  stop() {
    if (!this._listening) return;
    window.removeEventListener('deviceorientation', this._onOrientation);
    this._listening = false;
    this._baseline = null;
    this._onVector?.(0, 0, false);
  }

  _onOrientation(event) {
    if (event.beta == null || event.gamma == null) return;
    const { roll, pitch } = remapTilt(event.beta, event.gamma, screenAngle());
    if (!this._baseline) {
      this._baseline = { roll, pitch };
    }
    const invert = settings.get('invertGyroX') ? -1 : 1;
    const dRoll = (roll - this._baseline.roll) * invert;
    const dPitch = this._baseline.pitch - pitch; // tip forward (pitch decreases) = speed up
    const x = Math.max(-1, Math.min(1, dRoll / TILT_RANGE_DEG));
    const y = Math.max(-1, Math.min(1, dPitch / TILT_RANGE_DEG));
    this._onVector?.(x, y, true);
  }
}
