import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { AdminBadge, type AdminIconId, Avatar } from '@rede-social/ui';
import { MediaImage } from '@/components/media/MediaImage';
import type { InstagramLink } from '@/lib/profile-instagram';

export interface ProfileHeaderProps {
  displayName: string;
  /** The member's photo asset, or `null` — the neutral `Avatar` icon is the whole fallback (R-09). */
  avatarAssetId: string | null;
  /** The bio's VISIBLE text: the page has already split the Instagram line out of it. */
  bio: string | null;
  /**
   * 2026-10-09: the member's Instagram (`instagramLinkView`), a link under the name; absent or
   * `null`, no line.
   */
  instagram?: InstagramLink | null;
  /** Rendered ONLY on the owner's own screen; a member never sees another member's e-mail (D-45/D-46). */
  email?: string;
  /**
   * `1` when this header carries the screen's ONLY heading — `/membros/[membershipId]`, whose
   * `PageHeader` deliberately has no title (UI-SPEC §Member profile). `/perfil` keeps the default
   * `2`, because there the page's own screen-reader h1 "Perfil" heads the screen (a tab page, with
   * no `PageHeader` since 2026-10-09).
   */
  headingLevel?: 1 | 2;
  /**
   * 2026-10-06: the member is an administrator, and this is the mark's accessible name; the mark
   * sits after the name (the REINE prototype's badge). Only `/perfil` knows it (the viewer's own
   * role); another member's role is not on the wire (D-47), so `/membros/[id]` never passes it.
   */
  adminLabel?: string | null;
  /** The icon the administrator picked on "Editar perfil"; absent draws the crown. */
  adminIcon?: AdminIconId | null;
}

/**
 * The profile header, ported from `reference/frontend-design/components/profile/ProfileHeader.tsx`
 * MINUS website, `FollowButton` and "Mensagem" (D-45: photo, display name and bio only).
 * The prototype's `text-xl` name normalises to the Title role 24/700, and the bio keeps the
 * prototype's centred `max-w-xs` measure.
 *
 * **The prototype's `@handle` came back on 2026-10-09 as the member's Instagram** (`instagram`): a
 * line of the bio (`lib/profile-instagram.ts`) the page splits out and passes as a finished link,
 * under the name and before the e-mail, opening Instagram in a new tab. It is a bare link, never a
 * paragraph, so the screen's paragraphs stay the e-mail and the bio. Props only and synchronous:
 * the platform preview renders this same header from a client component.
 *
 * With no bio the paragraph is NOT rendered at all — no placeholder line, the column simply closes
 * after the name (UI-SPEC E1/empty). The name WRAPS instead of truncating (E1/overflow).
 *
 * The photo goes through `MediaImage` at `w320` (an 80px avatar at 3× DPR) with the avatar ladder's
 * `srcSet`, and falls back to the same neutral `Avatar` as "no photo" when it cannot be fetched.
 */
export function ProfileHeader({
  displayName,
  avatarAssetId,
  bio,
  instagram = null,
  email,
  headingLevel = 2,
  adminLabel = null,
  adminIcon = null,
}: ProfileHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className="flex flex-col items-center gap-3 px-4 pt-6 pb-4 text-center">
      {avatarAssetId ? (
        <MediaImage
          assetId={avatarAssetId}
          widths={PURPOSE_WIDTHS.avatar}
          baseWidth={320}
          alt={displayName}
          sizes="80px"
          eager
          ratio="aspect-square"
          className="h-20 w-20 shrink-0 rounded-full"
          fallback={<Avatar size="xl" alt={displayName} />}
        />
      ) : (
        <Avatar size="xl" alt={displayName} />
      )}

      <div className="flex flex-col items-center gap-1">
        <div className="flex max-w-full items-center justify-center gap-1.5">
          <Heading className="min-w-0 text-2xl font-bold tracking-[-0.02em] break-words text-text">
            {displayName}
          </Heading>
          {adminLabel ? <AdminBadge label={adminLabel} icon={adminIcon} size={20} /> : null}
        </div>
        {instagram ? (
          <a
            href={instagram.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={instagram.ariaLabel}
            data-profile-instagram
            className="max-w-full truncate text-sm font-bold text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {instagram.label}
          </a>
        ) : null}
        {email ? <p className="text-sm text-text-secondary">{email}</p> : null}
      </div>

      {bio ? (
        <p className="max-w-xs break-words text-center text-sm leading-relaxed text-text-secondary">
          {bio}
        </p>
      ) : null}
    </div>
  );
}
