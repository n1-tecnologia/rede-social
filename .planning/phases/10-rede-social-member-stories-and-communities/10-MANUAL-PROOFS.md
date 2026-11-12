---
phase: "10"
status: pending
---

# Phase 10 manual proofs (P1 to P9)

This file is the ledger of the proofs only the owner can run: a real phone against a hosted host, the live `social`
switch on a per-tenant project, the real-device look at the viewer menus, the held-out visual and accessibility
backstops, and the reading of the assumptions, defaults and wording the plans left to the owner. Everything an
agent could build is built and proved on the local stack (plans 01 to 15: unit, component, pgTAP, integration and the
Playwright journeys of plan 15); what is left here cannot be faked, so nothing in this file is ever recorded as done
by an agent.

**The rule.** Every row ships `pending`. A row becomes `passed` only when Igor pastes the evidence of its steps and
the date, in the row, himself. An agent never edits a Status line and never writes evidence it did not see. A phase
whose ledger has a `pending` row closes `human_needed`, never green. (Project memory: a blanket UAT pass is checked
against `docs/DEPLOY.md` before it is recorded, and a phone cannot reach `*.localhost`, so a row that needs a phone
needs a homolog or production host.)

**The evidence rule.** Paste shapes, counts, statuses, HTTP codes, exit codes and the words the screens show.
**Never** a key, a password, a token, a connection string, an e-mail address of a member or a project ref. Replace a
ref by `<ref>` and a host by `<host>` in what you paste.

**The procedures** are in `docs/DEPLOY.md`, "Phase 10 release (member stories and member communities)".

**The design approval is yours.** Sketch `020` (the design gate, D-33) carries `approved: true` because you approved
it provisionally on 2026-11-11 (commit `30ce8537`); the orchestrator wrote the approval keys on your word. No
executor wrote them. Rows P3 and P4 are where that provisional approval meets a real screen.

## The rows

| Row | Proof | Requirement | Needs | Status |
|-----|-------|-------------|-------|--------|
| P1 | The member story composer, the create-community entry and the Explorar story row on a real phone with the installed PWA | MSTORY-01, MSTORY-03, MCOMM-01, UI-04 | a phone and a homolog or production host with `social` on | pending |
| P2 | `social` switched off, then on, in a live per-tenant project: member writes stop, existing member communities stay readable, on restores them | MPUB-05 | a hosted tenant project with the Phase 10 migrations applied | pending |
| P3 | The viewer menus (the author's, the moderator's) and the destination sheet on a real device at 320px | MSTORY-06, MSTORY-09, UI-04 | a phone, a hosted host | pending |
| P4 | The five held-out visual and accessibility backstops: E02 long-text, E04 overflow, E06 overflow, E08 zero-one-many, E09 long-text | UI-04 | a phone-width window and a screen reader | pending |
| P5 | The planner's assumptions A1, A2, A3, A7, A8 confirmed (and A4, A5, A6, A9, A10, A11, A12 as recorded in the plans) | MCOMM-01, MPUB-01, MPUB-05, MSTORY-01 | Igor's reading of `10-RESEARCH.md` | pending |
| P6 | The UI-SPEC defaults OQ-1 to OQ-7, one line each | UI-04 | Igor's reading of `10-UI-SPEC.md` | pending |
| P7 | The D-478 legal wording, now covering communities | MPUB-07 | the production gate paragraph in `docs/DEPLOY.md` | pending |
| P8 | The owner-dashboard counts of member stories and member communities (Phase 9 Open Question 3) | MPUB-07 | Igor's decision | pending |
| P9 | The release in order: migrations, then API and worker together, then the web last, with the A7 exception (web first for the `authorUserId` change) | MPUB-07 | the homolog and production deploys | pending |

## P1 - The member story composer, the create-community entry and Explorar on a real phone

- **Proves:** that a member can publish a story from their own "+" circle in Explorar, create a community from
  `/comunidades` and publish in it from its page, that a follower sees the story circle and opens the grouped viewer,
  and that everything reads right on a real device with the app installed. The local journeys (`stories.spec.ts`,
  `comunidades.spec.ts`, `social.spec.ts`, each `10 member journey`) prove the flow on an emulated phone against a
  throwaway tenant; they cannot prove the installed PWA, the real photo picker or the real network.
- **Needs:** the homolog deploy of the release in `docs/DEPLOY.md` "Phase 10 release", `social`, `stories` and
  `communities` on for one homolog tenant, one administrator and three member accounts (an author, a follower of the
  author, a stranger who follows nobody), a phone with the app on the home screen (iOS Safari and Android Chrome).
- **Steps (the story):**
  1. As the author, open Explorar. The own circle reads "Seu story" with the "+" badge. Tap it, pick a real photo,
     read the audience line ("Quem segue você vê este story em Explorar por 24 horas."), publish. You land on
     Explorar with "Story publicado." and your circle now opens your stories instead of the composer.
  2. Open Comunidades, tap "Criar comunidade", read "Todos os membros de {tenant} veem esta comunidade. Só você
     publica nela.", name it, create it ("Comunidade criada."), tap "Publicar nesta comunidade", publish a text post and
     land back on the community page ("Publicação criada.").
  3. As the follower, open Explorar: the author's circle shows with the unseen ring and the name "Abrir stories de
     {name}. Há stories novos.". Open the viewer, watch the story, close it: the ring greys. In Comunidades the new
     community comes after the organization's cards with "Criada por {name}"; its post is on its page and in neither
     Início nor Explorar.
  4. As the stranger: the community and its post are visible, there is no circle for the author, and no publish
     control anywhere on the community page.
- **Evidence to paste:** the device and browser, the words the screens showed at each step, and anything that looked
  or behaved differently from the approved sketch `020`.
- **Status:** pending

## P2 - `social` off, then on, in a live per-tenant project

- **Proves:** MPUB-05 and D-718 against real hosted data: with `social` off, member writes stop (no "+" circle, no
  "Criar comunidade", no owner controls, no Explorar tab) while existing member communities, their posts and a highlight
  story stay readable and the moderator keeps removing; turning it on restores everything with no row changed. The
  local proofs are `social-module.test.ts` (`10 social switch`) and the browser case in `social-platform.spec.ts`
  (`10 moderation and switch`) on the local stack and a throwaway tenant.
- **Needs:** a tenant on its own hosted project with the eight Phase 10 migrations applied and the API and worker of
  the release serving it.
- **Steps (the story):** in the platform panel, open the tenant's Módulos tab. Confirm the member's controls and
  Explorar are there. Switch "Rede social" off (no dialog going off). After the flag cache window (about 30 s), reload as
  the member: the controls and the tab are gone, the community, its post and its highlight story still open. As the
  administrator, open the viewer on a member story held by a community highlight and the member community's edit form
  (both still work). Switch "Rede social" on (the confirmation first): every control is back.
- **Evidence to paste:** the counts of what stayed readable, the toasts, and the time it took each side to follow the
  switch.
- **Status:** pending

## P3 - The viewer menus and the destination sheet on a real device at 320px

- **Proves:** that the viewer's "Mais opções" sheet (the author's rows: "Publicar novo story", "Destacar" with an owned
  community, "Excluir story"; the moderator's one row) and the destination groups of the publish screen are reachable
  with a thumb, readable and not clipped on a narrow real screen, and that the delete dialogs read right in both copy
  variants (the author's and "A pessoa não é avisada.").
- **Needs:** a phone with a 320 to 375px wide viewport and the homolog host.
- **Evidence to paste:** the device, the viewport width and what, if anything, clipped, overlapped or was hard to hit.
- **Status:** pending

## P4 - The five held-out backstops

The UI-SPEC marks five state rows as held-out visual and accessibility checks, not unit tests. None has an automated
assertion. Check each at 320px (and with a screen reader where noted) against a lab or homolog member.

| Backstop | What to look at |
|----------|-----------------|
| E02 long-text | The own circle's accessible name wraps in a screen reader at 320px ("Seu story" and "Abrir seus stories") without clipping the label |
| E04 overflow | The publish screen's helper line wraps over two lines at 320px with the longest limits and does not push the frame sideways |
| E06 overflow | The `/comunidades` title row with the 44px create control and the longest heading at 320px: no horizontal scroll |
| E08 zero-one-many | Zero, one and many member communities after many organization ones in the desktop grid: the rows stay aligned |
| E09 long-text | A very long display name truncates inside the community header's byline row and keeps the 44px hit area |

- **Evidence to paste:** one line per backstop: the width, what you saw, and the screen reader if used.
- **Status:** pending

## P5 - The planner's assumptions

`10-RESEARCH.md` lists twelve assumptions the plans were built on. Confirm or overturn each with one line.

- **A1:** member communities sort after organization ones through the sentinel position 1000000.
- **A2:** the member-only permission keys `communities.community.create` and `communities.community.manage_own` and the reuse
  of `stories.story.publish` for members.
- **A3:** a holder of `moderation.manage` may remove an individual post inside a member community.
- **A7:** the API does not send another member's `authorUserId` on member stories; the new `author` key carries the name
  and the membership id (web deployed first, see P9).
- **A8:** an administrator editing a member community's name, description or cover is allowed and is not logged (only
  archive and removal are).
- **A4, A5, A6, A9, A10, A11, A12** as recorded in the plans: no notification for comments and likes on community posts
  (A4), member story video gated like post video (A5), the abuse ceilings (A6), the story video duration cap (A9), the
  measured plans for the audience gate and the authors read (A10), no `social` term on the member update policy (A11),
  blocked creators hidden from lists and the by-id read (A12).
- **Evidence to paste:** one line per assumption: confirmed, or what to change.
- **Status:** pending

## P6 - The UI-SPEC defaults OQ-1 to OQ-7

`10-UI-SPEC.md` drew a default for each open question; the design approval of sketch `020` is a blanket one. Answer each
with one line: OQ-1 (the "+" circle of a community opens the same member publish screen with the community pre-selected),
OQ-2 (the creator's name is plain text on the card and a link only where the profile opens), OQ-3 (a creator can reactivate
a community a moderator archived), OQ-4 (the Administrador mark never renders on a member's post), OQ-5 (limit range 0 to
20, default 3, 0 means members cannot create), OQ-6 (the notice above the highlight rows and one confirm per opening),
OQ-7 (like and comment on a highlight story for a reader who does not follow the author).

- **Evidence to paste:** one line per question: confirmed, or the change.
- **Status:** pending

## P7 - The D-478 legal wording now covering communities

The production gate for turning `social` on ("Ativar a Rede social" in `docs/DEPLOY.md`) carries a Phase 10 paragraph: the
terms of use, the community rules and the privacy policy for third-party content must now also cover communities created
by members. Read the wording and confirm it, or rewrite it, before any tenant has `social` on with the Phase 10 release.

- **Evidence to paste:** the date you read it and whether it changed.
- **Status:** pending

## P8 - The owner-dashboard counts

Phase 9's Open Question 3 asked whether the owner dashboard should count member stories and member communities. Phase 10
shipped without changing the dashboard. Decide: leave the counts as they are (organization content only), or ask for a
later plan.

- **Evidence to paste:** your decision, in one line.
- **Status:** pending

## P9 - The release in order

Follow `docs/DEPLOY.md`, "Phase 10 release": (1) the eight migrations through the ledgered fan-out first; (2) the web before the
API for the ONE change of the story wire (A7), because the previous web refuses the new `author` key and a `null`
`authorUserId`; (3) the API and the worker together; (4) nothing else of the web waits. Expect the Comunidades screens to
error for minutes between steps 2 and 3 on a tenant that has the module on (the known window in the same section).

- **Evidence to paste:** the order you ran, the migration counts per project (applied and skipped), and the first health check
  of each service.
- **Status:** pending

## Also open, recorded elsewhere (not proofs)

These are known and are not fixed by plan 15. They are in `docs/DEPLOY.md` or in the plan 15 summary, listed here so the
ledger is the one place you read:

- With `social` off a moderator cannot read or delete a loose member story (pgTAP 231 section 3, D-718 open item in
  `docs/DEPLOY.md`).
- The empty-database literal of EP-53 (`pnpm db:two --reset --bare`) was never run; the local `db:reset` and the no-op re-runs
  are the evidence that exists.
- A deep link `/stories/[storyId]` still headers a member story with the tenant name (a follow-up).
- The store's product pickers still list member communities (a follow-up).
