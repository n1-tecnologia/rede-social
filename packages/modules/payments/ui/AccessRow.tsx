import { Skeleton, StatusPill } from '@rede-social/ui';
import { ChevronRight, Mail } from 'lucide-react';
import { AccessStatePill } from './AccessStatePill';

export interface AccessRowProps {
  email: string;
  /** The server's state, which picks the pill's tone. */
  state: 'active' | 'subscription_pending' | 'blocked';
  stateLabel: string;
  /** "Manual" or the gateway's name, already finished. */
  sourceLabel: string;
  /**
   * Whether a live membership carries the address, as the server sent it. `false` draws the neutral
   * `noAccountLabel` pill; `true` and a missing value draw nothing (a missing field is not "no account").
   */
  hasAccount?: boolean | undefined;
  noAccountLabel: string;
  /** "Válido até 12 de nov. de 2026" or "Sem data de validade", finished in the tenant timezone. */
  validityLabel: string;
  onOpen: () => void;
}

/**
 * One Acessos row (09.1-14, UI-D-517): the e-mail with its state in words and colour. The WHOLE row is
 * one `<button>` that opens the access sheet (a list row opens an in-place surface, so it is a button,
 * not a link, UI-D-529). Props-only: every word, flag and handler arrives from `apps/web` (MOD-02).
 *
 * The e-mail is `truncate` inside a `min-w-0 flex-1` column, so a 64-character local part and a long
 * domain never push the chevron or the pills out of a 320px row; the pills WRAP on their own line, in
 * the order state, source, account. Names are plain React text: no raw HTML anywhere (UI-D-532).
 */
export function AccessRow({
  email,
  state,
  stateLabel,
  sourceLabel,
  hasAccount,
  noAccountLabel,
  validityLabel,
  onOpen,
}: AccessRowProps) {
  return (
    <button
      type="button"
      data-access-row={email}
      onClick={onOpen}
      className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand md:hover:bg-card-hover"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary">
        <Mail aria-hidden size={20} className="text-text-secondary" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-text">{email}</span>
        <span data-access-pills className="mt-1 flex flex-wrap gap-1">
          <AccessStatePill state={state} label={stateLabel} />
          <StatusPill tone="neutral">{sourceLabel}</StatusPill>
          {hasAccount === false ? <StatusPill tone="neutral">{noAccountLabel}</StatusPill> : null}
        </span>
        <span className="mt-1 truncate text-xs font-normal tabular-nums text-text-tertiary">
          {validityLabel}
        </span>
      </span>
      <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
    </button>
  );
}

export interface AccessRowSkeletonProps {
  /** 8 rows on a query change, 3 at the sentinel (UI-D-528). */
  count?: number;
}

/** `count` row skeletons in the row's own geometry: a 40px disc and three bars, `aria-busy`, no word. */
export function AccessRowSkeleton({ count = 1 }: AccessRowSkeletonProps) {
  return (
    <div aria-busy data-access-skeleton className="flex flex-col">
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div
          key={index}
          data-access-skeleton-row
          className="flex min-h-18 items-center gap-3 border-b border-divider px-4 py-3 last:border-0"
        >
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="55%" className="h-4" />
            <Skeleton variant="text" width="35%" className="h-3" />
            <Skeleton variant="text" width="45%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
