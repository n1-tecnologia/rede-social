# @rede-social/module-profile-form

The tenant's profile form (Phase 12, PFORM-01..): the admin builds the questions members answer to
complete their profile, reads and exports the answers, and the required questions hold a member out of
the app until they are answered. With the module off for a tenant nothing changes for anyone: the gate
fact is 0 and the builder is hidden (D-589). It is off by default for every tenant and no existing
tenant gets a row (D-596); turning it on is the platform super_admin's explicit per-tenant act.

**This package holds no tables and no jobs of its own.** The tables, the gate and the member routes are
KERNEL code, because `requireAuth` reads the gate on every request (the D-501 split, as in payments).
The package owns the builder's admin routes (plans 12-08 and 12-09), the answers export (plan 12-10), their
contracts and the manifest. The services the routes call live in the kernel
(`@rede-social/core/server/profile-form/*`), where the pure lock rules and the per-tenant advisory lock are
visible to the tests; a route never opens the admin lane.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `profileFormModule`, the manifest |
| `./contracts` | the permission names `PROFILE_FORM_PERMISSIONS` (`profile_form.manage`, `profile_form.read`) and a re-export of the builder API's schemas of `@rede-social/contracts/profile-form` (`createQuestionBodySchema`, `updateQuestionBodySchema`, `reorderBodySchema`, `adminQuestionSchema`, `adminQuestionListSchema`, `PROFILE_FORM_ISSUE_SET`) |
| `./server` | `profileFormRoutes` |

`profile_form.manage` is composed for `admin_tenant` only, by construction; `profile_form.read` is
composed for `admin_tenant` and `support_tenant`. A `member` never gets either.

Routes (`/v1/profile_form`), every one behind `requireAuth`, `requireModule('profile_form')` and
`requirePermission('profile_form.manage')` (`admin_tenant` only, by construction, see `module.ts`). With the
module off every route answers `404 MODULE_DISABLED`; the service re-checks the live module row in its own
transaction, because the 30-second flags cache is never the authority of a write. No route returns an
individual member's answer, only counts, EXCEPT `GET /export` below.

| Route | What |
|---|---|
| `GET /questions` | the ACTIVE questions in the order members see them, each with `answerCount` and a per-option `answerCount`, plus `activeCount` and `limit` (30) |
| `POST /questions` | creates a question at the end of the list (`position` last + 1, `revision` 1, a server-made id for every option); the 31st active question is `409 limit_reached` |
| `PATCH /questions/{id}` | edits any subset of title, help text, `required`, show-on-profile, type, options, "Outro" and limits; `revision` (the one the caller read) is required and a mismatch is `409 stale_revision`; an archived question is `409 already_archived`; an unknown or another tenant's id is the bare `404`; a body that changes nothing answers `200` and does not bump the revision |
| `PUT /order` | `{ ids }`, the WHOLE active list in its new order; the stored `position` is renumbered 1..n in one statement and no revision changes; anything that is not exactly the set of active ids (a missing one, an extra, a repeat, an archived one, another tenant's) is `409 order_mismatch` |
| `GET /archived` | the ARCHIVED questions, newest archive first then id, each with `archivedAt`, `required` and an exact `answerCount` (also per option); a tenant with none answers `{ questions: [] }` |
| `POST /questions/{id}/archive` | the question leaves the form and stops being asked, every answer stays (D-588); archiving the last required question releases every held member (D-589); an already archived question answers `200` with `archivedAt` unchanged |
| `POST /questions/{id}/reactivate` | an archived question goes back at the END of the active list (`position` last + 1, `listedAt` now); a required one holds again every member who lacks its answer (D-585); at 30 active questions it is `409 limit_reached`; an active question answers `200` unchanged |
| `DELETE /questions/{id}` | only a question nobody ever answered (`200 { deleted: true }`, a second delete is the bare `404`); one answer makes it `409 has_answers` and the RESTRICT foreign key refuses the same delete in SQL |
| `POST /questions/replace` | `{ replaces, ...a create body }`: the new question and the archive of `replaces` in ONE transaction; the new question takes the old one's `position`, the old one keeps its answers; allowed at 30 active questions (the count does not grow); a question that is not active is `409 already_archived`; any failure leaves the old question active and creates nothing |
| `GET /summary` | `{ total, complete, hasRequired }` over the live, active, non-blocked `member` memberships of the tenant (staff, blocked and invited are in no number); `complete` is the members with an answer to every active required question |
| `GET /impact` | `?change=create_required\|make_required\|reactivate\|replace[&questionId]` answers `{ members }`: how many members the change would ask to answer if applied now; `make_required` and `reactivate` need `questionId` (400 without it, bare 404 for an unknown or foreign one) and answer 0 when nobody would be asked (an optional or already active question, an already required one) |
| `GET /export` | the answers as a CSV attachment `respostas-perfil-AAAA-MM-DD.csv` (date in the tenant's time zone), `Cache-Control: no-store`, `admin_tenant` only (a `support_tenant` and a `member` are `403`, the module off is `404 MODULE_DISABLED`); see "The export" below |

**The export (D-595, PFORM-21).** The one door through which a member's answer leaves the app, so it is
logged, never cached and admin-only. ONE `profile_form_exported` row of the append-only `moderation_log` is
written and COMMITTED before the first byte of the file (the exporting admin is both actor and target; the
row holds no answer, e-mail or member list), so a mid-stream failure cannot roll it back. The row set is every
live `member`-role membership, `active` and `blocked` (invited, staff and soft-deleted ones are left out;
assumption A-12-02, to confirm with the product owner). Columns: name, e-mail, then one per question (active
ones in the admin's order, then archived ones by `archived_at`). Spreadsheet-friendly for pt-BR: UTF-8 with a
byte-order mark, `;` delimiter, CRLF, numbers with a comma decimal. Every cell, header cells included, that
begins with `=`, `+`, `-`, `@`, a tab, a CR, a LF or a full-width form of the first four is prefixed with a
single quote (OWASP CSV injection); only the stored JSON number of a `number` question is written as data. The
file is streamed in keyset pages of 500 memberships by id, so memory is bounded by a page. The e-mail lives in
`users`, readable only in the admin lane, so the export (and only the export) reads there, with an explicit
`tenant_id` predicate on every statement; its site is in the admin-lane inventory.

**Lock rules (D-587).** Once a question has answers, title, help text and `required` stay free, options may be
added and reordered, widening a limit and turning "show on profile" off are allowed; everything that would
reinterpret or expose a stored answer is refused with a coded `409 CONFLICT` and `details.profileForm`:
`type_locked`, `option_locked` (an option that has answers cannot be removed or relabelled, even by case),
`other_locked` ("Outro" off while an "Outro" answer exists), `visibility_locked` (private to public) and
`limits_locked` (narrowing a number or date limit). The pure rules live in
`@rede-social/core/server/profile-form/lock-rules` (`checkLocks`) and decide first; the database trigger of
plan 04 (SQLSTATE PF001..PF005) is the backstop and maps to the same codes. Answers name option ids, never
positions, so reordering options never changes what a stored answer means.

**Concurrency.** Every write of a tenant first takes
`pg_advisory_xact_lock(hashtextextended('profile_form:' || tenant_id, 0))`, so two admins' writes and the
30-question count never interleave, then re-reads the live module row, then locks the rows it changes
`FOR UPDATE` in the canonical order `position, created_at, id` (the order the member's save locks in).

**Aggregates only (D-593, PFORM-23).** The builder reads counts: answers per question and per option, the
summary and the impact. No route of this package ever returns an individual member's answer, and the
response schemas of the summary, the impact and the archived list carry no `value`, `answer` or `otherText`
key. Whether a member is held is never stored: the gate reads the SQL rule, so archiving, reactivating,
creating or flipping `required` takes effect on the next request and no answer row is ever written or
removed by the lifecycle routes.

## Events emitted

None.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: none.
- Notification retractions: none.

## Flag key

`profile_form` in `tenant_modules`. No `requires`: the form works whatever other module is on. Off by
default: not in `REAL_TENANT_DEFAULT_MODULES`, and the migration that widened the CHECK inserted no row,
so a missing row reads as disabled.

## Kernel dependencies

- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/profile-form/admin`
- `@rede-social/core/server/profile-form/export`
- `@rede-social/core/server/rbac/permissions`

## Navigation

- None. The module has no shell entry: its door is a row of Configurações.

## Jobs

- None.

## Reuse

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide the kernel tables and functions of
Phase 12 once they exist, a request id and a per-request logger.
