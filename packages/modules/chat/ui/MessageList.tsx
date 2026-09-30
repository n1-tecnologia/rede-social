import { DaySeparator } from './DaySeparator';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';

/**
 * The message log (UI-D-259): an ordered list with the log role, so screen readers announce each
 * ARRIVING message once (`aria-relevant="additions"`) and never re-read the thread.
 *
 * It renders what it is given, in the order given: the host (`chat-view.ts`'s `chatRuns`) has already
 * sorted by `seq`, inserted the day separators and kept the time only on the last bubble of each run.
 * Keys are the host's stable ids (message ids, day keys), never array indexes. Props-only: no words.
 */

export type MessageListItem =
  | { kind: 'day'; key: string; label: string }
  | ({ kind: 'message'; key: string } & MessageBubbleProps);

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
        const { kind: _kind, key, ...bubble } = item;
        return (
          <li key={key} data-chat-message={key} className="flex min-w-0 flex-col">
            <MessageBubble {...bubble} />
          </li>
        );
      })}
    </ol>
  );
}
