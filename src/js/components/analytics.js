/**
 * Stream Analytics Component
 * Real data aggregation without mock curves: 7-day/24-hour bucketing,
 * cubic Bézier SVG wave generation, capsule bars, and top viewers with privacy blur.
 */

function getTimelineBuckets(history, timeframe = '7d', language = 'en', customRewards) {
  const activeRewards = customRewards !== undefined ? customRewards : (typeof rewards !== 'undefined' ? rewards : []);
  const buckets = [];
  const now = new Date();

  if (timeframe === '24h') {
    const endHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
    for (let i = 7; i >= 0; i--) {
      const bEnd = new Date(endHour.getTime() - i * 3 * 3600 * 1000);
      const bStart = new Date(bEnd.getTime() - 3 * 3600 * 1000);
      const label = bStart.toLocaleTimeString(language === 'fa' ? 'fa-IR' : 'en-US', { hour: 'numeric', hour12: true });
      buckets.push({ start: bStart.getTime(), end: bEnd.getTime(), label, subLabel: '', count: 0, points: 0 });
    }
  } else {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400 * 1000);
      const bStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const bEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const label = bStart.toLocaleDateString(language === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'short' });
      const subLabel = bStart.toLocaleDateString(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'numeric', day: 'numeric' });
      buckets.push({ start: bStart.getTime(), end: bEnd.getTime(), label, subLabel, count: 0, points: 0 });
    }
  }

  for (const item of (history || [])) {
    const t = new Date(item.redeemedAt).getTime();
    if (Number.isNaN(t)) continue;
    for (const b of buckets) {
      if (t >= b.start && t <= b.end) {
        b.count += 1;
        const reward = (activeRewards || []).find((r) => r.id === item.rewardId || (Boolean(item.rewardTitle) && r.title === item.rewardTitle));
        const cost = Number(reward?.cost || item.rewardCost || 0);
        b.points += Number.isFinite(cost) ? cost : 0;
        break;
      }
    }
  }

  return buckets;
}

function renderTimelineChart(buckets) {
  const svg = document.getElementById('analytics-wave-svg');
  const colsContainer = document.getElementById('analytics-timeline-columns');
  if (!svg || !colsContainer) return;

  const area = document.getElementById('svg-wave-area');
  const line = document.getElementById('svg-wave-line');
  const nodes = document.getElementById('svg-wave-nodes');

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const count = buckets.length;
  const width = 600;
  const height = 160;
  const paddingX = 30;
  const paddingTop = 25;
  const paddingBottom = 25;
  const usableHeight = height - paddingTop - paddingBottom;
  const stepX = (width - paddingX * 2) / (count - 1);

  const points = buckets.map((b, i) => {
    const x = paddingX + i * stepX;
    const ratio = b.count / maxCount;
    const y = height - paddingBottom - ratio * usableHeight;
    return { x, y, count: b.count, points: b.points };
  });

  let lineD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cp1x = p0.x + (p1.x - p0.x) / 2;
    const cp1y = p0.y;
    const cp2x = p0.x + (p1.x - p0.x) / 2;
    const cp2y = p1.y;
    lineD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }

  const areaD = `${lineD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  if (line) line.setAttribute('d', lineD);
  if (area) area.setAttribute('d', areaD);

  if (nodes) {
    nodes.innerHTML = points.map((p) => `
      <g>
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#53fc18" stroke="#090c10" stroke-width="2"/>
        ${p.count > 0 ? `<text x="${p.x}" y="${p.y - 8}" fill="#53fc18" font-size="10" font-weight="700" text-anchor="middle">${p.count}</text>` : ''}
      </g>
    `).join('');
  }

  colsContainer.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
  colsContainer.innerHTML = buckets.map((b, idx) => `
    <div class="chart-day-col ${idx === count - 1 ? 'active' : ''}">
      <div>${b.label}</div>
      ${b.subLabel ? `<div style="font-size:10px; opacity:0.7;">${b.subLabel}</div>` : ''}
      <div class="chart-day-val">${b.count}</div>
    </div>
  `).join('');
}

function renderAnalytics(state, options = {}) {
  const { t = (k) => k, getLanguage = () => 'en' } = options;
  const history = state.history || [];
  const rewards = state.rewards || [];

  let totalPoints = 0;
  for (const item of history) {
    const reward = rewards.find((r) => r.id === item.rewardId || (Boolean(item.rewardTitle) && r.title === item.rewardTitle));
    const cost = Number(reward?.cost || item.rewardCost || 0);
    if (Number.isFinite(cost)) totalPoints += cost;
  }

  const statRedemptions = document.getElementById('stat-total-redemptions');
  if (statRedemptions) statRedemptions.textContent = String(history.length);

  const statPoints = document.getElementById('stat-total-points');
  if (statPoints) statPoints.textContent = totalPoints.toLocaleString();

  const mappedCount = rewards.filter((r) => {
    const s = state.sounds?.[r.id];
    return Boolean(s?.path || s?.name || s?.available);
  }).length;
  const statActiveSounds = document.getElementById('stat-active-sounds');
  if (statActiveSounds) {
    statActiveSounds.innerHTML = `${mappedCount} <span style="font-size:16px; color:var(--muted); font-weight:600;">/ ${rewards.length}</span>`;
  }
  const statSoundPct = document.getElementById('stat-sound-pct');
  if (statSoundPct) {
    statSoundPct.textContent = rewards.length ? `${Math.round((mappedCount / rewards.length) * 100)}%` : '0%';
  }

  const statStatus = document.getElementById('stat-polling-status');
  if (statStatus) {
    statStatus.textContent = state.connected ? 'Connected' : 'Offline';
    statStatus.style.color = state.connected ? 'var(--green)' : 'var(--muted)';
  }

  // Real timeline wave chart
  const timeframe = state.analyticsTimeframe || '7d';
  const buckets = getTimelineBuckets(history, timeframe, getLanguage(), rewards);
  renderTimelineChart(buckets);

  // Popular Sounds Capsule Bars
  const countsByReward = {};
  for (const item of history) {
    const key = item.rewardTitle || item.rewardId || 'Reward';
    countsByReward[key] = (countsByReward[key] || 0) + 1;
  }
  const sortedRewards = Object.entries(countsByReward).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxRCount = sortedRewards.length ? sortedRewards[0][1] : 1;

  const capsules = document.getElementById('popular-rewards-capsules');
  if (capsules) {
    if (!sortedRewards.length) {
      capsules.innerHTML = `<div class="empty">${t('noAnalyticsData')}</div>`;
    } else {
      capsules.innerHTML = sortedRewards.map(([name, c]) => `
        <div class="capsule-row">
          <div class="capsule-name" title="${name}">${name}</div>
          <div class="capsule-track">
            <div class="capsule-fill" style="width:${Math.max(5, (c / maxRCount) * 100)}%;"></div>
          </div>
          <div class="capsule-stat">${c}</div>
        </div>
      `).join('');
    }
  }

  // Top Viewers List with Privacy Blur
  const countsByUser = {};
  for (const item of history) {
    const name = item.userName || item.userLogin || (item.userId ? `User #${item.userId}` : 'Anonymous');
    countsByUser[name] = (countsByUser[name] || 0) + 1;
  }
  const sortedUsers = Object.entries(countsByUser).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const viewersList = document.getElementById('top-viewers-list');
  if (viewersList) {
    if (!sortedUsers.length) {
      viewersList.innerHTML = `<div class="empty">No redemptions yet</div>`;
    } else {
      viewersList.innerHTML = sortedUsers.map(([uname, c]) => `
        <div style="background:#0d121a; border:1px solid var(--line); border-radius:var(--radius-md); padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
          <span class="private-blur-wrap"><span class="private-blur" style="font-weight:700;">${uname}</span></span>
          <span style="font-size:12px; font-weight:700; color:var(--green);">${c} redemptions</span>
        </div>
      `).join('');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getTimelineBuckets,
    renderTimelineChart,
    renderAnalytics,
  };
} else {
  window.analyticsComponent = {
    getTimelineBuckets,
    renderTimelineChart,
    renderAnalytics,
  };
}
