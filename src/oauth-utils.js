const { parseRetryAfter } = require('./polling-backoff');

function shouldClearRefreshTokens(data) {
  return data?.error === 'invalid_grant';
}

function createOAuthError(data, statusCode, retryAfterHeader, now = Date.now()) {
  const message = shouldClearRefreshTokens(data)
    ? 'Kick login expired. Connect your account again.'
    : data?.error_description || data?.error || `Kick login refresh failed (${statusCode})`;
  const error = new Error(message);
  error.statusCode = statusCode;
  error.retryAfterMs = parseRetryAfter(retryAfterHeader, now);
  return error;
}

module.exports = { shouldClearRefreshTokens, createOAuthError };
