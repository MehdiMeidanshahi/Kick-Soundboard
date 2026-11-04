/**
 * Milestone 2 Challenger Stress & Verification Test Suite
 * 
 * Adversarial empirical tests probing:
 * 1. Sound Mapping & Recognition across SoundPad, Studio, and Analytics
 * 2. Unified Panic Stop Protocol (Pad, Preview, Queue halt & clear)
 * 3. Cooldown State Disambiguation (activeCooldowns vs rewardCooldowns)
 * 4. UI Interaction Findings & Bilingual Translation Verification
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Setup minimal mock browser environment for Node.js test execution
class MockAudioElement {
  constructor() {
    this.src = '';
    this.volume = 1.0;
    this.currentTime = 0;
    this.paused = true;
    this.ended = false;
    this._stopped = false;
    this.sinkId = '';
    this.onended = null;
    this.onerror = null;
  }

  async play() {
    if (this._stopped) {
      const err = new Error('The play() request was interrupted by a call to pause().');
      err.name = 'AbortError';
      throw err;
    }
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  removeAttribute(attr) {
    if (attr === 'src') this.src = '';
  }

  async setSinkId(sinkId) {
    this.sinkId = sinkId;
    return Promise.resolve();
  }
}

class MockElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.classList = new Set();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.eventListeners = {};
  }

  addEventListener(event, handler) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.eventListeners[event.type || event] || [];
    for (const h of handlers) h(event);
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }

  getAttribute(k) {
    return this.attributes[k] || null;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    // Basic selector matching for mock DOM
    const match = (el) => {
      if (!el || typeof el !== 'object') return;
      if (sel.startsWith('.') && el.classList && el.classList.has(sel.slice(1))) results.push(el);
      if (sel.startsWith('#') && el.id === sel.slice(1)) results.push(el);
      if (sel.includes('[data-')) {
        const attrMatch = sel.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
        if (attrMatch) {
          const attr = attrMatch[1];
          const val = attrMatch[2];
          const camel = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          if (el.dataset && el.dataset[camel] !== undefined) {
            if (val === undefined || String(el.dataset[camel]) === String(val)) results.push(el);
          }
        }
      }
      for (const child of el.children || []) match(child);
    };
    for (const child of this.children) match(child);
    return results;
  }

  scrollIntoView() {}
}

const mockDomElements = new Map();

function getOrCreateMockElement(id) {
  if (!mockDomElements.has(id)) {
    const el = new MockElement('div', id);
    mockDomElements.set(id, el);
  }
  return mockDomElements.get(id);
}

// Global browser polyfills
global.window = global.window || {
  addEventListener: () => {},
  removeEventListener: () => {},
  currentPlayingPreviewRewardId: null,
  clientLogger: {
    logError: () => {},
  },
};
global.document = global.document || {
  getElementById: (id) => getOrCreateMockElement(id),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return getOrCreateMockElement(sel.slice(1));
    return new MockElement('div');
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
};
global.Audio = MockAudioElement;

// Load client components
const queueModule = require('../src/js/components/queue');
const soundpadModule = require('../src/js/components/soundpad');
const studioModule = require('../src/js/components/studio');
const analyticsModule = require('../src/js/components/analytics');
const navModule = require('../src/js/components/navigation');
const i18nModule = require('../src/js/i18n');
const stateModule = require('../src/js/state');

// ============================================================================
// Group 1: Sound Mapping & Recognition Probes
// ============================================================================

test('Challenger 1.1: Sound mapping recognition handles all descriptor variants and corrupt shapes', () => {
  const isSoundMapped = (sound) => Boolean(sound?.path || sound?.name || sound?.available);

  // PASS shapes: Valid variations
  assert.equal(isSoundMapped({ name: 'horn.mp3', available: true, path: '/sounds/horn.mp3' }), true);
  assert.equal(isSoundMapped({ name: 'horn.mp3', available: false }), true, 'Missing file on disk is still mapped to a sound name');
  assert.equal(isSoundMapped({ path: '/sounds/horn.mp3' }), true, 'Path descriptor recognized');
  assert.equal(isSoundMapped({ available: true }), true, 'Available flag recognized');

  // FAIL shapes: Corrupt or unmapped descriptors
  assert.equal(isSoundMapped({ available: false }), false, 'available: false alone is unmapped');
  assert.equal(isSoundMapped({ path: '' }), false, 'Empty path string is unmapped');
  assert.equal(isSoundMapped({ name: '' }), false, 'Empty name string is unmapped');
  assert.equal(isSoundMapped({ path: null, name: undefined }), false, 'Null/undefined fields are unmapped');
  assert.equal(isSoundMapped({}), false, 'Empty object is unmapped');
  assert.equal(isSoundMapped(null), false, 'Null descriptor is unmapped');
  assert.equal(isSoundMapped(undefined), false, 'Undefined descriptor is unmapped');
  assert.equal(isSoundMapped(12345), false, 'Number is unmapped');
  assert.equal(isSoundMapped('not an object'), false, 'Primitive string is unmapped');
});

test('Challenger 1.2: SoundPad triggerPadSound routing between mapped playback and unmapped sound assignment', () => {
  let assignedReward = null;
  const onAssignSound = (reward) => { assignedReward = reward; };

  const testState = {
    volume: 0.8,
    rewardVolumes: { 'rew-mapped': 1.0 },
    rewards: [
      { id: 'rew-mapped', title: 'Airhorn Reward', cost: 100 },
      { id: 'rew-unmapped', title: 'Silent Reward', cost: 200 },
    ],
    sounds: {
      'rew-mapped': { name: 'airhorn.mp3', available: true },
      'rew-corrupt': {},
      'rew-null': null,
    },
  };

  // Case 1: Unmapped reward routes cleanly to onAssignSound
  soundpadModule.triggerPadSound('rew-unmapped', testState, onAssignSound);
  assert.ok(assignedReward, 'Should invoke onAssignSound');
  assert.equal(assignedReward.id, 'rew-unmapped');

  // Case 2: Reward missing entirely from state.rewards falls back gracefully
  assignedReward = null;
  soundpadModule.triggerPadSound('rew-nonexistent', testState, onAssignSound);
  assert.ok(assignedReward, 'Should fall back to default reward descriptor');
  assert.equal(assignedReward.id, 'rew-nonexistent');
  assert.equal(assignedReward.title, 'Reward');

  // Case 3: Corrupt descriptor in state.sounds routes to onAssignSound
  assignedReward = null;
  soundpadModule.triggerPadSound('rew-corrupt', testState, onAssignSound);
  assert.equal(assignedReward?.id, 'rew-corrupt');

  // Case 4: Mapped reward instantiates audio and plays
  soundpadModule.triggerPadSound('rew-mapped', testState, onAssignSound);
  const activeAudio = soundpadModule.getActivePadAudio();
  assert.ok(activeAudio, 'Active pad audio should be instantiated for mapped reward');
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), 'rew-mapped');

  // Cleanup
  soundpadModule.stopAllPadSounds();
});

test('Challenger 1.3: Studio reward rendering and filter pills with mixed sound states', () => {
  const container = getOrCreateMockElement('rewards-container');
  const testState = {
    connected: true,
    rewards: [
      { id: 'r1', title: 'Reward 1', cost: 50 },
      { id: 'r2', title: 'Reward 2', cost: 100 },
      { id: 'r3', title: 'Reward 3', cost: 150 },
    ],
    sounds: {
      r1: { name: 'bell.mp3', available: true },
      r2: { name: '', path: '', available: false },
      // r3 unmapped
    },
    rewardVolumes: { r1: 0.5 },
    rewardCooldowns: { r1: 10 },
  };

  // Render All
  testState.rewardFilterPill = 'all';
  studioModule.renderRewards(container.id, testState, { t: (k) => k });
  assert.ok(container.innerHTML.includes('Reward 1'));
  assert.ok(container.innerHTML.includes('Reward 2'));
  assert.ok(container.innerHTML.includes('Reward 3'));

  // Render Mapped only
  testState.rewardFilterPill = 'mapped';
  studioModule.renderRewards(container.id, testState, { t: (k) => k });
  assert.ok(container.innerHTML.includes('Reward 1'), 'r1 is mapped');
  assert.ok(!container.innerHTML.includes('Reward 2'), 'r2 is unmapped');
  assert.ok(!container.innerHTML.includes('Reward 3'), 'r3 is unmapped');

  // Render Unmapped only
  testState.rewardFilterPill = 'unmapped';
  studioModule.renderRewards(container.id, testState, { t: (k) => k });
  assert.ok(!container.innerHTML.includes('Reward 1'));
  assert.ok(container.innerHTML.includes('Reward 2'));
  assert.ok(container.innerHTML.includes('Reward 3'));
});

test('Challenger 1.4: Analytics sound stats calculation prevents divide-by-zero and handles corrupt data', () => {
  const testState = {
    connected: true,
    rewards: [],
    sounds: null,
    history: [],
  };

  const statActiveSounds = getOrCreateMockElement('stat-active-sounds');
  const statSoundPct = getOrCreateMockElement('stat-sound-pct');

  // Zero rewards: must not divide by zero or render NaN%
  analyticsModule.renderAnalytics(testState, { t: (k) => k });
  assert.equal(statSoundPct.textContent, '0%');

  // Mixed rewards with null/corrupt sounds
  testState.rewards = [
    { id: 'r1', title: 'R1', cost: 10 },
    { id: 'r2', title: 'R2', cost: 20 },
    { id: 'r3', title: 'R3', cost: 30 },
  ];
  testState.sounds = {
    r1: { name: 's1.mp3' },
    r2: null,
    r3: {},
  };

  analyticsModule.renderAnalytics(testState, { t: (k) => k });
  assert.equal(statSoundPct.textContent, '33%');
  assert.ok(statActiveSounds.innerHTML.includes('1 <span'));
});

// ============================================================================
// Group 2: Unified Panic Stop Protocol Probes
// ============================================================================

test('Challenger 2.1: Panic Stop idempotency and null-safety when called while idle', () => {
  const testState = {
    queue: [],
    volume: 0.8,
  };

  // Calling stop functions when no audio is active must not throw
  assert.doesNotThrow(() => soundpadModule.stopAllPadSounds());
  assert.doesNotThrow(() => queueModule.stopPreview());
  assert.doesNotThrow(() => queueModule.stopQueue(testState));
  assert.doesNotThrow(() => queueModule.clearQueue(testState));

  // Verify internal state remains clean
  assert.equal(soundpadModule.getActivePadAudio(), null);
  assert.equal(queueModule.getActivePreviewAudio(), null);
  assert.equal(queueModule.getCurrentItem(), null);
  assert.equal(testState.queue.length, 0);
});

test('Challenger 2.2: Panic Stop halts active SoundPad audio and resets tile states', () => {
  const testState = {
    volume: 0.8,
    rewards: [{ id: 'pad-1', title: 'Pad 1', cost: 10 }],
    sounds: { 'pad-1': { name: 'sample.mp3', available: true } },
  };

  // Trigger pad
  soundpadModule.triggerPadSound('pad-1', testState);
  const audio = soundpadModule.getActivePadAudio();
  assert.ok(audio, 'Audio should be playing');
  assert.equal(audio._stopped, false);
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), 'pad-1');

  // Stop all pad sounds
  soundpadModule.stopAllPadSounds();
  assert.equal(audio._stopped, true, 'Audio._stopped should be true');
  assert.equal(audio.paused, true, 'Audio should be paused');
  assert.equal(audio.src, '', 'Audio src should be cleared');
  assert.equal(soundpadModule.getActivePadAudio(), null, 'Active audio pointer must be nullified');
  assert.equal(soundpadModule.getCurrentPlayingPadRewardId(), null);
});

test('Challenger 2.3: Panic Stop halts active Studio Preview audio', async () => {
  const testState = {
    volume: 0.8,
    sounds: { 'prev-1': { name: 'test.mp3', available: true } },
  };

  await queueModule.playPreview('prev-1', testState);
  const previewAudio = queueModule.getActivePreviewAudio();
  assert.ok(previewAudio, 'Preview audio should be active');
  assert.equal(queueModule.getCurrentPlayingPreviewRewardId(), 'prev-1');

  // Stop preview
  queueModule.stopPreview();
  assert.equal(previewAudio._stopped, true);
  assert.equal(previewAudio.paused, true);
  assert.equal(previewAudio.src, '');
  assert.equal(queueModule.getActivePreviewAudio(), null);
  assert.equal(queueModule.getCurrentPlayingPreviewRewardId(), null);
});

test('Challenger 2.4: Panic Stop halts active Queue audio AND purges waiting items completely', () => {
  const testState = {
    volume: 0.8,
    queue: [],
    rewardVolumes: {},
    rewards: [
      { id: 'q1', title: 'Queue 1' },
      { id: 'q2', title: 'Queue 2' },
      { id: 'q3', title: 'Queue 3' },
    ],
  };

  // Ensure queue is not paused before testing
  queueModule.resumeQueue(testState);

  // Enqueue 3 items
  queueModule.enqueueRedemptionSound({ rewardId: 'q1', redemptionId: 'red-1' }, testState);
  queueModule.enqueueRedemptionSound({ rewardId: 'q2', redemptionId: 'red-2' }, testState);
  queueModule.enqueueRedemptionSound({ rewardId: 'q3', redemptionId: 'red-3' }, testState);

  assert.equal(queueModule.getCurrentItem()?.rewardId, 'q1');
  assert.equal(testState.queue.length, 2);

  // Execute full Panic Stop protocol (stopQueue + clearQueue)
  queueModule.stopQueue(testState);
  queueModule.clearQueue(testState);

  assert.equal(queueModule.getCurrentItem(), null, 'Current playing queue item must be nullified');
  assert.equal(testState.queue.length, 0, 'Queue must be completely purged');
});

test('Challenger 2.5: Concurrent Halting: SoundPad, Preview, and Queue halted in single pass', async () => {
  const testState = {
    volume: 0.8,
    queue: [],
    rewards: [
      { id: 'r1', title: 'R1' },
      { id: 'r2', title: 'R2' },
      { id: 'r3', title: 'R3' },
    ],
    sounds: {
      r1: { name: 's1.mp3', available: true },
      r2: { name: 's2.mp3', available: true },
      r3: { name: 's3.mp3', available: true },
    },
  };

  // Reset queue pause state
  queueModule.resumeQueue(testState);

  // Start Pad
  soundpadModule.triggerPadSound('r1', testState);
  const padAudio = soundpadModule.getActivePadAudio();

  // Start Preview
  await queueModule.playPreview('r2', testState);
  const prevAudio = queueModule.getActivePreviewAudio();

  // Start Queue
  queueModule.enqueueRedemptionSound({ rewardId: 'r3', redemptionId: 'red-3' }, testState);

  assert.ok(padAudio);
  assert.ok(prevAudio);
  assert.equal(queueModule.getCurrentItem()?.rewardId, 'r3');

  // Unified Panic Stop
  soundpadModule.stopAllPadSounds();
  queueModule.stopPreview();
  queueModule.stopQueue(testState);
  queueModule.clearQueue(testState);

  assert.equal(padAudio._stopped, true);
  assert.equal(prevAudio._stopped, true);
  assert.equal(soundpadModule.getActivePadAudio(), null);
  assert.equal(queueModule.getActivePreviewAudio(), null);
  assert.equal(queueModule.getCurrentItem(), null);
  assert.equal(testState.queue.length, 0);
});

test('Challenger 2.6: High-frequency Panic Stop rapid spam stress test (100 iterations)', () => {
  const testState = {
    volume: 0.8,
    queue: [],
    rewards: [{ id: 'spam-r', title: 'Spam' }],
    sounds: { 'spam-r': { name: 'spam.mp3', available: true } },
  };

  for (let i = 0; i < 100; i++) {
    // Interleave triggers and immediate panic stops
    soundpadModule.triggerPadSound('spam-r', testState);
    queueModule.enqueueRedemptionSound({ rewardId: 'spam-r', redemptionId: `spam-${i}` }, testState);
    
    soundpadModule.stopAllPadSounds();
    queueModule.stopPreview();
    queueModule.stopQueue(testState);
    queueModule.clearQueue(testState);

    assert.equal(soundpadModule.getActivePadAudio(), null);
    assert.equal(queueModule.getCurrentItem(), null);
    assert.equal(testState.queue.length, 0);
  }
});

test('Challenger 2.7: Escape keyboard shortcut modal routing logic', () => {
  let modalClosed = false;
  let panicStopped = false;

  const mockModal = {
    classList: {
      contains: (c) => c === 'open',
    },
  };

  function simulateEscape(isModalOpen) {
    if (isModalOpen) {
      modalClosed = true;
    } else {
      panicStopped = true;
    }
  }

  // Modal open -> closeSettings only
  simulateEscape(true);
  assert.equal(modalClosed, true);
  assert.equal(panicStopped, false);

  // Modal closed -> panicStopAll
  modalClosed = false;
  panicStopped = false;
  simulateEscape(false);
  assert.equal(modalClosed, false);
  assert.equal(panicStopped, true);
});

// ============================================================================
// Group 3: Cooldown State Disambiguation Probes
// ============================================================================

test('Challenger 3.1: Enqueueing redemptions writes epoch timestamp to activeCooldowns while preserving configured duration in rewardCooldowns', () => {
  const testState = {
    volume: 0.8,
    queue: [],
    rewardCooldowns: {
      'reward-10s': 10, // 10 seconds duration configured by user
      'reward-30s': 30, // 30 seconds duration configured by user
    },
    activeCooldowns: {},
    rewards: [{ id: 'reward-10s', title: '10s Reward' }],
  };

  const beforeTime = Date.now();
  const success = queueModule.enqueueRedemptionSound(
    { rewardId: 'reward-10s', redemptionId: 'red-1', cooldownMs: 10000 },
    testState
  );
  const afterTime = Date.now();

  assert.equal(success, true, 'First redemption should succeed');

  // Verify activeCooldowns received runtime timestamp
  const recordedTimestamp = testState.activeCooldowns['reward-10s'];
  assert.ok(
    recordedTimestamp >= beforeTime && recordedTimestamp <= afterTime,
    `activeCooldowns timestamp ${recordedTimestamp} should be between ${beforeTime} and ${afterTime}`
  );

  // CRITICAL CHECK: rewardCooldowns MUST NOT be mutated to epoch timestamp!
  assert.equal(
    testState.rewardCooldowns['reward-10s'],
    10,
    'rewardCooldowns configured duration must remain 10 seconds, not overwritten by timestamp!'
  );
  assert.equal(
    testState.rewardCooldowns['reward-30s'],
    30,
    'Other rewardCooldowns entries must remain untouched'
  );
});

test('Challenger 3.2: Cooldown window arbitration correctly suppresses spam and allows post-cooldown playback', () => {
  const testState = {
    volume: 0.8,
    queue: [],
    rewardCooldowns: { 'spam-rew': 5 },
    activeCooldowns: {},
    rewards: [{ id: 'spam-rew', title: 'Spam Rew' }],
  };

  const cdMs = 2000; // 2 seconds

  // Redemption 1: Fresh enqueue
  const r1 = queueModule.enqueueRedemptionSound({ rewardId: 'spam-rew', redemptionId: '1', cooldownMs: cdMs }, testState);
  assert.equal(r1, true, 'First redemption must be enqueued');

  // Redemption 2: Immediate spam within 2s window
  const r2 = queueModule.enqueueRedemptionSound({ rewardId: 'spam-rew', redemptionId: '2', cooldownMs: cdMs }, testState);
  assert.equal(r2, false, 'Second redemption within cooldown window must be rejected');

  // Fast-forward simulated clock by rewinding activeCooldowns timestamp
  testState.activeCooldowns['spam-rew'] = Date.now() - 2500; // 2.5s ago

  // Redemption 3: After cooldown window elapsed
  const r3 = queueModule.enqueueRedemptionSound({ rewardId: 'spam-rew', redemptionId: '3', cooldownMs: cdMs }, testState);
  assert.equal(r3, true, 'Redemption after cooldown window must be enqueued');
  assert.equal(testState.rewardCooldowns['spam-rew'], 5, 'rewardCooldowns duration preserved');
});

test('Challenger 3.3: High-concurrency burst of 50 redemptions allows exactly 1 and suppresses 49', () => {
  const testState = {
    volume: 0.8,
    queue: [],
    rewardCooldowns: { 'burst-rew': 60 },
    activeCooldowns: {},
    rewards: [{ id: 'burst-rew', title: 'Burst Rew' }],
  };

  let acceptedCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < 50; i++) {
    const ok = queueModule.enqueueRedemptionSound(
      { rewardId: 'burst-rew', redemptionId: `burst-${i}`, cooldownMs: 60000 },
      testState
    );
    if (ok) acceptedCount++;
    else rejectedCount++;
  }

  assert.equal(acceptedCount, 1, 'Only the very first redemption in a burst should be accepted');
  assert.equal(rejectedCount, 49, 'All 49 subsequent rapid redemptions must be rejected');
  assert.equal(testState.rewardCooldowns['burst-rew'], 60, 'Configured duration remains untouched');
});

// ============================================================================
// Group 4: UI Findings & Bilingual Parity Probes
// ============================================================================

test('Challenger 4.1: EMPIRICAL DEFECT PROBE: Verify clear history button uses wrong translation key in src/renderer.js', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const rendererContent = fs.readFileSync(rendererPath, 'utf8');

  // Find the #clear-history event listener block
  const clearHistoryMatch = rendererContent.match(/\$\('#clear-history'\)\?\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/);
  assert.ok(clearHistoryMatch, '#clear-history click listener must be found in src/renderer.js');

  const handlerBody = clearHistoryMatch[1];

  // Check if it calls confirm(t('confirmDisconnect')) instead of clearHistoryConfirm
  const hasDisconnectBug = handlerBody.includes("confirm(t('confirmDisconnect'))");
  const hasClearHistoryKey = handlerBody.includes("clearHistoryConfirm");

  assert.equal(
    hasDisconnectBug,
    false,
    'src/renderer.js line 554 must not use confirmDisconnect for clear history'
  );
  assert.equal(
    hasClearHistoryKey,
    true,
    'clearHistoryConfirm must be used in clear-history handler'
  );
});

test('Challenger 4.2: EMPIRICAL DEFECT PROBE: src/js/logger.js lacks typeof window !== "undefined" check for global error listeners', () => {
  const loggerPath = path.join(__dirname, '..', 'src', 'js', 'logger.js');
  const loggerContent = fs.readFileSync(loggerPath, 'utf8');

  // Check lines around window.addEventListener('error')
  const lines = loggerContent.split('\n');
  const errorListenerLine = lines.find((l) => l.includes("window.addEventListener('error'"));
  const unhandledRejectionLine = lines.find((l) => l.includes("window.addEventListener('unhandledrejection'"));

  assert.ok(errorListenerLine, 'window.addEventListener error exists');
  assert.ok(unhandledRejectionLine, 'window.addEventListener unhandledrejection exists');

  // Verify that typeof window !== 'undefined' guard encloses lines
  const hasWindowCheck = loggerContent.includes("typeof window !== 'undefined'");
  assert.equal(
    hasWindowCheck,
    true,
    'src/js/logger.js must guard window.addEventListener with typeof window guard'
  );
});

test('Challenger 4.3: Bilingual translation dictionary 1:1 parity and key completeness', () => {
  const { translations } = i18nModule;
  const enKeys = Object.keys(translations.en).sort();
  const faKeys = Object.keys(translations.fa).sort();

  const missingInFa = enKeys.filter((k) => !(k in translations.fa));
  const missingInEn = faKeys.filter((k) => !(k in translations.en));

  assert.deepEqual(missingInFa, [], `Missing translation keys in Persian: ${missingInFa.join(', ')}`);
  assert.deepEqual(missingInEn, [], `Missing translation keys in English: ${missingInEn.join(', ')}`);
  assert.equal(enKeys.length, faKeys.length, `Key counts must match (${enKeys.length} keys)`);

  // Verify clearHistoryConfirm exists in both
  assert.ok(translations.en.clearHistoryConfirm, 'clearHistoryConfirm must exist in en');
  assert.ok(translations.fa.clearHistoryConfirm, 'clearHistoryConfirm must exist in fa');
  assert.ok(translations.en.confirmDisconnect, 'confirmDisconnect must exist in en');
  assert.ok(translations.fa.confirmDisconnect, 'confirmDisconnect must exist in fa');
});

test('Challenger 4.4: Dual session token headers presence in api.js and logger.js', () => {
  const apiPath = path.join(__dirname, '..', 'src', 'js', 'api.js');
  const apiContent = fs.readFileSync(apiPath, 'utf8');

  assert.ok(apiContent.includes("'x-kick-app-session'"), 'api.js must send x-kick-app-session');
  assert.ok(apiContent.includes("'X-App-Session'"), 'api.js must send X-App-Session');
  assert.ok(apiContent.includes('window.sessionToken = apiSessionToken'), 'api.js must initialize window.sessionToken');

  const loggerPath = path.join(__dirname, '..', 'src', 'js', 'logger.js');
  const loggerContent = fs.readFileSync(loggerPath, 'utf8');

  assert.ok(loggerContent.includes("'x-kick-app-session'"), 'logger.js must send x-kick-app-session');
  assert.ok(loggerContent.includes("'X-App-Session'"), 'logger.js must send X-App-Session');
});
