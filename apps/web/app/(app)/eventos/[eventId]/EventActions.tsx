'use client';

import { RSVP_ANSWERS, type RsvpAnswer } from '@tria/module-events/contracts';
import { SegmentedControl, useToast } from '@tria/ui';
import { Lock, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { startTransition, useState } from 'react';
import { useBoundaryRefresh } from '@/components/events/useBoundaryRefresh';
import type { EventActionState } from '@/lib/events-view';
import { rsvpEventAction } from '../actions';

const isRsvpAnswer = (value: string): value is RsvpAnswer =>
  (RSVP_ANSWERS as readonly string[]).includes(value);

/**
 * The detail page's action zone, RSVP rows (UI-D-207, sketch 006 surface 2, approved 2026-09-27).
 *
 * The SERVER decides the phase from the request instant (`eventActionState`), and this island draws:
 *
 * | Row | What renders |
 * |-----|--------------|
 * | P0 / P1, not cancelled | the label "Você vai a este evento?" and the `SegmentedControl` Vou / Não vou |
 * | P0, in person | plus the hint "O check-in abre 1 hora antes do início." |
 * | P2, answered | the read-only line ("Você confirmou presença." / "Você respondeu que não vai.") |
 * | P2 unanswered, P3, checked in | nothing (the checked-in banner above says it) |
 * | cancelled, P0 / P1 | the pair DISABLED, showing the stored answer, no hint (D-201) |
 * | cancelled, P2 / P3 | nothing (the cancelled banner above says it) |
 * | in person, P1 / P2, not checked in (06-05) | below the rows above: ONE brand `<a>` "Fazer check-in" → `/eventos/{id}/check-in` |
 * | in person, cancelled, P1 / P2 (06-05) | the same CTA DISABLED (`aria-disabled`, opacity 50, not a link) |
 * | online, P0, answer Vou (06-06) | the pair · OUTLINE `Entrar` · hint "A transmissão começa às {time}." |
 * | online, P0, not Vou (06-06) | the pair · `Lock` 16 hint "Confirme presença para receber o link." |
 * | online, P1, not checked in (06-06) | the pair · BRAND `Entrar` · hint "Ao entrar, sua presença é registrada." |
 * | online, P2, not checked in (06-06) | the read-only line (if answered) · BRAND `Entrar` · the same hint |
 * | online, P1 / P2, checked in (06-06) | BRAND `Entrar` alone (rejoin, no hint; the banner above says it) |
 * | online, cancelled, P1 / P2 (06-06) | `Entrar` DISABLED (`aria-disabled`, opacity 50, not a link) |
 *
 * The pair carries NO brand fill (its only brand ink is the small `Check`), so the zone's single brand
 * fill is its CTA. Once checked in (a walk-in included) an in-person zone renders nothing and an online
 * zone keeps only `Entrar` in the window: the success banner above replaces everything else.
 *
 * **No CTA records anything by being rendered** (D-218, the plan's presence prohibition). "Fazer
 * check-in" is a plain link to the ticket, where the member must type the code. Every `Entrar` is a
 * plain `<a href="/eventos/{id}/entrar" target="_blank" rel="noopener noreferrer" data-no-prefetch>`,
 * never a framework link component, so nothing prefetches it; following it is the online check-in,
 * decided by the database at the instant of the tap. The zone never holds the meeting URL (D-207):
 * the anchor points at `/entrar`, whose 303 is the only place the URL reaches the browser.
 *
 * **The database decides, the UI reflects** (D-204). A tap moves `aria-pressed` optimistically, marks
 * the group busy and calls `rsvpEventAction`. Success refreshes the page (the count cell, announced
 * politely, is the feedback; there is no success toast). A refusal reverts the pair and toasts:
 * `rsvp_closed` ("as confirmações … encerraram") and `cancelled` also refresh into the zone the server
 * now draws; `attendance_locked` (a check-in landed meanwhile) refreshes into the banner.
 *
 * **Boundary refresh** (UI-D-203): ONE `setTimeout`, set in an effect, targets the next of
 * `checkinOpensAt` / `startsAt` / `endsAt` within 24 h and calls `router.refresh()`, so a member at
 * the venue sees the zone change without pulling. A refresh that brings the same phase back (a
 * device clock running ahead of the server) is retried; the hook is `useBoundaryRefresh`, shared
 * with the Início card. The clock is read ONLY inside that effect, never during render.
 */
export function EventActions({
  eventId,
  phase,
  format,
  cancelled,
  answer,
  checkedIn,
  checkinOpensAt,
  startsAt,
  endsAt,
  startTime,
}: EventActionState) {
  const t = useTranslations('events');
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // The optimistic answer, valid only while the server still reports `from`: once a refresh brings a
  // new recorded answer, the server's value wins again without an effect to clear it.
  const [pending, setPending] = useState<{ value: RsvpAnswer; from: RsvpAnswer | null } | null>(
    null,
  );
  const shown = pending !== null && pending.from === answer ? pending.value : answer;

  // `phase` re-arms the timer after each refresh lands: the instants stay the same, the phase moves.
  useBoundaryRefresh([checkinOpensAt, startsAt, endsAt], phase);

  const refresh = () => startTransition(() => router.refresh());

  const respond = async (value: string) => {
    if (busy || cancelled || !isRsvpAnswer(value) || value === shown) return;
    setPending({ value, from: answer });
    setBusy(true);
    const result = await rsvpEventAction(eventId, value);
    setBusy(false);
    if (result.ok) {
      refresh();
      return;
    }
    setPending(null);
    if (result.error === 'rsvp_closed') {
      toast.show({ tone: 'error', message: t('rsvp.errors.closed') });
      refresh();
    } else if (result.error === 'cancelled') {
      toast.show({ tone: 'error', message: t('errors.cancelled') });
      refresh();
    } else {
      toast.show({ tone: 'error', message: t('rsvp.errors.failed') });
      if (result.error === 'attendance_locked') refresh();
    }
  };

  const online = format === 'online';
  const inWindow = phase === 'P1' || phase === 'P2';

  // Checked in: the banner above replaces the zone, except an online event's `Entrar` inside the
  // window, which stays to rejoin the meeting (no hint).
  if (checkedIn) {
    if (!online || !inWindow || cancelled) return null;
    return (
      <div data-testid="event-actions" data-phase={phase} className="flex flex-col gap-3">
        <EnterLink eventId={eventId} tone="brand" label={t('online.enter')} />
      </div>
    );
  }

  const rsvpOpen = phase === 'P0' || phase === 'P1';
  const showPair = rsvpOpen;
  const showWindowHint = !cancelled && phase === 'P0' && format === 'in_person';
  const answeredLine =
    !cancelled && phase === 'P2' && answer !== null
      ? t(answer === 'going' ? 'rsvp.answeredGoing' : 'rsvp.answeredNotGoing')
      : null;

  const checkinWindow = format === 'in_person' && inWindow;

  // The online rows (UI-D-207 / UI-D-209). Before the window only a recorded `Vou` gets the OUTLINE
  // `Entrar` (entering early works but counts nothing); inside it every member gets the BRAND one.
  const onlineEarly = online && !cancelled && phase === 'P0';
  const enterTone: 'outline' | 'brand' | null = online
    ? onlineEarly
      ? answer === 'going'
        ? 'outline'
        : null
      : inWindow
        ? 'brand'
        : null
    : null;
  const onlineHint =
    online && !cancelled
      ? phase === 'P0'
        ? answer === 'going'
          ? { lock: false, text: t('online.hintBefore', { time: startTime }) }
          : { lock: true, text: t('online.confirmToGetLink') }
        : inWindow
          ? { lock: false, text: t('online.hintLive') }
          : null
      : null;

  if (!showPair && answeredLine === null && !checkinWindow && enterTone === null) return null;

  return (
    <div data-testid="event-actions" data-phase={phase} className="flex flex-col gap-3">
      {showPair ? (
        <SegmentedControl
          label={t('rsvp.label')}
          options={[
            { value: 'going', label: t('rsvp.going') },
            { value: 'not_going', label: t('rsvp.notGoing') },
          ]}
          value={shown}
          onChange={(value) => {
            void respond(value);
          }}
          disabled={cancelled}
          busy={busy}
        />
      ) : null}
      {showWindowHint ? (
        <p data-testid="event-actions-hint" className="break-words text-xs text-text-tertiary">
          {t('rsvp.windowHint')}
        </p>
      ) : null}
      {answeredLine !== null ? (
        <p data-testid="event-actions-answer" className="break-words text-sm text-text-secondary">
          {answeredLine}
        </p>
      ) : null}
      {checkinWindow ? (
        cancelled ? (
          <span
            data-testid="event-actions-checkin"
            aria-disabled="true"
            className={`${BRAND_CTA} pointer-events-none cursor-not-allowed opacity-50`}
          >
            {t('checkin.cta')}
          </span>
        ) : (
          <a
            href={`/eventos/${encodeURIComponent(eventId)}/check-in`}
            data-testid="event-actions-checkin"
            className={`${BRAND_CTA} ${BRAND_INTERACTIVE}`}
          >
            {t('checkin.cta')}
          </a>
        )
      ) : null}
      {enterTone !== null ? (
        cancelled ? (
          <span
            data-testid="event-actions-enter"
            aria-disabled="true"
            className={`${BRAND_CTA} pointer-events-none cursor-not-allowed opacity-50`}
          >
            <Video size={16} aria-hidden className="shrink-0" />
            {t('online.enter')}
          </span>
        ) : (
          <EnterLink eventId={eventId} tone={enterTone} label={t('online.enter')} />
        )
      ) : null}
      {onlineHint !== null ? (
        <p
          data-testid="event-actions-online-hint"
          className="flex items-start gap-2 break-words text-xs text-text-tertiary"
        >
          {onlineHint.lock ? <Lock size={16} aria-hidden className="shrink-0" /> : null}
          <span className="min-w-0">{onlineHint.text}</span>
        </p>
      ) : null}
    </div>
  );
}

/** `Button md fullWidth brand`, as classes on a link or a disabled span. */
const BRAND_CTA =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-on-brand transition-colors';
const BRAND_INTERACTIVE =
  'hover:bg-brand-hover active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
/** `Button md fullWidth outline`. */
const OUTLINE_CTA =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * `Entrar` (UI-D-209, D-218): ALWAYS a plain anchor to `/eventos/{id}/entrar`, opened in a new
 * browsing context, marked `data-no-prefetch`, and never a framework link component — so no render,
 * hover or viewport entry can fire it. The meeting URL is never here (D-207).
 */
function EnterLink({
  eventId,
  tone,
  label,
}: {
  eventId: string;
  tone: 'outline' | 'brand';
  label: string;
}) {
  return (
    <a
      href={`/eventos/${encodeURIComponent(eventId)}/entrar`}
      target="_blank"
      rel="noopener noreferrer"
      data-no-prefetch=""
      data-testid="event-actions-enter"
      data-tone={tone}
      className={tone === 'brand' ? `${BRAND_CTA} ${BRAND_INTERACTIVE}` : OUTLINE_CTA}
    >
      <Video size={16} aria-hidden className="shrink-0" />
      {label}
    </a>
  );
}
