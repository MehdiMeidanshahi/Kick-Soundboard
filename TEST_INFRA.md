# Kick Soundboard — Comprehensive Test Infrastructure & 4-Tier Test Plan

This document defines the test architecture, philosophy, feature inventory mapping, and exhaustive 4-tier test plan for the Kick Soundboard application.

---

## 1. Test Architecture & Philosophy

### Opaque-Box (Black-Box) Testing Principles
- **Strict Boundary Independence**: Tests interact with Kick Soundboard exclusively through public contracts: HTTP endpoints, IPC protocols, DOM elements/attributes, and public module interfaces. No reliance on internal private variables or closure states.
- **Authoritative Output Derivation**: Expected values are derived strictly from specifications (`PROJECT.md § Interface Contracts`, Kick Developer API OAuth 2.1 specs, and `ORIGINAL_REQUEST.md`).
- **Complete Test Isolation**: Every test creates its own independent execution environment, resets shared stores, sets up isolated mock HTTP servers/DOM trees, and cleans up artifacts upon completion. Tests run in any order without side effects.
- **Adversarial & Fault Injection Hardening**: All interfaces are subjected to malformed tokens, payload overflow (>64KB), unsupported media types, corrupt timestamps, zero-length files, path traversal attempts, and network dropouts.

---

## 2. Feature Inventory Mapping

| ID | Feature | Specification Reference | Target Interfaces |
|---|---|---|---|
| **F1** | Session Token Authentication | `PROJECT.md § F1`, § Interface Contracts | `x-kick-app-session` / `x-app-session` headers, Origin verification, `requireAppRequest()` |
| **F2** | Settings API Persistence | `PROJECT.md § F2`, `POST /api/settings` | Per-reward updates, bulk sounds, bulk volumes/cooldowns, global settings, volume & cooldown bounds |
| **F3** | Backend HTTP Routes & IPC Handlers | `PROJECT.md § F3`, `src/main.js` | 14 HTTP endpoints (`/health`, `/api/state`, `/api/updates`, `/api/config`, `/api/connect`, `/api/disconnect`, `/api/rewards`, `/api/settings`, `/api/history/clear`, `/api/audio/:id`, `/api/test-sound`, `/api/poll`, `/api/status`, `/api/log-error`, `/api/logs`) and static asset streaming |
| **F4** | Sound Mapping & Availability Recognition | `PROJECT.md § F4`, Soundpad/Studio | Audio file validation (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`), `{ name, available }` detection, unassigned rewards |
| **F5** | Rewards Ingestion & Polling | `PROJECT.md § F5`, `src/main.js` | `/api/rewards`, `/api/poll`, poll status timestamps (`lastPollSuccessAt`, `nextPollAt`), poll health indicators |
| **F6** | Cooldown State Disambiguation | `PROJECT.md § F6`, `queue.js` | Separation of configured duration (`rewardCooldowns`) from runtime timestamp (`activeCooldowns`), FIFO queue arbitration |
| **F7** | Unified Panic Stop | `PROJECT.md § F7`, Soundpad/Queue | `Escape` key, `#soundpad-stop-all`, halts Sound Pad audio, stops preview audio, clears redemption queue |
| **F8** | UI Property Harmonization | `PROJECT.md § F8`, Settings/State | Harmonized `outputDeviceId` (`setSinkId`), `updateAvailable`, `streamerProfile`, volume synchronization |
| **F9** | Bilingual Parity & i18n | `PROJECT.md § F9`, `src/js/i18n.js` | 1:1 English/Persian parity, RTL layout rules (`dir="rtl"`), template interpolation, fallback keys |
| **F10** | Real Client Component Testing | `PROJECT.md § F10`, `src/js/components/` | Direct automated testing of `navigation`, `studio`, `soundpad`, `queue`, `analytics`, and `settings` |
| **F11** | Client Infrastructure Testing | `PROJECT.md § F11`, `src/js/` | Direct testing of `api.js` (HTTP wrapper), `logger.js` (structured error logging), `state.js` (reactive store), `renderer.js` |
| **F12** | Live Application Verification & Defect Remediation | `PROJECT.md § F12`, E2E Life Cycle | End-to-end integration across audio playback, streamer mode privacy, zero regression verification |

---

## 3. Exhaustive 4-Tier Test Plan

### Tier 1: Feature Coverage (>=5 tests per feature, 60+ tests)
Validates primary behavior (happy path) and basic functional compliance for every feature in the inventory.

- **F1: Session Token Authentication**
  - T1.F1.1: Request with valid `x-kick-app-session` passes authentication.
  - T1.F1.2: Request with valid fallback `x-app-session` passes authentication.
  - T1.F1.3: Request with invalid session token is rejected with HTTP 403 Forbidden.
  - T1.F1.4: Request without session token header is rejected with HTTP 403 Forbidden.
  - T1.F1.5: Non-localhost Origin header is rejected with HTTP 403 Forbidden.

- **F2: Settings API Persistence**
  - T1.F2.1: Per-reward settings payload successfully updates reward sound path and cooldown.
  - T1.F2.2: Bulk sounds dictionary correctly updates multiple reward sound mappings.
  - T1.F2.3: Bulk volumes and cooldowns payload updates configuration store.
  - T1.F2.4: Global configuration (`volume`, `outputDeviceId`, `streamerMode`, `playPending`) updates cleanly.
  - T1.F2.5: Clear sound flag (`clearSound: true`) removes mapped sound entry from store.

- **F3: Backend HTTP Routes & IPC Handlers**
  - T1.F3.1: `GET /health` returns HTTP 200 `{ ok: true }`.
  - T1.F3.2: `GET /api/state` returns complete sanitized public state representation.
  - T1.F3.3: `POST /api/disconnect` clears session access tokens and resets connected state.
  - T1.F3.4: `POST /api/history/clear` clears redemption history array.
  - T1.F3.5: `GET /api/audio/:id` pipes audio stream with correct Content-Type for mapped files.

- **F4: Sound Mapping & Availability Recognition**
  - T1.F4.1: Existing audio file on disk marked as `available: true` with correct basename.
  - T1.F4.2: Missing audio file path marked as `available: false`.
  - T1.F4.3: Valid audio extensions (`.mp3`, `.wav`, `.ogg`, `.flac`) accepted.
  - T1.F4.4: Unsupported extension (`.exe`, `.txt`) rejected with HTTP 400.
  - T1.F4.5: Unassigned rewards correctly identified when no sound mapping exists.

- **F5: Rewards Ingestion & Polling**
  - T1.F5.1: `GET /api/rewards` returns Kick channel rewards list.
  - T1.F5.2: Polling trigger `POST /api/poll` invokes redemption poll cycle.
  - T1.F5.3: `GET /api/status` returns connection status based on token validity.
  - T1.F5.4: Poll health indicator formats last checked and next check timestamps.
  - T1.F5.5: Polling status indicators update when polling loop is active.

- **F6: Cooldown State Disambiguation**
  - T1.F6.1: Enqueue succeeds when reward has never been played.
  - T1.F6.2: Enqueue rejected when attempted within the active cooldown window.
  - T1.F6.3: Enqueue succeeds after the configured cooldown duration has elapsed.
  - T1.F6.4: Zero cooldown allows immediate sequential enqueues.
  - T1.F6.5: Cooldowns are tracked independently per reward ID without cross-talk.

- **F7: Unified Panic Stop**
  - T1.F7.1: Panic stop halts active Sound Pad audio and clears audio source.
  - T1.F7.2: Panic stop halts active sound preview audio and resets preview state.
  - T1.F7.3: Panic stop empties all pending items from redemption queue.
  - T1.F7.4: Escape key press triggers global panic stop.
  - T1.F7.5: `#soundpad-stop-all` button click hides stop button and halts playback.

- **F8: UI Property Harmonization**
  - T1.F8.1: `outputDeviceId` correctly passed and applied to audio elements via `setSinkId`.
  - T1.F8.2: `updateAvailable` boolean correctly calculated from version comparison.
  - T1.F8.3: `streamerProfile` correctly projected to UI header with username and avatar.
  - T1.F8.4: Poll timestamps harmonized between server UTC and client locale.
  - T1.F8.5: Master volume slider updates state and attenuates effective volume.

- **F9: Bilingual Parity & i18n**
  - T1.F9.1: English lookup returns expected text string.
  - T1.F9.2: Persian lookup returns translated Persian text string.
  - T1.F9.3: Template interpolation replaces `{placeholder}` with supplied values.
  - T1.F9.4: Missing key falls back gracefully to default language or key name.
  - T1.F9.5: Language toggle updates document `lang` and `dir` attributes (`ltr` vs `rtl`).

- **F10: Real Client Component Testing**
  - T1.F10.1: Navigation component toggles active classes on tab buttons and view panels.
  - T1.F10.2: Studio component renders rewards grid and filter pills.
  - T1.F10.3: Soundpad component renders 3D tactile buttons for configured rewards.
  - T1.F10.4: Queue component processes redemptions in strict FIFO order.
  - T1.F10.5: Analytics component aggregates redemption data into 7-day timeline buckets.

- **F11: Client Infrastructure Testing**
  - T1.F11.1: `api.js` request method automatically injects session headers.
  - T1.F11.2: `api.js` throws typed error with status code on non-2xx responses.
  - T1.F11.3: `logger.js` formats structured error payloads with stack and context.
  - T1.F11.4: `logger.js` falls back to HTTP `/api/log-error` when IPC unavailable.
  - T1.F11.5: `state.js` reactive store updates and notifies subscribers.

- **F12: Live Application Verification & Defect Remediation**
  - T1.F12.1: End-to-end redemption ingestion results in audio queueing.
  - T1.F12.2: Stream mode toggling applies animated privacy blur to sensitive elements.
  - T1.F12.3: Audio device selection enumerates and routes audio outputs.
  - T1.F12.4: History clearing removes all items and updates UI table.
  - T1.F12.5: Zero regression verification confirms 100% test pass rate across suite.

---

### Tier 2: Boundary & Corner Cases (>=5 tests per feature, 60+ tests)
Tests extreme inputs, invalid formats, limits, and stress conditions for all features.

- **F1: Session Token Authentication**
  - T2.F1.1: Malformed host header (e.g. `evil.com`) returns HTTP 421 Misdirected Request.
  - T2.F1.2: Empty session token string returns HTTP 403 Forbidden.
  - T2.F1.3: Partial / truncated session token returns HTTP 403 Forbidden.
  - T2.F1.4: Request with non-JSON Content-Type on POST returns HTTP 415.
  - T2.F1.5: Request body exceeding 64KB rejected with HTTP 413 Payload Too Large.

- **F2: Settings API Persistence**
  - T2.F2.1: Master volume < 0.0 clamped strictly to 0.0.
  - T2.F2.2: Master volume > 1.0 clamped strictly to 1.0.
  - T2.F2.3: Cooldown < 0 seconds clamped to 0.
  - T2.F2.4: Cooldown > 3600 seconds clamped to 3600.
  - T2.F2.5: Non-numeric volume values gracefully handled without crashing.

- **F3: Backend HTTP Routes & IPC Handlers**
  - T2.F3.1: Non-existent route returns HTTP 404 Not Found.
  - T2.F3.2: Malformed JSON payload in POST request returns HTTP 400 / 500 error cleanly.
  - T2.F3.3: Static asset request attempting path traversal (`/../../etc/passwd`) blocked.
  - T2.F3.4: GET request on unmapped `/api/audio/:id` returns HTTP 404.
  - T2.F3.5: Disconnect called when already disconnected handles gracefully with ok: true.

- **F4: Sound Mapping & Availability Recognition**
  - T2.F4.1: Zero-byte audio file checked for file existence without crash.
  - T2.F4.2: Sound file path with unicode / Persian characters handled properly.
  - T2.F4.3: Directory path passed instead of file path rejected with available: false.
  - T2.F4.4: File with uppercase extension (`.MP3`, `.WAV`) recognized as valid audio.
  - T2.F4.5: Deleting sound file from disk dynamically flips availability on subsequent state query.

- **F5: Rewards Ingestion & Polling**
  - T2.F5.1: HTTP 429 response parses `Retry-After` seconds header correctly.
  - T2.F5.2: HTTP 429 response parses `Retry-After` HTTP-date header correctly.
  - T2.F5.3: Exponential backoff caps at maximum 300,000ms (5 minutes).
  - T2.F5.4: Upstream Kick API 500 error increments consecutive failure counter.
  - T2.F5.5: Empty rewards response (`{ data: [] }`) renders empty state without error.

- **F6: Cooldown State Disambiguation**
  - T2.F6.1: Cooldown with timestamp in the future handled gracefully without indefinite lock.
  - T2.F6.2: High-frequency concurrent enqueue requests handled with atomic timestamp check.
  - T2.F6.3: Cooldown configured as `NaN` or non-numeric defaults safely to 0ms.
  - T2.F6.4: Reward with 1 hour (3600s) cooldown maintains suppression across multiple attempts.
  - T2.F6.5: Clearing reward history does not clear or disrupt active cooldown timers.

- **F7: Unified Panic Stop**
  - T2.F7.1: Panic stop called when no audio is playing executes cleanly without error.
  - T2.F7.2: Panic stop called repeatedly in rapid succession (10x spam) does not throw.
  - T2.F7.3: Interrupted HTMLAudioElement `play()` promise `AbortError` is suppressed.
  - T2.F7.4: Panic stop with 50 items in queue empties all items instantly.
  - T2.F7.5: Escape key pressed while inside input field stops sounds while preserving key event.

- **F8: UI Property Harmonization**
  - T2.F8.1: Missing streamer profile rendered with fallback placeholder avatar.
  - T2.F8.2: Semver comparison handles `v` prefix, prerelease tags, and numeric equality.
  - T2.F8.3: Audio device ID referencing disconnected device falls back gracefully.
  - T2.F8.4: Invalid / corrupt ISO date in `lastPollSuccessAt` handled without throwing.
  - T2.F8.5: Effective volume calculation with NaN rewardVolume defaults to master volume.

- **F9: Bilingual Parity & i18n**
  - T2.F9.1: Interpolation with missing parameter leaves other placeholders intact.
  - T2.F9.2: Translation key with special characters or dots handled safely.
  - T2.F9.3: Persian string rendering verifies presence of RTL text direction.
  - T2.F9.4: Switching languages back and forth 20 times retains complete translation consistency.
  - T2.F9.5: Null / undefined translation key returns safe fallback string.

- **F10: Real Client Component Testing**
  - T2.F10.1: Studio rewards search with regex special characters (`.*[]()^$`) does not crash.
  - T2.F10.2: Soundpad click on unmapped reward opens assignment dialog instead of playing.
  - T2.F10.3: Queue `skipCurrent()` called when queue is empty does not throw.
  - T2.F10.4: Analytics `getTimelineBuckets()` with corrupt dates skips invalid entries.
  - T2.F10.5: Settings modal focus trapping handles missing focusable elements gracefully.

- **F11: Client Infrastructure Testing**
  - T2.F11.1: `api.js` handles network abort / timeout cleanly with descriptive error.
  - T2.F11.2: `api.js` handles non-JSON error response from server without JSON parse crash.
  - T2.F11.3: `logger.js` handles circular object references in metadata without throwing.
  - T2.F11.4: `logger.js` rotates log file when size exceeds 5MB limit.
  - T2.F11.5: `state.js` handles updating nonexistent properties without state corruption.

- **F12: Live Application Verification & Defect Remediation**
  - T2.F12.1: Rapid pad spam (10 clicks in 50ms) triggers sampler retrigger (`currentTime = 0`) with zero duplicate elements.
  - T2.F12.2: Switching between 5 different pads rapidly interrupts previous audio cleanly.
  - T2.F12.3: Audio device change while sound is playing routes new sound to selected sink.
  - T2.F12.4: 100 redemption burst correctly processes FIFO queue with zero dropped items.
  - T2.F12.5: Deep link URL with invalid or missing protocol rejected cleanly.

---

### Tier 3: Cross-Feature Combinations (Pairwise Interactions)
Validates interactions and contract compliance between interconnected features.

1. **F1 (Auth) + F2 (Settings)**:
   - Valid session token allows saving settings; invalid token blocks settings modification.
2. **F2 (Settings) + F4 (Sound Mapping)**:
   - Saving a sound path via `/api/settings` immediately updates `sounds` map and availability flag.
3. **F2 (Settings) + F6 (Cooldowns)**:
   - Updating cooldown for a reward in settings dynamically enforces that cooldown on subsequent queue enqueues.
4. **F4 (Sound Mapping) + F7 (Panic Stop)**:
   - Soundpad triggered audio from mapped sound is immediately halted when Panic Stop is fired.
5. **F5 (Rewards Ingestion) + F10 (Studio Component)**:
   - Newly ingested rewards from `/api/rewards` dynamically populate the Studio UI grid with correct title, cost, and sound status.
6. **F6 (Cooldowns) + F10 (Queue Component)**:
   - Rapid incoming redemptions are filtered through the cooldown arbitrator; eligible redemptions enter FIFO queue.
7. **F7 (Panic Stop) + F10 (Soundpad Component)**:
   - Active playing tile equalizer animation stops and resets to idle when Panic Stop is triggered.
8. **F8 (Property Harmonization) + F10 (Settings Component)**:
   - Changing `outputDeviceId` in state correctly selects the matching `<option>` in the audio device dropdown.
9. **F9 (Bilingual Parity) + F10 (Studio & History UI)**:
   - Changing application language to Persian updates Studio table headers, search placeholders, and relative timestamps (`fa-IR`).
10. **F10 (Soundpad Retrigger) + F11 (Logger)**:
    - Retriggering audio via `currentTime = 0` suppresses `AbortError` and produces zero spurious error log entries.
11. **F5 (Polling / playPending) + F10 (Queue Component)**:
    - When `playPending: true`, redemptions with status `pending` enter the sound queue immediately; when `false`, they wait for approval.
12. **F8 (Streamer Mode) + F9 (Bilingual Parity)**:
    - Streamer mode privacy shield applies iridescent shimmer and blur across both LTR (English) and RTL (Persian) views.

---

### Tier 4: Real-World Scenarios (Comprehensive End-to-End Workloads)
Validates complete user flows under realistic streamer production workloads.

1. **Scenario 1: Full Streamer Onboarding & Broadcast Session Lifecycle**
   - Streamer starts app -> Connects Kick account via OAuth -> Ingests channel rewards -> Maps sounds to 4 rewards -> Adjusts master and per-reward volumes -> Plays soundpad pad -> Enables Streamer Mode -> Triggers Panic Stop on loud sound -> Disconnects cleanly.
2. **Scenario 2: High-Traffic Redemption Rush (Subathon / Raid Event)**
   - 50 redemptions arrive in burst from 10 different viewers -> Enqueued in FIFO order -> Cooldowns throttle spammy rewards -> Approved sounds play sequentially with effective volume multiplication -> History logs each redemption with viewer name and timestamp.
3. **Scenario 3: Upstream Network Outage & Exponential Backoff Recovery**
   - Kick API goes down with HTTP 503 -> Polling engine backs off exponentially (10s -> 20s -> 40s) -> Consecutive failure count increases -> Client logger records errors -> Upstream recovers -> Polling succeeds and resets backoff to 10s.
4. **Scenario 4: Streamer Privacy Shield & Disruption Mitigation**
   - Streamer enables Streamer Mode -> Sensitive token, usernames, and redemption details are blurred -> Dispatched test sound plays -> Viewer attempts to spam disruptive sound -> Panic Stop pressed -> Queue emptied and audio silenced instantly.
5. **Scenario 5: Dynamic Multi-Language Switching During Live Operation**
   - Streamer switches from English to Persian while audio is playing -> Document changes to `dir="rtl"` and `lang="fa"` -> UI labels, dialogs, and relative timestamps re-render in Persian without interrupting audio playback or dropping queue items.

---

## 4. Test Verification Matrix & Commands

```powershell
# Run the entire test suite including baseline and E2E opaque tests
pnpm test
```
All tests must execute cleanly with zero failures and zero unhandled errors.
