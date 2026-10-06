import { type AdminIconId, isAdminIcon } from '@rede-social/ui';

/**
 * The administrator's icon beside their name (2026-10-06, front only).
 *
 * The API has no field for it yet (`docs/pendencias-backend.md`), so the pick lives in a PER-DEVICE
 * cookie, like the theme's `rede_theme` (D-41): `{membershipId}.{icon}`, per origin (one tenant per
 * origin), written by `saveAdminIconAction` and read on the server, so the first HTML already draws
 * the picked icon. It only ever changes how THIS device draws its owner's own name: a post by anyone
 * else keeps the crown, and the membership id in the value stops another account signed in on the
 * same device from inheriting the pick. Never used for authorisation.
 */
export const ADMIN_ICON_COOKIE = 'rede_admin_icon';

export type AdminIconChoice = { membershipId: string; icon: AdminIconId };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatAdminIconChoice(choice: AdminIconChoice): string {
  return `${choice.membershipId.toLowerCase()}.${choice.icon}`;
}

/** The cookie's value back as a choice; anything malformed is `null` (the crown). */
export function parseAdminIconChoice(raw: string | null | undefined): AdminIconChoice | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const membershipId = raw.slice(0, dot);
  const icon = raw.slice(dot + 1);
  return UUID_RE.test(membershipId) && isAdminIcon(icon)
    ? { membershipId: membershipId.toLowerCase(), icon }
    : null;
}

/** The picked icon when `membershipId` is the pick's owner; otherwise `null` (draw the crown). */
export function adminIconFor(
  choice: AdminIconChoice | null,
  membershipId: string,
): AdminIconId | null {
  return choice !== null && choice.membershipId === membershipId.toLowerCase() ? choice.icon : null;
}
