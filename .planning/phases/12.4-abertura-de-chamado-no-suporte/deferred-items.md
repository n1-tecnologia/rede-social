# Phase 12.4 deferred items

Out-of-scope discoveries logged by plan executors. None of these were caused by the plan that found them.

## Found by 12.4-01 (2026-11-17)

Full pgTAP run (`pnpm supabase test db`) on the local stack that still holds Igor's account and earlier integration residue: 3 of 68 files fail, none touches the chat module or any 12.4-01 object.

| File | Test | Symptom | Likely cause |
|------|------|---------|--------------|
| `supabase/tests/120-story-highlights.sql` | 37 | the strip with viewer_seen plans a Seq Scan on `stories` instead of `stories_tenant_expires_idx` | planner statistics on a local database holding integration residue (stories 11 rows, story_views 8) |
| `supabase/tests/232-feed-community-audience.sql` | 56 | the merged Inicio is not served by `feed_posts_tenant_org_created_idx` by name | same, `EXPLAIN`-by-name probes are statistics-sensitive |
| `supabase/tests/154-moderation-log.sql` | 65 | 104 `moderation_log` rows (2026-11-13 and 2026-11-14) are not anchored to two memberships of their tenant | residue of earlier integration runs; known pgTAP 154 residue trip |

All three are fixed by a seeded reset (`pnpm db:reset` then `pnpm db:seed`), which this plan is forbidden to run. The 235 file and every file this plan touched (010, 020, 040, 152) are green.

## Found by the orchestrator at the wave 4 gate (2026-11-17)

| File | Test | Symptom | Likely cause |
|------|------|---------|--------------|
| `apps/web/app/(app)/eventos/EventsSections.test.tsx` | 10.2-14 "the tracer: the Em breve tag with the Clock and the live price-first note inside ONE link" | `expected 'R$ 80,00 · Abre em 2 d 4 h 12 min' to be '... 4 h 13 min'` | The countdown reads the real clock and the minute rolled over between render and assertion; no fake timers. Phase 10.2's file, not touched by 12.4 (`git diff 59bb398e..HEAD -- apps/web` is empty). |

Run 1 (`turbo typecheck test --continue --concurrency=4`, load 1.9): 1 failed of 9217 web tests, 40 of 41 tasks. Run 2 (the file alone, `vitest run`): 18 of 18 passed. Treat as a flake; a fix is to freeze the clock in that test (Phase 10.2 owner's call).

## Found by 12.4-10 (2026-11-17)

| File | Test | Symptom | Likely cause |
|------|------|---------|--------------|
| `apps/api/tests/integration/dashboard-owner-members.test.ts` | "gate on: B and C leave every active-member figure by exactly the cut members, A stays, the other areas do not move" (line 591) | `after.others` differs from `baseline.others` in the CONTENT area only (`reactivated` 0 to 1 and more, a `new` band 4 to 0); no support key differs | Seed and time drift on the local stack (members of rede-lab whose reactivation association changes once the payments gate cuts members, dates now a month past the seed). Content area is untouched by 12.4-10; fails when the file runs alone as well. Not chased. |

The other eight dashboard integration files (135 tests) and the whole pgTAP suite pass apart from the three known failures listed above (120 test 37, 154 test 65, 232 test 56).

## Found by 12.4-06 (2026-11-17)

| File | Test | Symptom | Likely cause |
|------|------|---------|--------------|
| `apps/api/tests/integration/isolation.test.ts` | "b3. stories ..." (`expected 0 to be greater than 0`), "b8. seen state ..." (`seeded labStory: expected '' not to be ''`), "phase 10 sweep: member stories and highlights ..." | Three story cases fail when the whole file runs | Seed drift on the local stack: all 11 rows of `public.stories` are older than the 24-hour window (`published_at > now() - interval '24 hours'` matches 0 rows), so the cases that need a live seeded story find none. Untouched by 12.4-06; every chat case of the file (b12, `chat cases`, `phase 7 sweep`) and the inventory unit test pass. Not chased. |

## Found by 12.4-16 (2026-11-17)

| File | Check | Symptom | Likely cause |
|------|-------|---------|--------------|
| `apps/web/lib/chat-view.test.ts` (line 11) | `pnpm boundaries` | "import `../../../packages/modules/chat/server/first-name` leaves the package" (1 issue in 2534 files) | Plan 12.4-11 (6f5244ff) imports the server `firstNameOf` by relative path to pin parity with the web copy. Not touched by 12.4-16; the plan 16 files add no import across packages. Fix belongs to 12.4-11's file (test the parity through the module's published contract, or move the parity pin to the chat module's own tests). |

Second occurrence, wave 7 gate (2026-11-17, load 4.2): the same `EventsSections.test.tsx` 10.2-14 countdown test failed in the full run (40 of 41 tasks). Alone it passed in 5 of 6 reruns and failed once with the identical assertion (`4 h 12 min` against `4 h 13 min`). Cause: the tracer test runs on REAL timers (fake timers start only in the next test, line 388) with the count seeded at 2026-10-05T08:47, so real time that passes between render and assertion can tick the display from 13 to 12 min; the more loaded the machine, the likelier. It is Phase 10.2's file and 12.4 changed nothing under `apps/web/app/(app)/eventos` (fix: `vi.useFakeTimers()` plus `vi.setSystemTime(Date.parse(SEED))` in the tracer too). Do not read a red here as a 12.4 regression.

Also on that gate `pnpm boundaries` found a REAL issue from plan 12.4-11 (a relative import from `apps/web` into `packages/modules/chat`); it is fixed in `fix(12.4-11)` and the command is now part of the wave gate.

## Found by 12.4-08 (2026-11-17)

| File | Test | Symptom | Likely cause |
|------|------|---------|--------------|
| `apps/api/tests/integration/chat-cases.test.ts` | "the member send repeats the index predicate to the letter (EP-012, EP-013)" (plan 02) | `expect(source).not.toMatch(/'open'\s*,\s*'in_progress'/)` fails on `packages/modules/chat/server/service.ts` | Plan 12.4-07 put the literal `state in ('open','in_progress')` in `service.ts` (the doc comment at line 818 and the open-tab statement at line 839) on purpose, so the open inbox tab matches `chat_conversations_open_inbox_idx`. Plan 02's EP-013 test reads the whole file and forbids a second spelling of the active list, so it went red at 12.4-07 (that plan's gate ran chat.test.ts and chat-cases-staff, not chat-cases.test.ts). Not caused by 12.4-08 (its `service.ts` change is the CS004 mapping only). Fix belongs to plan 07 or 02: scope the assertion to the member-send function body, not the whole file. |
