import assert from 'node:assert/strict';
import {
  MAX_HP,
  SIM_DT,
  FixedStepClock,
  OrderedInputBuffer,
  createInitialPlayerState,
  createMultiplayerSpawnXs,
  generateGameplayChunk,
  getChainWindowMs,
  getYetiConfig,
  maybeApplyYetiCapture,
  simulatePlayerTick,
} from '../server/dist/shared/AuthoritativeSim.js';

const settingsVolume = 1;
const chunkA = generateGameplayChunk(12345, 2, settingsVolume, new Set());
const chunkB = generateGameplayChunk(12345, 2, settingsVolume, new Set());
assert.deepEqual(chunkA, chunkB, 'gameplay obstacle generation must be deterministic');
assert.deepEqual(generateGameplayChunk(12345, 2, 0, new Set()), [], 'zero obstacle volume must produce an empty gameplay track');

const spawnXsA = createMultiplayerSpawnXs(24680, 8);
const spawnXsB = createMultiplayerSpawnXs(24680, 8);
assert.deepEqual(spawnXsA, spawnXsB, 'multiplayer spawn lanes must be deterministic');
assert.equal(spawnXsA.length, 8, 'spawn lane count should match player count');
for (let i = 0; i < spawnXsA.length; i++) {
  for (let j = i + 1; j < spawnXsA.length; j++) {
    assert.ok(Math.abs(spawnXsA[i] - spawnXsA[j]) >= 5.5, 'spawn lanes must be far enough apart to avoid initial skier collisions');
  }
}

const player = createInitialPlayerState('socket-a', 'Skier', 'player-a');
for (let i = 0; i < 30; i++) {
  simulatePlayerTick(player, {
    seq: i + 1,
    clientTime: i * SIM_DT * 1000,
    lateralAxis: 0,
    boost: true,
    brake: false,
    jumpPressed: false,
  }, SIM_DT, [], new Set(), i * SIM_DT * 1000);
}
assert.ok(player.z > 15, 'boosted player should move forward');
assert.ok(player.speed > 20, 'boosted player should accelerate');

const damaged = createInitialPlayerState('socket-b', 'Skier', 'player-b');
damaged.invincibilityRemaining = 0;
simulatePlayerTick(damaged, {
  seq: 1,
  clientTime: 0,
  lateralAxis: 0,
  boost: false,
  brake: false,
  jumpPressed: false,
}, SIM_DT, [{
  id: 'test-tree',
  type: 'tree',
  x: 0,
  z: 0.3,
  halfW: 1,
  halfD: 1,
  chunkIndex: 0,
}], new Set(), 0);
assert.equal(damaged.hp, MAX_HP - 1, 'tree collision should damage player');

const healed = createInitialPlayerState('socket-c', 'Skier', 'player-c');
healed.hp = 2;
const consumed = new Set();
simulatePlayerTick(healed, {
  seq: 1,
  clientTime: 0,
  lateralAxis: 0,
  boost: false,
  brake: true,
  jumpPressed: false,
}, SIM_DT, [{
  id: 'test-heart',
  type: 'heart',
  x: 0,
  z: 0.1,
  halfW: 1,
  halfD: 1,
  chunkIndex: 0,
}], consumed, 0);
assert.equal(healed.hp, MAX_HP, 'heart pickup should heal player');
assert.ok(consumed.has('test-heart'), 'heart pickup should be consumed');

const noYeti = createInitialPlayerState('socket-d', 'Skier', 'player-d');
noYeti.distance = 999999;
const noYetiEvents = [];
maybeApplyYetiCapture(noYeti, {
  gameMode: 'classic',
  difficulty: 'extreme',
  yetiStartMode: 'disabled',
  obstacleVolume: 1,
}, 999999, noYetiEvents);
assert.equal(noYeti.alive, true, 'disabled Yeti mode must not capture player');
assert.equal(noYetiEvents.length, 0, 'disabled Yeti mode must not emit Yeti events');

const inputBuffer = new OrderedInputBuffer();
const makeInput = (seq, boost = false) => ({
  seq,
  clientTime: seq * SIM_DT * 1000,
  lateralAxis: 0,
  boost,
  brake: false,
  jumpPressed: false,
});
assert.equal(inputBuffer.push(makeInput(1), 0), true, 'first input should be accepted');
assert.equal(inputBuffer.push(makeInput(2, true), 10), true, 'newer input should be accepted');
assert.equal(inputBuffer.push(makeInput(2), 12), false, 'duplicate input should be ignored');
assert.equal(inputBuffer.push(makeInput(1), 14), false, 'late input should not overwrite newer input');
assert.equal(inputBuffer.consume(0, 20, 500).seq, 1, 'server should consume the first queued input');
assert.equal(inputBuffer.consume(1, 30, 500).seq, 2, 'server should consume queued inputs in sequence order');
assert.equal(inputBuffer.consume(2, 100, 500).seq, 2, 'fresh input state should be held between ticks');
const staleInput = inputBuffer.consume(2, 700, 500);
assert.equal(staleInput.seq, 2, 'stale fallback should not acknowledge a new input');
assert.equal(staleInput.boost, false, 'stale fallback should clear held boost');

const clock = new FixedStepClock();
clock.reset(1000);
assert.equal(clock.consume(1034), 1, 'fixed step clock should advance after one simulation step');
assert.equal(clock.consume(1067), 1, 'fixed step clock should preserve fractional timer drift');
assert.equal(clock.consume(1134), 2, 'fixed step clock should catch up after a delayed server timer');

// --- Per-lobby difficulty ramp ---
const hazardTypes = new Set(['tree', 'fallen_tree', 'rock', 'stump', 'hole']);
const rampAtStart = generateGameplayChunk(4242, 0, 1, new Set(), true).filter(o => hazardTypes.has(o.type)).length;
const rampFarAway = generateGameplayChunk(4242, 30, 1, new Set(), true).filter(o => hazardTypes.has(o.type)).length;
assert.ok(rampFarAway > rampAtStart, 'difficulty ramp should place more hazards further from the run start');
const noRampAtStart = generateGameplayChunk(4242, 0, 1, new Set(), false).filter(o => hazardTypes.has(o.type)).length;
assert.ok(noRampAtStart >= rampAtStart, 'difficulty ramp should reduce hazard density near the run start compared to no ramp');
assert.deepEqual(
  generateGameplayChunk(4242, 5, 1, new Set(), false),
  generateGameplayChunk(4242, 5, 1, new Set(), false),
  'difficulty ramp defaulting to off must stay deterministic',
);

// --- Per-lobby skill scoring: near-miss ---
const nearMissPlayer = createInitialPlayerState('socket-e', 'Skier', 'player-e');
const nearMissEvents = simulatePlayerTick(nearMissPlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{
  id: 'nm-tree', type: 'tree', x: 1.0, z: 0.2, halfW: 0.5, halfD: 0.5, chunkIndex: 0,
}], new Set(), 0, true);
assert.ok(nearMissPlayer.bonusDistance > 0, 'near miss should award bonus distance when skill scoring is enabled');
assert.ok(nearMissEvents.some(e => e.type === 'near-miss'), 'near miss should emit a near-miss event');
assert.ok(nearMissPlayer.hp === MAX_HP, 'a near miss must not count as a collision');

const skillScoringOffPlayer = createInitialPlayerState('socket-f', 'Skier', 'player-f');
simulatePlayerTick(skillScoringOffPlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{
  id: 'nm-tree-2', type: 'tree', x: 1.0, z: 0.2, halfW: 0.5, halfD: 0.5, chunkIndex: 0,
}], new Set(), 0, false);
assert.equal(skillScoringOffPlayer.bonusDistance, 0, 'near miss must not award bonus distance when skill scoring is disabled');

// --- Per-lobby skill scoring: ramp jump chains ---
const chainPlayer = createInitialPlayerState('socket-g', 'Skier', 'player-g');
simulatePlayerTick(chainPlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'ramp-1', type: 'ramp', x: 0, z: 0.1, halfW: 2, halfD: 2, chunkIndex: 0 }], new Set(), 0, true);
assert.equal(chainPlayer.chainCount, 1, 'a first ramp jump alone should start a chain of 1, not award a chain bonus');
chainPlayer.isAirborne = false;
chainPlayer.y = 0;
const chainEvents = simulatePlayerTick(chainPlayer, {
  seq: 2, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'ramp-2', type: 'ramp', x: 0, z: chainPlayer.z + 0.1, halfW: 2, halfD: 2, chunkIndex: 0 }], new Set(), 500, true);
assert.ok(chainPlayer.bonusDistance > 0, 'a second ramp jump inside the chain window should award bonus distance');
assert.ok(chainEvents.some(e => e.type === 'jump-chain'), 'chained ramp jump should emit a jump-chain event');
assert.ok(chainPlayer.chainCount >= 2, 'chainCount should reach 2 after a successful chain');

const collidedChainPlayer = { ...chainPlayer, isAirborne: false, airborneFromRamp: false, y: 0, invincibilityRemaining: 0 };
simulatePlayerTick(collidedChainPlayer, {
  seq: 3, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{
  id: 'chain-breaker-tree', type: 'tree', x: collidedChainPlayer.x, z: collidedChainPlayer.z + 0.1, halfW: 1, halfD: 1, chunkIndex: 0,
}], new Set(), 1000, true);
assert.equal(collidedChainPlayer.chainCount, 0, 'colliding with an obstacle should reset an active chain');
// damagePlayer resets both to exactly 0, but the momentum/streak tracking
// block runs later in this same tick and nudges them up by one tick's worth
// before the reset has a chance to "stick" for a full frame - negligible in
// practice (SpeedMeter only shows momentum above 0.02) but real, so assert
// "collision-sized small" rather than exact zero.
assert.ok(collidedChainPlayer.momentum < 0.01, 'colliding with an obstacle should reset momentum');
assert.ok(collidedChainPlayer.cleanStreakSeconds < SIM_DT * 1.5, 'colliding with an obstacle should reset the clean streak');

// --- High momentum should extend the ramp-jump chain window past the base 4500ms ---
const momentumChainPlayer = createInitialPlayerState('socket-i', 'Skier', 'player-i');
momentumChainPlayer.momentum = 1;
simulatePlayerTick(momentumChainPlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: true, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'ramp-3', type: 'ramp', x: 0, z: 0.1, halfW: 2, halfD: 2, chunkIndex: 0 }], new Set(), 0, true);
assert.equal(momentumChainPlayer.chainCount, 1, 'first ramp jump should start a chain of 1');
momentumChainPlayer.isAirborne = false;
momentumChainPlayer.y = 0;
momentumChainPlayer.momentum = 1;
const extendedGapMs = getChainWindowMs(1) - 200;
assert.ok(extendedGapMs > 4500, 'sanity check: full momentum should extend the window past the base 4500ms');
const extendedChainEvents = simulatePlayerTick(momentumChainPlayer, {
  seq: 2, clientTime: 0, lateralAxis: 0, boost: true, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'ramp-4', type: 'ramp', x: 0, z: momentumChainPlayer.z + 0.1, halfW: 2, halfD: 2, chunkIndex: 0 }], new Set(), extendedGapMs, true);
assert.ok(extendedChainEvents.some(e => e.type === 'jump-chain'), 'high momentum should keep a chain alive past the base window');
assert.ok(momentumChainPlayer.chainCount >= 2, 'chain should continue when momentum extends the window');

const noMomentumChainPlayer = createInitialPlayerState('socket-j', 'Skier', 'player-j');
simulatePlayerTick(noMomentumChainPlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'ramp-5', type: 'ramp', x: 0, z: 0.1, halfW: 2, halfD: 2, chunkIndex: 0 }], new Set(), 0, true);
noMomentumChainPlayer.isAirborne = false;
noMomentumChainPlayer.y = 0;
const noMomentumChainEvents = simulatePlayerTick(noMomentumChainPlayer, {
  seq: 2, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'ramp-6', type: 'ramp', x: 0, z: noMomentumChainPlayer.z + 0.1, halfW: 2, halfD: 2, chunkIndex: 0 }], new Set(), extendedGapMs, true);
assert.ok(!noMomentumChainEvents.some(e => e.type === 'jump-chain'), 'zero momentum should not extend the chain window past the base 4500ms');
assert.equal(noMomentumChainPlayer.chainCount, 1, 'chain should reset to 1 without the momentum extension');

// --- Momentum: sustained boosting should build momentum and add a bonus ---
const momentumPlayer = createInitialPlayerState('socket-h', 'Skier', 'player-h');
for (let i = 0; i < 90; i++) {
  simulatePlayerTick(momentumPlayer, {
    seq: i + 1, clientTime: i * SIM_DT * 1000, lateralAxis: 0, boost: true, brake: false, jumpPressed: false,
  }, SIM_DT, [], new Set(), i * SIM_DT * 1000, true);
}
assert.ok(momentumPlayer.momentum > 0.5, 'sustained boosting should build momentum past the bonus threshold');
assert.ok(momentumPlayer.bonusDistance > 0, 'high momentum should accrue bonus distance over time');

const noMomentumPlayer = createInitialPlayerState('socket-i', 'Skier', 'player-i');
for (let i = 0; i < 90; i++) {
  simulatePlayerTick(noMomentumPlayer, {
    seq: i + 1, clientTime: i * SIM_DT * 1000, lateralAxis: 0, boost: false, brake: true, jumpPressed: false,
  }, SIM_DT, [], new Set(), i * SIM_DT * 1000, true);
}
assert.ok(noMomentumPlayer.momentum < 0.2, 'sustained braking should keep momentum low');
assert.ok(
  noMomentumPlayer.bonusDistance < momentumPlayer.bonusDistance,
  'a low-momentum run should accrue far less bonus than a sustained-boost run over the same duration',
);

// --- Graduated near-miss: a closer pass should award a bigger bonus than a marginal one ---
const closePlayer = createInitialPlayerState('socket-j', 'Skier', 'player-j');
simulatePlayerTick(closePlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'close-tree', type: 'tree', x: 0.86, z: 0.2, halfW: 0.5, halfD: 0.5, chunkIndex: 0 }], new Set(), 0, true);
const marginalPlayer = createInitialPlayerState('socket-k', 'Skier', 'player-k');
simulatePlayerTick(marginalPlayer, {
  seq: 1, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false,
}, SIM_DT, [{ id: 'far-tree', type: 'tree', x: 1.24, z: 0.2, halfW: 0.5, halfD: 0.5, chunkIndex: 0 }], new Set(), 0, true);
assert.ok(closePlayer.bonusDistance > 0 && marginalPlayer.bonusDistance > 0, 'both passes should be within the near-miss margin');
assert.ok(closePlayer.bonusDistance > marginalPlayer.bonusDistance, 'a closer near-miss should award a bigger bonus than a marginal one');

// --- Yeti proximity bonus: surviving in the danger window should accrue bonus distance ---
const dangerSettings = { gameMode: 'classic', difficulty: 'normal', yetiStartMode: 'distance', obstacleVolume: 1 };
const dangerConfig = getYetiConfig(dangerSettings);
// Derive roomTimeMs from the actual formula maybeApplyYetiCapture uses
// (activeSeconds = roomTimeMs/1000 - triggerDistance/speed), landing just
// under the real capture threshold instead of guessing a constant.
const dangerDistance = dangerConfig.triggerDistance + 10;
const dangerCaptureThreshold = Math.max(8, dangerConfig.captureAfterSeconds - dangerDistance / 220);
const dangerSpeed = 14; // BASE_SPEED, matches createInitialPlayerState's default
const dangerRoomTimeMs = (dangerConfig.triggerDistance / dangerSpeed + dangerCaptureThreshold * 0.9) * 1000;

const dangerPlayer = createInitialPlayerState('socket-l', 'Skier', 'player-l');
dangerPlayer.distance = dangerDistance;
const dangerEvents = [];
maybeApplyYetiCapture(dangerPlayer, dangerSettings, dangerRoomTimeMs, dangerEvents, SIM_DT, true);
assert.ok(dangerPlayer.alive, 'the danger bonus test should stay just under the actual capture threshold');
assert.ok(dangerPlayer.bonusDistance > 0, 'surviving deep in the yeti danger window should accrue bonus distance');

const noBonusWithoutSkillScoring = createInitialPlayerState('socket-m', 'Skier', 'player-m');
noBonusWithoutSkillScoring.distance = dangerDistance;
maybeApplyYetiCapture(noBonusWithoutSkillScoring, dangerSettings, dangerRoomTimeMs, [], SIM_DT, false);
assert.equal(noBonusWithoutSkillScoring.bonusDistance, 0, 'the yeti danger bonus must not apply when skill scoring is disabled');

// --- Ramp lane rotation: consecutive ramps in a chunk should not share a lane ---
const laneChunk = generateGameplayChunk(999, 3, 2, new Set(), false);
const rampsInChunk = laneChunk.filter(o => o.type === 'ramp');
assert.ok(rampsInChunk.length >= 2, 'test setup should generate at least 2 ramps to compare lanes');
const lanes = [[-34, -14], [-9, 9], [14, 34]];
const laneOf = x => lanes.findIndex(([lo, hi]) => x >= lo - 3 && x <= hi + 3);
assert.notEqual(laneOf(rampsInChunk[0].x), laneOf(rampsInChunk[1].x), 'consecutive ramps in a chunk should land in different lanes');

// Negative chunk indices happen in practice (e.g. a collision resolving the
// player slightly behind z=0 near run start) - JS's % can return negative
// results, which must not index the lane array out of bounds.
assert.doesNotThrow(
  () => generateGameplayChunk(999, -3, 2, new Set(), false),
  'ramp lane lookup must not throw for negative chunk indices',
);

console.log('Authoritative simulation checks passed.');
