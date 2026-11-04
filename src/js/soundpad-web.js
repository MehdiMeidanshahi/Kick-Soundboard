/**
 * Standalone Web Sound Pad Engine
 * Designed for mobile, tablet, OBS browser sources, or second-screen web controls.
 */
(function () {
  let activeAudio = null;
  let activeObjectUrl = '';
  let currentPlayingRewardId = null;
  let webState = {
    volume: 0.8,
    sounds: {},
    rewards: [],
    rewardVolumes: {},
  };

  // 1. Session Token resolution
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  if (tokenFromUrl) {
    window.sessionToken = tokenFromUrl;
    sessionStorage.setItem('kick_app_session', tokenFromUrl);
  } else if (sessionStorage.getItem('kick_app_session')) {
    window.sessionToken = sessionStorage.getItem('kick_app_session');
  }

  const $ = (s) => document.querySelector(s);

  function toast(message, isError = false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  async function apiRequest(endpoint, options = {}) {
    const token = window.sessionToken || '';
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'x-kick-app-session': token, 'X-App-Session': token } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(endpoint, { ...options, headers });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Request failed (${res.status})`);
    }
    return res.json().catch(() => ({}));
  }

  async function loadAudioSource(rewardId) {
    const token = window.sessionToken || '';
    const res = await fetch(`/api/audio/${encodeURIComponent(rewardId)}`, {
      headers: token ? { 'x-kick-app-session': token, 'X-App-Session': token } : {}
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Audio request failed (${res.status})`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  function stopAllSounds() {
    if (activeAudio) {
      try {
        activeAudio._stopped = true;
        activeAudio.pause();
        activeAudio.removeAttribute('src');
      } catch {}
      activeAudio = null;
    }
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = '';
    }
    currentPlayingRewardId = null;
    updateUI();

    // Broadcast panic stop to desktop soundboard engine
    fetch('/streamdeck/stop-all').catch(() => {});
  }

  async function triggerSound(rewardId) {
    const soundObj = webState.sounds?.[rewardId];
    if (!soundObj) return;

    // Haptic touch feedback for mobile & tablet Stream Deck users
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(35); } catch {}
    }

    // Retrigger behavior: same pad spammed -> reset currentTime = 0
    if (activeAudio && currentPlayingRewardId === rewardId && !activeAudio.paused && !activeAudio.ended) {
      activeAudio.currentTime = 0;
      const tile = document.querySelector(`[data-webpad-id="${rewardId}"]`);
      if (tile) {
        tile.classList.remove('retrigger');
        void tile.offsetWidth;
        tile.classList.add('retrigger');
      }
      return;
    }

    stopAllSounds();

    // 1. Also trigger in main desktop process so OBS output capture plays it
    fetch(`/streamdeck/trigger/${encodeURIComponent(rewardId)}`).catch(() => {});
    apiRequest('/api/trigger', {
      method: 'POST',
      body: JSON.stringify({ rewardId }),
    }).catch(() => {});

    // 2. Play locally in this browser window
    try {
      const audio = new Audio();
      const master = Number.isFinite(webState.volume) ? webState.volume : 0.8;
      const rewardVol = Number.isFinite(webState.rewardVolumes?.[rewardId]) ? webState.rewardVolumes[rewardId] : 1.0;
      audio.volume = Math.max(0, Math.min(1, master * rewardVol));

      activeAudio = audio;
      currentPlayingRewardId = rewardId;
      updateUI();

      audio.onended = () => {
        if (activeAudio === audio) stopAllSounds();
      };
      audio.onerror = () => {
        if (audio._stopped) return;
        if (window.clientLogger) {
          window.clientLogger.logError(`Web Sound Pad Audio Playback Error for reward ${rewardId}`, audio.error, { rewardId, src: audio.src });
        }
        stopAllSounds();
      };

      const src = await loadAudioSource(rewardId);
      if (activeAudio !== audio || audio._stopped) {
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
        return;
      }
      activeObjectUrl = src;
      audio.src = src;
      await audio.play();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (window.clientLogger) {
        window.clientLogger.logError(`Web Sound Pad trigger failed for reward ${rewardId}`, err, { rewardId });
      }
      toast(err.message, true);
      stopAllSounds();
    }
  }

  function updateUI() {
    document.querySelectorAll('[data-webpad-id]').forEach((tile) => {
      const rid = tile.dataset.webpadId;
      const isPlaying = activeAudio && currentPlayingRewardId === rid && !activeAudio.paused;
      tile.classList.toggle('active-play', Boolean(isPlaying));
      const eq = tile.querySelector('.equalizer-bars');
      if (eq) eq.style.display = isPlaying ? 'inline-flex' : 'none';
    });
  }

  function renderWebPad() {
    const container = $('#soundpad-sections-container');
    if (!container) return;

    const allPads = [];
    const handledIds = new Set();

    for (const [id, soundObj] of Object.entries(webState.sounds || {})) {
      if (!soundObj || (!soundObj.path && !soundObj.name && !soundObj.available)) continue;
      handledIds.add(id);
      const reward = (webState.rewards || []).find((r) => r.id === id);
      const soundBaseName = (soundObj.path ? soundObj.path.split(/[\\/]/).pop() : '') || soundObj.name || id;
      const title = reward?.title || soundObj.title || soundBaseName;
      const cost = reward?.cost ?? null;
      allPads.push({
        id,
        title,
        cost,
        soundName: soundBaseName,
        isReward: Boolean(reward),
      });
    }

    // Include mapped rewards from webState.rewards not already in handledIds
    for (const reward of (webState.rewards || [])) {
      if (handledIds.has(reward.id)) continue;
      const soundObj = webState.sounds?.[reward.id];
      if (soundObj && (soundObj.path || soundObj.name || soundObj.available)) {
        handledIds.add(reward.id);
        const soundBaseName = (soundObj.path ? soundObj.path.split(/[\\/]/).pop() : '') || soundObj.name || '';
        allPads.push({
          id: reward.id,
          title: reward.title,
          cost: reward.cost ?? null,
          soundName: soundBaseName,
          isReward: true,
        });
      }
    }

    const standalonePads = allPads.filter((p) => !p.isReward);
    const rewardPads = allPads.filter((p) => p.isReward);

    const renderTile = (pad, isStandalone) => {
      const isPlaying = activeAudio && currentPlayingRewardId === pad.id && !activeAudio.paused;
      return `
        <div class="soundpad-tile webpad-tile-large ${isStandalone ? 'standalone' : 'reward-point'} ${isPlaying ? 'active-play' : ''}" data-webpad-id="${pad.id}" role="button" tabindex="0">
          <div class="soundpad-tile-title-group">
            <div class="soundpad-tile-title" title="${pad.title}">${pad.title}</div>
            <div class="soundpad-tile-sub" title="${pad.soundName}">${pad.soundName}</div>
          </div>
          <div class="soundpad-tile-meta">
            ${isStandalone
              ? `<span class="soundpad-badge-pad">⚡ SOUND PAD</span>`
              : `<span class="soundpad-badge-points">🪙 ${pad.cost ?? 0} pts</span>`
            }
            <div class="equalizer-bars" style="display:${isPlaying ? 'inline-flex' : 'none'};">
              <span class="equalizer-bar"></span>
              <span class="equalizer-bar"></span>
              <span class="equalizer-bar"></span>
            </div>
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <!-- Section 1: Standalone Quick Sampler -->
      <section class="soundpad-section">
        <div class="soundpad-section-header">
          <div>
            <div class="soundpad-section-title">
              <span>⚡</span> Streamer Sound Pad (Quick Sampler)
            </div>
            <div class="soundpad-section-desc">Independent launchpad sounds · Tap to play immediately on stream</div>
          </div>
          <span class="soundpad-section-count neon">${standalonePads.length}</span>
        </div>
        <div class="soundpad-grid">
          ${standalonePads.length
            ? standalonePads.map((p) => renderTile(p, true)).join('')
            : `<div class="empty" style="grid-column:1/-1; padding:30px 10px;">No custom soundpad tiles yet. Add sound files in the desktop app!</div>`
          }
        </div>
      </section>

      <!-- Section 2: Channel Point Reward Sounds -->
      <section class="soundpad-section" style="margin-top: 32px;">
        <div class="soundpad-section-header">
          <div>
            <div class="soundpad-section-title">
              <span>🪙</span> Channel Point Reward Sounds (Kick)
            </div>
            <div class="soundpad-section-desc">Sounds mapped to viewer point redemptions on Kick</div>
          </div>
          <span class="soundpad-section-count purple">${rewardPads.length}</span>
        </div>
        <div class="soundpad-grid">
          ${rewardPads.length
            ? rewardPads.map((p) => renderTile(p, false)).join('')
            : `<div class="empty" style="grid-column:1/-1; padding:30px 10px;">No channel point sounds mapped yet. Connect Kick or map sounds in the desktop Studio view.</div>`
          }
        </div>
      </section>
    `;

    // Attach trigger clicks
    container.querySelectorAll('[data-webpad-id]').forEach((tile) => {
      tile.addEventListener('click', () => {
        triggerSound(tile.dataset.webpadId);
      });
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerSound(tile.dataset.webpadId);
        }
      });
    });
  }

  async function syncState() {
    try {
      const state = await apiRequest('/api/state');
      webState.volume = Number.isFinite(state.volume) ? state.volume : 0.8;
      webState.sounds = state.sounds || {};
      webState.rewardVolumes = state.rewardVolumes || {};

      // If rewards are empty but connected, fetch /api/rewards
      if (state.connected) {
        try {
          const rewRes = await apiRequest('/api/rewards');
          webState.rewards = rewRes.data || [];
        } catch {}
      }

      const statusEl = $('#webpad-conn-status');
      const statusText = $('#webpad-status-text');
      if (statusEl && statusText) {
        statusEl.classList.remove('error');
        statusText.textContent = state.connected ? 'Kick Connected' : 'Local App Connected';
      }

      const volInput = $('#webpad-volume');
      const volLabel = $('#webpad-volume-label');
      if (volInput) {
        volInput.value = Math.round(webState.volume * 100);
        volInput.style.setProperty('--pct', `${volInput.value}%`);
      }
      if (volLabel) {
        volLabel.textContent = `${Math.round(webState.volume * 100)}%`;
      }

      renderWebPad();
    } catch (err) {
      const statusEl = $('#webpad-conn-status');
      const statusText = $('#webpad-status-text');
      if (statusEl && statusText) {
        statusEl.classList.add('error');
        statusText.textContent = 'App Disconnected';
      }
    }
  }

  // Event Listeners
  $('#webpad-panic-stop')?.addEventListener('click', stopAllSounds);

  $('#webpad-deck-mode')?.addEventListener('click', () => {
    document.body.classList.toggle('deck-mode');
    const isDeck = document.body.classList.contains('deck-mode');
    if (isDeck && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (!isDeck && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    const btn = $('#webpad-deck-mode');
    if (btn) btn.textContent = isDeck ? '✕ EXIT DECK' : '🎛️ DECK MODE';
  });

  $('#webpad-volume')?.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    e.target.style.setProperty('--pct', `${val}%`);
    $('#webpad-volume-label').textContent = `${val}%`;
    webState.volume = val / 100;
    if (activeAudio) activeAudio.volume = webState.volume;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopAllSounds();
  });

  // Init
  syncState();
  setInterval(syncState, 15000);
})();
