# Phase 5: Communities & Stories - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 05-communities-stories
**Areas discussed:** Community page anatomy, Community posts in the feed, Community list signals, Stories strip + publish entry, Story comments + admin history
**Areas offered but not selected:** Archiving a community, Story viewer behaviour, Pinning to communities

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Community page anatomy | What survives from the prototype's header (cover, owner avatar, credit, tagline, highlight circles) | ✓ |
| Community posts in the feed | Community label on the card; where the admin picks a community | ✓ |
| Community list signals | COMM-03's four fields vs the prototype's activity badges and member count | ✓ |
| Archiving a community | What archive does to posts, the page, pinned stories; reversibility | |
| Stories strip + publish entry | Circle granularity, seen state, publish affordance | ✓ |
| Story viewer behaviour | Durations, gestures, overlay, end-of-sequence | |
| Pinning to communities | Where the pin action lives; post-expiry behaviour | |
| Story comments + admin history | Flat comment surface, ordering, deletion; the expired-story view | ✓ |

---

## Community page anatomy

### Owner credit

| Option | Description | Selected |
|--------|-------------|----------|
| No owner credit | Cover + name + description only; drops OWNER and VerifiedBadge (already do-not-port) | ✓ |
| Creating admin, "por {nome}" | The prototype's overlapping avatar; needs created_by and a nullable-author story | |
| Tenant logo as curator | Brand mark in the avatar slot; restates branding the shell already carries | |

**User's choice:** No owner credit.

### Pinned-stories row position

| Option | Description | Selected |
|--------|-------------|----------|
| Circle row under header | The prototype's exact "Destaques" position, above the first post | ✓ |
| Over the cover image | Overlaid on the cover; saves vertical space, fights the gradient | |
| Separate tab (Posts / Destaques) | Room to grow, but adds a navigation level | |

**User's choice:** Circle row under the header.
**Notes:** This answers PROTOTYPE.md open question 1 with "yes, the highlights circles are the pinned-stories UI" — and they now open the viewer instead of opening nothing.

### Cover image requirement

| Option | Description | Selected |
|--------|-------------|----------|
| Optional, brand fallback | Nullable; coverless communities render a brand gradient with the name | ✓ |
| Required at creation | Cover-first like every prototype card; forces an upload wait on a phone | |
| Optional, neutral placeholder | Nullable with the prototype's bg-tertiary; reads as broken | |

**User's choice:** Optional with a brand-gradient fallback.

### COMM-04 posting entry

| Option | Description | Selected |
|--------|-------------|----------|
| FAB → /criar, pre-filled | The existing ComposeFab, community locked in; one composer | ✓ |
| Inline composer on the page | Expands in place; would be a second, weaker composer (D-57's rejection) | |
| Only from /criar with a picker | No entry on the community page; contradicts COMM-04's wording | |

**User's choice:** FAB → /criar pre-filled.

### Follow-up raised by the user

**User's input (free text):** "IMPORTANTE LEMBRAR QUE TODO OS DESIGN JA ESTÁ NO FOLDER 'reference'"

**Resolution:** Verified the prototype folder directly. It covers the community list, the community page (including the highlights circle row), a community post detail, the reels pager (the story viewer's gesture model) and every UI primitive the phase needs. Exactly five Phase 5 surfaces are genuinely absent — the stories strip, the story viewer screen, the story publish flow, the community create/edit/archive form, and the pin flow. Recorded as **D-66** so the researcher and planner port first and design only those five. One correction made during this exchange: `Tabs` is already ported into `packages/ui/src/primitives/Tabs.tsx`, contrary to an option description that called it a new primitive.

---

## Community posts in the feed

### Community label

| Option | Description | Selected |
|--------|-------------|----------|
| Label in the post header | Tappable "em {Comunidade}" on the header's second line | ✓ |
| No label anywhere | Matches the prototype exactly; makes criterion 1's community half invisible | |
| Chip above the card | More prominent; competes with the author for the top of every card | |

**User's choice:** Label in the post header.

### Where the admin picks a community

| Option | Description | Selected |
|--------|-------------|----------|
| Both, with a picker in /criar | Optional "Publicar em" defaulting to tenant-wide, pre-selected from a community FAB | ✓ |
| Only from the community page | Strictly COMM-04's wording; no way to correct a mis-placed post | |
| Both, plus move after publishing | Fixes mistakes but moves a post after members have seen and liked it | |

**User's choice:** Both, with a picker; no post-publish move.

### Feed composition

| Option | Description | Selected |
|--------|-------------|----------|
| All mixed in, chronological | Roadmap criterion 1 verbatim; served by the Phase 4 community index | ✓ |
| Mixed but de-emphasised | Needs a ranking the keyset cursor cannot express | |
| Separate — community page only | Contradicts a locked success criterion | |

**User's choice:** All mixed in, chronological.

### Module-off behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Feed falls back to tenant-wide | Reverts to the community_id is null partial index Phase 4 built | ✓ |
| Community posts keep showing, unlabelled | Content visible with no page to navigate to | |
| You decide | | |

**User's choice:** Fall back to tenant-wide.

---

## Community list signals

### Card fields

| Option | Description | Selected |
|--------|-------------|----------|
| COMM-03's four fields only | Cover, name, description, post count | ✓ |
| Four fields + last activity | Adds a max(created_at) aggregate; no new table | |
| Four fields + unread badge | Needs a per-user community_last_seen table and a write per open | |

**User's choice:** The four fields only.

### Ordering and placement

| Option | Description | Selected |
|--------|-------------|----------|
| "Comunidades" tab, newest activity first | The tab D-55 reserved, at /comunidades | ✓ |
| Tab, alphabetical | Stable but buries what is new | |
| Tab, admin-defined order | Most control; adds a reorder UI to the least-designed surface | |

**User's choice:** Tab, newest activity first.

### Paging

| Option | Description | Selected |
|--------|-------------|----------|
| Keyset paging, same envelope | Reuses paging.ts and @rede-social/ui InfiniteScroll | ✓ |
| Unpaged, single query | Less code, no ceiling | |
| You decide | | |

**User's choice:** Keyset paging.

### Empty state

| Option | Description | Selected |
|--------|-------------|----------|
| EmptyState, tab still visible | Module flag drives nav (D-40); admin sees "Criar comunidade" there | ✓ |
| Hide the tab until one exists | Nav would depend on data rather than on the flag | |
| You decide | | |

**User's choice:** EmptyState with the tab visible.

---

## Stories strip + publish entry

### Circle granularity

| Option | Description | Selected |
|--------|-------------|----------|
| One circle per story | Newest first, own thumbnail; the only option that makes a strip with one publisher | ✓ |
| One grouped ring per publisher | The Instagram model; would show exactly one circle in V1 | |
| One circle per community + tenant-wide | Meaningful grouping, but pinning is a post-publish action | |

**User's choice:** One circle per story.

### Seen state

| Option | Description | Selected |
|--------|-------------|----------|
| No seen state in V1 | Same ring for all; order carries the newness signal | ✓ |
| Seen state, per-user view rows | A story_views table and a write per open | |
| Client-side only, per device | Disagrees across devices; lost on PWA reinstall | |

**User's choice:** No seen state in V1.

### Publish entry point

| Option | Description | Selected |
|--------|-------------|----------|
| First circle in the strip, "+" | Admin-only "Seu story"; does not touch the feed FAB | ✓ |
| Second action on the feed FAB | One creation entry; turns a one-tap button into a menu | |
| Both | Most discoverable; a menu for one extra item | |

**User's choice:** The strip's leading "+" circle.

### Publish flow

| Option | Description | Selected |
|--------|-------------|----------|
| Pick media → caption → publish | Full-screen; reuses useSignedUpload and the Mux branch | ✓ |
| Same composer as posts, story mode | Would need post concepts hidden; a story is one media item | |
| Pick media → publish, caption later | Makes a story editable after publishing | |

**User's choice:** Pick media → caption → publish.

---

## Story comments + admin history

### Comment surface

| Option | Description | Selected |
|--------|-------------|----------|
| BottomSheet over a paused viewer | The ported CommentSheet; CommentsList in a flat variant | ✓ |
| Inline input bar only, no list | Comments nobody can read | |
| Comments on a separate story page | Breaks the auto-advance sequence | |

**User's choice:** BottomSheet over a paused viewer.

### Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Oldest → newest | A flat list is one conversation; matches D-62's within-thread direction | ✓ |
| Newest first | Matches D-62's root ordering; but a story has no threads to rank | |
| You decide | | |

**User's choice:** Oldest → newest.

### Admin story history

| Option | Description | Selected |
|--------|-------------|----------|
| Admin-only "Seus stories" list | Reachable from the "+" circle; also hosts pin/unpin and delete | ✓ |
| Grid on the admin's own profile | D-45 stripped the profile to photo, name, bio — this is tenant content | |
| Reachable only from a pinned row | An unpinned expired story would become unreachable | |

**User's choice:** Admin-only "Seus stories" list.

---

## Claude's Discretion

Areas offered but not selected, plus everything the user did not weigh in on. All are recorded in CONTEXT.md `<decisions>` → "Claude's Discretion":

- **Archiving a community (COMM-01)** — what archive does to posts, the page, pinned stories; the column shape; reversibility.
- **Story viewer behaviour (STORY-02)** — durations, progress bars, tap zones, hold-to-pause, swipe-to-dismiss, end-of-sequence, mute default, pre-mounting; built against the reels pager.
- **Pinning mechanics (STORY-04)** — the pin table shape, how a pin overrides the expiry predicate, whether a pinned expired story stays likeable, active-vs-pinned circles on the community page.
- **Schema, API and V2 safety** — the new tables, wiring the Phase 4 FK slots, enforcing STORY-05 declaratively at the DB level, the ~60 s story rule, domain event names, and whether communities and stories are one package or two.
- **UI and composition** — strip placement on /inicio relative to the D-02 nudge and the feed slot, desktop behaviour, empty states and skeletons, the create/publish forms, catalog namespaces.
- **Test strategy** — isolation suite extensions, STORY-05 negative tests at both layers, the expiry predicate under a controlled clock, Playwright gesture coverage.

## Deferred Ideas

- Per-user read markers (community activity badges, story seen rings) — revisit with Phase 7's notification read state.
- "Quem viu" a story — same deferred story_views table.
- Member count on a community card — meaningless under COMM-02; real with V2 private communities.
- Moving a published post between communities.
- Admin-defined community ordering.
- A tabbed community page (Posts / Destaques).
- Editing a story after publishing.
- Member-created and private/opt-in communities (V2-CONT-02) — `community_members` is born here for exactly this.
- Pinned posts inside a community (V2-CONT-03).
- Per-community notification preferences.
