import { ThreadHeader } from '@rede-social/module-chat/ui';
import { PageHeader } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { DirectOtherView } from '@/lib/chat-view';

/**
 * The direct conversation's fixed-height column (11-22, UI-D-864, UI-D-261): the member page's heights on the
 * phone and the `md` rail, the same single column up to 680px on desktop (no split beside it), so only the
 * message scroller scrolls. Both routes (`/conversas/com/{membershipId}` and `/conversas/{conversationId}`) draw
 * it, so the lazy start and the open thread can never disagree about the frame.
 *
 * The header is the STAFF variant of the shipped `ThreadHeader` with the other member as the contact (D-864):
 * ONE link to `/membros/{membershipId}` holding the 32px avatar and the name `<h1>`, the back control to
 * `/conversas`. A departed account has the neutral avatar, "Membro removido" and NO link (`profileHref` is
 * `null`). There is no case bar, opener, category, priority, history or "Meus chamados" link (D-800): a direct
 * conversation has no case. When the contact is unknown (the first read failed) the bar carries only the back
 * control, so the error card below it never invents a name.
 */
const COLUMN =
  'mx-auto flex h-[calc(var(--screen-h)-var(--safe-top)-3.5rem-var(--safe-bottom)-5.25rem)] w-full max-w-[680px] flex-col md:h-[calc(var(--screen-h)-7rem)]';

export async function DirectThreadFrame({
  other,
  children,
}: {
  other: DirectOtherView | null;
  children: ReactNode;
}) {
  const t = await getTranslations('chat');
  return (
    <div data-chat-thread data-direct-thread className={COLUMN}>
      {other ? (
        <ThreadHeader
          backHref="/conversas"
          backLabel={t('staff.back')}
          avatar={other.avatar}
          name={other.name}
          profileHref={other.profileHref}
          profileLabel={t('staff.profile', { name: other.name })}
        />
      ) : (
        <PageHeader
          backHref="/conversas"
          backLabel={t('staff.back')}
          className="shrink-0 border-b border-border md:static"
        />
      )}
      {children}
    </div>
  );
}
