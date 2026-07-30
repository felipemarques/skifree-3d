// @ts-nocheck
const SLOPE_STRENGTH = 0.026;
const SLOPE_BEHIND = 70;
const SLOPE_AHEAD = 230;
const RELIEF_SCALE = 0.78;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getSnowReliefY(worldX, worldZ, swellMult = 1) {
  return (
    Math.sin(worldX * 0.08 + worldZ * 0.045) * 1.1 +
    Math.sin(worldX * 0.19 - worldZ * 0.033) * 0.6 +
    Math.sin(worldX * 0.48 + worldZ * 0.17) * 0.22 +
    Math.sin(worldX * 0.9 - worldZ * 0.55) * 0.09 +
    Math.sin(worldX * 0.022 + worldZ * 0.014) * 2.6 * swellMult
  );
}

export function getVisualTerrainY(worldX, worldZ, anchorX = 0, anchorZ = 0, swellMult = 1) {
  const relZ = clamp(worldZ - anchorZ, -SLOPE_BEHIND, SLOPE_AHEAD);
  const slope = -relZ * SLOPE_STRENGTH;
  const relief = (getSnowReliefY(worldX, worldZ, swellMult) - getSnowReliefY(anchorX, anchorZ, swellMult)) * RELIEF_SCALE;
  return slope + relief;
}
