import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The thread header (UI-D-258, sketch 007 surface 6) [designed]: the bar where a messenger shows the
 * contact, holding the ORGANISATION's identity instead (D-222). The `PageHeader` geometry: a 44×44
 * back control, then the leading identity, then the one `<h1>` 16/700 that truncates.
 *
 * Member variant (07-09): `logo` is the host's `TenantLogo size="thread"` (a 64px-capped, contained box
 * that renders nothing without a logo or when the image fails) and `title` is "Equipe {tenant}". There
 * is no subtitle, no status and no staff avatar: a member never sees who of the team is typing.
 *
 * Staff variant (07-10, reserved): `{ avatar, name, profileHref, profileLabel }` replaces the logo and
 * the plain title with ONE link to the member's profile. It is added there, beside this one, so the two
 * headers keep the same bar.
 *
 * It sits at the top of the thread's fixed-height column (UI-D-261), which never scrolls, so the bar
 * does not need to be sticky. A plain `<a>`, not `next/link`: a module package does not depend on the
 * web framework (MOD-02). Props-only: no words.
 */
export interface ThreadHeaderProps {
  /** The leading identity: the tenant logo (member view). `null` renders the title alone. */
  logo: ReactNode;
  title: string;
  backHref: string;
  backLabel: string;
}

const backClasses =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function ThreadHeader({ logo, title, backHref, backLabel }: ThreadHeaderProps) {
  return (
    <header
      data-thread-header
      className="z-10 flex shrink-0 items-center gap-2 border-b border-border bg-bg/95 px-2 py-2 backdrop-blur-sm"
    >
      <a href={backHref} aria-label={backLabel} className={backClasses}>
        <ChevronLeft aria-hidden size={28} />
      </a>
      {logo}
      <h1 className="min-w-0 flex-1 truncate text-base font-bold text-text">{title}</h1>
    </header>
  );
}
