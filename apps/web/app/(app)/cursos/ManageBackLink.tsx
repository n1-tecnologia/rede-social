import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MANAGE_PATH } from '@/lib/member-area';

/**
 * 2026-10-23 — "‹ Gerenciar" above a management list's title (the social-igoralves reference's
 * admin lists): the way back to the hub every list is reached from, passed to `ScreenHeader`'s
 * `back`. A plain link with a 44px hit area, the label quiet (13/600 secondary, the reference's) so
 * the screen's h1 stays the first thing read. Synchronous (`useTranslations`), so the server lists
 * and the client category manager draw the same link.
 */
export function ManageBackLink() {
  const t = useTranslations('courses.manage');
  return (
    <a
      href={MANAGE_PATH}
      aria-label={t('backAria')}
      data-testid="manage-back"
      className="inline-flex min-h-11 items-center gap-1 rounded-md pr-3 text-[13px] font-semibold text-text-secondary transition-colors hover:text-text active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <ChevronLeft aria-hidden size={18} />
      <span>{t('back')}</span>
    </a>
  );
}
