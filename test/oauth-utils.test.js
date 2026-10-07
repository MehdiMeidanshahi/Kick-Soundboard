const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldClearRefreshTokens, createOAuthError } = require('../src/oauth-utils');

test('only invalid_grant marks saved refresh tokens as unusable', () => {
  assert.equal(shouldClearRefreshTokens({ error: 'invalid_grant' }), true);
  assert.equal(shouldClearRefreshTokens({ error: 'temporarily_unavailable' }), false);
  assert.equal(shouldClearRefreshTokens({ error: 'invalid_client' }), false);
  assert.equal(shouldClearRefreshTokens({}), false);
});

test('temporary OAuth failures retain their retry delay and status', () => {
  const error = createOAuthError({ error: 'temporarily_unavailable' }, 503, '45', 0);
  assert.equal(error.message, 'temporarily_unavailable');
  assert.equal(error.statusCode, 503);
  assert.equal(error.retryAfterMs, 45_000);
});

test('invalid refresh grants give a reconnect message', () => {
  const error = createOAuthError({ error: 'invalid_grant' }, 400, null);
  assert.match(error.message, /login expired/i);
});
