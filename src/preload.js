const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kickApp', {
  getApiSessionToken: () => ipcRenderer.invoke('get-api-session-token'),
  chooseAudio: () => ipcRenderer.invoke('choose-audio'),
  onPlaySound: (callback) => ipcRenderer.on('play-sound', (_event, payload) => callback(payload)),
  onStateChanged: (callback) => ipcRenderer.on('state-changed', callback),
  onPollError: (callback) => ipcRenderer.on('poll-error', (_event, message) => callback(message)),
});
