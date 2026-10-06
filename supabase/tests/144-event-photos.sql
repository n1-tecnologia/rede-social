begin;
-- 144-event-photos.sql — `event_photos` (2026-10-03, the event's "Fotos"), executed inside Postgres.
--
-- 1. TENANT ISOLATION, both directions, with IDENTICAL-looking rows (the 020 adjacency rule: the same
--    filename, the same widths, the same author on each side): A's member lane reads A's photo and
--    ZERO of B's, B's lane the mirror; a lane with no claims reads nothing at all.
--
-- 2. A lane cannot write across tenants: A's lane inserting a row that says tenant B is 42501 (the
--    `with check` of `event_photos_tenant_isolation`), and an UPDATE or DELETE of B's row from A's lane
--    touches nothing.
--
-- 3. THE POSTURE: the policy is the standard `for all`, so a member lane of A MAY write A's rows; who
--    may add or remove a photo is `requirePermission('events.event.manage')` in the API, the Phase 4/5
--    posture (the positive control below pins it, so a tightening is a deliberate edit here).
--
-- 4. Structure, from the service lane (which bypasses RLS, so only the keys can refuse): the composite
--    `event_photos_event_fk` refuses a photo of A pointing at B's event (23503); one asset is one
--    photo, `event_photos_tenant_asset_uq` (23505); deleting an event takes its photos with it
--    (on delete cascade).
--
-- 5. The gallery statement, copied VERBATIM from `listEventPhotos` in
--    `packages/modules/events/server/photos.ts` (page 1: the bound cursor is null), rides
--    `event_photos_tenant_event_idx` BY NAME on a 6,000-photo fixture built and ANALYZEd here, with no
--    Sort node: the index order IS the gallery order. Edit both files together.
--
-- Fixture ids use the `1e400000-…` prefix (volume rows `1e4000e0-…` / `1e4000a0-…` / `1e4000f0-…`).
-- Like its siblings, this file ROLLS BACK, so it re-runs identically against a seeded or empty base.
select plan(14);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ph-a', 'Fotos A', '1e400000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ph-b', 'Fotos B', '1e400000-0000-4000-8000-000000000011');
select tests.auth_user('admin@ph-a.local', '1e400000-0000-4000-8000-000000000002');
select tests.auth_user('admin@ph-b.local', '1e400000-0000-4000-8000-000000000012');
select tests.member('1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('1e400000-0000-4000-8000-000000000011', '1e400000-0000-4000-8000-000000000012', 'admin_tenant');

-- Both halves of one event in ONE statement.
create function pg_temp.ev(p_id uuid, p_tenant uuid, p_author uuid) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at)
    values (p_id, p_tenant, p_author, 'Evento', 'in_person', 'Sede', 'Rua A, 1',
            now() - interval '3 days', now() - interval '3 days' + interval '2 hours')
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;

-- A ready `post` image of its tenant's admin, IDENTICAL on both sides but for the ids.
create function pg_temp.asset(p_id uuid, p_tenant uuid, p_owner uuid) returns void
language sql as $$
  insert into public.media_assets
    (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, width, height,
     variant_widths, filename, ready_at)
  values (p_id, p_tenant, p_owner, 'image', 'post', 'ready', 'image/webp', 1024, 1600, 1200,
          '{320,640,1080,1600}'::int[], 'x.webp', now())
$$;

select pg_temp.ev('1e400000-0000-4000-8000-0000000000e1', '1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002');
select pg_temp.ev('1e400000-0000-4000-8000-0000000000e2', '1e400000-0000-4000-8000-000000000011', '1e400000-0000-4000-8000-000000000012');
select pg_temp.asset('1e400000-0000-4000-8000-0000000000a1', '1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002');
select pg_temp.asset('1e400000-0000-4000-8000-0000000000a2', '1e400000-0000-4000-8000-000000000011', '1e400000-0000-4000-8000-000000000012');
select pg_temp.asset('1e400000-0000-4000-8000-0000000000a3', '1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002');
select pg_temp.asset('1e400000-0000-4000-8000-0000000000a4', '1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002');
insert into public.event_photos (id, tenant_id, event_id, media_asset_id, created_by_user_id) values
  ('1e400000-0000-4000-8000-0000000000f1', '1e400000-0000-4000-8000-000000000001',
   '1e400000-0000-4000-8000-0000000000e1', '1e400000-0000-4000-8000-0000000000a1',
   '1e400000-0000-4000-8000-000000000002'),
  ('1e400000-0000-4000-8000-0000000000f2', '1e400000-0000-4000-8000-000000000011',
   '1e400000-0000-4000-8000-0000000000e2', '1e400000-0000-4000-8000-0000000000a2',
   '1e400000-0000-4000-8000-000000000012');

-- ── 1. isolation, both directions ─────────────────────────────────────────────────────────────
select tests.as_tenant('1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002');
select results_eq(
  $$ select id from public.event_photos $$,
  $$ values ('1e400000-0000-4000-8000-0000000000f1'::uuid) $$,
  'A''s lane reads A''s photo, and only it'
);
select is_empty(
  $$ select id from public.event_photos
      where tenant_id = '1e400000-0000-4000-8000-000000000011'
         or event_id = '1e400000-0000-4000-8000-0000000000e2' $$,
  'A''s lane selects ZERO photos of B, asked for by tenant or by event'
);
reset role;
select tests.as_tenant('1e400000-0000-4000-8000-000000000011', '1e400000-0000-4000-8000-000000000012');
select results_eq(
  $$ select id from public.event_photos $$,
  $$ values ('1e400000-0000-4000-8000-0000000000f2'::uuid) $$,
  'B''s lane reads B''s photo, and only it'
);
reset role;
select tests.as_tenant_without_claims();
select is_empty(
  $$ select id from public.event_photos $$,
  'a lane with no claims (app.tenant_id() is NULL) reads no photo at all'
);
reset role;

-- ── 2. no write across tenants ────────────────────────────────────────────────────────────────
select tests.as_tenant('1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
     values ('1e400000-0000-4000-8000-000000000011', '1e400000-0000-4000-8000-0000000000e2',
             '1e400000-0000-4000-8000-0000000000a3', '1e400000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'A''s lane cannot insert a photo that says tenant B (event_photos_tenant_isolation, with check)'
);
select results_eq(
  $$ with d as (
       delete from public.event_photos where id = '1e400000-0000-4000-8000-0000000000f2' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'A''s lane DELETE of B''s photo touches nothing'
);
select results_eq(
  $$ with u as (
       update public.event_photos set created_by_user_id = '1e400000-0000-4000-8000-000000000002'
        where id = '1e400000-0000-4000-8000-0000000000f2' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  '…and so does its UPDATE'
);

-- ── 3. the posture: the API's permission decides who writes inside the tenant ─────────────────
select lives_ok(
  $$ insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
     values ('1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-0000000000e1',
             '1e400000-0000-4000-8000-0000000000a3', '1e400000-0000-4000-8000-000000000002') $$,
  'positive control: A''s lane writes A''s own photo (the manage permission is the API''s gate)'
);
reset role;

-- ── 4. the keys ───────────────────────────────────────────────────────────────────────────────
select tests.as_service();
select throws_ok(
  $$ insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
     values ('1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-0000000000e2',
             '1e400000-0000-4000-8000-0000000000a4', '1e400000-0000-4000-8000-000000000002') $$,
  '23503',
  null,
  'event_photos_event_fk: a photo of A cannot point at B''s event, even from the service lane'
);
select throws_ok(
  $$ insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
     values ('1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-0000000000e1',
             '1e400000-0000-4000-8000-0000000000a1', '1e400000-0000-4000-8000-000000000002') $$,
  '23505',
  null,
  'event_photos_tenant_asset_uq: one asset is one photo (the add''s conflict arbiter)'
);
select lives_ok(
  $$ delete from public.events where id = '1e400000-0000-4000-8000-0000000000e1' $$,
  'an event can be deleted with its photos in place…'
);
select is_empty(
  $$ select id from public.event_photos where event_id = '1e400000-0000-4000-8000-0000000000e1' $$,
  '…and its photos go with it (on delete cascade), while their assets stay for the media lifecycle'
);
reset role;

-- ── 5. the gallery rides its index, by name ───────────────────────────────────────────────────
-- 100 events x 60 photos = 6,000 rows (and their assets), then `analyze`. Sixty per event, above the
-- page's 31, so the ordered index scan stops early and a bitmap scan plus a sort is never cheaper.
with e as (
  insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address,
                             starts_at, ends_at)
  select ('1e4000e0-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         '1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002',
         'Volume ' || g, 'in_person', 'Sede', 'Rua A, 1',
         now() - interval '3 days', now() - interval '3 days' + interval '2 hours'
    from generate_series(1, 100) g
  returning id, tenant_id, format
)
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
select id, tenant_id, format, 'K7QM' from e;
insert into public.media_assets
  (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, width, height, variant_widths,
   filename, ready_at)
select ('1e4000a0-0000-4000-8000-' || lpad((g * 100 + p)::text, 12, '0'))::uuid,
       '1e400000-0000-4000-8000-000000000001', '1e400000-0000-4000-8000-000000000002',
       'image', 'post', 'ready', 'image/webp', 1024, 1600, 1200, '{320,640,1080,1600}'::int[],
       'x.webp', now()
  from generate_series(1, 100) g, generate_series(1, 60) p;
insert into public.event_photos (id, tenant_id, event_id, media_asset_id, created_by_user_id, created_at)
select ('1e4000f0-0000-4000-8000-' || lpad((g * 100 + p)::text, 12, '0'))::uuid,
       '1e400000-0000-4000-8000-000000000001',
       ('1e4000e0-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       ('1e4000a0-0000-4000-8000-' || lpad((g * 100 + p)::text, 12, '0'))::uuid,
       '1e400000-0000-4000-8000-000000000002',
       now() - make_interval(mins => p)
  from generate_series(1, 100) g, generate_series(1, 60) p;
analyze public.event_photos;
analyze public.media_assets;

create temporary table photo_plans (name text primary key, plan text);
do $$
declare
  v_plan text;
begin
  execute $q$
    explain (format json)
    select p.id,
           p.media_asset_id,
           a.variant_widths,
           to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
      from event_photos p
      join media_assets a on a.id = p.media_asset_id
       where p.tenant_id = '1e400000-0000-4000-8000-000000000001'::uuid
         and p.event_id = '1e4000e0-0000-4000-8000-000000000042'::uuid
         and a.status = 'ready'
         and (
           null::timestamptz is null
           or (p.created_at, p.id) < (null::timestamptz, null::uuid)
         )
       order by p.created_at desc, p.id desc
       limit 31
  $q$ into v_plan;
  insert into photo_plans values ('gallery', v_plan);
end
$$;
select matches(
  (select plan from photo_plans where name = 'gallery'),
  'event_photos_tenant_event_idx',
  'the gallery (tenant, event, created_at desc, id desc) rides event_photos_tenant_event_idx, BY NAME'
);
select ok(
  (select plan from photo_plans where name = 'gallery') not like '%"Node Type": "Sort"%',
  '…with no Sort node (the index order is the gallery order)'
);

select * from finish();
rollback;
