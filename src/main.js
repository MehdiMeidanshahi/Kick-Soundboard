const electron = require('electron');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, globalShortcut, nativeImage } = electron;
const session = electron?.session;
const net = electron?.net;
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const logger = require('./logger');
const proxyManager = require('./proxy-manager');

// Set Windows AppUserModelId immediately for proper taskbar icon and grouping
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.localvc.kicksoundboard');
  } catch {}
}

const appIconPath = path.join(__dirname, 'icon.ico');
const appIcon = (nativeImage?.createFromPath && fs.existsSync(appIconPath)) ? nativeImage.createFromPath(appIconPath) : null;
const { getApprovedRedemptions, getRedemptionsToPlay } = require('./redemption-playback');
const { parseRetryAfter, getPollDelay } = require('./polling-backoff');
const { shouldClearRefreshTokens, createOAuthError } = require('./oauth-utils');
const { parseVersion, compareVersions, latestStableRelease } = require('./versions');
const {
  resolveUserNames,
  resolveCurrentStreamer,
  enrichHistoryWithUserNames,
  mergeHistoryRecords,
} = require('./user-resolver');

const PORT = 9000;
const REDIRECT_URI = `http://localhost:${PORT}`;
const API_BASE = 'https://api.kick.com/public/v1';
const OAUTH_BASE = 'https://id.kick.com';
const { parseDeepLinkAuth } = require('./deep-link');
const DEFAULT_BRIDGE_URL = 'https://kicksoundboard-itsmehdi7.vercel.app';
const getBridgeUrl = () => process.env.KICK_BRIDGE_URL || config.bridgeUrl || DEFAULT_BRIDGE_URL;
const captureGuideScreenshots = !app.isPackaged && process.env.KICK_SOUNDBOARD_CAPTURE === '1';
const screenshotDirectory = path.join(__dirname, '..', 'docs', 'screenshots');
let mainWindow;
let soundpadWindow;
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
let cachedRewards = [];
let latestUpdateAvailable = false;
let config = { clientId: '', encryptedClientSecret: '', bridgeUrl: '', sounds: {}, volume: 0.8, rewardVolumes: {}, cooldowns: {}, history: [], seenIds: [], pendingIds: [], knownUsers: {}, streamerProfile: null, playPending: false, playedIds: [], proxyMode: 'direct', proxyRules: '' };
let accessToken = '';
let refreshToken = '';
let tokenExpiresAt = 0;
const apiSessionToken = randomString(32);
const allowedOrigin = `http://localhost:${PORT}`;

function appFetch(url, options) {
  if (net && typeof net.fetch === 'function') {
    return net.fetch(url, options);
  }
  return globalThis.fetch(url, options);
}

async function applyAppProxy() {
  if (session?.defaultSession) {
    await proxyManager.applyProxyToSession(session.defaultSession, {
      mode: config.proxyMode || 'direct',
      rules: config.proxyRules || '',
    });
  }
}

const dataDir = () => app.getPath('userData');
const configPath = () => path.join(dataDir(), 'settings.json');
const tokenPath = () => path.join(dataDir(), 'tokens.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function areAcceleratorsEqual(a, b) {
  if (!a || !b) return false;
  const norm = (s) => String(s).toLowerCase()
    .replace(/commandorcontrol|ctrl|control/g, 'ctrl')
    .replace(/return/g, 'enter')
    .split('+')
    .map(x => x.trim())
    .sort()
    .join('+');
  return norm(a) === norm(b);
}

function normalizeAccelerator(acc) {
  if (!acc || typeof acc !== 'string') return '';
  return acc.toLowerCase()
    .replace(/commandorcontrol|ctrl|control/g, 'ctrl')
    .replace(/return/g, 'enter')
    .split('+')
    .map(x => x.trim())
    .sort()
    .join('+');
}

function toElectronAccelerator(acc) {
  if (!acc || typeof acc !== 'string') return '';
  const parts = acc.split('+').map(s => s.trim());
  const normalizedParts = parts.map((p) => {
    const lower = p.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmdorctrl' || lower === 'commandorcontrol') return 'CommandOrControl';
    if (lower === 'alt') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (/^num\d$/i.test(p)) return p.toLowerCase(); // num0 .. num9
    if (/^numpad\d$/i.test(p)) return `num${p.slice(6)}`; // numpad1 -> num1
    if (lower === 'numpadadd' || lower === 'numadd') return 'numadd';
    if (lower === 'numpadsubtract' || lower === 'numsub') return 'numsub';
    if (lower === 'numpadmultiply' || lower === 'nummult') return 'nummult';
    if (lower === 'numpaddivide' || lower === 'numdiv') return 'numdiv';
    if (lower === 'numpaddecimal' || lower === 'numdec') return 'numdec';
    if (/^f\d{1,2}$/i.test(p)) return p.toUpperCase(); // F1..F24
    if (lower === 'space') return 'Space';
    if (lower === 'enter' || lower === 'return') return 'Return';
    if (p.length === 1) return p.toUpperCase();
    return p;
  });
  return normalizedParts.join('+');
}

function hasModifier(acc) {
  return /CommandOrControl|Control|Ctrl|Alt|Shift/i.test(acc);
}

function loadLocalState() {
  const stored = readJson(configPath(), {});
  config = { ...config, ...stored };
  config.goal = {
    title: 'Community Kick Goal',
    current: 0,
    target: 10000,
    autoAddRedemptions: true,
    lastUpdated: Date.now(),
    ...(config.goal || {}),
  };
  config.knownUsers = { ...(config.knownUsers || {}), ...(stored.knownUsers || {}) };
  config.history = enrichHistoryWithUserNames(config.history || [], config.knownUsers);
  lastPollSuccessAt = config.lastPollSuccessAt || null;
  nextPollAt = null;
  lastPollError = config.lastPollError || '';

  // Deduplicate and sanitize keybinds on load
  if (config.keybinds && typeof config.keybinds === 'object') {
    const seenAcc = new Map();
    for (const [id, acc] of Object.entries(config.keybinds)) {
      if (!acc || typeof acc !== 'string') {
        delete config.keybinds[id];
        continue;
      }
      const norm = normalizeAccelerator(acc);
      if (seenAcc.has(norm)) {
        delete config.keybinds[seenAcc.get(norm)];
      }
      seenAcc.set(norm, id);
    }
  }

  const tokens = readJson(tokenPath(), {});
  if (tokens.encryptedAccessToken && safeStorage.isEncryptionAvailable()) {
    try { accessToken = safeStorage.decryptString(Buffer.from(tokens.encryptedAccessToken, 'base64')); } catch {}
  }
  if (tokens.encryptedRefreshToken && safeStorage.isEncryptionAvailable()) {
    try { refreshToken = safeStorage.decryptString(Buffer.from(tokens.encryptedRefreshToken, 'base64')); } catch {}
  }
  tokenExpiresAt = Number(tokens.expiresAt || 0);
  applyAppProxy().catch(() => {});
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
  const token = req.headers['x-kick-app-session'] || req.headers['x-app-session'];
  if (originIsInvalid || token !== apiSessionToken) {
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
    const isFile = Boolean(sound?.path && fs.existsSync(sound.path) && (() => { try { return fs.statSync(sound.path).isFile(); } catch { return false; } })());
    sounds[id] = {
      name: path.basename(String(sound?.name || sound?.path || '')),
      available: isFile,
      path: sound?.path || '',
      title: sound?.title || path.basename(String(sound?.name || sound?.path || '')),
    };
  }

  const streamerName = config.streamerProfile?.name || config.streamerProfile?.username || '';
  const streamerObj = config.streamerProfile ? {
    ...config.streamerProfile,
    name: streamerName,
    username: streamerName,
    slug: config.streamerProfile.slug || streamerName.toLowerCase(),
    profile_pic: config.streamerProfile.profile_pic || config.streamerProfile.profilePicture || '',
  } : null;

  if (captureGuideScreenshots) {
    const mockStreamer = { name: 'StreamerExample', username: 'StreamerExample', slug: 'streamerexample', profile_pic: '' };
    return {
      configured: true,
      connected: true,
      clientId: '',
      version: app.getVersion(),
      volume: 0.8,
      rewardVolumes: { 'sample-reward-1': 0.85 },
      sounds: { 'sample-reward-1': { name: 'alert.mp3', available: true, path: 'alert.mp3', title: 'Play a sound' } },
      keybinds: config.keybinds || {},
      cooldowns: { 'sample-reward-1': 5 },
      rewardCooldowns: { 'sample-reward-1': 5 },
      outputDeviceId: config.outputDeviceId || '',
      audioDeviceId: config.outputDeviceId || '',
      streamerMode: Boolean(config.streamerMode),
      lastPollSuccessAt,
      nextPollAt,
      lastChecked: lastPollSuccessAt,
      nextCheck: nextPollAt,
      consecutiveFailures: 0,
      polling: true,
      pollError: lastPollError,
      history: [{ id: 'sample-redemption-1', rewardId: 'sample-reward-1', rewardTitle: 'Play a sound', userName: 'ViewerExample', userInput: 'Hello streamer!', redeemedAt: new Date(Date.now() - 120000).toISOString(), status: 'accepted' }],
      streamer: mockStreamer,
      streamerProfile: mockStreamer,
      channelName: 'StreamerExample',
      updateAvailable: Boolean(latestUpdateAvailable),
      hasUpdate: Boolean(latestUpdateAvailable),
      rewards: screenshotRewards(),
      playPending: Boolean(config.playPending),
    proxyMode: config.proxyMode || 'direct',
    proxyRules: config.proxyRules || '',
    systemProxy: proxyManager.detectSystemProxy().proxyServer || '',
    };
  }

  return {
    configured: Boolean(accessToken || (config.clientId && config.encryptedClientSecret)),
    connected: Boolean(accessToken),
    clientId: config.clientId,
    bridgeUrl: getBridgeUrl(),
    version: app.getVersion(),
    volume: config.volume ?? 0.8,
    rewardVolumes: config.rewardVolumes || {},
    sounds,
    keybinds: config.keybinds || {},
    cooldowns: config.cooldowns || {},
    rewardCooldowns: config.cooldowns || {},
    history: config.history || [],
    outputDeviceId: config.outputDeviceId || '',
    audioDeviceId: config.outputDeviceId || '',
    streamerMode: Boolean(config.streamerMode),
    lastPollSuccessAt,
    nextPollAt,
    lastChecked: lastPollSuccessAt,
    nextCheck: nextPollAt,
    consecutiveFailures: consecutivePollFailures,
    polling,
    pollError: lastPollError,
    streamer: streamerObj,
    streamerProfile: streamerObj,
    channelName: streamerObj?.username || '',
    updateAvailable: Boolean(latestUpdateAvailable),
    hasUpdate: Boolean(latestUpdateAvailable),
    rewards: cachedRewards || [],
    playPending: Boolean(config.playPending),
    proxyMode: config.proxyMode || 'direct',
    proxyRules: config.proxyRules || '',
    systemProxy: proxyManager.detectSystemProxy().proxyServer || '',
    goal: config.goal || { title: 'Community Kick Goal', current: 0, target: 10000, autoAddRedemptions: true },
  };
}

function screenshotRewards() {
  return [
    { id: 'sample-reward-1', title: 'Play a sound', cost: 500, is_enabled: true, is_paused: false },
    { id: 'sample-reward-2', title: 'Surprise sound', cost: 1500, is_enabled: true, is_paused: true },
    { id: 'sample-reward-3', title: 'Disabled reward', cost: 2500, is_enabled: false, is_paused: false },
  ];
}

function randomString(bytes = 48) { return crypto.randomBytes(bytes).toString('base64url'); }

function extractDeepLinkUrl(args) {
  if (!Array.isArray(args)) return null;
  for (const raw of args) {
    if (typeof raw !== 'string') continue;
    const clean = raw.trim().replace(/^["']|["']$/g, '');
    if (clean.startsWith('kick-soundboard://')) {
      return clean;
    }
  }
  return null;
}

function handleDeepLink(urlString) {
  if (typeof urlString !== 'string') return false;
  urlString = urlString.trim().replace(/^["']|["']$/g, '');
  if (urlString.startsWith('kick-soundboard://trigger/')) {
    const rawId = urlString.replace('kick-soundboard://trigger/', '').split(/[?#]/)[0];
    if (rawId) {
      const result = triggerSoundpadAction(decodeURIComponent(rawId));
      if (!result.ok) {
        logger.logError('Deep Link Trigger Failed', new Error(result.error), { urlString, result });
      }
      return result.ok;
    }
  }
  if (urlString.startsWith('kick-soundboard://stop-all')) {
    const result = panicStopAllAction();
    return result.ok;
  }
  const result = parseDeepLinkAuth(urlString);
  if (!result.success) {
    logger.logError('Deep Link Auth Failed', new Error(result.error), { urlString: urlString.split('?')[0] });
    return false;
  }
  accessToken = String(result.token).replace(/\/+$/, '');
  refreshToken = String(result.refresh || refreshToken).replace(/\/+$/, '');
  tokenExpiresAt = Date.now() + (Number(result.expiresIn || 3600) * 1000);
  saveTokens();
  startPolling();
  mainWindow?.webContents.send('state-changed');
  return true;
}

function openSoundpadWindow() {
  if (soundpadWindow && !soundpadWindow.isDestroyed()) {
    soundpadWindow.show();
    soundpadWindow.focus();
    return;
  }

  soundpadWindow = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 420,
    minHeight: 380,
    title: 'Kick Sound Pad',
    icon: appIcon || appIconPath,
    backgroundColor: '#090c10',
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const sessionToken = apiSessionToken;
  soundpadWindow.loadURL(`http://localhost:${PORT}/soundpad.html?token=${encodeURIComponent(sessionToken)}`);

  soundpadWindow.on('closed', () => {
    soundpadWindow = null;
  });
}

const overlayClients = new Set();
const overlayEventsQueue = [];

function broadcastOverlayEvent(event) {
  if (!event || !event.type) return;
  event.id = event.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  event.timestamp = event.timestamp || Date.now();

  overlayEventsQueue.push(event);
  if (overlayEventsQueue.length > 50) overlayEventsQueue.shift();

  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of overlayClients) {
    try {
      client.write(data);
    } catch {
      overlayClients.delete(client);
    }
  }
}

const goalClients = new Set();
const goalEventsQueue = [];

function broadcastGoalEvent(event) {
  if (!event) return;
  event.id = event.id || `goal_evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  event.timestamp = event.timestamp || Date.now();

  goalEventsQueue.push(event);
  if (goalEventsQueue.length > 50) goalEventsQueue.shift();

  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of goalClients) {
    try {
      client.write(data);
    } catch {
      goalClients.delete(client);
    }
  }
}

function triggerSoundpadAction(soundId) {
  const sound = config.sounds?.[soundId] || config.sounds?.[String(soundId)];
  if (!sound) {
    const err = new Error(`Trigger failed: sound '${soundId}' is not mapped or does not exist`);
    err.code = 'SOUND_NOT_MAPPED';
    logger.logError('Soundpad Trigger Warning', err, { soundId });
    return { ok: false, error: err.message, code: 'NOT_FOUND', status: 404 };
  }
  const resolvedPath = sound.path ? path.resolve(sound.path) : '';
  if (resolvedPath && !fs.existsSync(resolvedPath)) {
    const err = new Error(`Trigger failed: audio file '${resolvedPath}' does not exist on disk`);
    err.code = 'AUDIO_FILE_MISSING';
    logger.logError('Soundpad Trigger Missing File', err, { soundId, path: resolvedPath });
    return { ok: false, error: err.message, code: 'FILE_MISSING', status: 404 };
  }

  const hasMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
  const hasSoundpadWindow = Boolean(soundpadWindow && !soundpadWindow.isDestroyed());
  if (!hasMainWindow && !hasSoundpadWindow) {
    const err = new Error('Trigger failed: no active playback window is open to play audio');
    err.code = 'NO_ACTIVE_WINDOW';
    logger.logError('Soundpad Trigger Inactive Window', err, { soundId });
    return { ok: false, error: err.message, code: 'UNAVAILABLE', status: 503 };
  }

  try {
    if (hasMainWindow) {
      mainWindow.webContents.send('trigger-soundpad', { id: soundId });
    }
    if (hasSoundpadWindow) {
      soundpadWindow.webContents.send('trigger-soundpad', { id: soundId });
    }

    const isReward = Boolean((config.rewards || []).find((r) => String(r.id) === String(soundId)));
    const soundBaseName = (sound.path ? path.basename(sound.path) : '') || sound.name || soundId;
    const soundTitle = sound.title || soundBaseName;

    broadcastOverlayEvent({
      type: isReward ? 'channel_point' : 'soundpad',
      soundId,
      title: soundTitle,
      userName: 'Streamer',
      timestamp: Date.now(),
    });

    return { ok: true, triggered: soundId, status: 200 };
  } catch (err) {
    logger.logError('Soundpad Trigger Dispatch Error', err, { soundId });
    return { ok: false, error: err.message, code: 'INTERNAL_ERROR', status: 500 };
  }
}

function panicStopAllAction() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('panic-stop-all');
    }
    if (soundpadWindow && !soundpadWindow.isDestroyed()) {
      soundpadWindow.webContents.send('panic-stop-all');
    }
    return { ok: true, stopped: true, status: 200 };
  } catch (err) {
    logger.logError('Stream Deck Panic Stop Dispatch Error', err);
    return { ok: false, error: err.message, code: 'INTERNAL_ERROR', status: 500 };
  }
}

function registerGlobalKeybinds() {
  if (!globalShortcut || typeof globalShortcut.unregisterAll !== 'function') return;
  try {
    globalShortcut.unregisterAll();
  } catch {}

  const keybinds = config.keybinds || {};
  const registeredAccelerators = new Set();

  for (const [id, rawAcc] of Object.entries(keybinds)) {
    if (!rawAcc || typeof rawAcc !== 'string') continue;
    // Mouse buttons are handled in-window and cannot be registered via Win32 RegisterHotKey
    if (/mouse/i.test(rawAcc)) continue;
    // Escape key is reserved for Panic Stop and cannot be registered as custom sound keybind
    if (/^escape$/i.test(rawAcc) || /^esc$/i.test(rawAcc)) continue;
    const electronAcc = toElectronAccelerator(rawAcc);
    if (!electronAcc) continue;

    // Deduplicate: avoid registering the same accelerator twice in the loop
    if (registeredAccelerators.has(electronAcc.toLowerCase())) continue;

    const action = () => {
      if (id === '__panic_stop__') {
        panicStopAllAction();
      } else {
        triggerSoundpadAction(id);
      }
    };

    try {
      const ok = globalShortcut.register(electronAcc, action);
      if (ok) {
        registeredAccelerators.add(electronAcc.toLowerCase());
      } else {
        // If standalone key failed (e.g. single digit '1' or letter 'A' which Windows OS rejects without modifier),
        // try registering Alt+key as the global OS fallback
        if (!hasModifier(electronAcc) && !/^F\d{1,2}$/i.test(electronAcc)) {
          const fallback = `Alt+${electronAcc}`;
          if (!registeredAccelerators.has(fallback.toLowerCase())) {
            const fallbackOk = globalShortcut.register(fallback, action);
            if (fallbackOk) {
              registeredAccelerators.add(fallback.toLowerCase());
            }
          }
        }
      }
    } catch (err) {
      if (typeof logger !== 'undefined') {
        logger.logError('Global keybind registration error', err, { id, accelerator: electronAcc });
      }
    }
  }
}

async function beginOAuth(res) {
  const bridgeUrl = getBridgeUrl();
  if (bridgeUrl) {
    const loginUrl = `${bridgeUrl}/api/auth/login`;
    await shell.openExternal(loginUrl);
    return sendJson(res, 200, { ok: true, url: loginUrl });
  }
  const verifier = randomString();
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = randomString(24);
  oauthAttempt = { verifier, state, createdAt: Date.now() };
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'user:read channel:rewards:read channel:rewards:write events:subscribe kicks:read',
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
  const response = await appFetch(`${OAUTH_BASE}/oauth/token`, {
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

  // If local credentials exist (legacy mode), refresh directly
  if (config.clientId && getClientSecret()) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: getClientSecret(), refresh_token: refreshToken });
    const response = await appFetch(`${OAUTH_BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
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

  // Refresh via Vercel OAuth Bridge
  const bridgeUrl = getBridgeUrl();
  const response = await appFetch(`${bridgeUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (shouldClearRefreshTokens(data)) {
      accessToken = ''; refreshToken = ''; tokenExpiresAt = 0; saveTokens();
    }
    const retryAfter = response.headers?.get ? response.headers.get('retry-after') : null;
    throw createOAuthError(data, response.status, retryAfter);
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
  const response = await appFetch(`${API_BASE}${endpoint}`, { headers: { authorization: `Bearer ${token}` } });
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
  cachedRewards = result.data || [];
  return cachedRewards;
}

async function pollRedemptions(isInitial = false) {
  if (polling || !accessToken) return;
  polling = true;
  try {
    if (!config.streamerProfile && accessToken) {
      config.streamerProfile = await resolveCurrentStreamer({ kickGet, cachedUsers: config.knownUsers });
    }
    const all = new Map();
    const uncachedUserIds = new Set();
    for (const status of ['pending', 'accepted', 'rejected']) {
      let cursor = '';
      let pages = 0;
      do {
        const qs = new URLSearchParams({ status });
        if (cursor) qs.set('cursor', cursor);
        const result = await kickGet(`/channels/rewards/redemptions?${qs.toString()}`);
        for (const group of (result.data || [])) {
          for (const redemption of (group.redemptions || [])) {
            const redeemerId = redemption.redeemer?.user_id ?? null;
            if (redeemerId && !config.knownUsers?.[String(redeemerId)]) {
              uncachedUserIds.add(redeemerId);
            }
            all.set(redemption.id, {
              id: redemption.id, status: redemption.status,
              userName: redemption.redeemer?.username || (redeemerId ? config.knownUsers?.[String(redeemerId)] : '') || '',
              redeemerUserId: redeemerId,
              userInput: redemption.user_input || '', redeemedAt: redemption.redeemed_at,
              rewardId: group.reward?.id, rewardTitle: group.reward?.title || 'Channel reward',
            });
          }
        }
        cursor = result.pagination?.next_cursor || '';
        pages += 1;
      } while (cursor && pages < 3);
    }
    for (const item of (config.history || [])) {
      if (!item.userName && item.redeemerUserId && !config.knownUsers?.[String(item.redeemerUserId)]) {
        uncachedUserIds.add(item.redeemerUserId);
      }
    }
    if (uncachedUserIds.size > 0) {
      config.knownUsers ||= {};
      await resolveUserNames({
        userIds: [...uncachedUserIds],
        cachedUsers: config.knownUsers,
        kickGet,
      });
      for (const item of all.values()) {
        if (!item.userName && item.redeemerUserId && config.knownUsers[String(item.redeemerUserId)]) {
          item.userName = config.knownUsers[String(item.redeemerUserId)];
        }
      }
    }
    const sorted = [...all.values()].sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt));
    const previousHistory = config.history;
    config.history = mergeHistoryRecords(config.history, sorted);
    config.history = enrichHistoryWithUserNames(config.history, config.knownUsers);
    // Play approved redemptions, or pending redemptions if playPending toggle is enabled.
    // Redemptions are played once and never duplicated or replayed from startup backlog.
    const seenIds = new Set(config.seenIds || []);
    const pendingIds = new Set(config.pendingIds || []);
    const playedIds = new Set(config.playedIds || []);
    const toPlay = getRedemptionsToPlay(sorted, previousHistory, seenIds, pendingIds, isInitial, {
      playPending: Boolean(config.playPending),
    proxyMode: config.proxyMode || 'direct',
    proxyRules: config.proxyRules || '',
    systemProxy: proxyManager.detectSystemProxy().proxyServer || '',
      playedIds,
    });
    for (const item of toPlay) {
      playMappedSound(item.rewardId, item.id, item);
      playedIds.add(item.id);
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
    config.playedIds = [...playedIds].slice(-1000);
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
    const message = proxyManager.formatNetworkError(error, config.proxyMode || 'direct');
    if (message !== lastPollError) {
      lastPollError = message;
    }
    config.lastPollError = lastPollError;
    saveConfig();
    mainWindow?.webContents.send('poll-error', { message, retryInSeconds });
    mainWindow?.webContents.send('state-changed');
  } finally { polling = false; }
}

function playMappedSound(rewardId, redemptionId, item = {}) {
  mainWindow?.webContents.send('play-sound', {
    rewardId,
    redemptionId,
    masterVolume: config.volume ?? 0.8,
    rewardVolume: config.rewardVolumes?.[rewardId] ?? 1,
    cooldownMs: Math.max(0, Number(config.cooldowns?.[rewardId] || 0) * 1000),
  });

  const reward = (config.rewards || []).find((r) => String(r.id) === String(rewardId));
  const sound = config.sounds?.[rewardId];
  const rewardTitle = reward?.title || sound?.title || (sound?.path ? path.basename(sound.path) : '') || 'Channel Reward';
  const userName = item.userName || (item.user && item.user.username) || (item.redeemerUserId ? `Viewer #${item.redeemerUserId}` : 'Viewer');
  const cost = item.rewardCost || item.cost || reward?.cost || null;

  broadcastOverlayEvent({
    type: 'channel_point',
    id: redemptionId || `red_${Date.now()}`,
    rewardId,
    title: rewardTitle,
    userName,
    cost,
    timestamp: Date.now(),
  });

  // Channel Point Goal Integration: auto-add points and broadcast event
  const costNum = Number(cost || 0);
  if (config.goal && config.goal.autoAddRedemptions && costNum > 0) {
    config.goal.current = Math.max(0, (config.goal.current || 0) + costNum);
    config.goal.lastUpdated = Date.now();
    saveConfig();
    mainWindow?.webContents.send('goal-updated', config.goal);
    broadcastGoalEvent({
      type: 'redemption',
      userName,
      rewardTitle,
      pointsAdded: costNum,
      goal: config.goal,
      timestamp: Date.now(),
    });
  }
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
  // Stream Deck Integration endpoints (Background GET / POST for Elgato, Loupedeck, Touch Portal)
  if (url.pathname === '/streamdeck/actions' || url.pathname === '/api/streamdeck/actions') {
    const actions = [];
    const allSounds = config.sounds || {};
    const keybinds = config.keybinds || {};
    for (const [id, soundObj] of Object.entries(allSounds)) {
      if (!soundObj || (!soundObj.path && !soundObj.name)) continue;
      const soundBaseName = (soundObj.path ? path.basename(soundObj.path) : '') || soundObj.name || id;
      actions.push({
        id,
        title: soundObj.title || soundBaseName,
        type: id.startsWith('pad_') ? 'soundpad' : 'reward',
        triggerUrl: `http://localhost:${PORT}/streamdeck/trigger/${encodeURIComponent(id)}`,
        protocolUrl: `kick-soundboard://trigger/${encodeURIComponent(id)}`,
        keybind: keybinds[id] || null,
      });
    }
    return sendJson(res, 200, {
      ok: true,
      stopAllUrl: `http://localhost:${PORT}/streamdeck/stop-all`,
      stopAllProtocol: `kick-soundboard://stop-all`,
      actions,
    });
  }

  if (url.pathname.startsWith('/streamdeck/trigger/')) {
    const rawId = url.pathname.replace('/streamdeck/trigger/', '');
    const soundId = decodeURIComponent(rawId);
    if (!soundId) {
      logger.logError('Stream Deck Trigger Missing ID', new Error('Sound ID is missing in trigger URL path'));
      return sendJson(res, 400, { ok: false, error: 'Sound ID is required' });
    }
    const result = triggerSoundpadAction(soundId);
    return sendJson(res, result.status || (result.ok ? 200 : 400), result);
  }

  if (url.pathname === '/streamdeck/stop-all' || url.pathname === '/api/stop-all') {
    const result = panicStopAllAction();
    return sendJson(res, result.status || (result.ok ? 200 : 500), result);
  }

  // OBS Stream Overlay Routes (Browser Source 1920x1080)
  if (url.pathname === '/overlay' || url.pathname === '/overlay/') {
    const overlayPath = path.join(__dirname, 'overlay.html');
    if (fs.existsSync(overlayPath)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return fs.createReadStream(overlayPath).pipe(res);
    }
  }

  if (url.pathname === '/api/overlay/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write('retry: 3000\n\n');
    overlayClients.add(res);
    req.on('close', () => {
      overlayClients.delete(res);
    });
    return;
  }

  if (url.pathname === '/api/overlay/poll') {
    const since = Number(url.searchParams.get('since') || 0);
    const events = overlayEventsQueue.filter((e) => e.timestamp > since);
    return sendJson(res, 200, { ok: true, events, serverTime: Date.now() });
  }

  if (url.pathname === '/api/overlay/config') {
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req).catch(() => '{}')) || {};
      if (typeof body.channelPointsOnly === 'boolean') {
        config.overlayChannelPointsOnly = body.channelPointsOnly;
        saveConfig();
      }
      return sendJson(res, 200, { ok: true, channelPointsOnly: Boolean(config.overlayChannelPointsOnly) });
    }
    return sendJson(res, 200, { ok: true, channelPointsOnly: Boolean(config.overlayChannelPointsOnly) });
  }

  if (req.method === 'POST' && url.pathname === '/api/overlay/test') {
    const body = JSON.parse(await readBody(req).catch(() => '{}')) || {};
    const isChannel = body.type !== 'soundpad';
    const testEvent = {
      type: isChannel ? 'channel_point' : 'soundpad',
      id: `test_${Date.now()}`,
      soundId: 'test_alert',
      title: body.title || (isChannel ? 'Hydrate Streamer' : 'Airhorn Blast'),
      userName: body.userName || (isChannel ? 'KickViewer_42' : 'Streamer'),
      cost: isChannel ? (body.cost || 500) : null,
      timestamp: Date.now(),
    };
    broadcastOverlayEvent(testEvent);
    return sendJson(res, 200, { ok: true, event: testEvent });
  }

  // OBS Channel Point Goal Overlay Routes (Browser Source)
  if (url.pathname === '/goal' || url.pathname === '/goal.html') {
    const goalPath = path.join(__dirname, 'goal.html');
    if (fs.existsSync(goalPath)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return fs.createReadStream(goalPath).pipe(res);
    }
  }

  if (url.pathname === '/api/goal/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write('retry: 3000\n\n');
    goalClients.add(res);
    // Send initial state snapshot on connect
    res.write(`data: ${JSON.stringify({ type: 'init', goal: config.goal, timestamp: Date.now() })}\n\n`);
    req.on('close', () => {
      goalClients.delete(res);
    });
    return;
  }

  if (url.pathname === '/api/goal/poll') {
    const since = Number(url.searchParams.get('since') || 0);
    const events = goalEventsQueue.filter((e) => e.timestamp > since);
    return sendJson(res, 200, { ok: true, goal: config.goal, events, serverTime: Date.now() });
  }

  if (url.pathname === '/api/goal') {
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req).catch(() => '{}')) || {};
      const prevCurrent = config.goal.current || 0;
      if (typeof body.title === 'string') config.goal.title = body.title.trim() || 'Community Kick Goal';
      if (Number.isFinite(Number(body.target))) config.goal.target = Math.max(1, Number(body.target));
      if (Number.isFinite(Number(body.current))) config.goal.current = Math.max(0, Number(body.current));
      if (typeof body.autoAddRedemptions === 'boolean') config.goal.autoAddRedemptions = body.autoAddRedemptions;
      config.goal.lastUpdated = Date.now();
      saveConfig();
      const diff = (config.goal.current || 0) - prevCurrent;
      const evt = diff !== 0 ? {
        type: 'adjust',
        delta: diff,
        userName: 'Streamer',
        rewardTitle: diff < 0 ? 'Deduction' : 'Manual Add',
        goal: config.goal,
        timestamp: Date.now(),
      } : { type: 'update', goal: config.goal, timestamp: Date.now() };
      mainWindow?.webContents.send('goal-updated', config.goal, evt);
      broadcastGoalEvent(evt);
      return sendJson(res, 200, { ok: true, goal: config.goal });
    }
    return sendJson(res, 200, { ok: true, goal: config.goal });
  }

  if (req.method === 'POST' && url.pathname === '/api/goal/adjust') {
    const body = JSON.parse(await readBody(req).catch(() => '{}')) || {};
    const delta = Number(body.delta || 0);
    if (Number.isFinite(delta)) {
      config.goal.current = Math.max(0, (config.goal.current || 0) + delta);
      config.goal.lastUpdated = Date.now();
      saveConfig();
      const evt = {
        type: 'adjust',
        delta,
        userName: body.userName || 'Streamer',
        rewardTitle: delta < 0 ? 'Deduction' : 'Manual Add',
        goal: config.goal,
        timestamp: Date.now(),
      };
      mainWindow?.webContents.send('goal-updated', config.goal, evt);
      broadcastGoalEvent(evt);
    }
    return sendJson(res, 200, { ok: true, goal: config.goal });
  }

  if (req.method === 'POST' && url.pathname === '/api/goal/reset') {
    const prevPoints = config.goal.current || 0;
    config.goal.current = 0;
    config.goal.lastUpdated = Date.now();
    saveConfig();
    const evt = {
      type: 'reset',
      delta: -prevPoints,
      userName: 'Streamer',
      rewardTitle: 'Goal Reset',
      goal: config.goal,
      timestamp: Date.now(),
    };
    mainWindow?.webContents.send('goal-updated', config.goal, evt);
    broadcastGoalEvent(evt);
    return sendJson(res, 200, { ok: true, goal: config.goal });
  }

  if (req.method === 'POST' && url.pathname === '/api/goal/test') {
    const body = JSON.parse(await readBody(req).catch(() => '{}')) || {};
    const testDelta = Number(body.delta ?? 500);
    const isNegative = testDelta < 0;
    if (config.goal?.autoAddRedemptions) {
      config.goal.current = Math.max(0, (config.goal.current || 0) + testDelta);
      config.goal.lastUpdated = Date.now();
      saveConfig();
    }
    const evt = {
      type: isNegative ? 'adjust' : 'redemption',
      userName: isNegative ? 'Streamer' : 'KickViewer_42',
      rewardTitle: isNegative ? 'Deduction' : 'Hydrate Streamer',
      pointsAdded: !isNegative ? testDelta : 0,
      delta: testDelta,
      goal: config.goal,
      timestamp: Date.now(),
    };
    mainWindow?.webContents.send('goal-updated', config.goal, evt);
    broadcastGoalEvent(evt);
    return sendJson(res, 200, { ok: true, goal: config.goal });
  }

  if (req.method === 'POST' && url.pathname === '/api/trigger') {
    try {
      const body = JSON.parse(await readBody(req));
      const soundId = body.rewardId || body.id;
      if (!soundId) {
        logger.logError('API Trigger Missing ID', new Error('Sound ID is missing in request body'));
        return sendJson(res, 400, { ok: false, error: 'Sound ID is required' });
      }
      const result = triggerSoundpadAction(soundId);
      return sendJson(res, result.status || (result.ok ? 200 : 400), result);
    } catch (err) {
      logger.logError('API Trigger JSON Parse Error', err);
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  }

  if (url.pathname.startsWith('/api/') && !requireAppRequest(req, res)) return;
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const state = publicState();
    state.connected = captureGuideScreenshots || Boolean(accessToken);
    return sendJson(res, 200, state);
  }
  if (req.method === 'POST' && url.pathname === '/api/log-error') {
    try {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return sendJson(res, 500, { ok: false, error: 'Malformed JSON payload' });
      }
      const err = new Error(body?.message || 'Renderer Error');
      err.stack = body?.stack;
      err.code = body?.code;
      const result = logger.logError(body?.context || 'Client', err, body?.metadata);
      return sendJson(res, 200, { ok: true, path: result?.path || logger.getLogPath() });
    } catch (err) {
      if (err.statusCode === 413 || err.message?.includes('too large')) {
        return sendJson(res, 500, { ok: false, error: 'Request body is too large.' });
      }
      return sendJson(res, 500, { ok: false, error: 'Invalid log request' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/logs') {
    let recentStr = '';
    try {
      if (typeof logger.getRecentLogs === 'function') {
        const r = logger.getRecentLogs();
        recentStr = typeof r === 'string' ? r : JSON.stringify(r);
      } else if (fs.existsSync(logger.getLogPath())) {
        recentStr = fs.readFileSync(logger.getLogPath(), 'utf8');
      }
    } catch {}
    return sendJson(res, 200, {
      ok: true,
      path: logger.getLogPath(),
      recent: recentStr,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/updates') {
    try {
      const response = await appFetch('https://api.github.com/repos/MehdiMeidanshahi/Kick-Soundboard/releases?per_page=100', {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Kick-Soundboard' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      const releases = await response.json();
      const release = latestStableRelease(releases);
      if (!release) throw new Error('No published app releases were found.');
      const currentVersion = app.getVersion();
      const isNewer = compareVersions(release.tag_name, currentVersion) > 0;
      return sendJson(res, 200, {
        currentVersion,
        latestVersion: String(release.tag_name).replace(/^v/i, ''),
        updateAvailable: isNewer,
        hasUpdate: isNewer,
      });
    } catch (error) {
      return sendJson(res, 502, { error: error.name === 'TimeoutError' ? 'GitHub update check timed out.' : error.message || 'GitHub update check failed.' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = JSON.parse(await readBody(req));
    if (typeof body.clientId === 'string') config.clientId = String(body.clientId || '').trim();
    if (typeof body.bridgeUrl === 'string') config.bridgeUrl = String(body.bridgeUrl || '').trim();
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
    config.streamerProfile = null;
    saveConfig();
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
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON payload.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { error: 'Invalid settings payload.' });
    }
    if ('volume' in body) {
      if (typeof body.volume !== 'number' || !Number.isFinite(body.volume)) {
        return sendJson(res, 400, { error: 'Invalid volume value.' });
      }
      config.volume = Math.min(1, Math.max(0, body.volume));
    }
    if (typeof body.outputDeviceId === 'string') config.outputDeviceId = body.outputDeviceId;
    if (typeof body.audioDeviceId === 'string') config.outputDeviceId = body.audioDeviceId;
    if (typeof body.streamerMode === 'boolean') config.streamerMode = body.streamerMode;
    if (typeof body.playPending === 'boolean') config.playPending = body.playPending;
    if (typeof body.proxyMode === 'string') {
      const validModes = new Set(['direct', 'system', 'custom']);
      if (!validModes.has(body.proxyMode)) {
        return sendJson(res, 400, { error: 'Invalid proxyMode value. Must be direct, system, or custom.' });
      }
      config.proxyMode = body.proxyMode;
    }
    if (typeof body.proxyRules === 'string') {
      config.proxyRules = body.proxyRules.trim();
    }

    if (body.rewardVolumes && typeof body.rewardVolumes === 'object') {
      config.rewardVolumes = { ...config.rewardVolumes, ...body.rewardVolumes };
    }
    if (body.rewardCooldowns && typeof body.rewardCooldowns === 'object') {
      config.cooldowns = { ...config.cooldowns, ...body.rewardCooldowns };
    }
    if (body.cooldowns && typeof body.cooldowns === 'object') {
      config.cooldowns = { ...config.cooldowns, ...body.cooldowns };
    }

    if (body.rewardId) {
      config.sounds ||= {}; config.cooldowns ||= {}; config.rewardVolumes ||= {};
      if ('cooldown' in body) {
        if (typeof body.cooldown !== 'number' || !Number.isFinite(body.cooldown)) {
          return sendJson(res, 400, { error: 'Invalid cooldown value.' });
        }
        config.cooldowns[body.rewardId] = Math.round(Math.min(3600, Math.max(0, body.cooldown)));
      }
      if ('rewardVolume' in body) {
        if (typeof body.rewardVolume !== 'number' || !Number.isFinite(body.rewardVolume)) {
          return sendJson(res, 400, { error: 'Invalid reward volume value.' });
        }
        config.rewardVolumes[body.rewardId] = Math.min(1, Math.max(0, body.rewardVolume));
      }
      if (typeof body.soundPath === 'string') {
        const selectedPath = path.resolve(body.soundPath);
        const allowedExtensions = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
        if (!allowedExtensions.has(path.extname(selectedPath).toLowerCase()) || !fs.existsSync(selectedPath) || !fs.statSync(selectedPath).isFile()) {
          return sendJson(res, 400, { error: 'Choose a supported audio file.' });
        }
        config.sounds[body.rewardId] = {
          path: selectedPath,
          name: path.basename(selectedPath),
          title: body.title || config.sounds[body.rewardId]?.title || path.basename(selectedPath),
        };
      }
      if (typeof body.title === 'string' && config.sounds[body.rewardId]) {
        // Strictly update in-app display title; NEVER rename or mutate the original audio file on disk!
        config.sounds[body.rewardId].title = body.title.trim() || config.sounds[body.rewardId].name;
      }
      if (body.clearSound) delete config.sounds[body.rewardId];
    }
    if (body.sounds && typeof body.sounds === 'object' && !Array.isArray(body.sounds)) {
      const allowedExtensions = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
      for (const [rid, soundObj] of Object.entries(body.sounds)) {
        if (!soundObj) continue;
        if (typeof soundObj.path === 'string') {
          const validPath = path.resolve(soundObj.path);
          if (!allowedExtensions.has(path.extname(validPath).toLowerCase()) || !fs.existsSync(validPath) || !fs.statSync(validPath).isFile()) {
            return sendJson(res, 400, { error: 'Choose a supported audio file.' });
          }
        }
      }
      const newSounds = {};
      for (const [rid, soundObj] of Object.entries(body.sounds)) {
        if (!soundObj || !soundObj.path) continue;
        const validPath = path.resolve(soundObj.path);
        newSounds[rid] = {
          path: validPath,
          name: path.basename(validPath),
          title: soundObj.title || config.sounds?.[rid]?.title || path.basename(validPath),
        };
      }
      config.sounds = newSounds;
    }
    if (body.keybinds && typeof body.keybinds === 'object') {
      config.keybinds = config.keybinds || {};
      for (const [kId, kAcc] of Object.entries(body.keybinds)) {
        if (kAcc) {
          if (/^escape$/i.test(String(kAcc).trim()) || /^esc$/i.test(String(kAcc).trim())) {
            continue; // Escape cannot be bound as hotkey
          }
          // Conflict Prevention: unbind matching accelerator from any other sound
          for (const [otherId, otherAcc] of Object.entries(config.keybinds)) {
            if (otherId !== kId && otherAcc && areAcceleratorsEqual(otherAcc, kAcc)) {
              delete config.keybinds[otherId];
            }
          }
          config.keybinds[kId] = kAcc;
        } else {
          delete config.keybinds[kId];
        }
      }
      registerGlobalKeybinds();
    }
    saveConfig();
    await applyAppProxy().catch((err) => {
      logger.logError('Apply Proxy Error', err);
    });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/proxy/system') {
    const detected = proxyManager.detectSystemProxy();
    return sendJson(res, 200, { ok: true, data: detected });
  }
  if (req.method === 'POST' && url.pathname === '/api/proxy/test') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const testMode = body.proxyMode || 'direct';
    const testRules = proxyManager.normalizeProxyRules(body.proxyRules || '');
    const startTime = Date.now();
    try {
      if (session?.defaultSession) {
        await proxyManager.applyProxyToSession(session.defaultSession, { mode: testMode, rules: testRules });
      }
      const testResp = await appFetch('https://api.kick.com/public/v1/users?usernames[]=kick', {
        method: 'GET',
        headers: { 'user-agent': 'Kick-Soundboard' },
        signal: AbortSignal.timeout(6000),
      }).catch(async () => {
        return appFetch('https://api.kick.com', {
          method: 'GET',
          headers: { 'user-agent': 'Kick-Soundboard' },
          signal: AbortSignal.timeout(6000),
        });
      });
      const latencyMs = Date.now() - startTime;
      await applyAppProxy().catch(() => {});
      return sendJson(res, 200, {
        ok: true,
        latencyMs,
        status: testResp.status,
        message: `Connection successful (${latencyMs}ms)`,
      });
    } catch (err) {
      await applyAppProxy().catch(() => {});
      const formattedError = proxyManager.formatNetworkError(err, testMode);
      return sendJson(res, 200, {
        ok: false,
        error: formattedError,
        rawError: err.message,
      });
    }
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

  // Static Assets Handler (HTML, CSS, JS modules, icons)
  if (req.method === 'GET') {
    let relativePath = decodeURIComponent(url.pathname);
    if (relativePath === '/' || relativePath === '') relativePath = '/index.html';

    // Normalize path and prevent directory traversal
    const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
    const cleanRelative = safePath.replace(/^[\\\/]+/, '');

    // 1. Try resolving in __dirname (src directory)
    let targetFilePath = path.join(__dirname, cleanRelative);

    // 2. Fallback to build directory for icons
    if (!fs.existsSync(targetFilePath) || !fs.statSync(targetFilePath).isFile()) {
      const buildCandidate = path.join(__dirname, '..', 'build', cleanRelative);
      if (fs.existsSync(buildCandidate) && fs.statSync(buildCandidate).isFile()) {
        targetFilePath = buildCandidate;
      }
    }

    if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).isFile()) {
      const ext = path.extname(targetFilePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml; charset=utf-8',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-store' : 'public, max-age=86400',
      });
      return fs.createReadStream(targetFilePath).pipe(res);
    }
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
    icon: appIcon || appIconPath,
    backgroundColor: '#0d1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== allowedOrigin) event.preventDefault();
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.show();
  mainWindow.focus();
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
        app.quit();
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
ipcMain.handle('open-soundpad-window', (event) => {
  assertTrustedFrame(event);
  openSoundpadWindow();
  return { ok: true };
});
ipcMain.handle('save-keybind', (event, { id, accelerator }) => {
  assertTrustedFrame(event);
  config.keybinds = config.keybinds || {};
  if (accelerator) {
    if (/^escape$/i.test(String(accelerator).trim()) || /^esc$/i.test(String(accelerator).trim())) {
      return { ok: false, error: 'Escape key is reserved for Panic Stop and cannot be assigned as a hotkey.' };
    }
    // Conflict Prevention: unbind matching accelerator from any other sound
    for (const [otherId, otherAcc] of Object.entries(config.keybinds)) {
      if (otherId !== id && otherAcc && areAcceleratorsEqual(otherAcc, accelerator)) {
        delete config.keybinds[otherId];
      }
    }
    config.keybinds[id] = accelerator;
  } else {
    delete config.keybinds[id];
  }
  saveConfig();
  registerGlobalKeybinds();
  return { ok: true, keybinds: config.keybinds };
});
ipcMain.handle('get-keybinds', (event) => {
  assertTrustedFrame(event);
  return config.keybinds || {};
});
ipcMain.handle('open-url', (event, targetUrl) => {
  assertTrustedFrame(event);
  if (typeof targetUrl === 'string' && (targetUrl.startsWith('http://localhost:9000') || targetUrl.startsWith('http://127.0.0.1:9000') || targetUrl.startsWith('https://'))) {
    return shell.openExternal(targetUrl);
  }
});
ipcMain.handle('log-error', (event, { context, message, stack, code, metadata }) => {
  assertTrustedFrame(event);
  const err = new Error(message || 'Renderer Error');
  err.stack = stack;
  err.code = code;
  return logger.logError(context, err, metadata);
});
ipcMain.handle('get-log-path', (event) => {
  assertTrustedFrame(event);
  return logger.getLogPath();
});
ipcMain.handle('open-logs-folder', (event) => {
  assertTrustedFrame(event);
  return shell.openPath(logger.getLogDirectory());
});
ipcMain.handle('get-recent-logs', (event) => {
  assertTrustedFrame(event);
  return logger.readRecentLogs(100);
});
ipcMain.handle('notify-overlay-trigger', (event, eventData) => {
  assertTrustedFrame(event);
  if (eventData) broadcastOverlayEvent(eventData);
  return { ok: true };
});
ipcMain.handle('get-overlay-config', (event) => {
  assertTrustedFrame(event);
  return { channelPointsOnly: Boolean(config.overlayChannelPointsOnly) };
});
ipcMain.handle('save-overlay-config', (event, data) => {
  assertTrustedFrame(event);
  if (data && typeof data.channelPointsOnly === 'boolean') {
    config.overlayChannelPointsOnly = data.channelPointsOnly;
    saveConfig();
  }
  return { ok: true, channelPointsOnly: Boolean(config.overlayChannelPointsOnly) };
});

const gotSingleInstanceLock = app.requestSingleInstanceLock ? app.requestSingleInstanceLock() : true;
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLinkUrl = extractDeepLinkUrl(commandLine);
    const isTriggerLink = deepLinkUrl && (deepLinkUrl.includes('/trigger/') || deepLinkUrl.includes('/stop-all'));
    if (deepLinkUrl) handleDeepLink(deepLinkUrl);
    if (mainWindow && !isTriggerLink) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    const clean = extractDeepLinkUrl([url]);
    if (clean) handleDeepLink(clean);
  });

  app.whenReady().then(() => {
    try { app.setAppUserModelId('com.localvc.kicksoundboard'); } catch {}
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('kick-soundboard', process.execPath, [path.resolve(process.argv[1])]);
      }
    } else {
      app.setAsDefaultProtocolClient('kick-soundboard');
    }

    const startupDeepLink = extractDeepLinkUrl(process.argv);
    if (startupDeepLink) {
      handleDeepLink(startupDeepLink);
    }

    if (captureGuideScreenshots) {
      app.setPath('userData', path.join(app.getPath('temp'), 'kick-soundboard-screenshot-profile'));
    } else {
      loadLocalState();
      registerGlobalKeybinds();
    }
    server = http.createServer((req, res) => {
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('cross-origin-resource-policy', 'same-origin');
      res.setHeader('cache-control', 'no-store');
      handleRequest(req, res).catch((error) => {
        logger.logError('HTTP Server Unhandled Error', error, { url: req.url, method: req.method });
        if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.message || 'The local request failed.' });
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

  app.on('before-quit', () => {
    stopPolling();
    if (globalShortcut && typeof globalShortcut.unregisterAll === 'function') {
      try { globalShortcut.unregisterAll(); } catch {}
    }
    server?.close();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

module.exports = {
  handleRequest,
  requireAppRequest,
  assertTrustedFrame,
  publicState,
  readBody,
  sendJson,
  getApiSessionToken: () => apiSessionToken,
  getAllowedOrigin: () => allowedOrigin,
  getConfig: () => config,
  setConfig: (c) => { config = c; },
  setMainWindow: (win) => { mainWindow = win; },
  setAuthTokens: ({ access = '', refresh = '', expiresAt = 0 } = {}) => {
    accessToken = access;
    refreshToken = refresh;
    tokenExpiresAt = expiresAt;
  },
  getAuthTokens: () => ({ accessToken, refreshToken, tokenExpiresAt }),
  setLastPollSuccessAt: (v) => { lastPollSuccessAt = v; },
  setNextPollAt: (v) => { nextPollAt = v; },
  setConsecutivePollFailures: (v) => { consecutivePollFailures = v; },
  setPolling: (v) => { polling = v; },
  setLatestUpdateAvailable: (v) => { latestUpdateAvailable = v; },
  setCachedRewards: (v) => { cachedRewards = v; },
  triggerSoundpadAction,
  panicStopAllAction,
  openSoundpadWindow,
  appFetch,
  applyAppProxy,
};
