const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Component imports
const i18nModule = require('../src/js/i18n');
const soundpadModule = require('../src/js/components/soundpad');
const queueModule = require('../src/js/components/queue');
const studioModule = require('../src/js/components/studio');
const analyticsModule = require('../src/js/components/analytics');
const navModule = require('../src/js/components/navigation');

// Helper: Setup mock browser environment (DOM + HTMLAudioElement)
function setupMockDom() {
  const listeners = {};
  const queryMap = {};

  const docElement = {
    lang: 'en',
    dir: 'ltr',
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; }
  };

  const elements = new Map();

  function getOrCreateElement(id, tag = 'div') {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id,
      tagName: tag.toUpperCase(),
      style: {},
      classList: new Set(),
      children: [],
      dataset: {},
      hidden: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      title: '',
      placeholder: '',
      attributes: {},
      offsetWidth: 100,
      scrollIntoView: () => {},
      addEventListener: (evt, fn) => {
        listeners[id] = listeners[id] || {};
        listeners[id][evt] = listeners[id][evt] || [];
        listeners[id][evt].push(fn);
      },
      dispatchEvent: (evt) => {
        const fns = listeners[id]?.[evt.type] || [];
        fns.forEach((fn) => fn(evt));
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      querySelector: (selector) => null,
      querySelectorAll: (selector) => [],
      closest: () => null,
    };
    el.classList.add = (c) => el.classList.add(c);
    el.classList.remove = (c) => el.classList.delete(c);
    el.classList.contains = (c) => el.classList.has(c);
    el.classList.toggle = (c, b) => (b ? el.classList.add(c) : el.classList.delete(c));

    elements.set(id, el);
    return el;
  }

  // Prepopulate standard UI elements
  const stopAllBtn = getOrCreateElement('soundpad-stop-all', 'button');
  const grid = getOrCreateElement('soundpad-grid', 'div');
  const unmapped = getOrCreateElement('soundpad-unmapped-section', 'div');
  const langToggle = getOrCreateElement('lang-toggle', 'button');
  const toast = getOrCreateElement('toast', 'div');

  global.document = {
    documentElement: docElement,
    getElementById: (id) => elements.get(id) || getOrCreateElement(id),
    querySelector: (sel) => {
      if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
      return null;
    },
    querySelectorAll: (sel) => [],
    addEventListener: () => {},
  };

  global.window = {
    document: global.document,
    addEventListener: () => {},
    removeEventListener: () => {},
    clientLogger: {
      logError: (msg, err, extra) => {
        global.loggedErrors.push({ msg, err, extra });
      }
    }
  };

  global.loggedErrors = [];
}

// Mock Audio Class factory
function createMockAudioClass() {
  const instances = [];

  class MockAudio {
    constructor(src = '') {
      this.src = src;
      this.currentTime = 0;
      this.volume = 1;
      this.paused = true;
      this.ended = false;
      this._stopped = false;
      this.sinkId = '';
      this._playPromise = null;
      this._resolvePlay = null;
      this._rejectPlay = null;
      this.onended = null;
      this.onerror = null;

      instances.push(this);
    }

    play() {
      this.paused = false;
      this._playPromise = new Promise((resolve, reject) => {
        this._resolvePlay = resolve;
        this._rejectPlay = reject;
      });
      return this._playPromise;
    }

    pause() {
      this.paused = true;
      if (this._rejectPlay && !this._stopped) {
        const err = new Error('The play() request was interrupted by a call to pause().');
        err.name = 'AbortError';
        this._rejectPlay(err);
      }
    }

    removeAttribute(attr) {
      if (attr === 'src') this.src = '';
    }

    setSinkId(id) {
      this.sinkId = id;
      return Promise.resolve();
    }
  }

  return { MockAudio, instances };
}

// ============================================================================
// SUITE 1: Sound Pad Retriggering (currentTime = 0 spam)
// ============================================================================

test('Challenger 1.1: 10 rapid clicks in 50ms on same pad rewinds currentTime = 0 with zero duplicate Audio instances', async () => {
  setupMockDom();
  const { MockAudio, instances } = createMockAudioClass();
  global.Audio = MockAudio;

  const state = {
    volume: 0.9,
    rewardVolumes: { 'reward-abc': 0.8 },
    sounds: {
      'reward-abc': { name: 'airhorn.mp3', available: true, path: 'C:\\sounds\\airhorn.mp3' }
    },
    rewards: [{ id: 'reward-abc', title: 'Airhorn', cost: 100 }]
  };

  // Click 1: Start playback
  soundpadModule.triggerPadSound('reward-abc', state);
  assert.equal(instances.length, 1, 'Exactly 1 Audio instance must be instantiated on first click');
  const initialAudio = instances[0];
  assert.equal(initialAudio.paused, false, 'Audio must be playing');
  assert.equal(initialAudio.currentTime, 0);

  // Simulate audio having progressed to 1.75 seconds into the track
  initialAudio.currentTime = 1.75;

  // Spam 9 more clicks rapidly (within simulated 50ms interval)
  for (let i = 2; i <= 10; i++) {
    // Progress currentTime slightly to verify rewind
    initialAudio.currentTime = 0.3 * i;
    soundpadModule.triggerPadSound('reward-abc', state);

    assert.equal(
      instances.length,
      1,
      `Click ${i}: Must NOT instantiate a new Audio element! Reusing instance is mandatory to prevent duplicate overlapping audio.`
    );
    assert.equal(
      initialAudio.currentTime,
      0,
      `Click ${i}: activePadAudio.currentTime must be rewound to 0 for instant sampler attack`
    );
  }

  assert.equal(instances.length, 1, 'Final audio instances count must remain 1 after 10 rapid triggers');
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), 'reward-abc');
  assert.equal(soundpadModule.getActivePadAudio(), initialAudio);

  // Cleanup
  soundpadModule.stopAllPadSounds();
  assert.equal(initialAudio.paused, true);
  assert.equal(soundpadModule.getActivePadAudio(), null);
});

test('Challenger 1.2: Triggering soundpad tile when audio ended creates fresh audio cleanly', () => {
  setupMockDom();
  const { MockAudio, instances } = createMockAudioClass();
  global.Audio = MockAudio;

  const state = {
    volume: 0.8,
    sounds: { 'reward-1': { name: 'ding.mp3', available: true } },
    rewards: [{ id: 'reward-1', title: 'Ding' }]
  };

  soundpadModule.triggerPadSound('reward-1', state);
  assert.equal(instances.length, 1);
  const firstAudio = instances[0];

  // Simulate track naturally finishing
  firstAudio.ended = true;
  if (typeof firstAudio.onended === 'function') firstAudio.onended();

  assert.equal(soundpadModule.getActivePadAudio(), null);
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), null);

  // Trigger same pad again
  soundpadModule.triggerPadSound('reward-1', state);
  assert.equal(instances.length, 2, 'Fresh Audio element must be created after previous track ended');
  assert.equal(instances[1].currentTime, 0);
  assert.equal(instances[1].paused, false);

  soundpadModule.stopAllPadSounds();
});

test('Challenger 1.3: Triggering unmapped pad does NOT create Audio and invokes assign handler', () => {
  setupMockDom();
  const { MockAudio, instances } = createMockAudioClass();
  global.Audio = MockAudio;

  let assignedReward = null;
  const state = {
    volume: 0.8,
    sounds: { 'unmapped-rew': null },
    rewards: [{ id: 'unmapped-rew', title: 'Special Dance', cost: 500 }]
  };

  soundpadModule.triggerPadSound('unmapped-rew', state, (reward) => {
    assignedReward = reward;
  });

  assert.equal(instances.length, 0, 'No Audio instance should be created for unmapped reward');
  assert.notEqual(assignedReward, null, 'Assign sound handler must be invoked');
  assert.equal(assignedReward.id, 'unmapped-rew');
});

// ============================================================================
// SUITE 2: Pad Switching Interruption & AbortError Suppression
// ============================================================================

test('Challenger 2.1: Switching pads stops previous audio immediately and suppresses AbortError', async () => {
  setupMockDom();
  const { MockAudio, instances } = createMockAudioClass();
  global.Audio = MockAudio;

  const state = {
    volume: 0.8,
    sounds: {
      'pad-1': { name: 'sound1.mp3', available: true },
      'pad-2': { name: 'sound2.mp3', available: true }
    },
    rewards: [
      { id: 'pad-1', title: 'Sound 1' },
      { id: 'pad-2', title: 'Sound 2' }
    ]
  };

  // Play Pad 1
  soundpadModule.triggerPadSound('pad-1', state);
  assert.equal(instances.length, 1);
  const audio1 = instances[0];
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), 'pad-1');

  // Switch to Pad 2 while Pad 1 is playing
  soundpadModule.triggerPadSound('pad-2', state);
  assert.equal(instances.length, 2);
  const audio2 = instances[1];

  // Verify Pad 1 was halted immediately
  assert.equal(audio1.paused, true, 'Pad 1 must be paused immediately');
  assert.equal(audio1._stopped, true, 'Pad 1 _stopped flag must be set to true');
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), 'pad-2', 'Pad 2 must become active');
  assert.equal(soundpadModule.getActivePadAudio(), audio2);

  // Simulate Pad 1's play() promise rejecting with AbortError
  const abortErr = new Error('The play() request was interrupted by a call to pause().');
  abortErr.name = 'AbortError';
  if (audio1._rejectPlay) {
    audio1._rejectPlay(abortErr);
  }

  // Allow microtask queue to process rejection handlers
  await Promise.resolve();
  await Promise.resolve();

  // Verify AbortError was suppressed and NOT logged to clientLogger
  const abortLogs = global.loggedErrors.filter((e) => e.err?.name === 'AbortError');
  assert.equal(abortLogs.length, 0, 'AbortError must be suppressed without logging');

  // Verify Pad 2 was NOT interrupted by Pad 1's rejection handler!
  assert.equal(soundpadModule.getActivePadAudio(), audio2, 'Pad 2 must still be active pad audio');
  assert.equal(audio2.paused, false, 'Pad 2 must still be playing');

  soundpadModule.stopAllPadSounds();
});

test('Challenger 2.3: panicStopAll halts active SoundPad, preview, queue playback, and clears waiting queue', () => {
  setupMockDom();
  const { MockAudio, instances } = createMockAudioClass();
  global.Audio = MockAudio;

  const rendererModule = require('../src/renderer');

  const state = rendererModule.state;
  state.volume = 0.8;
  state.sounds = {
    'pad-panic': { name: 'horn.mp3', available: true }
  };
  state.rewards = [{ id: 'pad-panic', title: 'Horn' }];
  state.queue = [];

  // 1. Start Sound Pad sound
  rendererModule.triggerPadSound('pad-panic');
  assert.notEqual(soundpadModule.getActivePadAudio(), null, 'Sound pad audio must be active');
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), 'pad-panic');

  // 2. Start Preview sound
  rendererModule.playPreview('pad-panic');
  assert.notEqual(queueModule.getActivePreviewAudio(), null, 'Preview audio must be active');

  // 3. Enqueue 2 queue items
  rendererModule.enqueueRedemptionSound({ rewardId: 'pad-panic', redemptionId: 'r1' });
  rendererModule.enqueueRedemptionSound({ rewardId: 'pad-panic', redemptionId: 'r2' });
  assert.equal(queueModule.getCurrentItem()?.redemptionId, 'r1', 'First queue item playing');
  assert.equal(state.queue.length, 1, 'Second queue item waiting');

  // 4. Trigger PANIC STOP
  rendererModule.panicStopAll();

  // Verify all audio stopped immediately
  assert.equal(soundpadModule.getActivePadAudio(), null, 'Sound pad audio must be stopped');
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), null);
  assert.equal(queueModule.getActivePreviewAudio(), null, 'Preview audio must be stopped');
  assert.equal(queueModule.getCurrentPlayingPreviewRewardId(), null);
  assert.equal(queueModule.getCurrentItem(), null, 'Active queue item must be null');
  assert.equal(state.queue.length, 0, 'Waiting queue must be completely cleared');

  // Reset queue module paused state for next tests
  queueModule.resumeQueue(state);
});


// ============================================================================
// SUITE 3: Queue Preview Interruption & Cooldown Arbitration
// ============================================================================

test('Challenger 3.1: Queue playPreview halts on repeat click and suppresses AbortError', async () => {
  setupMockDom();
  const { MockAudio, instances } = createMockAudioClass();
  global.Audio = MockAudio;

  const state = { volume: 0.7, rewardVolumes: {} };

  // First click: plays preview
  queueModule.playPreview('reward-10', state);
  assert.equal(instances.length, 1);
  const preview1 = instances[0];
  assert.equal(queueModule.getCurrentPlayingPreviewRewardId(), 'reward-10');

  // Repeat click: should stop preview (toggle behavior)
  queueModule.playPreview('reward-10', state);
  assert.equal(queueModule.getCurrentPlayingPreviewRewardId(), null);
  assert.equal(preview1.paused, true);
  assert.equal(preview1._stopped, true);

  // Reject with AbortError
  const abortErr = new Error('The play() request was interrupted by a call to pause().');
  abortErr.name = 'AbortError';
  if (preview1._rejectPlay) preview1._rejectPlay(abortErr);

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(global.loggedErrors.filter((e) => e.err?.name === 'AbortError').length, 0);
});

test('Challenger 3.2: Queue cooldown arbitration uses activeCooldowns and does not corrupt rewardCooldowns', () => {
  const state = {
    volume: 0.8,
    rewardCooldowns: { 'reward-fast': 15 }, // Configured duration: 15 seconds
    activeCooldowns: {},
    queue: []
  };

  // Enqueue 1: Outside cooldown
  const enqueued1 = queueModule.enqueueRedemptionSound(
    { rewardId: 'reward-fast', redemptionId: 'red-1', cooldownMs: 15000 },
    state
  );
  assert.equal(enqueued1, true, 'First redemption must be enqueued');
  // First item is immediately transferred to currentItem for playback since queue was not busy
  assert.equal(queueModule.getCurrentItem()?.rewardId, 'reward-fast');
  assert.equal(state.queue.length, 0);

  // Verify rewardCooldowns duration setting was NOT overwritten with timestamp
  assert.equal(state.rewardCooldowns['reward-fast'], 15, 'state.rewardCooldowns must remain 15, not an epoch timestamp');
  assert.ok(state.activeCooldowns['reward-fast'] > 1700000000000, 'activeCooldowns must store the epoch timestamp');

  // Enqueue 2: A different reward while currentItem is active -> stays in waiting queue
  const enqueuedOther = queueModule.enqueueRedemptionSound(
    { rewardId: 'reward-slow', redemptionId: 'red-other', cooldownMs: 5000 },
    state
  );
  assert.equal(enqueuedOther, true, 'Different reward outside its cooldown must be enqueued');
  assert.equal(state.queue.length, 1, 'Waiting queue must now have 1 item');

  // Enqueue 3: Spam reward-fast within its 15000ms cooldown window
  const enqueuedSpam = queueModule.enqueueRedemptionSound(
    { rewardId: 'reward-fast', redemptionId: 'red-2', cooldownMs: 15000 },
    state
  );
  assert.equal(enqueuedSpam, false, 'Spam within cooldown window must be rejected');
  assert.equal(state.queue.length, 1, 'Queue length must not increment on suppressed spam');
  assert.equal(state.rewardCooldowns['reward-fast'], 15, 'rewardCooldowns duration remains unchanged');

  // Cleanup queue state
  queueModule.stopQueue(state);
  queueModule.clearQueue(state);
});

// ============================================================================
// SUITE 4: Bilingual Parity, Placeholder Matching & RTL Layout
// ============================================================================

test('Challenger 4.1: 100% Dictionary Key Parity between English and Persian', () => {
  const enKeys = Object.keys(i18nModule.translations.en).sort();
  const faKeys = Object.keys(i18nModule.translations.fa).sort();

  const missingInFa = enKeys.filter((k) => !(k in i18nModule.translations.fa));
  const missingInEn = faKeys.filter((k) => !(k in i18nModule.translations.en));

  assert.deepEqual(missingInFa, [], `Keys present in EN but missing in FA: ${missingInFa.join(', ')}`);
  assert.deepEqual(missingInEn, [], `Keys present in FA but missing in EN: ${missingInEn.join(', ')}`);
  assert.equal(enKeys.length, faKeys.length, 'English and Persian must have identical key count');
});

test('Challenger 4.2: Parameter Placeholder Integrity across EN and FA', () => {
  const { en, fa } = i18nModule.translations;
  const placeholderRegex = /\{([a-zA-Z0-9_]+)\}/g;

  for (const key of Object.keys(en)) {
    const enPlaceholders = [...(en[key] || '').matchAll(placeholderRegex)].map((m) => m[1]).sort();
    const faPlaceholders = [...(fa[key] || '').matchAll(placeholderRegex)].map((m) => m[1]).sort();

    assert.deepEqual(
      faPlaceholders,
      enPlaceholders,
      `Placeholder mismatch in key '${key}': EN has [${enPlaceholders}], FA has [${faPlaceholders}]`
    );
  }
});

test('Challenger 4.3: HTML data-i18n attributes match translation dictionary keys', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const { en } = i18nModule.translations;

  const matches = [...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  const missingKeys = [...new Set(matches)].filter((k) => !(k in en));

  assert.deepEqual(
    missingKeys,
    [],
    `HTML contains data-i18n keys that do not exist in translation dictionary: ${missingKeys.join(', ')}`
  );
});

test('Challenger 4.4: Persian Language Application sets dir="rtl", lang="fa" and toggle label', () => {
  setupMockDom();

  // Test applyLanguage to Persian
  i18nModule.applyLanguage('fa');
  assert.equal(global.document.documentElement.lang, 'fa');
  assert.equal(global.document.documentElement.dir, 'rtl');
  assert.equal(i18nModule.getLanguage(), 'fa');

  const langBtn = global.document.getElementById('lang-toggle');
  assert.equal(langBtn.textContent, 'English', 'Toggle button in Persian mode should offer switch to English');

  // Test applyLanguage to English
  i18nModule.applyLanguage('en');
  assert.equal(global.document.documentElement.lang, 'en');
  assert.equal(global.document.documentElement.dir, 'ltr');
  assert.equal(i18nModule.getLanguage(), 'en');
  assert.equal(langBtn.textContent, 'فارسی', 'Toggle button in English mode should offer switch to فارسی');
});

test('Challenger 4.5: RTL CSS rules exist for directional layout elements', () => {
  const cssDir = path.join(__dirname, '..', 'src', 'css');
  const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
  let totalRtlRules = 0;

  for (const f of cssFiles) {
    const content = fs.readFileSync(path.join(cssDir, f), 'utf8');
    const matches = content.match(/\[dir=["']?rtl["']?\]/g);
    if (matches) totalRtlRules += matches.length;
  }

  assert.ok(totalRtlRules >= 6, `Expected at least 6 [dir="rtl"] CSS rules across stylesheets, found ${totalRtlRules}`);
});

test('Challenger 4.6: JavaScript t(...) invocations match translation dictionary keys', () => {
  const { en } = i18nModule.translations;
  const srcFiles = [
    path.join(__dirname, '..', 'src', 'renderer.js'),
    path.join(__dirname, '..', 'src', 'js', 'components', 'navigation.js'),
    path.join(__dirname, '..', 'src', 'js', 'components', 'studio.js'),
    path.join(__dirname, '..', 'src', 'js', 'components', 'soundpad.js'),
    path.join(__dirname, '..', 'src', 'js', 'components', 'queue.js'),
    path.join(__dirname, '..', 'src', 'js', 'components', 'analytics.js'),
    path.join(__dirname, '..', 'src', 'js', 'components', 'settings.js'),
  ];

  const missingCalls = [];
  for (const f of srcFiles) {
    if (!fs.existsSync(f)) continue;
    const content = fs.readFileSync(f, 'utf8');
    const matches = [...content.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const key of matches) {
      if (!(key in en)) {
        missingCalls.push({ file: path.basename(f), key });
      }
    }
  }

  assert.deepEqual(
    missingCalls,
    [],
    `JavaScript sources contain t() calls with missing keys: ${JSON.stringify(missingCalls)}`
  );
});

test('Challenger 4.7: Clear history confirmation prompt uses clearHistoryConfirm, not confirmDisconnect', () => {
  const rendererContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const clearHistoryMatch = rendererContent.match(/\$\('#clear-history'\)\?\.addEventListener\('click'[\s\S]*?confirm\(([^)]+)\)/);
  assert.ok(clearHistoryMatch, 'clear-history event listener must exist');
  assert.ok(
    clearHistoryMatch[1].includes('clearHistoryConfirm'),
    `Expected clear-history confirmation to use clearHistoryConfirm, but found: ${clearHistoryMatch[1]}`
  );
});


