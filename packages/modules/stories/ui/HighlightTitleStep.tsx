'use client';

import { Button, Input } from '@tria/ui';
import { ChevronLeft } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

/**
 * The shared "Novo destaque" title step (UI-D-72) — ONE form for the two places a highlight gets a
 * name: the manage screen's "Novo destaque" sheet (plan 09) and the composer's single-select sheet
 * (`HighlightSheet` in `single` mode, plan 08). Two copies would drift on the counter, the limit or
 * the empty rule the first time either screen changed.
 *
 * Presentational and props-only: it ships no words (PWA-03) and makes no request of its own. What
 * "submitting" MEANS belongs to the host — the manage screen creates the highlight, the composer
 * only records a pending title (D-114) — so `onSubmit` is the host's, and it answers whether the
 * submit landed.
 *
 * **The rules this file owns (UI E05):**
 *
 * - **Enablement is decided on the TRIMMED value.** An empty or whitespace-only title keeps the
 *   submit disabled; the API trims too, so "   " can never become a highlight.
 * - **Enter on an empty title explains itself.** A disabled default button suppresses implicit form
 *   submission, so Enter is handled on the field: it shows the inline error and focus stays put.
 * - **The counter is the UNTRIMMED length**, `tabular-nums` in its own fixed slot under the field,
 *   so it never shifts the input as digits change.
 * - **`maxLength` holds the field at the limit** — and the change handler clips too, because a
 *   paste or a programmatic value is not bound by the attribute on every engine.
 * - **Single-flight submit.** While `onSubmit` is pending the button reads the submitting label and
 *   is disabled, and a second submit (tap or Enter) is a no-op. **A failure keeps the typed title**:
 *   the host fires its toast and the admin retries without retyping.
 *
 * Focus: on mount the step's heading takes focus when there is one (a body step that swapped in
 * inside a sheet announces WHERE the admin now is), else the field does.
 */
export interface HighlightTitleStepProps {
  /** "Novo destaque". Omit it when the surrounding sheet's own title already says so. */
  heading?: string;
  /** "Em {place}" — the host formats it. */
  placeLine?: string;
  /** "Nome". */
  label: string;
  /** "Ex.: Bastidores". */
  placeholder: string;
  /** The composer's "O destaque é criado junto com o story, quando você publicar." */
  helper?: string;
  /** "{count}/{limit}". A function: only the host has the words. */
  counter: (count: number, limit: number) => string;
  /** `STORY_HIGHLIGHT_MAX_TITLE`, passed by the host from `contracts` — never typed here. */
  limit: number;
  /** "Criar destaque". */
  submitLabel: string;
  /** "Criando…". */
  submittingLabel: string;
  /** "Voltar" — rendered only with `onBack`. */
  backLabel?: string;
  /** "Dê um nome para o destaque." */
  emptyError: string;
  /** Present when the step swapped in over a list it can return to. */
  onBack?: () => void;
  /** Receives the TRIMMED title. Resolves `false` to stay on the step with the title kept. */
  onSubmit: (title: string) => Promise<boolean> | boolean;
}

export function HighlightTitleStep({
  heading,
  placeLine,
  label,
  placeholder,
  helper,
  counter,
  limit,
  submitLabel,
  submittingLabel,
  backLabel,
  emptyError,
  onBack,
  onSubmit,
}: HighlightTitleStepProps) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [pending, setPending] = useState(false);
  /** Gates the handler synchronously: two submits in one tick must not both pass a state read. */
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (headingRef.current ?? inputRef.current)?.focus({ preventScroll: true });
  }, []);

  const trimmed = value.trim();

  async function submit() {
    if (inFlight.current) return;
    if (trimmed === '') {
      setShowEmpty(true);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      await onSubmit(trimmed);
    } catch {
      // The host owns the failure toast; the typed title simply stays.
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {onBack && backLabel ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 text-text-secondary"
          >
            <ChevronLeft aria-hidden size={20} />
            {backLabel}
          </Button>
        </div>
      ) : null}

      {heading || placeLine ? (
        <div className="flex flex-col gap-1">
          {heading ? (
            <h3
              ref={headingRef}
              tabIndex={-1}
              className="text-base font-bold text-text focus:outline-none"
            >
              {heading}
            </h3>
          ) : null}
          {placeLine ? (
            <p className="truncate text-xs font-normal text-text-tertiary">{placeLine}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Input
          ref={inputRef}
          id={inputId}
          label={label}
          placeholder={placeholder}
          value={value}
          maxLength={limit}
          autoComplete="off"
          enterKeyHint="done"
          error={showEmpty && trimmed === '' ? emptyError : undefined}
          onChange={(event) => {
            const next = event.target.value.slice(0, limit);
            setValue(next);
            if (next.trim() !== '') setShowEmpty(false);
          }}
          onKeyDown={onKeyDown}
        />
        {/* The fixed slot: right-aligned, one line, tabular digits — the field never moves. */}
        <div className="flex h-4 justify-end">
          <span className="text-xs font-normal tabular-nums text-text-tertiary">
            {counter(value.length, limit)}
          </span>
        </div>
      </div>

      {helper ? <p className="text-xs font-normal text-text-tertiary">{helper}</p> : null}

      <Button
        type="submit"
        variant="brand"
        size="md"
        fullWidth
        loading={pending}
        disabled={trimmed === ''}
      >
        {pending ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
