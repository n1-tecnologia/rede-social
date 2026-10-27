'use client';

import type { TokenState } from '@rede-social/contracts/projects';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ReplaceTokenSheet, type ReplaceTokenSheetProps } from './ReplaceTokenSheet';
import { TokenPill } from './TokenPill';

/** How long after a save the page is read once more (UI-D-562 planner assumption): no polling, no transport. */
const FOLLOW_UP_REFRESH_MS = 3000;

export interface TokenCardActionsProps {
  tenantId: string;
  state: TokenState;
  /** The expiry line, already a catalog sentence chosen on the server from the typed date. */
  expiryLine: string;
  /** "há 3 min" - computed on the server; null when the token was never checked. */
  verifiedWhen: string | null;
  /** `YYYY-MM-DD`, from the server. */
  today: string;
  /** `replaceTokenAction`, handed down by the page. */
  replaceAction: ReplaceTokenSheetProps['action'];
  /** The state's notice row, rendered by the server between the status and the action. */
  children?: ReactNode;
}

/**
 * The live half of the Token card (09.4-16, UI-D-555, UI-D-562, CTK-37): the status block (the pill, the
 * expiry line and when the token was checked), the state's notice (passed in as server-rendered children)
 * and "Substituir token" with its sheet.
 *
 * After a successful save the sheet has already refreshed the page; this island refreshes it ONCE MORE
 * after 3 s, from a timer cleared on unmount, so the follow-up health check can land. Meanwhile the status
 * block is `aria-busy` and reads "Verificando…" in place of "Verificado {when}." so a slow check never
 * looks like a rejected token. A failed refresh keeps the last state on screen. Nothing here holds the
 * token: it only knows that a save succeeded.
 */
export function TokenCardActions({
  tenantId,
  state,
  expiryLine,
  verifiedWhen,
  today,
  replaceAction,
  children,
}: TokenCardActionsProps) {
  const t = useTranslations('platform.database.token');
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onSaved = () => {
    setChecking(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      try {
        router.refresh();
      } catch {
        // A failed read keeps the last state on screen; the next visit shows the real one.
      }
      setChecking(false);
    }, FOLLOW_UP_REFRESH_MS);
  };

  return (
    <>
      <div data-token-status aria-busy={checking} className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <TokenPill state={state} />
          <span className="min-w-0 break-words text-xs text-text-tertiary">{expiryLine}</span>
        </div>
        <p className="break-words text-xs text-text-tertiary">
          {checking
            ? t('checking')
            : verifiedWhen
              ? t('verifiedAt', { when: verifiedWhen })
              : t('neverChecked')}
        </p>
      </div>
      {children}
      <div>
        <ReplaceTokenSheet
          tenantId={tenantId}
          today={today}
          action={replaceAction}
          onSaved={onSaved}
        />
      </div>
    </>
  );
}
