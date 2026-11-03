function getRedemptionsToPlay(items, history, seenIds, pendingIds, isInitial, options = {}) {
  const playPending = Boolean(options.playPending);
  const played = new Set(options.playedIds || []);
  const previousStatuses = new Map((history || []).map((item) => [item.id, item.status]));
  const seen = new Set(seenIds || []);
  const pending = new Set(pendingIds || []);

  return [...(items || [])].reverse().filter((item) => {
    if (played.has(item.id)) return false;
    if (item.status === 'rejected') return false;

    const previousStatus = previousStatuses.get(item.id);

    if (item.status === 'accepted') {
      return previousStatus === 'pending' || pending.has(item.id) || (!isInitial && !seen.has(item.id));
    }

    if (item.status === 'pending' && playPending) {
      return !isInitial && !seen.has(item.id);
    }

    return false;
  });
}

function getApprovedRedemptions(items, history, seenIds, pendingIds, isInitial, options = {}) {
  return getRedemptionsToPlay(items, history, seenIds, pendingIds, isInitial, options);
}

module.exports = {
  getRedemptionsToPlay,
  getApprovedRedemptions,
};
