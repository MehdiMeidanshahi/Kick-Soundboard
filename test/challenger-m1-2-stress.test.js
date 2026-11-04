const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

// Mock electron before requiring src/main.js
const Module = require('module');
const origRequire = Module.prototype.require;

const capturedIpcHandlers = new Map();
let mockDialogResult = { canceled: false, filePaths: ['C:\\mock\\test.mp3'] };
let openedExternalUrls = [];
let openedPaths = [];

Module.prototype.require = function (modulePath) {
  if (modulePath === 'electron') {
    return {
      app: {
        isPackaged: false,
        getVersion: () => '0.2.1',
        getPath: (name) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'kick-challenger-m1-2-userdata');
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
        showOpenDialog: async () => mockDialogResult,
        showErrorBox: () => {},
      },
      ipcMain: {
        handle: (channel, handler) => {
          capturedIpcHandlers.set(channel, handler);
        },
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
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

function makeTrustedEvent() {
  const allowedOrigin = main.getAllowedOrigin();
  const mainFrame = { url: `${allowedOrigin}/index.html` };
  return {
    senderFrame: mainFrame,
    sender: { mainFrame },
  };
}

// =============================================================================
// Suite 1: IPC Frame Gate `assertTrustedFrame` Adversarial Stress
// =============================================================================

test('Suite 1.1: assertTrustedFrame approves top-level mainFrame matching allowedOrigin', () => {
  const trustedEvent = makeTrustedEvent();
  assert.doesNotThrow(() => main.assertTrustedFrame(trustedEvent));
});

test('Suite 1.2: assertTrustedFrame rejects external origins', () => {
  const externalOrigins = [
    'http://evil.com/index.html',
    'https://localhost:9000/index.html',
    'http://localhost:9001/index.html',
    'http://127.0.0.1:9000/index.html',
    'about:blank',
    'file:///C:/malicious.html',
    'http://attacker.com?origin=http://localhost:9000',
    'http://localhost:9000@evil.com',
  ];

  for (const originUrl of externalOrigins) {
    const frame = { url: originUrl };
    const event = { senderFrame: frame, sender: { mainFrame: frame } };
    assert.throws(
      () => main.assertTrustedFrame(event),
      (err) => err.message === 'Untrusted app frame.',
      `Origin ${originUrl} should be rejected with 'Untrusted app frame.'`
    );
  }

  // Syntactically invalid URL (e.g. invalid port syntax) throws TypeError: Invalid URL
  const invalidUrlFrame = { url: 'http://localhost:9000.attacker.com' };
  const invalidEvent = { senderFrame: invalidUrlFrame, sender: { mainFrame: invalidUrlFrame } };
  assert.throws(
    () => main.assertTrustedFrame(invalidEvent),
    (err) => err instanceof TypeError,
    'Invalid URL syntax throws TypeError'
  );
});

test('Suite 1.3: assertTrustedFrame rejects subframes / iframes even if URL origin matches', () => {
  const allowedOrigin = main.getAllowedOrigin();
  const mainFrame = { url: `${allowedOrigin}/index.html` };
  const subFrame = { url: `${allowedOrigin}/embedded-frame.html` };

  const subframeEvent = {
    senderFrame: subFrame,
    sender: { mainFrame },
  };

  assert.throws(
    () => main.assertTrustedFrame(subframeEvent),
    (err) => err.message === 'Untrusted app frame.'
  );
});

test('Suite 1.4: assertTrustedFrame rejects malformed or missing event objects', () => {
  assert.throws(() => main.assertTrustedFrame(null));
  assert.throws(() => main.assertTrustedFrame(undefined));
  assert.throws(() => main.assertTrustedFrame({}));
  assert.throws(() => main.assertTrustedFrame({ senderFrame: null }));
  assert.throws(() => main.assertTrustedFrame({ senderFrame: { url: 'not-a-valid-url' } }));
});

test('Suite 1.5: IPC handlers strictly enforce assertTrustedFrame', async () => {
  const untrustedEvent = {
    senderFrame: { url: 'http://evil.com' },
    sender: { mainFrame: { url: 'http://evil.com' } },
  };

  const allHandlers = [
    'choose-audio',
    'get-api-session-token',
    'open-releases',
    'log-error',
    'get-log-path',
    'open-logs-folder',
    'get-recent-logs',
  ];

  for (const channel of allHandlers) {
    const handler = capturedIpcHandlers.get(channel);
    assert.ok(handler, `Handler for ${channel} must exist`);

    await assert.rejects(
      async () => {
        if (channel === 'log-error') {
          return handler(untrustedEvent, { message: 'test' });
        }
        return handler(untrustedEvent);
      },
      (err) => err.message === 'Untrusted app frame.',
      `IPC handler ${channel} must reject untrusted frame with 'Untrusted app frame.'`
    );
  }
});

test('Suite 1.6: IPC log-error handler handles empty / missing details gracefully when trusted', async () => {
  const trustedEvent = makeTrustedEvent();
  const handler = capturedIpcHandlers.get('log-error');

  // Should succeed with default details object
  const resWithObj = await handler(trustedEvent, { context: 'Test IPC', message: 'IPC test message' });
  assert.equal(resWithObj.ok, true);

  // If passed an empty object
  const resEmpty = await handler(trustedEvent, {});
  assert.equal(resEmpty.ok, true);
});

// =============================================================================
// Suite 2: Audio Streaming Path Traversal & Robustness Attacks
// =============================================================================

test('Suite 2.1: Path traversal attempts in /api/audio/:id return 404', async () => {
  const sessionToken = main.getApiSessionToken();
  const traversalIds = [
    '..%2f..%2fWindows%2fwin.ini',
    '%2e%2e%2f%2e%2e%2fpackage.json',
    '....//....//config.json',
    '..\\..\\Windows\\win.ini',
    '%2e%2e%5c%2e%2e%5cpackage.json',
    '..%252f..%252fpackage.json',
  ];

  for (const tid of traversalIds) {
    const { req, res } = createMockHttp({
      method: 'GET',
      url: `/api/audio/${tid}`,
      headers: {
        origin: 'http://localhost:9000',
        'x-kick-app-session': sessionToken,
      },
    });

    await main.handleRequest(req, res);
    assert.equal(res.statusCode, 404, `Audio path traversal ${tid} must return 404`);
  }
});

test('Suite 2.2: Prototype properties as reward IDs return 404 without crashing', async () => {
  const sessionToken = main.getApiSessionToken();
  const protoKeys = ['__proto__', 'constructor', 'toString', 'valueOf', 'isPrototypeOf', 'hasOwnProperty'];

  for (const key of protoKeys) {
    const { req, res } = createMockHttp({
      method: 'GET',
      url: `/api/audio/${key}`,
      headers: {
        origin: 'http://localhost:9000',
        'x-kick-app-session': sessionToken,
      },
    });

    await main.handleRequest(req, res);
    assert.equal(res.statusCode, 404, `Prototype key ${key} must return 404`);
  }
});

test('Suite 2.3: Audio streaming for valid mapped file handles binary pipe cleanly', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const tempAudio = path.join(os.tmpdir(), 'valid-stream-test.mp3');
  const binaryPayload = Buffer.from('FAKE-ID3-AUDIO-STREAM-DATA-BYTES-12345');
  fs.writeFileSync(tempAudio, binaryPayload);
  t.after(() => { try { fs.unlinkSync(tempAudio); } catch {} });

  main.getConfig().sounds = {
    'stream-reward-ok': { path: tempAudio, name: 'valid-stream-test.mp3' },
  };

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/audio/stream-reward-ok',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  const finishPromise = new Promise((resolve) => res.on('finish', resolve));
  await main.handleRequest(req, res);
  await finishPromise;

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'audio/mpeg');
  assert.equal(res.getHeader('cache-control'), 'no-store');
  assert.equal(res.body, binaryPayload.toString());
});

test('Suite 2.4: Audio stream error event terminates response without throwing', async (t) => {
  const sessionToken = main.getApiSessionToken();
  const tempAudio = path.join(os.tmpdir(), 'error-stream-test.wav');
  fs.writeFileSync(tempAudio, 'wav data');
  t.after(() => { try { fs.unlinkSync(tempAudio); } catch {} });

  main.getConfig().sounds = {
    'stream-reward-err': { path: tempAudio, name: 'error-stream-test.wav' },
  };

  const origCreateReadStream = fs.createReadStream;
  fs.createReadStream = function (filePath, opts) {
    if (filePath === tempAudio) {
      const stream = new Readable({
        read() {
          process.nextTick(() => {
            this.emit('error', new Error('Simulated stream disk read failure'));
          });
        },
      });
      return stream;
    }
    return origCreateReadStream.call(fs, filePath, opts);
  };
  t.after(() => { fs.createReadStream = origCreateReadStream; });

  const { req, res } = createMockHttp({
    method: 'GET',
    url: '/api/audio/stream-reward-err',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
    },
  });

  const closeOrFinish = new Promise((resolve) => {
    res.on('finish', resolve);
    res.on('close', resolve);
  });

  await main.handleRequest(req, res);
  await closeOrFinish;

  // Headers were sent before pipe, so res.destroy() was triggered on error
  assert.ok(res.ended, 'Response should end or destroy cleanly');
});

// =============================================================================
// Suite 3: Error Logging Ingestion (/api/log-error, /api/logs)
// =============================================================================

test('Suite 3.1: POST /api/log-error ingests structured error and returns 200', async () => {
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
      context: 'Challenger Ingestion Test',
      message: 'Network latency spike detected',
      code: 'ERR_TIMEOUT_MOCK',
      stack: 'Error: Network latency spike\n    at challenger (test.js:1:1)',
      metadata: { latencyMs: 4500, attempt: 3 },
    },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.ok(data.path);

  // Check log file content contains the message
  const logContent = fs.readFileSync(data.path, 'utf8');
  assert.ok(logContent.includes('Network latency spike detected'));
  assert.ok(logContent.includes('ERR_TIMEOUT_MOCK'));
});

test('Suite 3.2: POST /api/log-error rejects payloads exceeding 64KB with 500/413', async () => {
  const sessionToken = main.getApiSessionToken();
  const hugeString = 'A'.repeat(70 * 1024); // 70 KB payload
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/log-error',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: { message: hugeString },
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 500);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, false);
  assert.match(data.error, /Request body is too large/);
});

test('Suite 3.3: POST /api/log-error handles malformed JSON without crashing', async () => {
  const sessionToken = main.getApiSessionToken();
  const { req, res } = createMockHttp({
    method: 'POST',
    url: '/api/log-error',
    headers: {
      origin: 'http://localhost:9000',
      'x-kick-app-session': sessionToken,
      'content-type': 'application/json',
    },
    body: '{"message": "Broken JSON without closing brace',
  });

  await main.handleRequest(req, res);
  assert.equal(res.statusCode, 500);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, false);
});

test('Suite 3.4: GET /api/logs retrieves recent log entries safely', async () => {
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
  assert.ok(typeof data.path === 'string');
  assert.ok(typeof data.recent === 'string');
});

test('Suite 3.5: Logger rotates file when size exceeds 5MB', (t) => {
  const tempLogDir = path.join(os.tmpdir(), 'kick-rotation-test-' + Date.now());
  fs.mkdirSync(tempLogDir, { recursive: true });
  t.after(() => {
    try { fs.rmSync(tempLogDir, { recursive: true, force: true }); } catch {}
  });

  const origDir = logger.getLogDirectory();
  logger.setLogDirectory(tempLogDir);
  t.after(() => { logger.setLogDirectory(origDir); });

  const logFile = logger.getLogPath();
  // Create a 5.1 MB dummy log file
  const fiveMbPlus = Buffer.alloc(5.2 * 1024 * 1024, 'X');
  fs.writeFileSync(logFile, fiveMbPlus);

  assert.ok(fs.statSync(logFile).size > 5 * 1024 * 1024);

  // Trigger error log
  const res = logger.logError('Rotation Test', new Error('Trigger rotation'));
  assert.equal(res.ok, true);

  // Check that error.old.log now exists
  const oldLogFile = path.join(tempLogDir, 'error.old.log');
  assert.ok(fs.existsSync(oldLogFile), 'error.old.log must exist after rotation');
  assert.ok(fs.statSync(oldLogFile).size >= 5 * 1024 * 1024, 'old log contains prior content');

  // And the new error.log is small (freshly started)
  assert.ok(fs.statSync(logFile).size < 100 * 1024, 'new error.log should be fresh and small');
});

// =============================================================================
// Suite 4: Rapid Concurrency & Race Conditions
// =============================================================================

test('Suite 4.1: Rapid concurrent POST /api/settings updates config safely without corruption', async () => {
  const sessionToken = main.getApiSessionToken();
  const concurrencyCount = 50;
  const promises = [];

  for (let i = 0; i < concurrencyCount; i++) {
    const vol = (i % 10) / 10;
    const { req, res } = createMockHttp({
      method: 'POST',
      url: '/api/settings',
      headers: {
        origin: 'http://localhost:9000',
        'x-kick-app-session': sessionToken,
        'content-type': 'application/json',
      },
      body: {
        volume: vol,
        streamerMode: i % 2 === 0,
        rewardVolumes: { [`concurrency_reward_${i}`]: vol },
        rewardCooldowns: { [`concurrency_reward_${i}`]: i },
      },
    });

    promises.push(
      main.handleRequest(req, res).then(() => {
        assert.equal(res.statusCode, 200);
        assert.deepEqual(JSON.parse(res.body), { ok: true });
      })
    );
  }

  await Promise.all(promises);

  const cfg = main.getConfig();
  assert.ok(typeof cfg.volume === 'number');
  assert.ok(cfg.volume >= 0 && cfg.volume <= 1);
  assert.ok(typeof cfg.streamerMode === 'boolean');
});

test('Suite 4.2: Rapid concurrent POST /api/log-error writes all entries without lock failure', async () => {
  const sessionToken = main.getApiSessionToken();
  const concurrencyCount = 50;
  const promises = [];

  for (let i = 0; i < concurrencyCount; i++) {
    const { req, res } = createMockHttp({
      method: 'POST',
      url: '/api/log-error',
      headers: {
        origin: 'http://localhost:9000',
        'x-kick-app-session': sessionToken,
        'content-type': 'application/json',
      },
      body: {
        context: `Concurrent Client ${i}`,
        message: `Stress error message #${i}`,
      },
    });

    promises.push(
      main.handleRequest(req, res).then(() => {
        assert.equal(res.statusCode, 200);
        assert.equal(JSON.parse(res.body).ok, true);
      })
    );
  }

  await Promise.all(promises);

  const logContent = fs.readFileSync(logger.getLogPath(), 'utf8');
  assert.ok(logContent.includes('Stress error message #0'));
  assert.ok(logContent.includes(`Stress error message #${concurrencyCount - 1}`));
});

test('Suite 4.3: High-concurrency interleaved GET and POST operations', async () => {
  const sessionToken = main.getApiSessionToken();
  const ops = [];

  for (let i = 0; i < 25; i++) {
    // Operation 1: GET /api/state
    const op1 = createMockHttp({
      method: 'GET',
      url: '/api/state',
      headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken },
    });
    ops.push(main.handleRequest(op1.req, op1.res).then(() => assert.equal(op1.res.statusCode, 200)));

    // Operation 2: POST /api/settings
    const op2 = createMockHttp({
      method: 'POST',
      url: '/api/settings',
      headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
      body: { volume: 0.75, streamerMode: false },
    });
    ops.push(main.handleRequest(op2.req, op2.res).then(() => assert.equal(op2.res.statusCode, 200)));

    // Operation 3: POST /api/log-error
    const op3 = createMockHttp({
      method: 'POST',
      url: '/api/log-error',
      headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken, 'content-type': 'application/json' },
      body: { context: 'Interleaved Test', message: `Interleaved error ${i}` },
    });
    ops.push(main.handleRequest(op3.req, op3.res).then(() => assert.equal(op3.res.statusCode, 200)));

    // Operation 4: GET /api/logs
    const op4 = createMockHttp({
      method: 'GET',
      url: '/api/logs',
      headers: { origin: 'http://localhost:9000', 'x-kick-app-session': sessionToken },
    });
    ops.push(main.handleRequest(op4.req, op4.res).then(() => assert.equal(op4.res.statusCode, 200)));
  }

  await Promise.all(ops);
  assert.equal(ops.length, 100);
});
