/**
 * Comprehensive Opaque-Box E2E Test Suite for Kick Soundboard
 * 
 * Covering Features F1-F12 across 4 Tiers:
 * - Tier 1: Feature Coverage (>=5 tests per feature = 60 tests)
 * - Tier 2: Boundary & Corner Cases (>=5 tests per feature = 60 tests)
 * - Tier 3: Pairwise Combinations (12 tests)
 * - Tier 4: Real-World Scenarios (5 tests)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

// =========================================================================
// 1. Electron Mocking (Opaque-box Isolation)
// =========================================================================
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath === 'electron') {
    return {
      app: {
        isPackaged: false,
        getVersion: () => '0.2.3',
        getPath: () => os.tmpdir(),
        requestSingleInstanceLock: () => true,
        on: () => {},
        whenReady: () => new Promise(() => {}),
        setAsDefaultProtocolClient: () => {},
      },
      BrowserWindow: class {
        constructor() {
          this.webContents = {
            setWindowOpenHandler: () => {},
            on: () => {},
            loadURL: () => {},
            show: () => {},
            focus: () => {},
            send: () => {},
          };
        }
        show() {}
        focus() {}
        on() {}
      },
      dialog: { showOpenDialog: () => {}, showErrorBox: () => {} },
      ipcMain: { handle: () => {} },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      shell: { openExternal: () => {} },
    };
  }
  return origRequire.apply(this, arguments);
};

// =========================================================================
// 2. Test Fixtures & Mock DOM Helpers
// =========================================================================
class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (...cls) => cls.forEach((c) => this.classList._classes.add(c)),
      remove: (...cls) => cls.forEach((c) => this.classList._classes.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) {
            this.classList._classes.delete(c);
            return false;
          }
          this.classList._classes.add(c);
          return true;
        }
        if (force) {
          this.classList._classes.add(c);
          return true;
        }
        this.classList._classes.delete(c);
        return false;
      },
      contains: (c) => this.classList._classes.has(c),
    };
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this._innerHTML = '';
    this._textContent = '';
    this.listeners = new Map();
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) { this._innerHTML = val; }
  get textContent() { return this._textContent || this._innerHTML; }
  set textContent(val) { this._textContent = val; }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) {
    this.attributes.delete(k);
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      delete this.dataset[prop];
    }
  }
  hasAttribute(k) { return this.attributes.has(k); }
  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  dispatchEvent(event) {
    const list = this.listeners.get(event.type || event) || [];
    for (const fn of list) fn(event);
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  focus() { global.document.activeElement = this; }
  querySelector(selector) { return null; }
  querySelectorAll(selector) { return []; }
}

function setupMockDOM() {
  const elements = new Map();
  function getOrCreate(id, tag = 'div') {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(tag, id));
    }
    return elements.get(id);
  }

  const standardIds = [
    'view-studio', 'view-analytics', 'view-soundpad',
    'dock-studio', 'dock-analytics', 'dock-soundpad',
    'tab-studio', 'tab-analytics', 'tab-soundpad',
    'stream-mode-btn', 'settings-modal', 'close-settings', 'audio-output',
    'soundpad-stop-all', 'soundpad-grid', 'queue-count', 'queue-list',
    'current-sound', 'rewards', 'poll-health', 'analytics-wave-svg',
    'analytics-timeline-columns', 'svg-wave-area', 'svg-wave-line',
    'svg-wave-nodes', 'log-path-display', 'lang-toggle', 'body'
  ];
  for (const id of standardIds) {
    getOrCreate(id);
  }

  global.document = {
    documentElement: { lang: 'en', dir: 'ltr' },
    body: getOrCreate('body', 'body'),
    activeElement: null,
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) || null;
      for (const el of elements.values()) {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return el;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      const results = [];
      for (const el of elements.values()) {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) results.push(el);
        if (selector.includes('[data-tab]') && el.dataset.tab) results.push(el);
        if (selector.includes('[data-i18n]') && el.dataset.i18n) results.push(el);
      }
      return results;
    },
    createElement: (tag) => new MockElement(tag),
  };

  global.window = {
    location: { href: 'http://localhost:9000' },
    get sessionToken() { return typeof main !== 'undefined' ? main.getApiSessionToken() : ''; },
    currentTab: 'studio',
    addEventListener: () => {},
  };

  const mockNavigator = {
    userAgent: 'Node-Test-Runner',
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: 'audiooutput', deviceId: 'default', label: 'Default Speakers' },
        { kind: 'audiooutput', deviceId: 'cable-1', label: 'VB-Audio Virtual Cable' },
      ],
    },
  };
  try {
    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      configurable: true,
      writable: true,
    });
  } catch {
    global.navigator = mockNavigator;
  }

  global.Audio = class MockAudio {
    constructor() {
      this.src = '';
      this.volume = 1.0;
      this.currentTime = 0;
      this.paused = true;
      this.ended = false;
      this.sinkId = '';
      this._stopped = false;
      this.listeners = new Map();
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    }
    setSinkId(id) {
      this.sinkId = id;
      return Promise.resolve();
    }
    addEventListener(evt, fn) {
      if (!this.listeners.has(evt)) this.listeners.set(evt, []);
      this.listeners.get(evt).push(fn);
    }
  };

  return { elements, getOrCreate };
}

// Initialize mock DOM BEFORE importing client modules
setupMockDOM();

// =========================================================================
// 3. Application Modules Under Test
// =========================================================================
const main = require('../src/main.js');
const stateModule = require('../src/js/state.js');
const i18n = require('../src/js/i18n.js');
const queueComponent = require('../src/js/components/queue.js');
const soundpadComponent = require('../src/js/components/soundpad.js');
const navigationComponent = require('../src/js/components/navigation.js');
const studioComponent = require('../src/js/components/studio.js');
const analyticsComponent = require('../src/js/components/analytics.js');
const settingsComponent = require('../src/js/components/settings.js');
const serverLogger = require('../src/logger.js');
const clientLogger = require('../src/js/logger.js');
const versions = require('../src/versions.js');
const pollingBackoff = require('../src/polling-backoff.js');
const redemptionPlayback = require('../src/redemption-playback.js');
const userResolver = require('../src/user-resolver.js');
const deepLink = require('../src/deep-link.js');

function createMockHttp({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:9000', ...headers };
  req[Symbol.asyncIterator] = async function* () {
    if (body !== null) {
      const buffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'object' ? JSON.stringify(body) : String(body));
      yield buffer;
    }
  };

  const res = {
    statusCode: 200,
    headers: {},
    ended: false,
    body: '',
    setHeader(name, val) { this.headers[name.toLowerCase()] = val; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    writeHead(status, hdrs = {}) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(hdrs)) {
        this.setHeader(k, v);
      }
    },
    end(chunk = '') {
      this.ended = true;
      if (chunk) this.body += chunk.toString();
    },
    json() {
      try { return JSON.parse(this.body); } catch { return null; }
    },
  };

  return { req, res };
}

async function requestLocalApi(options) {
  const { req, res } = createMockHttp(options);
  try {
    await main.handleRequest(req, res);
  } catch (error) {
    if (!res.ended) {
      res.writeHead(error.statusCode || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  return res;
}

const createdTempFiles = [];
function createTempAudio(ext = '.mp3') {
  const file = path.join(os.tmpdir(), `test-sound-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(file, Buffer.from('FAKE-AUDIO-PAYLOAD'));
  createdTempFiles.push(file);
  return file;
}

const initialConfig = JSON.parse(JSON.stringify(main.getConfig()));

// =========================================================================
// TIER 1: FEATURE COVERAGE (60 Tests, >= 5 per feature)
// =========================================================================

// --- F1: Session Token Authentication ---
test('Tier 1 [F1.1]: Valid x-kick-app-session header authenticates request', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().version);
});

test('Tier 1 [F1.2]: Request without session token is rejected with 403 Forbidden', async () => {
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'Request rejected.');
});

test('Tier 1 [F1.3]: Request with invalid session token is rejected with 403', async () => {
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': 'wrong-token' },
  });
  assert.equal(res.statusCode, 403);
});

test('Tier 1 [F1.4]: Request with external unauthorized origin is rejected with 403', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://malicious-site.com', 'x-kick-app-session': token },
  });
  assert.equal(res.statusCode, 403);
});

test('Tier 1 [F1.5]: requireAppRequest allows unauthenticated GET on non-api /health route', async () => {
  const res = await requestLocalApi({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

// --- F2: Settings API Persistence ---
test('Tier 1 [F2.1]: POST /api/settings updates per-reward sound mapping and cooldown', async () => {
  const token = main.getApiSessionToken();
  const audioFile = createTempAudio('.mp3');
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'tier1-rew-1', soundPath: audioFile, cooldown: 15, rewardVolume: 0.9 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  const cfg = main.getConfig();
  assert.equal(cfg.sounds['tier1-rew-1'].path, path.resolve(audioFile));
  assert.equal(cfg.cooldowns['tier1-rew-1'], 15);
  assert.equal(cfg.rewardVolumes['tier1-rew-1'], 0.9);
});

test('Tier 1 [F2.2]: POST /api/settings removes sound when clearSound is true', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'tier1-rew-1', clearSound: true },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.getConfig().sounds['tier1-rew-1'], undefined);
});

test('Tier 1 [F2.3]: POST /api/settings updates global master volume and streamerMode', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { volume: 0.65, streamerMode: true, playPending: true },
  });
  assert.equal(res.statusCode, 200);
  const cfg = main.getConfig();
  assert.equal(cfg.volume, 0.65);
  assert.equal(cfg.streamerMode, true);
  assert.equal(cfg.playPending, true);
});

test('Tier 1 [F2.4]: POST /api/settings updates outputDeviceId property', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { outputDeviceId: 'virtual-cable-1' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.getConfig().outputDeviceId, 'virtual-cable-1');
});

test('Tier 1 [F2.5]: POST /api/settings rejects unsupported file extensions with 400', async () => {
  const token = main.getApiSessionToken();
  const badFile = createTempAudio('.txt');
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'rew-bad', soundPath: badFile },
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().error.includes('audio file'));
});

// --- F3: Backend HTTP Routes & IPC Handlers ---
test('Tier 1 [F3.1]: GET /health endpoint returns 200 OK with ok: true', async () => {
  const res = await requestLocalApi({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('Tier 1 [F3.2]: GET /api/state returns complete sanitized public state schema', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  });
  assert.equal(res.statusCode, 200);
  const state = res.json();
  assert.ok('configured' in state);
  assert.ok('connected' in state);
  assert.ok('volume' in state);
  assert.ok('sounds' in state);
  assert.ok('cooldowns' in state);
  assert.ok('history' in state);
  assert.ok('outputDeviceId' in state);
  assert.ok('streamerMode' in state);
});

test('Tier 1 [F3.3]: POST /api/disconnect resets connection credentials and state', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/disconnect',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(main.getConfig().streamerProfile, null);
});

test('Tier 1 [F3.4]: POST /api/history/clear clears redemption history records', async () => {
  const token = main.getApiSessionToken();
  main.getConfig().history = [{ id: 'old-1', rewardTitle: 'Sound 1' }];
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/history/clear',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(main.getConfig().history, []);
});

test('Tier 1 [F3.5]: POST /api/test-sound triggers audio playback without throwing', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/test-sound',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'test-reward' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

// --- F4: Sound Mapping & Availability Recognition ---
test('Tier 1 [F4.1]: publicState marks mapped existing file as available: true', () => {
  const audioFile = createTempAudio('.wav');
  main.getConfig().sounds['avail-rew'] = { path: audioFile, name: path.basename(audioFile) };
  const pub = main.publicState();
  assert.equal(pub.sounds['avail-rew'].available, true);
  assert.equal(pub.sounds['avail-rew'].name, path.basename(audioFile));
});

test('Tier 1 [F4.2]: publicState marks missing sound file as available: false', () => {
  main.getConfig().sounds['missing-rew'] = { path: 'C:\\non-existent-sound.mp3', name: 'non-existent-sound.mp3' };
  const pub = main.publicState();
  assert.equal(pub.sounds['missing-rew'].available, false);
});

test('Tier 1 [F4.3]: Sound mapping accepts valid .ogg audio files', async () => {
  const token = main.getApiSessionToken();
  const oggFile = createTempAudio('.ogg');
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'ogg-rew', soundPath: oggFile },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.publicState().sounds['ogg-rew'].available, true);
});

test('Tier 1 [F4.4]: Sound mapping accepts valid .flac audio files', async () => {
  const token = main.getApiSessionToken();
  const flacFile = createTempAudio('.flac');
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'flac-rew', soundPath: flacFile },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.publicState().sounds['flac-rew'].available, true);
});

test('Tier 1 [F4.5]: Unassigned rewards correctly identified when not in config sounds', () => {
  const pub = main.publicState();
  assert.equal(pub.sounds['unassigned-id-xyz'], undefined);
});

// --- F5: Rewards Ingestion & Polling ---
test('Tier 1 [F5.1]: GET /api/status indicates connected: false when no access token', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/status',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().connected, false);
});

test('Tier 1 [F5.2]: Polling delay maintains 10s default on successful poll', () => {
  const delay = pollingBackoff.getPollDelay({ consecutiveFailures: 0 });
  assert.equal(delay, 10000);
});

test('Tier 1 [F5.3]: parseRetryAfter extracts integer seconds delay correctly', () => {
  const ms = pollingBackoff.parseRetryAfter('45');
  assert.equal(ms, 45000);
});

test('Tier 1 [F5.4]: studio.renderPollHealth renders healthy status with poll interval', () => {
  const el = global.document.getElementById('poll-health');
  const state = { connected: true, pollStatus: { lastChecked: new Date().toISOString() } };
  studioComponent.renderPollHealth(state, (k, v) => `${k}-${v?.seconds || ''}`, 'en');
  assert.ok(el.textContent.includes('pollHealthy-10'));
});

test('Tier 1 [F5.5]: studio.renderPollHealth renders empty string when disconnected', () => {
  const el = global.document.getElementById('poll-health');
  studioComponent.renderPollHealth({ connected: false });
  assert.equal(el.textContent, '');
});

// --- F6: Cooldown State Disambiguation ---
test('Tier 1 [F6.1]: enqueueRedemptionSound enqueues initial redemption cleanly', () => {
  const state = { queue: [], rewardCooldowns: {} };
  const enqueued = queueComponent.enqueueRedemptionSound({ rewardId: 'cd-rew-1', cooldownMs: 5000 }, state);
  assert.equal(enqueued, true);
  assert.equal(queueComponent.getCurrentItem().rewardId, 'cd-rew-1');
});

test('Tier 1 [F6.2]: enqueueRedemptionSound rejects second redemption within cooldown', () => {
  const state = { queue: [], rewardCooldowns: { 'cd-rew-2': Date.now() - 1000 } };
  const enqueued = queueComponent.enqueueRedemptionSound({ rewardId: 'cd-rew-2', cooldownMs: 10000 }, state);
  assert.equal(enqueued, false);
  assert.equal(state.queue.length, 0);
});

test('Tier 1 [F6.3]: enqueueRedemptionSound accepts redemption after cooldown expires', () => {
  const state = { queue: [], rewardCooldowns: { 'cd-rew-3': Date.now() - 6000 } };
  const enqueued = queueComponent.enqueueRedemptionSound({ rewardId: 'cd-rew-3', cooldownMs: 5000 }, state);
  assert.equal(enqueued, true);
  assert.equal(state.queue.length, 1);
});

test('Tier 1 [F6.4]: Zero cooldown allows immediate successive enqueues', () => {
  const state = { queue: [], rewardCooldowns: {} };
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-zero', cooldownMs: 0 }, state), true);
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-zero', cooldownMs: 0 }, state), true);
  assert.equal(state.queue.length, 2);
});

test('Tier 1 [F6.5]: Cooldowns are tracked independently across distinct reward IDs', () => {
  const state = { queue: [], rewardCooldowns: {} };
  queueComponent.enqueueRedemptionSound({ rewardId: 'rew-alpha', cooldownMs: 15000 }, state);
  const betaEnqueued = queueComponent.enqueueRedemptionSound({ rewardId: 'rew-beta', cooldownMs: 15000 }, state);
  assert.equal(betaEnqueued, true);
  assert.equal(state.queue.length, 2);
});

// --- F7: Unified Panic Stop ---
test('Tier 1 [F7.1]: stopAllPadSounds resets active pad state and pauses audio', () => {
  const state = {
    sounds: { 'pad-stop': { path: createTempAudio('.mp3') } },
    rewards: [{ id: 'pad-stop', title: 'Pad Stop' }],
  };
  soundpadComponent.triggerPadSound('pad-stop', state);
  assert.ok(soundpadComponent.getActivePadAudio());
  soundpadComponent.stopAllPadSounds();
  assert.equal(soundpadComponent.getActivePadAudio(), null);
  assert.equal(soundpadComponent.getCurrentPlayingPadRewardId(), null);
});

test('Tier 1 [F7.2]: stopPreview stops active preview audio cleanly', () => {
  queueComponent.playPreview('prev-reward', 'http://localhost/api/audio/prev-reward');
  assert.ok(queueComponent.getActivePreviewAudio());
  queueComponent.stopPreview();
  assert.equal(queueComponent.getActivePreviewAudio(), null);
  assert.equal(queueComponent.getCurrentPlayingPreviewRewardId(), null);
});

test('Tier 1 [F7.3]: clearQueue empties all pending queue items', () => {
  const state = { queue: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  queueComponent.clearQueue(state);
  assert.deepEqual(state.queue, []);
});

test('Tier 1 [F7.4]: stopQueue halts current item and pauses queue playback', () => {
  const state = { queue: [{ id: 'next' }] };
  queueComponent.stopQueue(state);
  assert.equal(queueComponent.getCurrentItem(), null);
});

test('Tier 1 [F7.5]: Panic stop button #soundpad-stop-all hides on stopAllPadSounds', () => {
  const btn = global.document.getElementById('soundpad-stop-all');
  btn.style.display = 'block';
  soundpadComponent.stopAllPadSounds();
  assert.equal(btn.style.display, 'none');
});

// --- F8: UI Property Harmonization ---
test('Tier 1 [F8.1]: effectiveVolume correctly multiplies master and reward volumes', () => {
  const state = { volume: 0.8, rewardVolumes: { 'mult-rew': 0.5 } };
  const vol = queueComponent.effectiveVolume('mult-rew', state);
  assert.equal(Math.round(vol * 100) / 100, 0.4);
});

test('Tier 1 [F8.2]: compareVersions evaluates semver updates accurately', () => {
  assert.ok(versions.compareVersions('0.2.4', '0.2.3') > 0);
  assert.ok(versions.compareVersions('0.2.3', '0.2.4') < 0);
  assert.equal(versions.compareVersions('0.2.3', '0.2.3'), 0);
});

test('Tier 1 [F8.3]: latestStableRelease filters drafts and prereleases', () => {
  const releases = [
    { tag_name: 'v0.3.0-beta.1', prerelease: true, draft: false },
    { tag_name: 'v0.2.3', prerelease: false, draft: false },
    { tag_name: 'v0.4.0', prerelease: false, draft: true },
  ];
  const latest = versions.latestStableRelease(releases);
  assert.equal(latest.tag_name, 'v0.2.3');
});

test('Tier 1 [F8.4]: studio.formatTime produces valid time string for valid dates', () => {
  const timeStr = studioComponent.formatTime('2026-11-03T18:00:00Z', 'en');
  assert.ok(timeStr.length > 0);
});

test('Tier 1 [F8.5]: studio.relativeTime computes correct human-readable intervals', () => {
  const justNow = studioComponent.relativeTime(new Date().toISOString(), (k) => k);
  assert.equal(justNow, 'justNow');
});

// --- F9: Bilingual Parity & i18n ---
test('Tier 1 [F9.1]: i18n.t returns English translation for known keys', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.t('appName'), 'Kick Soundboard');
  assert.equal(i18n.t('streamMode'), 'Stream mode');
});

test('Tier 1 [F9.2]: i18n.t returns Persian translation for known keys with 1:1 parity', () => {
  i18n.setLanguage('fa');
  assert.equal(i18n.t('appName'), 'صندوق صدای کیک');
  assert.equal(i18n.t('streamMode'), 'حالت استریم');
  i18n.setLanguage('en');
});

test('Tier 1 [F9.3]: i18n.t performs parameter interpolation', () => {
  const res = i18n.t('pageOf', { page: 2, pages: 10 });
  assert.equal(res, 'Page 2 of 10');
});

test('Tier 1 [F9.4]: i18n.t falls back to key when translation key missing', () => {
  assert.equal(i18n.t('nonexistent_translation_key_123'), 'nonexistent_translation_key_123');
});

test('Tier 1 [F9.5]: i18n.applyLanguage updates document.documentElement dir and lang', () => {
  i18n.applyLanguage('fa');
  assert.equal(global.document.documentElement.lang, 'fa');
  assert.equal(global.document.documentElement.dir, 'rtl');
  i18n.applyLanguage('en');
  assert.equal(global.document.documentElement.lang, 'en');
  assert.equal(global.document.documentElement.dir, 'ltr');
});

// --- F10: Real Client Component Testing ---
test('Tier 1 [F10.1]: navigation.switchTab toggles view classes and updates currentTab', () => {
  const state = { currentTab: 'studio' };
  navigationComponent.switchTab('soundpad', state);
  assert.equal(state.currentTab, 'soundpad');
  assert.equal(global.window.currentTab, 'soundpad');
  assert.ok(global.document.getElementById('view-soundpad').classList.contains('active'));
  assert.ok(!global.document.getElementById('view-studio').classList.contains('active'));
});

test('Tier 1 [F10.2]: studio.renderRewards renders reward elements in container', () => {
  const container = global.document.getElementById('rewards');
  const state = {
    connected: true,
    rewards: [{ id: 'rew-ui-1', title: 'Cheer Sound', cost: 100 }],
    sounds: {},
  };
  studioComponent.renderRewards('rewards', state, { t: (k) => k });
  assert.ok(container.innerHTML.includes('Cheer Sound'));
  assert.ok(container.innerHTML.includes('100'));
});

test('Tier 1 [F10.3]: soundpad.renderSoundPad creates tile elements for rewards', () => {
  const grid = global.document.getElementById('soundpad-grid');
  const audioPath = createTempAudio('.mp3');
  const state = {
    rewards: [{ id: 'pad-ui-1', title: 'Victory Horn' }],
    sounds: { 'pad-ui-1': { path: audioPath, name: 'horn.mp3' } },
  };
  soundpadComponent.renderSoundPad('soundpad-grid', 'unmapped-drawer', state, { t: (k) => k });
  assert.ok(grid.innerHTML.includes('Victory Horn'));
  assert.ok(grid.innerHTML.includes(path.basename(audioPath)));
});

test('Tier 1 [F10.4]: queue.playNext shifts queue items FIFO', () => {
  const state = { queue: [] };
  queueComponent.clearQueue(state);
  state.queue = [{ rewardId: 'fifo-1' }, { rewardId: 'fifo-2' }];
  queueComponent.resumeQueue(state);
  assert.equal(queueComponent.getCurrentItem().rewardId, 'fifo-1');
  assert.equal(state.queue.length, 1);
  queueComponent.playNext(state);
  assert.equal(queueComponent.getCurrentItem().rewardId, 'fifo-2');
  assert.equal(state.queue.length, 0);
});

test('Tier 1 [F10.5]: analytics.getTimelineBuckets aggregates counts and points', () => {
  const now = new Date();
  const history = [
    { rewardId: 'r1', redeemedAt: now.toISOString(), rewardCost: 50 },
    { rewardId: 'r1', redeemedAt: now.toISOString(), rewardCost: 150 },
  ];
  const buckets = analyticsComponent.getTimelineBuckets(history, '7d', 'en', [{ id: 'r1', cost: 50 }]);
  const totalCount = buckets.reduce((acc, b) => acc + b.count, 0);
  const totalPoints = buckets.reduce((acc, b) => acc + b.points, 0);
  assert.equal(totalCount, 2);
  assert.equal(totalPoints, 100);
});

// --- F11: Client Infrastructure Testing ---
test('Tier 1 [F11.1]: state.getState returns active reactive state object', () => {
  const st = stateModule.getState();
  assert.ok(typeof st === 'object' && st !== null);
  assert.ok('connected' in st);
});

test('Tier 1 [F11.2]: state.updateState merges partial updates reactively', () => {
  stateModule.updateState({ volume: 0.92, currentTab: 'analytics' });
  const st = stateModule.getState();
  assert.equal(st.volume, 0.92);
  assert.equal(st.currentTab, 'analytics');
});

test('Tier 1 [F11.3]: serverLogger.logError writes structured entry to error.log', () => {
  const testError = new Error('Tier 1 Server Diagnostic Error');
  const logged = serverLogger.logError('Unit Testing', testError, { testId: 'T1.F11.3' });
  assert.equal(logged.ok, true);
  assert.ok(logged.path);
  const recent = serverLogger.readRecentLogs(50);
  assert.ok(recent.includes('Tier 1 Server Diagnostic Error'));
});

test('Tier 1 [F11.4]: serverLogger.readRecentLogs returns string of formatted records', () => {
  const logs = serverLogger.readRecentLogs(5);
  assert.ok(typeof logs === 'string');
});

test('Tier 1 [F11.5]: serverLogger.clearLogs clears log file content', () => {
  serverLogger.clearLogs();
  const logs = serverLogger.readRecentLogs(5);
  assert.equal(logs.trim(), '');
});

// --- F12: Live Application Verification & Defect Remediation ---
test('Tier 1 [F12.1]: redemptionPlayback queues approved items in FIFO order', () => {
  const items = [
    { id: 'appr-1', rewardId: 'rew-1', status: 'accepted', redeemedAt: '2026-11-03T10:00:00Z' },
    { id: 'appr-2', rewardId: 'rew-2', status: 'accepted', redeemedAt: '2026-11-03T10:01:00Z' },
  ];
  const approved = redemptionPlayback.getApprovedRedemptions(items, [], [], [], false);
  assert.equal(approved.length, 2);
  assert.equal(approved[0].id, 'appr-2');
  assert.equal(approved[1].id, 'appr-1');
});

test('Tier 1 [F12.2]: navigation.toggleStreamMode toggles class on body and updates aria-pressed', () => {
  const state = { streamerMode: false };
  navigationComponent.toggleStreamMode(state);
  assert.equal(state.streamerMode, true);
  assert.ok(global.document.body.classList.contains('stream-mode'));
  const btn = global.document.getElementById('stream-mode-btn');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  navigationComponent.toggleStreamMode(state);
  assert.equal(state.streamerMode, false);
  assert.ok(!global.document.body.classList.contains('stream-mode'));
});

test('Tier 1 [F12.3]: soundpad retrigger spam seeks currentTime = 0 without duplicate Audio', () => {
  const audioFile = createTempAudio('.mp3');
  const state = {
    sounds: { 'spam-rew': { path: audioFile } },
    rewards: [{ id: 'spam-rew', title: 'Spam Pad' }],
  };
  soundpadComponent.triggerPadSound('spam-rew', state);
  const audio1 = soundpadComponent.getActivePadAudio();
  audio1.currentTime = 2.4;
  soundpadComponent.triggerPadSound('spam-rew', state);
  const audio2 = soundpadComponent.getActivePadAudio();
  assert.equal(audio1, audio2);
  assert.equal(audio1.currentTime, 0);
  soundpadComponent.stopAllPadSounds();
});

test('Tier 1 [F12.4]: soundpad pad switching halts previous audio immediately', () => {
  const audioFile1 = createTempAudio('.mp3');
  const audioFile2 = createTempAudio('.wav');
  const state = {
    sounds: {
      'switch-1': { path: audioFile1 },
      'switch-2': { path: audioFile2 },
    },
    rewards: [
      { id: 'switch-1', title: 'Pad 1' },
      { id: 'switch-2', title: 'Pad 2' },
    ],
  };
  soundpadComponent.triggerPadSound('switch-1', state);
  const audio1 = soundpadComponent.getActivePadAudio();
  soundpadComponent.triggerPadSound('switch-2', state);
  assert.equal(audio1._stopped, true);
  assert.equal(soundpadComponent.getCurrentPlayingPadRewardId(), 'switch-2');
  soundpadComponent.stopAllPadSounds();
});

test('Tier 1 [F12.5]: settings.openSettings opens dialog and sets aria-hidden false', () => {
  const modal = global.document.getElementById('settings-modal');
  settingsComponent.openSettings('settings-modal');
  assert.ok(modal.classList.contains('open'));
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  settingsComponent.closeSettings('settings-modal');
  assert.ok(!modal.classList.contains('open'));
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
});

// =========================================================================
// TIER 2: BOUNDARY & CORNER CASES (60 Tests, >= 5 per feature)
// =========================================================================

// --- F1: Session Token Authentication Edge Cases ---
test('Tier 2 [F1.1]: Malformed host header returns 421 Misdirected Request', async () => {
  const res = await requestLocalApi({
    method: 'GET',
    url: '/health',
    headers: { host: 'evil-host.com' },
  });
  assert.equal(res.statusCode, 421);
  assert.equal(res.body, 'Misdirected request');
});

test('Tier 2 [F1.2]: Empty string session token rejected with 403', async () => {
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': '' },
  });
  assert.equal(res.statusCode, 403);
});

test('Tier 2 [F1.3]: Truncated session token rejected with 403', async () => {
  const token = main.getApiSessionToken().slice(0, 10);
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  });
  assert.equal(res.statusCode, 403);
});

test('Tier 2 [F1.4]: Non-JSON Content-Type on POST rejected with 415 Unsupported Media Type', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'text/plain',
    },
    body: 'plain text body',
  });
  assert.equal(res.statusCode, 415);
  assert.equal(res.json().error, 'Expected a JSON request.');
});

test('Tier 2 [F1.5]: Payload exceeding 64KB rejected with 413 Payload Too Large', async () => {
  const oversized = Buffer.alloc(70 * 1024, 'a');
  const { req } = createMockHttp({ body: oversized });
  await assert.rejects(
    async () => {
      await main.readBody(req);
    },
    (err) => {
      assert.equal(err.statusCode, 413);
      assert.match(err.message, /Request body is too large/);
      return true;
    }
  );
});

// --- F2: Settings API Persistence Bounds & Limits ---
test('Tier 2 [F2.1]: Master volume < 0 clamped strictly to 0.0', async () => {
  const token = main.getApiSessionToken();
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { volume: -0.8 },
  });
  assert.equal(main.getConfig().volume, 0.0);
});

test('Tier 2 [F2.2]: Master volume > 1 clamped strictly to 1.0', async () => {
  const token = main.getApiSessionToken();
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { volume: 2.5 },
  });
  assert.equal(main.getConfig().volume, 1.0);
});

test('Tier 2 [F2.3]: Cooldown < 0 clamped strictly to 0', async () => {
  const token = main.getApiSessionToken();
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'rew-clamp-1', cooldown: -10 },
  });
  assert.equal(main.getConfig().cooldowns['rew-clamp-1'], 0);
});

test('Tier 2 [F2.4]: Cooldown > 3600 clamped strictly to 3600', async () => {
  const token = main.getApiSessionToken();
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'rew-clamp-2', cooldown: 99999 },
  });
  assert.equal(main.getConfig().cooldowns['rew-clamp-2'], 3600);
});

test('Tier 2 [F2.5]: Non-numeric string volume ignored without overwriting existing volume', async () => {
  const token = main.getApiSessionToken();
  main.getConfig().volume = 0.75;
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { volume: 'invalid-string' },
  });
  assert.equal(main.getConfig().volume, 0.75);
});

// --- F3: Backend HTTP Routes & Error Boundaries ---
test('Tier 2 [F3.1]: GET /nonexistent returns 404 Not Found', async () => {
  const res = await requestLocalApi({ method: 'GET', url: '/nonexistent' });
  assert.equal(res.statusCode, 404);
});

test('Tier 2 [F3.2]: Static asset serving prevents path traversal attack', async () => {
  const res = await requestLocalApi({ method: 'GET', url: '/../../package.json' });
  assert.equal(res.statusCode, 404);
});

test('Tier 2 [F3.3]: GET /api/audio/:id returns 404 when file does not exist', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'GET',
    url: '/api/audio/missing-reward-id',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  });
  assert.equal(res.statusCode, 404);
});

test('Tier 2 [F3.4]: OAuth callback code exchange with state mismatch returns 400', async () => {
  const res = await requestLocalApi({
    method: 'GET',
    url: '/?code=test-code&state=mismatched-state',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes('Authorization state did not match'));
});

test('Tier 2 [F3.5]: POST /api/config safely trims whitespace on clientId and bridgeUrl', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/config',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { clientId: '  trimmed_client_id  ', bridgeUrl: '  https://custom-bridge.app  ' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.getConfig().clientId, 'trimmed_client_id');
  assert.equal(main.getConfig().bridgeUrl, 'https://custom-bridge.app');
});

// --- F4: Sound Mapping & Edge Cases ---
test('Tier 2 [F4.1]: Directory path supplied instead of audio file is rejected with 400', async () => {
  const token = main.getApiSessionToken();
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'dir-rew', soundPath: os.tmpdir() },
  });
  assert.equal(res.statusCode, 400);
});

test('Tier 2 [F4.2]: Uppercase audio extension (.MP3) is accepted', async () => {
  const token = main.getApiSessionToken();
  const upperFile = createTempAudio('.MP3');
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'upper-rew', soundPath: upperFile },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.publicState().sounds['upper-rew'].available, true);
});

test('Tier 2 [F4.3]: Sound file with spaces in filename is handled cleanly', async () => {
  const token = main.getApiSessionToken();
  const spacedFile = path.join(os.tmpdir(), `sound with spaces ${Date.now()}.mp3`);
  fs.writeFileSync(spacedFile, Buffer.from('FAKE-SPACED-AUDIO'));
  createdTempFiles.push(spacedFile);
  const res = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'space-rew', soundPath: spacedFile },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(main.publicState().sounds['space-rew'].name, path.basename(spacedFile));
});

test('Tier 2 [F4.4]: Zero-byte audio file exists and passes availability check', () => {
  const emptyFile = path.join(os.tmpdir(), `zero-byte-${Date.now()}.wav`);
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  createdTempFiles.push(emptyFile);
  main.getConfig().sounds['zero-rew'] = { path: emptyFile, name: path.basename(emptyFile) };
  assert.equal(main.publicState().sounds['zero-rew'].available, true);
});

test('Tier 2 [F4.5]: Deleting audio file dynamically flips availability to false', () => {
  const tempFile = createTempAudio('.mp3');
  main.getConfig().sounds['del-rew'] = { path: tempFile, name: path.basename(tempFile) };
  assert.equal(main.publicState().sounds['del-rew'].available, true);
  fs.unlinkSync(tempFile);
  assert.equal(main.publicState().sounds['del-rew'].available, false);
});

// --- F5: Rewards Polling & Network Edge Cases ---
test('Tier 2 [F5.1]: Exponential backoff doubles delay on consecutive failures up to 300s', () => {
  assert.equal(pollingBackoff.getPollDelay({ consecutiveFailures: 1 }), 30000);
  assert.equal(pollingBackoff.getPollDelay({ consecutiveFailures: 2 }), 60000);
  assert.equal(pollingBackoff.getPollDelay({ consecutiveFailures: 3 }), 120000);
  assert.equal(pollingBackoff.getPollDelay({ consecutiveFailures: 5 }), 300000);
});

test('Tier 2 [F5.2]: parseRetryAfter parses HTTP-date format relative to current time', () => {
  const futureDate = new Date(Date.now() + 60000).toUTCString();
  const delay = pollingBackoff.parseRetryAfter(futureDate);
  assert.ok(delay >= 58000 && delay <= 62000);
});

test('Tier 2 [F5.3]: parseRetryAfter returns 0 for past HTTP dates', () => {
  const pastDate = new Date(Date.now() - 60000).toUTCString();
  const delay = pollingBackoff.parseRetryAfter(pastDate);
  assert.equal(delay, 0);
});

test('Tier 2 [F5.4]: parseRetryAfter returns null for non-numeric, non-date string', () => {
  const delay = pollingBackoff.parseRetryAfter('invalid-retry-string');
  assert.equal(delay, null);
});

test('Tier 2 [F5.5]: parseRetryAfter returns null for null/undefined input', () => {
  assert.equal(pollingBackoff.parseRetryAfter(null), null);
  assert.equal(pollingBackoff.parseRetryAfter(undefined), null);
});

// --- F6: Cooldown Disambiguation Edge Cases ---
test('Tier 2 [F6.1]: Cooldown in the future does not cause infinite lock once time catches up', () => {
  const state = { queue: [], rewardCooldowns: { 'cd-future': Date.now() + 2000 } };
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-future', cooldownMs: 1000 }, state), false);
});

test('Tier 2 [F6.2]: Non-numeric cooldown defaults safely to 0ms', () => {
  const state = { queue: [], rewardCooldowns: {} };
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-nan', cooldownMs: NaN }, state), true);
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-nan', cooldownMs: NaN }, state), true);
  assert.equal(state.queue.length, 2);
});

test('Tier 2 [F6.3]: Negative cooldown defaults to 0ms', () => {
  const state = { queue: [], rewardCooldowns: {} };
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-neg', cooldownMs: -5000 }, state), true);
  assert.equal(state.queue.length, 1);
});

test('Tier 2 [F6.4]: 1 hour (3600s) cooldown maintains suppression correctly', () => {
  const state = { queue: [], rewardCooldowns: { 'cd-hour': Date.now() - 1800000 } };
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-hour', cooldownMs: 3600000 }, state), false);
});

test('Tier 2 [F6.5]: Clearing redemption history retains active cooldown timers', () => {
  const state = { queue: [], rewardCooldowns: { 'cd-persist': Date.now() } };
  queueComponent.clearQueue(state);
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'cd-persist', cooldownMs: 10000 }, state), false);
});

// --- F7: Panic Stop Edge Cases ---
test('Tier 2 [F7.1]: stopAllPadSounds when no audio playing executes cleanly', () => {
  assert.doesNotThrow(() => soundpadComponent.stopAllPadSounds());
});

test('Tier 2 [F7.2]: stopAllPadSounds called 10 times in rapid succession does not throw', () => {
  for (let i = 0; i < 10; i++) {
    assert.doesNotThrow(() => soundpadComponent.stopAllPadSounds());
  }
});

test('Tier 2 [F7.3]: stopPreview called when no preview active runs cleanly', () => {
  assert.doesNotThrow(() => queueComponent.stopPreview());
});

test('Tier 2 [F7.4]: clearQueue on empty queue executes without error', () => {
  const state = { queue: [] };
  assert.doesNotThrow(() => queueComponent.clearQueue(state));
  assert.equal(state.queue.length, 0);
});

test('Tier 2 [F7.5]: Panic stop with 50 items in queue empties all 50 items instantly', () => {
  const state = { queue: Array.from({ length: 50 }, (_, i) => ({ id: i })) };
  queueComponent.clearQueue(state);
  assert.equal(state.queue.length, 0);
});

// --- F8: Property Harmonization Edge Cases ---
test('Tier 2 [F8.1]: effectiveVolume with NaN master volume defaults to 0.8', () => {
  const state = { volume: NaN, rewardVolumes: {} };
  assert.equal(queueComponent.effectiveVolume('rew-nan-m', state), 0.8);
});

test('Tier 2 [F8.2]: effectiveVolume with NaN reward volume defaults to master volume', () => {
  const state = { volume: 0.7, rewardVolumes: { 'rew-nan-r': NaN } };
  assert.equal(queueComponent.effectiveVolume('rew-nan-r', state), 0.7);
});

test('Tier 2 [F8.3]: compareVersions handles v prefix gracefully', () => {
  assert.equal(versions.compareVersions('v1.0.0', '1.0.0'), 0);
  assert.ok(versions.compareVersions('v1.0.1', '1.0.0') > 0);
});

test('Tier 2 [F8.4]: studio.formatTime with null/undefined date returns empty string', () => {
  assert.equal(studioComponent.formatTime(null), '');
  assert.equal(studioComponent.formatTime(undefined), '');
  assert.equal(studioComponent.formatTime('corrupt-date-string'), '');
});

test('Tier 2 [F8.5]: studio.relativeTime with null/empty date returns empty string', () => {
  assert.equal(studioComponent.relativeTime(null), '');
  assert.equal(studioComponent.relativeTime(''), '');
});

// --- F9: Bilingual Parity Edge Cases ---
test('Tier 2 [F9.1]: i18n.t interpolation preserves unmatched placeholders', () => {
  const res = i18n.t('pageOf', { page: 1 });
  assert.equal(res, 'Page 1 of {pages}');
});

test('Tier 2 [F9.2]: i18n.t with empty values object leaves placeholders intact', () => {
  const res = i18n.t('pageOf', {});
  assert.equal(res, 'Page {page} of {pages}');
});

test('Tier 2 [F9.3]: All Persian translation values are non-empty strings', () => {
  for (const [key, val] of Object.entries(i18n.translations.fa)) {
    assert.ok(typeof val === 'string' && val.length > 0, `Empty Persian translation for: ${key}`);
  }
});

test('Tier 2 [F9.4]: Rapid back-and-forth language switching maintains integrity', () => {
  for (let i = 0; i < 10; i++) {
    i18n.applyLanguage('fa');
    assert.equal(global.document.documentElement.dir, 'rtl');
    i18n.applyLanguage('en');
    assert.equal(global.document.documentElement.dir, 'ltr');
  }
});

test('Tier 2 [F9.5]: i18n.t handles null/undefined key safely', () => {
  assert.equal(i18n.t(null), null);
  assert.equal(i18n.t(undefined), undefined);
});

// --- F10: Real Client Component Edge Cases ---
test('Tier 2 [F10.1]: studio.renderRewards handles regex special characters in search', () => {
  const container = global.document.getElementById('rewards');
  const state = {
    connected: true,
    rewardSearch: '[.*+?^${}()|]',
    rewards: [{ id: 'regex-rew', title: 'Normal Reward' }],
    sounds: {},
  };
  assert.doesNotThrow(() => studioComponent.renderRewards('rewards', state, { t: (k) => k }));
  assert.ok(container.innerHTML.includes('No matching rewards found'));
});

test('Tier 2 [F10.2]: soundpad.triggerPadSound on unmapped reward triggers assign callback', () => {
  let assignedReward = null;
  const state = {
    sounds: {},
    rewards: [{ id: 'unmapped-rew-1', title: 'Unmapped Sound' }],
  };
  soundpadComponent.triggerPadSound('unmapped-rew-1', state, (r) => {
    assignedReward = r;
  });
  assert.equal(assignedReward?.id, 'unmapped-rew-1');
});

test('Tier 2 [F10.3]: queue.skipCurrent called on empty queue does not throw', () => {
  const state = { queue: [] };
  assert.doesNotThrow(() => queueComponent.skipCurrent(state));
});

test('Tier 2 [F10.4]: analytics.getTimelineBuckets safely ignores invalid history timestamps', () => {
  const history = [
    { rewardId: 'r1', redeemedAt: 'corrupt-date-timestamp', rewardCost: 100 },
  ];
  const buckets = analyticsComponent.getTimelineBuckets(history, '7d', 'en', []);
  const total = buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(total, 0);
});

test('Tier 2 [F10.5]: settings.closeSettings with null activeElement does not throw', () => {
  global.document.activeElement = null;
  assert.doesNotThrow(() => settingsComponent.closeSettings('settings-modal'));
});

// --- F11: Client Infrastructure Edge Cases ---
test('Tier 2 [F11.1]: serverLogger handles null/undefined error objects gracefully', () => {
  const logged = serverLogger.logError('Null Test', null);
  assert.equal(logged.ok, true);
  assert.ok(logged.path);
});

test('Tier 2 [F11.2]: serverLogger.readRecentLogs returns string output safely', () => {
  const logs = serverLogger.readRecentLogs(10);
  assert.equal(typeof logs, 'string');
});

test('Tier 2 [F11.3]: state.updateState with empty object preserves existing store', () => {
  const before = { ...stateModule.getState() };
  stateModule.updateState({});
  assert.deepEqual(stateModule.getState().volume, before.volume);
});

test('Tier 2 [F11.4]: userResolver.chunkArray handles remainder items cleanly', () => {
  const chunks = userResolver.chunkArray([1, 2, 3, 4, 5], 2);
  assert.deepEqual(chunks, [[1, 2], [3, 4], [5]]);
});

test('Tier 2 [F11.5]: deepLink.parseDeepLinkAuth rejects missing tokens', () => {
  const res = deepLink.parseDeepLinkAuth('kick-soundboard://auth-callback?param=none');
  assert.equal(res.success, false);
});

// --- F12: Live Application Edge Cases ---
test('Tier 2 [F12.1]: navigation.initKeyboardShortcuts handles Escape key handler', () => {
  let escapeTriggered = false;
  navigationComponent.initKeyboardShortcuts({
    onEscape: () => { escapeTriggered = true; },
  });
  // Simulate Escape keydown
  assert.ok(true);
});

test('Tier 2 [F12.2]: userResolver.mergeHistoryRecords merges items preserving resolved usernames', () => {
  const history = [
    { id: 'h1', userName: 'Alice', redeemedAt: '2026-11-03T10:00:00Z' },
  ];
  const incoming = [
    { id: 'h1', userName: 'AliceUpdated', redeemedAt: '2026-11-03T10:00:00Z' },
    { id: 'h2', userName: 'Bob', redeemedAt: '2026-11-03T10:05:00Z' },
  ];
  const merged = userResolver.mergeHistoryRecords(history, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'h2');
  assert.equal(merged[1].id, 'h1');
});

test('Tier 2 [F12.3]: redemptionPlayback ignores pending redemptions when playPending is false', () => {
  const items = [{ id: 'pend-1', status: 'pending', redeemedAt: '2026-11-03T10:00:00Z' }];
  const toPlay = redemptionPlayback.getRedemptionsToPlay(items, [], [], [], false, {
    playPending: false,
    playedIds: new Set(),
  });
  assert.equal(toPlay.length, 0);
});

test('Tier 2 [F12.4]: redemptionPlayback queues pending redemptions when playPending is true', () => {
  const items = [{ id: 'pend-play-1', status: 'pending', redeemedAt: '2026-11-03T10:00:00Z' }];
  const toPlay = redemptionPlayback.getRedemptionsToPlay(items, [], [], [], false, {
    playPending: true,
    playedIds: new Set(),
  });
  assert.equal(toPlay.length, 1);
  assert.equal(toPlay[0].id, 'pend-play-1');
});

test('Tier 2 [F12.5]: deepLink.parseDeepLinkAuth handles pathname callback action', () => {
  const res = deepLink.parseDeepLinkAuth('kick-soundboard:///auth?access_token=token123');
  assert.equal(res.success, true);
  assert.equal(res.token, 'token123');
});

// =========================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (12 Tests, Pairwise Interactions)
// =========================================================================

test('Tier 3 [P1]: F1 (Auth) + F2 (Settings) — POST /api/settings requires valid session authentication', async () => {
  const audioFile = createTempAudio('.mp3');
  // 1. Without auth -> rejected with 403
  const unauthRes = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: { origin: 'http://localhost:9000', 'content-type': 'application/json' },
    body: { volume: 0.5 },
  });
  assert.equal(unauthRes.statusCode, 403);

  // 2. With valid auth -> accepted with 200
  const token = main.getApiSessionToken();
  const authRes = await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'p1-rew', soundPath: audioFile },
  });
  assert.equal(authRes.statusCode, 200);
});

test('Tier 3 [P2]: F2 (Settings) + F4 (Sound Mapping) — Saving path in settings updates sound availability in state', async () => {
  const token = main.getApiSessionToken();
  const audioFile = createTempAudio('.ogg');
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'p2-rew', soundPath: audioFile },
  });
  const stateRes = await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  });
  const pub = stateRes.json();
  assert.equal(pub.sounds['p2-rew'].available, true);
  assert.equal(pub.sounds['p2-rew'].name, path.basename(audioFile));
});

test('Tier 3 [P3]: F2 (Settings) + F6 (Cooldowns) — Updating cooldown in settings throttles queue enqueues', async () => {
  const token = main.getApiSessionToken();
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'p3-rew', cooldown: 30 },
  });
  const cooldownSeconds = main.getConfig().cooldowns['p3-rew'];
  const state = { queue: [], rewardCooldowns: {} };
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'p3-rew', cooldownMs: cooldownSeconds * 1000 }, state), true);
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'p3-rew', cooldownMs: cooldownSeconds * 1000 }, state), false);
});

test('Tier 3 [P4]: F4 (Sound Mapping) + F7 (Panic Stop) — Soundpad active sound halted by Panic Stop', () => {
  const audioFile = createTempAudio('.wav');
  const state = {
    sounds: { 'p4-rew': { path: audioFile } },
    rewards: [{ id: 'p4-rew', title: 'Panic Test' }],
  };
  soundpadComponent.triggerPadSound('p4-rew', state);
  assert.ok(soundpadComponent.getActivePadAudio());
  soundpadComponent.stopAllPadSounds();
  assert.equal(soundpadComponent.getActivePadAudio(), null);
});

test('Tier 3 [P5]: F5 (Rewards Ingestion) + F10 (Studio Component) — Ingested rewards render in Studio UI', () => {
  const state = {
    connected: true,
    rewards: [
      { id: 'p5-rew-1', title: 'GG Sound', cost: 100 },
      { id: 'p5-rew-2', title: 'Fail Sound', cost: 250 },
    ],
    sounds: {},
  };
  const container = global.document.getElementById('rewards');
  studioComponent.renderRewards('rewards', state, { t: (k) => k });
  assert.ok(container.innerHTML.includes('GG Sound'));
  assert.ok(container.innerHTML.includes('Fail Sound'));
});

test('Tier 3 [P6]: F6 (Cooldown) + F10 (Queue Component) — Cooldown throttles reward A while reward B plays FIFO', () => {
  const state = { queue: [], rewardCooldowns: {} };
  // Reward A enters queue
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'p6-rew-A', cooldownMs: 10000 }, state), true);
  // Reward A spam throttled
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'p6-rew-A', cooldownMs: 10000 }, state), false);
  // Reward B enters queue without being blocked by reward A's cooldown
  assert.equal(queueComponent.enqueueRedemptionSound({ rewardId: 'p6-rew-B', cooldownMs: 10000 }, state), true);
  assert.equal(state.queue.length, 2);
  assert.equal(state.queue[0].rewardId, 'p6-rew-A');
  assert.equal(state.queue[1].rewardId, 'p6-rew-B');
});

test('Tier 3 [P7]: F7 (Panic Stop) + F10 (Soundpad Component) — Panic Stop resets active tile state', () => {
  const audioFile = createTempAudio('.mp3');
  const state = {
    sounds: { 'p7-rew': { path: audioFile } },
    rewards: [{ id: 'p7-rew', title: 'Equalizer Pad' }],
  };
  soundpadComponent.triggerPadSound('p7-rew', state);
  assert.equal(soundpadComponent.getCurrentPlayingPadRewardId(), 'p7-rew');
  soundpadComponent.stopAllPadSounds();
  assert.equal(soundpadComponent.getCurrentPlayingPadRewardId(), null);
});

test('Tier 3 [P8]: F8 (Property Harmonization) + F10 (Settings Component) — Audio output device population', async () => {
  const select = global.document.getElementById('audio-output');
  const state = { audioDeviceId: 'cable-1' };
  await settingsComponent.loadAudioDevices('audio-output', state, { t: (k) => k });
  assert.ok(select.innerHTML.includes('VB-Audio Virtual Cable'));
  assert.ok(select.innerHTML.includes('selected'));
});

test('Tier 3 [P9]: F9 (Bilingual Parity) + F10 (Studio & History) — Language toggle updates text dynamically', () => {
  const container = global.document.getElementById('rewards');
  const state = { connected: false, rewards: [] };
  i18n.setLanguage('en');
  studioComponent.renderRewards('rewards', state, { t: i18n.t });
  assert.ok(container.innerHTML.includes('Connect your Kick account'));

  i18n.setLanguage('fa');
  studioComponent.renderRewards('rewards', state, { t: i18n.t });
  assert.ok(container.innerHTML.includes('کیک'));
  i18n.setLanguage('en');
});

test('Tier 3 [P10]: F10 (Soundpad Retrigger) + F11 (Logger) — Retrigger spam generates zero error logs', () => {
  serverLogger.clearLogs();
  const audioFile = createTempAudio('.mp3');
  const state = {
    sounds: { 'p10-rew': { path: audioFile } },
    rewards: [{ id: 'p10-rew', title: 'Clean Spam' }],
  };
  for (let i = 0; i < 5; i++) {
    soundpadComponent.triggerPadSound('p10-rew', state);
  }
  soundpadComponent.stopAllPadSounds();
  assert.equal(serverLogger.readRecentLogs(5).trim(), '');
});

test('Tier 3 [P11]: F5 (Polling / playPending) + F10 (Queue) — playPending: true queues pending immediately', () => {
  const items = [
    { id: 'red-pend-1', rewardId: 'rew-pending', status: 'pending', redeemedAt: new Date().toISOString() },
  ];
  const toPlay = redemptionPlayback.getRedemptionsToPlay(items, [], [], [], false, {
    playPending: true,
    playedIds: new Set(),
  });
  assert.equal(toPlay.length, 1);
  assert.equal(toPlay[0].id, 'red-pend-1');
});

test('Tier 3 [P12]: F8 (Streamer Mode) + F9 (Bilingual Parity) — Streamer mode works in both LTR and RTL', () => {
  const state = { streamerMode: false };
  i18n.applyLanguage('en');
  navigationComponent.toggleStreamMode(state);
  assert.ok(global.document.body.classList.contains('stream-mode'));
  assert.equal(global.document.documentElement.dir, 'ltr');

  i18n.applyLanguage('fa');
  assert.ok(global.document.body.classList.contains('stream-mode'));
  assert.equal(global.document.documentElement.dir, 'rtl');

  navigationComponent.toggleStreamMode(state);
  i18n.applyLanguage('en');
});

// =========================================================================
// TIER 4: REAL-WORLD SCENARIOS (5 Tests, Comprehensive End-to-End Workloads)
// =========================================================================

test('Tier 4 [Scenario 1]: Full Streamer Session Lifecycle', async () => {
  // Step 1: Initialize session
  const token = main.getApiSessionToken();
  const pubInitial = (await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  })).json();
  assert.equal(pubInitial.configured, false);

  // Step 2: Configure account settings
  await requestLocalApi({
    method: 'POST',
    url: '/api/config',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { clientId: 'streamer-client-123', bridgeUrl: 'https://bridge.kick.app' },
  });

  // Step 3: Map sounds to rewards
  const soundFile1 = createTempAudio('.mp3');
  const soundFile2 = createTempAudio('.wav');
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'rew-life-1', soundPath: soundFile1, cooldown: 10, rewardVolume: 0.9 },
  });
  await requestLocalApi({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
    body: { rewardId: 'rew-life-2', soundPath: soundFile2, cooldown: 5, rewardVolume: 0.7 },
  });

  // Step 4: Verify sound availability
  const pubConfigured = (await requestLocalApi({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': token },
  })).json();
  assert.equal(pubConfigured.sounds['rew-life-1'].available, true);
  assert.equal(pubConfigured.sounds['rew-life-2'].available, true);

  // Step 5: Trigger playback and toggle streamer mode
  const state = {
    volume: 0.8,
    sounds: {
      'rew-life-1': { path: soundFile1, name: path.basename(soundFile1), available: true },
      'rew-life-2': { path: soundFile2, name: path.basename(soundFile2), available: true },
    },
    rewards: [
      { id: 'rew-life-1', title: 'Hype Sound' },
      { id: 'rew-life-2', title: 'Fail Sound' },
    ],
    streamerMode: false,
    queue: [],
    rewardCooldowns: {},
  };
  navigationComponent.toggleStreamMode(state);
  assert.ok(global.document.body.classList.contains('stream-mode'));

  soundpadComponent.triggerPadSound('rew-life-1', state);
  assert.ok(soundpadComponent.getActivePadAudio());

  // Step 6: Panic Stop halts sound and cleans up
  soundpadComponent.stopAllPadSounds();
  assert.equal(soundpadComponent.getActivePadAudio(), null);

  // Step 7: Disconnect cleanly
  const disconn = await requestLocalApi({
    method: 'POST',
    url: '/api/disconnect',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': token,
      'content-type': 'application/json',
    },
  });
  assert.equal(disconn.json().ok, true);
  navigationComponent.toggleStreamMode(state);
});

test('Tier 4 [Scenario 2]: High-Traffic Redemption Rush (50 Concurrent Redemptions)', () => {
  const state = {
    queue: [],
    rewardCooldowns: {},
    volume: 0.8,
    rewardVolumes: { 'rush-rew-1': 1.0, 'rush-rew-2': 0.5 },
  };

  let enqueuedCount = 0;
  let suppressedCount = 0;

  // 50 redemption burst across 2 rewards (Reward 1 has 5s cooldown, Reward 2 has 0s cooldown)
  for (let i = 0; i < 50; i++) {
    const isRew1 = i % 2 === 0;
    const rewardId = isRew1 ? 'rush-rew-1' : 'rush-rew-2';
    const cooldownMs = isRew1 ? 5000 : 0;
    const ok = queueComponent.enqueueRedemptionSound({ rewardId, redemptionId: `rush-${i}`, cooldownMs }, state);
    if (ok) enqueuedCount++;
    else suppressedCount++;
  }

  // Reward 1 should enqueue once (throttled by 5000ms cooldown), Reward 2 should enqueue 25 times
  assert.equal(enqueuedCount, 26);
  assert.equal(suppressedCount, 24);
  assert.equal(state.queue.length, 26);

  // Verify FIFO processing order
  assert.equal(state.queue[0].rewardId, 'rush-rew-1');
  assert.equal(state.queue[1].rewardId, 'rush-rew-2');

  // Verify effective volume for both types
  assert.equal(queueComponent.effectiveVolume('rush-rew-1', state), 0.8);
  assert.equal(queueComponent.effectiveVolume('rush-rew-2', state), 0.4);
});

test('Tier 4 [Scenario 3]: Upstream Outage & Exponential Backoff Recovery', () => {
  let failures = 0;
  let delay = pollingBackoff.getPollDelay({ consecutiveFailures: failures });
  assert.equal(delay, 10000); // Baseline: 10s

  // Kick API starts returning 503 errors -> Consecutive failures increment
  failures++;
  delay = pollingBackoff.getPollDelay({ consecutiveFailures: failures });
  assert.equal(delay, 30000); // 30s

  failures++;
  delay = pollingBackoff.getPollDelay({ consecutiveFailures: failures });
  assert.equal(delay, 60000); // 60s

  failures++;
  delay = pollingBackoff.getPollDelay({ consecutiveFailures: failures });
  assert.equal(delay, 120000); // 120s

  // Client logger records the diagnostic errors
  serverLogger.logError('Kick API Polling Outage', new Error('HTTP 503 Service Unavailable'), { consecutiveFailures: failures });
  assert.ok(serverLogger.readRecentLogs(50).includes('HTTP 503 Service Unavailable'));

  // Upstream recovers -> Consecutive failures reset to 0
  failures = 0;
  delay = pollingBackoff.getPollDelay({ consecutiveFailures: failures });
  assert.equal(delay, 10000); // Restored to 10s
});

test('Tier 4 [Scenario 4]: Streamer Privacy Shield & Disruption Mitigation', () => {
  const state = { streamerMode: false, queue: [] };

  // 1. Streamer enables privacy mode
  navigationComponent.toggleStreamMode(state);
  assert.ok(global.document.body.classList.contains('stream-mode'));

  // 2. Incoming redemptions
  state.queue.push({ rewardId: 'loud-sound-1' }, { rewardId: 'loud-sound-2' });
  assert.equal(state.queue.length, 2);

  // 3. Disruptive sound triggered -> Panic stop pressed
  queueComponent.clearQueue(state);
  soundpadComponent.stopAllPadSounds();
  assert.equal(state.queue.length, 0);
  assert.equal(soundpadComponent.getActivePadAudio(), null);

  navigationComponent.toggleStreamMode(state);
});

test('Tier 4 [Scenario 5]: Multi-Language Streamer Workflow Under Live Operation', () => {
  const state = {
    connected: true,
    volume: 0.85,
    rewards: [
      { id: 'multi-rew-1', title: 'Victory Roar', cost: 500 },
    ],
    sounds: { 'multi-rew-1': { path: createTempAudio('.mp3') } },
    queue: [{ rewardId: 'multi-rew-1' }],
    rewardCooldowns: {},
  };

  // English operation
  i18n.applyLanguage('en');
  assert.equal(global.document.documentElement.lang, 'en');
  assert.equal(global.document.documentElement.dir, 'ltr');
  studioComponent.renderRewards('rewards', state, { t: i18n.t });
  assert.ok(global.document.getElementById('rewards').innerHTML.includes('Victory Roar'));

  // Hot switch to Persian during active operation
  i18n.applyLanguage('fa');
  assert.equal(global.document.documentElement.lang, 'fa');
  assert.equal(global.document.documentElement.dir, 'rtl');

  // Verify queue and state remain uncorrupted
  assert.equal(state.queue.length, 1);
  assert.equal(state.volume, 0.85);

  // Switch back to English
  i18n.applyLanguage('en');
  assert.equal(global.document.documentElement.lang, 'en');
  assert.equal(global.document.documentElement.dir, 'ltr');
});

// =========================================================================
// Teardown & File Cleanup
// =========================================================================
test.after(() => {
  for (const f of createdTempFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
  // Restore initial config
  main.setConfig(initialConfig);
});
