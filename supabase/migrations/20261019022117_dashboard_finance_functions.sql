-- dashboard_finance_functions (08.7-09, D-455, D-460, D-462, D-465, UI-D-470, UI-D-490,
-- INSIGHT-12, INSIGHT-14, INSIGHT-18; RESEARCH § O5 Financeiro, Privacy floor, Pitfalls 1, 5, 12,
-- R-Risk 1) — the owner's Financeiro numbers, built once a day. Hand-written (`--custom`), sorted
-- AFTER `*_dashboard_events_functions.sql` (builder v5), whose builder it replaces, and after
-- `*_store_dashboard_indexes.sql`, whose `store_orders_tenant_paid_idx (tenant_id, paid_at)` the
-- order scans below use.
--
-- D = the snapshot day (the tenant-local yesterday); Window30 = local days D-29..D; Prev30 =
-- D-59..D-30; `until_at` = local midnight of D+1 (today 00:00 local).
--
--   1. `app.dashboard_area_finance(p_day date) jsonb`, ids and numbers only (PR-1), RAW numbers
--      (the privacy floor is the API's, D-462):
--      - WHO COUNTS: the orders of ACTIVE ROLE MEMBERS of this tenant (UI-D-484's counted set), so
--        the band split adds up to the totals and every buyers list's total is its number.
--      - PAID AS OF `until_at` (EP-37, EP-41): an order counts when `paid_at < until_at` and it was
--        not revoked before `until_at` (`status = 'paid'`, or `revoked` with `revoked_at >=
--        until_at`). An order paid or revoked after the build's end therefore changes nothing until
--        the next day's build, whenever the build runs. A revoked order is never revenue: it counts
--        in `revoked` only, dated by `revoked_at`.
--      - PRIMARY / SECONDARY: each member's first paid order (as of `until_at`) by `paid_at, id` is
--        primary, every later one secondary (two first orders at the same instant resolve by id);
--        computed here, never stored on the order.
--      - `totals`, `primary`, `secondary` and `revoked` of Window30 and Prev30; `byProduct` (every
--        product created before `until_at`: Window30 orders, cents, buyers, entries and add-ons,
--        Prev30, the last sale, the product's Window30 revocations, its 12 + 12 weekly cents and its
--        Window30 orders by the buyer's band of today), most cents first; `byBand` (Window30 orders
--        by the buyer's band of today, the member rows of this build); `weekly` primary and
--        secondary cents in 24 blocks of 7 local days (12 ending D, 12 before); `summary` at D and
--        at D-30 (`base` active members joined by then, `rebought` members with 2+ paid orders,
--        `timeToSecondDays` the median local days from the first to the second, `lifetimeCents`),
--        each as of its own instant; `ladder` keyed by PRODUCT (first paid product → second, people,
--        average days; planning decision 1: no offer table exists); `neverAgain` (members with
--        exactly one paid order, by today's band); `attention.stalled` (ACTIVE products with no paid
--        order — or, never sold, no existence — for more than 60 local days, longest first).
--      - `vip` (UI-D-490, planning decision 3): the exclusive community (an active community
--        linked to a product through `store_product_communities`) with the most ACTIVE HOLDERS (a
--        counted member with an entitlement to a linked product, created before `until_at` and not
--        revoked before it — the 08.2 access rule), ties by id; its holders `at_risk` / `inactive`
--        today and of those the ones with push (`has_push`); the most common FIRST paid product
--        among the superfãs and engajados who do not hold it (`entryProductId`, ties by id) and how
--        many of them entered through it (`prospects`); the Window30 cents of its linked products.
--        Null when no product opens an active community.
--      - `contentSales` / `eventSales` (planning decision 4): Window30 paid orders within 7 days
--        AFTER the buyer's own like or live comment on a live post / check-in or walk-in at an
--        active event (the touch in (paid_at - 7 days, paid_at]), each order counted once per post
--        or event, and once in the totals — association, never cause.
--      Every `jsonb_agg` carries an explicit `order by` (EP-40: a forced rebuild over unchanged rows
--      writes a byte-identical payload). Product, community and event names are NOT stored.
--   2. `app.dashboard_build_snapshot(p_day date)` v6: the v5 body kept whole, the payload version
--      bumped to 6 (so the hourly dispatcher rebuilds every tenant within the hour), and
--      `'finance', app.dashboard_area_finance(p_day)` added to the payload, AFTER the member rows
--      are written in the same transaction (it reads their `band` and `has_push`).
--
-- Posture (T-08.7-12, T-08.7-18, T-08.7-21): `security definer set search_path = ''` with fully
-- qualified names; the owner bypasses RLS, so EVERY source predicate pins `tenant_id =
-- app.tenant_id()` and the member set joins on `(tenant_id, user_id)`: a shared identity's orders in
-- another tenant never count here (R-Pitfall 1). The new function is executable by no role but its
-- owner; the builder keeps its revoke/grant pair. No statement picks a single row with a LIMIT
-- (pgTAP 040). Expand-only: no table, column or policy changes.

create or replace function app.dashboard_area_finance(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30_at,
           ((p_day - 59)::timestamp at time zone t.timezone) as prev30_at,
           ((p_day + 1)::timestamp at time zone t.timezone) as until_at
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  -- The counted set: active role members of this tenant (UI-D-484).
  m as (
    select ms.id, ms.user_id, ms.joined_at
      from public.memberships ms
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
  ),
  -- The member rows the builder has just written: today's band and push of each member.
  r as (
    select s.membership_id, s.band, s.has_push
      from public.dashboard_member_snapshots s
     where s.tenant_id = app.tenant_id()
  ),
  bands as (
    select v.band
      from (values ('new'), ('superfan'), ('engaged'), ('occasional'), ('at_risk'), ('inactive')) as v(band)
  ),
  -- Every order of a counted member paid before until_at, with its standing at until_at (live_now)
  -- and at from30_at (live_then), and its window.
  o as (
    select so.id, so.product_id, so.amount_cents as cents, so.paid_at, m.id as membership_id,
           (so.paid_at at time zone b.tz)::date as local_day,
           (so.status = 'paid'
            or (so.status = 'revoked' and coalesce(so.revoked_at >= b.until_at, false))) as live_now,
           (so.paid_at < b.from30_at
            and (so.status = 'paid'
                 or (so.status = 'revoked' and coalesce(so.revoked_at >= b.from30_at, false)))) as live_then,
           case when so.paid_at >= b.from30_at then 'cur'
                when so.paid_at >= b.prev30_at then 'prev' end as grp
      from public.store_orders so
      join m on m.user_id = so.user_id
      cross join b
     where so.tenant_id = app.tenant_id()
       and so.paid_at is not null
       and so.paid_at < b.until_at
  ),
  -- Paid as of until_at, ranked per member: rn 1 is primary, every later one secondary.
  pn as (
    select o.id, o.product_id, o.cents, o.paid_at, o.membership_id, o.local_day, o.grp,
           row_number() over (partition by o.membership_id order by o.paid_at, o.id) as rn
      from o
     where o.live_now
  ),
  -- Paid as of from30_at: the summary at D-30.
  pt as (
    select o.id, o.cents, o.membership_id, o.local_day,
           row_number() over (partition by o.membership_id order by o.paid_at, o.id) as rn
      from o
     where o.live_then
  ),
  tot as (
    select jsonb_build_object(
             'current', jsonb_build_object(
               'orders', count(*) filter (where pn.grp = 'cur'),
               'cents', coalesce(sum(pn.cents) filter (where pn.grp = 'cur'), 0),
               'buyers', count(distinct pn.membership_id) filter (where pn.grp = 'cur')),
             'previous', jsonb_build_object(
               'orders', count(*) filter (where pn.grp = 'prev'),
               'cents', coalesce(sum(pn.cents) filter (where pn.grp = 'prev'), 0),
               'buyers', count(distinct pn.membership_id) filter (where pn.grp = 'prev'))) as totals,
           jsonb_build_object(
             'current', jsonb_build_object(
               'orders', count(*) filter (where pn.grp = 'cur' and pn.rn = 1),
               'cents', coalesce(sum(pn.cents) filter (where pn.grp = 'cur' and pn.rn = 1), 0)),
             'previous', jsonb_build_object(
               'orders', count(*) filter (where pn.grp = 'prev' and pn.rn = 1),
               'cents', coalesce(sum(pn.cents) filter (where pn.grp = 'prev' and pn.rn = 1), 0))) as prim,
           jsonb_build_object(
             'current', jsonb_build_object(
               'orders', count(*) filter (where pn.grp = 'cur' and pn.rn > 1),
               'cents', coalesce(sum(pn.cents) filter (where pn.grp = 'cur' and pn.rn > 1), 0)),
             'previous', jsonb_build_object(
               'orders', count(*) filter (where pn.grp = 'prev' and pn.rn > 1),
               'cents', coalesce(sum(pn.cents) filter (where pn.grp = 'prev' and pn.rn > 1), 0))) as sec
      from pn
  ),
  -- Orders of counted members revoked in Window30 / Prev30 (by revoked_at): never revenue.
  rv as (
    select so.product_id, so.amount_cents as cents, m.id as membership_id,
           case when so.revoked_at >= b.from30_at then 'cur' else 'prev' end as grp
      from public.store_orders so
      join m on m.user_id = so.user_id
      cross join b
     where so.tenant_id = app.tenant_id()
       and so.status = 'revoked'
       and so.revoked_at >= b.prev30_at
       and so.revoked_at < b.until_at
  ),
  rvt as (
    select jsonb_build_object(
             'current', jsonb_build_object(
               'orders', count(*) filter (where rv.grp = 'cur'),
               'cents', coalesce(sum(rv.cents) filter (where rv.grp = 'cur'), 0),
               'buyers', count(distinct rv.membership_id) filter (where rv.grp = 'cur')),
             'previous', jsonb_build_object(
               'orders', count(*) filter (where rv.grp = 'prev'),
               'cents', coalesce(sum(rv.cents) filter (where rv.grp = 'prev'), 0),
               'buyers', count(distinct rv.membership_id) filter (where rv.grp = 'prev'))) as v
      from rv
  ),
  -- The tenant's products that existed at until_at.
  pr as (
    select p.id, p.status, (p.created_at at time zone b.tz)::date as created_day
      from public.store_products p
      cross join b
     where p.tenant_id = app.tenant_id()
       and p.created_at < b.until_at
  ),
  ps as (
    select pn.product_id,
           count(*) filter (where pn.grp = 'cur') as c_orders,
           coalesce(sum(pn.cents) filter (where pn.grp = 'cur'), 0) as c_cents,
           count(distinct pn.membership_id) filter (where pn.grp = 'cur') as c_buyers,
           count(*) filter (where pn.grp = 'cur' and pn.rn = 1) as c_entry,
           count(*) filter (where pn.grp = 'cur' and pn.rn > 1) as c_addon,
           count(*) filter (where pn.grp = 'prev') as p_orders,
           coalesce(sum(pn.cents) filter (where pn.grp = 'prev'), 0) as p_cents,
           count(distinct pn.membership_id) filter (where pn.grp = 'prev') as p_buyers,
           max(pn.paid_at) as last_at
      from pn
     group by pn.product_id
  ),
  prv as (
    select rv.product_id, count(*) as n, sum(rv.cents) as cents,
           count(distinct rv.membership_id) as buyers
      from rv
     where rv.grp = 'cur'
     group by rv.product_id
  ),
  -- 24 blocks of 7 local days by paid day: 23 = D-6..D, 0 = D-167..D-161.
  pwk as (
    select pr.id as product_id,
           jsonb_build_object(
             'current', jsonb_agg(coalesce(y.cents, 0) order by k.j) filter (where k.j >= 12),
             'previous', jsonb_agg(coalesce(y.cents, 0) order by k.j) filter (where k.j < 12)) as v
      from pr
      cross join generate_series(0, 23) as k(j)
      left join (
        select pn.product_id, 23 - (p_day - pn.local_day) / 7 as j, sum(pn.cents) as cents
          from pn
         where pn.local_day > p_day - 168
         group by 1, 2
      ) y on y.product_id = pr.id and y.j = k.j
     group by pr.id
  ),
  -- Window30 paid orders with the buyer's band of today.
  pnb as (
    select pn.product_id, pn.cents, pn.membership_id, r.band
      from pn
      join r on r.membership_id = pn.membership_id
     where pn.grp = 'cur'
  ),
  pbb as (
    select pr.id as product_id,
           jsonb_object_agg(bands.band, jsonb_build_object(
             'orders', coalesce(z.n, 0), 'cents', coalesce(z.cents, 0),
             'buyers', coalesce(z.buyers, 0))) as v
      from pr
      cross join bands
      left join (
        select pnb.product_id, pnb.band, count(*) as n, sum(pnb.cents) as cents,
               count(distinct pnb.membership_id) as buyers
          from pnb
         group by 1, 2
      ) z on z.product_id = pr.id and z.band = bands.band
     group by pr.id
  ),
  bp as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'productId', pr.id,
             'current', jsonb_build_object(
               'orders', coalesce(ps.c_orders, 0), 'cents', coalesce(ps.c_cents, 0),
               'buyers', coalesce(ps.c_buyers, 0), 'entry', coalesce(ps.c_entry, 0),
               'addon', coalesce(ps.c_addon, 0)),
             'previous', jsonb_build_object(
               'orders', coalesce(ps.p_orders, 0), 'cents', coalesce(ps.p_cents, 0),
               'buyers', coalesce(ps.p_buyers, 0)),
             'lastSaleAt', to_char(ps.last_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'revoked', jsonb_build_object(
               'orders', coalesce(prv.n, 0), 'cents', coalesce(prv.cents, 0),
               'buyers', coalesce(prv.buyers, 0)),
             'weekly', pwk.v,
             'byBand', pbb.v)
           order by coalesce(ps.c_cents, 0) desc, pr.id), '[]'::jsonb) as v
      from pr
      left join ps on ps.product_id = pr.id
      left join prv on prv.product_id = pr.id
      left join pwk on pwk.product_id = pr.id
      left join pbb on pbb.product_id = pr.id
  ),
  bb as (
    select jsonb_object_agg(bands.band, jsonb_build_object(
             'orders', coalesce(z.n, 0), 'cents', coalesce(z.cents, 0),
             'buyers', coalesce(z.buyers, 0))) as v
      from bands
      left join (
        select pnb.band, count(*) as n, sum(pnb.cents) as cents,
               count(distinct pnb.membership_id) as buyers
          from pnb
         group by pnb.band
      ) z on z.band = bands.band
  ),
  wk as (
    select jsonb_build_object(
             'primary', jsonb_build_object(
               'current', jsonb_agg(coalesce(y.pc, 0) order by k.j) filter (where k.j >= 12),
               'previous', jsonb_agg(coalesce(y.pc, 0) order by k.j) filter (where k.j < 12)),
             'secondary', jsonb_build_object(
               'current', jsonb_agg(coalesce(y.sc, 0) order by k.j) filter (where k.j >= 12),
               'previous', jsonb_agg(coalesce(y.sc, 0) order by k.j) filter (where k.j < 12))) as v
      from generate_series(0, 23) as k(j)
      left join (
        select 23 - (p_day - pn.local_day) / 7 as j,
               sum(pn.cents) filter (where pn.rn = 1) as pc,
               sum(pn.cents) filter (where pn.rn > 1) as sc
          from pn
         where pn.local_day > p_day - 168
         group by 1
      ) y on y.j = k.j
  ),
  -- Per member, as of until_at: orders, cents, the first and second paid days and products.
  pm as (
    select pn.membership_id, count(*) as n, sum(pn.cents) as cents,
           max(pn.local_day) filter (where pn.rn = 1) as first_day,
           max(pn.local_day) filter (where pn.rn = 2) as second_day,
           max(pn.product_id::text) filter (where pn.rn = 1) as first_product,
           max(pn.product_id::text) filter (where pn.rn = 2) as second_product
      from pn
     group by pn.membership_id
  ),
  -- The same as of from30_at.
  pmt as (
    select pt.membership_id, count(*) as n, sum(pt.cents) as cents,
           max(pt.local_day) filter (where pt.rn = 1) as first_day,
           max(pt.local_day) filter (where pt.rn = 2) as second_day
      from pt
     group by pt.membership_id
  ),
  sm as (
    select jsonb_build_object(
             'current', jsonb_build_object(
               'base', (select count(*) from m cross join b where m.joined_at < b.until_at),
               'rebought', (select count(*) from pm where pm.n >= 2),
               'timeToSecondDays', (select round((percentile_cont(0.5) within group
                                                  (order by pm.second_day - pm.first_day))::numeric, 1)
                                      from pm where pm.n >= 2),
               'lifetimeCents', (select coalesce(sum(pm.cents), 0) from pm)),
             'previous', jsonb_build_object(
               'base', (select count(*) from m cross join b where m.joined_at < b.from30_at),
               'rebought', (select count(*) from pmt where pmt.n >= 2),
               'timeToSecondDays', (select round((percentile_cont(0.5) within group
                                                  (order by pmt.second_day - pmt.first_day))::numeric, 1)
                                      from pmt where pmt.n >= 2),
               'lifetimeCents', (select coalesce(sum(pmt.cents), 0) from pmt))) as v
  ),
  lad as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'entryProductId', x.first_product,
             'nextProductId', x.second_product,
             'people', x.people,
             'averageDays', x.avg_days)
           order by x.people desc, x.first_product, x.second_product), '[]'::jsonb) as v
      from (
        select pm.first_product, pm.second_product, count(*) as people,
               round(avg(pm.second_day - pm.first_day)::numeric, 1) as avg_days
          from pm
         where pm.n >= 2
         group by pm.first_product, pm.second_product
      ) x
  ),
  na as (
    select jsonb_object_agg(bands.band, coalesce(z.n, 0)) as v
      from bands
      left join (
        select r.band, count(*) as n
          from pm
          join r on r.membership_id = pm.membership_id
         where pm.n = 1
         group by r.band
      ) z on z.band = bands.band
  ),
  st as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'productId', x.id,
             'days', x.days,
             'lastSaleAt', to_char(x.last_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
           order by x.days desc, x.id), '[]'::jsonb) as v
      from (
        select pr.id, ps.last_at,
               p_day - coalesce((ps.last_at at time zone b.tz)::date, pr.created_day) as days
          from pr
          left join ps on ps.product_id = pr.id
          cross join b
         where pr.status = 'active'
      ) x
     where x.days > 60
  ),
  -- UI-D-490: the exclusive communities (active, linked to a product) and their active holders.
  linked as (
    select l.community_id, l.product_id
      from public.store_product_communities l
      join public.communities c
        on c.id = l.community_id
       and c.tenant_id = app.tenant_id()
       and c.status = 'active'
       and c.deleted_at is null
     where l.tenant_id = app.tenant_id()
  ),
  hold as (
    select distinct lk.community_id, m.id as membership_id
      from linked lk
      join public.store_entitlements e
        on e.tenant_id = app.tenant_id()
       and e.product_id = lk.product_id
      join m on m.user_id = e.user_id
      cross join b
     where e.created_at < b.until_at
       and (e.status = 'active' or coalesce(e.revoked_at >= b.until_at, false))
  ),
  vc as (
    select x.community_id, x.holders
      from (
        select lc.community_id, count(hold.membership_id) as holders,
               row_number() over (order by count(hold.membership_id) desc, lc.community_id) as pick
          from (select distinct linked.community_id from linked) lc
          left join hold on hold.community_id = lc.community_id
         group by lc.community_id
      ) x
     where x.pick = 1
  ),
  vh as (
    select hold.membership_id
      from hold
      join vc on vc.community_id = hold.community_id
  ),
  vf as (
    select count(*) filter (where r.band = 'at_risk') as at_risk,
           count(*) filter (where r.band = 'inactive') as inactive,
           count(*) filter (where r.band in ('at_risk', 'inactive') and r.has_push) as with_push
      from vh
      join r on r.membership_id = vh.membership_id
  ),
  vp as (
    select x.first_product, x.n
      from (
        select pm.first_product, count(*) as n,
               row_number() over (order by count(*) desc, pm.first_product) as pick
          from pm
          join r on r.membership_id = pm.membership_id
         where r.band in ('superfan', 'engaged')
           and not exists (select 1 from vh where vh.membership_id = pm.membership_id)
         group by pm.first_product
      ) x
     where x.pick = 1
  ),
  vrev as (
    select coalesce(sum(pn.cents), 0) as cents
      from pn
     where pn.grp = 'cur'
       and exists (select 1 from linked lk join vc on vc.community_id = lk.community_id
                    where lk.product_id = pn.product_id)
  ),
  vip as (
    select jsonb_build_object(
             'communityId', vc.community_id,
             'entryProductId', (select vp.first_product from vp),
             'holders', vc.holders,
             'fading', jsonb_build_object(
               'atRisk', vf.at_risk, 'inactive', vf.inactive, 'withPush', vf.with_push),
             'prospects', coalesce((select vp.n from vp), 0),
             'revenueCents', vrev.cents) as v
      from vc
      cross join vf
      cross join vrev
  ),
  -- Planning decision 4: a member's likes and live comments on posts, from 7 days before Window30.
  touch as (
    select l.user_id, l.post_id, l.created_at as at
      from public.feed_likes l
      cross join b
     where l.tenant_id = app.tenant_id()
       and l.post_id is not null
       and l.created_at >= b.from30_at - interval '7 days'
       and l.created_at < b.until_at
    union all
    select c.author_user_id, c.post_id, c.created_at
      from public.feed_comments c
      cross join b
     where c.tenant_id = app.tenant_id()
       and c.post_id is not null
       and c.deleted_at is null
       and c.created_at >= b.from30_at - interval '7 days'
       and c.created_at < b.until_at
  ),
  cs as (
    select distinct pn.id, pn.membership_id, pn.product_id, pn.cents, t.post_id
      from pn
      join m on m.id = pn.membership_id
      join touch t
        on t.user_id = m.user_id
       and t.at <= pn.paid_at
       and t.at > pn.paid_at - interval '7 days'
      join public.feed_posts p
        on p.id = t.post_id
       and p.tenant_id = app.tenant_id()
       and p.deleted_at is null
     where pn.grp = 'cur'
  ),
  csp as (
    select cs.post_id, cs.product_id, count(*) as n, sum(cs.cents) as cents,
           count(distinct cs.membership_id) as buyers
      from cs
     group by cs.post_id, cs.product_id
  ),
  csj as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'postId', x.post_id, 'orders', x.n, 'cents', x.cents, 'buyers', x.buyers,
             'products', x.products)
           order by x.n desc, x.cents desc, x.post_id), '[]'::jsonb) as v
      from (
        select cs.post_id, count(*) as n, sum(cs.cents) as cents,
               count(distinct cs.membership_id) as buyers,
               (select jsonb_agg(jsonb_build_object(
                         'productId', csp.product_id, 'orders', csp.n, 'cents', csp.cents,
                         'buyers', csp.buyers)
                       order by csp.n desc, csp.cents desc, csp.product_id)
                  from csp where csp.post_id = cs.post_id) as products
          from cs
         group by cs.post_id
      ) x
  ),
  cst as (
    select jsonb_build_object('orders', count(*), 'cents', coalesce(sum(y.cents), 0),
                              'buyers', count(distinct y.membership_id)) as v
      from (select distinct cs.id, cs.cents, cs.membership_id from cs) y
  ),
  es as (
    select distinct pn.id, pn.membership_id, pn.cents, ea.event_id
      from pn
      join m on m.id = pn.membership_id
      join public.event_attendances ea
        on ea.tenant_id = app.tenant_id()
       and ea.user_id = m.user_id
       and ea.status in ('checked_in', 'walk_in')
       and ea.checked_in_at <= pn.paid_at
       and ea.checked_in_at > pn.paid_at - interval '7 days'
      join public.events e
        on e.id = ea.event_id
       and e.tenant_id = app.tenant_id()
       and e.status = 'active'
       and e.deleted_at is null
     where pn.grp = 'cur'
  ),
  esj as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'eventId', x.event_id, 'orders', x.n, 'cents', x.cents, 'buyers', x.buyers)
           order by x.n desc, x.cents desc, x.event_id), '[]'::jsonb) as v
      from (
        select es.event_id, count(*) as n, sum(es.cents) as cents,
               count(distinct es.membership_id) as buyers
          from es
         group by es.event_id
      ) x
  ),
  est as (
    select jsonb_build_object('orders', count(*), 'cents', coalesce(sum(y.cents), 0),
                              'buyers', count(distinct y.membership_id)) as v
      from (select distinct es.id, es.cents, es.membership_id from es) y
  )
  select jsonb_build_object(
           'totals', (select tot.totals from tot),
           'primary', (select tot.prim from tot),
           'secondary', (select tot.sec from tot),
           'revoked', (select rvt.v from rvt),
           'byProduct', (select bp.v from bp),
           'byBand', (select bb.v from bb),
           'weekly', (select wk.v from wk),
           'summary', (select sm.v from sm),
           'ladder', (select lad.v from lad),
           'neverAgain', (select na.v from na),
           'attention', jsonb_build_object('stalled', (select st.v from st)),
           'vip', (select vip.v from vip),
           'contentSales', jsonb_build_object('posts', (select csj.v from csj),
                                              'total', (select cst.v from cst)),
           'eventSales', jsonb_build_object('events', (select esj.v from esj),
                                            'total', (select est.v from est)))
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_finance(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 6 since 08.7-09:
  -- the payload carries `finance`.
  v_version constant int := 6;
  v_tenant uuid := app.tenant_id();
  v_tz text;
begin
  if v_tenant is null
     or app.user_id() is distinct from '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'dashboard build: system lane only' using errcode = '42501';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_tenant;
  if v_tz is null then
    raise exception 'dashboard build: unknown tenant' using errcode = '42501';
  end if;

  if p_day is null or p_day >= (now() at time zone v_tz)::date then
    raise exception 'dashboard build: % is not a complete day', p_day using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.dashboard_snapshots s
     where s.tenant_id = v_tenant
       and s.snapshot_day = p_day
       and s.payload_version = v_version
  ) then
    return false;
  end if;

  -- The member rows first (latest only, PR-2): the members and content areas below read exactly these.
  delete from public.dashboard_member_snapshots where tenant_id = v_tenant;
  insert into public.dashboard_member_snapshots
         (tenant_id, membership_id, user_id, snapshot_day, built_at, band, band_d30, band_d60,
          last_active_at, active_days_30, strong_30, top_community_id, has_push, community_bands,
          insights)
  select * from app.dashboard_member_rows(p_day);

  -- 08.7-03: each member's own "Sua atividade" numbers, in the same transaction (D-463).
  update public.dashboard_member_snapshots s
     set activity = a.activity
    from app.dashboard_member_activity(p_day) a
   where s.tenant_id = v_tenant
     and s.membership_id = a.membership_id;

  insert into public.dashboard_snapshots
         (tenant_id, snapshot_day, payload_version, built_at, windows, payload)
  values (
    v_tenant,
    p_day,
    v_version,
    now(),
    jsonb_build_object(
      'day', to_char(p_day, 'YYYY-MM-DD'),
      'from30', to_char(p_day - 29, 'YYYY-MM-DD'),
      'prev30From', to_char(p_day - 59, 'YYYY-MM-DD'),
      'from7', to_char(p_day - 6, 'YYYY-MM-DD'),
      'prev7From', to_char(p_day - 13, 'YYYY-MM-DD'),
      'from30At', to_char(((p_day - 29)::timestamp at time zone v_tz) at time zone 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'prev30At', to_char(((p_day - 59)::timestamp at time zone v_tz) at time zone 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'untilAt', to_char(((p_day + 1)::timestamp at time zone v_tz) at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    jsonb_build_object(
      'overview', app.dashboard_area_overview(p_day),
      'members', app.dashboard_area_members(p_day),
      'content', app.dashboard_area_content(p_day),
      'events', app.dashboard_area_events(p_day),
      'finance', app.dashboard_area_finance(p_day))
  )
  on conflict (tenant_id, snapshot_day) do update
     set payload_version = excluded.payload_version,
         built_at = excluded.built_at,
         windows = excluded.windows,
         payload = excluded.payload;

  return true;
end
$$;--> statement-breakpoint
revoke all on function app.dashboard_build_snapshot(date) from public, anon;--> statement-breakpoint
grant execute on function app.dashboard_build_snapshot(date) to authenticated;
