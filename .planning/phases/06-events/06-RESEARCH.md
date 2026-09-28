# Phase 6: Events - Research

**Researched:** 2026-09-25
**Domain:** New feature module `@rede-social/module-events` (Drizzle schema + RLS + SECURITY DEFINER check-in functions, Hono routes, Next.js 16 App Router screens, route handlers for `/entrar` and `.ics`)
**Confidence:** HIGH for codebase patterns and Postgres behaviour (probed live on the local stack); MEDIUM for the Google Calendar template link (community docs only); LOW for nothing load-bearing.

## Summary

Phase 6 is a fourth module built on the Phase 5 `communities` template: its own package, one manifest entry per tier, a tab at `nav.order` 40, a home slot at order 7, keyset lists, permission-guarded writes, domain events emitted after commit, and pgTAP plus API isolation cases. Most of the work is the ordinary pattern. Three parts are new to this repo and carry the risk:

1. **Two secrets (the check-in code and the online meeting URL) that the tenant's own members must not be able to read, even from their own tenant lane.** Every table so far uses `tenantIsolationPolicy` only, which lets any lane in the tenant read every row. I verified on the local Postgres 17.6 that the lane already carries the member's role as a claim (`app.tenant_role()`, set by `withTenantTx` from `ctx.role`). A policy keyed on that claim hides a row from a `member` lane and shows it to an `admin_tenant` lane. The member paths that need a secret (typing the code, following `Entrar`) then go through two `SECURITY DEFINER` functions in the `app` schema that enforce the gate inside Postgres. Those functions run as `postgres`, which has `rolbypassrls = t`, so each must filter `tenant_id = app.tenant_id()` itself.
2. **Time rules that the database must refuse, not just the UI:** RSVP closes at `starts_at`, and check-in is allowed from `starts_at − 1 h` to `ends_at`. A CHECK cannot read another table, so the recommendation is a `BEFORE INSERT OR UPDATE` trigger on `event_attendances`. It reads the event `FOR SHARE` and raises SQLSTATE `23514` with a named constraint. I verified that `RAISE … USING constraint = …` puts that name in the error, so the service maps it exactly as it maps a CHECK violation today. Only the tenant's own RSVP statuses are writable through RLS; `checked_in` and `walk_in` can only be written by the definer functions.
3. **A GET with a side effect (`/eventos/{id}/entrar`) whose URL goes into members' calendars.** Next only prefetches `<Link>`, and only in production builds. The Serwist SW already marks every navigation NetworkOnly. The session cookie is `SameSite=Lax`, so an unfurler or a `<img>` from another site carries no session and records nothing. The handler also refuses to act on `Sec-Purpose: prefetch`. The D-218 test must run against a production `next start`, because a dev server never prefetches and would pass vacuously.

Timezone handling needs no library. The admin enters wall-clock date and time. The service converts inside SQL with `(date || ' ' || time)::timestamp at time zone tenants.timezone`, which uses Postgres's own tzdata; I checked it on the live stack, including DST gap behaviour. Rendering uses `Intl.DateTimeFormat('pt-BR', { timeZone })` on the server. Node 24.14 has no `Temporal` (probed), and `date-fns` is not installed. The bootstrap gains `tenant.timezone`. That also retires the two `America/Sao_Paulo` pins in `feed-view.tsx` and `MediaAssetRow.tsx`.

**Primary recommendation:** Clone the `communities` module shape. Put the code and URL in a separate `event_secrets` table behind a role-claim policy. Route every check-in through `app.events_check_in` / `app.events_enter` SECURITY DEFINER functions that **return** an outcome rather than raising, so the wrong-guess counter commits. Enforce every time rule in one trigger. Build the `.ics` and the Google link in the web tier from UTC instants. Add no package.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Event create/edit/cancel/reactivate | API (`@rede-social/module-events/server`, `withTenantTx`) | Database (CHECKs, XOR, deferrable FKs, guarded UPDATE) | Business rules live in the API; invariants that must hold for every writer live in the schema |
| Wall-clock → UTC conversion | Database (`timestamp at time zone tenants.timezone`) | API (Zod shape of `{date,time}`) | Postgres tzdata is authoritative; no JS tz math, no library |
| Upcoming / past lists, Início "next event" | API (keyset reads) | Database (tenant-first indexes) | One statement per page, counts in the same statement |
| RSVP | API route → tenant lane upsert | Database (self-only RLS + guard trigger) | "DB refuses after `starts_at`" is a trigger fact, not a UI rule |
| In-person check-in (code) | Database (`app.events_check_in` SECURITY DEFINER) | API (maps outcome → HTTP) | The code is unreadable by the member lane, so the comparison must run where the code is |
| Online `Entrar` gate + check-in | Database (`app.events_enter` SECURITY DEFINER) | Frontend server (Next route handler `GET /eventos/{id}/entrar` → 303) | The URL never reaches a member page; the gate runs at click time |
| Guess bounding | Database (`event_checkin_attempts`, written only by the definer) | — | No rate-limit infra exists; a DB counter is the only shared state |
| Attendance list + code display | API (`events.attendance.read`) | Database (role-claim policy on `event_secrets`) | Defense in depth: an API bug still cannot hand a member the code |
| Tenant-timezone formatting, relative labels | Frontend server (RSC, `apps/web/lib/events-view.ts`) | Browser (boundary `router.refresh()` only) | No `Date.now()` in render (UI-D-14); strings cross to the client |
| `.ics` download + Google Calendar link | Frontend server (route handler / page) | — | Needs the tenant's public origin (`primaryHostOrigin()`), which only the web tier knows |
| Cover upload | Browser → Storage (signed upload) | API media broker | Phase 3 machinery, unchanged |
| Domain events for Phase 7 | API (`emit` after commit) | — | MOD-03; the payloads must be self-sufficient (modules cannot import each other) |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried forward (locked before this discussion — do not re-open)
- **Timezone** (roadmap Phase 6 "Research needed"):
  - Instants are stored as `timestamptz` (UTC) and rendered in `tenants.timezone`. The column already exists, `not null default 'America/Sao_Paulo'`, in `packages/core/db/schema/tenants.ts:28`.
  - The admin enters start and end as wall-clock times in the **tenant's** timezone, whatever the device's timezone is.
  - The bootstrap payload does not carry the timezone yet. `apps/web/lib/feed-view.tsx` and `apps/web/components/media/MediaAssetRow.tsx` pin the column default while waiting for "a later phase" to add it. This phase is that phase.
- **Design source (D-66):** port what `reference/frontend-design/` has:
  - `events/page.tsx`: the poster card and the "Nada por aqui ainda" empty card.
  - `events/[eventId]/page.tsx`: the sticky back header, the hero card, the `Info` grid and the full-width CTA.
  - `event-checkin/page.tsx`: the boarding-pass confirmation.

  Only the surfaces the prototype lacks go through D-33 (UI-SPEC plus a `/gsd-sketch` mockup review): the create/edit form, the RSVP pair, code entry, the online variant, the Início card and the `Participantes` screen.
- **Navigation (D-55):**
  - `Eventos` is a BottomNav/rail **tab**: `nav: { placement: 'tab', … }` in the module manifest, driven by the module flag and never by data (D-77).
  - The Início card (D-202) is a `home` slot.
- **Authorisation:** every write is guarded by `requirePermission('events.…')`, never `requireRole` (04-01). V1 grants the manage permission to `admin_tenant` only, through `defaultRolePermissions`.
- **No new infrastructure:** covers go through the Phase 3 media broker (`useSignedUpload`, `GET /v1/media/{id}/{variant}`). Lists use the one keyset envelope (`packages/core/server/paging.ts`) and the `@rede-social/ui` `InfiniteScroll`.
- **Attendance shape:** one attendance row per member per event, whose `status` column moves through transitions. There are no boolean pairs (roadmap Phase 6 Notes; SCHEMA-CONVENTIONS §(d).1).

#### Eventos tab & detail page
- **D-200: Two chips under the heading, `Próximos` (default) and `Passados`, each its own keyset query.** This is the Ativas/Arquivadas pattern from D-88.
  - The split is a predicate on `ends_at` against `now()`, never a cron. An event in progress therefore stays in `Próximos` until it ends, which matters because check-in runs to the end (D-209).
  - `Próximos` runs soonest-first. `Passados` runs most-recent-first.
  - Each chip renders the prototype's poster card. Its top-left pill carries the member's own state: `Você vai` (the prototype's "Inscrito"), `Presente`, `Cancelado`, or the date when the member has not answered.
  - Rejected:
    - Horizontal rails ("Meus / Outros"): they cannot page.
    - One scroll with two sections: the past list grows forever.
- **D-201: A cancelled event stays where it is, with a `Cancelado` pill.** It stays in `Próximos` and then `Passados`.
  - Its detail page shows a cancellation banner, and RSVP, check-in and `Entrar` are disabled.
  - V1 notifies nobody of a cancellation (V2-EVENT-02). Seeing it in the list is how a member who confirmed finds out, so hiding cancelled events is rejected.
- **D-202: Início gets a "next event" card.** It is a `home`-slot widget (D-42) showing the tenant's next upcoming event, placed between the stories/highlights row and the feed.
  - It is hidden when no event is upcoming, and tapping it opens the detail page.
  - When the check-in window opens (D-209), the card becomes the check-in shortcut: `Fazer check-in` for an in-person event, `Entrar` for an online one. Members at the venue usually open the app on Início.
  - Rejected:
    - Showing the card only for events the member confirmed: an unanswered member would never see new events.
    - Keeping events to the tab only.
- **D-203: An in-person event's location is the venue name plus the address as text, with an `Abrir no Maps` button** that opens the device's maps app on that address (universal maps URL).
  - No embedded map: the prototype's `EventMap` keyless Google iframe is **not ported**.
  - That avoids an unofficial embed URL, a CSP `frame-src` exception, and every viewer's IP going to Google (LGPD).
  - Nearby places and Airbnb are dropped (do-not-port).

#### RSVP
- **D-204: RSVP is open until `starts_at`.**
  - Before the start, the member sets and changes their answer freely.
  - From the start, RSVP is closed and only check-in remains; a check-in without a prior "Vou" is a walk-in (EVENT-04).
  - Once a member has checked in, the answer is locked.
  - The API and the database refuse an RSVP write after `starts_at`, with a stable machine code (D-09). The UI hiding the control is not enough.
- **D-205: The RSVP control is a segmented pair, `Vou` / `Não vou`,** replacing the prototype's single "Garantir minha vaga" CTA.
  - `Não vou` is a **recorded answer**, so the admin can tell "declined" from "never answered".
  - Rejected: a single "Confirmar presença" toggle, which merges an explicit no and a change of mind.
- **D-206: Members see a count only: "N confirmados"** on the poster card and the detail page, exactly EVENT-03.
  - No avatar stack and no "Ana, João e mais 21". Who is going stays between each member and the admin.
  - That avoids exposing attendance tenant-wide, and avoids a second rule for staff whom D-47 hides from the directory.
- **D-207: An online event's link is gated by the member's answer and by the window.**
  - **Before the window opens (D-209):**
    - A member whose answer is `Vou` gets `Entrar`.
    - Everyone else sees an invitation to confirm (pt-BR copy such as "Confirme presença para receber o link").
  - **From the window's opening to `ends_at`:** `Entrar` works for **every** member. A member who never confirmed is recorded as a walk-in, the same rule as in person. That keeps EVENT-04 true online.
  - **The raw URL never appears in any member payload, page or export.** Members always go through the app's `/eventos/{id}/entrar` route (D-210), so the gate is enforced server-side at click time.
  - Consequence for the schema: a member session must not be able to read the URL through RLS. Defense in depth means the URL cannot sit in a column any member-lane read can select; the planner picks the shape (D-217).

#### Check-in
- **D-208: In-person check-in requires a venue code.**
  - Each event gets a short code (about 4 characters from an unambiguous alphabet), visible **only** to holders of the attendance permission. It shows at the top of the `Participantes` screen (D-215).
  - At the venue the admin says it or writes it on a board. The member types it inside the window to check in.
  - This is the prototype's typed-code field, without its pseudo-QR and camera scanner, which are V2-EVENT-01.
  - The code makes `Presente` mean "was there" rather than "tapped a button at home". A walk-in (no RSVP) checks in with the same code.
  - The code must not be readable by a member session, including through RLS. Wrong guesses must be bounded (D-217).
  - Rejected:
    - A plain self check-in button: attendance would be a claim, not a fact.
    - A per-event "exigir código" switch: two flows to design and test.
- **D-209: The check-in window is a fixed platform rule, from `starts_at − 1 h` to `ends_at`.** There is no form field.
  - The same window governs the online `Entrar` gate (D-207) and the Início card's switch (D-202).
  - A multi-day event has **one** check-in for its whole span.
  - The API and database enforce the window, not the UI.
  - Rejected:
    - 1 h before to 1 h after the start: it locks out late arrivals, and admin override is V2.
    - A window per event.
- **D-210: For an online event, tapping `Entrar` is the check-in.**
  - `/eventos/{id}/entrar` runs on the tenant's own domain. It verifies the membership, the event state and D-207's gate. Inside the window it records the check-in (or walk-in), then redirects to the stored meeting URL.
  - There is no code, because there is no venue to show it.
  - Rejected:
    - A separate check-in button: members joining from their calendar would never be counted.
    - No check-in online: online events would have no "Presente" column.
  - **Reversibility:** costly. Once members' calendars (D-211) hold `/eventos/{id}/entrar`, the URL shape is effectively permanent; this is the D-56 lesson applied to event links.
- **D-211: Calendar export (EVENT-06) is an `.ics` download plus a Google Calendar template link.**
  - Both carry the times in UTC, correct in any calendar.
  - For an in-person event, the location is the venue and address.
  - For an online event, the location is **the app's `/eventos/{id}/entrar` URL, never the raw meeting URL**. Opening it from the calendar counts the check-in, applies D-207's gate at click time, and still works after the admin edits the meeting link.
  - Because the export carries no secret, it is offered to every member whatever their answer.
  - **Reversibility:** costly, for the same reason as D-210.

#### Admin authoring & cancel
- **D-212: The admin creates an event from a `Criar evento` control in the `Eventos` title row.**
  - This is D-86's pattern: a compact brand button, or an icon-only `+` with an accessible label on narrow phones, present in both the empty and non-empty states. It is a **link**, not a button (the `createCta` rule).
  - It opens the full-screen `/eventos/novo`, and editing reuses the same form at `/eventos/{id}/editar`.
  - The empty state also carries the action for managers (D-77).
  - Rejected:
    - A floating button: creation is rare, and a FAB would cover posters.
    - An "Evento" mode in `/criar`: it would break D-51's one-post-model rule.
- **D-213: `ends_at` is required.** It is prefilled to `starts_at + 2 h` when the admin picks the start, and it stays editable.
  - The end drives the `Passados` split (D-200), the close of the check-in window (D-209) and the calendar's end (D-211). A missing end would need an invented duration in three places.
  - `ends_at > starts_at` is a DB CHECK.
  - "Exactly one of venue/address or online URL" is expressed declaratively, the way D-53's gallery-XOR-video was.
- **D-214: After members have RSVP'd, every field stays editable and existing answers and check-ins are kept.**
  - **Cancel** asks for confirmation and is **reversible with `Reativar` until `starts_at`**, mirroring archive/reactivate for communities (D-90).
  - **There is no delete**, so RSVPs, check-ins and the attendance history always survive.
  - In V1 nobody is notified of an edit or a cancel (V2-EVENT-02). The detail page's state is the signal.
  - Rejected:
    - A final cancel: a mis-tap would force re-creation, and every member would have to RSVP again.
    - Delete-when-empty: more states for little value.
- **D-215: The attendance list is an admin-only `Participantes` screen reached from the event page.**
  - It has three chips with counts: **`Confirmados`** (answered Vou, not yet checked in), **`Presentes`** (checked in; walk-ins carry a `Sem confirmação` tag) and **`Não vão`**.
  - Each chip is its own keyset query.
  - The venue code (D-208) sits at the top of this screen.
  - This screen is where EVENT-05 lives. It is prototype-less, so it goes through the D-33 review.

### Claude's Discretion

Nothing below was selected for discussion. Decide it in research or planning, record the choice, and pin the behaviour with tests. Do not re-ask the user.

**Schema and security (D-216..D-219 reserved for decisions the planner records here)**
- **D-216 (slot): the attendance row.** It must keep enough history to tell a walk-in from a confirmed member who checked in.
  - The Presentes chip's `Sem confirmação` tag (D-215) and the count's semantics (below) depend on it.
  - The roadmap names the transitions `going | not_going | checked_in`. Whether walk-in is its own status value, or a `checked_in_at` alongside the last answer, is the planner's call inside SCHEMA-CONVENTIONS §(d).1 (a status column, no booleans).
  - The RSVP-after-start and check-in-outside-window refusals must be declarative or transactional, with no read-then-write window.
- **D-217 (slot): where the meeting URL and the venue code live.** Neither may be selectable by a member-lane read. Candidate designs:
  - a separate admin-only table, e.g. `event_secrets` with a restrictive policy;
  - column privileges;
  - another mechanism the pgTAP suite can assert.

  Also decided here:
  - **Bounded code guessing:** no rate-limit infrastructure exists. `signup.ts:157` notes rate limiting as a pending product decision. Something DB-backed per member per event is the likely shape.
  - Whether the admin can regenerate a leaked code.
  - The meeting URL is validated as `https:` only. `/entrar` redirects only to the stored URL, never to a parameter, so there is no open redirect.
- **D-218 (slot): `/entrar` is a GET with a side effect.** It must never fire from a Next.js `<Link>` prefetch, a Serwist runtime-cache warm-up or a link unfurler.
  - Render it as a plain anchor with prefetch off, or bounce through a POST or an interstitial.
  - Pick the approach and pin it with a test that a detail-page render records nothing.
  - Also decide what `/entrar` does outside the window for a confirmed member (forward without recording, the recommended default) and after `ends_at` or on a cancelled event (a legible pt-BR refusal page).
- **D-219 (slot): what "N confirmados" counts.** The recommended default is members whose answer is `Vou`, including those who later checked in, and excluding walk-ins and `Não vou`. Also decided here: what a **past** event's card and detail page show (e.g. "N presentes" for past events), and whether staff RSVPs count.
- Domain events through the `EventMap` declaration-merging point (`packages/contracts/src/events.ts`): `event.published`, `event.updated`, `event.cancelled`, `event.rsvp`, the check-in event, and whether `Reativar` emits its own event.
  - Payloads must be Phase-7-ready without a re-read. EVENT-07 reminders at 24 h and 1 h need `starts_at`, and must survive an edit that moves the start, so `event.updated` carries the new start.
  - Do not double-emit.
- Permission keys: e.g. `events.event.manage` for create/edit/cancel, and `events.attendance.read` for `Participantes` plus the code. Also decide whether `support_tenant` gets attendance read, so staff at the door can see the code. The default is `admin_tenant` only.
- Index shapes for the two chip queries and the three attendance chips. `tenant_id` comes first, and DESC keyset indexes use `.desc().nullsFirst()`.

**UI and composition**
- Which prototype extras survive:
  - Recommended **keep**: the countdown line ("Faltam N dias" / "É hoje!") and the `Acontecendo agora` state for an event in progress.
  - Recommended **drop**: the `typeLabel` pill, since there is no event-type vocabulary in V1 (the same reasoning as D-51); vagas; ingresso/pagamento; certificado/horas; programme; "Bom saber"; photos; `/my-events`; `/event-photos`.
- The check-in flow's shape: code entry as a sheet over the detail page versus a `/eventos/{id}/check-in` route. Also how the prototype's boarding-pass card is reused as the confirmed state ("Check-in confirmado · Realizado às HH:MM", no pseudo-QR).
- Cover image: recommended **optional** with the brand-gradient fallback D-69 gave communities.
- The form's date/time inputs on mobile Safari and Chrome in the tenant's timezone, and the online/in-person switch.
- Empty states and skeletons for both chips, the Início card and the three attendance chips. pt-BR copy lives in a new `events` catalog namespace (`scripts/check-ui-literals.sh`).
- **Nav order and tab budget.** The prototype ran five tabs (Home, Comunidade, Vídeos, Membros, Eventos). `packages/core/ui/nav.ts` renders kernel Início first, module tabs by `order`, and kernel Perfil last. With 05.3's Reels tab landing before this phase, Eventos makes five: Início, Comunidades, Reels, Eventos, Perfil. Pick `nav.order` after Comunidades' 20 and Reels' value. Phase 9's `Explorar` (post-MVP) would be a sixth tab. That is Phase 9's problem, not this phase's, but do not pick an order that assumes it.
- Home-slot `order` for D-202: after the stories strip (5), before the feed (10). Re-check against 05.2's reshaped highlights row.
- Desktop composition under D-39 (rail plus centred column) for the list, the detail and `Participantes`.

**Test strategy**
- Extend the two-tenant pgTAP and API isolation suite with events, attendances and the secrets store. Each case asserts its positive control in the same test (03-08). Add a pgTAP case that a **member** session cannot read the code or the meeting URL.
- Window and start-time rules run under a clock the test controls: RSVP closes at the start, check-in opens 1 h before, and `/entrar` records only inside the window.
- A wrong-code refusal plus the guess bound.
- Playwright on a mobile viewport: the chips, RSVP toggling, code check-in, the Início card switching into check-in mode, `.ics` download, the admin create, cancel and `Reativar` path, and the `Participantes` chips.
- Seed (`scripts/seed.ts`):
  - events: upcoming, in progress, past, cancelled, online, in-person and multi-day;
  - attendance: Vou and Não vou answers, check-ins and walk-ins.

### Deferred Ideas (OUT OF SCOPE)

- **Seeing who's going (avatar stack, "Ana, João e mais 21")**, rejected by D-206. Revisit with Phase 9's follow graph (post-MVP: "people I follow are going") if the pilot asks.
- **An embedded map** (the prototype's `EventMap`), rejected by D-203 for CSP and LGPD reasons. A keyed static map would be the version to revisit.
- **A per-event check-in window** (form fields for open/close offsets), rejected by D-209 in favour of the fixed rule.
- **Deleting an event** (e.g. a test or a duplicate with no answers), rejected by D-214. Cancel is the only way out in V1.
- **A "require code" switch per event**, rejected by D-208.
- **A "Meus eventos" view** (the prototype's `/my-events`: registered and participated cards, stats, certificates). The state pill on each card (D-200) covers V1. A `Você vai` filter chip is the cheap version to revisit.
- **Events inside a community** (a `community_id` on events, events on a community page). Surfaced during analysis, not discussed; not in the requirements. Relevant once Phase 10's member-created communities exist (post-MVP).
- Already V2 in REQUIREMENTS.md, restated so nobody pulls them in:
  - QR / geofence check-in and admin manual check-in (V2-EVENT-01);
  - update and cancel notifications (V2-EVENT-02);
  - CSV export, "maybe", capacity and waitlist (V2-EVENT-03).
- Event reminders (EVENT-07) are Phase 7, not deferred: they are built there on this phase's domain events.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVENT-01 | `admin_tenant` can create, edit and cancel events with title, description, cover image, start/end datetime (timezone-aware), and either a physical location or an online link | §Pattern 1 (schema: `events` + `event_secrets`, XOR via redundant discriminator + deferrable composite FK); §Pattern 2 (wall-clock → UTC in SQL); §Pattern 6 (one PATCH for edit/cancel/reactivate, guarded UPDATE for the time rules); cover via `resolveCoverAsset` clone (Pitfall 5) |
| EVENT-02 | Member can view upcoming and past events and open an event's detail | §Pattern 3 (two keyset lists on `ends_at` vs `now()`, per-member state + counts in one statement); `events-view.ts` Intl formatting in `bootstrap.tenant.timezone` (§Pattern 2); Início `GET /v1/events/next` home slot |
| EVENT-03 | Member can confirm attendance (going / not going) before the event and see the number of confirmed attendees | §Pattern 4 (self-only RLS upsert + guard trigger `rsvp_closed`); D-219 recommendation (count = `going` + `checked_in`) |
| EVENT-04 | Member can check in on the day, within a window around the start; check-in without prior RSVP counts as walk-in | §Pattern 5 (`app.events_check_in` / `app.events_enter` SECURITY DEFINER; `walk_in` status; attempts table); §Pattern 7 (`/entrar` route handler) |
| EVENT-05 | `admin_tenant` can see the attendance list per event with confirmed vs checked-in status | §Pattern 3 attendance chips (three keysets, two indexes), `events.attendance.read`, code shown via staff-only `event_secrets` policy |
| EVENT-06 | Member can add an event to their calendar (.ics download and Google Calendar link) | §Pattern 8 (RFC 5545 serializer with octet folding + escaping; Google `action=TEMPLATE` with UTC `…Z` dates and **no** `ctz`); online LOCATION = `https://{primaryHost}/eventos/{id}/entrar` |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives from `.claude/CLAUDE.md` with the same authority as locked decisions:

- **Next.js on Vercel, API in Node/TypeScript (Hono) on Cloud Run. All business logic goes through the API.** The browser may talk to Supabase only for (1) Auth via `@supabase/ssr` and (2) read-only Realtime Broadcast. Event data, RSVP and check-in all go through the API.
- **Modularity (MOD-01..05):** a self-contained package (schema, API, UI) that depends only on the kernel and on published contracts. `turbo boundaries` denies module → module and module → app.
- **Design:** port from `reference/frontend-design/`; do not refactor in place (PROTOTYPE.md).
- **Supabase Free plan for the pilot.** Build and verify everything on the local Docker stack; cloud work (Phase 01.1) is deferred to the end.
- **Multi-tenant from day one:** RLS plus defense in depth. Never use the `service_role` key or `postgres` role for tenant queries (the `api_user` role and `set local role authenticated`). `withAdminTx` is kernel-only (Biome).
- **Schema must anticipate V2 without rewriting core tables.** Status columns, not booleans. Generic authorship `created_by_user_id`.
- **pt-BR UI.** Every string lives in `apps/web/messages/pt-BR/*.json`; `scripts/check-ui-literals.sh` fails hex literals, legacy prototype classes and pt-BR JSX literals.
- **Migrations:** `drizzle-kit generate` (`pnpm db:generate`) writes to `supabase/migrations`, and only the Supabase CLI applies them. Never run `drizzle-kit migrate`/`push`. Hand-written SQL (functions, triggers, deferrable FKs) goes in `--custom` migrations or is appended to the generated file (the 05-03/05-05 precedent).
- **What NOT to use (relevant here):** no `middleware.ts` (use `proxy.ts`); no browser `@supabase/supabase-js` for data; no uploads through Cloud Run; no `localStorage` tokens; no `prepare: true` on the pooler.
- **Stack table lists `date-fns` 4.4.0.** It is not installed. The approved UI-SPEC decided `Intl` and flagged the deviation. This research confirms `Intl` plus Postgres tzdata covers every need (§Pattern 2), so no package is added.
- **GSD workflow enforcement:** edits happen through GSD commands (`/gsd-execute-phase`).

## Standard Stack

No new dependency. Every piece is already in the workspace.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | `packages/modules/events/db/schema.ts`: tables, CHECKs, indexes, `pgPolicy`, `.enableRLS()` | Repo standard; `apps/api/drizzle.config.ts` already globs `'../../packages/modules/*/db/schema.ts'` [VERIFIED: apps/api/drizzle.config.ts] |
| hono + @hono/zod-openapi | 4.13.7 / 1.6.3 | `/v1/events` routes with `requireAuth` → `requireModule('events')` → `requirePermission(...)` | Same guard chain as `communitiesRoutes` [VERIFIED: packages/modules/communities/server/routes.ts] |
| zod | 4.6.2 | Contracts; `z.url({ protocol: /^https$/ })` for the meeting URL | Probed: accepts `https://meet.google.com/…`, rejects `http:`, `javascript:` and a bare `https://` [VERIFIED: local node probe against zod 4.6.2] |
| Postgres (Supabase local) | 17.6 | `timestamp at time zone`, triggers, SECURITY DEFINER functions | [VERIFIED: `select version()` on supabase_db_rede-social] |
| `node:crypto` `randomInt` | Node 24.14.0 | Uniform check-in code generation | Built-in; no package |
| `Intl.DateTimeFormat` | Node 24 ICU | Tenant-timezone formatting | UI-D-203; `Temporal` is `undefined` in Node 24.14 [VERIFIED: node probe] |

### Supporting (already installed, reused)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `motion` | 13.3.0 | The check-in success spring (`motion/react`) | Ticket done state only (UI-D-208) |
| `lucide-react` | 1.46.0 | Icons (`calendar-days` already mapped in `ICONS`) | Throughout |
| `@rede-social/ui` / `@rede-social/core/ui` | workspace | `Chip`, `StatusPill`, `InfiniteScroll`, `HomeSlots`, `MediaImage`, etc., plus a new `SegmentedControl` primitive | Per UI-SPEC inventory |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL `at time zone` conversion | `date-fns` + `@date-fns/tz`, or a hand-written Intl offset search | Adds a dependency (UI-SPEC forbids it without justification) or hand-rolls DST math; Postgres tzdata is already authoritative and tested |
| Hand-rolled ICS serializer (~60 lines) | `ical-generator` / `ics` npm packages | One VEVENT with six properties does not justify a dependency plus the legitimacy checkpoint; RFC 5545 folding and escaping are small and unit-testable |
| Role-claim RLS policy on `event_secrets` | Column privileges (`revoke select (meeting_url)`) | Column privileges cannot tell admin from member: both lanes are the same `authenticated` DB role [VERIFIED: packages/core/db/tenant-tx.ts:27,33] |
| SECURITY DEFINER check-in functions | API reading secrets through `withAdminTx` | `withAdminTx` is Biome-confined to `packages/core/server/{tenancy,platform,media}`; a module cannot reach it |
| Read-time counts (`count(*) filter`) | Trigger-owned `confirmed_count` / `present_count` columns | Counters add drift reconciliation, a hot row during check-in rush, and a lock-upgrade deadlock with the guard trigger's `FOR SHARE` (Pitfall 3) |

**Installation:** none. The only workspace edits are package dependency lines: `"@rede-social/module-events": "workspace:*"` in `apps/api/package.json` and `apps/web/package.json`.

## Package Legitimacy Audit

This phase installs **no external package**. The new workspace package `@rede-social/module-events` depends only on packages already in the lockfile at the versions `@rede-social/module-communities` pins (`@hono/zod-openapi` 1.6.3, `drizzle-orm` 0.45.2, `hono` 4.13.7, `lucide-react` 1.46.0, `pino` 10.3.1, `zod` 4.6.2, plus the same devDependencies) [VERIFIED: packages/modules/communities/package.json].

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none new) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
A `pnpm add` of any external package in a Phase 6 plan is a defect (UI-SPEC Registry Safety).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────── Browser (PWA) ───────────────────────┐
  member taps            │ /eventos (chips) ─ /eventos/{id} ─ /eventos/{id}/check-in   │
  (or a calendar         │ /inicio home slot (order 7)       plain <a> → /eventos/{id}/entrar
   app opens a link)     └──────────┬───────────────────────────────┬──────────────────┘
                                    │ RSC render / server actions    │ top-level GET (Lax cookie)
                                    ▼                                ▼
          ┌──────────────── Next.js 16 BFF (Vercel) ─────────────────────────────────────┐
          │ pages (RSC): format with Intl(timeZone = bootstrap.tenant.timezone)          │
          │ server actions: rsvp / checkIn / create / update / cancel / reactivate       │
          │ route handler GET /eventos/{id}/entrar:                                      │
          │   Sec-Purpose: prefetch? ─yes→ 204 no-store (records nothing)                │
          │   else POST /v1/events/{id}/enter ──► outcome                                │
          │        forward|recorded → 303 Location: stored https URL                     │
          │        ended|cancelled|confirm_first → /eventos/{id}/entrar/aviso?motivo=…   │
          │ route handler GET /eventos/{id}/agenda.ics → RFC 5545 text/calendar          │
          └───────────────┬──────────────────────────────────────────────────────────────┘
                          │ apiFetch (Bearer + x-tenant-host)
                          ▼
          ┌──────────── Hono API (Cloud Run): /v1/events ────────────────────────────────┐
          │ requireAuth → requireModule('events') → requirePermission(...)                │
          │ service.ts: withTenantTx(ctx, tx => …)  ── emit(...) queued after commit     │
          └───────────────┬──────────────────────────────────────────────────────────────┘
                          │ tenant lane: claims {sub, tenant_id, tenant_role} + role authenticated
                          ▼
          ┌──────────── Postgres (RLS) ──────────────────────────────────────────────────┐
          │ events (tenant isolation)      event_attendances (select tenant; write self, │
          │   CHECKs: window, XOR, status    RSVP statuses only) ── BEFORE trigger        │
          │ event_secrets (policy: tenant AND app.events_staff())  app.event_attendance_guard()
          │ event_checkin_attempts (select self; no write policy)     reads events FOR SHARE,
          │ app.events_check_in(id, code)  SECURITY DEFINER ─┐        raises 23514 + constraint
          │ app.events_enter(id)           SECURITY DEFINER ─┴─ explicit tenant filter,  │
          │   returns outcome (never raises for wrong code) → attempts row commits       │
          └──────────────────────────────────────────────────────────────────────────────┘
                          │ after commit: event.published / updated / cancelled /
                          ▼ reactivated / rsvp / checked_in  → manifest subscribers (log now; Phase 7 later)
```

### Recommended Project Structure

```
packages/modules/events/                # @rede-social/module-events (clone communities' package.json/tsconfig/turbo/vitest config)
├── module.ts                           # defineModule: nav tab order 40, home [{order:7}], events[], defaultRolePermissions
├── contracts/index.ts                  # Zod schemas, EVENT_ISSUES, EVENT_PERMISSIONS, window constants, EventMap merge
├── db/schema.ts                        # events, event_attendances, event_secrets, event_checkin_attempts
├── server/{index,routes,service,ics?}.ts
├── ui/                                 # EventCover, EventPoster, EventHero, EventInfoGrid, EventTicket,
│                                       # NextEventCard, AttendeeRow, CheckinCodeCard (ship no words)
└── tests/                              # contracts, events payload shape, component tests
packages/ui/src/primitives/SegmentedControl.tsx   # new primitive (UI-D-206) + test
supabase/migrations/<ts>_events.sql               # generated (+ appended hand-written FKs)
supabase/migrations/<ts>_events_functions.sql     # --custom: helper, guard trigger, two definer functions, grants
supabase/tests/130-events.sql                     # new (120 is claimed by 05.2); + 020 isolation cases
apps/api/src/{app.ts,modules/registry.ts}         # mount /v1/events, register manifest
apps/api/tests/integration/events.test.ts         # + isolation.test.ts cases
apps/web/app/(app)/eventos/                        # page, loading, EventsList, EventForm, novo/, [eventId]/…
apps/web/app/(app)/eventos/[eventId]/entrar/route.ts        # D-210/D-218
apps/web/app/(app)/eventos/[eventId]/entrar/aviso/page.tsx  # refusal screens (child segment, allowed)
apps/web/app/(app)/eventos/[eventId]/agenda.ics/route.ts    # EVENT-06
apps/web/lib/{events.ts,events-view.ts,events-calendar.ts}  # fetchers, Intl formatter, ics + google link
apps/web/messages/pt-BR/events.json                          # root key `events`
apps/web/e2e/events.spec.ts (+ events-admin.ts fixtures), phase6-smoke.spec.ts
```

`entrar/route.ts` plus `entrar/aviso/page.tsx` is legal: Next forbids a `route.js` only "at the same route segment level as `page.js`" [CITED: apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:39].

### Pattern 1: Schema (D-216, D-217, D-213)

**What:** four tables. Rules that must hold for every writer are expressed declaratively.

```ts
// packages/modules/events/db/schema.ts — shape, not final code
export const events = pgTable('events', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  title: text().notNull(),
  description: text().notNull().default(''),
  coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),   // nullable (D-69)
  format: text().notNull(),                                               // 'in_person' | 'online'
  venueName: text('venue_name'),
  address: text(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: text().notNull().default('active'),                            // 'active' | 'cancelled'
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: …defaultNow(), updatedAt: …defaultNow(), deletedAt: timestamp(…),  // deleted_at for Phase 8 moderation
}, (t) => [
  uniqueIndex('events_tenant_id_uq').on(t.tenantId, t.id),                         // composite-FK target
  uniqueIndex('events_tenant_id_format_uq').on(t.tenantId, t.id, t.format),        // XOR discriminator target
  index('events_tenant_starts_idx').on(t.tenantId, t.startsAt, t.id).where(sql`deleted_at is null`),  // Próximos + Início (asc)
  index('events_tenant_ends_idx').on(t.tenantId, t.endsAt.desc().nullsFirst(), t.id.desc().nullsFirst())
    .where(sql`deleted_at is null`),                                               // Passados (desc)
  check('events_format_chk', sql`${t.format} in ('in_person','online')`),
  check('events_status_chk', sql`${t.status} in ('active','cancelled')`),
  check('events_window_chk', sql`${t.endsAt} > ${t.startsAt}`),                     // D-213
  check('events_location_chk', sql`(format = 'in_person' and venue_name is not null and address is not null
                                      and length(btrim(venue_name)) > 0 and length(btrim(address)) > 0)
                                   or (format = 'online' and venue_name is null and address is null)`),
  check('events_cancelled_at_chk', sql`(status = 'cancelled') = (cancelled_at is not null)`),
  tenantIsolationPolicy('events_tenant_isolation'),
]).enableRLS();

export const eventAttendances = pgTable('event_attendances', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId, eventId: uuid('event_id').notNull(), userId: uuid('user_id').notNull().references(() => users.id),
  status: text().notNull(),                         // 'going' | 'not_going' | 'checked_in' | 'walk_in'
  respondedAt: timestamp('responded_at', …),        // last RSVP answer (kept after check-in → "Confirmou em")
  checkedInAt: timestamp('checked_in_at', …),
  checkinVia: text('checkin_via'),                  // 'code' | 'online'
  createdAt, updatedAt,
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [events.tenantId, events.id] }).onDelete('cascade'),
  uniqueIndex('event_attendances_tenant_event_user_uq').on(t.tenantId, t.eventId, t.userId),   // upsert arbiter
  index('event_attendances_tenant_event_status_idx')
    .on(t.tenantId, t.eventId, t.status, t.respondedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  index('event_attendances_tenant_event_checkin_idx')
    .on(t.tenantId, t.eventId, t.checkedInAt.desc().nullsFirst(), t.id.desc().nullsFirst())
    .where(sql`checked_in_at is not null`),
  check('event_attendances_status_chk', sql`status in ('going','not_going','checked_in','walk_in')`),
  check('event_attendances_checkin_chk', sql`(status in ('checked_in','walk_in')) = (checked_in_at is not null)
                                           and (status in ('checked_in','walk_in')) = (checkin_via is not null)`),
  check('event_attendances_via_chk', sql`checkin_via is null or checkin_via in ('code','online')`),
  check('event_attendances_answered_chk', sql`status = 'walk_in' or responded_at is not null`),
  pgPolicy('event_attendances_tenant_select', { for: 'select', to: authenticatedRole, using: sql`tenant_id = app.tenant_id()` }),
  pgPolicy('event_attendances_self_rsvp_insert', { for: 'insert', to: authenticatedRole,
    withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id() and status in ('going','not_going')` }),
  pgPolicy('event_attendances_self_rsvp_update', { for: 'update', to: authenticatedRole,
    using:     sql`tenant_id = app.tenant_id() and user_id = app.user_id() and status in ('going','not_going')`,
    withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id() and status in ('going','not_going')` }),
  // no delete policy: answers and check-ins always survive (D-214)
]).enableRLS();

export const eventSecrets = pgTable('event_secrets', {
  eventId: uuid('event_id').primaryKey(),
  tenantId, eventFormat: text('event_format').notNull(),
  checkinCode: text('checkin_code').notNull(),      // always present; used only while format = in_person
  meetingUrl: text('meeting_url'),
  codeRotatedAt: …defaultNow(), updatedAt: …defaultNow(),
}, (t) => [
  uniqueIndex('event_secrets_tenant_event_uq').on(t.tenantId, t.eventId),   // tenant-first index (040 gate)
  check('event_secrets_url_chk', sql`(event_format = 'online') = (meeting_url is not null)`),
  check('event_secrets_https_chk', sql`meeting_url is null or lower(meeting_url) like 'https://%'`),
  check('event_secrets_code_chk', sql`checkin_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'`),
  pgPolicy('event_secrets_staff_all', { for: 'all', to: authenticatedRole,
    using: sql`tenant_id = app.tenant_id() and app.events_staff()`,
    withCheck: sql`tenant_id = app.tenant_id() and app.events_staff()` }),
]).enableRLS();

export const eventCheckinAttempts = pgTable('event_checkin_attempts', {
  tenantId, eventId, userId, failedCount: integer('failed_count').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', …).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('event_checkin_attempts_uq').on(t.tenantId, t.eventId, t.userId),
  pgPolicy('event_checkin_attempts_self_select', { for: 'select', to: authenticatedRole,
    using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()` }),
  // NO insert/update/delete policy: only app.events_check_in writes it (a member lane cannot reset the bound)
]).enableRLS();
```

Hand-written SQL appended to the generated migration (drizzle cannot express `DEFERRABLE`; the 05-03/05-05 precedent says hand-written FKs survive `db:generate`):

```sql
-- the XOR across two tables (D-213, D-53 pattern): secrets carry a redundant discriminator
alter table public.event_secrets add constraint event_secrets_event_fk
  foreign key (tenant_id, event_id, event_format) references public.events (tenant_id, id, format)
  on delete cascade deferrable initially deferred;
-- every event has exactly one secrets row (existence, checked at commit)
alter table public.events add constraint events_secrets_fk
  foreign key (id) references public.event_secrets (event_id) deferrable initially deferred;
```

**Why deferrable:** a format switch (in person ↔ online, allowed by D-214) must update `events.format` and `event_secrets.{event_format, meeting_url}` in one transaction. With an immediate FK there is no statement order that satisfies both CHECKs and the FK. Referential *actions* other than NO ACTION cannot be deferred, so the update side stays NO ACTION and is only checked at commit [ASSUMED: Postgres FK deferral semantics from training; the planner's pgTAP case will exercise it].

**D-216 decision recorded:** walk-in is its **own status value** (`walk_in`), set when a check-in lands on no row or on a `not_going` row. `going → checked_in` keeps `responded_at`, so "Confirmou em" survives. This lets every attendance chip be a single status predicate:
- Confirmados = `status = 'going'`;
- Não vão = `status = 'not_going'`;
- Presentes = `checked_in_at is not null` (partial index), tagging `walk_in`.

### Pattern 2: Timezone (locked; implementation recommendation)

- **Write:** the contract takes wall-clock strings: `start: { date: 'YYYY-MM-DD', time: 'HH:MM' }` and the same shape for `end`. The service converts inside the statement:

```sql
-- Source: probed on local Postgres 17.6
insert into events (…, starts_at, ends_at)
select …,
       (${start.date} || ' ' || ${start.time})::timestamp at time zone t.timezone,
       (${end.date}   || ' ' || ${end.time})::timestamp   at time zone t.timezone
  from tenants t where t.id = ${ctx.tenantId}::uuid     -- tenants_self_select lets the lane read its own row
```

  Verified: `('2026-10-12 19:00'::timestamp at time zone 'America/Sao_Paulo')` → `2026-10-12 22:00:00+00`. For DST zones, a local time inside the spring-forward gap (`2026-03-08 02:30` New York) resolves to `07:30 UTC` (03:30 EDT), and an ambiguous fall-back time (`2026-11-01 01:30`) resolves to standard time (`06:30 UTC`) [VERIFIED: psql probe on supabase_db_rede-social]. `America/Sao_Paulo` has no DST, so the pilot never meets either case.
- **Edit form read-back:** `to_char(starts_at at time zone t.timezone, 'YYYY-MM-DD')` and `'HH24:MI'` in the same SQL. The web never converts.
- **Render:** `apps/web/lib/events-view.ts` builds `Intl.DateTimeFormat('pt-BR', { timeZone })` from the new `bootstrap.tenant.timezone`. Tenant-local calendar-day arithmetic ("Hoje", "Amanhã", "Em N dias") uses `Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })`, which yields `2026-10-12` [VERIFIED: node probe], and then diffs the two dates as UTC midnights.
- **Bootstrap:** add `timezone: z.string()` to `bootstrapSchema.tenant` (today its fields are `id`, `slug`, `displayName`, `branding` [VERIFIED: packages/contracts/src/bootstrap.ts:22-28]) and select `tenants.timezone` in `apps/api/src/routes/me.ts`. Then replace `const TENANT_TIME_ZONE = 'America/Sao_Paulo';` in `apps/web/lib/feed-view.tsx:39` and `export const DEFAULT_TENANT_TIME_ZONE = 'America/Sao_Paulo';` in `apps/web/components/media/MediaAssetRow.tsx:18` with the bootstrap value, as the CONTEXT and UI-D-203 require.
- **Correction to a UI-SPEC example:** `timeZoneName: 'longGeneric'` for `America/Sao_Paulo` in Node 24 renders **"Horário Padrão de Brasília"**, not "Horário de Brasília" [VERIFIED: node probe]. The form helper will show the former.

### Pattern 3: Lists, counts and the member's own state (D-200, D-215, D-219)

Recommended routes (all `requireAuth` + `requireModule('events')`):

| Route | Guard | Statement shape |
|---|---|---|
| `GET /v1/events?period=upcoming\|past&cursor&limit` | — | upcoming: `ends_at > now()` `order by starts_at, id` (`keysetComparison('asc')`); past: `ends_at <= now()` `order by ends_at desc, id desc` |
| `GET /v1/events/next` | — | `status='active' and ends_at > now()` `order by starts_at, id limit 1` (Início; excludes cancelled, UI-D-214) |
| `GET /v1/events/{id}` | — | detail + viewer attendance + counts; never the URL or code |
| `GET /v1/events/{id}/attendance?list=confirmed\|present\|not_going` | `events.attendance.read` | three keysets |
| `GET /v1/events/{id}/attendance/summary` | `events.attendance.read` | chip counts + `checkinCode` (in person) via the staff policy |

Each list page is **one statement**. Counts come from a lateral aggregate served by `event_attendances_tenant_event_status_idx`, and the viewer's row from the unique `(tenant_id, event_id, user_id)`:

```sql
select e.…, me.status as my_status, me.checked_in_at as my_checked_in_at,
       c.confirmed, c.present
  from events e
  left join event_attendances me
         on me.tenant_id = e.tenant_id and me.event_id = e.id and me.user_id = ${ctx.userId}::uuid
  left join lateral (
    select count(*) filter (where x.status in ('going','checked_in'))  as confirmed,   -- D-219
           count(*) filter (where x.status in ('checked_in','walk_in')) as present
      from event_attendances x where x.tenant_id = e.tenant_id and x.event_id = e.id) c on true
 where e.tenant_id = ${ctx.tenantId}::uuid and e.deleted_at is null and e.ends_at > now()
   and (${afterAt}::timestamptz is null or (e.starts_at, e.id) > (${afterAt}::timestamptz, ${afterId}::uuid))
 order by e.starts_at, e.id
 limit ${limit + 1}
```

**D-219 decision recorded:**
- "N confirmados" counts `going` plus `checked_in` (every member whose recorded answer was Vou), excluding `walk_in` and `not_going`.
- Past events show "N presentes" (`checked_in` + `walk_in`).
- **Staff answers count like everyone's**, because the number is attendance, not a directory listing. Rows of members who have since left still count, so the Participantes chip counts always equal their row counts ("Membro removido" rows are shown).
- ⚠ The **`Confirmados` chip** on Participantes is `status = 'going'` only (not yet checked in, D-215). It differs from the member-facing "N confirmados". Pin both in tests.

Participantes rows reuse the comment-author join, with the lifecycle predicate in the JOIN condition: `left join memberships ms on ms.user_id = c.author_user_id and ms.deleted_at is null` / `left join member_profiles mp on mp.membership_id = ms.id` [VERIFIED: packages/modules/feed/server/service.ts:1114-1115]. For events, add `ms.tenant_id = a.tenant_id`.

**Keyset:** use `encodeCursor` / `decodeCursor` / `keysetComparison(direction)` from `@rede-social/core/server/paging`; `keysetComparison('asc')` returns `{ operator: '>', order: 'asc' }` [VERIFIED: packages/core/server/paging.ts:75-77]. Timestamps go through `to_char(... at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, never a JS `Date` (the microsecond rule).

### Pattern 4: RSVP (D-204, D-205)

- Route: `PUT /v1/events/{id}/rsvp { answer: 'going' | 'not_going' }`, guarded by `requirePermission('events.attendance.respond')` (see Permissions below).
- One upsert under the tenant lane:

```sql
insert into event_attendances (tenant_id, event_id, user_id, status, responded_at)
values (${ctx.tenantId}::uuid, ${eventId}::uuid, ${ctx.userId}::uuid, ${answer}, now())
on conflict (tenant_id, event_id, user_id) do update
   set status = excluded.status, responded_at = now(), updated_at = now()
 where event_attendances.status in ('going','not_going')
   and event_attendances.status is distinct from excluded.status      -- repeat answer: no write, no event
returning status
```

  Verified: with the `DO UPDATE … WHERE` excluding a `checked_in` row, the statement returns **0 rows and does not error**, even with an RLS update policy whose USING excludes that row [VERIFIED: psql probe]. Zero rows means "unchanged or locked". The service distinguishes the two with a follow-up read (for the answer only, not for the decision).
- **The guard trigger** (hand-written, `--custom` migration) is the database's refusal for every writer:

```sql
create or replace function app.event_attendance_guard() returns trigger
language plpgsql set search_path = '' as $$
declare e record;
begin
  select status, starts_at, ends_at into e from public.events
   where id = new.event_id and tenant_id = new.tenant_id and deleted_at is null
   for share;                                   -- serialises against a concurrent cancel/edit (WR-01 lesson)
  if not found then raise exception using errcode = '23503', constraint = 'event_attendances_event_visible', message = 'event_not_found'; end if;
  if tg_op = 'UPDATE' and old.checked_in_at is not null and new.status is distinct from old.status then
    raise exception using errcode = '23514', constraint = 'event_attendances_locked', message = 'attendance_locked'; end if;
  if e.status = 'cancelled' then
    raise exception using errcode = '23514', constraint = 'event_attendances_event_active', message = 'cancelled'; end if;
  if new.status in ('going','not_going') and now() >= e.starts_at then
    raise exception using errcode = '23514', constraint = 'event_attendances_rsvp_open', message = 'rsvp_closed'; end if;
  if new.status in ('checked_in','walk_in') and (tg_op = 'INSERT' or old.checked_in_at is null)
     and (now() < e.starts_at - interval '1 hour' or now() >= e.ends_at) then
    raise exception using errcode = '23514', constraint = 'event_attendances_checkin_window', message = 'checkin_not_open'; end if;
  return new;
end $$;
create trigger event_attendances_guard before insert or update on public.event_attendances
  for each row execute function app.event_attendance_guard();
```

  `RAISE … USING errcode = '23514', constraint = '…'` puts the name in the error (`CONSTRAINT NAME: event_attendances_rsvp_open`) [VERIFIED: psql probe]. The service walks the drizzle cause chain for `code` + `constraint_name`, exactly as `isSlugCollision` does, and maps each to a machine code. `FOR SHARE` needs UPDATE privilege and the UPDATE policy on `events`. `tenantIsolationPolicy` is `for: 'all'` [VERIFIED: packages/core/db/rls.ts:6-12] and default privileges grant `select, insert, update, delete` to `authenticated`, so an invoker trigger works. Keep `events` on the standard policy for this reason.

### Pattern 5: Check-in through SECURITY DEFINER functions (D-208, D-209, D-210, D-217)

The staff helper keeps the role list in **one** SQL function so that widening it later (e.g. `support_tenant`) is one `create or replace`:

```sql
create or replace function app.events_staff() returns boolean
language sql stable security invoker as $$ select app.tenant_role() in ('admin_tenant') $$;
```

`app.tenant_role()` reads the `tenant_role` claim [VERIFIED: supabase/migrations/20260912030541_app_helpers.sql:30-33], which `withTenantTx` sets to `ctx.role` [VERIFIED: packages/core/db/tenant-tx.ts:25-30]. Probed: a `member` lane selecting a role-gated table gets 0 rows, the `admin_tenant` lane of the same tenant gets its 1 row, and a SECURITY DEFINER function called from the member lane still reads the claims and returns the value [VERIFIED: psql probe with `tests.as_tenant`-equivalent claims].

⚠ **A definer function owned by `postgres` bypasses RLS**: `postgres` has `rolbypassrls = t` [VERIFIED: pg_roles probe]. Every statement inside must carry `tenant_id = app.tenant_id()` and `user_id = app.user_id()`. Use `set search_path = ''` and fully-qualified names (the `app.ensure_member_profile` precedent), `revoke all … from public`, and `grant execute … to authenticated`.

```sql
-- returns an OUTCOME; never raises for a business refusal, so the attempts row COMMITS
create or replace function app.events_check_in(p_event_id uuid, p_code text)
returns table (outcome text, checked_in_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare v_t uuid := app.tenant_id(); v_u uuid := app.user_id(); e record; a record; v_code text;
begin
  if v_t is null or v_u is null then return query select 'not_found', null::timestamptz; return; end if;
  select id, format, status, starts_at, ends_at into e from public.events
   where id = p_event_id and tenant_id = v_t and deleted_at is null for share;
  if not found or e.format <> 'in_person' then return query select 'not_found', null::timestamptz; return; end if;
  if e.status = 'cancelled' then return query select 'cancelled', null::timestamptz; return; end if;
  if now() < e.starts_at - interval '1 hour' then return query select 'not_open', null::timestamptz; return; end if;
  if now() >= e.ends_at then return query select 'closed', null::timestamptz; return; end if;
  -- already present? answer idempotently before spending a guess
  select checked_in_at into a from public.event_attendances
   where tenant_id = v_t and event_id = p_event_id and user_id = v_u and checked_in_at is not null;
  if found then return query select 'already', a.checked_in_at; return; end if;
  select failed_count, window_started_at into a from public.event_checkin_attempts
   where tenant_id = v_t and event_id = p_event_id and user_id = v_u for update;
  if found and a.failed_count >= 5 and a.window_started_at > now() - interval '15 minutes' then
    return query select 'too_many_attempts', null::timestamptz; return; end if;
  select checkin_code into v_code from public.event_secrets where tenant_id = v_t and event_id = p_event_id;
  if v_code is distinct from upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) then
    insert into public.event_checkin_attempts (tenant_id, event_id, user_id, failed_count, window_started_at)
    values (v_t, p_event_id, v_u, 1, now())
    on conflict (tenant_id, event_id, user_id) do update
      set failed_count = case when event_checkin_attempts.window_started_at <= now() - interval '15 minutes'
                              then 1 else event_checkin_attempts.failed_count + 1 end,
          window_started_at = case when event_checkin_attempts.window_started_at <= now() - interval '15 minutes'
                                   then now() else event_checkin_attempts.window_started_at end;
    return query select 'wrong_code', null::timestamptz; return;
  end if;
  return query
  insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via)
  values (v_t, p_event_id, v_u, 'walk_in', now(), 'code')
  on conflict (tenant_id, event_id, user_id) do update
     set status = case when event_attendances.status = 'going' then 'checked_in' else 'walk_in' end,
         checked_in_at = now(), checkin_via = 'code', updated_at = now()
   where event_attendances.checked_in_at is null
  returning case when status = 'walk_in' then 'walk_in' else 'checked_in' end, event_attendances.checked_in_at;
end $$;
```

`app.events_enter(p_event_id uuid) returns table (outcome text, meeting_url text)` follows the same skeleton for online events, with these outcomes:
- `forward` (before the window, the member's answer is `going`): returns the URL and records nothing.
- `recorded` / `already` (inside the window): upserts `checked_in` or `walk_in` with `checkin_via = 'online'` and returns the URL.
- `confirm_first` (before the window, answer not `going`).
- `ended`.
- `cancelled`.
- `not_found` (including an in-person event).

The URL is returned **only** with `forward`, `recorded` or `already`. After a check-in, `already` keeps `Entrar` working to rejoin (UI-SPEC action zone).

**D-217 decisions recorded:**
- **Store:** `event_secrets` behind `event_secrets_staff_all`.
- **Code:** 4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols, no 0/O/1/I/L), 923,521 combinations. Generated in TypeScript with `crypto.randomInt(31)` per character and normalised at compare time (uppercase; strip spaces and hyphens).
- **Guess bound:** 5 wrong codes per member per event per 15-minute window. Over a ~4 h window that is at most ~80 guesses, ≈ 0.009 % of the space, and the only prize is the guesser's own attendance.
- **Regeneration adopted:** `POST /v1/events/{id}/checkin-code`, guarded by `events.event.manage`. It is a write, so it takes the manage permission. The UI's conditional "Gerar novo código" renders only with that permission.
- **`https:` only:** enforced three times: Zod `z.url({ protocol: /^https$/ })`, the DB CHECK, and a re-check before redirecting.

### Pattern 6: Admin writes (D-212..D-214)

- `POST /v1/events` and one `PATCH /v1/events/{id}` for edit, cancel and reactivate, guarded by `requirePermission('events.event.manage')` written as a literal (the communities rule). The edit body carries the **whole** event, as a replacement rather than a merge (the 04-09 media-triple precedent), because the format, the location fields and the URL move together. `status` changes are a status-only body.
- Create writes `events` + `event_secrets` in **one** `withTenantTx`. The deferred FKs are checked at commit, and the admin lane passes the staff policy.
- Cancel: `update … set status='cancelled', cancelled_at=now() where … and status='active' and now() < ends_at`. Reactivate: `… set status='active', cancelled_at=null where … and status='cancelled' and now() < starts_at`. A zero-row result is disambiguated by a read into `reactivate_started` or a no-op 200.
- **Cover:** copy `resolveCoverAsset` / `coverIsUsable` from `communities/server/service.ts` verbatim. The accepted tuple is `purpose = 'cover'`, `kind = 'image'`, `status = 'ready'`. A foreign or unknown asset gets a bare 404 (the 05-09 oracle fix). A stored dangling cover is self-healed to null on a write that did not assert it (the CR-01 fix).
- Machine codes: `details.event` from a closed `EVENT_ISSUES`. Proposed: `name_required`, `end_before_start`, `location_required`, `url_required`, `url_invalid`, `cover_invalid`, `rsvp_closed`, `cancelled`, `attendance_locked`, `checkin_not_open`, `checkin_closed`, `wrong_code`, `too_many_attempts`, `reactivate_started`, `not_in_person`.
  - Input problems → `400 VALIDATION_FAILED`.
  - State and time refusals → `409 CONFLICT`. `CONFLICT` already exists in `ERROR_CODES` [VERIFIED: packages/contracts/src/errors.ts].
  - Misses → a bare `404 NOT_FOUND` with no details (D-23).

**Permissions (recorded):**

| Key | Granted by `defaultRolePermissions` | Guards |
|---|---|---|
| `events.event.manage` | `admin_tenant` | create, edit, cancel, reactivate, regenerate code, edit-form read (meeting URL) |
| `events.attendance.read` | `admin_tenant` (support_tenant **not** in V1; widening = manifest line + `app.events_staff()` redefinition) | Participantes lists, summary + code |
| `events.attendance.respond` | `admin_tenant`, `support_tenant`, `member` | RSVP, check-in, enter |

`events.attendance.respond` exists because the locked decision says **every** write carries `requirePermission('events.…')`. The feed's likes carry no permission, but that precedent is overridden here by the explicit wording.

**Domain events (recorded).** Ids and instants only; no title, venue, URL or code ever enters a payload (T-05-06 logging rule; the manifest handlers log payloads verbatim):

| Event | When | Payload |
|---|---|---|
| `event.published` | create | `{ tenantId, eventId, actorUserId, format, startsAt, endsAt }` |
| `event.updated` | content change (any field) | `+ timesChanged: boolean` (Phase 7 re-arms reminders when true) |
| `event.cancelled` | transition active → cancelled | `{ tenantId, eventId, actorUserId, startsAt, endsAt }` |
| `event.reactivated` | transition cancelled → active | same; **yes, its own event**: Phase 7 must re-arm reminders cancelled by `event.cancelled` |
| `event.rsvp` | answer changed (not on a repeat) | `{ tenantId, eventId, userId, status, previousStatus, startsAt }` |
| `event.checked_in` | first check-in only | `{ tenantId, eventId, userId, walkIn, via: 'code'\|'online', startsAt }` |

These are emitted with `emit(ctx, …)` after `withTenantTx` resolves; `flushEventsAfterHandler` drops them if the handler threw [VERIFIED: packages/core/server/events/bus.ts]. `startsAt` rides on the RSVP event because the notifications module cannot import events internals (turbo `module` allow-list is kernel/contracts/tooling only [VERIFIED: turbo.json boundaries]). Phase 7 must be able to schedule a member's reminder from the payload alone.

### Pattern 7: `/eventos/{id}/entrar` (D-210, D-218)

```ts
// apps/web/app/(app)/eventos/[eventId]/entrar/route.ts — shape
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
  if (/prefetch/i.test(purpose)) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (!isUuid(eventId)) redirect(`/eventos/${encodeURIComponent(eventId)}`);        // detail renders not-found
  const result = await enterEvent(eventId);            // apiFetch POST /v1/events/{id}/enter
  // forward | recorded | already → external 303; re-check https before redirecting
  // ended | cancelled | confirm_first → /eventos/{id}/entrar/aviso?motivo=encerrado|cancelado|confirmar
  // not_found → /eventos/{id}; 401/403 envelope → bootstrapRedirectPath(...)
}
```

- **Mechanism chosen (D-218):** a plain anchor to a GET route handler that records **only inside the window**. It gets no interstitial and no POST bounce, because a calendar click must count in one tap (D-210/D-211). The defenses are layered:
  1. Every `Entrar` is a plain `<a>` with `target="_blank" rel="noopener noreferrer"`, never `next/link`. Next prefetches only `<Link>` [CITED: node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:8,298].
  2. The SW sends every navigation to `NetworkOnly`: `request.mode === 'navigate' || request.destination === 'document' || …` → `handler: new NetworkOnly()` [VERIFIED: apps/web/app/sw.ts:54-60]. There is no warm-up.
  3. Session cookies are `HttpOnly` + `SameSite=Lax` (STATE 01-02), so unfurlers and cross-site subresources carry no session and are bounced to login by `proxy.ts` before the handler runs.
  4. `Sec-Purpose: prefetch` gets 204. The header's only defined value is `prefetch`, and support is "not Baseline" [CITED: developer.mozilla.org Sec-Purpose], so this is a belt, not the brace.
  5. The API side is a **POST** (`POST /v1/events/{id}/enter`), so the side effect lives behind a non-safe method at the API tier.
- **Outside the window with answer Vou:** forward without recording (the recommended default). **After `ends_at` / cancelled / confirm-first:** the one refusal layout (UI-D-209) at `/eventos/{id}/entrar/aviso?motivo=`, with an unknown `motivo` falling back silently (D-93).
- **Login round-trip:** `isContinuablePath` today accepts only `/^\/post\/[^/]+$/` [VERIFIED: apps/web/lib/continue-path.ts:32-34]. A logged-out member opening the calendar link would therefore land on `/inicio` after login and lose the check-in. **Widen it** to also accept `/^\/eventos\/[0-9a-f-]{36}(\/entrar)?$/` (D-211 calendar links travel outside the app, the same D-56 reasoning). `proxy.ts`'s public `/^\/entrar(?:\/|$)/` is anchored at the root [VERIFIED: apps/web/proxy.ts:23], so `/eventos/{id}/entrar` is private, as it must be.
- **Test (D-218):** a Playwright case on a **production build** (`next start`, the 05.1-05 precedent on :3100) renders the detail page of an in-window online event, waits for the viewport and idle, and asserts (a) no request to `/entrar` was issued and (b) the member's attendance row is absent. Add a unit render asserting the anchor has no `next/link` behaviour (`data-no-prefetch`, plain `<a>`). A dev-server run cannot detect a regression: "Prefetching is only enabled in production" [CITED: link.md:298].

### Pattern 8: Calendar export (D-211, EVENT-06)

- **`.ics`** at `GET /eventos/{id}/agenda.ics` (a route handler; the `download` attribute on a same-origin anchor):

```
BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Rede Social//PT-BR\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n
BEGIN:VEVENT\r\nUID:{eventId}@{primaryHost}\r\nDTSTAMP:{nowUTC}\r\nDTSTART:{startUTC}\r\nDTEND:{endUTC}\r\n
SUMMARY:{esc(title)}\r\nDESCRIPTION:{esc(description + '\n\n' + detailUrl)}\r\nLOCATION:{esc(location)}\r\nURL:{detailUrl}\r\n
STATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n
```

  - UTC instants are formatted `YYYYMMDDTHHMMSSZ`.
  - `esc()` escapes `\` → `\\`, `;` → `\;`, `,` → `\,`, and newlines → `\n`. Content lines fold at **75 octets** with CRLF followed by one space [CITED: RFC 5545 §3.1, §3.3.11]. Fold on UTF-8 byte length without splitting a multi-byte character (pt-BR accents are 2 bytes).
  - VCALENDAR requires `PRODID` and `VERSION`; VEVENT requires `UID` and `DTSTAMP` [CITED: RFC 5545].
  - Serve with `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="evento.ics"` and `Cache-Control: private, no-store`.
- **Google Calendar:** `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates={startUTC}/{endUTC}&details=…&location=…`. Use UTC `…Z` dates and **omit `ctz`**: "the wrong combination is UTC timestamps together with ctz" [CITED: interactiondesignfoundation.github.io/add-event-to-calendar-docs/services/google.html, via web search — community documentation, no official Google spec]. Build it with `URLSearchParams`; truncate `details` (~1,000 characters) to bound the URL.
- **LOCATION:**
  - In person: `venue, address`.
  - Online: `${origin}/eventos/{id}/entrar`, where `origin` comes from `primaryHostOrigin()` (the tenant's verified primary host, already used for share links). Fall back to the request origin when it is null (local/generic shells).
  - Never the meeting URL.

### Anti-Patterns to Avoid
- **Putting `meeting_url` or `checkin_code` on `events`.** Any member-lane `select *` would leak it, and D-207 forbids it.
- **Raising an exception for a wrong code inside the transaction that increments the counter.** The rollback erases the increment and the bound never trips. Return outcomes; throw `ApiError` only **after** `withTenantTx` resolves.
- **A trigger-owned counter updated from the guard trigger's transaction.** See Pitfall 3.
- **`next/link` to `/entrar` anywhere**, including the Início card and the calendar's own UI.
- **Formatting instants in a client component.** Node and browser ICU can differ, and render must never call `Date.now()` (UI-D-14). Strings cross from the server; islands receive only ISO boundaries for `router.refresh()` scheduling.
- **`ctz` together with `…Z` dates** in the Google link.
- **Reading the event row in the service and then writing the attendance** (read-then-write). The trigger's `FOR SHARE` and the single upsert are the arbiter.
- **Naming anything under `packages/contracts/src/events.ts`.** That file is the domain-event bus contract, not the events module. The module's contracts live in `packages/modules/events/contracts/index.ts` and merge into `EventMap` from there.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wall-clock ↔ UTC in an IANA zone | JS offset search over `Intl.formatToParts` | Postgres `timestamp at time zone tenants.timezone` / `to_char(… at time zone …)` | DST gaps and folds, tzdata updates; verified behaviour on the live stack |
| Keyset cursors | A new cursor codec | `encodeCursor` / `decodeCursor` / `keysetComparison` (`@rede-social/core/server/paging`) | ONE envelope rule (R-11); total decode |
| Cover validation | New asset checks | Clone `resolveCoverAsset` + `coverIsUsable` tuple rule | Closes the 05-09 cross-tenant FK oracle; CR-01 self-heal |
| Rate limiting the code | Redis, in-memory maps (Cloud Run is multi-instance) | `event_checkin_attempts` written only by the definer function | Shared state across instances, survives restarts, testable in pgTAP |
| Permission checks in the web tier | Role comparisons | `bootstrap.permissions.includes(...)` | FEED-08 / T-05-03 rule |
| Upload | New upload code | `useSignedUpload` with `purpose: 'cover'` | Phase 3 machine, zero new code |
| Infinite lists | Custom observers | `@rede-social/ui` `InfiniteScroll` + `PullToRefresh` + `ScrollContainerContext` | Shipped and tested |
| Module nav/home plumbing | Kernel edits | `defineModule({ nav, home })` + `WEB_MODULE_REGISTRY.events` | MOD-04; kernel stays module-agnostic |

**Key insight:** the novel parts (secrets, windows, the side-effecting GET) are all enforced *below* the API. The API and UI only reflect the rules. That is what makes the pgTAP suite the proof and not the UI tests.

## Common Pitfalls

### Pitfall 1: The wrong-code counter never increments
**What goes wrong:** the service throws `ApiError(409, …wrong_code)` inside the `withTenantTx` callback, or the definer function `RAISE`s. The transaction rolls back together with the attempts upsert.
**How to avoid:** the function returns `'wrong_code'`. The service returns the outcome out of `withTenantTx` and throws **after** it resolved. Pin it with an integration test: 5 wrong codes, then the 6th with the **right** code → `too_many_attempts`.
**Warning signs:** the guess-bound test passes only when the wrong codes are sent in one request.

### Pitfall 2: A definer function leaks across tenants
**What goes wrong:** `postgres` bypasses RLS (`rolbypassrls = t`, verified). A missing `tenant_id = app.tenant_id()` in any statement inside `app.events_*` reads or writes another tenant's rows.
**How to avoid:** every statement filters by both claims; pgTAP calls each function from tenant A's lane with tenant B's event id and asserts `not_found` **and** no row written, with its positive control in the same block.

### Pitfall 3: Deadlock from lock upgrade
**What goes wrong:** if a counter trigger `UPDATE events … confirmed_count` runs in a transaction whose guard trigger already took `FOR SHARE` on the same row, two concurrent RSVPs each hold SHARE and wait for the other's to UPDATE → deadlock.
**How to avoid:** read-time counts (recommended). If counters are ever added, the guard must take `FOR NO KEY UPDATE` instead (serialising RSVPs per event).

### Pitfall 4: Deferred constraints never fire inside pgTAP
**What goes wrong:** `supabase test db` files run inside one transaction that is rolled back, so `DEFERRABLE INITIALLY DEFERRED` FKs are never checked, and an "online event without a URL" test passes vacuously.
**How to avoid:** issue `set constraints all immediate;` before the `throws_ok` that exercises the XOR and existence FKs.

### Pitfall 5: Cross-tenant cover id persists (05-09 regression)
**What goes wrong:** `cover_asset_id` goes straight into SQL. FK checks run as the table owner and bypass RLS, so another tenant's asset id persists, and a 23503-vs-201 split becomes an existence oracle.
**How to avoid:** resolve the cover inside the writing transaction with the communities tuple rule. The integration test sends a tenant-B asset id → bare 404.

### Pitfall 6: D-218 test passes on the dev server
**What goes wrong:** Next prefetches only in production, so a `next/link` regression is invisible under `next dev`.
**How to avoid:** run the no-side-effect spec against `next build && next start` (the 05.1-05 scratchpad-config pattern on :3100).

### Pitfall 7: Window e2e flakes because the server clock is real
**What goes wrong:** `page.clock` moves only the browser. The API and DB use real `now()`, so fast-forwarding the page never opens the window server-side.
**How to avoid:**
- Integration and e2e fixtures insert events **relative to real `now()`** through admin SQL (`apps/web/e2e/admin.ts` / `apps/api/tests/integration/setup.ts` `adminSql`).
- For the Início switch, create an event whose `starts_at − 1 h` is ~15 s ahead and wait out the real boundary.
- Do not rely on seeded "in progress" events for timing: the seed runs long before e2e (use multi-day spans for demo data).

### Pitfall 8: Migration and meta-snapshot collisions with 05.2/05.3
**What goes wrong:** drizzle-kit's snapshot chain (`supabase/migrations/meta/*_snapshot.json`) is linear. A migration generated before 05.2/05.3 land will not apply cleanly after them.
**How to avoid:** generate the events migration **at execution time**, after 05.2/05.3 are merged (`pnpm db:generate --name=events`). Never copy a generated file between branches. Re-run `pnpm db:generate` and assert an empty diff (migration hygiene).

### Pitfall 9: Shared files other phases also edit
**What goes wrong:** stale assumptions about nav, test counts or catalog state.
**How to avoid:** read current state at execution time for each file below.

| File | Collision |
|---|---|
| `apps/api/src/modules/registry.ts`, `apps/api/src/app.ts`, both `package.json`s | 05.3 (Reels) likely adds its own entries |
| `apps/api/tests/unit/registry.test.ts:53` | Asserts `expect(keys.sort()).toEqual(['communities', 'feed', 'stories']);` [VERIFIED]. It gains `events` (and whatever 05.3 adds) |
| `apps/web/lib/registry.tsx` (`WEB_MODULE_REGISTRY`) | 05.2 rewrites `storiesHome` |
| `apps/web/e2e/shell.spec.ts` and every spec asserting the nav list | Eventos adds a tab on **both** seed tenants (both have every module on via `REAL_TENANT_DEFAULT_MODULES`), and 05.3 adds Reels. The Phase 4 gate once failed on exactly this |
| `supabase/tests/020-tenant-isolation.sql` | Currently `plan(100)`; 05.2 also extends it. Recount at execution |
| pgTAP file number | 05.2 claims `120-story-highlights.sql`. Use `130-events.sql` or the next free number |
| `scripts/seed.ts` | 05.2/05.3 add fixtures; append the events block |
| Nav `order: 40` | Assumes Reels picks < 40. If 05.3 picks > 40, Reels lands after Eventos with no edit here (UI-D-215) |
| Home slot `order: 7` | 05.2 keeps stories at 5 (its RESEARCH), feed stays at 10 [VERIFIED: packages/modules/feed/module.ts:29] |

### Pitfall 10: The long-running `next dev` memoizes the catalog
**What goes wrong:** the new `events.json` keys raise `MISSING_MESSAGE` in e2e.
**How to avoid:** run e2e against a fresh production `next start` (05.1-05 STATE note).

### Pitfall 11: Two meanings of "Confirmados"
**What goes wrong:** the member-facing "N confirmados" (going + checked_in) and the admin chip `Confirmados · n` (going only) are computed by one shared expression, and one of the two is wrong.
**How to avoid:** two named contract fields (`confirmedCount`, `pendingConfirmedCount`), each pinned by a test on the seeded mix.

### Pitfall 12: Secrets or titles in logs
**What goes wrong:** a service log line or a manifest subscriber that spreads the payload exposes the code or the URL.
**How to avoid:** log lengths and flags only (`hasCover`, `format`). No payload field may hold the code or URL; a contract test asserts the payload key sets (the `story-pins.test.ts` precedent).

## Code Examples

### Manifest (from the communities/stories precedents)
```ts
// packages/modules/events/module.ts
export const eventsModule = defineModule({
  key: 'events',
  nav: { placement: 'tab', label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
  home: [{ order: 7 }],
  routes: () => import('./server/routes').then((m) => m.eventsRoutes),
  events: [ /* event.published, event.updated, event.cancelled, event.reactivated, event.rsvp, event.checked_in — log shape only */ ],
  defaultRolePermissions: {
    admin_tenant: [EVENT_PERMISSIONS.manage, EVENT_PERMISSIONS.attendanceRead, EVENT_PERMISSIONS.respond],
    support_tenant: [EVENT_PERMISSIONS.respond],
    member: [EVENT_PERMISSIONS.respond],
  },
});
```
`'calendar-days': CalendarDays` is already in `ICONS` [VERIFIED: packages/core/ui/nav.ts:133]. `ModuleNavPlacement` is `'tab' | 'topbar'` and `ModuleHomeSlot` is `{ order: number }` [VERIFIED: packages/core/server/modules/manifest.ts:11,45-47]. `'events'` is already in `TOGGLEABLE_MODULES` and `REAL_TENANT_DEFAULT_MODULES` [VERIFIED: packages/contracts/src/modules.ts:2-9,19-26].

### Mapping a guard-trigger refusal (the `isSlugCollision` walk, generalised)
```ts
const GUARD_CODES: Record<string, EventIssue> = {
  event_attendances_rsvp_open: 'rsvp_closed',
  event_attendances_event_active: 'cancelled',
  event_attendances_locked: 'attendance_locked',
  event_attendances_checkin_window: 'checkin_not_open',
};
function guardIssue(error: unknown): EventIssue | 'not_found' | null {
  for (let c: any = error, seen = new Set(); c && !seen.has(c); seen.add(c), c = c.cause) {
    if (c.code === '23503' && c.constraint_name === 'event_attendances_event_visible') return 'not_found';
    if (c.code === '23514' && c.constraint_name in GUARD_CODES) return GUARD_CODES[c.constraint_name];
  }
  return null;
}
```

### Web home slot that renders nothing on failure (UI-D-214, the stories-strip rule)
```tsx
const eventsHome: HomeSlotRenderer = async ({ bootstrap }) => {
  const next = await loadNextEvent();          // swallows → null, logs 'events.next_failed'
  if (!next) return null;                      // /inicio closes up
  return <NextEventCard … />;                  // strings + ISO boundaries from the server
};
// WEB_MODULE_REGISTRY.events = { home: [eventsHome] }
```
`homeSlotsFor` would replace a **rejected** renderer with the generic error card, so the renderer must catch its own errors [VERIFIED: apps/web/lib/registry.tsx `homeSlotsFor`].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `timeZone` pinned to `'America/Sao_Paulo'` in web formatters | `bootstrap.tenant.timezone` | This phase | Two files change; `bootstrap.test.ts` must accept the new key |
| `isContinuablePath` = `/post/{id}` only | + `/eventos/{id}` and `/eventos/{id}/entrar` | This phase | Calendar links survive a login |
| Every table on `tenantIsolationPolicy` only | First role-claim policy (`app.events_staff()`) and first SECURITY DEFINER functions called from a module service | This phase | A new pattern; document it in `SCHEMA-CONVENTIONS.md` (a §(l) "secrets inside a tenant") |

**Deprecated/outdated:**
- Prototype `formatEventDate` (`getUTC*`, no timezone): do not port (CONTEXT).
- Prototype `framer-motion` import: use `motion/react` (UI-SPEC).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `DEFERRABLE INITIALLY DEFERRED` on a NO ACTION FK with `ON DELETE CASCADE` behaves as described (update checked at commit, delete cascades immediately) | Pattern 1 | A format switch fails at commit. The pgTAP case with `set constraints all immediate` will show it; fallback is dropping the existence FK and relying on a reconciliation assertion |
| A2 | Google Calendar honours `action=TEMPLATE` with UTC `…Z` dates and no `ctz` | Pattern 8 | Wrong times in Google Calendar. Mitigation: a manual UAT check on a real Google account (no automated oracle) |
| A3 | iOS/Android calendar apps open the `LOCATION` URL `…/entrar` as a tappable link in the tenant's browser, carrying the session cookie of the installed PWA's origin | Pattern 7/8 | On iOS the PWA's cookie jar is separate from Safari's, so a calendar tap may hit login first. Covered by the widened continue path; verify on the phone UAT |
| A4 | 5 attempts / 15 min is an acceptable guess bound for the pilot | Pattern 5 | UX friction if members mistype often; a one-constant change |
| A5 | Counting staff answers and removed members in "N confirmados" is acceptable (D-219) | Pattern 3 | A number slightly different from the organiser's expectation; one predicate to change |
| A6 | Allowing an admin to create or edit an event whose start is already past (no refusal) is acceptable | Pattern 6 | A past event appears directly in Passados; add `starts_in_past` to `EVENT_ISSUES` if the pilot objects |

## Open Questions (RESOLVED)

1. **Should `support_tenant` see the code at the door?**
   - What we know: CONTEXT defaults to `admin_tenant` only; widening is one manifest line plus `app.events_staff()`.
   - Recommendation: ship `admin_tenant` only; list it in the UAT as a question for the pilot organiser.
   - RESOLVED: `admin_tenant` only in Phase 6, the CONTEXT default. 06-01 (planning decision 1) grants `events.attendance.read` to `admin_tenant` alone and puts `event_secrets` behind an inline role-claim policy (`app.tenant_role() = 'admin_tenant'`) instead of an `app.events_staff()` helper. 06-07's `must_haves` state that `support_tenant` sees neither the code nor the list. Widening later is one manifest line plus one generated `ALTER POLICY` on `event_secrets_staff_all`. 06-09's phone UAT (item 9) asks the pilot organiser whether door staff need the code, and 06-07's SUMMARY records it under "UAT questions". The pilot's answer can only widen access with that two-line change. It cannot reopen this phase's design.
2. **Phase 7's reminder text needs the event title, which no payload carries.**
   - What we know: payloads are ids and instants (logging rule), and modules cannot import each other.
   - Recommendation: Phase 7 resolves it (e.g. a kernel-level read contract, or a notification rendered from a published events read). Not a Phase 6 blocker; record it in the Phase 7 notes.
   - RESOLVED: out of Phase 6 scope, and handed to Phase 7. Phase 6 payloads stay ids and instants (06-01 planning decision 8), and no title is added to any payload. `event.updated` carries `startsAt`, `endsAt` and `timesChanged` (06-04), so reminders can be re-armed from the payload alone. 06-01's SUMMARY records the title gap under "Notes for Phase 7": reminder copy reads the title through a published events contract. Phase 7 chooses that read path. No Phase 6 task depends on the choice.
3. **Should the meeting URL be re-validated against a host allow-list (Zoom/Meet/Teams)?**
   - Recommendation: no. `https:` only is the locked rule; the admin is trusted, and the URL is never fetched server-side (no SSRF surface).
   - RESOLVED: no host allow-list. The URL is checked for `https:` three times: Zod `z.url({ protocol: /^https$/ })` and the `event_secrets_https_chk` CHECK (06-01), then a re-check before the redirect (06-06). 06-04's `must_haves` record this decision, and threat T-06-24 covers it. It follows CONTEXT's locked rule "the meeting URL is validated as `https:` only".

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | 24.14.0 | — |
| pnpm | workspace | ✓ | 12.4.1 | — |
| Docker + local Supabase stack | DB, pgTAP, integration, e2e | ✓ (db, auth, storage, realtime, kong, pooler containers running) | Postgres 17.6 | — |
| Supabase CLI | migrations, `supabase test db` | ✓ (`node_modules/.bin/supabase`) | 2.117.0 | — |
| Playwright | e2e | ✓ (`node_modules/.bin/playwright`) | 1.63.0 | — |
| Real Google Calendar / iOS device | A2/A3 checks | ✗ (manual) | — | Phone UAT at `/gsd-verify-work` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** real-device and real-Google checks become UAT items.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (module, ui, web, API), Playwright 1.63.0 (e2e), pgTAP via `pnpm supabase test db` (CLI 2.117.0) |
| Config file | `packages/modules/events/vitest.config.ts` (**new**, clone of communities'), `packages/ui/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/api/vitest.config.ts` (pins `VIDEO_PROVIDER: 'fake'`), `apps/web/playwright.config.ts`, `supabase/tests/*.sql` |
| Quick run command | `pnpm --filter @rede-social/module-events typecheck && pnpm --filter @rede-social/module-events lint && pnpm --filter @rede-social/module-events test` |
| API integration command | `pnpm db:reset && pnpm db:seed && pnpm test:integration -- events` (plus `isolation`, `bootstrap`, `modules`) |
| DB command | `pnpm supabase test db` |
| Migration hygiene | `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)"` |
| Full suite command | `pnpm db:reset && pnpm db:seed && pnpm lint && pnpm typecheck && pnpm test && pnpm boundaries && pnpm supabase test db && pnpm test:integration && pnpm --filter @rede-social/web build && pnpm check:static-routes && VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test events.spec.ts phase6-smoke.spec.ts shell.spec.ts` (the local exit gate remains `pnpm verify`) |

All root scripts exist [VERIFIED: package.json scripts `lint`, `typecheck`, `test`, `boundaries`, `db:generate`, `db:reset`, `db:seed`, `test:integration`, `check:static-routes`, `verify`, `supabase`]. `scripts/check-ui-literals.sh` and `scripts/check-static-routes.sh` exist [VERIFIED: ls scripts]. Web unit subsets: `pnpm --filter @rede-social/web exec vitest run lib/events` and `pnpm --filter @rede-social/web exec vitest run "app/(app)/eventos"`.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVENT-01 | Create/edit/cancel/reactivate; member 403; XOR + window CHECKs; wall-clock → UTC in tenant tz; cover tuple + foreign-asset bare 404; reactivate refused after start; events emitted once after commit | integration + pgTAP + module unit | `pnpm test:integration -- events`; `pnpm supabase test db`; `pnpm --filter @rede-social/module-events test` | ❌ W0 (`apps/api/tests/integration/events.test.ts`, `supabase/tests/130-events.sql`, `packages/modules/events/tests/*.test.ts`) |
| EVENT-01 | Admin form on a phone: create → detail, edit, cancel → banner, Reativar; the `+2 h` end prefill; format switch submits only the visible side | e2e (mobile-chromium) + web unit | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test events.spec.ts -g "admin"`; `pnpm --filter @rede-social/web exec vitest run "app/(app)/eventos"` | ❌ W0 |
| EVENT-02 | Próximos/Passados keysets (asc/desc, ties, in-progress stays upcoming, cancelled stays), `/next` excludes cancelled, detail in tenant tz under `timezoneId: 'America/Manaus'` | integration + pgTAP EXPLAIN (index by name) + e2e + web unit (`events-view.test.ts` fixed clock/tz) | `pnpm test:integration -- events`; `pnpm supabase test db`; `pnpm --filter @rede-social/web exec vitest run lib/events-view`; playwright `events.spec.ts -g "lista"` | ❌ W0 |
| EVENT-03 | RSVP toggle, repeat answer = no write/no event, `rsvp_closed` at `starts_at` (API 409 + pgTAP trigger raise under relative `now()`), locked after check-in, count semantics (D-219) | integration + pgTAP + e2e | same commands | ❌ W0 |
| EVENT-04 | Code check-in inside the window; `not_open` / `closed` / `cancelled`; walk-in from no row and from `not_going`; wrong code; 6th attempt `too_many_attempts` even with the right code; online `/enter` outcomes (`forward` records nothing, `recorded` walk-in, `ended`, `confirm_first`); detail render records nothing (prod build) | pgTAP (definer functions from both tenants) + integration + e2e | `pnpm supabase test db`; `pnpm test:integration -- events`; `pnpm --filter @rede-social/web exec playwright test events.spec.ts -g "check-in\|entrar"` (prod `next start` for the D-218 case) | ❌ W0 |
| EVENT-05 | Participantes three chips + counts + keyset + walk-in tag + removed member; code card; member 403 on attendance routes; **member lane reads 0 rows of `event_secrets`**, admin lane reads 1 | pgTAP + integration + e2e | `pnpm supabase test db`; `pnpm test:integration -- events`; playwright `-g "participantes"` | ❌ W0 |
| EVENT-06 | `.ics` bytes: CRLF, 75-octet folding with accents, escaping, UTC DTSTART/DTEND, online LOCATION is `/entrar`, never the meeting URL; Google link: `…Z` dates, no `ctz`; download in e2e | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/events-calendar`; playwright `-g "agenda"` | ❌ W0 |
| TENANT-05 (gate) | Four new tables in 020 (A sees own, zero of B, positive control); new endpoints in `isolation.test.ts` (B's id → bare 404, host mismatch 403) | pgTAP + integration | `pnpm supabase test db`; `pnpm test:integration -- isolation` | ✅ files exist; cases ❌ W0 |
| MOD-02/04 | Registry lists `events`; tab order 40; home order 7; module off → routes 404 + tab gone; boundaries clean | API unit + integration + boundaries | `pnpm --filter @rede-social/api test`; `pnpm test:integration -- modules`; `pnpm boundaries` | ✅ (update `registry.test.ts`) |

### Sampling Rate
- **Per task commit:** the quick run for the touched package (plus `pnpm --filter @rede-social/web exec vitest run <folder>` for web tasks, `pnpm --filter @rede-social/ui test` for `SegmentedControl`).
- **Per wave merge:** `pnpm db:reset && pnpm db:seed && pnpm test:integration -- events` + `pnpm supabase test db` + migration hygiene + `bash scripts/check-ui-literals.sh`.
- **Phase gate:** the full suite (`pnpm verify`) green before `/gsd-verify-work`, then the phone UAT: RSVP, code at the "venue", `Entrar` from a calendar entry, `.ics` import on iOS and Google.

### Wave 0 Gaps
- [ ] `packages/modules/events/` package scaffold including `vitest.config.ts` (Vitest 5 does not walk up) and `tests/`.
- [ ] `apps/api/tests/integration/events.test.ts`, with fixtures that insert events relative to `now()` through `adminSql`.
- [ ] `supabase/tests/130-events.sql` (number re-checked against 05.2's 120) plus the 020 cases and plan recount.
- [ ] `apps/web/lib/events-view.test.ts`, `apps/web/lib/events-calendar.test.ts`, `packages/ui/tests/segmented-control.test.tsx`.
- [ ] `apps/web/e2e/events.spec.ts` + `events-admin.ts` fixtures; `phase6-smoke.spec.ts`; production-build config for the D-218 case (scratchpad config overriding `baseURL` to :3100, the 05.1-05 pattern).
- [ ] TDD plans: Vitest emits no TAP, so each TDD plan needs a throwaway red-evidence normalizer (project memory). Never fabricate counts.
- [ ] Update, not delete: `registry.test.ts:53`, `shell.spec.ts` nav lists, `bootstrap.test.ts` tenant keys.

## Security Domain

`security_enforcement: true`, ASVS level 1, `security_block_on: high` [VERIFIED: .planning/config.json].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | Supabase session via `@supabase/ssr`; `requireAuth` on every route; `/entrar` behind `proxy.ts` private paths |
| V3 Session Management | yes | HttpOnly + SameSite=Lax cookies; no tokens in pages; `Cache-Control: no-store` on `/entrar` and `.ics` |
| V4 Access Control | yes | `requirePermission` per write; `requireModule('events')` → 404; RLS tenant isolation; role-claim policy on `event_secrets`; self-only RSVP write policies; definer functions with explicit tenant/user filters |
| V5 Input Validation | yes | Zod 4 `.strict()` contracts; `z.url({ protocol: /^https$/ })`; date `YYYY-MM-DD` / time `HH:MM` regexes; length caps as contract constants; DB CHECKs |
| V6 Cryptography | partial | `crypto.randomInt` for codes (never `Math.random`); no custom crypto |
| V7 Error/Logging | yes | Closed machine codes; no titles, URLs or codes in logs or event payloads |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Member reads the meeting URL or code via an API bug | Information disclosure | `event_secrets` staff-only policy; definer functions return the URL only when the gate passes; pgTAP member-lane case |
| Cross-tenant IDOR on event, attendance or cover ids | Information disclosure / Tampering | RLS + explicit `tenant_id` predicates + composite `(tenant_id, event_id)` FKs; bare 404 with no details; cover resolved in-lane |
| Code brute force | Elevation (fake presence) | 31^4 space + 5 per 15 min per member per event, DB-backed; regenerate on leak |
| Self-check-in without the code via a direct attendance UPDATE | Tampering | RLS lane may write only `going` / `not_going`; `checked_in` / `walk_in` only through `app.events_check_in` / `app.events_enter` |
| RSVP or check-in outside the window, or on a cancelled event (race with admin edit) | Tampering | Guard trigger with `FOR SHARE` on the event row; server `now()` only |
| Open redirect via `/entrar` | Spoofing | Redirect only to the stored URL; `https:` enforced at Zod, CHECK and use; never a query parameter |
| CSRF / unfurl / prefetch firing `/entrar` | Tampering (spurious check-in) | Lax cookies (no cross-site subresource session), `Sec-Purpose` 204, plain anchors, SW NetworkOnly, API-side POST; the residual is a top-level cross-site navigation that checks in the victim inside the window, low impact → document as accepted risk |
| ICS property injection via title/description newlines | Tampering | RFC 5545 TEXT escaping (`\n`, `;`, `,`, `\`) and folding; unit test with a hostile title |
| Stored XSS in description/venue | Tampering | Render as text (`whitespace-pre-line`), no `dangerouslySetInnerHTML`, no auto-linking in V1 |
| SSRF via the meeting URL | Information disclosure | The URL is never fetched server-side (no unfurl of it) |
| Definer function search_path hijack | Elevation | `set search_path = ''`, fully-qualified names, `revoke all from public` |

## Sources

### Primary (HIGH confidence)
- Codebase, read this session: `packages/modules/communities/{module.ts,contracts/index.ts,db/schema.ts,server/routes.ts,server/service.ts}`, `packages/modules/stories/{module.ts,db/schema.ts}`, `packages/core/server/{modules/manifest.ts,events/bus.ts,paging.ts,rbac/permissions.ts}`, `packages/core/db/{rls.ts,tenant-tx.ts,schema/tenants.ts,schema/notification-stubs.ts}`, `packages/core/docs/SCHEMA-CONVENTIONS.md`, `packages/contracts/src/{modules.ts,bootstrap.ts,events.ts,errors.ts}`, `apps/api/src/{app.ts,modules/registry.ts,routes/me.ts}`, `apps/api/drizzle.config.ts`, `apps/web/{lib/registry.tsx,lib/communities.ts,lib/api.ts,lib/continue-path.ts,proxy.ts,app/sw.ts,next.config.ts}`, `supabase/migrations/20260912030541_app_helpers.sql`, `20260912031029_app_membership_lookup_and_grants.sql`, `supabase/tests/{000,010,040,110}-*.sql`, `turbo.json`, `package.json`.
- Live probes on the local stack (Postgres 17.6): timezone conversion and DST behaviour; `INSERT … SELECT … FOR SHARE`; `RAISE … USING constraint`; a role-claim policy (member 0 rows, admin 1 row); a SECURITY DEFINER read from the member lane; `ON CONFLICT DO UPDATE … WHERE` against an RLS update policy (0 rows, no error); `rolbypassrls` of `postgres`.
- Node 24.14 probes: `Intl` pt-BR output, `longGeneric` zone name, `Temporal` absent; zod 4.6.2 `z.url({ protocol })`.
- Next.js 16 bundled docs: `route-handlers.md:39` (route vs page), `link.md:8,298` (prefetch only `<Link>`, production only), `route.md` (redirect in route handlers; GET dynamic by default since v15).

### Secondary (MEDIUM confidence)
- RFC 5545 §3.1 / §3.3.11 (datatracker.ietf.org): folding, TEXT escaping, required properties.
- MDN `Sec-Purpose`: the only value is `prefetch`; limited availability.

### Tertiary (LOW confidence)
- Google Calendar template link parameters: community docs (InteractionDesignFoundation add-event-to-calendar-docs, makecalendarlink), no official spec. A2 is flagged for UAT.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. There are no new packages; everything is in the lockfile or built in.
- Architecture: HIGH for module plumbing (direct clones of shipped modules). MEDIUM-HIGH for the secrets/definer design (probed, but new to this repo and it needs a SCHEMA-CONVENTIONS addendum).
- Pitfalls: HIGH. Most come from this repo's own STATE history or were reproduced live.

**Research date:** 2026-09-25
**Valid until:** 2026-10-25 (stack pinned). Re-check the collision table when 05.2/05.3 finish.
