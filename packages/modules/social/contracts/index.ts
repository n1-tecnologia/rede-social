import { MEDIA_LIMITS } from '@rede-social/contracts/media';
import { z } from 'zod';

/**
 * The social module's published contract surface (`@rede-social/module-social/contracts`): the
 * module key, the one permission the module owns (09-01), the follow graph's request and answer
 * shapes (09-02) and the per-tenant member media limits (09-06). The Explorar schemas arrive with the
 * plans that use them.
 */

/** The `tenant_modules.module_key` of this module (SOCIAL-01, D-482). */
export const SOCIAL_MODULE_KEY = 'social' as const;

/**
 * `social.participate` is composed for the role `member` ONLY, and that is by construction.
 *
 * The follow routes and the member branch of `GET /v1/members` check it, and the RLS policies and
 * SECURITY DEFINER functions those routes reach key on the MEMBER role of the caller's membership.
 * Granting it to `admin_tenant` or `support_tenant` (through settings or any other composition) would
 * let staff into routes whose SQL does not expect them: a follow row for a staff membership, or a
 * directory answer shaped for a member. Widen the SQL in the same change or never compose it
 * elsewhere; `apps/api/tests/unit/registry.test.ts` (case 16) fails first. The store's
 * `store.product.manage` carries the mirrored warning (admin-only by construction).
 */
export const SOCIAL_PERMISSIONS = { participate: 'social.participate' } as const;

/**
 * The closed refusal vocabulary of a follow (D-467). Today it has ONE word: the caller named their
 * own membership. Every other miss (unknown, another tenant's, staff, blocked, invited, removed) is
 * the bare 404 with NO code, because a code there would be an existence oracle (T-09-03). The route's
 * `defaultHook` lifts a Zod issue carrying one of these words into `details.follow`, and the service
 * throws the same word, so one vocabulary serves both layers.
 */
export const SOCIAL_FOLLOW_ISSUES = ['self_follow'] as const;
export type SocialFollowIssue = (typeof SOCIAL_FOLLOW_ISSUES)[number];
export const SOCIAL_FOLLOW_ISSUE_SET: ReadonlySet<string> = new Set(SOCIAL_FOLLOW_ISSUES);

/**
 * `PUT` / `DELETE /v1/social/follows/{membershipId}`: the state after the call and the target's
 * follower count. `.strict()` so the shape the API sends and the web parses cannot drift. A count of
 * exactly one is the integer 1 and zero is 0 (the web turns the singular label, EP-36).
 */
export const followResultSchema = z
  .object({
    following: z.boolean(),
    followerCount: z.number().int().min(0),
  })
  .strict();
export type FollowResult = z.infer<typeof followResultSchema>;

/**
 * The private lists (D-468). `SOCIAL_LIST_PAGE_SIZE` is what the web sends as `limit`; the server
 * clamps to `1..SOCIAL_LIST_MAX_PAGE_SIZE` so a crafted `?limit=100000` cannot ask for an unbounded
 * page. The query takes NO member id: the list is the session's own rows, and `.strict()` makes an
 * unknown key (`membershipId`, `userId`) a 400 rather than a silently ignored filter (D-468, T-09-04).
 *
 * `cursor` is OPAQUE (the kernel's `(created_at, id)` envelope, `paging.ts`): pass back the previous
 * `nextCursor` verbatim. A stale or tampered value is not an error, it is the first page.
 */
export const SOCIAL_LIST_PAGE_SIZE = 25;
export const SOCIAL_LIST_MAX_PAGE_SIZE = 50;
/** The longest cursor looked at: a base64url `{ v, n, id }` envelope is ~150 characters. */
const SOCIAL_MAX_CURSOR_LENGTH = 512;

export const socialListQuerySchema = z
  .object({
    cursor: z.string().max(SOCIAL_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SOCIAL_LIST_MAX_PAGE_SIZE)
      .default(SOCIAL_LIST_PAGE_SIZE),
  })
  .strict();
export type SocialListQuery = z.infer<typeof socialListQuerySchema>;

/**
 * One person in "Seguidores" or "Seguindo": the public profile fields (name, bio, photo) plus whether
 * the CALLER follows them (always true in "Seguindo"). No role, no counts, no email.
 */
export const socialListItemSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    viewerFollows: z.boolean(),
  })
  .strict();
export type SocialListItem = z.infer<typeof socialListItemSchema>;

/** `nextCursor` is non-null EXACTLY when another row exists beyond this page. */
export const socialListPageSchema = z
  .object({
    items: z.array(socialListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type SocialListPage = z.infer<typeof socialListPageSchema>;

/**
 * `POST /v1/social/follows/state`: which of these members does the caller follow? One batched read
 * for a page of `/membros` rows beats N calls. 1 to 50 ids; the answer holds one item per input id in
 * INPUT order, and `following: false` for an id that is unknown, staff or another tenant's, so the
 * answer carries no existence signal.
 */
export const SOCIAL_FOLLOW_STATE_MAX_IDS = 50;
export const followStateBodySchema = z
  .object({
    membershipIds: z.array(z.uuid()).min(1).max(SOCIAL_FOLLOW_STATE_MAX_IDS),
  })
  .strict();
export type FollowStateBody = z.infer<typeof followStateBodySchema>;

export const followStateSchema = z
  .object({
    items: z.array(z.object({ membershipId: z.uuid(), following: z.boolean() }).strict()),
  })
  .strict();
export type FollowState = z.infer<typeof followStateSchema>;

/**
 * `GET /v1/social/members/{membershipId}` (FOLLOW-04): the SOCIAL variant of another member's profile,
 * a separate shape on purpose. The base `memberProfileSchema` (`@rede-social/contracts/profiles`)
 * stays `.strict()` and unchanged (D-45), so a role or a count can never ride on it. Exactly these
 * five keys, `.strict()`, so the shape cannot drift between the API and the web (EP-41).
 *
 * `self` is true when the id is the caller's own membership; then `viewerFollows` is false.
 */
export const memberSocialProfileSchema = z
  .object({
    membershipId: z.uuid(),
    followerCount: z.number().int().min(0),
    followingCount: z.number().int().min(0),
    viewerFollows: z.boolean(),
    self: z.boolean(),
  })
  .strict();
export type MemberSocialProfile = z.infer<typeof memberSocialProfileSchema>;

const MIB = 1024 * 1024;

/**
 * The admin limit of a (kind, purpose) pair, read once at import. A pair missing from the shared
 * table is a programming error that must stop the module at load rather than become an unbounded cap.
 */
function adminLimit(kind: 'image' | 'video') {
  const limit = MEDIA_LIMITS[kind].post;
  if (!limit) throw new Error(`no media limit for ${kind}/post`);
  return limit;
}

/**
 * D-474: a tenant's member allowance can NARROW what the admin may do and never widen it, so every
 * cap is the admin limit of the same kind. They are taken from the shared media table (`MEDIA_LIMITS`)
 * rather than retyped, so the day the admin limit moves the ceiling of the setting moves with it.
 */
export const SOCIAL_MAX_PHOTO_BYTES = adminLimit('image').maxBytes;
export const SOCIAL_MAX_VIDEO_BYTES = adminLimit('video').maxBytes;
export const SOCIAL_MAX_VIDEO_SECONDS = adminLimit('video').maxDurationSeconds ?? 300;
/**
 * Mirrors the feed's own image cap (`FEED_MAX_IMAGES`). The feed contract cannot be imported here (a
 * module may not import another module), so the number is written twice and
 * `apps/api/tests/unit/registry.test.ts` (case 19) reads both and fails the day they drift.
 */
export const SOCIAL_MAX_PHOTOS_PER_POST = 10;

const photoMaxBytesField = z.number().int().min(1).max(SOCIAL_MAX_PHOTO_BYTES);
const photosPerPostField = z.number().int().min(1).max(SOCIAL_MAX_PHOTOS_PER_POST);
const videoEnabledField = z.boolean();
const videoSecondsField = z.number().int().min(1).max(SOCIAL_MAX_VIDEO_SECONDS);
const videoBytesField = z.number().int().min(1).max(SOCIAL_MAX_VIDEO_BYTES);

/** The values a tenant gets until the `super_admin` edits them: 5 MB x 4 photos, video off (60 s, 100 MB). */
export const SOCIAL_SETTINGS_DEFAULTS = {
  media: {
    photoMaxBytes: 5 * MIB,
    photosPerPost: 4,
    video: { enabled: false, maxDurationSeconds: 60, maxBytes: 100 * MIB },
  },
} as const;

/**
 * `tenant_modules['social'].settings` as the REGISTRY and the platform GET read it (D-474). Tolerant
 * on purpose, the `feedSettingsSchema` style: an empty blob parses to the defaults, a stray key is
 * dropped, and the callers use `safeParse` and fall back to `SOCIAL_SETTINGS_DEFAULTS` on a malformed
 * value, so a bad stored blob can never throw on a request path. `prefault({})` (not `default`) lets
 * every nested level fill its own defaults.
 */
export const socialSettingsSchema = z.object({
  media: z
    .object({
      photoMaxBytes: photoMaxBytesField.default(SOCIAL_SETTINGS_DEFAULTS.media.photoMaxBytes),
      photosPerPost: photosPerPostField.default(SOCIAL_SETTINGS_DEFAULTS.media.photosPerPost),
      video: z
        .object({
          enabled: videoEnabledField.default(SOCIAL_SETTINGS_DEFAULTS.media.video.enabled),
          maxDurationSeconds: videoSecondsField.default(
            SOCIAL_SETTINGS_DEFAULTS.media.video.maxDurationSeconds,
          ),
          maxBytes: videoBytesField.default(SOCIAL_SETTINGS_DEFAULTS.media.video.maxBytes),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type SocialSettings = z.infer<typeof socialSettingsSchema>;

/**
 * `PUT /v1/platform/tenants/{id}/modules/social/settings` (D-474, T-09-30): a PARTIAL patch, every
 * key optional at every level, `.strict()` so an unknown key is a 400 and never a silently stored
 * stray. No defaults here: a key the caller leaves out is a key the stored blob keeps.
 */
export const socialSettingsPatchSchema = z
  .object({
    media: z
      .object({
        photoMaxBytes: photoMaxBytesField.optional(),
        photosPerPost: photosPerPostField.optional(),
        video: z
          .object({
            enabled: videoEnabledField.optional(),
            maxDurationSeconds: videoSecondsField.optional(),
            maxBytes: videoBytesField.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SocialSettingsPatch = z.infer<typeof socialSettingsPatchSchema>;

/** The answer of both settings routes: the EFFECTIVE settings, every key present. */
export const socialSettingsAnswerSchema = z
  .object({
    media: z
      .object({
        photoMaxBytes: photoMaxBytesField,
        photosPerPost: photosPerPostField,
        video: z
          .object({
            enabled: videoEnabledField,
            maxDurationSeconds: videoSecondsField,
            maxBytes: videoBytesField,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
