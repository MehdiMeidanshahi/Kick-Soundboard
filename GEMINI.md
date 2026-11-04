# Kick Soundboard - Gemini Agent Rules

These rules apply to Gemini and Antigravity agents working on the Kick Soundboard repository.

1. **STRICT GIT PUSH PROTECTION**: Never run `git push` or create git commits without direct, explicit approval from the user in chat.
2. **MODULAR CODE ARCHITECTURE**: Maintain component separation:
   - CSS in `src/css/*.css` imported by `src/style.css`.
   - JavaScript in `src/js/components/*.js`, `src/js/state.js`, `src/js/i18n.js`, `src/js/api.js`, `src/js/logger.js`, and `src/renderer.js`.
   - Logging in `src/logger.js` recording all failures to `logs/error.log` with timestamp, context, how/when detail, stack trace, and memory statistics.
3. **ZERO REGRESSION VERIFICATION**: All 102 tests (`pnpm test`) must pass before concluding any task.
4. **KICK DESIGN SYSTEM**: Follow Kick dark theme (`#53FC18`), tactile 3D Sound Pad buttons, animated privacy blur for streamer mode, and real dynamic SVG wave charts in Stream Analytics.
5. **AUDIO ENGINE INTEGRITY**: Sampler retrigger (`currentTime = 0`), interrupt on switch, suppress `AbortError`, dedicated stop, and OBS output capture support.
6. **BILINGUAL PARITY**: Keep English (`en`) and Persian (`fa`) translations in complete 1:1 synchronization.
