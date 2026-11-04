# Kick Soundboard - Agent & Project Rules

These rules govern all AI coding agents working on the Kick Soundboard repository. They take precedence over standard defaults and must be strictly enforced.

---

## 1. Ironclad Git & Release Safety Guardrail

> [!CAUTION]
> **NEVER PUSH TO GIT OR CREATE COMMITS WITHOUT EXPLICIT PERMISSION.**
> - Do NOT run `git push`, `git push --tags`, or any automated push command.
> - Do NOT commit changes unless the user explicitly requests a commit in chat.
> - Always perform a pre-commit diff audit (`git status` and `git diff`) before requesting approval.
> - All new features and bugfixes must remain local until the user explicitly issues a push directive.

---

## 2. Test Verification & Quality Gates

- **Zero Regression Rule**: Every change to JavaScript, CSS, HTML, or build scripts must pass all automated tests (`pnpm test`).
- Current baseline: **102 tests passing**, 0 failing, 0 skipped.
- Both **PASS scenarios** (happy path) and **FAIL scenarios** (corrupt inputs, network timeouts, invalid dates, out-of-bounds volumes, AbortErrors) must be tested.
- Pre-build requirement: `pnpm test` must execute cleanly before running `pnpm build:win`.

---

## 3. Architecture & Code Modularization Standards

- **No Monolithic Files**: Do NOT put all code into a single file or inline script/style tags.
  - CSS must be organized under `src/css/` (`variables.css`, `base.css`, `layout.css`, `studio.css`, `analytics.css`, `soundpad.css`, `settings.css`, `privacy.css`) and imported via `src/style.css`.
  - Client JS must be organized under `src/js/` with single-responsibility modules:
    - State: `src/js/state.js`
    - Translations: `src/js/i18n.js`
    - API Client: `src/js/api.js`
    - Client Logger: `src/js/logger.js`
    - Components: `src/js/components/` (`navigation.js`, `studio.js`, `queue.js`, `soundpad.js`, `analytics.js`, `settings.js`)
    - Orchestrator: `src/renderer.js`
- **Error Logging System**:
  - All errors (runtime exceptions, unhandled rejections, Kick polling errors, playback failures) must be logged via `src/logger.js` to `logs/error.log`.
  - Log format must contain: Timestamp (ISO & Local), Context, How & When it happened, Error type/code/message, Stack trace, and System/Memory stats.
  - Rotate log when file exceeds 5 MB.

---

## 4. UI/UX & Kick Design Language

- **Kick Neon Theme**: Primary brand neon green `#53FC18`, deep black `#090c10`, dark surface `#0e141b`, border `#192634`.
- **Sound Pad UX**:
  - Sampler retrigger pattern: when spamming a pad, reset `audio.currentTime = 0` immediately. Never overlap identical sounds or spawn duplicate audio elements.
  - Interruption: triggering a new pad or preview stops the previous playback cleanly and suppresses `AbortError`.
  - Dedicated Panic Stop (`#soundpad-stop-all` or `Escape` key).
  - Unmapped sounds drawer with drag-and-drop or one-click assignment.
- **Stream Analytics**:
  - Real dynamic data only. No hardcoded mock Bézier curves or synthetic days.
  - Cubic Bézier SVG wave generation based on actual redemption history (7-day / 24-hour bucketing).
- **Streamer Privacy Shield**:
  - Stream Mode applies animated privacy blur (`backdrop-filter: blur(8px)`) with iridescent shimmer sweep and glint particles across sensitive tokens, amounts, and viewer names on all views.

---

## 5. Bilingual Localization (EN / FA)

- Maintain 1:1 translation parity between English (`en`) and Persian (`fa`) in `src/js/i18n.js`.
- Respect RTL layout rules when `document.documentElement.dir === 'rtl'`.
- Number formatting must use locale-aware formatting (`toLocaleString`).

---

## 6. Electron Security & OS Storage

- Context isolation enabled (`contextIsolation: true`, `nodeIntegration: false`).
- Sensitive OAuth tokens (access tokens, refresh tokens) must be encrypted using Windows DPAPI via Electron's `safeStorage` API.
- Local HTTP API server must reject non-localhost origins and require app session token headers.
