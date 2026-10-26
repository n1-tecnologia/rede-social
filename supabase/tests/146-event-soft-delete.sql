begin;
-- 146-event-soft-delete.sql — deleting an event (09.3-04, PEND-01, PEND-02, PEND-13, D-548, D-550),
-- executed inside Postgres. Numbered 146 after 145-event-schedule. Like its siblings, this file ROLLS
-- BACK, and writes every event together with its `event_secrets` row in ONE statement.
--
-- The delete is `update events set deleted_at = now(), updated_at = now() where tenant_id = … and id
-- = … and deleted_at is null` on the tenant lane. What the database must guarantee for it:
--
-- 1. THE OWNING LANE SOFT-DELETES: tenant A's admin lane sets `deleted_at` on A's event, and
--    `updated_at` moves (the fixture's was written in 2020).
--
-- 2. CROSS-TENANT NEGATIVE (PEND-13, T-09.3-15): tenant B's member lane running the SAME update on A's
--    event touches zero rows (RLS filters rather than raises), so A's event keeps `deleted_at is
--    null`; a select of A's event from B's lane returns zero rows, with A's own member lane reading
--    one as the positive control.
--
-- 3. NOTHING CASCADES (D-214, D-550, T-09.3-20): the answers (a `going` and a `checked_in`), the
--    secrets row and the photo of the deleted event are identical afterwards, and the member still
--    reads its own attendance row through its own lane.
--
-- 4. THE SQL FUNCTIONS KEEP THEIR OWN FILTER: the attendance guard refuses a NEW answer on the deleted
--    event with 23503 `event_not_found`, the same code it raises for an event that does not exist
--    (the control: the same insert on a live event is accepted).
--
-- 5. NO TRIGGER WRITES ELSEWHERE: `public.events` has no non-internal UPDATE trigger, so a soft delete
--    cannot touch another table behind the API's back.
--
-- 6. WHERE THE FILTER LIVES: the owning lane's plain select still returns the deleted row (RLS does
--    not hide it; the API's `deleted_at is null` predicate does).
--
-- Fixture ids use the `1e600000-…` prefix, free of 145's `1e500000-…`.
select plan(16);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-del-a', 'Exclusao A', '1e600000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-del-b', 'Exclusao B', '1e600000-0000-4000-8000-000000000011');
select tests.auth_user('member@del-a.local', '1e600000-0000-4000-8000-000000000002');
select tests.auth_user('admin@del-a.local', '1e600000-0000-4000-8000-000000000003');
select tests.auth_user('other@del-a.local', '1e600000-0000-4000-8000-000000000004');
select tests.auth_user('member@del-b.local', '1e600000-0000-4000-8000-000000000012');
select tests.member('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000002');
select tests.member('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000003', 'admin_tenant');
select tests.member('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000004');
select tests.member('1e600000-0000-4000-8000-000000000011', '1e600000-0000-4000-8000-000000000012');

-- Both halves of one event in ONE statement. `updated_at` is written in 2020 so a later `now()` is
-- visibly different (now() is the transaction timestamp: it never moves inside this file).
create function pg_temp.ev(p_id uuid, p_starts timestamptz, p_ends timestamptz) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, updated_at)
    values (p_id, '1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000003',
            'Evento', 'in_person', 'Sede', 'Rua A, 1', p_starts, p_ends, '2020-01-01 00:00:00+00')
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;

-- E1: starts in 30 minutes (inside the check-in window, so a checked_in row may exist). E2: tomorrow.
select pg_temp.ev('1e600000-0000-4000-8000-0000000000e1', now() + interval '30 minutes', now() + interval '2 hours 30 minutes');
select pg_temp.ev('1e600000-0000-4000-8000-0000000000e2', now() + interval '1 day', now() + interval '1 day 2 hours');

-- E1 holds a going answer, a check-in and a photo (the asset is tenant A's).
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via) values
  ('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-0000000000e1', '1e600000-0000-4000-8000-000000000002', 'going', now(), null, null),
  ('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-0000000000e1', '1e600000-0000-4000-8000-000000000003', 'checked_in', now(), now(), 'code');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('1e600000-0000-4000-8000-0000000000a1', '1e600000-0000-4000-8000-000000000001',
   '1e600000-0000-4000-8000-000000000003', 'image', 'post', 'ready', 'image/webp', 1024, '{320,640}');
insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id) values
  ('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-0000000000e1',
   '1e600000-0000-4000-8000-0000000000a1', '1e600000-0000-4000-8000-000000000003');

-- What the delete must leave alone, captured before it runs.
create temporary table kept_before on commit drop as
select (select jsonb_agg(to_jsonb(a) order by a.user_id) from public.event_attendances a
         where a.event_id = '1e600000-0000-4000-8000-0000000000e1') as attendances,
       (select jsonb_agg(to_jsonb(s)) from public.event_secrets s
         where s.event_id = '1e600000-0000-4000-8000-0000000000e1') as secrets,
       (select jsonb_agg(to_jsonb(p)) from public.event_photos p
         where p.event_id = '1e600000-0000-4000-8000-0000000000e1') as photos;

-- ── 1. the owning lane soft-deletes ───────────────────────────────────────────────────────────
select tests.as_tenant('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000003', 'admin_tenant');
select lives_ok(
  $$ update public.events set deleted_at = now(), updated_at = now()
      where tenant_id = '1e600000-0000-4000-8000-000000000001'
        and id = '1e600000-0000-4000-8000-0000000000e1'
        and deleted_at is null $$,
  'PEND-01: tenant A''s admin lane soft-deletes A''s event'
);
reset role;
select isnt(
  (select deleted_at from public.events where id = '1e600000-0000-4000-8000-0000000000e1'),
  null,
  '…and deleted_at is now filled'
);
select ok(
  (select updated_at > '2020-01-01 00:00:00+00' from public.events where id = '1e600000-0000-4000-8000-0000000000e1'),
  '…and updated_at moved'
);
select is(
  (select deleted_at from public.events where id = '1e600000-0000-4000-8000-0000000000e1'),
  now(),
  '…to the statement''s now(), the only instant the delete writes'
);

-- ── 2. cross-tenant negative: another tenant's lane touches zero rows ──────────────────────────
select tests.as_tenant('1e600000-0000-4000-8000-000000000011', '1e600000-0000-4000-8000-000000000012');
select lives_ok(
  $$ update public.events set deleted_at = now(), updated_at = now()
      where id = '1e600000-0000-4000-8000-0000000000e2' $$,
  'PEND-13: tenant B''s member lane running the same update on A''s event raises nothing (RLS filters)'
);
select is_empty(
  $$ select id from public.events where id = '1e600000-0000-4000-8000-0000000000e2' $$,
  '…and B''s lane cannot even read A''s event'
);
reset role;
select is(
  (select deleted_at from public.events where id = '1e600000-0000-4000-8000-0000000000e2'),
  null,
  '…so A''s event still has deleted_at null (zero rows were touched)'
);
select tests.as_tenant('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.events where id = '1e600000-0000-4000-8000-0000000000e2'),
  1,
  'positive control: A''s own member lane reads that same event'
);
reset role;

-- ── 3. nothing cascades ───────────────────────────────────────────────────────────────────────
select is(
  (select jsonb_agg(to_jsonb(a) order by a.user_id) from public.event_attendances a
    where a.event_id = '1e600000-0000-4000-8000-0000000000e1'),
  (select attendances from kept_before),
  'D-550: the going answer and the check-in of the deleted event are identical afterwards'
);
select is(
  (select jsonb_agg(to_jsonb(s)) from public.event_secrets s where s.event_id = '1e600000-0000-4000-8000-0000000000e1'),
  (select secrets from kept_before),
  '…the secrets row is identical'
);
select is(
  (select jsonb_agg(to_jsonb(p)) from public.event_photos p where p.event_id = '1e600000-0000-4000-8000-0000000000e1'),
  (select photos from kept_before),
  '…and the photo row is identical'
);
select tests.as_tenant('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000002');
select is(
  (select status from public.event_attendances
    where event_id = '1e600000-0000-4000-8000-0000000000e1' and user_id = '1e600000-0000-4000-8000-000000000002'),
  'going',
  'D-550: the member still reads its own attendance row of the deleted event through its own lane'
);
reset role;

-- ── 4. the attendance guard keeps its own filter ──────────────────────────────────────────────
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-0000000000e1',
             '1e600000-0000-4000-8000-000000000004', 'going', now()) $$,
  '23503',
  'event_not_found',
  'a NEW answer on the deleted event is refused 23503 event_not_found, like an event that does not exist'
);
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-0000000000e2',
             '1e600000-0000-4000-8000-000000000004', 'going', now()) $$,
  '…and the same answer on a live event is accepted (the control)'
);

-- ── 5. no trigger writes elsewhere ────────────────────────────────────────────────────────────
select is_empty(
  $$ select t.tgname
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'events'
        and not t.tgisinternal and (t.tgtype & 16) = 16 $$,
  'public.events has no non-internal UPDATE trigger: a soft delete cannot write another table'
);

-- ── 6. where the filter lives ─────────────────────────────────────────────────────────────────
select tests.as_tenant('1e600000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.events where id = '1e600000-0000-4000-8000-0000000000e1'),
  1,
  'RLS does not hide a deleted event from its own tenant: the API''s deleted_at predicate does'
);
reset role;

select * from finish();
rollback;
