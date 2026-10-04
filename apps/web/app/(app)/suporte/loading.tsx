import { Skeleton } from '@rede-social/ui';
import { Send } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * `/suporte` loading (UI-D-265, UI E09/loading): the thread's own fixed-height column with the header
 * bar, 4 alternating bubble skeletons (60% / 40%, the other side then the own side) and the composer
 * rendered and DISABLED, so the swap to the thread does not move the field under the member's thumb.
 *
 * The composer is redrawn in `ChatComposer`'s geometry rather than rendered: it is a client component
 * whose callbacks a server boundary cannot pass, and an inert field needs none of them.
 */
const BUBBLES = [
  { key: 'a', side: 'self-start', width: '60%' },
  { key: 'b', side: 'self-end', width: '40%' },
  { key: 'c', side: 'self-start', width: '40%' },
  { key: 'd', side: 'self-end', width: '60%' },
] as const;

export default async function SupportLoading() {
  const t = await getTranslations('chat');
  return (
    <div
      aria-busy
      className="flex h-[calc(var(--screen-h)-var(--safe-top)-3.5rem-var(--safe-bottom)-5.25rem)] flex-col md:h-[calc(var(--screen-h)-7rem)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg/95 px-2 py-2">
        <Skeleton variant="circle" className="h-11 w-11" />
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
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-button bg-(image:--button-image) text-on-button disabled:opacity-50"
          >
            <Send aria-hidden size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
