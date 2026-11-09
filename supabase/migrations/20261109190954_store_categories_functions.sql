-- store_categories_functions (Phase 12.3-09, NOVF-05..09; D-690, D-691, D-692, D-696; T-12.3-06, T-12.3-07) —
-- hand-written (`--custom`), applied right after its generated companion `*_store_categories.sql`, which created
-- `store_categories`, `store_front` and the optional `store_products.category_id`. The call that loads the data is the
-- next file, `*_store_categories_backfill.sql`.
--
-- ── WHAT THIS FILE INSTALLS, IN ORDER ───────────────────────────────────────────────────────────────
--   1. `revoke truncate` on the two new tables: TRUNCATE is not subject to row-level security and Supabase's default
--      privileges hand it to `authenticated` on every public table (the 08.2 precedent, `*_store_admin_write_truncate`).
--   2. `app.store_guess_category(text)`: IMMUTABLE. The web's rule (`guessStoreCategory`, `apps/web/lib/store-categories.ts`)
--      ported to SQL: the first category in PRIORITY ORDER (livros, materiais, roupas, perfumes, equipamentos, cursos,
--      servicos) whose words appear in the name as WHOLE WORDS, accents and case ignored (`app.imm_unaccent`), else
--      'outros'. `packages/modules/store/tests/guess-corpus.ts` is the shared proof that both rules answer the same.
--   3. `app.store_seed_categories_for(uuid)`: the owner-only SEAM. It CLAIMS the once-only seed through the marker row
--      `store_front.categories_seeded_at` and, only when it won the claim, writes the eight built-in categories. A store
--      whose admin deleted some or every category is never seeded again: the marker stays set.
--   4. `app.store_seed_categories()`: the tenant-pinned LAZY seed for a store enabled later. SECURITY DEFINER, no
--      argument, the tenant is the caller's own claim (`app.tenant_id()`), granted to `authenticated`.
--   5. `app.store_categories_initial_load()`: the ONE-TIME initial load (D-692). For every tenant that has at least one
--      product in THIS project and no seeded marker it calls the seam and, only when it seeded, gives the tenant's
--      UNCATEGORIZED products the category their name tells. It never writes `updated_at`.
--
-- ── WHY THE LOAD AND THE LAZY SEED ARE DRIVEN BY DATA THAT PHYSICALLY EXISTS HERE ────────────────────
-- Pitfall 2 / T-12.3-06: the central project holds mirror rows for tenants whose real project is another one, and the
-- central-clean report requires that no tenant row lives there. So neither function reads the module toggles of a
-- tenant and none of them is a trigger: the load walks the products that exist in this project, and the lazy seed walks
-- the caller's own session. A tenant with no product here is never touched by the load.
--
-- ── THE UNDO HANDLE OF THE LOAD (D-692, costly; recorded for the release notes of plan 17) ────────────
-- A product the load categorized and nobody edited since has a non-null `category_id` and an `updated_at` NOT AFTER
-- `store_front.categories_seeded_at` of its tenant (the load never touches `updated_at`). Those rows, and only those,
-- can be set back to NULL without erasing a category an admin chose afterwards.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- EXPAND-ONLY and fan-out safe (D-696): rows are added to new tables, a nullable column is filled where it is empty;
-- nothing is dropped, nothing is made required, and the API revision serving during the fan-out never selects the new
-- column or tables. No begin, commit or concurrent index build and no reference to the central schema (the tenant-set
-- guard test scans this file).

revoke truncate on public.store_categories, public.store_front from authenticated;
--> statement-breakpoint

-- 2. The guess. A case over the lower-cased, accent-folded name: one whole-word pattern per category, tried in the web's
-- priority order (a book before a consultation, an equipment or a course before a service). The words are plain letters,
-- spaces and hyphens, copied from the web's lists. A null name reads as empty.
create or replace function app.store_guess_category(p_name text)
returns text
language sql immutable set search_path = '' as $$
  select case
    when x.t ~ '(^|[^a-z0-9])(livro|livros|e-book|ebook|e-books|apostila|guia|manual)($|[^a-z0-9])'
      then 'livros'
    when x.t ~ '(^|[^a-z0-9])(protocolo|protocolos|planilha|planilhas|template|templates|checklist|material|materiais|roteiro|roteiros)($|[^a-z0-9])'
      then 'materiais'
    when x.t ~ '(^|[^a-z0-9])(camiseta|camisetas|camisa|moletom|jaqueta|jaleco|bone|calca|vestido|blusa|uniforme|avental|regata|roupa|roupas|touca|scrub|casaco)($|[^a-z0-9])'
      then 'roupas'
    when x.t ~ '(^|[^a-z0-9])(perfume|perfumes|fragrancia|colonia|body splash|eau de parfum|essencia)($|[^a-z0-9])'
      then 'perfumes'
    when x.t ~ '(^|[^a-z0-9])(equipamento|equipamentos|aparelho|dermapen|caneta|maquina|maca|led|laser|ultrassom|ring light|luminaria|tripe|ponteira|ponteiras)($|[^a-z0-9])'
      then 'equipamentos'
    when x.t ~ '(^|[^a-z0-9])(curso|cursos|formacao|masterclass|aula|aulas|treinamento|workshop|imersao|webinar)($|[^a-z0-9])'
      then 'cursos'
    when x.t ~ '(^|[^a-z0-9])(mentoria|consultoria|sessao|sessoes|consulta|atendimento|pacote)($|[^a-z0-9])'
      then 'servicos'
    else 'outros'
  end
  from (select lower(app.imm_unaccent(coalesce(p_name, ''))) as t) x
$$;
--> statement-breakpoint

-- 3. The seam. SECURITY INVOKER and owner-only (nothing in a tenant lane calls it directly): the claim is the single
-- statement `insert ... on conflict (tenant_id) do update ... where categories_seeded_at is null returning`, so two
-- concurrent callers cannot both win it, and a store whose marker is already set returns no row and seeds nothing.
-- The eight rows are the built-in categories the storefront had before it became editable; `on conflict do nothing`
-- keeps a row an admin already created with the same slug or name.
create or replace function app.store_seed_categories_for(p_tenant_id uuid)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_claimed uuid;
begin
  if p_tenant_id is null then
    return false;
  end if;

  insert into public.store_front as f (tenant_id, categories_seeded_at)
  values (p_tenant_id, now())
  on conflict (tenant_id) do update
    set categories_seeded_at = excluded.categories_seeded_at,
        updated_at = now()
    where f.categories_seeded_at is null
  returning f.tenant_id into v_claimed;

  if v_claimed is null then
    return false;
  end if;

  insert into public.store_categories (tenant_id, slug, name, icon, position)
  select p_tenant_id, v.slug, v.name, v.icon, v.position
    from (values
      ('cursos',       'Cursos',       'graduation-cap', 1),
      ('livros',       'Livros',       'book-open',      2),
      ('materiais',    'Materiais',    'file-text',      3),
      ('roupas',       'Roupas',       'shirt',          4),
      ('perfumes',     'Perfumes',     'spray-can',      5),
      ('equipamentos', 'Equipamentos', 'wrench',         6),
      ('servicos',     'Serviços',     'calendar-check', 7),
      ('outros',       'Outros',       'package',        8)
    ) as v (slug, name, icon, position)
  on conflict do nothing;

  return true;
end
$$;
--> statement-breakpoint

-- 4. The lazy seed for a store enabled later. SECURITY DEFINER because the caller is a member lane that cannot write the
-- new tables; it takes NO argument and reads only its own claim, so it can seed no tenant but the caller's. A session
-- without a tenant claim does nothing. Returns whether this call seeded.
create or replace function app.store_seed_categories()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  if v_tenant is null then
    return false;
  end if;
  return app.store_seed_categories_for(v_tenant);
end
$$;
--> statement-breakpoint

-- 5. The one-time initial load. SECURITY INVOKER and owner-only; the backfill migration calls it once and it stays so
-- pgTAP can run it on a fixture. The tenants it seeds are those that own at least one product here and carry no seeded
-- marker. A product that already has a category is never overwritten, and `updated_at` is never written. A tenant whose
-- marker is already set (a store that was seeded, even one whose admin then deleted every category) is skipped whole.
create or replace function app.store_categories_initial_load()
returns table (tenants_seeded integer, products_categorized integer)
language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid;
  v_rows   integer;
begin
  tenants_seeded := 0;
  products_categorized := 0;

  for v_tenant in
    select distinct p.tenant_id
      from public.store_products p
     where not exists (
             select 1
               from public.store_front f
              where f.tenant_id = p.tenant_id
                and f.categories_seeded_at is not null)
     order by p.tenant_id
  loop
    if app.store_seed_categories_for(v_tenant) then
      tenants_seeded := tenants_seeded + 1;

      update public.store_products p
         set category_id = c.id
        from public.store_categories c
       where p.tenant_id = v_tenant
         and p.category_id is null
         and c.tenant_id = v_tenant
         and c.slug = app.store_guess_category(p.name);
      get diagnostics v_rows = row_count;
      products_categorized := products_categorized + v_rows;
    end if;
  end loop;

  return next;
end
$$;
--> statement-breakpoint

-- Grants. EXECUTE is revoked from public and from the lanes on the two owner-only functions; the lazy seed is the only
-- one a tenant lane may call. The guess is a pure function: it keeps the default grant of the schema.
revoke all on function app.store_seed_categories_for(uuid)
  from public, anon, authenticated, service_role, api_user;
--> statement-breakpoint
revoke all on function app.store_categories_initial_load()
  from public, anon, authenticated, service_role, api_user;
--> statement-breakpoint
revoke all on function app.store_seed_categories() from public, anon;
--> statement-breakpoint
grant execute on function app.store_seed_categories() to authenticated;
--> statement-breakpoint

comment on function app.store_guess_category(text) is
  '12.3-09 (D-692): the category a product name tells (the web rule ported to SQL, whole words, accents and case ignored, priority order, else outros). Immutable; pinned by packages/modules/store/tests/guess-corpus.ts.';
--> statement-breakpoint
comment on function app.store_seed_categories_for(uuid) is
  '12.3-09 (D-691): owner-only seam. Claims the once-only category seed through store_front.categories_seeded_at and writes the eight built-in categories; returns whether it seeded. Never seeds a store twice, even after its admin deleted every category.';
--> statement-breakpoint
comment on function app.store_seed_categories() is
  '12.3-09 (D-691): the lazy, tenant-pinned category seed for a store enabled later. Takes no argument, reads app.tenant_id(), runs the seam for that tenant only.';
--> statement-breakpoint
comment on function app.store_categories_initial_load() is
  '12.3-09 (D-692): one-time initial load. Seeds every tenant that owns a product in this project and has no seeded marker, then categorizes that tenant''s uncategorized products by name without touching updated_at. Owner-only; called once by the backfill migration.';
