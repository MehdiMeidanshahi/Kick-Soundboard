const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getApprovedRedemptions } = require('./redemption-playback');
const { parseRetryAfter, getPollDelay } = require('./polling-backoff');
const { shouldClearRefreshTokens, createOAuthError } = require('./oauth-utils');
const { parseVersion, compareVersions, latestStableRelease } = require('./versions');

const PORT = 9000;
const REDIRECT_URI = `http://localhost:${PORT}`;
const API_BASE = 'https://api.kick.com/public/v1';
const OAUTH_BASE = 'https://id.kick.com';
const captureGuideScreenshots = !app.isPackaged && process.env.KICK_SOUNDBOARD_CAPTURE === '1';
const screenshotDirectory = path.join(__dirname, '..', 'docs', 'screenshots');
let mainWindow;
let server;
let oauthAttempt;
let pollTimer;
let polling = false;
let consecutivePollFailures = 0;
let lastPollRetryAfterMs = null;
let pollingGeneration = 0;
let lastPollError = '';
let lastPollSuccessAt = null;
let nextPollAt = null;
let config = { clientId: '', encryptedClientSecret: '', sounds: {}, volume: 0.8, rewardVolumes: {}, cooldowns: {}, history: [], seenIds: [], pendingIds: [] };
let accessToken = '';
let refreshToken = '';
let tokenExpiresAt = 0;
const apiSessionToken = randomString(32);
const allowedOrigin = `http://localhost:${PORT}`;

const dataDir = () => app.getPath('userData');
const configPath = () => path.join(dataDir(), 'settings.json');
const tokenPath = () => path.join(dataDir(), 'tokens.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadLocalState() {
  const stored = readJson(configPath(), {});
  config = { ...config, ...stored };
  lastPollSuccessAt = config.lastPollSuccessAt || null;
  nextPollAt = null;
  lastPollError = config.lastPollError || '';
  const tokens = readJson(tokenPath(), {});
  if (tokens.encryptedAccessToken && safeStorage.isEncryptionAvailable()) {
    try { accessToken = safeStorage.decryptString(Buffer.from(tokens.encryptedAccessToken, 'base64')); } catch {}
  }
  if (tokens.encryptedRefreshToken && safeStorage.isEncryptionAvailable()) {
    try { refreshToken = safeStorage.decryptString(Buffer.from(tokens.encryptedRefreshToken, 'base64')); } catch {}
  }
  tokenExpiresAt = Number(tokens.expiresAt || 0);
}

function saveConfig() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

function saveTokens() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const payload = { expiresAt: tokenExpiresAt };
  if (safeStorage.isEncryptionAvailable()) {
    payload.encryptedAccessToken = safeStorage.encryptString(accessToken).toString('base64');
    payload.encryptedRefreshToken = safeStorage.encryptString(refreshToken).toString('base64');
  }
  fs.writeFileSync(tokenPath(), JSON.stringify(payload), 'utf8');
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requireAppRequest(req, res) {
  const origin = req.headers.origin;
  const originIsInvalid = origin ? origin !== allowedOrigin : req.method !== 'GET';
  if (originIsInvalid || req.headers['x-kick-app-session'] !== apiSessionToken) {
    sendJson(res, 403, { error: 'Request rejected.' });
    return false;
  }
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, { error: 'Expected a JSON request.' });
    return false;
  }
  return true;
}

function publicState() {
  const sounds = {};
  for (const [id, sound] of Object.entries(config.sounds || {})) {
    sounds[id] = { name: path.basename(String(sound?.name || sound?.path || '')), available: Boolean(sound?.path && fs.existsSync(sound.path) && fs.statSync(sound.path).isFile()) };
  }
  if (captureGuideScreenshots) {
    return {
      configured: true, connected: true, clientId: '', version: app.getVersion(), volume: 0.8,
      rewardVolumes: { 'sample-reward-1': 0.85 }, sounds: { 'sample-reward-1': { name: 'alert.mp3', available: true } },
      cooldowns: { 'sample-reward-1': 5 },
      outputDeviceId: config.outputDeviceId || '', streamerMode: Boolean(config.streamerMode), lastPollSuccessAt, nextPollAt, pollError: lastPollError,
      history: [{ id: 'sample-redemption-1', rewardId: 'sample-reward-1', rewardTitle: 'Play a sound', userName: 'ViewerExample', userInput: 'Hello streamer!', redeemedAt: new Date(Date.now() - 120000).toISOString(), status: 'accepted' }],
    };
  }
  return { configured: Boolean(config.clientId && config.encryptedClientSecret), connected: Boolean(accessToken), clientId: config.clientId, version: app.getVersion(), volume: config.volume ?? 0.8, rewardVolumes: config.rewardVolumes || {}, sounds, cooldowns: config.cooldowns || {}, history: config.history || [], outputDeviceId: config.outputDeviceId || '', streamerMode: Boolean(config.streamerMode), lastPollSuccessAt, nextPollAt, pollError: lastPollError };
}

function screenshotRewards() {
  return [
    { id: 'sample-reward-1', title: 'Play a sound', cost: 500, is_enabled: true, is_paused: false },
    { id: 'sample-reward-2', title: 'Surprise sound', cost: 1500, is_enabled: true, is_paused: true },
    { id: 'sample-reward-3', title: 'Disabled reward', cost: 2500, is_enabled: false, is_paused: false },
  ];
}

function randomString(bytes = 48) { return crypto.randomBytes(bytes).toString('base64url'); }

async function beginOAuth(res) {
  if (!config.clientId || !getClientSecret()) return sendJson(res, 400, { error: 'Add your Kick Client ID and Client Secret first.' });
  const verifier = randomString();
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = randomString(24);
  oauthAttempt = { verifier, state, createdAt: Date.now() };
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'channel:rewards:read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  await shell.openExternal(`${OAUTH_BASE}/oauth/authorize?${params.toString()}`);
  sendJson(res, 200, { ok: true });
}

function getClientSecret() {
  if (!config.encryptedClientSecret) return '';
  try {
    return safeStorage.decryptString(Buffer.from(config.encryptedClientSecret, 'base64'));
  } catch { return ''; }
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: config.clientId,
    client_secret: getClientSecret(), redirect_uri: REDIRECT_URI, code_verifier: verifier,
  });
  const response = await fetch(`${OAUTH_BASE}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || `Token request failed (${response.status})`);
  accessToken = data.access_token;
  refreshToken = data.refresh_token || '';
  tokenExpiresAt = Date.now() + (Number(data.expires_in || 0) * 1000);
  saveTokens();
}

async function ensureToken() {
  if (accessToken && tokenExpiresAt - Date.now() > 60_000) return accessToken;
  if (!refreshToken) throw new Error('Connect your Kick account first.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: getClientSecret(), refresh_token: refreshToken });
  const response = await fetch(`${OAUTH_BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (shouldClearRefreshTokens(data)) {
      accessToken = ''; refreshToken = ''; tokenExpiresAt = 0; saveTokens();
    }
    throw createOAuthError(data, response.status, response.headers.get('retry-after'));
  }
  if (!data.access_token) throw new Error('Kick did not return an access token. Try connecting again.');
  accessToken = data.access_token;
  refreshToken = data.refresh_token || refreshToken;
  tokenExpiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
  saveTokens();
  return accessToken;
}

async function kickGet(endpoint) {
  const token = await ensureToken();
  const response = await fetch(`${API_BASE}${endpoint}`, { headers: { authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || `Kick API error (${response.status})`);
    error.statusCode = response.status;
    error.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    throw error;
  }
  return data;
}

async function fetchRewards() {
  const result = await kickGet('/channels/rewards');
  return result.data || [];
}

function mergeHistoryRecords(history, currentItems) {
  const byId = new Map((history || []).map((item) => [item.id, item]));
  for (const item of currentItems) {
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? { ...previous, status: item.status } : item);
  }
  return [...byId.values()].sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt)).slice(0, 100);
}

async function pollRedemptions(isInitial = false) {
  if (polling || !accessToken) return;
  polling = true;
  try {
    const all = new Map();
    for (const status of ['pending', 'accepted', 'rejected']) {
      let cursor = '';
      let pages = 0;
      do {
        const qs = new URLSearchParams({ status });
        if (cursor) qs.set('cursor', cursor);
        const result = await kickGet(`/channels/rewards/redemptions?${qs.toString()}`);
        for (const group of (result.data || [])) {
          for (const redemption of (group.redemptions || [])) {
            all.set(redemption.id, {
              id: redemption.id, status: redemption.status,
              userName: redemption.redeemer?.username || '',
              redeemerUserId: redemption.redeemer?.user_id ?? null,
              userInput: redemption.user_input || '', redeemedAt: redemption.redeemed_at,
              rewardId: group.reward?.id, rewardTitle: group.reward?.title || 'Channel reward',
            });
          }
        }
        cursor = result.pagination?.next_cursor || '';
        pages += 1;
      } while (cursor && pages < 3);
    }
    const sorted = [...all.values()].sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt));
    const previousHistory = config.history;
    config.history = mergeHistoryRecords(config.history, sorted);
    // Pending requests are silent. Play only when they become approved; also
    // play a newly observed approval after startup, but never replay old history.
    const seenIds = new Set(config.seenIds || []);
    const pendingIds = new Set(config.pendingIds || []);
    for (const item of getApprovedRedemptions(sorted, previousHistory, seenIds, pendingIds, isInitial)) {
      playMappedSound(item.rewardId, item.id);
    }
    for (const item of [...sorted].reverse()) {
      if (item.status === 'pending') {
        pendingIds.delete(item.id);
        pendingIds.add(item.id);
      } else pendingIds.delete(item.id);
      seenIds.delete(item.id);
      seenIds.add(item.id);
    }
    config.seenIds = [...seenIds].slice(-1000);
    config.pendingIds = [...pendingIds].slice(-1000);
    lastPollError = '';
    lastPollSuccessAt = new Date().toISOString();
    config.lastPollSuccessAt = lastPollSuccessAt;
    config.lastPollError = '';
    consecutivePollFailures = 0;
    lastPollRetryAfterMs = null;
    saveConfig();
    mainWindow?.webContents.send('state-changed');
  } catch (error) {
    if (!accessToken) mainWindow?.webContents.send('state-changed');
    consecutivePollFailures += 1;
    const retryAfterMs = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null;
    lastPollRetryAfterMs = retryAfterMs;
    const retryInSeconds = Math.ceil(getPollDelay({ consecutiveFailures: consecutivePollFailures, retryAfterMs }) / 1000);
    nextPollAt = new Date(Date.now() + retryInSeconds * 1000).toISOString();
    const message = String(error.message || 'Kick request failed.');
    if (message !== lastPollError) {
      lastPollError = message;
    }
    config.lastPollError = lastPollError;
    saveConfig();
    mainWindow?.webContents.send('poll-error', { message, retryInSeconds });
    mainWindow?.webContents.send('state-changed');
  } finally { polling = false; }
}

function playMappedSound(rewardId, redemptionId) {
  mainWindow?.webContents.send('play-sound', {
    rewardId,
    redemptionId,
    masterVolume: config.volume ?? 0.8,
    rewardVolume: config.rewardVolumes?.[rewardId] ?? 1,
    cooldownMs: Math.max(0, Number(config.cooldowns?.[rewardId] || 0) * 1000),
  });
}

async function handleRequest(req, res) {
  if (req.headers.host !== `localhost:${PORT}`) {
    res.writeHead(421, { 'cache-control': 'no-store' });
    return res.end('Misdirected request');
  }
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname === '/' && url.searchParams.has('code')) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!oauthAttempt || state !== oauthAttempt.state || Date.now() - oauthAttempt.createdAt > 10 * 60_000) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<h2>Kick connection failed</h2><p>Authorization state did not match. Return to the app and try again.</p>');
    }
    try {
      await exchangeCode(code, oauthAttempt.verifier);
      oauthAttempt = null;
      startPolling();
      mainWindow?.webContents.send('state-changed');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<meta http-equiv="refresh" content="2;url=http://localhost:9000"><h2>Kick connected</h2><p>You can return to the soundboard.</p>');
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<h2>Kick connection failed</h2><p>${escapeHtml(error.message)}</p>`);
    }
  }
  if (url.pathname.startsWith('/api/') && !requireAppRequest(req, res)) return;
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const state = publicState();
    state.connected = captureGuideScreenshots || Boolean(accessToken);
    return sendJson(res, 200, state);
  }
  if (req.method === 'GET' && url.pathname === '/api/updates') {
    try {
      const response = await fetch('https://api.github.com/repos/MehdiMeidanshahi/Kick-Soundboard/releases?per_page=100', {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Kick-Soundboard' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      const releases = await response.json();
      const release = latestStableRelease(releases);
      if (!release) throw new Error('No published app releases were found.');
      const currentVersion = app.getVersion();
      return sendJson(res, 200, {
        currentVersion,
        latestVersion: String(release.tag_name).replace(/^v/i, ''),
        updateAvailable: compareVersions(release.tag_name, currentVersion) > 0,
      });
    } catch (error) {
      return sendJson(res, 502, { error: error.name === 'TimeoutError' ? 'GitHub update check timed out.' : error.message || 'GitHub update check failed.' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = JSON.parse(await readBody(req));
    config.clientId = String(body.clientId || '').trim();
    if (body.clientSecret) {
      if (!safeStorage.isEncryptionAvailable()) return sendJson(res, 500, { error: 'Windows secure storage is unavailable; credentials were not saved.' });
      config.encryptedClientSecret = safeStorage.encryptString(String(body.clientSecret)).toString('base64');
    }
    saveConfig();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/connect') return beginOAuth(res);
  if (req.method === 'POST' && url.pathname === '/api/disconnect') {
    accessToken = ''; refreshToken = ''; tokenExpiresAt = 0;
    fs.rmSync(tokenPath(), { force: true });
    stopPolling();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/rewards') {
    if (captureGuideScreenshots) return sendJson(res, 200, { data: screenshotRewards() });
    try { return sendJson(res, 200, { data: await fetchRewards() }); }
    catch (error) { return sendJson(res, 401, { error: error.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const body = JSON.parse(await readBody(req));
    if (Number.isFinite(Number(body.volume))) config.volume = Math.min(1, Math.max(0, Number(body.volume)));
    if (typeof body.outputDeviceId === 'string') config.outputDeviceId = body.outputDeviceId;
    if (typeof body.streamerMode === 'boolean') config.streamerMode = body.streamerMode;
    if (body.rewardId) {
      config.sounds ||= {}; config.cooldowns ||= {}; config.rewardVolumes ||= {};
      if (typeof body.soundPath === 'string') {
        const selectedPath = path.resolve(body.soundPath);
        const allowedExtensions = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
        if (!allowedExtensions.has(path.extname(selectedPath).toLowerCase()) || !fs.statSync(selectedPath).isFile()) {
          return sendJson(res, 400, { error: 'Choose a supported audio file.' });
        }
        config.sounds[body.rewardId] = { path: selectedPath, name: path.basename(selectedPath) };
      }
      if (body.clearSound) delete config.sounds[body.rewardId];
      if (body.cooldown !== undefined) config.cooldowns[body.rewardId] = Math.min(3600, Math.max(0, Number(body.cooldown) || 0));
      if (body.rewardVolume !== undefined && Number.isFinite(Number(body.rewardVolume))) {
        config.rewardVolumes[body.rewardId] = Math.min(1, Math.max(0, Number(body.rewardVolume)));
      }
    }
    saveConfig();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/history/clear') {
    config.history = [];
    saveConfig();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
    const rewardId = decodeURIComponent(url.pathname.slice('/api/audio/'.length));
    const filePath = config.sounds?.[rewardId]?.path;
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); return res.end(); }
    const ext = path.extname(filePath).toLowerCase();
    const type = ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' })[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    const audioStream = fs.createReadStream(filePath);
    audioStream.on('error', () => {
      if (!res.headersSent) { res.writeHead(404); res.end(); }
      else res.destroy();
    });
    return audioStream.pipe(res);
  }
  if (req.method === 'POST' && url.pathname === '/api/test-sound') {
    const body = JSON.parse(await readBody(req));
    mainWindow?.webContents.send('play-sound', {
      rewardId: body.rewardId,
      masterVolume: config.volume ?? 0.8,
      rewardVolume: config.rewardVolumes?.[body.rewardId] ?? 1,
    });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/poll') {
    await pollRedemptions();
    return sendJson(res, 200, { ok: true });
  }
    if (req.method === 'GET' && url.pathname === '/api/status') {
    if (captureGuideScreenshots) return sendJson(res, 200, { connected: true });
    try { return sendJson(res, 200, { connected: Boolean(await ensureToken()) }); }
    catch { return sendJson(res, 200, { connected: false }); }
  }
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/renderer.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'renderer.js')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/queue-playback.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'queue-playback.js')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/icon.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    return fs.createReadStream(path.join(__dirname, '..', 'build', 'icon.svg')).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
}

function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function startPolling() {
  stopPolling();
  const generation = pollingGeneration;
  consecutivePollFailures = 0;
  lastPollRetryAfterMs = null;
  const schedulePoll = async (isInitial = false) => {
    if (generation !== pollingGeneration || !accessToken) return;
    await pollRedemptions(isInitial);
    if (generation !== pollingGeneration || !accessToken) return;
    const delay = getPollDelay({ consecutiveFailures: consecutivePollFailures, retryAfterMs: lastPollRetryAfterMs });
    lastPollRetryAfterMs = null;
    nextPollAt = new Date(Date.now() + delay).toISOString();
    mainWindow?.webContents.send('state-changed');
    pollTimer = setTimeout(() => schedulePoll(false), delay);
  };
  schedulePoll(true);
}
function stopPolling() {
  pollingGeneration += 1;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  nextPollAt = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1080, minHeight: 700,
    backgroundColor: '#0d1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== allowedOrigin) event.preventDefault();
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
  if (captureGuideScreenshots) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 750));
        fs.mkdirSync(screenshotDirectory, { recursive: true });
        const saveShot = async (filename) => {
          const image = await mainWindow.capturePage();
          fs.writeFileSync(path.join(screenshotDirectory, filename), image.toPNG());
        };
        await saveShot('app-overview.png');
        await mainWindow.webContents.executeJavaScript("document.querySelector('#settings-btn').click()");
        await new Promise((resolve) => setTimeout(resolve, 250));
        await saveShot('connection-settings.png');
      } catch (error) {
        console.error('Could not capture guide screenshots:', error.message);
      }
    });
  }
}

function assertTrustedFrame(event) {
  if (event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== allowedOrigin) {
    throw new Error('Untrusted app frame.');
  }
}

ipcMain.handle('choose-audio', async (event) => {
  assertTrustedFrame(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a sound for this reward', properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('get-api-session-token', (event) => {
  assertTrustedFrame(event);
  return apiSessionToken;
});
ipcMain.handle('open-releases', (event) => {
  assertTrustedFrame(event);
  return shell.openExternal('https://github.com/MehdiMeidanshahi/Kick-Soundboard/releases');
});

app.whenReady().then(() => {
  if (captureGuideScreenshots) {
    app.setPath('userData', path.join(app.getPath('temp'), 'kick-soundboard-screenshot-profile'));
  } else {
    loadLocalState();
  }
  server = http.createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    res.setHeader('cache-control', 'no-store');
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'The local request failed.' });
      else res.destroy();
    });
  });
  server.once('error', (error) => {
    dialog.showErrorBox('Kick Soundboard could not start', error.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Close the other program using it, then restart Kick Soundboard.`
      : 'The local app server could not start. Restart the app and try again.');
    app.quit();
  });
  server.listen(PORT, 'localhost', () => {
    createWindow();
    if (accessToken) startPolling();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { stopPolling(); server?.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
