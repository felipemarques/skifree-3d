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

  createRoom(playerName, roomSettings = {}) {
    this.connect();
    this.socket?.emit('room:create', { playerName, settings: roomSettings });
  }

  joinRoom(roomId, playerName) {
    this.connect();
    this.socket?.emit('room:join', { roomId: roomId.toUpperCase(), playerName });
  }

  leaveRoom() {
    this.socket?.emit('room:leave');
  }

  updateRoomSettings(roomSettings) {
    this.socket?.emit('room:updateSettings', roomSettings);
  }

  startGame() {
    this.socket?.emit('game:start');
  }

  sendPlayerUpdate(state) {
    this.socket?.volatile.emit('player:update', state);
  }

  sendGameOver(distance) {
    this.socket?.emit('player:gameover', { distance });
  }

  sendCombatThrow(projectile) {
    this.socket?.volatile.emit('combat:throw', projectile);
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
