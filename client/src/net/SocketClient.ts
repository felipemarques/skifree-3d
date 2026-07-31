// @ts-nocheck
import { io } from 'socket.io-client';

export class SocketClient {
  constructor() {
    this.socket = null;
    this._handlers = {};
  }

  connect(serverUrl = '') {
    if (this.socket) return;

    // Empty string = connect to the same origin (proxied by Vite dev server)
    this.socket = io(serverUrl, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      console.log('[Socket] connected', this.socket.id);
      this._emit('connect', { id: this.socket.id });
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] disconnected');
      this._emit('disconnect', {});
    });

    // Forward server events
    [
      'room:created',
      'room:joined',
      'room:state',
      'room:error',
      'room:countdown',
      'player:update',
      'player:left',
      'player:gameover',
      'combat:throw',
      'game:snapshot',
      'game:start',
    ].forEach(ev => {
      this.socket.on(ev, data => this._emit(ev, data));
    });
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

  createRoom(playerName, roomSettings = {}, playerId = '', playerColor = '', turnRate = 1.8) {
    this.connect();
    this.socket?.emit('room:create', { playerName, playerId, playerColor, settings: roomSettings, turnRate });
  }

  joinRoom(roomId, playerName, playerId = '', playerColor = '', turnRate = 1.8) {
    this.connect();
    this.socket?.emit('room:join', { roomId: roomId.toUpperCase(), playerName, playerId, playerColor, turnRate });
  }

  leaveRoom() {
    this.socket?.emit('room:leave');
  }

  updateRoomSettings(roomSettings) {
    this.socket?.emit('room:updateSettings', roomSettings);
  }

  updatePlayerColor(color) {
    this.socket?.emit('player:color', { color });
  }

  startGame() {
    this.socket?.emit('game:start');
  }

  sendPlayerUpdate(state) {
    this.socket?.volatile.emit('player:update', state);
  }

  sendPlayerInput(input) {
    this.socket?.emit('player:input', input);
  }

  sendGameOver(distance) {
    this.socket?.emit('player:gameover', { distance });
  }

  sendCombatThrow(projectile) {
    this.socket?.volatile.emit('combat:throw', projectile);
  }

  ping(callback) {
    if (!this.socket?.connected) return;
    const sentAt = performance.now();
    this.socket.emit('debug:ping', sentAt, () => {
      callback?.(performance.now() - sentAt);
    });
  }

  disconnect() {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    socket.removeAllListeners();
    socket.disconnect();
  }

  get id() {
    return this.socket?.id;
  }

  get connected() {
    return !!this.socket?.connected;
  }
}
