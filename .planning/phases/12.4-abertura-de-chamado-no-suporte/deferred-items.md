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
