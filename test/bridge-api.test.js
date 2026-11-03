const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const loginHandler = require('../bridge/api/auth/login');
const callbackHandler = require('../bridge/api/auth/callback');
const refreshHandler = require('../bridge/api/auth/refresh');

function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'kicksoundboard.vercel.app', ...headers };
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
// bridge/api/auth/login.js tests
// -------------------------------------------------------------

test('bridge login: fails with 500 when KICK_CLIENT_ID is missing', async () => {
  const originalClientId = process.env.KICK_CLIENT_ID;
  delete process.env.KICK_CLIENT_ID;
  try {
    const { req, res } = createMockReqRes({ url: '/api/auth/login' });
    await loginHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /KICK_CLIENT_ID environment variable is missing/);
  } finally {
    process.env.KICK_CLIENT_ID = originalClientId;
  }
});

test('bridge login: succeeds with 302 and sets secure cookie with all 5 scopes', async () => {
  process.env.KICK_CLIENT_ID = 'test_client_id_123';
  try {
    const { req, res } = createMockReqRes({
      url: '/api/auth/login',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'mybridge.vercel.app',
      },
    });
    await loginHandler(req, res);

    assert.equal(res.statusCode, 302);
    const location = res.getHeader('location');
    assert.ok(location);
    const redirectUrl = new URL(location);

    assert.equal(redirectUrl.origin, 'https://id.kick.com');
    assert.equal(redirectUrl.pathname, '/oauth/authorize');
    assert.equal(redirectUrl.searchParams.get('client_id'), 'test_client_id_123');
    assert.equal(redirectUrl.searchParams.get('response_type'), 'code');
    assert.equal(redirectUrl.searchParams.get('redirect_uri'), 'https://mybridge.vercel.app/api/auth/callback');
    assert.equal(
      redirectUrl.searchParams.get('scope'),
      'user:read channel:rewards:read channel:rewards:write events:subscribe kicks:read'
    );
    assert.ok(redirectUrl.searchParams.get('state'));
    assert.ok(redirectUrl.searchParams.get('code_challenge'));
    assert.equal(redirectUrl.searchParams.get('code_challenge_method'), 'S256');

    // Cookie verification
    const setCookie = res.getHeader('set-cookie');
    assert.ok(setCookie && setCookie.length > 0);
    assert.match(setCookie[0], /^kick_oauth=/);
    assert.match(setCookie[0], /HttpOnly/);
    assert.match(setCookie[0], /Secure/);
    assert.match(setCookie[0], /SameSite=Lax/);
  } finally {
    delete process.env.KICK_CLIENT_ID;
  }
});

// -------------------------------------------------------------
// bridge/api/auth/callback.js tests
// -------------------------------------------------------------

test('bridge callback: fails with 400 when Kick passes an error parameter', async () => {
  const { req, res } = createMockReqRes({
    url: '/api/auth/callback?error=access_denied&error_description=User%20denied%20access',
  });
  await callbackHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /User denied access/);
});

test('bridge callback: fails with 400 when kick_oauth cookie is missing', async () => {
  const { req, res } = createMockReqRes({
    url: '/api/auth/callback?code=some_code&state=some_state',
  });
  await callbackHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /OAuth state did not match or session expired/);
});

test('bridge callback: fails with 400 when state does not match cookie', async () => {
  const cookieData = Buffer.from(
    JSON.stringify({ state: 'expected_state', verifier: 'v', redirectUri: 'https://test/cb' })
  ).toString('base64url');

  const { req, res } = createMockReqRes({
    url: '/api/auth/callback?code=some_code&state=wrong_state',
    headers: { cookie: `kick_oauth=${cookieData}` },
  });
  await callbackHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /OAuth state did not match/);
});

test('bridge callback: fails with 500 when server credentials are missing', async () => {
  delete process.env.KICK_CLIENT_ID;
  delete process.env.KICK_CLIENT_SECRET;

  const cookieData = Buffer.from(
    JSON.stringify({ state: 'valid_state', verifier: 'v', redirectUri: 'https://test/cb' })
  ).toString('base64url');

  const { req, res } = createMockReqRes({
    url: '/api/auth/callback?code=some_code&state=valid_state',
    headers: { cookie: `kick_oauth=${cookieData}` },
  });
  await callbackHandler(req, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body, /Server environment variables .* are missing/);
});

test('bridge callback: fails with 500 when upstream token exchange fails', async () => {
  process.env.KICK_CLIENT_ID = 'cid';
  process.env.KICK_CLIENT_SECRET = 'csecret';

  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'Code is expired' }),
  });

  try {
    const cookieData = Buffer.from(
      JSON.stringify({ state: 'valid_state', verifier: 'v', redirectUri: 'https://test/cb' })
    ).toString('base64url');

    const { req, res } = createMockReqRes({
      url: '/api/auth/callback?code=expired_code&state=valid_state',
      headers: { cookie: `kick_oauth=${cookieData}` },
    });
    await callbackHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Code is expired/);
  } finally {
    global.fetch = origFetch;
    delete process.env.KICK_CLIENT_ID;
    delete process.env.KICK_CLIENT_SECRET;
  }
});

test('bridge callback: succeeds with 200, returns deep-link HTML and clears cookie', async () => {
  process.env.KICK_CLIENT_ID = 'cid';
  process.env.KICK_CLIENT_SECRET = 'csecret';

  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'acc_token_xyz',
      refresh_token: 'ref_token_123',
      expires_in: 7200,
    }),
  });

  try {
    const cookieData = Buffer.from(
      JSON.stringify({ state: 'valid_state', verifier: 'my_verifier', redirectUri: 'https://test/cb' })
    ).toString('base64url');

    const { req, res } = createMockReqRes({
      url: '/api/auth/callback?code=good_code&state=valid_state',
      headers: { cookie: `kick_oauth=${cookieData}` },
    });
    await callbackHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Kick Connected!/);
    assert.match(res.body, /kick-soundboard:\/\/auth\?token=acc_token_xyz/);
    assert.match(res.body, /refresh=ref_token_123/);
    assert.match(res.body, /expires_in=7200/);

    // Verify cookie cleared (Max-Age=0)
    const setCookie = res.getHeader('set-cookie');
    assert.ok(setCookie && setCookie.length > 0);
    assert.match(setCookie[0], /Max-Age=0/);
  } finally {
    global.fetch = origFetch;
    delete process.env.KICK_CLIENT_ID;
    delete process.env.KICK_CLIENT_SECRET;
  }
});

// -------------------------------------------------------------
// bridge/api/auth/refresh.js tests
// -------------------------------------------------------------

test('bridge refresh: fails with 405 on non-POST method', async () => {
  const { req, res } = createMockReqRes({ method: 'GET', url: '/api/auth/refresh' });
  await refreshHandler(req, res);
  assert.equal(res.statusCode, 405);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Method not allowed');
});

test('bridge refresh: fails with 500 when server credentials missing', async () => {
  delete process.env.KICK_CLIENT_ID;
  delete process.env.KICK_CLIENT_SECRET;

  const { req, res } = createMockReqRes({
    method: 'POST',
    url: '/api/auth/refresh',
    body: { refresh_token: 'ref_123' },
  });
  await refreshHandler(req, res);
  assert.equal(res.statusCode, 500);
  const data = JSON.parse(res.body);
  assert.equal(data.error, 'Server configuration error');
});

test('bridge refresh: fails with 400 when refresh_token is missing in request', async () => {
  process.env.KICK_CLIENT_ID = 'cid';
  process.env.KICK_CLIENT_SECRET = 'csecret';
  try {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/refresh',
      body: {},
    });
    await refreshHandler(req, res);
    assert.equal(res.statusCode, 400);
    const data = JSON.parse(res.body);
    assert.equal(data.error, 'Missing refresh_token');
  } finally {
    delete process.env.KICK_CLIENT_ID;
    delete process.env.KICK_CLIENT_SECRET;
  }
});

test('bridge refresh: forwards upstream Kick refresh error', async () => {
  process.env.KICK_CLIENT_ID = 'cid';
  process.env.KICK_CLIENT_SECRET = 'csecret';

  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'Token expired' }),
  });

  try {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/refresh',
      body: { refresh_token: 'bad_token' },
    });
    await refreshHandler(req, res);
    assert.equal(res.statusCode, 400);
    const data = JSON.parse(res.body);
    assert.equal(data.error, 'invalid_grant');
    assert.equal(data.error_description, 'Token expired');
  } finally {
    global.fetch = origFetch;
    delete process.env.KICK_CLIENT_ID;
    delete process.env.KICK_CLIENT_SECRET;
  }
});

test('bridge refresh: succeeds with 200 and returns refreshed tokens', async () => {
  process.env.KICK_CLIENT_ID = 'cid';
  process.env.KICK_CLIENT_SECRET = 'csecret';

  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
    }),
  });

  try {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/refresh',
      body: { refresh_token: 'old_refresh_token' },
    });
    await refreshHandler(req, res);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.access_token, 'new_access_token');
    assert.equal(data.refresh_token, 'new_refresh_token');
    assert.equal(data.expires_in, 3600);
  } finally {
    global.fetch = origFetch;
    delete process.env.KICK_CLIENT_ID;
    delete process.env.KICK_CLIENT_SECRET;
  }
});
