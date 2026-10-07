const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRetryAfter, getPollDelay } = require('../src/polling-backoff');

test('successful polls keep the 10 second interval', () => {
  assert.equal(getPollDelay({ consecutiveFailures: 0 }), 10_000);
});

test('failed polls back off exponentially up to five minutes', () => {
  assert.equal(getPollDelay({ consecutiveFailures: 1 }), 30_000);
  assert.equal(getPollDelay({ consecutiveFailures: 2 }), 60_000);
  assert.equal(getPollDelay({ consecutiveFailures: 3 }), 120_000);
  assert.equal(getPollDelay({ consecutiveFailures: 20 }), 300_000);
});

test('Retry-After seconds are honored when longer than normal backoff', () => {
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(getPollDelay({ consecutiveFailures: 1, retryAfterMs: 120_000 }), 120_000);
});

test('Retry-After HTTP dates are parsed relative to the current time', () => {
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:02:00 GMT', 0), 120_000);
});

test('invalid and past Retry-After values do not create a delay', () => {
  assert.equal(parseRetryAfter('not a date', 0), null);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', 0), 0);
});
