import { resolveBranding } from '@rede-social/contracts';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { fetchDirectList } from '@/lib/chat';
import { type ConversationsPageView, conversationsPageView, tenantDayKeys } from '@/lib/chat-view';
import { ConversationsList } from './ConversationsList';

/**
 * `/conversas` (CHAT-06, D-719, D-720, D-721, UI-D-862, UI-D-863) [designed]: where the top-bar chat bubble
 * lands a member who may write to other members. A full-screen route under the shipped `PageHeader` ("Conversas",
 * back to `/inicio`), then the list in its own 680px column.
 *
 * **Who may open it is decided by PERMISSION, never by role** (T-11-35): a viewer without the composed
 * `chat.direct` (staff, a member while `social` is off, a tenant without the chat module) gets the not-found
 * screen before anything is read, and the API refuses every direct read without it anyway. The data stays when
 * `social` is turned off and returns when it is turned back on (D-483).
 *
 * The page reads ONE `GET /v1/chat/direct` (page 1, with the pinned support summary). The API answers the caller's
 * own conversations only and already omits a conversation whose other member the administrator blocked or whose
 * membership was removed (D-721), so the screen draws exactly what it receives. An API 404 is the not-found
 * screen; a transport failure becomes the list's own error card (the support row is NOT drawn from a failed
 * read); only a refusal `bootstrapRedirectPath` knows is a navigation, performed outside the try (Next 16 throws
 * from `redirect()` and `notFound()`). Every time label is formatted here in the tenant zone from ONE
 * `Date.now()` (UI-D-14).
 */
export default async function ConversationsPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('chat')]);
  if (!bootstrap.permissions.includes(CHAT_PERMISSIONS.direct)) notFound();

  const { tenant } = bootstrap;
  let path: string | null = null;
  let missing = false;
  let initial: ConversationsPageView | null = null;
  try {
    const answer = await fetchDirectList({ cursor: null });
    const keys = tenantDayKeys(Date.now(), tenant.timezone);
    initial = conversationsPageView(answer, {
      tenant: tenant.displayName,
      timeZone: tenant.timezone,
      keys,
      t,
    });
  } catch (error) {
    if (error instanceof ApiClientError) {
      path = bootstrapRedirectPath(error);
      missing = path === null && error.status === 404;
    }
    if (!path && !missing) {
      console.error('chat.direct_list_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
    }
  }
  if (path) redirect(path);
  if (missing) notFound();

  return (
    <div data-conversations-page>
      <PageHeader
        title={t('conversations.title')}
        backHref="/inicio"
        backLabel={t('member.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <ConversationsList
        initial={initial}
        tenantName={tenant.displayName}
        logoUrl={resolveBranding(tenant.branding).logoUrl}
      />
    </div>
  );
}
