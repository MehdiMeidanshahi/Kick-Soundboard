/**
 * Milestone 2 Remediation Verification Test Suite
 * Tests:
 * 1. #clear-history confirm prompt semantics (clearHistoryConfirm vs confirmDisconnect)
 * 2. i18n translation key parity and presence of 'clear' and 'readyFilesNo'
 * 3. Safe Node.js importing of src/js/logger.js without global window
 * 4. studio.updateReadiness dynamic file availability and playback state handling
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const i18n = require('../src/js/i18n.js');
const studio = require('../src/js/components/studio.js');

test('Worker M2 Fix 1: src/renderer.js binds #clear-history to clearHistoryConfirm', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const match = content.match(/\$\('#clear-history'\)\?\.addEventListener\('click'[\s\S]*?if\s*\(!confirm\(t\('clearHistoryConfirm'\)\)\)/);
  assert.ok(match, '#clear-history click handler must call confirm(t("clearHistoryConfirm"))');
  assert.ok(
    !content.includes("$('#clear-history')?.addEventListener('click', async () => {\n    if (!confirm(t('confirmDisconnect')))"),
    'Must not call confirmDisconnect on #clear-history'
  );
});

test('Worker M2 Fix 2: i18n dictionaries define clear and readyFilesNo with exact EN/FA parity', () => {
  const { en, fa } = i18n.translations;

  // Key existence
  assert.equal(en.clear, 'Clear');
  assert.equal(fa.clear, 'پاک کردن');
  assert.equal(en.readyFilesNo, '{count} missing sound files');
  assert.equal(fa.readyFilesNo, '{count} فایل صوتی مفقود است');

  // Total key count parity
  const enKeys = Object.keys(en).sort();
  const faKeys = Object.keys(fa).sort();
  assert.deepEqual(enKeys, faKeys, 'EN and FA keys must match 1:1');
});

test('Worker M2 Fix 3: src/js/logger.js is safely importable in Node without ReferenceError', () => {
  // Clear require cache to re-test fresh import
  const loggerPath = require.resolve('../src/js/logger.js');
  delete require.cache[loggerPath];

  assert.doesNotThrow(() => {
    const logger = require('../src/js/logger.js');
    assert.ok(logger, 'logger module must export clientLogger');
    assert.equal(typeof logger.logError, 'function');
  });
});

test('Worker M2 Fix 4: studio.updateReadiness dynamically reflects missing sound files and playback state', () => {
  const elements = {};
  global.document = {
    getElementById: (id) => {
      if (!elements[id]) {
        elements[id] = {
          textContent: '',
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            toggle(c, force) {
              if (force) this.classes.add(c);
              else this.classes.delete(c);
            },
            contains(c) { return this.classes.has(c); },
          },
        };
      }
      return elements[id];
    },
  };

  const mockState = {
    connected: true,
    rewards: [
      { id: 'rew-1', title: 'Reward 1' },
      { id: 'rew-2', title: 'Reward 2' },
    ],
    sounds: {
      'rew-1': { name: 'sound1.mp3', available: true },
      'rew-2': { name: 'sound2.mp3', available: false }, // missing file
    },
    currentPlayingRewardId: null,
  };

  studio.updateReadiness(mockState, i18n.t);

  const readyFiles = elements['ready-files'];
  assert.ok(readyFiles.textContent.includes('1'), 'Must report 1 missing file');
  assert.ok(!readyFiles.classList.contains('ready'), 'Must not have ready class when files missing');

  const readyPlay = elements['ready-playback'];
  assert.equal(readyPlay.textContent, i18n.translations.en.readyPlayNo);
  assert.ok(!readyPlay.classList.contains('ready'), 'Must not have ready class when files missing and audio idle');

  // Now simulate active audio playback
  mockState.currentPlayingRewardId = 'rew-1';
  studio.updateReadiness(mockState, i18n.t);
  assert.equal(readyPlay.textContent, i18n.translations.en.readyPlayYes);
  assert.ok(readyPlay.classList.contains('ready'), 'Must have ready class when audio active');

  // Now simulate all sound files available
  mockState.sounds['rew-2'].available = true;
  mockState.currentPlayingRewardId = null;
  studio.updateReadiness(mockState, i18n.t);
  assert.equal(readyFiles.textContent, i18n.translations.en.readyFilesYes);
  assert.ok(readyFiles.classList.contains('ready'), 'Must have ready class when all files found');
  assert.equal(readyPlay.textContent, i18n.translations.en.readyPlayYes);
  assert.ok(readyPlay.classList.contains('ready'), 'Must have ready class when all files found and ready');

  // Now simulate all sound files available
  mockState.sounds['rew-2'].available = true;
  studio.updateReadiness(mockState, i18n.t);
  assert.equal(readyFiles.textContent, i18n.translations.en.readyFilesYes);
  assert.ok(readyFiles.classList.contains('ready'), 'Must have ready class when all files found');
});
