'use client';

import { PAYMENTS_MAX_LINK, PAYMENTS_MAX_PRODUCT_ID } from '@rede-social/module-payments/contracts';
import { Button, Input, SectionTitle, Switch } from '@rede-social/ui';
import { CircleAlert, Info, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OpeningErrorKey, OpeningFieldState, OpeningPair } from '@/lib/event-opening-form';
import {
  parseTicketPrice,
  type TicketErrorKey,
  type TicketFieldErrors,
  type TicketSectionState,
  ticketPriceText,
} from '@/lib/event-ticket';

/**
 * The "Ingresso" section of the event form (Phase 10.1-11, TICK-02 to TICK-05, TICK-20, D-744 to D-748,
 * D-755, D-757, UI-D-741 to UI-D-743, sketch 021 `form-ingresso-*`): the end of step 1, after "Vagas".
 *
 * **Presentational and controlled.** Every fact it draws arrives as a prop: the section's state from
 * `ticketSectionState` (first match wins, computed from the server's facts and never from a pre-check
 * of the gateway), the values, the errors and the two notes. It owns no field state and makes no
 * request: the form is the single writer and runs the second write after the event save.
 *
 * **Neutral.** The provider is only ever the `{gateway}` slot, filled with the display name the server
 * passes (or the catalog's neutral fallback); no key, literal or test string names it (UI-D-740).
 *
 * **Errors take the helper's place** and are the `Input`'s own `role="alert"` slot, cleared by the form on
 * the next edit of their field. The sales-lock refusal is its own `role="alert"` row at the top of the
 * section. A static notice (locked, module off) is text present at load, never a live region.
 */

/**
 * Phase 10.2-12 (D-792, D-793, D-794, UI-D-790, UI-D-791): the "Abertura das inscrições" field. Absent
 * (a caller that predates it) draws nothing. Every fact arrives as a prop; the section keeps no state.
 */
export type TicketOpeningProps = {
  /** The wall-clock pair as typed (or the stored one, read-only when locked). */
  pair: OpeningPair;
  onChange: (next: OpeningPair) => void;
  /** Empties both inputs; the form returns focus to the date input. */
  onClear: () => void;
  /** (a) locked, (b) empty, (c) filled, (d) past: from `openingFieldState`. */
  fieldState: OpeningFieldState;
  /** The sold count the locked line reads (the form reads it once per render). */
  soldCount: number;
  /** The tenant zone's generic name, the form's own `form.when.zone` string. */
  zoneLabel: string;
  /** Shown under the pair after the first submit or a server refusal. */
  error?: OpeningErrorKey;
  /** A stale tab hit the sales lock: the alert row at the top of the section. */
  lockedAlert: boolean;
  /** The switch is off and a date is typed or stored: the warning row under the off-effect note. */
  offWarning: boolean;
};

export type TicketSectionProps = {
  state: TicketSectionState;
  /** The `{gateway}` word, already resolved (display name or the neutral fallback). */
  gateway: string;
  /** The "Cobrar ingresso" switch. */
  on: boolean;
  onToggle: (next: boolean) => void;
  productId: string;
  onProductId: (value: string) => void;
  link: string;
  onLink: (value: string) => void;
  priceText: string;
  onPriceText: (value: string) => void;
  errors: TicketFieldErrors;
  /** Edit, confirmed presences, switch on, product not saved yet (D-748). */
  existingNote: boolean;
  /** A saved product whose switch was turned off (D-747). */
  offNote: boolean;
  /** The form's pending state: every control is disabled while the submit runs. */
  busy: boolean;
  /** Phase 10.2-12: the registration opening field; absent draws none. */
  opening?: TicketOpeningProps;
};

const ID = {
  product: 'event-gateway-id',
  link: 'event-checkout-url',
  price: 'event-ticket-price',
  opensDate: 'event-opens-date',
  opensTime: 'event-opens-time',
  opensError: 'event-opens-error',
} as const;

const HELPER = 'text-xs font-normal text-text-tertiary';
const WARNING_ROW = 'flex items-start gap-2 rounded-xl bg-warning/10 p-4';

export function TicketSection({
  state,
  gateway,
  on,
  onToggle,
  productId,
  onProductId,
  link,
  onLink,
  priceText,
  onPriceText,
  errors,
  existingNote,
  offNote,
  busy,
  opening,
}: TicketSectionProps) {
  const t = useTranslations('events');

  /** The catalog line of an error key; `idTaken` is the catalog's `taken`. */
  const error = (key: TicketErrorKey | undefined): string | undefined => {
    if (key === undefined) return undefined;
    return t(`form.ticket.errors.${key === 'idTaken' ? 'taken' : key}`, { gateway });
  };

  const fieldsLocked = state.fieldsDisabled || busy;
  // (d) shows every stored value disabled, the price included (sketch 021, `vinculado-indisponivel`).
  const priceLocked = state.priceDisabled || state.kind === 'linkedUnavailable' || busy;
  const showFields = on;

  return (
    <section
      data-event-ticket
      data-ticket-state={state.kind}
      aria-labelledby="event-ticket-title"
      className="flex flex-col gap-3"
    >
      <div>
        <SectionTitle variant="group" as="h3" id="event-ticket-title">
          {t('form.ticket.title')}
        </SectionTitle>
        <p className={`mt-1 ${HELPER}`}>{t('form.ticket.helper', { gateway })}</p>
      </div>

      {errors.section ? (
        <p
          role="alert"
          data-ticket-section-error
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-normal text-danger"
        >
          {error(errors.section)}
        </p>
      ) : null}

      {opening?.lockedAlert ? (
        <p
          role="alert"
          data-opening-section-error
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-normal text-danger"
        >
          {t('form.ticket.opensAt.errors.locked')}
        </p>
      ) : null}

      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-sm font-normal text-text">{t('form.ticket.switch')}</span>
        <Switch
          checked={on}
          onChange={onToggle}
          label={t('form.ticket.switch')}
          disabled={state.switchDisabled || busy}
          data-ticket-switch
        />
      </div>

      {state.kind === 'moduleOff' ? (
        <div data-ticket-module-off className={WARNING_ROW}>
          <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-xs font-normal text-text">{t('form.ticket.moduleOff')}</p>
        </div>
      ) : null}

      {state.kind === 'notConnected' ? (
        <p data-ticket-not-connected className={HELPER}>
          {t('form.ticket.notConnected')}
          {state.openPaymentsLink ? (
            <>
              {' '}
              <a
                href="/configuracoes/pagamentos"
                className="font-bold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {t('form.ticket.openPayments')}
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {state.kind === 'linkedUnavailable' ? (
        <div data-ticket-linked-unavailable className={WARNING_ROW}>
          <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-xs font-normal text-text">{t('form.ticket.linkedUnavailable')}</p>
        </div>
      ) : null}

      {state.kind === 'locked' ? (
        <div data-ticket-locked className="flex items-start gap-2 rounded-xl bg-bg-secondary p-4">
          <Lock aria-hidden size={16} className="mt-0.5 shrink-0 text-text-tertiary" />
          <p className="text-sm font-normal text-text-secondary">
            {t('form.ticket.soldLocked', { count: state.soldCount })}
          </p>
        </div>
      ) : null}

      {offNote ? (
        <p data-ticket-off-note className={HELPER}>
          {t('form.ticket.offEffect')}
        </p>
      ) : null}

      {opening?.offWarning ? (
        <div data-opening-off-warning className={WARNING_ROW}>
          <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-xs font-normal text-text">{t('form.ticket.opensAt.offWarning')}</p>
        </div>
      ) : null}

      {showFields ? (
        <div data-ticket-fields className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Input
              id={ID.product}
              name="gatewayProductId"
              label={t('form.ticket.idLabel', { gateway })}
              className="tabular-nums"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={PAYMENTS_MAX_PRODUCT_ID}
              value={productId}
              error={error(errors.id)}
              disabled={fieldsLocked}
              aria-describedby={errors.id ? `${ID.product}-error` : `${ID.product}-helper`}
              onChange={(event) => onProductId(event.target.value)}
            />
            {errors.id ? null : (
              <p id={`${ID.product}-helper`} className={HELPER}>
                {t('form.ticket.idHelper', { gateway })}
              </p>
            )}
            {state.recurringHint ? (
              <div data-ticket-recurring role="status" className={WARNING_ROW}>
                <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
                <p className="text-xs font-normal text-text">{t('form.ticket.recurring')}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Input
              id={ID.link}
              name="checkoutUrl"
              type="url"
              label={t('form.ticket.linkLabel')}
              placeholder={t('form.ticket.linkPlaceholder')}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={PAYMENTS_MAX_LINK}
              value={link}
              error={error(errors.link)}
              disabled={fieldsLocked}
              aria-describedby={errors.link ? `${ID.link}-error` : `${ID.link}-helper`}
              onChange={(event) => onLink(event.target.value)}
            />
            {errors.link ? null : (
              <p id={`${ID.link}-helper`} className={HELPER}>
                {t('form.ticket.linkHelper')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Input
              id={ID.price}
              name="ticketPrice"
              label={t('form.ticket.priceLabel')}
              placeholder={t('form.ticket.pricePlaceholder')}
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              value={priceText}
              error={error(errors.price)}
              disabled={priceLocked}
              aria-describedby={errors.price ? `${ID.price}-error` : `${ID.price}-helper`}
              onChange={(event) => onPriceText(event.target.value)}
              onBlur={() => {
                // The UI-D-383 / UI-D-524 echo: a price that parses is written back as `80,00`.
                const parsed = parseTicketPrice(priceText);
                if (parsed.ok && parsed.cents !== null) onPriceText(ticketPriceText(parsed.cents));
              }}
            />
            {errors.price ? null : (
              <p id={`${ID.price}-helper`} className={HELPER}>
                {t('form.ticket.priceHelper', { gateway })}
              </p>
            )}
            {existingNote ? (
              <p data-ticket-existing-note className={HELPER}>
                {t('form.ticket.existingNote')}
              </p>
            ) : null}
          </div>

          {opening ? <OpeningField opening={opening} busy={busy} /> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The "Abertura das inscrições" fieldset (UI-D-790, sketch 022 `form-abertura-*`): legend, the same
 * date/time pair geometry as the event's own start (one column below 360px), the zone line, then the
 * state's line. Locked (a): both inputs disabled with the stored value and the Lock line, no clear button.
 * The error takes the form's inline `role="alert"` slot under the pair.
 */
function OpeningField({ opening, busy }: { opening: TicketOpeningProps; busy: boolean }) {
  const t = useTranslations('events');
  const { pair, fieldState, error } = opening;
  const locked = fieldState === 'locked';
  const disabled = locked || busy;
  const hasValue = pair.date !== '' || pair.time !== '';
  const errorText = error ? t(`form.ticket.opensAt.errors.${error}`) : undefined;
  const describedBy = errorText ? ID.opensError : undefined;
  const invalidClass = errorText ? 'border-danger' : undefined;

  return (
    <fieldset
      data-ticket-opening
      data-opening-state={fieldState}
      className="flex min-w-0 flex-col gap-2"
    >
      <legend className="p-0 text-sm font-bold text-text">{t('form.ticket.opensAt.legend')}</legend>

      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_8rem]">
        <Input
          id={ID.opensDate}
          type="date"
          label={t('form.ticket.opensAt.date')}
          value={pair.date}
          disabled={disabled}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedBy}
          className={invalidClass}
          onChange={(event) => opening.onChange({ ...pair, date: event.target.value })}
        />
        <Input
          id={ID.opensTime}
          type="time"
          step={300}
          label={t('form.ticket.opensAt.time')}
          value={pair.time}
          disabled={disabled}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedBy}
          className={invalidClass}
          onChange={(event) => opening.onChange({ ...pair, time: event.target.value })}
        />
      </div>

      {errorText ? (
        <p
          id={ID.opensError}
          role="alert"
          data-opening-error
          className="break-words text-sm text-danger"
        >
          {errorText}
        </p>
      ) : null}

      <p data-opening-zone className={`break-words ${HELPER}`}>
        {t('form.when.zone', { zone: opening.zoneLabel })}
      </p>

      {locked ? (
        <p
          data-opening-locked
          className="flex items-start gap-2 break-words text-xs font-normal text-text-secondary"
        >
          <Lock aria-hidden size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
          <span>{t('form.ticket.opensAt.locked', { count: opening.soldCount })}</span>
        </p>
      ) : (
        <p data-opening-helper className={`break-words ${HELPER}`}>
          {t(fieldState === 'empty' ? 'form.ticket.opensAt.helper' : 'form.ticket.opensAt.filled')}
        </p>
      )}

      {fieldState === 'past' ? (
        <p
          data-opening-past
          className="flex items-start gap-2 break-words text-xs font-normal text-text-tertiary"
        >
          <Info aria-hidden size={14} className="mt-0.5 shrink-0" />
          <span>{t('form.ticket.opensAt.past')}</span>
        </p>
      ) : null}

      {hasValue && !locked ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          hitArea
          data-opening-clear
          disabled={busy}
          className="self-start"
          onClick={opening.onClear}
        >
          {t('form.ticket.opensAt.clear')}
        </Button>
      ) : null}
    </fieldset>
  );
}
