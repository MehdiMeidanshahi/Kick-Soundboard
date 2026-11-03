const OAUTH_BASE = 'https://id.kick.com';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Server configuration error' }));
  }

  const body = await readJson(req);
  const refreshToken = body.refresh_token || body.refreshToken;
  if (!refreshToken) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing refresh_token' }));
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  try {
    const tokenRes = await fetch(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      res.statusCode = tokenRes.status || 400;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in,
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: error.message || 'Token refresh failed' }));
  }
};
