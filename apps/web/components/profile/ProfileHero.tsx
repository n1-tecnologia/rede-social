import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { AdminBadge, type AdminIconId, Avatar, Skeleton } from '@rede-social/ui';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MediaImage } from '@/components/media/MediaImage';
import type { InstagramLink } from '@/lib/profile-instagram';

export interface ProfileHeroProps {
  displayName: string;
  /** The member's photo asset, or `null`: the neutral `Avatar` icon is the whole fallback (R-09). */
  avatarAssetId: string | null;
  /** The bio's VISIBLE text: the page has already split the Instagram line out of it. */
  bio: string | null;
  /** The member's Instagram (`instagramLinkView`), a link under the name; absent or `null`, no line. */
  instagram?: InstagramLink | null;
  /** The owner's own e-mail: only `/perfil` passes it (D-45/D-46). */
  email?: string;
  /** The administrator mark's accessible name (the viewer's OWN role, D-47); absent, no mark. */
  adminLabel?: string | null;
  /** The icon the administrator picked on "Editar perfil"; absent draws the crown. */
  adminIcon?: AdminIconId | null;
  /**
   * The icon links pinned to the band's top-right corner: `ProfileHeroAction`s, or, in the platform
   * preview, plain anchors styled with `PROFILE_HERO_ACTION`. Absent, the band is bare.
   */
  actions?: ReactNode;
  /**
   * The phone's band whatever the window: the platform preview's device, where a `md:` variant would
   * read the PANEL's width and draw the desktop band inside a phone.
   */
  phone?: boolean;
}

/**
 * The 44px glass circle of an icon link over the brand band: the community page's edit pencil
 * (`/comunidades/[id]`), white on `bg-black/40`, so it reads on any tenant gradient. Exported for the
 * platform preview, which draws the same circles as plain anchors.
 */
export const PROFILE_HERO_ACTION =
  'inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40';

export interface ProfileHeroActionProps {
  href: string;
  /** The link's accessible name, from the catalog ("Editar perfil", "Configurações"). */
  label: string;
  icon: LucideIcon;
}

/** One icon link of the hero's corner (`data-profile-action`): the icon is decorative, the label names it. */
export function ProfileHeroAction({ href, label, icon: Icon }: ProfileHeroActionProps) {
  return (
    <Link href={href} aria-label={label} data-profile-action className={PROFILE_HERO_ACTION}>
      <Icon aria-hidden size={20} />
    </Link>
  );
}

/** The band on the phone: 112px, full bleed. */
const BAND_PHONE = 'relative h-28 w-full bg-(image:--brand-gradient)';

/** The band: the phone's, then 144px with rounded corners in the desktop column. */
const BAND = `${BAND_PHONE} md:h-36 md:overflow-hidden md:rounded-2xl`;

/**
 * The avatar's seat, half over the band and centred on it (2026-10-13). `relative` so it paints above
 * the band (both are positioned, the avatar comes later); `flex` so the box is exactly the 96px circle
 * (an inline avatar would add a line box, and the ring would stop being round); the `ring-bg` cuts it
 * out of the band.
 */
const AVATAR_SEAT = 'relative mx-auto -mt-12 flex w-fit rounded-full shadow-lg ring-4 ring-bg';

/**
 * The own-profile hero of `/perfil` (2026-10-12, inspired by the REINE prototype's profile, not a
 * copy of it): the tenant's `--brand-gradient` band with the icon links in its corner (`actions`,
 * "Editar perfil" and "Configurações" since the rows are gone), the 96px avatar overlapping it, and
 * the identity under it: the name (with the administrator mark), the Instagram link, the e-mail and
 * the bio. Since 2026-10-13 the avatar and the identity are CENTRED on the band (the owner's ask). `ProfileHeader` stays as it was for `/membros/[id]`.
 *
 * **The root is a `<div>`, never a `<header>`:** `/perfil` is a tab page with no header bar, and the
 * profile spec asserts `main header` is absent. The actions come FIRST in the DOM, inside the band,
 * so the focus order is the reading order (corner icons, then the Instagram link).
 *
 * **Paragraphs are exactly the e-mail and the bio** (the profile spec counts them inside the hero):
 * the Instagram handle is a bare link, never a `<p>`, and no bio means no paragraph at all, no
 * placeholder line. The name WRAPS instead of truncating (E1/overflow); the bio keeps a 448px
 * measure (`max-w-md`).
 *
 * The photo goes through `MediaImage` exactly like `ProfileHeader`'s: `w320` (a 96px avatar at 3×
 * DPR) with the avatar ladder's `srcSet`, eager (the screen's visual anchor), and the same neutral
 * `Avatar` when it cannot be fetched, named after the person.
 *
 * Props only and synchronous, with no `'use client'`: the page renders it on the server and the
 * platform preview renders it from a client component. It ships no words.
 */
export function ProfileHero({
  displayName,
  avatarAssetId,
  bio,
  instagram = null,
  email,
  adminLabel = null,
  adminIcon = null,
  actions,
  phone = false,
}: ProfileHeroProps) {
  const fallback = <Avatar size="xl" className="h-24 w-24" alt={displayName} />;
  return (
    <div data-profile-hero className="relative">
      <div className={phone ? BAND_PHONE : BAND}>
        {actions ? (
          <div className="absolute top-3 right-3 flex items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div className={AVATAR_SEAT}>
        {avatarAssetId ? (
          <MediaImage
            assetId={avatarAssetId}
            widths={PURPOSE_WIDTHS.avatar}
            baseWidth={320}
            alt={displayName}
            sizes="96px"
            eager
            ratio="aspect-square"
            className="h-24 w-24 shrink-0 rounded-full"
            fallback={fallback}
          />
        ) : (
          fallback
        )}
      </div>

      {/* A centred column: each line is as wide as its text and never wider than the column, so the
          name and the bio wrap (centred line by line) and the Instagram link truncates past it. */}
      <div className="flex flex-col items-center gap-1 px-4 text-center">
        <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
          <h2
            data-profile-name
            className="min-w-0 text-2xl font-bold tracking-[-0.02em] break-words text-text"
          >
            {displayName}
          </h2>
          {adminLabel ? <AdminBadge label={adminLabel} icon={adminIcon} size={20} /> : null}
        </div>
        {instagram ? (
          <a
            href={instagram.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={instagram.ariaLabel}
            data-profile-instagram
            className="block max-w-full truncate text-sm font-bold text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {instagram.label}
          </a>
        ) : null}
        {email ? (
          <p className="max-w-full text-sm break-words text-text-secondary">{email}</p>
        ) : null}
        {bio?.trim() ? (
          <p className="mt-3 max-w-md break-words text-sm leading-relaxed text-text-secondary">
            {bio}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The hero while `/perfil` loads, in its geometry: the band itself (it needs no data, so the brand
 * shows at once and nothing changes colour when the page arrives), the 96px circle in the same seat,
 * and two bars for the name and the e-mail.
 */
export function ProfileHeroSkeleton() {
  return (
    <div aria-busy data-testid="profile-hero-skeleton" className="relative">
      <div aria-hidden className={BAND} />
      <div className={AVATAR_SEAT}>
        <Skeleton variant="circle" className="h-24 w-24" />
      </div>
      <div className="flex flex-col items-center gap-2 px-4">
        <Skeleton variant="text" width={180} className="mt-3 h-7" />
        <Skeleton variant="text" width={140} className="h-4" />
      </div>
    </div>
  );
}
