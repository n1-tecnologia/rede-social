import { type SQL, sql } from 'drizzle-orm';

/**
 * The chat ASSET gate seam (12.5-07, VOICE-24, VOICE-25; D-858, D-867, D-868). Kernel-owned, the
 * `course-gate.ts` posture: the kernel NAMES the gate, the chat module gives it a body, and the
 * kernel media service imports ONLY this file (never the chat module).
 *
 * The SQL function is declared by the KERNEL migration `*_chat_asset_gate_seam.sql` as a stub that
 * answers `false` (no recording hidden), so a project that reuses the media kernel without the chat
 * module hides nothing. The chat module gives the body with `create or replace`, keeping the
 * signature (`*_chat_voice_gate.sql`):
 *
 * | Function                                | Answer                                                         |
 * |-----------------------------------------|----------------------------------------------------------------|
 * | `app.chat_asset_hidden(uuid) boolean`   | a voice recording the caller may not read (or a retired one)   |
 *
 * It is a SECOND asset seam beside `app.media_asset_hidden` (the feed's, asked only by the video
 * playback route) and `app.course_asset_hidden` (08.5) on purpose: `/original` never asked the feed
 * gate, and a later feed or courses migration that re-creates its body would silently drop a chat
 * branch (D-867, MOD-02). The body is SECURITY INVOKER, so the chat tables' own policies decide who
 * may read a message that carries the recording (the member, the tenant's staff of a support case,
 * the participants of a direct or group conversation) and nothing restates them.
 *
 * `true` means "serve nothing": the uploader of a take and every user who can read a message that
 * references it are NOT hidden; a same-tenant non-participant, the staff of a direct conversation
 * they are not part of, and every caller once the recording is soft-deleted are. Anything that is not
 * a voice asset is never hidden by this gate. The media service ORs it into the ONE read gate it
 * already runs for an original and fails closed: an answer that is not a plain `false` is a 404.
 */

/** `true` when a voice recording is held back from the caller: another conversation's, or retired. */
export const chatAssetHidden = (assetId: string): SQL =>
  sql`app.chat_asset_hidden(${assetId}::uuid)`;
