-- course_asset_gate_seam (08.5-01, COURSE-20, D-433; RESEARCH Pattern 5, Pattern 12) — the KERNEL
-- declares the course ASSET gate; a module gives it a body.
--
-- WHY. From 08.5 a lesson's video and its materials are content a member opens only through a
-- lesson they may open (the course door: purchase and sequence; the live door: a replay of a live
-- they may open, D-433). The kernel media service asks that question before it mints a playback
-- credential (`playbackTokens`, T-08.3-05) and before it signs a material's `/original` bytes
-- (`serveVariant('original')`, T-08.3-08), so it is ONE seam with a kernel-owned name
-- (`packages/core/db/course-gate.ts` `courseAssetHidden`), never a call into a module. It is a
-- SECOND asset seam beside `app.media_asset_hidden` (the feed's, `*_community_gate_seam.sql`) on
-- purpose: a courses migration re-creating the feed body would inline it, and a later feed
-- redefinition would silently drop the lesson branch (MOD-02, 08.5-01 planning decision 1).
--
-- WHY STUBS FIRST. Every later migration that references the seam — the courses functions migration
-- that gives it a body, and anything that calls it — must find it when it runs. So this file sorts
-- before them and declares the function with its neutral answer; the courses module's
-- `*_courses_member_functions.sql` swaps the body with `create or replace` (same signature, same
-- OID). Until then, or in a project that reuses the media kernel without courses, no asset is
-- hidden by this gate:
--   app.course_asset_hidden(p_asset)   -> false   (no lesson asset hidden)
--
-- Hardening (the T-06-29 posture, kept by the body that replaces it): SECURITY DEFINER,
-- `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only. The stub reads no table. Expand-only: for every existing tenant this file
-- changes nothing a member can observe.

create or replace function app.course_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
--> statement-breakpoint
revoke all on function app.course_asset_hidden(uuid) from public;--> statement-breakpoint
grant execute on function app.course_asset_hidden(uuid) to authenticated;
