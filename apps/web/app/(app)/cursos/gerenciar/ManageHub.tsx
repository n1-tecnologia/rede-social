import { iconFor } from '@rede-social/core/ui';
import { Skeleton } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { getManagementTotals } from '@/lib/courses';
import { manageCardsView } from '@/lib/courses-manage-view';
import { ScreenHeader } from '../ScreenHeader';

const CARD =
  'flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-card-hover active:bg-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const SKELETON_CARDS = [0, 1, 2, 3];

/** The cards' placeholder, at their final geometry (four 112px cards). */
export function ManageCardsSkeleton() {
  return (
    <div aria-busy className="grid grid-cols-1 gap-3 px-4 lg:grid-cols-2">
      {SKELETON_CARDS.map((index) => (
        <Skeleton key={index} variant="rect" className="h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** The four cards, from the manager's own lists (`getManagementTotals`), worded by the view. */
async function ManageCards() {
  const [t, totals] = await Promise.all([getTranslations(), getManagementTotals()]);
  const cards = manageCardsView(totals, t as never);
  return (
    <ul data-testid="manage-cards" className="grid grid-cols-1 gap-3 px-4 lg:grid-cols-2">
      {cards.map((card) => {
        const Icon = iconFor(card.icon);
        return (
          <li key={card.key} className="flex">
            <a
              href={card.href}
              data-testid="manage-card"
              data-manage={card.key}
              className={`${CARD} w-full`}
            >
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
              >
                <Icon size={19} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-bold text-text">{card.title}</span>
                {card.meta ? (
                  <span
                    data-testid="manage-card-meta"
                    className="mt-0.5 text-[11px] font-medium text-text-tertiary tabular-nums"
                  >
                    {card.meta}
                  </span>
                ) : null}
                <span className="mt-1.5 text-xs leading-snug text-text-secondary">{card.body}</span>
              </span>
              <ChevronRight aria-hidden size={16} className="mt-2.5 shrink-0 text-text-tertiary" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 2026-10-23 — "Gerenciar" (`/cursos/gerenciar`), the social-igoralves reference's management hub and
 * the manager's ONE door to authoring: the last row of the courses area's menu leads here, and every
 * management list leads back ("‹ Gerenciar"). The h1 "Gerenciar" with its supporting line, then one
 * card per kind of content (Cursos, Trilhas, Lives, Categorias): the tinted icon, the title, the
 * counts line from the manager's own lists and the sentence of what is edited there. The reference's
 * "Suas edições" (its in-place editor's undo) has no counterpart here and is not drawn.
 *
 * The cards stream in their own `Suspense` (the totals walk the lists); the header never waits.
 * Desktop: a WIDE page (2026-10-23, `data-shell-wide`: the shell lifts its 680px column to 1280px),
 * the four cards two by two from `lg`, each as tall as its row.
 */
export async function ManageHub() {
  const t = await getTranslations();
  return (
    <div data-testid="manage-hub" data-shell-wide className="mx-auto flex w-full flex-col pb-6">
      <ScreenHeader title={t('courses.manage.title')} subtitle={t('courses.manage.subtitle')} />
      <Suspense fallback={<ManageCardsSkeleton />}>
        <ManageCards />
      </Suspense>
    </div>
  );
}
