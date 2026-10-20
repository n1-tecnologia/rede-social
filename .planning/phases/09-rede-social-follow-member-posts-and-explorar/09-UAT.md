---
status: testing
phase: 09-rede-social-follow-member-posts-and-explorar
source: [09-VERIFICATION.md]
started: 2026-10-20T13:36:16Z
updated: 2026-10-20T13:36:16Z
---

## Current Test

number: 1
name: Real-device PWA walk on the hosted stack
expected: |
  Everything works in an installed PWA on an iPhone (Safari) and an Android (Chrome): Explorar chips, the member composer (photo and video), the Siga para ver screen, Reels from Explorar and back; the push for the comment and reply notices arrives and opens the post with the comment focused.
awaiting: user response

## Tests

### 1. Real-device PWA walk on the hosted stack
expected: Explorar chips, the member composer (photo and video), the Siga para ver screen, Reels from Explorar and back, push for the comment and reply notices all work in an installed PWA on an iPhone (Safari) and an Android (Chrome); the push arrives and opens the post with the comment focused.
note: phones cannot reach *.localhost; push and HLS need the hosted stack (09-VALIDATION Manual-Only).
result: [pending]

### 2. Playwright specs of the phase
expected: social.spec.ts, social-platform.spec.ts and phase9-smoke.spec.ts are green against a freshly seeded database, in particular the Seguir control and the counts block after plan 09-17 changed FollowControl and SocialCountsBlock.
note: Playwright was not run anywhere in the gap round (unrun-verify); needs about 10 GiB free disk and a db:reset + db:seed (ask first).
result: [pending]

### 3. Visual fidelity against sketch 012
expected: the designed screens match the approved sketch at 320 and 390 px, in light and dark, under a tenant brand. The designer review (D-33) is a follow-up; the sketch was approved only provisionally on 2026-10-19.
result: [pending]

### 4. Real Mux upload of a member video
expected: (a) over the tenant duration cap ends `rejected` with the duration reason; (b) with no reported duration ends `failed` with the unmeasurable reason; the provider asset is deleted in both.
note: local runs use the fake provider (same applyReady path); this is also where the event-job ordering residual (review WR-05) would show.
result: [pending]

### 5. Legal wording, IN-01 check and one uninterrupted verify
expected: legal text of the terms of use, community rules and privacy policy for third-party content (D-478) settled with the operator before the super_admin turns `social` on for any tenant; tenants that had settings.postingPolicy = 'members' checked (IN-01); one green `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` on a freshly seeded database including e2e (WINDOWS 123).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
