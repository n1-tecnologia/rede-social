import type { ReactNode } from 'react';
import { cn } from '../cn';

/**
 * The administrator's mark beside a name (2026-10-06). The REINE prototype's king crown is the
 * default; the administrator may pick another of the same family on "Editar perfil". Every glyph is
 * SOLID on the crown's own 24px grid, so any of them reads at the crown's weight at 16 and 20px.
 * Ids are ASCII; their names live in the host's catalog (`profile.edit.adminIcon.names`).
 */
export const ADMIN_ICONS = [
  'crown',
  'star',
  'gem',
  'seal',
  'shield',
  'trophy',
  'medal',
  'bolt',
  'flame',
  'heart',
] as const;
export type AdminIconId = (typeof ADMIN_ICONS)[number];
export const DEFAULT_ADMIN_ICON: AdminIconId = 'crown';

export const isAdminIcon = (value: unknown): value is AdminIconId =>
  typeof value === 'string' && (ADMIN_ICONS as readonly string[]).includes(value);

const GLYPHS: Record<AdminIconId, ReactNode> = {
  crown: (
    <>
      <path d="M4 17H20V19C20 19.5 19.5 20 19 20H5C4.5 20 4 19.5 4 19V17Z" />
      <path d="M4 17L2 8L6.5 13L9 6L12 10L15 6L17.5 13L22 8L20 17H4Z" />
      <rect x="11.25" y="3" width="1.5" height="4" rx="0.5" />
      <rect x="10" y="4.25" width="4" height="1.5" rx="0.5" />
    </>
  ),
  star: (
    <path d="M12 2.3L14.7 9.18L22.08 9.62L16.37 14.32L18.23 21.48L12 17.5L5.77 21.48L7.63 14.32L1.92 9.62L9.3 9.18Z" />
  ),
  gem: (
    <>
      <path d="M6.6 3.5H17.4L21.6 9H2.4L6.6 3.5Z" />
      <path d="M2.4 10.6H21.6L12 21.5L2.4 10.6Z" />
    </>
  ),
  seal: (
    <path
      fillRule="evenodd"
      d="M12 1.6L14.23 3.69L17.2 2.99L18.08 5.92L21.01 6.8L20.31 9.77L22.4 12L20.31 14.23L21.01 17.2L18.08 18.08L17.2 21.01L14.23 20.31L12 22.4L9.77 20.31L6.8 21.01L5.92 18.08L2.99 17.2L3.69 14.23L1.6 12L3.69 9.77L2.99 6.8L5.92 5.92L6.8 2.99L9.77 3.69ZM7.4 12.3L9 10.7L10.9 12.6L15.1 8.4L16.7 10L10.9 15.8Z"
    />
  ),
  shield: (
    <path d="M12 2.2L20 5.2V11.2C20 16.1 16.7 20.2 12 21.8C7.3 20.2 4 16.1 4 11.2V5.2L12 2.2Z" />
  ),
  trophy: (
    <>
      <path d="M6.5 3H17.5V9.5C17.5 12.5 15 15 12 15C9 15 6.5 12.5 6.5 9.5V3Z" />
      <path
        d="M6.5 5H3.8V7.2C3.8 9.3 5.3 11 7.3 11.2M17.5 5H20.2V7.2C20.2 9.3 18.7 11 16.7 11.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.8 14.6H13.2V18H10.8Z" />
      <path d="M7.5 18H16.5V20.6C16.5 21 16.2 21.3 15.8 21.3H8.2C7.8 21.3 7.5 21 7.5 20.6V18Z" />
    </>
  ),
  medal: (
    <>
      <path d="M6.2 2H10.4L13.2 8.6L10.2 10.4L6.2 2Z" />
      <path d="M17.8 2H13.6L10.8 8.6L13.8 10.4L17.8 2Z" />
      <path
        fillRule="evenodd"
        d="M12 9A6.5 6.5 0 1 1 12 22A6.5 6.5 0 1 1 12 9ZM12 12.1L12.88 14.29L15.23 14.45L13.43 15.96L14 18.25L12 17L10 18.25L10.57 15.96L8.77 14.45L11.12 14.29Z"
      />
    </>
  ),
  bolt: <path d="M13.6 2L4.6 13.6H11.2L10.2 22L19.4 10.2H12.8L13.6 2Z" />,
  flame: (
    <path d="M12.5 2C13.5 5.5 18.5 8.5 18.5 14.2C18.5 18.6 15.6 22 12 22C8.4 22 5.5 18.9 5.5 15C5.5 12.1 7 10 8.6 8.6C8.7 10.8 9.6 12.3 11 12.9C10.6 9.2 11.4 5.2 12.5 2Z" />
  ),
  heart: (
    <path d="M12 21C12 21 3 15.5 3 9.2C3 6.3 5.2 4 8 4C9.7 4 11.2 4.9 12 6.2C12.8 4.9 14.3 4 16 4C18.8 4 21 6.3 21 9.2C21 15.5 12 21 12 21Z" />
  ),
};

/** The glyph alone, decorative (`aria-hidden`): the picker's tiles and `AdminBadge` draw it. */
export function AdminIconGlyph({ icon, size = 16 }: { icon: AdminIconId; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      data-admin-icon={icon}
    >
      {GLYPHS[icon]}
    </svg>
  );
}

export interface AdminBadgeProps {
  /** Accessible name ("Administrador"): the mark says something the name beside it does not. */
  label: string;
  /** The administrator's pick; absent or unknown draws the crown. */
  icon?: AdminIconId | null;
  /** Glyph size in px (16 beside a post author, 20 beside a profile's name). */
  size?: number;
  className?: string;
}

/**
 * The mark beside an administrator's name, in the tenant's SECONDARY colour (2026-10-06, product
 * request). Never a decoration only: it carries `label` as its name, whatever glyph it draws.
 */
export function AdminBadge({ label, icon, size = 16, className }: AdminBadgeProps) {
  const glyph = isAdminIcon(icon) ? icon : DEFAULT_ADMIN_ICON;
  return (
    <span
      role="img"
      aria-label={label}
      data-admin-badge={glyph}
      className={cn('inline-flex shrink-0 items-center text-brand-secondary', className)}
    >
      <AdminIconGlyph icon={glyph} size={size} />
    </span>
  );
}
