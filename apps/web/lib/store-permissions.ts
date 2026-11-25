import type {
  ProductCommunityLink,
  ProductCommunityPermission,
} from '@rede-social/module-store/contracts';

/**
 * 11.1-10 (D-888, D-890, D-891, UI-D-883, UI-D-884, UI-D-898): the pure layer of the product form's
 * buyer-permission group. It holds finished facts only: the five flags a link carries, their defaults,
 * and the mapping from what the form shows to the body the API accepts. Nothing here compares a role,
 * a product or an entitlement, and nothing imports a React file or a route: the screens (plans 12 to
 * 17) read these functions and draw what they answer.
 */

/** The five flags of a product-to-community link, in the order the checkboxes are drawn (UI-D-883). */
export const PERMISSION_ORDER = ['like', 'comment', 'share', 'post', 'story'] as const;
export type PermissionKey = (typeof PERMISSION_ORDER)[number];
export type BuyerPermissions = Record<PermissionKey, boolean>;

/** One chosen community with its five flags: exactly the strict link of the product body. */
export type PermissionLink = ProductCommunityLink;

/** What the form sends: the compatible `communityIds`, or the per-link `communityLinks` (never both). */
export type ProductLinksBody = { communityIds: string[] } | { communityLinks: PermissionLink[] };

/**
 * The defaults of D-890, the same values the database column defaults give a link written through
 * `communityIds`: like, comment and share on, post and story off. A fresh object on every call, so no
 * caller can mutate a shared default.
 */
export function defaultPermissions(): BuyerPermissions {
  return { like: true, comment: true, share: true, post: false, story: false };
}

/** True when every one of the five flags equals its default. */
export function isDefaultPermissions(value: BuyerPermissions): boolean {
  const defaults = defaultPermissions();
  return PERMISSION_ORDER.every((key) => value[key] === defaults[key]);
}

/**
 * The flags of one existing link: the stored values from the manager read's `communityPermissions`
 * (which lists only the links that differ from the defaults), else the defaults. A community the
 * product does not link yet reads the defaults too.
 */
export function permissionsForLink(
  communityPermissions: readonly ProductCommunityPermission[] | undefined,
  communityId: string,
): BuyerPermissions {
  const stored = communityPermissions?.find((entry) => entry.communityId === communityId);
  if (stored === undefined) return defaultPermissions();
  return {
    like: stored.like,
    comment: stored.comment,
    share: stored.share,
    post: stored.post,
    story: stored.story,
  };
}

/**
 * What the product has STORED, per community: every existing link mapped to its stored flags or the
 * defaults. This is the `original` the mapping and `linksChanged` compare a selection against.
 */
export function originalLinks(
  communityIds: readonly string[],
  communityPermissions: readonly ProductCommunityPermission[] | undefined,
): Map<string, BuyerPermissions> {
  return new Map(
    communityIds.map((id) => [id, permissionsForLink(communityPermissions, id)] as const),
  );
}

/** One link's five booleans and nothing else, in the order the contract lists them. */
function linkOf(selected: PermissionLink): PermissionLink {
  return {
    communityId: selected.communityId,
    like: selected.like,
    comment: selected.comment,
    share: selected.share,
    post: selected.post,
    story: selected.story,
  };
}

function sameFlags(a: BuyerPermissions, b: BuyerPermissions): boolean {
  return PERMISSION_ORDER.every((key) => a[key] === b[key]);
}

/**
 * The form-to-body mapping (D-890, D-891, UI-D-883). A body of `communityIds` means "keep what a link
 * has, give a new one the defaults"; so a selection can be sent as `communityIds` exactly when no
 * selected link's flags differ from `original.get(id) ?? defaults`. Any difference (a new link with a
 * non-default flag, a stored link changed, or a stored non-default link ticked back to the defaults,
 * which a `communityIds` save would NOT reset) is sent as `communityLinks` with all five booleans per
 * selected community. An API older than the web never sees the new key unless the administrator chose
 * a non-default, so a new web against an old API keeps working for every default save.
 */
export function toProductLinksBody(
  selected: readonly PermissionLink[],
  original: ReadonlyMap<string, BuyerPermissions>,
): ProductLinksBody {
  const wouldChange = selected.some(
    (entry) => !sameFlags(entry, original.get(entry.communityId) ?? defaultPermissions()),
  );
  if (!wouldChange) return { communityIds: selected.map((entry) => entry.communityId) };
  return { communityLinks: selected.map(linkOf) };
}
