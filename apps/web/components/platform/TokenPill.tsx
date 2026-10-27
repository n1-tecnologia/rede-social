import type { TokenState } from '@rede-social/contracts/projects';
import { StatusPill, type StatusTone } from '@rede-social/ui';

// RED stub (09.4-14): replaced by the real table in the GREEN commit.
export type TokenStateLabelKey = 'unchecked';

export function tokenPillProps(_state: TokenState): { tone: StatusTone; labelKey: TokenStateLabelKey } {
  return { tone: 'neutral', labelKey: 'unchecked' };
}

export function TokenPill({ state }: { state: TokenState; prefixed?: boolean }) {
  return <StatusPill tone={tokenPillProps(state).tone} data-testid="token-pill" />;
}
