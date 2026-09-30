import { Skeleton } from '@rede-social/ui';
import { Send } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * `/suporte/[conversationId]` loading (UI-D-265, UI E12/loading): the staff thread's own fixed-height
 * column, drawn in the right pane of the split from `lg` (the inbox list beside it never blanks) and
 * as the whole screen below `lg`. The header bar holds the back control, the 32px avatar and the name
 * bar (the real header is server-rendered with the member's name and avatar a beat later), then 4
 * alternating bubble skeletons (60% / 40%) and the composer drawn DISABLED, so the swap to the thread
 * does not move the field.
 *
 * The composer is redrawn in `ChatComposer`'s geometry rather than rendered: it is a client component
 * whose callbacks a server boundary cannot pass (the member `loading.tsx` rule).
 */
const BUBBLES = [
  { key: 'a', side: 'self-start', width: '60%' },
  { key: 'b', side: 'self-end', width: '40%' },
  { key: 'c', side: 'self-start', width: '40%' },
  { key: 'd', side: 'self-end', width: '60%' },
] as const;

export default async function StaffThreadLoading() {
  const t = await getTranslations('chat');
  return (
    <div
      aria-busy
      data-chat-thread-loading
      className="flex h-[calc(var(--screen-h)-var(--safe-top)-3.5rem-var(--safe-bottom)-5.25rem)] flex-col md:h-[calc(var(--screen-h)-7rem)] lg:h-full lg:min-h-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg/95 px-2 py-2">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton variant="circle" className="h-8 w-8" />
        <Skeleton variant="text" width={140} className="h-4" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 px-4 py-4">
        {BUBBLES.map((bubble) => (
          <Skeleton
            key={bubble.key}
            variant="rect"
            width={bubble.width}
            className={`h-10 rounded-2xl ${bubble.side}`}
          />
        ))}
      </div>
      <div data-chat-composer className="border-t border-border bg-bg-secondary px-4 py-2">
        <div className="flex items-end gap-2">
          <textarea
            disabled
            rows={1}
            aria-label={t('composer.label')}
            placeholder={t('composer.placeholder')}
            className="min-w-0 flex-1 resize-none rounded-2xl border border-border bg-bg-input px-4 py-2 text-base text-text placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            disabled
            aria-label={t('composer.send')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand disabled:opacity-50"
          >
            <Send aria-hidden size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
