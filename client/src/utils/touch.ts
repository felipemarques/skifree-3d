// @ts-nocheck
import { useEffect, useState } from 'react';
import { settings } from './Settings';

/**
 * Shared "is touch active" signal used by TouchControls, OrientationGate,
 * and Input.ts's control routing so all three agree on the same answer.
 * 'auto' (default) uses the standards-based pointer:coarse media feature -
 * "primary input is a finger, not a precise mouse" - which correctly
 * excludes touchscreen laptops (mouse stays primary there) unlike
 * UA-sniffing. 'on'/'off' let a player override it from Settings.
 */
export function isTouchActive() {
  const override = settings.get('touchControls');
  if (override === 'on') return true;
  if (override === 'off') return false;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function isPortraitOrientation() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(orientation: portrait)').matches;
}

// Tailwind's own max-sm: breakpoints throughout the HUD are width-gated
// (<640px), but a landscape phone is short, not narrow - many phones are
// well over 640px wide in landscape, so those breakpoints never fired and
// the HUD stayed at full desktop sizing in a viewport barely 350-400px
// tall. This is the height-based signal used to shrink it instead.
export const COMPACT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';

export function isCompactLandscape() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(COMPACT_LANDSCAPE_QUERY).matches;
}

/** Reactive version of isCompactLandscape() - shared by ScreenFrame.tsx and
 * any screen that wants to rearrange its own layout (e.g. TitleScreen going
 * wider/multi-column) rather than just relying on ScreenFrame's uniform
 * shrink-to-fit. */
export function useCompactLandscape() {
  const [compact, setCompact] = useState(isCompactLandscape);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(COMPACT_LANDSCAPE_QUERY);
    const handler = () => setCompact(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return compact;
}
