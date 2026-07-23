import { settings } from '../utils/Settings.js';

/**
 * Input — reads keyboard and/or mouse depending on Settings.controlMode.
 *
 * controlMode:
 *   'keyboard' — only WASD/arrow keys steer; mouse is ignored completely.
 *   'mouse'    — only mouse controls direction and speed; keyboard ignored.
 *   'both'     — both active; keyboard overrides mouse when keys are pressed.
 */
export class Input {
  constructor() {
    this.keys = {};
    this.mouse = { x: 0, y: 0, screenX: 0, screenY: 0 };

    // Track whether any key was pressed this frame (to decide override in 'both' mode)
    this._anyKeyHeld = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp   = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    window.addEventListener('keydown',    this._onKeyDown);
    window.addEventListener('keyup',      this._onKeyUp);
    window.addEventListener('mousemove',  this._onMouseMove);
    window.addEventListener('mousedown',  this._onMouseDown);
    window.addEventListener('mouseup',    this._onMouseUp);
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

  isDown(code) {
    return !!this.keys[code];
  }

  // ---- aggregated inputs used by Player.js ----

  /**
   * Lateral steering axis: -1 (left) … +1 (right)
   * Respects controlMode and mouseSensitivity.
   */
  get lateralAxis() {
    const mode = settings.get('controlMode');
    const sensitivity = settings.get('mouseSensitivity');
    const deadzone = settings.get('mouseDeadzone');

    const keyLeft  = this.isDown('ArrowLeft')  || this.isDown('KeyA') || this.isDown('a');
    const keyRight = this.isDown('ArrowRight') || this.isDown('KeyD') || this.isDown('d');
    const keyBrake = this.isDown('ArrowUp') || this.isDown('KeyW') || this.isDown('w');
    const keyBoost = this._isBoostKeyDown();
    const keyAxis  = (keyLeft ? -1 : 0) + (keyRight ? 1 : 0);
    this._anyKeyHeld = keyLeft || keyRight ||
      keyBrake || keyBoost || this.jump;

    if (mode === 'keyboard') {
      return keyAxis;
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

    // 'both': if any key is held, keyboard wins; otherwise mouse
    if (keyAxis !== 0) return keyAxis;
    return Math.max(-1, Math.min(1, mouseAxis));
  }

  /**
   * Speed modifier: null = natural, or a fraction 0…1 where 0=full brake, 1=full boost.
   * Only meaningful when mouse is active.
   */
  get mouseSpeedFraction() {
    const mode = settings.get('controlMode');
    const deadzone = settings.get('mouseDeadzone');
    const invertY = settings.get('invertMouseY');

    if (mode === 'keyboard') return null;

    // In 'both' mode, mouse speed only applies when no keys held
    if (mode === 'both' && this._anyKeyHeld) return null;

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
    return this.isDown('Space');
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
  }
}
