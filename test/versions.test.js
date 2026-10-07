const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, latestStableRelease } = require('../src/versions');

test('parses plain stable semantic versions with an optional v prefix', () => {
  assert.deepEqual(parseVersion('v0.1.8'), [0, 1, 8]);
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.equal(parseVersion('v0.1.8-rc.1'), null);
  assert.equal(parseVersion('v0.1.8+build.4'), null);
});

test('compares stable versions numerically', () => {
  assert.equal(compareVersions('v0.1.10', 'v0.1.9'), 1);
  assert.equal(compareVersions('v1.0.0', 'v1.0.0'), 0);
});

test('selects the newest published stable release and skips prereleases and drafts', () => {
  const releases = [
    { tag_name: 'v0.1.9', draft: false, prerelease: true },
    { tag_name: 'v0.1.10', draft: true, prerelease: false },
    { tag_name: 'v0.1.8-rc.1', draft: false, prerelease: false },
    { tag_name: 'v0.1.7', draft: false, prerelease: false },
    { tag_name: 'v0.1.6', draft: false, prerelease: false },
  ];
  assert.equal(latestStableRelease(releases).tag_name, 'v0.1.7');
  assert.equal(latestStableRelease(releases.slice(0, 3)), null);
});
