import { PURPOSE_WIDTHS } from '@tria/contracts/media';
import { Avatar } from '@tria/ui';
import { MediaImage } from '@/components/media/MediaImage';

export interface ProfileHeaderProps {
  displayName: string;
  /** The member's photo asset, or `null` — the neutral `Avatar` icon is the whole fallback (R-09). */
  avatarAssetId: string | null;
  bio: string | null;
  /** Rendered ONLY on the owner's own screen; a member never sees another member's e-mail (D-45/D-46). */
  email?: string;
}

/**
 * The profile header, ported from `reference/frontend-design/components/profile/ProfileHeader.tsx`
 * MINUS `@handle`, website, `FollowButton` and "Mensagem" (D-45: photo, display name and bio only).
 * The prototype's `text-xl` name normalises to the Title role 24/700, and the bio keeps the
 * prototype's centred `max-w-xs` measure.
 *
 * With no bio the paragraph is NOT rendered at all — no placeholder line, the column simply closes
 * after the name (UI-SPEC E1/empty). The name WRAPS instead of truncating (E1/overflow).
 *
 * The photo goes through `MediaImage` at `w320` (an 80px avatar at 3× DPR) with the avatar ladder's
 * `srcSet`, and falls back to the same neutral `Avatar` as "no photo" when it cannot be fetched.
 */
export function ProfileHeader({ displayName, avatarAssetId, bio, email }: ProfileHeaderProps) {
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
        <h2 className="text-2xl font-bold tracking-[-0.02em] break-words text-text">
          {displayName}
        </h2>
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
