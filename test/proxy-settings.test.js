const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Mock electron before requiring src/main.js
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath === 'electron') {
    return {
      app: {
        isPackaged: false,
        getVersion: () => '0.3.2',
        getPath: (name) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'kick-test-proxy-userdata');
          return os.tmpdir();
        },
        requestSingleInstanceLock: () => true,
        on: () => {},
        whenReady: () => new Promise(() => {}),
        setAsDefaultProtocolClient: () => {},
      },
      session: {
        defaultSession: {
          setProxy: async () => {},
        },
      },
      net: {
        fetch: async () => ({ status: 200, ok: true, json: async () => ({}) }),
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
        showOpenDialog: async () => ({ canceled: false, filePaths: [] }),
        showErrorBox: () => {},
      },
      ipcMain: {
        handle: () => {},
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
      },
      shell: {
        openExternal: async () => {},
      },
      globalShortcut: {
        register: () => true,
        unregisterAll: () => {},
      },
      nativeImage: {
        createFromPath: () => ({}),
      },
    };
  }
  return origRequire.apply(this, arguments);
};

const proxyManager = require('../src/proxy-manager.js');
const main = require('../src/main.js');

test('ProxyManager: detectSystemProxy returns well-formed object', () => {
  const result = proxyManager.detectSystemProxy();
  assert.equal(typeof result, 'object');
  assert.equal(typeof result.isEnabled, 'boolean');
  assert.equal(typeof result.proxyServer, 'string');
  assert.ok(['env', 'registry', 'none'].includes(result.source));
});

test('ProxyManager: detectSystemProxy prioritizes environment variables', () => {
  const originalEnv = process.env.HTTPS_PROXY;
  try {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';
    const result = proxyManager.detectSystemProxy();
    assert.equal(result.isEnabled, true);
    assert.equal(result.proxyServer, 'http://127.0.0.1:9999');
    assert.equal(result.source, 'env');
  } finally {
    if (originalEnv) process.env.HTTPS_PROXY = originalEnv;
    else delete process.env.HTTPS_PROXY;
  }
});

test('ProxyManager: normalizeProxyRules normalizes bare host:port and preserves schemes', () => {
  assert.equal(proxyManager.normalizeProxyRules('127.0.0.1:10809'), 'http://127.0.0.1:10809');
  assert.equal(proxyManager.normalizeProxyRules('localhost:7890'), 'http://localhost:7890');
  assert.equal(proxyManager.normalizeProxyRules('http://127.0.0.1:10809'), 'http://127.0.0.1:10809');
  assert.equal(proxyManager.normalizeProxyRules('socks5://127.0.0.1:10808'), 'socks5://127.0.0.1:10808');
  assert.equal(proxyManager.normalizeProxyRules('socks4://127.0.0.1:1080'), 'socks4://127.0.0.1:1080');
  assert.equal(proxyManager.normalizeProxyRules('http=127.0.0.1:10809;https=127.0.0.1:10809'), 'http=127.0.0.1:10809;https=127.0.0.1:10809');
  assert.equal(proxyManager.normalizeProxyRules(''), '');
  assert.equal(proxyManager.normalizeProxyRules(null), '');
});

test('ProxyManager: formatNetworkError formats human-friendly explanations', () => {
  const connRefused = new Error('connect ECONNREFUSED 127.0.0.1:10809');
  const customErr = proxyManager.formatNetworkError(connRefused, 'custom');
  assert.ok(customErr.includes('v2ray') || customErr.includes('VPN'), 'Must mention v2ray or VPN on connection refused');

  const timeoutErr = new Error('The operation timed out');
  const timeoutMsg = proxyManager.formatNetworkError(timeoutErr);
  assert.ok(timeoutMsg.includes('timed out') || timeoutMsg.includes('time'), 'Must mention timeout');

  const dnsErr = new Error('getaddrinfo ENOTFOUND invalid-proxy.local');
  const dnsMsg = proxyManager.formatNetworkError(dnsErr);
  assert.ok(dnsMsg.includes('DNS') || dnsMsg.includes('Hostname resolution'), 'Must mention DNS resolution');

  const authErr = new Error('HTTP 407 Proxy Authentication Required');
  const authMsg = proxyManager.formatNetworkError(authErr);
  assert.ok(authMsg.includes('407') || authMsg.includes('authentication'), 'Must mention proxy authentication');

  const fetchFailed = new Error('fetch failed');
  const directAdvice = proxyManager.formatNetworkError(fetchFailed, 'direct');
  assert.ok(directAdvice.includes('restricted') || directAdvice.includes('Settings'), 'Must advise proxy in settings for direct fetch failed');
});

test('ProxyManager: applyProxyToSession configures Electron session with local bypass rules', async () => {
  let capturedConfig = null;
  const mockSession = {
    setProxy: async (cfg) => {
      capturedConfig = cfg;
    },
  };

  // Custom proxy
  await proxyManager.applyProxyToSession(mockSession, { mode: 'custom', rules: '127.0.0.1:10809' });
  assert.equal(capturedConfig.proxyRules, 'http://127.0.0.1:10809');
  assert.ok(capturedConfig.proxyBypassRules.includes('localhost'));
  assert.ok(capturedConfig.proxyBypassRules.includes('127.0.0.1'));

  // System proxy
  await proxyManager.applyProxyToSession(mockSession, { mode: 'system' });
  assert.equal(capturedConfig.mode, 'system');
  assert.ok(capturedConfig.proxyBypassRules.includes('localhost'));

  // Direct connection
  await proxyManager.applyProxyToSession(mockSession, { mode: 'direct' });
  assert.equal(capturedConfig.mode, 'direct');
  assert.ok(capturedConfig.proxyBypassRules.includes('localhost'));
});

test('API & State: POST /api/settings handles proxyMode and proxyRules and updates state', async () => {
  const sessionToken = main.getApiSessionToken();
  const allowedOrigin = main.getAllowedOrigin();

  function mockHttp(options = {}, body = null) {
    const { EventEmitter } = require('node:events');
    const req = new EventEmitter();
    req.method = options.method || 'GET';
    req.url = options.url || '/api/state';
    req.headers = {
      host: 'localhost:9000',
      'x-kick-app-session': sessionToken,
      origin: allowedOrigin,
      ...(options.headers || {}),
    };
    req[Symbol.asyncIterator] = async function* () {
      if (body !== null) {
        yield Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      }
    };

    let statusCode = 200;
    let headers = {};
    let responseBody = '';

    const res = {
      writeHead: (st, hdrs) => { statusCode = st; headers = { ...headers, ...hdrs }; },
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (data) => { responseBody = data; res.emit('finish'); },
      emit: () => {},
    };

    const promise = new Promise((resolve) => {
      res.emit = (event) => {
        if (event === 'finish') {
          resolve({
            statusCode,
            headers,
            body: responseBody ? JSON.parse(responseBody) : null,
          });
        }
      };
    });

    process.nextTick(() => {
      if (body) {
        req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      }
      req.emit('end');
    });

    main.handleRequest(req, res);
    return promise;
  }

  // 1. Invalid proxyMode returns 400
  const invalidRes = await mockHttp(
    { method: 'POST', url: '/api/settings', headers: { 'content-type': 'application/json' } },
    { proxyMode: 'invalid_mode' }
  );
  assert.equal(invalidRes.statusCode, 400);

  // 2. Valid custom proxyMode and proxyRules returns 200
  const validRes = await mockHttp(
    { method: 'POST', url: '/api/settings', headers: { 'content-type': 'application/json' } },
    { proxyMode: 'custom', proxyRules: '127.0.0.1:10809' }
  );
  assert.equal(validRes.statusCode, 200);

  // 3. publicState reflects the saved proxy settings
  const state = main.publicState();
  assert.equal(state.proxyMode, 'custom');
  assert.equal(state.proxyRules, '127.0.0.1:10809');
  assert.equal(typeof state.systemProxy, 'string');

  // 4. GET /api/proxy/system returns 200 and detected data
  const sysRes = await mockHttp({ method: 'GET', url: '/api/proxy/system' });
  assert.equal(sysRes.statusCode, 200);
  assert.equal(sysRes.body.ok, true);
  assert.equal(typeof sysRes.body.data, 'object');

  // 5. POST /api/proxy/test returns 200 with result
  const testRes = await mockHttp(
    { method: 'POST', url: '/api/proxy/test', headers: { 'content-type': 'application/json' } },
    { proxyMode: 'direct' }
  );
  assert.equal(testRes.statusCode, 200);
  assert.equal(typeof testRes.body.ok, 'boolean');

  // 6. Reset back to direct mode (default)
  const resetRes = await mockHttp(
    { method: 'POST', url: '/api/settings', headers: { 'content-type': 'application/json' } },
    { proxyMode: 'direct', proxyRules: '' }
  );
  assert.equal(resetRes.statusCode, 200);
  assert.equal(main.publicState().proxyMode, 'direct');
});
