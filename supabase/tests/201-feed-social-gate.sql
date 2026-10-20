begin;
-- 201-feed-social-gate.sql — the audience of a feed post, executed inside Postgres (09-03, SOCIAL-03,
-- SOCIAL-04, SOCIAL-06; D-473, D-476, D-483, D-484; T-09-07, T-09-08, T-09-09, T-09-10). Numbered 201
-- after 200 (09-02).
--
-- 1. THE SELECT TRUTH TABLE of `feed_posts_social_gate`, for ONE followers post of member M1, in every
--    lane: M1 (the author) and M2 (a follower) read it; M3 (a stranger) does not; the tenant's
--    `admin_tenant` does; a REAL `support_tenant` session (a real user id) does NOT (T-09-10: the
--    exemption is the admin role plus the zero user, never the role claim); the SYSTEM lane
--    (`support_tenant` claim with the zero user, the notifications worker and the dashboard) does;
--    another tenant's member and a null-role claim do not. The organization post (visibility
--    'tenant') is visible to every lane of its own tenant.
--
-- 2. D-483, SOCIAL OFF: with the tenant's `social` row disabled, and then deleted, no lane reads a
--    followers post (the author's, the follower's, the admin's, the system's) while the organization
--    post stays visible; re-enabling restores every row untouched (nothing was deleted).
--
-- 3. D-484, LIVENESS: blocking an author (status and blocked_at, as the API writes them) or removing
--    them (deleted_at) removes their posts from the follower's lane and unblocking restores them;
--    unfollowing removes the followee's posts from the follower's lane and following again restores
--    them.
--
-- 4. THE INSERT GATE (T-09-08): a member lane cannot insert 'tenant' (42501), can insert 'followers'
--    with no community, and cannot insert a followers post INTO a community (the policy refuses it
--    first: 42501, ahead of the table check); a staff lane cannot insert 'followers' (42501) and can
--    insert 'tenant'; with `social` off the member insert is refused (42501); a null-role claim fails
--    closed (42501). The checks are asserted in the migration-role lane: a followers row with a
--    community raises 23514 on `feed_posts_visibility_shape_chk` and an unknown visibility raises
--    23514 on `feed_posts_visibility_chk`.
--
-- 5. INHERITANCE: comments and likes need no policy of their own. In a stranger's lane the comments of
--    the followers post read zero rows, a like on the post raises 42501 and a like on one of its
--    comments raises 42501; in the follower's lane the comment reads and the like succeeds. The story
--    comment (post id null) stays visible to the stranger (Pitfall 14).
--
-- 6. THE POLICY SHAPES by catalog: both policies exist, RESTRICTIVE, for authenticated, one for SELECT
--    and one for INSERT, and the select policy calls the seam function.
--
-- 7. THE EXPLORAR PLANS (09-04, SOCIAL-10, EXPL-02, T-09-11). On a volume fixture in tenant A - 60
--    volume members, 6,000 member posts (skewed: three rare authors wrote 30 each) interleaved with
--    1,200 organization posts, `analyze`d - the Explorar statement, written the way the service writes
--    it (the literals `p.visibility = 'followers'` and `p.community_id is null`, the member fragment,
--    the projection's join to the author's membership), is EXPLAINed AS THE `authenticated` ROLE with
--    the viewer's claims, so the restrictive policies and the seam functions are inside the plan
--    exactly as in production (the spike measured it the same way). Pinned BY INDEX NAME with no
--    `Seq Scan on feed_posts`, for: a member who follows 50 authors, a member who follows the 3 rare
--    authors (page 1 and a deep page), and the moderator's all-members read. The three indexes of
--    `20261019214205_feed_social_indexes.sql` are also asserted to exist with their LITERAL partial
--    predicates. The statement form is `ANY_SET` (`09-03-SPIKE.md`, CHOSEN_FORM): the author test is a
--    filter inside the policy disjunction, not an index condition, which is why the F3 plan still
--    walks the followers partial index and discards rows (the spike's recorded caveat), and why the
--    pin is on the INDEX that bounds the walk, not on a per-author access path.
--
-- Fixture ids use the `20100000-…` prefix and the tenants `pgtap-fsocial-a` / `pgtap-fsocial-b`, used
-- by no other file. Like its siblings, this file ROLLS BACK.
select plan(112);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-fsocial-a', 'Feed social A', '20100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-fsocial-b', 'Feed social B', '20100000-0000-4000-8000-000000000011');
select tests.auth_user('admin@fsocial-a.local', '20100000-0000-4000-8000-000000000002');
select tests.auth_user('support@fsocial-a.local', '20100000-0000-4000-8000-000000000003');
select tests.auth_user('m1@fsocial-a.local', '20100000-0000-4000-8000-000000000004');
select tests.auth_user('m2@fsocial-a.local', '20100000-0000-4000-8000-000000000005');
select tests.auth_user('m3@fsocial-a.local', '20100000-0000-4000-8000-000000000006');
select tests.auth_user('m4@fsocial-a.local', '20100000-0000-4000-8000-000000000007');
select tests.auth_user('k@fsocial-b.local', '20100000-0000-4000-8000-000000000012');

-- Memberships with FIXED ids so the liveness rows can be flipped by id.
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('20100000-0000-4000-8000-00000000f002', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('20100000-0000-4000-8000-00000000f003', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000003', 'support_tenant', 'active'),
  ('20100000-0000-4000-8000-00000000f004', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'member', 'active'),
  ('20100000-0000-4000-8000-00000000f005', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005', 'member', 'active'),
  ('20100000-0000-4000-8000-00000000f006', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006', 'member', 'active'),
  ('20100000-0000-4000-8000-00000000f007', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000007', 'member', 'active'),
  ('20100000-0000-4000-8000-00000000f012', '20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012', 'member', 'active');

-- `social` is ON in both tenants (B is on so its negative is the TENANT isolation, not the flag).
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('20100000-0000-4000-8000-000000000001', 'social', true),
  ('20100000-0000-4000-8000-000000000011', 'social', true);

-- M2 follows M1 and M4. M3 follows nobody.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005', '20100000-0000-4000-8000-000000000004'),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005', '20100000-0000-4000-8000-000000000007');

-- One community, only to prove a followers post may not go INTO one.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description) values
  ('20100000-0000-4000-8000-0000000000c1', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'Um', 'um', '');

-- Posts: ORG (the admin's organization post), P1 (M1, followers), P4 (M4, followers).
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility) values
  ('20100000-0000-4000-8000-000000000b01', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'organizacao', 'tenant'),
  ('20100000-0000-4000-8000-000000000b11', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'de M1', 'followers'),
  ('20100000-0000-4000-8000-000000000b14', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000007', 'de M4', 'followers');

-- A root comment on P1 (by M2), and a story comment (post id null) for Pitfall 14.
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('20100000-0000-4000-8000-000000000c11', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b11',
   '20100000-0000-4000-8000-000000000005', 'comentario em M1', 0, null, null, null);
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths)
values ('20100000-0000-4000-8000-0000000000e1', '20100000-0000-4000-8000-000000000001',
        '20100000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
values ('20100000-0000-4000-8000-0000000000e2', '20100000-0000-4000-8000-000000000001',
        '20100000-0000-4000-8000-000000000002', '20100000-0000-4000-8000-0000000000e1', 'image', '',
        now() - interval '1 hour', now() + interval '23 hours');
insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
values ('20100000-0000-4000-8000-0000000000e3', '20100000-0000-4000-8000-000000000001',
        '20100000-0000-4000-8000-0000000000e2', '20100000-0000-4000-8000-000000000002', 'story', 0, null, null, null);

-- ── 1. the SELECT truth table (T-09-07, T-09-10) ───────────────────────────────────────────────
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '1: the author M1 reads their own followers post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '1: the follower M2 reads it');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  '1: the stranger M3 reads nothing (feed_posts_social_gate)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '1: the tenant''s admin_tenant reads it (the moderator)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000003', 'support_tenant');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  '1: a REAL support_tenant session reads nothing (T-09-10: the role claim is not an exemption)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '1: the SYSTEM lane (support_tenant claim, the zero user) reads it, so the workers keep working');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  '1: another tenant''s member K reads nothing');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006', null);
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  '1: a null-role claim reads nothing (fails closed)');

-- The organization post is visible to every lane of its own tenant.
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '1: the organization post is visible to the null-role lane too (visibility tenant passes)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '1: the organization post is visible to the stranger M3');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '1: the organization post is visible to a real support user');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b01' $$,
  '1: …but not to another tenant''s member (tenant isolation still ANDs)');
reset role;

-- ── 2. D-483: social off hides every member post, deletes nothing ──────────────────────────────
update public.tenant_modules set enabled = false
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select is_empty(
  $$ select 1 from public.feed_posts where visibility = 'followers' $$,
  '2: social disabled: the AUTHOR reads no followers post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is_empty(
  $$ select 1 from public.feed_posts where visibility = 'followers' $$,
  '2: social disabled: the FOLLOWER reads no followers post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select is_empty(
  $$ select 1 from public.feed_posts where visibility = 'followers' $$,
  '2: social disabled: even the admin_tenant reads no followers post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is_empty(
  $$ select 1 from public.feed_posts where visibility = 'followers' $$,
  '2: social disabled: not even the system lane reads a followers post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select results_eq(
  $$ select count(*)::int from public.feed_posts where visibility = 'tenant' $$,
  ARRAY[1], '2: social disabled: the organization post stays visible');

reset role;
delete from public.tenant_modules
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is_empty(
  $$ select 1 from public.feed_posts where visibility = 'followers' $$,
  '2: social row ABSENT reads as off: the follower reads no followers post');

reset role;
insert into public.tenant_modules (tenant_id, module_key, enabled)
values ('20100000-0000-4000-8000-000000000001', 'social', true);
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '2: re-enabled: the author reads their post again (nothing was deleted)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '2: re-enabled: the follower reads it again');
reset role;

-- ── 3. D-484: liveness and the follow edge ─────────────────────────────────────────────────────
update public.memberships set status = 'blocked', blocked_at = now()
 where id = '20100000-0000-4000-8000-00000000f007';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b14' $$,
  '3: blocking the author M4 removes their post from the follower M2''s lane');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '3: …while the other followee M1''s post stays');
reset role;
update public.memberships set status = 'active', blocked_at = null
 where id = '20100000-0000-4000-8000-00000000f007';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b14' $$,
  ARRAY[1], '3: unblocking restores the post (the follow row was never touched)');
reset role;
update public.memberships set deleted_at = now()
 where id = '20100000-0000-4000-8000-00000000f007';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b14' $$,
  '3: removing the author (deleted_at) removes their post from the follower''s lane');
reset role;
update public.memberships set deleted_at = null
 where id = '20100000-0000-4000-8000-00000000f007';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b14' $$,
  ARRAY[1], '3: restoring the author restores the post');

select lives_ok(
  $$ delete from public.social_follows
      where follower_user_id = '20100000-0000-4000-8000-000000000005'
        and followee_user_id = '20100000-0000-4000-8000-000000000004' $$,
  '3: M2 unfollows M1 in their own lane');
select is_empty(
  $$ select 1 from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  '3: after the unfollow M2 reads nothing of M1');
select lives_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005', '20100000-0000-4000-8000-000000000004') $$,
  '3: M2 follows M1 again');
select results_eq(
  $$ select count(*)::int from public.feed_posts where id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '3: after the re-follow M2 reads M1''s post again');
reset role;

-- ── 4. the insert gate and the checks (T-09-08) ────────────────────────────────────────────────
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'forjado', 'tenant') $$,
  '42501', null, '4: a member claim cannot insert visibility tenant (feed_posts_social_insert_gate)');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'legitimo', 'followers') $$,
  '4: a member claim can insert a followers post with no community');
-- The policy is evaluated BEFORE the table check, so the SQLSTATE the database actually raises for a
-- followers post INTO a community from a member lane is 42501 (not 23514).
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'em comunidade', 'followers',
             '20100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '4: a member post INTO a community raises 42501 (the insert policy answers first)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'forjado', 'followers') $$,
  '42501', null, '4: a staff claim cannot insert visibility followers');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'aviso', 'tenant') $$,
  '4: a staff claim can insert visibility tenant');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', null);
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'sem papel', 'tenant') $$,
  '42501', null, '4: a null-role claim cannot insert (fails closed)');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'desligado', 'followers') $$,
  '42501', null, '4: with social off a member cannot insert a followers post');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'forma', 'followers',
             '20100000-0000-4000-8000-0000000000c1') $$,
  '23514', 'new row for relation "feed_posts" violates check constraint "feed_posts_visibility_shape_chk"',
  '4: the shape check: a followers row with a community raises 23514 in the migration-role lane');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'outro', 'other') $$,
  '23514', 'new row for relation "feed_posts" violates check constraint "feed_posts_visibility_chk"',
  '4: an unknown visibility raises 23514 on feed_posts_visibility_chk');

-- ── 5. inheritance by comments and likes ───────────────────────────────────────────────────────
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is_empty(
  $$ select 1 from public.feed_comments where post_id = '20100000-0000-4000-8000-000000000b11' $$,
  '5: the stranger M3 reads no comment of the followers post');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006', '20100000-0000-4000-8000-000000000b11') $$,
  '42501', null, '5: a like by the stranger M3 on the followers post raises 42501');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006', '20100000-0000-4000-8000-000000000c11', 'post') $$,
  '42501', null, '5: a like by M3 on a comment of the followers post raises 42501');
select results_eq(
  $$ select count(*)::int from public.feed_comments where id = '20100000-0000-4000-8000-0000000000e3' $$,
  ARRAY[1], '5: the story comment (post id null) stays visible to M3 (Pitfall 14)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.feed_comments where post_id = '20100000-0000-4000-8000-000000000b11' $$,
  ARRAY[1], '5: the follower M2 reads the comment of the followers post');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005', '20100000-0000-4000-8000-000000000b11') $$,
  '5: …and the follower''s like on the followers post succeeds');
reset role;

-- ── 6. the policy shapes by catalog (T-09-09) ──────────────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'feed_posts' and policyname = 'feed_posts_social_gate'
        and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{authenticated}'::name[] $$,
  ARRAY[1], '6: feed_posts_social_gate is RESTRICTIVE, for SELECT, to authenticated');
select results_eq(
  $$ select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'feed_posts' and policyname = 'feed_posts_social_insert_gate'
        and permissive = 'RESTRICTIVE' and cmd = 'INSERT' and roles = '{authenticated}'::name[] $$,
  ARRAY[1], '6: feed_posts_social_insert_gate is RESTRICTIVE, for INSERT, to authenticated');
select matches(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'feed_posts' and policyname = 'feed_posts_social_gate'),
  'social_visible_author_ids',
  '6: the select policy calls the kernel seam app.social_visible_author_ids()');

-- ── 8. the locked-answer definers and the playback gate (09-05, SOCIAL-06, D-469; T-09-09, T-09-14, T-09-16) ──
-- Fixtures for this section: a deleted followers post, gallery posts carrying assets (the
-- `feed_post_media_kind_fk` pair): a1 only on a followers post of M1; a2 on a followers post of M1 AND on
-- an organization post; a3 on no post; a5 only on a DELETED followers post of M1; a6 only on a followers
-- post of M4.
reset role;
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind, deleted_at) values
  ('20100000-0000-4000-8000-000000000b21', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'apagado de M1', 'followers', 'none', now()),
  ('20100000-0000-4000-8000-000000000b31', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'com midia a1', 'followers', 'gallery', null),
  ('20100000-0000-4000-8000-000000000b32', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'com midia a2', 'followers', 'gallery', null),
  ('20100000-0000-4000-8000-000000000b33', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'organizacao com a2', 'tenant', 'gallery', null),
  ('20100000-0000-4000-8000-000000000b34', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000007', 'com midia a6 de M4', 'followers', 'gallery', null),
  ('20100000-0000-4000-8000-000000000b35', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'apagado com a5', 'followers', 'gallery', now());
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('20100000-0000-4000-8000-0000000000a1', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20100000-0000-4000-8000-0000000000a2', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20100000-0000-4000-8000-0000000000a3', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20100000-0000-4000-8000-0000000000a5', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20100000-0000-4000-8000-0000000000a6', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000007', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}');
insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position) values
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b31', 'gallery', '20100000-0000-4000-8000-0000000000a1', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b32', 'gallery', '20100000-0000-4000-8000-0000000000a2', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b33', 'gallery', '20100000-0000-4000-8000-0000000000a2', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b34', 'gallery', '20100000-0000-4000-8000-0000000000a6', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b35', 'gallery', '20100000-0000-4000-8000-0000000000a5', 'image', 0);
-- 09-14 (WR-01): a7 on a DELETED followers post of M1 AND on a live organization post; a8 only on a
-- DELETED organization post; a9 on a DELETED followers post of M1 AND on a live followers post of M4.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind, deleted_at) values
  ('20100000-0000-4000-8000-000000000b36', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'apagado com a7', 'followers', 'gallery', now()),
  ('20100000-0000-4000-8000-000000000b37', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'organizacao viva com a7', 'tenant', 'gallery', null),
  ('20100000-0000-4000-8000-000000000b38', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'organizacao apagada com a8', 'tenant', 'gallery', now()),
  ('20100000-0000-4000-8000-000000000b39', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'apagado com a9', 'followers', 'gallery', now()),
  ('20100000-0000-4000-8000-000000000b3a', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000007', 'vivo de M4 com a9', 'followers', 'gallery', null);
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('20100000-0000-4000-8000-0000000000a7', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20100000-0000-4000-8000-0000000000a8', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20100000-0000-4000-8000-0000000000a9', '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}');
insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position) values
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b36', 'gallery', '20100000-0000-4000-8000-0000000000a7', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b37', 'gallery', '20100000-0000-4000-8000-0000000000a7', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b38', 'gallery', '20100000-0000-4000-8000-0000000000a8', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b39', 'gallery', '20100000-0000-4000-8000-0000000000a9', 'image', 0),
  ('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000b3a', 'gallery', '20100000-0000-4000-8000-0000000000a9', 'image', 0);

select is((select prosecdef from pg_proc where oid = 'app.feed_social_locked_author(uuid)'::regprocedure), true,
  '8: app.feed_social_locked_author is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'app.feed_social_locked_author(uuid)'::regprocedure),
  '8: app.feed_social_locked_author pins search_path to the empty string');
select ok(has_function_privilege('authenticated', 'app.feed_social_locked_author(uuid)'::regprocedure, 'execute'),
  '8: authenticated may execute app.feed_social_locked_author');
select ok(not has_function_privilege('anon', 'app.feed_social_locked_author(uuid)'::regprocedure, 'execute'),
  '8: anon may not execute app.feed_social_locked_author');
select is((select prosecdef from pg_proc where oid = 'app.feed_social_locked_comment(uuid)'::regprocedure), true,
  '8: app.feed_social_locked_comment is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'app.feed_social_locked_comment(uuid)'::regprocedure),
  '8: app.feed_social_locked_comment pins search_path to the empty string');
select ok(has_function_privilege('authenticated', 'app.feed_social_locked_comment(uuid)'::regprocedure, 'execute'),
  '8: authenticated may execute app.feed_social_locked_comment');
select ok(not has_function_privilege('anon', 'app.feed_social_locked_comment(uuid)'::regprocedure, 'execute'),
  '8: anon may not execute app.feed_social_locked_comment');
select is((select prosecdef from pg_proc where oid = 'app.media_asset_hidden(uuid)'::regprocedure), true,
  '8: app.media_asset_hidden is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'app.media_asset_hidden(uuid)'::regprocedure),
  '8: app.media_asset_hidden pins search_path to the empty string');
select ok(has_function_privilege('authenticated', 'app.media_asset_hidden(uuid)'::regprocedure, 'execute'),
  '8: authenticated may execute app.media_asset_hidden');
select ok(not has_function_privilege('anon', 'app.media_asset_hidden(uuid)'::regprocedure, 'execute'),
  '8: anon may not execute app.media_asset_hidden');

-- app.feed_social_locked_author: the truth table (D-469).
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), '20100000-0000-4000-8000-000000000004'::uuid,
  'locked_author: a stranger (M3) asking about M1''s followers post gets M1''s user id');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b14'), '20100000-0000-4000-8000-000000000007'::uuid,
  'locked_author: the same stranger asking about M4''s post gets M4''s user id');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: the follower M2 gets null (the post is readable, no locked answer)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: the author M1 gets null (EP-18)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: the admin_tenant gets null (reads through the moderator rule)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: a REAL support_tenant gets null (cannot follow, so the bare 404)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: the system lane (zero user, support_tenant claim) gets null');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006', null);
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: a null-role claim gets null (fails closed)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: another tenant''s member gets null for tenant A''s post (tenant pin, T-09-09)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b21'), null::uuid,
  'locked_author: a deleted followers post answers null');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b01'), null::uuid,
  'locked_author: an organization (tenant) post answers null');
reset role;
update public.memberships set status = 'blocked', blocked_at = now()
 where id = '20100000-0000-4000-8000-00000000f004';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: a BLOCKED author''s post answers null for the stranger (D-484)');
reset role;
update public.memberships set status = 'active', blocked_at = null
 where id = '20100000-0000-4000-8000-00000000f004';
update public.tenant_modules set enabled = false
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), null::uuid,
  'locked_author: with social OFF the stranger gets null (D-483)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_author('20100000-0000-4000-8000-000000000b11'), '20100000-0000-4000-8000-000000000004'::uuid,
  'locked_author: re-enabled, the stranger gets M1 again (nothing was deleted)');
reset role;

-- app.feed_social_locked_comment.
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_comment('20100000-0000-4000-8000-000000000c11'), true,
  'locked_comment: true for a stranger on a comment of the followers post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.feed_social_locked_comment('20100000-0000-4000-8000-000000000c11'), false,
  'locked_comment: false for the follower');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_comment('20100000-0000-4000-8000-0000000000e3'), false,
  'locked_comment: false for a story comment (no post)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.feed_social_locked_comment('20100000-0000-4000-8000-0000000000ff'), false,
  'locked_comment: false for an unknown id');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012');
select is(app.feed_social_locked_comment('20100000-0000-4000-8000-000000000c11'), false,
  'locked_comment: false in another tenant''s lane (tenant pin)');
reset role;

-- app.media_asset_hidden with the social rule (T-09-16); the store rows stay in 180-store.sql.
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), true,
  'media_asset_hidden: an asset only on a followers post is hidden from the stranger M3');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a6'), true,
  'media_asset_hidden: M4''s followers-only asset is hidden from the stranger M3');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a2'), false,
  'media_asset_hidden: false when the asset is also on an organization post');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a3'), false,
  'media_asset_hidden: false for an asset on no post (the composer''s preview)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), true,
  'media_asset_hidden: STILL hidden from the stranger M3 once the only followers post carrying it is soft-deleted (WR-01)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), true,
  'media_asset_hidden: hidden from the follower M2 once the only followers post is soft-deleted (the takedown closes it, WR-01)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), true,
  'media_asset_hidden: hidden from the author M1 once their own followers post is soft-deleted');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), false,
  'media_asset_hidden: NOT hidden from the admin_tenant after the deletion (moderation evidence, D-475)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), false,
  'media_asset_hidden: NOT hidden from the system lane (zero user) after the deletion');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), true,
  'media_asset_hidden: a REAL support_tenant is not exempt for the deleted followers post: hidden');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), false,
  'media_asset_hidden: false for a deleted followers post in another tenant''s lane (tenant pin, T-09-48)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a7'), false,
  'media_asset_hidden: a7 (deleted followers post AND a live organization post) is NOT hidden: the live visible carrier wins (EP-61)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a8'), false,
  'media_asset_hidden: a8 (only a soft-deleted ORGANIZATION post) stays false: the new branch is limited to followers (EP-62)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a9'), false,
  'media_asset_hidden: a9 (deleted followers post AND a live followers post of M4) is open to the follower M2 (EP-61)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a9'), true,
  'media_asset_hidden: a9 stays hidden from the stranger M3 (EP-61)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), false,
  'media_asset_hidden: false for the follower M2 (follows M1)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a6'), false,
  'media_asset_hidden: false for the follower M2 (follows M4)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000004');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), false,
  'media_asset_hidden: false for the author M1');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), false,
  'media_asset_hidden: false for the admin_tenant (moderator view)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), false,
  'media_asset_hidden: false for the system user (workers keep reading)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), true,
  'media_asset_hidden: a REAL support_tenant is not exempt: hidden');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000011', '20100000-0000-4000-8000-000000000012');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), false,
  'media_asset_hidden: false in another tenant''s lane (tenant pin, T-09-09)');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a1'), true,
  'media_asset_hidden: with social OFF even the follower M2 is refused (D-483)');
reset role;
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.media_asset_hidden('20100000-0000-4000-8000-0000000000a5'), true,
  'media_asset_hidden: with social OFF even the admin_tenant is refused the deleted followers post (D-483, T-09-48)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '20100000-0000-4000-8000-000000000001' and module_key = 'social';

-- ── 7. the Explorar plans on a volume fixture (09-04, SOCIAL-10, T-09-11) ───────────────────────
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'feed_posts'
             and indexname = 'feed_posts_tenant_followers_created_idx'
             and indexdef like '%(tenant_id, created_at DESC, id DESC) WHERE (visibility = ''followers''::text)%'),
  '7: feed_posts_tenant_followers_created_idx exists by name: (tenant_id, created_at desc, id desc) where visibility = ''followers''');
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'feed_posts'
             and indexname = 'feed_posts_tenant_org_created_idx'
             and indexdef like '%(tenant_id, created_at DESC, id DESC) WHERE (visibility = ''tenant''::text)%'),
  '7: feed_posts_tenant_org_created_idx exists by name, partial on visibility = ''tenant''');
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'feed_posts'
             and indexname = 'feed_posts_tenant_org_nocommunity_created_idx'
             and indexdef like '%(tenant_id, created_at DESC, id DESC) WHERE ((visibility = ''tenant''::text) AND (community_id IS NULL))%'),
  '7: feed_posts_tenant_org_nocommunity_created_idx exists by name, partial on visibility = ''tenant'' and community_id is null');

-- 60 volume members (tenant A) plus the two probes: F50 follows members 1..50, F3 follows the rare 58..60.
select tests.auth_user('v' || g || '@fsocial-a.local', ('20100000-0000-4000-8000-00000e' || lpad(g::text, 6, '0'))::uuid)
  from generate_series(1, 62) g;
insert into public.memberships (tenant_id, user_id, role, status)
select '20100000-0000-4000-8000-000000000001', ('20100000-0000-4000-8000-00000e' || lpad(g::text, 6, '0'))::uuid, 'member', 'active'
  from generate_series(1, 62) g;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-00000e000061',
       ('20100000-0000-4000-8000-00000e' || lpad(g::text, 6, '0'))::uuid
  from generate_series(1, 50) g;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-00000e000062',
       ('20100000-0000-4000-8000-00000e' || lpad(g::text, 6, '0'))::uuid
  from generate_series(58, 60) g;

-- 6,000 member posts: authors 1..57 in turn, except every 53rd, which belongs to one of the rare 58..60.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, created_at)
select ('20100000-0000-4000-8000-0000f1' || lpad(to_hex(g), 6, '0'))::uuid,
       '20100000-0000-4000-8000-000000000001',
       ('20100000-0000-4000-8000-00000e' ||
          lpad((case when g % 53 = 0 then 58 + (g % 3) else 1 + (g % 57) end)::text, 6, '0'))::uuid,
       'volume membro ' || g, 'followers',
       now() - (g || ' seconds')::interval
  from generate_series(1, 6000) g;
-- 1,200 organization posts by the admin, interleaved with them.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, created_at)
select ('20100000-0000-4000-8000-0000f2' || lpad(to_hex(g), 6, '0'))::uuid,
       '20100000-0000-4000-8000-000000000001',
       '20100000-0000-4000-8000-000000000002',
       'volume organizacao ' || g, 'tenant',
       now() - (g * 5 || ' seconds')::interval - interval '2 seconds'
  from generate_series(1, 1200) g;
analyze public.feed_posts;
analyze public.memberships;
analyze public.social_follows;

-- Captured through a temporary table the `authenticated` role may write, because EXPLAIN cannot be a
-- subquery and the plans must be taken INSIDE the viewer's lane. TEXT format, so that
-- `Seq Scan on feed_posts` is literally what a sequential scan prints (120's lesson).
create temporary table explorar_plans (name text primary key, plan text);
grant all on explorar_plans to authenticated;

select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-00000e000061');
do $$
declare
  r record;
  v_plan text;
begin
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      join public.memberships ms on ms.user_id = p.author_user_id
      where p.deleted_at is null
        and p.visibility = ''followers'' and p.community_id is null
        and (p.visibility = ''tenant''
             or ((select app.social_enabled())
                 and p.author_user_id = any (coalesce((select app.social_visible_author_ids()), ''{}''::uuid[]))))
      order by p.created_at desc, p.id desc limit 12'
  loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  insert into explorar_plans values ('f50', v_plan);
end
$$;
reset role;

select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-00000e000062');
do $$
declare
  r record;
  v_plan text;
begin
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      join public.memberships ms on ms.user_id = p.author_user_id
      where p.deleted_at is null
        and p.visibility = ''followers'' and p.community_id is null
        and (p.visibility = ''tenant''
             or ((select app.social_enabled())
                 and p.author_user_id = any (coalesce((select app.social_visible_author_ids()), ''{}''::uuid[]))))
      order by p.created_at desc, p.id desc limit 12'
  loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  insert into explorar_plans values ('f3', v_plan);

  -- A deep page: the keyset predicate of a cursor 1,000 rows down the timeline.
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      join public.memberships ms on ms.user_id = p.author_user_id
      where p.deleted_at is null
        and p.visibility = ''followers'' and p.community_id is null
        and (p.visibility = ''tenant''
             or ((select app.social_enabled())
                 and p.author_user_id = any (coalesce((select app.social_visible_author_ids()), ''{}''::uuid[]))))
        and (p.created_at, p.id) < (now() - interval ''1000 seconds'', ''20100000-0000-4000-8000-0000f1000000''::uuid)
      order by p.created_at desc, p.id desc limit 12'
  loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  insert into explorar_plans values ('f3_deep', v_plan);
end
$$;
reset role;

-- The moderator: no author predicate, the liveness test of the author's membership instead.
select tests.as_tenant('20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', 'admin_tenant');
do $$
declare
  r record;
  v_plan text;
begin
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      join public.memberships ms on ms.user_id = p.author_user_id
      where p.deleted_at is null
        and p.visibility = ''followers'' and p.community_id is null
        and (p.visibility = ''tenant''
             or ((select app.social_enabled())
                 and ms.status = ''active'' and ms.blocked_at is null and ms.deleted_at is null))
      order by p.created_at desc, p.id desc limit 12'
  loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  insert into explorar_plans values ('moderator', v_plan);
end
$$;
reset role;

select matches((select plan from explorar_plans where name = 'f50'),
  'feed_posts_tenant_followers_created_idx',
  '7: Explorar for a member who follows 50 authors is served by feed_posts_tenant_followers_created_idx BY NAME');
select ok((select plan from explorar_plans where name = 'f50') not like '%Seq Scan on feed_posts%',
  '7: …and is never a Seq Scan on feed_posts');
select matches((select plan from explorar_plans where name = 'f3'),
  'feed_posts_tenant_followers_created_idx',
  '7: Explorar for a member who follows the 3 rare authors is served by feed_posts_tenant_followers_created_idx BY NAME');
select ok((select plan from explorar_plans where name = 'f3') not like '%Seq Scan on feed_posts%',
  '7: …and is never a Seq Scan on feed_posts');
select matches((select plan from explorar_plans where name = 'f3_deep'),
  'feed_posts_tenant_followers_created_idx',
  '7: a deep Explorar page (keyset cursor) is served by the same index BY NAME');
select ok((select plan from explorar_plans where name = 'moderator') not like '%Seq Scan on feed_posts%'
          and (select plan from explorar_plans where name = 'moderator') like '%feed_posts_tenant_followers_created_idx%',
  '7: the moderator''s all-members read is served by feed_posts_tenant_followers_created_idx BY NAME, never a Seq Scan');
select ok((select plan from explorar_plans where name = 'f3_deep') not like '%Seq Scan on feed_posts%',
  '7: …and the deep page is never a Seq Scan on feed_posts');

select * from finish();
rollback;
