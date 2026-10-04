'use client';

import { cn, Textarea } from '@rede-social/ui';
import { Send } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';

/**
 * The thread composer (UI-D-260): the prototype's reply bar with the V2 extras removed (sketch 007
 * delta b). One field and one send button, nothing else.
 *
 * - **The field is 16px** (`text-base`), the iOS zoom guard, in the shipped `Textarea` look. It starts
 *   at one row and grows with its content up to 120px (five 24px lines), then scrolls inside, so a long
 *   draft never pushes the thread off a phone screen with the keyboard up.
 * - **`maxLength` 2000** (D-225) is native, and a counter appears from 1,800 characters, turning
 *   danger at the cap. It counts what the field counts (UTF-16 units), which is never more than the
 *   code points the API counts, so a draft the counter accepts is never refused for length.
 * - **Keys:** on a fine pointer, Enter sends and Shift+Enter adds a line; on touch, Enter adds a line
 *   and only the button sends (a phone keyboard's return key is for new lines). The pointer is asked
 *   at key time, so nothing about the device is read during render.
 * - **Send:** the trimmed draft is handed to `onSend` and the field is cleared at once, so the host
 *   can show its optimistic bubble. A `false` answer (or a rejection) puts the draft BACK in the field
 *   and shows the inline error, which the next keystroke clears (the shipped `CommentInput` rule): a
 *   network blip never costs the member what they wrote. Focus stays in the field.
 *
 * Props-only: this component ships no words.
 */

export interface ChatComposerProps {
  /** Field id (label, counter and error agree on it). */
  id?: string;
  /** Accessible name of the field, e.g. "Mensagem". */
  label: string;
  placeholder: string;
  /** Accessible name of the send button, e.g. "Enviar mensagem". */
  sendLabel: string;
  /** Builds the counter text from the current length, e.g. `1.900/2.000`. */
  counterTemplate: (count: number) => string;
  /** The inline error shown after a refused send. */
  errorText: string;
  /** The whole composer is inert (loading skeleton, unavailable thread). */
  disabled?: boolean;
  /**
   * Resolves `true` when the message was accepted and `false` when it was not; the composer then
   * restores the draft. A rejection is treated as `false`.
   */
  onSend: (body: string) => Promise<boolean>;
}

export const CHAT_COMPOSER_MAX_LENGTH = 2000;
export const CHAT_COMPOSER_COUNTER_FROM = 1800;

function finePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;
}

export function ChatComposer({
  id = 'chat-composer-field',
  label,
  placeholder,
  sendLabel,
  counterTemplate,
  errorText,
  disabled = false,
  onSend,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: measure from `auto` so the field also shrinks when lines are deleted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the measurement must rerun when the text changes.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [value]);

  const trimmed = value.trim();
  const canSend = !disabled && !pending && trimmed.length > 0;
  const length = value.length;
  const showCounter = length >= CHAT_COMPOSER_COUNTER_FROM;
  const atCap = length >= CHAT_COMPOSER_MAX_LENGTH;

  const send = async () => {
    if (!canSend) return;
    const draft = value;
    setValue('');
    setFailed(false);
    setPending(true);
    fieldRef.current?.focus();
    let accepted = false;
    try {
      accepted = await onSend(trimmed);
    } catch {
      accepted = false;
    }
    setPending(false);
    if (!accepted) {
      // The field stays editable while the send is in flight: put the failed draft back IN FRONT of
      // whatever was typed meanwhile, never over it (07 review B-WR-05).
      setValue((current) => (current.trim() === '' ? draft : `${draft}\n${current}`));
      setFailed(true);
    }
    fieldRef.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!finePointer()) return;
    event.preventDefault();
    void send();
  };

  return (
    <div data-chat-composer className="border-t border-border bg-bg-secondary px-4 py-2">
      {failed ? (
        <p data-chat-send-error role="alert" className="pb-2 text-sm font-normal text-danger">
          {errorText}
        </p>
      ) : null}
      {showCounter ? (
        <p
          data-chat-counter
          aria-live="off"
          className={cn(
            'pb-1 text-right text-xs font-normal tabular-nums',
            atCap ? 'text-danger' : 'text-text-tertiary',
          )}
        >
          {counterTemplate(length)}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <Textarea
          ref={fieldRef}
          id={id}
          rows={1}
          value={value}
          disabled={disabled}
          maxLength={CHAT_COMPOSER_MAX_LENGTH}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => {
            setValue(event.target.value);
            if (failed) setFailed(false);
          }}
          onKeyDown={onKeyDown}
          containerClassName="min-w-0 flex-1 gap-0"
          className="max-h-30 overflow-y-auto rounded-2xl px-4 py-2"
        />
        <button
          type="submit"
          data-chat-send
          aria-label={sendLabel}
          disabled={!canSend}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-button bg-(image:--button-image) text-on-button transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
        >
          <Send size={20} aria-hidden />
        </button>
      </form>
    </div>
  );
}
