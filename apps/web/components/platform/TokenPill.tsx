import type { TokenState } from '@rede-social/contracts/projects';
import { StatusPill, type StatusTone } from '@rede-social/ui';
import { useTranslations } from 'next-intl';

/** The catalog key (`platform.database.token.states.<key>`) of each state. */
export type TokenStateLabelKey =
  | 'valid'
  | 'expiring'
  | 'expired'
  | 'invalid'
  | 'noPermission'
  | 'orgMismatch'
  | 'unchecked';

/**
 * The ONE table of words and tones of a customer project's token (09.4-14, UI-D-553, D-573, CTK-35).
 * The Token card, the tenant header and the tenant list (plans 15 and 16) all read it, so
 * "Vencendo" cannot be amber in one place and red in another. A platform project has no token state
 * at all: callers render nothing for it, this component is never asked.
 *
 * Success is "fine", warning is "will become a problem" (the typed date is within the window),
 * danger is "a person must act" (an unreplaced token cannot repair itself), neutral is "nothing
 * checked yet". Colour is never the only signal: the label always carries the meaning.
 */
const TOKEN_PILLS: Record<TokenState, { tone: StatusTone; labelKey: TokenStateLabelKey }> = {
  valid: { tone: 'success', labelKey: 'valid' },
  expiring: { tone: 'warning', labelKey: 'expiring' },
  expired: { tone: 'danger', labelKey: 'expired' },
  invalid: { tone: 'danger', labelKey: 'invalid' },
  no_permission: { tone: 'danger', labelKey: 'noPermission' },
  org_mismatch: { tone: 'danger', labelKey: 'orgMismatch' },
  unchecked: { tone: 'neutral', labelKey: 'unchecked' },
};

/** Tone and catalog key of a state; pure, so a list row or a header can use it without a hook. */
export function tokenPillProps(state: TokenState): {
  tone: StatusTone;
  labelKey: TokenStateLabelKey;
} {
  return TOKEN_PILLS[state];
}

export interface TokenPillProps {
  state: TokenState;
  /** The header and the list read "Token: {state}"; the card shows the plain word. */
  prefixed?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * The state as a `StatusPill`. Directive-less on purpose: the Token card renders it from a Server
 * Component and the header and list from wherever the rows live, with the same word and tone.
 */
export function TokenPill({
  state,
  prefixed = false,
  className,
  'data-testid': testId,
}: TokenPillProps) {
  const t = useTranslations('platform.database.token.states');
  const tenant = useTranslations('platform.tenant');
  const { tone, labelKey } = tokenPillProps(state);
  const word = t(labelKey);
  return (
    <StatusPill tone={tone} className={className} data-testid={testId ?? 'token-pill'}>
      {prefixed ? tenant('tokenPill', { state: word }) : word}
    </StatusPill>
  );
}
