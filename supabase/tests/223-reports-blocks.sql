begin;
-- 223-reports-blocks.sql — NATIVE-31 / NATIVE-33 data halves, D-616, T-13-21, T-13-22, T-13-23, proved inside
-- Postgres (13-08): the minimum report and member-block slice the store policies require. A member reports a
-- post or a comment of their own tenant, the report is read by the reporter and the tenant's `admin_tenant` and
-- by no one else, a member blocks another member, and the block is visible to the blocker only. The rules are
-- `*_reports_blocks_functions.sql`; the tables are `*_reports_blocks.sql`.
--
-- 0. Shape and privileges: five functions (four definers with `search_path=""`, one `security invoker` stable
--    predicate), none executable by `anon`, all by `authenticated`; one select policy per table and no write
--    policy, so a direct insert, update or delete from a member lane changes nothing.
-- 1. The CHECKs and keys, written directly as the table owner: a note of 500 characters (not bytes) is accepted and
--    501 refused (23514), an unknown reason, subject type or status, `open` with a `resolved_at` and a resolved
--    status without one are refused, the excerpt is capped at 280, the duplicate is 23505, a self block is 23514.
-- 2. `app.content_report_create`: another member's post and comment, a duplicate (23505), the caller's own content
--    (RP001), a deleted, foreign-tenant or unknown subject (RP002), an unknown type (22023), a blocked, deleted or
--    claim-less caller (42501), two reporters of one comment, the same uuid as a post and as a comment, the
--    snapshot (author, excerpt cut at 280 code points, an emoji at the boundary never split).
-- 3. Visibility: the reporter reads their own rows and not another reporter's; `admin_tenant` reads every row of
--    the tenant; the reported author, a third member, a `support_tenant` and an admin of tenant B read none.
-- 4. `app.content_report_resolve`: admin only (a member, support, a blocked admin, no claim: 42501), `open` goes to
--    each of the three states once, a second resolve is RP004, the resolver and the instant are written, a report
--    of another tenant is not found (RP002), and nothing is removed.
-- 5. Blocks: create is idempotent, delete of a non-block is a no-op, self, staff, foreign-tenant, blocked, deleted
--    and unknown targets are BL001, the blocker's row is invisible to the blocked member, a third member and the
--    admin, `is_blocked_by_viewer` is true for the blocker only, and a block of tenant A is no block in tenant B
--    for the same two user ids.
-- 6. `app.account_anonymise` for a due member deletes their blocks as blocker and as blocked and nulls the note
--    of the reports they filed, in that tenant only; the other tenant's rows of the same user are untouched.
--
-- Fixture ids use the `22300000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(147);

-- ── helpers (session-local) ───────────────────────────────────────────────────────────────────
-- u('a3') a user id, t('a') a tenant id, po('a1') a post id, co('a1') a comment id.
create function pg_temp.u(p text) returns uuid language sql immutable as
  $$ select ('22300000-0000-4000-8000-0000000000' || p)::uuid $$;
create function pg_temp.po(p text) returns uuid language sql immutable as
  $$ select ('22300000-0000-4000-8000-0000000004' || p)::uuid $$;
create function pg_temp.co(p text) returns uuid language sql immutable as
  $$ select ('22300000-0000-4000-8000-0000000005' || p)::uuid $$;
create function pg_temp.t(p text) returns uuid language sql immutable as
  $$ select (case p when 'a' then '22300000-0000-4000-8000-000000000001'
                    when 'b' then '22300000-0000-4000-8000-000000000011'
                    else '22300000-0000-4000-8000-000000000021' end)::uuid $$;
-- Runs one DML statement under the current lane and answers how many rows it changed; -1 when the lane has no
-- privilege or no policy lets the statement through (42501).
create function pg_temp.try_dml(p text) returns int language plpgsql as $$
declare n int;
begin
  execute p;
  get diagnostics n = row_count;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;
-- A hash of every report and block of one tenant.
create function pg_temp.rb_hash(p uuid) returns text language sql stable as $$
  select md5(coalesce(string_agg(r, '|' order by r), '')) from (
    select 'r:' || to_jsonb(x)::text r from public.content_reports x where x.tenant_id = p
    union all select 'b:' || to_jsonb(x)::text from public.member_blocks x where x.tenant_id = p
  ) q $$;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-rb-a', 'Reports A', pg_temp.t('a'));
select tests.tenant('pgtap-rb-b', 'Reports B', pg_temp.t('b'));
select tests.tenant('pgtap-rb-c', 'Reports C', pg_temp.t('c'));
-- A: a1 admin, a2 support, a3 the main reporter and blocker, a4 the author of the reported content, a5 a third
-- member, a6 blocked, a7 soft-deleted, a8 and a9 more reporters, aa a blocked admin, ac a due member (section 6),
-- ad the one a3 and a4 block in section 6 as a control. B: b1 admin, b2 author, b3 member, and a3, a4 and ac also
-- hold a membership there (one identity, several tenants). C holds only the rows the CHECK tests write directly.
select tests.auth_user('a1@rb-a.local', pg_temp.u('a1'));
select tests.auth_user('a2@rb-a.local', pg_temp.u('a2'));
select tests.auth_user('a3@rb-a.local', pg_temp.u('a3'));
select tests.auth_user('a4@rb-a.local', pg_temp.u('a4'));
select tests.auth_user('a5@rb-a.local', pg_temp.u('a5'));
select tests.auth_user('a6@rb-a.local', pg_temp.u('a6'));
select tests.auth_user('a7@rb-a.local', pg_temp.u('a7'));
select tests.auth_user('a8@rb-a.local', pg_temp.u('a8'));
select tests.auth_user('a9@rb-a.local', pg_temp.u('a9'));
select tests.auth_user('aa@rb-a.local', pg_temp.u('aa'));
select tests.auth_user('ac@rb-a.local', pg_temp.u('ac'));
select tests.auth_user('ad@rb-a.local', pg_temp.u('ad'));
select tests.auth_user('b1@rb-b.local', pg_temp.u('b1'));
select tests.auth_user('b2@rb-b.local', pg_temp.u('b2'));
select tests.auth_user('b3@rb-b.local', pg_temp.u('b3'));
select tests.auth_user('c1@rb-c.local', pg_temp.u('c1'));

insert into public.memberships (tenant_id, user_id, role, status) values
  (pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant', 'active'),
  (pg_temp.t('a'), pg_temp.u('a2'), 'support_tenant', 'active'),
  (pg_temp.t('a'), pg_temp.u('a3'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('a4'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('a5'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('a6'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('a7'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('a8'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('a9'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('aa'), 'admin_tenant', 'active'),
  (pg_temp.t('a'), pg_temp.u('ac'), 'member', 'active'),
  (pg_temp.t('a'), pg_temp.u('ad'), 'member', 'active'),
  (pg_temp.t('b'), pg_temp.u('b1'), 'admin_tenant', 'active'),
  (pg_temp.t('b'), pg_temp.u('b2'), 'member', 'active'),
  (pg_temp.t('b'), pg_temp.u('b3'), 'member', 'active'),
  (pg_temp.t('b'), pg_temp.u('a3'), 'member', 'active'),
  (pg_temp.t('b'), pg_temp.u('a4'), 'member', 'active'),
  (pg_temp.t('b'), pg_temp.u('ac'), 'member', 'active');
-- a6 and aa blocked, a7 soft-deleted.
update public.memberships set status = 'blocked', blocked_at = now()
 where tenant_id = pg_temp.t('a') and user_id in (pg_temp.u('a6'), pg_temp.u('aa'));
update public.memberships set deleted_at = now()
 where tenant_id = pg_temp.t('a') and user_id = pg_temp.u('a7');

-- Content of tenant A: pa1 a live post, pa2 a3's own, pa3 deleted, pa4 281 characters, pa5 exactly 280, pa6 an
-- emoji at position 280, pa7 an emoji at position 281, and `fffff` a post and a comment sharing one id.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind, deleted_at) values
  (pg_temp.po('a1'), pg_temp.t('a'), pg_temp.u('a4'), 'post do a4', 'tenant', 'none', null),
  (pg_temp.po('a2'), pg_temp.t('a'), pg_temp.u('a3'), 'post proprio de a3', 'tenant', 'none', null),
  (pg_temp.po('a3'), pg_temp.t('a'), pg_temp.u('a4'), 'post apagado', 'tenant', 'none', now()),
  (pg_temp.po('a4'), pg_temp.t('a'), pg_temp.u('a4'), repeat('x', 281), 'tenant', 'none', null),
  (pg_temp.po('a5'), pg_temp.t('a'), pg_temp.u('a4'), repeat('y', 280), 'tenant', 'none', null),
  (pg_temp.po('a6'), pg_temp.t('a'), pg_temp.u('a4'), repeat('z', 279) || '😀' || 'resto', 'tenant', 'none', null),
  (pg_temp.po('a7'), pg_temp.t('a'), pg_temp.u('a4'), repeat('w', 280) || '😀', 'tenant', 'none', null),
  ('22300000-0000-4000-8000-0000000fffff', pg_temp.t('a'), pg_temp.u('a4'), 'post com o mesmo id', 'tenant', 'none', null),
  (pg_temp.po('b1'), pg_temp.t('b'), pg_temp.u('b2'), 'post de b', 'tenant', 'none', null);
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind, deleted_at) values
  (pg_temp.co('a1'), pg_temp.t('a'), pg_temp.po('a1'), pg_temp.u('a4'), 'comentario do a4', 0, null, null, null, null),
  (pg_temp.co('a2'), pg_temp.t('a'), pg_temp.po('a1'), pg_temp.u('a4'), 'comentario apagado', 0, null, null, null, now()),
  (pg_temp.co('a3'), pg_temp.t('a'), pg_temp.po('a1'), pg_temp.u('a3'), 'comentario proprio de a3', 0, null, null, null, null),
  ('22300000-0000-4000-8000-0000000fffff', pg_temp.t('a'), pg_temp.po('a1'), pg_temp.u('a4'), 'comentario com o mesmo id', 0, null, null, null, null),
  (pg_temp.co('b1'), pg_temp.t('b'), pg_temp.po('b1'), pg_temp.u('b2'), 'comentario de b', 0, null, null, null, null);

-- ── 0. shape and privileges ───────────────────────────────────────────────────────────────────
select ok(
  (select count(*) = 4 and bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
    where oid in (to_regprocedure('app.member_block_create(uuid)'),
                  to_regprocedure('app.member_block_delete(uuid)'),
                  to_regprocedure('app.content_report_create(text,uuid,text,text)'),
                  to_regprocedure('app.content_report_resolve(uuid,text)'))),
  'fact 0: the four writers exist and are SECURITY DEFINER with search_path pinned to ""'
);
select ok(
  (select count(*) = 1 and bool_and(not prosecdef and provolatile = 's' and 'search_path=""' = any(proconfig)) from pg_proc
    where oid = to_regprocedure('app.is_blocked_by_viewer(uuid)')),
  'fact 0: app.is_blocked_by_viewer exists and is SECURITY INVOKER, STABLE, with search_path pinned to ""'
);
select ok(
  (select count(*) = 5 and not bool_or(has_function_privilege('anon', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.is_blocked_by_viewer(uuid)'),
                  to_regprocedure('app.member_block_create(uuid)'),
                  to_regprocedure('app.member_block_delete(uuid)'),
                  to_regprocedure('app.content_report_create(text,uuid,text,text)'),
                  to_regprocedure('app.content_report_resolve(uuid,text)'))),
  'fact 0: anon cannot execute any of the five functions'
);
select ok(
  (select count(*) = 5 and bool_and(has_function_privilege('authenticated', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.is_blocked_by_viewer(uuid)'),
                  to_regprocedure('app.member_block_create(uuid)'),
                  to_regprocedure('app.member_block_delete(uuid)'),
                  to_regprocedure('app.content_report_create(text,uuid,text,text)'),
                  to_regprocedure('app.content_report_resolve(uuid,text)'))),
  'fact 0 positive control: authenticated can execute the five (the resolve refuses a non-admin inside, section 4)'
);
select ok(
  (select bool_and(c.relrowsecurity) and count(*) = 2 from pg_class c
    where c.oid in ('public.content_reports'::regclass, 'public.member_blocks'::regclass)),
  'fact 0: RLS is enabled on both tables'
);
select results_eq(
  $$ select polrelid::regclass::text, polcmd::text from pg_policy
      where polrelid in ('public.content_reports'::regclass, 'public.member_blocks'::regclass)
      order by 1 $$,
  $$ values ('content_reports', 'r'), ('member_blocks', 'r') $$,
  'fact 0: exactly ONE policy per table and it is a SELECT policy (no insert, update or delete policy)'
);
-- Writes from a member lane change nothing.
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
     values ('22300000-0000-4000-8000-000000000001', '22300000-0000-4000-8000-0000000000a3', 'feed_post',
             '22300000-0000-4000-8000-0000000004a1', '22300000-0000-4000-8000-0000000000a4', 'spam') $$,
  '42501', null,
  'fact 0 (T-13-22): a member lane cannot insert a report directly (no insert policy)'
);
select throws_ok(
  $$ insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
     values ('22300000-0000-4000-8000-000000000001', '22300000-0000-4000-8000-0000000000a3',
             '22300000-0000-4000-8000-0000000000a5') $$,
  '42501', null,
  'fact 0 (T-13-22): a member lane cannot insert a block directly (no insert policy)'
);
select ok(
  pg_temp.try_dml($$ update public.content_reports set status = 'dismissed' $$) <= 0
  and pg_temp.try_dml($$ delete from public.content_reports $$) <= 0
  and pg_temp.try_dml($$ update public.member_blocks set blocked_user_id = blocker_user_id $$) <= 0
  and pg_temp.try_dml($$ delete from public.member_blocks $$) <= 0,
  'fact 0 (T-13-22): a member lane changes no row of either table by update or delete'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant');
select ok(
  pg_temp.try_dml($$ update public.content_reports set status = 'dismissed' $$) <= 0
  and pg_temp.try_dml($$ delete from public.content_reports $$) <= 0,
  'fact 0 (T-13-23): not even the admin lane changes a report outside the resolve function'
);
reset role;

-- ── 1. the CHECKs and keys, written directly as the table owner (tenant C) ────────────────────
select lives_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, note)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', repeat('n', 500)) $$,
  'fact 1 (boundary): a note of 500 characters is accepted'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, note)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', repeat('n', 501)) $$,
  '23514', null,
  'fact 1 (boundary): a note of 501 characters is refused (23514)'
);
select lives_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, note)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', repeat('é', 500)) $$,
  'fact 1 (boundary): the cap counts characters, not bytes (500 two-byte characters are accepted)'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'rude') $$,
  '23514', null,
  'fact 1: an unknown reason is refused (23514)'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'story',
             gen_random_uuid(), gen_random_uuid(), 'spam') $$,
  '23514', null,
  'fact 1: an unknown subject type is refused (23514; Phase 11 appends story_comment, community, direct_message)'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, status)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', 'archived') $$,
  '23514', null,
  'fact 1: an unknown status is refused (23514)'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, status, resolved_at)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', 'open', now()) $$,
  '23514', null,
  'fact 1: status open with a resolved_at is refused (23514)'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, status)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', 'dismissed') $$,
  '23514', null,
  'fact 1: a resolved status without a resolved_at is refused (23514)'
);
select lives_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, status, resolved_at)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'post_comment',
             gen_random_uuid(), gen_random_uuid(), 'harassment', 'author_blocked', now()) $$,
  'fact 1 positive control: a resolved status with its resolved_at is accepted'
);
select lives_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'post_comment',
             gen_random_uuid(), gen_random_uuid(), 'sexual_violent') $$,
  'fact 1 positive control: an open report with no resolution and every other default is accepted'
);
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, excerpt)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', repeat('e', 281)) $$,
  '23514', null,
  'fact 1 (boundary): an excerpt of 281 characters is refused by the table (23514)'
);
select lives_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, excerpt)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             gen_random_uuid(), gen_random_uuid(), 'spam', repeat('e', 280)) $$,
  'fact 1 (boundary): an excerpt of 280 characters is accepted'
);
insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason) values
  (pg_temp.t('c'), pg_temp.u('c1'), 'feed_post', '22300000-0000-4000-8000-0000000000d1', pg_temp.u('c1'), 'spam');
select throws_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'feed_post',
             '22300000-0000-4000-8000-0000000000d1', gen_random_uuid(), 'other') $$,
  '23505', null,
  'fact 1 (AD-6): the same reporter, tenant, type and subject twice is the unique violation (23505)'
);
select lives_ok(
  $$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1', 'post_comment',
             '22300000-0000-4000-8000-0000000000d1', gen_random_uuid(), 'other') $$,
  'fact 1 positive control (adjacency): the same reporter and id under the OTHER type is a different row'
);
select throws_ok(
  $$ insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1',
             '22300000-0000-4000-8000-0000000000c1') $$,
  '23514', null,
  'fact 1: a block of oneself is refused by the table (23514)'
);
select lives_ok(
  $$ insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1',
             '22300000-0000-4000-8000-0000000000a1') $$,
  'fact 1 positive control: a block of another user is accepted'
);
select throws_ok(
  $$ insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
     values ('22300000-0000-4000-8000-000000000021', '22300000-0000-4000-8000-0000000000c1',
             '22300000-0000-4000-8000-0000000000a1') $$,
  '23505', null,
  'fact 1: the same block twice is the primary key violation (23505)'
);

-- ── 2. app.content_report_create ──────────────────────────────────────────────────────────────
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select lives_ok(
  $$ select app.content_report_create('post_comment', '22300000-0000-4000-8000-0000000005a1', 'harassment', 'nota') $$,
  'fact 2: a live member reports another member''s comment'
);
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'spam', null) $$,
  'fact 2: a live member reports another member''s post'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'offensive', null) $$,
  '23505', null,
  'fact 2 (AD-6): the same reporter reporting the same post twice is the unique violation (23505)'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a2', 'spam', null) $$,
  'RP001', null,
  'fact 2 (T-13-22): reporting one''s own post is RP001'
);
select throws_ok(
  $$ select app.content_report_create('post_comment', '22300000-0000-4000-8000-0000000005a3', 'spam', null) $$,
  'RP001', null,
  'fact 2 (T-13-22): reporting one''s own comment is RP001'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a3', 'spam', null) $$,
  'RP002', null,
  'fact 2: a deleted post is RP002 (the live predicate)'
);
select throws_ok(
  $$ select app.content_report_create('post_comment', '22300000-0000-4000-8000-0000000005a2', 'spam', null) $$,
  'RP002', null,
  'fact 2: a deleted comment is RP002 (the live predicate)'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004b1', 'spam', null) $$,
  'RP002', null,
  'fact 2 (T-13-22): a post of tenant B reported under tenant A''s lane is RP002'
);
select throws_ok(
  $$ select app.content_report_create('post_comment', '22300000-0000-4000-8000-0000000005b1', 'spam', null) $$,
  'RP002', null,
  'fact 2 (T-13-22): a comment of tenant B reported under tenant A''s lane is RP002'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', gen_random_uuid(), 'spam', null) $$,
  'RP002', null,
  'fact 2: a subject id that exists nowhere is RP002'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000005a1', 'spam', null) $$,
  'RP002', null,
  'fact 2: a comment id given as a post is RP002 (the type picks the table)'
);
select throws_ok(
  $$ select app.content_report_create('story_comment', '22300000-0000-4000-8000-0000000005a1', 'spam', null) $$,
  '22023', null,
  'fact 2: a subject type this phase does not know is 22023 (Phase 11 appends the others)'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a5', 'rude', null) $$,
  '23514', null,
  'fact 2: an unknown reason is the CHECK violation (23514)'
);
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a5', 'spam', repeat('n', 501)) $$,
  '23514', null,
  'fact 2 (boundary): a note of 501 characters through the function is 23514'
);
reset role;
select is(
  (select count(*)::int from public.content_reports
    where tenant_id = pg_temp.t('a') and subject_id = pg_temp.po('a5')),
  0,
  'fact 2: the refused calls above wrote nothing'
);
-- Two reporters of one comment, and a post and a comment that share one id.
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a8'));
select lives_ok(
  $$ select app.content_report_create('post_comment', '22300000-0000-4000-8000-0000000005a1', 'spam', null) $$,
  'fact 2 (adjacency): a second reporter of the same comment is accepted'
);
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'other', '') $$,
  'fact 2: an empty note is accepted'
);
reset role;
select is(
  (select count(*)::int from public.content_reports
    where tenant_id = pg_temp.t('a') and subject_type = 'post_comment' and subject_id = pg_temp.co('a1')),
  2,
  'fact 2 (adjacency): two different reporters of one comment make two rows'
);
select ok(
  (select note is null from public.content_reports
    where tenant_id = pg_temp.t('a') and reporter_user_id = pg_temp.u('a8') and subject_id = pg_temp.po('a1')),
  'fact 2: an empty note is stored as null'
);
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000fffff', 'spam', null) $$,
  'fact 2 (adjacency): the post with the shared id is reported'
);
select lives_ok(
  $$ select app.content_report_create('post_comment', '22300000-0000-4000-8000-0000000fffff', 'spam', null) $$,
  'fact 2 (adjacency): the comment with the SAME id is reported by the same reporter'
);
reset role;
select is(
  (select count(*)::int from public.content_reports
    where tenant_id = pg_temp.t('a') and reporter_user_id = pg_temp.u('a3')
      and subject_id = '22300000-0000-4000-8000-0000000fffff'),
  2,
  'fact 2 (adjacency): the type is part of the key, so one reporter and one uuid make two rows'
);
-- Refused callers.
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a6'));
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'spam', null) $$,
  '42501', null,
  'fact 2: a blocked member cannot report (42501)'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a7'));
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'spam', null) $$,
  '42501', null,
  'fact 2: a soft-deleted member cannot report (42501)'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('b3'));
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'spam', null) $$,
  '42501', null,
  'fact 2 (T-13-22): a user with no membership in tenant A, under tenant A''s claim, cannot report (42501)'
);
reset role;
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'spam', null) $$,
  '42501', null,
  'fact 2: a lane with no claim cannot report (42501)'
);
reset role;
-- The snapshot.
select ok(
  (select author_user_id = pg_temp.u('a4') and excerpt = 'comentario do a4' and status = 'open'
          and resolved_at is null and resolved_by_user_id is null and note = 'nota'
          and reason = 'harassment' and tenant_id = pg_temp.t('a')
     from public.content_reports
    where reporter_user_id = pg_temp.u('a3') and subject_id = pg_temp.co('a1')),
  'fact 2: the report snapshots the author at report time, the comment body, the reason and the note, and is open'
);
select ok(
  (select author_user_id = pg_temp.u('a4') and excerpt = 'post do a4'
     from public.content_reports
    where reporter_user_id = pg_temp.u('a3') and subject_id = pg_temp.po('a1')),
  'fact 2: a post report snapshots the caption'
);
-- Excerpt cut by code points (reporter a9).
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a9'));
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a4', 'spam', null) $$,
  'fact 2 (boundary): a post of 281 characters is reported'
);
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a5', 'spam', null) $$,
  'fact 2 (boundary): a post of exactly 280 characters is reported'
);
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a6', 'spam', null) $$,
  'fact 2 (precision): a post with an emoji at position 280 is reported'
);
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a7', 'spam', null) $$,
  'fact 2 (precision): a post with an emoji at position 281 is reported'
);
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004a1', 'spam', repeat('n', 500)) $$,
  'fact 2 (boundary): a note of exactly 500 characters through the function is accepted'
);
reset role;
select is(
  (select char_length(excerpt) from public.content_reports where reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a4')),
  280,
  'fact 2 (boundary): a source of 281 characters is cut to exactly 280'
);
select is(
  (select excerpt from public.content_reports where reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a5')),
  repeat('y', 280),
  'fact 2 (boundary): a source of exactly 280 characters is kept whole'
);
select ok(
  (select char_length(excerpt) = 280 and right(excerpt, 1) = '😀' and left(excerpt, 279) = repeat('z', 279)
     from public.content_reports where reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a6')),
  'fact 2 (precision): an emoji at position 280 is kept whole, never half'
);
select ok(
  (select char_length(excerpt) = 280 and excerpt = repeat('w', 280)
     from public.content_reports where reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a7')),
  'fact 2 (precision): an emoji at position 281 is dropped entirely, never cut in half'
);
select ok(
  (select char_length(note) = 500 from public.content_reports
    where reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a1')),
  'fact 2 (boundary): the 500-character note is stored whole'
);
select ok(
  (select created_at = now() and pg_typeof(created_at)::text = 'timestamp with time zone'
     from public.content_reports where reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a1')),
  'fact 2 (precision): created_at is a timestamptz set from the database clock'
);

-- ── 3. visibility ─────────────────────────────────────────────────────────────────────────────
-- Tenant A now holds 11 reports: a3 four (comment a1, post a1, the shared id as post and as comment), a8 two,
-- a9 five. Tenant B gets one, by b3.
select tests.as_tenant(pg_temp.t('b'), pg_temp.u('b3'));
select lives_ok(
  $$ select app.content_report_create('feed_post', '22300000-0000-4000-8000-0000000004b1', 'spam', 'nota de b') $$,
  'fact 3 setup: a member of tenant B reports tenant B''s post'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select is((select count(*)::int from public.content_reports), 4,
  'fact 3 positive control: the reporter reads exactly their own four rows');
select is((select count(*)::int from public.content_reports where reporter_user_id <> app.user_id()), 0,
  'fact 3 (T-13-21): …and not one row of another reporter (set compared against empty)');
select is((select count(*)::int from public.content_reports where reporter_user_id = pg_temp.u('a8')), 0,
  'fact 3 (T-13-21): …in particular not a8''s report of the very same comment');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a8'));
select is((select count(*)::int from public.content_reports), 2,
  'fact 3 positive control: a second reporter reads exactly their own two rows');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a4'));
select is((select count(*)::int from public.content_reports), 0,
  'fact 3 (T-13-21): the author of the reported content reads no report (set compared against empty)');
select is((select count(*)::int from public.content_reports where author_user_id = app.user_id()), 0,
  'fact 3 (T-13-21): …not even the rows that name them as the author');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a5'));
select is((select count(*)::int from public.content_reports), 0,
  'fact 3 (T-13-21): a third member reads no report (set compared against empty)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a2'), 'support_tenant');
select is((select count(*)::int from public.content_reports), 0,
  'fact 3 (T-13-21): the support team reads no report (set compared against empty)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant');
select is((select count(*)::int from public.content_reports), 11,
  'fact 3 positive control: the admin of tenant A reads every one of the tenant''s 11 reports');
select is((select count(*)::int from public.content_reports where tenant_id <> app.tenant_id()), 0,
  'fact 3 (T-13-22): …and none of another tenant''s');
reset role;
select tests.as_tenant(pg_temp.t('b'), pg_temp.u('b1'), 'admin_tenant');
select is((select count(*)::int from public.content_reports), 1,
  'fact 3 positive control: the admin of tenant B reads tenant B''s one report');
select is((select count(*)::int from public.content_reports where tenant_id = pg_temp.t('a')), 0,
  'fact 3 (T-13-22): …and none of tenant A''s eleven (set compared against empty)');
reset role;
select tests.as_tenant(pg_temp.t('b'), pg_temp.u('a3'));
select is((select count(*)::int from public.content_reports), 0,
  'fact 3 (T-13-22): the same user id that reported in tenant A reads nothing of it from tenant B');
reset role;
select tests.as_tenant_without_claims();
select is((select count(*)::int from public.content_reports), 0,
  'fact 3: a lane with no claim reads no report');
reset role;

-- ── 4. app.content_report_resolve ─────────────────────────────────────────────────────────────
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select throws_ok(
  $$ select app.content_report_resolve((select id from public.content_reports where subject_id = '22300000-0000-4000-8000-0000000005a1'), 'dismissed') $$,
  '42501', null,
  'fact 4 (T-13-23): a member, even the reporter of that very report, cannot resolve it (42501)'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a2'), 'support_tenant');
select throws_ok(
  $$ select app.content_report_resolve(gen_random_uuid(), 'dismissed') $$,
  '42501', null,
  'fact 4 (T-13-23): a support member cannot resolve (42501)'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('aa'), 'admin_tenant');
select throws_ok(
  $$ select app.content_report_resolve(gen_random_uuid(), 'dismissed') $$,
  '42501', null,
  'fact 4: a blocked admin (a stale admin claim) cannot resolve (42501)'
);
reset role;
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.content_report_resolve(gen_random_uuid(), 'dismissed') $$,
  '42501', null,
  'fact 4: a lane with no claim cannot resolve (42501)'
);
reset role;
select is(
  (select count(*)::int from public.content_reports where tenant_id = pg_temp.t('a') and status <> 'open'),
  0,
  'fact 4: the refused attempts resolved nothing'
);
-- An admin of tenant B holds a report id of tenant A (carried in a setting, since B's lane cannot read it).
select set_config('rb.a_report', (select id::text from public.content_reports
  where tenant_id = pg_temp.t('a') and reporter_user_id = pg_temp.u('a9') and subject_id = pg_temp.po('a4')), true);
select tests.as_tenant(pg_temp.t('b'), pg_temp.u('b1'), 'admin_tenant');
select throws_ok(
  $$ select app.content_report_resolve(current_setting('rb.a_report')::uuid, 'dismissed') $$,
  'RP002', null,
  'fact 4 (T-13-22): an admin of tenant B resolving a report of tenant A finds nothing (RP002)'
);
select lives_ok(
  $$ select app.content_report_resolve((select id from public.content_reports limit 1), 'dismissed') $$,
  'fact 4 positive control: the same admin resolves tenant B''s own report'
);
reset role;
select is(
  (select status from public.content_reports where id = current_setting('rb.a_report')::uuid),
  'open',
  'fact 4 (T-13-22): tenant A''s report is still open after the cross-tenant attempt'
);
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant');
select lives_ok(
  $$ select app.content_report_resolve((select id from public.content_reports where reporter_user_id = '22300000-0000-4000-8000-0000000000a3' and subject_id = '22300000-0000-4000-8000-0000000005a1'), 'dismissed') $$,
  'fact 4: the admin dismisses an open report'
);
select lives_ok(
  $$ select app.content_report_resolve((select id from public.content_reports where reporter_user_id = '22300000-0000-4000-8000-0000000000a3' and subject_id = '22300000-0000-4000-8000-0000000004a1'), 'content_removed') $$,
  'fact 4: the admin resolves another as content_removed'
);
select results_eq(
  $$ select subject_type, subject_id, author_user_id from app.content_report_resolve((select id from public.content_reports where reporter_user_id = '22300000-0000-4000-8000-0000000000a8' and subject_id = '22300000-0000-4000-8000-0000000005a1'), 'author_blocked') $$,
  $$ values ('post_comment'::text, '22300000-0000-4000-8000-0000000005a1'::uuid, '22300000-0000-4000-8000-0000000000a4'::uuid) $$,
  'fact 4: the third resolution is author_blocked, and the function returns the subject and the author for plan 14'
);
select throws_ok(
  $$ select app.content_report_resolve((select id from public.content_reports where reporter_user_id = '22300000-0000-4000-8000-0000000000a3' and subject_id = '22300000-0000-4000-8000-0000000005a1'), 'content_removed') $$,
  'RP004', null,
  'fact 4: a second resolve of a resolved report, with another resolution, is RP004'
);
select throws_ok(
  $$ select app.content_report_resolve((select id from public.content_reports where reporter_user_id = '22300000-0000-4000-8000-0000000000a3' and subject_id = '22300000-0000-4000-8000-0000000005a1'), 'dismissed') $$,
  'RP004', null,
  'fact 4: …and with the same resolution it is RP004 as well'
);
select throws_ok(
  $$ select app.content_report_resolve((select id from public.content_reports where status = 'open' limit 1), 'open') $$,
  '22023', null,
  'fact 4: open is not a resolution (22023)'
);
select throws_ok(
  $$ select app.content_report_resolve(gen_random_uuid(), 'dismissed') $$,
  'RP002', null,
  'fact 4: an unknown report id is RP002'
);
reset role;
select ok(
  (select status = 'dismissed' and resolved_by_user_id = pg_temp.u('a1') and resolved_at = now()
     from public.content_reports
    where reporter_user_id = pg_temp.u('a3') and subject_id = pg_temp.co('a1')),
  'fact 4: the resolved report carries its status, the resolving admin and the instant, and the RP004 left it alone'
);
select is(
  (select status from public.content_reports where reporter_user_id = pg_temp.u('a3') and subject_id = pg_temp.po('a1')),
  'content_removed',
  'fact 4: the second report holds its own resolution'
);
select is(
  (select count(*)::int from public.content_reports where tenant_id = pg_temp.t('a') and status = 'open'),
  8,
  'fact 4: three of the eleven are resolved and eight stay open'
);
select is(
  (select count(*)::int from public.feed_posts where id = pg_temp.po('a1') and deleted_at is null)
  + (select count(*)::int from public.feed_comments where id = pg_temp.co('a1') and deleted_at is null),
  2,
  'fact 4 (T-13-23): resolving as content_removed removed nothing by itself (post and comment are still live)'
);
select is(
  (select count(*)::int from public.memberships where tenant_id = pg_temp.t('a') and user_id = pg_temp.u('a4')
     and blocked_at is null and status = 'active'),
  1,
  'fact 4 (T-13-23): resolving as author_blocked blocked nobody by itself'
);
-- ── 5. blocks ─────────────────────────────────────────────────────────────────────────────────
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select is(app.member_block_create(pg_temp.u('a4')), true, 'fact 5: a member blocks another member');
select is(app.member_block_create(pg_temp.u('a4')), false, 'fact 5 (NATIVE-33): blocking twice is a no-op');
select is(app.member_block_delete(pg_temp.u('a5')), false, 'fact 5 (NATIVE-33): unblocking a non-block is a no-op');
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a3') $$, 'BL001', null,
  'fact 5 (T-13-22): blocking oneself is BL001');
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a1') $$, 'BL001', null,
  'fact 5 (T-13-23): blocking the admin is BL001 (staff cannot be blocked by a member)');
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a2') $$, 'BL001', null,
  'fact 5 (T-13-23): blocking the support team is BL001');
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000b2') $$, 'BL001', null,
  'fact 5 (T-13-22): blocking a member of tenant B is BL001');
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a6') $$, 'BL001', null,
  'fact 5: blocking an already blocked member is BL001 (not a live member)');
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a7') $$, 'BL001', null,
  'fact 5: blocking a soft-deleted member is BL001');
select throws_ok($$ select app.member_block_create(gen_random_uuid()) $$, 'BL001', null,
  'fact 5: blocking an unknown user is BL001');
select throws_ok($$ select app.member_block_create(null) $$, 'BL001', null,
  'fact 5: blocking nobody is BL001');
select is((select count(*)::int from public.member_blocks), 1,
  'fact 5 positive control: the blocker reads exactly their one block');
select is(app.is_blocked_by_viewer(pg_temp.u('a4')), true, 'fact 5: is_blocked_by_viewer is true for the blocker looking at the blocked member');
select is(app.is_blocked_by_viewer(pg_temp.u('a5')), false, 'fact 5: …and false for a member they did not block');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a4'));
select is(app.is_blocked_by_viewer(pg_temp.u('a3')), false,
  'fact 5 (T-13-21): the blocked member looking at the blocker reads false');
select is((select count(*)::int from public.member_blocks), 0,
  'fact 5 (T-13-21): the blocked member reads no block row (set compared against empty)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a5'));
select is(app.is_blocked_by_viewer(pg_temp.u('a4')), false,
  'fact 5 (T-13-21): a third member looking at the blocked member reads false');
select is(app.is_blocked_by_viewer(pg_temp.u('a3')), false,
  'fact 5 (T-13-21): …and at the blocker');
select is((select count(*)::int from public.member_blocks), 0,
  'fact 5 (T-13-21): a third member reads no block row (set compared against empty)');
select is(app.member_block_delete(pg_temp.u('a4')), false,
  'fact 5 (T-13-22): a third member cannot lift someone else''s block');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant');
select is((select count(*)::int from public.member_blocks), 0,
  'fact 5 (T-13-21): not even the admin reads a member''s block row');
reset role;
select is((select count(*)::int from public.member_blocks where tenant_id = pg_temp.t('a') and blocker_user_id = pg_temp.u('a3')), 1,
  'fact 5: the block is still there after the third member''s attempt to lift it');
-- One identity, two tenants: the block of tenant A is no block in tenant B.
select tests.as_tenant(pg_temp.t('b'), pg_temp.u('a3'));
select is(app.is_blocked_by_viewer(pg_temp.u('a4')), false,
  'fact 5 (T-13-22): the same blocker and target in tenant B read false (a block exists inside one tenant)');
select is((select count(*)::int from public.member_blocks), 0,
  'fact 5 (T-13-22): …and tenant B''s lane reads no block row');
select is(app.member_block_create(pg_temp.u('a4')), true,
  'fact 5 positive control: the same pair can be blocked in tenant B, independently');
select is(app.member_block_delete(pg_temp.u('a4')), true,
  'fact 5: lifting tenant B''s block');
reset role;
select is((select count(*)::int from public.member_blocks where blocker_user_id = pg_temp.u('a3') and blocked_user_id = pg_temp.u('a4')), 1,
  'fact 5 (T-13-22): …lifts tenant B''s row only; tenant A''s block of the same pair remains');
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a6'));
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a5') $$, '42501', null,
  'fact 5: a blocked member cannot block (42501)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a7'));
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a5') $$, '42501', null,
  'fact 5: a soft-deleted member cannot block (42501)');
reset role;
select tests.as_tenant_without_claims();
select throws_ok($$ select app.member_block_create('22300000-0000-4000-8000-0000000000a5') $$, '42501', null,
  'fact 5: a lane with no claim cannot block (42501)');
select throws_ok($$ select app.member_block_delete('22300000-0000-4000-8000-0000000000a5') $$, '42501', null,
  'fact 5: a lane with no claim cannot unblock (42501)');
select is(app.is_blocked_by_viewer(pg_temp.u('a4')), false, 'fact 5: a lane with no claim reads false from the predicate');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select is(app.member_block_delete(pg_temp.u('a4')), true, 'fact 5: the blocker lifts the block');
select is(app.is_blocked_by_viewer(pg_temp.u('a4')), false, 'fact 5: …and the predicate reads false again');
select is(app.member_block_create(pg_temp.u('a4')), true, 'fact 5: blocking again after an unblock creates the row again');
reset role;

-- ── 6. app.account_anonymise ──────────────────────────────────────────────────────────────────
-- ac is DUE in tenant A (requested fifteen days ago, deadline yesterday) and live in tenant B. ac blocked a4 and
-- was blocked by a5 in A, filed a report with a private note in A, and also blocked b3 and filed a noted report in
-- B. a3's block of a4 and a3's reports are the controls of the same tenant.
update public.memberships
   set deleted_at = now() - interval '15 days',
       deletion_requested_at = now() - interval '15 days',
       deletion_due_at = now() - interval '1 day'
 where tenant_id = pg_temp.t('a') and user_id = pg_temp.u('ac');
insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id) values
  (pg_temp.t('a'), pg_temp.u('ac'), pg_temp.u('a4')),
  (pg_temp.t('a'), pg_temp.u('a5'), pg_temp.u('ac')),
  (pg_temp.t('a'), pg_temp.u('a4'), pg_temp.u('a5')),
  (pg_temp.t('b'), pg_temp.u('ac'), pg_temp.u('b3'));
insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, note, excerpt) values
  (pg_temp.t('a'), pg_temp.u('ac'), 'feed_post', pg_temp.po('a1'), pg_temp.u('a4'), 'harassment', 'nota privada de ac em A', 'post do a4'),
  (pg_temp.t('b'), pg_temp.u('ac'), 'feed_post', pg_temp.po('b1'), pg_temp.u('b2'), 'spam', 'nota privada de ac em B', 'post de b');
create temp table rb_hash (k text primary key, v text);
insert into rb_hash values ('b0', pg_temp.rb_hash(pg_temp.t('b')));
select ok(
  app.account_anonymise((select id from public.memberships where tenant_id = pg_temp.t('a') and user_id = pg_temp.u('ac'))),
  'fact 6: the due member is anonymised (returns true)'
);
select is(
  (select count(*)::int from public.member_blocks
    where tenant_id = pg_temp.t('a') and (blocker_user_id = pg_temp.u('ac') or blocked_user_id = pg_temp.u('ac'))),
  0,
  'fact 6 (NATIVE-33): the removed member''s blocks are deleted in both directions'
);
select is(
  (select count(*)::int from public.member_blocks where tenant_id = pg_temp.t('a')),
  2,
  'fact 6 positive control: the two blocks of other members in the same tenant (a3 to a4, a4 to a5) stay'
);
select ok(
  (select note is null from public.content_reports
    where tenant_id = pg_temp.t('a') and reporter_user_id = pg_temp.u('ac')),
  'fact 6 (NATIVE-31): the note of the report the removed member filed is nulled'
);
select ok(
  (select count(*) = 1 and bool_and(excerpt = 'post do a4' and status = 'open' and reason = 'harassment')
     from public.content_reports where tenant_id = pg_temp.t('a') and reporter_user_id = pg_temp.u('ac')),
  'fact 6: …but the report itself stays, with its reason, status and snapshot'
);
select is(
  (select note from public.content_reports
    where tenant_id = pg_temp.t('a') and reporter_user_id = pg_temp.u('a3') and subject_id = pg_temp.co('a1')),
  'nota',
  'fact 6 positive control: another reporter''s note in the same tenant is untouched'
);
select is(
  (select v from rb_hash where k = 'b0'),
  pg_temp.rb_hash(pg_temp.t('b')),
  'fact 6 (T-13-22): the same user''s reports and blocks in tenant B are byte-identical after tenant A''s anonymisation'
);
select ok(
  (select note = 'nota privada de ac em B' from public.content_reports
    where tenant_id = pg_temp.t('b') and reporter_user_id = pg_temp.u('ac'))
  and (select count(*) = 1 from public.member_blocks where tenant_id = pg_temp.t('b') and blocker_user_id = pg_temp.u('ac')),
  'fact 6 (T-13-22): …in particular tenant B''s note and block of the same user'
);
select is(
  app.account_anonymise((select id from public.memberships where tenant_id = pg_temp.t('a') and user_id = pg_temp.u('ac'))),
  false,
  'fact 6: a second anonymisation of the same member returns false and changes nothing'
);
select ok(
  not app.account_anonymise((select id from public.memberships where tenant_id = pg_temp.t('b') and user_id = pg_temp.u('ac'))),
  'fact 6: tenant B''s live membership of the same user is not due, so it is refused (false) and its rows stay'
);
select ok(
  (select prosrc like '%member_blocks%' and prosrc like '%content_reports%' and prosrc like '%Membro removido%'
     from pg_proc where oid = to_regprocedure('app.account_anonymise(uuid)')),
  'fact 6: the anonymisation keeps plan 07''s literal and now names both tables'
);

select * from finish();
rollback;
