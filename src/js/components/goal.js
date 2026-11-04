/**
 * Channel Point Goal Management Component
 * Provides live mirror preview, manual points adjustment, goal configuration,
 * and OBS browser source link integration.
 */

function renderGoalView(containerId, state, options = {}) {
  const root = document.getElementById(containerId);
  if (!root) return;

  const { t = (k) => k, onToast = () => {} } = options;
  const goal = state.goal || {
    title: 'Community Kick Goal',
    current: 0,
    target: 10000,
    autoAddRedemptions: true,
  };

  const current = Math.max(0, Number(goal.current || 0));
  const target = Math.max(1, Number(goal.target || 10000));
  const pct = Math.min(100, Math.round((current / target) * 100));
  const isComplete = current >= target;

  root.innerHTML = `
    <div class="goal-mgmt-grid">
      <!-- Section 1: Live Interactive Preview Card -->
      <div class="goal-card-wrapper">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="font-size:16px; font-weight:800; color:var(--text);">${t('goalPreview')}</h3>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">Real-time mirror of what viewers see in your OBS stream</div>
          </div>
          <span class="stat-pill green" id="goal-status-badge">${isComplete ? t('goalComplete') : '⚡ Live Active'}</span>
        </div>

        <div style="display:flex; justify-content:center; padding:16px 0;">
          <div class="kick-goal-card ${isComplete ? 'goal-complete' : ''}" id="app-preview-goal-card" style="width:100%; max-width:680px;">
            <div class="goal-popup-container" id="app-preview-goal-popup-container"></div>
            <div class="goal-header">
              <div class="goal-title-wrap">
                <span class="goal-icon" aria-hidden="true">🎯</span>
                <span class="goal-title" id="preview-goal-title">${goal.title || 'Community Kick Goal'}</span>
              </div>
              <div class="goal-stats">
                <span>🪙</span>
                <span class="goal-current-num" id="preview-goal-current">${current.toLocaleString()}</span>
                <span class="goal-target-num">/ <span id="preview-goal-target">${target.toLocaleString()}</span> pts</span>
                <span class="goal-pct-pill" id="preview-goal-pct">${pct}%</span>
              </div>
            </div>

            <progress class="kick-goal-progress" id="preview-goal-progress" value="${current}" max="${target}" aria-label="Channel point goal progress">${pct}%</progress>

            <div class="goal-footer">
              <span id="preview-goal-subtitle">${t('channelPointGoalSubtitle')}</span>
              <span class="goal-complete-banner" style="display:${isComplete ? 'inline-flex' : 'none'};">🎉 ${t('goalComplete')}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 2: Manual Points Adjustments (Like donation goals) -->
      <div class="goal-card-wrapper">
        <h3 style="font-size:15px; font-weight:800; color:var(--text); margin-bottom:6px;">⚡ ${t('goalAdjustTitle')}</h3>
        <div style="font-size:12px; color:var(--muted); margin-bottom:14px;">Quickly add or remove points, set exact progress, or reset the goal.</div>

        <div class="goal-adjust-row" style="margin-bottom:16px;">
          <span style="font-size:12px; font-weight:700; color:var(--muted);">${t('goalAddPoints')}:</span>
          <button type="button" class="goal-adjust-btn positive" data-goal-adjust="50">+50</button>
          <button type="button" class="goal-adjust-btn positive" data-goal-adjust="100">+100</button>
          <button type="button" class="goal-adjust-btn positive" data-goal-adjust="500">+500</button>
          <button type="button" class="goal-adjust-btn positive" data-goal-adjust="1000">+1,000</button>
          <button type="button" class="goal-adjust-btn positive" data-goal-adjust="5000">+5,000</button>

          <span style="font-size:12px; font-weight:700; color:var(--muted); margin-left:12px;">${t('goalDeductPoints')}:</span>
          <button type="button" class="goal-adjust-btn negative" data-goal-adjust="-50">-50</button>
          <button type="button" class="goal-adjust-btn negative" data-goal-adjust="-100">-100</button>
          <button type="button" class="goal-adjust-btn negative" data-goal-adjust="-500">-500</button>
          <button type="button" class="goal-adjust-btn negative" data-goal-adjust="-1000">-1,000</button>

          <button type="button" class="goal-reset-btn" id="goal-reset-btn">🔄 ${t('goalReset')}</button>
        </div>

        <div style="display:flex; gap:14px; flex-wrap:wrap; padding-top:14px; border-top:1px solid var(--line);">
          <!-- Custom Delta Input -->
          <div style="display:flex; gap:8px; align-items:center;">
            <label for="goal-custom-delta-input" style="font-size:12px; font-weight:700; color:var(--text);">Custom Delta:</label>
            <input type="number" id="goal-custom-delta-input" placeholder="500" style="width:100px; padding:6px 10px; font-size:12px;" min="1" max="1000000">
            <button type="button" id="goal-apply-add-btn" class="primary small">+ Add</button>
            <button type="button" id="goal-apply-deduct-btn" class="danger small">- Deduct</button>
          </div>

          <!-- Direct Set Input -->
          <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
            <label for="goal-direct-set-input" style="font-size:12px; font-weight:700; color:var(--text);">${t('goalSetPoints')}:</label>
            <input type="number" id="goal-direct-set-input" value="${current}" style="width:110px; padding:6px 10px; font-size:12px;" min="0" max="10000000">
            <button type="button" id="goal-apply-set-btn" class="ghost small">Set Exact</button>
          </div>
        </div>
      </div>

      <!-- Section 3: Goal Settings & Target -->
      <div class="goal-card-wrapper">
        <h3 style="font-size:15px; font-weight:800; color:var(--text); margin-bottom:14px;">🎯 ${t('goalSaveSettings')}</h3>
        <form id="goal-settings-form" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:18px;">
          <div class="field">
            <label for="goal-title-input">${t('goalTitle')}</label>
            <input type="text" id="goal-title-input" value="${goal.title || ''}" placeholder="e.g. Subathon Microphone Upgrade" maxlength="60" required style="width:100%;">
          </div>

          <div class="field">
            <label for="goal-target-input">${t('goalTarget')} (Max Points)</label>
            <input type="number" id="goal-target-input" value="${target}" min="1" max="100000000" step="1" required style="width:100%;">
          </div>

          <div class="field" style="grid-column: 1 / -1;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:700; color:var(--text);">
              <input type="checkbox" id="goal-auto-add-toggle" ${goal.autoAddRedemptions ? 'checked' : ''}>
              <span>${t('goalAutoAdd')}</span>
            </label>
            <div style="font-size:11px; color:var(--muted); margin-top:4px;">${t('goalAutoAddNote')}</div>
          </div>

          <div style="grid-column: 1 / -1; display:flex; justify-content:flex-end;">
            <button type="submit" class="primary">${t('goalSaveSettings')}</button>
          </div>
        </form>
      </div>

      <!-- Section 4: OBS Browser Source Setup & Test Event -->
      <div class="goal-card-wrapper">
        <h3 style="font-size:15px; font-weight:800; color:var(--text); margin-bottom:6px;">🎥 ${t('goalObsTitle')}</h3>
        <div style="font-size:12px; color:var(--muted); margin-bottom:14px;">${t('goalObsInstructions')}</div>

        <div style="display:flex; gap:10px; align-items:center; margin-bottom:14px;">
          <input type="text" id="goal-obs-url" readonly value="http://localhost:9000/goal" style="flex:1; font-family:monospace; font-size:12px; background:#090e15;">
          <button type="button" id="goal-copy-url-btn" class="primary small">${t('goalCopyUrl')}</button>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button type="button" id="goal-test-redemption-btn" class="ghost small" style="border-color:rgba(83,252,24,0.4); color:var(--green);">${t('goalTestRedemption')}</button>
          <button type="button" id="goal-test-deduct-btn" class="ghost small" style="border-color:rgba(255,92,100,0.4); color:#ff5c64;">${t('goalTestDeduct')}</button>
          <span style="font-size:11px; color:var(--muted);">Simulate live popup chips (+500 viewer redemption or -500 streamer deduction) on stream.</span>
        </div>
      </div>
    </div>
  `;

  // --- Live Floating Popup Chip in App Preview ---
  function showPreviewPopup(event) {
    const popupContainer = root.querySelector('#app-preview-goal-popup-container');
    if (!popupContainer || !event) return;

    const points = Number(event.pointsAdded ?? event.delta ?? 0);
    const isReset = event.type === 'reset';
    const isNegative = points < 0 || isReset;

    const chip = document.createElement('div');
    chip.className = `goal-popup-chip ${isNegative ? 'negative deduct' : 'positive'}`;

    const sign = points > 0 ? '+' : '';
    const pointsText = isReset ? 'Reset to 0 🪙' : `${sign}${points.toLocaleString()} 🪙`;
    const user = String(event.userName || (isNegative ? 'Streamer' : 'Viewer')).replace(/[&<>"']/g, '');
    const defaultReward = isReset ? t('goalResetLabel') : (isNegative ? t('goalDeduction') : '');
    const reward = event.rewardTitle ? String(event.rewardTitle).replace(/[&<>"']/g, '') : defaultReward;

    chip.innerHTML = `
      <span class="chip-icon">${isNegative ? '🔻' : '🪙'}</span>
      <span class="chip-points">${pointsText}</span>
      <span class="chip-user">@${user}</span>
      ${reward ? `<span class="chip-reward">${reward}</span>` : ''}
    `;

    popupContainer.appendChild(chip);

    setTimeout(() => {
      if (chip.parentNode) chip.remove();
    }, 3500);
  }

  // --- Attach Event Listeners ---

  // 1. Quick Adjust Buttons (+50, +100, -500, etc.)
  root.querySelectorAll('[data-goal-adjust]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const delta = Number(btn.dataset.goalAdjust);
      showPreviewPopup({ delta, userName: 'Streamer', rewardTitle: delta < 0 ? t('goalDeduction') : '' });
      if (typeof options.onAdjustGoal === 'function') {
        await options.onAdjustGoal(delta);
      }
    });
  });

  // 2. Custom Delta Add & Deduct
  const customDeltaInput = root.querySelector('#goal-custom-delta-input');
  root.querySelector('#goal-apply-add-btn')?.addEventListener('click', async () => {
    const val = Number(customDeltaInput?.value || 0);
    if (val > 0) {
      showPreviewPopup({ delta: val, userName: 'Streamer' });
      if (typeof options.onAdjustGoal === 'function') {
        await options.onAdjustGoal(val);
        if (customDeltaInput) customDeltaInput.value = '';
      }
    }
  });

  root.querySelector('#goal-apply-deduct-btn')?.addEventListener('click', async () => {
    const val = Number(customDeltaInput?.value || 0);
    if (val > 0) {
      showPreviewPopup({ delta: -val, userName: 'Streamer', rewardTitle: t('goalDeduction') });
      if (typeof options.onAdjustGoal === 'function') {
        await options.onAdjustGoal(-val);
        if (customDeltaInput) customDeltaInput.value = '';
      }
    }
  });

  // 3. Direct Set Progress Value
  root.querySelector('#goal-apply-set-btn')?.addEventListener('click', async () => {
    const directInput = root.querySelector('#goal-direct-set-input');
    const val = Number(directInput?.value || 0);
    const diff = Math.max(0, val) - current;
    if (diff !== 0) {
      showPreviewPopup({ delta: diff, userName: 'Streamer', rewardTitle: diff < 0 ? t('goalDeduction') : '' });
    }
    if (typeof options.onSetGoalProgress === 'function') {
      await options.onSetGoalProgress(Math.max(0, val));
    }
  });

  // 4. Reset Goal
  root.querySelector('#goal-reset-btn')?.addEventListener('click', async () => {
    if (confirm(t('goalResetConfirm'))) {
      showPreviewPopup({ type: 'reset', delta: -current, userName: 'Streamer', rewardTitle: t('goalResetLabel') });
      if (typeof options.onResetGoal === 'function') {
        await options.onResetGoal();
      }
    }
  });

  // 5. Goal Settings Form Submit
  root.querySelector('#goal-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = root.querySelector('#goal-title-input')?.value.trim() || 'Community Kick Goal';
    const rawTarget = root.querySelector('#goal-target-input')?.value;
    const targetVal = Number(String(rawTarget).replace(/,/g, '')) || 10000;
    const autoAdd = root.querySelector('#goal-auto-add-toggle')?.checked ?? true;

    if (typeof options.onSaveGoalSettings === 'function') {
      await options.onSaveGoalSettings({
        title,
        target: Math.max(1, targetVal),
        autoAddRedemptions: autoAdd,
      });
    }
  });

  // 6. Copy OBS URL
  root.querySelector('#goal-copy-url-btn')?.addEventListener('click', async () => {
    const urlInput = root.querySelector('#goal-obs-url');
    if (urlInput && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(urlInput.value).catch(() => {});
      onToast(t('goalUrlCopied'));
    }
  });

  // 7. Test Redemption & Deduct Events
  root.querySelector('#goal-test-redemption-btn')?.addEventListener('click', async () => {
    showPreviewPopup({ pointsAdded: 500, userName: 'KickViewer_42', rewardTitle: 'Hydrate Streamer' });
    if (typeof options.onTestRedemption === 'function') {
      await options.onTestRedemption();
    }
  });

  root.querySelector('#goal-test-deduct-btn')?.addEventListener('click', async () => {
    showPreviewPopup({ delta: -500, userName: 'Streamer', rewardTitle: t('goalDeduction') });
    if (typeof options.onTestDeduct === 'function') {
      await options.onTestDeduct();
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderGoalView };
} else if (typeof window !== 'undefined') {
  window.goalModule = { renderGoalView };
}
