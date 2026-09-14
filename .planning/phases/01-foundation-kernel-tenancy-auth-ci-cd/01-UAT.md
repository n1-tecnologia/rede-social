---
status: testing
phase: 01-foundation-kernel-tenancy-auth-ci-cd
source: [01-VERIFICATION.md]
started: 2026-09-14T19:41:05Z
updated: 2026-09-14T19:41:05Z
---

## Current Test

number: 1
name: AUTH-04 consent controls on /cadastro (judgment-tier prohibition, plan 01-04)
expected: |
  Open http://tria-demo.localhost:3000/cadastro on a phone-sized viewport. Two separate, visibly UNCHECKED checkboxes (community rules of "TRIA Demo"; TRIA terms + privacy), neither pre-checked, not merged into one control, not hidden behind a collapsed section. Submitting with either one unchecked is refused (browser `required`; the API answers 400 VALIDATION_FAILED if the form is bypassed).
awaiting: user response

## Tests

### 1. AUTH-04 consent controls on /cadastro (judgment-tier prohibition, plan 01-04)
expected: Open http://tria-demo.localhost:3000/cadastro on a phone-sized viewport. Two separate, visibly UNCHECKED checkboxes (community rules; TRIA terms + privacy), neither pre-checked, not merged, not collapsed/hidden. Submitting with either unchecked is refused (browser `required` + API 400 VALIDATION_FAILED). Non-authoritative LLM-judge verdict: HONORED (cadastro/[slug]/page.tsx:99-112; signup.spec.ts:96-97; signup.test.ts #6).
result: [pending]

### 2. AUTH-06 suspension disclosure (judgment-tier prohibition, plan 01-05)
expected: Log in as a seeded member, then block the membership via psql (`update public.memberships set status='blocked', blocked_at=now() where user_id=…`), reload /inicio, and read /acesso-suspenso plus the raw 403 body of GET /v1/me/bootstrap with the same token. The screen shows only "Seu acesso a {tenant} foi suspenso. Fale com a equipe." — no reason, no moderator, no timestamp, no hint that the e-mail exists in another tenant; the 403 body's `details` carries only `tenantName`. Non-authoritative LLM-judge verdict: HONORED (acesso-suspenso/page.tsx; require-auth.ts:60; blocked.spec.ts).
result: [pending]

### 3. WR-09 policy consequence — recovery e-mail on Vercel Preview hosts
expected: Decide whether Vercel Preview deployments must be able to send password-recovery e-mails. Either accept that on Preview hosts (`*.vercel.app`, PLATFORM_HOST unset) /esqueci-senha sends NO e-mail and answers the constant D-10 message, or schedule a Preview allow-list env in Phase 01.1 (see 01-REVIEW-FIX.md "Please confirm"). The code path is tested locally (recovery.spec.ts case 6); the intended Preview behaviour is a product/deploy choice.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
