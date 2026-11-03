const crypto = require('node:crypto');

const OAUTH_BASE = 'https://id.kick.com';

function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = async function handler(req, res) {
  const clientId = process.env.KICK_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end('<h2>Configuration Error</h2><p>KICK_CLIENT_ID environment variable is missing on Vercel.</p>');
  }

  // Derive base redirect URI from request host or env
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = process.env.KICK_REDIRECT_URI || `${proto}://${host}/api/auth/callback`;

  const verifier = randomString(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = randomString(24);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'user:read channel:rewards:read channel:rewards:write events:subscribe kicks:read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  // Store verifier and state in secure HttpOnly cookie for stateless callback verification
  const cookiePayload = JSON.stringify({ verifier, state, redirectUri });
  const cookieValue = Buffer.from(cookiePayload).toString('base64url');
  
  res.setHeader('Set-Cookie', [
    `kick_oauth=${cookieValue}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  ]);

  res.statusCode = 302;
  res.setHeader('Location', `${OAUTH_BASE}/oauth/authorize?${params.toString()}`);
  return res.end();
};
