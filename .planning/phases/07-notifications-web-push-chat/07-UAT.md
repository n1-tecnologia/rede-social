---
status: testing
phase: 07-notifications-web-push-chat
source: [07-VERIFICATION.md]
started: 2026-10-01T14:30:20Z
updated: 2026-10-01T14:30:20Z
---

## Current Test

number: 1
name: Real-device rows 1-17 of docs/phase-07-device-test-plan.md
expected: |
  Every row passes as written, against production after the 'Phase 7 release' steps of docs/DEPLOY.md (VAPID secrets, Realtime private-only, JWT expiry, API before web)
awaiting: user response

## Tests

### 1. Real-device rows 1-17 of docs/phase-07-device-test-plan.md
expected: Every row passes as written, against production after the 'Phase 7 release' steps of docs/DEPLOY.md
result: [pending]

### 2. Blocked member with an open app (device plan row 14, block by SQL while the app is open on Início and on /suporte)
expected: No new join succeeds; the open socket goes quiet no later than its next token push or re-join (≤ 3600 s); API reads are refused and the web moves to /acesso-suspenso; subscriptions are gone at the next send
result: [pending]

### 3. Decide on the C-WR-02 change to the token-route gate (T-07-12): the four BFF GET routes accept a request with no Sec-Fetch-Site and no Origin and move on to the session check
expected: The developer accepts the fallback or asks for the stricter 403 back
result: [pending]

### 4. Review the verdicts on the eleven flagged prohibitions (07-VERIFICATION table 'Prohibitions')
expected: Each holds as described, or the developer records a reason it does not
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
