// @ts-nocheck
// Colyseus-backed adapter that keeps the exact public interface the old
// socket.io-based SocketClient exposed (method names, event names/payload
// shapes) so gameController.ts and Game.ts need zero changes - they only
// ever talk to this facade, never to Colyseus directly.
import { Client, getStateCallbacks } from 'colyseus.js';
import { SimStateSchema } from '../../../shared/RoomStateSchema';

const ROOM_NAME = 'ski_room';
// A per-reconnect-attempt delay and cap, roughly matching the server's own
// DISCONNECT_GRACE_SECONDS (server/SkiRoom.ts) so a resume attempt that's
// still in flight when the grace window closes gets one last shot right at
// the edge instead of giving up early.
const RECONNECT_ATTEMPTS = 6;
const RECONNECT_DELAY_MS = 1800;

export class SocketClient {
  constructor() {
    this._client = null;
    this._room = null;
    this._handlers = {};
    this._connected = false;
    this._reconnectionToken = null;
    this._lastRoomCode = null;
    this._reconnecting = false;
    this._leavingIntentionally = false;
    this._pendingPings = new Map();
    this._pingSeq = 0;
    this._pendingEventsBuffer = [];
  }

  connect(serverUrl = '') {
    if (this._client) return;
    // Empty string = same origin, matching the old socket.io default - but
    // in dev the page is served by Vite (:5173) while the game server runs
    // on :3002, so colyseus.js needs to be pointed there directly (its own
    // WS connection isn't a fixed-prefix path Vite's proxy can forward).
    // Plain REST calls (e.g. the room-code lookup) still go through Vite's
    // existing `/api` proxy via relative fetch(), so no proxy config changes
    // were needed for those. Pointed at the dev machine's LAN IP rather than
    // localhost so a phone on the same network (e.g. for gyro testing) can
    // reach it too - localhost on the phone would otherwise resolve to the
    // phone itself.
    const endpoint = serverUrl || (import.meta.env?.DEV ? 'http://192.168.0.103:3002' : undefined);
    this._client = endpoint ? new Client(endpoint) : new Client();
  }

  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
  }

  off(event, handler) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== handler);
  }

  _emit(event, data) {
    (this._handlers[event] || []).forEach(h => h(data));
  }

  _bindRoom(room) {
    this._room = room;
    this._reconnectionToken = room.reconnectionToken;
    this._connected = true;

    room.onMessage('room:created', data => {
      if (data?.roomId) this._lastRoomCode = String(data.roomId).toUpperCase();
      this._emit('room:created', data);
    });
    room.onMessage('room:joined', data => {
      if (data?.roomId) this._lastRoomCode = String(data.roomId).toUpperCase();
      this._emit('room:joined', data);
    });
    room.onMessage('room:state', data => this._emit('room:state', data));
    room.onMessage('room:error', data => this._emit('room:error', data));
    room.onMessage('room:countdown', data => this._emit('room:countdown', data));
    room.onMessage('player:update', data => this._emit('player:update', data));
    room.onMessage('player:left', data => this._emit('player:left', data));
    room.onMessage('player:gameover', data => this._emit('player:gameover', data));
    room.onMessage('game:start', data => this._emit('game:start', data));
    room.onMessage('debug:pong', payload => {
      // Keyed by seq (not a single shared field) - a round trip taking
      // longer than the ~1s polling interval in _updatePingMeasurement
      // (Game.ts) would otherwise let a newer ping() call overwrite the
      // in-flight request, causing a late-arriving pong to be misattributed
      // to the wrong request or silently dropped (looks like a "frozen"
      // ping reading that only updates every several seconds).
      const seq = payload?.seq;
      const rtt = performance.now() - payload.sentAt;
      console.log(`[ping] recv pong seq=${seq} rtt=${rtt.toFixed(0)}ms pendingBefore=${this._pendingPings.size}`);
      const entry = this._pendingPings.get(seq);
      if (!entry) return;
      this._pendingPings.delete(seq);
      entry(rtt);
    });

    // Transient per-tick events (hit/heal/jump-chain/etc) aren't part of the
    // schema-synced state - the server sends them as a plain message just
    // before broadcastPatch() each tick (AuthoritativeRoomRuntime._syncState),
    // so buffering them here and draining the buffer inside onStateChange
    // below keeps "events + player state for this tick" bundled together,
    // matching the old single 'game:snapshot' message's behavior closely.
    this._pendingEventsBuffer = [];
    room.onMessage('game:events', events => {
      this._pendingEventsBuffer.push(...events);
    });

    try {
      const $ = getStateCallbacks(room);
      // Explicit initial pass covers a fresh join/reconnect (the current full
      // set, matching the old full-resync-on-join semantics); onAdd then
      // covers anything newly consumed after that, one id at a time. Never
      // re-clones the whole set per tick - that per-tick full-clone cost was
      // exactly the earlier "boost held for a long time causes lag" bug.
      // Note: must traverse via $(room.state).consumedPickupIds, not
      // $(room.state.consumedPickupIds) directly - the latter throws
      // ("refId is undefined") since the dereferenced collection isn't
      // hooked into the decoder's reference tracker on its own.
      for (const id of room.state.consumedPickupIds) this._emit('pickup:add', id);
      $(room.state).consumedPickupIds.onAdd(id => this._emit('pickup:add', id));
    } catch (err) {
      // Schema wiring is somewhat fragile cross-library glue - fail loud but
      // don't let it take the whole room connection down with it.
      console.error('[SocketClient] schema state-callback wiring failed', err);
    }

    room.onStateChange(state => {
      this._emit('game:snapshot', this._buildSnapshotFromState(state));
    });

    room.onLeave((code, reason) => {
      // code 1000/1001 = clean close (leaveRoom()/tab close); anything else
      // (e.g. 1006 abnormal closure - what ws.terminate() produces, see
      // server/index.ts's pingMaxRetries comment) points at the connection
      // being killed out from under the client rather than closed normally.
      console.warn(`[socket] room:onLeave code=${code} reason=${reason || ''} intentional=${this._leavingIntentionally}`);
      this._connected = false;
      if (this._room === room) this._room = null;
      if (this._leavingIntentionally) {
        // Self-initiated (leaveRoom()/disconnect()/_leaveCurrentRoomIfAny())
        // - by the time this fires the caller has already driven whatever
        // UI transition it wanted (or, for _leaveCurrentRoomIfAny, is about
        // to bind a brand new room right after this resolves). Emitting
        // 'disconnect' here too would let gameController's handler mistake
        // an intentional rebind for a real drop and reset room state out
        // from under the rejoin in flight - see _leaveCurrentRoomIfAny's
        // comment on the "zombie player" bug this guards against.
        this._leavingIntentionally = false;
        return;
      }
      this._emit('disconnect', {});
      this._attemptReconnect();
    });

    room.onError((code, message) => {
      this._emit('room:error', { message: message || 'Room connection error.' });
    });
  }

  // Inverse of AuthoritativeRoomRuntime._syncState()'s field-by-field write
  // onto the schema instance - rebuilds the exact plain-object shape
  // _onGameSnapshot (Game.ts) already consumed from the old 'game:snapshot'
  // message, so that function needed no changes for this migration.
  _buildSnapshotFromState(state) {
    const players = [];
    state.players.forEach((p, sessionId) => {
      players.push({
        id: sessionId,
        playerId: p.playerId,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        z: p.z,
        angle: p.angle,
        speed: p.speed,
        turnRate: p.turnRate,
        hp: p.hp,
        alive: p.alive,
        finished: p.finished,
        distance: p.distance,
        bonusDistance: p.bonusDistance,
        chainCount: p.chainCount,
        momentum: p.momentum,
        cleanStreakSeconds: p.cleanStreakSeconds,
        isAirborne: p.isAirborne,
        airborneFromRamp: p.airborneFromRamp,
        jumpVelocityY: p.jumpVelocityY,
        airVelocityX: p.airVelocityX,
        airVelocityZ: p.airVelocityZ,
        airTime: p.airTime,
        invincibilityRemaining: p.invincibilityRemaining,
        lastProcessedInputSeq: p.lastProcessedInputSeq,
        // '' is schema's sentinel for "no death kind" (see
        // shared/RoomStateSchema.ts) - converted back to undefined here so
        // downstream code sees the same shape it always has.
        deathKind: p.deathKind || undefined,
      });
    });
    return {
      serverTick: state.serverTick,
      roomTimeMs: state.roomTimeMs,
      players,
      events: this._pendingEventsBuffer.splice(0),
    };
  }

  async _attemptReconnect() {
    if (!this._client || !this._reconnectionToken || this._reconnecting) return;
    this._reconnecting = true;
    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
      try {
        const room = await this._client.reconnect(this._reconnectionToken, SimStateSchema);
        this._reconnecting = false;
        this._bindRoom(room);
        // Server proactively re-sends 'room:joined' (with resumed:true)
        // once the reconnect resolves on its side too (see SkiRoom.onLeave)
        // - nothing else to do here, just wait for it to arrive.
        return;
      } catch {
        if (attempt === RECONNECT_ATTEMPTS - 1) {
          this._reconnecting = false;
          this._emit('room:error', { message: 'Lost connection to the room.' });
          return;
        }
        await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
      }
    }
  }

  // Guards against the "zombie player" bug: gameController.playAgain()
  // destroys the local Game and immediately calls joinRoom() again for a
  // fresh run, without ever calling leaveRoom() on the room connection from
  // the run that just ended - that old room object was otherwise left bound
  // (and its WebSocket open) while a second, brand new session joined
  // alongside it. The server had no signal the old session was abandoned,
  // so it lingered as a duplicate seat and - since it was the *first*
  // session, per onJoin's isCreator check - kept ownerId, silently demoting
  // the real, still-playing client to a non-host duplicate of itself.
  // Explicitly leaving any previously bound room first (and awaiting the
  // clean, consented removal it triggers server-side) before joining/
  // creating a new one closes that gap for every caller, not just playAgain.
  async _leaveCurrentRoomIfAny() {
    if (!this._room) return;
    const staleRoom = this._room;
    this._leavingIntentionally = true;
    try {
      await staleRoom.leave();
    } catch {
      // leave() itself failed (already gone/unreachable) rather than
      // resolving via the room's own onLeave - that handler is what
      // normally resets _leavingIntentionally, so reset it here too or a
      // later, genuinely unexpected disconnect on the *next* room would
      // silently get swallowed by this stale flag.
      this._leavingIntentionally = false;
    }
    if (this._room === staleRoom) this._room = null;
  }

  async createRoom(playerName, roomSettings = {}, playerId = '', playerColor = '', turnRate = 1.8) {
    this.connect();
    await this._leaveCurrentRoomIfAny();
    try {
      const room = await this._client.create(ROOM_NAME, { playerName, playerId, playerColor, settings: roomSettings, turnRate }, SimStateSchema);
      this._bindRoom(room); // _lastRoomCode is set from the server's 'room:created' message
    } catch (err) {
      this._emit('room:error', { message: err?.message || 'Could not create room.' });
    }
  }

  async joinRoom(roomId, playerName, playerId = '', playerColor = '', turnRate = 1.8) {
    this.connect();
    const code = String(roomId || '').toUpperCase();

    // If this call landed while we already hold a live reconnection token
    // for this exact room (gameController re-calls joinRoom() on its own
    // 'connect' handler after a drop), a token resume is already underway
    // via _attemptReconnect() - nothing further to do.
    if (this._reconnecting && this._lastRoomCode === code) return;

    await this._leaveCurrentRoomIfAny();

    try {
      const res = await fetch(`/api/rooms/${code}/lookup`);
      if (!res.ok) {
        this._emit('room:error', { message: `Room "${code}" not found.` });
        return;
      }
      const { roomId: internalId } = await res.json();
      const room = await this._client.joinById(internalId, { playerName, playerId, playerColor, turnRate }, SimStateSchema);
      this._lastRoomCode = code;
      this._bindRoom(room);
    } catch (err) {
      this._emit('room:error', { message: err?.message || `Room "${code}" not found.` });
    }
  }

  leaveRoom() {
    this._leavingIntentionally = true;
    this._room?.leave();
  }

  updateRoomSettings(roomSettings) {
    this._room?.send('room:updateSettings', roomSettings);
  }

  updatePlayerColor(color) {
    this._room?.send('player:color', { color });
  }

  startGame() {
    this._room?.send('game:start');
  }

  // Unreachable in current builds (superseded by the authoritative snapshot
  // path - see Game.ts's _authoritativeMultiplayer gate) but kept as a
  // harmless facade method for parity, same as the old implementation.
  sendPlayerUpdate(state) {
    this._room?.sendUnreliable('player:update', state);
  }

  sendPlayerInput(input) {
    this._room?.send('player:input', input);
  }

  sendGameOver(distance) {
    this._room?.send('player:gameover', { distance });
  }

  ping(callback) {
    if (!this._room || !this._connected) return;
    const seq = ++this._pingSeq;
    this._pendingPings.set(seq, callback);
    const sentAt = performance.now();
    console.log(`[ping] send seq=${seq} pendingAfter=${this._pendingPings.size}`);
    this._room.send('debug:ping', { seq, sentAt });
  }

  disconnect() {
    this._leavingIntentionally = true;
    this._room?.leave();
    this._room = null;
    this._client = null;
    this._connected = false;
    this._reconnectionToken = null;
    this._lastRoomCode = null;
  }

  get id() {
    return this._room?.sessionId;
  }

  get connected() {
    return !!this._connected;
  }
}
