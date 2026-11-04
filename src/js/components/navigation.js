/**
 * Navigation & Keyboard Shortcuts Component
 * Handles tab transitions, view synchronization, Streamer Mode toggle,
 * and keyboard bindings (Alt+1..3, Escape).
 */

function switchTab(tabId, state, options = {}) {
  const validTabs = ['studio', 'analytics', 'soundpad', 'goal'];
  if (!validTabs.includes(tabId)) return;

  state.currentTab = tabId;
  window.currentTab = tabId;

  // 1. Sync dock buttons
  document.querySelectorAll('.dock-btn[data-tab]').forEach((btn) => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // 2. Switch view container
  document.querySelectorAll('.app-view').forEach((view) => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) targetView.classList.add('active');

  if (typeof options.onTabSwitched === 'function') {
    options.onTabSwitched(tabId);
  }
}

function toggleStreamMode(state, onModeChanged) {
  state.streamerMode = !state.streamerMode;
  document.body.classList.toggle('stream-mode', state.streamerMode);

  const btn = document.getElementById('stream-mode-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(state.streamerMode));
    btn.classList.toggle('primary', state.streamerMode);
  }

  if (typeof onModeChanged === 'function') {
    onModeChanged(state.streamerMode);
  }
}

function initKeyboardShortcuts(handlers = {}) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (typeof handlers.onEscape === 'function') handlers.onEscape();
    }
    if (e.altKey) {
      if (e.key === '1') {
        e.preventDefault();
        if (typeof handlers.onSwitchTab === 'function') handlers.onSwitchTab('studio');
      } else if (e.key === '2') {
        e.preventDefault();
        if (typeof handlers.onSwitchTab === 'function') handlers.onSwitchTab('analytics');
      } else if (e.key === '3') {
        e.preventDefault();
        if (typeof handlers.onSwitchTab === 'function') handlers.onSwitchTab('soundpad');
      } else if (e.key === '4') {
        e.preventDefault();
        if (typeof handlers.onSwitchTab === 'function') handlers.onSwitchTab('goal');
      }
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { switchTab, toggleStreamMode, initKeyboardShortcuts };
} else {
  window.navigationComponent = { switchTab, toggleStreamMode, initKeyboardShortcuts };
}
