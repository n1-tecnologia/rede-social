-- media_bucket_audio (12.5-01, D-864, VOICE-13): widen the PRIVATE `media` bucket's mime allow-list to
-- the thirteen values `@rede-social/contracts/media` now accepts — the ten it held (three images,
-- PDF, the four office document mimes, the two video mimes) plus the three recording containers of
-- `VOICE_MIMES`: audio/webm (Chrome, Firefox, Android), audio/mp4 (Safari, iOS) and audio/ogg
-- (Firefox). Base types only; the recorder strips the codec parameter before the upload starts.
--
-- Why: a chat voice message is a direct-to-Storage PUT, and the bucket's allow-list is the FIRST gate
-- that PUT meets, so a recording would be refused at the PUT with today's list before the API ever
-- judged its bytes. What a declared mime's bytes really are is still judged at `complete` (the
-- object's recorded content type against the row's declared mime, then the container signature).
--
-- Expand-only and a no-op for every existing object: nothing is removed from the list, `public`
-- stays false, `file_size_limit` is unchanged (50 MiB), `storage.objects` keeps ZERO policies, and
-- every vector format is still refused (T-03-09).
--
-- Idempotent and value-for-value identical to `[storage.buckets.media]` in supabase/config.toml,
-- which seeds LOCAL stacks only. `supabase/tests/070-media-bucket.sql` pins both as a SET. Ships
-- with the 12.5 release, before the API that accepts the new mimes (docs/DEPLOY.md § Storage buckets).
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
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.ms-excel',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'application/vnd.ms-powerpoint',
             'video/mp4',
             'video/quicktime',
             'audio/webm',
             'audio/mp4',
             'audio/ogg'
           ]
     where id = 'media';
  end if;
end
$$;
