import { cn } from '@rede-social/ui';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Where the operator creates the token (09.4-14, UI-D-557, D-569, CTK-39). A code constant, never a
 * value from the catalog, a project or a request: the link cannot be made to point anywhere else.
 */
const TOKENS_URL = 'https://supabase.com/dashboard/account/tokens';

const STEPS = ['step1', 'step2', 'step3', 'step4'] as const;

/**
 * "Como criar o token": ONE component, open in the wizard (a `div`) and closed in the Token card and
 * the replace sheet (a native `<details>`, so it needs no state and works without JavaScript).
 *
 * It names no button, menu or screen of the Supabase dashboard (the dashboard changes; a stale
 * tutorial is worse than none) and no permission name: step 3 reads whatever the catalog says, and
 * the catalog carries the `[PENDENTE-PERMISSÕES]` marker until plan 17 writes the list after Igor's
 * probe (D-578; `i18n/token-messages.test.ts` fails while the marker exists). Every string comes from
 * the pt-BR catalog; the steps wrap (`break-words`) so nothing scrolls sideways at 320px.
 */
export function TokenHowTo({
  collapsible = false,
  className,
}: {
  collapsible?: boolean;
  className?: string;
}) {
  const t = useTranslations('platform.database.token.howto');

  const body = (
    <>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-text-secondary">
        {STEPS.map((step) => (
          <li key={step} className="break-words">
            {t(step)}
          </li>
        ))}
      </ol>
      <a
        href={TOKENS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 flex-wrap items-center gap-1 self-start text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {t('link')}
        <ExternalLink aria-hidden size={16} />
        <span className="sr-only">{t('newTab')}</span>
      </a>
      <p className="text-xs text-text-tertiary">{t('note')}</p>
    </>
  );

  if (collapsible) {
    return (
      <details data-token-howto className={cn('flex flex-col', className)}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
          {t('title')}
        </summary>
        <div className="mt-2 flex flex-col gap-3">{body}</div>
      </details>
    );
  }

  return (
    <div data-token-howto className={cn('flex flex-col gap-3', className)}>
      <p className="text-sm font-bold text-text-secondary">{t('title')}</p>
      {body}
    </div>
  );
}
