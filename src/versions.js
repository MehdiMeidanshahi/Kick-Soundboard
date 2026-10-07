function parseVersion(version) {
  const match = String(version || '').replace(/^v/i, '').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function latestStableRelease(releases) {
  return (releases || [])
    .filter((release) => !release.draft && !release.prerelease && parseVersion(release.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] || null;
}

module.exports = { parseVersion, compareVersions, latestStableRelease };
