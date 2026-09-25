---
phase: "06"
slug: "events"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-25"
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `06-RESEARCH.md` §Validation Architecture; threat references come from its §Security Domain.
> The Per-Task Verification Map lists requirement rows only; task IDs are bound when the plans exist.
> Phases 05.2 and 05.3 execute before this phase. Re-read the collision points (pgTAP file number, `registry.test.ts`, `shell.spec.ts` nav lists, the isolation counts, the seed) at execution time rather than trusting the numbers below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (module, ui, web, API suites) · Playwright 1.63.0 (e2e) · pgTAP via `pnpm supabase test db` (CLI 2.117.0) |
| **Config file** | `packages/modules/events/vitest.config.ts` (**new**, clone of communities'), `packages/ui/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/api/vitest.config.ts` (already pins `VIDEO_PROVIDER: 'fake'`), `apps/web/playwright.config.ts`, `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @tria/module-events typecheck && pnpm --filter @tria/module-events lint && pnpm --filter @tria/module-events test` |
| **API integration command** | `pnpm db:reset && pnpm db:seed && pnpm test:integration -- events` (plus `isolation`, `bootstrap`, `modules`) |
| **DB command** | `pnpm supabase test db` |
| **Migration hygiene command** | `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)"` |
| **Full suite command** | `pnpm db:reset && pnpm db:seed && pnpm lint && pnpm typecheck && pnpm test && pnpm boundaries && pnpm supabase test db && pnpm test:integration && pnpm --filter @tria/web build && pnpm check:static-routes && VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts phase6-smoke.spec.ts shell.spec.ts` (the local exit gate remains `pnpm verify`) |
| **Estimated runtime** | quick ~3–5 s per package; API integration ~5–10 s after reset+seed; full suite several minutes (e2e dominated) |

**Plan-file rule:** `<automated>` commands inside PLAN.md XML-escape `&&` as `&amp;&amp;`.

**Video-provider rule (hard):** no validation command may depend on real Mux or a tunnel. Playwright runs are prefixed `VIDEO_PROVIDER=fake`; event covers are **images** only.

**Prefetch rule (D-218):** the "rendering the detail page records nothing" case must run against a production build (`next start`), because Next only prefetches in production — a dev-server run passes vacuously. Use a scratchpad Playwright config overriding `baseURL` to :3100 (the 05.1-05 pattern).

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the touched package (plus `pnpm --filter @tria/web exec vitest run <folder>` for web tasks, `pnpm --filter @tria/ui test` for `SegmentedControl`)
- **After every plan wave:** `pnpm db:reset && pnpm db:seed && pnpm test:integration -- events` + `pnpm supabase test db` + the migration hygiene command + `bash scripts/check-ui-literals.sh`
- **Before `/gsd-verify-work`:** Full suite must be green (`pnpm verify`), then the phone UAT replay below (RSVP, code at the "venue", `Entrar` from a calendar entry, `.ics` import on iOS and Google)
- **Max feedback latency:** 10 seconds (quick tier)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | EVENT-01 (create/edit/cancel/reactivate API) | V4 access control · cross-tenant IDOR | Member 403 on every write; format XOR + time-window CHECKs; wall-clock → UTC in the tenant's timezone; cover tuple 400 / foreign asset bare 404; reactivate refused after start; domain events emitted once, after commit | integration + pgTAP + module unit | `pnpm test:integration -- events`; `pnpm supabase test db`; `pnpm --filter @tria/module-events test` | ❌ W0 (`apps/api/tests/integration/events.test.ts`, `supabase/tests/130-events.sql`, `packages/modules/events/tests/*.test.ts`) | ⬜ pending |
| TBD | TBD | TBD | EVENT-01 (admin form on a phone) | V5 input validation · stored XSS | Create → detail, edit, cancel → banner, Reativar; `+2 h` end prefill; format switch submits only the visible side; description rendered as text | e2e (mobile-chromium) + web unit | `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts -g "admin"`; `pnpm --filter @tria/web exec vitest run "app/(app)/eventos"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-02 (lists + detail in tenant timezone) | — | Próximos/Passados keysets (asc/desc, ties, in-progress stays upcoming, cancelled stays listed); `/next` excludes cancelled; detail rendered in the tenant's timezone under `timezoneId: 'America/Manaus'` | integration + pgTAP EXPLAIN (index by name) + web unit + e2e | `pnpm test:integration -- events`; `pnpm supabase test db`; `pnpm --filter @tria/web exec vitest run lib/events-view`; `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts -g "lista"` | ❌ W0 (`apps/web/lib/events-view.test.ts`, fixed clock/tz) | ⬜ pending |
| TBD | TBD | TBD | EVENT-03 (RSVP + count) | Tampering (window race) | RSVP toggle; repeat answer = no write, no event; `rsvp_closed` at `starts_at` (API 409 + pgTAP trigger raise under relative `now()`); locked after check-in; count semantics per D-219 | integration + pgTAP + e2e | `pnpm test:integration -- events`; `pnpm supabase test db`; `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-04 (check-in + walk-in) | Elevation (code brute force) · Tampering (self check-in via UPDATE) · CSRF/prefetch on `/entrar` | Code check-in inside the window; `not_open` / `closed` / `cancelled`; walk-in from no row and from `not_going`; wrong code; 6th attempt `too_many_attempts` even with the right code; online `/enter` outcomes (`forward` records nothing, `recorded` walk-in, `ended`, `confirm_first`); the RLS lane cannot write `checked_in`/`walk_in`; detail render records nothing (prod build) | pgTAP (definer functions from both tenants) + integration + e2e | `pnpm supabase test db`; `pnpm test:integration -- events`; `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts -g "check-in\|entrar"` (prod `next start` for the D-218 case) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-05 (admin attendance list) | Information disclosure (meeting URL / code) | Participantes: three chips + counts + keyset + walk-in tag + removed member; code card; member 403 on attendance routes; **member lane reads 0 rows of `event_secrets`, admin lane reads 1** | pgTAP + integration + e2e | `pnpm supabase test db`; `pnpm test:integration -- events`; `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts -g "participantes"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-06 (.ics + Google link) | Tampering (ICS property injection) · Information disclosure (meeting URL) | `.ics` bytes: CRLF, 75-octet folding with accents, RFC 5545 escaping (hostile title), UTC DTSTART/DTEND; online LOCATION is the app's `/entrar`, never the meeting URL; Google link uses `…Z` dates and no `ctz`; download works in e2e | web unit + e2e | `pnpm --filter @tria/web exec vitest run lib/events-calendar`; `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test events.spec.ts -g "agenda"` | ❌ W0 (`apps/web/lib/events-calendar.test.ts`) | ⬜ pending |
| TBD | TBD | TBD | TENANT-05 gate (all new tables/routes) | IDOR / Spoofing | Four new tables in `020` (A sees own, zero of B, positive control); each new endpoint: other tenant's id → bare 404, host mismatch → 403 | pgTAP + integration | `pnpm supabase test db`; `pnpm test:integration -- isolation` | ✅ files exist; cases ❌ W0 (extend `020`, recount `plan()`; `isolation.test.ts`) | ⬜ pending |
| TBD | TBD | TBD | MOD-02/04 (module wiring) | V4 access control | Registry lists `events`; tab order 40; home-slot order 7; module off → routes 404 and tab gone; boundaries clean | API unit + integration + boundaries | `pnpm --filter @tria/api test`; `pnpm test:integration -- modules`; `pnpm boundaries` | ✅ (update `registry.test.ts`) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/modules/events/` package scaffold including `vitest.config.ts` (Vitest 5 does not walk up) and `tests/`
- [ ] `apps/api/tests/integration/events.test.ts`, with fixtures that insert events relative to `now()` through `adminSql`
- [ ] `supabase/tests/130-events.sql` (number re-checked against 05.2's 120) plus the `020` cases and the `plan()` recount
- [ ] `apps/web/lib/events-view.test.ts`, `apps/web/lib/events-calendar.test.ts`, `packages/ui/tests/segmented-control.test.tsx`
- [ ] `apps/web/e2e/events.spec.ts` + `events-admin.ts` fixtures; `phase6-smoke.spec.ts`; the production-build config for the D-218 case
- [ ] Any TDD plan: the throwaway TAP normalizer (Vitest emits no TAP) — never fabricated counts
- [ ] Update, not delete: `registry.test.ts:53`, `shell.spec.ts` nav lists, `bootstrap.test.ts` tenant keys
- [ ] No framework installs — Vitest, Playwright and pgTAP are already in place

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Phone UAT replay (CONTEXT `<specifics>`) | EVENT-01..06 | Real-device flow: a code read aloud at a venue, a calendar app handing a link back to the installed PWA | 1) as admin, create an in-person and an online event from a phone; 2) as a member, confirm, then change to not going and back; 3) inside the window, check in with the code the admin reads out, and once with a wrong code; 4) as a member with no RSVP, check in (walk-in); 5) as admin, open Participantes and confirm the confirmed vs present split; 6) cancel an event and confirm the confirmed member still sees it, cancelled |
| Calendar import on iOS and Google | EVENT-06 | Calendar apps' parsing of `.ics` and of the Google template link cannot be driven from Playwright | Download the `.ics` on iOS and import it; open the Google Calendar link; confirm title, times in the tenant's timezone, and (online event) that the location is the app's `/entrar` link, not the meeting URL |
| `Entrar` from a calendar entry | EVENT-04 | Installed-PWA cookie behaviour when a calendar app opens the link (research assumption, iOS) | From the calendar entry of an online event, tap the link inside the window: it opens the meeting and the member shows as present; outside the window it forwards without recording |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
