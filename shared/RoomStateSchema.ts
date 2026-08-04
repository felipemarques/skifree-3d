// @ts-nocheck
// Colyseus schema classes for the authoritative per-tick player sync -
// Phase 2 of the Colyseus migration. Deliberately narrow in scope: this
// mirrors ONLY what AuthoritativeRoomRuntime's old emitSnapshot() sent
// (RoomSnapshotPlayer's 26 flat fields + consumedPickupIds), not the whole
// PlayerSimState (shared/AuthoritativeSim.ts) - the sim itself keeps
// mutating plain objects/a plain Set exactly as before; schema only enters
// at this network-sync boundary. Uses defineTypes() (imperative, no
// decorators) to match this codebase's existing plain-JS/@ts-nocheck style
// rather than needing experimentalDecorators wired into either tsconfig.
import { Schema, MapSchema, SetSchema, defineTypes } from '@colyseus/schema';

export class PlayerStateSchema extends Schema {
  constructor() {
    super();
    this.id = '';
    this.playerId = '';
    this.name = '';
    this.color = '';
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.angle = 0;
    this.speed = 0;
    this.turnRate = 0;
    this.hp = 0;
    this.alive = true;
    this.finished = false;
    this.distance = 0;
    this.bonusDistance = 0;
    this.chainCount = 0;
    this.momentum = 0;
    this.cleanStreakSeconds = 0;
    this.isAirborne = false;
    this.airborneFromRamp = false;
    this.jumpVelocityY = 0;
    this.airVelocityX = 0;
    this.airVelocityZ = 0;
    this.airTime = 0;
    this.invincibilityRemaining = 0;
    this.lastProcessedInputSeq = 0;
    // Schema has no `undefined` - '' is the sentinel for "no death kind",
    // converted back to undefined at the plain-object boundary on the
    // client (see SocketClient.ts's toPlainPlayerState).
    this.deathKind = '';
  }
}
defineTypes(PlayerStateSchema, {
  id: 'string',
  playerId: 'string',
  name: 'string',
  color: 'string',
  x: 'number',
  y: 'number',
  z: 'number',
  angle: 'number',
  speed: 'number',
  turnRate: 'number',
  hp: 'number',
  alive: 'boolean',
  finished: 'boolean',
  distance: 'number',
  bonusDistance: 'number',
  chainCount: 'number',
  momentum: 'number',
  cleanStreakSeconds: 'number',
  isAirborne: 'boolean',
  airborneFromRamp: 'boolean',
  jumpVelocityY: 'number',
  airVelocityX: 'number',
  airVelocityZ: 'number',
  airTime: 'number',
  invincibilityRemaining: 'number',
  lastProcessedInputSeq: 'number',
  deathKind: 'string',
});

export class SimStateSchema extends Schema {
  constructor() {
    super();
    this.serverTick = 0;
    this.roomTimeMs = 0;
    this.seed = 0;
    this.players = new MapSchema();
    this.consumedPickupIds = new SetSchema();
  }
}
defineTypes(SimStateSchema, {
  serverTick: 'number',
  roomTimeMs: 'number',
  seed: 'number',
  players: { map: PlayerStateSchema },
  consumedPickupIds: { set: 'string' },
});
