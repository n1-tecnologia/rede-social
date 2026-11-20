import type { ReactNode } from 'react';
import { DaySeparator } from './DaySeparator';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';

/**
 * The message log (UI-D-259): an ordered list with the log role, so screen readers announce each
 * ARRIVING message once (`aria-relevant="additions"`) and never re-read the thread.
 *
 * It renders what it is given, in the order given: the host (`chat-view.ts`'s `chatRuns`) has already
 * sorted by `seq`, inserted the day separators and kept the time only on the last bubble of each run.
 * Keys are the host's stable ids (message ids, day keys), never array indexes. Props-only: no words.
 *
 * **The per-message `menu` slot (11-22, D-733, UI-D-870).** A host may hand a message item an optional `menu`
 * node, drawn in the FREE GUTTER beside the bubble: the row becomes `flex items-center gap-1`, the bubble keeps
 * its `max-w-[85%]`, and the node follows it. Only an INCOMING bubble (`side: 'other'`) ever carries one: the
 * viewer's own messages have no gutter control, whatever the host passes. The package knows nothing of what the
 * node is (a "…" button, a link): the host builds it, names it and decides who gets one. An item with no `menu`
 * renders exactly as before.
 */

export type MessageListItem =
  | { kind: 'day'; key: string; label: string }
  | ({
      kind: 'message';
      key: string;
      /** The host's gutter control for an INCOMING bubble (UI-D-870); ignored beside the viewer's own. */
      menu?: ReactNode;
    } & MessageBubbleProps);

export interface MessageListProps {
  /** Accessible name of the log, e.g. "Mensagens". */
  label: string;
  items: readonly MessageListItem[];
}

export function MessageList({ label, items }: MessageListProps) {
  return (
    <ol
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={label}
      className="flex flex-col gap-2 px-4 py-4"
    >
      {items.map((item) => {
        if (item.kind === 'day') return <DaySeparator key={item.key} label={item.label} />;
        const { kind: _kind, key, menu, ...bubble } = item;
        const gutter =
          bubble.side === 'other' && menu !== undefined && menu !== null && menu !== false;
        return (
          <li key={key} data-chat-message={key} className="flex min-w-0 flex-col">
            {gutter ? (
              <div data-chat-gutter className="flex min-w-0 items-center gap-1">
                <MessageBubble {...bubble} />
                {menu}
              </div>
            ) : (
              <MessageBubble {...bubble} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
