export const SIM_TICK_HZ = 30;
export const SNAPSHOT_HZ = 30;
export const SIM_DT = 1 / SIM_TICK_HZ;
export const CHUNK_SIZE = 80;
export const MAX_HP = 3;
export const BASE_SPEED = 14;
export const BOOST_SPEED = 28;
export const MIN_SPEED = BASE_SPEED * 0.22;
// Manual jumps now scale mildly with approach speed too (same lerp/
// smoothstep shape ramps already used) - a smaller range than ramps since
// a manual jump should stay the "safe, predictable" option, but boosting
// into one should still visibly pay off rather than always launching
// identically regardless of speed.
export const MANUAL_JUMP_VELOCITY = 7.2;
export const MANUAL_JUMP_MIN_VELOCITY = 6.0;
export const MANUAL_JUMP_MAX_VELOCITY = 8.4;
export const RAMP_JUMP_MIN_VELOCITY = 4.8;
export const RAMP_JUMP_MAX_VELOCITY = 9.6;
export const GRAVITY = 18;
export const PLAYER_TURN_RATE = 1.8;
export const PLAYER_MAX_TURN_ANGLE = Math.PI * 0.42;
export const INVINCIBILITY_TIME = 1.8;
export const MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS = 5;
// Sky Mario combat - mirrors client/src/game/Game.ts's own projectile
// constants exactly (PROJECTILE_SPEED/PROJECTILE_LIFETIME/
// SKY_MARIO_THROW_COOLDOWN, and the gravity/bounce/hitbox numbers inside
// _updateProjectiles) so the server's authoritative hit detection lands on
// the same trajectory the client is already rendering, not a diverging one.
export const SKY_MARIO_THROW_COOLDOWN = 0.75;
export const PROJECTILE_SPEED = 34;
export const PROJECTILE_LIFETIME = 2.4;
const PROJECTILE_GRAVITY = 7.5;
const PROJECTILE_GROUND_CLEARANCE = 0.18;
const PROJECTILE_BOUNCE_MULT = 0.28;
const PROJECTILE_HIT_HALF_X = 0.65;
const PROJECTILE_HIT_HALF_Z = 0.9;
const PROJECTILE_HIT_HALF_Y = 1.0;
const PROJECTILE_TARGET_Y_OFFSET = 0.65;
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
// Mid-air tricks: lateralAxis is otherwise discarded while airborne (see
// simulatePlayerTick's steer branch), repurposed here to spin the skier.
// TRICK_SPIN_RATE/TRICK_LANDING_TOLERANCE_DEG are tuned so the single most
// natural input - just hold a direction for the whole jump - lands clean on
// an ordinary manual jump (~0.8s airtime: 4.4 * 0.8 ~= 202 deg, well inside
// the +-45 tolerance around 180). An earlier tuning (5.5 rad/s, +-25 deg)
// made that same natural full-hold input overshoot to ~252 deg and fail
// every time, which read as "tricks don't work" even though the scoring
// logic itself was correct. Landing within TRICK_LANDING_TOLERANCE_DEG of a
// clean multiple of 180 pays a bonus; landing further off than that (but
// past the attempt deadzone, so a stray touch of the stick doesn't count as
// a failed trick) stumbles.
const TRICK_SPIN_RATE = 4.4;
const TRICK_ATTEMPT_DEADZONE_DEG = 30;
const TRICK_LANDING_TOLERANCE_DEG = 45;
const TRICK_BONUS_PER_HALF_SPIN = 2;
const TRICK_MAX_HALF_SPINS = 4;
const TRICK_BAD_LANDING_SPEED_MULT = 0.6;
// Avalanche: same below-BOOST_SPEED "sustain speed to escape" guarantee as
// the yeti (see YETI_CHASE_SPEED), tuned closer to BOOST_SPEED since the
// threat is time-boxed to one zone rather than the whole rest of the run.
const AVALANCHE_CHASE_SPEED: Record<Difficulty, number> = {
  easy: 22,
  normal: 24,
  hard: 26,
  extreme: 27,
};
const AVALANCHE_DANGER_GAP_WINDOW = 80;
const AVALANCHE_PROXIMITY_BONUS_RATE = 3;
const AVALANCHE_OUTRUN_BONUS = 6;
const AVALANCHE_GRACE_DISTANCE = 20;

export function getAvalancheChaseSpeed(difficulty: Difficulty): number {
  return AVALANCHE_CHASE_SPEED[difficulty] || AVALANCHE_CHASE_SPEED.normal;
}

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
  // Sky Mario combat - absolute world-space throw angle (same sin/cos
  // convention as state.angle: x = sin, z = cos), computed client-side by
  // raycasting the mouse cursor onto the ground and pointing from the
  // player toward that point - entirely independent of state.angle/
  // lateralAxis/steering (see Game.ts's _computeSkyMarioAimAngle). null
  // means no aim override is available this tick (e.g. the raycast missed
  // the ground plane); the throw then falls back to state.angle.
  aimAngle?: number | null;
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
  /**
   * Raw parameters the client needs to build a visual that matches this
   * hitbox bit-for-bit. Only present for types whose extents can't be
   * derived from halfW/halfD alone — fallen trees rotate the trunk, so the
   * AABB is an angle-dependent mix of length and thickness. Other types
   * (tree scale, rock radius, hole box) recover cleanly from halfW/halfD.
   */
  visual?: { length: number; radius: number; angle: number };
  /**
   * Purely cosmetic tag some obstacles carry alongside `type` - doesn't
   * affect collision/near-miss logic (those only ever check `type`). Used
   * by the cliffs "rockfall" set-piece so the client can play a shadow/drop
   * telegraph on these specific rocks while collision stays identical to an
   * ordinary rock from the moment it's generated.
   */
  subtype?: string;
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
  /**
   * Per-player steering rate (rad/s), sent at join from the player's
   * keyTurnSpeed setting so multiplayer steers like their solo runs
   * (M4). Defaults to PLAYER_TURN_RATE.
   */
  turnRate: number;
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
  // Sky Mario combat - see SKY_MARIO_THROW_COOLDOWN's comment.
  fireHeld: boolean;
  throwCooldownRemaining: number;
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
  avalancheTriggerAtMs: number;
  avalancheTriggerDistance: number;
  // Dwell tracking for the fork "Bold Line" bonus - see maybeApplyForkBonus.
  forkZoneRiskyTicks: number;
  forkZoneTotalTicks: number;
  // Accumulated mid-air spin (radians, signed) while airborne - see
  // simulatePlayerTick's steer branch and landing block. Reset on every
  // triggerJump and again on landing.
  trickSpinRad: number;
  stuckTimer: number;
  deathKind?: string;
  // Obstacles this player has actually collided with, for the lifetime of
  // this run - a collision pushes the player back out to just past the
  // obstacle's edge (see resolveCollision), which on a later tick can land
  // squarely inside NEAR_MISS_MARGIN once the z-crossing finally resolves.
  // The near-miss loop's own per-tick hitObstacleIds only excludes the
  // exact tick of the hit, so without this an obstacle you just crashed
  // into can still pay out a "near miss" once you clear it.
  hitObstacleHistory: Set<string>;
  // Same lifetime-of-run dedupe as hitObstacleHistory above, but for the
  // air-clear bonus (see AIR_CLEAR_TYPES) - an obstacle already rewarded
  // for a direct mid-air overflight shouldn't pay out again if its z keeps
  // re-qualifying across ticks near the crossing boundary.
  airClearHistory: Set<string>;
  // One-shot mid-air resource, refreshed every triggerJump - see
  // AIR_BOOST_VELOCITY_Y's comment.
  airBoostAvailable: boolean;
}

export interface SimEvent {
  type: 'hit' | 'heal' | 'death' | 'jump' | 'landing' | 'yeti-warning' | 'yeti-capture' | 'near-miss' | 'jump-chain' | 'unstuck'
    | 'avalanche-warning' | 'avalanche-capture' | 'avalanche-outrun' | 'trick' | 'trick-fail' | 'fork-bold-line'
    | 'landing-precision' | 'air-clear' | 'air-boost' | 'combat-throw';
  playerId: string;
  socketId: string;
  obstacleId?: string;
  obstacleType?: string;
  hp?: number;
  distance?: number;
  kind?: string;
  chainCount?: number;
  bonus?: number;
  spinDeg?: number;
  // combat-throw only - spawn parameters for the client's own cosmetic
  // projectile physics/rendering (see PostFX-adjacent client code in
  // Game.ts's _spawnProjectile). Hit detection itself is authoritative
  // (see simulateProjectilesTick) and reports back as ordinary 'hit'/
  // 'death' events, so this is purely visual spawn data.
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
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
  turnRate?: number;
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
  // Only present right after a client (re)joins - the full cumulative
  // history of consumed pickup ids. Every other tick omits this and sends
  // consumedPickupIdsDelta instead (see AuthoritativeRoomRuntime.emitSnapshot).
  consumedPickupIdsFull?: string[];
  consumedPickupIdsDelta: string[];
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
      visual: { length, radius, angle },
    };
  }
  if (type === 'rock') {
    const radius = rng.range(0.34, 0.82);
    return { halfW: radius * 0.95, halfD: radius * 0.85 };
  }
  if (type === 'stump') return { halfW: 0.3, halfD: 0.3 };
  if (type === 'ramp') return { halfW: 1.85, halfD: 1.35 };
  // 0.46 matches the client's heart pickup visual (Obstacles.ts) so touching
  // the rendered heart always collects it — was 0.34, which left a ring of
  // "visually touching, not collecting" around every pickup in multiplayer.
  // No rng draw is involved, so chunk layouts are bit-identical to before.
  if (type === 'heart') return { halfW: 0.46, halfD: 0.46 };

  const variant = rng.next();
  if (variant < 0.38) {
    return { halfW: rng.range(2.3, 3.35) * 0.62, halfD: rng.range(1.25, 2.05) * 0.62 };
  }
  if (variant < 0.76) {
    return { halfW: rng.range(2.5, 3.75) * 0.62, halfD: rng.range(1.45, 2.35) * 0.62 };
  }
  return { halfW: rng.range(1.45, 2.1) * 0.62, halfD: rng.range(2.8, 4.15) * 0.62 };
}

function createObstacle(id: string, type: ObstacleType, chunkIndex: number, zBase: number, rng: SimRandom, xRange: [number, number], zRange: [number, number], subtype?: string) {
  const extents = obstacleExtents(type, rng);
  return {
    id,
    type,
    x: rng.range(xRange[0], xRange[1]),
    z: zBase + rng.range(zRange[0], zRange[1]),
    chunkIndex,
    ...extents,
    ...(subtype ? { subtype } : {}),
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

// Exported so the client can find the nearest ice zone at/ahead of the
// player for a ground-tint "visible from afar" warning (SnowTerrain.ts,
// Game.ts), mirroring why WEATHER_ZONE_LENGTH above is exported for the
// storm-wall blizzard warning. Samples each candidate zone's midpoint
// (clear of the 80m transition blend) rather than duplicating the seeded
// roll logic in weatherZoneDescriptor, which stays private - grip < 0.5 is
// unambiguous since only ice reduces it (WEATHER_ICE_GRIP = 0.22; clear and
// blizzard are both grip: 1). i = 0 covers the player's current zone too,
// so the tint stays visible while standing on the ice, not just approaching it.
export function getIceZoneAhead(seed: number, z: number, maxZonesAhead = 2): { start: number; end: number } | null {
  const currentZoneIndex = Math.floor(z / WEATHER_ZONE_LENGTH);
  for (let i = 0; i <= maxZonesAhead; i++) {
    const zoneIndex = currentZoneIndex + i;
    if (zoneIndex <= 0) continue;
    const sampleZ = zoneIndex * WEATHER_ZONE_LENGTH + WEATHER_ZONE_LENGTH * 0.5;
    if (getWeatherAtZ(seed, sampleZ).grip < 0.5) {
      return { start: zoneIndex * WEATHER_ZONE_LENGTH, end: (zoneIndex + 1) * WEATHER_ZONE_LENGTH };
    }
  }
  return null;
}

// A second, independent periodic zone system (own length/roll multiplier,
// deliberately not derived from WEATHER_ZONE_LENGTH) so avalanche zones can
// fall anywhere relative to weather/ice, rather than being coupled to it -
// see maybeApplyAvalancheCapture for the actual chase/capture decision,
// which re-derives zone containment from state.z directly rather than
// calling this lookahead version.
export const AVALANCHE_ZONE_LENGTH = 640;
const AVALANCHE_ZONE_ROLL_CHANCE = 0.35;

function avalancheZoneDescriptor(seed: number, zoneIndex: number): boolean {
  // Mirrors weatherZoneDescriptor's "zone 0 is always safe" rule - the very
  // start of a run shouldn't already be an avalanche chase.
  if (zoneIndex <= 0) return false;
  const roll = new SimRandom((seed + zoneIndex * 950213) >>> 0).next();
  return roll < AVALANCHE_ZONE_ROLL_CHANCE;
}

// Exported for an advance "avalanche ahead" client cue, mirroring
// getIceZoneAhead's shape - optional/cosmetic, not required for the capture
// logic itself to be correct.
export function getAvalancheZoneAhead(seed: number, z: number, maxZonesAhead = 2): { start: number; end: number } | null {
  const currentZoneIndex = Math.floor(z / AVALANCHE_ZONE_LENGTH);
  for (let i = 0; i <= maxZonesAhead; i++) {
    const zoneIndex = currentZoneIndex + i;
    if (avalancheZoneDescriptor(seed, zoneIndex)) {
      return { start: zoneIndex * AVALANCHE_ZONE_LENGTH, end: (zoneIndex + 1) * AVALANCHE_ZONE_LENGTH };
    }
  }
  return null;
}

// A fourth independent periodic zone (own length/roll multiplier again) -
// branching trail forks. Tuned as an occasional set-piece rather than a
// constant lane split: a per-zone roll plus a cooldown that forbids two
// fork zones back to back, so a run gets a handful of deliberate choices
// rather than feeling like every other zone is a fork. FORK_LANE_GAP is the
// half-width of the obstacle-free centerline strip separating the two
// lanes - narrower than either lane itself, so straddling it is a
// deliberate, narrow option rather than a free third path.
export const FORK_ZONE_LENGTH = 240;
const FORK_ZONE_ROLL_CHANCE = 0.26;
export const FORK_LANE_GAP = 6;
const FORK_BOLD_LINE_RATIO = 0.65;
const FORK_BOLD_LINE_BONUS = 5;
// The safe lane trades hazard density for raw pace rather than being a
// strictly-better option - a real risk/reward tradeoff against the risky
// lane's higher hazard density and Bold Line bonus. Tuned well below the
// cos(angle) speed variation normal steering already causes, so the
// tradeoff reads as a deliberate slowdown rather than getting lost in
// ordinary turning noise.
export const FORK_SAFE_LANE_SPEED_MULT = 0.68;

function forkZoneDescriptor(seed: number, zoneIndex: number): boolean {
  if (zoneIndex <= 0) return false;
  const roll = new SimRandom((seed + zoneIndex * 275604) >>> 0).next();
  if (roll >= FORK_ZONE_ROLL_CHANCE) return false;
  // Never two fork zones back to back.
  if (forkZoneDescriptor(seed, zoneIndex - 1)) return false;
  return true;
}

// Exported so the client can find the fork zone bounds for the divider
// shader visual (SnowTerrain.ts) - mirrors getIceZoneAhead/getAvalancheZoneAhead.
export function getForkZoneAhead(seed: number, z: number, maxZonesAhead = 2): { start: number; end: number } | null {
  const currentZoneIndex = Math.floor(z / FORK_ZONE_LENGTH);
  for (let i = 0; i <= maxZonesAhead; i++) {
    const zoneIndex = currentZoneIndex + i;
    if (forkZoneDescriptor(seed, zoneIndex)) {
      return { start: zoneIndex * FORK_ZONE_LENGTH, end: (zoneIndex + 1) * FORK_ZONE_LENGTH };
    }
  }
  return null;
}

/**
 * "Bold Line" bonus: a one-shot reward if the player spent most of a fork
 * zone in the risky (x > FORK_LANE_GAP) lane, mirroring
 * maybeApplyAvalancheCapture's "track state while in the zone, pay out once
 * on exit" shape. Tracks a running risky-tick ratio rather than sampling
 * once, so briefly ducking into the safe lane doesn't flip the result.
 */
export function maybeApplyForkBonus(state: PlayerSimState, seed: number, events: SimEvent[], skillScoring = false) {
  if (!skillScoring || !state.alive) return;
  const zoneIndex = Math.floor(state.z / FORK_ZONE_LENGTH);
  const inZone = forkZoneDescriptor(seed, zoneIndex);

  if (!inZone) {
    if (state.forkZoneTotalTicks > 0) {
      const riskyRatio = state.forkZoneRiskyTicks / state.forkZoneTotalTicks;
      if (riskyRatio >= FORK_BOLD_LINE_RATIO) {
        state.bonusDistance += FORK_BOLD_LINE_BONUS;
        events.push({ type: 'fork-bold-line', playerId: state.playerId, socketId: state.id, distance: state.distance, bonus: FORK_BOLD_LINE_BONUS });
      }
    }
    state.forkZoneRiskyTicks = 0;
    state.forkZoneTotalTicks = 0;
    return;
  }

  state.forkZoneTotalTicks += 1;
  if (state.x > FORK_LANE_GAP) state.forkZoneRiskyTicks += 1;
}

// Biome progression: forest is always the starting/tutorial zone (zone 0);
// the remaining three biomes are then visited in a seed-shuffled order,
// reshuffled every full cycle (one pass through BIOME_CYCLE_POOL), instead
// of the old fixed
// forest -> alpine -> cliffs -> glacier sequence. That fixed order let
// players (and enemies of "fun") memorize exactly when the next set-piece/
// hazard-mix was coming; shuffling per seed (and per cycle, for runs long
// enough to loop back around) keeps it unpredictable while staying fully
// deterministic - same seed always produces the same order, which the
// authoritative multiplayer sim and every client need.
// Defined here as the single source of truth since obstacle generation
// below needs it too and must stay deterministic/shared. client/src/game/
// Biome.ts's palette blend reuses getBiomeZoneBlend below instead of
// duplicating this zoning.
export type BiomeKind = 'forest' | 'alpine' | 'cliffs' | 'glacier' | 'windswept' | 'deadwood';
const BIOME_ZONE_CORE_LENGTH = 1500;
const BIOME_ZONE_TRANSITION_LENGTH = 300;
const BIOME_ZONE_PERIOD = BIOME_ZONE_CORE_LENGTH + BIOME_ZONE_TRANSITION_LENGTH;
const BIOME_CYCLE_POOL: BiomeKind[] = ['alpine', 'cliffs', 'glacier', 'windswept', 'deadwood'];

function shuffledBiomeCycle(seed: number, cycleIndex: number): BiomeKind[] {
  const pool = [...BIOME_CYCLE_POOL];
  const rng = new SimRandom((seed + cycleIndex * 104729 + 17) >>> 0);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function biomeAtZoneIndex(seed: number, zoneIndex: number): BiomeKind {
  if (zoneIndex <= 0) return 'forest';
  const idx = zoneIndex - 1;
  const cycleIndex = Math.floor(idx / BIOME_CYCLE_POOL.length);
  const posInCycle = idx % BIOME_CYCLE_POOL.length;
  return shuffledBiomeCycle(seed, cycleIndex)[posInCycle];
}

export function getBiomeKindAtZ(seed: number, z: number): BiomeKind {
  const zoneIndex = Math.floor(Math.max(0, z) / BIOME_ZONE_PERIOD);
  const zoneStart = zoneIndex * BIOME_ZONE_PERIOD;
  // Switches at the transition band's midpoint, matching the "dominant"
  // read of the old fixed-threshold table (which switched partway through
  // the old STOPS blend band rather than at either endpoint).
  const dominantSwitch = zoneStart + BIOME_ZONE_CORE_LENGTH + BIOME_ZONE_TRANSITION_LENGTH / 2;
  return z < dominantSwitch ? biomeAtZoneIndex(seed, zoneIndex) : biomeAtZoneIndex(seed, zoneIndex + 1);
}

// Exposed for Biome.ts's cosmetic palette blend, which needs the same
// zoning/order plus the transition progress `t` and both endpoint biomes to
// interpolate palettes across - kept here so the two never drift apart.
export function getBiomeZoneBlend(seed: number, z: number): { a: BiomeKind; b: BiomeKind; t: number } {
  const zoneIndex = Math.floor(Math.max(0, z) / BIOME_ZONE_PERIOD);
  const zoneStart = zoneIndex * BIOME_ZONE_PERIOD;
  const coreEnd = zoneStart + BIOME_ZONE_CORE_LENGTH;
  const a = biomeAtZoneIndex(seed, zoneIndex);
  const b = biomeAtZoneIndex(seed, zoneIndex + 1);
  const t = z <= coreEnd ? 0 : clamp((z - coreEnd) / BIOME_ZONE_TRANSITION_LENGTH, 0, 1);
  return { a, b, t };
}

// Windswept ridge's signature danger: a real lateral force (not just a
// speed/steering multiplier like weather's grip) that pushes the grounded
// player sideways, deterministically as a function of z alone (never wall
// clock time, so it stays bit-identical for client prediction/replay and
// the authoritative server). Strength fades in/out across the biome's own
// transition band via getBiomeZoneBlend, and each zone gets its own seeded
// gust direction so it's not just "wind always blows right" - the whole
// point is punishing complacent steering with something other players
// can't out-jump or dodge, the way every other biome's danger works today.
const WIND_PUSH_STRENGTH = 5.5;
const WIND_GUST_WAVELENGTH = 55;

export function getWindPushAtZ(seed: number, z: number): number {
  const { a, b, t } = getBiomeZoneBlend(seed, z);
  const strengthA = a === 'windswept' ? 1 : 0;
  const strengthB = b === 'windswept' ? 1 : 0;
  const strength = lerp(strengthA, strengthB, t) * WIND_PUSH_STRENGTH;
  if (strength <= 0) return 0;
  const zoneIndex = Math.floor(Math.max(0, z) / BIOME_ZONE_PERIOD);
  const dir = new SimRandom((seed + zoneIndex * 55411 + 3) >>> 0).next() < 0.5 ? -1 : 1;
  return dir * strength * Math.sin(z / WIND_GUST_WAVELENGTH);
}

// Per-biome static-hazard type mix (tree/fallen_tree/rock/stump weights,
// must sum to 1) - forest keeps the original default split; alpine goes
// rock/stump-heavy and tree-light (matches the above-treeline palette
// Biome.ts already uses); cliffs stays close to alpine's mix since the
// biome's real distinguishing feature is its set-piece (see below), not
// its baseline mix. Glacier is almost bare rock/ice (barely any trees at
// all) - its own distinguishing feature is the crevasse-field set-piece.
// Windswept is a bare, above-treeline ridge (even sparser trees than
// alpine, mostly rock/stump) - its distinguishing feature is the crosswind
// (see getWindPushAtZ) rather than its density. Deadwood is a burnt/dead
// forest - tree-dense like forest but weighted hard toward fallen_tree,
// reading as dense clutter rather than a healthy treeline.
const BIOME_OBSTACLE_MIX: Record<BiomeKind, { tree: number; fallen_tree: number; rock: number; stump: number }> = {
  forest: { tree: 0.44, fallen_tree: 0.18, rock: 0.18, stump: 0.20 },
  alpine: { tree: 0.12, fallen_tree: 0.10, rock: 0.50, stump: 0.28 },
  cliffs: { tree: 0.18, fallen_tree: 0.12, rock: 0.45, stump: 0.25 },
  glacier: { tree: 0.03, fallen_tree: 0.05, rock: 0.58, stump: 0.34 },
  windswept: { tree: 0.08, fallen_tree: 0.12, rock: 0.46, stump: 0.34 },
  deadwood: { tree: 0.28, fallen_tree: 0.44, rock: 0.10, stump: 0.18 },
};

function pickBiomeObstacleType(mix: { tree: number; fallen_tree: number; rock: number; stump: number }, roll: number): ObstacleType {
  let acc = mix.tree;
  if (roll < acc) return 'tree';
  acc += mix.fallen_tree;
  if (roll < acc) return 'fallen_tree';
  acc += mix.rock;
  if (roll < acc) return 'rock';
  return 'stump';
}

// A third independent periodic zone (own length/roll multiplier again),
// deciding which chunks fall inside a biome set-piece band - a short run of
// chunks with a distinctly different layout from that biome's normal
// baseline, so each biome reads as somewhere different to actually ski
// through, not just a different color grade. Flavor is picked from
// whichever biome the zone's z falls into, so no separate per-biome zone
// system is needed.
const BIOME_SETPIECE_ZONE_LENGTH = 240;
const BIOME_SETPIECE_ROLL_CHANCE = 0.3;
// How far in from each edge the set-piece's obstacle bands sit (forest
// tunnel / alpine squeeze), leaving a clear-ish lane of
// 2*(TRACK_LIMIT-BIOME_SETPIECE_EDGE_BAND) down the middle.
const BIOME_SETPIECE_EDGE_BAND = 22;

function isBiomeSetPieceZone(seed: number, chunkIndex: number): boolean {
  const zoneIndex = Math.floor((chunkIndex * CHUNK_SIZE) / BIOME_SETPIECE_ZONE_LENGTH);
  if (zoneIndex <= 0) return false;
  const roll = new SimRandom((seed + zoneIndex * 621547) >>> 0).next();
  return roll < BIOME_SETPIECE_ROLL_CHANCE;
}

// Glacier's own extra, independent (per-chunk, not per-set-piece-zone) low
// chance of a rockfall cluster - distinct seed multiplier so it doesn't
// correlate with isBiomeSetPieceZone's own roll, and low enough that it
// reads as an occasional extra danger layered on an already rock-dense
// biome, not a rework of its crevasse-field identity.
const GLACIER_ROCKFALL_ROLL_CHANCE = 0.15;

function isGlacierRockfallChunk(seed: number, chunkIndex: number): boolean {
  const roll = new SimRandom((seed + chunkIndex * 88651) >>> 0).next();
  return roll < GLACIER_ROCKFALL_ROLL_CHANCE;
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

  const biome = getBiomeKindAtZ(seed, zBase);
  const obstacleMix = BIOME_OBSTACLE_MIX[biome];
  const setPiece = isBiomeSetPieceZone(seed, chunkIndex);
  // Cliffs' set-piece is a "frozen lake crossing" - sparse, high-speed,
  // scenic - so it reduces density instead of the edge-band squeeze forest/
  // alpine use. Glacier's "crevasse field" (below) adds its danger entirely
  // through extra holes/ramps rather than static obstacles, so its own
  // baseline density is toned down to match, not stacked on top.
  const isCrevasseField = setPiece && biome === 'glacier';
  // Cliffs' and alpine's own set-piece flavor: a couple of tight rock
  // clusters (tagged `subtype: 'rockfall'` purely for the client's
  // shadow/drop telegraph) instead of the frozen-lake sparse breather /
  // edge-squeeze stacking with anything else - reads as "danger from above"
  // rather than raising ambient density. Glacier also gets an independent,
  // rarer rockfall roll below (isGlacierRockfallChunk) so it can layer on
  // top of its own crevasse-field set-piece without double-booking a zone.
  const isRockfallField = setPiece && (biome === 'cliffs' || biome === 'alpine');
  const isGlacierRockfall = !isCrevasseField && biome === 'glacier' && isGlacierRockfallChunk(seed, chunkIndex);
  // Forest's (and any other non-rockfall/non-glacier) set-piece flavor: on
  // top of the existing edge-band scatter below, a physical chokepoint gate
  // - fence-post/rock walls funneling from both edges down to one narrow
  // gap partway through the zone. Every other set-piece danger here is
  // purely reactive (dodge what's in front of you); this is the one hazard
  // that punishes *commitment* - the gap is narrow enough that a player has
  // to line up on it well before arriving, so taking the approach at full
  // speed leaves no room left to correct a bad line.
  const isChokepoint = setPiece && !isRockfallField && biome !== 'glacier';
  const setPieceHazardVolume = setPiece
    ? (isRockfallField ? hazardVolume * 0.25 : biome === 'glacier' ? hazardVolume * 0.7 : hazardVolume * 1.6)
    : hazardVolume;
  // Fork zones take precedence over the biome set-piece edge-banding when
  // both happen to land on the same chunk - the lane split is the more
  // player-facing mechanic of the two.
  const isFork = forkZoneDescriptor(seed, Math.floor(zBase / FORK_ZONE_LENGTH));

  const trySpawn = (type: ObstacleType, xRange: [number, number], zRange: [number, number], options: { attempts?: number; padding?: number; heartSpacing?: boolean; subtype?: string } = {}) => {
    const attempts = options.attempts ?? 12;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const obs = createObstacle(`${chunkIndex}:${type}:${records.length}:${attempt}`, type, chunkIndex, zBase, rng, xRange, zRange, options.subtype);
      if (overlapsExisting(obs.x, obs.z, obs.halfW, obs.halfD, records, options.padding ?? 0.75)) continue;
      if (options.heartSpacing && tooCloseToHeart(obs.x, obs.z, records, consumedPickupIds)) continue;
      records.push(obs);
      return true;
    }
    return false;
  };

  if (isFork) {
    // Safe lane: reduced density, a guaranteed heart. Risky lane: increased
    // density and more ramps (feeding the jump-chain/trick systems). Two
    // separate loops rather than one shared loop with biased xRange
    // selection, so the density difference is real, not just which lane
    // happens to get more of the same total count.
    const safeLane: [number, number] = [-TRACK_LIMIT, -FORK_LANE_GAP];
    const riskyLane: [number, number] = [FORK_LANE_GAP, TRACK_LIMIT];
    for (let i = 0; i < scaledCount(OBSTACLES_PER_CHUNK, hazardVolume * 0.4); i++) {
      trySpawn(pickBiomeObstacleType(obstacleMix, rng.next()), safeLane, [8, CHUNK_SIZE - 8]);
    }
    for (let i = 0; i < scaledCount(OBSTACLES_PER_CHUNK, hazardVolume * 1.5); i++) {
      trySpawn(pickBiomeObstacleType(obstacleMix, rng.next()), riskyLane, [8, CHUNK_SIZE - 8]);
    }
    for (let i = 0; i < scaledCount(RAMPS_PER_CHUNK, rampVolume * 1.6, 1); i++) {
      trySpawn('ramp', [riskyLane[0] + 4, riskyLane[1] - 2], [12, CHUNK_SIZE - 12], { attempts: 18, padding: 1.1 });
    }
    // Holes are a hazard, not a safety feature - they belong in the risky
    // lane's extra density, not guaranteed into the "safe" one (that was
    // inverted: the safe lane was both slower and still guaranteed a hole).
    for (let i = 0; i < scaledCount(HOLES_PER_CHUNK, hazardVolume); i++) {
      trySpawn('hole', [FORK_LANE_GAP, 42], [14, CHUNK_SIZE - 10], { attempts: 14, padding: 0.9 });
    }
    const heartCount = Math.max(1, scaledCount(HEARTS_PER_CHUNK, Math.max(volume, 0.5), 1));
    for (let i = 0; i < heartCount; i++) {
      trySpawn('heart', safeLane, [18, CHUNK_SIZE - 12], { attempts: 24, padding: 0.35, heartSpacing: true });
    }
  } else {
    for (let i = 0; i < scaledCount(OBSTACLES_PER_CHUNK, setPieceHazardVolume); i++) {
      const type = pickBiomeObstacleType(obstacleMix, rng.next());
      // Forest tunnel / alpine canyon squeeze: obstacles concentrated toward
      // both edges instead of spread across the full width, leaving a
      // clear-ish lane down the middle - reads as a squeeze without touching
      // TRACK_LIMIT or the player's own position clamp (the physical width
      // stays constant everywhere on purpose - see the biome plan's explicit
      // scope note on why).
      const xRange: [number, number] = isChokepoint
        ? (i % 2 === 0 ? [-TRACK_LIMIT, -BIOME_SETPIECE_EDGE_BAND] : [BIOME_SETPIECE_EDGE_BAND, TRACK_LIMIT])
        : [-TRACK_LIMIT, TRACK_LIMIT];
      trySpawn(type, xRange, [8, CHUNK_SIZE - 8]);
    }

    for (let i = 0; i < scaledCount(RAMPS_PER_CHUNK, rampVolume, 1); i++) {
      const lane = RAMP_LANES[((chunkIndex + i) % RAMP_LANES.length + RAMP_LANES.length) % RAMP_LANES.length];
      trySpawn('ramp', lane, [12, CHUNK_SIZE - 12], { attempts: 18, padding: 1.1 });
    }
    // Glacier's "crevasse field" set-piece: a burst of extra holes plus
    // extra ramps, rewarding a chain of jumps across the gaps instead of
    // the edge-squeeze forest/alpine use or the sparse breather cliffs
    // uses - the danger is "jump or fall in", not "dodge the clutter".
    if (isCrevasseField) {
      for (let i = 0; i < scaledCount(HOLES_PER_CHUNK, hazardVolume * 1.8, 1); i++) {
        trySpawn('hole', [-42, 42], [14, CHUNK_SIZE - 10], { attempts: 14, padding: 0.9 });
      }
      for (let i = 0; i < scaledCount(RAMPS_PER_CHUNK, rampVolume * 1.5, 1); i++) {
        const lane = RAMP_LANES[((chunkIndex + i + 1) % RAMP_LANES.length + RAMP_LANES.length) % RAMP_LANES.length];
        trySpawn('ramp', lane, [12, CHUNK_SIZE - 12], { attempts: 18, padding: 1.1 });
      }
    }
    // Cliffs'/alpine's "rockfall" set-piece (plus glacier's independent
    // extra roll): 2-3 tight clusters of extra rocks (1-2 each) instead of
    // scattering them evenly across the chunk, so they read as falling from
    // a specific overhang rather than generic clutter.
    if (isRockfallField || isGlacierRockfall) {
      const clusterCount = 2 + (rng.next() < 0.5 ? 1 : 0);
      for (let c = 0; c < clusterCount; c++) {
        const clusterX = rng.range(-TRACK_LIMIT + 6, TRACK_LIMIT - 6);
        const clusterZ = rng.range(16, CHUNK_SIZE - 16);
        const rocksInCluster = rng.next() < 0.5 ? 1 : 2;
        for (let r = 0; r < rocksInCluster; r++) {
          trySpawn(
            'rock',
            [clusterX - 3, clusterX + 3],
            [clusterZ - 3, clusterZ + 3],
            { attempts: 10, padding: 0.6, subtype: 'rockfall' },
          );
        }
      }
    }

    // Chokepoint gate: two gap-marker rocks plus a short run of funnel posts
    // per side, stepping the safe x-band in from near TRACK_LIMIT down to
    // the gap at gateZ. Tight xRange/zRange windows (matching the rockfall
    // cluster's own `[x-3, x+3]` technique above) place each post close to
    // its intended spot rather than scattering it across the chunk.
    if (isChokepoint) {
      const gateZ = rng.range(CHUNK_SIZE * 0.45, CHUNK_SIZE * 0.62);
      const gapHalf = 8;
      const funnelPosts = 3;
      for (const side of [-1, 1] as const) {
        trySpawn('rock', [side * gapHalf - 1, side * gapHalf + 1], [gateZ - 1, gateZ + 1], { attempts: 14, padding: 0.5, subtype: 'chokepoint' });
        for (let p = 1; p <= funnelPosts; p++) {
          const t = p / (funnelPosts + 1);
          const fx = side * (TRACK_LIMIT - 6 - t * (TRACK_LIMIT - 6 - gapHalf));
          const fz = gateZ - 5 - p * 5;
          if (fz < 6) continue;
          trySpawn('stump', [fx - 1.2, fx + 1.2], [fz - 1.2, fz + 1.2], { attempts: 10, padding: 0.5, subtype: 'chokepoint' });
        }
      }
    }

    for (let i = 0; i < scaledCount(HOLES_PER_CHUNK, hazardVolume); i++) {
      trySpawn('hole', [-42, 42], [14, CHUNK_SIZE - 10], { attempts: 14, padding: 0.9 });
    }

    for (let i = 0; i < scaledCount(HEARTS_PER_CHUNK, Math.max(volume, 0.5), 1); i++) {
      trySpawn('heart', [-34, 34], [18, CHUNK_SIZE - 12], { attempts: 24, padding: 0.35, heartSpacing: true });
    }
  }

  return records;
}

// Optional `chunkCache` lets repeat callers (the server's per-tick, per-
// player hot path in AuthoritativeRoomRuntime.ts, called dozens of times a
// second per player) skip re-running generateGameplayChunk's RNG-driven
// spawn loops for a chunk it already generated - chunk contents are fully
// determined by (seed, chunkIndex, obstacleVolume, difficultyRamp), which
// stay constant for a room's whole run, so this is safe to memoize forever.
export function getGameplayObstaclesNear(
  seed: number,
  z: number,
  radius: number,
  obstacleVolume: number,
  consumedPickupIds: Set<string>,
  difficultyRamp = false,
  chunkCache: Map<number, ObstacleRecord[]> | null = null,
) {
  const currentChunk = Math.floor(z / CHUNK_SIZE);
  const result: ObstacleRecord[] = [];
  for (let chunk = currentChunk - 1; chunk <= currentChunk + 2; chunk++) {
    if (chunk < 0) continue;
    let chunkRecords = chunkCache?.get(chunk);
    if (!chunkRecords) {
      chunkRecords = generateGameplayChunk(seed, chunk, obstacleVolume, consumedPickupIds, difficultyRamp);
      chunkCache?.set(chunk, chunkRecords);
    }
    for (const obs of chunkRecords) {
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

export function createInitialPlayerState(id: string, name: string, playerId = id, spawn: Partial<Pick<PlayerSimState, 'x' | 'y' | 'z' | 'startZ' | 'color' | 'turnRate'>> = {}): PlayerSimState {
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
    turnRate: clamp(Number(spawn.turnRate) || PLAYER_TURN_RATE, 0.5, 4),
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
    fireHeld: false,
    throwCooldownRemaining: 0,
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
    avalancheTriggerAtMs: -1,
    avalancheTriggerDistance: 0,
    forkZoneRiskyTicks: 0,
    forkZoneTotalTicks: 0,
    trickSpinRad: 0,
    stuckTimer: 0,
    hitObstacleHistory: new Set(),
    airClearHistory: new Set(),
    airBoostAvailable: false,
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
    aimAngle: Number.isFinite(input.aimAngle) ? Number(input.aimAngle) : null,
  };
}

function triggerJump(state: PlayerSimState, force = MANUAL_JUMP_VELOCITY, source: 'manual' | 'ramp' = 'manual') {
  if (state.isAirborne) return false;
  state.isAirborne = true;
  state.airborneFromRamp = source === 'ramp';
  state.jumpVelocityY = force;
  state.airTime = 0;
  state.trickSpinRad = 0;
  state.airVelocityX = Math.sin(state.angle) * state.speed;
  state.airVelocityZ = Math.cos(state.angle) * state.speed;
  // Every jump - manual or ramp - refreshes the one-shot air-boost charge
  // (see AIR_BOOST_VELOCITY_Y). It's per-jump, not a regenerating resource:
  // spend it mid-air for a second-wind height kick, or lose it on landing.
  state.airBoostAvailable = true;
  return true;
}

function getManualJumpVelocity(speed: number) {
  const t = clamp((speed - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED), 0, 1);
  return lerp(MANUAL_JUMP_MIN_VELOCITY, MANUAL_JUMP_MAX_VELOCITY, smoothstep(t));
}

function getRampJumpVelocity(speed: number) {
  const t = clamp((speed - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED), 0, 1);
  return lerp(RAMP_JUMP_MIN_VELOCITY, RAMP_JUMP_MAX_VELOCITY, smoothstep(t));
}

// Double-jump-style resource: while airborne, a second jumpPressed edge
// spends the current jump's one-shot airBoostAvailable charge for a
// second-wind upward kick (smaller than any real jump launch) instead of
// doing nothing the way holding/mashing jump mid-air always has. Gives
// players a limited, deliberate way to extend/save a jump instead of it
// being purely a function of takeoff speed.
const AIR_BOOST_VELOCITY_Y = 4.5;

// Airborne obstacle interaction: obstacles that are otherwise entirely
// ignored while airborne (see the isAirborne-continue branch further down)
// now pay a bonus for a direct mid-air overflight - literally jumping the
// gap over/between hazards rather than just avoiding them, distinct from
// the ground-level near-miss's "close graze" reward.
const AIR_CLEAR_TYPES = new Set<ObstacleType>(['tree', 'rock', 'stump', 'fallen_tree']);
const AIR_CLEAR_MIN_BONUS = 0.8;
const AIR_CLEAR_MAX_BONUS = 2.6;
const AIR_CLEAR_HEIGHT_FOR_MAX = 1.6;

// Landing precision: a bonus on top of a trick attempt for keeping the
// steering angle tight (small state.angle) while spinning, rather than a
// standalone reward. state.angle is frozen for the whole flight (it's only
// updated while grounded - see the steer branch above), so it's really the
// *takeoff* angle, not something that changes mid-air; scoring it on its
// own would just reward jumping while going perfectly straight, which is
// the default idle state, not a skill. Gating on the same trick-attempt
// deadzone as trick scoring means this only ever pays out alongside an
// actual deliberate spin attempt (successful or not).
const LANDING_PRECISION_MAX_ANGLE_DEG = 26;
const LANDING_PRECISION_MIN_AIRTIME = 0.18;
const LANDING_PRECISION_MAX_BONUS = 2.2;
const LANDING_PRECISION_AIRTIME_FOR_MAX = 0.9;

function damagePlayer(state: PlayerSimState, obstacle: { id: string; type: string }, impactSpeed: number, events: SimEvent[]) {
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
        : obstacle.type === 'sky_mario_projectile'
          ? 'skier'
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

export interface ProjectileSimState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  hit: boolean;
}

export function createProjectile(id: string, ownerId: string, spawn: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): ProjectileSimState {
  return { id, ownerId, x: spawn.x, y: spawn.y, z: spawn.z, vx: spawn.vx, vy: spawn.vy, vz: spawn.vz, life: PROJECTILE_LIFETIME, hit: false };
}

// Authoritative Sky Mario combat hit detection - advances every live
// projectile one tick (same gravity/bounce as the client's own cosmetic
// physics in Game.ts's _updateProjectiles, kept in sync so trajectories
// look the same) and damages the first non-owner living player it overlaps.
// Ground is always y=0 in this sim (see PlayerSimState.y's comment on jump
// physics not modeling terrain height), so no groundYAt lookup is needed
// here, unlike the client's cosmetic copy which samples visual terrain
// height for its bounce.
export function simulateProjectilesTick(projectiles: ProjectileSimState[], playerStates: Iterable<PlayerSimState>, dt: number, events: SimEvent[]): void {
  for (const p of projectiles) {
    if (p.hit) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.hit = true;
      continue;
    }
    p.vy -= PROJECTILE_GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.y < PROJECTILE_GROUND_CLEARANCE) {
      p.y = PROJECTILE_GROUND_CLEARANCE;
      p.vy = Math.abs(p.vy) * PROJECTILE_BOUNCE_MULT;
    }
    for (const state of playerStates) {
      if (state.id === p.ownerId || !state.alive) continue;
      const dx = Math.abs(state.x - p.x);
      const dz = Math.abs(state.z - p.z);
      const dy = Math.abs((state.y + PROJECTILE_TARGET_Y_OFFSET) - p.y);
      if (dx < PROJECTILE_HIT_HALF_X && dz < PROJECTILE_HIT_HALF_Z && dy < PROJECTILE_HIT_HALF_Y) {
        p.hit = true;
        damagePlayer(state, { id: p.id, type: 'sky_mario_projectile' }, PROJECTILE_SPEED, events);
        break;
      }
    }
  }
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
  forkSafeLaneSlow = false,
  seed = 0,
  gameMode: GameMode = 'classic',
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
    state.angle = clamp(state.angle + steer * (state.turnRate ?? PLAYER_TURN_RATE) * weather.grip * dt, -PLAYER_MAX_TURN_ANGLE, PLAYER_MAX_TURN_ANGLE);
    let targetSpeed = BASE_SPEED;
    if (cleanInput.boost) targetSpeed = BOOST_SPEED;
    if (cleanInput.brake) targetSpeed = MIN_SPEED;
    if (forkSafeLaneSlow) targetSpeed *= FORK_SAFE_LANE_SPEED_MULT;
    const penalisedTarget = targetSpeed * Math.max(Math.cos(state.angle), 0.28);
    state.speed = lerp(state.speed, penalisedTarget, Math.min(1, 10 * dt * weather.grip));
  } else if (skillScoring) {
    // Mid-air trick input - see TRICK_SPIN_RATE's comment. Scored on landing.
    state.trickSpinRad += cleanInput.lateralAxis * TRICK_SPIN_RATE * dt;
  }

  if (cleanInput.jumpPressed && !state.jumpHeld) {
    if (triggerJump(state, getManualJumpVelocity(state.speed), 'manual')) {
      events.push({ type: 'jump', playerId: state.playerId, socketId: state.id, distance: state.distance });
    } else if (state.isAirborne && state.airBoostAvailable) {
      state.airBoostAvailable = false;
      state.jumpVelocityY = Math.max(state.jumpVelocityY, 0) + AIR_BOOST_VELOCITY_Y;
      events.push({ type: 'air-boost', playerId: state.playerId, socketId: state.id, distance: state.distance });
    }
  }
  state.jumpHeld = cleanInput.jumpPressed;

  // Sky Mario combat - throw is a fire-and-forget spawn event (position/
  // velocity only); the actual hit detection happens once per tick across
  // all live projectiles in simulateProjectilesTick, run by the caller
  // after every player has taken their movement tick, not here (a thrown
  // projectile can hit a player other than the one who just processed input
  // this iteration, so it can't be resolved inline per-player).
  if (gameMode === 'sky_mario') {
    state.throwCooldownRemaining = Math.max(0, state.throwCooldownRemaining - dt);
    if (cleanInput.firePressed && !state.fireHeld && state.throwCooldownRemaining <= 0) {
      state.throwCooldownRemaining = SKY_MARIO_THROW_COOLDOWN;
      const aimAngle = cleanInput.aimAngle !== null && cleanInput.aimAngle !== undefined ? cleanInput.aimAngle : state.angle;
      const launchSpeed = PROJECTILE_SPEED + state.speed * 0.22;
      const vx = Math.sin(aimAngle) * launchSpeed;
      const vz = Math.cos(aimAngle) * launchSpeed;
      events.push({
        type: 'combat-throw',
        playerId: state.playerId,
        socketId: state.id,
        distance: state.distance,
        x: state.x + Math.sin(aimAngle) * 0.65,
        y: state.y + 0.82,
        z: state.z + Math.cos(aimAngle) * 1.0,
        vx,
        vy: 1.2,
        vz,
      });
    }
    state.fireHeld = cleanInput.firePressed;
  }

  const moveX = state.isAirborne ? state.airVelocityX : Math.sin(state.angle) * state.speed + getWindPushAtZ(seed, state.z);
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
      state.hitObstacleHistory.add(obs.id);
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
    state.hitObstacleHistory.add(obs.id);
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
      if (hitObstacleIds.has(obs.id) || consumedPickupIds.has(obs.id) || state.hitObstacleHistory.has(obs.id)) continue;
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

  // Airborne obstacle interaction - see AIR_CLEAR_TYPES's comment. Mirrors
  // the near-miss loop's z-crossing detection, but rewards a direct
  // overflight (lateral overlap) instead of a close-but-clear graze.
  if (skillScoring && state.isAirborne) {
    for (const obs of obstacles) {
      if (!AIR_CLEAR_TYPES.has(obs.type)) continue;
      if (hitObstacleIds.has(obs.id) || consumedPickupIds.has(obs.id) || state.hitObstacleHistory.has(obs.id) || state.airClearHistory.has(obs.id)) continue;
      if (!(obs.z >= previousZ && obs.z < state.z)) continue;
      const lateralOverlap = (PLAYER_HALF_W + obs.halfW) - Math.abs(state.x - obs.x);
      if (lateralOverlap <= 0) continue;
      state.airClearHistory.add(obs.id);
      const centerT = clamp(lateralOverlap / (PLAYER_HALF_W + obs.halfW), 0, 1);
      const heightT = clamp(state.y / AIR_CLEAR_HEIGHT_FOR_MAX, 0, 1);
      const bonus = AIR_CLEAR_MIN_BONUS + (centerT * 0.5 + heightT * 0.5) * (AIR_CLEAR_MAX_BONUS - AIR_CLEAR_MIN_BONUS);
      state.bonusDistance += bonus;
      events.push({ type: 'air-clear', playerId: state.playerId, socketId: state.id, obstacleId: obs.id, obstacleType: obs.type, distance: state.distance, bonus });
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
      const airTimeAtLanding = state.airTime;
      state.y = 0;
      state.isAirborne = false;
      state.airborneFromRamp = false;
      state.airVelocityX = 0;
      state.airVelocityZ = 0;
      state.jumpVelocityY = 0;
      state.airTime = 0;
      events.push({ type: 'landing', playerId: state.playerId, socketId: state.id, distance: state.distance });

      // Mid-air trick scoring - see TRICK_SPIN_RATE's comment. Entirely
      // skillScoring-gated, same as jump-chain/near-miss, so a player who
      // never enabled skill scoring never sees a surprise stumble either.
      if (skillScoring) {
        const spinDeg = Math.abs(state.trickSpinRad) * (180 / Math.PI);
        const attemptedTrick = spinDeg > TRICK_ATTEMPT_DEADZONE_DEG;

        // Landing precision - see LANDING_PRECISION_MAX_ANGLE_DEG's comment
        // on why this is gated on attemptedTrick rather than scored on its
        // own.
        if (attemptedTrick && airTimeAtLanding >= LANDING_PRECISION_MIN_AIRTIME) {
          const angleDeg = Math.abs(state.angle) * (180 / Math.PI);
          if (angleDeg <= LANDING_PRECISION_MAX_ANGLE_DEG) {
            const precisionT = 1 - angleDeg / LANDING_PRECISION_MAX_ANGLE_DEG;
            const airTimeT = clamp(airTimeAtLanding / LANDING_PRECISION_AIRTIME_FOR_MAX, 0, 1);
            const bonus = LANDING_PRECISION_MAX_BONUS * precisionT * (0.5 + 0.5 * airTimeT);
            state.bonusDistance += bonus;
            events.push({ type: 'landing-precision', playerId: state.playerId, socketId: state.id, distance: state.distance, bonus });
          }
        }

        if (attemptedTrick) {
          const halfSpins = Math.min(Math.round(spinDeg / 180), TRICK_MAX_HALF_SPINS);
          const offFromClean = Math.abs(spinDeg - halfSpins * 180);
          if (halfSpins > 0 && offFromClean <= TRICK_LANDING_TOLERANCE_DEG) {
            const bonus = halfSpins * TRICK_BONUS_PER_HALF_SPIN;
            state.bonusDistance += bonus;
            events.push({ type: 'trick', playerId: state.playerId, socketId: state.id, distance: state.distance, spinDeg: halfSpins * 180, bonus });
          } else {
            state.speed *= TRICK_BAD_LANDING_SPEED_MULT;
            events.push({ type: 'trick-fail', playerId: state.playerId, socketId: state.id, distance: state.distance, spinDeg });
          }
        }
      }
      state.trickSpinRad = 0;
    }
  }

  state.distance = Math.max(0, state.z - state.startZ) + state.bonusDistance;
  return events;
}

/**
 * Pulls a shoved player out of any solid obstacle they now overlap, with no
 * extra damage. The shove knockback is applied blindly along X, which can
 * slam a player into a tree/hole they had no chance to avoid — the shove
 * already cost HP, so stacking a second, unpreventable obstacle hit on top
 * was the reported bug (minor list: shove re-resolution). aObstacles /
 * bObstacles are each player's nearby gameplay obstacles at their own z,
 * computed by the caller (the runtime tick) — pure and deterministic, so
 * server-side state stays reproducible.
 */
function pullShoveVictimOutOfHazards(state: PlayerSimState, obstacles: ObstacleRecord[]) {
  if (!state.alive) return;
  for (const obs of obstacles) {
    if (obs.type === 'heart' || obs.type === 'ramp') continue;
    if (!collidesAABB(state.x, state.z, PLAYER_HALF_W, PLAYER_HALF_D, obs)) continue;
    const resolved = resolveCollision(state.x, state.z, obs);
    state.x = resolved.x;
    state.z = resolved.z;
  }
}

export function applyPlayerCollision(
  a: PlayerSimState,
  b: PlayerSimState,
  aObstacles: ObstacleRecord[] = [],
  bObstacles: ObstacleRecord[] = [],
): SimEvent[] {
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

  pullShoveVictimOutOfHazards(a, aObstacles);
  pullShoveVictimOutOfHazards(b, bObstacles);

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
    hard: { triggerDistance: 1400 },
    extreme: { triggerDistance: 850 },
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

/**
 * Avalanche chase, zone-bounded (see AVALANCHE_ZONE_LENGTH/avalancheZoneDescriptor)
 * rather than persistent-once-triggered like the yeti - reads as a
 * self-contained set-piece rather than a second permanent threat. The zone
 * containing state.z is re-derived every call (not looked up via
 * getAvalancheZoneAhead, which is for an advance client cue only) so entry/
 * exit is exact. avalancheTriggerDistance anchors the chase line in
 * state.distance-space at the moment of entry, since distance (unlike z)
 * already includes bonusDistance and varies per player.
 */
export function maybeApplyAvalancheCapture(state: PlayerSimState, seed: number, difficulty: Difficulty, roomTimeMs: number, events: SimEvent[], dt = 0, skillScoring = false) {
  if (!state.alive) return;
  const zoneIndex = Math.floor(state.z / AVALANCHE_ZONE_LENGTH);
  const inZone = avalancheZoneDescriptor(seed, zoneIndex);

  if (!inZone) {
    if (state.avalancheTriggerAtMs >= 0) {
      // Cleared the zone alive - a one-shot reward on exit, mirrors the
      // yeti danger bonus's "reuse the real gap" principle but paid once
      // instead of continuously, since the threat itself is bounded.
      if (skillScoring) {
        state.bonusDistance += AVALANCHE_OUTRUN_BONUS;
        events.push({ type: 'avalanche-outrun', playerId: state.playerId, socketId: state.id, distance: state.distance, bonus: AVALANCHE_OUTRUN_BONUS });
      }
      state.avalancheTriggerAtMs = -1;
    }
    return;
  }

  if (state.avalancheTriggerAtMs < 0) {
    state.avalancheTriggerAtMs = roomTimeMs;
    // Unlike the yeti's fixed, externally-known triggerDistance (which the
    // player can already see coming via the distance HUD, giving a real
    // head start), the avalanche's chase line anchors to wherever the
    // player's own distance happens to be at the exact tick they enter the
    // zone - with no grace distance, gap starts at exactly 0 and goes
    // negative the very next tick for anyone not already above chaseSpeed
    // at that precise instant, an unfair near-instant capture regardless of
    // skill. This grace distance gives every player the same brief buffer
    // to react, matching the "sustain speed to escape" intent.
    state.avalancheTriggerDistance = state.distance - AVALANCHE_GRACE_DISTANCE;
  }

  const elapsedSinceTrigger = Math.max(0, (roomTimeMs - state.avalancheTriggerAtMs) / 1000);
  const chaseSpeed = AVALANCHE_CHASE_SPEED[difficulty] || AVALANCHE_CHASE_SPEED.normal;
  const avalancheDistance = state.avalancheTriggerDistance + chaseSpeed * elapsedSinceTrigger;
  const gap = state.distance - avalancheDistance;

  if (gap <= 0) {
    state.alive = false;
    state.finished = true;
    state.deathKind = 'avalanche';
    events.push({ type: 'avalanche-capture', playerId: state.playerId, socketId: state.id, kind: 'avalanche', distance: state.distance });
    events.push({ type: 'death', playerId: state.playerId, socketId: state.id, kind: 'avalanche', distance: state.distance, hp: state.hp });
    return;
  }

  const dangerT = clamp(1 - gap / AVALANCHE_DANGER_GAP_WINDOW, 0, 1);
  if (dangerT > 0.5) {
    events.push({ type: 'avalanche-warning', playerId: state.playerId, socketId: state.id, distance: state.distance });
  }

  if (skillScoring && dt > 0 && dangerT > 0) {
    state.bonusDistance += dt * dangerT * AVALANCHE_PROXIMITY_BONUS_RATE;
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
    turnRate: state.turnRate,
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
