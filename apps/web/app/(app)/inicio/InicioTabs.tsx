import { buttonClasses, cn } from '@rede-social/ui';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { HubTabs } from '@/app/(app)/cursos/HubTabs';
import { INICIO_TABS, type InicioTab, inicioTabHref } from './tabs';

/** The destination of "Encontrar pessoas": the member directory (D-466). */
const FIND_HREF = '/membros';

/**
 * The same 44x44 round hit area the shipped `IconButton` draws, as a LINK: `IconButton` is a
 * `<button>`, and `/membros` is a route, so a button inside an anchor (or the reverse) would nest two
 * interactive controls. Visible below 360px only; the labelled button takes over from 360px up.
 */
const FIND_ICON_LINK = cn(
  'relative inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-text transition-colors',
  'hover:bg-bg-hover active:bg-bg-tertiary',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
  'min-[360px]:hidden',
);

const FIND_BUTTON_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  hitArea: true,
  className: 'hidden shrink-0 whitespace-nowrap min-[360px]:inline-flex',
});

export interface InicioTabsProps {
  /** The root translator: every word is the catalog's, never a prop's (UI-D-512). */
  t: (key: string) => string;
  /** The active chip, decided on the server from `?aba=` (`inicioTabFromParam`). */
  tab: InicioTab;
  /**
   * UI-D-492: the trailing "Encontrar pessoas" control, for a viewer holding `social.participate`
   * ONLY. A moderator is outside the follow graph (D-467), so for them it would be a dead end.
   */
  showFind: boolean;
}

/**
 * The Início · Explorar chip row (D-479, UI-D-491, UI-D-492): the shipped `HubTabs` over the
 * `INICIO_TABS` registry (a tablist of LINKS, `aria-label` "Áreas do início") with, when `showFind`,
 * a trailing "Encontrar pessoas" entry to `/membros`: an outline `sm` button with the `UserPlus` glyph
 * from 360px up, a 44x44 icon link with the SAME text as its accessible name below that (two classes
 * toggling at the breakpoint, never a media query in JavaScript).
 *
 * The tabs take the remaining width (`min-w-0 flex-1`), so the two tabs and the 140px control fit the
 * 358px content width of a 390px phone without scrolling the tablist (E01 overflow). The row renders
 * at once and sits OUTSIDE the body's `Suspense`, so changing the tab never moves it (E01 loading).
 * Rendered only for a viewer who may participate or moderate while `social` is effective
 * (`showsInicioTabs`); the caller decides, this component draws.
 */
export function InicioTabs({ t, tab, showFind }: InicioTabsProps) {
  const find = t('social.find.cta');
  return (
    <div className="flex items-center gap-2 px-4 md:px-0">
      <div className="min-w-0 flex-1">
        <HubTabs
          label={t('social.tabs.label')}
          value={tab}
          items={INICIO_TABS.map((item) => ({
            key: item.key,
            label: t(item.labelKey),
            href: inicioTabHref(item.key),
          }))}
        />
      </div>
      {showFind ? (
        <>
          <Link href={FIND_HREF} className={FIND_BUTTON_LINK} data-testid="inicio-find-people">
            <UserPlus aria-hidden size={16} />
            {find}
          </Link>
          <Link
            href={FIND_HREF}
            aria-label={find}
            className={FIND_ICON_LINK}
            data-testid="inicio-find-people-icon"
          >
            <UserPlus aria-hidden size={20} />
          </Link>
        </>
      ) : null}
    </div>
  );
}
