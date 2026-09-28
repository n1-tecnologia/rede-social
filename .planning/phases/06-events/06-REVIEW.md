---
phase: 06-events
reviewed: 2026-09-28T00:00:00Z
depth: standard
files_reviewed: 130
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/app.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/me.ts
  - apps/api/tests/integration/bootstrap.test.ts
  - apps/api/tests/integration/events-admin.test.ts
  - apps/api/tests/integration/events-attendance.test.ts
  - apps/api/tests/integration/events-checkin.test.ts
  - apps/api/tests/integration/events-rsvp.test.ts
  - apps/api/tests/integration/events.test.ts
  - apps/api/tests/integration/feed-query-budget.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - apps/api/tests/integration/modules.test.ts
  - apps/api/tests/unit/registry.test.ts
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx
  - apps/web/app/(app)/configuracoes/midia/page.tsx
  - apps/web/app/(app)/eventos/EventForm.test.tsx
  - apps/web/app/(app)/eventos/EventForm.tsx
  - apps/web/app/(app)/eventos/EventsList.test.tsx
  - apps/web/app/(app)/eventos/EventsList.tsx
  - apps/web/app/(app)/eventos/[eventId]/CancelEventControl.tsx
  - apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx
  - apps/web/app/(app)/eventos/[eventId]/EventActions.tsx
  - apps/web/app/(app)/eventos/[eventId]/EventDescription.tsx
  - apps/web/app/(app)/eventos/[eventId]/EventRefresh.tsx
  - apps/web/app/(app)/eventos/[eventId]/ReactivateEventControl.tsx
  - apps/web/app/(app)/eventos/[eventId]/agenda.ics/route.ts
  - apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.test.tsx
  - apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.tsx
  - apps/web/app/(app)/eventos/[eventId]/check-in/page.tsx
  - apps/web/app/(app)/eventos/[eventId]/editar/page.tsx
  - apps/web/app/(app)/eventos/[eventId]/entrar/aviso/page.tsx
  - apps/web/app/(app)/eventos/[eventId]/entrar/route.test.ts
  - apps/web/app/(app)/eventos/[eventId]/entrar/route.ts
  - apps/web/app/(app)/eventos/[eventId]/loading.tsx
  - apps/web/app/(app)/eventos/[eventId]/not-found.tsx
  - apps/web/app/(app)/eventos/[eventId]/page.tsx
  - apps/web/app/(app)/eventos/[eventId]/participantes/ActiveChipInView.tsx
  - apps/web/app/(app)/eventos/[eventId]/participantes/ParticipantsList.test.tsx
  - apps/web/app/(app)/eventos/[eventId]/participantes/ParticipantsList.tsx
  - apps/web/app/(app)/eventos/[eventId]/participantes/RegenerateCodeControl.tsx
  - apps/web/app/(app)/eventos/[eventId]/participantes/page.tsx
  - apps/web/app/(app)/eventos/actions.ts
  - apps/web/app/(app)/eventos/loading.tsx
  - apps/web/app/(app)/eventos/novo/not-found.tsx
  - apps/web/app/(app)/eventos/novo/page.tsx
  - apps/web/app/(app)/eventos/page.tsx
  - apps/web/app/(app)/inicio/feed-actions.ts
  - apps/web/app/(app)/post/[postId]/page.tsx
  - apps/web/components/events/NextEventRefresh.tsx
  - apps/web/components/media/MediaAssetRow.tsx
  - apps/web/e2e/admin.ts
  - apps/web/e2e/comunidades.spec.ts
  - apps/web/e2e/events-admin.ts
  - apps/web/e2e/events-prefetch.spec.ts
  - apps/web/e2e/events.spec.ts
  - apps/web/e2e/fixtures/README.md
  - apps/web/e2e/media-video.spec.ts
  - apps/web/e2e/phase2-smoke.spec.ts
  - apps/web/e2e/phase4-smoke.spec.ts
  - apps/web/e2e/phase5-smoke.spec.ts
  - apps/web/e2e/phase52-smoke.spec.ts
  - apps/web/e2e/phase6-smoke.spec.ts
  - apps/web/e2e/platform-branding.spec.ts
  - apps/web/e2e/reels.spec.ts
  - apps/web/e2e/shell.spec.ts
  - apps/web/e2e/stories.spec.ts
  - apps/web/i18n/messages.test.ts
  - apps/web/lib/continue-path.test.ts
  - apps/web/lib/continue-path.ts
  - apps/web/lib/events-calendar.test.ts
  - apps/web/lib/events-calendar.ts
  - apps/web/lib/events-view.test.ts
  - apps/web/lib/events-view.ts
  - apps/web/lib/events.ts
  - apps/web/lib/feed-view.test.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/reels.test.ts
  - apps/web/lib/reels.ts
  - apps/web/lib/registry.tsx
  - apps/web/messages/pt-BR/events.json
  - apps/web/package.json
  - apps/web/playwright.pwa.config.ts
  - packages/contracts/src/bootstrap.ts
  - packages/core/docs/SCHEMA-CONVENTIONS.md
  - packages/modules/events/contracts/index.ts
  - packages/modules/events/db/schema.ts
  - packages/modules/events/module.ts
  - packages/modules/events/package.json
  - packages/modules/events/server/checkin-code.ts
  - packages/modules/events/server/index.ts
  - packages/modules/events/server/routes.ts
  - packages/modules/events/server/service.ts
  - packages/modules/events/tests/checkin-code.test.ts
  - packages/modules/events/tests/contracts.test.ts
  - packages/modules/events/tests/event-detail-ui.test.tsx
  - packages/modules/events/tests/event-poster.test.tsx
  - packages/modules/events/tests/event-ticket.test.tsx
  - packages/modules/events/tests/events-payload.test.ts
  - packages/modules/events/tests/next-event-card.test.tsx
  - packages/modules/events/tests/participants-ui.test.tsx
  - packages/modules/events/tsconfig.json
  - packages/modules/events/turbo.json
  - packages/modules/events/ui/AttendeeRow.tsx
  - packages/modules/events/ui/CheckinCodeCard.tsx
  - packages/modules/events/ui/EventCover.tsx
  - packages/modules/events/ui/EventHero.tsx
  - packages/modules/events/ui/EventInfoGrid.tsx
  - packages/modules/events/ui/EventPoster.tsx
  - packages/modules/events/ui/EventTicket.tsx
  - packages/modules/events/ui/NextEventCard.tsx
  - packages/modules/events/ui/index.ts
  - packages/modules/events/vitest.config.ts
  - packages/ui/src/index.ts
  - packages/ui/src/primitives/SegmentedControl.tsx
  - packages/ui/tests/segmented-control.test.tsx
  - scripts/check-static-routes.sh
  - scripts/seed.ts
  - supabase/migrations/20260927145318_events.sql
  - supabase/migrations/20260927154326_event_attendances.sql
  - supabase/migrations/20260927154335_event_attendance_guard.sql
  - supabase/migrations/20260927185909_event_checkin_attempts.sql
  - supabase/migrations/20260927185926_event_check_in_function.sql
  - supabase/migrations/20260927193130_event_enter_function.sql
  - supabase/tests/020-tenant-isolation.sql
  - supabase/tests/140-events.sql
  - supabase/tests/141-event-attendances.sql
  - supabase/tests/142-event-checkin.sql
findings:
  critical: 1
  warning: 5
  info: 5
  total: 11
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-09-28T00:00:00Z
**Depth:** standard
**Files Reviewed:** 130
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

Scope was the Phase 6 diff (`6c1c850..HEAD`). For files that existed before Phase 6 (the feed-view, reels, MediaAssetRow and comunidades/inicio/post call sites, the continue-path file, and the older e2e specs), only the Phase 6 hunks were reviewed.

The tenant-isolation posture holds up under tracing:
- Both SECURITY DEFINER functions (`app.events_check_in`, `app.events_enter`) set `search_path = ''`, qualify every name, filter every statement by `tenant_id = app.tenant_id()` and, where needed, by `user_id = app.user_id()`. EXECUTE is revoked from PUBLIC.
- `event_secrets` is gated on `tenant_role = 'admin_tenant'` in both USING and WITH CHECK.
- No member payload has a key that could carry the meeting URL or the code.
- The `/entrar` route handler has no open redirect. The destination comes only from the database and is re-checked to be `https:`. The 204 guard covers prefetch and RSC requests.
- `agenda.ics` reads the member-lane payload only, and its ICS TEXT escaping and octet folding are correct.
- `safeContinuePath` rejects protocol-relative URLs and control bytes, and re-runs the allow-list.

The one blocker is in the brute-force bound. The limit on wrong venue-code guesses is not enforced under concurrency, so the invariant "at most 5 wrong codes per member per event per 15 minutes" can be bypassed. The warnings cover:
- a 500 on a tampered events-list cursor (the attendance list has a guard for this, the events list does not);
- a code input that cannot accept the separators the backend normalises away;
- a boundary refresh that misses its transition on a device whose clock runs fast;
- a broken cover when its asset is soft-deleted;
- a guess budget that grows with event length and with the number of accounts.

## Critical Issues

### CR-01: The check-in guess bound can be bypassed with concurrent requests (the first burst per member per event is unlimited)

**File:** `supabase/migrations/20260927185926_event_check_in_function.sql:117-150`
**Issue:** Step 5 enforces the D-217 bound with `select … from public.event_checkin_attempts … for update of x`. `FOR UPDATE` locks only a row that already exists. On a member's first guesses for an event there is no row yet, so nothing is locked. Every concurrent call passes step 5 (`found` is false), reaches the comparison in step 6, and only then meets the others at the `insert … on conflict do update`. That upsert serialises the counter increments but not the guesses. N parallel `POST /v1/events/{id}/check-in` requests therefore evaluate N codes before the counter reaches 5. The function's header says "`for update` serialises one member's parallel guesses", which is false for this case. After the row exists, later bursts are serialised correctly.

The code space is 31^4 = 923,521, and the code is the only proof of physical presence. Signup is self-service (`/auth/signup?tenant=`), so every fresh account gets another unbounded burst. The stated bound ("at most 5 wrong codes per member per event per 15-minute window", T-06-27) does not hold. pgTAP fact 11 and the integration tests exercise only sequential guesses, so none of them can catch this.

**Fix:** Create or lock the counter row BEFORE reading it, so the first guess also takes the row lock:
```sql
  -- 5. The guess bound. Materialise the row first so FOR UPDATE always has something to lock:
  insert into public.event_checkin_attempts (tenant_id, event_id, user_id, failed_count, window_started_at)
  values (v_t, p_event_id, v_u, 0, now())
  on conflict on constraint event_checkin_attempts_pkey do nothing;

  select x.failed_count, x.window_started_at
    into v_failed, v_window
    from public.event_checkin_attempts x
   where x.tenant_id = v_t and x.event_id = p_event_id and x.user_id = v_u
     for update of x;
```
A concurrent inserter blocks on the uncommitted index entry, so every caller then serialises on the same row. Another option is `perform pg_advisory_xact_lock(hashtextextended(v_t::text || p_event_id::text || v_u::text, 0));` at the top of step 5. Add a pgTAP or integration case that fires about 20 wrong codes in parallel from one member and asserts that at most 5 are answered `wrong_code` and the rest `too_many_attempts`.

## Warnings

### WR-01: `GET /v1/events` returns 500 on a well-formed cursor whose `n` is not a timestamp

**File:** `packages/modules/events/server/service.ts:175-206`
**Issue:** `listEvents` passes `decodeCursor(query.cursor)?.n` straight into `${afterAt}::timestamptz`. `decodeCursor` only proves that `n` is a string (`cursorSchema` has `n: z.string()`). So `encodeCursor({ n: 'x', id: <uuid> })` reaches Postgres, fails the cast (22007) and becomes a 500, although the docblock at line 171 promises that a tampered envelope degrades to page 1 (T-06-04). `listAttendance` in the same file saw this and added `CURSOR_INSTANT` (lines 1243, 1284), but `listEvents` never got it. The hostile-cursor test (`events.test.ts:268-279`) only covers a bad base64, a bad version and a bad uuid, never a bad `n`.
**Fix:** Apply the same guard in `listEvents`:
```ts
const decoded = decodeCursor(query.cursor);
const after = decoded && CURSOR_INSTANT.test(decoded.n) ? decoded : null;
```
Add `encodeCursor({ n: 'not-a-date', id: UUID })` to the hostile list in `events.test.ts` case 4.

### WR-02: The code input's `maxLength` counts separators that the backend strips, so a member typing "K7 QM" or "K7-QM" is stuck

**File:** `apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.tsx:16,121-122,192`
**Issue:** The contract, the SQL function and `normalize` all treat `k7-qm` and ` K7 QM ` as the same guess, and the `checkinSchema` bound is deliberately 16 "because the database normalises". But the `<Input>` has `maxLength={EVENT_CHECKIN_CODE_LENGTH}` (4) on the RAW value. The admin card shows the code with `tracking-[0.3em]` (`CheckinCodeCard.tsx:60`), which invites spaces. "K7 Q" hits the 4-character limit while `normalize` gives only 3 characters, so `ready` stays false and the submit stays disabled. The member cannot type the 4th character, and a paste of "K7-QM" is truncated to "K7-Q".
**Fix:** Strip the separators in `onChange` instead of relying on `maxLength`:
```tsx
onChange={(change) => {
  setValue(normalize(change.target.value).slice(0, EVENT_CHECKIN_CODE_LENGTH));
  if (!locked) setError(null);
}}
```
Alternatively, drop `maxLength` to `checkinSchema`'s 16 and keep `ready` on the normalised length.

### WR-03: The boundary refresh misses its transition for good when the device clock runs ahead of the server

**File:** `apps/web/app/(app)/eventos/[eventId]/EventActions.tsx:89-101`, `apps/web/components/events/NextEventRefresh.tsx:32-45`
**Issue:** The timer fires at `boundary − Date.now() + 1s` on the DEVICE clock, and the server decides the phase from ITS clock. If the device runs more than 1 s fast, `router.refresh()` lands before the server boundary, and the server draws the same `phase`. The effect's dependencies (`checkinOpensAt`, `startsAt`, `endsAt`, `phase`, `router`) are unchanged, so it never re-runs. Even if it did, the `ms > now` filter would already have dropped that boundary. The detail's action zone and the Início card then never switch to "Fazer check-in" / `Entrar` until a manual pull. That is the UI-D-203 behaviour this code exists to provide, and it fails at exactly the moment a member is at the door.
**Fix:** After a refresh that did not change `phase`, retry a few times with a short backoff. For example, keep the fired boundary in a ref, and if `phase` is still the pre-boundary phase, schedule `router.refresh()` again after 2 s, 5 s and 15 s. Another option is to have the server send `serverNowMs` and compute the delay as `boundary − serverNowMs + (Date.now() − mountedAt)`. Extract the shared timer into one hook, since the two copies are already identical (see IN-03).

### WR-04: A soft-deleted cover asset renders as an empty dark box instead of the gradient fallback

**File:** `packages/modules/events/server/service.ts:99-117,697-712`
**Issue:** The projection returns `e.cover_asset_id` unconditionally, while `a.variant_widths` comes from a `left join media_assets` that `media_assets_tenant_select` filters to `deleted_at is null`. When an admin retires the cover in `/configuracoes/midia`, members get `coverAssetId: <uuid>` with `coverVariantWidths: []`. `EventCover` takes the image branch (`coverAssetId !== null`, `EventCover.tsx:54`), and `MediaImage` with an empty ladder renders no `<img>` and no fallback. Posters, the hero, the ticket and the Início card then show a black veil over nothing instead of the D-69 gradient. `updateEvent` self-heals the id only on the next edit.
**Fix:** Null the id when the join misses, in both `eventColumns` and `getEventForEdit`:
```sql
case when a.id is null then null else e.cover_asset_id end as cover_asset_id,
```
The poster then takes the gradient branch, and the edit form shows "no cover" instead of a dead reference.

### WR-05: The guess budget scales with event length and account count, because nothing bounds either

**File:** `supabase/migrations/20260927185926_event_check_in_function.sql:124`, `packages/modules/events/contracts/index.ts:171-207`
**Issue:** Even with CR-01 fixed, the bound is 5 wrong guesses per 15 minutes per member, which is 20 per hour, applied over the whole window `[starts_at − 1h, ends_at)`. `eventInputSchema` puts no cap on `end − start`, and the seed itself ships a 72-hour event. One account on that event gets about 1,460 guesses (about 0.16% of the space). Accounts are self-service, and there is no per-event aggregate limit, so an attacker's success probability grows linearly with the number of accounts. The code is the only thing that makes "Presente" mean "was there" (checkin-code.ts:9).
**Fix:** Add a per-event aggregate bound inside `app.events_check_in`. For example, count wrong guesses across all members in the last 15 minutes from a per-event counter row, and above a threshold refuse (or flag the event so the admin sees "Gerar novo código" highlighted). Optionally cap the event duration in `eventInputSchema`, or lengthen the code for multi-day events. At minimum, record the accepted risk explicitly in the threat model next to T-06-27.

## Info

### IN-01: `tenants.timezone` is now load-bearing on every page but has no CHECK

**File:** `packages/contracts/src/bootstrap.ts:28-31`, `apps/web/lib/feed-view.tsx` (`absoluteTimeFormatter`)
**Issue:** Before Phase 6 the zone was the constant `America/Sao_Paulo`. Now the feed, comments, media library and events all build `new Intl.DateTimeFormat(…, { timeZone })` from `bootstrap.tenant.timezone`, which the contract validates as `z.string()` only, and the column is `text` with no CHECK. A bad value throws `RangeError` in every render. The SQL `at time zone t.timezone` in create and update would also fail. No write path exists yet, so this is latent.
**Fix:** Add `check (timezone in (select name from pg_timezone_names))`, or validate the value when it is written, and refine the Zod schema with `Intl.supportedValuesOf('timeZone')`.

### IN-02: The edit page shows the not-found screen on a transport failure

**File:** `apps/web/app/(app)/eventos/[eventId]/editar/page.tsx:30-31`
**Issue:** `if (result.status !== 'ok') notFound();` treats `loadEventForEdit`'s `'error'` (5xx or network) like a miss. The detail, check-in and participantes pages all render a retry screen for `'error'`, so the admin here is told the event does not exist.
**Fix:** Branch on `'not-found'` only, and render the same `EmptyState` retry card the detail page uses for `'error'`.

### IN-03: Duplicated logic that can drift

**File:** `apps/web/app/(app)/eventos/[eventId]/EventActions.tsx:12-15,89-101`, `apps/web/components/events/NextEventRefresh.tsx:6-45`, `packages/modules/events/server/checkin-code.ts:25-27`, `apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.tsx:16`
**Issue:** The boundary-refresh effect and its two constants are copied verbatim between `EventActions` and `NextEventRefresh`. `normalizeCheckinCode` is exported from `@tria/module-events/server` but no production code calls it (only its test does). `CheckinForm` has its own copy, and the real normalisation is the SQL `regexp_replace` in the function, whose `[[:space:]]` class may differ from JS `\s` (for example on U+00A0).
**Fix:** Extract a `useBoundaryRefresh(boundaries, phase)` hook. Move `normalizeCheckinCode` to `contracts` so the client imports it, or drop the unused server export.

### IN-04: Event-id validation differs between server actions

**File:** `apps/web/app/(app)/eventos/actions.ts:147,225,345,373`
**Issue:** The attendance and regenerate actions validate `eventId` with `EVENT_ID_RE` (lines 414-415). `rsvpEventAction`, `checkInEventAction`, `updateEventAction` and `statusAction` only check `length > 0`, so a crafted id costs an API round-trip and is logged as `*_failed` noise. This is not exploitable: the id is `encodeURIComponent`-ed, and `revalidatePath` only runs after an API success.
**Fix:** Use `isEventId(eventId)` in every action that takes an id.

### IN-05: A bootstrap hiccup after a successful check-in is reported as a failure

**File:** `apps/web/app/(app)/eventos/actions.ts:232-235`
**Issue:** `Promise.all([getBootstrap(), checkIn(...)])` rejects if the bootstrap read fails, even when the check-in committed. The member then sees "failed" although they are present. If both reject, whichever rejects first wins, so a `wrong_code` refusal can be masked as `failed`. A retry self-heals as `already`.
**Fix:** Await `checkIn` first, map its refusals, and only then read the bootstrap for `doneLine`. If that read fails, fall back to an ISO or UTC line rather than failing the whole action.

---

_Reviewed: 2026-09-28T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
