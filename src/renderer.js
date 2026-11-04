(function () {
/**
 * Kick Soundboard - Main Renderer Orchestrator
 * Coordinates modular components: i18n, Logger, State, API, SoundPad, Analytics, Studio, Queue, Settings, Navigation.
 */

// Load or import modules (supports both browser window globals and Node require in tests)
const isNode = typeof module !== 'undefined' && module.exports;

const i18nModule = isNode ? require('./js/i18n') : window.i18n;
const stateModule = isNode ? require('./js/state') : window.appState;
const apiModule = isNode ? require('./js/api') : window.apiClient;
const loggerModule = isNode ? require('./js/logger') : window.clientLogger;
const soundpadModule = isNode ? require('./js/components/soundpad') : window.soundpadComponent;
const analyticsModule = isNode ? require('./js/components/analytics') : window.analyticsComponent;
const studioModule = isNode ? require('./js/components/studio') : window.studioComponent;
const queueModule = isNode ? require('./js/components/queue') : window.queueComponent;
const settingsModule = isNode ? require('./js/components/settings') : window.settingsComponent;
const navModule = isNode ? require('./js/components/navigation') : window.navigationComponent;
if (typeof window !== 'undefined') {
  window.soundpadModule = soundpadModule;
  window.queueModule = queueModule;
}

// Core singletons
const state = stateModule.state;
const translations = i18nModule.translations;
const t = i18nModule.t;
const applyLanguage = i18nModule.applyLanguage;
const request = apiModule.request;
const getTimelineBuckets = analyticsModule.getTimelineBuckets;
const renderTimelineChart = analyticsModule.renderTimelineChart;

// DOM shorthand
const $ = (s) => document.querySelector(s);
let toastTimer = null;

function toast(message, isError = false) {
  const el = $('#toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);

  if (isError && loggerModule) {
    loggerModule.logError('UI Toast Alert', new Error(message), { isError: true });
  }
}

// Effective volume calculation
function effectiveVolume(rewardId) {
  return queueModule.effectiveVolume(rewardId, state);
}

// Queue delegation
function enqueueRedemptionSound(payload) {
  return queueModule.enqueueRedemptionSound(payload, state, () => queueModule.updateQueueUI(state, t));
}
function stopQueue() {
  queueModule.stopQueue(state, () => queueModule.updateQueueUI(state, t));
}
function resumeQueue() {
  queueModule.resumeQueue(state, () => queueModule.updateQueueUI(state, t));
}
function skipCurrent() {
  queueModule.skipCurrent(state, () => queueModule.updateQueueUI(state, t));
}
function clearQueue() {
  queueModule.clearQueue(state, () => queueModule.updateQueueUI(state, t));
}
function stopPreview() {
  queueModule.stopPreview(() => updatePreviewButtons());
}
async function playPreview(rewardId) {
  await queueModule.playPreview(rewardId, state, () => updatePreviewButtons());
}

function updatePreviewButtons() {
  document.querySelectorAll('[data-preview-sound]').forEach((btn) => {
    const rid = btn.dataset.previewSound;
    const isPlaying = queueModule.getCurrentPlayingPreviewRewardId() === rid;
    btn.textContent = isPlaying ? `■ ${t('stopPreview')}` : `▶ ${t('previewSound')}`;
  });
}

// SoundPad delegation
function triggerPadSound(rewardId) {
  soundpadModule.triggerPadSound(rewardId, state, (reward) => chooseSound(reward));
  const sound = state.sounds?.[rewardId];
  if (sound) {
    const isReward = Boolean((state.rewards || []).find((r) => String(r.id) === String(rewardId)));
    const soundBaseName = (sound.path ? sound.path.split(/[\\/]/).pop() : '') || sound.name || rewardId;
    const title = sound.title || soundBaseName;
    if (window.kickApp?.notifyOverlayTrigger) {
      window.kickApp.notifyOverlayTrigger({
        type: isReward ? 'channel_point' : 'soundpad',
        soundId: rewardId,
        title,
        userName: isReward ? 'Channel Reward' : 'Streamer',
        cost: isReward ? (state.rewards?.find((r) => String(r.id) === String(rewardId))?.cost || 0) : null,
        timestamp: Date.now(),
      }).catch(() => {});
    }
  }
}
function stopAllPadSounds() {
  soundpadModule.stopAllPadSounds();
}
function panicStopAll() {
  soundpadModule.stopAllPadSounds();
  stopPreview();
  stopQueue();
  clearQueue();
}
function renderSoundPad() {
  soundpadModule.renderSoundPad('soundpad-grid', 'soundpad-unmapped-section', state, {
    t,
    onTrigger: (rid) => triggerPadSound(rid),
    onChooseSound: (reward) => chooseSound(reward),
    onOpenKeybindModal: (id, title) => openKeybindModal(id, title),
    onRenameSoundpadTitle: (id, title) => openRenameModal(id, title),
    onToast: (msg) => toast(msg),
  });
}

// Channel Point Goal delegation
function renderGoal() {
  if (typeof goalModule !== 'undefined' && goalModule.renderGoalView) {
    goalModule.renderGoalView('goal-view-container', state, {
      t,
      onToast: (msg) => toast(msg),
      onAdjustGoal: async (delta) => {
        try {
          const res = await request('/api/goal/adjust', {
            method: 'POST',
            body: JSON.stringify({ delta }),
          });
          if (res?.goal) {
            state.goal = res.goal;
            renderGoal();
            const sign = delta >= 0 ? '+' : '';
            toast(`${sign}${delta.toLocaleString()} points adjusted.`);
          }
        } catch (err) {
          toast(err.message, true);
        }
      },
      onSetGoalProgress: async (currentVal) => {
        try {
          const res = await request('/api/goal', {
            method: 'POST',
            body: JSON.stringify({ current: currentVal }),
          });
          if (res?.goal) {
            state.goal = res.goal;
            renderGoal();
            toast(t('goalSettingsSaved'));
          }
        } catch (err) {
          toast(err.message, true);
        }
      },
      onResetGoal: async () => {
        try {
          const res = await request('/api/goal/reset', { method: 'POST', body: '{}' });
          if (res?.goal) {
            state.goal = res.goal;
            renderGoal();
            toast(t('goalResetSuccess'));
          }
        } catch (err) {
          toast(err.message, true);
        }
      },
      onSaveGoalSettings: async (settings) => {
        try {
          const res = await request('/api/goal', {
            method: 'POST',
            body: JSON.stringify(settings),
          });
          if (res?.goal) {
            state.goal = res.goal;
            renderGoal();
            toast(t('goalSettingsSaved'));
          }
        } catch (err) {
          toast(err.message, true);
        }
      },
      onTestRedemption: async () => {
        try {
          const res = await request('/api/goal/test', { method: 'POST', body: '{}' });
          if (res?.goal) {
            state.goal = res.goal;
            renderGoal();
          }
          toast('Test +500 redemption popup dispatched to OBS overlay!');
        } catch (err) {
          toast(err.message, true);
        }
      },
      onTestDeduct: async () => {
        try {
          const res = await request('/api/goal/test', {
            method: 'POST',
            body: JSON.stringify({ delta: -500 }),
          });
          if (res?.goal) {
            state.goal = res.goal;
            renderGoal();
          }
          toast('Test -500 deduction popup dispatched to OBS overlay!');
        } catch (err) {
          toast(err.message, true);
        }
      },
    });
  }
}

// Studio & Rewards delegation
function renderRewards() {
  studioModule.renderRewards('rewards', state, {
    t,
    onChooseSound: (reward) => chooseSound(reward),
    onClearSound: (rid) => clearSound(rid),
    onPreviewSound: (rid) => playPreview(rid),
    onSaveRewardSettings: (rid, fields) => saveRewardSettings(rid, fields),
  });
}

function renderHistory() {
  studioModule.renderHistory('history', 'history-pagination', state, {
    t,
    language: i18nModule.getLanguage(),
  });
}

function updateReadiness() {
  studioModule.updateReadiness(state, t);
}

function renderPollHealth() {
  studioModule.renderPollHealth(state, t, i18nModule.getLanguage());
}

// Analytics delegation
function renderAnalytics() {
  analyticsModule.renderAnalytics(state, {
    t,
    getLanguage: () => i18nModule.getLanguage(),
  });
}

// Keybind Helpers (Scoped globally so all handlers can access them)
function areAcceleratorsEqual(a, b) {
  if (!a || !b) return false;
  const norm = (s) => String(s).toLowerCase()
    .replace(/commandorcontrol|ctrl|control/g, 'ctrl')
    .replace(/return/g, 'enter')
    .split('+')
    .map(x => x.trim())
    .sort()
    .join('+');
  return norm(a) === norm(b);
}

function formatAcceleratorForDisplay(acc) {
  if (!acc) return '';
  return String(acc)
    .replace(/\bCommandOrControl\b/gi, 'Ctrl')
    .replace(/\bReturn\b/gi, 'Enter')
    .replace(/\bmouse4\b/gi, 'Mouse 4')
    .replace(/\bmouse5\b/gi, 'Mouse 5')
    .replace(/\bnum(\d)\b/gi, 'Num $1')
    .replace(/\bnumadd\b/gi, 'Num +')
    .replace(/\bnumsub\b/gi, 'Num -')
    .replace(/\bnummult\b/gi, 'Num *')
    .replace(/\bnumdiv\b/gi, 'Num /')
    .replace(/\bnumdec\b/gi, 'Num .');
}

function getMouseAccelerator(e) {
  if (!e || (e.button !== 3 && e.button !== 4)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.button === 3 ? 'Mouse4' : 'Mouse5');
  return parts.join('+');
}

let currentRecordingKeybindTarget = null;
let recordedAccelerator = '';

function openKeybindModal(targetId, targetTitle) {
  currentRecordingKeybindTarget = targetId;
  recordedAccelerator = state.keybinds?.[targetId] || '';
  const modal = $('#keybind-modal');
  const titleEl = $('#keybind-target-title');
  const displayBox = $('#keybind-display-box');
  const errorMsg = $('#keybind-error-msg');
  const saveBtn = $('#save-keybind-btn');

  if (titleEl) titleEl.textContent = targetTitle || targetId;
  if (errorMsg) {
    errorMsg.style.display = 'none';
    errorMsg.textContent = '';
  }
  if (displayBox) {
    displayBox.style.borderColor = 'var(--line)';
    displayBox.style.color = 'var(--green)';
    displayBox.textContent = formatAcceleratorForDisplay(recordedAccelerator) || 'Press key or mouse button...';
  }
  if (saveBtn) {
    saveBtn.disabled = !recordedAccelerator;
  }
  if (modal) {
    modal.style.display = 'grid';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeKeybindModal() {
  const modal = $('#keybind-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  const errorMsg = $('#keybind-error-msg');
  if (errorMsg) {
    errorMsg.style.display = 'none';
    errorMsg.textContent = '';
  }
  currentRecordingKeybindTarget = null;
  recordedAccelerator = '';
}

function openStreamDeckModal() {
  const modal = $('#streamdeck-modal');
  const listEl = $('#streamdeck-actions-list');
  if (!modal) return;

  modal.style.display = 'grid';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  if (listEl) {
    const sounds = state.sounds || {};
    const keybinds = state.keybinds || {};
    const entries = Object.entries(sounds).filter(([_, s]) => s && (s.path || s.name || s.available));
    if (!entries.length) {
      listEl.innerHTML = `<div class="empty" style="padding:20px 10px;">${t('soundpadEmpty')}</div>`;
    } else {
      listEl.innerHTML = entries.map(([id, soundObj]) => {
        const soundBaseName = (soundObj.path ? soundObj.path.split(/[\\/]/).pop() : '') || soundObj.name || id;
        const reward = (state.rewards || []).find((r) => r.id === id);
        const title = reward?.title || soundObj.title || soundBaseName;
        const triggerUrl = `http://localhost:9000/streamdeck/trigger/${encodeURIComponent(id)}`;
        const protoUri = `kick-soundboard://trigger/${encodeURIComponent(id)}`;
        const kb = keybinds[id] || '';

        return `
          <div class="streamdeck-row">
            <div class="streamdeck-row-info">
              <div class="streamdeck-row-title">${title}</div>
              <div class="streamdeck-row-sub">
                ${kb ? `<span style="color:var(--green); font-weight:700;">⌨️ ${kb}</span> · ` : ''}
                <span>${soundBaseName}</span>
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" class="primary small" data-copy-trigger="${triggerUrl}" title="Copy HTTP GET URL for Elgato Website action">${t('copyTriggerUrl')}</button>
              <button type="button" class="ghost small" data-copy-proto="${protoUri}" title="Copy custom URI for Elgato Open action">${t('copyProtocolUri')}</button>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('[data-copy-trigger]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(btn.dataset.copyTrigger).catch(() => {});
          }
          toast(t('triggerUrlCopied'));
        });
      });

      listEl.querySelectorAll('[data-copy-proto]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(btn.dataset.copyProto).catch(() => {});
          }
          toast(t('protocolUriCopied'));
        });
      });
    }
  }
}

function closeStreamDeckModal() {
  const modal = $('#streamdeck-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

// Standalone Sound Pad Rename Title Modal
function openRenameModal(soundId, currentTitle) {
  const modal = $('#rename-soundpad-modal');
  const input = $('#rename-soundpad-input');
  const idInput = $('#rename-soundpad-id');
  if (!modal || !input) return;
  if (idInput) idInput.value = soundId;
  input.value = currentTitle || '';
  modal.classList.add('open');
  modal.style.display = 'grid';
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

function closeRenameModal() {
  const modal = $('#rename-soundpad-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

// OBS Stream Overlay Modal
function getOverlayUrl(channelPointsOnly) {
  const base = 'http://localhost:9000/overlay';
  return channelPointsOnly ? `${base}?channelPointsOnly=1` : base;
}

async function openObsOverlayModal() {
  const modal = $('#obs-overlay-modal');
  const toggle = $('#obs-channel-points-only-toggle');
  const urlInput = $('#obs-overlay-url-input');
  if (!modal) return;

  try {
    let isChannelOnly = false;
    if (window.kickApp?.getOverlayConfig) {
      const cfg = await window.kickApp.getOverlayConfig();
      isChannelOnly = Boolean(cfg?.channelPointsOnly);
    } else {
      const res = await request('/api/overlay/config').catch(() => ({}));
      isChannelOnly = Boolean(res?.channelPointsOnly);
    }
    if (toggle) toggle.checked = isChannelOnly;
    if (urlInput) urlInput.value = getOverlayUrl(isChannelOnly);
  } catch {}

  modal.classList.add('open');
  modal.style.display = 'grid';
  modal.setAttribute('aria-hidden', 'false');
}

function closeObsOverlayModal() {
  const modal = $('#obs-overlay-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

// Navigation & Tab Switching
function switchTab(tabId) {
  navModule.switchTab(tabId, state, {
    onTabSwitched: (newTab) => {
      if (newTab === 'analytics') renderAnalytics();
      else if (newTab === 'soundpad') renderSoundPad();
      else if (newTab === 'goal') renderGoal();
      else if (newTab === 'studio') { renderRewards(); renderHistory(); }
    },
  });
}

// Settings Dialog delegation
function openSettings() {
  const modalConnectBtn = $('#modal-connect-btn');
  if (modalConnectBtn) {
    modalConnectBtn.hidden = Boolean(state.connected);
    modalConnectBtn.style.setProperty('display', state.connected ? 'none' : 'inline-flex', 'important');
  }
  const disconnectBtn = $('#disconnect-btn');
  if (disconnectBtn) {
    disconnectBtn.hidden = !state.connected;
    disconnectBtn.style.setProperty('display', state.connected ? 'inline-flex' : 'none', 'important');
  }

  settingsModule.openSettings('settings-modal', {
    onLoadAudioDevices: () => loadAudioDevices(),
  });
  settingsModule.updateProxyUI?.(state);
}

function closeSettings() {
  settingsModule.closeSettings('settings-modal');
}

async function loadAudioDevices() {
  await settingsModule.loadAudioDevices('audio-output', state, { t });
}

// Reward & State API actions
async function chooseSound(target) {
  try {
    const selectedPath = await window.kickApp?.chooseAudio();
    if (!selectedPath) return;

    const baseName = selectedPath.split(/[\\/]/).pop();
    const soundId = (typeof target === 'object' && target?.id)
      ? target.id
      : (typeof target === 'string' && target ? target : `pad_${Date.now()}`);
    const soundTitle = (typeof target === 'object' && target?.title) ? target.title : baseName;

    state.sounds ||= {};
    state.sounds[soundId] = {
      path: selectedPath,
      name: baseName,
      available: true,
      title: soundTitle,
    };

    await request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        rewardId: soundId,
        soundPath: selectedPath,
        title: soundTitle,
        sounds: state.sounds,
      }),
    });

    toast(t('soundAssigned', { name: baseName }));
    renderRewards();
    renderSoundPad();
    updateReadiness();
  } catch (error) {
    toast(error.message, true);
  }
}

async function clearSound(rewardId) {
  try {
    if (state.sounds?.[rewardId]) {
      delete state.sounds[rewardId];
      await request('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          rewardId,
          clearSound: true,
          sounds: state.sounds,
        }),
      });
      renderRewards();
      renderSoundPad();
      updateReadiness();
    }
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveRewardSettings(rewardId, fields) {
  try {
    if (fields.volume !== undefined) {
      state.rewardVolumes ||= {};
      state.rewardVolumes[rewardId] = fields.volume;
    }
    if (fields.cooldown !== undefined) {
      state.rewardCooldowns ||= {};
      state.rewardCooldowns[rewardId] = fields.cooldown;
    }
    await request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        rewardId,
        cooldown: fields.cooldown,
        rewardVolume: fields.volume,
        rewardVolumes: state.rewardVolumes,
        rewardCooldowns: state.rewardCooldowns,
      }),
    });
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadRewards() {
  try {
    const r = await request('/api/rewards');
    if (Array.isArray(r?.data)) {
      state.rewards = r.data;
    } else if (Array.isArray(r)) {
      state.rewards = r;
    }
  } catch (err) {
    try {
      const data = await request('/api/state');
      if (Array.isArray(data.rewards)) state.rewards = data.rewards;
    } catch (_) {}
  }
  renderRewards();
  renderSoundPad();
  updateReadiness();
}

async function connectKick() {
  try {
    const result = await request('/api/connect', { method: 'POST', body: '{}' });
    if (result.ok) {
      toast(t('openedKick'));
      try {
        const r = await request('/api/rewards');
        if (Array.isArray(r?.data)) {
          state.rewards = r.data;
          renderRewards();
          renderSoundPad();
          updateReadiness();
        }
      } catch (_) {}
    }
  } catch (error) {
    toast(error.message, true);
    if (error.message.includes('Client ID')) openSettings();
  }
}

async function refreshState() {
  try {
    const data = await request('/api/state');
    state.connected = Boolean(data.connected);
    state.streamerMode = Boolean(data.streamerMode);
    state.volume = Number.isFinite(data.volume) ? data.volume : 0.8;
    state.playPending = Boolean(data.playPending);
    state.audioDeviceId = data.outputDeviceId || data.audioDeviceId || '';
    state.proxyMode = data.proxyMode || 'direct';
    state.proxyRules = data.proxyRules || '';
    state.systemProxy = data.systemProxy || '';
    state.sounds = data.sounds || {};
    state.rewardVolumes = data.rewardVolumes || {};
    state.rewardCooldowns = data.rewardCooldowns || {};
    state.history = data.history || [];
    state.rewards = data.rewards || state.rewards || [];

    if (state.connected) {
      try {
        const r = await request('/api/rewards');
        if (Array.isArray(r?.data)) {
          state.rewards = r.data;
        } else if (Array.isArray(r)) {
          state.rewards = r;
        }
      } catch (_) {}
    }

    state.pollStatus = {
      lastChecked: data.lastPollSuccessAt || data.lastChecked || null,
      nextCheck: data.nextPollAt || data.nextCheck || null,
      consecutiveFailures: data.consecutiveFailures || 0,
      polling: Boolean(data.polling),
    };

    // Update UI elements
    setConnected(state.connected);

    // Streamer badge
    const streamer = data.streamer || data.streamerProfile;
    const streamerName = streamer?.username || streamer?.name || streamer?.slug;
    const chipText = $('#streamer-chip-text');
    if (chipText) {
      chipText.textContent = streamerName ? `@${streamerName}` : (data.channelName || 'Kick Local');
    }

    // Volume input
    const volInput = $('#volume');
    const volLabel = $('#volume-label');
    if (volInput) {
      volInput.value = Math.round(state.volume * 100);
      volInput.style.setProperty('--pct', `${volInput.value}%`);
    }
    if (volLabel) volLabel.textContent = `${Math.round(state.volume * 100)}%`;

    // Stream mode
    document.body.classList.toggle('stream-mode', Boolean(state.streamerMode));
    $('#stream-mode-btn')?.setAttribute('aria-pressed', String(Boolean(state.streamerMode)));
    $('#stream-mode-btn')?.classList.toggle('primary', Boolean(state.streamerMode));

    // Render active views
    renderPollHealth();
    renderRewards();
    renderHistory();
    renderSoundPad();
    if (state.currentTab === 'analytics') renderAnalytics();
    if (state.currentTab === 'goal') renderGoal();
    updateReadiness();
    queueModule.updateQueueUI(state, t);

    // Settings modal fields
    const accountStatusText = $('#account-status-text');
    if (accountStatusText) {
      accountStatusText.textContent = state.connected
        ? (streamerName ? `Connected as @${streamerName}` : 'Connected')
        : 'Not connected';
    }
    const disconnectBtn = $('#disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.hidden = !state.connected;
      disconnectBtn.style.setProperty('display', state.connected ? 'inline-flex' : 'none', 'important');
    }
    const modalConnectBtn = $('#modal-connect-btn');
    if (modalConnectBtn) {
      modalConnectBtn.hidden = Boolean(state.connected);
      modalConnectBtn.style.setProperty('display', state.connected ? 'none' : 'inline-flex', 'important');
    }

    const playPendingToggle = $('#play-pending-toggle');
    if (playPendingToggle) playPendingToggle.checked = Boolean(state.playPending);
  } catch (error) {
    toast(error.message, true);
  }
}

function setConnected(connected) {
  state.connected = Boolean(connected);
  const dot = $('#status-dot');
  const label = $('#status-label');
  const banner = $('#setup-banner');
  const bannerConnect = $('#banner-connect');
  const connectBtn = $('#connect-btn');
  const modalConnectBtn = $('#modal-connect-btn');
  const disconnectBtn = $('#disconnect-btn');

  if (dot) dot.classList.toggle('live', state.connected);
  if (label) {
    label.textContent = state.connected ? 'Connected' : 'Not connected';
    label.classList.toggle('connected', state.connected);
  }
  if (banner) {
    banner.classList.toggle('show', !state.connected);
    banner.hidden = Boolean(state.connected);
    banner.style.setProperty('display', state.connected ? 'none' : 'block', 'important');
  }
  if (bannerConnect) bannerConnect.hidden = Boolean(state.connected);
  if (connectBtn) {
    connectBtn.hidden = Boolean(state.connected);
    connectBtn.style.setProperty('display', state.connected ? 'none' : 'inline-flex', 'important');
  }
  if (modalConnectBtn) {
    modalConnectBtn.hidden = Boolean(state.connected);
    modalConnectBtn.style.setProperty('display', state.connected ? 'none' : 'inline-flex', 'important');
  }
  if (disconnectBtn) {
    disconnectBtn.hidden = !state.connected;
    disconnectBtn.style.setProperty('display', state.connected ? 'inline-flex' : 'none', 'important');
  }
}

// Initialize UI Event Listeners
function initEventListeners() {
  // Navigation tabs (dock sidebar rail)
  document.querySelectorAll('.dock-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Master volume control
  $('#volume')?.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    e.target.style.setProperty('--pct', `${val}%`);
    $('#volume-label').textContent = `${val}%`;
    state.volume = val / 100;

    // Real-time update volume of any active audio (queue playback, preview, or sound pad)
    queueModule.updateActiveAudioVolume?.(state);
    soundpadModule.updateActiveAudioVolume?.(state);
    const activeAudio = queueModule.getActiveAudio?.();
    const currentItem = queueModule.getCurrentItem?.();
    if (activeAudio && currentItem) {
      activeAudio.volume = effectiveVolume(currentItem.rewardId);
    }
    const prevAudio = queueModule.getActivePreviewAudio?.();
    const prevId = queueModule.getCurrentPlayingPreviewRewardId?.();
    if (prevAudio && prevId) {
      prevAudio.volume = effectiveVolume(prevId);
    }
    const padAudio = soundpadModule.getActivePadAudio?.();
    const padId = soundpadModule.getCurrentPlayingPadRewardId?.();
    if (padAudio && padId) {
      const rewardVol = Number.isFinite(state.rewardVolumes?.[padId]) ? state.rewardVolumes[padId] : 1.0;
      padAudio.volume = Math.max(0, Math.min(1, state.volume * rewardVol));
    }
  });

  $('#volume')?.addEventListener('change', async () => {
    try {
      await request('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ volume: Number($('#volume').value) / 100 }),
      });
    } catch (error) {
      toast(error.message, true);
    }
  });

  // Stream mode button
  $('#stream-mode-btn')?.addEventListener('click', () => {
    navModule.toggleStreamMode(state, async (mode) => {
      try {
        await request('/api/settings', { method: 'POST', body: JSON.stringify({ streamerMode: mode }) });
      } catch (error) {
        toast(error.message, true);
      }
    });
  });

  // Language toggle
  $('#lang-toggle')?.addEventListener('click', () => {
    const newLang = i18nModule.getLanguage() === 'fa' ? 'en' : 'fa';
    applyLanguage(newLang);
    renderRewards();
    renderHistory();
    renderSoundPad();
    if (state.currentTab === 'analytics') renderAnalytics();
    if (state.currentTab === 'goal') renderGoal();
    renderPollHealth();
    updateReadiness();
  });

  // Settings Modal triggers
  $('#settings-btn')?.addEventListener('click', openSettings);
  $('#setup-settings')?.addEventListener('click', openSettings);
  $('#close-settings')?.addEventListener('click', closeSettings);
  $('#cancel-settings')?.addEventListener('click', closeSettings);

  // Connect Kick buttons
  $('#connect-btn')?.addEventListener('click', connectKick);
  $('#banner-connect')?.addEventListener('click', connectKick);
  $('#modal-connect-btn')?.addEventListener('click', connectKick);

  // Disconnect Kick
  $('#disconnect-btn')?.addEventListener('click', async () => {
    if (!confirm(t('confirmDisconnect'))) return;
    try {
      await request('/api/disconnect', { method: 'POST', body: '{}' });
      setConnected(false);
      state.rewards = [];
      renderRewards();
      renderSoundPad();
      toast(t('disconnected'));
      closeSettings();
    } catch (error) {
      toast(error.message, true);
    }
  });

  // Settings Form submit
  $('#settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const proxyMode = $('#proxy-mode-select')?.value || 'direct';
      const proxyRules = $('#proxy-rules-input')?.value || '';
      await request('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          playPending: $('#play-pending-toggle')?.checked ?? false,
          outputDeviceId: $('#audio-output')?.value || '',
          audioDeviceId: $('#audio-output')?.value || '',
          proxyMode,
          proxyRules,
        }),
      });
      state.playPending = $('#play-pending-toggle')?.checked ?? false;
      state.audioDeviceId = $('#audio-output')?.value || '';
      state.proxyMode = proxyMode;
      state.proxyRules = proxyRules;
      toast(t('settingsSaved'));
      closeSettings();
    } catch (error) {
      toast(error.message, true);
    }
  });

  // Proxy mode select toggle
  $('#proxy-mode-select')?.addEventListener('change', (e) => {
    const customContainer = $('#proxy-custom-container');
    if (customContainer) {
      customContainer.style.display = e.target.value === 'custom' ? 'block' : 'none';
    }
    const statusPill = $('#proxy-status-message');
    if (statusPill) { statusPill.style.display = 'none'; statusPill.textContent = ''; }
  });

  // Detect system proxy
  $('#detect-proxy-btn')?.addEventListener('click', async () => {
    const statusPill = $('#proxy-status-message');
    const rulesInput = $('#proxy-rules-input');
    try {
      const res = await request('/api/proxy/system');
      if (res?.data?.proxyServer) {
        if (rulesInput) rulesInput.value = res.data.proxyServer;
        if (statusPill) {
          statusPill.style.display = 'inline-flex';
          statusPill.className = 'proxy-status-pill success';
          statusPill.textContent = t('proxyDetected', { proxy: res.data.proxyServer });
        }
      } else {
        if (statusPill) {
          statusPill.style.display = 'inline-flex';
          statusPill.className = 'proxy-status-pill error';
          statusPill.textContent = t('noSystemProxyDetected');
        }
      }
    } catch (err) {
      if (statusPill) {
        statusPill.style.display = 'inline-flex';
        statusPill.className = 'proxy-status-pill error';
        statusPill.textContent = err.message;
      }
    }
  });

  // Test proxy connection
  $('#test-proxy-btn')?.addEventListener('click', async () => {
    const statusPill = $('#proxy-status-message');
    const proxyMode = $('#proxy-mode-select')?.value || 'direct';
    const proxyRules = $('#proxy-rules-input')?.value || '';

    if (statusPill) {
      statusPill.style.display = 'inline-flex';
      statusPill.className = 'proxy-status-pill testing';
      statusPill.textContent = t('proxyTesting');
    }

    try {
      const res = await request('/api/proxy/test', {
        method: 'POST',
        body: JSON.stringify({ proxyMode, proxyRules }),
      });
      if (res.ok) {
        if (statusPill) {
          statusPill.className = 'proxy-status-pill success';
          statusPill.textContent = proxyMode === 'direct'
            ? t('proxyDirectSuccess', { latency: res.latencyMs })
            : t('proxySuccess', { latency: res.latencyMs });
        }
      } else {
        if (statusPill) {
          statusPill.className = 'proxy-status-pill error';
          statusPill.textContent = res.error || 'Connection failed';
        }
      }
    } catch (err) {
      if (statusPill) {
        statusPill.className = 'proxy-status-pill error';
        statusPill.textContent = err.message;
      }
    }
  });

  // Audio output device refresh
  $('#refresh-audio-devices')?.addEventListener('click', () => loadAudioDevices());

  // Updates checker
  $('#check-updates')?.addEventListener('click', async () => {
    const statusEl = $('#update-status');
    const downloadBtn = $('#download-update');
    if (statusEl) statusEl.textContent = 'Checking...';
    try {
      const data = await request('/api/updates');
      if (Boolean(data.updateAvailable || data.hasUpdate)) {
        if (statusEl) statusEl.textContent = t('updateAvailable', { version: data.latestVersion });
        if (downloadBtn) {
          downloadBtn.hidden = false;
          downloadBtn.removeAttribute('hidden');
          downloadBtn.onclick = () => window.kickApp?.openReleases();
        }
      } else {
        if (statusEl) statusEl.textContent = t('upToDate', { version: data.currentVersion });
        if (downloadBtn) {
          downloadBtn.hidden = true;
          downloadBtn.setAttribute('hidden', '');
        }
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = t('updateCheckFailed', { message: error.message });
    }
  });

  // Diagnostic Logs UI (Settings modal)
  $('#open-logs-folder')?.addEventListener('click', () => {
    if (loggerModule) loggerModule.openLogsFolder();
  });

  $('#view-recent-logs')?.addEventListener('click', async () => {
    const out = $('#recent-logs-output');
    if (!out) return;
    if (out.style.display === 'block') {
      out.style.display = 'none';
      return;
    }
    out.style.display = 'block';
    out.textContent = 'Loading logs...';
    if (loggerModule) {
      const logs = await loggerModule.getRecentLogs();
      out.textContent = logs || 'No error logs recorded yet. Everything running smoothly!';
    }
  });

  // Filter Pills (Studio)
  document.querySelectorAll('.filter-pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.rewardFilterPill = btn.dataset.filter || 'all';
      renderRewards();
    });
  });

  // Search rewards
  $('#reward-search')?.addEventListener('input', (e) => {
    state.rewardSearch = e.target.value;
    renderRewards();
  });

  // Unassigned only checkbox
  $('#unassigned-only')?.addEventListener('change', (e) => {
    state.unassignedOnly = e.target.checked;
    renderRewards();
  });

  // Refresh rewards button
  $('#refresh-btn')?.addEventListener('click', () => loadRewards());

  // Queue Controls
  $('#stop-btn')?.addEventListener('click', () => stopQueue());
  $('#resume-queue')?.addEventListener('click', () => resumeQueue());
  $('#skip-btn')?.addEventListener('click', () => skipCurrent());
  $('#clear-queue')?.addEventListener('click', () => clearQueue());

  // History Filter & Search
  $('#history-search')?.addEventListener('input', (e) => {
    state.historySearch = e.target.value;
    state.historyPage = 1;
    renderHistory();
  });

  $('#history-filter')?.addEventListener('change', (e) => {
    state.historyFilter = e.target.value;
    state.historyPage = 1;
    renderHistory();
  });

  $('#clear-history')?.addEventListener('click', async () => {
    if (!confirm(t('clearHistoryConfirm'))) return;
    try {
      await request('/api/history/clear', { method: 'POST', body: '{}' });
      state.history = [];
      renderHistory();
      if (state.currentTab === 'analytics') renderAnalytics();
      toast(t('historyCleared'));
    } catch (error) {
      toast(error.message, true);
    }
  });

  $('#history-prev')?.addEventListener('click', () => {
    if (state.historyPage > 1) {
      state.historyPage--;
      renderHistory();
    }
  });

  $('#history-next')?.addEventListener('click', () => {
    state.historyPage++;
    renderHistory();
  });

  // Sound Pad Panic Stop & Search
  $('#soundpad-stop-all')?.addEventListener('click', () => panicStopAll());

  // Pop out Floating Sound Pad Window
  $('#popout-soundpad-btn')?.addEventListener('click', async () => {
    try {
      if (window.kickApp?.openSoundpadWindow) {
        await window.kickApp.openSoundpadWindow();
      } else {
        const token = (await window.kickApp?.getApiSessionToken?.()) || window.sessionToken || '';
        const url = `http://localhost:9000/soundpad.html${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        window.open(url, 'KickSoundPad', 'width=760,height=600,menubar=no,toolbar=no');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Stream Deck Sync & Integration Modal
  $('#open-streamdeck-sync')?.addEventListener('click', openStreamDeckModal);
  $('#close-streamdeck-btn')?.addEventListener('click', closeStreamDeckModal);
  $('#close-streamdeck-bottom-btn')?.addEventListener('click', closeStreamDeckModal);

  $('#copy-panic-url')?.addEventListener('click', async () => {
    const url = 'http://localhost:9000/streamdeck/stop-all';
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
    toast(t('panicStopUrlCopied'));
  });

  $('#copy-panic-uri')?.addEventListener('click', async () => {
    const uri = 'kick-soundboard://stop-all';
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(uri).catch(() => {});
    }
    toast(t('protocolUriCopied'));
  });

  function handleRecordedKeybind(acc) {
    const displayBox = $('#keybind-display-box');
    const errorMsg = $('#keybind-error-msg');
    const saveBtn = $('#save-keybind-btn');

    if (!acc) return;

    // 1. Escape is reserved for Panic Stop & Dialog Cancel - strictly reject!
    if (/^escape$/i.test(acc) || /^esc$/i.test(acc)) {
      recordedAccelerator = '';
      if (errorMsg) {
        errorMsg.textContent = `❌ ${t('keybindEscapeReserved')}`;
        errorMsg.style.display = 'block';
      }
      if (displayBox) {
        displayBox.textContent = 'Escape (Reserved)';
        displayBox.style.borderColor = '#ff5c64';
        displayBox.style.color = '#ff858a';
      }
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    // 2. Reject lone modifier keys
    if (/^(commandorcontrol|ctrl|control|alt|shift|meta)(\+(commandorcontrol|ctrl|control|alt|shift|meta))*$/i.test(acc)) {
      recordedAccelerator = '';
      if (errorMsg) {
        errorMsg.textContent = `⚠️ ${t('keybindInvalidKey')}`;
        errorMsg.style.display = 'block';
      }
      if (displayBox) {
        displayBox.textContent = formatAcceleratorForDisplay(acc) + ' + ...';
        displayBox.style.borderColor = '#e3b341';
        displayBox.style.color = '#e3b341';
      }
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    // 3. Conflict Detection with other Sound Pad tiles
    let conflictName = null;
    if (state.keybinds) {
      for (const [otherId, otherAcc] of Object.entries(state.keybinds)) {
        if (otherId !== currentRecordingKeybindTarget && otherAcc && areAcceleratorsEqual(otherAcc, acc)) {
          const otherSound = state.sounds?.[otherId] || (state.rewards || []).find((r) => r.id === otherId);
          conflictName = otherSound?.title || otherSound?.name || otherId;
          break;
        }
      }
    }

    recordedAccelerator = acc;

    if (conflictName) {
      if (errorMsg) {
        errorMsg.textContent = `⚠️ ${t('keybindConflictWarning', { name: conflictName })}`;
        errorMsg.style.display = 'block';
      }
      if (displayBox) {
        displayBox.textContent = formatAcceleratorForDisplay(acc);
        displayBox.style.borderColor = '#e3b341';
        displayBox.style.color = '#e3b341';
      }
    } else {
      if (errorMsg) {
        errorMsg.style.display = 'none';
        errorMsg.textContent = '';
      }
      if (displayBox) {
        displayBox.textContent = formatAcceleratorForDisplay(acc);
        displayBox.style.borderColor = 'var(--green)';
        displayBox.style.color = 'var(--green)';
      }
    }

    if (saveBtn) saveBtn.disabled = false;
  }

  // Intercept auxclick to prevent Electron window backwards/forwards navigation on Mouse4/Mouse5
  window.addEventListener('auxclick', (e) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
    }
  });

  // Mouse 4 & Mouse 5 Listener (in-window sound triggers & recording)
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();

    const mouseAcc = getMouseAccelerator(e);
    if (!mouseAcc) return;

    // If Keybind Modal is open, record Mouse 4 / Mouse 5
    const modal = $('#keybind-modal');
    if (modal?.classList.contains('open') && currentRecordingKeybindTarget) {
      handleRecordedKeybind(mouseAcc);
      return;
    }

    // If another modal is open, ignore
    if ($('#settings-modal')?.classList.contains('open')) return;
    if ($('#streamdeck-modal')?.classList.contains('open')) return;

    // Trigger matching SoundPad pad
    for (const [soundId, acc] of Object.entries(state.keybinds || {})) {
      if (acc && areAcceleratorsEqual(acc, mouseAcc)) {
        triggerPadSound(soundId);
        break;
      }
    }
  });

  function eventToAccelerator(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let keyName = '';
    const code = e.code || '';

    if (e.key === 'BrowserBack') {
      keyName = 'Mouse4';
    } else if (e.key === 'BrowserForward') {
      keyName = 'Mouse5';
    } else if (/^F\d{1,2}$/i.test(code) || /^F\d{1,2}$/i.test(e.key)) {
      keyName = (code || e.key).toUpperCase();
    } else if (code.startsWith('Numpad')) {
      const numPart = code.replace('Numpad', '').toLowerCase();
      const map = {
        add: 'numadd',
        subtract: 'numsub',
        multiply: 'nummult',
        divide: 'numdiv',
        decimal: 'numdec',
        enter: 'Return'
      };
      keyName = map[numPart] || (/^\d$/.test(numPart) ? `num${numPart}` : numPart);
    } else if (code.startsWith('Digit')) {
      keyName = code.replace('Digit', '');
    } else if (code.startsWith('Key')) {
      keyName = code.replace('Key', '').toUpperCase();
    } else if (code === 'Space' || e.key === ' ') {
      keyName = 'Space';
    } else if (code === 'Enter' || e.key === 'Enter') {
      keyName = 'Return';
    } else if (e.key && e.key.length === 1) {
      keyName = e.key.toUpperCase();
    } else {
      keyName = e.key || code;
    }

    if (!keyName) return '';
    parts.push(keyName);
    return parts.join('+');
  }

  // In-Window Direct Keydown Listener for Instant Soundpad Triggers
  window.addEventListener('keydown', (e) => {
    // Ignore if modal is open or if user is typing in an input / textarea / editable
    if ($('#keybind-modal')?.classList.contains('open')) return;
    if ($('#settings-modal')?.classList.contains('open')) return;
    if ($('#streamdeck-modal')?.classList.contains('open')) return;

    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) {
      return;
    }

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const pressedAcc = eventToAccelerator(e);
    if (!pressedAcc) return;

    for (const [soundId, acc] of Object.entries(state.keybinds || {})) {
      if (acc && areAcceleratorsEqual(acc, pressedAcc)) {
        e.preventDefault();
        triggerPadSound(soundId);
        break;
      }
    }
  });

  // Keybind Recording Modal Listener
  window.addEventListener('keydown', (e) => {
    const modal = $('#keybind-modal');
    if (!modal || !modal.classList.contains('open') || !currentRecordingKeybindTarget) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      handleRecordedKeybind('Escape');
      return;
    }

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      const parts = [];
      if (e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      handleRecordedKeybind(parts.join('+'));
      return;
    }

    e.preventDefault();
    const acc = eventToAccelerator(e);
    if (!acc) return;

    handleRecordedKeybind(acc);
  });

  $('#save-keybind-btn')?.addEventListener('click', async () => {
    if (!currentRecordingKeybindTarget || !recordedAccelerator) return;
    const targetId = currentRecordingKeybindTarget;
    const accelerator = recordedAccelerator;
    state.keybinds = state.keybinds || {};

    // Conflict Detection: check if this hotkey is already assigned to another sound
    const conflictingIds = [];
    for (const [otherId, existingAcc] of Object.entries(state.keybinds)) {
      if (otherId !== targetId && existingAcc && areAcceleratorsEqual(existingAcc, accelerator)) {
        conflictingIds.push(otherId);
        delete state.keybinds[otherId];
      }
    }

    state.keybinds[targetId] = accelerator;

    // Send payload to backend with new keybind and clearing conflicts
    const payload = { [targetId]: accelerator };
    for (const cid of conflictingIds) {
      payload[cid] = null;
    }

    if (window.kickApp?.saveKeybind) {
      await window.kickApp.saveKeybind(targetId, accelerator).catch(() => {});
      for (const cid of conflictingIds) {
        await window.kickApp.saveKeybind(cid, null).catch(() => {});
      }
    }
    await request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ keybinds: payload }),
    }).catch(() => {});

    closeKeybindModal();
    renderSoundPad();

    if (conflictingIds.length > 0) {
      toast(t('keybindReassigned', { key: formatAcceleratorForDisplay(accelerator) }));
    } else {
      toast(t('keybindSaved', { key: formatAcceleratorForDisplay(accelerator) }));
    }
  });

  $('#clear-keybind-btn')?.addEventListener('click', async () => {
    if (!currentRecordingKeybindTarget) return;
    const targetId = currentRecordingKeybindTarget;
    if (state.keybinds) delete state.keybinds[targetId];

    if (window.kickApp?.saveKeybind) {
      await window.kickApp.saveKeybind(targetId, null).catch(() => {});
    }
    await request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ keybinds: { [targetId]: null } }),
    }).catch(() => {});

    closeKeybindModal();
    renderSoundPad();
    toast(t('keybindCleared'));
  });

  $('#close-keybind-btn')?.addEventListener('click', closeKeybindModal);
  $('#cancel-keybind-btn')?.addEventListener('click', closeKeybindModal);

  // Standalone Web Sound Pad Launcher
  $('#open-web-soundpad')?.addEventListener('click', async () => {
    try {
      const token = (await window.kickApp?.getApiSessionToken?.()) || window.sessionToken || '';
      const url = `http://localhost:9000/soundpad.html${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      if (window.kickApp?.openUrl) {
        await window.kickApp.openUrl(url);
      } else {
        window.open(url, '_blank');
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url).catch(() => {});
      }
      toast(t('webPadCopied'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#soundpad-search')?.addEventListener('input', (e) => {
    state.soundpadSearch = e.target.value;
    renderSoundPad();
  });

  // Standalone Sound Pad Rename Title Modal Event Listeners
  $('#close-rename-btn')?.addEventListener('click', closeRenameModal);
  $('#cancel-rename-btn')?.addEventListener('click', closeRenameModal);

  $('#rename-soundpad-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#save-rename-btn')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeRenameModal();
    }
  });

  $('#save-rename-btn')?.addEventListener('click', async () => {
    const idInput = $('#rename-soundpad-id');
    const input = $('#rename-soundpad-input');
    if (!idInput || !input) return;
    const soundId = idInput.value;
    const newTitle = input.value.trim();
    if (!soundId || !newTitle) return;

    // Only update in-app soundpad display title; NEVER rename or mutate original audio file on disk!
    if (state.sounds?.[soundId]) {
      state.sounds[soundId].title = newTitle;
    }
    await request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ rewardId: soundId, title: newTitle }),
    }).catch(() => {});

    closeRenameModal();
    renderSoundPad();
    toast(t('titleSaved'));
  });

  // OBS Stream Overlay Modal Event Listeners
  $('#open-obs-overlay')?.addEventListener('click', openObsOverlayModal);
  $('#close-obs-overlay-btn')?.addEventListener('click', closeObsOverlayModal);
  $('#close-obs-overlay-bottom-btn')?.addEventListener('click', closeObsOverlayModal);

  $('#obs-channel-points-only-toggle')?.addEventListener('change', async (e) => {
    const checked = e.target.checked;
    const urlInput = $('#obs-overlay-url-input');
    if (urlInput) urlInput.value = getOverlayUrl(checked);

    if (window.kickApp?.saveOverlayConfig) {
      await window.kickApp.saveOverlayConfig({ channelPointsOnly: checked }).catch(() => {});
    }
    await request('/api/overlay/config', {
      method: 'POST',
      body: JSON.stringify({ channelPointsOnly: checked }),
    }).catch(() => {});
  });

  $('#copy-obs-url-btn')?.addEventListener('click', async () => {
    const urlInput = $('#obs-overlay-url-input');
    if (!urlInput) return;
    const url = urlInput.value;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
    toast(t('obsUrlCopied'));
  });

  $('#test-obs-channel-point-btn')?.addEventListener('click', async () => {
    try {
      await request('/api/overlay/test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'channel_point',
          title: 'Hydrate Streamer',
          userName: 'KickViewer_42',
          cost: 500,
        }),
      });
      toast('Test Channel Point alert sent to OBS overlay!');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#test-obs-soundpad-btn')?.addEventListener('click', async () => {
    try {
      await request('/api/overlay/test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'soundpad',
          title: 'Airhorn Blast',
          userName: 'Streamer',
        }),
      });
      toast('Test Sound Pad alert sent to OBS overlay!');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Analytics Timeframe Toggles
  $('#timeframe-7d')?.addEventListener('click', () => {
    $('#timeframe-7d')?.classList.add('active');
    $('#timeframe-24h')?.classList.remove('active');
    state.analyticsTimeframe = '7d';
    renderAnalytics();
  });

  $('#timeframe-24h')?.addEventListener('click', () => {
    $('#timeframe-24h')?.classList.add('active');
    $('#timeframe-7d')?.classList.remove('active');
    state.analyticsTimeframe = '24h';
    renderAnalytics();
  });

  // Global Keyboard Shortcuts
  navModule.initKeyboardShortcuts({
    onEscape: () => {
      const modal = $('#settings-modal');
      if (modal && modal.classList.contains('open')) {
        closeSettings();
      } else {
        panicStopAll();
      }
    },
    onSwitchTab: (tabId) => switchTab(tabId),
  });

  // Kick IPC Listeners
  window.kickApp?.onPlaySound(({ rewardId, redemptionId, masterVolume, rewardVolume, cooldownMs }) => {
    state.volume = masterVolume;
    state.rewardVolumes ||= {};
    state.rewardVolumes[rewardId] = rewardVolume;
    enqueueRedemptionSound({ rewardId, redemptionId, cooldownMs });
  });

  window.kickApp?.onStateChanged(() => refreshState().catch((err) => toast(err.message, true)));

  window.kickApp?.onPollError(({ message, retryInSeconds }) => toast(
    `${t('kickCheckFailed', { message })} ${t('pollRetry', { seconds: retryInSeconds })}`,
    true
  ));

  window.kickApp?.onTriggerSoundpad?.(({ id }) => {
    triggerPadSound(id);
  });

  window.kickApp?.onPanicStopAll?.(() => {
    panicStopAll();
  });

  window.kickApp?.onGoalUpdated?.((goal) => {
    state.goal = goal;
    if (state.currentTab === 'goal') renderGoal();
  });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => loadAudioDevices());
  }
}

// Bootstrap
if (!isNode && typeof window !== 'undefined' && typeof document !== 'undefined') {
  function bootstrap() {
    applyLanguage();
    initEventListeners();
    setConnected(false);
    renderUI();
    refreshState().catch((err) => toast(err.message, true));
    const timer = setInterval(() => {
      renderHistory();
      renderPollHealth();
      if (state.currentTab === 'analytics') renderAnalytics();
    }, 60_000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}

// Module export for unit tests & browser globals
if (isNode) {
  module.exports = {
    state,
    translations,
    t,
    applyLanguage,
    switchTab,
    request,
    toast,
    effectiveVolume,
    enqueueRedemptionSound,
    triggerPadSound,
    stopPreview,
    playPreview,
    getTimelineBuckets,
    renderTimelineChart,
    renderRewards,
    renderHistory,
    renderSoundPad,
    renderAnalytics,
    renderGoal,
    openSettings,
    closeSettings,
    openRenameModal,
    closeRenameModal,
    panicStopAll,
  };
} else if (typeof window !== 'undefined') {
  window.renderer = {
    state,
    translations,
    t,
    applyLanguage,
    switchTab,
    request,
    toast,
    effectiveVolume,
    enqueueRedemptionSound,
    triggerPadSound,
    stopPreview,
    playPreview,
    getTimelineBuckets,
    renderTimelineChart,
    renderRewards,
    renderHistory,
    renderSoundPad,
    renderAnalytics,
    renderGoal,
    openSettings,
    closeSettings,
    openRenameModal,
    closeRenameModal,
    panicStopAll,
  };
}

})();
