begin;
-- 199-dashboard-areas.sql — the 08.7 owner area functions executed inside Postgres (08.7-06 onward;
-- events, finance and support join later plans). INSIGHT-10, INSIGHT-14, INSIGHT-18, INSIGHT-19;
-- D-455, D-458, D-462, UI-D-484, UI-D-488, UI-D-489 b; RESEARCH Pitfalls 1, 2, 4, 5, 8, 12.
--
-- CONTENT (08.7-06, `app.dashboard_area_content`, builder v4):
--   1. KINDS AND WHO COUNTS (tenant K, `America/Sao_Paulo`): a video post (`media_kind = 'video'`),
--      a gallery with one image (photo) and with two (carousel), a post with a link preview (link),
--      a plain post (text) and a story. Likes and live comments by role `member` only, up to the
--      end of D: the admin's like, a like made today, a removed comment and the staff replies count
--      nowhere (UI-D-484). The 48-hour curve, the thread meta (a ROOT member comment is answered by
--      a reply of current staff; a member's reply answers nothing; median of 30 and 60 minutes is
--      45), a story's views as unique MEMBER viewers with their today's band (the admin's view and
--      a view made today left out) and no thread meta (UI-D-489 b). Associations: two interactors
--      with no earlier action are reactivated, one acting the same morning is not; an RSVP and a
--      paid order within 7 days after the first touch count, one before it does not; the vitrine
--      counts a linked product's order while the post was its community's newest.
--   2. WINDOW EDGES (EP-27): a post at local 00:00 of D-29 is in, one at 23:59 of D-30 is not (it
--      is Prev30's), a deleted post and a post made today are not items.
--   3. SLOTS (EP-28, UI-D-488, tenant H): 05:59 → 0h–6h and 06:00 → 6h–12h of the same Wednesday;
--      23:59 and 23:30 of a Sunday (23:30 local = 02:30Z Monday) → Sunday 18h–24h; every other cell 0,
--      and the 28 cells add up to the posts (R-Pitfall 8).
--   4. EMPTY (EP-29, tenant Z): no publication → `items: []`, KPIs 0, 28 cells of 0, weekly posts 0.
--   5. TENANT PIN (R-Pitfall 1, tenant L): a shared identity member of K and L; L's post and like
--      never appear in K's payload, and L's own build counts them.
--   6. POSTURE (T-08.7-05, R-Pitfall 12): the function is SECURITY DEFINER with an empty search_path
--      and executable by no lane role; the builder writes payload version 4 with a `content` key;
--      the stored payload names no caption (PR-1) and no viewer (PR-5).
--
-- EVENTS (08.7-08, `app.dashboard_area_events`, builder v5), section 7, tenant E:
--   upcoming from local 00:00 today on (soonest first, cancelled and deleted left out), past of
--   Window30 (23:59 of D in), confirmed = going + checked_in, check-ins and walk-ins of every
--   attendee row, the totals of Window30 and Prev30, member presences by the band of the day BEFORE
--   the event (UI-D-489 c: e1 engaged then, occasional at D), walk-ins as presences, the staff walk-in
--   with no band, the tenant pin (a shared identity's walk-in in L), EP-34 on tenant Z, PR-1, posture.
--
-- FINANCE (08.7-09, `app.dashboard_area_finance`, builder v6), section 8, tenant F: two first
--   orders of one member at the SAME instant resolve primary by id (the lower id is primary, the
--   other secondary, and the ladder path runs from the first to the second); an order revoked after
--   payment is never revenue and counts in `revoked` only, and the member's later order becomes
--   their primary; an order at 23:59 of D counts and one at local 00:00 today does not (EP-37); the
--   tenant pin (a shared identity's order in L never counts in F, and L's own build counts it);
--   `has_index` for `store_orders_tenant_paid_idx` (R-Risk 1); PR-1 (no product name stored);
--   posture.
--
-- Fixture ids use the `19900000-…` prefix and the tenants `pgtap-areas-k` / `-l` / `-h` / `-z` /
-- `-e` / `-f`, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(75);

-- ── helpers (rolled back with the file) ────────────────────────────────────────────────────────
-- D is the São Paulo yesterday; `at(k, t)` the São Paulo local instant `t` of D-k; `k_of(dow)` the
-- smallest k in 1..7 whose D-k has that ISO weekday (1 = Monday … 7 = Sunday).
create function pg_temp.d() returns date
language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date - 1 $$;
create function pg_temp.at(p_k int, p_time time default '12:00') returns timestamptz
language sql as $$ select ((pg_temp.d() - p_k)::timestamp + p_time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.k_of(p_dow int) returns int
language sql as $$
  select min(k) from generate_series(1, 7) as g(k)
   where extract(isodow from pg_temp.d() - k)::int = p_dow
$$;
create function pg_temp.build(p_tenant uuid) returns boolean
language plpgsql as $$
declare
  v boolean;
begin
  perform tests.as_tenant(p_tenant, '00000000-0000-0000-0000-000000000000', 'support_tenant');
  v := app.dashboard_build_snapshot(pg_temp.d());
  reset role;
  return v;
end
$$;
create function pg_temp.content_of(p_tenant uuid) returns jsonb
language sql as $$
  select s.payload -> 'content' from public.dashboard_snapshots s
   where s.tenant_id = p_tenant and s.snapshot_day = pg_temp.d()
$$;
create function pg_temp.item(p_tenant uuid, p_id text) returns jsonb
language sql as $$
  select x from jsonb_array_elements(pg_temp.content_of(p_tenant) -> 'items') as x
   where x ->> 'id' = '19900000-0000-4000-8000-' || p_id
$$;
create function pg_temp.cell(p_tenant uuid, p_weekday text, p_from int) returns int
language sql as $$
  select (x ->> 'posts')::int from jsonb_array_elements(pg_temp.content_of(p_tenant) -> 'heatmap') as x
   where x ->> 'weekday' = p_weekday and (x ->> 'fromHour')::int = p_from
$$;
create function pg_temp.post(p_tenant uuid, p_author uuid, p_id text, p_at timestamptz,
                             p_media text default 'none', p_community uuid default null,
                             p_link uuid default null) returns void
language sql as $$
  insert into public.feed_posts (id, tenant_id, community_id, caption, media_kind, link_preview_id,
                                 author_user_id, created_at)
  values (('19900000-0000-4000-8000-' || p_id)::uuid, p_tenant, p_community, 'Legenda secreta 199.',
          p_media, p_link, p_author, p_at)
$$;

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-areas-k', 'Áreas K', '19900000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-areas-l', 'Áreas L', '19900000-0000-4000-8000-000000000011');
select tests.tenant('pgtap-areas-h', 'Áreas H', '19900000-0000-4000-8000-000000000031');
select tests.tenant('pgtap-areas-z', 'Áreas Z', '19900000-0000-4000-8000-000000000021');
update public.tenants set timezone = 'America/Sao_Paulo'
 where id in ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000011',
              '19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000021');
select tests.auth_user('admin@areas-k.local', '19900000-0000-4000-8000-000000000002');
select tests.auth_user('support@areas-k.local', '19900000-0000-4000-8000-000000000003');
select tests.auth_user('m1@areas-k.local', '19900000-0000-4000-8000-000000000004');
select tests.auth_user('m2@areas-k.local', '19900000-0000-4000-8000-000000000005');
select tests.auth_user('m3@areas-k.local', '19900000-0000-4000-8000-000000000006');
select tests.auth_user('m4@areas-k.local', '19900000-0000-4000-8000-000000000007');
select tests.auth_user('admin@areas-l.local', '19900000-0000-4000-8000-000000000012');
select tests.auth_user('admin@areas-h.local', '19900000-0000-4000-8000-000000000032');
select tests.auth_user('admin@areas-z.local', '19900000-0000-4000-8000-000000000022');
select tests.member('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000004');
select tests.member('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000005');
select tests.member('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000006');
select tests.member('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000007');
select tests.member('19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000012', 'admin_tenant');
-- m3 is a shared identity: a member of K and of L (08.1).
select tests.member('19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000006');
select tests.member('19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000032', 'admin_tenant');
select tests.member('19900000-0000-4000-8000-000000000021', '19900000-0000-4000-8000-000000000022', 'admin_tenant');
update public.memberships set joined_at = pg_temp.at(100, '10:00')
 where tenant_id in ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000011',
                     '19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000021');

-- K's media: a video, three images, a story image; a resolved link preview.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes,
                                 width, height, duration_seconds) values
  ('19900000-0000-4000-8000-0000000000a1', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'video', 'post', 'ready', 'video/mp4', 1024, 1080, 1920, 42),
  ('19900000-0000-4000-8000-0000000000a2', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, 1080, 1350, null),
  ('19900000-0000-4000-8000-0000000000a3', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, 1080, 1080, null),
  ('19900000-0000-4000-8000-0000000000a4', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, 1080, 1080, null),
  ('19900000-0000-4000-8000-0000000000a5', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, 1080, 1920, null);
insert into public.feed_link_previews (id, tenant_id, url_hash, url, status) values
  ('19900000-0000-4000-8000-0000000000b1', '19900000-0000-4000-8000-000000000001', 'pgtap-199', 'https://exemplo.com/199', 'resolved');
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, position) values
  ('19900000-0000-4000-8000-0000000000c9', '19900000-0000-4000-8000-000000000001',
   '19900000-0000-4000-8000-000000000002', 'VIP 199', 'vip-199', 1);

-- K's posts (the admin's): e1 video D-3 10:00, e2 photo, e3 carousel, e4 link, e5 text D-2 noon (the
-- thread), e6 text 00:00 of D-29 (in), e7 text 23:59 of D-30 (out, Prev30), e9 deleted, ea made
-- today; d1 and d2 in the exclusive community at D-10 and D-5.
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e1', pg_temp.at(3, '10:00'), 'video');
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e2', pg_temp.at(4, '09:00'), 'gallery');
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e3', pg_temp.at(5, '09:00'), 'gallery');
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e4', pg_temp.at(6, '09:00'), 'none', null, '19900000-0000-4000-8000-0000000000b1');
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e5', pg_temp.at(2, '12:00'));
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e6', pg_temp.at(29, '00:00'));
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e7', pg_temp.at(30, '23:59'));
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000e9', pg_temp.at(3, '12:00'));
update public.feed_posts set deleted_at = now() where id = '19900000-0000-4000-8000-0000000000e9';
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000ea', pg_temp.at(-1, '00:30'));
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000d1', pg_temp.at(10), 'none', '19900000-0000-4000-8000-0000000000c9');
select pg_temp.post('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '0000000000d2', pg_temp.at(5), 'none', '19900000-0000-4000-8000-0000000000c9');
insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e1', 'video', '19900000-0000-4000-8000-0000000000a1', 'video', 0),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e2', 'gallery', '19900000-0000-4000-8000-0000000000a2', 'image', 0),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e3', 'gallery', '19900000-0000-4000-8000-0000000000a3', 'image', 0),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e3', 'gallery', '19900000-0000-4000-8000-0000000000a4', 'image', 1);
-- A story at D-2 20:00.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, published_at, expires_at) values
  ('19900000-0000-4000-8000-0000000000f1', '19900000-0000-4000-8000-000000000001',
   '19900000-0000-4000-8000-000000000002', '19900000-0000-4000-8000-0000000000a5', 'image',
   pg_temp.at(2, '20:00'), pg_temp.at(1, '20:00'));

-- Likes on the video (e1, D-3 10:00): m1 +1h, m2 +7h30, m3 +50h; the admin's (staff) and m4's made
-- today count nowhere.
insert into public.feed_likes (tenant_id, user_id, post_id, created_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000004', '19900000-0000-4000-8000-0000000000e1', pg_temp.at(3, '11:00')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000005', '19900000-0000-4000-8000-0000000000e1', pg_temp.at(3, '17:30')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000006', '19900000-0000-4000-8000-0000000000e1', pg_temp.at(1, '12:00')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '19900000-0000-4000-8000-0000000000e1', pg_temp.at(3, '10:30')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000007', '19900000-0000-4000-8000-0000000000e1', pg_temp.at(-1, '01:00'));
-- The thread on e5 (D-2 noon): c1 (m1, 13:00) answered by support at 13:30; c2 (m2, 14:00) answered
-- by the admin at 15:00; c3 (m3, D-1 09:00) unanswered, with a reply by m1 (a member's reply answers
-- nothing); c4 (m4) removed by the admin.
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind, created_at, deleted_at, deleted_by_user_id) values
  ('19900000-0000-4000-8000-000000000c01', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000004', 'Comentário um.', 0, null, null, null, pg_temp.at(2, '13:00'), null, null),
  ('19900000-0000-4000-8000-000000000c02', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000005', 'Comentário dois.', 0, null, null, null, pg_temp.at(2, '14:00'), null, null),
  ('19900000-0000-4000-8000-000000000c03', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000006', 'Comentário três.', 0, null, null, null, pg_temp.at(1, '09:00'), null, null),
  ('19900000-0000-4000-8000-000000000c04', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000007', 'Comentário quatro.', 0, null, null, null, pg_temp.at(1, '08:00'), pg_temp.at(1, '08:30'), '19900000-0000-4000-8000-000000000002');
insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind, created_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000003', 'Resposta da equipe.', 1, '19900000-0000-4000-8000-000000000c01', 0, 'post', pg_temp.at(2, '13:30')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000002', 'Resposta do admin.', 1, '19900000-0000-4000-8000-000000000c02', 0, 'post', pg_temp.at(2, '15:00')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000e5', '19900000-0000-4000-8000-000000000004', 'Resposta de membro.', 1, '19900000-0000-4000-8000-000000000c03', 0, 'post', pg_temp.at(1, '10:00'));
-- The story: m1 and m2 view it (D-2 21:00), the admin views it, m4 views it today; m3 likes it, m2
-- comments on it.
insert into public.story_views (tenant_id, user_id, story_id, viewed_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000004', '19900000-0000-4000-8000-0000000000f1', pg_temp.at(2, '21:00')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000005', '19900000-0000-4000-8000-0000000000f1', pg_temp.at(2, '21:00')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', '19900000-0000-4000-8000-0000000000f1', pg_temp.at(2, '21:00')),
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000007', '19900000-0000-4000-8000-0000000000f1', pg_temp.at(-1, '01:00'));
insert into public.feed_likes (tenant_id, user_id, story_id, created_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000006', '19900000-0000-4000-8000-0000000000f1', pg_temp.at(2, '22:00'));
insert into public.feed_comments (tenant_id, story_id, author_user_id, body, created_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000f1', '19900000-0000-4000-8000-000000000005', 'Resposta ao story.', pg_temp.at(2, '22:30'));
-- Associations on the video: m2's RSVP "vou" on D-2 (within 7 days after D-3 17:30) and m1's paid
-- order on D-2 (after D-3 11:00). On the thread post e5 both came BEFORE m1's and m2's first touch.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, category, capacity)
values ('19900000-0000-4000-8000-0000000000ee', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002',
        'Encontro', 'in_person', 'Sede', 'Rua A, 1', now() + interval '1 day', now() + interval '1 day 2 hours', null, 10);
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
values ('19900000-0000-4000-8000-0000000000ee', '19900000-0000-4000-8000-000000000001', 'in_person', 'AR9K');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000ee', '19900000-0000-4000-8000-000000000005', 'going', pg_temp.at(2, '12:00'));
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('19900000-0000-4000-8000-0000000000aa', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'Produto 199', 4321),
  ('19900000-0000-4000-8000-0000000000ab', '19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000002', 'VIP 199', 9900);
insert into public.store_product_communities (tenant_id, product_id, community_id) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-0000000000ab', '19900000-0000-4000-8000-0000000000c9');
insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, created_at, paid_at) values
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000004', '19900000-0000-4000-8000-0000000000aa', 'paid', 4321, 'BRL', pg_temp.at(2, '12:00'), pg_temp.at(2, '12:00')),
  -- m4 buys the VIP at D-8: while d1 (D-10) was the community's newest post (d2 is D-5).
  ('19900000-0000-4000-8000-000000000001', '19900000-0000-4000-8000-000000000007', '19900000-0000-4000-8000-0000000000ab', 'paid', 9900, 'BRL', pg_temp.at(8, '12:00'), pg_temp.at(8, '12:00'));

-- L: its own post at D-3, liked by the shared identity m3 in L.
select pg_temp.post('19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000012', '0000000000e8', pg_temp.at(3, '12:00'));
insert into public.feed_likes (tenant_id, user_id, post_id, created_at) values
  ('19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000006', '19900000-0000-4000-8000-0000000000e8', pg_temp.at(3, '13:00'));

-- H: 05:59 and 06:00 of the same Wednesday; 23:59 and 23:30 of a Sunday.
select pg_temp.post('19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000032', '0000000001a1', pg_temp.at(pg_temp.k_of(3), '05:59'));
select pg_temp.post('19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000032', '0000000001a2', pg_temp.at(pg_temp.k_of(3), '06:00'));
select pg_temp.post('19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000032', '0000000001a3', pg_temp.at(pg_temp.k_of(7), '23:59'));
select pg_temp.post('19900000-0000-4000-8000-000000000031', '19900000-0000-4000-8000-000000000032', '0000000001a4', pg_temp.at(pg_temp.k_of(7), '23:30'));

-- E (08.7-08, the events area): the admin, e1..e4 (e4 joined at D-25), e2 also a member of L (a
-- shared identity). Every event is written to start in 15 minutes (the attendance guard judges
-- now()), its attendee rows are inserted with explicit instants, then it is moved to its instants.
select tests.tenant('pgtap-areas-e', 'Áreas E', '19900000-0000-4000-8000-000000000041');
update public.tenants set timezone = 'America/Sao_Paulo' where id = '19900000-0000-4000-8000-000000000041';
select tests.auth_user('admin@areas-e.local', '19900000-0000-4000-8000-000000000042');
select tests.auth_user('e1@areas-e.local', '19900000-0000-4000-8000-000000000043');
select tests.auth_user('e2@areas-e.local', '19900000-0000-4000-8000-000000000044');
select tests.auth_user('e3@areas-e.local', '19900000-0000-4000-8000-000000000045');
select tests.auth_user('e4@areas-e.local', '19900000-0000-4000-8000-000000000046');
select tests.member('19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000042', 'admin_tenant');
select tests.member('19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000043');
select tests.member('19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000044');
select tests.member('19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000045');
select tests.member('19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000046');
select tests.member('19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000044');
update public.memberships set joined_at = pg_temp.at(100, '10:00')
 where tenant_id = '19900000-0000-4000-8000-000000000041'
    or (tenant_id = '19900000-0000-4000-8000-000000000011' and user_id = '19900000-0000-4000-8000-000000000044');
update public.memberships set joined_at = pg_temp.at(25, '10:00')
 where tenant_id = '19900000-0000-4000-8000-000000000041' and user_id = '19900000-0000-4000-8000-000000000046';
-- e1 likes four posts on D-34..D-31: active then, not in D-29..D.
select pg_temp.post('19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000042', '0000000002a' || g, pg_temp.at(45, '09:00'))
  from generate_series(1, 4) as g;
insert into public.feed_likes (tenant_id, user_id, post_id, created_at)
select '19900000-0000-4000-8000-000000000041', '19900000-0000-4000-8000-000000000043',
       ('19900000-0000-4000-8000-0000000002a' || g)::uuid, pg_temp.at(30 + g, '12:00')
  from generate_series(1, 4) as g;
create function pg_temp.event(p_tenant uuid, p_id text, p_capacity int) returns void
language sql as $$
  insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address,
                             starts_at, ends_at, category, capacity)
  values (('19900000-0000-4000-8000-' || p_id)::uuid, p_tenant,
          (select m.user_id from public.memberships m where m.tenant_id = p_tenant and m.role = 'admin_tenant'),
          'Encontro 199 secreto', 'in_person', 'Sede', 'Rua A, 1',
          now() + interval '15 minutes', now() + interval '2 hours', null, p_capacity)
$$;
create function pg_temp.attend(p_tenant uuid, p_event text, p_user uuid, p_status text,
                               p_responded timestamptz, p_checked timestamptz) returns void
language sql as $$
  insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at,
                                        checked_in_at, checkin_via)
  values (p_tenant, ('19900000-0000-4000-8000-' || p_event)::uuid, p_user, p_status, p_responded,
          p_checked, case when p_checked is not null then 'code' end)
$$;
create function pg_temp.place(p_event text, p_at timestamptz) returns void
language sql as $$
  update public.events set starts_at = p_at, ends_at = p_at + interval '2 hours'
   where id = ('19900000-0000-4000-8000-' || p_event)::uuid
$$;
-- EV1 (D-20 noon, capacity 5): e1 checked in (answered D-35), e2 walked in, e3 said "vou" and did
-- not come, e4 checked in, and the admin walked in.
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e1', 5);
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e1', '19900000-0000-4000-8000-000000000043', 'checked_in', pg_temp.at(35), pg_temp.at(20, '12:10'));
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e1', '19900000-0000-4000-8000-000000000044', 'walk_in', null, pg_temp.at(20, '12:10'));
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e1', '19900000-0000-4000-8000-000000000045', 'going', pg_temp.at(22), null);
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e1', '19900000-0000-4000-8000-000000000046', 'checked_in', pg_temp.at(22), pg_temp.at(20, '12:10'));
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e1', '19900000-0000-4000-8000-000000000042', 'walk_in', null, pg_temp.at(20, '12:10'));
select pg_temp.place('0000000002e1', pg_temp.at(20, '12:00'));
-- EV2 (D-40, Prev30): e3 checked in. EV3 (in two days): e3 said "vou". EV4 cancelled, EV5 deleted.
-- EV6 at local 00:00 today (upcoming) and EV7 at 23:59 of D (past): EP-32.
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e2', null);
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e2', '19900000-0000-4000-8000-000000000045', 'checked_in', pg_temp.at(42), pg_temp.at(40, '12:10'));
select pg_temp.place('0000000002e2', pg_temp.at(40, '12:00'));
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e3', 5);
select pg_temp.attend('19900000-0000-4000-8000-000000000041', '0000000002e3', '19900000-0000-4000-8000-000000000045', 'going', pg_temp.at(1), null);
select pg_temp.place('0000000002e3', now() + interval '2 days');
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e4', null);
select pg_temp.place('0000000002e4', pg_temp.at(10, '12:00'));
update public.events set status = 'cancelled', cancelled_at = now() where id = '19900000-0000-4000-8000-0000000002e4';
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e5', null);
select pg_temp.place('0000000002e5', pg_temp.at(12, '12:00'));
update public.events set deleted_at = now() where id = '19900000-0000-4000-8000-0000000002e5';
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e6', null);
select pg_temp.place('0000000002e6', pg_temp.at(-1, '00:00'));
select pg_temp.event('19900000-0000-4000-8000-000000000041', '0000000002e7', null);
select pg_temp.place('0000000002e7', pg_temp.at(0, '23:59'));
-- L: e2 walks in to L's own event at D-30 (Prev30 for L; inside E's X-29..X of EV1 if it leaked).
select pg_temp.event('19900000-0000-4000-8000-000000000011', '0000000002e9', null);
select pg_temp.attend('19900000-0000-4000-8000-000000000011', '0000000002e9', '19900000-0000-4000-8000-000000000044', 'walk_in', null, pg_temp.at(30, '12:10'));
select pg_temp.place('0000000002e9', pg_temp.at(30, '12:00'));
create function pg_temp.events_of(p_tenant uuid) returns jsonb
language sql as $$
  select s.payload -> 'events' from public.dashboard_snapshots s
   where s.tenant_id = p_tenant and s.snapshot_day = pg_temp.d()
$$;
create function pg_temp.event_ids(p_tenant uuid, p_group text) returns text
language sql as $$
  select coalesce(string_agg(right(x ->> 'id', 12), ',' order by ord), '')
    from jsonb_array_elements(pg_temp.events_of(p_tenant) -> p_group) with ordinality as t(x, ord)
$$;

-- ── 1. kinds and who counts ────────────────────────────────────────────────────────────────────
select is(pg_temp.build('19900000-0000-4000-8000-000000000001'), true, 'tenant K builds its yesterday');
select is(
  (select string_agg((pg_temp.item('19900000-0000-4000-8000-000000000001', id)) ->> 'kind', ',' order by id)
     from unnest(array['0000000000e1', '0000000000e2', '0000000000e3', '0000000000e4', '0000000000e5', '0000000000f1']) as id),
  'video,photo,carousel,link,text,story',
  'INSIGHT-10: media_kind video → video; one image → photo; two → carousel; a link preview → link; none → text; a story row → story');
select is((pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') ->> 'likes')::int, 3,
  'UI-D-484: the video''s member likes count (3); the admin''s like and one made today count nowhere');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') -> 'velocity48h',
  '[1, 2, 2, 2, 2, 2, 2, 2]'::jsonb,
  'velocity48h: cumulative member likes + comments at 6 … 48 hours (the +50h like is past the curve)');
select is((pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e5') ->> 'comments')::int, 4,
  'UI-D-484: live member comments count, a member''s reply included; staff replies and the removed one count nowhere');
select is(
  (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e5') -> 'commentMeta') - 'oldestUnansweredHours'::text,
  '{"answered": 2, "unanswered": 1, "firstReplyMedianMinutes": 45}'::jsonb,
  'commentMeta: a root member comment is answered by a current staff reply (a member''s reply answers nothing); median of 30 and 60 minutes is 45');
select is(
  (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e5') -> 'commentMeta' ->> 'oldestUnansweredHours')::int,
  floor(extract(epoch from (now() - pg_temp.at(1, '09:00'))) / 3600)::int,
  'EP-31: oldestUnansweredHours is the floor of the hours the oldest unanswered comment has waited at build time');
select is((pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') -> 'commentMeta' ->> 'unanswered')::int, 0,
  'a post with no comment has a zero thread meta');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') -> 'commentMeta' -> 'oldestUnansweredHours',
  'null'::jsonb, 'nothing waits → oldestUnansweredHours is null');
select is((pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000f1') ->> 'views')::int, 2,
  'D-458 / PR-5: a story''s views are its unique MEMBER viewers up to the end of D (the admin''s and today''s left out)');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000f1') -> 'reachByBand',
  '{"new": 0, "superfan": 0, "engaged": 0, "occasional": 2, "at_risk": 0, "inactive": 0}'::jsonb,
  'a story''s viewers by today''s band, raw in the snapshot (the API floors it)');
select is(
  (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000f1') ->> 'likes')::int
    || '/' || (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000f1') ->> 'comments')::int,
  '1/1', 'a story''s member likes and replies');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000f1') -> 'commentMeta',
  'null'::jsonb, 'UI-D-489 b: a story carries no thread meta (story replies are flat)');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') -> 'views',
  'null'::jsonb, 'D-455: a post stores no view number at all');
select is((pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') ->> 'reactivated')::int, 2,
  'planning decision 3: m1 and m2 had no action in the 30 days before their first touch (reactivated); m3 acted that morning');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') -> 'rsvps',
  '[{"eventId": "19900000-0000-4000-8000-0000000000ee", "members": 1}]'::jsonb,
  'an RSVP "vou" within 7 days after the first touch is associated with the publication');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e1') -> 'orders',
  '{"count": 1, "cents": 4321}'::jsonb,
  'a paid order within 7 days after the first touch is associated (count and cents)');
select is(
  (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e5') -> 'rsvps')
    || jsonb_build_array(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e5') -> 'orders'),
  '[{"count": 0, "cents": 0}]'::jsonb,
  'an RSVP and an order made BEFORE the first touch are not associated (EP-46: an empty association is 0, not floored)');
select is(
  (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000d1') ->> 'vitrine')::int
    || '/' || (pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000d2') ->> 'vitrine')::int,
  '1/0', 'the vitrine counts a linked product''s order while the post was its exclusive community''s newest');
select is(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e5') -> 'vitrine',
  'null'::jsonb, 'a post outside an exclusive community has no vitrine');
select is(
  (select jsonb_agg(x ->> 'id' order by ord)
     from jsonb_array_elements(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'items')
          with ordinality as t(x, ord)),
  (select jsonb_agg(x ->> 'id' order by (x ->> 'createdAt') desc, x ->> 'id' desc)
     from jsonb_array_elements(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'items') as x),
  'EP-30: items are stored createdAt desc, id desc');

-- ── 2. window edges (EP-27) ────────────────────────────────────────────────────────────────────
select ok(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e6') is not null,
  'EP-27: a post at local 00:00 of D-29 is in the window');
select ok(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e7') is null,
  'EP-27: a post at local 23:59 of D-30 is not');
select ok(pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000e9') is null
          and pg_temp.item('19900000-0000-4000-8000-000000000001', '0000000000ea') is null,
  'R-Pitfall 5: a deleted post and a post made today are not items');
select is(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'kpis' -> 'posts',
  '{"current": 8, "previous": 1}'::jsonb,
  'kpis.posts: the 8 live posts of Window30; the 23:59 D-30 one is Prev30''s');
select is(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'kpis' -> 'interactions' ->> 'current',
  '7', 'kpis.interactions: member likes + live comments on the window''s posts (3 + 4)');
select is(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'kpis' -> 'members' ->> 'current',
  '3', 'kpis.members: the distinct members behind them (m1, m2, m3)');
select is(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'interactorsByBand',
  '{"new": 0, "superfan": 0, "engaged": 0, "occasional": 3, "at_risk": 0, "inactive": 0}'::jsonb,
  'interactorsByBand: today''s band of the posts'' interactors (not floored, UI-D-486)');
select is(
  (select sum((x ->> 'posts')::int)::int from jsonb_array_elements(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'heatmap') as x),
  8, 'UI-D-488: the 28 cells add up to the window''s posts');
select is(
  (select sum(v::int)::int from jsonb_array_elements_text(pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'weeklyPerPost' -> 'posts') as v),
  9, 'weeklyPerPost.posts: the 12 blocks ending D hold every live post of D-83..D (the 8 and e7; not the deleted one, not today''s)');
select is(
  (pg_temp.content_of('19900000-0000-4000-8000-000000000001') -> 'byCommunity' -> 0),
  '{"communityId": null, "posts": 6, "interactions": 7}'::jsonb,
  'byCommunity: the tenant-wide feed as communityId null, most interactions first');

-- ── 3. slots (EP-28, tenant H) ─────────────────────────────────────────────────────────────────
select is(pg_temp.build('19900000-0000-4000-8000-000000000031'), true, 'tenant H builds its yesterday');
select is(pg_temp.cell('19900000-0000-4000-8000-000000000031', 'wed', 0), 1,
  'EP-28: a post at local 05:59 lands in 0h–6h');
select is(pg_temp.cell('19900000-0000-4000-8000-000000000031', 'wed', 6), 1,
  'EP-28: a post at local 06:00 lands in 6h–12h');
select is(
  (select to_char(pg_temp.at(pg_temp.k_of(7), '23:30') at time zone 'UTC', 'ID HH24:MI')),
  '1 02:30', 'the Sunday 23:30 local instant is 02:30Z on a Monday');
select is(pg_temp.cell('19900000-0000-4000-8000-000000000031', 'sun', 18), 2,
  'EP-28: 23:59 and 23:30 (02:30Z Monday) of a Sunday land in Sunday 18h–24h, on their local weekday');
select is(pg_temp.cell('19900000-0000-4000-8000-000000000031', 'mon', 0), 0,
  'EP-28: nothing lands in Monday 0h–6h');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.content_of('19900000-0000-4000-8000-000000000031') -> 'heatmap') as x
    where (x ->> 'posts')::int > 0),
  3, 'every other cell is 0: each post lands in exactly one cell (R-Pitfall 8)');

-- ── 4. empty (EP-29, tenant Z) ─────────────────────────────────────────────────────────────────
select is(pg_temp.build('19900000-0000-4000-8000-000000000021'), true, 'tenant Z builds its yesterday');
select is(pg_temp.content_of('19900000-0000-4000-8000-000000000021') -> 'items', '[]'::jsonb,
  'EP-29: a tenant with no publication answers items []');
select is(
  pg_temp.content_of('19900000-0000-4000-8000-000000000021') -> 'kpis',
  '{"posts": {"current": 0, "previous": 0}, "interactions": {"current": 0, "previous": 0}, "members": {"current": 0, "previous": 0}}'::jsonb,
  'EP-29: every KPI is 0');
select is(
  (select count(*)::int || '/' || sum((x ->> 'posts')::int + (x ->> 'interactions')::int)::int
     from jsonb_array_elements(pg_temp.content_of('19900000-0000-4000-8000-000000000021') -> 'heatmap') as x),
  '28/0', 'EP-29: 28 heatmap cells, every one 0');
select is(pg_temp.content_of('19900000-0000-4000-8000-000000000021') -> 'weeklyPerPost' -> 'posts',
  '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'::jsonb,
  'EP-29: weeklyPerPost.posts all 0 (the web leaves per-post points undefined, never 0)');

-- ── 5. tenant pin (R-Pitfall 1) ────────────────────────────────────────────────────────────────
select ok(pg_temp.content_of('19900000-0000-4000-8000-000000000001')::text not like '%0000000000e8%',
  'R-Pitfall 1: L''s post never appears in K''s payload');
select is(pg_temp.build('19900000-0000-4000-8000-000000000011'), true, 'tenant L builds its yesterday');
select is((pg_temp.item('19900000-0000-4000-8000-000000000011', '0000000000e8') ->> 'likes')::int, 1,
  'L''s own build counts the shared identity''s like in L');

-- ── 6. posture ─────────────────────────────────────────────────────────────────────────────────
select ok(
  pg_temp.content_of('19900000-0000-4000-8000-000000000001')::text not like '%Legenda secreta%'
  and pg_temp.content_of('19900000-0000-4000-8000-000000000001')::text not like '%19900000-0000-4000-8000-000000000004%',
  'PR-1 / PR-5: the stored content names no caption and no member (no viewer, no interactor)');
select is(
  (select payload_version || '/' || (payload ? 'content')::text || '/' || (payload ? 'events')::text
          || '/' || (payload ? 'finance')::text
     from public.dashboard_snapshots
    where tenant_id = '19900000-0000-4000-8000-000000000001' and snapshot_day = pg_temp.d()),
  '6/true/true/true', 'builder v6 writes payload version 6 with a content, an events and a finance key');
select ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'dashboard_area_content')
  and (select bool_and(not has_function_privilege(r, 'app.dashboard_area_content(date)', 'execute'))
         from unnest(array['anon', 'authenticated', 'service_role']) as r),
  'T-08.7-05: app.dashboard_area_content is SECURITY DEFINER with an empty search_path, executable by no lane role');

-- ── 7. events (08.7-08, tenant E) ──────────────────────────────────────────────────────────────
select is(pg_temp.build('19900000-0000-4000-8000-000000000041'), true, 'tenant E builds its yesterday');
select is(pg_temp.event_ids('19900000-0000-4000-8000-000000000041', 'upcoming'), '0000000002e6,0000000002e3',
  'EP-32 / R-Pitfall 5: upcoming are the active events from local 00:00 today on, soonest first (the cancelled and the deleted left out)');
select is(pg_temp.event_ids('19900000-0000-4000-8000-000000000041', 'past'), '0000000002e7,0000000002e1',
  'EP-32 / EP-35: past are the window''s active events, most recent first (23:59 of D is in; the Prev30 one is not listed)');
select is(
  (select x - 'id' - 'startsAt' - 'endsAt' from jsonb_array_elements(pg_temp.events_of('19900000-0000-4000-8000-000000000041') -> 'past') as x
    where x ->> 'id' = '19900000-0000-4000-8000-0000000002e1'),
  '{"format": "in_person", "capacity": 5, "confirmed": 3, "checkIns": 2, "walkIns": 2, "durationMinutes": 120}'::jsonb,
  'EP-33: confirmed is going + checked_in (a walk-in never), checkIns and walkIns every attendee row, the duration in whole minutes');
select is(
  (select (x ->> 'confirmed')::int || '/' || (x ->> 'capacity') from jsonb_array_elements(pg_temp.events_of('19900000-0000-4000-8000-000000000041') -> 'upcoming') as x
    where x ->> 'id' = '19900000-0000-4000-8000-0000000002e3'),
  '1/5', 'an upcoming event''s RSVPs "vou" at build time, beside its capacity');
select is(pg_temp.events_of('19900000-0000-4000-8000-000000000041') -> 'attendanceTotals',
  '{"current": {"confirmed": 3, "present": 4, "walkIns": 2}, "previous": {"confirmed": 1, "present": 1, "walkIns": 0}}'::jsonb,
  'planning decision 3: confirmed, presences (check-ins + walk-ins) and walk-ins of Window30 and Prev30');
select is(pg_temp.events_of('19900000-0000-4000-8000-000000000041') -> 'attendanceByBand',
  '{"new": 1, "superfan": 0, "engaged": 1, "occasional": 0, "at_risk": 0, "inactive": 1}'::jsonb,
  'UI-D-489 c: each member presence under the band of the day before the event: e1 engaged then, the walk-in e2 inactive, e4 new; the admin''s walk-in has no band');
select is(
  (select s.band from public.dashboard_member_snapshots s
    where s.tenant_id = '19900000-0000-4000-8000-000000000041' and s.user_id = '19900000-0000-4000-8000-000000000043'),
  'occasional', 'planning decision 1: e1 counted as engaged on the day before is only occasional at D (today''s band is not used)');
select ok(pg_temp.events_of('19900000-0000-4000-8000-000000000041')::text not like '%0000000002e9%',
  'R-Pitfall 1: L''s event never appears in E''s payload, and e2''s walk-in in L never makes e2 active in E');
select is(pg_temp.events_of('19900000-0000-4000-8000-000000000011') -> 'attendanceTotals' -> 'previous' ->> 'present',
  '1', 'L''s own build counts the shared identity''s walk-in in L');
select is(pg_temp.events_of('19900000-0000-4000-8000-000000000021'),
  '{"upcoming": [], "past": [], "attendanceTotals": {"current": {"confirmed": 0, "present": 0, "walkIns": 0}, "previous": {"confirmed": 0, "present": 0, "walkIns": 0}}, "attendanceByBand": {"new": 0, "superfan": 0, "engaged": 0, "occasional": 0, "at_risk": 0, "inactive": 0}}'::jsonb,
  'EP-34: a tenant with no event answers upcoming [], past [], zero totals and every band 0');
select ok(pg_temp.events_of('19900000-0000-4000-8000-000000000041')::text not like '%secreto%',
  'PR-1: the stored events name no title');
select ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'dashboard_area_events')
  and (select bool_and(not has_function_privilege(r, 'app.dashboard_area_events(date)', 'execute'))
         from unnest(array['anon', 'authenticated', 'service_role']) as r),
  'T-08.7-01: app.dashboard_area_events is SECURITY DEFINER with an empty search_path, executable by no lane role');

-- ── 8. finance (08.7-09, tenant F) ─────────────────────────────────────────────────────────────
-- F: the admin and f1..f3 (joined D-100); f3 is also a member of L (a shared identity). Products fa
-- (1000) and fb (3000) created at D-100. f1 pays fb (…3b1) and fa (…3b2) at the SAME instant of D-5;
-- f2 pays fa at D-3, revoked at D-1, then fb at D-2; f3 pays fa at 23:59 of D and fb at 00:00 today.
-- In L, f3 pays L's own product at D-4.
select tests.tenant('pgtap-areas-f', 'Áreas F', '19900000-0000-4000-8000-000000000051');
update public.tenants set timezone = 'America/Sao_Paulo' where id = '19900000-0000-4000-8000-000000000051';
select tests.auth_user('admin@areas-f.local', '19900000-0000-4000-8000-000000000052');
select tests.auth_user('f1@areas-f.local', '19900000-0000-4000-8000-000000000053');
select tests.auth_user('f2@areas-f.local', '19900000-0000-4000-8000-000000000054');
select tests.auth_user('f3@areas-f.local', '19900000-0000-4000-8000-000000000055');
select tests.member('19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000052', 'admin_tenant');
select tests.member('19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000053');
select tests.member('19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000054');
select tests.member('19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000055');
select tests.member('19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000055');
update public.memberships set joined_at = pg_temp.at(100, '10:00')
 where tenant_id = '19900000-0000-4000-8000-000000000051'
    or (tenant_id = '19900000-0000-4000-8000-000000000011' and user_id = '19900000-0000-4000-8000-000000000055');
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, created_at) values
  ('19900000-0000-4000-8000-0000000003a1', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000052', 'Produto secreto 199 A', 1000, pg_temp.at(100)),
  ('19900000-0000-4000-8000-0000000003a2', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000052', 'Produto secreto 199 B', 3000, pg_temp.at(100)),
  ('19900000-0000-4000-8000-0000000003a9', '19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000012', 'Produto secreto 199 L', 500, pg_temp.at(100));
insert into public.store_orders (id, tenant_id, user_id, product_id, status, amount_cents, currency, created_at, paid_at, revoked_at) values
  ('19900000-0000-4000-8000-0000000003b1', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000053', '19900000-0000-4000-8000-0000000003a2', 'paid', 3000, 'BRL', pg_temp.at(5), pg_temp.at(5), null),
  ('19900000-0000-4000-8000-0000000003b2', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000053', '19900000-0000-4000-8000-0000000003a1', 'paid', 1000, 'BRL', pg_temp.at(5), pg_temp.at(5), null),
  ('19900000-0000-4000-8000-0000000003b3', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000054', '19900000-0000-4000-8000-0000000003a1', 'revoked', 1000, 'BRL', pg_temp.at(3), pg_temp.at(3), pg_temp.at(1)),
  ('19900000-0000-4000-8000-0000000003b4', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000054', '19900000-0000-4000-8000-0000000003a2', 'paid', 3000, 'BRL', pg_temp.at(2), pg_temp.at(2), null),
  ('19900000-0000-4000-8000-0000000003b5', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000055', '19900000-0000-4000-8000-0000000003a1', 'paid', 1000, 'BRL', pg_temp.at(0, '23:59'), pg_temp.at(0, '23:59'), null),
  ('19900000-0000-4000-8000-0000000003b6', '19900000-0000-4000-8000-000000000051', '19900000-0000-4000-8000-000000000055', '19900000-0000-4000-8000-0000000003a2', 'paid', 3000, 'BRL', pg_temp.at(-1, '00:00'), pg_temp.at(-1, '00:00'), null),
  ('19900000-0000-4000-8000-0000000003b9', '19900000-0000-4000-8000-000000000011', '19900000-0000-4000-8000-000000000055', '19900000-0000-4000-8000-0000000003a9', 'paid', 500, 'BRL', pg_temp.at(4), pg_temp.at(4), null);
create function pg_temp.finance_of(p_tenant uuid) returns jsonb
language sql as $$
  select s.payload -> 'finance' from public.dashboard_snapshots s
   where s.tenant_id = p_tenant and s.snapshot_day = pg_temp.d()
$$;
create function pg_temp.product_of(p_tenant uuid, p_id text) returns jsonb
language sql as $$
  select x from jsonb_array_elements(pg_temp.finance_of(p_tenant) -> 'byProduct') as x
   where x ->> 'productId' = '19900000-0000-4000-8000-' || p_id
$$;

select is(pg_temp.build('19900000-0000-4000-8000-000000000051'), true, 'tenant F builds its yesterday');
select is(pg_temp.finance_of('19900000-0000-4000-8000-000000000051') -> 'primary' -> 'current',
  '{"orders": 3, "cents": 7000}'::jsonb,
  'INSIGHT-12: primary are f1''s lower id (fb, of the same-instant pair), f2''s fb (its revoked fa never counts) and f3''s fa');
select is(pg_temp.finance_of('19900000-0000-4000-8000-000000000051') -> 'secondary' -> 'current',
  '{"orders": 1, "cents": 1000}'::jsonb,
  'EP-37: the other order of the same-instant pair (the higher id) is secondary');
select is(pg_temp.finance_of('19900000-0000-4000-8000-000000000051') -> 'totals' -> 'current',
  '{"orders": 4, "cents": 8000, "buyers": 3}'::jsonb,
  'EP-37: 23:59 of D counts, local 00:00 today does not, and a revoked order is never revenue');
select is(pg_temp.finance_of('19900000-0000-4000-8000-000000000051') -> 'revoked' -> 'current',
  '{"orders": 1, "cents": 1000, "buyers": 1}'::jsonb,
  'the order revoked after payment counts in revoked only (raw here; the API floors it)');
select is(
  (select (x -> 'current') - 'cents' from pg_temp.product_of('19900000-0000-4000-8000-000000000051', '0000000003a2') as x),
  '{"orders": 2, "buyers": 2, "entry": 2, "addon": 0}'::jsonb,
  'byProduct: fb sold twice, both entries (primary orders)');
select is(
  (select (x -> 'current') - 'cents' from pg_temp.product_of('19900000-0000-4000-8000-000000000051', '0000000003a1') as x),
  '{"orders": 2, "buyers": 2, "entry": 1, "addon": 1}'::jsonb,
  'byProduct: fa an entry for f3 and an add-on for f1 (f2''s revoked fa left out)');
select is(pg_temp.finance_of('19900000-0000-4000-8000-000000000051') -> 'ladder',
  '[{"entryProductId": "19900000-0000-4000-8000-0000000003a2", "nextProductId": "19900000-0000-4000-8000-0000000003a1", "people": 1, "averageDays": 0.0}]'::jsonb,
  'the ladder by product runs from the primary of the tie to the other, 0 days apart');
select ok(pg_temp.finance_of('19900000-0000-4000-8000-000000000051')::text not like '%0000000003a9%'
  and pg_temp.finance_of('19900000-0000-4000-8000-000000000051')::text not like '%0000000003b9%',
  'R-Pitfall 1: the shared identity''s order in L never appears in F''s payload');
delete from public.dashboard_snapshots where tenant_id = '19900000-0000-4000-8000-000000000011';
select is(
  (pg_temp.build('19900000-0000-4000-8000-000000000011')::text || '/' ||
   (pg_temp.finance_of('19900000-0000-4000-8000-000000000011') -> 'totals' -> 'current')::text),
  'true/{"cents": 500, "buyers": 1, "orders": 1}',
  'L''s own build counts the shared identity''s order in L');
select has_index('public', 'store_orders', 'store_orders_tenant_paid_idx', array['tenant_id', 'paid_at'],
  'R-Risk 1: store_orders_tenant_paid_idx (tenant_id, paid_at) exists for the window scans');
select ok(pg_temp.finance_of('19900000-0000-4000-8000-000000000051')::text not like '%secreto%',
  'PR-1: the stored finance names no product');
select ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'dashboard_area_finance')
  and (select bool_and(not has_function_privilege(r, 'app.dashboard_area_finance(date)', 'execute'))
         from unnest(array['anon', 'authenticated', 'service_role']) as r),
  'T-08.7-18: app.dashboard_area_finance is SECURITY DEFINER with an empty search_path, executable by no lane role');

select * from finish();
rollback;
