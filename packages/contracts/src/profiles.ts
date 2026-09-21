import { z } from 'zod';
import { mediaVariantUrl, PURPOSE_WIDTHS } from './media';

/**
 * Member profile contract (PROF-01, PROF-02, TENANT-04).
 *
 * Pure module — no node imports — so client components may import it through `@tria/contracts/profiles`
 * for the edit form's counter and `maxLength` (03-04) exactly as `@tria/contracts/media` serves the
 * pick-time upload gate. It is deliberately NOT re-exported from `./index.ts`: the root barrel has
 * been frozen since Phase 2 wave 2, and `./media` established the subpath precedent.
 *
 * The profile hangs off the MEMBERSHIP, not off `users` (`packages/core/docs/SCHEMA-CONVENTIONS.md`
 * §(b)4 — "a person may present differently in different tenants"), so every shape below is keyed by
 * `membershipId`. `users.name` is the identity anchor and is never rewritten by a profile edit (D-46).
 *
 * The photo is a `media_assets` id, and the URL the payload carries is the STABLE
 * `/v1/media/{assetId}/w128` serving path (R-05) — never an inline signed Storage URL, so the tenant
 * check runs on every image fetch and a cached payload can never outlive its URLs (TENANT-04).
 */

/** The display-name cap, in UTF-16 code units — see the `bioSchema` docblock for why that matters. */
export const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * The bio cap, in UTF-16 code units. 150 is the design team's number
 * [reference/frontend-design/lib/constants.ts:16], and R-09 keeps it plain text.
 */
export const MAX_BIO_LENGTH = 150;

/**
 * The closed refusal vocabulary for a profile write. A `400 VALIDATION_FAILED` envelope carries
 * `details.displayName`, `details.bio` or `details.avatarAssetId` set to exactly one of these
 * (alongside the standard Zod `issues[]`), so 03-04 can switch on it exhaustively and map each to
 * pt-BR copy — the `MEDIA_ISSUES` discipline applied to the profile form.
 */
export const PROFILE_ISSUES = ['required', 'too_long', 'invalid'] as const;
export type ProfileIssue = (typeof PROFILE_ISSUES)[number];
/** `details.displayName` / `details.bio` / `details.avatarAssetId` always parse with this. */
export const profileIssueSchema = z.enum(PROFILE_ISSUES);

/**
 * Normalise a bio BEFORE it is measured (R-09, plain text with newlines as the only structure):
 * CRLF becomes LF, runs of three or more newlines collapse to exactly two, the value is trimmed and
 * an empty result becomes `null` — a bio is stored as SQL NULL, never as `''`, so "no bio" has one
 * representation everywhere. A non-string (including `null`/`undefined`) is `null` too.
 */
export function normaliseBio(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return collapsed === '' ? null : collapsed;
}

/**
 * The display name (D-46: freely editable, overwritten in place, no history, no approval gate).
 * `.trim()` runs BEFORE `.min()`/`.max()` in Zod 4, so `'  Ana  '` is accepted as `'Ana'` and a
 * 61-character value whose trailing character is a space is accepted as 60.
 * The `'required'` message is what the route hook turns into `details.displayName = 'required'`.
 */
export const displayNameSchema = z.string().trim().min(1, 'required').max(MAX_DISPLAY_NAME_LENGTH);

/**
 * The bio, normalised in a `preprocess` and only THEN length-checked. Normalising inside the schema
 * (rather than after it) is what avoids the Zod 4 ordering trap recorded for 02-03 — format checks
 * run before overwrite transforms — so a 151-character value that trims to 150 is accepted.
 *
 * `.max()` counts UTF-16 code units, i.e. exactly what JavaScript's `String.length` measures, which
 * is also the unit the browser's `value.length` counter and `<textarea maxLength>` use. The client
 * counter and the server therefore cannot disagree: an astral-plane emoji counts as 2 on both sides.
 */
export const bioSchema = z.preprocess(normaliseBio, z.string().max(MAX_BIO_LENGTH).nullable());

/**
 * `PATCH /v1/me/profile` body. At least one key must be present; unknown keys are refused
 * (`.strict()`). A key that is ABSENT leaves the column untouched; a key present with `null` clears
 * it — `{ avatarAssetId: null }` removes the photo and retires the previous asset server-side.
 *
 * Refusals (all `400 VALIDATION_FAILED`, codes from `PROFILE_ISSUES`):
 *   `details.displayName = 'required'`   — empty or whitespace-only name
 *   `details.displayName = 'too_long'`   — beyond `MAX_DISPLAY_NAME_LENGTH`
 *   `details.bio = 'too_long'`           — beyond `MAX_BIO_LENGTH`
 *   `details.avatarAssetId = 'invalid'`  — not an avatar asset of the caller's, ready or processing
 * plus the standard `details.issues[{ path, message }]` for shape violations.
 */
export const updateProfileBodySchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: bioSchema.optional(),
    avatarAssetId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at_least_one_field',
  });
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

/**
 * `GET`/`PATCH /v1/me/profile` and `POST /v1/me/profile/dismiss-nudge` answer this: the caller's OWN
 * profile, which carries the facts only its owner may see (`email`, the nudge state) on top of the
 * public `memberProfileSchema` fields.
 *
 * `needsNudge` is SERVER state (R-13, D-02): true while `(avatarAssetId is null or bio is null) and
 * nudgeDismissedAt is null`. The card's visibility rule is this flag, never a client recomputation
 * and never `localStorage` — an installed PWA whose storage the OS evicts must not re-nag someone
 * who already said no.
 */
export const ownProfileSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    avatarUrl: z.string().nullable(),
    email: z.string(),
    nudgeDismissedAt: z.string().nullable(),
    needsNudge: z.boolean(),
  })
  .strict();
export type OwnProfile = z.infer<typeof ownProfileSchema>;

/**
 * Another member's profile as PROF-02 shows it — and D-45 is the whole specification: **photo,
 * display name and bio ONLY**. No role badge (there is no admin badge on profiles in V1), no join
 * date, no counts, no follow/message affordance, and no e-mail — the e-mail is staff's identity
 * anchor (D-46), not a member-visible fact.
 *
 * `.strict()` is the MECHANISM that keeps D-45 true over time: a later field added to the row cannot
 * leak into this shape without failing the contract test that feeds it a `role` key. 03-03's
 * `GET /v1/members/{membershipId}` must return exactly this.
 */
export const memberProfileSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .strict();
export type MemberProfile = z.infer<typeof memberProfileSchema>;

/**
 * The `<img srcset>` for an avatar, built from `PURPOSE_WIDTHS.avatar` so the derived ladder and the
 * srcset can never drift: widening the avatar ladder in `@tria/contracts/media` widens this string
 * automatically, and a width the worker never produced can never appear here.
 */
export function avatarSrcSet(assetId: string): string {
  return PURPOSE_WIDTHS.avatar
    .map((width) => `${mediaVariantUrl(assetId, `w${width}`)} ${width}w`)
    .join(', ');
}

/** The single display size a payload carries (`bootstrap.membership.profile.avatarUrl`, R-05/R-06). */
export const AVATAR_DISPLAY_VARIANT = 'w128';

/** The stable serving URL for an avatar, or `null` when the member has no photo. */
export function avatarUrlFor(assetId: string | null): string | null {
  return assetId === null ? null : mediaVariantUrl(assetId, AVATAR_DISPLAY_VARIANT);
}
