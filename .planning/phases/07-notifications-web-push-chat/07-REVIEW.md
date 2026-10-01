---
phase: 07-notifications-web-push-chat
reviewed: 2026-10-01
depth: standard
diff_base: 80ef5b8
files_reviewed: 261
findings:
  critical: 2
  warning: 19
  info: 21
  total: 42
status: issues_found
parts:
  - 07-REVIEW-A-server.md
  - 07-REVIEW-B-modules.md
  - 07-REVIEW-C-web.md
---

# Phase 7 Code Review (consolidated)

The 261 files changed by Phase 7 were reviewed in three parallel passes at standard depth. Each pass has its own report with full detail:

| Area | Report | Files | Critical | Warning | Info |
|------|--------|-------|----------|---------|------|
| A: server, kernel, database | [07-REVIEW-A-server.md](07-REVIEW-A-server.md) | 91 | 1 | 7 | 6 |
| B: modules and `@rede-social/ui` | [07-REVIEW-B-modules.md](07-REVIEW-B-modules.md) | 101 | 0 | 6 | 7 |
| C: web app | [07-REVIEW-C-web.md](07-REVIEW-C-web.md) | 69 | 1 | 6 | 8 |

**Diff base.** The base is `80ef5b8`, the last Phase 7 planning commit. It replaces the workflow's default anchor (the parent of `126ce58`). The planning commits between the two change no code, so the scope is the same either way.

## Critical

- **A-CR-01. A member can join any support conversation in their own tenant.** In `supabase/migrations/20260930190151_chat.sql`, the `chat_participants_access` policy is `FOR ALL`, and its write check is only `user_id = app.user_id()`. A member's tenant session can therefore insert itself as a participant in any conversation of its tenant, and so gain that conversation's messages and its `conv:` Realtime topic. No current API route reaches this path. B-WR-04 and A-WR-01 report the same root cause.
- **C-CR-01. The support thread can drop a message until the page is reloaded.** In `apps/web/app/(app)/suporte/ThreadPane.tsx`, `lastSeqRef` serves as both the catch-up cursor and the replay filter, and sending a message advances it. If a staff reply's signal arrives after the member's own send has returned, that reply is skipped. Every later catch-up then starts past it, so it stays missing until a reload.

## Warnings by theme

- **Chat RLS is too broad (A-WR-01, B-WR-04).** The policies are `FOR ALL`, so a member could post as `author_side='staff'` or rewind `last_seq`.
- **Retraction and deletion gaps:**
  - B-WR-01: a race between fan-out and retraction.
  - B-WR-02: push retries deliver text that was deleted, and the rendered text stays in `pgboss.job`.
  - B-WR-03: story comments deleted through the feed route are never retracted.
  - A-WR-04: retraction is skipped while the module is off.
- **Robustness of bootstrap and counters:**
  - A-WR-02: one failing counter returns a 500 for the whole bootstrap.
  - A-WR-03: a second pooled connection opened inside a transaction can deadlock with `max: 5`.
  - A-WR-07: `conversationsBadge` is required, which forces a manual deploy order.
- **Realtime:**
  - A-WR-05: rejoining a topic while it is still leaving leaves the topic dead.
  - A-WR-06: pgTAP skips the Realtime assertions when no partition exists.
  - B-WR-06: reminders send one Realtime message per recipient, which can exceed Free-plan rates.
- **Web:**
  - C-WR-01: push and `/notificacoes` ignore the notifications module toggle.
  - C-WR-02: requiring `Sec-Fetch-Site` breaks Safari before 16.4.
  - C-WR-03: `NotificationsSurface` has races.
  - C-WR-04: a failed read mark is never retried.
  - C-WR-05: the push switch can stay on "checking" forever.
  - C-WR-06: a subscription survives a sign-out other than through "Sair".
  - B-WR-05: a failed send restores the old draft over newer typing.

The 21 info items are listed in each area report.

## What held up

- **Security-definer functions** pin `search_path`, take the tenant from the session claim, and revoke default execute.
- **Realtime topic handling:** the topic is validated before any cast, and `realtime.messages` has no INSERT policy.
- **URLs:** notification-click URLs are limited to same-origin paths.
- **Untrusted text:** no XSS or open-redirect path was found. Chat and notification text renders as plain text.
- **Tenant isolation:** no cross-tenant leak was found.
