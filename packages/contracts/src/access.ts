/**
 * `@rede-social/contracts/access` — the community ACCESS vocabulary (08.2, STORE-13, STORE-15,
 * STORE-17, D-354, D-356). A SUBPATH, never re-exported from `src/index.ts` (the root barrel is
 * frozen, and the web's client components import these lists).
 *
 * WHO OWNS WHAT (MOD-02). The STORE owns the rule ("this community is locked for this member"),
 * through the kernel seam `app.community_locked_ids()`. The FEED emits these values on its answers,
 * and the WEB reads them to draw the padlock and route to the buy section. Neither feed nor the web
 * imports the store module to do so: the words live here, in the shared contracts package.
 */

/**
 * The `details.access` value of a 403 `FORBIDDEN` on locked content:
 *
 * - `community_locked` — the post (or its comments, or a like on it) belongs to a community locked
 *   for the caller. On the visible SAMPLE post the interaction routes answer this; `GET
 *   /v1/feed/posts/{postId}` on a HIDDEN post answers it too, with `details.communityId`, so a
 *   shared link can send the member to the community's buy section. Any other miss stays the bare
 *   404 (D-23).
 */
export const ACCESS_REFUSALS = ['community_locked'] as const;
export type AccessRefusal = (typeof ACCESS_REFUSALS)[number];

/**
 * How a post is served when it is NOT fully accessible. Absent means full access; the API emits a
 * value only on a locked community's answers (RESEARCH Pitfall 10: the key is optional, so an older
 * web never meets it while the `store` module is off).
 *
 * - `sample` — the newest live post of a community locked for the caller: readable, never
 *   interactive (no like, no comment, no share).
 */
export const POST_ACCESS = ['sample'] as const;
export type PostAccess = (typeof POST_ACCESS)[number];
