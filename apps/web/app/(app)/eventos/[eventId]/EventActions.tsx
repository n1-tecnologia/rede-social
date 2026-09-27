'use client';

import { RSVP_ANSWERS, type RsvpAnswer } from '@tria/module-events/contracts';
import { SegmentedControl, useToast } from '@tria/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { startTransition, useEffect, useState } from 'react';
import type { EventActionState } from '@/lib/events-view';
import { rsvpEventAction } from '../actions';

/** A scheduled refresh lands just AFTER the boundary, so the server's clock is past it too. */
const BOUNDARY_MARGIN_MS = 1_000;
/** Only a boundary within the next day is scheduled; a longer-lived page refreshes on its own. */
const BOUNDARY_HORIZON_MS = 24 * 60 * 60 * 1_000;

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
 *
 * The check-in CTA (06-05) and `Entrar` with its hints (06-06) slot in below later; this markup does
 * not change for them. The pair carries NO brand fill (its only brand ink is the small `Check`), so
 * the zone's single brand fill stays reserved for that CTA.
 *
 * **The database decides, the UI reflects** (D-204). A tap moves `aria-pressed` optimistically, marks
 * the group busy and calls `rsvpEventAction`. Success refreshes the page (the count cell, announced
 * politely, is the feedback; there is no success toast). A refusal reverts the pair and toasts:
 * `rsvp_closed` ("as confirmações … encerraram") and `cancelled` also refresh into the zone the server
 * now draws; `attendance_locked` (a check-in landed meanwhile) refreshes into the banner.
 *
 * **Boundary refresh** (UI-D-203): ONE `setTimeout`, set in an effect, targets the next of
 * `checkinOpensAt` / `startsAt` / `endsAt` within 24 h and calls `router.refresh()`, so a member at
 * the venue sees the zone change without pulling. The clock is read ONLY inside that effect, never
 * during render.
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `phase` is the re-arm trigger
  useEffect(() => {
    const now = Date.now();
    const next = [checkinOpensAt, startsAt, endsAt]
      .map((iso) => Date.parse(iso))
      .filter((ms) => Number.isFinite(ms) && ms > now)
      .reduce<number | null>(
        (soonest, ms) => (soonest === null || ms < soonest ? ms : soonest),
        null,
      );
    if (next === null || next - now > BOUNDARY_HORIZON_MS) return;
    const timer = window.setTimeout(() => router.refresh(), next - now + BOUNDARY_MARGIN_MS);
    return () => window.clearTimeout(timer);
  }, [checkinOpensAt, startsAt, endsAt, phase, router]);

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

  if (checkedIn) return null;

  const rsvpOpen = phase === 'P0' || phase === 'P1';
  const showPair = rsvpOpen;
  const showWindowHint = !cancelled && phase === 'P0' && format === 'in_person';
  const answeredLine =
    !cancelled && phase === 'P2' && answer !== null
      ? t(answer === 'going' ? 'rsvp.answeredGoing' : 'rsvp.answeredNotGoing')
      : null;

  if (!showPair && answeredLine === null) return null;

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
    </div>
  );
}
