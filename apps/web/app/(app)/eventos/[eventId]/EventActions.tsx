'use client';

import type { RsvpAnswer } from '@rede-social/module-events/contracts';
import { Button, useToast } from '@rede-social/ui';
import { Award, Lock, QrCode, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, startTransition, useState } from 'react';
import { useBoundaryRefresh } from '@/components/events/useBoundaryRefresh';
import type { EventActionState } from '@/lib/events-view';
import { rsvpEventAction } from '../actions';

/**
 * The detail page's action zone, in the REINE prototype's shape (2026-10-06): ONE gold call to
 * action (the button colour, `Button variant="brand"`), the way the prototype's gold button reads.
 *
 * The SERVER decides the phase from the request instant (`eventActionState`), and this island draws:
 *
 * | State | What renders |
 * |-------|--------------|
 * | P0 / P1, not going | "Garantir minha vaga" (records a Vou); when no spot is left, "Vagas esgotadas", disabled, and the full hint |
 * | P0 / P1, going, in person | "Ver meu check-in" → `/eventos/{id}/check-in`; in P0 the window hint; then the quiet "Cancelar inscrição" (records a Não vou) |
 * | P2 / P3, answered, not present | the read-only line ("Você confirmou presença." / "Você respondeu que não vai.") |
 * | in person, not present | the gold check-in link: "Ver meu check-in" for a Vou (P0 to P2), "Fazer check-in" for anyone in P2 (the walk-in) |
 * | in person, present, not over | "Ver meu check-in" (the ticket's done state) |
 * | P3, present, with a certificate | "Ver meu certificado" → `/eventos/meus` |
 * | online | `Entrar` exactly as before (06-06): outline for a Vou in P0, brand in P1 / P2, with its hints; in P1 the gold `Entrar` replaces "Garantir minha vaga" (entering records the walk-in) |
 * | cancelled | the CTA DISABLED (`aria-disabled`), nothing records |
 *
 * **No CTA records anything by being rendered** (D-218): the check-in links are plain links to the
 * ticket, where the member types the code, and every `Entrar` is a plain anchor to `/entrar`, never
 * prefetched (D-207: the meeting URL never reaches this island).
 *
 * **The database decides, the UI reflects** (D-204). A tap answers optimistically, marks the zone
 * busy and calls `rsvpEventAction`; success refreshes the page, a refusal reverts and toasts
 * (`rsvp_closed` and `cancelled` refresh into the zone the server now draws; `event_full` says the
 * event is full; `attendance_locked` refreshes into the check-in banner).
 *
 * **Boundary refresh** (UI-D-203): `useBoundaryRefresh` targets the next of `checkinOpensAt` /
 * `startsAt` / `endsAt` within 24 h, so the zone changes at the venue without a pull.
 */
export function EventActions({
  eventId,
  phase,
  format,
  cancelled,
  full = false,
  answer,
  checkedIn,
  checkinOpensAt,
  startsAt,
  endsAt,
  startTime,
  certificate = false,
}: EventActionState & { certificate?: boolean }) {
  const t = useTranslations('events');
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // The optimistic answer, valid only while the server still reports `from`.
  const [pending, setPending] = useState<{ value: RsvpAnswer; from: RsvpAnswer | null } | null>(
    null,
  );
  const shown = pending !== null && pending.from === answer ? pending.value : answer;

  useBoundaryRefresh([checkinOpensAt, startsAt, endsAt], phase);

  const refresh = () => startTransition(() => router.refresh());

  const respond = async (value: RsvpAnswer) => {
    if (busy || cancelled || value === shown) return;
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
    } else if (result.error === 'event_full') {
      toast.show({ tone: 'error', message: t('rsvp.errors.full') });
      refresh();
    } else {
      toast.show({ tone: 'error', message: t('rsvp.errors.failed') });
      if (result.error === 'attendance_locked') refresh();
    }
  };

  const online = format === 'online';
  const inWindow = phase === 'P1' || phase === 'P2';
  const rsvpOpen = phase === 'P0' || phase === 'P1';
  const going = shown === 'going';
  const ticketHref = `/eventos/${encodeURIComponent(eventId)}/check-in`;

  // Present (a walk-in included): the ticket's done state in person, `Entrar` online to rejoin, the
  // certificate once it is over.
  if (checkedIn) {
    if (cancelled) return null;
    if (phase === 'P3') {
      return certificate ? (
        <Zone phase={phase}>
          <a href="/eventos/meus" data-testid="event-actions-certificate" className={GOLD}>
            <Award size={16} aria-hidden className="shrink-0" />
            {t('reine.cta.certificate')}
          </a>
        </Zone>
      ) : null;
    }
    if (online) {
      return inWindow ? (
        <Zone phase={phase}>
          <EnterLink eventId={eventId} tone="brand" label={t('online.enter')} />
        </Zone>
      ) : null;
    }
    return (
      <Zone phase={phase}>
        <a href={ticketHref} data-testid="event-actions-checkin" className={GOLD}>
          <QrCode size={16} aria-hidden className="shrink-0" />
          {t('reine.cta.checkin')}
        </a>
      </Zone>
    );
  }

  const answeredLine =
    !cancelled && !rsvpOpen && phase !== 'P3' && answer !== null
      ? t(answer === 'going' ? 'rsvp.answeredGoing' : 'rsvp.answeredNotGoing')
      : null;

  // The in-person check-in link: for a Vou from the moment it is answered; once answers close (P2),
  // for anyone, the walk-in. Never beside "Garantir minha vaga": one gold call at a time.
  const checkinLink = !online && (going ? rsvpOpen || inWindow : phase === 'P2');
  const showWindowHint = !cancelled && phase === 'P0' && !online && going;

  const enterTone: 'outline' | 'brand' | null = online
    ? phase === 'P0'
      ? going
        ? 'outline'
        : null
      : inWindow
        ? 'brand'
        : null
    : null;
  const onlineHint =
    online && !cancelled
      ? phase === 'P0'
        ? going
          ? { lock: false, text: t('online.hintBefore', { time: startTime }) }
          : { lock: true, text: t('online.confirmToGetLink') }
        : inWindow
          ? { lock: false, text: t('online.hintLive') }
          : null
      : null;

  // Online inside the window the gold `Entrar` already records the walk-in: no second gold call.
  const register = rsvpOpen && !going && !(online && inWindow);
  const unregister = rsvpOpen && going && !cancelled;

  if (!register && !checkinLink && enterTone === null && answeredLine === null && !unregister) {
    return null;
  }

  return (
    <Zone phase={phase}>
      {register ? (
        full && !cancelled ? (
          <>
            <Button type="button" variant="brand" size="lg" fullWidth disabled>
              {t('reine.cta.full')}
            </Button>
            <p data-testid="event-actions-full" className="break-words text-xs text-text-tertiary">
              {t('rsvp.fullHint')}
            </p>
          </>
        ) : (
          <Button
            type="button"
            variant="brand"
            size="lg"
            fullWidth
            data-testid="event-actions-register"
            loading={busy}
            disabled={cancelled}
            aria-disabled={cancelled || undefined}
            onClick={() => {
              void respond('going');
            }}
          >
            {t('reine.cta.register')}
          </Button>
        )
      ) : null}

      {answeredLine !== null ? (
        <p data-testid="event-actions-answer" className="break-words text-sm text-text-secondary">
          {answeredLine}
        </p>
      ) : null}

      {checkinLink ? (
        cancelled ? (
          <span
            data-testid="event-actions-checkin"
            aria-disabled="true"
            className={`${GOLD_BASE} pointer-events-none cursor-not-allowed opacity-50`}
          >
            <QrCode size={16} aria-hidden className="shrink-0" />
            {t(going ? 'reine.cta.checkin' : 'checkin.cta')}
          </span>
        ) : (
          <a href={ticketHref} data-testid="event-actions-checkin" className={GOLD}>
            <QrCode size={16} aria-hidden className="shrink-0" />
            {t(going ? 'reine.cta.checkin' : 'checkin.cta')}
          </a>
        )
      ) : null}

      {showWindowHint ? (
        <p data-testid="event-actions-hint" className="break-words text-xs text-text-tertiary">
          {t('rsvp.windowHint')}
        </p>
      ) : null}

      {enterTone !== null ? (
        cancelled ? (
          <span
            data-testid="event-actions-enter"
            aria-disabled="true"
            className={`${GOLD_BASE} pointer-events-none cursor-not-allowed opacity-50`}
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

      {unregister ? (
        <button
          type="button"
          data-testid="event-actions-unregister"
          disabled={busy}
          onClick={() => {
            void respond('not_going');
          }}
          className="mx-auto rounded px-2 py-1 text-xs font-semibold text-text-tertiary underline-offset-2 transition-colors hover:text-text-secondary hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {t('reine.cta.cancel')}
        </button>
      ) : null}
    </Zone>
  );
}

function Zone({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div data-testid="event-actions" data-phase={phase} className="flex flex-col gap-3">
      {children}
    </div>
  );
}

/**
 * `Button lg fullWidth brand`, as classes on a link or a disabled span: the button colour (the
 * REINE gold wherever a tenant set it) under the gradient button's image, the focus ring on the
 * primary.
 */
const GOLD_BASE =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors';
const GOLD = `${GOLD_BASE} hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;
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
      className={tone === 'brand' ? GOLD : OUTLINE_CTA}
    >
      <Video size={16} aria-hidden className="shrink-0" />
      {label}
    </a>
  );
}
