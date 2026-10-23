import { Hourglass, type LucideIcon, RefreshCw, TriangleAlert } from 'lucide-react';

/**
 * The member-facing "held out" states of a host (09.2-21, UI-D-542, A-UI-8, D-535, D-545): the four of the
 * by-host `status` set that stop a member from using the form or the app. A pure, env-free module, so the
 * pages, the server actions and their tests share ONE table.
 *
 * - `suspended`: a decision about the tenant (D-32). Its screen is the shipped "Comunidade indisponível".
 * - `unavailable`: the project is paused or unreachable. Same screen and same sentence as a suspension, so a
 *   member never learns whether it was a decision or an outage (A-UI-8, PU-3).
 * - `updating` / `preparing`: their own screens ("Comunidade em atualização" / "em preparação").
 *
 * `active` (and anything unknown, or no tenant at all) is NOT held: `heldOf` answers `null`.
 */
export type Held = 'suspended' | 'unavailable' | 'updating' | 'preparing';

/** The catalog namespace whose `title` / `body` a held state shows. */
export type HeldNamespace = 'unavailable' | 'updating' | 'preparing';

export function heldOf(status: string | null | undefined): Held | null {
  switch (status) {
    case 'suspended':
    case 'unavailable':
    case 'updating':
    case 'preparing':
      return status;
    default:
      return null;
  }
}

/** The public screen a held state lands on. None of them clears a cookie: that is `/auth/suspended` alone. */
export function heldPath(held: Held): string {
  switch (held) {
    case 'updating':
      return '/comunidade-em-atualizacao';
    case 'preparing':
      return '/comunidade-em-preparacao';
    default:
      return '/comunidade-indisponivel';
  }
}

export function heldNamespace(held: Held): HeldNamespace {
  return held === 'updating' || held === 'preparing' ? held : 'unavailable';
}

/** The glyph of the card: the state's own for the two dedicated screens, the shipped triangle otherwise. */
export function heldIcon(held: Held): LucideIcon {
  if (held === 'updating') return RefreshCw;
  if (held === 'preparing') return Hourglass;
  return TriangleAlert;
}

/**
 * The 503 codes a tenant-lane or slug route answers for a tenant that is not ready (plan 08, plan 11), for
 * the one place the web has no host status to read: a sign-up on a GENERIC host, which is told by the API.
 */
export function heldOfCode(code: string | null | undefined): Held | null {
  switch (code) {
    case 'TENANT_UPDATING':
      return 'updating';
    case 'TENANT_PREPARING':
      return 'preparing';
    case 'TENANT_UNAVAILABLE':
      return 'unavailable';
    default:
      return null;
  }
}
