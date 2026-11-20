'use client';

import { BottomSheet } from '@rede-social/ui';
import { Ban, Ellipsis, Flag } from 'lucide-react';

/**
 * The message menu of a direct conversation (11-22, MODER-05, D-733, UI-D-870) [designed]: the gutter trigger
 * beside an INCOMING bubble and the `BottomSheet` it opens. Two rows at most, and nothing else: "Denunciar
 * mensagem" and, when the server's `canBlock` allows it, "Bloquear {nome}". There is no copy, reply, forward or
 * delete row, because a sent message cannot be edited or deleted (D-859) and none of the others exists.
 *
 * The words arrive FINISHED from the host (this file ships none) and the rows only call back: the report sheet
 * and the block dialog are the report-and-block hook's, opened by the host. The sheet's focus lands on its first
 * row, traps focus, closes on Escape and returns focus to the control that opened it (the shipped sheet).
 */

/** What the trigger opens: the message and whether it is a recording (a recording reports with its own title). */
export interface MessageMenuTarget {
  messageId: string;
  voice: boolean;
}

/**
 * The "…" control in the free gutter beside an incoming bubble: a ghost `Ellipsis` 16 in `text-text-tertiary`,
 * always visible (a phone has no hover), 44px tall and 40px wide at 320px (the ONE declared exception to the
 * 44px rule, A-UI-6: the 15% beside a bubble is 43px there) and 44x44 from 390px. No background until hover or
 * press. Its accessible name is the host's, the same for every message.
 */
export function MessageMenuTrigger({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      data-message-menu
      onClick={onOpen}
      className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg min-[390px]:w-11"
    >
      <Ellipsis aria-hidden size={16} />
    </button>
  );
}

const ROW =
  'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';

export interface MessageMenuSheetProps {
  open: boolean;
  onClose: () => void;
  /** "Opções da mensagem". */
  title: string;
  /** "Denunciar mensagem": always present (the blocked member and the blocker can both report). */
  report: { label: string; onSelect: () => void };
  /**
   * "Bloquear {nome}", finished; `null` draws no row: the viewer already blocked the person (the strip holds
   * "Desbloquear"), the person left, or the viewer is staff (`canBlock` from the server, never a role here).
   */
  block: { label: string; onSelect: () => void } | null;
}

export function MessageMenuSheet({ open, onClose, title, report, block }: MessageMenuSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div data-message-menu-sheet className="flex flex-col pb-2">
        <button type="button" className={ROW} data-message-report onClick={report.onSelect}>
          <Flag aria-hidden size={20} className="shrink-0" />
          <span className="min-w-0 break-words">{report.label}</span>
        </button>
        {block ? (
          <button type="button" className={ROW} data-message-block onClick={block.onSelect}>
            <Ban aria-hidden size={20} className="shrink-0" />
            <span className="min-w-0 truncate">{block.label}</span>
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}
