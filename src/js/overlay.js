/**
 * Kick Soundboard - OBS Stream Overlay Engine (1920x1080)
 * Sequential 3-second animated stream alerts for Kick channel points and sound pad triggers.
 */
(function () {
  const container = document.getElementById('overlay-banner-container');
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  let channelPointsOnly = urlParams.get('channelPointsOnly') === '1' || urlParams.get('channelPointsOnly') === 'true';

  // Fetch initial config from server if not overridden via URL
  if (!urlParams.has('channelPointsOnly')) {
    fetch('/api/overlay/config')
      .then((res) => res.json())
      .then((cfg) => {
        if (cfg && typeof cfg.channelPointsOnly === 'boolean') {
          channelPointsOnly = cfg.channelPointsOnly;
        }
      })
      .catch(() => {});
  }

  const alertQueue = [];
  let isDisplaying = false;
  let lastSeenTimestamp = Date.now();

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function enqueueAlert(event) {
    if (!event || !event.type) return;

    // Filter rule: If channelPointsOnly is enabled, skip manual soundpad triggers
    if (channelPointsOnly && event.type !== 'channel_point') {
      return;
    }

    alertQueue.push(event);
    if (!isDisplaying) {
      processNextAlert();
    }
  }

  function processNextAlert() {
    if (alertQueue.length === 0) {
      isDisplaying = false;
      return;
    }

    isDisplaying = true;
    const item = alertQueue.shift();

    const banner = document.createElement('div');
    const isChannelPoint = item.type === 'channel_point';

    banner.className = `overlay-banner ${isChannelPoint ? 'channel-point' : 'soundpad'}`;

    if (isChannelPoint) {
      const userName = escapeHtml(item.userName || 'Viewer');
      const title = escapeHtml(item.title || 'Channel Reward');
      const costBadge = Number.isFinite(item.cost) && item.cost > 0
        ? `<span class="overlay-cost-badge">🪙 ${item.cost} pts</span>`
        : '';

      banner.innerHTML = `
        <div class="overlay-icon-wrap" aria-hidden="true">💎</div>
        <div class="overlay-content">
          <div class="overlay-redeemer">
            <span>🪙</span>
            <span class="overlay-redeemer-name">${userName}</span>
            <span>redeemed:</span>
            ${costBadge}
          </div>
          <div class="overlay-title">${title}</div>
        </div>
        <div class="overlay-equalizer" aria-hidden="true">
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
        </div>
      `;
    } else {
      const title = escapeHtml(item.title || 'Sound Pad');

      banner.innerHTML = `
        <div class="overlay-icon-wrap" aria-hidden="true">⚡</div>
        <div class="overlay-content">
          <div>
            <span class="overlay-badge">⚡ SOUND PAD</span>
          </div>
          <div class="overlay-title">${title}</div>
        </div>
        <div class="overlay-equalizer" aria-hidden="true">
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
          <div class="overlay-equalizer-bar"></div>
        </div>
      `;
    }

    container.innerHTML = '';
    container.appendChild(banner);

    // Each banner displays for exactly 3 seconds (3000ms), followed by a 150ms buffer
    setTimeout(() => {
      if (banner.parentNode) {
        banner.remove();
      }
      setTimeout(() => {
        processNextAlert();
      }, 150);
    }, 3000);
  }

  // 1. Primary Real-time Connection: Server-Sent Events (SSE)
  let evtSource = null;
  function connectSSE() {
    try {
      if (evtSource) {
        evtSource.close();
      }
      evtSource = new EventSource('/api/overlay/events');

      evtSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.timestamp) {
            lastSeenTimestamp = Math.max(lastSeenTimestamp, payload.timestamp);
          }
          enqueueAlert(payload);
        } catch {}
      };

      evtSource.onerror = () => {
        // SSE error or reconnection handled automatically
      };
    } catch {}
  }

  connectSSE();

  // 2. Secondary Connection: Polling Fallback (ensures reliability in OBS browser source caching)
  setInterval(async () => {
    try {
      const res = await fetch(`/api/overlay/poll?since=${lastSeenTimestamp}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.events)) {
        for (const evt of data.events) {
          if (evt.timestamp > lastSeenTimestamp) {
            lastSeenTimestamp = evt.timestamp;
            enqueueAlert(evt);
          }
        }
      }
    } catch {}
  }, 1200);

  // Periodically re-sync config in background
  setInterval(async () => {
    if (urlParams.has('channelPointsOnly')) return;
    try {
      const res = await fetch('/api/overlay/config');
      if (!res.ok) return;
      const cfg = await res.json();
      if (cfg && typeof cfg.channelPointsOnly === 'boolean') {
        channelPointsOnly = cfg.channelPointsOnly;
      }
    } catch {}
  }, 5000);
})();
