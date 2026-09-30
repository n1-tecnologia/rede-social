import { SectionTitle } from '@rede-social/ui';
import type { ReactNode } from 'react';

export interface NotificationListProps {
  /** The "Novas" heading (catalog), and the rows of the unread section. */
  unreadTitle: string;
  unread: ReactNode[];
  /** The "Anteriores" heading (catalog), and the rows of the read section. */
  readTitle: string;
  read: ReactNode[];
  /** The mark-all control, rendered at the right of the Novas header (UI-D-252). */
  markAll?: ReactNode;
  /** Whatever follows the sections: the `InfiniteScroll` sentinel, the 90-day footer. */
  footer?: ReactNode;
  /** The region's accessible name (catalog: "Notificações de {tenant}"). */
  ariaLabel: string;
}

/**
 * The two sections of `/notificacoes` (D-231, UI-D-250) [proto]: "Novas" (unread) above
 * "Anteriores" (read), each newest first, rows on the page ground with no card and no dividers. A
 * section with no rows is ABSENT, its header included. This component ships no words: the headings,
 * the control and the footer are host-provided.
 */
export function NotificationList({
  unreadTitle,
  unread,
  readTitle,
  read,
  markAll,
  footer,
  ariaLabel,
}: NotificationListProps) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col pb-6">
      {unread.length > 0 ? (
        <div data-testid="notifications-unread">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <SectionTitle variant="group" as="h2">
              {unreadTitle}
            </SectionTitle>
            {markAll}
          </div>
          {unread}
        </div>
      ) : null}
      {read.length > 0 ? (
        <div data-testid="notifications-read">
          <SectionTitle variant="group" as="h2" className="px-4 pt-6 pb-2">
            {readTitle}
          </SectionTitle>
          {read}
        </div>
      ) : null}
      {footer}
    </section>
  );
}
