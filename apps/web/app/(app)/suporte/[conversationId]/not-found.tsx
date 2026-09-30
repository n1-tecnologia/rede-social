import { EmptyState } from '@rede-social/ui';
import { MessageCircleOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getBootstrap } from '@/lib/bootstrap';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Conversa não encontrada": the ONE screen every miss on `/suporte/[conversationId]` lands on (D-23,
 * T-07-66, T-07-67), cloned from the events not-found.
 *
 * Five different causes reach this one rendering, and a later reader must not "improve" any of them
 * into a distinguishable message:
 *   1. a member (no `chat.support`) probing a staff URL;
 *   2. a malformed id (refused before any request);
 *   3. an id that matches no conversation;
 *   4. a conversation of ANOTHER tenant (RLS never returns it, so the API cannot tell it from 3);
 *   5. another member's thread seen by a member (the participant policy, the same bare 404).
 * Any difference would be an existence oracle over an enumerable uuid space.
 *
 * It takes no props and reads no param: a component that cannot see the id cannot echo it. It names
 * the CALLER's tenant, which is identical across the causes: `/suporte` is an authenticated route, so
 * the tenant the membership confirmed (the same `bootstrap.tenant.displayName` the shell brands itself
 * with, and which the API holds equal to the host's tenant, `TENANT_HOST_MISMATCH`) is the honest name.
 * Only when the bootstrap cannot be read does it fall back to the host shell's name. From `lg` it
 * renders in the split's right pane, beside the inbox list; the CTA goes back to `/suporte`.
 */
async function tenantName(): Promise<string> {
  try {
    return (await getBootstrap()).tenant.displayName;
  } catch {
    return tenantDisplayName(await getHostTenant());
  }
}

export default async function ConversationNotFound() {
  const [t, tenant] = await Promise.all([getTranslations('chat'), tenantName()]);
  return (
    <div data-chat-not-found className="flex w-full flex-col gap-3 px-4 pt-4 lg:my-auto lg:pt-0">
      <EmptyState
        variant="card"
        icon={MessageCircleOff}
        title={t('notFound.title')}
        body={t('notFound.body', { tenant })}
        action={
          <a
            href="/suporte"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
