/**
 * Studio & Rewards Management Component
 * Renders channel rewards with per-reward volume/cooldown controls,
 * redemption history log with pagination and search, and stream readiness indicators.
 */

function formatTime(value, language = 'en') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(language === 'fa' ? 'fa-IR' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

function relativeTime(value, t = (k) => k) {
  if (!value) return '';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 45) return t('justNow');
  if (seconds < 90) return t('secondsAgo', { seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('minutesAgo', { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('hoursAgo', { hours });
  const days = Math.round(hours / 24);
  return t('daysAgo', { days });
}

function renderRewards(containerId, state, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const { t = (k) => k, onChooseSound, onClearSound, onPreviewSound, onSaveRewardSettings } = options;

  if (!state.connected && !state.rewards.length) {
    container.innerHTML = `<div class="empty">${t('connectEmpty')}</div>`;
    return;
  }

  const query = (state.rewardSearch || '').trim().toLowerCase();
  const unassignedOnly = Boolean(state.unassignedOnly);
  const pill = state.rewardFilterPill || 'all';

  const filtered = (state.rewards || []).filter((reward) => {
    const sound = state.sounds?.[reward.id];
    const hasSound = Boolean(sound?.path || sound?.name || sound?.available);
    if (unassignedOnly && hasSound) return false;
    if (pill === 'mapped' && !hasSound) return false;
    if (pill === 'unmapped' && hasSound) return false;
    const isPaused = reward.is_paused === true || reward.is_enabled === false || reward.enabled === false;
    if (pill === 'enabled' && isPaused) return false;
    if (pill === 'paused' && !isPaused) return false;

    if (!query) return true;
    const soundPath = sound?.path || '';
    const soundName = sound?.name || '';
    return (
      (reward.title || '').toLowerCase().includes(query) ||
      (reward.prompt || '').toLowerCase().includes(query) ||
      soundPath.toLowerCase().includes(query) ||
      soundName.toLowerCase().includes(query)
    );
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="empty">No matching rewards found</div>`;
    return;
  }

  container.innerHTML = filtered.map((reward) => {
    const sound = state.sounds?.[reward.id];
    const hasSound = Boolean(sound?.path || sound?.name || sound?.available);
    const soundName = (sound?.path ? sound.path.split(/[\\/]/).pop() : '') || sound?.name || 'No sound selected';
    const volume = state.rewardVolumes?.[reward.id] ?? 1;
    const cooldown = state.rewardCooldowns?.[reward.id] ?? 0;
    const isPlaying = (typeof window !== 'undefined' ? window.currentPlayingPreviewRewardId : null) === reward.id;
    const isPaused = reward.is_paused === true || reward.is_enabled === false || reward.enabled === false;

    return `
      <div class="sound-row" data-reward-id="${reward.id}">
        <div class="sound-row-header">
          <div class="reward-info">
            <div class="reward-title">${reward.title}</div>
            <div class="reward-details">
              <span class="reward-sub">${t('costPoints', { cost: reward.cost ?? 0 })}</span>
              <span class="reward-status">${isPaused ? t('paused') : t('enabled')}</span>
            </div>
            <div class="sound-name ${hasSound ? '' : 'muted'}" style="margin-top:6px;">
              ${hasSound ? t('soundAssigned', { name: soundName }) : soundName}
            </div>
          </div>

          <div class="row-actions">
            <button type="button" class="ghost small" data-choose-sound="${reward.id}">${t('chooseSound')}</button>
            ${hasSound ? `<button type="button" class="ghost small" data-clear-sound="${reward.id}">${t('clearSound')}</button>` : ''}
            <button type="button" class="primary small" data-preview-sound="${reward.id}" ${hasSound ? '' : 'disabled'}>
              ${isPlaying ? `■ ${t('stopPreview')}` : `▶ ${t('previewSound')}`}
            </button>
          </div>
        </div>

        <div class="reward-controls">
          <label class="volume-label-ctrl">
            <span>${t('soundVolume')}</span>
            <input type="range" min="0" max="100" value="${Math.round(volume * 100)}" style="--pct: ${Math.round(volume * 100)}%;" data-reward-volume="${reward.id}">
            <span class="reward-volume-percent" id="vol-percent-${reward.id}">${Math.round(volume * 100)}%</span>
          </label>
          <label class="cooldown-label-ctrl">
            <span>${t('cooldownSec')}</span>
            <input type="number" min="0" max="3600" value="${cooldown}" data-reward-cooldown="${reward.id}">
          </label>
        </div>
      </div>
    `;
  }).join('');

  // Attach event handlers
  container.querySelectorAll('[data-choose-sound]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rew = state.rewards.find((r) => r.id === btn.dataset.chooseSound);
      if (rew && onChooseSound) onChooseSound(rew);
    });
  });

  container.querySelectorAll('[data-clear-sound]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (onClearSound) onClearSound(btn.dataset.clearSound);
    });
  });

  container.querySelectorAll('[data-preview-sound]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (onPreviewSound) onPreviewSound(btn.dataset.previewSound);
    });
  });

  container.querySelectorAll('[data-reward-volume]').forEach((input) => {
    input.addEventListener('input', () => {
      const rid = input.dataset.rewardVolume;
      const val = Number(input.value) / 100;
      input.style.setProperty('--pct', `${input.value}%`);
      state.rewardVolumes = state.rewardVolumes || {};
      state.rewardVolumes[rid] = val;
      const percentEl = document.getElementById(`vol-percent-${rid}`);
      if (percentEl) percentEl.textContent = `${input.value}%`;

      // Update real-time volume of active queue redemption, preview, or pad if currently playing
      const master = Number.isFinite(state.volume) ? state.volume : 0.8;
      const effVol = Math.max(0, Math.min(1, master * val));
      if (typeof window !== 'undefined') {
        const queueComp = window.queueComponent || (typeof queueModule !== 'undefined' ? queueModule : null);
        if (queueComp) {
          queueComp.updateActiveAudioVolume?.(state, rid);
          const activeAudio = queueComp.getActiveAudio?.();
          const currentItem = queueComp.getCurrentItem?.();
          if (activeAudio && (!currentItem || String(currentItem.rewardId) === String(rid))) {
            activeAudio.volume = effVol;
          }
          const prevAudio = queueComp.getActivePreviewAudio?.();
          const prevId = queueComp.getCurrentPlayingPreviewRewardId?.();
          if (prevAudio && String(prevId) === String(rid)) {
            prevAudio.volume = effVol;
          }
        }
        const soundpadComp = window.soundpadComponent || (typeof soundpadModule !== 'undefined' ? soundpadModule : null);
        if (soundpadComp) {
          soundpadComp.updateActiveAudioVolume?.(state, rid);
          const padAudio = soundpadComp.getActivePadAudio?.();
          const padId = soundpadComp.getCurrentPlayingPadRewardId?.();
          if (padAudio && String(padId) === String(rid)) {
            padAudio.volume = effVol;
          }
        }
      }
    });
    input.addEventListener('change', () => {
      const rid = input.dataset.rewardVolume;
      const val = Number(input.value) / 100;
      state.rewardVolumes = state.rewardVolumes || {};
      state.rewardVolumes[rid] = val;
      if (onSaveRewardSettings) onSaveRewardSettings(rid, { rewardVolume: val, volume: val });
    });
  });

  container.querySelectorAll('[data-reward-cooldown]').forEach((input) => {
    input.addEventListener('change', () => {
      const rid = input.dataset.rewardCooldown;
      const val = Math.max(0, parseInt(input.value, 10) || 0);
      if (onSaveRewardSettings) onSaveRewardSettings(rid, { cooldown: val });
    });
  });
}

function renderHistory(containerId, paginationContainerId, state, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const { t = (k) => k, language = 'en' } = options;

  const history = state.history || [];
  const query = (state.historySearch || '').trim().toLowerCase();
  const filter = state.historyFilter || 'all';

  const filtered = history.filter((item) => {
    const status = String(item.status || 'accepted').toLowerCase();
    if (filter !== 'all' && status !== filter) return false;
    if (!query) return true;
    const u = (item.userName || item.userLogin || '').toLowerCase();
    const r = (item.rewardTitle || '').toLowerCase();
    const m = (item.userInput || '').toLowerCase();
    return u.includes(query) || r.includes(query) || m.includes(query);
  });

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, state.historyPage || 1), totalPages);
  state.historyPage = currentPage;

  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (!pageItems.length) {
    container.innerHTML = `<div class="empty">${t('emptyHistory')}</div>`;
  } else {
    container.innerHTML = pageItems.map((item) => {
      const userName = item.userName || item.userLogin || (item.userId ? `User #${item.userId}` : 'Viewer');
      const rewardTitle = item.rewardTitle || 'Reward';
      const status = String(item.status || 'accepted').toLowerCase();
      const timeStr = formatTime(item.redeemedAt, language);
      const relStr = relativeTime(item.redeemedAt, t);

      return `
        <div class="history-item">
          <div class="history-head">
            <div>
              <span class="private-blur-wrap"><span class="history-user private-blur">${userName}</span></span>
              <span style="color:var(--muted); font-size:12px;"> redeemed </span>
              <span class="history-reward">${rewardTitle}</span>
            </div>
            <span class="tag ${status}">${t(status)}</span>
          </div>
          <div class="history-sub">${timeStr} · ${relStr}</div>
          ${item.userInput ? `<div class="history-msg private-blur-wrap"><div class="private-blur">${item.userInput}</div></div>` : ''}
        </div>
      `;
    }).join('');
  }

  // Update pagination
  const pagination = document.getElementById(paginationContainerId);
  if (pagination) {
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    const pageLabel = document.getElementById('history-page');

    if (pageLabel) pageLabel.textContent = t('pageOf', { page: currentPage, pages: totalPages });
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  }
}

function updateReadiness(state, t = (k) => k) {
  const readyConn = document.getElementById('ready-connection');
  const readySounds = document.getElementById('ready-sounds');
  const readyFiles = document.getElementById('ready-files');
  const readyPlay = document.getElementById('ready-playback');

  const rewards = state.rewards || [];
  const mappedCount = rewards.filter((r) => {
    const s = state.sounds?.[r.id];
    return Boolean(s?.path || s?.name || s?.available);
  }).length;

  if (readyConn) {
    readyConn.textContent = state.connected ? t('readyConnYes') : t('readyConnNo');
    readyConn.classList.toggle('ready', Boolean(state.connected));
  }

  if (readySounds) {
    readySounds.textContent = mappedCount > 0 ? t('readySoundsYes', { count: mappedCount }) : t('readySoundsNo');
    readySounds.classList.toggle('ready', mappedCount > 0);
  }

  const missingFilesCount = rewards.filter((r) => {
    const s = state.sounds?.[r.id];
    return Boolean(s && !s.available);
  }).length;

  if (readyFiles) {
    if (missingFilesCount > 0) {
      readyFiles.textContent = t('readyFilesNo', { count: missingFilesCount });
      readyFiles.classList.remove('ready');
    } else {
      readyFiles.textContent = t('readyFilesYes');
      readyFiles.classList.add('ready');
    }
  }

  const isAudioActive = Boolean(
    (typeof window !== 'undefined' && window.currentPlayingPreviewRewardId) ||
    (typeof window !== 'undefined' && window.soundpadComponent?.getCurrentPlayingPadRewardId?.()) ||
    (typeof window !== 'undefined' && window.queueComponent?.getCurrentItem?.()) ||
    state.currentPlayingRewardId
  );

  const isAudioReady = isAudioActive || (!state.invalidOutput && !state.audioOutputError && missingFilesCount === 0);

  if (readyPlay) {
    readyPlay.textContent = isAudioReady ? t('readyPlayYes') : t('readyPlayNo');
    readyPlay.classList.toggle('ready', isAudioReady);
  }
}

function renderPollHealth(state, t = (k) => k, language = 'en') {
  const el = document.getElementById('poll-health');
  if (!el) return;

  if (!state.connected) {
    el.textContent = '';
    return;
  }

  const poll = state.pollStatus || {};
  const lastTime = formatTime(poll.lastChecked, language);
  const nextTime = formatTime(poll.nextCheck, language);

  let text = t('pollHealthy', { seconds: 10 });
  if (lastTime) text += ` · ${t('lastChecked', { time: lastTime })}`;
  if (nextTime) text += ` · ${t('nextCheck', { time: nextTime })}`;
  el.textContent = text;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderRewards,
    renderHistory,
    updateReadiness,
    renderPollHealth,
    formatTime,
    relativeTime,
  };
} else {
  window.studioComponent = {
    renderRewards,
    renderHistory,
    updateReadiness,
    renderPollHealth,
    formatTime,
    relativeTime,
  };
}
