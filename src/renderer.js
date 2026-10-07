const $ = (selector) => document.querySelector(selector);
const modal = $('#settings-modal');
const rewardRoot = $('#rewards');
const historyRoot = $('#history');
const toastRoot = $('#toast');
const translations = {
  en: {
    appName:'Kick Soundboard', tagline:'Local reward sounds for your stream', settings:'Settings', connect:'Connect Kick', connected:'Connected', polling:'Connected · checking every 10 sec', notConnected:'Not connected',
    setupTitle:'Connect your Kick channel', setupDescription:'Enter your developer app credentials in Settings, then connect Kick. The app checks for reward redemptions and plays mapped sounds on this PC.', openSettings:'Open Settings', localNotice:'Your credentials and sound mappings are stored locally on this computer.',
    rewardSounds:'Reward sounds', refreshRewards:'Refresh rewards', masterVolume:'Master volume', stopAudio:'Stop audio', redemptionHistory:'Redemption history', clear:'Clear', soundQueue:'Sound queue', waiting:'waiting', queuedTotal:'queued',
    connectEmpty:'Connect your Kick account to load your channel rewards.', noRewards:'No rewards found. Create channel point rewards on Kick, then refresh.', emptyHistory:'New reward redemptions will appear here.',
    connectionSettings:'Kick connection settings', clientId:'Client ID', clientIdHelp:'From your Kick Developer app settings.', clientSecret:'Client Secret', secretPlaceholder:'Saved securely on this PC', clientSecretHelp:'Only stored on this PC using Windows secure storage. Never share it.', redirectUrl:'Redirect URL', redirectHelp:'This must match your Kick Developer app redirect URL.', cancel:'Cancel', saveLocally:'Save locally', disconnectKick:'Disconnect Kick', disconnectedKick:'Kick disconnected on this PC. Revoke app access in Kick settings too, if desired.', appVersion:'Version {version}', checkUpdates:'Check for updates', checkingUpdates:'Checking GitHub for updates…', updateAvailable:'Version {version} is available.', upToDate:'You have the latest version ({version}).', updateError:'Could not check for updates: {message}', downloadUpdate:'Open download page',
    points:'points', noSound:'No sound selected', chooseSound:'Choose sound', change:'Change', test:'Test', removeSound:'Remove sound', cooldown:'Cooldown · sec', cooldownTitle:'Cooldown in seconds',
    pending:'Pending approval', accepted:'Approved', rejected:'Rejected', redeemed:'Redeemed', redeemedVerb:'redeemed', unknownViewer:'Unknown viewer', viewerId:'Viewer #{id}', untitledReward:'Untitled reward', channelReward:'Channel reward',
    statusGuideTitle:'Redemption status guide', pendingGuide:'Waiting for your decision in Kick’s Reward request queue. Its sound may play while pending.', acceptedGuide:'You approved this redemption.', rejectedGuide:'You rejected this redemption. It is skipped if already rejected when detected; a sound played while pending cannot be undone.',
    enabled:'Enabled', paused:'Paused', disabled:'Disabled', perRewardVolume:'Sound volume',
    audioOnlyApp:'Audio file selection is available in the Windows app.', chooseFirst:'Choose a sound for this reward first.', addedSound:'Sound added to {name}.',
    rewardsRefreshed:'Rewards refreshed.', savedCredentials:'Credentials saved securely on this PC.', openedKick:'Kick opened in your browser. Approve the requested access, then return here.',
    authFailed:'Kick connection failed', authStateFailed:'Authorization state did not match. Return to the app and try again.',
    settingsMissing:'Add your Kick Client ID and Client Secret first.', secureStoreUnavailable:'Windows secure storage is unavailable; credentials were not saved.',
    kickCheckFailed:'Kick check failed: {message}', clearHistory:'Clear redemption history?'
  },
  fa: {
    appName:'صندوق صدای کیک', tagline:'پخش صدای محلی برای پاداش‌های استریم', settings:'تنظیمات', connect:'اتصال به کیک', connected:'متصل', polling:'متصل · بررسی هر ۱۰ ثانیه', notConnected:'متصل نیست',
    setupTitle:'کانال کیک خود را وصل کنید', setupDescription:'اطلاعات برنامهٔ توسعه‌دهنده را در تنظیمات وارد کنید و به کیک وصل شوید. برنامه بازخرید پاداش‌ها را بررسی می‌کند و صدای انتخاب‌شده را در همین رایانه پخش می‌کند.', openSettings:'باز کردن تنظیمات', localNotice:'اطلاعات ورود و نگاشت صداها فقط روی همین رایانه ذخیره می‌شوند.',
    rewardSounds:'صداهای پاداش', refreshRewards:'به‌روزرسانی پاداش‌ها', masterVolume:'بلندی صدای اصلی', stopAudio:'توقف صدا', redemptionHistory:'تاریخچهٔ بازخریدها', clear:'پاک کردن', soundQueue:'صف پخش صدا', waiting:'در انتظار', queuedTotal:'در صف',
    connectEmpty:'برای دریافت پاداش‌های کانال، حساب کیک را وصل کنید.', noRewards:'پاداشی پیدا نشد. در کیک پاداش بسازید و دوباره به‌روزرسانی کنید.', emptyHistory:'بازخریدهای جدید اینجا نمایش داده می‌شوند.',
    connectionSettings:'تنظیمات اتصال کیک', clientId:'شناسهٔ کلاینت', clientIdHelp:'از تنظیمات برنامهٔ توسعه‌دهندهٔ کیک بردارید.', clientSecret:'رمز کلاینت', secretPlaceholder:'به‌صورت امن روی این رایانه ذخیره می‌شود', clientSecretHelp:'فقط با حافظهٔ امن ویندوز روی این رایانه ذخیره می‌شود. آن را برای کسی نفرستید.', redirectUrl:'نشانی بازگشت', redirectHelp:'این نشانی باید با نشانی بازگشت برنامهٔ کیک یکسان باشد.', cancel:'لغو', saveLocally:'ذخیره روی رایانه', disconnectKick:'قطع اتصال کیک', disconnectedKick:'اتصال این برنامه به کیک قطع شد. در صورت تمایل، دسترسی برنامه را از تنظیمات کیک هم لغو کنید.', appVersion:'نسخهٔ {version}', checkUpdates:'بررسی نسخهٔ جدید', checkingUpdates:'در حال بررسی نسخه‌های GitHub…', updateAvailable:'نسخهٔ {version} در دسترس است.', upToDate:'آخرین نسخه را دارید ({version}).', updateError:'بررسی نسخهٔ جدید انجام نشد: {message}', downloadUpdate:'رفتن به صفحهٔ دانلود',
    points:'امتیاز', noSound:'صدایی انتخاب نشده', chooseSound:'انتخاب صدا', change:'تغییر', test:'آزمایش', removeSound:'حذف صدا', cooldown:'وقفه · ثانیه', cooldownTitle:'مدت وقفه به ثانیه',
    pending:'در انتظار تأیید', accepted:'تأیید شد', rejected:'رد شد', redeemed:'بازخرید شد', redeemedVerb:'پاداش', unknownViewer:'بینندهٔ ناشناس', viewerId:'بینندهٔ شمارهٔ {id}', untitledReward:'پاداش بدون نام', channelReward:'پاداش کانال',
    statusGuideTitle:'راهنمای وضعیت بازخرید', pendingGuide:'منتظر تصمیم شما در Reward request queue کیک است. ممکن است صدا در همین وضعیت پخش شود.', acceptedGuide:'این بازخرید را تأیید کرده‌اید.', rejectedGuide:'این بازخرید را رد کرده‌اید. اگر پیش از شناسایی برنامه رد شده باشد، صدا پخش نمی‌شود؛ صدایی که در حالت انتظار پخش شده، قابل بازگرداندن نیست.',
    enabled:'فعال', paused:'مکث‌شده', disabled:'غیرفعال', perRewardVolume:'بلندی صدای این پاداش',
    audioOnlyApp:'انتخاب فایل صدا در برنامهٔ ویندوز انجام می‌شود.', chooseFirst:'ابتدا برای این پاداش یک صدا انتخاب کنید.', addedSound:'صدا برای «{name}» تنظیم شد.',
    rewardsRefreshed:'پاداش‌ها به‌روز شدند.', savedCredentials:'اطلاعات ورود به‌شکل امن روی همین رایانه ذخیره شد.', openedKick:'کیک در مرورگر باز شد. دسترسی درخواستی را تأیید کنید و به برنامه برگردید.',
    authFailed:'اتصال به کیک ناموفق بود', authStateFailed:'تأیید مجوز نامعتبر بود. به برنامه برگردید و دوباره تلاش کنید.',
    settingsMissing:'ابتدا شناسه و رمز کلاینت کیک را وارد کنید.', secureStoreUnavailable:'حافظهٔ امن ویندوز در دسترس نیست؛ اطلاعات ذخیره نشد.',
    kickCheckFailed:'بررسی کیک ناموفق بود: {message}', clearHistory:'پاک کردن تاریخچهٔ بازخریدها؟'
  }
};
let language = localStorage.getItem('kick-soundboard-language') === 'fa' ? 'fa' : 'en';
let state = { connected: false, configured: false, sounds: {}, cooldowns: {}, rewardVolumes: {}, history: [], volume: 0.8 };
let rewards = [];
let queue = [];
const queuedRedemptionIds = new Set();
let activeAudio = null;
let activeRewardId = '';
let activeObjectUrl = '';
let playbackBusy = false;
let queueTimer = null;
const lastPlaybackStart = new Map();
let toastTimeout;

function t(key, values = {}) {
  let result = translations[language][key] || translations.en[key] || key;
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, String(value));
  return result;
}
function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
  document.title = t('appName');
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $('#lang-toggle').textContent = language === 'fa' ? 'English' : 'فارسی';
  $('#lang-toggle').setAttribute('aria-label', language === 'fa' ? 'Change language to English' : 'تغییر زبان به فارسی');
  $('#connect-btn').textContent = state.connected ? t('connected') : t('connect');
  $('#status-label').textContent = state.connected ? t('polling') : t('notConnected');
  renderRewards(); renderHistory(); updateQueue();
}

async function request(path, options = {}) {
  const sessionToken = await window.kickApp?.getApiSessionToken();
  if (!sessionToken) throw new Error('The secure app session is unavailable. Restart the app and try again.');
  const response = await fetch(`http://localhost:9000${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-kick-app-session': sessionToken, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}

function toast(message, isError = false) {
  toastRoot.textContent = message;
  toastRoot.classList.toggle('error', isError);
  toastRoot.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastRoot.classList.remove('show'), 3000);
}

function setConnected(connected) {
  state.connected = connected;
  $('#status-dot').classList.toggle('live', connected);
  $('#status-label').textContent = connected ? t('polling') : t('notConnected');
  $('#connect-btn').textContent = connected ? t('connected') : t('connect');
  $('#connect-btn').disabled = connected;
  $('#setup-banner').classList.toggle('show', !state.configured);
}

function safeText(value) { return String(value ?? ''); }
function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(language === 'fa' ? 'fa-IR' : 'en', { numeric: 'auto' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.floor(hours / 24), 'day');
}

function renderRewards() {
  if (!state.connected) {
    rewardRoot.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = t('connectEmpty'); rewardRoot.append(empty);
    return;
  }
  if (!rewards.length) {
    rewardRoot.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = t('noRewards'); rewardRoot.append(empty);
    return;
  }
  rewardRoot.replaceChildren(...rewards.map((reward) => {
    const row = document.createElement('div');
    row.className = 'sound-row';
    const title = document.createElement('div');
    const titleText = document.createElement('div'); titleText.className = 'reward-title'; titleText.textContent = reward.title || t('untitledReward');
    const subtitle = document.createElement('div'); subtitle.className = 'reward-sub'; subtitle.textContent = `${Number(reward.cost || 0).toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} ${t('points')}`;
    const statusKind = reward.is_enabled === false ? 'disabled' : reward.is_paused === true ? 'paused' : 'enabled';
    const status = document.createElement('span'); status.className = `reward-status ${statusKind}`;
    const statusDot = document.createElement('span'); statusDot.className = 'reward-status-dot';
    const statusText = document.createElement('span'); statusText.textContent = t(statusKind);
    status.title = t(statusKind); status.setAttribute('aria-label', t(statusKind)); status.append(statusDot, statusText);
    const details = document.createElement('div'); details.className = 'reward-details'; details.append(subtitle, status);
    title.append(titleText, details);
    const sound = document.createElement('div'); sound.className = 'sound-name';
    sound.textContent = state.sounds?.[reward.id]?.name || t('noSound');
    sound.title = sound.textContent;
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const choose = document.createElement('button'); choose.className = 'small'; choose.textContent = state.sounds?.[reward.id] ? t('change') : t('chooseSound');
    choose.addEventListener('click', () => chooseSound(reward));
    actions.append(choose);
    if (state.sounds?.[reward.id]) {
      const play = document.createElement('button'); play.className = 'small'; play.textContent = t('test'); play.title = language === 'fa' ? 'پخش آزمایشی' : 'Play a preview';
      play.addEventListener('click', () => enqueueSound(reward.id));
      const clear = document.createElement('button'); clear.className = 'small ghost'; clear.textContent = '×'; clear.title = t('removeSound');
      clear.addEventListener('click', () => clearSound(reward.id));
      actions.append(play, clear);
    }
    const controls = document.createElement('div'); controls.className = 'reward-controls';
    const volumeControl = document.createElement('div'); volumeControl.className = 'reward-volume-control';
    const volumeLabel = document.createElement('label'); volumeLabel.className = 'cool-label'; volumeLabel.textContent = t('perRewardVolume');
    const soundVolume = document.createElement('input'); soundVolume.type = 'range'; soundVolume.min = '0'; soundVolume.max = '100'; soundVolume.value = Math.round((state.rewardVolumes?.[reward.id] ?? 1) * 100);
    soundVolume.setAttribute('aria-label', `${t('perRewardVolume')}: ${reward.title}`);
    const soundVolumeValue = document.createElement('span'); soundVolumeValue.className = 'volume-value'; soundVolumeValue.textContent = `${soundVolume.value}%`;
    soundVolume.addEventListener('input', () => {
      const value = Number(soundVolume.value) / 100;
      state.rewardVolumes ||= {}; state.rewardVolumes[reward.id] = value; soundVolumeValue.textContent = `${soundVolume.value}%`;
      if (activeRewardId === reward.id && activeAudio) activeAudio.volume = effectiveVolume(reward.id);
    });
    soundVolume.addEventListener('change', () => saveRewardSettings(reward.id, { rewardVolume: Number(soundVolume.value) / 100 }));
    volumeControl.append(volumeLabel, soundVolume, soundVolumeValue);
    const cooldownControl = document.createElement('div'); cooldownControl.className = 'cooldown-control';
    const cooldown = document.createElement('input'); cooldown.type = 'number'; cooldown.min = '0'; cooldown.max = '3600'; cooldown.step = '1';
    cooldown.className = 'cooldown'; cooldown.title = t('cooldownTitle'); cooldown.value = state.cooldowns?.[reward.id] || 0;
    cooldown.setAttribute('aria-label', language === 'fa' ? `مدت وقفه برای ${reward.title}` : `Cooldown seconds for ${reward.title}`);
    cooldown.addEventListener('change', () => saveRewardSettings(reward.id, { cooldown: cooldown.value }));
    const cooldownLabel = document.createElement('label'); cooldownLabel.className = 'cool-label'; cooldownLabel.textContent = t('cooldown'); cooldownControl.append(cooldown, cooldownLabel);
    controls.append(volumeControl, cooldownControl);
    row.append(title, sound, actions, controls);
    return row;
  }));
}

function renderHistory() {
  const items = state.history || [];
  if (!items.length) {
    historyRoot.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = t('emptyHistory'); historyRoot.append(empty);
    return;
  }
  historyRoot.replaceChildren(...items.slice(0, 100).map((item) => {
    const row = document.createElement('div'); row.className = 'event';
    const info = document.createElement('div'); info.className = 'event-info';
    const oldName = item.user && item.user !== 'Viewer' ? item.user : '';
    const redeemerName = item.userName || item.username || oldName || (item.redeemerUserId ? t('viewerId', { id: item.redeemerUserId }) : t('unknownViewer'));
    const user = document.createElement('div'); user.className = 'event-user';
    const userBdi = document.createElement('bdi'); userBdi.dir = 'auto'; userBdi.textContent = redeemerName; user.append(userBdi);
    const action = document.createElement('div'); action.className = 'event-action';
    const rewardBdi = document.createElement('bdi'); rewardBdi.dir = 'auto'; rewardBdi.textContent = item.rewardTitle || t('channelReward');
    if (language === 'fa') action.append(document.createTextNode(`${t('redeemedVerb')} «`), rewardBdi, document.createTextNode('» را بازخرید کرد'));
    else action.append(document.createTextNode(`${t('redeemedVerb')} `), rewardBdi);
    const meta = document.createElement('div'); meta.className = 'event-meta';
    const date = document.createElement('span'); date.textContent = formatTime(item.redeemedAt);
    const relative = document.createElement('span'); relative.className = 'relative-time'; relative.textContent = relativeTime(item.redeemedAt);
    meta.append(date, relative);
    info.append(action, user, meta);
    const tag = document.createElement('span'); tag.className = `tag ${item.status || ''}`; tag.textContent = t(item.status || 'redeemed');
    row.append(info, tag);
    if (item.userInput) { const text = document.createElement('div'); text.className = 'event-text'; const inputBdi = document.createElement('bdi'); inputBdi.dir = 'auto'; inputBdi.textContent = item.userInput; text.append(inputBdi); row.append(text); }
    return row;
  }));
}

function updateQueue() {
  const locale = language === 'fa' ? 'fa-IR' : 'en-US';
  const total = queue.length + (playbackBusy ? 1 : 0);
  $('#queue-count').textContent = `${total.toLocaleString(locale)} ${t('queuedTotal')} · ${queue.length.toLocaleString(locale)} ${t('waiting')}`;
}
function effectiveVolume(rewardId) {
  return (state.volume ?? 0.8) * (state.rewardVolumes?.[rewardId] ?? 1);
}
function enqueueSound(rewardId) {
  if (!state.sounds?.[rewardId]) return toast(t('chooseFirst'), true);
  queue.push({ rewardId, cooldownMs: Math.max(0, Number(state.cooldowns?.[rewardId] || 0) * 1000) }); updateQueue();
  if (!playbackBusy) playNext();
}
function enqueueRedemptionSound({ rewardId, redemptionId, cooldownMs }) {
  if (!rewardId || (redemptionId && queuedRedemptionIds.has(redemptionId))) return;
  if (!state.sounds?.[rewardId]) return toast(t('chooseFirst'), true);
  if (redemptionId) queuedRedemptionIds.add(redemptionId);
  queue.push({ rewardId, redemptionId, cooldownMs: Math.max(0, Number(cooldownMs) || 0) }); updateQueue();
  if (!playbackBusy) playNext();
}
function playNext() {
  if (playbackBusy) return;
  const item = queue.shift(); updateQueue();
  if (!item) return;
  const { rewardId, cooldownMs } = item;
  playbackBusy = true;
  updateQueue();
  const waitMs = Math.max(0, (lastPlaybackStart.get(rewardId) || 0) + cooldownMs - Date.now());
  if (waitMs > 0) {
    queueTimer = setTimeout(() => { queueTimer = null; startQueuedAudio(rewardId); }, waitMs);
    return;
  }
  startQueuedAudio(rewardId);
}
function startQueuedAudio(rewardId) {
  const audio = new Audio();
  audio.loop = false;
  activeRewardId = rewardId;
  audio.volume = effectiveVolume(rewardId);
  activeAudio = audio;
  lastPlaybackStart.set(rewardId, Date.now());
  updateQueue();
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    if (activeAudio !== audio) return;
    activeAudio = null; activeRewardId = '';
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = '';
    playbackBusy = false;
    updateQueue();
    playNext();
  };
  const fail = (message) => { if (activeAudio === audio) toast(message, true); finish(); };
  audio.addEventListener('ended', finish, { once: true });
  audio.addEventListener('error', () => {
    const reason = audio.error?.code === 4 ? 'unsupported format or missing audio file' : 'audio could not be decoded or played';
    fail(`Could not play this reward sound (${reason}). Check the selected file and try Test.`);
  }, { once: true });
  (async () => {
    try {
      const sessionToken = await window.kickApp?.getApiSessionToken();
      if (!sessionToken) throw new Error(t('secureStoreUnavailable'));
      const response = await fetch(`http://localhost:9000/api/audio/${encodeURIComponent(rewardId)}`, {
        headers: { 'x-kick-app-session': sessionToken },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Audio request failed (${response.status})`);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      if (activeAudio !== audio) { URL.revokeObjectURL(objectUrl); return; }
      activeObjectUrl = objectUrl;
      audio.src = objectUrl;
      await audio.play();
    } catch (error) {
      fail(`Could not play this reward sound: ${error.message}`);
    }
  })();
}
function stopSounds() {
  queue = []; updateQueue();
  if (queueTimer) { clearTimeout(queueTimer); queueTimer = null; }
  playbackBusy = false;
  if (activeAudio) { activeAudio.pause(); activeAudio.currentTime = 0; activeAudio.src = ''; activeAudio = null; activeRewardId = ''; }
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = '';
  updateQueue();
}

async function chooseSound(reward) {
  try {
    if (!window.kickApp?.chooseAudio) return toast(t('audioOnlyApp'), true);
    const soundPath = await window.kickApp.chooseAudio();
    if (!soundPath) return;
    await request('/api/settings', { method: 'POST', body: JSON.stringify({ rewardId: reward.id, soundPath }) });
    await refreshState(); toast(t('addedSound', { name: reward.title }));
  } catch (error) { toast(error.message, true); }
}
async function clearSound(rewardId) {
  try { await request('/api/settings', { method: 'POST', body: JSON.stringify({ rewardId, clearSound: true }) }); await refreshState(); }
  catch (error) { toast(error.message, true); }
}
async function saveRewardSettings(rewardId, fields) {
  try { await request('/api/settings', { method: 'POST', body: JSON.stringify({ rewardId, ...fields }) }); await refreshState(); }
  catch (error) { toast(error.message, true); }
}
async function loadRewards() {
  const result = await request('/api/rewards');
  rewards = result.data || [];
  renderRewards();
}
async function refreshState() {
  const newState = await request('/api/state');
  state = { ...state, ...newState };
  setConnected(state.connected);
  $('#disconnect-btn').hidden = !state.connected;
  $('#client-id').value = state.clientId || '';
  $('#app-version').textContent = t('appVersion', { version: state.version || '—' });
  $('#volume').value = Math.round((state.volume ?? 0.8) * 100);
  $('#volume-label').textContent = `${$('#volume').value}%`;
  renderRewards(); renderHistory();
  if (state.connected && !rewards.length) {
    try { await loadRewards(); } catch (error) { toast(error.message, true); }
  }
}

function openSettings() { modal.classList.add('open'); $('#client-secret').value = ''; }
function closeSettings() { modal.classList.remove('open'); }
async function connectKick() {
  try {
    const result = await request('/api/connect', { method: 'POST', body: '{}' });
    if (result.ok) toast(t('openedKick'));
  } catch (error) { toast(error.message, true); if (error.message.includes('Client ID')) openSettings(); }
}

$('#lang-toggle').addEventListener('click', () => {
  language = language === 'en' ? 'fa' : 'en';
  localStorage.setItem('kick-soundboard-language', language);
  applyLanguage();
});
$('#settings-btn').addEventListener('click', openSettings);
$('#setup-settings').addEventListener('click', openSettings);
$('#close-settings').addEventListener('click', closeSettings);
$('#cancel-settings').addEventListener('click', closeSettings);
$('#connect-btn').addEventListener('click', connectKick);
$('#banner-connect').addEventListener('click', connectKick);
$('#disconnect-btn').addEventListener('click', async () => {
  try {
    await request('/api/disconnect', { method: 'POST', body: '{}' });
    await refreshState(); closeSettings(); toast(t('disconnectedKick'));
  } catch (error) { toast(error.message, true); }
});
$('#check-updates').addEventListener('click', async () => {
  const button = $('#check-updates');
  const status = $('#update-status');
  button.disabled = true;
  $('#download-update').hidden = true;
  status.textContent = t('checkingUpdates');
  try {
    const result = await request('/api/updates');
    status.textContent = result.updateAvailable
      ? t('updateAvailable', { version: result.latestVersion })
      : t('upToDate', { version: result.currentVersion });
    $('#download-update').hidden = !result.updateAvailable;
  } catch (error) {
    status.textContent = t('updateError', { message: error.message });
  } finally { button.disabled = false; }
});
$('#download-update').addEventListener('click', () => window.kickApp?.openReleases());
$('#refresh-btn').addEventListener('click', async () => { try { await loadRewards(); toast(t('rewardsRefreshed')); } catch (error) { toast(error.message, true); } });
$('#stop-btn').addEventListener('click', stopSounds);
$('#clear-history').addEventListener('click', async () => { try { await request('/api/history/clear', { method: 'POST', body: '{}' }); await refreshState(); } catch (error) { toast(error.message, true); } });
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('/api/config', { method: 'POST', body: JSON.stringify({ clientId: $('#client-id').value, clientSecret: $('#client-secret').value }) });
    $('#client-secret').value = ''; closeSettings(); await refreshState(); toast(t('savedCredentials'));
  } catch (error) { toast(error.message.includes('Client ID') ? t('settingsMissing') : error.message, true); if (error.message.includes('Client ID')) openSettings(); }
});
$('#volume').addEventListener('input', () => {
  $('#volume-label').textContent = `${$('#volume').value}%`;
  state.volume = Number($('#volume').value) / 100;
  if (activeAudio) activeAudio.volume = effectiveVolume(activeRewardId);
});
$('#volume').addEventListener('change', async () => {
  try { await request('/api/settings', { method: 'POST', body: JSON.stringify({ volume: Number($('#volume').value) / 100 }) }); }
  catch (error) { toast(error.message, true); }
});
window.kickApp?.onPlaySound(({ rewardId, redemptionId, masterVolume, rewardVolume, cooldownMs }) => {
  state.volume = masterVolume;
  state.rewardVolumes ||= {}; state.rewardVolumes[rewardId] = rewardVolume;
  enqueueRedemptionSound({ rewardId, redemptionId, cooldownMs });
});
window.kickApp?.onStateChanged(() => refreshState().catch((error) => toast(error.message, true)));
window.kickApp?.onPollError((message) => toast(t('kickCheckFailed', { message }), true));

applyLanguage();
setConnected(false);
refreshState().catch((error) => toast(error.message, true));
setInterval(renderHistory, 60_000);
