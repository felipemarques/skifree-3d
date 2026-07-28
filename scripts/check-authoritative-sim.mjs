import assert from 'node:assert/strict';
import {
  MAX_HP,
  SIM_DT,
  FixedStepClock,
  OrderedInputBuffer,
  createInitialPlayerState,
  createMultiplayerSpawnXs,
  generateGameplayChunk,
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

console.log('Authoritative simulation checks passed.');
