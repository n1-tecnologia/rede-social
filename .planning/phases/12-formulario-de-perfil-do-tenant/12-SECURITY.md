---
phase: "12"
slug: "formulario-de-perfil-do-tenant"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-10-30"
---

# Phase 12 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register = the 18 PLAN `<threat_model>` tables: 40 threats, T-12-01..T-12-40 (25 high, 14 medium, 1 low), every disposition `mitigate`. Verified read-only by `gsd-security-auditor` against HEAD e97b5990 on 2026-10-30: the code at every cited location, the live local database catalog (policies, grants, foreign keys, triggers, function ACLs), and the targeted unit suites named below (all green). **39 closed, 1 open (T-12-02, medium, non-blocking under `block_on: high`), 0 open at or above `high`.**

What the auditor did NOT run, so no result is claimed for it: pgTAP `supabase/tests/220-profile-form.sql`, the API integration suites, Playwright. For the database-level threats the mitigation was confirmed in the live catalog and the SQL source, and the pgTAP or integration test that pins it is listed as "pinned by (not run by the auditor)". The agent Playwright run of 2026-10-30 (20 passed, `12-UAT.md` row 8) is recorded in the UAT, not here.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser to Next `proxy.ts` | The `next` query and the `x-rede-path` request header. The proxy deletes any inbound copy of the header and sets its own; every use goes through `safeNextPath`. | A destination path (untrusted until validated) |
| Browser to web BFF handlers and server actions | `/api/profile-form/export`, `/api/me/counters`, `completar-perfil/actions.ts`, the builder `actions.ts`: same-origin check and a verified session; the export body is passed through unread. | Session cookie, answers, the CSV stream |
| Web to API | Bearer token and `x-tenant-host`: the host selects the tenant, `requireAuth` takes the membership of record, then the profile-form gate (`PROFILE_FORM_PENDING`, exact allowed paths), then `requireModule` and `requirePermission('profile_form.manage')` per route. | Tenant identity, role, answers |
| API to Postgres, tenant lane versus admin lane | Tenant lane: `set local role authenticated` plus claims, RLS, explicit `tenant_id`. Admin lane (service role, RLS off): the export page reads rely only on `tenant_id = ctx.tenantId`. | Questions, answers, member e-mails and names (export) |
| SECURITY DEFINER boundary | `app.profile_form_missing(_self)`, the `_gate` twins, `profile_form_lock_active()`, `profile_form_question_guard()`, each with its own per-role ACL. | Tenant-scoped completeness and lock state |
| Member-authored content | `parseAnswer` to jsonb (4096-byte CHECK) to RLS and aggregate-only admin reads, then React-text rendering to other members and staff, then CSV with formula neutralisation into the admin's spreadsheet application. | Free text, links, phone numbers, numbers, dates |
| Audit and log | An append-only `moderation_log` row committed before the first export byte; pino redaction of `answers`; `redactDbError` logs only the SQLSTATE and the constraint name. | Who exported, when; no values |
| Operator and release | The super admin switches the module per tenant (off by default, no backfill); `migrateAll`, then API and worker, then web; the schema gate holds a behind project out as `updating`. | Module flag, migrations |
| Process | The design-gate approval (agent-recorded, provisional) and the e2e harness's module-row baseline. | A sketch approval; a module row |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-12-01 | Tampering | sketch mockup reaching the bundle | low | mitigate | `git grep "016-phase-12-designed-screens" -- apps packages` has no match; the sketch has one inline script (theme toggles) and no fetch, XHR or external URL | closed |
| T-12-02 | Repudiation | gate approval written by the agent | medium | mitigate | Satisfied: plans 11 to 18 carry the `approved: true` precondition, the README reads `approved: true`, the record states its provenance (`approved_by: "Igor (recorded by Claude on Igor's instruction)"`, `approval_kind: provisional`, commit e1dc26c2). NOT satisfied: the approval was authored by the orchestrator from a chat instruction, not pasted by Igor, and the only trace of the instruction is chat history. Design questions (a) to (f) were never answered. To close: Igor edits the five README frontmatter values himself (UAT row 11), or Igor accepts the risk and it is logged below. Impact if left: design-process repudiation only; it gates UI coding, not data access | open — below high threshold (non-blocking) |
| T-12-03 | Elevation of privilege | `profile_form.manage` composed for a role other than `admin_tenant` | high | mitigate | `packages/modules/profile-form/module.ts:25-28` (manage for `admin_tenant` only, read for admin and support); run: `apps/api/tests/unit/registry.test.ts` case 22 (3 roles, module on and off, a generous-managers setting) and the manifest test | closed |
| T-12-04 | Tampering | the key defaulting on or backfilled for existing tenants | medium | mitigate | `REAL_TENANT_DEFAULT_MODULES` excludes it (`packages/contracts/src/modules.ts:41-49`); migration 20261029230924 only drops and re-adds the CHECK; the live `tenant_modules` has 0 `profile_form` rows; pinned by pgTAP 220 (not run by the auditor) | closed |
| T-12-05 | Tampering | `parseAnswer` accepting a value the stored type forbids (a `javascript:` link, a DDD 01 phone, an out-of-range number, an option id of another question) | high | mitigate | `parseAnswer` is built from the stored definition only (`packages/contracts/src/profile-form.ts:154-305`: `z.httpUrl()`, control-character refusal, DDD and digit rules, safe-integer range, `unknown_option`); `member.ts:136,316` builds the definition from the DB row; run: contracts tests. See the `parseLink` gap under residual findings | closed |
| T-12-06 | Information disclosure | `profile_form_answers` read by other members or another tenant | high | mitigate | Live `pg_policies` on `profile_form_answers`: self, staff and public select plus per-operation insert, update and delete, all `tenant_id = app.tenant_id()`; composite FK `(tenant_id, question_id)`; RLS on; `anon` has no grants; TRUNCATE revoked from `authenticated`; SQL 20261029232606:64-83 and 20261029233037:45-47 | closed |
| T-12-07 | Tampering | an answer written for another member or another tenant's question | high | mitigate | Insert and update `with check` tie tenant, `user_id = app.user_id()`, role member and a live membership of the same tenant and user (20261029232606:71-78); composite FK 23503; pinned by pgTAP 220 :413-428,:504 (not run by the auditor) | closed |
| T-12-08 | Information disclosure | `app.profile_form_missing` probing another member's pending state | medium | mitigate | Live ACL: the function and both `_gate` twins are not executable by `authenticated` or `anon`; `profile_form_missing_self()` derives the membership from the claims (20261029233037:88-101); pinned by pgTAP 220 :841-844 (not run by the auditor) | closed |
| T-12-09 | Tampering | a type, option, visibility or limit edit that reinterprets or exposes stored answers | high | mitigate | Live trigger `profile_form_questions_guard` enabled, FK `question_fk` RESTRICT; PF001 to PF005 raised in 20261029233037:157-260; pinned by pgTAP 220 :733-793 (not run by the auditor) | closed |
| T-12-10 | Denial of service | the gate rule slowing every request | medium | mitigate | One short-circuiting `case` (20261029233037:49-86), the partial index `profile_form_questions_required_idx`, a unique probe index (live schema). The "under 5 ms on 20,000 members" figure rests on 12-04-SUMMARY and was not reproduced read-only | closed (structure) |
| T-12-11 | Elevation of privilege | gate bypass by hitting an allowed path variant or a sibling route | high | mitigate | `require-auth.ts:115-119,219-225`: exact-path Set after trailing-slash stripping; run: `require-auth-form.test.ts` case 2 (`/answers/x`, `/profile-form-x`, `/counters`, `/profile`, `/feed` refused) | closed |
| T-12-12 | Denial of service | the gate adding a second query or an unbounded scan to every request | medium | mitigate | `membership.ts:114-117,133-136`: the count rides the one lookup statement; run: `require-auth-form.test.ts` case 4 (one `execute` each) | closed |
| T-12-13 | Repudiation / Tampering | the gate silently changing membership state or killing the session | high | mitigate | `require-auth.ts:219-225` throws `ApiError` before `c.set('ctx')` (:227); pinned by integration `profile-form-gate.test.ts:348` (not run by the auditor) | closed |
| T-12-14 | Tampering | an answer written to a foreign, archived or unknown question, or with a value the stored type forbids | high | mitigate | `member.ts:290-369`: tenant lane, `lockActiveQuestions` takes the tenant from the claims, an unknown or archived id gives `unknown_question`, explicit `tenant_id` on insert and delete, `parseAnswer(def)`; live composite FK as the floor; integration `profile-form-member.test.ts` (not run by the auditor) | closed |
| T-12-15 | Information disclosure | answers echoed in logs, errors or URLs | medium | mitigate | `me.ts:457-466` logs ids and the key count only; `logging.ts:44` censors `answers`; `logging.ts:140-165` `redactDbError` logs SQLSTATE and constraint only; `openapi.ts:12-20` validation errors carry path and message only; run: `logging-redact.test.ts` | closed |
| T-12-16 | Tampering | a save racing an admin edit leaving an answer that violates a lock | high | mitigate | `member.ts:167-173,295-302`: `app.profile_form_lock_active()` (live: definer, `for share of q`, canonical order) then the stale-etag 409 `form_changed`; trigger backstop live; `profile-form-concurrency.test.ts` (12 cases, not run by the auditor) | closed |
| T-12-17 | Information disclosure | a private or archived answer returned to another member | high | mitigate | `answers.ts:92-123`: explicit `a.tenant_id`, target membership, `q.show_on_profile`, `q.archived_at is null`, an active member-role target; RLS public select (live) as the floor; explicit field mapping; `members.ts:161-190` role picks the payload | closed |
| T-12-18 | Information disclosure | the route used to probe which memberships exist, are blocked or are staff | medium | mitigate | `answers.ts:62-73,96-101,139` every miss returns `null`; `members.ts:177-178` one bare `ApiError(404,'NOT_FOUND')`; byte-identical test `profile-form-answers.test.ts:200` (not run by the auditor) | closed |
| T-12-19 | Elevation of privilege | a non-admin (support, member, another tenant's admin) building or editing the form | high | mitigate | `routes.ts`: 12 `createRoute` blocks, each with `requireModule('profile_form')` and a literal `requirePermission('profile_form.manage')`; `requirePermission` fails closed; live RLS insert, update and delete are `admin_tenant` only; every service starts with `requireModuleOn` (a live re-check) | closed |
| T-12-20 | Tampering | an edit that reinterprets or exposes stored answers (type change, option relabel or removal, private to public, narrowed limit) | high | mitigate | `lock-rules.ts:63-88` `checkLocks` first (`admin.ts:451-458`), the trigger backstop mapped by `guardIssueOf` (`admin.ts:472-477`); run: `profile-form-lock-rules.test.ts`; race test `profile-form-admin.test.ts:934` (not run by the auditor) | closed |
| T-12-21 | Tampering | lost update between two admins, or a count raced past the 30-question limit | medium | mitigate | `admin.ts:50-53` per-tenant advisory lock in all 7 writes, `body.revision !== row.revision` gives `stale_revision` (:443), canonical `order by position, created_at, id for update` (:516-521) | closed |
| T-12-22 | Tampering | deleting or orphaning answers through delete, replace or archive | high | mitigate | `admin.ts:670-696` `has_answers` and the 23503 mapping; live RESTRICT FK; replace is one `withTenantTx` (:705-726); no function in `admin.ts` writes an answer row | closed |
| T-12-23 | Information disclosure | summary, impact and archived list exposing an individual answer or another tenant's counts | medium | mitigate | `admin.ts:90-131,134-159` counts only, no `value` selected; every statement carries `tenant_id`; foreign ids give a bare 404 (`readOne` :177-196); key lists pinned in `profile-form-lifecycle.test.ts` (not run by the auditor) | closed |
| T-12-24 | Tampering | CSV formula injection through a name, title or answer | high | mitigate | `csv.ts:33,45-51` `TRIGGER = /^[=+\-@\t\r\n＝＋－＠]/` with a quote prefix, applied to every cell including the header (`export.ts:185-189`); the numeric exception only for stored JSON numbers matching `PLAIN_NUMBER`; run: `profile-form-csv.test.ts` OWASP payload suite and header cells | closed |
| T-12-25 | Information disclosure | export reachable by support, members or another tenant, or served from a cache | high | mitigate | `routes.ts:325-338,368-376` guard chain, `no-store`, attachment; `export.ts:166` role check (review WR-01, d6a0ae8b); page reads carry `m.tenant_id`, `a.tenant_id`, `mp.tenant_id` = `ctx.tenantId` (the only isolation in the admin lane); run: `profile-form-export-guard.test.ts` (support and member refused with 403 before any read); `profile-form-export.test.ts:495,563` (not run by the auditor) | closed |
| T-12-26 | Repudiation | an export with no trace, or a trace that can be rewritten | high | mitigate | `export.ts:80-120,168` the audit row is written and its transaction ended before the stream exists; live `moderation_log` has SELECT and INSERT grants only plus the no-update-delete and no-truncate triggers; the live data holds 22 `profile_form_exported` rows; test `profile-form-export.test.ts:220-244` (not run by the auditor) | closed |
| T-12-27 | Spoofing | open redirect through `next`, `x-rede-path` or an encoded look-alike | high | mitigate | `safe-next-path.ts:61-110` (shape checks on the raw value and one decode, look-alikes, control characters, 500-character cap, `(auth)` and self exclusions); `proxy.ts:107-108` deletes the inbound header and sets its own, all 4 `NextResponse.next` or `rewrite` carry `requestHeaders`; run: `safe-next-path.test.ts` and `proxy.test.ts` case 32. Commit 87f701d9 adds a request-scoped slot (`bootstrap.ts:87`, React `cache`, not module state) that stores only `safeNextPath(header)` | closed |
| T-12-28 | Tampering | the counters BFF or the shell following a location chosen by a response body | medium | mitigate | `counters/route.ts:55-70` `location = bootstrapRedirectPath(code)`, never from the body; `LiveShell.tsx:129` `landOnFormFlow` requires `startsWith('/completar-perfil')`; run: the counters route test and `LiveShell.form.test.ts` | closed |
| T-12-29 | Spoofing | open redirect through `next` on the completion screen or its action | high | mitigate | `completar-perfil/actions.ts:112` `safeNextPath(input.next) ?? fallback` is the only destination source; `ProfileForm.tsx:172-179` pushes `result.destination` only; run: `actions.test.ts` and `page.test.tsx` | closed |
| T-12-30 | Information disclosure | answers persisted in `localStorage`, `sessionStorage`, a URL, a log, a toast or an error message | high | mitigate | Zero `localStorage`, `sessionStorage`, `dangerouslySetInnerHTML` or `innerHTML` outside tests in the profile-form components, libs and screens; storage, URL and toast assertions at `ProfileForm.test.tsx:349` and `form-state.test.ts:330`; `actions.ts` logs status and code only | closed |
| T-12-31 | Tampering | a client parser turning ambiguous input into a different valid stored value, or a link helper turning `javascript:` into something accepted | medium | mitigate | `lib/profile-form/link.ts:14-27` leaves `javascript:`, `data:` and `ftp:` as typed; the server re-validates (`member.ts:316`); run: `link.test.ts`, `phone.test.ts`, `number.test.ts` | closed |
| T-12-32 | Tampering | stored XSS or an unsafe link through an answer, option label, question title or tenant name | high | mitigate | `AnswerValue.tsx` renders React text only; an anchor only when `answer-view.ts:72-77` says `http:` or `https:`, with `rel="noopener noreferrer nofollow ugc"`; e-mail is text; run: `AnswerValue.test.tsx` | closed |
| T-12-33 | Elevation of privilege | the builder page or its actions reachable without `profile_form.manage` (a support user, a typed URL) | high | mitigate | `configuracoes/page.tsx:154` the row only with the composed permission; builder `page.tsx:42,67` `notFound()`; every action goes through the guarded API; run: builder `page.test.tsx`. Browser: admin spec test 5 (a support user meets the not-found screen, no admin data in the HTML or RSC payload) | closed |
| T-12-34 | Tampering | a reopening write applied without knowing its effect (impact read failure) | medium | mitigate | The guard lives in the screens, not in the server action: `ArchivedList.tsx:124-143` and `QuestionEditorSheet.tsx:282-302` refuse to write when the impact read fails. Zero-write tests `builder.test.tsx:583` and `QuestionEditorSheet.test.tsx:746` (run, pass). The register wording says "the action layer refuses"; a direct call of the server action is unguarded, but the caller already holds `profile_form.manage`. Consider amending the register text | closed (location deviation) |
| T-12-35 | Tampering | stored XSS through a question title, help text or option label | high | mitigate | No raw-HTML sink in the builder and member files (grep), pinned by source scans `dialogs.test.tsx:898,906`; length caps and `hasUnsafeChars` refusals (`profile-form.ts:346-361,407`), re-parsed on the server | closed |
| T-12-36 | Tampering | the UI offering a locked change as free, leading an admin to reinterpret answers | high | mitigate | `editor-state.ts:534,589-640` `lockFlags` and `checkDraftLocks` mirror `lock-rules.ts`; parity table `editor-state.test.ts:617` (a copied table, so parity is by convention); authority stays with the server 409 and the live trigger | closed |
| T-12-37 | Information disclosure | the export relay caching, logging or parsing the file, or serving it cross-origin | high | mitigate | `export/route.ts:21-47` same-origin (403), `getClaims` (401), one forward, body passed as `res.body`, `no-store`, status-only failure log; `download.ts` keeps the blob until the click, no storage; run: `route.test.ts`. Residual IN-02 below | closed |
| T-12-38 | Elevation of privilege | a non-admin reaching the relay | medium | mitigate | The relay forwards to the API whose chain is admin-only; run: `route.test.ts:133` (API 403 returned as 403, empty body); the button and row are absent without the permission (T-12-33) | closed |
| T-12-39 | Tampering | an e2e run leaving a required question or the module on, gating other specs' members or the owner's data | high | mitigate | `apps/web/e2e/profile-form.ts:88-208` baseline file written before the change, restore in `beforeAll` and `afterAll`, run-prefix sweep; effect confirmed live after the agent run of 2026-10-30: 0 module rows, 0 questions, 0 answers, 0 `e2epf-` accounts | closed |
| T-12-40 | Denial of service | releasing the API before the migrations (the new API against the old schema) or turning the module on before the web is live | medium | mitigate | `docs/DEPLOY.md:3633-3660` states migrations, then API and worker, then web, then the per-tenant switch; the first half is enforced by `migrations/required.ts` (a behind project is held out as `updating`; new files raise the head); module-off default per T-12-04. The "module only after the web is live" half is a runbook step only | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## SUMMARY Threat Flags

`threat_flag: definer-function` (12-06-SUMMARY, `20261029234918_profile_form_lock_active.sql`) maps to T-12-14 and T-12-16 and is informational. Verified live: `prosecdef = t`, `search_path = ""`, owner postgres, no arguments, the tenant only from `app.tenant_id()`, role filter in (admin, support, member), EXECUTE revoked from PUBLIC and granted to `authenticated`, `api_user` and `service_role`. It returns only rows `profile_form_questions_select` already lets those roles read. Reachability is limited to the API's tenant lane: the Data API exposes only `data_api_closed` (`supabase/config.toml:11-19`), `anon` has no USAGE on `app`, and `authenticated` has `statement_timeout = 8s`, which bounds the share locks. The other 17 SUMMARY Threat Flags sections say "None"; 12-04 names the TRUNCATE revoke as an extra, confirmed live.

---

## Residual and unregistered findings

Not part of the register, none reopens a threat, none accepted by Igor. Listed so they are not lost.

| Ref | Finding | Effect | Where |
|-----|---------|--------|-------|
| Review IN-02 | The export is a GET that writes an audit row, and `sameOriginGet` accepts a request that carries neither `Sec-Fetch-Site` nor `Origin` | Every browser with Fetch Metadata sends `cross-site` on a forged navigation and is refused with 403; only a legacy Safari (older than 16.4) could be induced to download the admin's own CSV and write a spurious audit row. The attacker cannot read the response. T-12-25 and T-12-37 stay closed | `apps/web/lib/notifications-bff.ts:58-62` |
| Review IN-03 | `safeNextPath` accepts `/api/*` and `/_next/*` destinations | Same origin, so not an open redirect. The chain to the export does not work: the form page sends any non-member to `/inicio` and a member who lands on the export gets the API's 403. T-12-27 and T-12-29 hold | `apps/web/lib/safe-next-path.ts` |
| Review IN-01 and IN-04 | The CSV BOM is a literal U+FEFF while the comment says it is an escape; a reorder of more than 30 ids is a generic 400 | Value correct, comment wrong; a bound, not a gap | `csv.ts:21`; `profile-form.ts:491-499` |
| New, robustness | `parseLink` never calls `hasUnsafeChars`: `https://a.com/\ud800` passes `parseAnswer`, `JSON.stringify` yields `"\ud800"` and Postgres refuses the `::jsonb` cast (22P02, reproduced with psql) | An authenticated member gets a 500 on save instead of a keyed 400; the transaction rolls back, nothing is stored, the log carries only the SQLSTATE. Same family as review WR-02 (fixed in a2b15911 for the other types); no integrity or disclosure impact | `packages/contracts/src/profile-form.ts:258-266` |
| New, informational | The `public_select` RLS floor does not look at the target membership's state (blocked or removed); the API does (`answers.ts:62-73`) | The API is the only data client | `20261029232606_profile_form_tables.sql:66-70` |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

No accepted risks. T-12-02 stays open (below the block threshold) until Igor edits the sketch 016 approval himself or accepts the risk here.

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-30 | 40 | 39 | 1 (T-12-02, medium, non-blocking) | gsd-security-auditor (read-only), orchestrated by Claude |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (none)
- [x] `threats_open: 0` confirmed (0 open at or above `high`)
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-30 for the blocking gate, with one non-blocking open threat (T-12-02, the design-gate approval, which only Igor can close).
