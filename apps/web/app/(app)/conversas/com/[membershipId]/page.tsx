import { CHAT_PERMISSIONS, type DirectWithAnswer } from '@rede-social/module-chat/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DirectThreadFrame } from '@/components/chat/DirectThreadFrame';
import { DirectThreadError, DirectThreadPane } from '@/components/chat/DirectThreadPane';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { fetchDirectWith } from '@/lib/chat';
import { directWithView, tenantDayKeys } from '@/lib/chat-view';
import { loadOwnProfile } from '@/lib/profile';

/** A canonical uuid: anything else is the one not-found screen before any request (D-23). */
const MEMBERSHIP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/conversas/com/[membershipId]` (CHAT-06, D-720, D-722, UI-D-864) [designed]: where "Enviar mensagem" (the
 * profile and the member row) lands. The lazy start of a conversation with ONE member, by MEMBERSHIP id:
 *
 * - **A pair has at most one conversation.** When the API says the pair already has one, the page REDIRECTS to
 *   `/conversas/{conversationId}` (never two, never a second empty thread); otherwise it renders the empty thread
 *   ("Escreva para {nome}") and the pane's FIRST send creates the conversation in place.
 * - **The caller's own membership redirects to `/conversas`** (a member does not write to themselves); the
 *   comparison is made here against the viewer's own profile, so it costs no API call and enumerates nothing.
 * - **Every miss is the ONE not-found screen** (T-11-06): a viewer without `chat.direct`, a malformed id, a
 *   target that is staff, removed, another tenant's or unknown (the API's bare 404). One screen for all of them,
 *   so the page cannot be used to enumerate members or learn why. A transport failure is the thread's error card.
 * - **A member who opens someone who blocked them gets the closed strip** with the same ONE sentence as an open
 *   conversation that closed (D-722: the refusal also applies to starting); the page never says why.
 *
 * `redirect()` and `notFound()` throw (Next 16), so every one of them sits OUTSIDE any try/catch.
 */
export default async function StartDirectConversationPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const [{ membershipId }, bootstrap, t] = await Promise.all([
    params,
    requireBootstrap(),
    getTranslations('chat'),
  ]);
  if (!bootstrap.permissions.includes(CHAT_PERMISSIONS.direct)) notFound();
  if (!MEMBERSHIP_ID_RE.test(membershipId)) notFound();
  const id = membershipId.toLowerCase();

  const own = await loadOwnProfile();
  if (own && own.membershipId.toLowerCase() === id) redirect('/conversas');

  let path: string | null = null;
  let missing = false;
  let answer: DirectWithAnswer | null = null;
  try {
    answer = await fetchDirectWith(id);
  } catch (error) {
    if (error instanceof ApiClientError) {
      path = bootstrapRedirectPath(error);
      missing = path === null && error.status === 404;
    }
    if (!path && !missing) {
      console.error('chat.direct_with_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
    }
  }
  if (path) redirect(path);
  if (missing) notFound();

  if (answer === null) {
    return (
      <DirectThreadFrame other={null}>
        <DirectThreadError />
      </DirectThreadFrame>
    );
  }
  if (answer.conversationId) redirect(`/conversas/${answer.conversationId}`);

  const { tenant } = bootstrap;
  const view = directWithView(answer, t);
  const keys = tenantDayKeys(Date.now(), tenant.timezone);

  return (
    <DirectThreadFrame other={view.other}>
      <DirectThreadPane
        tenantId={tenant.id}
        tenantName={tenant.displayName}
        other={view.other}
        initialConversationId={null}
        initialViews={[]}
        initialHasOlder={false}
        initialKeys={keys}
        initialComposer={{ state: view.state, strip: view.strip }}
        // The viewer is a member, the other is live and the viewer has not blocked them yet: the same facts the
        // detail answers `canBlock` from; the pane re-reads the server's own answer once the thread exists.
        canBlock={view.state === 'open' || view.state === 'closed'}
      />
    </DirectThreadFrame>
  );
}
