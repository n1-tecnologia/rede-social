import { EmptyState } from '@rede-social/ui';
import { MessageCircleOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getBootstrap } from '@/lib/bootstrap';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Conversa não encontrada" (11-22, D-720, UI-D-864, T-11-06): the ONE screen every miss on
 * `/conversas/[conversationId]` and `/conversas/com/[membershipId]` lands on, cloned from the support
 * thread's not-found. Six different causes reach this one rendering, and a later reader must not "improve" any
 * of them into a distinguishable message:
 *   1. a viewer without the composed `chat.direct` (staff, `social` off, no chat module) probing the URL;
 *   2. a malformed id (refused before any request);
 *   3. an id that matches no conversation or no member;
 *   4. a conversation or member of ANOTHER tenant (RLS never returns it, so the API cannot tell it from 3);
 *   5. a conversation of another pair, a staff account or a removed member;
 *   6. a conversation the administrator's block or a removal took away.
 * Any difference would be an existence oracle over an enumerable uuid space.
 *
 * It takes no props and reads no param: a component that cannot see the id cannot echo it. It names the
 * CALLER's tenant, which is identical across the causes (the bootstrap's own name; only when it cannot be read
 * does it fall back to the host shell's). The call to action goes back to `/conversas`.
 */
async function tenantName(): Promise<string> {
  try {
    return (await getBootstrap()).tenant.displayName;
  } catch {
    return tenantDisplayName(await getHostTenant());
  }
}

export default async function DirectConversationNotFound() {
  const [t, tenant] = await Promise.all([getTranslations('chat'), tenantName()]);
  return (
    <div data-chat-not-found className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
      <EmptyState
        variant="card"
        icon={MessageCircleOff}
        title={t('direct.notFound.title')}
        body={t('direct.notFound.body', { tenant })}
        action={
          <a
            href="/conversas"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('direct.notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
