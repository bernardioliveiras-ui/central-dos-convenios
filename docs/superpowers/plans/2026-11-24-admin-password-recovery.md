# Admin Password Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a manually authorized, single-use password reset for the existing ADMIN without data loss.

**Architecture:** The Cloudflare Worker reads temporary `ADMIN_RECOVERY_TOKEN`, compares it without leaking its value, and atomically persists a peppered new hash, a hashed-token audit marker, and revocation of ADMIN sessions in existing D1 tables. Manual PowerShell steps manage the short-lived token and new password.

**Tech Stack:** JavaScript Cloudflare Workers, D1 SQLite, Node tests, PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-11-24-admin-password-recovery-design.md`

## Global Constraints

- Preserve ADMIN identity, D1, broker accounts, audit events, MFA state, all existing secret values.
- No remote writes, no account automation, no migration.
- Token and password must never be printed or committed.
- Work from v0.3.2 ZIP, release v0.3.3 as a new ZIP for manual GitHub push.

## Review Focus

- Missing/mismatched/too-short token: 403 and no mutation (Task 1).
- Existing token used twice: second request 409 and first password remains (Task 1).
- Recovery on missing ADMIN: no account creation or secondary ADMIN (Task 1).
- Successful recovery: old password/cookies invalid, new password authenticates; broker remains (Task 1).
- Bad new password, malformed payload, rate limit: no mutation or credential leakage (Task 1).

---

### Task 1: Worker recovery API with TDD

**Files:** `src/server/worker.js`, `tests/auth.test.js`

**Interfaces:** `POST /api/setup/admin/recover` JSON `{recoveryToken,email,password}`. Success `{message}` HTTP 200. Expects `env.ADMIN_RECOVERY_TOKEN` >=32 characters. Uses `env.DB.batch` for atomic audit-marker (`audit_events.id=hashToken(...)`), password update and session deletion.

- [ ] Write failing integration tests through real Worker+in-memory D1 for the five Review Focus cases; assert status, persisted hashes, sessions, audit and broker invariants.
- [ ] Run targeted tests, observe 404/other expected RED.
- [ ] Add `recoverAdmin(request,env)` and route after setup bootstrap, with token/rate/payload validation.
- [ ] Run `node --test tests/auth.test.js`; verify GREEN.

### Task 2: Documentation and release

**Files:** `ATIVACAO-POWERSHELL.md`, `README.md`, `security-checklist.md`, `package.json`, `package-lock.json`

- [ ] Document conditional manual steps with `npx.cmd`, `Get-Credential`, token creation, POST and secret removal; no old secrets recreated.
- [ ] Bump to 0.3.3.
- [ ] Run `npm test`, `npm run build`, `npm run check:config`, Wrangler dry-run (0 exit).
- [ ] Independent security review and fixes (if important), ZIP integrity validation, durable ZIP saved, handoff instructions.

## Execution notes

This is a source ZIP extract without `.git` metadata. Do not initialize or push a repo; tests and a new verified ZIP replace git commits for this handoff.
