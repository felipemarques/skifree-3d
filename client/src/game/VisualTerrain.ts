// @ts-nocheck
const SLOPE_STRENGTH = 0.026;
const SLOPE_BEHIND = 70;
const SLOPE_AHEAD = 230;
const RELIEF_SCALE = 0.78;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getSnowReliefY(worldX, worldZ) {
  return (
    Math.sin(worldX * 0.08 + worldZ * 0.045) * 0.42 +
    Math.sin(worldX * 0.19 - worldZ * 0.033) * 0.22 +
    Math.sin(worldX * 0.48 + worldZ * 0.17) * 0.07
  );
}

export function getVisualTerrainY(worldX, worldZ, anchorX = 0, anchorZ = 0) {
  const relZ = clamp(worldZ - anchorZ, -SLOPE_BEHIND, SLOPE_AHEAD);
  const slope = -relZ * SLOPE_STRENGTH;
  const relief = (getSnowReliefY(worldX, worldZ) - getSnowReliefY(anchorX, anchorZ)) * RELIEF_SCALE;
  return slope + relief;
}
