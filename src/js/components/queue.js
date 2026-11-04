/**
 * Queue & Audio Playback Engine Component
 * Handles FIFO audio playback, cooldown arbitration, device routing,
 * and safe sound previewing without unhandled AbortErrors.
 */

let activeAudio = null;
let activeObjectUrl = '';
let currentItem = null;
let queuePaused = false;
let activePreviewAudio = null;
let previewObjectUrl = '';
let currentPlayingPreviewRewardId = null;

async function loadAudioSource(rewardId) {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const token = (window.sessionToken || (await window.kickApp?.getApiSessionToken?.())) || '';
    const res = await window.fetch(`/api/audio/${encodeURIComponent(rewardId)}`, {
      headers: token ? { 'x-kick-app-session': token, 'X-App-Session': token } : {}
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Audio request failed (${res.status})`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
  return `/api/audio/${encodeURIComponent(rewardId)}`;
}

function getCurrentItem() {
  return currentItem;
}

function getActiveAudio() {
  return activeAudio;
}

function getActivePreviewAudio() {
  return activePreviewAudio;
}

function getCurrentPlayingPreviewRewardId() {
  return currentPlayingPreviewRewardId;
}

function updateActiveAudioVolume(state, rewardId = null) {
  if (activeAudio && currentItem) {
    if (!rewardId || String(currentItem.rewardId) === String(rewardId)) {
      activeAudio.volume = effectiveVolume(currentItem.rewardId, state);
    }
  }
  if (activePreviewAudio && currentPlayingPreviewRewardId) {
    if (!rewardId || String(currentPlayingPreviewRewardId) === String(rewardId)) {
      activePreviewAudio.volume = effectiveVolume(currentPlayingPreviewRewardId, state);
    }
  }
}

function effectiveVolume(rewardId, state) {
  const master = Number.isFinite(state?.volume) ? state.volume : 0.8;
  const rv = state?.rewardVolumes?.[rewardId] ?? state?.rewardVolumes?.[String(rewardId)];
  const rewardVol = Number.isFinite(rv) ? rv : 1.0;
  return Math.max(0, Math.min(1, master * rewardVol));
}

function enqueueRedemptionSound({ rewardId, redemptionId, cooldownMs }, state, onQueueChanged) {
  const now = Date.now();
  const cd = cooldownMs || 0;
  state.activeCooldowns = state.activeCooldowns || {};
  const lastPlayed = state.activeCooldowns[rewardId] || state.rewardCooldowns?.[rewardId] || 0;

  if (cd > 0 && now - lastPlayed < cd) {
    return false; // suppressed by cooldown
  }

  state.activeCooldowns[rewardId] = now;
  state.queue = state.queue || [];
  state.queue.push({ rewardId, redemptionId, enqueuedAt: now });

  if (typeof onQueueChanged === 'function') onQueueChanged();
  if (!currentItem && !queuePaused) {
    playNext(state, onQueueChanged);
  }
  return true;
}

function playNext(state, onQueueChanged) {
  if (queuePaused || !state.queue?.length) {
    currentItem = null;
    if (typeof onQueueChanged === 'function') onQueueChanged();
    return;
  }

  currentItem = state.queue.shift();
  if (typeof onQueueChanged === 'function') onQueueChanged();
  startQueuedAudio(currentItem, state, onQueueChanged);
}

function startQueuedAudio(item, state, onQueueChanged) {
  try {
    const audio = new Audio();
    audio.volume = effectiveVolume(item.rewardId, state);

    if (state.audioDeviceId && typeof audio.setSinkId === 'function') {
      audio.setSinkId(state.audioDeviceId).catch((err) => {
        if (window.clientLogger) window.clientLogger.logError('Queue audio setSinkId failed', err);
        audio.setSinkId('').catch(() => {});
      });
    }

    activeAudio = audio;
    window.currentQueueRewardId = item.rewardId;
    if (window.soundpadModule?.updateSoundPadUI) {
      window.soundpadModule.updateSoundPadUI();
    }

    const cleanup = () => {
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = '';
      }
      activeAudio = null;
      currentItem = null;
      window.currentQueueRewardId = null;
      if (window.soundpadModule?.updateSoundPadUI) {
        window.soundpadModule.updateSoundPadUI();
      }
      playNext(state, onQueueChanged);
    };

    audio.onended = cleanup;

    audio.onerror = () => {
      if (audio._stopped) return;
      if (window.clientLogger) {
        window.clientLogger.logError(`Queue Audio Error for reward ${item.rewardId}`, audio.error, { item });
      }
      cleanup();
    };

    if (typeof window === 'undefined') {
      audio.src = `/api/audio/${encodeURIComponent(item.rewardId)}`;
      audio.play().catch((err) => {
        if (err.name === 'AbortError' || audio._stopped) return;
        cleanup();
      });
      return;
    }

    (async () => {
      try {
        const src = await loadAudioSource(item.rewardId);
        if (activeAudio !== audio || audio._stopped) {
          if (src.startsWith('blob:')) URL.revokeObjectURL(src);
          return;
        }
        if (src.startsWith('blob:')) activeObjectUrl = src;
        audio.src = src;
        await audio.play();
      } catch (err) {
        if (err.name === 'AbortError' || audio._stopped) return;
        if (window.clientLogger) {
          window.clientLogger.logError(`Queue play() rejected for reward ${item.rewardId}`, err, { item });
        }
        cleanup();
      }
    })();
  } catch (error) {
    if (window.clientLogger) {
      window.clientLogger.logError(`startQueuedAudio exception for reward ${item.rewardId}`, error, { item });
    }
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = '';
    }
    activeAudio = null;
    currentItem = null;
    playNext(state, onQueueChanged);
  }
}

function stopQueue(state, onQueueChanged) {
  queuePaused = true;
  if (activeAudio) {
    try {
      activeAudio._stopped = true;
      activeAudio.pause();
      activeAudio.removeAttribute('src');
    } catch {}
    activeAudio = null;
  }

  const prependFn = (typeof window !== 'undefined' && (window.kickQueuePlayback?.prependInterruptedItem || window.stopCurrentPlayback))
    || (typeof globalThis !== 'undefined' && globalThis.kickQueuePlayback?.prependInterruptedItem);
  if (currentItem && typeof prependFn === 'function') {
    state.queue = prependFn(state.queue, currentItem);
  } else if (currentItem) {
    state.queue.unshift(currentItem);
  }
  currentItem = null;
  if (typeof onQueueChanged === 'function') onQueueChanged();
}

function resumeQueue(state, onQueueChanged) {
  queuePaused = false;
  if (typeof onQueueChanged === 'function') onQueueChanged();
  if (!currentItem && state.queue?.length) {
    playNext(state, onQueueChanged);
  }
}

function skipCurrent(state, onQueueChanged) {
  if (activeAudio) {
    try {
      activeAudio._stopped = true;
      activeAudio.pause();
      activeAudio.removeAttribute('src');
    } catch {}
    activeAudio = null;
  }
  currentItem = null;
  playNext(state, onQueueChanged);
}

function clearQueue(state, onQueueChanged) {
  state.queue = [];
  if (typeof onQueueChanged === 'function') onQueueChanged();
}

function stopPreview(onPreviewChanged) {
  if (activePreviewAudio) {
    try {
      activePreviewAudio._stopped = true;
      activePreviewAudio.pause();
      activePreviewAudio.removeAttribute('src');
    } catch {}
    activePreviewAudio = null;
  }
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
  }
  currentPlayingPreviewRewardId = null;
  window.currentPlayingPreviewRewardId = null;
  if (typeof onPreviewChanged === 'function') onPreviewChanged();
}

async function playPreview(rewardId, state, onPreviewChanged) {
  if (activePreviewAudio && currentPlayingPreviewRewardId === rewardId) {
    stopPreview(onPreviewChanged);
    return;
  }

  stopPreview(onPreviewChanged);

  try {
    const audio = new Audio();
    audio.volume = effectiveVolume(rewardId, state);

    if (state.audioDeviceId && typeof audio.setSinkId === 'function') {
      audio.setSinkId(state.audioDeviceId).catch(() => {
        audio.setSinkId('').catch(() => {});
      });
    }

    activePreviewAudio = audio;
    currentPlayingPreviewRewardId = rewardId;
    window.currentPlayingPreviewRewardId = rewardId;
    if (typeof onPreviewChanged === 'function') onPreviewChanged();

    audio.onended = () => {
      if (activePreviewAudio === audio) {
        stopPreview(onPreviewChanged);
      }
    };

    audio.onerror = () => {
      if (audio._stopped) return;
      if (window.clientLogger) {
        window.clientLogger.logError(`Preview audio error for reward ${rewardId}`, audio.error, { rewardId });
      }
      stopPreview(onPreviewChanged);
    };

    if (typeof window === 'undefined') {
      audio.src = `/api/audio/${encodeURIComponent(rewardId)}`;
      await audio.play();
      return;
    }

    const src = await loadAudioSource(rewardId);
    if (activePreviewAudio !== audio || audio._stopped) {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      return;
    }
    if (src.startsWith('blob:')) previewObjectUrl = src;
    audio.src = src;

    await audio.play();
  } catch (err) {
    if (err.name === 'AbortError' || activePreviewAudio?._stopped) return;
    if (window.clientLogger) {
      window.clientLogger.logError(`playPreview rejected for reward ${rewardId}`, err, { rewardId });
    }
    if (typeof window !== 'undefined' && typeof window.renderer?.toast === 'function') {
      window.renderer.toast(`Preview failed: ${err.message}`, true);
    }
    stopPreview(onPreviewChanged);
  }
}

function updateQueueUI(state, t = (k) => k) {
  const countEl = document.getElementById('queue-count');
  const currentEl = document.getElementById('current-sound');
  const listEl = document.getElementById('queue-list');
  const stopBtn = document.getElementById('stop-btn');
  const resumeBtn = document.getElementById('resume-queue');
  const skipBtn = document.getElementById('skip-btn');
  const clearBtn = document.getElementById('clear-queue');

  const waitingCount = state.queue?.length || 0;
  if (countEl) countEl.textContent = t('queueCountWaiting', { count: waitingCount });

  if (stopBtn) {
    stopBtn.hidden = Boolean(queuePaused);
    if (stopBtn.style?.setProperty) {
      stopBtn.style.setProperty('display', queuePaused ? 'none' : 'inline-flex');
    } else if (stopBtn.style) {
      stopBtn.style.display = queuePaused ? 'none' : 'inline-flex';
    }
    if (queuePaused) stopBtn.setAttribute('hidden', '');
    else stopBtn.removeAttribute('hidden');
  }
  if (resumeBtn) {
    resumeBtn.hidden = !queuePaused;
    if (resumeBtn.style?.setProperty) {
      resumeBtn.style.setProperty('display', queuePaused ? 'inline-flex' : 'none');
    } else if (resumeBtn.style) {
      resumeBtn.style.display = queuePaused ? 'inline-flex' : 'none';
    }
    if (!queuePaused) resumeBtn.setAttribute('hidden', '');
    else resumeBtn.removeAttribute('hidden');
  }
  if (skipBtn) skipBtn.disabled = !currentItem;
  if (clearBtn) clearBtn.disabled = waitingCount === 0;

  if (currentEl) {
    if (currentItem) {
      const reward = state.rewards.find((r) => r.id === currentItem.rewardId);
      currentEl.innerHTML = `<span>▶ Playing:</span> <strong>${reward?.title || currentItem.rewardId}</strong>`;
      currentEl.style.display = 'flex';
    } else {
      currentEl.innerHTML = `<span>.... ${t('nothingPlaying')}</span>`;
      currentEl.style.display = 'flex';
    }
  }

  if (listEl) {
    if (!waitingCount) {
      listEl.innerHTML = '';
    } else {
      listEl.innerHTML = state.queue.map((item, idx) => {
        const reward = state.rewards.find((r) => r.id === item.rewardId);
        return `
          <div class="queue-item">
            <span>#${idx + 1} ${reward?.title || item.rewardId}</span>
            <button type="button" class="ghost small" data-remove-queue="${idx}" style="padding:2px 7px; font-size:10px;">✕</button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('[data-remove-queue]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.removeQueue, 10);
          state.queue.splice(idx, 1);
          updateQueueUI(state, t);
        });
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    effectiveVolume,
    enqueueRedemptionSound,
    playNext,
    startQueuedAudio,
    stopQueue,
    resumeQueue,
    skipCurrent,
    clearQueue,
    playPreview,
    stopPreview,
    updateQueueUI,
    getCurrentItem,
    getActiveAudio,
    getActivePreviewAudio,
    getCurrentPlayingPreviewRewardId,
    updateActiveAudioVolume,
  };
} else {
  window.queueComponent = {
    effectiveVolume,
    enqueueRedemptionSound,
    playNext,
    startQueuedAudio,
    stopQueue,
    resumeQueue,
    skipCurrent,
    clearQueue,
    playPreview,
    stopPreview,
    updateQueueUI,
    getCurrentItem,
    getActiveAudio,
    getActivePreviewAudio,
    getCurrentPlayingPreviewRewardId,
    updateActiveAudioVolume,
  };
}
