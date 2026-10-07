(function (root, createApi) {
  const api = createApi();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.kickQueuePlayback = api;
})(globalThis, function () {
  function prependInterruptedItem(queue, currentItem) {
    return currentItem ? [currentItem, ...queue] : queue;
  }

  return { prependInterruptedItem };
});
