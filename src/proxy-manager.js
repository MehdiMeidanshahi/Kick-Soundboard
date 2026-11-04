/**
 * Proxy Manager for Kick Soundboard
 * Handles Windows system proxy detection, proxy rules normalization,
 * Electron session proxy configuration, and human-friendly network error formatting.
 */

const { execFileSync } = require('node:child_process');

/**
 * Detects the active system proxy from Windows Registry or environment variables.
 * @returns {{ isEnabled: boolean, proxyServer: string, source: 'registry' | 'env' | 'none' }}
 */
function detectSystemProxy() {
  // 1. Check environment variables first (common in VPN / terminal environments)
  const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (envProxy && typeof envProxy === 'string' && envProxy.trim()) {
    return {
      isEnabled: true,
      proxyServer: envProxy.trim(),
      source: 'env',
    };
  }

  // 2. Query Windows Registry for Internet Settings
  if (process.platform === 'win32') {
    try {
      const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
      const enableOut = execFileSync('reg.exe', ['query', regKey, '/v', 'ProxyEnable'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });

      const enabledMatch = enableOut.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
      const isEnabled = enabledMatch ? parseInt(enabledMatch[1], 16) === 1 : false;

      let serverOut = '';
      try {
        serverOut = execFileSync('reg.exe', ['query', regKey, '/v', 'ProxyServer'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
      } catch {}

      const serverMatch = serverOut.match(/ProxyServer\s+REG_\w+\s+(.+)/);
      const proxyServer = serverMatch ? serverMatch[1].trim() : '';

      if (proxyServer) {
        return {
          isEnabled,
          proxyServer,
          source: 'registry',
        };
      }
    } catch {
      // Fallback if registry query fails or access is restricted
    }
  }

  return {
    isEnabled: false,
    proxyServer: '',
    source: 'none',
  };
}

/**
 * Normalizes proxy input string into a standard format recognized by Chromium.
 * e.g., '127.0.0.1:10809' -> 'http://127.0.0.1:10809'
 *       'socks5://127.0.0.1:10808' -> 'socks5://127.0.0.1:10808'
 * @param {string} rules
 * @returns {string}
 */
function normalizeProxyRules(rules) {
  if (!rules || typeof rules !== 'string') return '';
  const trimmed = rules.trim();
  if (!trimmed) return '';

  // Multiple protocol rules e.g. "http=127.0.0.1:10809;https=127.0.0.1:10809"
  if (trimmed.includes(';') || trimmed.includes('=')) {
    return trimmed;
  }

  // Has scheme e.g. http://, https://, socks5://, socks4://
  if (/^[a-zA-Z0-9]+:\/\//.test(trimmed)) {
    return trimmed;
  }

  // Default to http:// scheme for plain host:port
  return `http://${trimmed}`;
}

/**
 * Formats low-level network errors into clear, actionable human explanations.
 * @param {Error|any} error
 * @param {string} proxyMode - 'direct' | 'system' | 'custom'
 * @returns {string}
 */
function formatNetworkError(error, proxyMode = 'direct') {
  const message = String(error?.cause?.message || error?.message || error || '');
  const code = String(error?.code || error?.cause?.code || '');

  if (/ECONNREFUSED/i.test(message) || code === 'ECONNREFUSED' || /ERR_PROXY_CONNECTION_FAILED/i.test(message)) {
    if (proxyMode === 'custom' || proxyMode === 'system') {
      return 'Proxy connection refused. Ensure your v2ray, Clash, or VPN proxy client is running and the port is correct.';
    }
    return 'Connection refused by server. Please check your network connection.';
  }

  if (/ETIMEDOUT/i.test(message) || code === 'ETIMEDOUT' || /ERR_TIMED_OUT/i.test(message) || /timed? out/i.test(message) || error?.name === 'TimeoutError') {
    return 'Connection timed out. The server or proxy did not respond in time.';
  }

  if (/ENOTFOUND/i.test(message) || code === 'ENOTFOUND' || /ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return 'Hostname resolution failed (DNS error). Check your internet connection or proxy address.';
  }

  if (/ERR_CERT|certificate/i.test(message)) {
    return 'SSL/TLS certificate verification failed. Check if a proxy or antivirus is intercepting HTTPS connections.';
  }

  if (/407/i.test(message) || /Proxy Authentication Required/i.test(message)) {
    return 'Proxy authentication required (HTTP 407). Please verify your proxy username and password.';
  }

  if (/fetch failed/i.test(message)) {
    if (proxyMode === 'direct') {
      return 'Failed to reach Kick API. If Kick or OAuth is restricted in your region, try enabling System Proxy or a custom proxy in Settings.';
    }
    return 'Failed to reach Kick API through proxy. Verify your proxy status and routing rules.';
  }

  return message || 'An unknown network error occurred.';
}

/**
 * Applies proxy configuration to an Electron session.
 * @param {object} session - Electron session instance (e.g. session.defaultSession)
 * @param {{ mode?: string, rules?: string }} proxyConfig
 */
async function applyProxyToSession(session, proxyConfig = {}) {
  if (!session || typeof session.setProxy !== 'function') return;

  const mode = proxyConfig.mode || 'direct';
  const rules = normalizeProxyRules(proxyConfig.rules || '');
  const bypassRules = '<local>,localhost,127.0.0.1';

  try {
    if (mode === 'custom' && rules) {
      await session.setProxy({
        proxyRules: rules,
        proxyBypassRules: bypassRules,
      });
    } else if (mode === 'system') {
      await session.setProxy({
        mode: 'system',
        proxyBypassRules: bypassRules,
      });
    } else {
      // Direct connection
      await session.setProxy({
        mode: 'direct',
        proxyBypassRules: bypassRules,
      });
    }
  } catch (err) {
    throw new Error(`Failed to configure proxy in session: ${err.message}`);
  }
}

module.exports = {
  detectSystemProxy,
  normalizeProxyRules,
  formatNetworkError,
  applyProxyToSession,
};
