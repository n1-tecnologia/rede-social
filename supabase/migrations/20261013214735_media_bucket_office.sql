-- media_bucket_office (08.3-03, D-410, COURSE-07): widen the PRIVATE `media` bucket's mime
-- allow-list to the eleven values `@rede-social/contracts/media` now accepts — three images, PDF, the
-- four office document mimes of `ATTACHMENT_MIMES` (xlsx, xls, pptx, ppt) and the two video mimes —
-- so the allow-list stays exactly the union of the contract's kinds.
--
-- Why: a course lesson's materials (D-410) are "PDF, spreadsheet, slides, images" at 50 MB, and
-- the feed's attachments widen with them (FEED-01, "PDF and similar"). The bucket's allow-list is
-- the FIRST gate a direct-to-Storage PUT meets, so a spreadsheet would be refused at the PUT with
-- today's list before the API ever judged its bytes.
--
-- Expand-only and a no-op for every existing object: nothing is removed from the list, `public`
-- stays false, `file_size_limit` stays 50 MiB (the Supabase Free per-file ceiling, which is also
-- `MEDIA_LIMITS.file.attachment.maxBytes`), `storage.objects` keeps ZERO policies, and every vector
-- format is still refused (T-03-09). What a declared mime's bytes really are is still judged at
-- `complete`: `inspectFile` checks the PDF, ZIP (OOXML) and OLE (legacy office) signatures and
-- decodes the images with sharp, and the object's recorded content type is compared with the row's
-- declared mime (T-08.3-16).
--
-- Idempotent and value-for-value identical to `[storage.buckets.media]` in supabase/config.toml,
-- which seeds LOCAL stacks only. `supabase/tests/070-media-bucket.sql` pins both as a SET. Ships with
-- the 08.3 release, before the API that accepts the new mimes (docs/DEPLOY.md § Storage buckets).
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
             'video/quicktime'
           ]
     where id = 'media';
  end if;
end
$$;
