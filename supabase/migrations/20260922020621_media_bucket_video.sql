-- media_bucket_video (03-06, MEDIA-03): widen the PRIVATE `media` bucket's mime allow-list to the
-- two video mimes `@rede-social/contracts/media` already accepts (`MEDIA_LIMITS.video.*.mimes`), so the
-- allow-list is exactly the union of the contract's kinds: jpeg/png/webp (images), pdf (files),
-- mp4/quicktime (video).
--
-- Why a video mime belongs in a bucket that, in production, never stores a video: `VIDEO_PROVIDER`
-- has two implementations and `fake` — the fail-safe default that every non-production environment
-- and CI runs — mints its direct-upload target HERE, under the asset's own
-- `<tenant_id>/media/<assetId>/original` key. The alternative would be a dev-only byte-accepting API
-- route, which would put a request-body parser in the API and quietly contradict MEDIA-01's
-- structural rule that file bytes never transit Cloud Run. With `VIDEO_PROVIDER=mux` the streaming
-- vendor owns the object and nothing mints a Storage URL for a video at all, so these two entries
-- are simply unused.
--
-- What this does NOT widen: the bucket stays PRIVATE, keeps the 50 MiB per-file cap (so a real
-- 500 MB post video could never land here even by accident), keeps ZERO `storage.objects` policies,
-- and still refuses every vector format (T-03-09). An image asset whose object turned out to carry
-- video bytes is still refused at `complete`, which compares the object's contentType against the
-- row's declared mime and removes the object — the allow-list was never the only check.
--
-- Idempotent and value-for-value identical to `[storage.buckets.media]` in supabase/config.toml,
-- which seeds LOCAL stacks only. `supabase/tests/070-media-bucket.sql` pins both.
--
-- Guarded with `to_regclass`: `supabase test db` / a bare Postgres without the storage schema must
-- still apply the migration set.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array[
             'image/jpeg',
             'image/png',
             'image/webp',
             'application/pdf',
             'video/mp4',
             'video/quicktime'
           ]
     where id = 'media';
  end if;
end
$$;
