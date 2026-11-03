const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUsersQuery,
  chunkArray,
  extractUsername,
  resolveUserNames,
  resolveCurrentStreamer,
  enrichHistoryWithUserNames,
  mergeHistoryRecords,
} = require('../src/user-resolver');

test('buildUsersQuery builds correct Kick API query parameters', () => {
  assert.equal(buildUsersQuery([]), '/users');
  assert.equal(buildUsersQuery(null), '/users');
  assert.equal(buildUsersQuery([123]), '/users?id=123');
  assert.equal(buildUsersQuery([123, '456', 789]), '/users?id=123&id=456&id=789');
  assert.equal(buildUsersQuery([123, null, '', undefined, '999']), '/users?id=123&id=999');
});

test('chunkArray splits arrays correctly', () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkArray([], 5), []);
  assert.deepEqual(chunkArray([1], 10), [[1]]);
});

test('extractUsername extracts valid names in priority order', () => {
  assert.equal(extractUsername({ username: 'itsmehdi7' }), 'itsmehdi7');
  assert.equal(extractUsername({ name: 'itsmehdi7' }), 'itsmehdi7');
  assert.equal(extractUsername({ slug: 'itsmehdi7' }), 'itsmehdi7');
  assert.equal(extractUsername({ username: '', name: 'streamer_name' }), 'streamer_name');
  assert.equal(extractUsername(null), '');
  assert.equal(extractUsername({}), '');
});

test('resolveUserNames fetches uncached users in batch and updates cache', async () => {
  const calls = [];
  const mockKickGet = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === '/users?id=3698484&id=98765') {
      return {
        data: [
          { user_id: 3698484, name: 'itsmehdi7' },
          { user_id: 98765, username: 'coolviewer' },
        ],
      };
    }
    return { data: [] };
  };

  const cachedUsers = { '11111': 'already_known' };
  const result = await resolveUserNames({
    userIds: [3698484, '11111', 98765, 3698484, null],
    cachedUsers,
    kickGet: mockKickGet,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], '/users?id=3698484&id=98765');
  assert.equal(result['3698484'], 'itsmehdi7');
  assert.equal(result['98765'], 'coolviewer');
  assert.equal(result['11111'], 'already_known');
});

test('resolveUserNames does not call API if all users are cached', async () => {
  let called = false;
  const mockKickGet = async () => {
    called = true;
    return { data: [] };
  };

  const cachedUsers = { '123': 'viewer1', '456': 'viewer2' };
  await resolveUserNames({
    userIds: [123, '456'],
    cachedUsers,
    kickGet: mockKickGet,
  });

  assert.equal(called, false);
});

test('resolveUserNames gracefully handles API errors without throwing', async () => {
  const mockKickGet = async () => {
    const error = new Error('Rate limit exceeded (429)');
    error.statusCode = 429;
    throw error;
  };

  const cachedUsers = { '100': 'existing' };
  const result = await resolveUserNames({
    userIds: [200],
    cachedUsers,
    kickGet: mockKickGet,
    logger: { warn: () => {} },
  });

  assert.equal(result['100'], 'existing');
  assert.equal(result['200'], undefined);
});

test('resolveCurrentStreamer retrieves profile and populates cache', async () => {
  const mockKickGet = async (endpoint) => {
    assert.equal(endpoint, '/users');
    return {
      data: [
        { user_id: 3698484, name: 'itsmehdi7', profile_picture: 'https://kick.com/avatar.webp' },
      ],
    };
  };

  const cachedUsers = {};
  const profile = await resolveCurrentStreamer({
    kickGet: mockKickGet,
    cachedUsers,
  });

  assert.deepEqual(profile, {
    userId: 3698484,
    name: 'itsmehdi7',
    profilePicture: 'https://kick.com/avatar.webp',
  });
  assert.equal(cachedUsers['3698484'], 'itsmehdi7');
});

test('resolveCurrentStreamer gracefully returns null on API error', async () => {
  const mockKickGet = async () => {
    throw new Error('Unauthorized');
  };

  const profile = await resolveCurrentStreamer({ kickGet: mockKickGet });
  assert.equal(profile, null);
});

test('enrichHistoryWithUserNames retrofits past redemptions with resolved names', () => {
  const cachedUsers = {
    '3698484': 'itsmehdi7',
    '9999': 'superfan',
  };

  const history = [
    { id: '1', redeemerUserId: 3698484, userName: '', rewardTitle: 'Sound 1' },
    { id: '2', redeemerUserId: 9999, rewardTitle: 'Sound 2' },
    { id: '3', redeemerUserId: 1111, userName: '', rewardTitle: 'Sound 3' },
    { id: '4', redeemerUserId: 3698484, userName: 'custom_name', rewardTitle: 'Sound 4' },
  ];

  const enriched = enrichHistoryWithUserNames(history, cachedUsers);

  assert.equal(enriched[0].userName, 'itsmehdi7');
  assert.equal(enriched[1].userName, 'superfan');
  assert.equal(enriched[2].userName, '');
  assert.equal(enriched[3].userName, 'custom_name'); // preserved
});

test('mergeHistoryRecords merges items preserving resolved usernames and sorting by redeemedAt', () => {
  const previousHistory = [
    { id: '1', status: 'pending', userName: '', redeemerUserId: 3698484, redeemedAt: '2026-03-11T12:00:00Z' },
    { id: '2', status: 'accepted', userName: 'alice', redeemerUserId: 222, redeemedAt: '2026-03-11T11:00:00Z' },
  ];

  const currentItems = [
    { id: '1', status: 'accepted', userName: 'itsmehdi7', redeemerUserId: 3698484, redeemedAt: '2026-03-11T12:00:00Z' },
    { id: '3', status: 'pending', userName: 'bob', redeemerUserId: 333, redeemedAt: '2026-03-11T13:00:00Z' },
  ];

  const merged = mergeHistoryRecords(previousHistory, currentItems);

  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, '3'); // Most recent (13:00)
  assert.equal(merged[1].id, '1'); // (12:00)
  assert.equal(merged[1].status, 'accepted');
  assert.equal(merged[1].userName, 'itsmehdi7'); // updated userName
  assert.equal(merged[2].id, '2'); // (11:00)
});

