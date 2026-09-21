-- media_bucket (03-01, MEDIA-01/MEDIA-02/TENANT-04): the PRIVATE `media` Storage bucket for every
-- member upload.
--
-- Why a migration: `[storage.buckets.media]` in supabase/config.toml seeds the bucket on LOCAL
-- stacks only (`supabase start` / `db reset` read it) — a hosted project needs the row from here,
-- applied by `supabase db push` like every other migration. Idempotent upsert, so whichever runs
-- first (config.toml locally, this file everywhere) the two agree on every value.
--
-- Layout (CLAUDE.md §4): the browser PUTs (or TUS-uploads) the bytes straight to an API-minted
-- signed URL at `<tenant_id>/media/<assetId>/original` — deliberately WITHOUT an extension, so the
-- whole key space is a pure function of (tenantId, assetId, variant) and the serving route needs no
-- database read — and the worker writes the derived WebP ladder at
-- `<tenant_id>/media/<assetId>/w<width>.webp` (immutable, one-year cache). The size cap and the mime
-- allow-list are enforced by Storage at PUT time, for service-key uploads too, and they are pinned
-- against the API's 413 threshold by supabase/tests/070-media-bucket.sql.
--
-- Why PRIVATE and why NO `storage.objects` policy (R-15): reads happen only through
-- `GET /v1/media/{assetId}/{variant}`, which 302s to a freshly signed URL built from the CALLER's
-- own tenant id, so a tenant-B session cannot name a tenant-A object at all. The browser never holds
-- a Supabase JWT for Storage (CLAUDE.md forbids `@supabase/supabase-js` in the browser for
-- data/storage), so a policy would grant nothing that is used while creating a latent widening the
-- day a token does leak. `070-media-bucket.sql` asserts the policy count stays at ZERO.
--
-- Vector formats are absent from the allow-list on purpose: unlike the admin-only brand logo there is
-- no safety-scan escape hatch for a member-uploaded avatar, which would be a stored-XSS surface.
--
-- Guarded with `to_regclass`: `supabase test db` / a bare Postgres without the storage schema must
-- still apply the migration set.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'media',
      'media',
      false,
      52428800,
      array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
      ]
    )
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;
