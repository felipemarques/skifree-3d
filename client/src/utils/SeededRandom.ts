// @ts-nocheck
// Deterministic pseudo-random number generator (LCG)
// Given the same seed, always produces the same sequence.
export class SeededRandom {
  constructor(seed = 12345) {
    this.seed = seed >>> 0;
  }

  next() {
    // Park-Miller LCG
    this.seed = Math.imul(1664525, this.seed) + 1013904223 >>> 0;
    return this.seed / 0xFFFFFFFF;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
}
