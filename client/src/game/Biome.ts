// @ts-nocheck
import * as THREE from 'three';
import { getBiomeKindAtZ, getBiomeZoneBlend } from '../../../shared/AuthoritativeSim';

// Per-biome palette/lighting values, purely for atmosphere (no gameplay/
// physics/determinism implications, unlike the weather system's grip). The
// order biomes appear in is now seed-shuffled (see shared/AuthoritativeSim.ts's
// getBiomeZoneBlend) rather than a fixed forest->alpine->cliffs->glacier
// sequence, so this file only needs the palette-per-kind lookup plus the
// shared zoning/blend-progress helper - no local stop table or thresholds.
const FOREST = {
  skyTop: 0x426b92, skyHorizon: 0xb6cada, skyGround: 0xd6e1e8, fogColor: 0xaec7dc,
  mountainTint: 0x9bb4c9, mountainTintT: 0, sunColor: 0xfffbec, sunIntensityMult: 1.0,
  hemiSky: 0xdcedff, hemiGround: 0x8aa4bd, treeHueShift: 0, rockHueShift: 0, snowTint: 0xcccccc,
  terrainReliefMult: 0.7, auroraIntensity: 0,
};
const ALPINE = {
  skyTop: 0x1c4a7a, skyHorizon: 0xdcebf5, skyGround: 0xf0f6fa, fogColor: 0xb8dcf0,
  mountainTint: 0xf2f8fc, mountainTintT: 0.65, sunColor: 0xfffef5, sunIntensityMult: 1.25,
  hemiSky: 0xf5faff, hemiGround: 0xb8d4e8, treeHueShift: 0.07, rockHueShift: 0.05, snowTint: 0xaaffff,
  terrainReliefMult: 1.0, auroraIntensity: 0.5,
};
const CLIFFS = {
  skyTop: 0x24203f, skyHorizon: 0xe8703a, skyGround: 0xf0a066, fogColor: 0xe0956a,
  mountainTint: 0x2e2438, mountainTintT: 0.85, sunColor: 0xff8c42, sunIntensityMult: 0.75,
  hemiSky: 0xf0b080, hemiGround: 0x4a3550, treeHueShift: -0.08, rockHueShift: 0.06, snowTint: 0xffcc99,
  terrainReliefMult: 1.4, auroraIntensity: 1,
};
const GLACIER = {
  skyTop: 0x0c2740, skyHorizon: 0xbfe8f5, skyGround: 0xe6f7fb, fogColor: 0xcdeef5,
  mountainTint: 0xeaf9ff, mountainTintT: 0.9, sunColor: 0xeaf6ff, sunIntensityMult: 0.95,
  hemiSky: 0xe0f7ff, hemiGround: 0x8fd0e0, treeHueShift: -0.15, rockHueShift: 0.12, snowTint: 0xbdf0ff,
  terrainReliefMult: 1.6, auroraIntensity: 1.3,
};

const WINDSWEPT = {
  skyTop: 0x5a6b78, skyHorizon: 0xc9d6dc, skyGround: 0xe4ecef, fogColor: 0xb0bec5,
  mountainTint: 0xaab8c2, mountainTintT: 0.7, sunColor: 0xf5f5f0, sunIntensityMult: 0.85,
  hemiSky: 0xd7e3e8, hemiGround: 0x94a3ab, treeHueShift: 0.02, rockHueShift: 0.08, snowTint: 0xd8e2e5,
  terrainReliefMult: 1.3, auroraIntensity: 0.3,
};
const DEADWOOD = {
  skyTop: 0x2e3a34, skyHorizon: 0x6b7a6e, skyGround: 0x8a9a8a, fogColor: 0x5f6f62,
  mountainTint: 0x3c463e, mountainTintT: 0.55, sunColor: 0xd9d9c8, sunIntensityMult: 0.65,
  hemiSky: 0x7d8c7f, hemiGround: 0x3a4038, treeHueShift: -0.22, rockHueShift: -0.05, snowTint: 0xc9d0c4,
  terrainReliefMult: 0.85, auroraIntensity: 0.15,
};

const BIOME_PALETTES = { forest: FOREST, alpine: ALPINE, cliffs: CLIFFS, glacier: GLACIER, windswept: WINDSWEPT, deadwood: DEADWOOD };

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

export function getBiomeAtZ(seed, z, target) {
  const { a: aKind, b: bKind, t } = getBiomeZoneBlend(seed, z);
  const a = BIOME_PALETTES[aKind];
  const b = BIOME_PALETTES[bKind];
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

export function getBiomeHueShiftAtZ(seed, z) {
  const { a: aKind, b: bKind, t } = getBiomeZoneBlend(seed, z);
  const a = BIOME_PALETTES[aKind];
  const b = BIOME_PALETTES[bKind];
  return {
    treeHueShift: THREE.MathUtils.lerp(a.treeHueShift, b.treeHueShift, t),
    rockHueShift: THREE.MathUtils.lerp(a.rockHueShift, b.rockHueShift, t),
  };
}

// Thin wrapper - the actual zoning/order lives in shared/AuthoritativeSim.ts
// (getBiomeKindAtZ) since obstacle generation needs it too and must stay
// deterministic/shared; this keeps the two from ever drifting apart.
export function getDominantBiome(seed, z) {
  return getBiomeKindAtZ(seed, z);
}
