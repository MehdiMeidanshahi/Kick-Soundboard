/**
 * Parses and validates kick-soundboard:// custom protocol URLs
 * Example: kick-soundboard://auth?token=XYZ&refresh=ABC&expires_in=3600
 */
function parseDeepLinkAuth(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { success: false, error: 'Empty or invalid URL.' };
  }

  try {
    const parsed = new URL(urlString);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'kick-soundboard:') {
      return { success: false, error: `Unexpected protocol: ${protocol}` };
    }

    // In URLs like kick-soundboard://auth?token=..., hostname is 'auth' and pathname is '' or '/'
    const action = parsed.hostname || parsed.pathname.replace(/^\/+/, '');
    if (action !== 'auth') {
      return { success: false, error: `Unknown deep-link action: ${action}` };
    }

    const token = parsed.searchParams.get('token') || parsed.searchParams.get('access_token');
    const refresh = parsed.searchParams.get('refresh') || parsed.searchParams.get('refresh_token') || '';
    const expiresInParam = parsed.searchParams.get('expires_in');
    const expiresIn = expiresInParam && !isNaN(Number(expiresInParam)) ? Number(expiresInParam) : 3600;

    if (!token) {
      return { success: false, error: 'Missing access token in deep link.' };
    }

    return {
      success: true,
      token,
      refresh,
      expiresIn,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to parse deep link URL.' };
  }
}

module.exports = {
  parseDeepLinkAuth,
};
