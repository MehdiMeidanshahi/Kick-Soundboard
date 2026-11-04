/**
 * Settings Modal Component
 * Handles dialog display, focus trapping/restoration, audio output device enumeration,
 * software updates, and diagnostic log inspection.
 */

let lastFocusedElement = null;

function openSettings(modalId, options = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  if (typeof options.onLoadAudioDevices === 'function') {
    options.onLoadAudioDevices();
  }

  // Update log path in settings modal
  const logPathDisplay = document.getElementById('log-path-display');
  if (logPathDisplay && window.clientLogger) {
    window.clientLogger.getLogPath().then((p) => {
      if (p) logPathDisplay.textContent = p;
    });
  }

  const closeBtn = document.getElementById('close-settings');
  if (closeBtn) closeBtn.focus();
}

function closeSettings(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

async function loadAudioDevices(selectId, state, options = {}) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const { t = (k) => k } = options;

  if (!navigator.mediaDevices?.enumerateDevices) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');

    select.innerHTML = `<option value="">${t('systemDefault')}</option>` +
      audioOutputs.map((d) => `
        <option value="${d.deviceId}" ${d.deviceId === state.audioDeviceId ? 'selected' : ''}>
          ${d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
        </option>
      `).join('');
  } catch (err) {
    if (window.clientLogger) {
      window.clientLogger.logError('Failed to enumerate audio devices', err);
    }
  }
}

function updateProxyUI(state) {
  const modeSelect = document.getElementById('proxy-mode-select');
  const rulesInput = document.getElementById('proxy-rules-input');
  const customContainer = document.getElementById('proxy-custom-container');
  const statusPill = document.getElementById('proxy-status-message');

  if (modeSelect) {
    modeSelect.value = state.proxyMode || 'direct';
  }
  if (rulesInput && typeof state.proxyRules === 'string') {
    rulesInput.value = state.proxyRules;
  }
  if (customContainer && modeSelect) {
    customContainer.style.display = modeSelect.value === 'custom' ? 'block' : 'none';
  }
  if (statusPill) {
    statusPill.style.display = 'none';
    statusPill.textContent = '';
    statusPill.className = 'proxy-status-pill';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { openSettings, closeSettings, loadAudioDevices, updateProxyUI };
} else {
  window.settingsComponent = { openSettings, closeSettings, loadAudioDevices, updateProxyUI };
}
