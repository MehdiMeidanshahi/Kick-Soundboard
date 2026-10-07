const test = require('node:test');
const assert = require('node:assert/strict');
const { getApprovedRedemptions } = require('../src/redemption-playback');

test('pending redemptions never enter the sound queue', () => {
  const items = [{ id: 'pending-1', status: 'pending' }];
  assert.deepEqual(getApprovedRedemptions(items, [], [], [], false), []);
});

test('rejected redemptions never enter the sound queue', () => {
  const items = [{ id: 'rejected-1', status: 'rejected' }];
  assert.deepEqual(getApprovedRedemptions(items, [], [], [], false), []);
});

test('a newly observed approval during polling is queued', () => {
  const items = [{ id: 'accepted-1', status: 'accepted' }];
  assert.deepEqual(getApprovedRedemptions(items, [], [], [], false), items);
});

test('a pending redemption is queued once when it becomes approved', () => {
  const items = [{ id: 'redemption-1', status: 'accepted' }];
  const previousHistory = [{ id: 'redemption-1', status: 'pending' }];
  assert.deepEqual(getApprovedRedemptions(items, previousHistory, ['redemption-1'], ['redemption-1'], false), items);
  assert.deepEqual(getApprovedRedemptions(items, [{ id: 'redemption-1', status: 'accepted' }], ['redemption-1'], [], false), []);
});

test('an approval after reconnect is queued when its previous pending state is known', () => {
  const items = [{ id: 'redemption-1', status: 'accepted' }];
  const previousHistory = [{ id: 'redemption-1', status: 'pending' }];
  assert.deepEqual(getApprovedRedemptions(items, previousHistory, ['redemption-1'], ['redemption-1'], true), items);
});

test('startup ignores old approvals that have no previously stored pending state', () => {
  const items = [{ id: 'old-accepted', status: 'accepted' }];
  assert.deepEqual(getApprovedRedemptions(items, [], [], [], true), []);
});

test('multiple approvals are returned oldest first for FIFO playback', () => {
  const newestFirst = [
    { id: 'newer', status: 'accepted' },
    { id: 'older', status: 'accepted' },
  ];
  assert.deepEqual(getApprovedRedemptions(newestFirst, [], [], [], false).map((item) => item.id), ['older', 'newer']);
});

test('seen approvals are not replayed when they fall outside visible history', () => {
  const accepted = [{ id: 'older-accepted', status: 'accepted' }];
  assert.deepEqual(getApprovedRedemptions(accepted, [], ['older-accepted'], [], false), []);
});

test('pending approvals are still detected when they fall outside visible history', () => {
  const accepted = [{ id: 'older-pending', status: 'accepted' }];
  assert.deepEqual(getApprovedRedemptions(accepted, [], ['older-pending'], ['older-pending'], false), accepted);
});
