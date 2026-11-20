import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { fetchReports, reportQueueRow } from '@/lib/reports';
import { parseReportEstado } from '@/lib/reports-view';
import { getHostTenant } from '@/lib/tenant-host';
import { ReportsQueue } from './ReportsQueue';

/**
 * `/configuracoes/denuncias` (MODER-04, MODER-05, D-616, D-731, UI-D-637, UI-D-873) — the administrator's queue of
 * reported posts, comments, stories, story comments, communities and direct messages.
 *
 * **`notFound()`, never a 403 screen** (UI-D-270, the `/configuracoes/moderacao` posture): without
 * `moderation.manage` in `bootstrap.permissions` (the SAME composed value the API's `requirePermission` reads) and on
 * the platform host, this route answers the app's not-found page at ZERO API cost, so a member who types the URL never
 * learns the screen exists. The API re-checks the permission on the list itself (a 403 reads as a failed first page).
 *
 * `?estado=` is parsed by the closed list of `parseReportEstado` (an unknown value is "Abertas"). Page 1 is read here
 * and finished with the SAME builder the load-more action uses (`reportQueueRow`), so the rows never differ by page.
 * Nothing on this page notifies the author, the reporter or the reported member.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string | string[] }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage)) notFound();

  const estado = parseReportEstado((await searchParams).estado);
  const [ts, tm, ta, page] = await Promise.all([
    getTranslations('safety'),
    getTranslations('moderation'),
    getTranslations('app'),
    fetchReports({ estado }).catch((error: unknown) => {
      console.error('reports.queue.first_page_failed', { error: String(error) });
      return null;
    }),
  ]);

  const timeZone = bootstrap.tenant.timezone;
  const items = page?.items.map((item) => reportQueueRow(item, { timeZone, ts, tm })) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={ts('queue.title')}
        backHref="/configuracoes"
        backLabel={ta('settings.back')}
        className="md:static md:px-0"
      />
      <ReportsQueue
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        estado={estado}
        initialError={page === null}
        tenantName={bootstrap.tenant.displayName}
      />
    </div>
  );
}
