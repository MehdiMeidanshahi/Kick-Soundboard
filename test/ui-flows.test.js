const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('UI Flow: HTML has all required IDs and DOM elements for app functionality', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

  const requiredIds = [
    'settings-modal', 'settings-form', 'rewards', 'history', 'history-panel', 'toast',
    'lang-toggle', 'settings-btn', 'connect-btn', 'status-dot', 'status-label',
    'setup-banner', 'banner-connect', 'setup-settings', 'poll-health', 'readiness',
    'ready-connection', 'ready-sounds', 'ready-files', 'ready-playback',
    'reward-tools', 'reward-search', 'unassigned-only', 'volume', 'volume-label',
    'queue-count', 'stop-btn', 'resume-queue', 'skip-btn', 'current-sound',
    'queue-list', 'clear-queue', 'history-search', 'history-filter', 'clear-history',
    'history-prev', 'history-page', 'history-next', 'history-pagination',
    'account-status-text', 'modal-connect-btn', 'disconnect-btn', 'play-pending-toggle',
    'audio-output', 'refresh-audio-devices', 'app-version', 'check-updates',
    'update-status', 'download-update', 'stream-mode-btn', 'refresh-btn',
    'dock-studio', 'dock-analytics', 'dock-soundpad', 'tab-studio', 'tab-analytics',
    'tab-soundpad', 'view-studio', 'view-analytics', 'view-soundpad'
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `Expected element with id="${id}" in index.html`);
  }
});

test('UI Flow: Button visibility uses HTML hidden attribute instead of inline display:none', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

  // Elements that renderer.js toggles with .hidden
  const hiddenElements = ['disconnect-btn', 'download-update', 'resume-queue'];
  for (const id of hiddenElements) {
    const regex = new RegExp(`id="${id}"[^>]*hidden`);
    assert.ok(regex.test(html), `Expected element id="${id}" to have standard hidden attribute`);
    // Ensure no inline style="display:none;" on these elements which would block .hidden=false
    const inlineNoneRegex = new RegExp(`id="${id}"[^>]*style="[^"]*display:\\s*none`);
    assert.ok(!inlineNoneRegex.test(html), `Element id="${id}" must not have inline display:none style`);
  }
});

test('UI Flow: Stream mode CSS rules exist for privacy blur and control hiding', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.ok(html.includes('href="./style.css"'), 'index.html must link modular style.css');

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'privacy.css'), 'utf8');
  assert.ok(css.includes('body.stream-mode #reward-tools'), 'CSS must hide #reward-tools in stream mode');
  assert.ok(css.includes('body.stream-mode #history-panel .filter-row'), 'CSS must hide history filter in stream mode');
  assert.ok(css.includes('body.stream-mode #history-panel .private-blur'), 'CSS must blur private elements in stream mode');
  assert.ok(css.includes('privacy-shimmer'), 'CSS must include privacy-shimmer animation');
  assert.ok(css.includes('privacy-glow'), 'CSS must include privacy-glow animation');
});

test('UI Flow: Translations are 100% complete across English and Persian', () => {
  const i18nJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'i18n.js'), 'utf8');
  
  // Extract translations object from i18n.js
  const match = i18nJs.match(/const translations\s*=\s*(\{[\s\S]*?\n\};)/);
  assert.ok(match, 'translations object found in i18n.js');

  const evaluated = new Function(`return ${match[1]}`)();
  const enKeys = Object.keys(evaluated.en);
  const faKeys = Object.keys(evaluated.fa);

  assert.ok(enKeys.length > 50, 'en translations must contain core keys');
  for (const key of enKeys) {
    assert.ok(evaluated.fa[key], `Missing Persian translation for key: ${key}`);
  }
});

test('UI Flow: Stream Analytics contains zero hardcoded mock SVG curves or mock days', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

  // Hardcoded mockup wave coordinates must NOT be in the HTML
  assert.ok(!html.includes('Q100,60 200,90'), 'Hardcoded SVG wave coordinates must not exist in index.html');
  assert.ok(!html.includes('circle cx="200" cy="90"'), 'Hardcoded SVG mock circles must not exist in index.html');
  assert.ok(!html.includes('circle cx="400" cy="40"'), 'Hardcoded SVG mock circles must not exist in index.html');

  // Dynamic elements must be present
  assert.ok(html.includes('id="svg-wave-area"'), 'Dynamic wave area path must exist');
  assert.ok(html.includes('id="svg-wave-line"'), 'Dynamic wave line path must exist');
  assert.ok(html.includes('id="svg-wave-nodes"'), 'Dynamic wave nodes group must exist');
  assert.ok(html.includes('id="analytics-timeline-columns"'), 'Dynamic timeline columns container must exist');
  assert.ok(html.includes('id="timeframe-7d"'), '7-day timeframe toggle button must exist');
  assert.ok(html.includes('id="timeframe-24h"'), '24-hour timeframe toggle button must exist');
});

test('UI Flow: getTimelineBuckets correctly maps real timestamps and calculates counts and points', () => {
  const analyticsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'components', 'analytics.js'), 'utf8');

  // Extract getTimelineBuckets function definition
  const match = analyticsJs.match(/function getTimelineBuckets\([\s\S]*?\n  return buckets;\s*\n\}/);
  assert.ok(match, 'getTimelineBuckets function found in analytics.js');

  const fn = new Function('language', 'rewards', `${match[0]}; return getTimelineBuckets;`)('en', [
    { id: 'rew-1', cost: 100 },
    { id: 'rew-2', cost: 250 }
  ]);

  // Test with empty history
  const emptyBuckets = fn([], '7d');
  assert.equal(emptyBuckets.length, 7);
  assert.equal(emptyBuckets.every((b) => b.count === 0 && b.points === 0), true);

  // Test with real timestamp history (2 on today, 1 yesterday)
  const now = new Date();
  const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).toISOString();
  const yesterdayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 15, 0, 0).toISOString();

  const realHistory = [
    { id: '1', rewardId: 'rew-1', redeemedAt: todayIso },
    { id: '2', rewardId: 'rew-2', redeemedAt: todayIso },
    { id: '3', rewardId: 'rew-1', redeemedAt: yesterdayIso }
  ];

  const buckets7d = fn(realHistory, '7d');
  assert.equal(buckets7d.length, 7);
  // Last bucket is today
  const todayBucket = buckets7d[6];
  assert.equal(todayBucket.count, 2);
  assert.equal(todayBucket.points, 350); // 100 + 250

  // 2nd to last bucket is yesterday
  const yesterdayBucket = buckets7d[5];
  assert.equal(yesterdayBucket.count, 1);
  assert.equal(yesterdayBucket.points, 100);

  // Test 24h buckets
  const buckets24h = fn(realHistory, '24h');
  assert.equal(buckets24h.length, 8);
});

test('UI Flow: Stream mode applies animated privacy blur globally and Soundpad has sampler retrigger and dedicated stop', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const privacyCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'privacy.css'), 'utf8');
  const soundpadJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'components', 'soundpad.js'), 'utf8');

  // Stream mode global rules
  assert.ok(privacyCss.includes('body.stream-mode .private-blur'), 'Global .private-blur rule must exist for all pages');
  assert.ok(privacyCss.includes('privacy-sparkle') || privacyCss.includes('privacy-shimmer'), 'Sparkle shimmer effect must exist in CSS');
  assert.ok(privacyCss.includes('privacy-glow'), 'Privacy glow animation must exist');

  // Master volume in header
  assert.ok(html.includes('header-volume-control'), 'Master volume control must be in the header for universal accessibility');
  assert.ok(html.includes('id="volume"'), 'Master volume input must exist');
  assert.ok(html.includes('id="volume-label"'), 'Master volume percentage label must exist');

  // Soundpad sampler features
  assert.ok(html.includes('id="soundpad-stop-all"'), 'Dedicated Stop Audio button must exist in soundpad header');
  assert.ok(html.includes('id="soundpad-unmapped-section"'), 'Unmapped rewards section must exist on soundpad');
  assert.ok(soundpadJs.includes('function triggerPadSound'), 'triggerPadSound function must exist');
  assert.ok(soundpadJs.includes('activePadAudio.currentTime = 0'), 'Retrigger must reset currentTime to 0 for instant spam playback');
});
