const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeepLinkAuth } = require('../src/deep-link');

test('parses valid deep-link auth URL with hostname action', () => {
  const url = 'kick-soundboard://auth?token=access_123&refresh=refresh_456&expires_in=7200';
  const result = parseDeepLinkAuth(url);
  assert.equal(result.success, true);
  assert.equal(result.token, 'access_123');
  assert.equal(result.refresh, 'refresh_456');
  assert.equal(result.expiresIn, 7200);
});

test('parses valid deep-link auth URL with pathname action', () => {
  const url = 'kick-soundboard:///auth?access_token=token_abc&refresh_token=refresh_def';
  const result = parseDeepLinkAuth(url);
  assert.equal(result.success, true);
  assert.equal(result.token, 'token_abc');
  assert.equal(result.refresh, 'refresh_def');
  assert.equal(result.expiresIn, 3600); // default
});

test('rejects non kick-soundboard protocol', () => {
  const result = parseDeepLinkAuth('http://auth?token=123');
  assert.equal(result.success, false);
  assert.match(result.error, /Unexpected protocol/);
});

test('rejects missing or wrong action', () => {
  const result = parseDeepLinkAuth('kick-soundboard://settings?token=123');
  assert.equal(result.success, false);
  assert.match(result.error, /Unknown deep-link action/);
});

test('rejects missing token', () => {
  const result = parseDeepLinkAuth('kick-soundboard://auth?refresh=123');
  assert.equal(result.success, false);
  assert.match(result.error, /Missing access token/);
});

test('rejects invalid URL input', () => {
  assert.equal(parseDeepLinkAuth('').success, false);
  assert.equal(parseDeepLinkAuth(null).success, false);
  assert.equal(parseDeepLinkAuth('not-a-valid-url').success, false);
});
