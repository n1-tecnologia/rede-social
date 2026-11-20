import { CHAT_PERMISSIONS, type DirectDetail } from '@rede-social/module-chat/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DirectThreadFrame } from '@/components/chat/DirectThreadFrame';
import { DirectThreadError, DirectThreadPane } from '@/components/chat/DirectThreadPane';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { fetchDirectDetail, getMessages } from '@/lib/chat';
import { chatMessageView, directDetailView, tenantDayKeys } from '@/lib/chat-view';

/** A canonical uuid: anything else is the one not-found screen before any request (D-23). */
const CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/conversas/[conversationId]` (CHAT-06, CHAT-07, D-720, D-722, UI-D-864, UI-D-865) [designed]: ONE direct
 * conversation, as its own screen in the 680px column (no split on desktop).
 *
 * **Every miss is ONE screen** (D-23, T-11-02, T-11-06): a caller without the composed `chat.direct` (staff, a
 * member with `social` off, a tenant without the chat module), a malformed id, an unknown id, another tenant's
 * or another pair's conversation, and one the administrator's block or a removal took away all render the
 * not-found screen, so the page never says why. The permission is read from `bootstrap.permissions`, never a
 * role. A transport failure is the thread's error card instead, never dressed up as "not found".
 *
 * The page reads the detail (the contact, the composer enum and the viewer's positions) and the latest page of
 * messages, and finishes them here: the contact through `directOtherView`, the composer strip through
 * `composerStateView` (the closed strip is ONE sentence with no name, no reason, nothing about a block, T-11-03)
 * and every bubble in the tenant zone from ONE `Date.now()` (UI-D-14). The screen draws exactly what the API
 * answered and computes no access, no block and no state of its own.
 *
 * Prefetch-safe: this render records nothing. The pane POSTs the read mark after mount while visible.
 * `redirect()` and `notFound()` throw (Next 16), so both sit OUTSIDE any try/catch.
 */
export default async function DirectConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const [{ conversationId }, bootstrap, t] = await Promise.all([
    params,
    requireBootstrap(),
    getTranslations('chat'),
  ]);
  if (!bootstrap.permissions.includes(CHAT_PERMISSIONS.direct)) notFound();
  if (!CONVERSATION_ID_RE.test(conversationId)) notFound();
  const id = conversationId.toLowerCase();

  let path: string | null = null;
  let missing = false;
  let detail: DirectDetail | null = null;
  try {
    detail = await fetchDirectDetail(id);
  } catch (error) {
    if (error instanceof ApiClientError) {
      path = bootstrapRedirectPath(error);
      missing = path === null && error.status === 404;
    }
    if (!path && !missing) {
      console.error('chat.direct_detail_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
    }
  }
  if (path) redirect(path);
  if (missing) notFound();

  if (detail === null) {
    return (
      <DirectThreadFrame other={null}>
        <DirectThreadError />
      </DirectThreadFrame>
    );
  }

  const page = await getMessages(id, null);
  if (page === null) {
    return (
      <DirectThreadFrame other={null}>
        <DirectThreadError />
      </DirectThreadFrame>
    );
  }

  const { tenant } = bootstrap;
  const view = directDetailView(detail, t);
  const keys = tenantDayKeys(Date.now(), tenant.timezone);
  const views = page.items.map((row) =>
    chatMessageView(row, { timeZone: tenant.timezone, viewer: 'member', t }),
  );

  return (
    <DirectThreadFrame other={view.other}>
      <DirectThreadPane
        tenantId={tenant.id}
        tenantName={tenant.displayName}
        other={view.other}
        initialConversationId={view.conversationId}
        initialViews={views}
        initialHasOlder={page.hasMore}
        initialKeys={keys}
        initialComposer={{ state: view.state, strip: view.strip }}
        canBlock={view.canBlock}
      />
    </DirectThreadFrame>
  );
}
