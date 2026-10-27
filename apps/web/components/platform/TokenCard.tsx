import type { TokenSummary } from '@rede-social/contracts/projects';

export interface TokenCardProps {
  tenantId: string;
  token: TokenSummary;
  today: string;
  verifiedWhen: string | null;
}

/** RED stub (09.4-16 Task 1): renders nothing yet. */
export function TokenCard(_props: TokenCardProps) {
  return <div data-token-card-stub />;
}
