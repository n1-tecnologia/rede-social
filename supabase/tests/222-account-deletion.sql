begin;
-- 222-account-deletion.sql — NATIVE-19 / NATIVE-20 / NATIVE-21 data halves, D-609, D-610, T-13-13, T-13-14, T-13-15,
-- proved inside Postgres (13-07): "Excluir minha conta" is a request that deactivates a member at once (the shipped
-- soft state `deleted_at`, plus a marker and a 14-day deadline), a cancel by a fresh token, and an in-place
-- anonymisation that keeps every post and comment. The rules are `*_account_deletion_functions.sql`.
--
-- 0. Privileges: five definers with `search_path=""`, none executable by `anon`; `request` and `notice_take` by
--    `authenticated`; `cancel`, `due` and `anonymise` by the connection role and `service_role` only.
-- 1. `app.account_deletion_request`: the deadline is `requested + 14 days` on timestamptz, the member leaves every
--    live-member read at once, a second call returns the SAME deadline and rewrites nothing, and a blocked, a
--    moderation-deleted, a foreign-tenant or a claim-less caller is refused (42501). Tenant B is unchanged.
-- 2. The last administrator (AD001): the only active admin is refused (a blocked and a deleted admin do not
--    count), a second active admin lets the first through, and two admins one after the other leave exactly one.
-- 3. `app.account_deletion_cancel`: a token issued BEFORE or AT the request cannot cancel it, one AFTER can, the
--    previous deadline is parked and `notice_take` returns it once, a moderation soft-delete is never restored,
--    another tenant's id changes nothing, a cancel after the deadline is refused.
-- 4. `app.account_deletion_due`: only passed deadlines that are not anonymised and not cancelled, one second
--    either side of the boundary, ordered by deadline then id, the limit clamped to 1..500.
-- 5. The cancel-versus-anonymise pair in both orders resolves to exactly one outcome.
-- 6. `app.account_anonymise`: the profile reads the constant, answers and push rows are gone, retained purchase
--    and grant rows lose the e-mail, posts, comments, orders and the membership stay, a second call returns false.
-- 7. Two-tenant negative with a positive control: the same operations for a due member of A leave B's rows
--    identical (a hash of every touched table), and anonymising B's member afterwards changes B and not A.
--
-- Fixture ids use the `22200000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
-- The literal `Membro removido` is the constant `REMOVED_MEMBER_NAME` in packages/contracts/src/native.ts (plan 03).
select plan(86);

-- ── helpers (session-local) ───────────────────────────────────────────────────────────────────
-- u('a3') a user id, m('a3') that user's membership id, t('a') a tenant id, mail('a3') the e-mail.
create function pg_temp.u(p text) returns uuid language sql immutable as
  $$ select ('22200000-0000-4000-8000-0000000000' || p)::uuid $$;
create function pg_temp.m(p text) returns uuid language sql immutable as
  $$ select ('22200000-0000-4000-8000-0000000001' || p)::uuid $$;
create function pg_temp.t(p text) returns uuid language sql immutable as
  $$ select (case p when 'a' then '22200000-0000-4000-8000-000000000001'
                    when 'b' then '22200000-0000-4000-8000-000000000011'
                    else '22200000-0000-4000-8000-000000000021' end)::uuid $$;
-- A hash of every row of the tenant in every table the anonymisation may touch.
create function pg_temp.tenant_hash(p uuid) returns text language sql stable as $$
  select md5(coalesce(string_agg(r, '|' order by r), '')) from (
    select 'm:' || to_jsonb(x)::text r from public.memberships x where x.tenant_id = p
    union all select 'p:' || to_jsonb(x)::text from public.member_profiles x where x.tenant_id = p
    union all select 'a:' || to_jsonb(x)::text from public.profile_form_answers x where x.tenant_id = p
    union all select 's:' || to_jsonb(x)::text from public.push_subscriptions x where x.tenant_id = p
    union all select 'g:' || to_jsonb(x)::text from public.access_grants x where x.tenant_id = p
    union all select 'e:' || to_jsonb(x)::text from public.payment_events x where x.tenant_id = p
    union all select 'c:' || to_jsonb(x)::text from public.consent_records x where x.tenant_id = p
    union all select 'o:' || to_jsonb(x)::text from public.store_orders x where x.tenant_id = p
    union all select 'f:' || to_jsonb(x)::text from public.feed_posts x where x.tenant_id = p
    union all select 'k:' || to_jsonb(x)::text from public.feed_comments x where x.tenant_id = p
    union all select 'd:' || to_jsonb(x)::text from public.media_assets x where x.tenant_id = p
    union all select 'i:' || to_jsonb(x)::text from public.tenant_invites x where x.tenant_id = p
  ) q $$;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ad-a', 'Delete A', pg_temp.t('a'));
select tests.tenant('pgtap-ad-b', 'Delete B', pg_temp.t('b'));
select tests.tenant('pgtap-ad-c', 'Delete C', pg_temp.t('c'));
-- A: a1 a2 admins; a3 the member who asks to leave (content, answers, devices); a4 moderation soft-deleted;
-- a5 blocked; a6 cancels; a7 due in one second; a8 a live control with the same kinds of data; a9 due exactly now;
-- aa due one second ago; ab already anonymised; ac due twelve hours ago. B: b1 admin, b2 a due member, b3 live.
-- C (the last-admin tenant): c1 the only active admin, c2 a blocked admin, c3 a deleted admin, c4 a member.
select tests.auth_user('a1@ad-a.local', pg_temp.u('a1'));
select tests.auth_user('a2@ad-a.local', pg_temp.u('a2'));
select tests.auth_user('a3@ad-a.local', pg_temp.u('a3'));
select tests.auth_user('a4@ad-a.local', pg_temp.u('a4'));
select tests.auth_user('a5@ad-a.local', pg_temp.u('a5'));
select tests.auth_user('a6@ad-a.local', pg_temp.u('a6'));
select tests.auth_user('a7@ad-a.local', pg_temp.u('a7'));
select tests.auth_user('a8@ad-a.local', pg_temp.u('a8'));
select tests.auth_user('a9@ad-a.local', pg_temp.u('a9'));
select tests.auth_user('aa@ad-a.local', pg_temp.u('aa'));
select tests.auth_user('ab@ad-a.local', pg_temp.u('ab'));
select tests.auth_user('ac@ad-a.local', pg_temp.u('ac'));
select tests.auth_user('b1@ad-b.local', pg_temp.u('b1'));
select tests.auth_user('b2@ad-b.local', pg_temp.u('b2'));
select tests.auth_user('b3@ad-b.local', pg_temp.u('b3'));
select tests.auth_user('c1@ad-c.local', pg_temp.u('c1'));
select tests.auth_user('c2@ad-c.local', pg_temp.u('c2'));
select tests.auth_user('c3@ad-c.local', pg_temp.u('c3'));
select tests.auth_user('c4@ad-c.local', pg_temp.u('c4'));

insert into public.memberships (id, tenant_id, user_id, role, status) values
  (pg_temp.m('a1'), pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant', 'active'),
  (pg_temp.m('a2'), pg_temp.t('a'), pg_temp.u('a2'), 'admin_tenant', 'active'),
  (pg_temp.m('a3'), pg_temp.t('a'), pg_temp.u('a3'), 'member', 'active'),
  (pg_temp.m('a4'), pg_temp.t('a'), pg_temp.u('a4'), 'member', 'active'),
  (pg_temp.m('a5'), pg_temp.t('a'), pg_temp.u('a5'), 'member', 'active'),
  (pg_temp.m('a6'), pg_temp.t('a'), pg_temp.u('a6'), 'member', 'active'),
  (pg_temp.m('a7'), pg_temp.t('a'), pg_temp.u('a7'), 'member', 'active'),
  (pg_temp.m('a8'), pg_temp.t('a'), pg_temp.u('a8'), 'member', 'active'),
  (pg_temp.m('a9'), pg_temp.t('a'), pg_temp.u('a9'), 'member', 'active'),
  (pg_temp.m('aa'), pg_temp.t('a'), pg_temp.u('aa'), 'member', 'active'),
  (pg_temp.m('ab'), pg_temp.t('a'), pg_temp.u('ab'), 'member', 'active'),
  (pg_temp.m('ac'), pg_temp.t('a'), pg_temp.u('ac'), 'member', 'active'),
  (pg_temp.m('b1'), pg_temp.t('b'), pg_temp.u('b1'), 'admin_tenant', 'active'),
  (pg_temp.m('b2'), pg_temp.t('b'), pg_temp.u('b2'), 'member', 'active'),
  (pg_temp.m('b3'), pg_temp.t('b'), pg_temp.u('b3'), 'member', 'active'),
  (pg_temp.m('c1'), pg_temp.t('c'), pg_temp.u('c1'), 'admin_tenant', 'active'),
  (pg_temp.m('c2'), pg_temp.t('c'), pg_temp.u('c2'), 'admin_tenant', 'active'),
  (pg_temp.m('c3'), pg_temp.t('c'), pg_temp.u('c3'), 'admin_tenant', 'active'),
  (pg_temp.m('c4'), pg_temp.t('c'), pg_temp.u('c4'), 'member', 'active');
-- a4: a MODERATION soft-delete (no marker); a5 and c2: blocked; c3: deleted.
update public.memberships set deleted_at = now() where id in (pg_temp.m('a4'), pg_temp.m('c3'));
update public.memberships set status = 'blocked', blocked_at = now() where id in (pg_temp.m('a5'), pg_temp.m('c2'));

-- The data of the three members the anonymisation is proved on: a3 (due), a8 (a live control in the SAME tenant)
-- and b2 (a due member of ANOTHER tenant, the positive control of the two-tenant negative).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths, filename) values
  ('22200000-0000-4000-8000-0000000002a3', pg_temp.t('a'), pg_temp.u('a3'), 'image', 'avatar', 'ready', 'image/jpeg', 1024, '{640}', 'foto-da-pessoa.jpg'),
  ('22200000-0000-4000-8000-0000000002a8', pg_temp.t('a'), pg_temp.u('a8'), 'image', 'avatar', 'ready', 'image/jpeg', 1024, '{640}', 'foto-do-controle.jpg'),
  ('22200000-0000-4000-8000-0000000002b2', pg_temp.t('b'), pg_temp.u('b2'), 'image', 'avatar', 'ready', 'image/jpeg', 1024, '{640}', 'foto-de-b.jpg');
update public.member_profiles set display_name = 'Pessoa Tres', bio = 'Sobre a pessoa tres',
  avatar_asset_id = '22200000-0000-4000-8000-0000000002a3' where membership_id = pg_temp.m('a3');
update public.member_profiles set display_name = 'Pessoa Oito', bio = 'Sobre a pessoa oito',
  avatar_asset_id = '22200000-0000-4000-8000-0000000002a8' where membership_id = pg_temp.m('a8');
update public.member_profiles set display_name = 'Pessoa B Dois', bio = 'Sobre a pessoa b dois',
  avatar_asset_id = '22200000-0000-4000-8000-0000000002b2' where membership_id = pg_temp.m('b2');

insert into public.profile_form_questions
  (id, tenant_id, type, title, required, show_on_profile, allow_other, options, position, archived_at, created_by_user_id) values
  ('22200000-0000-4000-8000-0000000003a1', pg_temp.t('a'), 'short_text', 'Instagram', false, true, false, '[]'::jsonb, 1, null, pg_temp.u('a1')),
  ('22200000-0000-4000-8000-0000000003b1', pg_temp.t('b'), 'short_text', 'Instagram', false, true, false, '[]'::jsonb, 1, null, pg_temp.u('b1'));
insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value) values
  (pg_temp.t('a'), '22200000-0000-4000-8000-0000000003a1', pg_temp.m('a3'), pg_temp.u('a3'), '"@pessoa.tres"'::jsonb),
  (pg_temp.t('a'), '22200000-0000-4000-8000-0000000003a1', pg_temp.m('a8'), pg_temp.u('a8'), '"@pessoa.oito"'::jsonb),
  (pg_temp.t('b'), '22200000-0000-4000-8000-0000000003b1', pg_temp.m('b2'), pg_temp.u('b2'), '"@pessoa.b.dois"'::jsonb);

insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, p256dh, auth, user_agent) values
  (pg_temp.t('a'), pg_temp.u('a3'), 'https://push.example/ad-a3', 'webpush', 'k', 'a', 'Mozilla a3'),
  (pg_temp.t('a'), pg_temp.u('a8'), 'https://push.example/ad-a8', 'webpush', 'k', 'a', 'Mozilla a8'),
  (pg_temp.t('b'), pg_temp.u('b2'), 'https://push.example/ad-b2', 'webpush', 'k', 'a', 'Mozilla b2');
insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform, app_environment) values
  (pg_temp.t('a'), pg_temp.u('a3'), repeat('a3', 32), 'apns', 'ios', 'production');

insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind) values
  ('22200000-0000-4000-8000-0000000004a1', pg_temp.t('a'), pg_temp.u('a3'), 'post um da pessoa tres', 'tenant', 'none'),
  ('22200000-0000-4000-8000-0000000004a2', pg_temp.t('a'), pg_temp.u('a3'), 'post dois da pessoa tres', 'tenant', 'none'),
  ('22200000-0000-4000-8000-0000000004a8', pg_temp.t('a'), pg_temp.u('a8'), 'post do controle', 'tenant', 'none'),
  ('22200000-0000-4000-8000-0000000004b2', pg_temp.t('b'), pg_temp.u('b2'), 'post da pessoa b dois', 'tenant', 'none');
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('22200000-0000-4000-8000-0000000005a3', pg_temp.t('a'), '22200000-0000-4000-8000-0000000004a8', pg_temp.u('a3'), 'comentario da pessoa tres', 0, null, null, null),
  ('22200000-0000-4000-8000-0000000005b2', pg_temp.t('b'), '22200000-0000-4000-8000-0000000004b2', pg_temp.u('b2'), 'comentario da pessoa b dois', 0, null, null, null);

insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('22200000-0000-4000-8000-0000000006a1', pg_temp.t('a'), pg_temp.u('a1'), 'Produto A', 1000),
  ('22200000-0000-4000-8000-0000000006b1', pg_temp.t('b'), pg_temp.u('b1'), 'Produto B', 2000);
insert into public.store_orders (id, tenant_id, user_id, product_id, status, amount_cents, currency, paid_at) values
  ('22200000-0000-4000-8000-0000000007a3', pg_temp.t('a'), pg_temp.u('a3'), '22200000-0000-4000-8000-0000000006a1', 'paid', 1000, 'BRL', now()),
  ('22200000-0000-4000-8000-0000000007a8', pg_temp.t('a'), pg_temp.u('a8'), '22200000-0000-4000-8000-0000000006a1', 'paid', 1000, 'BRL', now()),
  ('22200000-0000-4000-8000-0000000007b2', pg_temp.t('b'), pg_temp.u('b2'), '22200000-0000-4000-8000-0000000006b1', 'paid', 2000, 'BRL', now());

-- Access grants: tenant B also holds a grant for a3's e-mail address (the same person may be a member of two
-- tenants; the anonymisation of A's membership must not reach it).
insert into public.access_grants (id, tenant_id, email, source, status) values
  ('22200000-0000-4000-8000-0000000008a3', pg_temp.t('a'), 'a3@ad-a.local', 'manual', 'active'),
  ('22200000-0000-4000-8000-0000000008a8', pg_temp.t('a'), 'a8@ad-a.local', 'manual', 'active'),
  ('22200000-0000-4000-8000-0000000008b3', pg_temp.t('b'), 'a3@ad-a.local', 'manual', 'active'),
  ('22200000-0000-4000-8000-0000000008b2', pg_temp.t('b'), 'b2@ad-b.local', 'manual', 'active');
insert into public.payment_integrations (id, tenant_id, provider, secret_sealed) values
  ('22200000-0000-4000-8000-0000000009a1', pg_temp.t('a'), 'fake', 'v1:1:aaaa:bbbb:cccc'),
  ('22200000-0000-4000-8000-0000000009b1', pg_temp.t('b'), 'fake', 'v1:1:dddd:eeee:ffff');
insert into public.payment_events (id, tenant_id, integration_id, provider, dedupe_key, type, effect, email, amount_cents) values
  ('22200000-0000-4000-8000-000000000ae3', pg_temp.t('a'), '22200000-0000-4000-8000-0000000009a1', 'fake', 'ad-k-a3', 'purchase_approved', 'grant', 'a3@ad-a.local', 1000),
  ('22200000-0000-4000-8000-000000000ae8', pg_temp.t('a'), '22200000-0000-4000-8000-0000000009a1', 'fake', 'ad-k-a8', 'purchase_approved', 'grant', 'a8@ad-a.local', 1000),
  ('22200000-0000-4000-8000-000000000be3', pg_temp.t('b'), '22200000-0000-4000-8000-0000000009b1', 'fake', 'ad-k-b3', 'purchase_approved', 'grant', 'a3@ad-a.local', 2000),
  ('22200000-0000-4000-8000-000000000be2', pg_temp.t('b'), '22200000-0000-4000-8000-0000000009b1', 'fake', 'ad-k-b2', 'purchase_approved', 'grant', 'b2@ad-b.local', 2000);
insert into public.consent_records (tenant_id, user_id, kind, text_version, ip, user_agent) values
  (pg_temp.t('a'), pg_temp.u('a3'), 'tenant_rules', 1, '203.0.113.3', 'Mozilla consent a3'),
  (pg_temp.t('a'), pg_temp.u('a8'), 'tenant_rules', 1, '203.0.113.8', 'Mozilla consent a8'),
  (pg_temp.t('b'), pg_temp.u('b2'), 'tenant_rules', 1, '203.0.113.2', 'Mozilla consent b2');
insert into public.tenant_invites (id, tenant_id, email, role, status, user_id, accepted_at, created_by) values
  ('22200000-0000-4000-8000-000000000ca3', pg_temp.t('a'), 'a3@ad-a.local', 'admin_tenant', 'accepted', pg_temp.u('a3'), now(), pg_temp.u('a1')),
  ('22200000-0000-4000-8000-000000000ca8', pg_temp.t('a'), 'a8@ad-a.local', 'admin_tenant', 'accepted', pg_temp.u('a8'), now(), pg_temp.u('a1')),
  ('22200000-0000-4000-8000-000000000cb2', pg_temp.t('b'), 'b2@ad-b.local', 'admin_tenant', 'accepted', pg_temp.u('b2'), now(), pg_temp.u('b1'));

-- A hash of tenant B and of tenant A as they are before anything runs, kept for the isolation facts.
create temp table ad_hash (k text primary key, v text);
insert into ad_hash values ('b0', pg_temp.tenant_hash(pg_temp.t('b'))), ('a0', pg_temp.tenant_hash(pg_temp.t('a')));

-- ── 0. the privilege facts ────────────────────────────────────────────────────────────────────
select ok(
  (select count(*) = 5 and bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
    where oid in (to_regprocedure('app.account_deletion_request()'),
                  to_regprocedure('app.account_deletion_cancel(uuid,uuid,timestamp with time zone)'),
                  to_regprocedure('app.account_deletion_notice_take()'),
                  to_regprocedure('app.account_deletion_due(integer)'),
                  to_regprocedure('app.account_anonymise(uuid)'))),
  'fact 0: the five deletion functions exist and are SECURITY DEFINER with search_path pinned to ""'
);
select ok(
  (select count(*) = 5 and not bool_or(has_function_privilege('anon', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.account_deletion_request()'),
                  to_regprocedure('app.account_deletion_cancel(uuid,uuid,timestamp with time zone)'),
                  to_regprocedure('app.account_deletion_notice_take()'),
                  to_regprocedure('app.account_deletion_due(integer)'),
                  to_regprocedure('app.account_anonymise(uuid)'))),
  'fact 0: anon cannot execute any of the five'
);
select ok(
  (select count(*) = 2 and bool_and(has_function_privilege('authenticated', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.account_deletion_request()'),
                  to_regprocedure('app.account_deletion_notice_take()'))),
  'fact 0 positive control: authenticated can execute request and notice_take'
);
select ok(
  (select count(*) = 3 and not bool_or(has_function_privilege('authenticated', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.account_deletion_cancel(uuid,uuid,timestamp with time zone)'),
                  to_regprocedure('app.account_deletion_due(integer)'),
                  to_regprocedure('app.account_anonymise(uuid)'))),
  'fact 0 (T-13-13): authenticated cannot execute cancel, due or anonymise'
);
select ok(
  (select count(*) = 3 and bool_and(has_function_privilege('service_role', oid, 'execute') and has_function_privilege('api_user', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.account_deletion_cancel(uuid,uuid,timestamp with time zone)'),
                  to_regprocedure('app.account_deletion_due(integer)'),
                  to_regprocedure('app.account_anonymise(uuid)'))),
  'fact 0 positive control: service_role and the connection role api_user can execute cancel, due and anonymise'
);
select ok(
  coalesce((select prosrc like '%Membro removido%' from pg_proc where oid = to_regprocedure('app.account_anonymise(uuid)')), false),
  'fact 0: the anonymisation writes the literal Membro removido (REMOVED_MEMBER_NAME, packages/contracts/src/native.ts)'
);
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select throws_ok(
  $$ select app.account_anonymise('22200000-0000-4000-8000-0000000001a8') $$,
  '42501', null,
  'fact 0 (T-13-13): a member lane cannot call the anonymisation, not even for another member (permission denied)'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select throws_ok(
  $$ select app.account_deletion_cancel('22200000-0000-4000-8000-000000000001', '22200000-0000-4000-8000-0000000000a3', now() + interval '1 hour') $$,
  '42501', null,
  'fact 0 (T-13-14): a member lane cannot call the cancel with a token time of its own choosing'
);
reset role;

-- ── 1. the request ────────────────────────────────────────────────────────────────────────────
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a8'));
select ok(
  exists (select 1 from app.push_subscriptions_for_v2(array[pg_temp.u('a3'), pg_temp.u('a8')]) where user_id = pg_temp.u('a3'))
  and exists (select 1 from app.push_subscriptions_for_v2(array[pg_temp.u('a3'), pg_temp.u('a8')]) where user_id = pg_temp.u('a8')),
  'fact 1 positive control: before any request both a3 and a8 are in the push reader'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select lives_ok(
  $$ select app.account_deletion_request() $$,
  'fact 1: a live member requests deletion'
);
reset role;
select ok(
  (select m.deleted_at = m.deletion_requested_at
          and m.deletion_due_at = m.deletion_requested_at + interval '14 days'
          and m.anonymised_at is null and m.deletion_cancelled_until is null
     from public.memberships m where m.id = pg_temp.m('a3')),
  'fact 1 (precision): deleted_at = deletion_requested_at and the deadline is exactly requested + 14 days on timestamptz'
);
create temp table ad_req (k text primary key, v timestamptz);
insert into ad_req select 'a3', deletion_requested_at from public.memberships where id = pg_temp.m('a3');
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a3'));
select is(
  app.account_deletion_request(),
  (select m.deletion_due_at from public.memberships m where m.id = pg_temp.m('a3')),
  'fact 1 (idempotency): a second request returns the SAME deadline'
);
reset role;
select is(
  (select m.deletion_requested_at from public.memberships m where m.id = pg_temp.m('a3')),
  (select v from ad_req where k = 'a3'),
  'fact 1 (idempotency): …and does not rewrite deletion_requested_at'
);
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a8'));
select ok(
  not exists (select 1 from app.push_subscriptions_for_v2(array[pg_temp.u('a3'), pg_temp.u('a8')]) where user_id = pg_temp.u('a3'))
  and exists (select 1 from app.push_subscriptions_for_v2(array[pg_temp.u('a3'), pg_temp.u('a8')]) where user_id = pg_temp.u('a8')),
  'fact 1: the requester is outside the push reader at once (the shipped live predicate), a8 stays in'
);
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a5'));
select throws_ok($$ select app.account_deletion_request() $$, '42501', null, 'fact 1: a blocked member is refused (42501)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a4'));
select throws_ok($$ select app.account_deletion_request() $$, '42501', null,
  'fact 1: a member soft-deleted by moderation (no marker) is refused (42501)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('b3'));
select throws_ok($$ select app.account_deletion_request() $$, '42501', null,
  'fact 1: a user of tenant B under A''s claim is refused (42501)');
reset role;
select tests.as_tenant_without_claims();
select throws_ok($$ select app.account_deletion_request() $$, '42501', null, 'fact 1: a lane with no claim is refused (42501)');
reset role;
select ok(
  (select count(*) = 0 from public.memberships
    where id in (pg_temp.m('a4'), pg_temp.m('a5'), pg_temp.m('b3')) and deletion_requested_at is not null),
  'fact 1: the refusals marked no membership'
);
select is(
  pg_temp.tenant_hash(pg_temp.t('b')), (select v from ad_hash where k = 'b0'),
  'fact 1 (two-tenant negative): the request of a3 and the refusals left every row of tenant B identical'
);
select isnt(
  pg_temp.tenant_hash(pg_temp.t('a')), (select v from ad_hash where k = 'a0'),
  'fact 1 (positive control): the same hash of tenant A changed'
);

-- ── 2. the last administrator ────────────────────────────────────────────────────────────────
select tests.as_tenant(pg_temp.t('c'), pg_temp.u('c1'), 'admin_tenant');
select throws_ok(
  $$ select app.account_deletion_request() $$, 'AD001', null,
  'fact 2 (PU-4): the only active admin is refused with AD001 (a blocked and a deleted admin do not count)'
);
reset role;
select ok(
  (select deleted_at is null and deletion_requested_at is null from public.memberships where id = pg_temp.m('c1')),
  'fact 2: the refusal changed nothing'
);
update public.memberships set status = 'active', blocked_at = null where id = pg_temp.m('c2');
select tests.as_tenant(pg_temp.t('c'), pg_temp.u('c1'), 'admin_tenant');
select lives_ok(
  $$ select app.account_deletion_request() $$,
  'fact 2 positive control: with a second ACTIVE admin the first goes through'
);
reset role;
select is(
  (select count(*)::int from public.memberships
    where tenant_id = pg_temp.t('c') and role = 'admin_tenant' and status = 'active' and blocked_at is null and deleted_at is null),
  1,
  'fact 2: exactly one active admin is left in tenant C'
);
select tests.as_tenant(pg_temp.t('c'), pg_temp.u('c2'), 'admin_tenant');
select throws_ok(
  $$ select app.account_deletion_request() $$, 'AD001', null,
  'fact 2 (interleave): the second admin, asking right after the first, is refused with AD001'
);
reset role;
select is(
  (select count(*)::int from public.memberships
    where tenant_id = pg_temp.t('a') and role = 'admin_tenant' and status = 'active' and blocked_at is null and deleted_at is null),
  2,
  'fact 2 positive control: tenant A starts with two active admins'
);
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a1'), 'admin_tenant');
select lives_ok($$ select app.account_deletion_request() $$, 'fact 2: a1 (one of two admins of A) requests');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a2'), 'admin_tenant');
select throws_ok($$ select app.account_deletion_request() $$, 'AD001', null,
  'fact 2: a2, asking right after, is refused with AD001');
reset role;
select results_eq(
  $$ select user_id from public.memberships
      where tenant_id = '22200000-0000-4000-8000-000000000001' and role = 'admin_tenant' and status = 'active'
        and blocked_at is null and deleted_at is null $$,
  $$ select pg_temp.u('a2') $$,
  'fact 2 (concurrency, pgTAP half): tenant A is left with exactly one active admin, a2'
);

-- ── 3. the cancel ─────────────────────────────────────────────────────────────────────────────
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a6'));
select lives_ok($$ select app.account_deletion_request() $$, 'fact 3: a6 requests deletion');
reset role;
select tests.as_service();
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a6'),
    (select deletion_requested_at from public.memberships where id = pg_temp.m('a6')) - interval '1 second'),
  false,
  'fact 3 (T-13-14): a token issued BEFORE the request cannot cancel it'
);
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a6'),
    (select deletion_requested_at from public.memberships where id = pg_temp.m('a6'))),
  false,
  'fact 3 (T-13-14): a token issued AT the request instant cannot cancel it either'
);
select is(
  app.account_deletion_cancel(pg_temp.t('b'), pg_temp.u('a6'), now() + interval '1 second'),
  false,
  'fact 3: tenant B''s id with a6''s user changes nothing'
);
reset role;
select ok(
  (select deleted_at is not null and deletion_requested_at is not null and deletion_due_at is not null
     from public.memberships where id = pg_temp.m('a6')),
  'fact 3: after the three refusals a6 is still deactivated with the request intact'
);
select tests.as_service();
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a4'), now() + interval '1 hour'), false,
  'fact 3: a moderation soft-delete (no marker) is never restored'
);
reset role;
select ok(
  (select deleted_at is not null from public.memberships where id = pg_temp.m('a4')),
  'fact 3: …and a4 stays soft-deleted'
);
select tests.as_service();
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a8'), now() + interval '1 hour'), false,
  'fact 3: a live member with no request cannot be "cancelled" (false)'
);
select is(app.account_deletion_cancel(null, pg_temp.u('a6'), now()), false, 'fact 3: a null tenant is false, not an error');
reset role;

-- Boundary states set directly: a7 is due in one second, a9 exactly now, aa one second ago, ab anonymised,
-- ac twelve hours ago, b2 (tenant B) two days ago; a3 is moved a day past its deadline.
update public.memberships set deleted_at = now(), deletion_requested_at = now() - interval '14 days' + interval '1 second',
  deletion_due_at = now() + interval '1 second' where id = pg_temp.m('a7');
update public.memberships set deleted_at = now(), deletion_requested_at = now() - interval '14 days',
  deletion_due_at = now() where id = pg_temp.m('a9');
update public.memberships set deleted_at = now(), deletion_requested_at = now() - interval '14 days' - interval '1 second',
  deletion_due_at = now() - interval '1 second' where id = pg_temp.m('aa');
update public.memberships set deleted_at = now() - interval '20 days', deletion_requested_at = now() - interval '20 days',
  deletion_due_at = now() - interval '6 days', anonymised_at = now() - interval '5 days' where id = pg_temp.m('ab');
update public.memberships set deleted_at = now(), deletion_requested_at = now() - interval '14 days' - interval '12 hours',
  deletion_due_at = now() - interval '12 hours' where id = pg_temp.m('ac');
update public.memberships set deleted_at = now() - interval '16 days', deletion_requested_at = now() - interval '16 days',
  deletion_due_at = now() - interval '2 days' where id = pg_temp.m('b2');
update public.memberships set deletion_requested_at = now() - interval '15 days', deletion_due_at = now() - interval '1 day',
  deleted_at = now() - interval '15 days' where id = pg_temp.m('a3');

-- ── 4. the due list ───────────────────────────────────────────────────────────────────────────
select tests.as_service();
select is(
  array(select membership_id from app.account_deletion_due(10)),
  array[pg_temp.m('b2'), pg_temp.m('a3'), pg_temp.m('ac'), pg_temp.m('aa'), pg_temp.m('a9')],
  'fact 4 (NATIVE-19 boundary): due = passed or exactly now, ordered by deadline then id; a7 (one second ahead), ab (anonymised), a6 (not past), a4 (no marker) are out'
);
select is(
  (select count(*)::int from app.account_deletion_due(10) where membership_id = pg_temp.m('a7')), 0,
  'fact 4: a row due one second in the future is not returned'
);
select is(
  (select count(*)::int from app.account_deletion_due(10) where membership_id = pg_temp.m('a9')), 1,
  'fact 4: a row due exactly now is returned'
);
select is(
  (select count(*)::int from app.account_deletion_due(10) where membership_id = pg_temp.m('aa')), 1,
  'fact 4: a row due one second ago is returned'
);
select is(array(select membership_id from app.account_deletion_due(0)), array[pg_temp.m('b2')],
  'fact 4: a limit of 0 is clamped up to 1 (the earliest deadline)');
select is(array(select membership_id from app.account_deletion_due(-5)), array[pg_temp.m('b2')],
  'fact 4: a negative limit is clamped up to 1');
select is((select count(*)::int from app.account_deletion_due(100000)), 5,
  'fact 4: a huge limit is clamped down to 500 and returns every due row (5)');
select is((select count(*)::int from app.account_deletion_due(null)), 1, 'fact 4: a null limit is 1');
select is(
  (select (user_id, tenant_id)::text from app.account_deletion_due(1)),
  (pg_temp.u('b2'), pg_temp.t('b'))::text,
  'fact 4: the row carries the user id and the tenant id the job needs'
);
reset role;

-- ── 5. cancel at the boundary and the race with the anonymisation ───────────────────────────
select tests.as_service();
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a9'), now() + interval '1 second'), false,
  'fact 5 (NATIVE-19 boundary): at the deadline instant the cancel is refused'
);
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('ac'), now() + interval '1 second'), false,
  'fact 5: after the deadline the cancel is refused (sign-in then fails: the account is anonymised)'
);
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a7'),
    (select deletion_requested_at from public.memberships where id = pg_temp.m('a7')) + interval '1 second'),
  true,
  'fact 5: at one second before the deadline a fresh token cancels'
);
select is(app.account_anonymise(pg_temp.m('a7')), false,
  'fact 5 (NATIVE-20 race, order 1): after the cancel the anonymisation returns false');
select is(app.account_anonymise(pg_temp.m('a9')), true,
  'fact 5 (NATIVE-20 race, order 2): the row due now is anonymised…');
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a9'), now() + interval '1 second'), false,
  'fact 5: …and the cancel that follows returns false'
);
reset role;
select ok(
  (select deleted_at is null and deletion_requested_at is null and deletion_due_at is null and anonymised_at is null
          and deletion_cancelled_until is not null
     from public.memberships where id = pg_temp.m('a7')),
  'fact 5: order 1 ends with a7 live again, anonymised_at null and the old deadline parked'
);
select ok(
  (select anonymised_at is not null and deleted_at is not null from public.memberships where id = pg_temp.m('a9')),
  'fact 5: order 2 ends with a9 anonymised and still deactivated'
);

-- ── 6. the notice, read once ──────────────────────────────────────────────────────────────────
select tests.as_service();
select is(
  app.account_deletion_cancel(pg_temp.t('a'), pg_temp.u('a6'),
    (select deletion_requested_at from public.memberships where id = pg_temp.m('a6')) + interval '1 second'),
  true,
  'fact 6 (NATIVE-20): a token issued after the request restores a6'
);
reset role;
select ok(
  (select deleted_at is null and deletion_requested_at is null and deletion_due_at is null and anonymised_at is null
          and deletion_cancelled_until = now() + interval '14 days'
     from public.memberships where id = pg_temp.m('a6')),
  'fact 6: a6 is live, the markers are cleared and the previous deadline is parked'
);
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a6'));
select is(
  app.account_deletion_notice_take(), now() + interval '14 days',
  'fact 6: notice_take returns the parked deadline'
);
select is(app.account_deletion_notice_take(), null::timestamptz, 'fact 6: …and returns null the second time (read once)');
reset role;
select tests.as_tenant(pg_temp.t('a'), pg_temp.u('a8'));
select is(app.account_deletion_notice_take(), null::timestamptz,
  'fact 6: a member with no parked deadline gets null');
reset role;
select tests.as_tenant_without_claims();
select throws_ok($$ select app.account_deletion_notice_take() $$, '42501', null, 'fact 6: a lane with no claim is refused (42501)');
reset role;

-- ── 7. the anonymisation ──────────────────────────────────────────────────────────────────────
-- Before: a3's retained rows still carry the person.
select is(
  (select count(*)::int from public.profile_form_answers where membership_id = pg_temp.m('a3')), 1,
  'fact 7 positive control: before, a3 has an answer'
);
select is(
  (select count(*)::int from public.push_subscriptions where user_id = pg_temp.u('a3')), 2,
  'fact 7 positive control: before, a3 has two devices (web and native)'
);
create temp table ad_counts as
  select (select count(*) from public.feed_posts where tenant_id = pg_temp.t('a'))::int posts,
         (select count(*) from public.feed_comments where tenant_id = pg_temp.t('a'))::int comments,
         (select count(*) from public.store_orders where tenant_id = pg_temp.t('a'))::int orders,
         (select count(*) from public.access_grants where tenant_id = pg_temp.t('a'))::int grants,
         (select count(*) from public.memberships where tenant_id = pg_temp.t('a'))::int members;
insert into ad_hash values ('b1', pg_temp.tenant_hash(pg_temp.t('b')));
select tests.as_service();
select is(app.account_anonymise(pg_temp.m('a3')), true, 'fact 7: a due member is anonymised');
select is(app.account_anonymise(pg_temp.m('a3')), false, 'fact 7 (idempotency): a second call returns false');
select is(app.account_anonymise(pg_temp.m('a6')), false, 'fact 7 (T-13-13): a member who cancelled is not anonymised');
select is(app.account_anonymise(pg_temp.m('a8')), false, 'fact 7 (T-13-13): a live member is not anonymised');
select is(app.account_anonymise(pg_temp.m('a4')), false, 'fact 7 (T-13-13): a moderation soft-delete is not anonymised');
select is(app.account_anonymise(pg_temp.m('a5')), false, 'fact 7 (T-13-13): a blocked member is not anonymised');
select is(app.account_anonymise(gen_random_uuid()), false, 'fact 7: an unknown membership id is false');
select is(app.account_anonymise(null), false, 'fact 7: a null membership id is false');
reset role;
select is(
  (select display_name || '|' || coalesce(bio, 'null') || '|' || coalesce(avatar_asset_id::text, 'null')
     from public.member_profiles where membership_id = pg_temp.m('a3')),
  'Membro removido|null|null',
  'fact 7 (NATIVE-21): the profile reads Membro removido with no bio and no photo'
);
select is(
  (select status || '|' || (deleted_at is not null)::text || '|' || coalesce(filename, 'null')
     from public.media_assets where id = '22200000-0000-4000-8000-0000000002a3'),
  'deleted|true|null',
  'fact 7: the avatar asset is marked deleted and its file name is blanked (the storage object is the job''s)'
);
select is((select count(*)::int from public.profile_form_answers where membership_id = pg_temp.m('a3')), 0,
  'fact 7 (NATIVE-21): the answers (Instagram and the rest) are gone');
select is((select count(*)::int from public.push_subscriptions where user_id = pg_temp.u('a3')), 0,
  'fact 7 (NATIVE-21): the push devices are gone');
select is(
  (select count(*)::int from public.feed_posts f join public.member_profiles p
     on p.tenant_id = f.tenant_id and p.user_id = f.author_user_id
    where f.author_user_id = pg_temp.u('a3') and p.display_name = 'Membro removido'),
  2,
  'fact 7 (NATIVE-21): both posts of a3 still exist and read the author Membro removido'
);
select is(
  (select count(*)::int from public.feed_comments f join public.member_profiles p
     on p.tenant_id = f.tenant_id and p.user_id = f.author_user_id
    where f.author_user_id = pg_temp.u('a3') and p.display_name = 'Membro removido'),
  1,
  'fact 7 (NATIVE-21): the comment of a3 still exists and reads Membro removido'
);
select is(
  (select posts || '/' || comments || '/' || orders || '/' || grants || '/' || members from ad_counts),
  (select (select count(*) from public.feed_posts where tenant_id = pg_temp.t('a'))
       || '/' || (select count(*) from public.feed_comments where tenant_id = pg_temp.t('a'))
       || '/' || (select count(*) from public.store_orders where tenant_id = pg_temp.t('a'))
       || '/' || (select count(*) from public.access_grants where tenant_id = pg_temp.t('a'))
       || '/' || (select count(*) from public.memberships where tenant_id = pg_temp.t('a'))),
  'fact 7 (D-609): no post, comment, order, grant or membership row was deleted (counts before and after are equal)'
);
select ok(
  (select anonymised_at is not null and deleted_at is not null and role = 'member'
     from public.memberships where id = pg_temp.m('a3')),
  'fact 7: the membership row survives with anonymised_at set (every author foreign key holds)'
);
select is(
  (select amount_cents || '/' || status from public.store_orders where id = '22200000-0000-4000-8000-0000000007a3'),
  '1000/paid',
  'fact 7: the purchase of a3 survives with its amount and status'
);
select ok(
  (select email ~ '^removed-[0-9a-f-]+@removed\.invalid$' and email <> 'a3@ad-a.local'
     from public.access_grants where id = '22200000-0000-4000-8000-0000000008a3'),
  'fact 7 (T-13-15): the access grant of a3 survives with no e-mail address'
);
select is((select email from public.payment_events where id = '22200000-0000-4000-8000-000000000ae3'), null::text,
  'fact 7 (T-13-15): the payment event of a3 keeps its amount but no e-mail');
select is((select amount_cents from public.payment_events where id = '22200000-0000-4000-8000-000000000ae3'), 1000,
  'fact 7: …and the event amount is intact');
select is(
  (select coalesce(ip::text, '') || '|' || coalesce(user_agent, 'null') from public.consent_records where user_id = pg_temp.u('a3')),
  '|null',
  'fact 7 (T-13-15): the consent proof of a3 survives without the address and the browser'
);
select ok(
  (select count(*) = 1 and bool_and(email ~ '^removed-[0-9a-f-]+@removed\.invalid$') from public.tenant_invites where user_id = pg_temp.u('a3')),
  'fact 7 (T-13-15): the accepted invite of a3 lost the e-mail'
);
select is(
  (select count(*)::int from public.access_grants where tenant_id = pg_temp.t('a') and email = 'a3@ad-a.local'), 0,
  'fact 7: no grant of tenant A still carries a3''s address'
);

-- ── 8. the same operations, tenant A against tenant B ────────────────────────────────────────
select is(
  pg_temp.tenant_hash(pg_temp.t('b')), (select v from ad_hash where k = 'b1'),
  'fact 8 (two-tenant negative): anonymising a3 left every row of tenant B identical'
);
select is(
  (select email from public.access_grants where id = '22200000-0000-4000-8000-0000000008b3'), 'a3@ad-a.local',
  'fact 8: tenant B''s grant for the very same address was not touched'
);
select is(
  (select email from public.payment_events where id = '22200000-0000-4000-8000-000000000be3'), 'a3@ad-a.local',
  'fact 8: tenant B''s payment event for the same address was not touched'
);
select ok(
  (select display_name = 'Pessoa Oito' and bio = 'Sobre a pessoa oito' and avatar_asset_id is not null
     from public.member_profiles where membership_id = pg_temp.m('a8'))
  and (select count(*) = 1 from public.profile_form_answers where membership_id = pg_temp.m('a8'))
  and (select count(*) = 1 from public.push_subscriptions where user_id = pg_temp.u('a8'))
  and (select email = 'a8@ad-a.local' from public.access_grants where id = '22200000-0000-4000-8000-0000000008a8')
  and (select email = 'a8@ad-a.local' from public.payment_events where id = '22200000-0000-4000-8000-000000000ae8')
  and (select ip is not null from public.consent_records where user_id = pg_temp.u('a8')),
  'fact 8: a8 (a live member of the SAME tenant) kept the profile, the answer, the device, the grant, the event and the consent'
);
insert into ad_hash values ('a1', pg_temp.tenant_hash(pg_temp.t('a')));
select tests.as_service();
select is(app.account_anonymise(pg_temp.m('b2')), true, 'fact 8 positive control: B''s own due member is anonymised');
reset role;
select isnt(
  pg_temp.tenant_hash(pg_temp.t('b')), (select v from ad_hash where k = 'b1'),
  'fact 8 positive control: tenant B''s hash changed'
);
select is(
  pg_temp.tenant_hash(pg_temp.t('a')), (select v from ad_hash where k = 'a1'),
  'fact 8 (two-tenant negative): …and tenant A''s hash did not'
);
select is(
  (select display_name from public.member_profiles where membership_id = pg_temp.m('b2')), 'Membro removido',
  'fact 8: b2''s profile reads Membro removido'
);
select ok(
  (select count(*) = 1 from public.feed_posts where author_user_id = pg_temp.u('b2'))
  and (select count(*) = 1 from public.feed_comments where author_user_id = pg_temp.u('b2'))
  and (select count(*) = 0 from public.profile_form_answers where membership_id = pg_temp.m('b2'))
  and (select count(*) = 0 from public.push_subscriptions where user_id = pg_temp.u('b2'))
  and (select email ~ '^removed-' from public.access_grants where id = '22200000-0000-4000-8000-0000000008b2'),
  'fact 8: b2''s post and comment stay, the answer and the device are gone, the grant lost the address'
);
select ok(
  (select email = 'a3@ad-a.local' from public.access_grants where id = '22200000-0000-4000-8000-0000000008b3'),
  'fact 8: and B''s anonymisation left B''s unrelated grant for a3''s address alone'
);

select * from finish();
rollback;
