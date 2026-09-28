begin;
-- 070-media-bucket.sql — the PRIVATE `media` Storage bucket of plan 03-01 (MEDIA-01/TENANT-04), as
-- the DATABASE sees it. Locally the row comes from `[storage.buckets.media]` in supabase/config.toml
-- (read at `supabase start` / `db reset`); everywhere else from `*_media_bucket.sql`, an idempotent
-- upsert applied by `supabase db push`. Both must agree on every value below, because the API's 413
-- threshold and the accepted upload mimes are pinned to them: a bucket that quietly allowed 100 MiB
-- or a vector mime would make the broker's own refusals a fiction.
--
-- Why assertion 6 exists (R-15, T-03-08): `storage.objects` has RLS enabled and ZERO policies on
-- this stack, and that is deliberate for this bucket. The browser never holds a Supabase JWT for
-- Storage (CLAUDE.md forbids `@supabase/supabase-js` in the browser for data/storage) — every read
-- goes through `GET /v1/media/{assetId}/{variant}`, which 302s to a signed URL built from the
-- CALLER's own tenant id. A select policy would therefore grant nothing that is used, while creating
-- a latent widening the day a token does leak. The assertion is what keeps that count at zero.
--
-- Runs in one transaction that rolls back, so it re-runs identically in any order.
select plan(7);

select is(
  (select count(*)::int from storage.buckets where id = 'media'),
  1,
  'MEDIA-01: the media bucket exists (config.toml locally, *_media_bucket.sql hosted)'
);

select is(
  (select public from storage.buckets where id = 'media'),
  false,
  'TENANT-04: the media bucket is PRIVATE — a member photo is never world-readable'
);

select is(
  (select file_size_limit from storage.buckets where id = 'media'),
  52428800::bigint,
  'MEDIA-01: the bucket caps files at 50 MiB (52428800), the Supabase Free per-file ceiling'
);

select ok(
  (select 'image/jpeg' = any(allowed_mime_types) and 'application/pdf' = any(allowed_mime_types)
     from storage.buckets where id = 'media'),
  'MEDIA-01: member photos (jpeg) and the file kind (pdf) are in the allow-list'
);

select ok(
  (select not ('image/svg+xml' = any(allowed_mime_types)) from storage.buckets where id = 'media'),
  'T-03-09: a vector upload is NOT accepted — unlike the admin-only brand logo there is no safety-scan escape hatch for a member avatar'
);

-- 03-06: the allow-list is exactly the union of MEDIA_LIMITS in @rede-social/contracts/media. The two video
-- mimes are here for `VIDEO_PROVIDER=fake`, which mints its direct-upload target in THIS bucket
-- rather than at a dev-only byte-accepting API route (that route would contradict MEDIA-01). With
-- `VIDEO_PROVIDER=mux` the vendor owns the object and they are unused. Pinned as a SET, so neither
-- a silent widening nor a silent narrowing can pass.
select results_eq(
  $$ select array(select unnest(allowed_mime_types) from storage.buckets where id = 'media' order by 1) $$,
  $$ values (array['application/pdf','image/jpeg','image/png','image/webp','video/mp4','video/quicktime']) $$,
  'MEDIA-01/MEDIA-03: the media bucket allow-list is exactly the contract union — images, pdf and the two video mimes, no vector'
);

select is(
  (select count(*)::int from pg_policy where polrelid = 'storage.objects'::regclass),
  0,
  'R-15/T-03-08: storage.objects carries ZERO policies — a policy would grant nothing that is used'
);

select * from finish();
rollback;
