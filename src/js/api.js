/**
 * Local REST API Client
 * Wraps all requests with authentication tokens and dispatches structured error logs upon failure.
 */

let apiSessionToken = '';

async function initSessionToken() {
  if (typeof window !== 'undefined' && window.kickApp?.getApiSessionToken) {
    try {
      apiSessionToken = await window.kickApp.getApiSessionToken();
      window.sessionToken = apiSessionToken;
    } catch (err) {
      console.warn('Could not retrieve API session token via IPC:', err);
    }
  }
}

async function request(endpoint, options = {}) {
  if (!apiSessionToken && typeof window !== 'undefined' && window.sessionToken) {
    apiSessionToken = window.sessionToken;
  }
  if (!apiSessionToken) {
    await initSessionToken();
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-kick-app-session': apiSessionToken,
    'X-App-Session': apiSessionToken,
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(endpoint, { ...options, headers });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const errorMsg = data.error || `HTTP ${response.status} request failed`;
      const err = new Error(errorMsg);
      err.statusCode = response.status;
      err.data = data;
      
      // Dispatch structured error log
      if (window.clientLogger) {
        window.clientLogger.logError(`API ${options.method || 'GET'} ${endpoint}`, err, {
          status: response.status,
          responseBody: text.slice(0, 500),
          payload: options.body,
        });
      }
      throw err;
    }

    return data;
  } catch (err) {
    if (window.clientLogger && !err.statusCode) {
      window.clientLogger.logError(`Network Error ${options.method || 'GET'} ${endpoint}`, err, {
        endpoint,
        options,
      });
    }
    throw err;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { request, initSessionToken };
} else {
  window.apiClient = { request, initSessionToken };
}
