const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

// Captured IPC handlers and mock state
const ipcHandlers = new Map();
let mockDialogResult = { canceled: false, filePaths: ['C:\\sounds\\alert.mp3'] };
let openedExternalUrls = [];
let openedPaths = [];
let sentIpcMessages = [];
let encryptionAvailable = true;

// Mock electron before requiring src/main.js
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath === 'electron') {
    return {
      app: {
        isPackaged: false,
        getVersion: () => '0.2.1',
        getPath: (name) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'kick-test-userdata');
          return os.tmpdir();
        },
        requestSingleInstanceLock: () => true,
        on: () => {},
        whenReady: () => new Promise(() => {}), // Don't auto-start server on import
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
            send: (channel, payload) => {
              sentIpcMessages.push({ channel, payload });
            },
          };
        }
        show() {}
        focus() {}
        on() {}
      },
      dialog: {
        showOpenDialog: async () => mockDialogResult,
        showErrorBox: () => {},
      },
      ipcMain: {
        handle: (channel, handler) => {
          ipcHandlers.set(channel, handler);
        },
      },
      safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      shell: {
        openExternal: async (url) => {
          openedExternalUrls.push(url);
          return true;
        },
        openPath: async (p) => {
          openedPaths.push(p);
          return '';
        },
      },
    };
  }
  return origRequire.apply(this, arguments);
};

const main = require('../src/main.js');
const logger = require('../src/logger.js');

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

  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.ended = false;
  res.body = '';
  res.setHeader = function (name, val) {
    this.headers[name.toLowerCase()] = val;
  };
  res.getHeader = function (name) {
    return this.headers[name.toLowerCase()];
  };
  res.writeHead = function (status, headers = {}) {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers)) {
      this.setHeader(k, v);
    }
  };
  res.write = function (chunk = '') {
    if (chunk) this.body += chunk.toString();
    return true;
  };
  res.end = function (chunk = '') {
    this.ended = true;
    if (chunk) this.body += chunk.toString();
    this.emit('finish');
  };
  res.destroy = function () {
    this.ended = true;
    this.emit('close');
  };

  return { req, res };
}

function createTrustedEvent() {
  const allowedOrigin = main.getAllowedOrigin();
  const mainFrame = { url: `${allowedOrigin}/index.html` };
  return {
    senderFrame: mainFrame,
    sender: { mainFrame },
  };
}

function createUntrustedOriginEvent() {
  const mainFrame = { url: 'http://evil.com/index.html' };
  return {
    senderFrame: mainFrame,
    sender: { mainFrame },
  };
}

function createSubframeEvent() {
  const allowedOrigin = main.getAllowedOrigin();
  const mainFrame = { url: `${allowedOrigin}/index.html` };
  const childFrame = { url: `${allowedOrigin}/iframe.html` };
  return {
    senderFrame: childFrame,
    sender: { mainFrame },
  };
}

// -------------------------------------------------------------
// Security & Host Middleware
// -------------------------------------------------------------

test('local server: rejects request with non-localhost host header (421 Misdirected Request)', async () => {
  const { req, res } = createMockHttp({
    url: '/health',
    headers: { host: 'evil.com' },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 421);
  assert.equal(res.body, 'Misdirected request');
});

test('local server: requireAppRequest rejects invalid origin (403 Forbidden)', () => {
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: { origin: 'http://evil.com' },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Request rejected.');
});

test('local server: requireAppRequest rejects missing or invalid session token (403 Forbidden)', () => {
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': 'invalid_session_token',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Request rejected.');
});

test('local server: requireAppRequest rejects non-JSON Content-Type on POST (415 Unsupported Media Type)', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'text/plain',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 415);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Expected a JSON request.');
});

test('local server: requireAppRequest passes valid request', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, true);
});

// -------------------------------------------------------------
// Body Limit
// -------------------------------------------------------------

test('local server: readBody rejects payloads exceeding 64KB (413 Payload Too Large)', async () => {
  const oversizedBuffer = Buffer.alloc(70 * 1024, 'a');
  const { req } = createMockHttp({ body: oversizedBuffer });

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

test('local server: readBody successfully parses normal payloads', async () => {
  const normalBody = JSON.stringify({ hello: 'world' });
  const { req } = createMockHttp({ body: normalBody });
  const result = await main.readBody(req);
  assert.equal(result, normalBody);
});

// -------------------------------------------------------------
// Core Routes
// -------------------------------------------------------------

test('local server: GET /health returns 200 with ok: true', async () => {
  const { req, res } = createMockHttp({ url: '/health' });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
});

test('local server: GET /api/state returns current public state with streamer info', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(typeof data.configured, 'boolean');
  assert.equal(typeof data.connected, 'boolean');
  assert.equal(typeof data.volume, 'number');
  assert.ok(Array.isArray(data.history));
});

test('local server: GET /nonexistent returns 404 Not found', async () => {
  const { req, res } = createMockHttp({ url: '/nonexistent' });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, 'Not found');
});

// -------------------------------------------------------------
// Audio & Settings Routes
// -------------------------------------------------------------

test('local server: GET /api/audio/:id rejects unauthorized caller with 403', async () => {
  const { req, res } = createMockHttp({ url: '/api/audio/unmapped-reward-id' });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 403);
});

test('local server: GET /api/audio/:id returns 404 when authorized but sound not found', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    url: '/api/audio/unmapped-reward-id',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 404);
});

test('local server: POST /api/settings rejects unsupported audio file extensions (400)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew_1',
      soundPath: path.resolve('package.json'), // Not an audio file
    },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Choose a supported audio file.');
});

test('local server: POST /api/settings clamps volume and cooldown bounds', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      volume: 1.5, // should clamp to 1.0
      outputDeviceId: 'virtual_cable_1',
      streamerMode: true,
      playPending: true,
      rewardId: 'rew_test',
      cooldown: 5000, // should clamp to 3600
      rewardVolume: 2.0, // should clamp to 1.0
    },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);

  const config = main.getConfig();
  assert.equal(config.volume, 1.0);
  assert.equal(config.outputDeviceId, 'virtual_cable_1');
  assert.equal(config.streamerMode, true);
  assert.equal(config.playPending, true);
  assert.equal(config.cooldowns['rew_test'], 3600);
  assert.equal(config.rewardVolumes['rew_test'], 1.0);
});

test('local server: POST /api/history/clear clears redemption history', async () => {
  const sessionToken = main.getApiSessionToken();
  const config = main.getConfig();
  config.history = [{ id: '1', rewardTitle: 'Sound 1' }];

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/history/clear',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(main.getConfig().history, []);
});

test('local server: POST /api/disconnect resets connection state', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/disconnect',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(main.getConfig().streamerProfile, null);
});

// -------------------------------------------------------------
// OAuth State Mismatch in Callback
// -------------------------------------------------------------

test('local server: GET /?code=...&state=... fails with 400 when state does not match', async () => {
  const { req, res } = createMockHttp({
    url: '/?code=auth_code_123&state=unmatched_state',
  });
  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Kick connection failed/);
  assert.match(res.body, /Authorization state did not match/);
});


// =============================================================
// Milestone 1: Session Authentication & IPC Verification Suite
// =============================================================

test('local server: requireAppRequest PASS scenario - accepts x-kick-app-session', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, true);
  assert.equal(res.statusCode, 200);
});

test('local server: requireAppRequest PASS scenario - accepts x-app-session for backward compatibility', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-app-session': sessionToken,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, true);
  assert.equal(res.statusCode, 200);
});

test('local server: requireAppRequest PASS scenario - accepts case-variant headers (X-Kick-App-Session, X-App-Session, mixed)', () => {
  const sessionToken = main.getApiSessionToken();

  const http1 = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });
  assert.equal(main.requireAppRequest(http1.req, http1.res), true);

  const http2 = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-app-session': sessionToken,
    },
  });
  assert.equal(main.requireAppRequest(http2.req, http2.res), true);
});

test('local server: requireAppRequest PASS scenario - allows GET request without origin header', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/audio/sample-sound',
    headers: {
      'x-kick-app-session': sessionToken,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, true);
});

test('local server: requireAppRequest FAIL scenario - rejects missing session token header (403)', () => {
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Request rejected.');
});

test('local server: requireAppRequest FAIL scenario - rejects empty session token (403)', () => {
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': '',
      'x-app-session': '',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('local server: requireAppRequest FAIL scenario - rejects forged x-app-session token (403)', () => {
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-app-session': 'forged_session_token_xyz',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('local server: requireAppRequest FAIL scenario - rejects missing origin on POST request (403)', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('local server: requireAppRequest FAIL scenario - rejects non-localhost origin on POST (403)', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://attacker-site.com',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('local server: assertTrustedFrame PASS scenario - validates mainFrame with allowed origin', () => {
  const allowedOrigin = main.getAllowedOrigin();
  const mainFrame = {};
  const mockEvent = {
    senderFrame: mainFrame,
    sender: { mainFrame },
  };
  mockEvent.senderFrame.url = `${allowedOrigin}/index.html`;

  assert.doesNotThrow(() => {
    main.assertTrustedFrame(mockEvent);
  });
});

test('local server: assertTrustedFrame FAIL scenario - rejects external/unauthorized origin', () => {
  const mainFrame = {};
  const mockEvent = {
    senderFrame: mainFrame,
    sender: { mainFrame },
  };
  mockEvent.senderFrame.url = 'http://evil.com/phishing.html';

  assert.throws(
    () => {
      main.assertTrustedFrame(mockEvent);
    },
    { message: 'Untrusted app frame.' }
  );
});

test('local server: assertTrustedFrame FAIL scenario - rejects child/subframe invocation', () => {
  const allowedOrigin = main.getAllowedOrigin();
  const mainFrame = {};
  const childFrame = {};
  const mockEvent = {
    senderFrame: childFrame,
    sender: { mainFrame },
  };
  mockEvent.senderFrame.url = `${allowedOrigin}/iframe.html`;

  assert.throws(
    () => {
      main.assertTrustedFrame(mockEvent);
    },
    { message: 'Untrusted app frame.' }
  );
});

test('local server: getApiSessionToken returns cryptographically sound base64url token', () => {
  const token = main.getApiSessionToken();
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 40, `Token length ${token.length} should be at least 40 characters`);
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'Token must match base64url characters');
});

// =============================================================
// Milestone 1: Settings API & State Normalization Comprehensive Tests
// =============================================================

test('local server: POST /api/settings per-reward assigns sound, volume, and cooldown (PASS)', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const dummyAudioPath = path.join(os.tmpdir(), 'valid-reward-sound.mp3');
  fs.writeFileSync(dummyAudioPath, 'dummy audio data');
  t.after(() => { try { fs.unlinkSync(dummyAudioPath); } catch {} });

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew_pass_1',
      soundPath: dummyAudioPath,
      cooldown: 45,
      rewardVolume: 0.75,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  const config = main.getConfig();
  assert.equal(config.sounds['rew_pass_1'].path, path.resolve(dummyAudioPath));
  assert.equal(config.sounds['rew_pass_1'].name, 'valid-reward-sound.mp3');
  assert.equal(config.cooldowns['rew_pass_1'], 45);
  assert.equal(config.rewardVolumes['rew_pass_1'], 0.75);

  const state = main.publicState();
  assert.equal(state.sounds['rew_pass_1'].name, 'valid-reward-sound.mp3');
  assert.equal(state.sounds['rew_pass_1'].available, true);
  assert.equal(state.sounds['rew_pass_1'].path, path.resolve(dummyAudioPath));
  assert.equal(state.cooldowns['rew_pass_1'], 45);
  assert.equal(state.rewardCooldowns['rew_pass_1'], 45);
  assert.equal(state.rewardVolumes['rew_pass_1'], 0.75);
});

test('local server: POST /api/settings per-reward clears mapped sound (PASS)', async () => {
  const sessionToken = main.getApiSessionToken();
  const config = main.getConfig();
  config.sounds['rew_to_clear'] = { path: 'some-path.mp3', name: 'some-path.mp3' };

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew_to_clear',
      clearSound: true,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(main.getConfig().sounds['rew_to_clear'], undefined);
  assert.equal(main.publicState().sounds['rew_to_clear'], undefined);
});

test('local server: POST /api/settings handles bulk sounds update and removal (PASS)', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const soundA = path.join(os.tmpdir(), 'bulk-a.wav');
  const soundB = path.join(os.tmpdir(), 'bulk-b.ogg');
  fs.writeFileSync(soundA, 'dummy');
  fs.writeFileSync(soundB, 'dummy');
  t.after(() => {
    try { fs.unlinkSync(soundA); } catch {}
    try { fs.unlinkSync(soundB); } catch {}
  });

  // Assign both
  const { req: req1, res: res1 } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      sounds: {
        'rew-a': { path: soundA },
        'rew-b': { path: soundB },
      },
    },
  });
  await main.handleRequest(req1, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(main.getConfig().sounds['rew-a'].name, 'bulk-a.wav');
  assert.equal(main.getConfig().sounds['rew-b'].name, 'bulk-b.ogg');

  // Bulk update with only rew-a removes rew-b
  const { req: req2, res: res2 } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      sounds: {
        'rew-a': { path: soundA },
      },
    },
  });
  await main.handleRequest(req2, res2);
  assert.equal(res2.statusCode, 200);
  assert.ok(main.getConfig().sounds['rew-a']);
  assert.equal(main.getConfig().sounds['rew-b'], undefined);
});

test('local server: POST /api/settings handles bulk rewardVolumes and cooldowns (PASS)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardVolumes: { 'bulk-1': 0.4, 'bulk-2': 0.9 },
      rewardCooldowns: { 'bulk-1': 12 },
      cooldowns: { 'bulk-2': 30 },
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);

  const cfg = main.getConfig();
  assert.equal(cfg.rewardVolumes['bulk-1'], 0.4);
  assert.equal(cfg.rewardVolumes['bulk-2'], 0.9);
  assert.equal(cfg.cooldowns['bulk-1'], 12);
  assert.equal(cfg.cooldowns['bulk-2'], 30);
});

test('local server: POST /api/settings accepts audioDeviceId alias and updates outputDeviceId (PASS)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      audioDeviceId: 'obs-virtual-cable-output',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(main.getConfig().outputDeviceId, 'obs-virtual-cable-output');

  const state = main.publicState();
  assert.equal(state.outputDeviceId, 'obs-virtual-cable-output');
  assert.equal(state.audioDeviceId, 'obs-virtual-cable-output');
});

test('local server: publicState normalizes streamer, poll timestamps, audioDeviceId, and updates (PASS)', () => {
  const config = main.getConfig();
  config.streamerProfile = { userId: 99, name: 'ProStreamer', profilePicture: 'https://pic.png' };
  config.outputDeviceId = 'cable-1';

  main.setLastPollSuccessAt('2026-11-03T18:00:00.000Z');
  main.setNextPollAt('2026-11-03T18:00:10.000Z');
  main.setConsecutivePollFailures(2);
  main.setPolling(true);
  main.setLatestUpdateAvailable(true);

  const state = main.publicState();
  assert.equal(state.streamer.username, 'ProStreamer');
  assert.equal(state.streamer.name, 'ProStreamer');
  assert.equal(state.streamer.slug, 'prostreamer');
  assert.equal(state.streamerProfile.username, 'ProStreamer');
  assert.equal(state.channelName, 'ProStreamer');

  assert.equal(state.lastPollSuccessAt, '2026-11-03T18:00:00.000Z');
  assert.equal(state.lastChecked, '2026-11-03T18:00:00.000Z');
  assert.equal(state.nextPollAt, '2026-11-03T18:00:10.000Z');
  assert.equal(state.nextCheck, '2026-11-03T18:00:10.000Z');
  assert.equal(state.consecutiveFailures, 2);
  assert.equal(state.polling, true);
  assert.equal(state.outputDeviceId, 'cable-1');
  assert.equal(state.audioDeviceId, 'cable-1');
  assert.equal(state.updateAvailable, true);
  assert.equal(state.hasUpdate, true);
});

test('local server: POST /api/settings rejects corrupt JSON body with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: '{"volume": corrupt_json_here',
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Invalid JSON payload.');
});

test('local server: POST /api/settings rejects non-object payload with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: [1, 2, 3],
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Invalid settings payload.');
});

test('local server: POST /api/settings rejects non-existent audio file cleanly with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew_nonexistent',
      soundPath: 'C:\\this_audio_file_does_not_exist_anywhere.mp3',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Choose a supported audio file.');
});

test('local server: POST /api/settings rejects bulk non-existent audio file with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      sounds: {
        'rew-1': { path: 'C:\\ghost.wav' },
      },
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Choose a supported audio file.');
});

test('local server: POST /api/settings rejects non-numeric volume with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: { volume: 'invalid-volume' },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Invalid volume value.');
});

test('local server: POST /api/settings rejects non-numeric rewardVolume with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew-1',
      rewardVolume: 'loud',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Invalid reward volume value.');
});

test('local server: POST /api/settings rejects non-numeric cooldown with 400 (FAIL)', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew-1',
      cooldown: 'one_minute',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Invalid cooldown value.');
});

// =============================================================
// Milestone 1: Comprehensive Untested Routes & IPC Handlers
// =============================================================

test('local server: GET /api/updates PASS scenario - returns updateAvailable and hasUpdate when newer release exists', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ tag_name: 'v1.0.0', draft: false, prerelease: false }],
      };
    }
    return origFetch(url);
  };
  t.after(() => { global.fetch = origFetch; });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/updates',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.updateAvailable, true);
  assert.equal(data.hasUpdate, true);
  assert.equal(data.latestVersion, '1.0.0');
  assert.equal(data.currentVersion, '0.2.1');
});

test('local server: GET /api/updates PASS scenario - returns updateAvailable: false when version is current', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ tag_name: 'v0.2.1', draft: false, prerelease: false }],
      };
    }
    return origFetch(url);
  };
  t.after(() => { global.fetch = origFetch; });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/updates',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.updateAvailable, false);
  assert.equal(data.hasUpdate, false);
});

test('local server: GET /api/updates FAIL scenario - maps GitHub rate limit or API error to 502', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: false,
        status: 403,
        json: async () => ({ message: 'API rate limit exceeded' }),
      };
    }
    return origFetch(url);
  };
  t.after(() => { global.fetch = origFetch; });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/updates',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 502);
  const data = JSON.parse(res.body);
  assert.match(data.error, /GitHub returned HTTP 403/);
});

test('local server: GET /api/updates FAIL scenario - maps timeout to 502', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const origFetch = global.fetch;
  global.fetch = async () => {
    const err = new Error('Timeout');
    err.name = 'TimeoutError';
    throw err;
  };
  t.after(() => { global.fetch = origFetch; });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/updates',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 502);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'GitHub update check timed out.');
});

test('local server: POST /api/config PASS scenario - trims clientId and bridgeUrl and encrypts secret', async () => {
  const sessionToken = main.getApiSessionToken();
  encryptionAvailable = true;

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/config',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      clientId: '  client-abc  ',
      bridgeUrl: '  https://test-bridge.com  ',
      clientSecret: 'secret_12345',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  const cfg = main.getConfig();
  assert.equal(cfg.clientId, 'client-abc');
  assert.equal(cfg.bridgeUrl, 'https://test-bridge.com');
  assert.ok(cfg.encryptedClientSecret);
});

test('local server: POST /api/config FAIL scenario - returns 500 when safeStorage encryption unavailable', async () => {
  const sessionToken = main.getApiSessionToken();
  encryptionAvailable = false;

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/config',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      clientSecret: 'secret_cannot_encrypt',
    },
  });

  await main.handleRequest(req, res);
  encryptionAvailable = true; // restore

  assert.equal(res.statusCode, 500);
  const data = JSON.parse(res.body);
  assert.match(data.error, /Windows secure storage is unavailable/);
});

test('local server: POST /api/connect PASS scenario - opens bridge URL when bridge configured', async () => {
  const sessionToken = main.getApiSessionToken();
  main.getConfig().bridgeUrl = 'https://custom-bridge.org';
  openedExternalUrls = [];

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/connect',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(data.url, 'https://custom-bridge.org/api/auth/login');
  assert.equal(openedExternalUrls[0], 'https://custom-bridge.org/api/auth/login');
});

test('local server: POST /api/connect PASS scenario - opens default bridge login URL when custom bridge not configured', async () => {
  const sessionToken = main.getApiSessionToken();
  main.getConfig().bridgeUrl = '';
  openedExternalUrls = [];

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/connect',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(openedExternalUrls[0], 'https://kicksoundboard-itsmehdi7.vercel.app/api/auth/login');
});

test('local server: GET /api/rewards PASS scenario - returns rewards list when connected', async (t) => {
  const sessionToken = main.getApiSessionToken();
  main.setAuthTokens({ access: 'valid-test-access-token', refresh: 'valid-refresh-token', expiresAt: Date.now() + 3600000 });

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/channels/rewards')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'rew-mock-1', title: 'Airhorn', cost: 200 },
            { id: 'rew-mock-2', title: 'Applause', cost: 500 },
          ],
        }),
      };
    }
    return origFetch(url);
  };
  t.after(() => {
    global.fetch = origFetch;
    main.setAuthTokens({ access: '', refresh: '', expiresAt: 0 });
  });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/rewards',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.data.length, 2);
  assert.equal(data.data[0].title, 'Airhorn');
});

test('local server: GET /api/rewards FAIL scenario - returns 401 when disconnected', async () => {
  const sessionToken = main.getApiSessionToken();
  main.setAuthTokens({ access: '', refresh: '', expiresAt: 0 });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/rewards',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 401);
  const data = JSON.parse(res.body);
  assert.match(data.error, /Connect your Kick account first/);
});

test('local server: POST /api/test-sound PASS scenario - dispatches play-sound IPC to renderer', async () => {
  const sessionToken = main.getApiSessionToken();
  sentIpcMessages = [];
  main.setMainWindow({
    webContents: {
      send: (channel, payload) => sentIpcMessages.push({ channel, payload }),
    },
  });

  main.getConfig().volume = 0.85;
  main.getConfig().rewardVolumes = { 'rew_test_sound': 0.6 };

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/test-sound',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: { rewardId: 'rew_test_sound' },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  assert.equal(sentIpcMessages.length, 1);
  assert.equal(sentIpcMessages[0].channel, 'play-sound');
  assert.equal(sentIpcMessages[0].payload.rewardId, 'rew_test_sound');
  assert.equal(sentIpcMessages[0].payload.masterVolume, 0.85);
  assert.equal(sentIpcMessages[0].payload.rewardVolume, 0.6);
});

test('local server: POST /api/poll PASS scenario - executes polling check cleanly', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/poll',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('local server: GET /api/status PASS scenario - returns connected: false when disconnected', async () => {
  const sessionToken = main.getApiSessionToken();
  main.setAuthTokens({ access: '', refresh: '', expiresAt: 0 });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/status',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.connected, false);
});

test('local server: GET /api/status PASS scenario - returns connected: true when token valid', async () => {
  const sessionToken = main.getApiSessionToken();
  main.setAuthTokens({ access: 'valid-test-access-token', refresh: 'valid-refresh-token', expiresAt: Date.now() + 3600000 });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/status',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.connected, true);

  main.setAuthTokens({ access: '', refresh: '', expiresAt: 0 });
});

test('local server: POST /api/log-error PASS scenario - ingests client error and writes to log file', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/log-error',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      context: 'AudioPlayer',
      message: 'Failed to load audio stream',
      stack: 'Error: Failed to load\n at play()',
      code: 'ERR_MEDIA',
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.ok(data.path);
});

test('local server: GET /api/logs PASS scenario - returns recent logs and log file path', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/logs',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.path);
  assert.equal(typeof data.recent, 'string');
});

test('local server: static file serving PASS scenario - serves index.html, style.css, and renderer.js', async () => {
  // 1. GET /
  const httpRoot = createMockHttp({ url: '/' });
  const finishRoot = new Promise((resolve) => httpRoot.res.on('finish', resolve));
  await main.handleRequest(httpRoot.req, httpRoot.res);
  await finishRoot;
  assert.equal(httpRoot.res.statusCode, 200);
  assert.match(httpRoot.res.getHeader('content-type'), /text\/html/);
  assert.ok(httpRoot.res.body.includes('Kick Soundboard'));

  // 2. GET /style.css
  const httpCss = createMockHttp({ url: '/style.css' });
  const finishCss = new Promise((resolve) => httpCss.res.on('finish', resolve));
  await main.handleRequest(httpCss.req, httpCss.res);
  await finishCss;
  assert.equal(httpCss.res.statusCode, 200);
  assert.match(httpCss.res.getHeader('content-type'), /text\/css/);

  // 3. GET /renderer.js
  const httpJs = createMockHttp({ url: '/renderer.js' });
  const finishJs = new Promise((resolve) => httpJs.res.on('finish', resolve));
  await main.handleRequest(httpJs.req, httpJs.res);
  await finishJs;
  assert.equal(httpJs.res.statusCode, 200);
  assert.match(httpJs.res.getHeader('content-type'), /text\/javascript/);
});

test('local server: static file serving FAIL scenario - returns 404 for missing file, directory traversal, and disallowed extension', async () => {
  // 1. Missing file
  const httpMissing = createMockHttp({ url: '/non-existent-style.css' });
  await main.handleRequest(httpMissing.req, httpMissing.res);
  assert.equal(httpMissing.res.statusCode, 404);

  // 2. Directory traversal attempt
  const httpTraversal = createMockHttp({ url: '/../../package.json' });
  await main.handleRequest(httpTraversal.req, httpTraversal.res);
  assert.equal(httpTraversal.res.statusCode, 404);

  // 3. Disallowed extension (.md)
  const httpMd = createMockHttp({ url: '/README.md' });
  await main.handleRequest(httpMd.req, httpMd.res);
  assert.equal(httpMd.res.statusCode, 404);
});

test('local server: GET /api/audio/:id PASS scenario - streams binary audio with correct Content-Type', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const dummyAudio = path.join(os.tmpdir(), 'test-stream-sound.mp3');
  fs.writeFileSync(dummyAudio, 'test audio binary data');
  t.after(() => { try { fs.unlinkSync(dummyAudio); } catch {} });

  main.getConfig().sounds['rew_stream_test'] = { path: dummyAudio, name: 'test-stream-sound.mp3' };

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/audio/rew_stream_test',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  const finishAudio = new Promise((resolve) => res.on('finish', resolve));
  await main.handleRequest(req, res);
  await finishAudio;

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'audio/mpeg');
  assert.equal(res.body, 'test audio binary data');
});

test('IPC Handlers: PASS scenario - all 7 IPC handlers execute successfully with trusted frame', async () => {
  const trustedEvent = createTrustedEvent();

  // 1. choose-audio (file selected)
  mockDialogResult = { canceled: false, filePaths: ['C:\\sounds\\ding.mp3'] };
  assert.equal(await ipcHandlers.get('choose-audio')(trustedEvent), 'C:\\sounds\\ding.mp3');

  // choose-audio (canceled)
  mockDialogResult = { canceled: true, filePaths: [] };
  assert.equal(await ipcHandlers.get('choose-audio')(trustedEvent), null);

  // 2. get-api-session-token
  assert.equal(ipcHandlers.get('get-api-session-token')(trustedEvent), main.getApiSessionToken());

  // 3. open-releases
  openedExternalUrls = [];
  await ipcHandlers.get('open-releases')(trustedEvent);
  assert.match(openedExternalUrls[0], /github\.com.*releases/);

  // 4. log-error
  const logRes = ipcHandlers.get('log-error')(trustedEvent, {
    context: 'IPC Test Context',
    message: 'IPC test message',
    stack: 'Error at ipc()',
    code: 'IPC_TEST',
  });
  assert.equal(logRes.ok, true);

  // 5. get-log-path
  const logPath = ipcHandlers.get('get-log-path')(trustedEvent);
  assert.equal(typeof logPath, 'string');
  assert.ok(logPath.includes('error.log'));

  // 6. open-logs-folder
  openedPaths = [];
  await ipcHandlers.get('open-logs-folder')(trustedEvent);
  assert.equal(openedPaths.length, 1);

  // 7. get-recent-logs
  const recentLogs = ipcHandlers.get('get-recent-logs')(trustedEvent);
  assert.equal(typeof recentLogs, 'string');
});

test('IPC Handlers: FAIL scenario - all 7 IPC handlers reject untrusted origin and child frames', async () => {
  const untrustedOriginEvent = createUntrustedOriginEvent();
  const subframeEvent = createSubframeEvent();

  const handlerKeys = [
    'choose-audio',
    'get-api-session-token',
    'open-releases',
    'log-error',
    'get-log-path',
    'open-logs-folder',
    'get-recent-logs',
  ];

  for (const key of handlerKeys) {
    const handler = ipcHandlers.get(key);
    assert.ok(handler, `Handler ${key} should be registered with ipcMain.handle`);

    // Untrusted external origin (e.g. http://evil.com)
    await assert.rejects(
      async () => {
        await handler(untrustedOriginEvent, {});
      },
      { message: 'Untrusted app frame.' }
    );

    // Child/subframe invocation
    await assert.rejects(
      async () => {
        await handler(subframeEvent, {});
      },
      { message: 'Untrusted app frame.' }
    );
  }
});
