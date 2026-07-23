import * as THREE from 'three';
import { Game } from './game/Game.js';
import { UI } from './game/UI.js';
import { MenuBackdrop } from './game/MenuBackdrop.js';
import { SocketClient } from './net/SocketClient.js';
import { settings } from './utils/Settings.js';
import { rankingStore } from './utils/RankingStore.js';

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
document.body.appendChild(renderer.domElement);

const ui = new UI();
const menuBackdrop = new MenuBackdrop(renderer);
const socket = new SocketClient();

const inputName = document.getElementById('input-name');
const inputRoom = document.getElementById('input-room');
const btnSolo = document.getElementById('btn-solo');
const btnSaveName = document.getElementById('btn-save-name');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const btnStartGame = document.getElementById('btn-start-game');
const btnLeaveRoom = document.getElementById('btn-leave-room');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnMainMenu = document.getElementById('btn-main-menu');
const btnSettings = document.getElementById('btn-settings');
const gameMode = document.getElementById('game-mode');
const btnRanking = document.getElementById('btn-ranking');
const btnGameoverRanking = document.getElementById('btn-gameover-ranking');
const btnBackFromRanking = document.getElementById('btn-back-from-ranking');
const btnClearRanking = document.getElementById('btn-clear-ranking');
const screenRanking = document.getElementById('screen-ranking');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnPauseSettings = document.getElementById('btn-pause-settings');
const btnPauseMainMenu = document.getElementById('btn-pause-main-menu');
const btnMute = document.getElementById('btn-mute');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnBackToMenu = document.getElementById('btn-back-to-menu');
const controlMode = document.getElementById('control-mode');
const mouseSensitivity = document.getElementById('mouse-sensitivity');
const invertMouse = document.getElementById('invert-mouse');
const sfxVolume = document.getElementById('sfx-volume');
const graphicsQuality = document.getElementById('graphics-quality');
const difficulty = document.getElementById('difficulty');
const yetiStartMode = document.getElementById('yeti-start-mode');
const fogLevel = document.getElementById('fog-level');
const snowVolume = document.getElementById('snow-volume');
const obstacleVolume = document.getElementById('obstacle-volume');
const mouseSensitivityValue = document.getElementById('mouse-sensitivity-value');
const sfxVolumeValue = document.getElementById('sfx-volume-value');
const fogLevelValue = document.getElementById('fog-level-value');
const snowVolumeValue = document.getElementById('snow-volume-value');
const obstacleVolumeValue = document.getElementById('obstacle-volume-value');
const screenSettings = document.getElementById('screen-settings');
const roomDifficulty = document.getElementById('room-difficulty');
const roomGameMode = document.getElementById('room-game-mode');
const roomYetiStartMode = document.getElementById('room-yeti-start-mode');
const roomObstacleVolume = document.getElementById('room-obstacle-volume');
const roomObstacleVolumeValue = document.getElementById('room-obstacle-volume-value');
const roomHostLabel = document.getElementById('room-host-label');
const blockedBrowserShortcutKeys = new Set(['s', 'o', 'a', 'b', 'f', 'p', 'w', 'q']);
const PLAYER_NAME_KEY = 'skifree3d_player_name';

let currentGame = null;
let playerName = 'Skier';
let isMultiplayer = false;
let roomId = null;
let roomSeed = null;
let roomPlayers = [];
let roomOwnerId = null;
let roomSettings = null;
let roomCountdown = null;
let settingsReturnMode = 'title';
let currentRankingEntries = [];

function getRankingMode(result) {
  if (result.gameMode === 'sky_mario') {
    return result.multiplayer ? 'multiplayer_sky_mario' : 'sky_mario';
  }
  return result.multiplayer ? 'multiplayer' : 'classic';
}

function normalizePlayerName(value) {
  return String(value || '').trim().slice(0, 16) || 'Skier';
}

function loadSavedPlayerName() {
  try {
    return normalizePlayerName(localStorage.getItem(PLAYER_NAME_KEY));
  } catch (e) {
    return 'Skier';
  }
}

function savePlayerName() {
  playerName = normalizePlayerName(inputName?.value);
  if (inputName) inputName.value = playerName;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, playerName);
  } catch (e) {
    // Ignore localStorage write failures.
  }
  return playerName;
}

function getLocalRoomSettings() {
  return {
    gameMode: gameMode?.value || settings.get('gameMode'),
    difficulty: settings.get('difficulty'),
    yetiStartMode: settings.get('yetiStartMode'),
    obstacleVolume: Number(settings.get('obstacleVolume')),
  };
}

function getRoomSettingsFormValues() {
  return {
    gameMode: roomGameMode?.value || 'classic',
    difficulty: roomDifficulty?.value || 'normal',
    yetiStartMode: roomYetiStartMode?.value || 'distance',
    obstacleVolume: Number(roomObstacleVolume?.value ?? 1),
  };
}

function isRoomHost() {
  return !!roomOwnerId && roomOwnerId === socket.id;
}

function applyRoomSettings(nextSettings = {}) {
  roomSettings = {
    gameMode: nextSettings.gameMode || 'classic',
    difficulty: nextSettings.difficulty || 'normal',
    yetiStartMode: nextSettings.yetiStartMode || 'distance',
    obstacleVolume: Number(nextSettings.obstacleVolume ?? 1),
  };
  if (roomDifficulty) roomDifficulty.value = roomSettings.difficulty;
  if (roomGameMode) roomGameMode.value = roomSettings.gameMode || 'classic';
  if (roomYetiStartMode) roomYetiStartMode.value = roomSettings.yetiStartMode;
  if (roomObstacleVolume) roomObstacleVolume.value = roomSettings.obstacleVolume;
  updateRoomSettingsUI();
}

function updateRoomSettingsUI() {
  if (roomObstacleVolumeValue && roomObstacleVolume) {
    roomObstacleVolumeValue.textContent = `${Math.round(Number(roomObstacleVolume.value) * 100)}%`;
  }

  const host = isRoomHost();
  const countingDown = roomCountdown !== null;
  for (const el of [roomGameMode, roomDifficulty, roomYetiStartMode, roomObstacleVolume]) {
    if (el) el.disabled = !host || countingDown;
  }
  if (btnStartGame) {
    btnStartGame.disabled = !host || countingDown;
    btnStartGame.textContent = countingDown
      ? `Starting ${Math.max(0, Math.round(Number(roomCountdown) || 0))}`
      : 'Start Game';
  }
  if (roomHostLabel) {
    roomHostLabel.textContent = countingDown
      ? 'Starting'
      : (host ? 'You are host' : 'Host controls');
  }
}

function setRoomCountdown(remaining = null) {
  const parsed = remaining === null || remaining === undefined
    ? null
    : Math.max(0, Math.round(Number(remaining) || 0));
  roomCountdown = parsed;
  ui.updateRoomCountdown(roomCountdown);
  updateRoomSettingsUI();
}

function sendRoomSettingsUpdate() {
  if (!isRoomHost()) return;
  roomSettings = getRoomSettingsFormValues();
  updateRoomSettingsUI();
  socket.updateRoomSettings(roomSettings);
}

function loadSettingsForm() {
  controlMode.value = settings.get('controlMode');
  mouseSensitivity.value = settings.get('mouseSensitivity');
  invertMouse.checked = settings.get('invertMouseY');
  sfxVolume.value = settings.get('sfxVolume');
  graphicsQuality.value = settings.get('graphicsQuality');
  if (difficulty) difficulty.value = settings.get('difficulty');
  if (yetiStartMode) yetiStartMode.value = settings.get('yetiStartMode');
  if (fogLevel) fogLevel.value = settings.get('fogLevel');
  if (snowVolume) snowVolume.value = settings.get('snowVolume');
  if (obstacleVolume) obstacleVolume.value = settings.get('obstacleVolume');
  if (gameMode) gameMode.value = settings.get('gameMode');
  updateSettingsValueLabels();
}

function saveSettingsForm() {
  settings.set('controlMode', controlMode.value);
  settings.set('mouseSensitivity', Number(mouseSensitivity.value));
  settings.set('invertMouseY', invertMouse.checked);
  settings.set('sfxVolume', Number(sfxVolume.value));
  settings.set('graphicsQuality', graphicsQuality.value);
  if (difficulty) settings.set('difficulty', difficulty.value);
  if (yetiStartMode) settings.set('yetiStartMode', yetiStartMode.value);
  if (fogLevel) settings.set('fogLevel', Number(fogLevel.value));
  if (snowVolume) settings.set('snowVolume', Number(snowVolume.value));
  if (obstacleVolume) settings.set('obstacleVolume', Number(obstacleVolume.value));
  if (gameMode) settings.set('gameMode', gameMode.value);
}

function updateSettingsValueLabels() {
  if (mouseSensitivityValue) mouseSensitivityValue.textContent = Number(mouseSensitivity.value).toFixed(1);
  if (sfxVolumeValue) sfxVolumeValue.textContent = `${Math.round(Number(sfxVolume.value) * 100)}%`;
  if (fogLevelValue && fogLevel) fogLevelValue.textContent = `${Math.round(Number(fogLevel.value) * 100)}%`;
  if (snowVolumeValue && snowVolume) snowVolumeValue.textContent = `${Math.round(Number(snowVolume.value) * 100)}%`;
  if (obstacleVolumeValue && obstacleVolume) {
    obstacleVolumeValue.textContent = `${Math.round(Number(obstacleVolume.value) * 100)}%`;
  }
}

function startGame(options) {
  menuBackdrop.stop();
  destroyCurrentGame();
  const gameSocket = options.multiplayer ? socket : null;
  currentGame = new Game(renderer, ui, gameSocket, {
    ...options,
    roomSettings: options.multiplayer ? roomSettings : null,
    playerName,
    roomId,
    onRunComplete: result => {
      rankingStore.addRemote({
        playerId: rankingStore.playerId,
        name: result.playerName,
        distance: result.distance,
        mode: getRankingMode(result),
        difficulty: result.difficulty,
        date: Date.now(),
      });
    },
  });
  currentGame.start();
  if (btnMute) {
    btnMute.style.display = 'block';
    btnMute.textContent = currentGame.audio.muted ? 'X' : '\u266b';
  }
}

function showTitleScreen() {
  menuBackdrop.start();
  if (btnMute) btnMute.style.display = 'none';
  ui.showTitle();
}

function showSettingsScreen() {
  if (!currentGame?.isPaused) menuBackdrop.start();
  if (btnMute && !currentGame) btnMute.style.display = 'none';
  ui.showSettings();
}

function showWaitingScreen(rid, players) {
  menuBackdrop.start();
  if (btnMute) btnMute.style.display = 'none';
  ui.showWaiting(rid, players);
  ui.updateRoomCountdown(roomCountdown);
  updateRoomSettingsUI();
}

async function showRankingScreen() {
  menuBackdrop.start();
  if (btnMute) btnMute.style.display = 'none';
  currentRankingEntries = await rankingStore.syncFromServer(10);
  ui.showRanking(currentRankingEntries);
}

function destroyCurrentGame() {
  if (!currentGame) return;
  currentGame.destroy();
  currentGame = null;
}

function pauseCurrentGame() {
  if (!currentGame?.pause()) return;
  ui.showPause();
}

function resumeCurrentGame() {
  if (!currentGame) return;
  currentGame.resume();
}

function leaveCurrentGameToMenu() {
  destroyCurrentGame();
  if (isMultiplayer) {
    socket.leaveRoom();
    socket.disconnect();
  }
  roomId = null;
  roomSeed = null;
  roomPlayers = [];
  roomOwnerId = null;
  roomSettings = null;
  roomCountdown = null;
  isMultiplayer = false;
  settingsReturnMode = 'title';
  showTitleScreen();
}

inputRoom.addEventListener('input', () => {
  inputRoom.value = inputRoom.value.toUpperCase();
});

mouseSensitivity.addEventListener('input', updateSettingsValueLabels);
sfxVolume.addEventListener('input', updateSettingsValueLabels);
fogLevel?.addEventListener('input', updateSettingsValueLabels);
snowVolume?.addEventListener('input', updateSettingsValueLabels);
obstacleVolume?.addEventListener('input', updateSettingsValueLabels);
roomDifficulty?.addEventListener('change', sendRoomSettingsUpdate);
roomGameMode?.addEventListener('change', sendRoomSettingsUpdate);
roomYetiStartMode?.addEventListener('change', sendRoomSettingsUpdate);
roomObstacleVolume?.addEventListener('input', () => {
  updateRoomSettingsUI();
  sendRoomSettingsUpdate();
});

btnSolo.addEventListener('click', () => {
  playerName = savePlayerName();
  isMultiplayer = false;
  socket.disconnect();
  roomId = null;
  roomSeed = null;
  settings.set('gameMode', gameMode?.value || 'classic');
  startGame({
    seed: Math.floor(Math.random() * 999999) + 1,
    multiplayer: false,
    gameMode: gameMode?.value || 'classic',
  });
});

btnCreate.addEventListener('click', () => {
  playerName = savePlayerName();
  isMultiplayer = true;
  roomSettings = getLocalRoomSettings();
  socket.createRoom(playerName, roomSettings);
});

btnJoin.addEventListener('click', () => {
  const code = inputRoom.value.trim().toUpperCase();
  if (!code || code.length < 4) {
    ui.setError('Enter a valid room code.');
    return;
  }

  playerName = savePlayerName();
  isMultiplayer = true;
  socket.joinRoom(code, playerName);
});

btnSaveName?.addEventListener('click', () => {
  savePlayerName();
  ui.setError('Name saved.');
});

btnStartGame.addEventListener('click', () => {
  if (btnStartGame) {
    btnStartGame.disabled = true;
    btnStartGame.textContent = 'Starting...';
  }
  socket.startGame();
});

btnLeaveRoom.addEventListener('click', () => {
  socket.leaveRoom();
  socket.disconnect();
  roomId = null;
  roomSeed = null;
  roomPlayers = [];
  roomOwnerId = null;
  roomSettings = null;
  roomCountdown = null;
  isMultiplayer = false;
  showTitleScreen();
});

btnPlayAgain.addEventListener('click', () => {
  destroyCurrentGame();
  if (isMultiplayer && roomId) {
    socket.joinRoom(roomId, playerName);
  } else {
    startGame({ seed: Math.floor(Math.random() * 999999) + 1, multiplayer: false });
  }
});

btnMainMenu.addEventListener('click', () => {
  leaveCurrentGameToMenu();
});

btnSettings.addEventListener('click', () => {
  settingsReturnMode = 'title';
  loadSettingsForm();
  showSettingsScreen();
});

btnRanking?.addEventListener('click', () => {
  showRankingScreen();
});

btnGameoverRanking?.addEventListener('click', () => {
  destroyCurrentGame();
  showRankingScreen();
});

btnBackFromRanking?.addEventListener('click', () => {
  showTitleScreen();
});

btnClearRanking?.addEventListener('click', async () => {
  await rankingStore.clearRemote();
  currentRankingEntries = [];
  ui.showRanking(rankingStore.getTop(10));
});

screenRanking?.addEventListener('click', async event => {
  const overviewButton = event.target.closest('#btn-ranking-overview');
  if (overviewButton) {
    ui.showRanking(currentRankingEntries);
    return;
  }

  const playerButton = event.target.closest('[data-player-id]');
  if (!playerButton) return;

  const player = await rankingStore.getPlayerSummary(playerButton.dataset.playerId, 10);
  if (player) ui.showRankingDetail(player);
});

btnResumeGame?.addEventListener('click', () => {
  resumeCurrentGame();
});

btnPauseSettings?.addEventListener('click', () => {
  if (!currentGame?.isPaused) pauseCurrentGame();
  settingsReturnMode = 'pause';
  loadSettingsForm();
  showSettingsScreen();
});

btnPauseMainMenu?.addEventListener('click', () => {
  leaveCurrentGameToMenu();
});

btnSaveSettings.addEventListener('click', () => {
  saveSettingsForm();
  currentGame?.audio.setVolume(settings.get('sfxVolume'));
  if (settingsReturnMode === 'pause' && currentGame?.isPaused) {
    ui.showPause();
  } else {
    settingsReturnMode = 'title';
    showTitleScreen();
  }
});

btnMute?.addEventListener('click', () => {
  if (!currentGame) return;
  currentGame.audio.unlock();
  currentGame.audio.setMuted(!currentGame.audio.muted);
  btnMute.textContent = currentGame.audio.muted ? 'X' : '\u266b';
});

btnBackToMenu.addEventListener('click', () => {
  loadSettingsForm();
  if (settingsReturnMode === 'pause' && currentGame?.isPaused) {
    ui.showPause();
  } else {
    settingsReturnMode = 'title';
    showTitleScreen();
  }
});

socket.on('room:created', ({ roomId: rid, seed, players, ownerId, settings: serverSettings, countdown }) => {
  roomId = rid;
  roomSeed = seed;
  roomPlayers = players;
  roomOwnerId = ownerId;
  applyRoomSettings(serverSettings);
  showWaitingScreen(rid, players);
  setRoomCountdown(countdown);
});

socket.on('room:joined', ({ roomId: rid, seed, players, ownerId, settings: serverSettings, countdown }) => {
  roomId = rid;
  roomSeed = seed;
  roomPlayers = players;
  roomOwnerId = ownerId;
  applyRoomSettings(serverSettings);
  showWaitingScreen(rid, players);
  setRoomCountdown(countdown);
});

socket.on('room:state', ({ players, ownerId, settings: serverSettings, countdown }) => {
  roomPlayers = players;
  if (ownerId) roomOwnerId = ownerId;
  if (serverSettings) applyRoomSettings(serverSettings);
  if (countdown !== undefined) setRoomCountdown(countdown);
  ui.updateWaitingPlayers(players);
  updateRoomSettingsUI();
});

socket.on('room:countdown', ({ remaining }) => {
  setRoomCountdown(remaining);
});

socket.on('room:error', ({ message }) => {
  ui.setError(message);
  if (!roomId && !currentGame) {
    isMultiplayer = false;
    socket.disconnect();
  }
});

socket.on('game:start', ({ seed, settings: serverSettings }) => {
  roomSeed = seed || roomSeed;
  if (serverSettings) applyRoomSettings(serverSettings);
  setRoomCountdown(null);
  startGame({ seed: roomSeed, multiplayer: true, roomSettings, players: roomPlayers });
});

socket.on('connect', () => {
  if (roomId && isMultiplayer) {
    socket.joinRoom(roomId, playerName);
  }
});

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = String(e.key || '').toLowerCase();
  if (!blockedBrowserShortcutKeys.has(key)) return;

  e.preventDefault();
  e.stopImmediatePropagation();
}, { capture: true });

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !currentGame) return;
  e.preventDefault();

  if (currentGame._running) pauseCurrentGame();
  else if (settingsReturnMode === 'pause' && screenSettings?.style.display !== 'none') ui.showPause();
  else resumeCurrentGame();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  menuBackdrop.resize(window.innerWidth, window.innerHeight);
  currentGame?.resize(window.innerWidth, window.innerHeight);
});

playerName = loadSavedPlayerName();
if (inputName) inputName.value = playerName;
loadSettingsForm();
rankingStore.syncFromServer(10);
showTitleScreen();
