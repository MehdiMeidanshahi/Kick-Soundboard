# Project: Kick Soundboard Test Coverage & Defect Remediation

## Architecture
Kick Soundboard is an Electron desktop application integrating Kick.com channel point redemptions and interactive audio playback.
- **Main Process (`src/main.js`)**: Hosts a local secure HTTP server on localhost with session token protection (`x-kick-app-session`), config persistence (`config.json`), audio file resolution, Kick API OAuth token management and polling, and system tray/IPC handling.
- **Renderer Process (`src/renderer.js`)**: Orchestrates the client-side single-page UI, tab navigation, global shortcuts (Escape, Space), sound previews, and panic stop.
- **Client Modules (`src/js/`)**:
  - `state.js`: Central reactive state store.
  - `api.js`: Authenticated HTTP fetch client with session token headers.
  - `logger.js`: Client-side error logger sending diagnostic entries to `/api/log-error`.
  - `i18n.js`: 1:1 bilingual translation engine supporting English (en) and Persian (fa) with RTL layout rules.
  - `components/`: UI modules for `navigation.js`, `studio.js`, `soundpad.js`, `queue.js`, `analytics.js`, `settings.js`.
- **Styling (`src/css/`)**: Kick Neon design system, CSS custom properties, responsive layout, tactile 3D Sound Pad buttons, animated streamer privacy blur, and cubic Bézier SVG stream analytics.
- **Automated Test Runner**: Node native test runner (`node --test`), executed via `pnpm test`.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Session Token Authentication | Secure client-to-server HTTP API calls with matching header (`x-kick-app-session`) | M1 | Survey 2 |
| F2 | Settings API Persistence | Support both per-reward settings and bulk config/sounds/volumes/cooldowns payloads in `/api/settings` | M1 | Survey 1, 2 |
| F3 | Backend HTTP Routes & IPC Handlers | Comprehensive verification and error handling across all 14 HTTP endpoints and IPC channels | M1 | Survey 3 |
| F4 | Sound Mapping & Availability Recognition | Correctly detect mapped sounds using `{ name, available }` and `{ path }` in SoundPad, Studio, Analytics | M2 | Survey 1, 2 |
| F5 | Rewards Ingestion & Polling | Fetch Kick rewards via `/api/rewards` and sync polling status with UI indicators | M2 | Survey 2 |
| F6 | Cooldown State Disambiguation | Separate user-configured cooldown durations (`state.rewardCooldowns`) from runtime active timestamps (`state.activeCooldowns`) | M2 | Survey 1, 2 |
| F7 | Unified Panic Stop | Instantly halt Sound Pad audio, preview audio, and redemption queue playback on Escape or `#soundpad-stop-all` | M2 | Survey 1, 2 |
| F8 | UI Property Harmonization | Unify `outputDeviceId`, `updateAvailable`, `streamerProfile`, and poll status timestamps between backend and UI | M2 | Survey 1, 2, 3 |
| F9 | Bilingual Parity & i18n | Provide 1:1 English/Persian translations for all UI dialogs, including disconnect confirmation | M2 | Survey 3 |
| F10 | Real Client Component Testing | Direct automated unit testing of all 6 components (`navigation`, `studio`, `soundpad`, `queue`, `analytics`, `settings`) across pass and fail scenarios | M3 | Survey 3 |
| F11 | Client Infrastructure Testing | Direct unit testing of `api.js`, `logger.js`, `state.js`, and `renderer.js` across pass and fail scenarios | M3 | Survey 3 |
| F12 | Live Application Verification & Defect Remediation | End-to-end verification of all UI interactions, zero regressions (`pnpm test`), and comprehensive structured defect report | M4 | ORIGINAL_REQUEST |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend API & Session Harmonization | Fix session token header mismatch, bulk & per-reward settings persistence, and expand backend route unit tests | none | DONE |
| M2 | Client Components & State Remediation | Fix sound mapping recognition, rewards loading, cooldown separation, panic stop, and property mismatches | M1 | IN_PROGRESS |
| M3 | Client Components & UI Test Expansion | Add comprehensive pass and fail scenario automated tests directly executing all client components and modules | M2 | PLANNED |
| M4 | Final Integration, Verification & Defect Report | Pass 100% of test suite, conduct adversarial hardening, and generate formal structured defect & verification report | M1, M2, M3 | PLANNED |

---

## Interface Contracts

### Client (`api.js`) ↔ Server (`main.js`)
- Request Header: `x-kick-app-session` (value: session token string). Server must accept `x-kick-app-session` or fallback `x-app-session`.
- Response: JSON format `{ ok: true, ... }` or `{ error: string }`.

### Settings Endpoint (`POST /api/settings`)
- Payload can be:
  1. Per-reward: `{ rewardId: string, soundPath?: string, clearSound?: boolean, cooldown?: number, rewardVolume?: number }`
  2. Bulk sounds: `{ sounds: Record<string, { path?: string, name?: string }> }`
  3. Bulk volumes & cooldowns: `{ rewardVolumes?: Record<string, number>, rewardCooldowns?: Record<string, number>, cooldowns?: Record<string, number> }`
  4. Global config: `{ volume?: number, outputDeviceId?: string, streamerMode?: boolean, playPending?: boolean }`
- Response: `200 OK` `{ ok: true }` or `400 Bad Request` `{ error: string }`.

### State Endpoint (`GET /api/state`)
- Returns: `{ configured, connected, clientId, bridgeUrl, version, volume, rewardVolumes, sounds, cooldowns, history, outputDeviceId, streamerMode, lastPollSuccessAt, nextPollAt, pollError, streamer, playPending }`
- `sounds`: Record mapping `rewardId` -> `{ name: string, available: boolean, path?: string }`.
- `streamer`: `{ username: string, name?: string, slug?: string, profile_pic?: string }` (or `streamerProfile`).

### Updates Endpoint (`GET /api/updates`)
- Returns: `{ currentVersion: string, latestVersion: string, updateAvailable: boolean, hasUpdate: boolean }`.

### Panic Stop Protocol
- Invoked via Escape key or `#soundpad-stop-all`.
- Action: Must call `stopAllPadSounds()`, `stopPreview()`, AND `stopQueue()` / `clearQueue()`.

---

## Code Layout
- `src/main.js`: Electron main process & local HTTP server (Owned by M1)
- `src/preload.js`: Electron IPC bridge (Owned by M1)
- `src/logger.js`: Node.js server logging engine (Owned by M1)
- `src/js/api.js`: Client HTTP request wrapper (Owned by M2)
- `src/js/state.js`: Client reactive state store (Owned by M2)
- `src/js/logger.js`: Client diagnostic error logger (Owned by M2)
- `src/js/i18n.js`: English/Persian translations (Owned by M2)
- `src/js/components/`: Modular UI component classes/functions (Owned by M2)
- `src/renderer.js`: UI orchestrator and event binder (Owned by M2)
- `src/css/`: UI stylesheets (Kick neon theme) (Owned by M2)
- `test/`: Native Node.js test suites (Owned by M1, M2, M3, E2E Track)
