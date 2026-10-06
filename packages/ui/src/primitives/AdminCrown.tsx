import { cn } from '../cn';

export interface AdminCrownProps {
  /** Accessible name ("Administrador"): the crown says something the name beside it does not. */
  label: string;
  /** Glyph size in px (16 beside a post author, 20 beside a profile's name). */
  size?: number;
  className?: string;
}

/**
 * The crown beside an administrator's name (2026-10-06, the REINE prototype's `VerifiedBadge`, its
 * king crown). Painted in the tenant's BUTTON colour (`text-button`), the REINE gold wherever a
 * tenant set one, its primary otherwise. Never a decoration only: it carries `label` as its name.
 */
export function AdminCrown({ label, size = 16, className }: AdminCrownProps) {
  return (
    <span
      role="img"
      aria-label={label}
      data-admin-crown=""
      className={cn('inline-flex shrink-0 items-center text-button', className)}
    >
      <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M4 17H20V19C20 19.5 19.5 20 19 20H5C4.5 20 4 19.5 4 19V17Z" fill="currentColor" />
        <path d="M4 17L2 8L6.5 13L9 6L12 10L15 6L17.5 13L22 8L20 17H4Z" fill="currentColor" />
        <rect x="11.25" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
        <rect x="10" y="4.25" width="4" height="1.5" rx="0.5" fill="currentColor" />
      </svg>
    </span>
  );
}
