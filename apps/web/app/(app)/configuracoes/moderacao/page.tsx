import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { Card, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ModerationLogRow } from '@/components/admin/ModerationLogRow';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadModerationLog } from '@/lib/moderation';
import { type ModerationLogLabels, toModerationLogView } from '@/lib/moderation-view';
import { getHostTenant } from '@/lib/tenant-host';

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
 * 08-01 renders page 1 (tracer depth). The action chips, keyset paging with `InfiniteScroll` and pull
 * to refresh are 08-03's.
 */
export default async function ModerationLogPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage)) notFound();

  const [t, page] = await Promise.all([getTranslations('moderation.log'), loadModerationLog()]);

  // `raw`: templates whose `{…}` slots the pure view fills (the names, the roles, the date).
  const labels: ModerationLogLabels = {
    rows: {
      commentRemoved: t.raw('rows.commentRemoved'),
      blocked: t.raw('rows.blocked'),
      unblocked: t.raw('rows.unblocked'),
      roleChanged: t.raw('rows.roleChanged'),
    },
    roles: {
      admin_tenant: t('roles.admin_tenant'),
      support_tenant: t('roles.support_tenant'),
      member: t('roles.member'),
    },
    you: t('you'),
    removedMember: t('removedMember'),
    context: { post: t('context.post'), story: t('context.story') },
    excerpt: t.raw('excerpt'),
    reason: t.raw('reason'),
    time: t.raw('time'),
  };
  const timezone = bootstrap.tenant.timezone;

  let body: React.ReactNode;
  if (page === null) {
    body = (
      <EmptyState
        variant="card"
        icon={CircleAlert}
        title={t('errors.title')}
        body={t('errors.generic')}
      />
    );
  } else if (page.items.length === 0) {
    body = (
      <EmptyState
        variant="card"
        icon={ShieldCheck}
        title={t('empty.title')}
        body={t('empty.body')}
      />
    );
  } else {
    body = (
      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        <ol aria-label={t('label')} data-moderation-log>
          {page.items.map((entry) => (
            <ModerationLogRow
              key={entry.id}
              view={toModerationLogView(entry, { timezone, labels })}
            />
          ))}
        </ol>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      {/* `stickyTop="0px"`: the `/configuracoes/midia` reason (the primitive's default offset is
          measured from the scrollport's padding edge and pushes the header down over the page). */}
      <PageHeader
        title={t('title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <p className="px-4 text-xs font-normal text-text-tertiary md:px-0">{t('permanent')}</p>
      {body}
    </div>
  );
}
