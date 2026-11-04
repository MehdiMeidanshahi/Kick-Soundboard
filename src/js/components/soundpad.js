/**
 * Sound Pad (Sampler Launchpad) Component
 * Features tactile 3D tiles, instant retrigger attack (currentTime = 0),
 * clean pad interruption, equalizer animation, and unmapped rewards drawer.
 */

let activePadAudio = null;
let activePadObjectUrl = '';
let currentPlayingPadRewardId = null;

function getActivePadAudio() {
  return activePadAudio;
}

function getCurrentPlayingPadRewardId() {
  return currentPlayingPadRewardId;
}

function updateActiveAudioVolume(state, rewardId = null) {
  if (activePadAudio && currentPlayingPadRewardId) {
    if (!rewardId || String(currentPlayingPadRewardId) === String(rewardId)) {
      const master = Number.isFinite(state?.volume) ? state.volume : 0.8;
      const rv = state?.rewardVolumes?.[currentPlayingPadRewardId] ?? state?.rewardVolumes?.[String(currentPlayingPadRewardId)];
      const rewardVol = Number.isFinite(rv) ? rv : 1.0;
      activePadAudio.volume = Math.max(0, Math.min(1, master * rewardVol));
    }
  }
}

function stopAllPadSounds() {
  if (activePadAudio) {
    try {
      activePadAudio._stopped = true;
      activePadAudio.pause();
      activePadAudio.removeAttribute('src');
    } catch (e) {
      // Ignore audio cleanup error
    }
    activePadAudio = null;
  }
  if (activePadObjectUrl) {
    URL.revokeObjectURL(activePadObjectUrl);
    activePadObjectUrl = '';
  }
  currentPlayingPadRewardId = null;
  updateSoundPadUI();
  const stopAllBtn = document.getElementById('soundpad-stop-all');
  if (stopAllBtn) stopAllBtn.style.display = 'none';
}

function triggerPadSound(rewardId, state, onAssignSound) {
  const soundConfig = state.sounds?.[rewardId];
  const hasSound = Boolean(soundConfig?.path || soundConfig?.name || soundConfig?.available);
  if (!soundConfig || !hasSound) {
    if (typeof onAssignSound === 'function') {
      const reward = state.rewards.find((r) => r.id === rewardId);
      onAssignSound(reward || { id: rewardId, title: 'Reward' });
    }
    return;
  }

  // 1. Sampler Retrigger Behavior: Same pad clicked while playing -> reset currentTime = 0
  if (activePadAudio && currentPlayingPadRewardId === rewardId && !activePadAudio.paused && !activePadAudio.ended) {
    activePadAudio.currentTime = 0;
    const tile = document.querySelector(`.soundpad-tile[data-soundpad-reward-id="${rewardId}"]`);
    if (tile) {
      tile.classList.remove('retrigger');
      void tile.offsetWidth; // trigger reflow
      tile.classList.add('retrigger');
    }
    return;
  }

  // 2. Interruption: Different pad clicked -> stop previous sound immediately
  stopAllPadSounds();

  try {
    const audio = new Audio();
    const master = Number.isFinite(state.volume) ? state.volume : 0.8;
    const rewardVol = Number.isFinite(state.rewardVolumes?.[rewardId]) ? state.rewardVolumes[rewardId] : 1.0;
    audio.volume = Math.max(0, Math.min(1, master * rewardVol));

    if (state.audioDeviceId && typeof audio.setSinkId === 'function') {
      audio.setSinkId(state.audioDeviceId).catch((err) => {
        if (window.clientLogger) window.clientLogger.logError('Audio setSinkId failed', err);
        audio.setSinkId('').catch(() => {});
      });
    }

    activePadAudio = audio;
    currentPlayingPadRewardId = rewardId;

    const stopAllBtn = document.getElementById('soundpad-stop-all');
    if (stopAllBtn) stopAllBtn.style.display = 'inline-flex';

    audio.onplay = () => updateSoundPadUI();
    audio.onplaying = () => updateSoundPadUI();
    audio.onpause = () => updateSoundPadUI();
    audio.onended = () => {
      if (activePadAudio === audio) {
        stopAllPadSounds();
      }
    };

    audio.onerror = () => {
      if (audio._stopped) return;
      if (window.clientLogger) {
        window.clientLogger.logError(`SoundPad Audio Playback Error for reward ${rewardId}`, audio.error, {
          rewardId,
          audioSrc: audio.src,
        });
      }
      stopAllPadSounds();
    };

    updateSoundPadUI();

    if (typeof window === 'undefined') {
      audio.src = `/api/audio/${encodeURIComponent(rewardId)}`;
      audio.play().then(() => updateSoundPadUI()).catch((err) => {
        if (err.name === 'AbortError' || audio._stopped) return;
        stopAllPadSounds();
      });
      return;
    }

    (async () => {
      try {
        let src = `/api/audio/${encodeURIComponent(rewardId)}`;
        if (typeof window.fetch === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          const token = (window.sessionToken || (await window.kickApp?.getApiSessionToken?.())) || '';
          const res = await window.fetch(src, {
            headers: token ? { 'x-kick-app-session': token, 'X-App-Session': token } : {}
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Audio request failed (${res.status})`);
          }
          const blob = await res.blob();
          src = URL.createObjectURL(blob);
        }

        if (activePadAudio !== audio || audio._stopped) {
          if (src.startsWith('blob:')) URL.revokeObjectURL(src);
          return;
        }
        if (src.startsWith('blob:')) activePadObjectUrl = src;
        audio.src = src;

        await audio.play();
        updateSoundPadUI();
      } catch (err) {
        if (err.name === 'AbortError' || audio._stopped) return;
        if (window.clientLogger) {
          window.clientLogger.logError(`SoundPad play() rejected for reward ${rewardId}`, err, { rewardId });
        }
        stopAllPadSounds();
      }
    })();
  } catch (error) {
    if (window.clientLogger) {
      window.clientLogger.logError(`Exception in triggerPadSound for reward ${rewardId}`, error, { rewardId });
    }
    stopAllPadSounds();
  }
}

function updateSoundPadUI() {
  document.querySelectorAll('.soundpad-tile[data-soundpad-reward-id]').forEach((tile) => {
    const rid = String(tile.dataset.soundpadRewardId);
    const isPlaying = Boolean(
      (activePadAudio && String(currentPlayingPadRewardId) === rid && !activePadAudio.ended && !activePadAudio._stopped) ||
      (window.currentQueueRewardId && String(window.currentQueueRewardId) === rid)
    );
    tile.classList.toggle('active-play', isPlaying);

    const eq = tile.querySelector('.equalizer-bars');
    if (eq) eq.style.display = isPlaying ? 'inline-flex' : 'none';

    const stopBtn = tile.querySelector('.soundpad-stop-btn');
    if (stopBtn) stopBtn.style.display = isPlaying ? 'inline-flex' : 'none';
  });
}

function renderSoundPad(containerId, unmappedContainerId, state, options = {}) {
  const grid = document.getElementById(containerId);
  const unmappedSection = document.getElementById(unmappedContainerId);
  if (!grid) return;

  const { t = (k) => k, onTrigger, onChooseSound } = options;

  // 1. Gather all active sound pads (both attached to Kick rewards and standalone soundpad sounds)
  const allSoundPads = [];
  const handledIds = new Set();

  for (const [id, soundObj] of Object.entries(state.sounds || {})) {
    if (!soundObj || (!soundObj.path && !soundObj.name && !soundObj.available)) continue;
    handledIds.add(id);
    const reward = (state.rewards || []).find((r) => r.id === id);
    const soundBaseName = (soundObj.path ? soundObj.path.split(/[\\/]/).pop() : '') || soundObj.name || id;
    const title = reward?.title || soundObj.title || soundBaseName;
    const cost = reward?.cost ?? null;
    allSoundPads.push({
      id,
      title,
      cost,
      soundName: soundBaseName,
      isReward: Boolean(reward),
      reward,
    });
  }

  // Include mapped rewards from state.rewards not already in handledIds
  for (const reward of (state.rewards || [])) {
    if (handledIds.has(reward.id)) continue;
    const soundObj = state.sounds?.[reward.id];
    if (soundObj && (soundObj.path || soundObj.name || soundObj.available)) {
      handledIds.add(reward.id);
      const soundBaseName = (soundObj.path ? soundObj.path.split(/[\\/]/).pop() : '') || soundObj.name || '';
      allSoundPads.push({
        id: reward.id,
        title: reward.title,
        cost: reward.cost ?? null,
        soundName: soundBaseName,
        isReward: true,
        reward,
      });
    }
  }

  // Unmapped channel point rewards (Kick rewards without a sound mapped yet)
  const unmappedRewards = (state.rewards || []).filter((r) => !handledIds.has(r.id));

  const query = (state.soundpadSearch || '').trim().toLowerCase();
  const filtered = allSoundPads.filter((p) =>
    (p.title || '').toLowerCase().includes(query) ||
    (p.soundName || '').toLowerCase().includes(query)
  );

  if (!filtered.length && !query && !unmappedRewards.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1 / -1; padding: 40px 10px;">
        <div style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">${t('soundpadEmpty')}</div>
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">Add your favorite sounds or connect your Kick channel to load reward sounds.</div>
        <button type="button" class="primary" id="soundpad-empty-add-btn">+ ${t('addSoundpadTile')}</button>
      </div>
    `;
    const emptyAddBtn = document.getElementById('soundpad-empty-add-btn');
    if (emptyAddBtn && typeof onChooseSound === 'function') {
      emptyAddBtn.addEventListener('click', () => onChooseSound(null));
    }
    if (unmappedSection) unmappedSection.style.display = 'none';
    return;
  }

  // Separate sounds into Standalone Sound Pad sounds and Kick Channel Point Reward sounds
  const standalonePads = filtered.filter((p) => !p.isReward || p.cost === null);
  const rewardPads = filtered.filter((p) => p.isReward && p.cost !== null);

  const formatAcceleratorForDisplay = (accelerator) => {
    if (!accelerator) return '';
    return String(accelerator)
      .replace(/CommandOrControl/gi, 'Ctrl')
      .replace(/Control/gi, 'Ctrl')
      .replace(/mouse4/gi, 'Mouse 4')
      .replace(/mouse5/gi, 'Mouse 5')
      .replace(/num([0-9])/gi, 'Num $1')
      .replace(/\+/g, '+');
  };

  const renderTile = (pad, isRewardTile) => {
    const isPlaying = activePadAudio && currentPlayingPadRewardId === pad.id && !activePadAudio.paused;
    const tileTypeClass = isRewardTile ? 'reward-point' : 'standalone';
    const badgeHtml = isRewardTile
      ? `<span class="soundpad-badge-points">🪙 ${t('costPoints', { cost: pad.cost })}</span>`
      : `<span class="soundpad-badge-pad">⚡ ${t('soundpadBadgePad')}</span>`;
    const keybind = state.keybinds?.[pad.id] || '';
    const displayKey = formatAcceleratorForDisplay(keybind);

    return `
      <div class="soundpad-tile ${tileTypeClass} ${isPlaying ? 'active-play' : ''}" data-soundpad-reward-id="${pad.id}" role="button" tabindex="0" aria-label="${pad.title} - ${isRewardTile ? t('costPoints', { cost: pad.cost }) : t('soundpadBadgePad')}">
        <div class="soundpad-tile-header">
          <div class="soundpad-tile-title-group">
            <div class="soundpad-tile-title" title="${pad.title}">
              <span class="soundpad-tile-title-text">${pad.title}</span>
              ${!isRewardTile ? `<button type="button" class="soundpad-edit-title-btn" data-edit-title="${pad.id}" title="${t('editTitle')}" aria-label="${t('editTitle')}">✏️</button>` : ''}
            </div>
            <div class="soundpad-tile-sub" title="${pad.soundName}">${pad.soundName}</div>
          </div>
          <button type="button" class="soundpad-keybind-btn ${keybind ? 'assigned' : ''}" data-keybind-sound="${pad.id}" title="${keybind ? t('keybindAssigned', { key: displayKey }) : t('assignKeybind')}">⌨️ ${displayKey || '+Key'}</button>
        </div>
        <div class="soundpad-tile-meta">
          <div class="soundpad-tile-badge-group">
            ${badgeHtml}
            <div class="equalizer-bars" style="display:${isPlaying ? 'inline-flex' : 'none'};">
              <span class="equalizer-bar"></span>
              <span class="equalizer-bar"></span>
              <span class="equalizer-bar"></span>
            </div>
          </div>
          <div class="soundpad-tile-actions">
            <button type="button" class="soundpad-deck-btn" data-deck-copy="${pad.id}" title="${t('copyTriggerUrl')}" aria-label="Stream Deck trigger">🎛️</button>
            <button type="button" class="soundpad-change-btn" data-change-sound="${pad.id}" title="${t('changeSound')}" aria-label="${t('changeSound')}">📁</button>
            <button type="button" class="soundpad-stop-btn" data-stop-sound="${pad.id}" style="display:${isPlaying ? 'inline-flex' : 'none'};" title="${t('stopPreview')}">⏹ ${t('stopPreview')}</button>
          </div>
        </div>
      </div>
    `;
  };

  const addTileHtml = `
    <div class="soundpad-tile add-tile" id="soundpad-add-tile">
      <div style="font-size:24px; color:var(--green); margin-bottom:4px;">+</div>
      <div style="font-weight:700; font-size:13px; color:var(--text);">${t('addSoundpadTile')}</div>
      <div style="font-size:11px; color:var(--muted); margin-top:2px;">${t('assignRewardSubtitle')}</div>
    </div>
  `;

  const standaloneTilesHtml = standalonePads.map((p) => renderTile(p, false)).join('');
  const rewardTilesHtml = rewardPads.map((p) => renderTile(p, true)).join('');

  grid.innerHTML = `
    <!-- Section 1: Standalone Streamer Quick Sampler -->
    <div class="soundpad-section">
      <div class="soundpad-section-header">
        <div>
          <div class="soundpad-section-title">
            <span>⚡</span>
            <span>${t('soundpadStandaloneTitle')}</span>
          </div>
          <div class="soundpad-section-desc">${t('soundpadStandaloneDesc')}</div>
        </div>
        <span class="soundpad-section-count neon">${standalonePads.length}</span>
      </div>
      <div class="soundpad-grid" id="soundpad-standalone-grid">
        ${standaloneTilesHtml}
        ${addTileHtml}
      </div>
    </div>

    <!-- Clear Visual Separator Between Sound Pad and Channel Point Rewards -->
    <div class="soundpad-separator" role="separator" aria-label="${t('soundpadRewardsSeparator')}">
      <div class="soundpad-separator-line"></div>
      <div class="soundpad-separator-badge">
        <span>🪙</span>
        <span>${t('soundpadRewardsSeparator')}</span>
      </div>
      <div class="soundpad-separator-line"></div>
    </div>

    <!-- Section 2: Kick Channel Point Rewards -->
    <div class="soundpad-section">
      <div class="soundpad-section-header">
        <div>
          <div class="soundpad-section-title">
            <span>🪙</span>
            <span>${t('soundpadRewardsTitle')}</span>
          </div>
          <div class="soundpad-section-desc">${t('soundpadRewardsDesc')}</div>
        </div>
        <span class="soundpad-section-count purple">${rewardPads.length}</span>
      </div>
      <div class="soundpad-grid" id="soundpad-rewards-grid">
        ${rewardTilesHtml || `<div class="empty" style="grid-column: 1 / -1; padding: 24px 10px;">${t('soundpadNoRewards')}</div>`}
      </div>
    </div>
  `;

  // Click & Keydown on tile triggers sampler
  grid.querySelectorAll('.soundpad-tile[data-soundpad-reward-id]').forEach((tile) => {
    const handleTrigger = () => {
      const rid = tile.dataset.soundpadRewardId;
      if (typeof onTrigger === 'function') onTrigger(rid);
      else triggerPadSound(rid, state, onChooseSound);
    };

    tile.addEventListener('click', (e) => {
      if (e.target.closest('.soundpad-change-btn') || e.target.closest('.soundpad-stop-btn') || e.target.closest('.soundpad-keybind-btn') || e.target.closest('.soundpad-deck-btn') || e.target.closest('.soundpad-edit-title-btn')) return;
      handleTrigger();
    });

    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTrigger();
      }
    });
  });

  // Dedicated tile stop buttons
  grid.querySelectorAll('.soundpad-stop-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopAllPadSounds();
    });
  });

  // Keybind button on tile
  grid.querySelectorAll('[data-keybind-sound]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rid = btn.dataset.keybindSound;
      const pad = allSoundPads.find((p) => p.id === rid);
      if (typeof options.onOpenKeybindModal === 'function') {
        options.onOpenKeybindModal(rid, pad?.title || rid);
      }
    });
  });

  // Stream Deck trigger copy button on tile
  grid.querySelectorAll('[data-deck-copy]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rid = btn.dataset.deckCopy;
      const url = `http://localhost:9000/streamdeck/trigger/${encodeURIComponent(rid)}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url).catch(() => {});
      }
      if (typeof options.onToast === 'function') {
        options.onToast(t('triggerUrlCopied'));
      }
    });
  });

  // Edit standalone soundpad title button
  grid.querySelectorAll('[data-edit-title]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rid = btn.dataset.editTitle;
      const pad = allSoundPads.find((p) => p.id === rid);
      if (typeof options.onRenameSoundpadTitle === 'function') {
        options.onRenameSoundpadTitle(rid, pad?.title || '');
      }
    });
  });

  // Change sound button on tile
  grid.querySelectorAll('[data-change-sound]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rid = btn.dataset.changeSound;
      const pad = allSoundPads.find((p) => p.id === rid);
      if (typeof onChooseSound === 'function') onChooseSound(pad?.reward || rid);
    });
  });

  // Add sound tile focus / picker (Always creates standalone pad sound)
  const addTile = document.getElementById('soundpad-add-tile');
  if (addTile) {
    addTile.addEventListener('click', () => {
      if (typeof onChooseSound === 'function') {
        onChooseSound(null);
      }
    });
  }

  // Render Unmapped Rewards Drawer (if any channel rewards still lack sounds)
  if (unmappedSection) {
    const unmappedList = document.getElementById('soundpad-unmapped-list');
    const unmappedCount = document.getElementById('soundpad-unmapped-count');
    if (unmappedRewards.length > 0) {
      unmappedSection.style.display = 'block';
      if (unmappedCount) unmappedCount.textContent = String(unmappedRewards.length);
      if (unmappedList) {
        unmappedList.innerHTML = unmappedRewards.map((reward) => `
          <div style="background:#0d121a; border:1px solid var(--line); border-radius:var(--radius-md); padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:700; font-size:13px; color:var(--text);">${reward.title}</div>
              <div style="font-size:11px; color:var(--purple); font-weight:600; margin-top:2px;">${reward.cost ?? 0} pts</div>
            </div>
            <button type="button" class="primary small" data-quick-assign="${reward.id}">${t('chooseSound')}</button>
          </div>
        `).join('');

        unmappedList.querySelectorAll('[data-quick-assign]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const rid = btn.dataset.quickAssign;
            const rew = state.rewards.find((r) => r.id === rid);
            if (rew && typeof onChooseSound === 'function') onChooseSound(rew);
          });
        });
      }
    } else {
      unmappedSection.style.display = 'none';
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    triggerPadSound,
    stopAllPadSounds,
    updateSoundPadUI,
    renderSoundPad,
    getActivePadAudio,
    getCurrentPlayingPadRewardId,
    updateActiveAudioVolume,
  };
} else {
  window.soundpadComponent = {
    triggerPadSound,
    stopAllPadSounds,
    updateSoundPadUI,
    renderSoundPad,
    getActivePadAudio,
    getCurrentPlayingPadRewardId,
    updateActiveAudioVolume,
  };
  window.soundpadModule = window.soundpadComponent;
}
