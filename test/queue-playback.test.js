const test = require('node:test');
const assert = require('node:assert/strict');
const { prependInterruptedItem } = require('../src/queue-playback');

test('stopping current playback keeps it ahead of the waiting queue', () => {
  const current = { rewardId: 'current', redemptionId: 'redemption-current' };
  const waiting = [{ rewardId: 'next' }, { rewardId: 'last' }];

  assert.deepEqual(prependInterruptedItem(waiting, current), [current, ...waiting]);
  assert.deepEqual(waiting, [{ rewardId: 'next' }, { rewardId: 'last' }]);
});

test('stopping without a current item leaves the queue unchanged', () => {
  const waiting = [{ rewardId: 'next' }];
  assert.equal(prependInterruptedItem(waiting, null), waiting);
});
