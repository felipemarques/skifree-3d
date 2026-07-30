// @ts-nocheck
import * as THREE from 'three';

// Ordered distance stops - the world's palette/lighting slowly evolves with
// z, purely for atmosphere (no gameplay/physics/determinism implications,
// unlike the weather system's grip). "Hold" stops (1200/3000) repeat the
// previous stop's values so the palette stays put until the transition band
// actually starts, rather than blending continuously from z=0. Transition
// bands are short (300m) and the shifts are large/saturated on purpose -
// this is meant to read as a clear change, not a barely-there drift.
const FOREST = {
  skyTop: 0x426b92, skyHorizon: 0xb6cada, skyGround: 0xd6e1e8, fogColor: 0xaec7dc,
  mountainTint: 0x9bb4c9, mountainTintT: 0, sunColor: 0xfffbec, sunIntensityMult: 1.0,
  hemiSky: 0xdcedff, hemiGround: 0x8aa4bd, treeHueShift: 0, rockHueShift: 0, snowTint: 0xffffff,
  terrainReliefMult: 0.7, auroraIntensity: 0,
};
const ALPINE = {
  skyTop: 0x1c4a7a, skyHorizon: 0xdcebf5, skyGround: 0xf0f6fa, fogColor: 0xb8dcf0,
  mountainTint: 0xf2f8fc, mountainTintT: 0.65, sunColor: 0xfffef5, sunIntensityMult: 1.25,
  hemiSky: 0xf5faff, hemiGround: 0xb8d4e8, treeHueShift: 0.07, rockHueShift: 0.05, snowTint: 0xe0f0ff,
  terrainReliefMult: 1.0, auroraIntensity: 0,
};
const CLIFFS = {
  skyTop: 0x24203f, skyHorizon: 0xe8703a, skyGround: 0xf0a066, fogColor: 0xe0956a,
  mountainTint: 0x2e2438, mountainTintT: 0.85, sunColor: 0xff8c42, sunIntensityMult: 0.75,
  hemiSky: 0xf0b080, hemiGround: 0x4a3550, treeHueShift: -0.08, rockHueShift: 0.06, snowTint: 0xffcc99,
  terrainReliefMult: 1.4, auroraIntensity: 1,
};

const STOPS = [
  { at: 0, ...FOREST },
  { at: 1200, ...FOREST },
  { at: 1500, ...ALPINE },
  { at: 3000, ...ALPINE },
  { at: 3300, ...CLIFFS },
];

const DOMINANT_THRESHOLDS = [
  { upTo: 1350, name: 'forest' },
  { upTo: 3150, name: 'alpine' },
];

function findBracket(z) {
  if (z <= STOPS[0].at) return { a: STOPS[0], b: STOPS[0], t: 0 };
  for (let i = 1; i < STOPS.length; i++) {
    if (z <= STOPS[i].at) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      const span = Math.max(1, b.at - a.at);
      return { a, b, t: THREE.MathUtils.clamp((z - a.at) / span, 0, 1) };
    }
  }
  const last = STOPS[STOPS.length - 1];
  return { a: last, b: last, t: 0 };
}

export function createBiomeBlendTarget() {
  return {
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    skyGround: new THREE.Color(),
    fogColor: new THREE.Color(),
    mountainTint: new THREE.Color(),
    mountainTintT: 0,
    sunColor: new THREE.Color(),
    sunIntensityMult: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    snowTint: new THREE.Color(),
    terrainReliefMult: 1,
    auroraIntensity: 0,
  };
}

export function getBiomeAtZ(z, target) {
  const { a, b, t } = findBracket(z);
  target.skyTop.set(a.skyTop).lerp(new THREE.Color(b.skyTop), t);
  target.skyHorizon.set(a.skyHorizon).lerp(new THREE.Color(b.skyHorizon), t);
  target.skyGround.set(a.skyGround).lerp(new THREE.Color(b.skyGround), t);
  target.fogColor.set(a.fogColor).lerp(new THREE.Color(b.fogColor), t);
  target.mountainTint.set(a.mountainTint).lerp(new THREE.Color(b.mountainTint), t);
  target.mountainTintT = THREE.MathUtils.lerp(a.mountainTintT, b.mountainTintT, t);
  target.sunColor.set(a.sunColor).lerp(new THREE.Color(b.sunColor), t);
  target.sunIntensityMult = THREE.MathUtils.lerp(a.sunIntensityMult, b.sunIntensityMult, t);
  target.hemiSky.set(a.hemiSky).lerp(new THREE.Color(b.hemiSky), t);
  target.hemiGround.set(a.hemiGround).lerp(new THREE.Color(b.hemiGround), t);
  target.snowTint.set(a.snowTint).lerp(new THREE.Color(b.snowTint), t);
  target.terrainReliefMult = THREE.MathUtils.lerp(a.terrainReliefMult, b.terrainReliefMult, t);
  target.auroraIntensity = THREE.MathUtils.lerp(a.auroraIntensity, b.auroraIntensity, t);
  return target;
}

export function getBiomeHueShiftAtZ(z) {
  const { a, b, t } = findBracket(z);
  return {
    treeHueShift: THREE.MathUtils.lerp(a.treeHueShift, b.treeHueShift, t),
    rockHueShift: THREE.MathUtils.lerp(a.rockHueShift, b.rockHueShift, t),
  };
}

export function getDominantBiome(z) {
  for (const { upTo, name } of DOMINANT_THRESHOLDS) {
    if (z < upTo) return name;
  }
  return 'cliffs';
}
