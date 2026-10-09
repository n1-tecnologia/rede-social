'use client';

import { cn, PageHeader } from '@rede-social/ui';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * The staff side of `/suporte` (UI-D-262, UI-D-264, D-224) [designed]: the inbox list and the
 * conversation, as two routes on a phone and as ONE split card on a desktop.
 *
 * It lives in the shared `/suporte` layout segment, so the list is rendered ONCE and survives every
 * `/suporte/{id}` navigation: a row click swaps only the right pane, and the list keeps its state and
 * its scroll position (no remount).
 *
 * `useSelectedLayoutSegment()` says whether a conversation is open (`null` on `/suporte`, the id on
 * `/suporte/{id}`). The layout is CSS-only, so the server render and hydration agree at every width:
 * - **below `lg`** (the phone and the `md` rail, where the column is too narrow for a 288px list):
 *   the list alone on `/suporte` under the `PageHeader` "Suporte" (back to the previous screen,
 *   `/inicio` when opened directly), the thread alone on `/suporte/{id}`;
 * - **from `lg`** (1024px, the full 680px column): one card at the shell's content height, a 288px
 *   list pane with its own header and its own `overflow-y-auto`, and the right pane `min-w-0` holding
 *   the thread or, on `/suporte`, the idle pane. Only the panes scroll.
 *
 * A resize keeps the URL: at 900px an open `/suporte/{id}` simply shows the thread alone, and back
 * returns to the list (UI E13/partial). No component gains chrome the phone lacks (UI-D-47).
 */
export function SupportSplit({ list, children }: { list: ReactNode; children: ReactNode }) {
  const t = useTranslations('chat');
  const segment = useSelectedLayoutSegment();
  const open = segment !== null;

  return (
    <div
      data-support-split
      className="mx-auto w-full max-w-[680px] lg:grid lg:h-[calc(var(--screen-h)-7rem)] lg:grid-cols-[288px_1fr] lg:overflow-hidden lg:rounded-xl lg:bg-card lg:shadow-[0_1px_3px_rgba(22,35,59,.06)] lg:dark:border lg:dark:border-border"
    >
      <div
        data-support-list
        className={cn(
          open ? 'hidden lg:flex' : 'flex',
          'min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-border',
        )}
      >
        <PageHeader
          title={t('inbox.title')}
          backHref="/inicio"
          backLabel={t('inbox.back')}
          className="md:static md:px-0 lg:hidden"
        />
        <div className="sticky top-0 z-10 hidden shrink-0 border-b border-border bg-card px-4 py-3 lg:block">
          <h1 className="truncate text-base font-bold text-text">{t('inbox.title')}</h1>
        </div>
        {list}
      </div>
      <div
        data-support-pane
        className={cn(open ? 'flex' : 'hidden lg:flex', 'min-w-0 flex-col lg:min-h-0')}
      >
        {children}
      </div>
    </div>
  );
}
