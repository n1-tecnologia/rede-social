begin;
-- 228-store-categories.sql — Phase 12.3 (NOVF-07, NOVF-08, NOVF-09, NOVF-11; D-690, D-691, D-692, D-700; T-12.3-02, T-12.3-03,
-- T-12.3-06, T-12.3-07): the two new store tables of migration `*_store_categories.sql`, the seed, the load and the guess rule of
-- `*_store_categories_functions.sql`, executed inside Postgres.
--
--  1. SHAPE and the CHECK boundaries of `store_categories` and `store_front` (slug 24 ok and 25 refused; name 1 and 30 ok, 0 and 31
--     refused; a bad icon refused; 5 featured products ok and 6 refused), the two uniqueness rules (slug and `lower(name)` per
--     tenant, the same values allowed in two tenants), and the two `on delete set null` keys.
--  2. THE SEED (D-691, once and never again): the seam `app.store_seed_categories_for` claims the seed by the marker row (8 rows the
--     first time, 0 the second time, 0 after the admin deleted some or all), the lazy `app.store_seed_categories()` seeds only the
--     CALLER's tenant, and the execute privileges are exact.
--  3. THE POLICIES: the admin of A writes A's rows; a member and a support member of A and the admin of B write none, each negative
--     beside its positive control; a tenant-B session reads none of A's rows; TRUNCATE is revoked from `authenticated`.
--
-- WHAT THE DATABASE DOES NOT DO (T-12.3-03). `store_products.category_id` is a plain single-column foreign key to
-- `store_categories(id)`, so the DATABASE itself would accept a product that points at ANOTHER tenant's category id. The guard is
-- the service (plan 12.3-11), which resolves the category by its slug UNDER ROW-LEVEL SECURITY. What this file asserts is the half
-- that makes that guard sound: a tenant-A session cannot read tenant B's category rows (section 3), so a service lookup can never
-- return a foreign id. This file does NOT claim that the database refuses a foreign category id.
--
-- Fixture ids use the `28000000-0000-4000-8000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK and leaves
-- nothing behind. Tenants: A (policies; admin, support, member), B (the other tenant; admin), K and K2 (CHECK boundaries and the
-- twin rows), S, T, U (the seed), plus a product in A and in B for the front row's promo column.
select plan(120);

-- ── fixture helpers (rolled back with the file) ─────────────────────────────────────────────────
-- One category row as the migration role (a direct insert, no seed).
create function tests.sc_cat(p_tenant uuid, p_slug text, p_name text, p_icon text default 'package', p_pos int default 1)
returns void language sql as $$
  insert into public.store_categories (tenant_id, slug, name, icon, position) values (p_tenant, p_slug, p_name, p_icon, p_pos);
$$;
-- One product row. `created_by_user_id` is the shared creator user; the status is the column default.
create function tests.sc_prod(p_id uuid, p_tenant uuid, p_name text, p_category uuid default null, p_status text default 'active')
returns void language sql as $$
  insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, category_id, status)
  values (p_id, p_tenant, '28000000-0000-4000-8000-020000000005', p_name, 1990, p_category, p_status);
$$;

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-sc2-a', 'Sc2 A', '28000000-0000-4000-8000-010000000001');
select tests.tenant('pgtap-sc2-b', 'Sc2 B', '28000000-0000-4000-8000-010000000002');
select tests.tenant('pgtap-sc2-k', 'Sc2 K', '28000000-0000-4000-8000-010000000003');
select tests.tenant('pgtap-sc2-k2', 'Sc2 K2', '28000000-0000-4000-8000-010000000004');
select tests.tenant('pgtap-sc2-s', 'Sc2 S', '28000000-0000-4000-8000-010000000005');
select tests.tenant('pgtap-sc2-t', 'Sc2 T', '28000000-0000-4000-8000-010000000006');
select tests.tenant('pgtap-sc2-u', 'Sc2 U', '28000000-0000-4000-8000-010000000007');
-- u1 admin of A, u2 support of A, u3 member of A, u4 admin of B, u5 the creator of every fixture product.
select tests.auth_user('admin@sc2-a.local', '28000000-0000-4000-8000-020000000001');
select tests.auth_user('support@sc2-a.local', '28000000-0000-4000-8000-020000000002');
select tests.auth_user('member@sc2-a.local', '28000000-0000-4000-8000-020000000003');
select tests.auth_user('admin@sc2-b.local', '28000000-0000-4000-8000-020000000004');
select tests.auth_user('creator@sc2.local', '28000000-0000-4000-8000-020000000005');
-- One product in A and one in B (the promo column of the front row points at them). A and B are seeded in section 2 before any load.
select tests.sc_prod('28000000-0000-4000-8000-040000000001', '28000000-0000-4000-8000-010000000001', 'Produto A');
select tests.sc_prod('28000000-0000-4000-8000-040000000002', '28000000-0000-4000-8000-010000000002', 'Produto B');

-- ── (1) SHAPE ─────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'store_categories', 'shape: store_categories exists');
select has_table('public', 'store_front', 'shape: store_front exists');
select col_not_null('public', 'store_categories', 'tenant_id', 'shape: store_categories.tenant_id is not null');
select col_not_null('public', 'store_categories', 'slug', 'shape: store_categories.slug is not null');
select col_not_null('public', 'store_categories', 'name', 'shape: store_categories.name is not null');
select col_not_null('public', 'store_categories', 'icon', 'shape: store_categories.icon is not null');
select col_not_null('public', 'store_categories', 'position', 'shape: store_categories.position is not null');
select results_eq(
  $$ select column_name::text collate "default" from information_schema.columns
      where table_schema = 'public' and table_name = 'store_categories' order by 1 $$,
  $$ values ('created_at'), ('icon'), ('id'), ('name'), ('position'), ('slug'), ('tenant_id'), ('updated_at') $$,
  'shape: store_categories holds exactly id, tenant_id, slug, name, icon, position and the two timestamps');
select results_eq(
  $$ select column_name::text collate "default" from information_schema.columns
      where table_schema = 'public' and table_name = 'store_front' order by 1 $$,
  $$ values ('categories_seeded_at'), ('featured_product_ids'), ('promo_product_id'), ('tenant_id'), ('updated_at') $$,
  'shape: store_front holds exactly tenant_id, promo_product_id, featured_product_ids, categories_seeded_at and updated_at');
select col_is_pk('public', 'store_front', 'tenant_id', 'shape: store_front carries one row per tenant (tenant_id is the primary key)');
select col_is_null('public', 'store_front', 'categories_seeded_at', 'shape: the seed marker is nullable (null = never seeded)');
select col_is_null('public', 'store_front', 'promo_product_id', 'shape: the promo product is optional');
select col_not_null('public', 'store_front', 'featured_product_ids', 'shape: the featured list is never null');
select col_has_default('public', 'store_front', 'featured_product_ids', 'shape: the featured list defaults (to empty)');
select col_type_is('public', 'store_products', 'category_id', 'uuid', 'shape: store_products.category_id is uuid');
select col_is_null('public', 'store_products', 'category_id', 'shape: store_products.category_id is optional (nothing is made required)');
select col_hasnt_default('public', 'store_products', 'category_id', 'shape: store_products.category_id has no default');
select results_eq(
  $$ select (c.conname || '=' || c.confdeltype::text)::text collate "default" from pg_constraint c
      where c.conname in ('store_products_category_id_store_categories_id_fk', 'store_front_promo_product_id_store_products_id_fk')
      order by 1 $$,
  $$ values ('store_front_promo_product_id_store_products_id_fk=n'), ('store_products_category_id_store_categories_id_fk=n') $$,
  'on delete set null: both optional keys (a product to its category, the front row to its promo product) clear instead of block');
select results_eq(
  $$ select (c.conname || '=' || c.confdeltype::text)::text collate "default" from pg_constraint c
      where c.conname in ('store_categories_tenant_id_tenants_id_fk', 'store_front_tenant_id_tenants_id_fk') order by 1 $$,
  $$ values ('store_categories_tenant_id_tenants_id_fk=c'), ('store_front_tenant_id_tenants_id_fk=c') $$,
  'on delete cascade: both tables follow their tenant');

-- ── (1b) THE CHECK BOUNDARIES, as the migration role on tenant K ───────────────────────────────
-- slug: 1..24 characters of [a-z0-9-], not starting or ending with a hyphen.
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', repeat('a', 24), 'Slug de 24') $$,
  'slug boundary: a 24-character slug is accepted');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', repeat('a', 25), 'Slug de 25') $$,
  '23514', null, 'slug boundary: a 25-character slug is refused');
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'a', 'Slug de 1') $$,
  'slug boundary: a 1-character slug is accepted');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'Abc', 'Slug maiuscula') $$,
  '23514', null, 'slug shape: an uppercase slug is refused');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', '-abc', 'Slug hifen inicio') $$,
  '23514', null, 'slug shape: a slug that starts with a hyphen is refused');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'abc-', 'Slug hifen fim') $$,
  '23514', null, 'slug shape: a slug that ends with a hyphen is refused');
-- name: 1..30 characters.
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'nome-1', 'x') $$,
  'name boundary: a 1-character name is accepted');
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'nome-30', repeat('n', 30)) $$,
  'name boundary: a 30-character name is accepted');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'nome-0', '') $$,
  '23514', null, 'name boundary: an empty name is refused');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'nome-31', repeat('n', 31)) $$,
  '23514', null, 'name boundary: a 31-character name is refused');
-- icon: 1..32 characters of [a-z0-9-].
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'icone-32', 'Icone 32', repeat('i', 32)) $$,
  'icon boundary: a 32-character icon is accepted');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'icone-33', 'Icone 33', repeat('i', 33)) $$,
  '23514', null, 'icon boundary: a 33-character icon is refused');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'icone-ruim', 'Icone ruim', 'Bad Icon') $$,
  '23514', null, 'icon shape: a bad icon (capital letters and a space) is refused');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'icone-vazio', 'Icone vazio', '') $$,
  '23514', null, 'icon shape: an empty icon is refused');
-- position: never negative.
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'pos-neg', 'Pos negativa', 'package', -1) $$,
  '23514', null, 'position: a negative position is refused');
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'pos-zero', 'Pos zero', 'package', 0) $$,
  'position: zero is accepted');

-- ── (1c) UNIQUENESS per tenant, and the same values in two tenants ─────────────────────────────
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'nome-1', 'Outro nome') $$,
  '23505', null, 'unique (tenant, slug): the same slug twice in one tenant is refused');
select throws_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000003', 'outro-slug', 'X') $$,
  '23505', null, 'unique (tenant, lower(name)): the same name in another case is refused in one tenant (x then X)');
select lives_ok(
  $$ select tests.sc_cat('28000000-0000-4000-8000-010000000004', 'nome-1', 'x') $$,
  'adjacency: the same slug and the same name in the OTHER tenant are accepted');
select results_eq(
  $$ select count(*)::int from public.store_categories
      where slug = 'nome-1' and tenant_id in ('28000000-0000-4000-8000-010000000003', '28000000-0000-4000-8000-010000000004') $$,
  array[2], 'adjacency: the twin slug exists as two rows, one per tenant');
update public.store_categories set name = 'Renomeada' where tenant_id = '28000000-0000-4000-8000-010000000004' and slug = 'nome-1';
select results_eq(
  $$ select name::text from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000003' and slug = 'nome-1' $$,
  array['x'], 'adjacency: a rename in K2 never touches the same-named row of K');
delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000004' and slug = 'nome-1';
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000003' and slug = 'nome-1' $$,
  array[1], 'adjacency: a delete in K2 never touches the same-slug row of K');

-- ── (1d) store_front: 5 featured products ok, 6 refused; the two keys clear on delete ─────────
select lives_ok(
  $$ insert into public.store_front (tenant_id, featured_product_ids) values ('28000000-0000-4000-8000-010000000003', array[
       '28000000-0000-4000-8000-0f0000000001', '28000000-0000-4000-8000-0f0000000002', '28000000-0000-4000-8000-0f0000000003',
       '28000000-0000-4000-8000-0f0000000004', '28000000-0000-4000-8000-0f0000000005']::uuid[]) $$,
  'featured boundary: 5 featured products are accepted');
select throws_ok(
  $$ update public.store_front set featured_product_ids = array[
       '28000000-0000-4000-8000-0f0000000001', '28000000-0000-4000-8000-0f0000000002', '28000000-0000-4000-8000-0f0000000003',
       '28000000-0000-4000-8000-0f0000000004', '28000000-0000-4000-8000-0f0000000005', '28000000-0000-4000-8000-0f0000000006']::uuid[]
      where tenant_id = '28000000-0000-4000-8000-010000000003' $$,
  '23514', null, 'featured boundary: 6 featured products are refused (an update from 5 to 6)');
select throws_ok(
  $$ insert into public.store_front (tenant_id, featured_product_ids) values ('28000000-0000-4000-8000-010000000004', array[
       '28000000-0000-4000-8000-0f0000000001', '28000000-0000-4000-8000-0f0000000002', '28000000-0000-4000-8000-0f0000000003',
       '28000000-0000-4000-8000-0f0000000004', '28000000-0000-4000-8000-0f0000000005', '28000000-0000-4000-8000-0f0000000006']::uuid[]) $$,
  '23514', null, 'featured boundary: 6 featured products are refused (an insert)');
select lives_ok(
  $$ insert into public.store_front (tenant_id) values ('28000000-0000-4000-8000-010000000004') $$,
  'featured default: a front row with no featured list is accepted');
select results_eq(
  $$ select cardinality(featured_product_ids) from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000004' $$,
  array[0], 'featured default: the default list is empty');
-- the two foreign keys clear (set null) when the target row goes away
select tests.sc_prod('28000000-0000-4000-8000-040000000003', '28000000-0000-4000-8000-010000000003', 'Produto K',
  (select id from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000003' and slug = 'nome-1'));
update public.store_front set promo_product_id = '28000000-0000-4000-8000-040000000003' where tenant_id = '28000000-0000-4000-8000-010000000003';
delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000003' and slug = 'nome-1';
select results_eq(
  $$ select count(*)::int from public.store_products where id = '28000000-0000-4000-8000-040000000003' and category_id is null $$,
  array[1], 'set null: deleting a category keeps the product and clears its category_id');
delete from public.store_products where id = '28000000-0000-4000-8000-040000000003';
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000003' and promo_product_id is null $$,
  array[1], 'set null: deleting the promo product clears the front row''s promo_product_id');

-- ── (2) THE SEED (D-691, once and never again) ─────────────────────────────────────────────────
-- 2a. the seam, as the migration role, on tenant S.
select is_empty(
  $$ select 1 from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000005' $$,
  'seed: a tenant never seeded has no front row (no marker)');
select results_eq(
  $$ select app.store_seed_categories_for('28000000-0000-4000-8000-010000000005') $$,
  array[true], 'seed once: the seam claims the first seed of S (returns true)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000005' $$,
  array[8], 'seed once: eight rows the first time');
select results_eq(
  $$ select (position::text || ':' || slug || ':' || name || ':' || icon)::text collate "default"
       from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000005' order by position $$,
  $$ values ('1:cursos:Cursos:graduation-cap'), ('2:livros:Livros:book-open'), ('3:materiais:Materiais:file-text'),
            ('4:roupas:Roupas:shirt'), ('5:perfumes:Perfumes:spray-can'), ('6:equipamentos:Equipamentos:wrench'),
            ('7:servicos:Serviços:calendar-check'), ('8:outros:Outros:package') $$,
  'seed: the eight rows carry the built-in slugs, names, icons and positions 1 to 8');
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000005' and categories_seeded_at is not null $$,
  array[1], 'seed: the marker row now says the store was seeded');
select results_eq(
  $$ select app.store_seed_categories_for('28000000-0000-4000-8000-010000000005') $$,
  array[false], 'seed once: the second call claims nothing (returns false)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000005' $$,
  array[8], 'seed once: still eight rows after the second call (zero inserted)');
delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000005';
select results_eq(
  $$ select app.store_seed_categories_for('28000000-0000-4000-8000-010000000005') $$,
  array[false], 'seed never again: after the admin deleted EVERY category the seam still claims nothing');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000005' $$,
  array[0], 'seed never again: the emptied store stays empty (zero inserted after a delete-all)');
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000005' and categories_seeded_at is not null $$,
  array[1], 'seed never again: the marker row stays after the delete-all');
select results_eq(
  $$ select app.store_seed_categories_for(null::uuid) $$,
  array[false], 'seed: a null tenant seeds nothing and answers false');
-- 2b. a partial first run: some rows deleted, the seam called again leaves the same rows (T).
select app.store_seed_categories_for('28000000-0000-4000-8000-010000000006');
delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000006' and slug in ('livros', 'roupas', 'outros');
select results_eq(
  $$ select app.store_seed_categories_for('28000000-0000-4000-8000-010000000006') $$,
  array[false], 'partial first run: the seam repeated after a partial run claims nothing');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000006' $$,
  array[5], 'partial first run: the five surviving rows are exactly what is left (nothing is re-added)');
-- 2c. a front row that exists without the marker (the promo set before any seed) and an admin-made category: the claim keeps both.
insert into public.store_front (tenant_id, promo_product_id) values ('28000000-0000-4000-8000-010000000007', null);
select tests.sc_cat('28000000-0000-4000-8000-010000000007', 'cursos', 'Meus cursos', 'star', 1);
select results_eq(
  $$ select app.store_seed_categories_for('28000000-0000-4000-8000-010000000007') $$,
  array[true], 'claim: a front row with no marker is claimed by the seam (it seeds)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000007' $$,
  array[8], 'claim: the admin''s own cursos row stands in for the built-in one (7 new rows plus 1 kept, never 9)');
select results_eq(
  $$ select name::text from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000007' and slug = 'cursos' $$,
  array['Meus cursos'], 'claim: the admin''s own row is kept as the admin named it (on conflict do nothing)');
-- 2d. the lazy seed, as a TENANT session: only the caller's tenant.
select tests.as_tenant('28000000-0000-4000-8000-010000000002', '28000000-0000-4000-8000-020000000004', 'admin_tenant');
select results_eq($$ select app.store_seed_categories() $$, array[true], 'lazy seed: the admin of B seeds B (returns true)');
select results_eq($$ select app.store_seed_categories() $$, array[false], 'lazy seed: a second call by B seeds nothing (returns false)');
reset role;
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000002' $$,
  array[8], 'lazy seed: B holds eight rows');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000001' $$,
  array[0], 'lazy seed: a tenant-B session left tenant A alone (A still holds none)');
select tests.as_tenant('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-020000000003', 'member');
select results_eq($$ select app.store_seed_categories() $$, array[true], 'lazy seed: a MEMBER of A seeds A (the definer, not the role, writes)');
reset role;
select results_eq(
  $$ select tenant_id::text || '=' || count(*)::text from public.store_categories
      where tenant_id in ('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-010000000002') group by tenant_id order by 1 $$,
  $$ values ('28000000-0000-4000-8000-010000000001=8'), ('28000000-0000-4000-8000-010000000002=8') $$,
  'lazy seed: A and B hold eight rows each (the second seed never reached B, it never doubled)');
select tests.as_tenant_without_claims();
select results_eq($$ select app.store_seed_categories() $$, array[false], 'lazy seed: a session with no tenant claim does nothing (returns false)');
reset role;
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id::text like '28000000-%' $$,
  array[7], 'lazy seed: the claimless session wrote no front row (exactly the seven fixture front rows of A, B, K, K2, S, T and U exist)');
-- 2e. the execute privileges are exact.
select results_eq(
  $$ select has_function_privilege('anon', 'app.store_seed_categories()', 'execute') $$,
  array[false], 'privileges: anon cannot execute the lazy seed');
select results_eq(
  $$ select has_function_privilege('authenticated', 'app.store_seed_categories()', 'execute') $$,
  array[true], 'privileges: authenticated can execute the lazy seed (the only function a tenant lane may call)');
select results_eq(
  $$ select has_function_privilege('authenticated', 'app.store_seed_categories_for(uuid)', 'execute') $$,
  array[false], 'privileges: authenticated cannot execute the seam');
select results_eq(
  $$ select has_function_privilege('service_role', 'app.store_seed_categories_for(uuid)', 'execute') $$,
  array[false], 'privileges: service_role cannot execute the seam');
select results_eq(
  $$ select has_function_privilege('anon', 'app.store_seed_categories_for(uuid)', 'execute') $$,
  array[false], 'privileges: anon cannot execute the seam');
select results_eq(
  $$ select has_function_privilege('authenticated', 'app.store_categories_initial_load()', 'execute') $$,
  array[false], 'privileges: authenticated cannot execute the initial load');
select results_eq(
  $$ select has_function_privilege('service_role', 'app.store_categories_initial_load()', 'execute') $$,
  array[false], 'privileges: service_role cannot execute the initial load');
select results_eq(
  $$ select has_function_privilege('anon', 'app.store_categories_initial_load()', 'execute') $$,
  array[false], 'privileges: anon cannot execute the initial load');
select tests.as_tenant('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-020000000001', 'admin_tenant');
select throws_ok(
  $$ select app.store_seed_categories_for('28000000-0000-4000-8000-010000000002') $$,
  '42501', null, 'privileges: an admin lane that calls the seam directly for another tenant is refused outright');
select throws_ok(
  $$ select app.store_categories_initial_load() $$,
  '42501', null, 'privileges: an admin lane that calls the initial load directly is refused outright');
reset role;

-- ── (3) THE POLICIES (T-12.3-02, T-12.3-03, T-12.3-07) ─────────────────────────────────────────
-- A and B each hold eight categories and a front row (from the lazy seed above); A has product 04..01, B has 04..02.
select results_eq(
  $$ select (tablename::text || '=' || count(*)::text) collate "default" from pg_policies
      where schemaname = 'public' and tablename in ('store_categories', 'store_front') group by tablename order by 1 $$,
  $$ values ('store_categories=4'), ('store_front=4') $$,
  'policies: each new table carries exactly its four policies (select, insert, update, delete)');
select results_eq(
  $$ select (relname::text || '=' || relrowsecurity::text) collate "default" from pg_class
      where relnamespace = 'public'::regnamespace and relname in ('store_categories', 'store_front') order by 1 $$,
  $$ values ('store_categories=true'), ('store_front=true') $$,
  'policies: row-level security is on for both tables');
select results_eq(
  $$ select has_table_privilege('authenticated', 'public.store_categories', 'TRUNCATE') $$,
  array[false], 'T-12.3-07: TRUNCATE is revoked from authenticated on store_categories (truncate skips RLS)');
select results_eq(
  $$ select has_table_privilege('authenticated', 'public.store_front', 'TRUNCATE') $$,
  array[false], 'T-12.3-07: TRUNCATE is revoked from authenticated on store_front (truncate skips RLS)');

-- 3a. THE POSITIVE CONTROL: the admin of A reads, inserts, renames and deletes A's own category rows.
select tests.as_tenant('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-020000000001', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.store_categories $$,
  array[8], 'positive control: the admin of A reads A''s eight categories and no other (adjacency: B holds eight with the same slugs)');
select results_eq(
  $$ select count(*)::int from public.store_categories where slug = 'cursos' $$,
  array[1], 'adjacency: both tenants hold a category slugged cursos, the lane returns exactly one');
select results_eq(
  $$ select tenant_id::text from public.store_categories where slug = 'cursos' $$,
  array['28000000-0000-4000-8000-010000000001'], 'adjacency: and the cursos row it returns belongs to A');
select results_eq(
  $$ with i as (insert into public.store_categories (tenant_id, slug, name, icon, position)
                values ('28000000-0000-4000-8000-010000000001', 'extra', 'Extra', 'star', 9) returning 1) select count(*)::int from i $$,
  array[1], 'positive control: the admin of A inserts a category into A');
select results_eq(
  $$ with u as (update public.store_categories set name = 'Extra 2' where tenant_id = '28000000-0000-4000-8000-010000000001' and slug = 'extra' returning 1) select count(*)::int from u $$,
  array[1], 'positive control: the admin of A renames A''s category');
select results_eq(
  $$ with d as (delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000001' and slug = 'extra' returning 1) select count(*)::int from d $$,
  array[1], 'positive control: the admin of A deletes A''s category');
select results_eq(
  $$ with u as (update public.store_front set promo_product_id = '28000000-0000-4000-8000-040000000001' where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[1], 'positive control: the admin of A sets the promo product on A''s front row');
reset role;

-- 3b. THE NEGATIVES beside it: a member of A.
select tests.as_tenant('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-020000000003', 'member');
select results_eq(
  $$ select count(*)::int from public.store_categories $$,
  array[8], 'a member of A reads A''s eight categories (reading is for every lane of the tenant)');
select results_eq(
  $$ select count(*)::int from public.store_front $$,
  array[1], 'a member of A reads A''s front row');
select throws_ok(
  $$ insert into public.store_categories (tenant_id, slug, name, icon, position)
     values ('28000000-0000-4000-8000-010000000001', 'm-extra', 'M extra', 'star', 9) $$,
  '42501', null, 'a member of A cannot insert a category into A');
select results_eq(
  $$ with u as (update public.store_categories set name = 'Hack' where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'a member of A updates zero of A''s categories');
select results_eq(
  $$ with d as (delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from d $$,
  array[0], 'a member of A deletes zero of A''s categories');
select throws_ok(
  $$ insert into public.store_front (tenant_id) values ('28000000-0000-4000-8000-010000000001') $$,
  '42501', null, 'a member of A cannot insert a front row for A');
select results_eq(
  $$ with u as (update public.store_front set promo_product_id = null where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'a member of A updates zero front rows (the promo product is not theirs to clear)');
select results_eq(
  $$ with d as (delete from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from d $$,
  array[0], 'a member of A deletes zero front rows');
reset role;

-- 3c. a SUPPORT member of A.
select tests.as_tenant('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-020000000002', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.store_categories $$,
  array[8], 'a support member of A reads A''s eight categories');
select throws_ok(
  $$ insert into public.store_categories (tenant_id, slug, name, icon, position)
     values ('28000000-0000-4000-8000-010000000001', 's-extra', 'S extra', 'star', 9) $$,
  '42501', null, 'a support member of A cannot insert a category into A');
select results_eq(
  $$ with u as (update public.store_categories set name = 'Hack' where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'a support member of A updates zero of A''s categories');
select results_eq(
  $$ with d as (delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from d $$,
  array[0], 'a support member of A deletes zero of A''s categories');
select results_eq(
  $$ with u as (update public.store_front set promo_product_id = null where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'a support member of A updates zero front rows');
select throws_ok(
  $$ insert into public.store_front (tenant_id) values ('28000000-0000-4000-8000-010000000001') $$,
  '42501', null, 'a support member of A cannot insert a front row for A');
reset role;

-- 3d. the ADMIN OF B, aimed at A (the cross-tenant negatives).
select tests.as_tenant('28000000-0000-4000-8000-010000000002', '28000000-0000-4000-8000-020000000004', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.store_categories $$,
  array[8], 'positive control: the admin of B reads B''s eight categories');
select is_empty(
  $$ select 1 from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000001' $$,
  'T-12.3-03: a tenant-B session reads none of tenant A''s categories, so a service lookup can never return a foreign id');
select is_empty(
  $$ select 1 from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000001' $$,
  'a tenant-B session reads none of tenant A''s front row');
select throws_ok(
  $$ insert into public.store_categories (tenant_id, slug, name, icon, position)
     values ('28000000-0000-4000-8000-010000000001', 'b-extra', 'B extra', 'star', 9) $$,
  '42501', null, 'T-12.3-02: the admin of B cannot insert a category stamped with A''s tenant_id');
select results_eq(
  $$ with u as (update public.store_categories set name = 'Hack' where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.3-02: the admin of B updates zero of A''s categories');
select results_eq(
  $$ with d as (delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from d $$,
  array[0], 'T-12.3-02: the admin of B deletes zero of A''s categories');
select results_eq(
  $$ with u as (update public.store_front set promo_product_id = null where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.3-02: the admin of B updates zero of A''s front rows');
select results_eq(
  $$ with d as (delete from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from d $$,
  array[0], 'T-12.3-02: the admin of B deletes zero of A''s front rows');
reset role;
-- and the admin of A aimed at B
select tests.as_tenant('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-020000000001', 'admin_tenant');
select throws_ok(
  $$ insert into public.store_front (tenant_id) values ('28000000-0000-4000-8000-010000000002') $$,
  '42501', null, 'T-12.3-02: the admin of A cannot insert a front row stamped with B''s tenant_id');
select results_eq(
  $$ with u as (update public.store_categories set name = 'Hack' where tenant_id = '28000000-0000-4000-8000-010000000002' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.3-02: the admin of A updates zero of B''s categories');
reset role;

-- 3e. A's rows are intact after every refused write above (read as the migration role).
select results_eq(
  $$ select (position::text || ':' || slug || ':' || name)::text collate "default" from public.store_categories
      where tenant_id = '28000000-0000-4000-8000-010000000001' order by position $$,
  $$ values ('1:cursos:Cursos'), ('2:livros:Livros'), ('3:materiais:Materiais'), ('4:roupas:Roupas'),
            ('5:perfumes:Perfumes'), ('6:equipamentos:Equipamentos'), ('7:servicos:Serviços'), ('8:outros:Outros') $$,
  'after every refused write A''s eight categories are exactly as seeded');
select results_eq(
  $$ select promo_product_id::text from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000001' $$,
  array['28000000-0000-4000-8000-040000000001'], 'after every refused write A''s promo product is the one the admin of A set');
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000002' and promo_product_id is null $$,
  array[1], 'after every refused write B''s front row is untouched (promo still null)');

select * from finish();
rollback;
