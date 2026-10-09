'use client';

import { EVENT_CHECKIN_CODE_LENGTH } from '@rede-social/module-events/contracts';
import { Button, Input, useMediaQuery } from '@rede-social/ui';
import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useEffect, useRef, useState } from 'react';
import { type CheckinActionResult, checkInEventAction } from '../../actions';

/** The inline refusals, by the catalog key each one prints. */
type CheckinError = 'wrongCode' | 'tooManyAttempts' | 'notOpen' | 'cancelled' | 'failed';

/** What the member typed, in the stored shape: uppercase, no whitespace or hyphens. */
const normalize = (raw: string) => raw.toUpperCase().replace(/[\s-]+/g, '');

/**
 * The RAW input cap: `checkinSchema`'s bound (16), not the code's 4. The browser applies
 * `maxLength` to the raw text BEFORE `onChange`, so a cap of 4 would truncate a pasted `K7-QM` to
 * `K7-Q` and freeze `K7 Q` one symbol short (06 review WR-02). The value itself is normalised and
 * clipped to the code's length in `onChange`, so it never shows more than 4 symbols.
 */
const RAW_MAX_LENGTH = 16;

/** The prototype's spring for the done circle [proto]. */
const DONE_SPRING = { type: 'spring', stiffness: 420, damping: 22, delay: 0.08 } as const;

/**
 * The ticket's bottom section while the check-in window is open, and its done state (UI-D-208,
 * sketch 006 surface 3, approved 2026-09-27).
 *
 * **Open.** The label "Código do evento", the shipped `Input` (uppercase, tracked, no autocorrect or
 * autofill; separators the backend ignores are stripped as they are typed or pasted, and the value is
 * clipped to the contract's code length) and ONE brand `Button` "Confirmar check-in", disabled until
 * the normalised value has the full length. No error renders before the first submit
 * (UI E08/empty). While the action runs the button is `loading` ("Confirmando…", `aria-busy`) and the
 * field is read-only, so a double tap is a no-op (UI E08/loading).
 *
 * **Refusals** render in the `Input`'s own `role="alert"` slot (UI E08/error):
 *  - `wrong_code`: the value stays and is SELECTED for retyping (the guess is already counted);
 *  - `too_many_attempts`: the submit stays disabled until the page is refreshed (D-217);
 *  - `checkin_not_open` / `checkin_closed` / `cancelled` (a race): the inline sentence, then
 *    `router.refresh()`, and the page swaps in the event's state.
 *
 * **Done.** The in-place swap: the 56px brand circle springs in (`motion/react`, the prototype's
 * stiffness 420 / damping 22 / delay 0.08; no scale under `prefers-reduced-motion`), then
 * "Check-in confirmado!" RECEIVES FOCUS, "Realizado às {time}" (formatted by the server action in the
 * tenant's zone) and the outline link "Voltar para o evento" (`checkin.doneBack`: a link TO the
 * event, unlike the header's history-aware "Voltar"). The page then refreshes, and a page that loads
 * already done renders the same state with no animation. Brand budget: the button before, the
 * circle after, never both.
 *
 * **Nothing is persisted on the device** (the prototype's browser storage is dropped): presence is a
 * database fact, re-read on every visit.
 */
export function CheckinForm({
  eventId,
  detailHref,
  doneLine,
}: {
  eventId: string;
  detailHref: string;
  /** The server's "Realizado às …" when the viewer is already present; null while open. */
  doneLine: string | null;
}) {
  const t = useTranslations('events');
  const router = useRouter();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CheckinError | null>(null);
  const [locked, setLocked] = useState(false);
  // Set only by a submit in THIS page: it plays the spring and moves focus. A page that loads already
  // done (`doneLine` from the server) shows the same state, still and unfocused.
  const [justDone, setJustDone] = useState<string | null>(null);
  const [selectPending, setSelectPending] = useState(false);

  const done = justDone ?? doneLine;

  useEffect(() => {
    if (justDone !== null) doneRef.current?.focus();
  }, [justDone]);

  useEffect(() => {
    if (!selectPending) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    setSelectPending(false);
  }, [selectPending]);

  if (done !== null) {
    // The spring plays only for a check-in made on THIS page, and never under reduced motion.
    const spring = justDone !== null && !reduceMotion;
    return (
      <div data-testid="checkin-done" className="flex flex-col items-center text-center">
        <motion.span
          data-testid="checkin-done-circle"
          data-animate={spring ? 'spring' : 'still'}
          aria-hidden
          initial={spring ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={DONE_SPRING}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg"
        >
          <Check size={28} strokeWidth={3} />
        </motion.span>
        <h3
          ref={doneRef}
          tabIndex={-1}
          className="mt-3 text-base font-bold text-text focus:outline-none"
        >
          {t('checkin.doneTitle')}
        </h3>
        <p data-testid="checkin-done-at" className="mt-1 text-xs text-text-tertiary">
          {done}
        </p>
        <a
          href={detailHref}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t('checkin.doneBack')}
        </a>
      </div>
    );
  }

  const code = normalize(value);
  const ready = code.length === EVENT_CHECKIN_CODE_LENGTH;

  const refuse = (result: Extract<CheckinActionResult, { ok: false }>) => {
    switch (result.error) {
      case 'wrong_code':
        setError('wrongCode');
        setSelectPending(true);
        return;
      case 'too_many_attempts':
        setError('tooManyAttempts');
        setLocked(true);
        return;
      case 'checkin_not_open':
      case 'checkin_closed':
        setError('notOpen');
        startTransition(() => router.refresh());
        return;
      case 'cancelled':
        setError('cancelled');
        startTransition(() => router.refresh());
        return;
      default:
        setError('failed');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || locked || !ready) return;
    setBusy(true);
    const result = await checkInEventAction(eventId, code);
    setBusy(false);
    if (result.ok) {
      setError(null);
      setJustDone(result.doneLine);
      startTransition(() => router.refresh());
      return;
    }
    refuse(result);
  };

  const messages: Record<CheckinError, string> = {
    wrongCode: t('checkin.errors.wrongCode'),
    tooManyAttempts: t('checkin.errors.tooManyAttempts'),
    notOpen: t('checkin.errors.notOpen'),
    cancelled: t('errors.cancelled'),
    failed: t('checkin.errors.failed'),
  };
  const message = error === null ? undefined : messages[error];

  return (
    <form data-testid="checkin-form" noValidate onSubmit={submit} className="flex flex-col">
      <label
        htmlFor="checkin-code"
        className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-text-tertiary"
      >
        {t('checkin.codeLabel')}
      </label>
      <Input
        ref={inputRef}
        id="checkin-code"
        name="code"
        value={value}
        onChange={(change) => {
          setValue(normalize(change.target.value).slice(0, EVENT_CHECKIN_CODE_LENGTH));
          if (!locked) setError(null);
        }}
        readOnly={busy}
        error={message}
        placeholder={t('checkin.codePlaceholder')}
        maxLength={RAW_MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className="text-center font-bold uppercase tracking-[0.3em] placeholder:font-normal placeholder:normal-case placeholder:tracking-normal"
      />
      <Button
        type="submit"
        variant="brand"
        size="md"
        fullWidth
        loading={busy}
        disabled={!ready || locked}
        className="mt-3"
      >
        {busy ? null : <Check size={16} aria-hidden className="shrink-0" />}
        {busy ? t('checkin.submitting') : t('checkin.submit')}
      </Button>
    </form>
  );
}
