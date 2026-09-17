begin;
-- 060-branding-bucket.sql — the public `branding` Storage bucket of plan 02-13 (D-27/D-28), as the
-- DATABASE sees it. Locally the row comes from `[storage.buckets.branding]` in supabase/config.toml
-- (read at `supabase start` / `db reset`); everywhere else from `*_branding_bucket.sql`, an
-- idempotent upsert applied by `supabase db push`. Both must agree on every value below, because
-- the API's 413 threshold (`BRANDING_MAX_BYTES`) and the accepted upload mimes are pinned to them.
--
-- Why no `storage.objects` policy is asserted: reads of a public bucket bypass RLS by design (brand
-- assets are public — T-02-85 accepted), and every write goes through service-key signed upload
-- URLs or the service key itself, never through `authenticated`. Object keys are built server-side
-- as `<tenant_id>/branding/<uuid>.<ext>` and `<tenant_id>/branding/icons/<iconVersion>/…`.
--
-- Runs in one transaction that rolls back, so it re-runs identically in any order.
select plan(5);

select is(
  (select count(*)::int from storage.buckets where id = 'branding'),
  1,
  'D-27: the branding bucket exists (config.toml locally, *_branding_bucket.sql hosted)'
);

select is(
  (select public from storage.buckets where id = 'branding'),
  true,
  'D-27: the branding bucket is public — logos and derived icons are world-readable by design'
);

select is(
  (select file_size_limit from storage.buckets where id = 'branding'),
  2097152::bigint,
  'D-27: the bucket caps files at 2 MiB (2097152), the same value the API answers 413 above'
);

select ok(
  (select 'image/svg+xml' = any(allowed_mime_types) and 'image/x-icon' = any(allowed_mime_types)
     from storage.buckets where id = 'branding'),
  'D-27/D-28: SVG uploads and the derived ICO favicon are in the allow-list'
);

select ok(
  (select not ('image/gif' = any(allowed_mime_types)) from storage.buckets where id = 'branding'),
  'D-27: GIF is not an accepted brand format (Storage refuses it at PUT time, the API at start)'
);

select * from finish();
rollback;
