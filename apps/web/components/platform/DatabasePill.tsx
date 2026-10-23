import type { DatabaseState } from '@rede-social/contracts/projects';
import { StatusPill, type StatusTone } from '@rede-social/ui';
import { useTranslations } from 'next-intl';

/** The catalog key (`platform.database.states.<key>`) of each state. */
export type DatabaseStateLabelKey =
  | 'ready'
  | 'preparing'
  | 'preparationFailed'
  | 'behind'
  | 'paused'
  | 'unreachable'
  | 'moving'
  | 'unchecked';

/**
 * The ONE table of words and tones of a tenant's database state (09.2-19, UI-D-539, D-542, D-543,
 * D-545, A-UI-5). The Banco tab, the tenant list's column and the tenant header (plan 20) all read
 * it, so "Atrasado" cannot be amber in one place and red in another.
 *
 * Danger is reserved for "needs a person now" (a failed bootstrap, an unreachable project); warning
 * is "will resolve or is waiting on an upstream action" (late, paused); neutral is "nothing wrong
 * to act on" (running, moving, not checked yet). Colour is never the only signal: the label always
 * carries the meaning.
 */
const DATABASE_PILLS: Record<DatabaseState, { tone: StatusTone; labelKey: DatabaseStateLabelKey }> =
  {
    ready: { tone: 'success', labelKey: 'ready' },
    preparing: { tone: 'neutral', labelKey: 'preparing' },
    preparation_failed: { tone: 'danger', labelKey: 'preparationFailed' },
    behind: { tone: 'warning', labelKey: 'behind' },
    paused: { tone: 'warning', labelKey: 'paused' },
    unreachable: { tone: 'danger', labelKey: 'unreachable' },
    moving: { tone: 'neutral', labelKey: 'moving' },
    unchecked: { tone: 'neutral', labelKey: 'unchecked' },
  };

/** Tone and catalog key of a state; pure, so a list row or a header can use it without a hook. */
export function databasePillProps(state: DatabaseState): {
  tone: StatusTone;
  labelKey: DatabaseStateLabelKey;
} {
  return DATABASE_PILLS[state];
}

export interface DatabasePillProps {
  state: DatabaseState;
  className?: string;
  /** Plan 20's header and list may mark the pill (a test id, an id for `aria-describedby`). */
  'data-testid'?: string;
}

/**
 * The state as a `StatusPill`. Directive-less on purpose: the Banco tab renders it from a Server
 * Component and the list from wherever the rows live, and both get the same word and tone.
 */
export function DatabasePill({ state, className, 'data-testid': testId }: DatabasePillProps) {
  const t = useTranslations('platform.database.states');
  const { tone, labelKey } = databasePillProps(state);
  return (
    <StatusPill tone={tone} className={className} data-testid={testId ?? 'database-pill'}>
      {t(labelKey)}
    </StatusPill>
  );
}
