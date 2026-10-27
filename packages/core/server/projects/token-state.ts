import {
  TOKEN_CHECKS,
  type TokenCheck,
  type TokenState,
  tokenState,
} from '@rede-social/contracts/projects';
import { todayInSaoPaulo } from './token';

/**
 * The token state on the server (09.4-08, D-573, D-576, CTK-21, CTK-33). The state itself is derived ONLY by the
 * contracts `tokenState`, the function the panel's token card, header pill, list pill and list filter also call,
 * so the log line and the panel answers cannot disagree. This module adds the two server-side facts around it:
 * a platform project has no token state at all, and what a change of it looks like in a log.
 *
 * The token state is never an input of `databaseState` and never moves a binding or a host answer (D-574).
 */

const KNOWN_CHECKS: ReadonlySet<string> = new Set(TOKEN_CHECKS);

/**
 * The token state of a project, or `null` for a platform-owned one. `tokenCheck` is the stored column text; a
 * value the contracts do not know reads as never checked. `today` defaults to the operator's calendar day.
 */
export function tokenStateOf(input: {
  owner: string;
  tokenCheck: string | null;
  expiresAt: string | null;
  today?: string;
}): TokenState | null {
  if (input.owner !== 'customer') return null;
  const check =
    input.tokenCheck !== null && KNOWN_CHECKS.has(input.tokenCheck)
      ? (input.tokenCheck as TokenCheck)
      : null;
  return tokenState({
    check,
    expiresAt: input.expiresAt,
    today: input.today ?? todayInSaoPaulo(),
  });
}

/**
 * The ONE structured line a change of the token state writes (D-576): the event, the project id and the two
 * states. Never the token, its prefix, its length, the organisation slug or the ref (T-09.4-28).
 */
export function tokenChangeFields(
  projectId: string,
  from: TokenState | null,
  to: TokenState | null,
) {
  return { event: 'project.token.state_changed' as const, projectId, from, to };
}
