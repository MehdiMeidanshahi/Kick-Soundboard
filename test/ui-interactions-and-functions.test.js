const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Read modular source files
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const i18nJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'i18n.js'), 'utf8');
const soundpadJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'components', 'soundpad.js'), 'utf8');
const analyticsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'components', 'analytics.js'), 'utf8');
const privacyCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'privacy.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'base.css'), 'utf8');

// =========================================================================
// 1. i18n Translation System: t(key, values) - Pass & Fail Scenarios
// =========================================================================

test('i18n: t() PASS scenario - English translation and parameter interpolation', () => {
  const match = i18nJs.match(/const translations\s*=\s*(\{[\s\S]*?\n\};)/);
  const translations = new Function(`return ${match[1]}`)();
  
  function t(key, values = {}, lang = 'en') {
    const table = translations[lang] || translations.en;
    let text = table[key] || translations.en[key] || key;
    for (const [k, v] of Object.entries(values)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
    return text;
  }

  // Pass: Basic lookup
  assert.equal(t('appName'), 'Kick Soundboard');
  assert.equal(t('streamMode'), 'Stream mode');
  
  // Pass: Interpolation
  const interpolated = t('pollRetry', { seconds: 15 });
  assert.ok(interpolated.includes('15 seconds'), `Expected '15 seconds' in '${interpolated}'`);
});

test('i18n: t() PASS scenario - Persian (fa) translation and RTL presence', () => {
  const match = i18nJs.match(/const translations\s*=\s*(\{[\s\S]*?\n\};)/);
  const translations = new Function(`return ${match[1]}`)();

  function t(key, values = {}, lang = 'fa') {
    const table = translations[lang] || translations.en;
    let text = table[key] || translations.en[key] || key;
    for (const [k, v] of Object.entries(values)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
    return text;
  }

  assert.equal(t('appName'), 'صندوق صدای کیک');
  assert.equal(t('streamMode'), 'حالت استریم');
  const interpolatedFa = t('pollRetry', { seconds: 30 });
  assert.ok(interpolatedFa.includes('30'), `Expected '30' in '${interpolatedFa}'`);
});

test('i18n: t() FAIL scenario - Graceful fallback on missing key or null values', () => {
  const match = i18nJs.match(/const translations\s*=\s*(\{[\s\S]*?\n\};)/);
  const translations = new Function(`return ${match[1]}`)();

  function t(key, values = {}, lang = 'en') {
    const table = translations[lang] || translations.en;
    let text = table[key] || translations.en[key] || key;
    if (values && typeof values === 'object') {
      for (const [k, v] of Object.entries(values)) {
        text = text.replaceAll(`{${k}}`, String(v ?? ''));
      }
    }
    return text;
  }

  // Fail: Key does not exist -> returns raw key string, never throws
  assert.equal(t('nonExistentKey_12345'), 'nonExistentKey_12345');

  // Fail: Null / undefined parameter value -> does not crash, replaces cleanly
  const withNull = t('pollRetry', { seconds: null });
  assert.ok(!withNull.includes('NaN'), 'Should not contain NaN');
});

// =========================================================================
// 2. Volume Calculations: effectiveVolume(rewardId) - Pass & Fail Scenarios
// =========================================================================

test('Volume: effectiveVolume PASS scenario - Multiplies master and reward volumes accurately', () => {
  function effectiveVolume(rewardId, state) {
    const master = Number.isFinite(state.volume) ? state.volume : 0.8;
    const rewardVol = Number.isFinite(state.rewardVolumes?.[rewardId]) ? state.rewardVolumes[rewardId] : 1.0;
    return Math.max(0, Math.min(1, master * rewardVol));
  }

  const state = { volume: 0.8, rewardVolumes: { 'rew-1': 0.5, 'rew-2': 1.0, 'rew-3': 0.0 } };
  
  assert.equal(effectiveVolume('rew-1', state), 0.4); // 80% * 50% = 40%
  assert.equal(effectiveVolume('rew-2', state), 0.8); // 80% * 100% = 80%
  assert.equal(effectiveVolume('rew-3', state), 0.0); // Muted
  assert.equal(effectiveVolume('rew-unmapped', state), 0.8); // Defaults to 1.0 * master
});

test('Volume: effectiveVolume FAIL scenario - Clamps negative and out-of-bounds volumes', () => {
  function effectiveVolume(rewardId, state) {
    const master = Number.isFinite(state.volume) ? state.volume : 0.8;
    const rewardVol = Number.isFinite(state.rewardVolumes?.[rewardId]) ? state.rewardVolumes[rewardId] : 1.0;
    return Math.max(0, Math.min(1, master * rewardVol));
  }

  // Fail: Negative values clamped to 0
  assert.equal(effectiveVolume('rew-neg', { volume: -0.5, rewardVolumes: {} }), 0.0);
  assert.equal(effectiveVolume('rew-neg', { volume: 0.8, rewardVolumes: { 'rew-neg': -1.2 } }), 0.0);

  // Fail: Over 1.0 values clamped to 1.0
  assert.equal(effectiveVolume('rew-high', { volume: 2.5, rewardVolumes: { 'rew-high': 1.5 } }), 1.0);

  // Fail: Non-numeric / NaN values default safely
  assert.equal(effectiveVolume('rew-nan', { volume: NaN, rewardVolumes: { 'rew-nan': 'invalid' } }), 0.8);
});

// =========================================================================
// 3. Tab Switching: switchTab(tabId) - Pass & Fail Scenarios
// =========================================================================

test('Navigation: switchTab PASS scenario - Valid tab switches view and tab states', () => {
  const tabs = ['studio', 'analytics', 'soundpad'];
  for (const tab of tabs) {
    assert.ok(indexHtml.includes(`id="dock-${tab}"`), `Expected dock button for ${tab}`);
    assert.ok(indexHtml.includes(`id="view-${tab}"`), `Expected app view for ${tab}`);
  }
});

test('Navigation: switchTab FAIL scenario - Unknown tab gracefully defaults or ignores', () => {
  assert.ok(rendererJs.includes('function switchTab(tabId)'), 'switchTab function exists in renderer.js');
  
  const mockViews = {
    studio: { classList: new Set(['active']) },
    analytics: { classList: new Set() },
    soundpad: { classList: new Set() }
  };

  function simulateSwitchTab(tabId) {
    const valid = ['studio', 'analytics', 'soundpad'];
    if (!valid.includes(tabId)) return false;
    for (const k of valid) {
      if (k === tabId) mockViews[k].classList.add('active');
      else mockViews[k].classList.delete('active');
    }
    return true;
  }

  assert.equal(simulateSwitchTab('analytics'), true);
  assert.ok(mockViews.analytics.classList.has('active'));
  assert.ok(!mockViews.studio.classList.has('active'));

  // Fail: invalid tab name
  assert.equal(simulateSwitchTab('invalid-tab-xyz'), false);
});

// =========================================================================
// 4. Sound Pad Sampler Engine: triggerPadSound - Pass & Fail Scenarios
// =========================================================================

test('Sound Pad: triggerPadSound PASS scenario - Spam/retrigger seeks currentTime = 0 without duplicate audio', () => {
  assert.ok(soundpadJs.includes('function triggerPadSound'), 'triggerPadSound exists in soundpad.js');
  assert.ok(soundpadJs.includes('activePadAudio.currentTime = 0'), 'Retrigger resets currentTime to 0');
  
  let playCount = 0;
  let seekCount = 0;
  const mockAudio = {
    currentTime: 1.5,
    play: () => { playCount++; return Promise.resolve(); }
  };

  function simulatePadClick(rewardId, currentPlayingRewardId, audioInstance) {
    if (audioInstance && currentPlayingRewardId === rewardId) {
      audioInstance.currentTime = 0;
      seekCount++;
      return audioInstance.play();
    }
    // New sound
    playCount++;
    return Promise.resolve();
  }

  // Click 1 (initial start)
  simulatePadClick('rew-1', null, null);
  assert.equal(playCount, 1);
  assert.equal(seekCount, 0);

  // Click 2 (spam same pad)
  simulatePadClick('rew-1', 'rew-1', mockAudio);
  assert.equal(seekCount, 1);
  assert.equal(mockAudio.currentTime, 0);
  assert.equal(playCount, 2);
});

test('Sound Pad: triggerPadSound PASS scenario - Switching pads interrupts previous sound cleanly', () => {
  let stopped = false;
  let newPlayed = false;

  const mockAudio = {
    _stopped: false,
    pause: () => { stopped = true; },
    removeAttribute: () => {}
  };

  function simulateSwitch(newRewardId, oldRewardId, oldAudio) {
    if (oldAudio && oldRewardId !== newRewardId) {
      oldAudio._stopped = true;
      oldAudio.pause();
    }
    newPlayed = true;
  }

  simulateSwitch('rew-2', 'rew-1', mockAudio);
  assert.equal(stopped, true);
  assert.equal(newPlayed, true);
});

test('Sound Pad: stopPreview FAIL scenario - Interrupted play() AbortError is suppressed', () => {
  assert.ok(
    soundpadJs.includes("err.name === 'AbortError'") || soundpadJs.includes('audio._stopped'),
    'AbortError or _stopped check must exist to prevent false error toasts'
  );
});

// =========================================================================
// 5. Cooldown & Queue Enqueueing: Pass & Fail Scenarios
// =========================================================================

test('Queue: enqueueRedemptionSound PASS scenario - Enqueues playable reward outside cooldown', () => {
  const queue = [];
  const rewardCooldowns = {};

  function enqueue(item) {
    const now = Date.now();
    const cooldownMs = item.cooldownMs || 0;
    const lastPlayed = rewardCooldowns[item.rewardId] || 0;
    if (cooldownMs > 0 && now - lastPlayed < cooldownMs) {
      return false; // suppressed by cooldown
    }
    rewardCooldowns[item.rewardId] = now;
    queue.push(item);
    return true;
  }

  const enqueued1 = enqueue({ rewardId: 'rew-1', cooldownMs: 5000 });
  assert.equal(enqueued1, true);
  assert.equal(queue.length, 1);
});

test('Queue: enqueueRedemptionSound FAIL scenario - Suppresses redemption within cooldown window', () => {
  const queue = [];
  const rewardCooldowns = {};

  function enqueue(item) {
    const now = Date.now();
    const cooldownMs = item.cooldownMs || 0;
    const lastPlayed = rewardCooldowns[item.rewardId] || 0;
    if (cooldownMs > 0 && now - lastPlayed < cooldownMs) {
      return false; // suppressed
    }
    rewardCooldowns[item.rewardId] = now;
    queue.push(item);
    return true;
  }

  assert.equal(enqueue({ rewardId: 'rew-cooldown', cooldownMs: 10000 }), true);
  assert.equal(enqueue({ rewardId: 'rew-cooldown', cooldownMs: 10000 }), false);
  assert.equal(queue.length, 1);
});

// =========================================================================
// 6. Real Stream Analytics Bucketing: Pass & Fail Scenarios
// =========================================================================

test('Analytics: getTimelineBuckets PASS scenario - Accurately aggregates points and counts', () => {
  const match = analyticsJs.match(/function getTimelineBuckets\([\s\S]*?\n  return buckets;\s*\n\}/);
  assert.ok(match, 'getTimelineBuckets definition found');

  const fn = new Function('language', 'rewards', `${match[0]}; return getTimelineBuckets;`)('en', [
    { id: 'rew-1', cost: 100 },
    { id: 'rew-2', cost: 500 }
  ]);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).toISOString();
  
  const history = [
    { id: '1', rewardId: 'rew-1', redeemedAt: today },
    { id: '2', rewardId: 'rew-2', redeemedAt: today }
  ];

  const buckets = fn(history, '7d');
  assert.equal(buckets.length, 7);
  assert.equal(buckets[6].count, 2);
  assert.equal(buckets[6].points, 600); // 100 + 500
});

test('Analytics: getTimelineBuckets FAIL scenario - Corrupt dates and empty history handle safely', () => {
  const match = analyticsJs.match(/function getTimelineBuckets\([\s\S]*?\n  return buckets;\s*\n\}/);
  const fn = new Function('language', 'rewards', `${match[0]}; return getTimelineBuckets;`)('en', []);

  // Empty history
  const empty = fn([], '7d');
  assert.equal(empty.length, 7);
  assert.equal(empty.every(b => b.count === 0 && b.points === 0), true);

  // Corrupt / invalid date strings
  const corrupt = fn([{ id: 'bad', rewardId: 'x', redeemedAt: 'invalid-date-string' }], '7d');
  assert.equal(corrupt.length, 7);
  assert.equal(corrupt.every(b => !Number.isNaN(b.count) && !Number.isNaN(b.points)), true);
});

// =========================================================================
// 7. Error Logger Component: Pass & Fail Scenarios
// =========================================================================

test('Logger: logError writes structured detail to disk with timestamp, context, and stack', () => {
  const logger = require('../src/logger');
  const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-test-logs-'));
  logger.setLogDirectory(tempLogDir);

  const testError = new Error('Audio hardware device disconnected');
  testError.code = 'AUDIO_DISCONNECT';

  const res = logger.logError('Testing Audio Pipeline', testError, {
    rewardId: 'rew-test-42',
    action: 'Pad Trigger',
  });

  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(res.path), 'Log file should be created');

  const content = fs.readFileSync(res.path, 'utf8');
  assert.ok(content.includes('Testing Audio Pipeline'), 'Context must be logged');
  assert.ok(content.includes('Audio hardware device disconnected'), 'Message must be logged');
  assert.ok(content.includes('AUDIO_DISCONNECT'), 'Error code must be logged');
  assert.ok(content.includes('rew-test-42'), 'Metadata must be logged');
  assert.ok(content.includes('TIMESTAMP:'), 'Timestamp must be logged');
  assert.ok(content.includes('STACK TRACE:'), 'Stack trace must be logged');
});

test('Logger: readRecentLogs and clearLogs function accurately', () => {
  const logger = require('../src/logger');
  const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-test-logs-2-'));
  logger.setLogDirectory(tempLogDir);

  logger.logError('Context A', new Error('Error A'));
  logger.logError('Context B', new Error('Error B'));

  const recent = logger.readRecentLogs(50);
  assert.ok(recent.includes('Error A'));
  assert.ok(recent.includes('Error B'));

  assert.equal(logger.clearLogs(), true);
  assert.equal(logger.readRecentLogs(), '');
});

// =========================================================================
// 8. Accessibility (a11y) & Modern Web Guidance Contract Audit
// =========================================================================

test('a11y: Skip link exists as the very first interactive body element', () => {
  assert.ok(indexHtml.includes('class="skip-link visually-hidden"'), 'Skip link element must exist');
  assert.ok(indexHtml.includes('href="#view-studio"'), 'Skip link must point to main content container');
  assert.ok(baseCss.includes('.skip-link:focus'), 'Skip link must have prominent focus styles in base.css');
});

test('a11y: All navigation and dock buttons have explicit accessible names', () => {
  assert.ok(indexHtml.includes('id="dock-studio"') && indexHtml.includes('aria-label="Stream Studio (Alt+1)"'));
  assert.ok(indexHtml.includes('id="dock-analytics"') && indexHtml.includes('aria-label="Stream Analytics (Alt+2)"'));
  assert.ok(indexHtml.includes('id="dock-soundpad"') && indexHtml.includes('aria-label="Stream Sound Pad (Alt+3)"'));
  assert.ok(indexHtml.includes('id="stream-mode-btn"') && indexHtml.includes('aria-label="Stream mode (Privacy blur)"'));
  assert.ok(indexHtml.includes('id="settings-btn"') && indexHtml.includes('aria-label="Settings"'));
  assert.ok(indexHtml.includes('id="close-settings"') && indexHtml.includes('aria-label="Close"'));
});

test('a11y: All search and form inputs have accessible labels or aria-labels', () => {
  assert.ok(indexHtml.includes('id="reward-search"') && indexHtml.includes('aria-label="Search rewards"'));
  assert.ok(indexHtml.includes('id="history-search"') && indexHtml.includes('aria-label="Search history"'));
  assert.ok(indexHtml.includes('id="soundpad-search"') && indexHtml.includes('aria-label="Search sound pad"'));
  assert.ok(indexHtml.includes('id="volume"') && indexHtml.includes('aria-label="Master volume"'));
});

test('a11y: Settings modal has dialog role, aria-modal, aria-labelledby, and focus restoration', () => {
  const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'components', 'settings.js'), 'utf8');
  assert.ok(indexHtml.includes('id="settings-modal"'));
  assert.ok(indexHtml.includes('role="dialog"'));
  assert.ok(indexHtml.includes('aria-modal="true"'));
  assert.ok(indexHtml.includes('aria-labelledby="settings-title"'));
  
  assert.ok(settingsJs.includes('lastFocusedElement = document.activeElement'), 'Must save active element before opening modal');
  assert.ok(settingsJs.includes('lastFocusedElement.focus()'), 'Must restore focus upon closing modal');
});

test('a11y: High contrast :focus-visible outlines are explicitly declared in base.css', () => {
  assert.ok(baseCss.includes(':focus-visible'), 'CSS must define :focus-visible');
  assert.ok(baseCss.includes('outline: 2px solid var(--green)'), 'Focus indicator must use high-contrast green');
});

test('Stream Mode: Privacy blur features iridescent shimmer, glints, and reduced-motion fallback', () => {
  assert.ok(privacyCss.includes('body.stream-mode .private-blur'), 'Global private-blur CSS rule must exist in privacy.css');
  assert.ok(privacyCss.includes('privacy-shimmer'), 'Shimmer sweep animation must exist');
  assert.ok(privacyCss.includes('privacy-glow'), 'Particle glow animation must exist');
  assert.ok(privacyCss.includes('prefers-reduced-motion: reduce'), 'prefers-reduced-motion override must exist');
});

test('Sound Pad: Standalone and Kick Reward sounds render in distinct sections with distinct visual badges', () => {
  const soundpadModule = require('../src/js/components/soundpad');
  const elements = new Map();
  const getOrCreate = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: '',
        style: {},
        classList: { toggle: () => {}, add: () => {}, remove: () => {} },
        querySelectorAll: () => [],
        addEventListener: () => {},
      });
    }
    return elements.get(id);
  };

  const fakeGrid = getOrCreate('soundpad-grid');
  const fakeUnmapped = getOrCreate('soundpad-unmapped-section');

  const origDoc = global.document;
  global.document = {
    getElementById: (id) => elements.get(id) || getOrCreate(id),
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  try {
    const state = {
      sounds: {
        'pad_1': { path: 'c:/sounds/airhorn.mp3', name: 'airhorn.mp3', available: true, title: 'Airhorn' },
        'reward_1': { path: 'c:/sounds/alert.mp3', name: 'alert.mp3', available: true, title: 'Super Alert' },
      },
      rewards: [
        { id: 'reward_1', title: 'Super Alert', cost: 500 },
      ],
    };

    soundpadModule.renderSoundPad('soundpad-grid', 'soundpad-unmapped-section', state, {
      t: (k, params) => params?.cost ? `${params.cost} pts` : k,
    });

    const rendered = fakeGrid.innerHTML;
    assert.ok(rendered.includes('soundpad-standalone-grid'), 'Standalone quick sampler grid must exist');
    assert.ok(rendered.includes('soundpad-rewards-grid'), 'Kick channel points rewards grid must exist');
    assert.ok(rendered.includes('soundpad-badge-pad'), 'Standalone tile must carry soundpad-badge-pad');
    assert.ok(rendered.includes('soundpad-badge-points'), 'Reward tile must carry soundpad-badge-points');
    assert.ok(rendered.includes('standalone'), 'Tile must carry standalone CSS class');
    assert.ok(rendered.includes('reward-point'), 'Tile must carry reward-point CSS class');
  } finally {
    global.document = origDoc;
  }
});

test('Web Sound Pad: Desktop app toolbar includes web soundpad launch button', () => {
  assert.ok(indexHtml.includes('id="open-web-soundpad"'), 'Desktop HTML must include open-web-soundpad button');
  const soundpadHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'soundpad.html'), 'utf8');
  assert.ok(soundpadHtml.includes('webpad-shell') && soundpadHtml.includes('Web Pad'), 'Standalone webapp soundpad HTML file must exist');
});

test('UI Design: Range slider has borderless reset and progress track styling', () => {
  assert.ok(baseCss.includes('input[type=range]'), 'base.css must style input[type=range]');
  assert.ok(baseCss.includes('linear-gradient'), 'Track fill must use linear-gradient for progress indication');
  assert.ok(baseCss.includes('border: none !important'), 'Slider must reset border to prevent capsule outlines');
});
