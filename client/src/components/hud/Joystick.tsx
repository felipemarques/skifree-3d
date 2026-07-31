import { useState } from 'react';
import type { GameController } from '@/app/gameController';

const MAX_RADIUS = 52;
const RING_SIZE = MAX_RADIUS * 2;
const KNOB_SIZE = 52;

/**
 * Floating virtual joystick, relative to wherever the player's thumb
 * touches down (not a fixed on-screen position, and not an absolute
 * screen-position drag like the old scheme) - touch anywhere in the left
 * zone and the ring appears centered right under the thumb, the knob
 * follows the finger clamped to a max radius, and releasing snaps back to
 * neutral. Reports a normalized -1..1 vector to Input.ts via
 * GameController.setJoystickVector - X steers, Y sets speed (push up to
 * boost, pull down to brake - the natural up=faster reading, not mouse
 * mode's inverted up=brake convention).
 */
export function Joystick({ controller }: { controller: GameController | null }) {
  const [touchId, setTouchId] = useState<number | null>(null);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const report = (dx: number, dy: number) => {
    controller?.setJoystickVector(dx / MAX_RADIUS, -dy / MAX_RADIUS, true);
  };

  const findTouch = (list: React.TouchList) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === touchId) return list[i];
    }
    return null;
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (touchId !== null) return; // already steering with one finger
    const touch = event.changedTouches[0];
    if (!touch) return;
    setTouchId(touch.identifier);
    setCenter({ x: touch.clientX, y: touch.clientY });
    setKnob({ x: 0, y: 0 });
    // Activate immediately (centered/neutral), not only once the first
    // touchmove delta comes in - controller.setJoystickVector mutates
    // Input.ts directly rather than going through React state, so this
    // takes effect this same tick. Without it, the brief window between
    // touchdown and the first detected move fell through to the non-touch
    // control path (stale desktop mouse.x/y), which reads as the stick
    // "not working" right as the player starts dragging.
    controller?.setJoystickVector(0, 0, true);
    event.preventDefault();
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const touch = findTouch(event.changedTouches);
    if (!touch) return;
    const dx = touch.clientX - center.x;
    const dy = touch.clientY - center.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, MAX_RADIUS);
    const angle = Math.atan2(dy, dx);
    const kx = dist > 0 ? Math.cos(angle) * clampedDist : 0;
    const ky = dist > 0 ? Math.sin(angle) * clampedDist : 0;
    setKnob({ x: kx, y: ky });
    report(kx, ky);
    event.preventDefault();
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const touch = findTouch(event.changedTouches);
    if (!touch) return;
    setTouchId(null);
    setKnob({ x: 0, y: 0 });
    controller?.setJoystickVector(0, 0, false);
    event.preventDefault();
  };

  const active = touchId !== null;

  return (
    <div
      className="pointer-events-auto fixed inset-y-0 left-0 z-[150] w-[58%]"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {active && (
        <>
          <div
            className="pointer-events-none absolute rounded-full border-2 border-white/30 bg-white/5"
            style={{ left: center.x - MAX_RADIUS, top: center.y - MAX_RADIUS, width: RING_SIZE, height: RING_SIZE }}
          />
          <div
            className="pointer-events-none absolute rounded-full border border-white/55 bg-white/25 backdrop-blur-sm"
            style={{
              left: center.x + knob.x - KNOB_SIZE / 2,
              top: center.y + knob.y - KNOB_SIZE / 2,
              width: KNOB_SIZE,
              height: KNOB_SIZE,
            }}
          />
        </>
      )}
    </div>
  );
}
