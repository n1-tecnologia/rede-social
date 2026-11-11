import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * 10-13 (UI-D-706, D-710) — the limit notice that REPLACES "Criar comunidade" for a member who owns as
 * many active communities as the tenant allows (limit above 0): `Info` 16 beside one 14/400 sentence
 * that names the limit with an ICU plural. It is static text: no action (archiving happens on the
 * community's own edit form), no live region, nothing to dismiss. The `px-4 pb-3` wrapper is the
 * notice's own spacing under the heading block, so the page does not repeat it.
 *
 * Not a client component on purpose: it holds no state, so the server renders it as plain markup.
 * The `nova` limit screen states the same sentence in its `EmptyState` body (a string slot), from the
 * same catalog key.
 */
export function CommunityLimitNotice({ limit }: { limit: number }) {
  const t = useTranslations('communities');
  return (
    <div data-community-limit-notice className="px-4 pb-3">
      <div className="flex items-start gap-2 rounded-xl bg-bg-secondary p-4">
        <Info aria-hidden size={16} className="mt-0.5 shrink-0 text-text-tertiary" />
        <p className="min-w-0 text-sm font-normal text-text-secondary">
          {t('limit.notice', { limit })}
        </p>
      </div>
    </div>
  );
}
