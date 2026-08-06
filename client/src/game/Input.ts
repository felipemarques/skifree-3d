// @ts-nocheck
import { settings } from '../utils/Settings';

/**
 * Input — reads keyboard, mouse, a virtual joystick, and device tilt
 * depending on Settings.controlMode.
 *
 * controlMode:
 *   'keyboard' — only WASD/arrow keys steer; mouse is ignored completely.
 *   'mouse'    — only mouse controls direction and speed; keyboard ignored.
 *   'both'     — both active; keyboard overrides mouse when keys are pressed.
 *   'gyro'     — device tilt controls direction and speed (mobile only, see
 *                GyroControl.ts); keyboard still works as a fallback.
 *
 * Touch is a floating joystick (Joystick.tsx) rather than an absolute
 * screen-position drag: it reports a normalized -1..1 vector relative to
 * wherever the player's thumb first touched down, like a real analog
 * stick, via setJoystickVector(). Gyro mode reports the same shape of
 * vector via setGyroVector() (see GyroControl.ts), calibrated relative to
 * whatever angle the phone was held at when it started listening. Both are
 * treated identically by _externalAxis() below - whichever is active
 * forces mouse-equivalent routing regardless of controlMode, so either
 * works even if the player's saved preference is 'keyboard' from a prior
 * desktop session. Only one is ever active at a time in practice (the
 * touch joystick only mounts when controlMode isn't 'gyro' and vice versa),
 * but if both somehow report simultaneously the joystick wins.
 */
export class Input {
  constructor() {
    this.keys = {};
    this.mouse = { x: 0, y: 0, screenX: 0, screenY: 0 };

    // Track whether any key was pressed this frame (to decide override in 'both' mode)
    this._anyKeyHeld = false;

    this._touchJumpHeld = false;
    this._joystickActive = false;
    this._joystickX = 0; // -1 (left) .. 1 (right)
    this._joystickY = 0; // -1 (pulled down/boost) .. 1 (pushed up/brake)
    this._gyroActive = false;
    this._gyroX = 0; // -1 (tilt left) .. 1 (tilt right)
    this._gyroY = 0; // -1 (tilt back/brake) .. 1 (tilt forward/boost)

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp   = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);

    window.addEventListener('keydown',    this._onKeyDown);
    window.addEventListener('keyup',      this._onKeyUp);
    window.addEventListener('mousemove',  this._onMouseMove);
    window.addEventListener('mousedown',  this._onMouseDown);
    window.addEventListener('mouseup',    this._onMouseUp);
    window.addEventListener('blur',       this._onWindowBlur);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  /**
   * Window lost focus (alt-tab, click-out) — release every held input so
   * returning to the tab doesn't resume with Space/Shift/WASD permanently
   * stuck for the rest of the run (see C1 in todo/gameplay-scan.md).
   */
  _onWindowBlur() {
    this.clearAllInput();
  }

  /**
   * Tab went hidden — same release as blur. Mobile browsers don't fire
   * `blur` reliably when the app is backgrounded, so visibilitychange is the
   * backstop. Touch state is included: a thumb can lift mid-gesture and the
   * pointercancel never reach the joystick/jump button.
   */
  _onVisibilityChange() {
    if (document.hidden) this.clearAllInput();
  }

  clearAllInput() {
    this.keys = {};
    this._anyKeyHeld = false;
    this._touchJumpHeld = false;
    this._joystickActive = false;
    this._joystickX = 0;
    this._joystickY = 0;
    this._gyroActive = false;
    this._gyroX = 0;
    this._gyroY = 0;
  }

  _onKeyDown(e) {
    this.keys[e.code] = true;
    this.keys[e.key.toLowerCase()] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    this.keys[e.code] = false;
    this.keys[e.key.toLowerCase()] = false;
  }

  _onMouseMove(e) {
    this.mouse.screenX = e.clientX;
    this.mouse.screenY = e.clientY;
    this.mouse.x = (e.clientX / window.innerWidth)  * 2 - 1;  // -1 … +1
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;  // -1 … +1  (top = +1)
  }

  _onMouseDown(e) {
    if (e.button === 0) this.keys.MouseLeft = true;
  }

  _onMouseUp(e) {
    if (e.button === 0) this.keys.MouseLeft = false;
  }

  /** Called by the on-screen jump button (TouchControls.tsx). */
  setTouchJump(pressed) {
    this._touchJumpHeld = !!pressed;
  }

  /**
   * Called by the floating virtual joystick (Joystick.tsx) - x/y already
   * normalized to -1..1 relative to the joystick's own center (wherever the
   * thumb touched down), not absolute screen position. active=false on
   * release resets to neutral and stops forcing mouse-equivalent routing.
   */
  setJoystickVector(x, y, active = true) {
    this._joystickActive = !!active;
    this._joystickX = active ? x : 0;
    this._joystickY = active ? y : 0;
  }

  /**
   * Called by GyroControl.ts on every device-tilt reading, once gyro mode
   * has permission and is listening - same normalized -1..1 shape as
   * setJoystickVector, already calibrated relative to wherever the phone
   * was held when it started. active=false stops forcing the external-axis
   * routing (e.g. controlMode switched away from 'gyro' mid-run).
   */
  setGyroVector(x, y, active = true) {
    this._gyroActive = !!active;
    this._gyroX = active ? x : 0;
    this._gyroY = active ? y : 0;
  }

  /**
   * Touch joystick and device tilt both report through this same analog
   * axis - whichever is currently active takes over lateralAxis/
   * mouseSpeedFraction below regardless of controlMode, exactly like the
   * joystick already did before gyro support existed. The joystick wins if
   * both are somehow active at once (shouldn't happen - see the class
   * doc comment).
   */
  _externalAxis() {
    if (this._joystickActive) return { x: this._joystickX, y: this._joystickY };
    if (this._gyroActive) return { x: this._gyroX, y: this._gyroY };
    return null;
  }

  isDown(code) {
    return !!this.keys[code];
  }

  _getKeyboardState() {
    const keyLeft = this.isDown('ArrowLeft') || this.isDown('KeyA') || this.isDown('a');
    const keyRight = this.isDown('ArrowRight') || this.isDown('KeyD') || this.isDown('d');
    const keyBrake = this.isDown('ArrowUp') || this.isDown('KeyW') || this.isDown('w');
    const keyBoost = this._isBoostKeyDown();
    return {
      keyLeft,
      keyRight,
      keyBrake,
      keyBoost,
      keyAxis: (keyLeft ? -1 : 0) + (keyRight ? 1 : 0),
      anyHeld: keyLeft || keyRight || keyBrake || keyBoost || this.jump,
    };
  }

  // ---- aggregated inputs used by Player.js ----

  /**
   * Lateral steering axis: -1 (left) … +1 (right)
   * Respects controlMode and mouseSensitivity.
   */
  get lateralAxis() {
    const ext = this._externalAxis();
    if (ext) {
      const sensitivity = settings.get('mouseSensitivity');
      // Response curve, not a raw linear pass-through: Player.ts multiplies
      // speed by cos(turn angle), floored at 0.28 - deliberately calibrated
      // so pinning a hard turn costs most of your speed (max turn angle's
      // cosine is ~0.25). A joystick (or a gyro tilt held at an angle)
      // invites holding a diagonal position in a way keyboard taps/mouse
      // micro-movements don't, so a raw pass-through drifts the ski toward
      // max-turn (and that speed floor) far more readily than intended.
      // Curving it means small/moderate pushes turn gently - full
      // deflection still reaches the exact same max as before, so nothing
      // about the actual turn range changes.
      const x = ext.x;
      const curved = Math.sign(x) * Math.pow(Math.abs(x), 1.6);
      return Math.max(-1, Math.min(1, curved * sensitivity));
    }

    const mode = settings.get('controlMode');
    const sensitivity = settings.get('mouseSensitivity');
    const deadzone = settings.get('mouseDeadzone');

    const keyboard = this._getKeyboardState();
    this._anyKeyHeld = keyboard.anyHeld;

    if (mode === 'keyboard') {
      return keyboard.keyAxis;
    }

    // Mouse lateral: use mouse.x if outside deadzone
    let mouseAxis = 0;
    if (Math.abs(this.mouse.x) > deadzone) {
      mouseAxis = Math.sign(this.mouse.x) *
        Math.min(1, (Math.abs(this.mouse.x) - deadzone) / (1 - deadzone)) *
        sensitivity;
    }

    if (mode === 'mouse') {
      return Math.max(-1, Math.min(1, mouseAxis));
    }

    // 'both': any gameplay key takes ownership. In particular, holding boost
    // must not leave a stale mouse X position steering the skier sideways.
    if (keyboard.anyHeld) return keyboard.keyAxis;
    return Math.max(-1, Math.min(1, mouseAxis));
  }

  /**
   * Speed modifier: null = natural, or a fraction 0…1 where 0=full brake, 1=full boost.
   * Only meaningful when mouse/joystick is active.
   */
  get mouseSpeedFraction() {
    const ext = this._externalAxis();
    if (ext) {
      // Physical stick/tilt mapping only: +1 = pushed up / tilted forward
      // (boost), -1 = pulled down / tilted back (brake). invertMouseY is a
      // mouse-only preference — applying it here flipped up=boost on touch.
      const jy = ext.y;
      if (Math.abs(jy) <= 0.05) return null; // small deadzone around center
      return Math.max(0, Math.min(1, (1 + jy) / 2));
    }

    const mode = settings.get('controlMode');
    const deadzone = settings.get('mouseDeadzone');
    const invertY = settings.get('invertMouseY');
    const keyboard = this._getKeyboardState();

    if (mode === 'keyboard') return null;

    // In 'both'/'gyro' mode, mouse speed only applies when no keys held -
    // gyro included so a keyboard plugged into a phone (or desktop testing
    // with controlMode stuck on 'gyro') doesn't fight a stale mouse Y.
    if ((mode === 'both' || mode === 'gyro') && keyboard.anyHeld) return null;

    let my = this.mouse.y; // +1 = top, -1 = bottom
    if (invertY) my = -my;

    // Mouse Y controls speed: move mouse DOWN (my < -deadzone) = faster, UP = brake
    if (Math.abs(my) <= deadzone) return null; // in deadzone = neutral

    // Map -1…+1 (after deadzone) to 0…1 (0=brake, 1=boost)
    // my ranges from +1 (top) to -1 (bottom).
    // We want: top → brake (low fraction), bottom → boost (high fraction)
    const normalizedY = (-my - deadzone) / (1 - deadzone); // 0 at top-deadzone, 1 at bottom
    return Math.max(0, Math.min(1, normalizedY));
  }

  get boost() {
    const mode = settings.get('controlMode');
    if (mode === 'mouse') return false; // mouse speed handles it
    return this._isBoostKeyDown();
  }

  get brake() {
    const mode = settings.get('controlMode');
    if (mode === 'mouse') return false; // mouse speed handles it
    return this.isDown('ArrowUp') || this.isDown('KeyW') || this.isDown('w');
  }

  get jump() {
    return this.isDown('Space') || this._touchJumpHeld;
  }

  get fire() {
    return (
      this.isDown('KeyE') ||
      this.isDown('e') ||
      this.isDown('ControlLeft') ||
      this.isDown('ControlRight') ||
      this.isDown('control') ||
      this.isDown('MouseLeft')
    );
  }

  _isBoostKeyDown() {
    return (
      this.isDown('ArrowDown') ||
      this.isDown('KeyS') ||
      this.isDown('s') ||
      this.isDown('KeyF') ||
      this.isDown('f') ||
      this.isDown('ShiftLeft') ||
      this.isDown('ShiftRight') ||
      this.isDown('shift')
    );
  }

  destroy() {
    window.removeEventListener('keydown',   this._onKeyDown);
    window.removeEventListener('keyup',     this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('blur',      this._onWindowBlur);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }
}
