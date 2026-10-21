import { EmptyState } from '@rede-social/ui';
import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Story não encontrado" — the ONE screen every miss on `/stories/[storyId]` lands on (UI-D-16),
 * the post's `not-found.tsx` restated for stories (2026-10-20).
 *
 * **Why it exists now.** Since the client's FRONT.pdf a story is shared the way a post is
 * (`storyShareUrl`), so its link travels outside the app, and a story deleted after the link was
 * sent is the common way to meet a miss here. Without this file that miss fell through to Next's
 * default 404, in English and outside the app's chrome.
 *
 * **Every cause is the same screen, on purpose** (T-05-35): an unknown id, another tenant's story
 * and a removed one all arrive as `loadStory`'s single `not-found`, because the API answers one
 * indistinguishable bare 404 for all three; any difference here would be an existence oracle over
 * an enumerable uuid space. It takes no props and reads no param, so it can never echo the id it
 * was reached with. The tenant's name in the body is HOST-derived (UI-D-46), byte-identical for
 * every cause, and says nothing about the requested story.
 */
export default async function StoryNotFound() {
  const [t, hostTenant] = await Promise.all([getTranslations('stories'), getHostTenant()]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4 md:px-0">
      <EmptyState
        variant="card"
        icon={FileQuestion}
        title={t('notFound.title')}
        body={t('notFound.body', { tenant: tenantDisplayName(hostTenant) })}
        action={
          <a
            href="/inicio"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
