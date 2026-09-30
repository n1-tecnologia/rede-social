import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { getInbox } from '@/lib/chat';
import { inboxRowView, tenantDayKeys } from '@/lib/chat-view';
import { InboxSkeleton, SupportInbox } from './SupportInbox';
import { SupportSplit } from './SupportSplit';

/**
 * The shared `/suporte` segment (07-10, UI-D-264, planning decision 1). It decides by PERMISSION,
 * never by role (D-223, D-224):
 *
 * - a caller WITHOUT `chat.support` (a member holding `chat.support.contact`, or chat is off) gets
 *   `children` unchanged: 07-09's member thread, untouched;
 * - a holder of `chat.support` (`support_tenant` or `admin_tenant`) gets `SupportSplit`: the inbox list
 *   rendered ONCE here, so it persists across every `/suporte/{id}` navigation, beside `children` (the
 *   idle pane or the staff thread).
 *
 * The API re-enforces every gate (`requirePermission('chat.support')` on the inbox, participant/staff
 * policies on the threads, T-07-66); this only chooses what to draw.
 *
 * Page 1 of the inbox streams in its own Suspense boundary with the 72px row skeletons, so the right
 * pane (the thread or the idle pane) renders on its own and never waits for the list, and the list
 * never blanks for the thread (UI E13/loading). Every row is formatted here in the tenant zone from
 * ONE `Date.now()` (UI-D-262).
 */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(CHAT_PERMISSIONS.answer)) return children;

  return (
    <SupportSplit
      list={
        <Suspense fallback={<InboxSkeleton count={6} />}>
          <InboxFirstPage tenantId={bootstrap.tenant.id} timeZone={bootstrap.tenant.timezone} />
        </Suspense>
      }
    >
      {children}
    </SupportSplit>
  );
}

async function InboxFirstPage({ tenantId, timeZone }: { tenantId: string; timeZone: string }) {
  const [t, page] = await Promise.all([getTranslations('chat'), getInbox({ cursor: null })]);
  const keys = tenantDayKeys(Date.now(), timeZone);
  return (
    <SupportInbox
      tenantId={tenantId}
      initialItems={(page?.items ?? []).map((row) => inboxRowView(row, { timeZone, keys, t }))}
      initialCursor={page?.nextCursor ?? null}
      initialError={page === null}
    />
  );
}
