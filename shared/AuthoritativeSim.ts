export const SIM_TICK_HZ = 30;
export const SNAPSHOT_HZ = 30;
export const SIM_DT = 1 / SIM_TICK_HZ;
export const CHUNK_SIZE = 80;
export const MAX_HP = 3;
export const BASE_SPEED = 14;
export const BOOST_SPEED = 28;
export const MIN_SPEED = BASE_SPEED * 0.22;
export const MANUAL_JUMP_VELOCITY = 7.2;
export const RAMP_JUMP_MIN_VELOCITY = 4.8;
export const RAMP_JUMP_MAX_VELOCITY = 9.6;
export const GRAVITY = 18;
export const PLAYER_TURN_RATE = 1.8;
export const PLAYER_MAX_TURN_ANGLE = Math.PI * 0.42;
export const INVINCIBILITY_TIME = 1.8;
export const MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS = 5;
// Anti-softlock: "stuck" means actual forward progress is far below what
// the player's own current speed/heading implies (i.e. something is
// physically blocking them - wedged against obstacles), not just moving
// slowly on purpose. A flat z-speed floor would misread deliberate slow
// play (full brake + a sharp turn legitimately converges to well under
// 1 unit/s) as stuck - see client Player.ts's matching solo logic, which
// this mirrors so both modes agree on what "stuck" means.
const STUCK_Z_RATIO_THRESHOLD = 0.35;
const STUCK_MIN_EXPECTED_SPEED = 0.5;
const STUCK_DETECT_TIME = 2.2;
const UNSTUCK_PUSH = 5.0;
export const PLAYER_COLOR_OPTIONS = [
  { value: '#2979ff', label: 'Blue' },
  { value: '#4caf50', label: 'Green' },
  { value: '#ff6b35', label: 'Orange' },
  { value: '#f9c74f', label: 'Yellow' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ef476f', label: 'Pink' },
  { value: '#06d6a0', label: 'Mint' },
  { value: '#ff9f1c', label: 'Amber' },
] as const;
export const DEFAULT_PLAYER_COLOR = PLAYER_COLOR_OPTIONS[0].value;

export class FixedStepClock {
  private accumulatorMs = 0;
  private lastAtMs = 0;

  constructor(
    private readonly stepMs = SIM_DT * 1000,
    private readonly maxSteps = 5,
  ) {}

  reset(nowMs: number) {
    this.accumulatorMs = 0;
    this.lastAtMs = nowMs;
  }

  consume(nowMs: number): number {
    if (!this.lastAtMs) this.reset(nowMs);
    const elapsedMs = clamp(nowMs - this.lastAtMs, 0, 250);
    this.lastAtMs = nowMs;
    this.accumulatorMs += elapsedMs;

    const steps = Math.min(this.maxSteps, Math.floor(this.accumulatorMs / this.stepMs));
    this.accumulatorMs -= steps * this.stepMs;
    if (steps === this.maxSteps && this.accumulatorMs >= this.stepMs) {
      this.accumulatorMs = 0;
    }
    return steps;
  }
}

const TRACK_LIMIT = 52;
// Ramps rotate through these lanes (by chunk + spawn index) instead of a
// pure uniform-random x, so consecutive ramps are never side-by-side and
// chaining requires actually crossing the track rather than holding a line.
const RAMP_LANES: [number, number][] = [[-34, -14], [-9, 9], [14, 34]];
const OBSTACLES_PER_CHUNK = 18;
const RAMPS_PER_CHUNK = 2;
const HOLES_PER_CHUNK = 2;
const HEARTS_PER_CHUNK = 1;
const HEART_MIN_DISTANCE = 70;
const PLAYER_HALF_W = 0.35;
const PLAYER_HALF_D = 0.55;
const MULTIPLAYER_SPAWN_SPACING = 8;
const MULTIPLAYER_SPAWN_JITTER = 1.15;
const NEAR_MISS_TYPES = new Set(['tree', 'rock', 'stump', 'fallen_tree', 'npc', 'dog', 'bear']);
const NEAR_MISS_MARGIN = 0.4;
const NEAR_MISS_MIN_BONUS = 0.5;
const NEAR_MISS_MAX_BONUS = 3;
const JUMP_CHAIN_WINDOW_MS = 4500;
const JUMP_CHAIN_BONUS_DISTANCE = 4;
// Momentum: builds while sustaining speed, decays (faster than it builds)
// when braking - a continuous "how committed are you right now" value, 0..1.
const MOMENTUM_BUILD_RATE = 0.6;
const MOMENTUM_DECAY_RATE = 1.4;
const MOMENTUM_BONUS_THRESHOLD = 0.5;
const MOMENTUM_MAX_BONUS_RATE = 0.3;
// Staying fast pays twice: momentum both boosts distance directly (above)
// and grants extra grace time to reach the next ramp before the chain
// resets, up to 60% longer at full momentum.
const JUMP_CHAIN_MOMENTUM_WINDOW_BONUS = 0.6;
// Clean streak: a slower-building, whole-run version of the same idea -
// ramps up over CLEAN_STREAK_MAX_SECONDS of no hits, resets hard on one.
const CLEAN_STREAK_MAX_SECONDS = 45;
const CLEAN_STREAK_MAX_BONUS_RATE = 0.4;
// Yeti proximity: rewards surviving deep in the danger window instead of
// only punishing capture - see maybeApplyYetiCapture, which already
// computes exactly how close a player is to being caught for the real
// capture decision, reused here as a continuous bonus signal.
const YETI_PROXIMITY_BONUS_RATE = 3;
const MULTIPLAYER_SPAWN_LIMIT = 34;

export type GameMode = 'classic' | 'sky_mario';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export type YetiStartMode = 'distance' | 'immediate' | 'disabled';

export interface RoomSettings {
  gameMode: GameMode;
  difficulty: Difficulty;
  yetiStartMode: YetiStartMode;
  obstacleVolume: number;
  difficultyRamp?: boolean;
  skillScoring?: boolean;
}

export interface ControlInput {
  seq: number;
  clientTime: number;
  lateralAxis: number;
  boost: boolean;
  brake: boolean;
  jumpPressed: boolean;
  firePressed?: boolean;
}

export const MAX_BUFFERED_INPUTS = 120;

export function createNeutralControlInput(seq = 0): ControlInput {
  return {
    seq,
    clientTime: 0,
    lateralAxis: 0,
    boost: false,
    brake: false,
    jumpPressed: false,
    firePressed: false,
  };
}

/**
 * Keeps received controls ordered so snapshots only acknowledge inputs that
 * were actually used by an authoritative simulation tick.
 */
export class OrderedInputBuffer {
  private queue: ControlInput[] = [];
  private lastReceivedSeq = 0;
  private lastReceivedAtMs = 0;
  private lastApplied = createNeutralControlInput();

  push(input: ControlInput, receivedAtMs: number): boolean {
    const clean = sanitizeControlInput(input);
    if (clean.seq <= this.lastReceivedSeq) return false;

    this.lastReceivedSeq = clean.seq;
    this.lastReceivedAtMs = receivedAtMs;
    this.queue.push(clean);
    if (this.queue.length > MAX_BUFFERED_INPUTS) this.queue.shift();
    return true;
  }

  consume(lastProcessedSeq: number, nowMs: number, staleAfterMs: number): ControlInput {
    while (this.queue.length && this.queue[0].seq <= lastProcessedSeq) {
      this.queue.shift();
    }

    const next = this.queue.shift();
    if (next) {
      this.lastApplied = next;
      return next;
    }

    if (!this.lastReceivedAtMs || nowMs - this.lastReceivedAtMs > staleAfterMs) {
      return createNeutralControlInput(lastProcessedSeq);
    }

    return this.lastApplied;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

export type ObstacleType = 'tree' | 'fallen_tree' | 'rock' | 'stump' | 'ramp' | 'hole' | 'heart';

export interface ObstacleRecord {
  id: string;
  type: ObstacleType;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  chunkIndex: number;
}

export interface PlayerSimState {
  id: string;
  playerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  startZ: number;
  angle: number;
  speed: number;
  hp: number;
  alive: boolean;
  finished: boolean;
  isAirborne: boolean;
  airborneFromRamp: boolean;
  jumpVelocityY: number;
  airVelocityX: number;
  airVelocityZ: number;
  airTime: number;
  jumpHeld: boolean;
  invincibilityRemaining: number;
  distance: number;
  bonusDistance: number;
  lastRampJumpAtMs: number;
  chainCount: number;
  momentum: number;
  cleanStreakSeconds: number;
  lastProcessedInputSeq: number;
  lastInputAtMs: number;
  yetiTriggerAtMs: number;
  stuckTimer: number;
  deathKind?: string;
}

export interface SimEvent {
  type: 'hit' | 'heal' | 'death' | 'jump' | 'landing' | 'yeti-warning' | 'yeti-capture' | 'near-miss' | 'jump-chain' | 'unstuck';
  playerId: string;
  socketId: string;
  obstacleId?: string;
  obstacleType?: string;
  hp?: number;
  distance?: number;
  kind?: string;
  chainCount?: number;
  bonus?: number;
}

export interface RoomSnapshotPlayer {
  id: string;
  playerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  speed: number;
  hp: number;
  alive: boolean;
  finished: boolean;
  distance: number;
  bonusDistance?: number;
  chainCount?: number;
  momentum?: number;
  cleanStreakSeconds?: number;
  isAirborne: boolean;
  airborneFromRamp?: boolean;
  jumpVelocityY?: number;
  airVelocityX?: number;
  airVelocityZ?: number;
  airTime?: number;
  invincibilityRemaining: number;
  lastProcessedInputSeq: number;
  deathKind?: string;
}

export interface RoomSnapshot {
  serverTick: number;
  roomTimeMs: number;
  seed: number;
  settings: RoomSettings;
  players: RoomSnapshotPlayer[];
  events: SimEvent[];
  consumedPickupIds: string[];
}

class SimRandom {
  seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    if (!this.seed) this.seed = 1;
  }

  next() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  range(min: number, max: number) {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number) {
    return Math.floor(this.range(min, max + 1));
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

export function sanitizePlayerColor(color: unknown) {
  const normalized = String(color || '').trim().toLowerCase();
  return PLAYER_COLOR_OPTIONS.some(option => option.value === normalized)
    ? normalized
    : DEFAULT_PLAYER_COLOR;
}

function scaledCount(base: number, volume: number, minWhenNonZero = 0) {
  if (volume <= 0) return 0;
  return Math.max(minWhenNonZero, Math.round(base * volume));
}

function collidesAABB(ax: number, az: number, ahw: number, ahd: number, b: ObstacleRecord, padding = 0) {
  return (
    Math.abs(ax - b.x) < ahw + b.halfW + padding &&
    Math.abs(az - b.z) < ahd + b.halfD + padding
  );
}

function overlapsExisting(x: number, z: number, halfW: number, halfD: number, existing: ObstacleRecord[], padding = 0.75) {
  return existing.some(obs => collidesAABB(x, z, halfW, halfD, obs, padding));
}

function tooCloseToHeart(x: number, z: number, existing: ObstacleRecord[], consumed: Set<string>) {
  const minSq = HEART_MIN_DISTANCE * HEART_MIN_DISTANCE;
  for (const obs of existing) {
    if (obs.type !== 'heart' || consumed.has(obs.id)) continue;
    const dx = x - obs.x;
    const dz = z - obs.z;
    if (dx * dx + dz * dz < minSq) return true;
  }
  return false;
}

function obstacleExtents(type: ObstacleType, rng: SimRandom) {
  if (type === 'tree') {
    const scale = rng.range(0.78, 1.45);
    return { halfW: scale * 0.72, halfD: scale * 0.72 };
  }
  if (type === 'fallen_tree') {
    const length = rng.range(2.2, 4.2);
    const radius = rng.range(0.16, 0.28);
    const angle = rng.range(0, Math.PI);
    const trunkHalf = length * 0.52;
    const thickHalf = Math.max(0.42, radius * 2.2);
    return {
      halfW: Math.abs(Math.cos(angle)) * trunkHalf + Math.abs(Math.sin(angle)) * thickHalf,
      halfD: Math.abs(Math.sin(angle)) * trunkHalf + Math.abs(Math.cos(angle)) * thickHalf,
    };
  }
  if (type === 'rock') {
    const radius = rng.range(0.34, 0.82);
    return { halfW: radius * 0.95, halfD: radius * 0.85 };
  }
  if (type === 'stump') return { halfW: 0.3, halfD: 0.3 };
  if (type === 'ramp') return { halfW: 1.85, halfD: 1.35 };
  if (type === 'heart') return { halfW: 0.34, halfD: 0.34 };

  const variant = rng.next();
  if (variant < 0.38) {
    return { halfW: rng.range(2.3, 3.35) * 0.62, halfD: rng.range(1.25, 2.05) * 0.62 };
  }
  if (variant < 0.76) {
    return { halfW: rng.range(2.5, 3.75) * 0.62, halfD: rng.range(1.45, 2.35) * 0.62 };
  }
  return { halfW: rng.range(1.45, 2.1) * 0.62, halfD: rng.range(2.8, 4.15) * 0.62 };
}

function createObstacle(id: string, type: ObstacleType, chunkIndex: number, zBase: number, rng: SimRandom, xRange: [number, number], zRange: [number, number]) {
  const extents = obstacleExtents(type, rng);
  return {
    id,
    type,
    x: rng.range(xRange[0], xRange[1]),
    z: zBase + rng.range(zRange[0], zRange[1]),
    halfW: extents.halfW,
    halfD: extents.halfD,
    chunkIndex,
  };
}

const DIFFICULTY_RAMP_DISTANCE = 1400;
const DIFFICULTY_RAMP_MIN = 0.6;
const DIFFICULTY_RAMP_MAX = 1.3;

export function getRampedHazardVolume(baseVolume: number, chunkIndex: number, difficultyRamp: boolean) {
  if (!difficultyRamp) return baseVolume;
  const distance = Math.max(0, chunkIndex) * CHUNK_SIZE;
  const rampT = clamp(distance / DIFFICULTY_RAMP_DISTANCE, 0, 1);
  const rampMultiplier = DIFFICULTY_RAMP_MIN + rampT * (DIFFICULTY_RAMP_MAX - DIFFICULTY_RAMP_MIN);
  return clamp(baseVolume * rampMultiplier, 0, 2);
}

// Deterministic, distance-only stand-in for "more ramps while chaining" in
// multiplayer: a live per-player signal can't safely drive this path (it's
// recomputed from scratch every tick and must stay identical between the
// server and every client - see the ramps loop below), so instead ramp
// availability itself grows with distance, same mechanism as the hazard
// ramp above but never below the base volume.
export function getRampedRampVolume(baseVolume: number, chunkIndex: number, difficultyRamp: boolean) {
  if (!difficultyRamp) return baseVolume;
  const distance = Math.max(0, chunkIndex) * CHUNK_SIZE;
  const rampT = clamp(distance / DIFFICULTY_RAMP_DISTANCE, 0, 1);
  return clamp(baseVolume * (1 + rampT * 0.6), 0, 2);
}

// Deterministic mid-run "course variety" - periodic weather zones along z,
// pure function of (seed, z) so server and every client's prediction land
// on bit-identical physics. grip < 1 is a real steering/speed penalty
// (see simulatePlayerTick); fogIntensity/snowIntensity are render-only.
// Exported (read-only, purely additive) so the client can compute the
// upcoming zone boundary for the storm-wall warning visual (Game.ts) -
// doesn't change any simulation behavior, just exposes the same period
// getWeatherAtZ already uses internally.
export const WEATHER_ZONE_LENGTH = 480;
const WEATHER_TRANSITION_LENGTH = 80;
const WEATHER_ICE_GRIP = 0.22;

export interface WeatherAtZ {
  grip: number;
  fogIntensity: number;
  snowIntensity: number;
}

const CLEAR_WEATHER: WeatherAtZ = { grip: 1, fogIntensity: 0, snowIntensity: 0 };

function weatherZoneDescriptor(seed: number, zoneIndex: number): WeatherAtZ {
  // Every run's first zone is always clear - otherwise ~45% of runs would
  // start mid-fade into blizzard/ice before the player has any warning.
  if (zoneIndex <= 0) return CLEAR_WEATHER;
  const roll = new SimRandom((seed + zoneIndex * 104729) >>> 0).next();
  if (roll < 0.55) return CLEAR_WEATHER;
  if (roll < 0.80) return { grip: 1, fogIntensity: 1, snowIntensity: 1 };
  return { grip: WEATHER_ICE_GRIP, fogIntensity: 0, snowIntensity: 0.15 };
}

export function getWeatherAtZ(seed: number, z: number): WeatherAtZ {
  const zoneIndex = Math.floor(z / WEATHER_ZONE_LENGTH);
  const localZ = z - zoneIndex * WEATHER_ZONE_LENGTH;
  const current = weatherZoneDescriptor(seed, zoneIndex);
  if (zoneIndex <= 0 || localZ >= WEATHER_TRANSITION_LENGTH) return current;
  const previous = weatherZoneDescriptor(seed, zoneIndex - 1);
  const t = smoothstep(localZ / WEATHER_TRANSITION_LENGTH);
  return {
    grip: lerp(previous.grip, current.grip, t),
    fogIntensity: lerp(previous.fogIntensity, current.fogIntensity, t),
    snowIntensity: lerp(previous.snowIntensity, current.snowIntensity, t),
  };
}

export function generateGameplayChunk(seed: number, chunkIndex: number, obstacleVolume = 1, consumedPickupIds: Set<string> = new Set(), difficultyRamp = false) {
  const rng = new SimRandom((seed + chunkIndex * 7919) >>> 0);
  const zBase = chunkIndex * CHUNK_SIZE;
  const records: ObstacleRecord[] = [];
  const volume = clamp(Number(obstacleVolume) || 0, 0, 2);
  if (volume <= 0) return records;
  // Only the hazard categories (static obstacles, holes) ramp with distance;
  // ramps and hearts stay on the base volume so the difficulty ramp doesn't
  // also strip away the tools that make the added hazards survivable.
  const hazardVolume = getRampedHazardVolume(volume, chunkIndex, difficultyRamp);
  const rampVolume = getRampedRampVolume(volume, chunkIndex, difficultyRamp);

  const trySpawn = (type: ObstacleType, xRange: [number, number], zRange: [number, number], options: { attempts?: number; padding?: number; heartSpacing?: boolean } = {}) => {
    const attempts = options.attempts ?? 12;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const obs = createObstacle(`${chunkIndex}:${type}:${records.length}:${attempt}`, type, chunkIndex, zBase, rng, xRange, zRange);
      if (overlapsExisting(obs.x, obs.z, obs.halfW, obs.halfD, records, options.padding ?? 0.75)) continue;
      if (options.heartSpacing && tooCloseToHeart(obs.x, obs.z, records, consumedPickupIds)) continue;
      records.push(obs);
      return true;
    }
    return false;
  };

  for (let i = 0; i < scaledCount(OBSTACLES_PER_CHUNK, hazardVolume); i++) {
    const r = rng.next();
    if (r < 0.44) trySpawn('tree', [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
    else if (r < 0.62) trySpawn('fallen_tree', [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
    else if (r < 0.8) trySpawn('rock', [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
    else trySpawn('stump', [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
  }

  for (let i = 0; i < scaledCount(RAMPS_PER_CHUNK, rampVolume, 1); i++) {
    const lane = RAMP_LANES[((chunkIndex + i) % RAMP_LANES.length + RAMP_LANES.length) % RAMP_LANES.length];
    trySpawn('ramp', lane, [12, CHUNK_SIZE - 12], { attempts: 18, padding: 1.1 });
  }

  for (let i = 0; i < scaledCount(HOLES_PER_CHUNK, hazardVolume); i++) {
    trySpawn('hole', [-42, 42], [14, CHUNK_SIZE - 10], { attempts: 14, padding: 0.9 });
  }

  for (let i = 0; i < scaledCount(HEARTS_PER_CHUNK, Math.max(volume, 0.5), 1); i++) {
    trySpawn('heart', [-34, 34], [18, CHUNK_SIZE - 12], { attempts: 24, padding: 0.35, heartSpacing: true });
  }

  return records;
}

export function getGameplayObstaclesNear(seed: number, z: number, radius: number, obstacleVolume: number, consumedPickupIds: Set<string>, difficultyRamp = false) {
  const currentChunk = Math.floor(z / CHUNK_SIZE);
  const result: ObstacleRecord[] = [];
  for (let chunk = currentChunk - 1; chunk <= currentChunk + 2; chunk++) {
    if (chunk < 0) continue;
    for (const obs of generateGameplayChunk(seed, chunk, obstacleVolume, consumedPickupIds, difficultyRamp)) {
      if (consumedPickupIds.has(obs.id)) continue;
      if (Math.abs(obs.z - z) <= radius) result.push(obs);
    }
  }
  return result;
}

export function createMultiplayerSpawnXs(seed: number, playerCount: number) {
  const count = clamp(Math.round(Number(playerCount) || 0), 0, 8);
  if (count <= 0) return [];

  const rng = new SimRandom((Number(seed) || 1) >>> 0);
  const start = -((count - 1) * MULTIPLAYER_SPAWN_SPACING) / 2;
  const lanes = Array.from({ length: count }, (_, index) => start + index * MULTIPLAYER_SPAWN_SPACING);

  for (let i = lanes.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const temp = lanes[i];
    lanes[i] = lanes[j];
    lanes[j] = temp;
  }

  return lanes.map(x => clamp(x + rng.range(-MULTIPLAYER_SPAWN_JITTER, MULTIPLAYER_SPAWN_JITTER), -MULTIPLAYER_SPAWN_LIMIT, MULTIPLAYER_SPAWN_LIMIT));
}

export function createInitialPlayerState(id: string, name: string, playerId = id, spawn: Partial<Pick<PlayerSimState, 'x' | 'y' | 'z' | 'startZ' | 'color'>> = {}): PlayerSimState {
  const z = Number(spawn.z ?? 0) || 0;
  return {
    id,
    playerId,
    name: String(name || 'Skier').slice(0, 16),
    color: sanitizePlayerColor(spawn.color),
    x: clamp(Number(spawn.x ?? 0) || 0, -55, 55),
    y: Math.max(0, Number(spawn.y ?? 0) || 0),
    z,
    startZ: Number(spawn.startZ ?? z) || 0,
    angle: 0,
    speed: BASE_SPEED,
    hp: MAX_HP,
    alive: true,
    finished: false,
    isAirborne: false,
    airborneFromRamp: false,
    jumpVelocityY: 0,
    airVelocityX: 0,
    airVelocityZ: 0,
    airTime: 0,
    jumpHeld: false,
    invincibilityRemaining: MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS,
    distance: 0,
    bonusDistance: 0,
    lastRampJumpAtMs: -Infinity,
    chainCount: 0,
    momentum: 0,
    cleanStreakSeconds: 0,
    lastProcessedInputSeq: 0,
    lastInputAtMs: 0,
    yetiTriggerAtMs: -1,
    stuckTimer: 0,
  };
}

export function sanitizeControlInput(input: Partial<ControlInput> = {}): ControlInput {
  return {
    seq: Math.max(0, Math.round(Number(input.seq) || 0)),
    clientTime: Math.max(0, Number(input.clientTime) || 0),
    lateralAxis: clamp(Number(input.lateralAxis) || 0, -1, 1),
    boost: !!input.boost,
    brake: !!input.brake,
    jumpPressed: !!input.jumpPressed,
    firePressed: !!input.firePressed,
  };
}

function triggerJump(state: PlayerSimState, force = MANUAL_JUMP_VELOCITY, source: 'manual' | 'ramp' = 'manual') {
  if (state.isAirborne) return false;
  state.isAirborne = true;
  state.airborneFromRamp = source === 'ramp';
  state.jumpVelocityY = force;
  state.airTime = 0;
  state.airVelocityX = Math.sin(state.angle) * state.speed;
  state.airVelocityZ = Math.cos(state.angle) * state.speed;
  return true;
}

function getRampJumpVelocity(speed: number) {
  const t = clamp((speed - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED), 0, 1);
  return lerp(RAMP_JUMP_MIN_VELOCITY, RAMP_JUMP_MAX_VELOCITY, smoothstep(t));
}

function damagePlayer(state: PlayerSimState, obstacle: ObstacleRecord, impactSpeed: number, events: SimEvent[]) {
  if (state.invincibilityRemaining > 0 || !state.alive) return;
  state.hp = Math.max(0, state.hp - 1);
  state.chainCount = 0;
  state.momentum = 0;
  state.cleanStreakSeconds = 0;
  const baseEvent = {
    playerId: state.playerId,
    socketId: state.id,
    obstacleId: obstacle.id,
    obstacleType: obstacle.type,
    hp: state.hp,
    distance: state.distance,
  };
  if (state.hp <= 0) {
    state.alive = false;
    state.finished = true;
    state.deathKind = obstacle.type === 'hole'
      ? 'hole'
      : obstacle.type === 'tree'
        ? 'tree'
        : 'tumble';
    events.push({ ...baseEvent, type: 'death', kind: state.deathKind });
  } else {
    state.invincibilityRemaining = INVINCIBILITY_TIME;
    events.push({ ...baseEvent, type: 'hit' });
  }
  state.speed *= obstacle.type === 'hole' ? 0.18 : Math.max(0.2, impactSpeed > BOOST_SPEED * 0.85 ? 0.24 : 0.35);
}

function resolveCollision(px: number, pz: number, obs: ObstacleRecord) {
  const overlapX = PLAYER_HALF_W + obs.halfW - Math.abs(px - obs.x);
  const overlapZ = PLAYER_HALF_D + obs.halfD - Math.abs(pz - obs.z);
  if (overlapX < overlapZ) {
    return { x: px + overlapX * (Math.sign(px - obs.x) || 1), z: pz };
  }
  return { x: px, z: pz + overlapZ * (Math.sign(pz - obs.z) || -1) };
}

export function getChainWindowMs(momentum: number): number {
  return JUMP_CHAIN_WINDOW_MS * (1 + clamp(momentum, 0, 1) * JUMP_CHAIN_MOMENTUM_WINDOW_BONUS);
}

export function simulatePlayerTick(
  state: PlayerSimState,
  input: ControlInput,
  dt: number,
  obstacles: ObstacleRecord[],
  consumedPickupIds: Set<string>,
  nowMs: number,
  skillScoring = false,
  weather: WeatherAtZ = CLEAR_WEATHER,
): SimEvent[] {
  const events: SimEvent[] = [];
  if (!state.alive) return events;

  const previousZ = state.z;
  const cleanInput = sanitizeControlInput(input);
  state.lastProcessedInputSeq = Math.max(state.lastProcessedInputSeq, cleanInput.seq);
  state.lastInputAtMs = nowMs;

  if (state.invincibilityRemaining > 0) {
    state.invincibilityRemaining = Math.max(0, state.invincibilityRemaining - dt);
  }

  if (skillScoring && state.chainCount > 0 && nowMs - state.lastRampJumpAtMs > getChainWindowMs(state.momentum)) {
    state.chainCount = 0;
  }

  const steer = state.isAirborne ? 0 : cleanInput.lateralAxis;
  if (!state.isAirborne) {
    state.angle = clamp(state.angle + steer * PLAYER_TURN_RATE * weather.grip * dt, -PLAYER_MAX_TURN_ANGLE, PLAYER_MAX_TURN_ANGLE);
    let targetSpeed = BASE_SPEED;
    if (cleanInput.boost) targetSpeed = BOOST_SPEED;
    if (cleanInput.brake) targetSpeed = MIN_SPEED;
    const penalisedTarget = targetSpeed * Math.max(Math.cos(state.angle), 0.28);
    state.speed = lerp(state.speed, penalisedTarget, Math.min(1, 10 * dt * weather.grip));
  }

  if (cleanInput.jumpPressed && !state.jumpHeld) {
    if (triggerJump(state, MANUAL_JUMP_VELOCITY, 'manual')) {
      events.push({ type: 'jump', playerId: state.playerId, socketId: state.id, distance: state.distance });
    }
  }
  state.jumpHeld = cleanInput.jumpPressed;

  const moveX = state.isAirborne ? state.airVelocityX : Math.sin(state.angle) * state.speed;
  const moveZ = state.isAirborne ? state.airVelocityZ : Math.cos(state.angle) * state.speed;

  let newX = clamp(state.x + moveX * dt, -55, 55);
  let newZ = state.z + moveZ * dt;
  const hitObstacleIds = new Set<string>();

  for (const obs of obstacles) {
    if (consumedPickupIds.has(obs.id)) continue;
    if (!collidesAABB(newX, newZ, PLAYER_HALF_W, PLAYER_HALF_D, obs)) continue;

    if (obs.type === 'heart') {
      consumedPickupIds.add(obs.id);
      if (state.hp < MAX_HP) {
        state.hp = Math.min(MAX_HP, state.hp + 1);
        events.push({ type: 'heal', playerId: state.playerId, socketId: state.id, obstacleId: obs.id, obstacleType: obs.type, hp: state.hp, distance: state.distance });
      }
      continue;
    }

    if (obs.type === 'ramp') {
      if (!state.isAirborne) {
        if (triggerJump(state, getRampJumpVelocity(state.speed), 'ramp')) {
          events.push({ type: 'jump', playerId: state.playerId, socketId: state.id, obstacleId: obs.id, obstacleType: obs.type, distance: state.distance });
          if (skillScoring) {
            const chained = nowMs - state.lastRampJumpAtMs <= getChainWindowMs(state.momentum);
            state.chainCount = chained ? state.chainCount + 1 : 1;
            if (chained) {
              state.bonusDistance += JUMP_CHAIN_BONUS_DISTANCE;
              events.push({ type: 'jump-chain', playerId: state.playerId, socketId: state.id, obstacleId: obs.id, obstacleType: obs.type, distance: state.distance, chainCount: state.chainCount });
            }
            state.lastRampJumpAtMs = nowMs;
          }
        }
      }
      continue;
    }

    if (state.isAirborne && obs.type === 'tree' && !state.airborneFromRamp) {
      const resolved = resolveCollision(newX, newZ, obs);
      newX = resolved.x;
      newZ = resolved.z;
      damagePlayer(state, obs, Math.hypot(state.airVelocityX, state.airVelocityZ), events);
      hitObstacleIds.add(obs.id);
      state.airVelocityX *= 0.18;
      state.airVelocityZ *= 0.18;
      state.jumpVelocityY = Math.min(state.jumpVelocityY, 0.5);
      continue;
    }

    if (state.isAirborne) continue;

    if (obs.type === 'hole') {
      consumedPickupIds.add(obs.id);
      damagePlayer(state, obs, state.speed, events);
      continue;
    }

    const resolved = resolveCollision(newX, newZ, obs);
    newX = resolved.x;
    newZ = resolved.z;
    damagePlayer(state, obs, state.speed, events);
    hitObstacleIds.add(obs.id);
  }

  // Anti-softlock (see STUCK_Z_RATIO_THRESHOLD's comment) - mirrors client
  // Player.ts's solo logic so a wedged multiplayer player gets the same
  // rescue solo already had, instead of being stuck with no recovery.
  const expectedZSpeed = Math.abs(Math.cos(state.angle) * state.speed);
  const actualZSpeed = Math.abs(newZ - previousZ) / Math.max(dt, 0.001);
  const isObstructed = !state.isAirborne
    && expectedZSpeed > STUCK_MIN_EXPECTED_SPEED
    && actualZSpeed / expectedZSpeed < STUCK_Z_RATIO_THRESHOLD;

  if (isObstructed) {
    state.stuckTimer += dt;
    if (state.stuckTimer >= STUCK_DETECT_TIME) {
      newZ += UNSTUCK_PUSH;
      state.angle = 0;
      state.speed = BASE_SPEED;
      state.isAirborne = false;
      state.airborneFromRamp = false;
      state.jumpVelocityY = 0;
      state.airVelocityX = 0;
      state.airVelocityZ = 0;
      state.airTime = 0;
      state.stuckTimer = 0;
      events.push({ type: 'unstuck', playerId: state.playerId, socketId: state.id, distance: state.distance });
    }
  } else {
    state.stuckTimer = 0;
  }

  state.x = newX;
  state.z = newZ;

  if (skillScoring && !state.isAirborne) {
    for (const obs of obstacles) {
      if (!NEAR_MISS_TYPES.has(obs.type)) continue;
      if (hitObstacleIds.has(obs.id) || consumedPickupIds.has(obs.id)) continue;
      // Fires once, exactly as the obstacle's z crosses from ahead to
      // behind the player this tick - the player only ever moves forward,
      // so a given obstacle can only cross once per run.
      if (!(obs.z >= previousZ && obs.z < state.z)) continue;
      const lateralGap = Math.abs(state.x - obs.x) - (PLAYER_HALF_W + obs.halfW);
      if (lateralGap < 0 || lateralGap > NEAR_MISS_MARGIN) continue;
      // 1 = grazed the edge of the obstacle, 0 = right at the edge of the
      // near-miss margin - the closer the cut, the bigger the reward.
      const closenessT = 1 - lateralGap / NEAR_MISS_MARGIN;
      const speed01 = clamp(state.speed / BOOST_SPEED, 0, 1);
      const bonus = NEAR_MISS_MIN_BONUS + closenessT * (NEAR_MISS_MAX_BONUS - NEAR_MISS_MIN_BONUS) * (0.6 + 0.4 * speed01);
      state.bonusDistance += bonus;
      events.push({ type: 'near-miss', playerId: state.playerId, socketId: state.id, obstacleId: obs.id, obstacleType: obs.type, distance: state.distance, bonus });
    }
  }

  if (skillScoring && state.alive) {
    const speed01 = clamp((state.speed - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED), 0, 1);
    const momentumTarget = state.isAirborne ? state.momentum : speed01;
    const momentumRate = momentumTarget > state.momentum ? MOMENTUM_BUILD_RATE : MOMENTUM_DECAY_RATE;
    state.momentum = clamp(state.momentum + (momentumTarget - state.momentum) * clamp(momentumRate * dt, 0, 1), 0, 1);

    state.cleanStreakSeconds += dt;

    const distanceThisTick = Math.max(0, state.z - previousZ);
    if (distanceThisTick > 0) {
      if (state.momentum > MOMENTUM_BONUS_THRESHOLD) {
        const momentumT = (state.momentum - MOMENTUM_BONUS_THRESHOLD) / (1 - MOMENTUM_BONUS_THRESHOLD);
        state.bonusDistance += distanceThisTick * momentumT * MOMENTUM_MAX_BONUS_RATE;
      }
      const streakT = clamp(state.cleanStreakSeconds / CLEAN_STREAK_MAX_SECONDS, 0, 1);
      if (streakT > 0) {
        state.bonusDistance += distanceThisTick * streakT * CLEAN_STREAK_MAX_BONUS_RATE;
      }
    }
  }

  if (state.isAirborne) {
    state.airTime += dt;
    state.y += state.jumpVelocityY * dt;
    state.jumpVelocityY -= GRAVITY * dt;
    if (state.y <= 0) {
      state.y = 0;
      state.isAirborne = false;
      state.airborneFromRamp = false;
      state.airVelocityX = 0;
      state.airVelocityZ = 0;
      state.jumpVelocityY = 0;
      state.airTime = 0;
      events.push({ type: 'landing', playerId: state.playerId, socketId: state.id, distance: state.distance });
    }
  }

  state.distance = Math.max(0, state.z - state.startZ) + state.bonusDistance;
  return events;
}

export function applyPlayerCollision(a: PlayerSimState, b: PlayerSimState): SimEvent[] {
  const events: SimEvent[] = [];
  if (!a.alive || !b.alive || a.isAirborne || b.isAirborne) return events;
  if (a.invincibilityRemaining > 0 && b.invincibilityRemaining > 0) return events;

  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  if (dx >= PLAYER_HALF_W * 2 + 0.38 || dz >= PLAYER_HALF_D * 2 + 0.58) return events;

  const side = Math.sign(a.x - b.x) || 1;
  a.x = clamp(a.x + side * 0.28, -55, 55);
  b.x = clamp(b.x - side * 0.28, -55, 55);
  a.speed *= 0.55;
  b.speed *= 0.55;

  for (const state of [a, b]) {
    if (state.invincibilityRemaining > 0) continue;
    state.hp = Math.max(0, state.hp - 1);
    state.chainCount = 0;
    state.momentum = 0;
    state.cleanStreakSeconds = 0;
    if (state.hp <= 0) {
      state.alive = false;
      state.finished = true;
      state.deathKind = 'skier';
      events.push({ type: 'death', playerId: state.playerId, socketId: state.id, kind: 'skier', hp: state.hp, distance: state.distance });
    } else {
      state.invincibilityRemaining = INVINCIBILITY_TIME;
      events.push({ type: 'hit', playerId: state.playerId, socketId: state.id, obstacleType: 'skier', hp: state.hp, distance: state.distance });
    }
  }

  return events;
}

// Chase speed the yeti implicitly closes distance at once triggered, in the
// same units as PlayerSimState.distance (world-Z units/second) - mirrors
// Yeti.ts's DIFFICULTY_PRESETS.baseSpeed (solo's real 3D chase speed) so
// both modes agree on how fast the yeti actually is, and each value stays
// below BOOST_SPEED (28) so a player sustaining near-max speed can always
// keep the gap growing. Previously multiplayer had no speed-based escape at
// all - just a hard elapsed-time countdown from the moment distance crossed
// triggerDistance that nothing the player did afterward could affect,
// making capture purely a matter of time regardless of skill.
const YETI_CHASE_SPEED: Record<Difficulty, number> = {
  easy: 19,
  normal: 22,
  hard: 24,
  extreme: 26,
};
// Gap (world-Z units) within which the danger meter/warning ramps up.
const YETI_DANGER_GAP_WINDOW = 100;

export function getYetiConfig(settings: RoomSettings) {
  const difficulty = settings.difficulty || 'normal';
  const configs = {
    easy: { triggerDistance: 2600 },
    normal: { triggerDistance: 2000 },
    hard: { triggerDistance: 1300 },
    extreme: { triggerDistance: 550 },
  } as Record<Difficulty, { triggerDistance: number }>;
  const config = configs[difficulty] || configs.normal;
  return {
    ...config,
    chaseSpeed: YETI_CHASE_SPEED[difficulty] || YETI_CHASE_SPEED.normal,
    triggerDistance: settings.yetiStartMode === 'immediate' ? 0 : config.triggerDistance,
  };
}

export function maybeApplyYetiCapture(state: PlayerSimState, settings: RoomSettings, roomTimeMs: number, events: SimEvent[], dt = 0, skillScoring = false) {
  if (!state.alive) return;
  if (settings.yetiStartMode === 'disabled') return;
  const config = getYetiConfig(settings);
  if (state.distance < config.triggerDistance) {
    state.yetiTriggerAtMs = -1;
    return;
  }
  if (state.yetiTriggerAtMs < 0) state.yetiTriggerAtMs = roomTimeMs;

  // The yeti's implicit chase position: it starts right at the trigger line
  // and advances at a fixed speed from the moment of trigger. The player is
  // only caught once their actual (real, obstacle-slowed) distance falls
  // behind that line - sustaining speed above chaseSpeed keeps the gap
  // growing forever, exactly like solo's real chase, rather than a fixed
  // timer nothing the player does can affect.
  const elapsedSinceTrigger = Math.max(0, (roomTimeMs - state.yetiTriggerAtMs) / 1000);
  const yetiDistance = config.triggerDistance + config.chaseSpeed * elapsedSinceTrigger;
  const gap = state.distance - yetiDistance;

  if (gap <= 0) {
    state.alive = false;
    state.finished = true;
    state.deathKind = 'yeti';
    events.push({ type: 'yeti-capture', playerId: state.playerId, socketId: state.id, kind: 'yeti', distance: state.distance });
    events.push({ type: 'death', playerId: state.playerId, socketId: state.id, kind: 'yeti', distance: state.distance, hp: state.hp });
    return;
  }

  const dangerT = clamp(1 - gap / YETI_DANGER_GAP_WINDOW, 0, 1);
  if (dangerT > 0.55) {
    events.push({ type: 'yeti-warning', playerId: state.playerId, socketId: state.id, distance: state.distance });
  }

  // Danger bonus: rewards surviving with a small gap instead of only
  // punishing capture. Reuses the exact same gap that decides real capture
  // above, so it's fully authoritative - never a separate/guessable signal.
  if (skillScoring && dt > 0) {
    if (dangerT > 0) {
      state.bonusDistance += dt * dangerT * YETI_PROXIMITY_BONUS_RATE;
    }
  }
}

export function toSnapshotPlayer(state: PlayerSimState): RoomSnapshotPlayer {
  return {
    id: state.id,
    playerId: state.playerId,
    name: state.name,
    color: sanitizePlayerColor(state.color),
    x: state.x,
    y: state.y,
    z: state.z,
    angle: state.angle,
    speed: state.speed,
    hp: state.hp,
    alive: state.alive,
    finished: state.finished,
    distance: state.distance,
    bonusDistance: state.bonusDistance,
    chainCount: state.chainCount,
    momentum: state.momentum,
    cleanStreakSeconds: state.cleanStreakSeconds,
    isAirborne: state.isAirborne,
    airborneFromRamp: state.airborneFromRamp,
    jumpVelocityY: state.jumpVelocityY,
    airVelocityX: state.airVelocityX,
    airVelocityZ: state.airVelocityZ,
    airTime: state.airTime,
    invincibilityRemaining: state.invincibilityRemaining,
    lastProcessedInputSeq: state.lastProcessedInputSeq,
    deathKind: state.deathKind,
  };
}
