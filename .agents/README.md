# Kick Soundboard Agentic Workspace

This directory holds the specialized **Skills** and **Subagent Personas** configured for developing, testing, styling, and packaging the Kick Soundboard application.

## Directory Structure

```
.agents/
├── skills/
│   ├── soundboard-ui-ux/
│   │   └── SKILL.md                 # UI/UX design, CSS modularization, 3D pads, SVG waves
│   ├── audio-playback-engine/
│   │   └── SKILL.md                 # Audio retriggering, queue arbitration, device routing
│   ├── kick-api-integration/
│   │   └── SKILL.md                 # Kick API, OAuth 2.1 PKCE, polling, user caching
│   ├── windows-build-packaging/
│   │   └── SKILL.md                 # electron-builder, NSIS installers, binary inspection
│   └── git-release-safety/
│       └── SKILL.md                 # Pre-commit auditing, version bumps, push protection
└── subagents/
    ├── ui-designer.md               # Kick UI/UX Specialist persona
    ├── audio-architect.md           # Audio Engine & Sampler Specialist persona
    ├── kick-integrator.md           # Kick API & Electron Backend Specialist persona
    ├── build-qa-specialist.md       # Windows Packaging & QA Specialist persona
    └── release-manager.md           # Release & Git Gatekeeper persona
```

For complete instructions on invoking skills and agents individually or coordinating them in multi-agent workflows, see [docs/AGENTS_AND_SKILLS.md](../docs/AGENTS_AND_SKILLS.md).
