begin;
-- 050-tenant-domains-invariants.sql — the assumption-delta invariants of plan 02-09 (D-35, D-36),
-- as the DATABASE sees them. Until 02-09 a tenant's host was a seed constant; from there on it is a
-- chosen, mutable, possibly-plural set managed at runtime, so the singular assumption must not be
-- able to come back silently:
--   * every tenant has at most ONE `is_primary` row (partial unique index
--     `tenant_domains_one_primary_per_tenant`);
--   * every host belongs to exactly ONE tenant (unique `tenant_domains_host_key`), case variants are
--     one host (citext equality) and an upper-cased spelling cannot even be stored
--     (`tenant_domains_host_chk` — hosts are lower-cased at the boundary by `normalizeHost`);
--   * `verification_status` is one of the four lifecycle values (`tenant_domains_verification_status_chk`);
--   * `verified_at is not null` is the routing predicate — an unverified host resolves nowhere.
--
-- Runs in one transaction that rolls back, so it re-runs identically in any order (TENANT-05).
select plan(6);

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-dom-a', 'Domínios A', '0d000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-dom-b', 'Domínios B', '0d000000-0000-4000-8000-000000000002');

insert into public.tenant_domains (host, tenant_id, is_primary, verified_at, verification_status) values
  ('inv-a.test', '0d000000-0000-4000-8000-000000000001', true, now(), 'verified'),
  ('inv-b-pending.test', '0d000000-0000-4000-8000-000000000002', true, null, 'pending');

-- ── (1) at most one primary per tenant ──────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.tenant_domains (host, tenant_id, is_primary)
     values ('inv-a-second.test', '0d000000-0000-4000-8000-000000000001', true) $$,
  '23505',
  null,
  'D-35: a second is_primary row for the same tenant is refused by tenant_domains_one_primary_per_tenant'
);

-- ── (2) one tenant per host ─────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.tenant_domains (host, tenant_id, is_primary)
     values ('inv-a.test', '0d000000-0000-4000-8000-000000000002', false) $$,
  '23505',
  null,
  'D-34/D-20: a host already attached to tenant A cannot be attached to tenant B (tenant_domains_host_key)'
);

-- ── (3) the lifecycle vocabulary is closed ──────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.tenant_domains (host, tenant_id, verification_status)
     values ('inv-b-bogus.test', '0d000000-0000-4000-8000-000000000002', 'bogus') $$,
  '23514',
  null,
  'D-34: verification_status accepts only pending | verified | expired | failed'
);

-- ── (4) no tenant currently holds two primaries ─────────────────────────────────────────────────
select is(
  (select count(*) from (
     select tenant_id from public.tenant_domains where is_primary
      group by tenant_id having count(*) > 1) x),
  0::bigint,
  'D-35: no tenant in the database has more than one primary host'
);

-- ── (5) a verified host resolves to exactly one tenant, whatever the spelling ───────────────────
-- The lookup uses an upper-cased spelling on purpose: citext equality is what makes
-- `Comunidade.Cliente.com.br` and `comunidade.cliente.com.br` one row (edge TENANT-07/adjacency).
select is(
  (select count(distinct tenant_id) from public.tenant_domains
    where host = 'INV-A.TEST' and verified_at is not null),
  1::bigint,
  'D-36: the verified host inv-a.test maps to exactly one tenant, found case-insensitively'
);

-- ── (6) an unverified host never satisfies the routing predicate ────────────────────────────────
select is(
  (select count(*) from public.tenant_domains
    where host = 'inv-b-pending.test' and verified_at is not null),
  0::bigint,
  'D-36: a pending host (verified_at null) is invisible to the verified-only resolver predicate'
);

select * from finish();
rollback;
