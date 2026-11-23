---
status: testing
phase: 11-rede-social-direct-messages-member-blocking-and-reports
source: [11-VERIFICATION.md]
started: 2026-11-23T00:00:00Z
updated: 2026-11-23T00:00:00Z
---

## Current Test

number: 1
name: Two real phones with push (direct message banner)
expected: |
  An iPhone with the installed PWA and an Android phone both receive the "nova mensagem" push for a direct message,
  a second message in the same conversation replaces the first banner, and with the app in the foreground no banner
  shows (assumption A5). The full steps and the evidence rule are in 11-MANUAL-PROOFS.md (rows P1..P41).
awaiting: user response

## Tests

The owner's ledger `11-MANUAL-PROOFS.md` holds the step-by-step procedure and evidence rule of every row. This file only
lists the groups the verifier named, so `/gsd-verify-work 11` has something to walk. No row is written `passed` by an agent.

### 1. Two real phones with push (direct message banner)
expected: iPhone (installed PWA) and Android both get the push; a second message in the same conversation replaces the banner; no banner in the foreground (A5).
result: [pending]

### 2. Voice in a direct chat, heard only by the two participants
expected: a recording sent in a direct conversation plays for the two participants only; the administrator can hear a REPORTED recording only through its report, never by browsing the conversation.
result: [pending]

### 3. The blocked member's strip, the report of every subject and the "Nova denúncia" push
expected: the blocked member sees the closed strip "Esta conversa não aceita novas mensagens." with no hint of why and a refused send; the blocker sees "Você bloqueou {nome}" with "Desbloquear"; a report of a post, a comment, a story, a story comment, a community and a direct message reaches the queue; the administrator's phone gets the "Nova denúncia" notice.
result: [pending]

### 4. VoiceOver and TalkBack walks, the held-out visual rows and the sketch 025 approval kind
expected: the Conversas list, the conversation, the menus and the queue read sensibly with VoiceOver and TalkBack; the 320px and 360px layouts hold (40px gutter trigger, 44px targets, a 60-character name, the story sheet, the community sheet, the ellipsis chip on a photographic cover); the sketch 025 approval kind (now provisional) and its 22 defaults are confirmed.
result: [pending]

### 5. Playwright runs: direct-chat.spec.ts (10 cases) and safety.spec.ts (13 cases)
expected: both specs run green on the two Chromium projects against a seeded local stack (API, web and worker with ffmpeg); the first run may need selector adjustments (toast locator, dialog names, report-sheet radio by label, the `[data-comment-delete]` locators of the four edited shipped specs).
result: [pending]

### 6. Hosted release in order, and the full pnpm verify
expected: migrations on every tenant database first (`pnpm db:migrate-all`), then the web, then the API and the worker together (strict `titleText` push schema); the read-only after-checks of the DEPLOY.md section pass; the full `pnpm verify` (which resets the local database) is green or its reds are the known stale-seed ones.
result: [pending]

### 7. WR-01 policy decision
expected: Igor decides whether a block is silent (the blocked side keeps `canFollow`/`canMessage` true and meets one neutral refusal) or detectable and rate-limited (`follows/state` limited, the conversation-less closed composer kept); WR-02..WR-05 are fixed or accepted in the same decision.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
