import { Avatar, BackLink } from '@rede-social/ui';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The thread header (UI-D-258 / UI-D-263, sketch 007 surfaces 6 and "st") [designed]: the bar where a
 * messenger shows the contact. The `PageHeader` geometry: a 44×44 back control, then the leading
 * identity, then the one `<h1>` 16/700 that truncates. ONE component with two leading variants, so
 * both sides of the conversation keep the same bar.
 *
 * - **Member variant** (07-09): `logo` is the host's `TenantLogo size="thread"` (a 64px-capped,
 *   contained box that renders nothing without a logo or when the image fails) and `title` is
 *   "Equipe {tenant}" (D-222). No subtitle, no status and no staff avatar: a member never sees who of
 *   the team is typing.
 * - **Staff variant** (07-10, D-224): `{ avatar, name, profileHref, profileLabel }`. ONE link to the
 *   member's existing profile (`/membros/{membershipId}`), `min-w-0` so a long name truncates instead
 *   of pushing the back control, holding the 32px avatar and the name `<h1>`, and labelled
 *   `profileLabel` ("Ver o perfil de {name}"). There is no side panel. A departed member
 *   (`profileHref: null`) has no profile to open: the neutral avatar and the removed name in tertiary,
 *   with no link.
 *
 * It sits at the top of the thread's fixed-height column (UI-D-261), which never scrolls, so the bar
 * does not need to be sticky. Plain `<a>`s, not `next/link`: a module package does not depend on the
 * web framework (MOD-02). The back control is the shared `BackLink` (2026-10-09), still a plain
 * `<a>`: a tap returns to the screen the member came from, and `backHref` is only the fallback for a
 * direct entry. Props-only: no words.
 */
interface ThreadHeaderBase {
  /** The `BackLink`'s fallback: where back goes when no app screen is behind this one. */
  backHref: string;
  backLabel: string;
}

export interface ThreadHeaderMemberProps extends ThreadHeaderBase {
  /** The leading identity: the tenant logo (member view). `null` renders the title alone. */
  logo: ReactNode;
  title: string;
}

export interface ThreadHeaderStaffProps extends ThreadHeaderBase {
  /** The member's avatar URL; `null` shows the neutral `User` fallback. */
  avatar: string | null;
  name: string;
  /** `/membros/{membershipId}`, or `null` for a departed member (no link, UI-D-263). */
  profileHref: string | null;
  /** The link's accessible name, "Ver o perfil de {name}". */
  profileLabel: string;
}

export type ThreadHeaderProps = ThreadHeaderMemberProps | ThreadHeaderStaffProps;

const backClasses =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const profileClasses =
  'flex min-w-0 items-center gap-2 rounded-xl pr-2 transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

function StaffIdentity({ avatar, name, profileHref, profileLabel }: ThreadHeaderStaffProps) {
  const face = (
    <span aria-hidden className="inline-flex shrink-0">
      <Avatar size="sm" src={profileHref === null ? null : avatar} alt="" />
    </span>
  );
  if (profileHref === null) {
    return (
      <div data-thread-member className="flex min-w-0 flex-1 items-center gap-2">
        {face}
        <h1 className="min-w-0 truncate text-base font-bold text-text-tertiary">{name}</h1>
      </div>
    );
  }
  return (
    <a
      href={profileHref}
      aria-label={profileLabel}
      data-thread-member
      data-thread-profile
      className={profileClasses}
    >
      {face}
      <h1 className="min-w-0 truncate text-base font-bold text-text">{name}</h1>
    </a>
  );
}

export function ThreadHeader(props: ThreadHeaderProps) {
  const { backHref, backLabel } = props;
  return (
    <header
      data-thread-header
      className="z-10 flex shrink-0 items-center gap-2 border-b border-border bg-bg/95 px-2 py-2 backdrop-blur-sm"
    >
      <BackLink href={backHref} aria-label={backLabel} className={backClasses}>
        <ChevronLeft aria-hidden size={28} />
      </BackLink>
      {'name' in props ? (
        <StaffIdentity {...props} />
      ) : (
        <>
          {props.logo}
          <h1 className="min-w-0 flex-1 truncate text-base font-bold text-text">{props.title}</h1>
        </>
      )}
    </header>
  );
}
