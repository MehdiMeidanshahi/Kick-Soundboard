/**
 * Client-Side Error Logger
 * Captures all uncaught errors, unhandled rejections, and runtime exceptions.
 * Dispatches detailed logs with context, timestamps, and stack traces to the persistent log file.
 */

const clientLogger = {
  async logError(context, error, metadata = {}) {
    const errorObj = error instanceof Error ? error : new Error(String(error || 'Unknown client error'));
    const payload = {
      context: context || 'UI Interaction',
      message: errorObj.message,
      stack: errorObj.stack || (new Error()).stack,
      code: errorObj.code || metadata.code || 'CLIENT_ERROR',
      metadata: {
        ...metadata,
        url: window.location?.href,
        userAgent: navigator.userAgent,
        currentTab: window.currentTab || 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    // 1. Try sending via Electron IPC bridge if available
    try {
      if (window.kickApp?.logError) {
        await window.kickApp.logError(payload);
        return;
      }
    } catch (ipcErr) {
      console.warn('IPC logError failed, falling back to HTTP:', ipcErr);
    }

    // 2. Fallback to HTTP endpoint
    try {
      const token = (typeof window !== 'undefined' && window.sessionToken) || '';
      await fetch('/api/log-error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kick-app-session': token,
          'X-App-Session': token,
        },
        body: JSON.stringify(payload),
      });
    } catch (httpErr) {
      console.error('Failed to dispatch error log to server:', httpErr);
    }
  },

  async getRecentLogs() {
    try {
      if (window.kickApp?.getRecentLogs) {
        return await window.kickApp.getRecentLogs();
      }
      const token = (typeof window !== 'undefined' && window.sessionToken) || '';
      const res = await fetch('/api/logs', {
        headers: {
          'x-kick-app-session': token,
          'X-App-Session': token,
        },
      });
      if (res.ok) {
        const data = await res.json();
        return data.recent || '';
      }
    } catch (err) {
      console.error('Failed to fetch recent logs:', err);
    }
    return '';
  },

  async openLogsFolder() {
    try {
      if (window.kickApp?.openLogsFolder) {
        return await window.kickApp.openLogsFolder();
      }
    } catch (err) {
      console.error('Failed to open logs folder:', err);
    }
  },

  async getLogPath() {
    try {
      if (window.kickApp?.getLogPath) {
        return await window.kickApp.getLogPath();
      }
      const token = (typeof window !== 'undefined' && window.sessionToken) || '';
      const res = await fetch('/api/logs', {
        headers: {
          'x-kick-app-session': token,
          'X-App-Session': token,
        },
      });
      if (res.ok) {
        const data = await res.json();
        return data.path || '';
      }
    } catch {
      // Fallback
    }
    return '';
  },
};

// Global error handlers
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('error', (event) => {
    clientLogger.logError('Uncaught Window Error', event.error || event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    clientLogger.logError('Unhandled Promise Rejection', event.reason, {
      reasonType: typeof event.reason,
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = clientLogger;
} else {
  window.clientLogger = clientLogger;
}
