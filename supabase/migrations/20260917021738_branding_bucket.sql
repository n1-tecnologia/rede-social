-- branding_bucket (02-13, D-27/D-28): the public `branding` Storage bucket for tenant brand assets.
--
-- Why a migration: `[storage.buckets.branding]` in supabase/config.toml seeds the bucket on LOCAL
-- stacks only (`supabase start` reads it; RESEARCH A7) — a hosted project needs the row from here,
-- applied by `supabase db push` like every other migration. Idempotent upsert, so whichever runs
-- first (config.toml locally, this file everywhere) the two agree on every value.
--
-- Layout (CLAUDE.md §4): uploads at `<tenant_id>/branding/<uuid>.<ext>` through API-minted signed
-- upload URLs; the worker's derived favicon + PWA icon set at `<tenant_id>/branding/icons/<iconVersion>/`
-- (the two ICO mime types are for that derived favicon). Size cap and mime allow-list are enforced
-- by Storage at PUT time, for service-key uploads too.
--
-- Why no `storage.objects` policy: reads of a PUBLIC bucket bypass RLS by design (brand assets are
-- public — T-02-85 accepted), listing needs a select policy this migration does NOT create (keys are
-- `<tenant uuid>/branding/<random uuid>` — nothing guessable), and every write happens through
-- service-key signed URLs or the service key itself, never through `authenticated`.
--
-- Guarded with `to_regclass`: `supabase test db` / a bare Postgres without the storage schema must
-- still apply the migration set.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'branding',
      'branding',
      true,
      2097152,
      array[
        'image/png',
        'image/svg+xml',
        'image/webp',
        'image/jpeg',
        'image/x-icon',
        'image/vnd.microsoft.icon'
      ]
    )
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;
