---
status: complete
phase: 07-notifications-web-push-chat
source: [07-VERIFICATION.md]
started: 2026-10-01T14:30:20Z
updated: 2026-10-01T14:33:03Z
---

## Current Test

[testing complete]

## Tests

### 1. Real-device rows 1-17 of docs/phase-07-device-test-plan.md
expected: Every row passes as written, against production after the 'Phase 7 release' steps of docs/DEPLOY.md
result: blocked
blocked_by: real-device
reason: "Needs production with the Phase 7 release and real phones; developer closed Phase 7 on 2026-10-01 with this deferred to the real-device pass (Phase 8 SC 4), same as 05.2/05.3"

### 2. Blocked member with an open app (device plan row 14, block by SQL while the app is open on Início and on /suporte)
expected: No new join succeeds; the open socket goes quiet no later than its next token push or re-join (≤ 3600 s); API reads are refused and the web moves to /acesso-suspenso; subscriptions are gone at the next send
result: blocked
blocked_by: real-device
reason: "Needs a real device against production; deferred with test 1"

### 3. Decide on the C-WR-02 change to the token-route gate (T-07-12): the four BFF GET routes accept a request with no Sec-Fetch-Site and no Origin and move on to the session check
expected: The developer accepts the fallback or asks for the stricter 403 back
result: pass
reason: "Developer (igor.vboas) accepted the C-WR-02 fallback as documented on 2026-10-01"

### 4. Review the verdicts on the eleven flagged prohibitions (07-VERIFICATION table 'Prohibitions')
expected: Each holds as described, or the developer records a reason it does not
result: pass
reason: "Developer (igor.vboas) accepted the eleven flagged prohibition verdicts as described in 07-VERIFICATION.md on 2026-10-01"

## Summary

total: 4
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 2

## Gaps
