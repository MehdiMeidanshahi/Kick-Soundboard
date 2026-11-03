const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

// Mock electron before requiring src/main.js
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath === 'electron') {
    return {
      app: {
        isPackaged: false,
        getVersion: () => '0.2.1',
        getPath: () => os.tmpdir(),
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

const main = require('../src/main.js');

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
    setHeader(name, val) {
      this.headers[name.toLowerCase()] = val;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers)) {
        this.setHeader(k, v);
      }
    },
    end(chunk = '') {
      this.ended = true;
      if (chunk) this.body += chunk.toString();
    },
  };

  return { req, res };
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
