import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadModerationLog } from '@/lib/moderation';
import {
  type ModerationLogTranslator,
  moderationLogLabels,
  parseModerationAction,
  toModerationLogView,
} from '@/lib/moderation-view';
import { getHostTenant } from '@/lib/tenant-host';
import { ModerationLog } from './ModerationLog';

/**
 * `/configuracoes/moderacao` (MODER-03, D-337, D-339, UI-D-277) — the tenant's moderation history.
 *
 * **`notFound()`, never a 403 screen** (UI-D-270, the `/configuracoes/midia` posture): without
 * `moderation.manage` in `bootstrap.permissions` — the SAME composed value the API's
 * `requirePermission` reads — and on the platform host, this route answers the app's not-found page,
 * so a member who types the URL never learns the screen exists. The API re-checks the permission on
 * the read itself (403 → `notFound()` in `loadModerationLog`).
 *
 * READ-ONLY by design: rows are not links and carry no action; there is no export, edit or delete
 * anywhere on the screen, and the permanence line says so out loud.
 *
 * 08-03 (D-337, UI-D-277): the action chips bound to `?acao=` (the API's own action values; an
 * unknown value reads as "Tudo"), keyset paging through `InfiniteScroll`, pull to refresh, and the
 * empty, filtered-empty and error states live in `ModerationLog`. This server component reads page 1
 * for the URL's filter and formats it with the SAME builder the load-more action uses.
 */
export default async function ModerationLogPage({
  searchParams,
}: {
  searchParams: Promise<{ acao?: string | string[] }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage)) notFound();

  const acao = parseModerationAction((await searchParams).acao);
  const [t, page] = await Promise.all([
    getTranslations('moderation.log'),
    loadModerationLog(acao === null ? {} : { action: acao }),
  ]);

  const labels = moderationLogLabels(t as unknown as ModerationLogTranslator);
  const timezone = bootstrap.tenant.timezone;
  const items = page?.items.map((entry) => toModerationLogView(entry, { timezone, labels })) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <ModerationLog
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        acao={acao}
        initialError={page === null}
      />
    </div>
  );
}
