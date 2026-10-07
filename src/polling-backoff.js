const SUCCESS_POLL_INTERVAL_MS = 10_000;
const INITIAL_ERROR_BACKOFF_MS = 30_000;
const MAX_ERROR_BACKOFF_MS = 5 * 60_000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - now));
}

function getPollDelay({ consecutiveFailures, retryAfterMs = null }) {
  if (!consecutiveFailures) return SUCCESS_POLL_INTERVAL_MS;
  const backoff = Math.min(MAX_ERROR_BACKOFF_MS, INITIAL_ERROR_BACKOFF_MS * (2 ** Math.min(consecutiveFailures - 1, 10)));
  return Math.max(backoff, retryAfterMs ?? 0);
}

module.exports = { SUCCESS_POLL_INTERVAL_MS, parseRetryAfter, getPollDelay };
