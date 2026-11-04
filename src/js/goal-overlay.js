/**
 * Kick Soundboard - OBS Channel Point Goal Overlay Engine
 * Smooth real-time progress bar with floating redemption chips.
 */
(function () {
  const goalCard = document.getElementById('goal-card');
  const popupContainer = document.getElementById('goal-popup-container');
  const titleEl = document.getElementById('goal-title');
  const currentEl = document.getElementById('goal-current');
  const targetEl = document.getElementById('goal-target');
  const pctEl = document.getElementById('goal-pct');
  const progressEl = document.getElementById('goal-progress');

  if (!goalCard || !progressEl) return;

  let currentGoal = {
    title: 'Community Kick Goal',
    current: 0,
    target: 10000,
    autoAddRedemptions: true,
  };

  let lastTimestamp = Date.now();

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function updateGoalUI(goal) {
    if (!goal) return;
    currentGoal = { ...currentGoal, ...goal };

    const current = Math.max(0, Number(currentGoal.current || 0));
    const target = Math.max(1, Number(currentGoal.target || 10000));
    const pct = Math.min(100, Math.round((current / target) * 100));

    if (titleEl) titleEl.textContent = currentGoal.title || 'Community Kick Goal';
    if (currentEl) currentEl.textContent = current.toLocaleString();
    if (targetEl) targetEl.textContent = target.toLocaleString();
    if (pctEl) pctEl.textContent = `${pct}%`;

    progressEl.max = target;
    progressEl.value = current;
    progressEl.setAttribute('aria-valuenow', String(current));
    progressEl.setAttribute('aria-valuemax', String(target));
    progressEl.textContent = `${pct}%`;

    goalCard.classList.toggle('goal-complete', current >= target);
  }

  function showRedemptionPopup(event) {
    if (!popupContainer || !event) return;

    const points = Number(event.pointsAdded ?? event.delta ?? 0);
    const isReset = event.type === 'reset';
    const isNegative = points < 0 || isReset;

    const chip = document.createElement('div');
    chip.className = `goal-popup-chip ${isNegative ? 'negative deduct' : 'positive'}`;

    const sign = points > 0 ? '+' : '';
    const pointsText = isReset ? 'Reset to 0 🪙' : `${sign}${points.toLocaleString()} 🪙`;
    const user = escapeHtml(event.userName || (isNegative ? 'Streamer' : 'Viewer'));
    const defaultReward = isReset ? 'Goal Reset' : (isNegative ? 'Deduction' : '');
    const reward = event.rewardTitle ? escapeHtml(event.rewardTitle) : defaultReward;

    chip.innerHTML = `
      <span class="chip-icon">${isNegative ? '🔻' : '🪙'}</span>
      <span class="chip-points">${pointsText}</span>
      <span class="chip-user">@${user}</span>
      ${reward ? `<span class="chip-reward">${reward}</span>` : ''}
    `;

    popupContainer.appendChild(chip);

    // Auto remove after animation completes (3.5s)
    setTimeout(() => {
      if (chip.parentNode) chip.remove();
    }, 3500);
  }

  function handleIncomingEvent(event) {
    if (!event) return;
    if (event.timestamp) {
      lastTimestamp = Math.max(lastTimestamp, event.timestamp);
    }

    if (event.goal) {
      updateGoalUI(event.goal);
    }

    if (event.type === 'redemption' || event.type === 'adjust' || event.type === 'reset') {
      showRedemptionPopup(event);
    }
  }

  // 1. Initial State Fetch
  fetch('/api/goal')
    .then((res) => res.json())
    .then((data) => {
      if (data?.goal) updateGoalUI(data.goal);
    })
    .catch(() => {});

  // 2. Real-time SSE Connection
  let evtSource = null;
  function connectSSE() {
    try {
      if (evtSource) evtSource.close();
      evtSource = new EventSource('/api/goal/events');

      evtSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          handleIncomingEvent(payload);
        } catch {}
      };

      evtSource.onerror = () => {
        // SSE auto reconnects natively
      };
    } catch {}
  }

  connectSSE();

  // 3. Polling Fallback (ensures OBS source caching doesn't drop updates)
  setInterval(async () => {
    try {
      const res = await fetch(`/api/goal/poll?since=${lastTimestamp}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.goal) updateGoalUI(data.goal);
      if (Array.isArray(data?.events)) {
        for (const evt of data.events) {
          if (evt.timestamp > lastTimestamp) {
            lastTimestamp = evt.timestamp;
            handleIncomingEvent(evt);
          }
        }
      }
    } catch {}
  }, 1200);
})();
