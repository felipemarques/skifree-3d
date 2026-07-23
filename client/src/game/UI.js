const MAX_HEARTS = 3;
const MAX_DISPLAY_SPEED_KMH = 105;

export class UI {
  constructor() {
    this.screenTitle = document.getElementById('screen-title');
    this.screenSettings = document.getElementById('screen-settings');
    this.screenWaiting = document.getElementById('screen-waiting');
    this.screenGameover = document.getElementById('screen-gameover');
    this.screenPause = document.getElementById('screen-pause');
    this.screenRanking = document.getElementById('screen-ranking');

    this.hudEl = document.getElementById('hud');
    this.playerListEl = document.getElementById('player-list');
    this.controlsHintEl = document.getElementById('controls-hint');
    this.yetiWarningEl = document.getElementById('yeti-warning');
    this.hitFlashEl = document.getElementById('hit-flash');
    this.yetiRadarEl = document.getElementById('yeti-radar');
    this.yetiRadarDotsEl = document.getElementById('yeti-radar-dots');
    this.yetiRadarDistanceEl = document.getElementById('yeti-radar-distance');

    this.hudDistance = document.getElementById('hud-distance');
    this.hudSpeed = document.getElementById('hud-speed');
    this.speedFill = document.getElementById('speed-fill');
    this.jumpState = document.getElementById('jump-state');
    this.hudQuality = document.getElementById('hud-quality');
    this.spawnShield = document.getElementById('spawn-shield');
    this.spectatorTarget = document.getElementById('spectator-target');

    this.finalDistance = document.getElementById('final-distance');
    this.leaderboard = document.getElementById('leaderboard');
    this.rankingList = document.getElementById('ranking-list');
    this.rankingEmpty = document.getElementById('ranking-empty');
    this.rankingDetail = document.getElementById('ranking-detail');
    this.displayRoomCode = document.getElementById('display-room-code');
    this.waitingPlayers = document.getElementById('waiting-players');
    this.roomCountdown = document.getElementById('room-countdown');
    this.errorMessages = Array.from(document.querySelectorAll('.error-msg'));
    this.hearts = Array.from({ length: MAX_HEARTS }, (_, i) =>
      document.getElementById(`heart-${i}`)
    );

    this._lastHp = MAX_HEARTS;
    this._activeGameMode = 'classic';
    this._controlsHintEnabled = false;
  }

  showTitle() {
    this._showScreen(this.screenTitle);
    this._setDisplay(this.hudEl, 'none');
    this._setDisplay(this.playerListEl, 'none');
    this._setDisplay(this.controlsHintEl, 'none');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._setDisplay(this.yetiRadarEl, 'none');
    this.clearError();
  }

  showRanking(entries = []) {
    this._showScreen(this.screenRanking);
    this._setDisplay(this.hudEl, 'none');
    this._setDisplay(this.playerListEl, 'none');
    this._setDisplay(this.controlsHintEl, 'none');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._setDisplay(this.yetiRadarEl, 'none');

    if (!this.rankingList || !this.rankingEmpty) return;
    this._setDisplay(this.rankingEmpty, entries.length ? 'none' : 'block');
    this._setDisplay(this.rankingList, entries.length ? 'grid' : 'none');
    this._setDisplay(this.rankingDetail, 'none');
    this.rankingList.innerHTML = entries.map((entry, i) => {
      const date = new Date(entry.date).toLocaleDateString();
      return `
        <div class="ranking-row">
          <span class="ranking-place">${i + 1}</span>
          <button class="ranking-player-button" data-player-id="${this._escapeHtml(entry.playerId)}">${this._escapeHtml(entry.name)}</button>
          <span class="ranking-distance">${Math.round(entry.distance)} m</span>
          <span class="ranking-meta">${this._escapeHtml(this._formatMode(entry.mode))} &middot; ${this._escapeHtml(entry.difficulty)} &middot; ${date} &middot; ${Math.round(entry.runCount || 1)} runs</span>
        </div>
      `;
    }).join('');
    this.clearError();
  }

  showRankingDetail(player) {
    if (!this.rankingList || !this.rankingDetail || !player) return;

    const history = Array.isArray(player.history) ? player.history.slice(0, 10) : [];
    this._setDisplay(this.rankingEmpty, 'none');
    this._setDisplay(this.rankingList, 'none');
    this._setDisplay(this.rankingDetail, 'block');

    const rows = history.map((entry, i) => {
      const date = new Date(entry.date).toLocaleDateString();
      return `
        <div class="ranking-row">
          <span class="ranking-place">${i + 1}</span>
          <span class="ranking-name">${Math.round(entry.distance)} m</span>
          <span class="ranking-distance">${date}</span>
          <span class="ranking-meta">${this._escapeHtml(this._formatMode(entry.mode))} &middot; ${this._escapeHtml(entry.difficulty)}</span>
        </div>
      `;
    }).join('');

    this.rankingDetail.innerHTML = `
      <div class="ranking-detail-card">
        <div class="ranking-detail-title">${this._escapeHtml(player.name || 'Skier')}</div>
        <div class="ranking-detail-meta">
          ${Math.round(player.runCount || history.length || 0)} runs &middot;
          best ${Math.round(player.bestDistance || 0)} m
        </div>
      </div>
      <button class="btn btn-secondary" id="btn-ranking-overview" type="button">Back to Ranking</button>
      <div class="ranking-history-title">Last 10 Runs</div>
      <div class="ranking-list">${rows || '<div class="ranking-detail-meta">No run history found.</div>'}</div>
    `;
    this.clearError();
  }

  showSettings() {
    this._showScreen(this.screenSettings);
    this._setDisplay(this.hudEl, 'none');
    this._setDisplay(this.playerListEl, 'none');
    this._setDisplay(this.controlsHintEl, 'none');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._setDisplay(this.yetiRadarEl, 'none');
    this.clearError();
  }

  showWaiting(roomId, players = []) {
    this._showScreen(this.screenWaiting);
    this.displayRoomCode.textContent = roomId;
    this.updateWaitingPlayers(players);
    this.updateRoomCountdown(null);
    this._setDisplay(this.hudEl, 'none');
    this._setDisplay(this.playerListEl, 'none');
    this._setDisplay(this.controlsHintEl, 'none');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._setDisplay(this.yetiRadarEl, 'none');
    this.clearError();
  }

  showGame(state = {}) {
    this._hideScreens();
    this._controlsHintEnabled = true;
    this._setDisplay(this.hudEl, 'block');
    this._setDisplay(this.controlsHintEl, 'block');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._activeGameMode = state.gameMode || 'classic';
    this.updateControlsHint(this._activeGameMode);
  }

  showPause() {
    this._showScreen(this.screenPause);
    this._setDisplay(this.hudEl, 'block');
    this._setDisplay(this.playerListEl, 'none');
    this._setDisplay(this.controlsHintEl, 'none');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._setDisplay(this.yetiRadarEl, 'none');
    this.clearError();
  }

  showGameOver(distance, scores = []) {
    this._showScreen(this.screenGameover);
    this._setDisplay(this.hudEl, 'none');
    this._setDisplay(this.playerListEl, 'none');
    this._setDisplay(this.controlsHintEl, 'none');
    this._setDisplay(this.yetiWarningEl, 'none');
    this._setDisplay(this.yetiRadarEl, 'none');
    this.finalDistance.textContent = `${Math.round(distance)} m`;

    if (scores.length > 1) {
      const sorted = [...scores].sort((a, b) => (b.distance || 0) - (a.distance || 0));
      this.leaderboard.innerHTML =
        '<div class="section-title" style="margin-bottom: 6px;">Room Scores</div>' +
        sorted
          .map((s, i) => `<div>${i + 1}. ${this._escapeHtml(s.name || 'Player')} - ${Math.round(s.distance || 0)} m</div>`)
          .join('');
    } else {
      this.leaderboard.innerHTML = '';
    }
  }

  updateHUD(distance, speed, hp, state = {}) {
    const speedKmh = Math.round(speed * 3.6);
    this.hudDistance.textContent = Math.round(distance);
    this.hudSpeed.textContent = speedKmh;

    if (this.speedFill) {
      const pct = Math.max(0, Math.min(100, (speedKmh / MAX_DISPLAY_SPEED_KMH) * 100));
      this.speedFill.style.width = `${pct}%`;
    }

    if (this.jumpState) {
      const airborne = !!state.isAirborne;
      this.jumpState.textContent = airborne ? 'Air' : 'Ground';
      this.jumpState.classList.toggle('active', airborne);
    }

    if (this.hudQuality && state.graphicsQuality) {
      this.hudQuality.textContent = state.graphicsQuality;
    }

    if (this.spawnShield) {
      const shieldSeconds = Math.ceil(Math.max(0, Number(state.spawnShieldSeconds) || 0));
      this.spawnShield.textContent = `Shield ${shieldSeconds}s`;
      this.spawnShield.style.display = shieldSeconds > 0 ? 'block' : 'none';
    }

    if (this.spectatorTarget) {
      const targetName = String(state.spectatorTarget || '').trim();
      this.spectatorTarget.textContent = targetName ? `Viewing ${targetName}` : '';
      this.spectatorTarget.style.display = targetName ? 'block' : 'none';
    }

    this.updateHearts(hp);
  }

  updateHearts(hp) {
    this.hearts.forEach((heart, i) => {
      if (!heart) return;
      heart.classList.toggle('lost', i >= hp);
      if (hp < this._lastHp && i === hp) {
        heart.classList.remove('shake');
        void heart.offsetWidth;
        heart.classList.add('shake');
      } else if (hp > this._lastHp && i === hp - 1) {
        heart.classList.remove('heal');
        void heart.offsetWidth;
        heart.classList.add('heal');
      }
    });
    this._lastHp = hp;
  }

  updateWaitingPlayers(players = []) {
    const names = players.map(p => p.name || 'Player').join(', ');
    this.waitingPlayers.textContent = `Players in room: ${names || 'waiting'} (${players.length}/8)`;
  }

  updateControlsHint(gameMode = 'classic', notice = '') {
    if (!this.controlsHintEl) return;

    const items = [
      ['A / D', 'Turn'],
      ['W', 'Brake'],
      ['S / Shift', 'Boost'],
      ['Space', 'Jump'],
      ['Mouse', 'Steer / speed'],
      ['Esc', 'Pause'],
    ];

    if (gameMode === 'sky_mario') {
      items.push(['E / Ctrl', 'Throw']);
      items.push(['Click', 'Throw']);
    }

    this.controlsHintEl.innerHTML = `
      <div class="controls-title">${gameMode === 'sky_mario' ? 'Sky Mario Controls' : 'Controls'}</div>
      ${notice ? `<div class="controls-notice">${this._escapeHtml(notice)}</div>` : ''}
      <div class="controls-grid">
        ${items.map(([key, label]) => `
          <div class="control-item">
            <span class="keycap">${this._escapeHtml(key)}</span>
            <span>${this._escapeHtml(label)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  updateRoomCountdown(remaining = null) {
    if (!this.roomCountdown) return;
    if (remaining === null || remaining === undefined) {
      this._setDisplay(this.roomCountdown, 'none');
      return;
    }

    const seconds = Math.max(0, Math.round(Number(remaining) || 0));
    this.roomCountdown.textContent = seconds > 0 ? `Starting in ${seconds}` : 'Go!';
    this._setDisplay(this.roomCountdown, 'block');
  }

  updatePlayerList(players) {
    if (!players || players.length <= 1) {
      this._setDisplay(this.playerListEl, 'none');
      return;
    }

    const sorted = [...players].sort((a, b) => (b.distance || 0) - (a.distance || 0));
    this._setDisplay(this.playerListEl, 'block');
    this.playerListEl.innerHTML = sorted
      .map((p, i) => {
        const alive = p.alive !== false;
        return `
          <div class="player-list-row">
            <div class="player-list-name">${i + 1}. ${this._escapeHtml(p.name || 'Player')}</div>
            <div class="player-list-meta">
              <span class="player-status${alive ? '' : ' dead'}">${alive ? 'Playing' : 'Dead'}</span>
              &middot; ${Math.round(p.distance || 0)} m
            </div>
          </div>
        `;
      })
      .join('');
  }

  showYetiWarning(show) {
    this._setDisplay(this.yetiWarningEl, show ? 'block' : 'none');
  }

  updateYetiRadar(threats = []) {
    if (!this.yetiRadarEl || !this.yetiRadarDotsEl) return;
    const visible = threats.length > 0;
    this._setDisplay(this.yetiRadarEl, visible ? 'block' : 'none');
    if (!visible) {
      this.yetiRadarDotsEl.innerHTML = '';
      if (this.yetiRadarDistanceEl) this.yetiRadarDistanceEl.textContent = '--';
      return;
    }

    const maxDistance = 140;
    this.yetiRadarDotsEl.innerHTML = threats.slice(0, 6).map(threat => {
      const scale = Math.min(1, threat.distance / maxDistance);
      const x = 50 + Math.max(-42, Math.min(42, (threat.dx / maxDistance) * 42));
      const y = 50 - Math.max(-42, Math.min(42, (threat.dz / maxDistance) * 42));
      const urgent = threat.distance < 42 ? ' urgent' : '';
      const size = Math.round(9 + (1 - scale) * 7);
      return `<span class="yeti-dot${urgent}" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;"></span>`;
    }).join('');

    if (this.yetiRadarDistanceEl) {
      this.yetiRadarDistanceEl.textContent = `${Math.round(threats[0].distance)}m`;
    }
  }

  showHitFeedback() {
    if (!this.hitFlashEl) return;
    this.hitFlashEl.classList.remove('active');
    void this.hitFlashEl.offsetWidth;
    this.hitFlashEl.classList.add('active');

    window.clearTimeout(this._hitFlashTimer);
    this._hitFlashTimer = window.setTimeout(() => {
      this.hitFlashEl.classList.remove('active');
    }, 90);
  }

  showLandingFeedback() {
    if (!this.controlsHintEl) return;
    this.updateControlsHint(this._activeGameMode, 'Clean Landing');
    this._setDisplay(this.controlsHintEl, 'block');

    window.clearTimeout(this._controlsHintTimer);
    this._controlsHintTimer = window.setTimeout(() => {
      if (!this._controlsHintEnabled) return;
      this.updateControlsHint(this._activeGameMode);
      this._setDisplay(this.controlsHintEl, 'block');
    }, 900);
  }

  showHealFeedback() {
    if (!this.controlsHintEl) return;
    this.updateControlsHint(this._activeGameMode, 'Health +1');
    this._setDisplay(this.controlsHintEl, 'block');

    window.clearTimeout(this._controlsHintTimer);
    this._controlsHintTimer = window.setTimeout(() => {
      if (!this._controlsHintEnabled) return;
      this.updateControlsHint(this._activeGameMode);
      this._setDisplay(this.controlsHintEl, 'block');
    }, 850);
  }

  setError(message) {
    this.errorMessages.forEach(el => {
      el.textContent = message;
    });

    window.clearTimeout(this._errorTimer);
    this._errorTimer = window.setTimeout(() => this.clearError(), 3000);
  }

  clearError() {
    this.errorMessages.forEach(el => {
      el.textContent = '';
    });
  }

  _showScreen(screen) {
    this._controlsHintEnabled = false;
    window.clearTimeout(this._controlsHintTimer);
    this._hideScreens();
    this._setDisplay(screen, 'flex');
  }

  _hideScreens() {
    this._setDisplay(this.screenTitle, 'none');
    this._setDisplay(this.screenSettings, 'none');
    this._setDisplay(this.screenWaiting, 'none');
    this._setDisplay(this.screenGameover, 'none');
    this._setDisplay(this.screenPause, 'none');
    this._setDisplay(this.screenRanking, 'none');
  }

  _setDisplay(el, display) {
    if (el) el.style.display = display;
  }

  _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  _formatMode(mode) {
    return ({
      solo: 'Classic',
      classic: 'Classic',
      multiplayer: 'Multiplayer',
      sky_mario: 'Sky Mario',
      multiplayer_sky_mario: 'Multiplayer Sky Mario',
    })[mode] || 'Classic';
  }
}
