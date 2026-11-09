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
--  4. THE GUESS RULE `app.store_guess_category`: every row of the shared corpus (packages/modules/store/tests/guess-corpus.ts, quoted
--     into a temp table by a script), whole-word boundaries (led / ledger), empty names, accents and case, the priority order, and the
--     one KNOWN DIVERGENCE pinned on purpose (unaccent folds letters that NFD does not decompose; the pt-BR corpus never meets one).
--  5. THE INITIAL LOAD `app.store_categories_initial_load` on a fixture: each product lands in the category its name tells, no
--     `updated_at` moves, a seeded tenant is skipped, a category already set is kept, a store emptied by its admin is never
--     re-seeded, the order of storage does not matter, and a second run writes nothing.
--  6. CENTRAL RESIDUE (Pitfall 2, T-12.3-06): a `tenant_modules` row for a store whose products live in another project causes no
--     write (tenant LD), inside section 5.
--
-- WHAT THE DATABASE DOES NOT DO (T-12.3-03). `store_products.category_id` is a plain single-column foreign key to
-- `store_categories(id)`, so the DATABASE itself would accept a product that points at ANOTHER tenant's category id. The guard is
-- the service (plan 12.3-11), which resolves the category by its slug UNDER ROW-LEVEL SECURITY. What this file asserts is the half
-- that makes that guard sound: a tenant-A session cannot read tenant B's category rows (section 3), so a service lookup can never
-- return a foreign id. This file does NOT claim that the database refuses a foreign category id.
--
-- Fixture ids use the `28000000-0000-4000-8000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK and leaves
-- nothing behind. Tenants: A (policies; admin, support, member), B (the other tenant; admin), K and K2 (CHECK boundaries and the
-- twin rows), S, T, U (the seed), plus a product in A and in B for the front row's promo column; LA, LB, LC, LD, O1 and O2 for the
-- load (section 5). The load and the seam run as the migration role (they are owner-only); the lazy seed runs as a tenant session.
select plan(165);

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

-- ── (4) THE GUESS RULE: parity with the shared corpus (D-692, NOVF-08) ──────────────────────────
-- The corpus below is the QUOTED content of packages/modules/store/tests/guess-corpus.ts (GUESS_CORPUS), generated from that file by a
-- script (never retyped): ordinal, name, the category the web's `guessStoreCategory` returned when the corpus was produced. Rule: a new
-- corpus row adds a line in that file AND here, in the same change. The table is a temp table, read only by the migration role.
create temp table sc_corpus (n int, name text, expected text) on commit drop;
insert into sc_corpus (n, name, expected) values
    (1, 'Formação Marketing para Clínicas', 'cursos'),
    (2, 'Masterclass Lábios Naturais', 'cursos'),
    (3, 'E-book: Primeira Consulta', 'livros'),
    (4, 'Livro: Harmonização Facial na Prática', 'livros'),
    (5, 'Guia de Precificação para Clínicas', 'livros'),
    (6, 'Kit de Protocolos de Bioestimuladores', 'materiais'),
    (7, 'Jaleco Premium Bordado', 'roupas'),
    (8, 'Camiseta Oversized Rede Demo', 'roupas'),
    (9, 'Boné Aba Curva Rede Demo', 'roupas'),
    (10, 'Perfume Signature 100 ml', 'perfumes'),
    (11, 'Body Splash Pele de Seda 200 ml', 'perfumes'),
    (12, 'Dermapen Pro Sem Fio', 'equipamentos'),
    (13, 'Luminária LED de Bancada', 'equipamentos'),
    (14, 'Ring Light Profissional 18 polegadas', 'equipamentos'),
    (15, 'Mentoria Individual: Agenda Cheia', 'servicos'),
    (16, 'Pacote Skinbooster: 3 Sessões', 'servicos'),
    (17, 'Kit Ring Light para Atendimento', 'equipamentos'),
    (18, 'Curso de Atendimento ao Paciente', 'cursos'),
    (19, 'FRAGRÂNCIA AMADEIRADA', 'perfumes'),
    (20, 'ebook de receitas', 'livros'),
    (21, 'Ledger de vendas', 'outros'),
    (22, 'Cursinho', 'outros'),
    (23, 'Vale-presente', 'outros'),
    (24, '', 'outros'),
    (25, 'JALECO BRANCO', 'roupas'),
    (26, 'Fragrância Cítrica', 'perfumes'),
    (27, 'Eau de Parfum Noir', 'perfumes'),
    (28, 'Body Splash Vanilla', 'perfumes'),
    (29, 'Kit LED', 'equipamentos'),
    (30, 'Ring Light', 'equipamentos'),
    (31, 'Planilha de Custos', 'materiais'),
    (32, 'Workshop de Peeling', 'cursos'),
    (33, 'Aula Avulsa de Drenagem', 'cursos'),
    (34, 'Consultoria Financeira', 'servicos'),
    (35, 'Apostila de Anatomia', 'livros'),
    (36, 'Manual do Aluno', 'livros'),
    (37, 'Touca Descartável', 'roupas'),
    (38, 'Calça Scrub Azul', 'roupas'),
    (39, 'Máquina de Microagulhamento', 'equipamentos'),
    (40, 'Maca Dobrável', 'equipamentos'),
    (41, 'Laser Diodo 808', 'equipamentos'),
    (42, 'Ponteiras para Dermapen', 'equipamentos'),
    (43, 'Tripé de Mesa', 'equipamentos'),
    (44, 'Essência Floral', 'perfumes'),
    (45, 'Colônia Infantil', 'perfumes'),
    (46, 'Sessão de Detox', 'servicos'),
    (47, 'Pacote de Imersão', 'cursos'),
    (48, 'Imersão Master', 'cursos'),
    (49, 'Treinamento em Vendas', 'cursos'),
    (50, 'Roteiro de Atendimento', 'materiais'),
    (51, 'Checklist Pré-Consulta', 'materiais'),
    (52, 'Template de Contrato', 'materiais'),
    (53, 'Camisa Polo', 'roupas'),
    (54, 'Blusa Manga Longa', 'roupas'),
    (55, 'Avental Impermeável', 'roupas'),
    (56, 'Kit Perfumes e Livros', 'livros'),
    (57, 'Livro de Perfumes', 'livros'),
    (58, 'Curso Online de Laser', 'equipamentos'),
    (59, 'Mentoria em Vendas e Livro', 'livros'),
    (60, '  Perfume  ', 'perfumes'),
    (61, 'Planilha e Curso', 'materiais'),
    (62, 'Equipamento Ultrassom', 'equipamentos'),
    (63, 'led', 'equipamentos'),
    (64, 'ledger', 'outros'),
    (65, 'e-book', 'livros'),
    (66, 'body splash', 'perfumes'),
    (67, 'eau de parfum', 'perfumes'),
    (68, 'ring light', 'equipamentos');
select results_eq(
  $$ select count(*)::int from sc_corpus $$,
  array[68], 'parity: the quoted corpus holds the 68 rows of GUESS_CORPUS (the SUMMARY records this count)');
select is_empty(
  $$ select c.n, c.name, c.expected, app.store_guess_category(c.name) as got
       from sc_corpus c where app.store_guess_category(c.name) is distinct from c.expected $$,
  'parity: app.store_guess_category agrees with the web rule on EVERY corpus row (a row listed here is a disagreement)');
select results_eq(
  $$ select n, app.store_guess_category(name)::text from sc_corpus order by n $$,
  $$ select n, expected::text from sc_corpus order by n $$,
  'parity: the SQL answers, in corpus order, are exactly the expected categories');
select results_eq(
  $$ select app.store_guess_category(name)::text from sc_corpus where name = 'led' $$,
  array['equipamentos'], 'parity: the corpus row led is equipamentos');
select results_eq(
  $$ select app.store_guess_category(name)::text from sc_corpus where name = 'ledger' $$,
  array['outros'], 'parity: the corpus row ledger is outros (the word led glued to letters is not a match)');

-- 4a. NOVF-08 adjacency: whole-word boundaries. Hyphen, space, dot and parenthesis are boundaries; a letter or a digit is not.
select is_empty(
  $$ select v.name, v.expected, app.store_guess_category(v.name) as got
       from (values
         ('led', 'equipamentos'), ('LED', 'equipamentos'), ('ledger', 'outros'), ('lede', 'outros'),
         ('led2', 'outros'), ('2led', 'outros'), ('xled', 'outros'), ('ledx', 'outros'),
         ('led.', 'equipamentos'), ('(led)', 'equipamentos'), ('kit-led', 'equipamentos'), ('led-x', 'equipamentos'),
         ('e-book', 'livros'), ('E-Book', 'livros'), ('ebook', 'livros'), ('e book', 'outros'),
         ('body splash', 'perfumes'), ('bodysplash', 'outros'), ('eau de parfum', 'perfumes'), ('eaudeparfum', 'outros'),
         ('ring light', 'equipamentos'), ('ringlight', 'outros'), ('ring-light', 'outros'),
         ('curso-livre', 'cursos'), ('pre-curso', 'cursos'), ('cursinho', 'outros'), ('curso2', 'outros'),
         ('masterclass', 'cursos'), ('mastercl', 'outros')
       ) as v (name, expected)
      where app.store_guess_category(v.name) is distinct from v.expected $$,
  'adjacency: whole words only (led matches and ledger does not; e-book, body splash, eau de parfum and ring light match as written; a letter or a digit glued to a word does not match)');

-- 4b. NOVF-08 empty: an empty name and a name matching nothing go to outros.
select results_eq($$ select app.store_guess_category('') $$, array['outros'], 'empty: an empty name goes to outros');
select results_eq($$ select app.store_guess_category('   ') $$, array['outros'], 'empty: a blank name goes to outros');
select results_eq($$ select app.store_guess_category(null) $$, array['outros'], 'empty: a null name reads as empty and goes to outros');
select results_eq($$ select app.store_guess_category('Zzz Qwerty 123') $$, array['outros'], 'empty: a name matching nothing goes to outros');

-- 4c. NOVF-08 encoding: accents and case do not count, and SQL agrees with the TypeScript rule on the corpus.
select is_empty(
  $$ select v.name, v.expected, app.store_guess_category(v.name) as got
       from (values
         ('Fragrância', 'perfumes'), ('FRAGRANCIA', 'perfumes'), ('fragrancia', 'perfumes'), ('FRAGRÂNCIA', 'perfumes'),
         ('JALECO', 'roupas'), ('Jaleco', 'roupas'), ('jAlEcO', 'roupas'), ('Jaleço', 'roupas'),
         ('Formação', 'cursos'), ('FORMAÇÃO', 'cursos'), ('Sessão', 'servicos'), ('SESSÕES', 'servicos'),
         ('Máquina', 'equipamentos'), ('Tripé', 'equipamentos'), ('Boné', 'roupas'), ('Calça', 'roupas'), ('Colônia', 'perfumes')
       ) as v (name, expected)
      where app.store_guess_category(v.name) is distinct from v.expected $$,
  'encoding: accents and case do not count (Fragrância, FRAGRANCIA, JALECO, mixed case, cedilla, tilde, circumflex)');
-- KNOWN DIVERGENCE, pinned and not hidden. The SQL side folds case after `unaccent`, which also maps letters that do NOT decompose
-- under Unicode NFD (for example the Polish l with stroke: 'Łed' becomes 'led'); the web's `plainText` strips only the combining marks
-- of NFD, so 'Łed' stays 'łed' there and the web answers 'outros'. The pt-BR corpus has no such letter, so the two rules agree on
-- every name a Brazilian store holds. The assertions below pin the divergence and prove the corpus does not exercise it.
select results_eq(
  $$ select app.store_guess_category('Łed') $$,
  array['equipamentos'], 'KNOWN DIVERGENCE (pinned): unaccent folds a non-decomposable letter, so SQL reads Łed as led (equipamentos); the web rule answers outros');
select is_empty(
  $$ select c.n, c.name from sc_corpus c
      where lower(app.imm_unaccent(c.name))
            is distinct from regexp_replace(lower(normalize(c.name, nfd)), '[̀-ͯ]', '', 'g') $$,
  'encoding: on every corpus row unaccent and NFD stripping produce the same text, so the corpus does not exercise the divergence');

-- 4d. NOVF-08 ordering: a name holding words of two categories goes to the first category in the rule's priority order
-- (livros, materiais, roupas, perfumes, equipamentos, cursos, servicos), wherever the words sit in the name.
select is_empty(
  $$ select v.name, v.expected, app.store_guess_category(v.name) as got
       from (values
         ('livro e planilha', 'livros'), ('planilha e jaleco', 'materiais'), ('jaleco e perfume', 'roupas'),
         ('perfume e laser', 'perfumes'), ('laser e curso', 'equipamentos'), ('curso e mentoria', 'cursos'),
         ('planilha e livro', 'livros'), ('jaleco e planilha', 'materiais'), ('perfume e jaleco', 'roupas'),
         ('laser e perfume', 'perfumes'), ('curso e laser', 'equipamentos'), ('mentoria e curso', 'cursos'),
         ('mentoria curso laser perfume jaleco planilha livro', 'livros'),
         ('mentoria curso laser perfume jaleco planilha', 'materiais'),
         ('mentoria curso laser perfume jaleco', 'roupas'),
         ('mentoria curso laser perfume', 'perfumes'),
         ('mentoria curso laser', 'equipamentos'),
         ('mentoria curso', 'cursos'),
         ('mentoria', 'servicos')
       ) as v (name, expected)
      where app.store_guess_category(v.name) is distinct from v.expected $$,
  'ordering: with words of two categories the first in the priority order wins, whichever comes first in the name');

-- ── (5) THE INITIAL LOAD (D-692, T-12.3-06) ───────────────────────────────────────────────────
-- Tenants: LA the load tenant (an admin-made category and a pre-categorized product), LB already seeded, LC seeded and then emptied
-- by its admin, LD a store with the module on and NO product here (a mirror-like row), O1 and O2 the same products in opposite orders.
select tests.tenant('pgtap-sc2-la', 'Sc2 LA', '28000000-0000-4000-8000-010000000008');
select tests.tenant('pgtap-sc2-lb', 'Sc2 LB', '28000000-0000-4000-8000-010000000009');
select tests.tenant('pgtap-sc2-lc', 'Sc2 LC', '28000000-0000-4000-8000-01000000000a');
select tests.tenant('pgtap-sc2-ld', 'Sc2 LD', '28000000-0000-4000-8000-01000000000b');
select tests.tenant('pgtap-sc2-o1', 'Sc2 O1', '28000000-0000-4000-8000-01000000000c');
select tests.tenant('pgtap-sc2-o2', 'Sc2 O2', '28000000-0000-4000-8000-01000000000d');
-- LA: an admin-made category BEFORE any seed (no marker), then eight products, one of them already in it.
select tests.sc_cat('28000000-0000-4000-8000-010000000008', 'especiais', 'Especiais', 'star', 1);
select tests.sc_prod('28000000-0000-4000-8000-0400000000a1', '28000000-0000-4000-8000-010000000008', 'Curso de Atendimento ao Paciente');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a2', '28000000-0000-4000-8000-010000000008', 'Livro: Harmonização Facial na Prática');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a3', '28000000-0000-4000-8000-010000000008', 'Jaleco Premium Bordado');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a4', '28000000-0000-4000-8000-010000000008', 'Ledger de vendas');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a5', '28000000-0000-4000-8000-010000000008', '');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a6', '28000000-0000-4000-8000-010000000008', 'Kit LED');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a7', '28000000-0000-4000-8000-010000000008', 'Perfume Signature 100 ml', null, 'archived');
select tests.sc_prod('28000000-0000-4000-8000-0400000000a8', '28000000-0000-4000-8000-010000000008', 'Curso Premium',
  (select id from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000008' and slug = 'especiais'));
-- LB: seeded (the seam), two products with no category. LC: seeded, then every category deleted, one product with no category.
select app.store_seed_categories_for('28000000-0000-4000-8000-010000000009');
select tests.sc_prod('28000000-0000-4000-8000-0400000000b1', '28000000-0000-4000-8000-010000000009', 'Curso X');
select tests.sc_prod('28000000-0000-4000-8000-0400000000b2', '28000000-0000-4000-8000-010000000009', 'Livro Y');
select app.store_seed_categories_for('28000000-0000-4000-8000-01000000000a');
delete from public.store_categories where tenant_id = '28000000-0000-4000-8000-01000000000a';
select tests.sc_prod('28000000-0000-4000-8000-0400000000c1', '28000000-0000-4000-8000-01000000000a', 'Curso Z');
-- LD: the store module is ON for it and it owns NO product in this project (the central project holds such mirror rows).
insert into public.tenant_modules (tenant_id, module_key, enabled) values ('28000000-0000-4000-8000-01000000000b', 'store', true);
-- O1 and O2: the same five products in opposite storage orders.
select tests.sc_prod('28000000-0000-4000-8000-0400000000d1', '28000000-0000-4000-8000-01000000000c', 'Livro Alfa');
select tests.sc_prod('28000000-0000-4000-8000-0400000000d2', '28000000-0000-4000-8000-01000000000c', 'Jaleco Beta');
select tests.sc_prod('28000000-0000-4000-8000-0400000000d3', '28000000-0000-4000-8000-01000000000c', 'Laser Gama');
select tests.sc_prod('28000000-0000-4000-8000-0400000000d4', '28000000-0000-4000-8000-01000000000c', 'Mentoria Delta');
select tests.sc_prod('28000000-0000-4000-8000-0400000000d5', '28000000-0000-4000-8000-01000000000c', 'Epsilon sem palavra');
select tests.sc_prod('28000000-0000-4000-8000-0400000000e5', '28000000-0000-4000-8000-01000000000d', 'Epsilon sem palavra');
select tests.sc_prod('28000000-0000-4000-8000-0400000000e4', '28000000-0000-4000-8000-01000000000d', 'Mentoria Delta');
select tests.sc_prod('28000000-0000-4000-8000-0400000000e3', '28000000-0000-4000-8000-01000000000d', 'Laser Gama');
select tests.sc_prod('28000000-0000-4000-8000-0400000000e2', '28000000-0000-4000-8000-01000000000d', 'Jaleco Beta');
select tests.sc_prod('28000000-0000-4000-8000-0400000000e1', '28000000-0000-4000-8000-01000000000d', 'Livro Alfa');
-- A distinct, explicit `updated_at` on every fixture product, so "the load never writes it" is an equality and not a coincidence.
with n as (select id, row_number() over (order by id) as rn from public.store_products where id::text like '28000000-%')
update public.store_products p set updated_at = timestamptz '2026-02-01 10:00:00+00' + (n.rn::text || ' minutes')::interval
  from n where p.id = n.id;

-- The state the load starts from. `sc_base` is what any NON-fixture row of the local database would add to the load's counters
-- (the seed holds none, so both are normally 0); `sc_pre` is every fixture product as it is before the load.
create temp table sc_base on commit drop as
  select (select count(distinct p.tenant_id) from public.store_products p
           where p.tenant_id::text not like '28000000-%'
             and not exists (select 1 from public.store_front f where f.tenant_id = p.tenant_id and f.categories_seeded_at is not null))::int as t,
         (select count(*) from public.store_products p
           where p.tenant_id::text not like '28000000-%' and p.category_id is null
             and not exists (select 1 from public.store_front f where f.tenant_id = p.tenant_id and f.categories_seeded_at is not null))::int as p;
create temp table sc_pre on commit drop as
  select id, tenant_id, category_id, updated_at from public.store_products where id::text like '28000000-%';
select results_eq(
  $$ select count(*)::int from sc_pre $$,
  array[23], 'load fixture: 23 fixture products exist before the load (A, B, LA 8, LB 2, LC 1, O1 5, O2 5)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id in ('28000000-0000-4000-8000-010000000008') $$,
  array[1], 'load fixture: LA starts with only its admin-made category (no marker, not seeded)');

-- THE FIRST RUN, as the migration role.
create temp table sc_run1 on commit drop as select * from app.store_categories_initial_load();
select results_eq(
  $$ select (r.tenants_seeded - b.t)::int from sc_run1 r, sc_base b $$,
  array[3], 'load: it seeded exactly the three fixture tenants that owned products and carried no marker (LA, O1, O2)');
select results_eq(
  $$ select (r.products_categorized - b.p)::int from sc_run1 r, sc_base b $$,
  array[17], 'load: it categorized exactly the 17 uncategorized products of those tenants (LA 7, O1 5, O2 5)');
select results_eq(
  $$ select (p.name || ' => ' || c.slug)::text collate "default"
       from public.store_products p join public.store_categories c on c.id = p.category_id
      where p.tenant_id = '28000000-0000-4000-8000-010000000008' order by 1 $$,
  $$ values ('Curso de Atendimento ao Paciente => cursos'), ('Curso Premium => especiais'), ('Jaleco Premium Bordado => roupas'),
            ('Kit LED => equipamentos'), ('Ledger de vendas => outros'), ('Livro: Harmonização Facial na Prática => livros'),
            ('Perfume Signature 100 ml => perfumes'), (' => outros') order by 1 $$,
  'load: each product of LA is in the category app.store_guess_category names for its name (an empty name and ledger in outros, an ARCHIVED product too)');
select results_eq(
  $$ select c.slug::text from public.store_products p join public.store_categories c on c.id = p.category_id where p.id = '28000000-0000-4000-8000-0400000000a8' $$,
  array['especiais'], 'load: a product that already had a category keeps it (Curso Premium stays in especiais, never overwritten by its name)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000008' $$,
  array[9], 'load: LA holds its own especiais plus the eight built-in categories');
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-010000000008' and categories_seeded_at is not null $$,
  array[1], 'load: LA now carries the seed marker');
select is_empty(
  $$ select s.id from sc_pre s join public.store_products p on p.id = s.id where p.updated_at is distinct from s.updated_at $$,
  'no touch (D-692): not one fixture product changed its updated_at (every one of the 23 is compared, not a sample)');
select results_eq(
  $$ select count(*)::int from sc_pre s join public.store_products p on p.id = s.id $$,
  array[23], 'no touch: the comparison above covered all 23 fixture products');
select results_eq(
  $$ select count(*)::int from public.store_products where id::text like '28000000-%' and category_id is distinct from
       (select s.category_id from sc_pre s where s.id = store_products.id) $$,
  array[17], 'the load changed the category of exactly 17 fixture products and no other column is claimed here');

-- an already-seeded tenant is skipped: its products with no category STAY without one.
select results_eq(
  $$ select count(*)::int from public.store_products where tenant_id = '28000000-0000-4000-8000-010000000009' and category_id is not null $$,
  array[0], 'skip: LB was already seeded, so its two uncategorized products stay uncategorized');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-010000000009' $$,
  array[8], 'skip: LB still holds exactly its eight categories');
select results_eq(
  $$ select count(*)::int from public.store_products where tenant_id in ('28000000-0000-4000-8000-010000000001', '28000000-0000-4000-8000-010000000002') and category_id is not null $$,
  array[0], 'skip: A and B were seeded by the lazy seed, so their products stay uncategorized');
-- a store whose admin deleted every category is never re-seeded, and its product is not categorized.
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-01000000000a' $$,
  array[0], 'never again: LC (every category deleted) is not re-seeded by the load');
select results_eq(
  $$ select count(*)::int from public.store_products where tenant_id = '28000000-0000-4000-8000-01000000000a' and category_id is not null $$,
  array[0], 'never again: LC''s product stays uncategorized');
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-01000000000a' and categories_seeded_at is not null $$,
  array[1], 'never again: the marker row of LC stays');

-- Pitfall 2 / T-12.3-06: the module row alone causes no write. LD has `tenant_modules.store = true` and no product here.
select results_eq(
  $$ select count(*)::int from public.tenant_modules where tenant_id = '28000000-0000-4000-8000-01000000000b' and module_key = 'store' and enabled $$,
  array[1], 'central residue: the module row of LD exists and says the store is on (the precondition of the case)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-01000000000b' $$,
  array[0], 'central residue: the load wrote no category for a tenant that owns no product here');
select results_eq(
  $$ select count(*)::int from public.store_front where tenant_id = '28000000-0000-4000-8000-01000000000b' $$,
  array[0], 'central residue: the load wrote no store_front row for a tenant that owns no product here');

-- NOVF-08 ordering: the result does not depend on the order the products are stored (O1 forward, O2 reversed).
select results_eq(
  $$ select (p.name || ' => ' || c.slug)::text collate "default" from public.store_products p
       join public.store_categories c on c.id = p.category_id where p.tenant_id = '28000000-0000-4000-8000-01000000000c' order by 1 $$,
  $$ select (p.name || ' => ' || c.slug)::text collate "default" from public.store_products p
       join public.store_categories c on c.id = p.category_id where p.tenant_id = '28000000-0000-4000-8000-01000000000d' order by 1 $$,
  'ordering: the same products stored in opposite orders land in the same categories');
select results_eq(
  $$ select (p.name || ' => ' || c.slug)::text collate "default" from public.store_products p
       join public.store_categories c on c.id = p.category_id where p.tenant_id = '28000000-0000-4000-8000-01000000000c' order by 1 $$,
  $$ values ('Epsilon sem palavra => outros'), ('Jaleco Beta => roupas'), ('Laser Gama => equipamentos'),
            ('Livro Alfa => livros'), ('Mentoria Delta => servicos') order by 1 $$,
  'ordering: and those categories are the ones the names tell (O1 spelled out)');

-- THE SECOND RUN writes nothing (the backfill applied again is a no-op).
create temp table sc_post_p on commit drop as
  select id, category_id, updated_at from public.store_products where id::text like '28000000-%';
create temp table sc_post_c on commit drop as
  select id, tenant_id, slug, name, icon, position, created_at, updated_at from public.store_categories where tenant_id::text like '28000000-%';
create temp table sc_post_f on commit drop as
  select tenant_id, promo_product_id, featured_product_ids, categories_seeded_at, updated_at from public.store_front where tenant_id::text like '28000000-%';
create temp table sc_run2 on commit drop as select * from app.store_categories_initial_load();
select results_eq(
  $$ select tenants_seeded::int, products_categorized::int from sc_run2 $$,
  $$ values (0, 0) $$, 'idempotency: a second run of the load reports zero tenants seeded and zero products categorized');
select is_empty(
  $$ (select * from sc_post_p except select id, category_id, updated_at from public.store_products where id::text like '28000000-%')
     union all
     (select id, category_id, updated_at from public.store_products where id::text like '28000000-%' except select * from sc_post_p) $$,
  'idempotency: the second run left every fixture product exactly as the first run left it (category and updated_at)');
select is_empty(
  $$ (select * from sc_post_c except select id, tenant_id, slug, name, icon, position, created_at, updated_at from public.store_categories where tenant_id::text like '28000000-%')
     union all
     (select id, tenant_id, slug, name, icon, position, created_at, updated_at from public.store_categories where tenant_id::text like '28000000-%' except select * from sc_post_c) $$,
  'idempotency: the second run wrote no category row, changed none and removed none');
select is_empty(
  $$ (select * from sc_post_f except select tenant_id, promo_product_id, featured_product_ids, categories_seeded_at, updated_at from public.store_front where tenant_id::text like '28000000-%')
     union all
     (select tenant_id, promo_product_id, featured_product_ids, categories_seeded_at, updated_at from public.store_front where tenant_id::text like '28000000-%' except select * from sc_post_f) $$,
  'idempotency: the second run left every marker row as it was (the marker claim is a no-op once set)');
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-01000000000a' $$,
  array[0], 'never again: LC is still empty after the second run (a deleted-all store is not re-seeded by a later load)');

-- NOVF-07 edge empty: a store with no category answers an empty list, never an error, and the lazy seed does not refill it.
select tests.as_tenant('28000000-0000-4000-8000-01000000000a', '28000000-0000-4000-8000-020000000005', 'admin_tenant');
select is_empty(
  $$ select 1 from public.store_categories $$,
  'empty store: an admin session of LC (no category left) reads an empty list, not an error');
select results_eq($$ select count(*)::int from public.store_front $$, array[1], 'empty store: its front row (the marker) is still there to read');
select results_eq($$ select app.store_seed_categories() $$, array[false], 'empty store: the lazy seed does not refill a store the admin emptied');
reset role;
select results_eq(
  $$ select count(*)::int from public.store_categories where tenant_id = '28000000-0000-4000-8000-01000000000a' $$,
  array[0], 'empty store: and it is still empty after the lazy seed call');

select * from finish();
rollback;
