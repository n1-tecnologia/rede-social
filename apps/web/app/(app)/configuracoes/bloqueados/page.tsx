import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadMoreBlocked, unblockBlocked } from '@/components/feed/safety-actions';
import { blockedMemberView, fetchBlocks } from '@/lib/blocks';
import { requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';
import { BlockedList } from './BlockedList';

/**
 * `/configuracoes/bloqueados` (CHAT-07, D-723, D-724, UI-D-635): the members the viewer blocked, each with an
 * outline "Desbloquear". A server component reading page 1 of the CALLER's own blocks (the API lists nobody
 * else's, and nobody else can read that a block exists, T-11-03); the rows arrive finished and `BlockedList` keeps
 * the paging and the unblock.
 *
 * `notFound()` on the platform host, the `/configuracoes/moderacao` posture: the platform host has no members
 * area and no blocks, so the route answers the app's not-found page rather than an empty list.
 *
 * Unblocking restores only the content filter (D-724): no follow comes back, and nothing here says otherwise.
 */
export default async function BlockedPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();
  await requireBootstrap();

  const [t, ta, page] = await Promise.all([
    getTranslations('safety.blocked'),
    getTranslations('app'),
    fetchBlocks().catch((error: unknown) => {
      console.error('safety.blocked.first_page_failed', { error: String(error) });
      return null;
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('title')}
        backHref="/configuracoes"
        backLabel={ta('settings.back')}
        className="md:static md:px-0"
      />
      <BlockedList
        initialItems={page?.items.map(blockedMemberView) ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        unblockAction={unblockBlocked}
        loadMoreAction={loadMoreBlocked}
      />
    </div>
  );
}
