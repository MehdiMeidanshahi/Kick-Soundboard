/**
 * Resolves Kick viewer usernames from user IDs using the official
 * GET /public/v1/users endpoint with OAuth scope user:read.
 */

function buildUsersQuery(userIds = []) {
  const list = Array.isArray(userIds) ? userIds : [];
  const validIds = list
    .map((id) => (typeof id === 'string' ? id.trim() : id))
    .filter((id) => id !== null && id !== undefined && id !== '');
  if (!validIds.length) return '/users';
  const query = validIds.map((id) => `id=${encodeURIComponent(id)}`).join('&');
  return `/users?${query}`;
}

function chunkArray(items = [], chunkSize = 50) {
  const size = Math.max(1, chunkSize);
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Extracts a displayable username from a Kick user object.
 * Checks username, name, and slug in that order.
 */
function extractUsername(user) {
  if (!user || typeof user !== 'object') return '';
  return String(user.username || user.name || user.slug || '').trim();
}

/**
 * Resolves uncached user IDs using kickGet and updates the cache.
 *
 * @param {Object} options
 * @param {Array<number|string>} options.userIds - IDs to resolve
 * @param {Record<string, string>} options.cachedUsers - mutable cache mapping userId -> username
 * @param {Function} options.kickGet - async function to call Kick API
 * @param {Object} [options.logger] - optional logger
 * @returns {Promise<Record<string, string>>}
 */
async function resolveUserNames({ userIds = [], cachedUsers = {}, kickGet, logger = console }) {
  if (typeof kickGet !== 'function') return cachedUsers;

  const missingIds = [];
  const seen = new Set();
  for (const rawId of userIds) {
    if (rawId === null || rawId === undefined || rawId === '') continue;
    const strId = String(rawId).trim();
    if (!strId || seen.has(strId)) continue;
    seen.add(strId);
    if (!cachedUsers[strId]) {
      missingIds.push(strId);
    }
  }

  if (!missingIds.length) return cachedUsers;

  const chunks = chunkArray(missingIds, 50);
  for (const chunk of chunks) {
    try {
      const endpoint = buildUsersQuery(chunk);
      const result = await kickGet(endpoint);
      const list = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
      for (const entry of list) {
        const uid = entry?.user_id ?? entry?.id;
        const name = extractUsername(entry);
        if (uid !== null && uid !== undefined && name) {
          cachedUsers[String(uid)] = name;
        }
      }
    } catch (error) {
      if (logger?.warn) {
        logger.warn(`Could not resolve Kick usernames for batch: ${error?.message || error}`);
      }
    }
  }

  return cachedUsers;
}

/**
 * Fetches the authenticated streamer's profile.
 *
 * @param {Object} options
 * @param {Function} options.kickGet - async function calling Kick API
 * @param {Record<string, string>} [options.cachedUsers] - optional user cache to populate
 * @returns {Promise<{ userId: number|string, name: string, profilePicture: string } | null>}
 */
async function resolveCurrentStreamer({ kickGet, cachedUsers = {} }) {
  if (typeof kickGet !== 'function') return null;
  try {
    const result = await kickGet('/users');
    const user = Array.isArray(result?.data) ? result.data[0] : result?.data;
    if (!user) return null;
    const userId = user.user_id ?? user.id;
    const name = extractUsername(user);
    const profilePicture = String(user.profile_picture || '');
    if (userId !== null && userId !== undefined && name) {
      cachedUsers[String(userId)] = name;
    }
    return { userId, name, profilePicture };
  } catch {
    return null;
  }
}

/**
 * Enriches history / redemption records with known usernames.
 * If an item is missing userName but has redeemerUserId and the user is in cachedUsers,
 * fills in userName.
 *
 * @param {Array<Object>} records
 * @param {Record<string, string>} cachedUsers
 * @returns {Array<Object>}
 */
function enrichHistoryWithUserNames(records = [], cachedUsers = {}) {
  if (!Array.isArray(records) || !cachedUsers) return records;
  return records.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const currentName = String(item.userName || item.username || '').trim();
    if (currentName) return item;
    const redeemerId = item.redeemerUserId !== null && item.redeemerUserId !== undefined
      ? String(item.redeemerUserId)
      : '';
    const resolved = redeemerId ? cachedUsers[redeemerId] : '';
    if (resolved) {
      return { ...item, userName: resolved };
    }
    return item;
  });
}

function mergeHistoryRecords(history = [], currentItems = []) {
  const byId = new Map((history || []).map((item) => [item.id, item]));
  for (const item of currentItems) {
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? {
      ...previous,
      status: item.status,
      userName: item.userName || previous.userName || '',
      redeemerUserId: item.redeemerUserId ?? previous.redeemerUserId ?? null,
    } : item);
  }
  return [...byId.values()].sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt)).slice(0, 100);
}

module.exports = {
  buildUsersQuery,
  chunkArray,
  extractUsername,
  resolveUserNames,
  resolveCurrentStreamer,
  enrichHistoryWithUserNames,
  mergeHistoryRecords,
};
