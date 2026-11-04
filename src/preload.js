const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kickApp', {
  getApiSessionToken: () => ipcRenderer.invoke('get-api-session-token'),
  chooseAudio: () => ipcRenderer.invoke('choose-audio'),
  openReleases: () => ipcRenderer.invoke('open-releases'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  openSoundpadWindow: () => ipcRenderer.invoke('open-soundpad-window'),
  saveKeybind: (id, accelerator) => ipcRenderer.invoke('save-keybind', { id, accelerator }),
  getKeybinds: () => ipcRenderer.invoke('get-keybinds'),
  logError: (details) => ipcRenderer.invoke('log-error', details),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  getRecentLogs: () => ipcRenderer.invoke('get-recent-logs'),
  notifyOverlayTrigger: (event) => ipcRenderer.invoke('notify-overlay-trigger', event),
  getOverlayConfig: () => ipcRenderer.invoke('get-overlay-config'),
  saveOverlayConfig: (config) => ipcRenderer.invoke('save-overlay-config', config),
  onPlaySound: (callback) => ipcRenderer.on('play-sound', (_event, payload) => callback(payload)),
  onStateChanged: (callback) => ipcRenderer.on('state-changed', callback),
  onPollError: (callback) => ipcRenderer.on('poll-error', (_event, message) => callback(message)),
  onTriggerSoundpad: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('trigger-soundpad', listener);
    return () => ipcRenderer.removeListener('trigger-soundpad', listener);
  },
  onPanicStopAll: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('panic-stop-all', listener);
    return () => ipcRenderer.removeListener('panic-stop-all', listener);
  },
  onGoalUpdated: (callback) => {
    const listener = (_event, goal) => callback(goal);
    ipcRenderer.on('goal-updated', listener);
    return () => ipcRenderer.removeListener('goal-updated', listener);
  },
});
