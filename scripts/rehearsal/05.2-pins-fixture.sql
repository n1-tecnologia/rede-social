-- 05.2-pins-fixture.sql — the pins-era edge fixture `scripts/rehearse-highlights-migration.sh` loads
-- (05.2-11, HIGHLIGHT-05, D-116).
--
-- It runs on a database reset to migration `20260924022607_story_community_pins` — the last version
-- before migration file 1 (`*_story_highlights.sql`) — so `public.story_community_pins` still exists
-- and nothing has been copied yet. `supabase/tests/000-helpers.sql` has NOT run on that database, so
-- the `tests.auth_user` / `tests.tenant` / `tests.member` inserts are inlined here in the same shape.
-- Every id is fixed (`5a…` tenant A, `5b…` tenant B) so the assertions can name the rows, and none
-- collides with the seed's `0d…`/`0e…` families or pgTAP's fixtures.
--
-- The edges it covers, each one a way the backfill could lose, merge or invent a curated story:
--   * a story pinned to TWO communities           → two items under two highlights, never merged;
--   * an EXPIRED pinned story                      → copied, and still reachable with no expiry clause;
--   * a SOFT-DELETED pinned story                  → copied (the pin row existed), hidden by the read;
--   * a pin in an ARCHIVED community               → copied (archive gates NEW content, not history);
--   * two different curators in one community     → each item keeps its own adder and time;
--   * an active community with NO pins            → gets NO highlight at all (the empty edge);
--   * a second tenant with a structurally identical pin → its own highlight, never tenant A's.
--
-- Afterwards every pin is snapshotted into `rehearsal.pins_before`, the ground truth the assert
-- file compares the migrated items against once the pin table is gone.

-- ── tenants, curators, memberships ────────────────────────────────────────────────────────────
insert into public.tenants (id, slug, display_name, rules_text, rules_version) values
  ('5a000000-0000-4000-8000-000000000001', 'rehearsal-pins-a', 'Ensaio A', 'Regras de teste.', 1),
  ('5b000000-0000-4000-8000-000000000001', 'rehearsal-pins-b', 'Ensaio B', 'Regras de teste.', 1);

-- The `auth.users` insert fires the mirror trigger that creates each `public.users` row.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '5a000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pins-a1@rehearsal.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5a000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pins-a2@rehearsal.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5b000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pins-b1@rehearsal.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now());

insert into public.memberships (tenant_id, user_id, role, status) values
  ('5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000003', 'admin_tenant', 'active'),
  ('5b000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-000000000002', 'admin_tenant', 'active');

-- ── communities: active ×2 with pins, archived ×1 with a pin, active ×1 with NO pins; B ×1 ─────
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, status) values
  ('5a000000-0000-4000-8000-0000000000c1', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'Avisos', 'avisos', 'active'),
  ('5a000000-0000-4000-8000-0000000000c2', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'Eventos', 'eventos', 'active'),
  ('5a000000-0000-4000-8000-0000000000c3', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'Arquivo', 'arquivo', 'archived'),
  ('5a000000-0000-4000-8000-0000000000c4', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'Sem destaques', 'sem-destaques', 'active'),
  ('5b000000-0000-4000-8000-0000000000c1', '5b000000-0000-4000-8000-000000000001',
   '5b000000-0000-4000-8000-000000000002', 'Avisos', 'avisos', 'active');

-- ── `story`-purpose ready image assets, one per story ──────────────────────────────────────────
insert into public.media_assets
  (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('5a000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('5a000000-0000-4000-8000-0000000000a2', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('5a000000-0000-4000-8000-0000000000a3', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('5b000000-0000-4000-8000-0000000000a1', '5b000000-0000-4000-8000-000000000001',
   '5b000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');

-- ── stories: ACTIVE, EXPIRED (30 h ago), SOFT-DELETED; B's one active story ───────────────────
insert into public.stories
  (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at,
   deleted_at) values
  ('5a000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-0000000000a1', 'image',
   'ativa', now() - interval '1 hour', now() + interval '23 hours', null),
  ('5a000000-0000-4000-8000-0000000000e2', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-0000000000a2', 'image',
   'expirada', now() - interval '30 hours', now() - interval '6 hours', null),
  ('5a000000-0000-4000-8000-0000000000e3', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-0000000000a3', 'image',
   'removida', now() - interval '2 hours', now() + interval '22 hours', now() - interval '1 hour'),
  ('5b000000-0000-4000-8000-0000000000e1', '5b000000-0000-4000-8000-000000000001',
   '5b000000-0000-4000-8000-000000000002', '5b000000-0000-4000-8000-0000000000a1', 'image',
   'ativa', now() - interval '1 hour', now() + interval '23 hours', null);

-- ── the pins ───────────────────────────────────────────────────────────────────────────────────
insert into public.story_community_pins
  (id, tenant_id, story_id, community_id, pinned_by_user_id, pinned_at) values
  -- the ACTIVE story in TWO communities (c1 by curator 1, c2 by curator 2)
  ('5a000000-0000-4000-8000-0000000000f1', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-0000000000c1',
   '5a000000-0000-4000-8000-000000000002', now() - interval '50 minutes'),
  ('5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-0000000000c2',
   '5a000000-0000-4000-8000-000000000003', now() - interval '40 minutes'),
  -- the EXPIRED story, pinned to c1 by curator 2 while it was still live
  ('5a000000-0000-4000-8000-0000000000f3', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-0000000000e2', '5a000000-0000-4000-8000-0000000000c1',
   '5a000000-0000-4000-8000-000000000003', now() - interval '29 hours'),
  -- the SOFT-DELETED story, pinned to c2 before it was removed
  ('5a000000-0000-4000-8000-0000000000f4', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-0000000000e3', '5a000000-0000-4000-8000-0000000000c2',
   '5a000000-0000-4000-8000-000000000002', now() - interval '90 minutes'),
  -- a pin in the ARCHIVED community (made before the archive)
  ('5a000000-0000-4000-8000-0000000000f5', '5a000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-0000000000c3',
   '5a000000-0000-4000-8000-000000000002', now() - interval '55 minutes'),
  -- tenant B's structurally identical pin
  ('5b000000-0000-4000-8000-0000000000f1', '5b000000-0000-4000-8000-000000000001',
   '5b000000-0000-4000-8000-0000000000e1', '5b000000-0000-4000-8000-0000000000c1',
   '5b000000-0000-4000-8000-000000000002', now() - interval '50 minutes');

-- ── the snapshot: every pin that exists, the ground truth the assert file checks against ─────
create schema rehearsal;
create table rehearsal.pins_before as
  select tenant_id, community_id, story_id, pinned_by_user_id, pinned_at
    from public.story_community_pins;
