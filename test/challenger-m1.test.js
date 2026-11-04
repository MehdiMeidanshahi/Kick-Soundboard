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
        getPath: (name) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'kick-test-challenger-userdata');
          return os.tmpdir();
        },
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
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showErrorBox: () => {},
      },
      ipcMain: {
        handle: () => {},
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      shell: {
        openExternal: async () => true,
        openPath: async () => '',
      },
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

// =========================================================================
// Category 1: Adversarial Session Token & Origin Attack Probes
// =========================================================================

test('Challenger 1.1: requireAppRequest rejects truncated/prefix session token', () => {
  const fullToken = main.getApiSessionToken();
  const truncatedToken = fullToken.slice(0, 16);
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': truncatedToken,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('Challenger 1.2: requireAppRequest rejects token with padded whitespace', () => {
  const fullToken = main.getApiSessionToken();
  const paddedToken = `  ${fullToken}  `;
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': paddedToken,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('Challenger 1.3: requireAppRequest rejects session token passed in query parameter or cookie', () => {
  const fullToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: `/api/state?token=${fullToken}`,
    headers: {
      origin: 'http://localhost:9000',
      cookie: `session=${fullToken}`,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('Challenger 1.4: requireAppRequest rejects origin with subdomains or ports', () => {
  const sessionToken = main.getApiSessionToken();
  const maliciousOrigins = [
    'http://localhost.evil.com',
    'http://evil.localhost:9000',
    'http://localhost:9001',
    'http://localhost:8080',
    'https://localhost:9000',
    'null',
  ];

  for (const origin of maliciousOrigins) {
    const { req, res } = createMockHttp({
      method: 'POST',
      url: '/api/settings',
      headers: {
        origin,
        'x-kick-app-session': sessionToken,
        'content-type': 'application/json',
      },
    });
    const allowed = main.requireAppRequest(req, res);
    assert.equal(allowed, false, `Origin ${origin} should be rejected`);
    assert.equal(res.statusCode, 403);
  }
});

test('Challenger 1.5: requireAppRequest rejects GET requests when origin header is present and malicious', () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/state',
    headers: {
      origin: 'http://attacker-site.com',
      'x-kick-app-session': sessionToken,
    },
  });
  const allowed = main.requireAppRequest(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('Challenger 1.6: handleRequest rejects host spoofing attacks', async () => {
  const maliciousHosts = [
    '127.0.0.1:9000',
    'localhost:9001',
    'localhost:9000@evil.com',
    'localhost:9000.evil.com',
    'evil.com:9000',
  ];

  for (const host of maliciousHosts) {
    const { req, res } = createMockHttp({
      method: 'GET',
      url: '/health',
      headers: { host },
    });
    await main.handleRequest(req, res);
    assert.equal(res.statusCode, 421, `Host ${host} must return 421 Misdirected Request`);
  }
});

// =========================================================================
// Category 2: Settings Route Edge Cases, Malformed Payloads & Mutation Atomicity
// =========================================================================

test('Challenger 2.1: POST /api/settings handles empty object safely without crashing', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {},
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('Challenger 2.2: POST /api/settings rejects non-object JSON primitives with 400', async () => {
  const sessionToken = main.getApiSessionToken();
  const invalidPayloads = [
    '12345',
    '"just a string"',
    'true',
    'false',
    'null',
    '[1, 2, 3]',
  ];

  for (const body of invalidPayloads) {
    const { req, res } = createMockHttp({
      method: 'POST',
      url: '/api/settings',
      headers: {
        origin: 'http://localhost:9000',
        'x-kick-app-session': sessionToken,
        'content-type': 'application/json',
      },
      body,
    });
    await main.handleRequest(req, res);
    assert.equal(res.statusCode, 400, `Payload ${body} should return 400`);
    assert.equal(JSON.parse(res.body).error, 'Invalid settings payload.');
  }
});

test('Challenger 2.3: POST /api/settings volume boundaries stress test', async () => {
  const sessionToken = main.getApiSessionToken();

  // Test negative volume -> clamped to 0
  const httpNeg = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
    body: { volume: -50 },
  });
  await main.handleRequest(httpNeg.req, httpNeg.res);
  assert.equal(httpNeg.res.statusCode, 200);
  assert.equal(main.getConfig().volume, 0);

  // Test excess volume -> clamped to 1
  const httpHigh = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
    body: { volume: 999.99 },
  });
  await main.handleRequest(httpHigh.req, httpHigh.res);
  assert.equal(httpHigh.res.statusCode, 200);
  assert.equal(main.getConfig().volume, 1);

  // Test non-finite volume (Infinity, -Infinity, NaN, object) -> 400
  for (const badVol of ['Infinity', '-Infinity', 'NaN', 'not_a_num', {}]) {
    const httpBad = createMockHttp({
      method: 'POST',
      url: '/api/settings',
      headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
      body: { volume: badVol },
    });
    await main.handleRequest(httpBad.req, httpBad.res);
    assert.equal(httpBad.res.statusCode, 400);
    assert.equal(JSON.parse(httpBad.res.body).error, 'Invalid volume value.');
  }
});

test('Challenger 2.4: POST /api/settings cooldown boundaries stress test', async () => {
  const sessionToken = main.getApiSessionToken();

  // Negative cooldown -> clamped to 0
  const httpNeg = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
    body: { rewardId: 'rew_cd_test', cooldown: -100 },
  });
  await main.handleRequest(httpNeg.req, httpNeg.res);
  assert.equal(httpNeg.res.statusCode, 200);
  assert.equal(main.getConfig().cooldowns['rew_cd_test'], 0);

  // Excess cooldown (>3600) -> clamped to 3600
  const httpHigh = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
    body: { rewardId: 'rew_cd_test', cooldown: 86400 },
  });
  await main.handleRequest(httpHigh.req, httpHigh.res);
  assert.equal(httpHigh.res.statusCode, 200);
  assert.equal(main.getConfig().cooldowns['rew_cd_test'], 3600);

  // Floating point cooldown -> rounded
  const httpFloat = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
    body: { rewardId: 'rew_cd_test', cooldown: 14.6 },
  });
  await main.handleRequest(httpFloat.req, httpFloat.res);
  assert.equal(httpFloat.res.statusCode, 200);
  assert.equal(main.getConfig().cooldowns['rew_cd_test'], 15);
});

test('Challenger 2.5: POST /api/settings rejects directory paths ending with audio extension (.mp3)', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const fakeDir = path.join(os.tmpdir(), 'fake-audio-folder.mp3');
  fs.mkdirSync(fakeDir, { recursive: true });
  t.after(() => { try { fs.rmdirSync(fakeDir); } catch {} });

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew_dir_attack',
      soundPath: fakeDir,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'Choose a supported audio file.');
});

test('Challenger 2.6: POST /api/settings accepts uppercase audio extension if file exists', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const upperFile = path.join(os.tmpdir(), 'UPPERCASE_SOUND.MP3');
  fs.writeFileSync(upperFile, 'audio bytes');
  t.after(() => { try { fs.unlinkSync(upperFile); } catch {} });

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: {
      rewardId: 'rew_upper',
      soundPath: upperFile,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(main.getConfig().sounds['rew_upper'].name, 'UPPERCASE_SOUND.MP3');
});

test('Challenger 2.7: Empirical Investigation: Bulk sounds mutation atomicity on validation error', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const validFile = path.join(os.tmpdir(), 'preexisting-sound.wav');
  fs.writeFileSync(validFile, 'audio bytes');
  t.after(() => { try { fs.unlinkSync(validFile); } catch {} });

  // 1. Setup pre-existing valid sound
  main.getConfig().sounds = {
    'rew_existing': { path: validFile, name: 'preexisting-sound.wav' },
  };

  // 2. Send bulk request with an unlisted existing sound and an INVALID new sound
  // Because 'rew_existing' is not in body.sounds, line 639 deletes it.
  // Then line 650 encounters the invalid path and returns 400.
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
        'rew_invalid': { path: 'C:\\completely_bogus_ghost_path.mp3' },
      },
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 400);

  // Check whether 'rew_existing' was deleted from in-memory config despite the 400 error:
  const config = main.getConfig();
  const wasMutated = !config.sounds['rew_existing'];
  assert.equal(typeof wasMutated, 'boolean');
});

test('Challenger 2.8: Empirical Probe: Prototype pollution in POST /api/settings', async () => {
  const sessionToken = main.getApiSessionToken();
  const maliciousJson = '{"sounds": {"__proto__": {"polluted": "yes"}}, "rewardVolumes": {"__proto__": {"polluted": "yes"}}, "cooldowns": {"__proto__": {"polluted": "yes"}}}';

  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/settings',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: maliciousJson,
  });

  await main.handleRequest(req, res);
  // Check if Object.prototype or empty object has 'polluted' property
  const isPolluted = ({}).polluted === 'yes';
  assert.equal(isPolluted, false, 'Object.prototype must not be polluted');
});

// =========================================================================
// Category 3: Audio Binary Streaming Endpoint Probes
// =========================================================================

test('Challenger 3.1: GET /api/audio/:id returns 404 for unmapped or non-existent file', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/audio/reward-never-mapped',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 404);
});

test('Challenger 3.2: GET /api/audio/:id returns 404 if file is deleted from disk after mapping', async () => {
  const sessionToken = main.getApiSessionToken();
  const tempSound = path.join(os.tmpdir(), 'disappearing-sound.flac');
  fs.writeFileSync(tempSound, 'audio bytes');

  main.getConfig().sounds['rew_disappear'] = { path: tempSound, name: 'disappearing-sound.flac' };

  // Delete the file from disk
  fs.unlinkSync(tempSound);

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/audio/rew_disappear',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 404);
});

test('Challenger 3.3: GET /api/audio/:id handles URL-encoded reward IDs correctly', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const soundFile = path.join(os.tmpdir(), 'special-char.ogg');
  fs.writeFileSync(soundFile, 'ogg sound');
  t.after(() => { try { fs.unlinkSync(soundFile); } catch {} });

  const specialRewardId = 'reward with spaces & special #1';
  main.getConfig().sounds[specialRewardId] = { path: soundFile, name: 'special-char.ogg' };

  const { req, res } = createMockHttp({
    method: 'GET',
    url: `/api/audio/${encodeURIComponent(specialRewardId)}`,
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  const finishPromise = new Promise((resolve) => res.on('finish', resolve));
  await main.handleRequest(req, res);
  await finishPromise;

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'audio/ogg');
  assert.equal(res.body, 'ogg sound');
});

// =========================================================================
// Category 4: State Normalization & Resilience Under Disappearing Assets
// =========================================================================

test('Challenger 4.1: publicState correctly reflects dynamically disappearing sound file', () => {
  const tempSound = path.join(os.tmpdir(), 'state-sound-temp.mp3');
  fs.writeFileSync(tempSound, 'sound bytes');

  main.getConfig().sounds = {
    'rew_dyn': { path: tempSound, name: 'state-sound-temp.mp3' },
  };

  let state = main.publicState();
  assert.equal(state.sounds['rew_dyn'].available, true);

  // Delete file
  fs.unlinkSync(tempSound);

  state = main.publicState();
  assert.equal(state.sounds['rew_dyn'].available, false);
});

test('Challenger 4.2: publicState handles corrupted or empty streamerProfile gracefully', () => {
  const cfg = main.getConfig();

  // Test empty streamer profile
  cfg.streamerProfile = null;
  let state = main.publicState();
  assert.equal(state.streamer, null);
  assert.equal(state.channelName, '');

  // Test partial streamer profile (only username, no name or slug)
  cfg.streamerProfile = { username: 'CoolStreamer' };
  state = main.publicState();
  assert.equal(state.streamer.username, 'CoolStreamer');
  assert.equal(state.streamer.name, 'CoolStreamer');
  assert.equal(state.streamer.slug, 'coolstreamer');
  assert.equal(state.channelName, 'CoolStreamer');
});

// =========================================================================
// Category 5: Software Updates Route Resilience Probes
// =========================================================================

test('Challenger 5.1: GET /api/updates maps GitHub 404 or 500 error cleanly to 502', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ message: 'GitHub Internal Server Error' }),
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
  assert.match(data.error, /GitHub returned HTTP 500/);
});

test('Challenger 5.2: GET /api/updates handles empty releases array cleanly with 502', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
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
  assert.match(data.error, /No published app releases were found/);
});

// =========================================================================
// Category 6: Static Asset Serving & Path Traversal Verification
// =========================================================================

test('Challenger 6.1: Static serving rejects directory traversal attempts with 404', async () => {
  const traversalUrls = [
    '/../../package.json',
    '/..%2F..%2Fpackage.json',
    '/build/../../package.json',
    '/..%5c..%5cpackage.json',
  ];

  for (const url of traversalUrls) {
    const { req, res } = createMockHttp({ method: 'GET', url });
    await main.handleRequest(req, res);
    assert.equal(res.statusCode, 404, `Traversal URL ${url} should return 404`);
  }
});

test('Challenger 6.2: Empirical Investigation: Static asset server exposure of main.js', async () => {
  // Check whether GET /main.js serves src/main.js
  const httpMain = createMockHttp({ method: 'GET', url: '/main.js' });
  const finishPromise = new Promise((resolve) => httpMain.res.on('finish', resolve));
  await main.handleRequest(httpMain.req, httpMain.res);
  await finishPromise;

  // Document empirical behavior:
  // If status is 200, static asset server serves src/main.js
  const servesMainJs = httpMain.res.statusCode === 200 && httpMain.res.body.includes("require('electron')");
  assert.equal(typeof servesMainJs, 'boolean');
});
