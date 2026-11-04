---
name: audio-playback-engine
description: Manage Kick Soundboard's audio pipeline, sampler retriggering, queue arbitration, output device routing (OBS/virtual cables), and playback error handling.
---

# Audio Playback Engine Skill

Use this skill when developing, refactoring, or troubleshooting audio playback, sound queuing, sampler retrigger mechanics, volume attenuation, device routing, or audio error handling.

## Core Architecture

The audio engine spans two core client components:
- `src/js/components/queue.js`: Handles incoming Kick channel point redemption queues, cooldown tracking, effective volume calculation, and AbortError-safe audio previewing.
- `src/js/components/soundpad.js`: Handles interactive streamer soundboard playback, rapid sampler retriggering, interruption of previous sounds, pad mapping, and panic stop.

## Key Principles & Patterns

1. **Sampler Retrigger Pattern (Instant Spam Playback)**:
   - When a streamer clicks a sound pad or presses a hotkey while that pad is already playing:
     ```javascript
     if (activePadId === padId && previewAudio && !previewAudio.paused) {
       previewAudio.currentTime = 0; // Rewind instantly to beginning
       return;                       // Avoid loading/instantiating new audio
     }
     ```
   - **Crucial Rule**: Never instantiate a second `Audio` element for the same pad. Reusing the existing element with `currentTime = 0` eliminates latency, avoids memory bloat, and guarantees the sound never doubles up or plays on top of itself.

2. **Interruption & Safe Switching**:
   - When switching to a different pad, the previously playing sound must be stopped immediately:
     ```javascript
     function stopPreview() {
       if (previewAudio) {
         previewAudio.pause();
         previewAudio.currentTime = 0;
         previewAudio.src = '';
         previewAudio = null;
       }
     }
     ```
   - **Suppression of `AbortError`**: Calling `pause()` or changing `src` while an asynchronous `audio.play()` call is pending triggers an `AbortError`. This error is normal browser behavior and must be caught and ignored:
     ```javascript
     previewAudio.play().catch((err) => {
       if (err.name === 'AbortError') return; // Safe interruption
       logError('Soundpad Playback', err, { sound: soundPath });
     });
     ```

3. **Master & Reward Volume Multiplication**:
   - Overall volume is calculated as:
     $$\text{Effective Volume} = \left(\frac{\text{Master Volume}}{100}\right) \times \left(\frac{\text{Reward Volume}}{100}\right)$$
   - Both inputs must be clamped between `0` and `100` (`0.0` to `1.0` for `HTMLAudioElement.volume`).
   - Defined in `src/js/components/queue.js` as `calculateEffectiveVolume(masterVol, rewardVol)`.

4. **Output Device Selection (`setSinkId`)**:
   - Enables routing soundboard output to specific Windows audio devices (e.g. Virtual Audio Cable, VB-Audio Voicemeeter, or OBS Audio Capture).
   - In `src/js/components/settings.js`, populate device list with `navigator.mediaDevices.enumerateDevices()`.
   - Apply device destination to all audio instances via `audio.setSinkId(selectedDeviceId)`.

5. **Redemption Queue Arbitration**:
   - FIFO playback: redemptions are processed sequentially.
   - Cooldown window: prevents spamming expensive or disruptive reward sounds within a configurable interval (default: 10s - 30s).
   - Pending state handling: honors the `playPending` setting so streamers can audition sounds before approving in Kick dashboard.

6. **Panic Stop (Mute / Stop All)**:
   - Global stop button `#soundpad-stop-all` and keyboard shortcut `Escape`.
   - Instantly halts active sound pad playback, empties the waiting redemption queue, and stops the current queue item.

## Verification Workflow

Test audio calculations, error suppression, and retriggering:
```powershell
pnpm test
```
Specific tests:
- `Volume: effectiveVolume PASS & FAIL scenarios`
- `Sound Pad: triggerPadSound PASS scenario - Spam/retrigger seeks currentTime = 0`
- `Sound Pad: triggerPadSound PASS scenario - Switching pads interrupts previous sound cleanly`
- `Sound Pad: stopPreview FAIL scenario - Interrupted play() AbortError is suppressed`
- `Queue: enqueueRedemptionSound PASS & FAIL scenarios`
