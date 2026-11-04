---
name: windows-build-packaging
description: Compile, package, and verify standalone Windows executables and NSIS installers using electron-builder, native rebuilds, and pre-build quality gates.
---

# Windows Build & Packaging Skill

Use this skill when packaging the application for Windows, updating electron-builder configurations, generating icons, or inspecting output binaries.

## Build Requirements & Tools

- **Node.js**: v22+
- **Package Manager**: `pnpm`
- **Electron**: v44+
- **Packager**: `electron-builder` (`--win nsis --x64`)

## Packaging Procedures

### Step 1: Pre-Build Quality Gate
Before creating any build, verify all unit and integration tests pass without error:
```powershell
pnpm test
```
If any test fails, STOP and fix the issue before building.

### Step 2: Running the Windows Package Build
Execute the Windows package script:
```powershell
pnpm build:win
```
This performs:
1. Native dependency rebuild via `@electron/rebuild`.
2. Electron binaries download and packaging into `release/win-unpacked/`.
3. ASAR archive creation with integrity checksums.
4. NSIS installer creation (`release/Kick-Soundboard-Setup-0.2.3.exe`).
5. Blockmap generation for differential auto-updates.

### Step 3: Inspecting Output Artifacts
Verify that both output targets exist and have valid file sizes:
```powershell
Get-ChildItem -Path "release"
Get-Item "release\win-unpacked\Kick Soundboard.exe" | Format-List Name, Length, LastWriteTime
```
Expected output:
- **Standalone Unpacked Directory**: `release\win-unpacked\Kick Soundboard.exe` (~240MB uncompressed)
- **NSIS Installer**: `release\Kick-Soundboard-Setup-0.2.3.exe` (~100MB compressed)

### Step 4: Asset & Icon Generation
If icons need to be updated:
- Master SVG: `build/icon.svg`
- Icon script: `scripts/generate-windows-icon.ps1`
- Generates multi-resolution `.ico` (`16x16`, `24x24`, `32x32`, `48x48`, `64x64`, `128x128`, `256x256`) into `build/icon.ico`.

## Smoke Testing the Build
To test the built binary locally without installation:
```powershell
Start-Process "release\win-unpacked\Kick Soundboard.exe"
```
Check that:
1. Window opens with deep black theme and neon green accent.
2. Dock navigation (Studio, History, Analytics, Soundpad, Settings) switches cleanly.
3. Master volume slider and sound triggers respond without errors.
4. Error log is created at `%APPDATA%\Kick Soundboard\logs\error.log` if any unhandled error occurs.
