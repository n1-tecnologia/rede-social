---
status: complete
phase: 01-foundation-kernel-tenancy-auth-ci-cd
source: [01-VERIFICATION.md]
started: 2026-09-14T19:41:05Z
updated: 2026-09-14T21:30:08Z
---

## Current Test

[testing complete]

## Tests

### 1. AUTH-04 consent controls on /cadastro (judgment-tier prohibition, plan 01-04)
expected: Open http://rede-demo.localhost:3000/cadastro on a phone-sized viewport. Two separate, visibly UNCHECKED checkboxes (community rules; Rede Social terms + privacy), neither pre-checked, not merged, not collapsed/hidden. Submitting with either unchecked is refused (browser `required` + API 400 VALIDATION_FAILED). Non-authoritative LLM-judge verdict: HONORED (cadastro/[slug]/page.tsx:99-112; signup.spec.ts:96-97; signup.test.ts #6).
result: pass

### 2. AUTH-06 suspension disclosure (judgment-tier prohibition, plan 01-05)
expected: Log in as a seeded member, then block the membership via psql (`update public.memberships set status='blocked', blocked_at=now() where user_id=…`), reload /inicio, and read /acesso-suspenso plus the raw 403 body of GET /v1/me/bootstrap with the same token. The screen shows only "Seu acesso a {tenant} foi suspenso. Fale com a equipe." — no reason, no moderator, no timestamp, no hint that the e-mail exists in another tenant; the 403 body's `details` carries only `tenantName`. Non-authoritative LLM-judge verdict: HONORED (acesso-suspenso/page.tsx; require-auth.ts:60; blocked.spec.ts).
result: pass

### 3. WR-09 policy consequence — recovery e-mail on Vercel Preview hosts
expected: Decide whether Vercel Preview deployments must be able to send password-recovery e-mails. Either accept that on Preview hosts (`*.vercel.app`, PLATFORM_HOST unset) /esqueci-senha sends NO e-mail and answers the constant D-10 message, or schedule a Preview allow-list env in Phase 01.1 (see 01-REVIEW-FIX.md "Please confirm"). The code path is tested locally (recovery.spec.ts case 6); the intended Preview behaviour is a product/deploy choice.
result: pass
note: "User: 'vou testar depois quando deployar na versão' — current Preview behaviour (no recovery e-mail on generic hosts) accepted for now; real check happens on the first Preview deploy in Phase 01.1"

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

## Deferred Follow-Ups

- test: 3
  idea: "Confirm password-recovery behaviour on Vercel Preview hosts during the first Preview deploy (Phase 01.1); add a Preview allow-list env if recovery e-mails are wanted there"
  deferred_at: 2026-09-14
