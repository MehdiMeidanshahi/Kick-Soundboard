function getApprovedRedemptions(items, history, seenIds, pendingIds, isInitial) {
  const previousStatuses = new Map((history || []).map((item) => [item.id, item.status]));
  const seen = new Set(seenIds || []);
  const pending = new Set(pendingIds || []);
  return [...(items || [])].reverse().filter((item) => {
    const previousStatus = previousStatuses.get(item.id);
    return item.status === 'accepted'
      && (previousStatus === 'pending' || pending.has(item.id) || (!isInitial && !seen.has(item.id)));
  });
}

module.exports = { getApprovedRedemptions };
