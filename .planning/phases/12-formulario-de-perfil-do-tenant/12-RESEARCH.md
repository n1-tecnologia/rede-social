# Phase 12: Formulário de perfil do tenant - Research

**Researched:** 2026-10-29
**Domain:** tenant-authored questionnaire (versioned-by-state questions, typed JSON answers), a hard gate on the `requireAuth` hot path, per-tenant database fan-out
**Confidence:** HIGH on the gate mechanism, repo map and RLS shape (read and measured in this session); MEDIUM on concurrency semantics and CSV size limits (design is robust to both, tests listed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-580:** A NEW member answers the form after login, on the same "complete your profile" screen an existing member uses. `/cadastro/[slug]` and `/participar` do not change: no answers travel in the sign-up or join body, so the e-mail verification step does not interfere and there is one mechanism for new and old members.
- **D-581:** The form is a HARD GATE. While the member has an unanswered required question, the API refuses every route except the form's own routes, the bootstrap and sign-out with a new error code (name left to the planner; the model is `SUBSCRIPTION_PENDING`), and the web sends the member to the form screen through `bootstrapRedirectPath`. Nothing is written to `memberships.status`, the profile or any content, and the Supabase session is never revoked (same guarantees as the payment cut, D-498). "Sair" keeps working.
- **D-582:** The member sees ALL active questions on ONE scrollable screen, required ones marked, with a single "Salvar" at the end. The same screen serves the first answer, the return after a form change, and later edits from the profile. No one-question-per-step flow, no sections.
- **D-583:** After saving, the member goes where they were headed (a post or notification link they opened before the gate caught them); with no destination they land on `/inicio`. The destination must be a same-origin relative path validated on the server side of the web app, never an arbitrary URL (open-redirect risk).
- **D-584:** The gate applies to the role `member` only. `admin_tenant`, `support_tenant` and `super_admin` are never gated and never asked, so the admin cannot lock themselves out of the builder.
- **D-585:** Completeness is COMPUTED, never stored as a flag or a version counter: a member is complete when every ACTIVE REQUIRED question has a valid answer. Creating a required question (or turning an optional one into required, or reactivating an archived required one) reopens the form for every member who lacks an answer, and they answer only what is missing. Existing answers are kept. Making a required question optional, or archiving it, frees the members it was holding. This also covers members who completed the profile before the form existed.
- **D-586:** A new OPTIONAL question never gates anyone. Members see a dismissible notice on their profile ("Há perguntas novas"), in the mold of `ProfileCompletenessCard` and `nudge_dismissed_at`: dismissal is server state, so a reinstall does not bring it back. Dismissal granularity (per question or per batch) is the planner's call.
- **D-587:** Editing a question that already has answers: title and help text change freely. The TYPE and the OPTIONS that have answers are locked: the admin may ADD options, but changing the type or removing an answered option is done by creating a new question and archiving the old one. No answer is ever discarded or silently reinterpreted.
- **D-588:** Removing a question ARCHIVES it. It leaves the form and stops being asked, but its answers are kept: visible to the admin in a list of archived questions and included in the CSV export. The admin can reactivate it (D-585 applies on reactivation). The builder offers no hard delete of a question that has answers.
- **D-589:** Turning the module off, or archiving every required question, releases all members from the gate. Answers are kept untouched.
- **D-590:** The types that ship: short text, long text, dropdown, multiple choice (several answers), single choice (radio), number, date, phone (Brazilian mask and validation), e-mail, link (URL), yes/no, acceptance (a box that must be ticked to count as answered), and a 1 to 5 rating. Number and date accept a minimum and maximum set by the admin.
- **D-591:** DEFERRED, not in this phase: state/city (needs the official municipality list) and file/photo answers (private upload). The model must accept a new type later WITHOUT rewriting the questions or answers tables: the answer value is stored typed and validated per type by a discriminated schema in `packages/contracts`, and the type list can grow by a small migration at most.
- **D-592:** Dropdown, multiple choice and single choice support an "Outro" option, switched on PER QUESTION by the admin. The text the member types is stored with the answer.
- **D-593:** By default an answer is readable by the member who gave it, by `admin_tenant` and by `support_tenant` of that tenant, and by nobody else. The admin may switch "mostrar no meu perfil" PER QUESTION; only then do other members of the same tenant see that answer on the member's profile, and the member sees a notice on that question in the form ("esta resposta aparece no seu perfil"). The answers table must NOT inherit `member_profiles_tenant_select` (tenant-wide read): its policies are self, staff, and public-flagged rows. A cross-tenant negative test covers every policy.
- **D-594:** LGPD: the builder shows a short warning when a question is created ("peça só o que precisa; a comunidade responde por estes dados"). Answers hang off the membership and go away with it (`on delete cascade`, as `member_profiles` does), so an LGPD deletion needs no extra path. The platform does not block question titles or types and there is no per-question "finalidade" field.
- **D-595:** The admin can export the answers as CSV, one row per member (name, e-mail, one column per question, archived questions included). Only `admin_tenant` can export and each export is written to the moderation log (`moderation_log` is immutable by design). The export must neutralise spreadsheet formula injection (cells beginning with `=`, `+`, `-`, `@` or a tab).
- **D-596:** The form is a TOGGLEABLE MODULE, off by default. Its key is appended LAST to `TOGGLEABLE_MODULES` (the `tenant_modules_key_chk` CHECK is generated from that list and widens in the same migration), it is NOT in `REAL_TENANT_DEFAULT_MODULES`, no existing tenant gets a backfill row, and the `super_admin` turns it on per tenant in the platform panel, as `store`, `courses`, `social` and `payments`. Off hides the "Formulário de perfil" tab and releases the gate (D-589). Suggested key `profile_form`; the final name is the planner's.

### Claude's Discretion
- Limits: maximum questions per form, maximum options per choice question, character caps for text types.
- The exact error code and the API shape of the gate. HARD CONSTRAINT from `requireAuth`: the check must ride the SAME membership lookup, as the payment `_gated` SQL twins do, with no second round trip per request, and it must be cheap for a tenant with the module off or with no required question. Research must size this before planning.
- The builder's ergonomics: reorder, preview, duplicate a question, "how many have answered". The UI-SPEC and its sketch gate decide them.
- A question that has answers: the planner should freeze its "show on profile" switch the same way D-587 freezes the type (a private answer must not become public silently); flag it in the UI-SPEC for confirmation.
- Whether a question that was never answered may be hard-deleted.
- pt-BR copy of every screen, notice and error; where on the profile the public answers render.
- The final name of the module key and of the gate error code.

### Deferred Ideas (OUT OF SCOPE)
- State/city question type backed by the official municipality list.
- File or photo as an answer type (private upload through the media pipeline).
- Question sections (grouping) and conditional questions ("show B only if A = X").
- Notifying members (notification center or Web Push) when the admin creates or changes the form; for now they discover it on the next app open, where the gate catches them.
- Filtering the member list by answer, and feeding answers into the 08.7 reports.
- A per-question "finalidade" (purpose) field shown to the member.
</user_constraints>

## Project Constraints (from CLAUDE.md)

Directives the plans must satisfy (CLAUDE.md is authoritative; same weight as the locked decisions):
- `tenant_id` on every row, RLS on every table, a cross-tenant negative test for every policy; defense in depth (host -> membership -> RLS). Per-tenant physical database since 09.2/09.4: the tenant schema is `supabase/migrations`, fanned out to every tenant project; the isolation suite must pass on both the single-database lane and the two-database lane.
- Modularity MOD-01..05: a module package depends only on the kernel and on other modules' published contracts. The kernel never imports a module (the permission and counters resolvers are inverted from the app tier).
- Drizzle schema is the source of truth (`.enableRLS()` + `pgPolicy`), `drizzle-kit generate` writes into `supabase/migrations`, the Supabase CLI / `migrateAll` applies. Hand-written SQL (functions, triggers, grants) goes in custom migrations. Never `drizzle-kit migrate`.
- API: Hono + `@hono/zod-openapi`, Zod 4 contracts in `packages/contracts`; web never imports `packages/db`; web talks to the API through the BFF with HttpOnly cookies.
- Runtime DB role `api_user` (NOBYPASSRLS) only through the two lanes (`withTenantTx`, `withAdminTx`); never the `postgres` role for tenant traffic.
- pt-BR UI, all strings from the next-intl catalog (`scripts/check-ui-literals.sh` rejects literal text in TSX); mobile-first, 44px targets; screens the prototype lacks go through a UI-SPEC and a sketch gate (UI-04, D-417).
- `apps/web/AGENTS.md`: this Next.js has breaking changes; read `node_modules/next/dist/docs/` before writing web code (`redirect()`/`notFound()` outside try/catch, async `params`/`cookies()`/`headers()`).
- GSD workflow enforcement: edits go through a GSD command. Memory-derived traps for this repo are collected under Validation Architecture.

<phase_requirements>
## Phase Requirements

REQUIREMENTS.md has no PFORM text; these are the researcher's DRAFT final sentences. The planner copies them into REQUIREMENTS.md (new `### Tenant profile form` section) and the ROADMAP `**Requirements**:` line, and re-resolves any row whose meaning it changes. Every D-580..D-596 and every ROADMAP success criterion (SC1..SC6) is traced below.

| ID | Requirement text | Source | Test type |
|----|------------------|--------|-----------|
| PFORM-01 | The profile form is a toggleable module: its key `profile_form` is appended last to `TOGGLEABLE_MODULES`, the `tenant_modules_key_chk` CHECK widens in the same migration, the key is not in `REAL_TENANT_DEFAULT_MODULES`, no existing tenant gets a row, the `super_admin` switches it per tenant in the platform panel, and with it off every builder and answer-admin route answers 404 `MODULE_DISABLED` and the "Formulário de perfil" row is absent | D-596, D-589 | unit (contracts, registry), pgTAP, integration |
| PFORM-02 | `admin_tenant` (permission `profile_form.manage`, composed for `admin_tenant` only while the module is on) creates, edits (title, help text, required, show-on-profile) and reorders questions; the stored order is the order members see; a `support_tenant`, a `member` and another tenant's admin are refused; at most 30 active questions, title <= 120, help text <= 300 characters, enforced by the API and by CHECKs | SC1, D-582, Discretion (UI-D-599) | integration, pgTAP |
| PFORM-03 | Removing a question archives it (`archived_at`), keeps its answers, lists it under "Arquivadas" with its answer count and includes it in the export; reactivation puts it at the end of the list and reopens the form per PFORM-09; a never-answered question may be hard-deleted and the database itself refuses to delete a question that has answers | D-588, SC1 | pgTAP, integration |
| PFORM-04 | Each of the thirteen types has a validator in the discriminated Zod schema of `packages/contracts`: short text <= 120, long text <= 1000, dropdown and single choice (one option id, or "Outro" with text), multiple choice (>= 1 option ids, optional "Outro" text), number (finite, within the admin's min/max), date (real calendar day `YYYY-MM-DD` within min/max), phone (Brazilian, 10 or 11 digits, DDD 11-99, leading 9 when 11 digits), e-mail, link (`http:`/`https:` only), yes/no (boolean), acceptance (only `true` counts), rating (integer 1-5) | D-590, SC1 | unit |
| PFORM-05 | A new question type is added by one Zod variant and, at most, a widening of the `type` CHECK; the questions and answers tables are not rewritten, the answer value is a typed `jsonb`, and a contract test pins that the TypeScript type list and the CHECK list are the same list | D-591 | unit, pgTAP |
| PFORM-06 | Choice questions carry 2 to 20 options (label <= 80, unique per question) with stable ids; "Outro" is switched per question, is not counted in the 20, stores the member's text (<= 120) inside the answer, and an answer naming an option id that is not in the question is refused | D-592, SC1 | unit, integration |
| PFORM-07 | `PUT /v1/me/profile-form/answers` validates every submitted answer against its question's CURRENT type, options, limits and required flag, in one transaction with no partial write; it refuses an unknown, archived or other-tenant question id, and refuses a save that leaves an active required question without an answer, with errors keyed by question id | SC5, D-585 | integration |
| PFORM-08 | Questions and answers are tenant-isolated: every policy, the composite foreign key `(tenant_id, question_id)` and the membership leg of the insert policy refuse another tenant's rows; each policy has a two-tenant negative test next to its positive control, on the single-database and the two-database lane, and every new route has an entry in the isolation inventory | SC5, D-593 | pgTAP, integration (isolation, two-database), unit (inventory) |
| PFORM-09 | Completeness is computed by one SQL rule (`app.profile_form_missing`): a member is complete when every active required question has an answer row; no flag or counter is stored; creating a required question, turning an optional one required or reactivating a required one reopens the form for members lacking the answer, existing answers are kept, and making a question optional or archiving it frees those it held | D-585, SC4 | pgTAP, integration |
| PFORM-10 | For a `member` with a pending required question, `requireAuth` answers every route outside the allow-list with 403 `PROFILE_FORM_PENDING` carrying only `details.tenantName`; the pending fact is read in the SAME statement as the membership lookup (no second round trip); the gate never writes `memberships.status`, the profile or any content and never revokes the Supabase session | D-581 | unit, integration |
| PFORM-11 | The gate spares and releases: `admin_tenant`, `support_tenant` and `super_admin` are never gated; a tenant with the module off, with no active required question, or whose required questions were all archived or made optional gates nobody and keeps all answers; `blocked` and the payment `cut` outrank the form (a cut member gets `SUBSCRIPTION_PENDING`); the allow-list is exactly the bootstrap and the form's own read and save routes | D-584, D-589, D-581 | unit, integration |
| PFORM-12 | `GET /v1/me/bootstrap` carries an additive `profileForm` block (`pendingRequired`, `newOptional`; absent when the module is off or the role is not `member`); `bootstrapRedirectPath` maps `PROFILE_FORM_PENDING` to `/completar-perfil`; `requireBootstrap` redirects a member with `pendingRequired > 0`; the counters BFF and `LiveShell` take an open app to the form without a reload; the form screen itself never redirects to itself | D-581, SC3 | web unit, e2e |
| PFORM-13 | Entry paths: sign-up and join send no answers and are unchanged; a new member, an existing member who never completed the profile, and a member who completed photo/bio/Instagram before the form existed all land on `/completar-perfil` on the next app open when a required question is unanswered, and answer only what is missing; a tenant with no required question signs members up and lets them in exactly as today | D-580, D-585, SC2, SC3, SC4 | e2e, integration |
| PFORM-14 | One screen: `/completar-perfil` lists all active questions in the admin's order, pre-filled, required marked, with one "Salvar"; the mode (first, returning, edit) is decided by the server from the data, never from the URL; a form change during typing returns 409 with the fresh list and the member's typed answers for surviving questions are kept | D-582, SC3 | web unit, e2e, integration |
| PFORM-15 | After a successful save the member goes to the `next` destination only if it is a same-origin relative path validated on the web server (single leading `/`, no `//`, no `\`, no scheme, <= 500 characters, not `/completar-perfil` or an `(auth)` route), else to `/inicio`; an invalid `next` is ignored silently and never echoed | D-583 | web unit |
| PFORM-16 | A new optional question never gates; a member sees a dismissible "Há perguntas novas" notice on `/perfil` (members only, module on); "Agora não" is stored server-side (column on `member_profiles`) with batch granularity, so it survives reinstall and other devices, and a later new optional question brings it back | D-586 | integration, web unit |
| PFORM-17 | Once a question has answers its type and its answered options are locked (options may be added, not renamed or removed; "Outro" cannot be switched off while "Outro" answers exist; number/date limits may only widen), title, help text and required stay free, and "show on profile" may not go from private to public; each rule is enforced by the service with a coded 409 and by a database trigger; "replace" (create new + archive old) is one transaction and a failure leaves the old question active | D-587, Discretion (PU-1, PU-2) | pgTAP, integration |
| PFORM-18 | An answer is readable only by its owner, by `admin_tenant` and `support_tenant` of the same tenant, and, for an active question flagged show-on-profile, by other members of the same tenant through `GET /v1/members/{id}/profile-answers` (strict payload; one indistinguishable 404 for an unknown, other-tenant, blocked, removed or staff target and for the module off); the form shows "esta resposta aparece no seu perfil" from the server flag; `member_profiles_tenant_select` is not inherited | D-593, SC6 | pgTAP, integration |
| PFORM-19 | The staff (`admin_tenant`, `support_tenant`) read every answer of a `member`-role target, archived questions included, on the member's page; a member never receives another member's private answer | D-593, SC6 | integration, web unit |
| PFORM-20 | A member reads and edits their own answers from "Minhas respostas" on `/perfil` (members only, module on), each row marked when public, through the same screen and the same save route | D-582, SC3 | web unit, e2e |
| PFORM-21 | `admin_tenant` exports the answers as CSV (one row per live `member`-role membership: name, e-mail, one column per question, archived included); the response is streamed in keyset pages; every cell beginning with `=`, `+`, `-`, `@`, tab or carriage return is neutralised; one `moderation_log` row (`profile_form_exported`) is committed before the first byte; `support_tenant` and `member` are refused 403 | D-595, SC6 | unit (writer), integration |
| PFORM-22 | Answers carry `membership_id ... on delete cascade` (and `user_id ... on delete cascade`), so deleting the membership or the identity removes them with no extra path; the builder shows the LGPD warning when a question is created and has no purpose field | D-594 | pgTAP, web unit |
| PFORM-23 | The builder reads aggregates only (answers per question and per option, `{ total, complete }`, and the "N membros vão precisar responder" impact for a change that reopens the form); it never returns an individual member's answer; the impact read failing blocks the write | D-585, Discretion (UI-D-576) | integration |
| PFORM-24 | Two admins editing the same form do not overwrite each other (per-question `revision`, 409 on mismatch; all admin writes of one tenant serialize on an advisory lock), and a member save locks the questions it answers `FOR SHARE`, so a type/option/visibility change and an answer never interleave | Discretion (concurrency) | integration (two connections) |
| PFORM-25 | The migrations are additive and fan out: the new tables, functions and CHECK widenings live in `supabase/migrations` only, apply idempotently through `migrateAll` to every project, a project behind the image is held out (`updating`) until current, the old `_gated` functions stay for one release, and no tenant is backfilled | CONTEXT canonical refs (09.2, 09.4), D-596 | integration (migrate-all), pgTAP |
| PFORM-26 | Every new screen is mobile-first (390px design, 320px must not break), fully pt-BR from the catalog, 44px targets, in the prototype's language, and no UI task starts before the sketch gate `016` carries `approved: true` pasted by the user | SC6, UI-04 | web unit, Playwright 390/320, literal-check script |

**Traceability check.** SC1: 02, 03, 04, 06. SC2: 13. SC3: 12, 13, 14, 20. SC4: 09, 13. SC5: 07, 08. SC6: 18, 19, 21, 26. D-580: 13. D-581: 10, 11, 12. D-582: 02, 14, 20. D-583: 15. D-584: 11. D-585: 07, 09, 13, 23. D-586: 16. D-587: 17. D-588: 03. D-589: 01, 11. D-590: 04. D-591: 05. D-592: 06. D-593: 08, 18, 19. D-594: 22. D-595: 21. D-596: 01, 25.
</phase_requirements>

## Summary

The phase is one new data model (questions + answers, two tables in the tenant schema), one hot-path addition (a `profile_form_pending` fact folded into the membership lookup), one admin module, and four member surfaces. The riskiest piece, the gate, is cheap: a new pair of definer functions (`app.membership_in_tenant_gate` / `app.memberships_of_user_gate`) returns the seven columns of the `_gated` twins plus `profile_form_missing`, computed by ONE definer function `app.profile_form_missing(tenant, membership)` that short-circuits on the module row (one primary-key probe), then on the role, then on the partial index of active required questions, and only then anti-joins the answers through the unique index `(tenant_id, membership_id, question_id)`. Measured locally on 20,000 members x 30 required answers: 0.05 ms execution for a complete member, 0.005 ms for a tenant with the module off [VERIFIED: local EXPLAIN ANALYZE, 2026-10-29, rolled-back temp-table transaction; plan shown below]. Existing `_gated` functions are left untouched (expand-only release, D-12 order), because a function cannot change its return type in place.

The model follows the payments precedent (D-501): the gate is read by `requireAuth` on every request, so the tables, the SQL rule, the member routes and the services are KERNEL code (`packages/core`), while the admin builder, the permissions and the export live in a new module package `packages/modules/profile-form` with its manifest, exactly like `packages/modules/payments`. Answers are `jsonb` typed per question by a discriminated Zod schema in `packages/contracts`; options are a `jsonb` array on the question row with stable ids (answers reference ids, so a rename never changes meaning); "archived" is `archived_at` (SCHEMA-CONVENTIONS (d)2 soft-delete style); D-587's locks are enforced twice, by the service (coded 409) and by a `BEFORE UPDATE` trigger; D-588's "no hard delete with answers" is enforced by `ON DELETE RESTRICT` on the composite foreign key, so even a bug cannot drop an answered question. Concurrency between an admin edit and a member save is closed by an explicit `FOR SHARE` on the question rows in the save transaction (a plain FK check takes only `FOR KEY SHARE`, which does NOT conflict with the `FOR NO KEY UPDATE` an ordinary UPDATE takes [CITED: postgresql.org/docs/current/explicit-locking.html]).

Things the planner must not miss: (1) `moderation_log` cannot take the export row today (its action CHECK lists five actions and both membership columns are NOT NULL); it needs a widening migration plus the writer union, the contracts list and the Moderação row renderer. (2) `/v1/me/counters` is not in the allow-list, so an open app is caught by a new `REFUSAL_FLOWS` entry in the counters BFF and a `LiveShell` branch. (3) The member read and the bootstrap must derive "form active" from the SAME SQL function, never from the 30-second flags cache, or a member can ping-pong between the gate and an empty form. (4) `ROADMAP` SC1/SC2 wording still says "removes questions" and "at sign-up"; D-588 and D-580 supersede, reword. (5) The sketch gate `016` is a blocking human checkpoint (not created yet).

**Primary recommendation:** Mirror the payments split. Kernel: `profile_form_questions` + `profile_form_answers` tables, `app.profile_form_missing`, the `_gate` lookup twins, `PROFILE_FORM_PENDING` in `requireAuth`, member routes under `/v1/me/profile-form`. Module `profile_form` (`packages/modules/profile-form`): admin builder routes under `/v1/profile_form`, `profile_form.manage` / `profile_form.read` permissions, CSV export. Sequence: contracts + tables + RLS + functions first (pgTAP green), then the gate, then the member API, then the admin API, then web, with the sketch gate in wave 1 beside the API plans.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| "Is this member held out?" (the pending fact) | Database (definer SQL function) | API (`requireAuth` maps it to 403) | One rule in one place (the 09.1 principle); evaluated in the membership statement so there is one round trip and one snapshot |
| Hard gate refusal and allow-list | API / Backend (`requireAuth`) | — | Authority is the API; the web redirect is a convenience, never the control |
| Redirect to the form, `next` handling | Frontend Server (SSR / `requireBootstrap`, `proxy.ts` header) | Browser (`LiveShell` for an open app) | Same shape as `/assinatura-pendente`; `next` validated where used |
| Question/answer validation per type | API (Zod discriminated schema in `packages/contracts`) | Browser (same schema for instant field errors) | Server is authoritative; the shared schema keeps client and server in step |
| Lock rules (type, options, visibility) | API service (coded 409) | Database trigger + FK RESTRICT | Defense in depth; costly to loosen later |
| Visibility (self / staff / public-flagged) | Database (RLS) | API (module, role, target checks) | RLS is the floor, the API adds module-on and target-state filters |
| Completeness for summaries and impact | Database (set-based anti-join) | API | Never in JS; same SQL rule family |
| Builder UI, completion screen, profile blocks | Frontend Server (RSC pages) + Browser (client forms) | — | Existing page patterns (`/configuracoes/*`, `(auth)` group) |
| CSV generation and formula neutralisation | API / Backend | Frontend Server (BFF proxies the attachment) | PII never goes through a client library; the log row is written by the API |
| Module on/off | Platform panel (central) -> mirror -> tenant `tenant_modules` | — | Existing mirror ownership: central owns `enabled` |

## Standard Stack

No new package is installed by this phase. Everything below is already in the repo and pinned.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.6.2 | Per-type answer validators as one discriminated union | [VERIFIED: packages/contracts/package.json `"zod": "4.6.2"`]; `z.discriminatedUnion`, `z.iso.date()`, `z.httpUrl()`, `z.email()` all exist and behave as needed (probe run 2026-10-29: `z.iso.date().safeParse('2026-02-30').success === false`, `z.httpUrl().safeParse('javascript:alert(1)').success === false`, `z.httpUrl().safeParse('ftp://a.b').success === false`) |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | Tables, `pgPolicy`, CHECKs, generated migrations | [VERIFIED: apps/api/drizzle.config.ts] schema glob `../../packages/core/db/schema/*.ts` and `../../packages/modules/*/db/schema.ts`, out `../../supabase/migrations` |
| @hono/zod-openapi + hono | 1.6.3 / 4.13.7 | Member and admin routes | existing module route pattern |
| postgres (postgres.js) | 3.4.9 | Keyset reads for the CSV | existing lane code |
| next-intl | 4.14.4 | pt-BR catalogs (`apps/web/messages/pt-BR/*.json`, merged by directory) | existing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest 5 + Testing Library | 5.0.0 / 16.3.3 | unit, contracts, web components | every plan |
| pgTAP via `pnpm supabase test db` | CLI 2.117.0 | RLS, triggers, functions | PFORM-03, 05, 08, 09, 17, 18, 22, 25 |
| Playwright | 1.63.0 | e2e at 390/320 | PFORM-12..16, 20, 26 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Options as `jsonb` on the question | A `profile_form_options` table | Relational options give FKs but answers still reference option ids inside `jsonb`, so no FK is gained; a second table adds RLS, fan-out and move-engine surface. Keep `jsonb` with stable ids |
| Hand-written CSV writer (about 25 lines) | `csv-stringify` / `papaparse` | A library adds a dependency and the OWASP neutralisation is custom either way; the writer is tiny and fully unit-tested |
| New definer-function pair `_gate` | Change `app.access_state` to return a new value | Mixes two unrelated gates, breaks `ACCESS_STATES` parsing in older API revisions, and loses the clean precedence (cut before form) |
| `FOR SHARE` on question rows in the save | Rely on FK check | FK takes `FOR KEY SHARE` only; it does not block a non-key UPDATE of the question |

**Installation:** none.

## Package Legitimacy Audit

No external package is installed by this phase (UI-SPEC "Registry Safety" says the same for the UI layer; the server side uses only workspace-pinned libraries above). Package Legitimacy Gate: not applicable.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 member browser                      Next.js (Vercel)                         API (Cloud Run)                  tenant project DB
 ───────────────                     ────────────────                         ───────────────                  ─────────────────
 any page ───────────────────────► proxy.ts: session check;                                                    
                                     adds request header x-rede-path ─┐                                          
 (app) layout / page ──► requireBootstrap() ──GET /v1/me/bootstrap───► requireAuth ──► membership_in_tenant_gate(user, tenant)
                                     │                                   │              └─ app.access_state()          (payment, existing)
                                     │                                   │              └─ app.profile_form_missing()  ◄── module row? role? required Q? anti-join answers
                                     │                                   │          order: blocked → invited → access blocked → cut (SUBSCRIPTION_PENDING)
                                     │                                   │                 → pending form & path ∉ allow-list ⇒ 403 PROFILE_FORM_PENDING{tenantName}
                                     │◄── bootstrap 200 {profileForm:{pendingRequired,newOptional}} (allowed path)
                                     ├─ pendingRequired > 0 ─► redirect /completar-perfil?next=<validated x-rede-path>
                                     │
 any other API call ───BFF────────────────────────────────────────────► 403 PROFILE_FORM_PENDING ─► bootstrapRedirectPath ─► /completar-perfil?t=<tenant>
 open app (LiveShell) ─ GET /api/me/counters ─► 403 PROFILE_FORM_PENDING ─► REFUSAL_FLOWS ─► location=/completar-perfil

 /completar-perfil (auth group, host brand) ── GET /v1/me/profile-form ──► questions (active, ordered) + own answers + mode + missingRequired + formEtag
                                           └─ PUT /v1/me/profile-form/answers ──► tx(tenant lane): live module check → FOR SHARE active questions
                                                                                      → etag check (409 + fresh list) → per-type Zod → upsert/delete answers
                                                                                      → recompute missing ⇒ 422 keyed by question id if still missing
                                              success ─► flashToast + redirect(validated next ?? /inicio)

 /configuracoes/formulario-de-perfil (admin) ──► /v1/profile_form/* (requireAuth → requireModule → requirePermission('profile_form.manage'))
      create/update/reorder/archive/reactivate/delete/replace/impact/summary/export     advisory lock per tenant; revision check; trigger guards
 /perfil, /membros/[id] ──► /v1/me/profile-form (own) · /v1/members/{id}/profile-answers (public or staff)
```

### Recommended Project Structure

```
packages/contracts/src/profile-form.ts              # subpath @rede-social/contracts/profile-form: types list, option/limits schemas,
                                                    #   answerValueSchema (discriminated), body/response schemas, constants, PROFILE_FORM_ISSUES
packages/core/db/schema/profile-form-questions.ts   # Drizzle: table, CHECKs, indexes, policies   (+ export in schema/index.ts)
packages/core/db/schema/profile-form-answers.ts
packages/core/server/profile-form/                  # kernel services (payments precedent)
  member.ts       # getMemberForm, saveAnswers, dismissNotice, bootstrapBlock
  admin.ts        # list/create/update/reorder/archive/reactivate/delete/replace/impact/summary (admin lane only where e-mail is needed)
  answers.ts      # publicAnswersOf, staffAnswersOf
  export.ts       # exportAnswersCsv (keyset pages) + csv.ts (writer + neutraliser)
  lock-rules.ts   # pure lock/ratchet rules shared by the service and unit tests
packages/modules/profile-form/                      # payments-shaped module package
  module.ts  contracts/index.ts  server/{index,routes}.ts  README.md  package.json  turbo.json  tsconfig.json  vitest.config.ts  tests/
supabase/migrations/<ts>_profile_form_module_key.sql   # generated: tenant_modules_key_chk widened (from TOGGLEABLE_MODULES)
supabase/migrations/<ts>_profile_form_tables.sql       # generated: 2 tables, member_profiles column, moderation_log action CHECK
supabase/migrations/<ts>_profile_form_functions.sql    # custom: app.profile_form_missing, _gate twins, trigger, grants
supabase/tests/220-profile-form.sql                    # pgTAP
apps/api/src/routes/me.ts                              # + 3 member routes
apps/api/src/routes/members.ts                         # + GET /:membershipId/profile-answers
apps/web/app/(auth)/completar-perfil/                  # the screen (auth group, host brand)
apps/web/app/(app)/configuracoes/formulario-de-perfil/ # builder (payments hub shape)
```

### Pattern 1: the gate rides the existing membership statement (answers asks 2 and 4)

**What:** add a successor pair of definer functions; keep the `_gated` pair untouched. The new pair returns the same seven columns plus `profile_form_missing integer`. `Membership` gains `profileFormMissing: number`, `toMembership` parses it, and `requireAuth` adds one refusal after the payment checks.

**Why a new pair and not an edit:** `create or replace function` cannot change a function's return type, and a `drop` + `create` would break the still-serving older API revision during the D-12 order (migrations first, API second). The 09.1-02 migration states the same rule: "`app.membership_in_tenant` and `app.memberships_of_user` are NOT touched, so the API revision still serving during `supabase db push` keeps working; the new revision calls the `_gated` twins." Drop the `_gated` pair in a later cleanup migration (08.1-05 precedent for `membership_for_user`).

**The rule (one place):**
```sql
-- Source: modeled on supabase/migrations/20261020225255_access_gate_functions.sql (app.access_state)
create or replace function app.profile_form_missing(p_tenant uuid, p_membership uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select case
    -- 1. module off or missing row: one primary-key probe, then done (cost for a tenant without the module)
    when not exists (
      select 1 from public.tenant_modules tm
       where tm.tenant_id = p_tenant and tm.module_key = 'profile_form' and tm.enabled
    ) then 0
    -- 2. only the role `member` is ever held (D-584); a live membership of THIS tenant
    when not exists (
      select 1 from public.memberships m
       where m.id = p_membership and m.tenant_id = p_tenant
         and m.role = 'member' and m.deleted_at is null
    ) then 0
    -- 3. active required questions the member has no answer row for (partial index, then unique-index probes)
    else (
      select count(*)::int
        from public.profile_form_questions q
       where q.tenant_id = p_tenant and q.required and q.archived_at is null
         and not exists (
           select 1 from public.profile_form_answers a
            where a.tenant_id = q.tenant_id and a.membership_id = p_membership and a.question_id = q.id
         )
    )
  end
$$;

create or replace function app.membership_in_tenant_gate(p_user_id uuid, p_tenant_id uuid)
returns table (tenant_id uuid, tenant_slug text, tenant_display_name text, role text, status text,
               tenant_status text, access_state text, profile_form_missing integer)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.slug, t.display_name, m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status,
         app.access_state(m.tenant_id, m.user_id),
         app.profile_form_missing(m.tenant_id, m.id)
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = p_user_id and m.tenant_id = p_tenant_id and m.deleted_at is null
$$;
-- memberships_of_user_gate: same body without the tenant predicate, order by t.slug.
-- revoke all ... from public; grant execute on both twins to api_user; on profile_form_missing to service_role.
```
The `case` guarantees the evaluation order (a plain `A and B` of two EXISTS gives no ordering guarantee). The access-state precedent is explicit that "The order (gate, then staff, then e-mail) means an ungated tenant pays one primary-key probe of `tenant_modules` per request." This rule has the same property.

**Sizing (measured, answer to extra ask 2):**

```
-- local Postgres 54322, rolled-back transaction, temp tables with the proposed indexes
-- q: 30 required active questions for the tenant; a: 20,000 members x 30 answers + 200,000 rows of other tenants
-- unique index a_uq on a (tenant_id, membership_id, question_id); partial index q_req on q (tenant_id) where required and archived_at is null
Complete member (module on, 30 required, 30 answered)   Execution Time: 0.550 ms (first cold run; InitPlan nested-loop anti join 0.046 ms)
Tenant with the module off                              Execution Time: 0.005 ms (one probe of tenant_modules)
```
[VERIFIED: local EXPLAIN (ANALYZE, BUFFERS) 2026-10-29; temp tables use local buffers, plan shape is what transfers]. Production latency over Supavisor was not measured [ASSUMED: negligible next to the existing single round trip]. Cost summary per request: module off = +1 PK probe (same as the payments `access_gate_on` already costs); module on, staff = +2 PK probes; module on, member, no required question = +1 partial-index probe returning nothing; member with R required questions = R unique-index probes (R <= 30). Required indexes: unique `(tenant_id, membership_id, question_id)` on answers (also serves the self reads), partial `(tenant_id) where required and archived_at is null` on questions.

**`requireAuth` change** (file `packages/core/server/auth/require-auth.ts`):
```ts
// Source: current file lines 106 and 191-196 (quoted in "Verified in-repo facts")
export const PROFILE_FORM_ALLOWED_PATHS = new Set([
  '/v1/me/bootstrap',
  '/v1/me/profile-form',
  '/v1/me/profile-form/answers',
]);
// after the existing `cut` check, last of all:
if (membership.profileFormMissing > 0 && !PROFILE_FORM_ALLOWED_PATHS.has(c.req.path.replace(/\/+$/, ''))) {
  throw new ApiError(403, 'PROFILE_FORM_PENDING', { tenantName: membership.tenantDisplayName });
}
```
Order stays: bearer -> host -> verify -> membership -> tenant suspended -> blocked -> invited -> access blocked -> cut -> **form pending**. A cut member is refused with `SUBSCRIPTION_PENDING` first (and cannot reach the form: pay first, then fill in); `ctx` is set only after all checks, so a refused request never reaches a handler.

**Error code and names (recommended):** error code `PROFILE_FORM_PENDING` (403, sibling of `SUBSCRIPTION_PENDING`, `details.tenantName` only); module key `profile_form`; permissions `profile_form.manage` (admin_tenant only) and `profile_form.read` (admin_tenant + support_tenant); route prefix `/v1/profile_form` (see Pitfall 11 for why the underscore). Files that change for the code: `packages/contracts/src/errors.ts` (append to `ERROR_CODES`), `packages/core/server/http/api-error.ts` (`ERROR_MESSAGES` is `Record<ErrorCode, string>`, so the compiler forces the pt-BR message), `apps/web/lib/bootstrap.ts` (`bootstrapRedirectPath`), `apps/web/app/api/me/counters/route.ts` (`REFUSAL_FLOWS`), `apps/web/components/shell/LiveShell.tsx`.

**What happens to what (answer to ask 2):**
- Routes outside the allow-list: 403 `PROFILE_FORM_PENDING` (media, feed, notifications, chat, `/v1/me/counters`, `/v1/me/profile`, `/v1/me/profile/dismiss-nudge`, push subscriptions, ...). Public lanes (`/v1/public/*`, `/v1/join/*`, `/v1/hooks`, `/v1/webhooks`) do not run `requireAuth` and are unaffected.
- `/v1/me/bootstrap`: allowed (D-581), 200 with the `profileForm` block; this is how a page render learns to redirect without an error round trip. `/v1/me/counters` is NOT allowed, so the counters BFF needs the new refusal flow (an open app is taken to the form at the next refetch).
- Sign-out: does not touch the API. `logout()` is a Supabase Auth call from a server action [VERIFIED: apps/web/app/(app)/actions.ts:18-29 `await supabase.auth.signOut({ scope: 'local' })`], so no allow-list entry is needed. `LogoutForm` first forgets the device's push subscription through the BFF; under the gate that DELETE returns 403, but `useLogoutSubmit` bounds it to 2 s ("Everything is bounded to 2 s ... so a dead network never blocks logging out", `LogoutForm.tsx`), so verify `disablePush` swallows a 403 (Pitfall 9).
- The form's own routes: the three paths above. The notice dismissal route is NOT in the allow-list on purpose: an optional-only form never gates, and a gated member answers the required questions first.
- Per-tenant database lane: the lookup runs on the tenant project's handle (`resolveProject(tenantId)` -> `withHandle` in `membershipInTenant`), so the new function must exist in every tenant project. It does, because it ships in `supabase/migrations` (the tenant set); a project whose applied schema is below the image is held out as `updating` before any tenant query runs [VERIFIED: packages/core/server/migrations/required.ts doc: "A project whose applied schema is BELOW it is held out (`updating`) until the fan-out catches it up"]. `membershipsOfUser` (generic hosts) stays on the central handle, which is project 0 and also carries the tenant set, so the second twin must ship in the same migration. The control-plane mirror and the host answer (`resolveTenantHost`) read central tables only and are untouched; only `tenant_modules.enabled` crosses (central owns it, pushed best-effort to the tenant project, reconcile heals), so the gate follows the same lag as every other module flag.

### Pattern 2: data model (answer to ask 3)

`profile_form_questions` (kernel schema file, Drizzle):

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk default random | |
| tenant_id | uuid not null -> tenants(id) | `unique (tenant_id, id)` for the composite FK |
| type | text not null | CHECK `in (13 types)` built from the contracts list, same trick as `tenant_modules_key_chk`; widening is the "small migration at most" of D-591 |
| title | text not null | CHECK `char_length between 1 and 120` |
| help_text | text null | CHECK `<= 300` |
| required | boolean not null default false | |
| show_on_profile | boolean not null default false | |
| allow_other | boolean not null default false | CHECK: only the three choice types |
| options | jsonb not null default '[]' | `[{ "id": "<uuid>", "label": "..." }]` in display order; CHECK array, length <= 20, and `(type is choice) = (length >= 2)` |
| limits | jsonb not null default '{}' | `{ "min"?, "max"? }` for number (numbers) and date (ISO days); CHECK object |
| position | integer not null | ordering; gaps allowed; tie-break `(position, created_at, id)` |
| archived_at | timestamptz null | soft state (SCHEMA-CONVENTIONS (d)2) |
| listed_at | timestamptz not null default now() | set on create and on reactivate; drives the "new optional" notice (D-586) |
| revision | integer not null default 1 | optimistic lock for two admins; NOT a completeness counter (D-585 is about completeness, which stays computed) |
| created_by_user_id | uuid not null -> users(id) | authorship convention (c)1 |
| created_at, updated_at | timestamptz | |

Indexes (tenant first): `(tenant_id, archived_at, position)` for the lists; partial `(tenant_id) where required and archived_at is null` for the gate; the `unique (tenant_id, id)`.

`profile_form_answers`:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| tenant_id | uuid not null -> tenants(id) | |
| question_id | uuid not null | composite FK `(tenant_id, question_id) -> profile_form_questions(tenant_id, id) ON DELETE RESTRICT` (a cross-tenant answer is impossible and an answered question cannot be deleted by anyone, D-588) |
| membership_id | uuid not null -> memberships(id) ON DELETE CASCADE | D-594, same as `member_profiles` |
| user_id | uuid not null -> users(id) ON DELETE CASCADE | denormalised for the self policy, as `member_profiles.user_id` is |
| value | jsonb not null | CHECK `octet_length(value::text) <= 4096`; shape below |
| created_at, updated_at | timestamptz | |

Indexes: `unique (tenant_id, membership_id, question_id)` (gate anti-join, self reads, upsert target); `(tenant_id, question_id)` (answer counts, FK RESTRICT check, the "has answers" lock queries).

**Answer value shapes** (stored `value`; the question's `type` is the discriminator, so no per-answer type column; the type is locked once answered):

| Type | `value` | Validator notes |
|------|---------|-----------------|
| short_text / long_text | JSON string, trimmed | 1..120 / 1..1000 code points |
| single_choice / dropdown | `{ "optionId": "<id>" , "otherText": null }` or `{ "optionId": null, "otherText": "<1..120>" }` | exactly one side; `otherText` only if `allow_other` |
| multiple_choice | `{ "optionIds": ["<id>", ...], "otherText": "<..>" or null }` | >= 1 total selections, ids unique and in the question |
| number | JSON number | finite, within `limits` |
| date | `"YYYY-MM-DD"` | `z.iso.date()`, within `limits` |
| phone | `"11912345678"` (national digits) | 10 or 11 digits, DDD 11-99, 9 after the DDD when 11 |
| email | lower-case string | `z.email()`, <= 254 |
| link | `"https://..."` | `z.httpUrl()`, <= 2048 |
| yes_no | boolean | |
| acceptance | `true` | an unticked box is NO ROW (delete), so "answered" always means ticked |
| rating | integer 1..5 | |

An unanswered optional question and a cleared one are the absence of a row. Because validity is enforced at write time and the locks forbid narrowing, "has an answer row" IS "has a valid answer", which is what lets the gate be a pure anti-join with no per-type logic in SQL.

**Contract shape** (`packages/contracts/src/profile-form.ts`, new subpath in `package.json` exports like `./payments`):
```ts
// Source: pattern of packages/contracts/src/payments.ts + zod 4.6.2 probe above
export const PROFILE_FORM_TYPES = ['short_text','long_text','dropdown','multiple_choice','single_choice',
  'number','date','phone','email','link','yes_no','acceptance','rating'] as const;
export const answerValueSchemas = {
  short_text: z.string().trim().min(1).max(PROFILE_FORM_LIMITS.shortText),
  // ... one schema per type
} satisfies Record<ProfileFormType, z.ZodType>;
// The server builds the check from the QUESTION row, never from the client's claim of type:
export function parseAnswer(q: QuestionDef, raw: unknown): { ok: true; value: unknown } | { ok: false; issue: ProfileFormIssue } { /* switch on q.type, min/max/options from q */ }
```
Because min/max/options come from the stored question, `parseAnswer` is a function over `(question, raw)`; the discriminated union `z.discriminatedUnion('type', [...])` is used for the question definition body (create/update) and for the wire shape `{ type, value }` the web form emits, which the server re-derives from the stored type anyway.

**Other tables touched:**
- `member_profiles`: one additive nullable column `profile_form_notice_dismissed_at timestamptz` (the `nudge_dismissed_at` mould; `ADD COLUMN` nullable is instant). New-optional count = active optional questions with `listed_at > coalesce(dismissed_at, '-infinity')` that this member has not answered. "Agora não" = `set ... = now()` (batch granularity, UI-D-589 default).
- `moderation_log`: widen `moderation_log_action_chk` with `profile_form_exported` (precedent migration `20261019225153_moderation_post_removed.sql`: DROP + ADD CHECK, immutability triggers fire on rows, not DDL). The row needs both membership columns, which are `notNull()`: use the exporting admin as actor AND target (`targetMembershipId` = actor's membership), no subject, no excerpt, optional `reason` null. Parts that change together: `packages/core/db/schema/moderation-log.ts` CHECK list, `packages/contracts/src/moderation.ts` `MODERATION_ACTIONS` (append last: filter chips read this order), `packages/core/server/moderation/log.ts` `ModerationEntry` union + the `removal`/`details` logic, `apps/web/components/admin/ModerationLogRow.tsx` and `apps/web/lib/moderation-view.ts` (exhaustive maps), tests `packages/contracts/tests/moderation.test.ts`, `packages/core/tests/moderation-log.test.ts`, pgTAP `154-moderation-log.sql`.

**RLS policies (D-593; NOT `member_profiles_tenant_select`).** Using the helper fragments the store already uses (`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`, the `TENANT_ADMIN` const in `packages/modules/store/db/schema.ts`):

| Table | Policy | For | Predicate |
|-------|--------|-----|-----------|
| questions | `profile_form_questions_select` | select | `tenant_id = app.tenant_id() and (archived_at is null or app.tenant_role() in ('admin_tenant','support_tenant'))` |
| questions | `_insert` / `_update` / `_delete` | each | `tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'` (with check the same) |
| answers | `profile_form_answers_self_select` | select | `tenant_id = app.tenant_id() and user_id = app.user_id()` |
| answers | `profile_form_answers_staff_select` | select | `tenant_id = app.tenant_id() and app.tenant_role() in ('admin_tenant','support_tenant')` |
| answers | `profile_form_answers_public_select` | select | `tenant_id = app.tenant_id() and exists (select 1 from public.profile_form_questions q where q.tenant_id = profile_form_answers.tenant_id and q.id = profile_form_answers.question_id and q.show_on_profile and q.archived_at is null)` |
| answers | `_self_insert` / `_self_update` / `_self_delete` | each | `tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() = 'member'`; insert/update `with check` adds `exists (select 1 from public.memberships mm where mm.id = membership_id and mm.tenant_id = tenant_id and mm.user_id = user_id and mm.deleted_at is null)` |

Staff never write answers (D-584). The public policy's `exists` is a single indexed probe on a table of <= 60 rows per tenant; the SCHEMA-CONVENTIONS (a)5 caution against correlated subqueries is about large tables. pgTAP 010 requires RLS + at least one policy on every table carrying `tenant_id`, and 040 requires a tenant-first index; both are met.

**Lock enforcement (D-587 and the "show on profile" freeze).** Service rules in `lock-rules.ts` (pure, unit-tested) and a `BEFORE UPDATE` trigger `app.profile_form_question_guard()` that raises a distinct SQLSTATE mapped to a coded 409 when the row has answers and: the `type` changes; an option id present in OLD (and answered) is missing or relabelled in NEW; `allow_other` goes true -> false while an "Outro" answer exists; `show_on_profile` goes false -> true (the PU-1 ratchet: true -> false stays allowed); `limits` narrow. The service takes `select ... from profile_form_questions where id = $1 for update` FIRST and counts answers in a separate statement afterwards, so correctness does not depend on trigger timing under READ COMMITTED; the trigger is the backstop. `ON DELETE RESTRICT` covers the delete half of D-588. A hard delete of a never-answered question is allowed (PU-3 default).

**Ordering and concurrency cost.** `position` is an integer; reorder sends the full ordered id list and the service renumbers `1..n` in one `UPDATE ... FROM unnest(...) with ordinality`, refusing (409) when the list is not exactly the current active set. Create = `max(position)+1`, reactivate = `max(position)+1` (UI-D-578). Every admin write of a tenant takes `pg_advisory_xact_lock(hashtextextended('profile_form:'||tenant_id, 0))`, the same shape as `setupLock` in `packages/core/server/payments/gate.ts`. Cost: the admin writes are rare, so serialising per tenant is free; there is no unique constraint on `position`, so a lost race can at worst reorder, never corrupt.

**Concurrency, member save vs admin edit (answer to ask 6).** The save transaction (tenant lane) runs: (1) live module check from `tenant_modules` in the same statement family as the gate (NOT `moduleFlags`); (2) `select ... from profile_form_questions where tenant_id = $t and archived_at is null order by position for share` (conflicts with the admin's UPDATE/`FOR UPDATE`; a plain FK check would take only `FOR KEY SHARE`, which does not conflict with a non-key UPDATE [CITED: postgresql.org/docs/current/explicit-locking.html "FOR SHARE ... blocks other transactions from performing UPDATE, DELETE, SELECT FOR UPDATE or SELECT FOR NO KEY UPDATE"]); (3) compare the client's `formEtag` (md5 of `id:revision` of the active questions in order) and answer 409 with the fresh list on mismatch; (4) validate every submitted answer with `parseAnswer`; (5) upsert (`on conflict (tenant_id, membership_id, question_id) do update`) and delete cleared optional ones; (6) recount missing required and refuse with keyed errors (rollback) if any. Either the admin change commits first (the member validates against the new definition) or the member commits first (the admin then counts the new answer and the lock applies). Module turned off meanwhile = 200 no-op per UI-D-587.

### Pattern 3: member and admin API surface

Member routes are KERNEL routes in `apps/api/src/routes/me.ts` (mounted at `/v1/me` with `requireAuth`), with NO `requireModule`: UI-D-587 requires "the module was turned off meanwhile: the save is accepted as a no-op" and UI-D-588 requires a "Nothing to answer" state, both of which a 404 `MODULE_DISABLED` would break.
- `GET /v1/me/profile-form` -> `{ mode: 'first'|'returning'|'edit'|'none', missingRequired, formEtag, questions[ { id, type, title, helpText, required, showOnProfile, options[ {id,label} ], allowOther, limits, answer } ] }`. Staff and module-off return `mode: 'none', questions: []`.
- `PUT /v1/me/profile-form/answers` `{ formEtag, answers: { [questionId]: value | null } }` -> 200 `{ missingRequired: 0 }` | 422 `{ errors: { [questionId]: issueCode } }` | 409 (form changed, body carries the fresh list). Staff: 403 `FORBIDDEN`.
- `POST /v1/me/profile-form/dismiss-notice` (idempotent, `coalesce`-style like `dismissNudge`).
- `GET /v1/members/{membershipId}/profile-answers` in `routes/members.ts`: public rows for a member viewer (strict payload, reuses the D-23 indistinguishable 404), all rows for staff (`profile_form.read`).
Admin routes (module, `app.route('/v1/profile_form', profileFormRoutes)`): list active / archived, summary, impact, create, update (`revision`), reorder, archive, reactivate, delete, replace, export. Guard chain `requireAuth -> requireModule('profile_form') -> requirePermission('profile_form.manage')` per route. The member dismissal and read routes are not admin routes.

The e-mail in the export lives in `users`, which is self-select only in the tenant lane, so the export (and only it) reads in the admin lane with an explicit `tenant_id = ctx.tenantId` predicate, exactly as `listAdminMembers` does (`packages/core/server/tenancy/admin-members.ts`: "RLS is therefore OFF: the `m.tenant_id = ${ctx.tenantId}` predicate on every statement is the only isolation"). That adds an entry to `apps/api/tests/admin-lane-inventory/` (a new `profile-form.ts` area, class `T`, status `migrated`) and `packages/core/server/profile-form/**` to the Biome `noRestrictedImports` allow list next to `server/payments/**` (biome.json lines 37-40 pattern).

### Pattern 4: CSV export streaming and neutralisation

Keyset pages of 500 memberships (`order by m.id`, `m.id > $cursor`), each page one query returning name, e-mail and `jsonb_object_agg(question_id, value)`; the API writes the header (questions: active in order, then archived by `archived_at`) and then page by page into a `ReadableStream`, so memory is bounded by a page. The log row is written and committed BEFORE the first byte (a mid-stream failure cannot roll it back; the dialog's wording "fica registrado" stays true). Delimiter `;` and a UTF-8 BOM for pt-BR Excel (PU-9 default) [ASSUMED: Excel in a pt-BR locale splits on `;`, and a BOM makes it read UTF-8]. A Cloud Run non-streaming HTTP/1 response is capped (CLAUDE.md quotes 32 MiB for bodies); a streamed chunked response avoids depending on that [ASSUMED]; 20,000 members x 30 columns is a few MB either way. The web side is a Route Handler that proxies the API attachment with `apiFetch` and streams `res.body` through with `Content-Disposition: attachment; filename="respostas-perfil-AAAA-MM-DD.csv"` and `Cache-Control: no-store`.

Neutralisation (answers D-595; OWASP): leading `=`, `+`, `-`, `@`, tab (0x09), carriage return (0x0D) and line feed (0x0A), plus full-width `＝＋－＠` [CITED: community.owasp.org/attacks/CSV_Injection lists these triggers and advises prefixing the cell inside the quoted field; "checking only the first character is insufficient, since field separators and quotes must be handled too"]. Recommended: after RFC 4180 quoting, prefix a single quote `'` to any cell whose text starts with one of those characters (the cell then shows the quote-less text in Excel), applied to EVERY cell including names, e-mails and question titles (headers come from admin text too), and to number cells only when they are text (a negative number such as `-3` from a number question is data: write numbers from the stored `jsonb` number with a leading minus WITHOUT neutralising only when the value came from a `number` type; everything else neutralised). Unit-test the writer with the OWASP payload list.

### Anti-Patterns to Avoid
- **A stored "completed" flag or a form version on the member.** D-585 forbids it; completeness is the anti-join.
- **Reading "is the form active" from `moduleFlags` (30-second cache) in the member read while the gate reads the live SQL.** The two disagree for up to 30 s and trap the member in a redirect loop (Pitfall 1).
- **`requireModule` on the member routes.** It would 404 the save and the empty-form state the UI-SPEC defines.
- **Inheriting `member_profiles_tenant_select` or reusing `tenantIsolationPolicy` (`for: 'all'`) on answers.** It would expose every answer to the whole tenant.
- **A client-supplied question type.** The server derives the validator from the stored question.
- **Writing the answers in a URL, log line, toast, `localStorage` or analytics event** (UI-D-598). Add the answers path to the pino redaction if a body logger exists (`logging-redact.test.ts` pins the redaction list).
- **A new `ModuleKey` with a hyphen** (breaks the mount-path test, Pitfall 11).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-type value validation | ad hoc `if`s in the route | one `parseAnswer` over the Zod 4 primitives (`z.iso.date()`, `z.httpUrl()`, `z.email()`) | URL scheme allow-listing and real-calendar dates are already correct in Zod 4.6.2 (probe above) |
| Tenant gate wiring | a second query in `requireAuth` | the successor `_gate` twins | the no-second-round-trip constraint |
| Module toggle plumbing | a settings flag | `TOGGLEABLE_MODULES` + `defineModule` + platform `ModuleToggles` | exact precedent (store, courses, social, payments) |
| Moderation log insert | a new audit table | widen `moderation_log` and call `recordModerationAction` | append-only locks (4 of them) already proven by pgTAP 154 |
| Open-redirect check | a fresh regex | extend the logic of `safeContinuePath` in `apps/web/lib/continue-path.ts` (leading `/`, no `//`, no `/\`, no control characters, <= 512) into a general `safeNextPath` and add the `(auth)`/self exclusions | the same rule set is already reviewed there |
| Advisory serialisation | home-made flag rows | `pg_advisory_xact_lock(hashtextextended(...))` | `setupLock` precedent in `packages/core/server/payments/gate.ts` |
| Dismissible notice storage | a new table | a nullable `timestamptz` on `member_profiles` | the `nudge_dismissed_at` mould |
| Cross-tenant FK safety | trigger comparing tenant ids | composite FK `(tenant_id, question_id)` | the database proves it, no code path to forget |

**Key insight:** every hard piece (gate placement, lane routing, mirror ownership, module toggle, immutable log, open-redirect rule, advisory lock, admin-lane e-mail read) already has a reviewed precedent in this repo; the work is wiring them, not inventing.

## Common Pitfalls

### Pitfall 1: the gate and the form disagree about "active" (redirect loop)
**What goes wrong:** the gate (live SQL) says pending, the `/completar-perfil` read says "module off, nothing to answer" because it used the 30 s `moduleFlags` cache; the empty state links to `/inicio`, which redirects back.
**How to avoid:** the bootstrap block, the member read and the save all derive active/missing from `app.profile_form_missing` and a live `tenant_modules` read inside their transaction; the cache is used only for permissions and nav.
**Warning signs:** a member bounced between `/inicio` and `/completar-perfil` right after the super_admin toggles the module.

### Pitfall 2: the form page redirects to itself
**What goes wrong:** `/completar-perfil` calls `requireBootstrap()`, which redirects a pending member to `/completar-perfil`.
**How to avoid:** the page uses `getBootstrap` through `loadOrRedirect(..., bootstrapRedirectPath)` (the `acceptInviteRedirectPath` precedent), never `requireBootstrap`. A unit test asserts the page module does not import it.

### Pitfall 3: the destination is lost
**What goes wrong:** D-583 needs the link the member opened, but `bootstrapRedirectPath(error)` only sees the error and Server Components cannot read the request path.
**How to avoid (recommended):** `proxy.ts` already builds the forwarded request headers (`buildRequestHeaders`, `requestHeaders`); add one header (for example `x-rede-path` = pathname + search, for authenticated page requests only). `requireBootstrap()` reads it with `headers()`, validates it with `safeNextPath`, and calls `redirect('/completar-perfil?next=' + encodeURIComponent(path))`. The error-code mapping (`bootstrapRedirectPath`) carries no path and lands on `/inicio` after saving, which is acceptable for the rare non-render case. The existing `rede_continue` cookie is for cold logged-out deep links only (`isContinuablePath`: `/post/`, `/eventos/`, `/stories/`); it is consumed by the login action, so after login the post page render hits the gate and the header path carries the same destination. Alternative (not recommended): reuse the cookie from a Route Handler. Needs a PU-style confirmation only if the planner prefers the cookie.

### Pitfall 4: `moderation_log` rejects the export row
**What goes wrong:** the CHECK lists five actions and both membership columns are `notNull()`; the insert fails at runtime, after the file was produced.
**How to avoid:** widen the CHECK (generated migration), append `profile_form_exported` last in `MODERATION_ACTIONS`, extend `ModerationEntry`, use the actor as target, update the Moderação row renderer; log BEFORE streaming.

### Pitfall 5: FK checks do not serialise with admin edits
**What goes wrong:** a member answer inserted while the admin changes the type; the FK only takes `FOR KEY SHARE`, which does not conflict with a non-key UPDATE.
**How to avoid:** explicit `FOR SHARE` on the active question rows in the save, and `FOR UPDATE` first in admin updates; test with two connections.

### Pitfall 6: `Membership` consumers break typecheck
**What goes wrong:** adding `profileFormMissing` to `Membership` breaks every fixture that builds one.
**How to avoid:** make it required (a missing value must not read as "not pending" by accident) and update `packages/core/tests/membership-pick.test.ts` and `packages/core/tests/require-auth-cut.test.ts`; add `require-auth-form.test.ts` in the `require-auth-cut.test.ts` mould.

### Pitfall 7: a new tenant table the move engine cannot place
**What goes wrong:** `platform:move-tenant` derives its table list from catalogs and refuses uncovered tables.
**How to avoid:** both new tables carry `tenant_id` and their FKs are plain and acyclic, so `fk-order.ts` sorts them; run `move-copy.test.ts` / `move-guard.test.ts` after the migration to prove coverage [VERIFIED: packages/core/server/projects/move/plan.ts doc: "Anything with a `tenant_id` column that is NOT listed here is copied"].

### Pitfall 8: hard-coded module counts
**What goes wrong:** tests pin the number of keys.
**How to avoid:** update `packages/contracts/tests/platform.test.ts` (`expect(TOGGLEABLE_MODULES).toHaveLength(11)`), `apps/api/tests/unit/registry.test.ts` (line 242 list `[...REAL_TENANT_DEFAULT_MODULES, 'store', 'courses', 'social', 'payments']`), the platform `ModuleToggles` and modules page tests, `apps/web/messages/pt-BR/platform.json` neighbours (new `platform.profile_form.json` with `moduleNames` / `moduleDescriptions` / `disableDialog`), `iconFor` gains `clipboard-list`, and `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx` gains the `profile_form` extras entry.

### Pitfall 9: push-forget on the gated screen
**What goes wrong:** "Sair" runs `disablePush`, whose BFF DELETE returns 403 under the gate.
**How to avoid:** `useLogoutSubmit` bounds it to 2 s; confirm `disablePush` treats a 403 as done (read `apps/web/lib/push.ts`), add a test on the gated screen.

### Pitfall 10: stale admin tab and the `revision`
**What goes wrong:** two admins edit; the later save overwrites the earlier.
**How to avoid:** `PATCH` carries `revision`; mismatch -> 409 with the UI-D-569 alert; also take the per-tenant advisory lock so a concurrent `reorder` cannot interleave.

### Pitfall 11: mount-path test and the underscore key
**What goes wrong:** `apps/api/tests/unit/mounts.test.ts` case 1 asserts `route.path.startsWith('/v1/${key}')` for every manifest with routes; a kebab mount `/v1/profile-form` fails for key `profile_form`.
**How to avoid:** mount at `/v1/profile_form` (module admin routes) — ugly but zero test churn — or change the test to normalise; the member routes under `/v1/me/profile-form` are unaffected.

### Pitfall 12: seed and fixtures
Module off by default means the seed (`scripts/seed.ts`) and every existing integration/e2e suite are unaffected; do NOT enable the module in the seed (it would gate seeded members the moment a spec adds a required question). Specs enable it through a `withProfileForm` helper in `apps/api/tests/integration/setup.ts` modelled on `withPaymentsGate`/`setPaymentsRow`, and clean up by prefix.

### Pitfall 13: test-suite traps from memory (carry into every plan)
- `pnpm test:integration -- <name>` does NOT filter; run one file with `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`.
- Run pgTAP before integration (integration residue trips `154-moderation-log.sql`); after `pnpm db:reset` run `pnpm db:seed`; use `pnpm supabase ...` (it goes through `scripts/supabase.sh`), never bare `supabase`.
- Local disk is at 99% (2.8 GiB free on 2026-10-29): gates with `TURBO_CACHE=local:r --concurrency=4`, skip `turbo run build`, remove `apps/web/.next/dev` and `.next/cache` when no `next dev` runs, and run e2e under a free-space watchdog (a full e2e drops about 9 GB; Docker hangs when the disk fills).
- TDD red-evidence gate expects TAP; Vitest never emits it (throwaway normalizer, never fabricate counts).
- Plan-gate parser: a second colon inside a bold `D-NN` bullet breaks decision coverage; carried-forward prior-phase D-NN bullets need `[informational]` right after the first id.
- Execution is sequential on the main tree; keep API plans flowing past the pending sketch gate and stop at the first plan whose `depends_on` names it; never stage the sketch files.

## Code Examples

### The CSV cell neutraliser (unit-tested with the OWASP list)
```ts
// Source: OWASP CSV Injection guidance (community.owasp.org/attacks/CSV_Injection)
const TRIGGER = /^[=+\-@\t\r\n＝＋－＠]/;
export function csvCell(text: string, opts: { numeric?: boolean } = {}): string {
  const safe = !opts.numeric && TRIGGER.test(text) ? `'${text}` : text;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
```

### The allow-list refusal in `requireAuth` (shape only; see Pattern 1)
```ts
if (membership.profileFormMissing > 0 && !PROFILE_FORM_ALLOWED_PATHS.has(c.req.path.replace(/\/+$/, ''))) {
  throw new ApiError(403, 'PROFILE_FORM_PENDING', { tenantName: membership.tenantDisplayName });
}
```

### Save skeleton (tenant lane)
```ts
// Source: composed from lanes in packages/core/db/README.md and the payments gate service
return withTenantTx(ctx, async (tx) => {
  if (!(await liveModuleOn(tx, ctx))) return { missingRequired: 0 };           // no-op, not a 404
  const questions = await lockActiveQuestions(tx, ctx);                          // ... for share, ordered
  if (body.formEtag !== etagOf(questions)) throw new FormChanged(questions);     // 409 + fresh list
  const errors = applyAnswers(tx, ctx, questions, body.answers);                 // parseAnswer, upsert, delete
  if (Object.keys(errors).length || (await missingRequired(tx, ctx)) > 0) throw new AnswerErrors(errors);
  return { missingRequired: 0 };
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cut member allowed only `/v1/me/subscription`, bootstrap refused | Form gate also allows the bootstrap (D-581) | this phase | the web learns "pending" from a 200 bootstrap block and from the error code on other routes |
| `app.access_state` is the only per-request gate fact | `app.profile_form_missing` joins it in the same statement | this phase | one lookup, two independent gates, explicit precedence |

**Deprecated/outdated:** nothing is retired. The `_gated` pair becomes unused after the new API ships; schedule its drop in a later cleanup migration.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Excel in pt-BR splits on `;` and reads a UTF-8 file with a BOM correctly | Pattern 4 | Export opens as one column or mojibake; change delimiter/BOM (PU-9 already flags it as the planner's call) |
| A2 | A streamed (chunked) Cloud Run response is not subject to the 32 MiB cap quoted in CLAUDE.md for bodies | Pattern 4 | Very large exports fail; mitigation is paging the export or a signed download; sizes expected are a few MB |
| A3 | Production latency over Supavisor adds nothing material to the measured 0.05 ms in-database cost | Pattern 1 | Gate cost higher than estimated; the function is one statement already inside the lookup, so the delta is bounded by DB execution time |
| A4 | `pnpm supabase test db <file>` accepts a single file path in CLI 2.117.0 | Validation Architecture | Run the whole pgTAP suite instead (about 800 assertions, fast) |
| A5 | A `BEFORE UPDATE` row trigger sees committed answers after waiting on a row lock in READ COMMITTED | Pattern 2 | The design does not depend on it (service takes `FOR UPDATE` first and counts in a later statement); the trigger is a backstop only; cover with a two-connection test |
| A6 | UI-SPEC defaults PU-1..PU-13 (ratchet toward private, answered labels locked, limits 30/20/120/300/80/120/120/1000, batch dismissal, one route for gate and edit, preview without duplicate, `;` + BOM, sketch run) are accepted by Igor; only PU-14 is recorded as confirmed | Requirements PFORM-02, 06, 16, 17, 21 | Constants and one-line rules change; no structural impact |
| A7 | Option ids are server-generated UUIDs | Pattern 2 | Any stable id scheme works; contract test pins uniqueness within a question |
| A8 | `disablePush` already treats a failed DELETE as done | Pitfall 9 | "Sair" could stall up to the 2 s bound on the gated screen; one small fix |
| A9 | Including `blocked` members in the CSV and excluding `invited`, staff and deleted ones is what Igor expects for "one row per member" | PFORM-21 | Row-set filter only |

## Open Questions

1. **Where does `next` travel?**
   - Known: UI-D-581 carries `?next=`; `bootstrapRedirectPath(error)` has no path; `requireBootstrap` runs in Server Components.
   - Unclear: header from `proxy.ts` (recommended) vs cookie vs "the page that caught the error".
   - Recommendation: the `x-rede-path` request header, validated by `safeNextPath` at use; planner confirms in the plan and adds `proxy.test.ts` cases.
2. **Which members are exported?** Recommendation: live (`deleted_at is null`) `member`-role memberships, `active` and `blocked`; exclude `invited` and staff. Flag in the plan for Igor (A9).
3. **Sketch gate 016** is a blocking human checkpoint (D-417): `.planning/sketches/016-phase-12-designed-screens/` does not exist yet and MANIFEST row 016 must be registered `pending`; Igor pastes `approved: true`. Or he waives it and the waiver is recorded in CONTEXT.
4. **ROADMAP wording to reconcile** (see Existing-code contradictions). The planner rewrites SC1/SC2 when it writes the `**Requirements**:` line.
5. **When to drop the `_gated` pair** (one release after the new API is live in production).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | ✓ | v24.14.0 | — |
| pnpm | monorepo | ✓ | 12.4.1 | — |
| Docker (client) | local Supabase stack, pgTAP | ✓ (client 29.3.1; engine answered through the stack below) | 29.3.1 | restart procedure in memory (`docker-hangs-when-disk-fills`) |
| Local Postgres (Supabase stack) | pgTAP, integration, EXPLAIN | ✓ | reachable at 127.0.0.1:54322 (`select 1` ok), psql 18.3 | `pnpm db:reset && pnpm db:seed` |
| Free disk | e2e, builds, stack | ⚠ 99% used, 2.8 GiB free | — | clear `.turbo/cache`, `apps/web/.next/dev`, `.next/cache`; e2e needs >= 10 GiB; watchdog |
| Playwright browsers | PFORM-12..16, 20, 26 | not probed | 1.63.0 pinned | `playwright install` on demand |
| Context7 MCP | doc lookup | ✗ (tool not present in this session) | — | Zod behaviour proved by a probe against the repo's own 4.6.2; PostgreSQL and OWASP facts read from their sites |

**Missing dependencies with no fallback:** none. **With fallback:** disk space (clean caches before the e2e plan).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit, contracts, web components), pgTAP via Supabase CLI 2.117.0, API integration (Vitest against the live local stack), Playwright 1.63.0 |
| Config file | per-package `vitest.config.ts` (Vitest 5 does not walk up); `apps/web/playwright.config.ts`; pgTAP files in `supabase/tests/` |
| Quick run command | `pnpm --filter @rede-social/contracts test` · `pnpm --filter @rede-social/core test` · `pnpm --filter @rede-social/api test` (unit only: `vitest run tests/unit`) · `pnpm --filter @rede-social/web test` |
| Full suite command | `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`; then `pnpm supabase test db`; then `pnpm test:integration`; web e2e via `pnpm e2e` (heavy) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PFORM-01 | key appended, CHECK widened, defaults, off hides routes | unit + pgTAP + integration | `pnpm --filter @rede-social/contracts test` (platform.test.ts); `pnpm --filter @rede-social/api exec vitest run tests/unit/registry.test.ts`; pgTAP 220 | ❌ Wave 0 (new cases) |
| PFORM-02 | builder CRUD, order, limits, roles | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/profile-form-admin.test.ts` | ❌ Wave 0 |
| PFORM-03 | archive/reactivate/delete, FK RESTRICT | pgTAP + integration | `pnpm supabase test db` (220) + above | ❌ Wave 0 |
| PFORM-04 | 13 validators | unit | `pnpm --filter @rede-social/contracts test` (profile-form.test.ts) | ❌ Wave 0 |
| PFORM-05 | type list == CHECK list | unit + pgTAP | contracts test + 220 | ❌ Wave 0 |
| PFORM-06 | options/Outro | unit + integration | contracts + member integration | ❌ Wave 0 |
| PFORM-07 | save validation, atomic, keyed errors | integration | `... exec vitest run tests/integration/profile-form-member.test.ts` | ❌ Wave 0 |
| PFORM-08 | two-tenant negatives, inventory | pgTAP + integration + unit | 220; `tests/integration/isolation.test.ts`; `tests/unit/isolation-inventory.test.ts` | partial (isolation files exist, new cases ❌) |
| PFORM-09 | computed completeness | pgTAP + integration | 220 + member integration | ❌ Wave 0 |
| PFORM-10 | gate in requireAuth | unit + integration | `pnpm --filter @rede-social/core exec vitest run tests/require-auth-form.test.ts`; `tests/integration/profile-form-gate.test.ts` | ❌ Wave 0 (mould: `require-auth-cut.test.ts`, `payments-cut.test.ts`) |
| PFORM-11 | exemptions, release, precedence, allow-list | unit + integration | same two files | ❌ Wave 0 |
| PFORM-12 | bootstrap block, redirects, counters/LiveShell | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/bootstrap.test.ts components/shell/LiveShell.pending.test.ts app/api/me/counters/route.test.ts`; Playwright `profile-form-gate.spec.ts` | files exist (extend) + ❌ spec |
| PFORM-13 | entry paths | e2e + integration | Playwright `profile-form-member.spec.ts`; integration | ❌ Wave 0 |
| PFORM-14 | one screen, 409 keeps typed answers | web unit + e2e | component test + spec | ❌ Wave 0 |
| PFORM-15 | `next` validation | web unit | `pnpm --filter @rede-social/web exec vitest run lib/safe-next-path.test.ts` | ❌ Wave 0 (mould `continue-path.test.ts`) |
| PFORM-16 | optional notice, server dismissal | integration + web unit | member integration + component test | ❌ Wave 0 |
| PFORM-17 | locks, ratchet, replace | pgTAP + integration | 220 + admin integration | ❌ Wave 0 |
| PFORM-18 | privacy, public-flagged read, strict payload | pgTAP + integration | 220 + `tests/integration/profile-form-answers.test.ts` | ❌ Wave 0 |
| PFORM-19 | staff read | integration + web unit | same | ❌ Wave 0 |
| PFORM-20 | Minhas respostas | web unit + e2e | component test + spec | ❌ Wave 0 |
| PFORM-21 | CSV, neutralisation, log row | unit + integration | `pnpm --filter @rede-social/core exec vitest run tests/profile-form-csv.test.ts`; admin integration | ❌ Wave 0 |
| PFORM-22 | cascade, LGPD warning | pgTAP + web unit | 220 + catalog test | ❌ Wave 0 |
| PFORM-23 | aggregates only, impact | integration | admin integration | ❌ Wave 0 |
| PFORM-24 | concurrency | integration (two connections) | `tests/integration/profile-form-concurrency.test.ts` | ❌ Wave 0 |
| PFORM-25 | fan-out, expand-only, hold-out | integration | `tests/integration/migrate-all.test.ts`, `schema-gate.test.ts`, `two-database-routing.test.ts` (extend) | files exist (extend) |
| PFORM-26 | pt-BR, 44px, 320/390, sketch gate | web unit + Playwright + script | `bash scripts/check-ui-literals.sh`; `pnpm check:static-routes`; specs; `grep -q '^approved: true' .planning/sketches/016-phase-12-designed-screens/README.md` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the package's unit command above (seconds); for SQL tasks the single pgTAP file (or the whole `pnpm supabase test db` if A4 fails).
- **Per wave merge:** `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`, then `pnpm supabase test db`, then the new integration files one by one with `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>`; run `pnpm lint` (includes `check-ui-literals.sh`) and `pnpm check:static-routes` when web routes change.
- **Phase gate:** pgTAP, then full `pnpm test:integration` after `pnpm db:reset && pnpm db:seed`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, the new Playwright specs under a disk watchdog, then `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `packages/contracts/src/profile-form.ts` + `packages/contracts/tests/profile-form.test.ts` (validators, type list, limits, issue codes)
- [ ] `supabase/tests/220-profile-form.sql` (shape, CHECKs, FK RESTRICT, policies x two tenants, function, trigger, cascade, hardening: `revoke ... from public`, grants)
- [ ] Update `010-rls-coverage.sql`/`040` only if assertions list tables (they are catalogue-driven, expect no edit; verify)
- [ ] `packages/core/tests/require-auth-form.test.ts`, extend `membership-pick.test.ts` fixtures
- [ ] `apps/api/tests/integration/profile-form-{admin,member,gate,answers,concurrency}.test.ts` + `withProfileForm` helper in `setup.ts`
- [ ] New cases in `isolation.test.ts` and entries in `apps/api/tests/isolation-inventory.ts` for every new route (the unit test fails until each has a real `it(` title)
- [ ] `apps/api/tests/admin-lane-inventory/profile-form.ts` entry for the export site
- [ ] `apps/api/tests/unit/registry.test.ts` cases (permissions admin-only by construction, defaults list, module count), `module-readmes.test.ts` satisfied by `packages/modules/profile-form/README.md` with the fixed headings
- [ ] `apps/web/e2e/profile-form-{gate,member,admin}.spec.ts` + `affected-map.json` rows + `scripts/check-static-routes.sh` entries for `/(auth)/completar-perfil/page` and `/(app)/configuracoes/formulario-de-perfil/page`
- [ ] Sketch `016` (MANIFEST row `pending`, README with the approval frontmatter pasted by the user)
- [ ] Framework install: none

## Security Domain

`security_enforcement` is enabled (absent = enabled; `security_asvs_level: 1` in config).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | existing Supabase Auth / JWKS |
| V3 Session Management | yes (gate must not revoke the session) | D-581/D-498: no session writes; "Sair" via Supabase |
| V4 Access Control | yes | RLS self/staff/public policies, `requirePermission('profile_form.manage' | 'profile_form.read')`, role `member` only for write, composite FK, single indistinguishable 404 |
| V5 Input Validation | yes | Zod discriminated per-type validators, `z.httpUrl()` (blocks `javascript:`), `z.iso.date()`, server derives the validator from the stored question, size CHECKs |
| V6 Cryptography | no new | n/a |
| V8 Data Protection | yes (personal data) | answers never logged or placed in URLs/toasts/storage; export is `admin_tenant` only, `no-store`, logged; cascade deletion; pino redaction |
| V12/V13 API | yes | strict response payloads, limits (30 questions, 20 options, caps) bound request size |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read/write of questions or answers | Information disclosure / Tampering | RLS + composite FK + membership leg in the insert policy + two-tenant tests + isolation inventory |
| Private answer made public silently | Information disclosure | PU-1 ratchet in service and trigger; public policy also requires `archived_at is null` |
| Another member's answer via the public route | Information disclosure | strict payload, public rows only, same 404 for every miss, target must be an active `member` |
| Stored XSS via question title, option label, answer, tenant name | Tampering | React text only; link answers rendered only for `http(s)`, `rel="noopener noreferrer nofollow ugc"` |
| CSV formula injection | Tampering | neutralise `= + - @ \t \r \n` (and full-width) on every cell including headers |
| Open redirect through `next` | Spoofing | validate at use on the web server; same-origin relative only; never echoed |
| Gate bypass by hitting an allowed path | Elevation of privilege | allow-list is exact paths, trailing slash stripped; the allowed routes only read the caller's own form / write the caller's own answers |
| IDOR on `membershipId` / `questionId` | Elevation of privilege | ids resolved inside the caller's tenant; unknown and foreign ids are indistinguishable |
| Race between lock rules and answers | Tampering | advisory lock + `FOR UPDATE` first in admin edits, `FOR SHARE` in saves, trigger backstop |
| Oversized payloads / DoS | Denial of service | limits in contracts and CHECKs; at most 30 answers per save; body size cap on the route |
| Export used to exfiltrate | Information disclosure | `admin_tenant` only, audit row before the first byte, `Cache-Control: no-store`, attachment |

## Existing-Code Map (answer to ask 4)

**Touch (gate and contracts)**
- `packages/core/server/auth/require-auth.ts` (new allow-list + refusal after line 196), `packages/core/server/tenancy/membership.ts` (`Membership` at line 27, `Row` with `access_state` at line 48, calls at lines 95 and 113 move to the `_gate` twins), `supabase/migrations/20261020225255_access_gate_functions.sql` (read only: pattern; do not edit, applied migrations are forward-only).
- `packages/contracts/src/errors.ts` (`ERROR_CODES`), `packages/core/server/http/api-error.ts` (`ERROR_MESSAGES`), `packages/contracts/src/modules.ts` (key appended, doc comment "twelve since Phase 12"), `packages/contracts/src/bootstrap.ts` (additive `profileForm` block, `.optional()`/`.default(...)` per the file's own rule "Every future ADDITIVE bootstrap field follows this rule"), `packages/contracts/src/moderation.ts`, `packages/contracts/package.json` (new `./profile-form` export).
- `apps/api/src/routes/me.ts` (bootstrap adds the block; 3 member routes), `apps/api/src/routes/members.ts` (public/staff answers), `apps/api/src/app.ts` (mount `/v1/profile_form`), `apps/api/src/modules/registry.ts` (`MODULE_REGISTRY` entry, import), `apps/api/package.json` and `apps/web/package.json` (workspace dependency), `pnpm-lock.yaml`.
- `packages/core/db/schema/index.ts` (+2 exports), `packages/core/db/schema/member-profiles.ts` (+1 column), `packages/core/db/schema/moderation-log.ts` (CHECK list).
- `biome.json` (admin-lane import allow-list gains `packages/core/server/profile-form/**`), `apps/api/tests/admin-lane-inventory/`.

**Touch (web)**
- `apps/web/lib/bootstrap.ts` (`bootstrapRedirectPath` case; `requireBootstrap` pending redirect with `x-rede-path`), `apps/web/proxy.ts` (forward the header, `proxy.test.ts`), `apps/web/app/api/me/counters/route.ts` (`REFUSAL_FLOWS`), `apps/web/components/shell/LiveShell.tsx` (+ `LiveShell.pending.test.ts` mould), `apps/web/app/(auth)/assinatura-pendente/page.tsx` (the gate-screen template: `(auth)` group, `LogoutForm`, `EmptyState`, `?t=` fallback).
- `apps/web/app/(app)/perfil/page.tsx` (notice under `ProfileCompletenessCard` at the `completeness.done < completeness.total` block, then `ProfileSection id="respostas"` before `ProfileActivity`), `apps/web/components/profile/ProfileCompletenessCard.tsx` (mould for the notice), `apps/web/app/(app)/membros/[membershipId]/page.tsx` (public/staff block in its own `Suspense`), `apps/web/lib/profile.ts` (loaders mould).
- `apps/web/app/(app)/configuracoes/page.tsx` (new `Row` in the "Administração" group, flag `canManageProfileForm` like `canManagePayments` at lines 134-149, 204-211), `apps/web/app/(app)/configuracoes/pagamentos/{page,PaymentsTabs,tabs,actions,loading}.tsx` (hub mould), `apps/web/app/(app)/configuracoes/regras/` (editor frame), `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx` + `apps/web/components/platform/ModuleToggles.tsx` (`extras.profile_form.confirmDisable`, `iconFor` gains `clipboard-list`), `apps/web/messages/pt-BR/` (new `profileForm.json`, `platform.profile_form.json`), `scripts/check-static-routes.sh`, `apps/web/e2e/affected-map.json`.
- Moderation: `apps/web/components/admin/ModerationLogRow.tsx`, `apps/web/lib/moderation-view.ts`.

**Imitate (do not edit)**: `packages/modules/payments/*` (module package shape, guard chain, README), `packages/core/server/payments/{gate,status,setup}.ts` (kernel service + advisory lock), `packages/core/server/tenancy/admin-members.ts` (admin-lane e-mail read, keyset cursor via `../paging`), `packages/core/server/profiles/service.ts` (`dismissNudge` idempotent coalesce), `packages/modules/store/db/schema.ts` (`TENANT_ADMIN` policy fragment), `apps/web/lib/continue-path.ts` (redirect-path rule), `apps/api/tests/integration/payments-cut.test.ts` + `packages/core/tests/require-auth-cut.test.ts` (gate test moulds), `supabase/tests/205-payments-tables.sql` (pgTAP shape), `supabase/migrations/20261019202758_social_module_key.sql` (CHECK-widening migration), `supabase/migrations/20261019225153_moderation_post_removed.sql`.

**Contradictions or gaps with locked decisions (flag, do not relitigate)**
1. ROADMAP SC2 still reads "answers it as part of creating the account, before reaching the app"; D-580 puts it right after the first login with sign-up unchanged. Reword SC2 to the outcome ("before reaching the app on the first login").
2. ROADMAP SC1 says "removes questions"; D-588 means archive (with hard delete only for a never-answered question, PU-3). Reword.
3. D-581 lists "sign-out" among what the API still allows; sign-out never touches the API (Supabase Auth through a server action), so no allow-list entry exists or is needed. Not a conflict in effect.
4. UI-D-587 (save as a no-op when the module is off) and UI-D-588 (empty state) contradict the repo convention "module routes answer 404 `MODULE_DISABLED`" if the member routes were mounted behind `requireModule`; resolved by keeping them kernel routes without it.
5. `moderation_log` cannot represent a tenant-level action (target membership NOT NULL; fixed action CHECK): D-595 needs the widening above; not stated in CONTEXT.
6. REQUIREMENTS `V2-PLAT-08` ("First-login profile completion nudge") is partly superseded; annotate it when the PFORM rows are added.
7. The ROADMAP "Requirements" line is "TBD (new PFORM-*)"; the spec-less probe guard only skips on a bare `TBD`, so feed the table above to the edge probe (memory `specless-probe-tbd-requirements`).

## Risks (answer to ask 6)

| Risk | Mitigation |
|------|------------|
| Two admins editing | `revision` optimistic lock (409) + per-tenant advisory lock on every admin write |
| Member saves while the admin changes the form | `FOR SHARE` on active questions, `formEtag` 409 with the fresh list, server validates against the current definition |
| Answer-vs-version race at save | same transaction as the validation; unknown/archived question id -> keyed error, never an orphan row |
| Hot-path cost | measured 0.05 ms (complete member) / 0.005 ms (module off); bounded by 30 required questions; partial and unique indexes |
| Summary / impact queries on a big tenant | set-based anti-join of `member`-role memberships against required questions; admin-only, once per page load; add `EXPLAIN` on a 20k-member fixture in the plan |
| LGPD | cascade on membership and user; builder warning; no purpose field (D-594); answers excluded from logs/URLs; export audited |
| CSV injection and PII leak | neutraliser on every cell, admin-only, audit row first, `no-store` |
| Idempotent migration on existing tenants | additive DDL only; `ADD COLUMN` nullable; CHECK widening drop+add (tiny table); functions `create or replace`; ledger + advisory lock in the runner; no backfill; old `_gated` kept for rollback |
| Rolled-back API against a newer schema | harmless: old API calls old functions; new tables unused; `isBehind` never holds out a project that is ahead |
| Test-data and seed impact | none while the module stays off in the seed; new suites create their own tenant state and clean by prefix; update hard-coded module counts (Pitfall 8) |
| Disk at 99% | clean caches before gates; e2e under a watchdog |

## Verified In-Repo Facts

Every discrete in-repo value the examples above rely on, quoted verbatim from files opened this session (the quote is what makes the tag checkable; a value not in this list is `[ASSUMED]`).

- **Module list** [VERIFIED: packages/contracts/src/modules.ts:9-21]: `export const TOGGLEABLE_MODULES = [` ... `'social',` `'payments',` `] as const;` (eleven keys, `'feed','communities','stories','events','chat','notifications','reels','store','courses','social','payments'`); the doc says "`tenant_modules_key_chk` is GENERATED from this list in this order, so a new key is appended LAST and ships with the migration that widens the CHECK." Key is built by `TOGGLEABLE_MODULES.map((key) => \`'${key}'\`).join(',')` in `packages/core/db/schema/tenant-modules.ts`.
- **Payment allow-list** [VERIFIED: packages/core/server/auth/require-auth.ts:106]: `export const CUT_ALLOWED_PATHS = new Set(['/v1/me/subscription']);` and the cut refusal [VERIFIED: require-auth.ts:194-196]: `if (membership.accessState === 'cut' && !CUT_ALLOWED_PATHS.has(c.req.path.replace(/\/+$/, ''))) {` `throw new ApiError(403, 'SUBSCRIPTION_PENDING', { tenantName: membership.tenantDisplayName });`. The bootstrap is NOT in it (only in `INVITED_ALLOWED_PATHS`, lines 95-99: `'/v1/me/bootstrap', '/v1/me/invite', '/v1/me/accept-invite'`).
- **Membership type and calls** [VERIFIED: packages/core/server/tenancy/membership.ts:27-38,48,95,113]: `export type Membership = {` ... `accessState: AccessState;` ; `access_state: string;` in `Row`; `from app.membership_in_tenant_gated(${userId}::uuid, ${tenantId}::uuid)`; `from app.memberships_of_user_gated(${userId}::uuid)`.
- **The `_gated` twin's columns** [VERIFIED: supabase/migrations/20261020225255_access_gate_functions.sql:139-162]: `returns table (tenant_id uuid, tenant_slug text, tenant_display_name text, role text, status text, tenant_status text, access_state text)` with `app.access_state(m.tenant_id, m.user_id)`; grants `grant execute on function app.membership_in_tenant_gated(uuid, uuid) to api_user;` (line 203). Release rule [VERIFIED: same file, header lines 48-51]: "Expand-only: seven new functions and a privilege revoke ... `app.membership_in_tenant` and `app.memberships_of_user` are NOT touched, so the API revision still serving during `supabase db push` keeps working".
- **Error codes** [VERIFIED: packages/contracts/src/errors.ts:43]: `'SUBSCRIPTION_PENDING',`; message map [VERIFIED: packages/core/server/http/api-error.ts:24]: `SUBSCRIPTION_PENDING: 'Sua assinatura não está ativa.',` inside `export const ERROR_MESSAGES: Record<ErrorCode, string>`.
- **Counters BFF** [VERIFIED: apps/web/app/api/me/counters/route.ts:37]: `const REFUSAL_FLOWS = ['MEMBERSHIP_BLOCKED', 'SUBSCRIPTION_PENDING'] as const;`.
- **Bootstrap redirect map** [VERIFIED: apps/web/lib/bootstrap.ts:111-137]: `export function bootstrapRedirectPath(error: ApiClientError): string | null {` with `case 'SUBSCRIPTION_PENDING': return \`/assinatura-pendente?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}\`;`; and the accept-invite precedent for a page that must not call `requireBootstrap` [VERIFIED: bootstrap.ts:146-149 `acceptInviteRedirectPath`].
- **Bootstrap additive rule** [VERIFIED: packages/contracts/src/bootstrap.ts:73]: "The API still always sends it. Every future ADDITIVE bootstrap field follows this rule: `.default(...)` or `.optional()`, never required."
- **moderation_log constraints** [VERIFIED: packages/core/db/schema/moderation-log.ts:57,59,86]: `actorMembershipId: uuid('actor_membership_id').notNull(),` `targetMembershipId: uuid('target_membership_id').notNull(),` and the CHECK `'moderation_log_action_chk'`; list [VERIFIED: packages/contracts/src/moderation.ts:29-35]: `export const MODERATION_ACTIONS = [ 'comment_removed', 'member_blocked', 'member_unblocked', 'role_changed', 'post_removed', ] as const;`. Precedent migration: `supabase/migrations/20261019225153_moderation_post_removed.sql` (DROP + ADD of the two CHECKs).
- **Sign-out does not call the API** [VERIFIED: apps/web/app/(app)/actions.ts:18-29]: `export async function logout(): Promise<void> {` ... `await supabase.auth.signOut({ scope: 'local' })`; the push-forget bound [VERIFIED: apps/web/components/shell/LogoutForm.tsx:11]: "bounded to 2 s (`useLogoutSubmit`), so a dead network never blocks logging out (T-07-48)".
- **Held-out schema** [VERIFIED: packages/core/server/migrations/required.ts:12]: "A project whose applied schema is BELOW it is held out (`updating`) until the fan-out catches it up".
- **Move engine coverage** [VERIFIED: packages/core/server/projects/move/plan.ts:33-34]: "Anything with a `tenant_id` column that is NOT listed here is copied."
- **Mount-path test** [VERIFIED: apps/api/tests/unit/mounts.test.ts:20]: `const mounted = app.routes.filter((route) => route.path.startsWith(\`/v1/${key}\`));`.
- **Hard-coded counts to update** [VERIFIED: packages/contracts/tests/platform.test.ts:61]: `expect(TOGGLEABLE_MODULES).toHaveLength(11);` and [VERIFIED: apps/api/tests/unit/registry.test.ts:242]: `[...REAL_TENANT_DEFAULT_MODULES, 'store', 'courses', 'social', 'payments'].sort(),`.
- **Admin-lane import allow-list** [VERIFIED: biome.json:36-41]: `"!packages/core/server/tenancy/**",` ... `"!packages/core/server/payments/**",` `"!packages/core/server/projects/**",`.
- **Latest pgTAP file** [VERIFIED: `ls supabase/tests` 2026-10-29]: `216-project-owner-token.sql` is the last; `220-profile-form.sql` is free. Latest tenant migration `20261026213816_feed_posts_deleted_community_gate.sql` (153 files in `supabase/migrations`).
- **Zod 4.6.2 features** [VERIFIED: probe in packages/contracts, 2026-10-29]: `typeof z.iso.date`, `z.httpUrl`, `z.email`, `z.discriminatedUnion`, `z.uuid` are all `function`; `z.iso.date().safeParse('2026-02-30').success === false`; `z.httpUrl().safeParse('javascript:alert(1)').success === false`; `z.httpUrl().safeParse('ftp://a.b').success === false`.

## Sources

### Primary (HIGH confidence)
- Repo files read in full this session: `packages/core/server/auth/require-auth.ts`, `packages/core/server/tenancy/membership.ts`, `supabase/migrations/20261020225255_access_gate_functions.sql`, `apps/api/src/routes/me.ts`, `apps/web/lib/bootstrap.ts`, `packages/contracts/src/{modules,bootstrap}.ts`, `packages/contracts/src/errors.ts`, `packages/core/db/schema/{member-profiles,tenant-modules,moderation-log}.ts`, `packages/modules/payments/{module.ts,server/routes.ts}`, `apps/api/src/modules/registry.ts`, `apps/web/app/(auth)/assinatura-pendente/page.tsx`, UI-SPEC and CONTEXT.
- Local measurement: psql EXPLAIN (ANALYZE, BUFFERS) on the local stack, 2026-10-29 (script in the session scratchpad `gate-bench.sql`, rolled back).
- Zod 4.6.2 behaviour probe run against `packages/contracts/node_modules/zod`, 2026-10-29.
- https://www.postgresql.org/docs/current/explicit-locking.html — row-level lock conflict table; `FOR SHARE` vs `FOR NO KEY UPDATE`; an ordinary UPDATE takes `FOR NO KEY UPDATE`.

### Secondary (MEDIUM confidence)
- https://community.owasp.org/attacks/CSV_Injection — trigger characters and the prefix mitigation (OWASP; page notes quote-based methods can fail after save/reopen in Excel).

### Tertiary (LOW confidence)
- Excel pt-BR delimiter/BOM behaviour and Cloud Run streamed-response cap: training knowledge, tagged A1/A2.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependency, all pinned versions read from the repo.
- Architecture (gate, data model, RLS): HIGH, based on read source and a local measurement; trigger-timing semantics MEDIUM (design independent of it).
- Pitfalls: HIGH for repo-derived ones (mount test, moderation_log constraints, allow-list, counters BFF), MEDIUM for Excel/Cloud Run.

**Research date:** 2026-10-29
**Valid until:** 2026-11-28 (stable internal patterns; re-check if 09.4 closing changes the lookup functions or the migration set layout)
