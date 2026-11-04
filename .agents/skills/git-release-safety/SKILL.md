---
name: git-release-safety
description: Enforce safe Git operations, pre-commit diff auditing, semantic version management, and strict push prevention without explicit human permission.
---

# Git & Release Safety Skill

Use this skill when staging files, preparing commit messages, checking git status, managing semantic versions, or performing release coordination.

## Ironclad Rule

> [!CAUTION]
> **DO NOT PUSH TO GITHUB OR CREATE COMMITS UNLESS THE USER EXPLICITLY DIRECTS YOU TO DO SO IN CHAT.**
> Automatic git commits, automated git tags, and automated git pushes are strictly forbidden.

## Safe Git Workflow

### 1. Diff Auditing
Always check untracked and modified files before touching git:
```powershell
git status
git diff --stat
```
Verify that:
- No sensitive files (`.env`, tokens, credentials, private audio files) are being tracked.
- Large build directories (`release/`, `dist/`, `node_modules/`) are ignored by `.gitignore`.

### 2. Pre-Commit Quality Checks
Ensure test passing baseline before staging:
```powershell
pnpm test
```
All 102 tests must pass.

### 3. Version Bump Procedures
When preparing a new release version:
1. Update `version` in `package.json`.
2. Update version references in `README.md`.
3. Synchronize `CHANGELOG.md` with features and fixes.
4. Verify build package matches version:
   ```powershell
   pnpm build:win
   ```

### 4. Human-In-The-Loop Approval Gate
Before committing or pushing:
1. Show the user a clear summary of staged files and diff summary.
2. Ask for explicit approval to commit.
3. Wait for the user's confirmation before executing:
   ```powershell
   git add <specific files>
   git commit -m "feat/fix: <descriptive message>"
   ```
4. Only run `git push origin main` if the user explicitly says: "push to github" or "push".
