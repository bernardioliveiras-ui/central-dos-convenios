# Optional Admin MFA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ADMIN can access the BKO with email/password before MFA opt-in, and can voluntarily enable TOTP from the admin dashboard.

**Architecture:** Change server authorization and `/api/me` to distinguish disabled versus enabled MFA. Preserve TOTP challenge once enabled and make fresh enrollment an explicit dashboard action. Preserve existing D1 records, secrets, broker flow, and manual GitHub deployment.

**Tech Stack:** Cloudflare Worker/JS, D1 SQLite, Vite DOM client, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-23-optional-admin-mfa-design.md`

## Global Constraints

- Preserve `SESSION_SECRET`, `PASSWORD_PEPPER`, `RATE_LIMIT_SALT` and all user data.
- No D1 migration or remote publication; deliver ZIP to user, who publishes via GitHub.
- Preserve MFA requirement for ADMIN once enabled, including replay protection.
- Existing exposed, unconfirmed MFA key must never be reused when opting in.

## Review Focus

- MFA disabled but `mfa_secret` staged: ADMIN should see BKO without verification (Task 1 test).
- MFA enabled but session unverified: all BKO endpoints still deny access (Task 1 test).
- TOTP code replay from a different session: rejected (Task 1 regression).
- Broker role with valid session: still cannot access BKO (Task 1 regression).
- Previously exposed MFA key: voluntary enrollment replaces pending secret; old TOTP cannot activate account (Task 1 test).

---

### Task 1: Backend authorization and enrollment

**Files:**
- Modify: `src/server/auth.js` (`requireStaff`)
- Modify: `src/server/worker.js` (`myProfile`, `mfaSetup`, `bootstrap` copy)
- Test: `tests/auth.test.js`, `tests/portal.test.js`, `tests/bko.test.js`

**Interfaces:**
- `/api/me` ADMIN JSON keeps `mfaEnabled:boolean`, `mfaRequired:boolean` (`true` iff enabled but session not verified).
- `POST /api/auth/mfa/setup` only for authenticated ADMIN with MFA disabled, body `{password:string}` verified against the stored hash with pepper and rate-limited (8 per hour), returns `{secret,otpauthUrl}`. Always replace any pending `mfa_secret` with a new secret.

- [ ] Write test: bootstrap ADMIN without MFA can read `/api/bko/applications` and `/api/me` returns `{mfaEnabled:false,mfaRequired:false}`.
- [ ] Write test: pending `mfa_secret` does not block staff, new enrollment changes secret, old key fails verification.
- [ ] Write test: missing/wrong current password cannot create an MFA secret.
- [ ] Write test: after enrolling MFA, a fresh session is challenged and denied until correct TOTP; replay and broker denial remain.
- [ ] Run targeted tests; confirm these new assertions fail before changes.
- [ ] Update `requireStaff`, `myProfile`, `mfaSetup`, bootstrap message with minimum code.
- [ ] Run `node --test tests/auth.test.js tests/portal.test.js tests/bko.test.js`; expect all pass.

### Task 2: Optional dashboard enrollment UI

**Files:**
- Modify: `portal.html` (ADMIN action in `bko-view` only)
- Modify: `src/client/portal.js` (conditionally show button, explicit enrollment, MFA copy, back action)
- Test: `tests/portal-ui.test.js` (static contract checks using readFileSync)

**Interfaces:**
- `#enable-admin-mfa` is visible only for unprotected ADMIN and opens a password confirmation step; submission invokes `startMfaSetup(password)`.
- MFA already enabled still uses the existing challenge flow in `enterPortal()`.

- [ ] Write test: optional button exists in BKO, enrollment is not called on login without enabled MFA, and button click starts enrollment.
- [ ] Run targeted UI test; confirm failure.
- [ ] Implement DOM condition and voluntary MFA setup action. Change enrollment copy from mandatory to optional and allow returning to dashboard before activation.
- [ ] Run targeted UI test; expect pass.

### Task 3: Hand-off, docs and release

**Files:**
- Modify: `README.md`, `ATIVACAO-POWERSHELL.md`, `security-checklist.md`, `package.json`, `package-lock.json`
- Create: `central-dos-convenios-v0.3.2-mfa-opcional.zip` outside source root

- [ ] Revise guides: MFA optional, first ADMIN login password-only, opt-in button, prior exposed key replaced on opt-in; note reduced security by default.
- [ ] Bump patch to `0.3.2` with `npm version 0.3.2 --no-git-tag-version --ignore-scripts`.
- [ ] Run `npm test`, `npm run build`, `npm run check:config`, `npx wrangler deploy --dry-run`; all exit 0.
- [ ] Package source excluding `node_modules`, `dist`, `.wrangler`, local secrets; verify ZIP integrity.
- [ ] Persist ZIP and provide manual GitHub/Cloudflare next steps without external writes.

## Execution notes

- Ruling: source is a ZIP export without `.git`, so git worktree/commit and SDD bookkeeping scripts are inapplicable; verify tests and package an independent ZIP.
- Ruling: `portal.html` is a minified one-line file, so the optional MFA dashboard control and password-confirmation form are created from `src/client/portal.js` at runtime instead of editing the huge HTML line. The `adminAccessView` helper is tested behaviorally, not via source-text greps.
- Independent review identified activation from a stolen session; addressed by password reconfirmation, 8/hour rate limit and a failing security test before implementation.
