const OAUTH_BASE = 'https://id.kick.com';

function parseCookies(header = '') {
  const list = {};
  header.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (errorParam) {
    res.statusCode = 400;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><title>Connection Failed</title><style>body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#161b22;padding:32px;border-radius:12px;border:1px solid #30363d;max-width:400px;text-align:center;}h2{color:#f85149;margin-top:0;}p{color:#8b949e;}</style></head>
      <body><div class="card"><h2>Kick Connection Failed</h2><p>${escapeHtml(errorParam)}</p></div></body>
      </html>
    `);
  }

  const cookies = parseCookies(req.headers.cookie);
  let oauthData = null;
  if (cookies.kick_oauth) {
    try {
      oauthData = JSON.parse(Buffer.from(cookies.kick_oauth, 'base64url').toString('utf8'));
    } catch {}
  }

  if (!oauthData || oauthData.state !== state) {
    res.statusCode = 400;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><title>Session Expired</title><style>body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#161b22;padding:32px;border-radius:12px;border:1px solid #30363d;max-width:400px;text-align:center;}h2{color:#f85149;margin-top:0;}p{color:#8b949e;}</style></head>
      <body><div class="card"><h2>Connection Failed</h2><p>OAuth state did not match or session expired. Please return to Kick Soundboard and try again.</p></div></body>
      </html>
    `);
  }

  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end('<h2>Configuration Error</h2><p>Server environment variables KICK_CLIENT_ID or KICK_CLIENT_SECRET are missing.</p>');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: oauthData.redirectUri,
    code_verifier: oauthData.verifier,
  });

  try {
    const tokenRes = await fetch(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || `Token exchange failed (${tokenRes.status})`);
    }

    const deepLink = `kick-soundboard://auth?token=${encodeURIComponent(data.access_token)}&refresh=${encodeURIComponent(data.refresh_token || '')}&expires_in=${encodeURIComponent(data.expires_in || 0)}`;

    // Clear cookie
    res.setHeader('Set-Cookie', [
      'kick_oauth=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);

    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Kick Connected</title>
        <style>
          body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
          .card { background: #161b22; border: 1px solid #30363d; border-radius: 14px; padding: 36px 32px; max-width: 440px; text-align: center; box-shadow: 0 16px 48px rgba(0,0,0,0.5); }
          .icon { width: 56px; height: 56px; border-radius: 50%; background: #238636; color: white; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 20px; }
          h2 { margin: 0 0 12px; color: #53fc18; font-size: 22px; }
          p { color: #8b949e; line-height: 1.5; font-size: 14px; margin: 0 0 24px; }
          .btn { display: inline-block; background: #53fc18; color: #000; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; transition: opacity .2s; }
          .btn:hover { opacity: 0.9; }
          .subtext { margin-top: 18px; font-size: 12px; color: #57606a; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>Kick Connected!</h2>
          <p>Your Kick account has been authorized. You can return to the Kick Soundboard app.</p>
          <a id="deep-link-btn" href="${escapeHtml(deepLink)}" class="btn">Open Kick Soundboard</a>
          <div class="subtext">If the app doesn't open automatically, click the button above.</div>
        </div>
        <script>
          // Automatically launch custom protocol deep-link
          window.location.href = ${JSON.stringify(deepLink)};
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><title>Connection Error</title><style>body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#161b22;padding:32px;border-radius:12px;border:1px solid #30363d;max-width:400px;text-align:center;}h2{color:#f85149;margin-top:0;}p{color:#8b949e;}</style></head>
      <body><div class="card"><h2>Token Exchange Error</h2><p>${escapeHtml(error.message)}</p></div></body>
      </html>
    `);
  }
};
