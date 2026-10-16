import { Card, cn } from '@rede-social/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { RISE, SURFACE } from './surface';
import { type LabelTone, ToneLabel } from './ToneLabel';

export interface ActionCardProps {
  icon: LucideIcon;
  title: string;
  detail: string;
  /** A status pill under the row ("Começa em 40 min"). */
  pill?: { tone: LabelTone; text: string };
  /** The card's action (a button or link the host decides). */
  action?: ReactNode;
  /** When set, the unread dot shows and this word is read to screen readers ("não lida"). */
  unreadLabel?: string;
}

/**
 * An action card: an icon, a bold title and a detail line, then an optional pill, action and unread
 * dot. The module holds no words: every string is the host's.
 */
export function ActionCard({
  icon: Icon,
  title,
  detail,
  pill,
  action,
  unreadLabel,
}: ActionCardProps) {
  return (
    <Card className={cn(SURFACE, RISE, 'flex flex-col gap-3 p-4')}>
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Icon aria-hidden size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
          <span className="text-sm font-bold text-text">{title}</span>
          <span className="text-xs text-text-secondary">{detail}</span>
        </div>
        {unreadLabel ? (
          <>
            <span
              data-unread-dot
              aria-hidden
              className="size-2.5 shrink-0 rounded-full bg-danger"
            />
            <span className="sr-only">{unreadLabel}</span>
          </>
        ) : null}
      </div>
      {pill || action ? (
        <div className="flex flex-wrap items-center gap-2">
          {pill ? <ToneLabel tone={pill.tone}>{pill.text}</ToneLabel> : null}
          {action}
        </div>
      ) : null}
    </Card>
  );
}
