/**
 * Central Reactive Application State
 */

const state = {
  connected: false,
  streamerMode: false,
  volume: 0.8,
  playPending: false,
  audioDeviceId: '',
  rewardVolumes: {},
  rewardCooldowns: {},
  activeCooldowns: {},
  sounds: {},
  keybinds: {},
  activeKeybindModalTarget: null,
  history: [],
  queue: [],
  currentPlayingRewardId: null,
  activePreviewAudio: null,
  currentTab: 'studio',
  historyPage: 1,
  historyFilter: 'all',
  historySearch: '',
  rewardSearch: '',
  rewardFilterPill: 'all',
  unassignedOnly: false,
  soundpadSearch: '',
  analyticsTimeframe: '7d',
  rewards: [],
  goal: {
    title: 'Community Kick Goal',
    current: 0,
    target: 10000,
    autoAddRedemptions: true,
  },
  pollStatus: {
    lastChecked: null,
    nextCheck: null,
    consecutiveFailures: 0,
    polling: false,
  },
};

function getState() {
  return state;
}

function updateState(partial) {
  Object.assign(state, partial);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { state, getState, updateState };
} else {
  window.appState = { state, getState, updateState };
}
