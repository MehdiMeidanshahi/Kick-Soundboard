---
name: soundboard-ui-ux
description: Design, modernize, and style Kick Soundboard's user interface, components, CSS stylesheets, Sound Pad tactile tiles, real SVG analytics waves, and streamer mode privacy animations.
---

# Kick Soundboard UI/UX Skill

Use this skill when developing, refactoring, or polishing visual elements, components, stylesheets, or interactive UI flows in the Kick Soundboard application.

## Core Responsibilities

1. **Design System & Theme Tokens (`src/css/variables.css`)**:
   - Primary Kick Neon: `#53fc18` (`--green`), `#42cc13` (`--green-dark`), `rgba(83, 252, 24, 0.16)` (`--green-glow`).
   - Deep Black Backgrounds: `#090c10` (`--bg`), `#0e141b` (`--card`), `#131b24` (`--card-soft`).
   - Structural Lines: `#192634` (`--line`), `#24374a` (`--line-strong`).
   - Typography: Inter/Segoe UI with balanced font scales (`--text-xs` through `--text-2xl`).

2. **Component Separation Rules (`src/css/`)**:
   - `variables.css`: Global tokens, colors, transitions, shadows.
   - `base.css`: CSS reset, accessible focus rings (`:focus-visible`), utility classes (`.visually-hidden`).
   - `layout.css`: Sidebar dock rail, top header, status bar, expanded master volume slider.
   - `studio.css`: Rewards grid cards, sound mapping rows, filter pills, redemption history table.
   - `analytics.css`: 4-stat metric cards, SVG Bézier wave container, capsule bars, top viewers.
   - `soundpad.css`: 3D tactile pads, equalizer wave animation, unmapped audio drawer, panic stop button.
   - `settings.css`: Settings dialog, audio device picker, diagnostic logs viewer.
   - `privacy.css`: Streamer mode privacy blur, iridescent sweep, glints.
   - `style.css`: Master `@import` aggregator.

3. **Sound Pad UI Experience (`src/js/components/soundpad.js`)**:
   - **Tactile feedback**: Pad cards must feature a depressed 3D `:active` transform (`translateY(2px)`).
   - **Equalizer animation**: Only the currently active playing pad displays the 4-bar green equalizer animation.
   - **Sampler retrigger**: Triggering the same pad repeatedly resets `currentTime = 0` instantly without delay or audio doubling.
   - **One-click Sound Selection**: Direct "Change sound" button opens a file picker (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`).
   - **Unmapped Sounds Drawer**: Sliding side drawer displaying unmapped audio files from the user's sound library for quick assignment.

4. **Stream Analytics Real Data Wave (`src/js/components/analytics.js`)**:
   - **No mock data**: SVG paths (`#svg-wave-area`, `#svg-wave-line`) are dynamically generated from real redemption timestamps.
   - **Cubic Bézier Interpolation**: Smooth wave curve calculated with control points between consecutive bucket coordinates:
     ```javascript
     const cp1x = p0.x + (p1.x - p0.x) / 2;
     const cp1y = p0.y;
     const cp2x = p0.x + (p1.x - p0.x) / 2;
     const cp2y = p1.y;
     lineD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
     ```
   - **Timeframe toggle**: Instant reactive switching between 7 Days (`7d`) and 24 Hours (`24h`).

5. **Streamer Mode Privacy Shield (`src/css/privacy.css`)**:
   - Wrap sensitive text (usernames, channel IDs, token status) in `.private-blur-wrap`.
   - Apply backdrop blur (`8px`), iridescent metallic sweep (`@keyframes privacy-sweep`), and animated twinkle glints (`@keyframes glint-twinkle`).
   - Provide `@media (prefers-reduced-motion: reduce)` fallbacks disabling continuous loops.

6. **Accessibility & Keyboard Navigation**:
   - Provide skip link `#skip-to-content` as the first body element.
   - Ensure all icon-only buttons have explicit `aria-label` or `title` attributes.
   - Support keyboard navigation: `Alt+1` (Studio), `Alt+2` (History), `Alt+3` (Analytics), `Alt+4` (Soundpad), `Escape` (Stop all sounds / Close modals).

## Verification Workflow

After modifying UI components or styles:
```powershell
pnpm test
```
Verify that all 102 tests pass, particularly `test/ui-flows.test.js` and `test/ui-interactions-and-functions.test.js`.
