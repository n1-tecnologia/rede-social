# Phase 6: Events - Context

**Gathered:** 2026-09-25
**Status:** Ready for planning

> **Decision numbering.** Phase 6 was discussed while 05.2 (Story Highlights) and 05.3 (Reels) were still open; both execute before this phase. 05.2's context claims the running sequence from **D-100 onward**, and 05.3 will continue it. To stop the two runs colliding, this phase owns the separate block **D-200..D-219**. Its UI-SPEC follows the same rule and starts at **UI-D-200**, because 05.2's UI-SPEC continues from UI-D-59.
>
> **Roadmap cut (2026-09-25, after this discussion).** The MVP is Phases 1–8 plus 01.1 and 05.1–05.3. The "Rede social" module (follow graph, member authoring, Explorar, direct messages) moved to post-MVP Phases 9–11. Nothing in this phase may depend on it.

<domain>
## Phase Boundary

Phase 6 adds the events module (`@rede-social/module-events`, registry key `events`, already in `TOGGLEABLE_MODULES` and `REAL_TENANT_DEFAULT_MODULES`). It covers EVENT-01..EVENT-06:

- **Authoring (EVENT-01):** `admin_tenant` creates, edits and cancels an event from a phone. An event has a title, description, cover, a timezone-aware start and end, and exactly one of: a physical venue with an address, or an online link.
- **Browsing (EVENT-02):** members see an `Eventos` tab split into upcoming and past, plus an event detail page. Times always render in the tenant's timezone.
- **RSVP (EVENT-03):** members answer going / not going before the event and see how many confirmed.
- **Check-in (EVENT-04):** on the day, inside the check-in window, a member checks in. A check-in without a prior RSVP is recorded as a walk-in.
- **Attendance (EVENT-05):** `admin_tenant` sees who confirmed and who checked in.
- **Calendar (EVENT-06):** members add the event to their calendar with an `.ics` download and a Google Calendar link.

Out of this phase:
- Reminders (EVENT-07) and "new event" notifications. Both are built in Phase 7, which consumes the domain events emitted here.
- The admin panel and moderation (Phase 8).
- Everything REQUIREMENTS.md already marks V2:
  - V2-EVENT-01: QR / geofence check-in and admin manual check-in.
  - V2-EVENT-02: update and cancel notifications.
  - V2-EVENT-03: CSV export, "maybe" RSVP, capacity and waitlist.
- Prototype extras on PROTOTYPE.md's do-not-port list: ticketing, payment, certificates, hours, event photos, nearby places, Airbnb, the QR scanner.

</domain>

<decisions>
## Implementation Decisions

### Carried forward (locked before this discussion — do not re-open)
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

### Eventos tab & detail page
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

### RSVP
- **D-204: RSVP is open until `starts_at`.**
  - Before the start, the member sets and changes their answer freely.
  - From the start, RSVP is closed and only check-in remains; a check-in without a prior "Vou" is a walk-in (EVENT-04).
  - Once a member has checked in, the answer is locked.
  - The API and the database refuse an RSVP write after `starts_at`, with a stable machine code (D-09). The UI hiding the control is not enough.
- **D-205: The RSVP control is a segmented pair, `Vou` / `Não vou`,** replacing the prototype's single "Garantir minha vaga" CTA.
  - `Não vou` is a **recorded answer**, so the admin can tell "declined" from "never answered".
  - Rejected: a single "Confirmar presença" toggle, which merges an explicit no and a change of mind.
- **D-206: Members see a count only, "N confirmados",** on the poster card and the detail page, exactly EVENT-03.
  - No avatar stack and no "Ana, João e mais 21". Who is going stays between each member and the admin.
  - That avoids exposing attendance tenant-wide, and avoids a second rule for staff whom D-47 hides from the directory.
- **D-207: An online event's link is gated by the member's answer and by the window.**
  - **Before the window opens (D-209):**
    - A member whose answer is `Vou` gets `Entrar`.
    - Everyone else sees an invitation to confirm (pt-BR copy such as "Confirme presença para receber o link").
  - **From the window's opening to `ends_at`:** `Entrar` works for **every** member. A member who never confirmed is recorded as a walk-in, the same rule as in person. That keeps EVENT-04 true online.
  - **The raw URL never appears in any member payload, page or export.** Members always go through the app's `/eventos/{id}/entrar` route (D-210), so the gate is enforced server-side at click time.
  - Consequence for the schema: a member session must not be able to read the URL through RLS. Defense in depth means the URL cannot sit in a column any member-lane read can select; the planner picks the shape (D-217).

### Check-in
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

### Admin authoring & cancel
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 6: Events": the goal, four success criteria, **Research needed** (store UTC plus the tenant timezone, render America/Sao_Paulo) and **Notes** (`attendances` one row per user with status transitions; `event.published` / `event.rsvp` / `event.cancelled` emitted here; EVENT-07 in Phase 7).
- `.planning/ROADMAP.md` §Overview "Cross-cutting rules carried by every phase": the isolation suite as the exit gate, schema conventions, the module package plus registry, the design-language rule (UI-01/UI-04), the pt-BR catalog, and the Supabase Free plan.
- `.planning/ROADMAP.md` §"Phase 7": how reminders (EVENT-07) and "new event" notifications will consume this phase's events.
- `.planning/REQUIREMENTS.md`: EVENT-01..EVENT-06 (exact wording), EVENT-07 (Phase 7), **V2-EVENT-01..03** (what stays out), NOTIF-01 (new events and reminders are notification kinds), ADMIN-04 (event creation must work from a phone).
- `.planning/PROJECT.md` §Key Decisions: "Events: RSVP before + check-in on the day, admin sees attendance".

### Prior decisions this phase builds on
- `.planning/phases/05.1-community-authoring-entry-points/05.1-CONTEXT.md`:
  - **D-86**: title-row create control, the model for D-212.
  - **D-88**: one keyset query per status chip, the model for D-200 and D-215.
  - **D-90**: reversible archive with `Reativar`, the model for D-214.
  - **D-93**: silent fallback for bad query params.
- `.planning/phases/05-communities-stories/05-CONTEXT.md`:
  - **D-66**: port the prototype first; design only what is missing.
  - **D-69**: brand-gradient fallback for a missing cover.
  - **D-77**: nav driven by flag, not data; the empty state is the creation entry.
- `.planning/phases/04-feed/04-CONTEXT.md`:
  - **D-51**: no type chips, which is why `typeLabel` is recommended out.
  - **D-53**: an XOR rule expressed declaratively, the model for venue-XOR-URL.
  - **D-55**: the `Eventos` tab budget.
  - **D-56**: URL shapes become permanent once shared, which is why D-210/D-211 are costly.
  - **D-57**: full-screen authoring routes.
- `.planning/phases/03-media-pipeline-member-profiles/03-CONTEXT.md`:
  - D-43/D-44: the media broker for covers.
  - **D-47**: staff hidden from the directory, relevant to D-206 and D-219.
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-CONTEXT.md`:
  - **D-33**: UI-SPEC plus mockup review before prototype-less screens.
  - **D-40**: registry-driven nav tabs.
  - **D-42**: `/inicio` home slots.
  - D-25: brand pair; D-39: desktop rail; D-41: light/dark tokens.
- `.planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-CONTEXT.md`:
  - **D-09**: stable machine error codes, needed for the RSVP-closed, outside-window and wrong-code refusals.
  - D-16/D-17: `events` is toggleable and on by default.
  - D-18: package layout.
- `.planning/phases/05.2-story-highlights/05.2-CONTEXT.md`: being written in parallel. It reshapes the Início stories row that D-202's card sits under, and it owns the D-100+ id run this phase steps around.

### Design (the prototype is the visual source of truth)
- `reference/frontend-design/app/(app)/events/page.tsx`: `EventPoster` (4/5 cover, gradient, status pill top-left, title and place bottom), the `Gallery` section header style and the "Nada por aqui ainda" empty card. Port the card; replace the rails with D-200's chips.
- `reference/frontend-design/app/(app)/events/[eventId]/page.tsx`: the sticky back header with a state pill, the `card-magazine` hero (16/10), the `Info` grid, the full-width `btn-gold` CTA (becomes D-205's pair / check-in / `Entrar`) and the "Evento não encontrado" state. Drop `SpotsPill`, the payment banner, certificates and the photos rail.
- `reference/frontend-design/app/(app)/event-checkin/page.tsx`: the boarding-pass ticket, the typed-code field, and the "Check-in confirmado! Realizado às …" state. Port the ticket and code entry; drop `PseudoQr`, `QrScanner` and the `localStorage` persistence.
- `reference/frontend-design/components/events/EventMap.tsx` and `MyEventDetails.tsx`: **not ported** (D-203). Only the "open in Maps" idea survives.
- `reference/frontend-design/types/event.ts` and `lib/mock/events.ts`: the prototype's `IgorEvent`. `formatEventDate` uses `getUTC*` with no timezone; do not port the formatter.
- `.planning/research/PROTOTYPE.md`:
  - §3 route rows `/events`, `/events/[eventId]`, `/event-checkin`, `/my-events`;
  - §4 the matching screen → requirement rows (the gaps: no online link, no attendee count, no .ics, no cancel state);
  - §5 `components/events/` notes;
  - §6 the **Event** data-model row;
  - §9 row **events (L)** and the "Do not port" list;
  - §10 **open question 4** (events semantics, answered by this context).
- `.planning/sketches/MANIFEST.md` and `.planning/sketches/003-phase-05-designed-screens/`: the D-33 review pattern and the latest approved drawings. ⚠ No `sketch-findings-*` skill is packaged, so read them directly.
- `.planning/phases/05-communities-stories/05-UI-SPEC.md` and `.planning/phases/05.1-community-authoring-entry-points/05.1-UI-SPEC.md`: the Copywriting Contract, the chip row and title-row CTA treatments this phase reuses. This phase's UI decisions start at UI-D-200.

### Architecture, schema and pitfalls
- `packages/core/docs/SCHEMA-CONVENTIONS.md`: `tenant_id` first in every index, RLS on every table, §(d).1 status column with transitions (it names `event_attendance.status` as the example), §(d).3 time-based visibility as a predicate and not a cron, §(e).3 the nullable-FK notification pattern Phase 7 will point at events with.
- `.planning/research/PITFALLS.md` §Pitfall 1 (service role kills RLS) and §Pitfall 9 (V2-safe schema).
- `.planning/research/STACK.md` §Stack Pattern 2 (Hono module layout, tenant lane) and §Stack Pattern 3 (drizzle-kit generate, then the Supabase CLI applies; the `api_user` role). §Stack Pattern 1 covers Serwist runtime caching, relevant to D-218.
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (two lanes) and §Recommended Project Structure.
- `.claude/CLAUDE.md` §"What NOT to Use": no browser Supabase for data, no uploads through Cloud Run. §Technology Stack: `date-fns` 4.4.0 for tz-aware formatting.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/contracts/src/modules.ts`: `events` is already in `TOGGLEABLE_MODULES` and `REAL_TENANT_DEFAULT_MODULES`, so no registry-key work is needed.
- `packages/core/db/schema/tenants.ts:28`: `timezone text not null default 'America/Sao_Paulo'`. `packages/core/server/platform/tenants.ts:314` already returns it on the platform payload; `packages/contracts/src/bootstrap.ts` needs it added.
- `packages/core/server/paging.ts`: the ONE keyset envelope for both list chips and the three attendance chips.
- `packages/ui/src/`, all for the ported screens:
  - `primitives/`: `Chip`, `Tabs`, `StatusPill` (Você vai / Presente / Cancelado / Sem confirmação), `EmptyState`, `PageHeader`, `SectionTitle`, `Button`, `Input`, `Textarea`, `Switch` (online/in-person), `Avatar`, `Skeleton`, `Card`, `FileDropZone`;
  - `overlays/`: `BottomSheet` (code entry), `ConfirmDialog` (cancel / Reativar), `Toast`;
  - `layout/`: `InfiniteScroll`, `PullToRefresh`, `ScrollContainerContext`.
- `packages/modules/communities/`: the closest template for a module with a list, a detail page, a full-screen form, a status column with a reversible transition, and a `defaultRolePermissions` manage permission (`module.ts`, `server/service.ts`, `ui/CommunityCard.tsx`, `ui/CommunityCover.tsx` for the gradient fallback).
- `apps/web/app/(app)/comunidades/`: `CommunitiesList.tsx` (title-row `createCta` plus the Ativas/Arquivadas chips from 05.1), `CommunityForm.tsx` (the full-screen create/edit form with cover upload and status actions), and `nova/` and `[communityId]/` routes. This is the structural twin of `/eventos`, `/eventos/novo` and `/eventos/{id}`.
- `packages/core/server/modules/manifest.ts`: `ModuleNav` (`placement: 'tab'`, `order`) for the tab, and `ModuleHomeSlot` (`order`) for D-202. `apps/web/lib/registry.tsx` supplies the per-module renderer, so the kernel imports no module UI.
- `packages/contracts/src/events.ts` plus `packages/core/server/events/bus.ts`: `EventMap` declaration merging and after-commit dispatch.
- `packages/core/server/jobs/boss.ts`: only needed if the planner finds a job. Reminders are Phase 7.
- `apps/web/lib/feed-view.tsx` and `apps/web/components/media/MediaAssetRow.tsx`: the timezone-pinned formatting pattern (no `Date.now()` in render). Their comments explicitly wait for the bootstrap to carry `timezone`.

### Established Patterns
- **Three-layer tenant scoping:** JWT/membership, then an explicit `tenant_id` predicate, then RLS under `authenticated` in a per-request transaction.
- **Permission, never role**, on every write. The bootstrap carries the composed permissions the UI reads.
- **Rules that must hold live in the schema:** CHECKs, composite FKs, partial unique indexes. The RSVP and check-in time rules and the venue-XOR-URL rule belong in that family.
- **Counters are trigger-owned.** If `confirmed_count` is a column, only a trigger writes it.
- **Entry points to full-screen routes are links** (`ComposeFab` / `createCta`).
- **Events are emitted after `withTenantTx` resolves** (MOD-03). Heavy work runs in the worker, never in the request.
- **pt-BR catalog only.** `pnpm verify` is the local exit gate, and `supabase/tests/010-rls-coverage.sql` asserts every new table has RLS and a policy.
- **Isolation cases assert their positive control** in the same test (03-08).

### Integration Points
- `packages/modules/events/` (new): `module.ts` (a `nav` tab, a `home` slot, `defaultRolePermissions`, the `events` subscriptions), `db/schema.ts`, `server/{routes,service}.ts` behind `requireModule('events')`, `contracts/index.ts`, and `ui/`.
- `apps/api/src/modules/registry.ts`: mount the module in the tenant lane.
- `apps/web/app/(app)/eventos/`: `page.tsx` (chips), `novo/`, `[eventId]/` (detail), `[eventId]/editar/`, `[eventId]/participantes/`, `[eventId]/entrar/` (a route handler, D-210/D-218), plus the `.ics` route.
- `apps/web/app/(app)/inicio/page.tsx`: the D-202 card through `HomeSlots`.
- `packages/contracts/src/bootstrap.ts` and `apps/api/src/routes/me.ts`: `tenant.timezone` in the bootstrap.
- `packages/core/db/schema/index.ts`, `supabase/migrations/*` and `supabase/tests/*`: the new tables, the secrets store, CHECKs and policies, and the extended two-tenant plan.
- `apps/web/messages/pt-BR/`: an `events` namespace.
- `scripts/seed.ts`: the event and attendance fixtures listed under Test strategy.

</code_context>

<specifics>
## Specific Ideas

- "Presente" in the attendance list must mean the member was there, not that they tapped a button at home. That is the whole point of the venue code (D-208), and why online check-in is tied to actually opening the link (D-210).
- The admin reads the code off their phone and says it on the mic or writes it on a board. No hardware, no QR.
- A member who is at the venue opens the app on Início, so the check-in door has to be there too (D-202).
- A cancelled event must stay visible, because in V1 nothing else tells a confirmed member it was cancelled.
- A calendar entry for an online event should keep working, and keep counting, even after the admin changes the meeting link.
- Nobody sees who else is going. The admin sees everything.

</specifics>

<deferred>
## Deferred Ideas

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

</deferred>

---

*Phase: 06-events*
*Context gathered: 2026-09-25*
