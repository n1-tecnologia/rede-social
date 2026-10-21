import { Skeleton } from '@rede-social/ui';
import { CircleCheck, CircleDashed, CircleHelp, type LucideIcon, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { AccessStatePill } from './AccessStatePill';

/** The four states an Eventos row can be in (UI-D-519): the glyph, the word and the colour all say it. */
export type EventRowState = 'applied' | 'no_account' | 'unknown_product' | 'ignored';

const GLYPH: Record<EventRowState, LucideIcon> = {
  applied: CircleCheck,
  no_account: UserX,
  unknown_product: CircleHelp,
  ignored: CircleDashed,
};

export interface EventRowProps {
  state: EventRowState;
  /** The state's word ("Aplicado", "Sem conta", ...), finished. */
  stateLabel: string;
  /** The gateway-neutral event name ("Compra aprovada"), never the gateway's trigger. */
  name: string;
  /** The buyer's address, or the finished "E-mail não informado". */
  email: string;
  /** The mapped product's name, or the finished "ID {externalId}"; `null` renders no product line. */
  product?: string | null | undefined;
  /** What the event did ("Acesso liberado"); `null` or missing renders no effect line. */
  effect?: string | null | undefined;
  /** "recebido há 3 min", finished from the server's clock. */
  received: string;
  /**
   * The row's action, filled by the caller (an `outline sm` button or a text link). It is a SIBLING of
   * the text column and never shrinks; below 360px it moves under the column so a long e-mail keeps
   * its width (finding F-4 of sketch 013).
   */
  action?: ReactNode;
}

/**
 * One Eventos row (09.1-14, UI-D-519, UI-D-520, D-503): what the gateway sent, in the integration's own
 * neutral words. Props-only (MOD-02): it renders the finished strings it is given and a slot, and has no
 * way to show a request body, a header, a signing hash or a gateway message, because it is never handed
 * one (T-09.1-65). E-mail and product are `truncate` inside a `min-w-0 flex-1` column and are plain React
 * text. The glyph disc says the state next to the pill's word; it is decorative (`aria-hidden`).
 */
export function EventRow({
  state,
  stateLabel,
  name,
  email,
  product,
  effect,
  received,
  action,
}: EventRowProps) {
  const Glyph = GLYPH[state];
  return (
    <li className="flex min-h-18 flex-wrap items-start gap-x-3 px-4 py-3">
      <span
        data-event-glyph={state}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary"
      >
        <Glyph
          aria-hidden
          size={20}
          className={state === 'applied' ? 'text-success' : 'text-text-secondary'}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold text-text">{name}</span>
        <span className="truncate text-xs font-normal text-text-secondary">{email}</span>
        {product ? (
          <span className="truncate text-xs font-normal text-text-tertiary">{product}</span>
        ) : null}
        {effect ? <span className="text-xs font-normal text-text-tertiary">{effect}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <AccessStatePill state={state} label={stateLabel} />
          <span className="text-xs font-normal text-text-tertiary">{received}</span>
        </span>
      </div>
      {action ? (
        <div className="shrink-0 max-[359px]:basis-full max-[359px]:pt-2 max-[359px]:pl-13">
          {action}
        </div>
      ) : null}
    </li>
  );
}

export interface EventRowSkeletonProps {
  /** 8 rows while the tab loads (UI-D-528). */
  count?: number;
}

/** `count` row skeletons in the row's own geometry: a 40px disc and three bars, `aria-busy`, no word. */
export function EventRowSkeleton({ count = 1 }: EventRowSkeletonProps) {
  return (
    <div aria-busy data-event-skeleton className="flex flex-col">
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div
          key={index}
          data-event-skeleton-row
          className="flex min-h-18 items-start gap-3 border-b border-divider px-4 py-3 last:border-0"
        >
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="40%" className="h-4" />
            <Skeleton variant="text" width="60%" className="h-3" />
            <Skeleton variant="text" width="35%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
