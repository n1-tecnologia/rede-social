import { StatusPill, type StatusTone } from '@rede-social/ui';

/**
 * Every state word the payments screens print as a pill (UI-D-520). The first three are the access
 * states of an e-mail (Acessos, and Membros through the same vocabulary); the last four are the states
 * of a delivered event (Eventos).
 */
export const ACCESS_PILL_STATES = [
  'active',
  'subscription_pending',
  'blocked',
  'applied',
  'no_account',
  'unknown_product',
  'ignored',
] as const;
export type AccessPillState = (typeof ACCESS_PILL_STATES)[number];

/**
 * THE mapping from a state to its tone, written once and used identically on every surface (UI-D-520,
 * D-497): Ativo and Aplicado are success; Assinatura pendente (money decided), Sem conta and Produto
 * desconhecido are warning; Bloqueado (a person decided) is the only danger; Ignorado is neutral.
 * Danger is reserved for a human decision to keep someone out, so a late payment never reads like one.
 */
const TONE: Record<AccessPillState, StatusTone> = {
  active: 'success',
  applied: 'success',
  subscription_pending: 'warning',
  no_account: 'warning',
  unknown_product: 'warning',
  blocked: 'danger',
  ignored: 'neutral',
};

export interface AccessStatePillProps {
  state: AccessPillState;
  /** The finished word. The label always carries the meaning: colour is never the only signal. */
  label: string;
  className?: string;
}

/** The one status pill of the payments screens (props-only, MOD-02, UI-D-531). */
export function AccessStatePill({ state, label, className }: AccessStatePillProps) {
  return (
    <StatusPill tone={TONE[state]} data-state={state} className={className}>
      {label}
    </StatusPill>
  );
}
