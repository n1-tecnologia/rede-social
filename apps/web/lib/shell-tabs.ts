import { buildNav, type ShellNav, withTabOverrides } from '@rede-social/core/ui';
import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import type { getTranslations } from 'next-intl/server';
import type { requireBootstrap } from '@/lib/bootstrap';
import { memberAreaTabOverrides } from '@/lib/member-area';
import { moduleLabelResolver } from '@/lib/registry';

type Translator = Awaited<ReturnType<typeof getTranslations>>;
type Bootstrap = Awaited<ReturnType<typeof requireBootstrap>>;

/**
 * The TopBar slots the shell lifts out of the bar: the Loja, under Principal on the desktop rail
 * (2026-10-23) and the last tab of the phone's bottom bar (2026-10-28).
 */
export const MAIN_SLOTS = ['store'] as const;

/**
 * The shell's tabs and slots for this caller (2026-10-28, shared by the tenant layout and Marca's
 * phone bar order, so both read the same bar). The manifest nav is role-blind (one Cursos entry for
 * everyone), so the host decides per request, as with dots and areas: a caller without
 * `courses.manage` (member, support_tenant) gets the Membros tab pointing at the member area; an
 * admin keeps Cursos -> the hub (also current while previewing the member area, 2026-10-22).
 */
export function shellTabs(
  bootstrap: Pick<Bootstrap, 'modules' | 'permissions'>,
  labels: { home: string; profile: string; memberNav: string },
  tRoot: Translator,
): ShellNav {
  return withTabOverrides(
    buildNav(bootstrap.modules, {
      home: labels.home,
      profile: labels.profile,
      module: moduleLabelResolver(tRoot),
    }),
    memberAreaTabOverrides({
      canManage: bootstrap.permissions.includes(COURSE_PERMISSIONS.manage),
      label: labels.memberNav,
    }),
  );
}
