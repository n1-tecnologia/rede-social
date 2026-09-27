import { Card } from '@tria/ui';
import { Video } from 'lucide-react';
import type { ReactNode } from 'react';

export interface CheckinCodeCardProps {
  /** "Código de check-in": 12/700 uppercase tertiary, above the code. */
  label: string;
  /** The venue code (D-208), or `null` for an online event (the online note renders instead). */
  code: string | null;
  /** The code spelled out character by character ("Código K, 7, Q, M"), built by the host: the
   *  code's accessible name. */
  codeAriaLabel: string;
  /** The helper under the code: "Diga ou escreva este código no local…". */
  helper: string;
  /** The online event's note, shown with `Video` 20 in place of a code. */
  onlineNote: string;
  /** The host's slot under the helper: "Gerar novo código", only with the manage permission. */
  action?: ReactNode;
}

/**
 * The `Participantes` code card (UI-D-213, D-208, sketch 006 Surface 6): the FIRST thing on the
 * screen, because the organiser opens it at the door to read the code aloud.
 *
 * `Card mx-4 mt-2 p-4 text-center`: the label 12/700 uppercase tertiary; the code 24/700
 * `uppercase tracking-[0.3em] tabular-nums` in `text-text` (NOT the brand colour: the only brand fill
 * on the screen is the active chip), with its accessible name spelled character by character so a screen
 * reader does not read "K7QM" as a word (an `sr-only` twin of the `aria-hidden` glyphs: ARIA does
 * not support `aria-label` on a generic `<p>`, and Biome's `useAriaPropsSupportedByRole` refuses it); the helper 12/400 tertiary; then the `action` slot.
 * With `code === null` (an online event) the same card shows `Video` 20 tertiary and the online note:
 * there is no venue to show a code at.
 *
 * **The code is a PROP: this module never fetches it.** The host reads it through the admin-only
 * summary route and passes it in. Presentational and props-only; it **ships no words** (PWA-03).
 */
export function CheckinCodeCard({
  label,
  code,
  codeAriaLabel,
  helper,
  onlineNote,
  action,
}: CheckinCodeCardProps) {
  if (code === null) {
    return (
      <Card
        data-testid="checkin-code-card"
        data-kind="online"
        className="mx-4 mt-2 flex flex-col items-center gap-2 p-4 text-center"
      >
        <Video aria-hidden size={20} className="text-text-tertiary" />
        <p className="text-xs font-normal text-text-tertiary">{onlineNote}</p>
      </Card>
    );
  }

  return (
    <Card data-testid="checkin-code-card" data-kind="code" className="mx-4 mt-2 p-4 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="mt-1 text-2xl font-bold uppercase tracking-[0.3em] tabular-nums text-text">
        <span data-testid="checkin-code" aria-hidden>
          {code}
        </span>
        <span data-testid="checkin-code-spelled" className="sr-only">
          {codeAriaLabel}
        </span>
      </p>
      <p className="mt-1 text-xs font-normal text-text-tertiary">{helper}</p>
      {action ? <div className="mt-2 flex justify-center">{action}</div> : null}
    </Card>
  );
}
