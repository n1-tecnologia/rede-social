import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { fetchMyCases } from '@/lib/chat';
import { type MyCasesPageView, myCasesPageView, tenantDayKeys } from '@/lib/chat-view';
import { MyCasesList } from './MyCasesList';

/**
 * `/suporte/chamados` (CASE-14, D-803, UI-D-821, A-UI-17) [ported + designed]: "Meus chamados", the member's
 * own cases, reached from the case bar's link (which is hidden when the member has no case at all). The
 * shipped `PageHeader` "Meus chamados" steps back to `/suporte`, then `MyCasesList` draws "Chamado atual"
 * and "Anteriores" with paging, pull-to-refresh and the empty and error states.
 *
 * **Who may open it is decided by permission, never by role** (D-223): a caller without
 * `chat.support.contact` (the chat module is off for the tenant, D-40) gets the not-found screen, and so
 * does a holder of `chat.support`, because staff never own a case (`staff_has_inbox`). A member with no case
 * at all is NOT redirected: a direct visit shows the empty state with "Falar com a equipe" (D-803).
 *
 * The page reads ONE `GET /v1/chat/support/cases` (page 1). The API answers the caller's own cases only, so
 * no other member's case can reach this page; a transport failure becomes the list's own error card, and
 * only a refusal `bootstrapRedirectPath` knows is a navigation (performed outside the try, Next 16 throws
 * from `redirect()`). Every time label is formatted here in the tenant zone from ONE `Date.now()` (UI-D-14).
 */
export default async function MyCasesPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('chat')]);
  const { permissions } = bootstrap;
  if (
    permissions.includes(CHAT_PERMISSIONS.answer) ||
    !permissions.includes(CHAT_PERMISSIONS.contact)
  ) {
    notFound();
  }

  let path: string | null = null;
  let initial: MyCasesPageView | null = null;
  try {
    const page = await fetchMyCases({ cursor: null });
    const keys = tenantDayKeys(Date.now(), bootstrap.tenant.timezone);
    initial = myCasesPageView(page, { timeZone: bootstrap.tenant.timezone, keys, t });
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.my_cases_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);

  return (
    <div data-my-cases-page>
      <PageHeader title={t('mine.title')} backHref="/suporte" backLabel={t('member.back')} />
      <MyCasesList initial={initial} />
    </div>
  );
}
