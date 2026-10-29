# Phase 12: Formulário de perfil do tenant - Context

**Gathered:** 2026-10-29
**Status:** Ready for planning

<domain>
## Phase Boundary

The tenant admin builds the profile form of their own community: a list of questions of several types, each marked required or optional. Members of that tenant answer it: new members right after their first login, existing members who never completed the profile, and members who had already completed it when the form is created or when a required question is added later. The admin reads the answers (per member and as a CSV export). A question can optionally show its answer on the member's public profile.

This phase delivers three things: the admin screens (a form builder under `/configuracoes`), the member screens (the completion screen and "Minhas respostas" on the profile), and the model and backend behind them (questions, answers, the completeness rule, the gate).

What this phase does NOT deliver: state/city and file/photo answer types (deferred), question sections or conditional questions, a push or notification when the form changes, filtering the member list by answer, anything in the "Rede social" phases 10-11.

</domain>

<decisions>
## Implementation Decisions

### Where and when the form appears
- **D-580:** A NEW member answers the form after login, on the same "complete your profile" screen an existing member uses. `/cadastro/[slug]` and `/participar` do not change: no answers travel in the sign-up or join body, so the e-mail verification step does not interfere and there is one mechanism for new and old members. — **Reversibility:** reversible — only the entry point of one screen.
- **D-581:** The form is a HARD GATE. While the member has an unanswered required question, the API refuses every route except the form's own routes, the bootstrap and sign-out with a new error code (name left to the planner; the model is `SUBSCRIPTION_PENDING`), and the web sends the member to the form screen through `bootstrapRedirectPath`. Nothing is written to `memberships.status`, the profile or any content, and the Supabase session is never revoked (same guarantees as the payment cut, D-498). "Sair" keeps working. — **Reversibility:** costly — the error code joins the published contracts and `requireAuth`, the hot path of every request.
- **D-582:** The member sees ALL active questions on ONE scrollable screen, required ones marked, with a single "Salvar" at the end. The same screen serves the first answer, the return after a form change, and later edits from the profile. No one-question-per-step flow, no sections. — **Reversibility:** reversible.
- **D-583:** After saving, the member goes where they were headed (a post or notification link they opened before the gate caught them); with no destination they land on `/inicio`. The destination must be a same-origin relative path validated on the server side of the web app, never an arbitrary URL (open-redirect risk). — **Reversibility:** reversible.
- **D-584:** The gate applies to the role `member` only. `admin_tenant`, `support_tenant` and `super_admin` are never gated and never asked, so the admin cannot lock themselves out of the builder. — **Reversibility:** reversible.

### When members are asked again
- **D-585:** Completeness is COMPUTED, never stored as a flag or a version counter: a member is complete when every ACTIVE REQUIRED question has a valid answer. Creating a required question (or turning an optional one into required, or reactivating an archived required one) reopens the form for every member who lacks an answer, and they answer only what is missing. Existing answers are kept. Making a required question optional, or archiving it, frees the members it was holding. This also covers members who completed the profile before the form existed. — **Reversibility:** costly — it fixes the shape of the answers table and of the gate query.
- **D-586:** A new OPTIONAL question never gates anyone. Members see a dismissible notice on their profile ("Há perguntas novas"), in the mold of `ProfileCompletenessCard` and `nudge_dismissed_at`: dismissal is server state, so a reinstall does not bring it back. Dismissal granularity (per question or per batch) is the planner's call. — **Reversibility:** reversible.
- **D-587:** Editing a question that already has answers: title and help text change freely. The TYPE and the OPTIONS that have answers are locked: the admin may ADD options, but changing the type or removing an answered option is done by creating a new question and archiving the old one. No answer is ever discarded or silently reinterpreted. — **Reversibility:** costly — answers are stored typed; loosening this later means migrating stored values.
- **D-588:** Removing a question ARCHIVES it. It leaves the form and stops being asked, but its answers are kept: visible to the admin in a list of archived questions and included in the CSV export. The admin can reactivate it (D-585 applies on reactivation). The builder offers no hard delete of a question that has answers. — **Reversibility:** costly — "kept" is a promise to members and to the export.
- **D-589:** Turning the module off, or archiving every required question, releases all members from the gate. Answers are kept untouched. — **Reversibility:** reversible.

### Question types
- **D-590:** The types that ship: short text, long text, dropdown, multiple choice (several answers), single choice (radio), number, date, phone (Brazilian mask and validation), e-mail, link (URL), yes/no, acceptance (a box that must be ticked to count as answered), and a 1 to 5 rating. Number and date accept a minimum and maximum set by the admin. — **Reversibility:** costly — each type is a validator in the shared contracts and a stored value shape.
- **D-591:** DEFERRED, not in this phase: state/city (needs the official municipality list) and file/photo answers (private upload). The model must accept a new type later WITHOUT rewriting the questions or answers tables: the answer value is stored typed and validated per type by a discriminated schema in `packages/contracts`, and the type list can grow by a small migration at most. — **Reversibility:** costly — this is the extensibility contract of the model.
- **D-592:** Dropdown, multiple choice and single choice support an "Outro" option, switched on PER QUESTION by the admin. The text the member types is stored with the answer. — **Reversibility:** reversible.

### Who sees the answers, privacy and operations
- **D-593:** By default an answer is readable by the member who gave it, by `admin_tenant` and by `support_tenant` of that tenant, and by nobody else. The admin may switch "mostrar no meu perfil" PER QUESTION; only then do other members of the same tenant see that answer on the member's profile, and the member sees a notice on that question in the form ("esta resposta aparece no seu perfil"). The answers table must NOT inherit `member_profiles_tenant_select` (tenant-wide read): its policies are self, staff, and public-flagged rows. A cross-tenant negative test covers every policy. — **Reversibility:** costly — RLS shape and an exposure promise to members.
- **D-594:** LGPD: the builder shows a short warning when a question is created ("peça só o que precisa; a comunidade responde por estes dados"). Answers hang off the membership and go away with it (`on delete cascade`, as `member_profiles` does), so an LGPD deletion needs no extra path. The platform does not block question titles or types and there is no per-question "finalidade" field. — **Reversibility:** reversible.
- **D-595:** The admin can export the answers as CSV, one row per member (name, e-mail, one column per question, archived questions included). Only `admin_tenant` can export and each export is written to the moderation log (`moderation_log` is immutable by design). The export must neutralise spreadsheet formula injection (cells beginning with `=`, `+`, `-`, `@` or a tab). — **Reversibility:** reversible.
- **D-596:** The form is a TOGGLEABLE MODULE, off by default. Its key is appended LAST to `TOGGLEABLE_MODULES` (the `tenant_modules_key_chk` CHECK is generated from that list and widens in the same migration), it is NOT in `REAL_TENANT_DEFAULT_MODULES`, no existing tenant gets a backfill row, and the `super_admin` turns it on per tenant in the platform panel, as `store`, `courses`, `social` and `payments`. Off hides the "Formulário de perfil" tab and releases the gate (D-589). Suggested key `profile_form`; the final name is the planner's. — **Reversibility:** one-way — the key lives in a CHECK constraint and in the published contracts, so renaming it later needs a migration.

### Claude's Discretion
- Limits: maximum questions per form, maximum options per choice question, character caps for text types.
- The exact error code and the API shape of the gate. HARD CONSTRAINT from `requireAuth`: the check must ride the SAME membership lookup, as the payment `_gated` SQL twins do, with no second round trip per request, and it must be cheap for a tenant with the module off or with no required question. Research must size this before planning.
- The builder's ergonomics: reorder, preview, duplicate a question, "how many have answered". The UI-SPEC and its sketch gate decide them.
- A question that has answers: the planner should freeze its "show on profile" switch the same way D-587 freezes the type (a private answer must not become public silently); flag it in the UI-SPEC for confirmation.
- Whether a question that was never answered may be hard-deleted.
- pt-BR copy of every screen, notice and error; where on the profile the public answers render.
- The final name of the module key and of the gate error code.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project and phase scope
- `.planning/ROADMAP.md` §Phase 12 — goal, six success criteria, UI hint, the eight points that were open before this discussion (all now decided in this file)
- `.planning/PROJECT.md` — constraints: modularity (MOD-01..05), tenant isolation with RLS, per-tenant database, pt-BR UI
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — `tenant_id` on every row, RLS on every table, profile data hangs off the membership

### The gate (how a member is held out of the app)
- `packages/core/server/auth/require-auth.ts` — order of refusals, `CUT_ALLOWED_PATHS`, the single membership lookup and its `_gated` SQL twins
- `apps/api/src/routes/me.ts` — `/me/bootstrap` and `/me/subscription` (the one route a cut member reaches)
- `apps/web/lib/bootstrap.ts` — `bootstrapRedirectPath`, the code-to-screen map
- `apps/web/app/(auth)/assinatura-pendente/page.tsx` — the existing gate screen, a page in the `(auth)` group with the host brand
- `packages/contracts/src/errors.ts` — the published error codes
- `.planning/phases/09.1-acesso-por-gateway-de-pagamento/09.1-CONTEXT.md` — D-491..D-499, the payment gate this phase mirrors (cut never writes membership status, never revokes the session)

### Profile model and sign-up
- `packages/core/db/schema/member-profiles.ts` — one row per membership, the asymmetric policies, why the profile hangs off the membership
- `packages/core/server/profiles/service.ts` — profile reads and writes
- `apps/web/lib/profile-activity-view.ts` — `profileCompleteness` today (photo, bio, Instagram)
- `apps/web/components/profile/ProfileCompletenessCard.tsx` and `apps/web/app/(app)/perfil/page.tsx` — the soft "Complete seu perfil" card and `nudge_dismissed_at`
- `packages/core/server/tenancy/signup.ts`, `packages/core/server/tenancy/join.ts` — the two doors that create a membership (unchanged by this phase, D-580)
- `apps/web/app/(auth)/participar/actions.ts` — join flow and `consent_records`

### Admin side and modules
- `apps/web/app/(app)/configuracoes/page.tsx` and `apps/web/app/(app)/configuracoes/regras` — the admin settings hub and the rules editor, the closest precedent for a tenant-authored editor
- `apps/web/app/(app)/configuracoes/membros` and `apps/web/app/(app)/membros/[membershipId]/page.tsx` — member list and a member's page, where the admin and other members read answers
- `packages/modules/dashboard/server/member-detail.ts` — the admin's per-member view (08.7, D-462: named lists readable by `admin_tenant` only)
- `packages/contracts/src/modules.ts` — `TOGGLEABLE_MODULES`, `REAL_TENANT_DEFAULT_MODULES` and how a key is appended
- `packages/modules/store/module.ts` and `apps/api/src/modules/registry.ts` — shape of a module manifest and its registration
- `packages/core/db/schema/moderation-log.ts` — the immutable log the CSV export writes to

### Design and per-tenant database
- `reference/frontend-design/` and `.planning/sketches/MANIFEST.md` — the prototype has no form-builder screen; UI-04 requires a UI-SPEC and a sketch gate in the prototype's language
- `.planning/phases/09.2-banco-por-tenant-projeto-supabase-dedicado-por-tenant/09.2-CONTEXT.md` — questions and answers live in each tenant's own database; migrations fan out to every project and the isolation suite runs on both lanes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bootstrapRedirectPath` (`apps/web/lib/bootstrap.ts`): add one code and one target screen; the redirect plumbing exists.
- `requireAuth` + `CUT_ALLOWED_PATHS`: the allow-list pattern for "the one route a gated member may reach".
- `ProfileCompletenessCard` and `member_profiles.nudge_dismissed_at`: the dismissible-notice pattern for D-586, server-side dismissal.
- `/configuracoes/*` pages and the rules editor: the layout, tab and action-toast conventions for a new admin tab.
- Module manifest (`defineModule`), registry and `tenant_modules`: the toggle, permission and navigation plumbing for D-596.
- `moderation_log`: where the CSV export is recorded.
- Zod schemas in `packages/contracts`: the home of the per-type answer validators (D-590, D-591).

### Established Patterns
- Profile data hangs off the membership, never off `users`; tenant-owned rows carry `tenant_id` first in every index and RLS on every table.
- A gate never mutates membership state and never revokes the session (D-498).
- A new toggleable module is appended last, off by default, no backfill row, turned on per tenant by the `super_admin` (STORE-01, COURSE-01, SOCIAL-01, D-501).
- Editing a tenant-authored text does NOT force re-acceptance today (rules, D-341). This phase deliberately differs: required questions DO reopen for everyone (D-585).
- All UI strings come from the pt-BR catalog; screens the prototype lacks go through a UI-SPEC and a sketch gate (UI-04).

### Integration Points
- `requireAuth` (every request): the gate check, subject to the no-second-round-trip constraint in Claude's Discretion.
- `/me/bootstrap`: tells the web whether the form is pending, so the redirect needs no extra call.
- `/perfil` and `/membros/[membershipId]`: where "Minhas respostas", the dismissible notice and the public answers render.
- `/configuracoes`: the new "Formulário de perfil" tab (builder, archived questions, CSV export).
- Platform panel module switches: the new key joins the per-tenant toggles.
- Migrations: central schema is unaffected; the tenant schema gains the questions and answers tables and fans out to every tenant project (Phases 09.2 and 09.4).

</code_context>

<specifics>
## Specific Ideas

- Igor's wording of the product: the admin creates "esse formulário inicial" in the tenant admin panel; a member who already completed the profile "com o que tem hoje" is shown the form again when the admin creates it. Today's "completed" is the soft card (photo, bio, Instagram), not a stored state, so D-585 treats every member as needing the form's required answers regardless of the old card.
- Question types Igor named: short text, long text, dropdown, multiple choice, radio option, "e qualquer outra mais que você me sugerir" (D-590 and D-591 settle which extras ship).
- Style of the screens: mobile-first in the prototype's language (Manrope, light ground, white cards, 12px radii, 44px touch targets, the tenant's brand as the single accent), pt-BR only.

</specifics>

<deferred>
## Deferred Ideas

- State/city question type backed by the official municipality list.
- File or photo as an answer type (private upload through the media pipeline).
- Question sections (grouping) and conditional questions ("show B only if A = X").
- Notifying members (notification center or Web Push) when the admin creates or changes the form; for now they discover it on the next app open, where the gate catches them.
- Filtering the member list by answer, and feeding answers into the 08.7 reports.
- A per-question "finalidade" (purpose) field shown to the member.

</deferred>

---

*Phase: 12-formulario-de-perfil-do-tenant*
*Context gathered: 2026-10-29*
