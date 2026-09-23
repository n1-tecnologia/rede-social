'use client';

import { Avatar, cn, IconButton } from '@tria/ui';
import { Loader2, Send, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

/**
 * The pinned comment composer — `[proto]` `comments/CommentInput.tsx` plus the reply-target chip.
 *
 * **The field is 16px and may never be smaller.** Below 16px iOS Safari zooms the whole page on
 * focus and the member loses the sheet they were reading; `text-base` is therefore a correctness
 * value here, not a typographic preference (UI-SPEC §Typography, E12).
 *
 * **Single-line by design.** V1 comments are short, and a growing field inside a bottom sheet with
 * the keyboard up eats the conversation it belongs to. A long draft SCROLLS horizontally inside the
 * field instead of pushing the list off screen; Enter submits, and there is no Shift+Enter newline.
 *
 * **The chip and the text are independent** (E12/partial): the submit control is gated on the
 * TRIMMED text alone, a chip with no text is a valid state, and submitting with no chip creates a
 * root comment. That independence is why the chip carries its own dismiss control rather than being
 * cleared as a side effect of typing.
 *
 * **A failed submit keeps what the member wrote.** The text stays in the field and the inline error
 * renders above it — retyping a comment because the network blinked is the failure this avoids.
 * The error string is owned by the list (and ultimately the catalog); this component only places it.
 */

export type ReplyTarget = {
  /** The root being replied to. */
  commentId: string;
  /** Already interpolated by the host: "Respondendo a {name}". */
  chipLabel: string;
  dismissLabel: string;
};

export type CommentInputProps = {
  viewerAvatarUrl: string | null;
  /** Accessible name of the viewer's own avatar. */
  viewerLabel: string;
  placeholder: string;
  /** Accessible name of the submit glyph. */
  submitLabel: string;
  replyTarget: ReplyTarget | null;
  onDismissReply: () => void;
  /**
   * Resolves `true` when the comment was accepted (the field is cleared) and `false` when it was
   * refused (the text stays exactly where the member left it). It never rejects — the list maps a
   * rejection to `false` so the two failure shapes cannot behave differently.
   */
  onSubmit: (body: string) => Promise<boolean>;
  /** Rendered above the field when the last submit failed; cleared by the next keystroke. */
  errorLabel: string | null;
  onClearError: () => void;
  /**
   * Bumped by the list every time "Responder" is tapped. The field focuses on the CHANGE rather
   * than on the target's identity, so tapping "Responder" twice on the same root re-focuses.
   */
  focusKey?: number;
  /** `sheet` pins the composer to the bottom of the sheet's scrollport; `inline` lets it flow. */
  variant?: 'sheet' | 'inline';
};

const SUBMIT_SPRING = { type: 'spring', stiffness: 400, damping: 22 } as const;

export function CommentInput({
  viewerAvatarUrl,
  viewerLabel,
  placeholder,
  submitLabel,
  replyTarget,
  onDismissReply,
  onSubmit,
  errorLabel,
  onClearError,
  focusKey = 0,
  variant = 'inline',
}: CommentInputProps) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  // The bump, not the target's identity, is the trigger: tapping "Responder" twice on the same
  // root must re-focus the field rather than do nothing.
  useEffect(() => {
    if (focusKey > 0) inputRef.current?.focus();
  }, [focusKey]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !pending;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    const accepted = await onSubmit(trimmed);
    setPending(false);
    // Cleared ONLY on acceptance. A refused submit leaves the draft intact (E12/error).
    if (accepted) setValue('');
  };

  return (
    <form
      onSubmit={submit}
      data-comment-input
      className={cn(
        'border-t border-border bg-bg-secondary',
        variant === 'sheet' && 'sticky bottom-0 z-10 pb-safe',
      )}
    >
      {errorLabel ? (
        <p data-comment-submit-error className="px-4 pt-3 text-sm font-normal text-danger">
          {errorLabel}
        </p>
      ) : null}

      {replyTarget ? (
        <div className="flex items-center gap-2 px-4 pt-3">
          <span
            data-reply-chip
            className="inline-flex min-w-0 items-center rounded-full bg-bg-tertiary px-3.5 py-1.5 text-xs font-normal text-text-secondary"
          >
            {/* `truncate` on the label, not on the row: the dismiss control must stay reachable
                however long the name is (E12/long-text). */}
            <span className="truncate">{replyTarget.chipLabel}</span>
          </span>
          <IconButton
            icon={X}
            size={16}
            label={replyTarget.dismissLabel}
            data-reply-chip-dismiss
            onClick={onDismissReply}
            className="h-11 w-11 shrink-0 text-text-tertiary"
          />
        </div>
      ) : null}

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar src={viewerAvatarUrl} alt={viewerLabel} size="sm" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (errorLabel) onClearError();
          }}
          placeholder={placeholder}
          // 16px (`text-base`) — the iOS zoom guard. Never smaller (UI-SPEC E12).
          className="min-w-0 flex-1 bg-transparent text-base font-normal text-text outline-none placeholder:text-text-tertiary"
        />
        <AnimatePresence initial={false}>
          {trimmed.length > 0 ? (
            <motion.div
              key="submit"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              transition={reduceMotion ? { duration: 0 } : SUBMIT_SPRING}
              className="shrink-0"
            >
              <IconButton
                icon={pending ? Loader2 : Send}
                size={20}
                type="submit"
                label={submitLabel}
                data-comment-submit
                aria-busy={pending || undefined}
                disabled={!canSubmit}
                className={cn('text-brand', pending && '[&_svg]:animate-spin')}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </form>
  );
}
