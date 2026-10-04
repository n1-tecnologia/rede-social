'use client';

import { Button, cn, Input, SectionTitle } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type KeyboardEvent, useId } from 'react';
import { ADDRESS_CAPS, type AddressParts, cepDigits, formatCep, isCep } from '@/lib/event-address';
import type { CepLookupStatus } from './useCepLookup';

/** The address inputs' ids, also the order Enter walks (`enterKeyHint="next"`). */
export const ADDRESS_FIELD_IDS = {
  cep: 'event-cep',
  street: 'event-street',
  number: 'event-number',
  complement: 'event-complement',
  district: 'event-district',
  city: 'event-city',
  state: 'event-state',
} as const;

const ENTER_CHAIN: readonly string[] = Object.values(ADDRESS_FIELD_IDS);

/**
 * `enterKeyHint="next"` keeps its word: the keyboard's Next key (Enter) moves to the following
 * address field instead of submitting the whole form mid-address. The UF, last, keeps Enter native.
 */
function nextOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
  const next = ENTER_CHAIN[ENTER_CHAIN.indexOf(event.currentTarget.id) + 1];
  if (!next) return;
  event.preventDefault();
  document.getElementById(next)?.focus();
}

/**
 * A digit TYPED into a full CEP is refused, as a `maxLength` would refuse it: the field keeps the
 * first 8 digits, so a digit typed before or inside `01310-200` would shift it into another CEP
 * (`90131-020`) and look that one up. Refused: a typed insertion (`insertText`) that leaves more
 * than 8 digits with nothing selected, which the length tells (the value grew by exactly what was
 * typed). A paste, a drop or a typed replacement of a selection goes through, so a pasted
 * "CEP 01310-200" still lands whole. The shown value goes back with the caret where it was, ahead
 * of React's controlled restore, which would leave the caret at the end.
 */
function refusedKeystroke(event: ChangeEvent<HTMLInputElement>, stored: string): boolean {
  const native = event.nativeEvent;
  if (!(native instanceof InputEvent) || native.inputType !== 'insertText' || !isCep(stored)) {
    return false;
  }
  const input = event.currentTarget;
  const typed = native.data ?? '';
  const shown = formatCep(stored);
  const raw = input.value;
  if (raw.replace(/\D/g, '').length <= 8 || raw.length !== shown.length + typed.length) {
    return false;
  }
  const caret = Math.max(0, (input.selectionStart ?? raw.length) - typed.length);
  input.value = shown;
  input.setSelectionRange(caret, caret);
  return true;
}

export type AddressFieldErrors = Partial<
  Record<'cep' | 'street' | 'city' | 'state' | 'tooLong', string>
>;

export type EventAddressFieldsProps = {
  parts: AddressParts;
  status: CepLookupStatus;
  /** Shown only after the form's first submit (the form computes them; UI E10/empty). */
  errors: AddressFieldErrors;
  /**
   * The CEP's DIGITS on every change but a refused keystroke (`refusedKeystroke`): the form stores
   * them and asks `useCepLookup`, skipping digits it already holds (EventForm's `changeCep`).
   */
  onCepChange: (digits: string) => void;
  onPartChange: (key: Exclude<keyof AddressParts, 'cep'>, value: string) => void;
  /** Edit mode, when the event arrived with a free-text address: back to that text, untouched. */
  onKeepLegacy?: () => void;
};

/**
 * PDF item #10: the in-person address as separate fields, CEP first (the lookup fills rua, bairro,
 * cidade and UF), then número and complemento, which no lookup ever touches. A controlled view: the
 * parts, the lookup and the errors live in `EventForm`, which composes the parts into the one
 * `address` string (`lib/event-address.ts`).
 *
 * The block is a `div` with the group role, named by its visible "Endereço" title (the
 * SegmentedControl rule, UI-D-206), rather than a `<fieldset>`: its `<legend>` could not share the
 * title row with "Manter endereço anterior" without that button joining the group's name.
 *
 * Geometry for the 390px phone and below: every grid track is `minmax(0, …)` or fixed (`5rem` for
 * the UF), so no field can widen the page (PDF item #11), and the cidade/UF errors render BELOW
 * their row, one line each (the "Quando" pattern), so the 80px UF cell never wraps a sentence.
 *
 * Every input is `autoComplete="off"`: an event's venue is a public place, and iOS AutoFill would
 * otherwise offer the admin's own home address. The CEP is `inputMode="numeric"`, shown as
 * `00000-000` while typed and stored as digits; it carries no `maxLength`, because a cap would cut
 * a pasted "CEP 01310-200" before its digits. The field keeps only the first 8 digits, and what a
 * cap would have refused, a digit typed into a full CEP, `refusedKeystroke` refuses.
 */
export function EventAddressFields({
  parts,
  status,
  errors,
  onCepChange,
  onPartChange,
  onKeepLegacy,
}: EventAddressFieldsProps) {
  const t = useTranslations('events');
  const titleId = useId();
  const numberHelperId = `${ADDRESS_FIELD_IDS.number}-helper`;
  const cityErrorId = `${ADDRESS_FIELD_IDS.city}-error`;
  const stateErrorId = `${ADDRESS_FIELD_IDS.state}-error`;

  const statusLine: Record<CepLookupStatus, string> = {
    idle: '',
    loading: t('form.cep.searching'),
    found: t('form.cep.found'),
    generic: t('form.cep.generic'),
    not_found: t('form.cep.notFound'),
    failed: t('form.cep.failed'),
  };
  const statusDanger = status === 'not_found' || status === 'failed';

  return (
    // biome-ignore lint/a11y/useSemanticElements: a titled group, not a fieldset (see the docblock)
    <div
      role="group"
      aria-labelledby={titleId}
      data-event-address="structured"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <SectionTitle id={titleId} variant="group" as="h3">
          {t('form.address.label')}
        </SectionTitle>
        {onKeepLegacy ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-event-address-keep-legacy
            onClick={onKeepLegacy}
          >
            {t('form.address.keepLegacy')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Input
          id={ADDRESS_FIELD_IDS.cep}
          name="cep"
          label={t('form.cep.label')}
          placeholder={t('form.cep.placeholder')}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          value={formatCep(parts.cep)}
          required
          error={errors.cep}
          onKeyDown={nextOnEnter}
          onChange={(event) => {
            if (!refusedKeystroke(event, parts.cep)) onCepChange(cepDigits(event.target.value));
          }}
        />
        {/* Always mounted, so the polite region exists before its first message; min-h-4 keeps the
            one-line messages from shifting the fields below. */}
        <p
          aria-live="polite"
          data-event-cep-status={status}
          className={cn(
            'min-h-4 text-xs font-normal',
            statusDanger ? 'text-danger' : 'text-text-tertiary',
          )}
        >
          {statusLine[status]}
        </p>
      </div>

      <Input
        id={ADDRESS_FIELD_IDS.street}
        name="street"
        label={t('form.street.label')}
        placeholder={t('form.street.placeholder')}
        value={parts.street}
        maxLength={ADDRESS_CAPS.street}
        autoComplete="off"
        enterKeyHint="next"
        required
        error={errors.street}
        onKeyDown={nextOnEnter}
        onChange={(event) => onPartChange('street', event.target.value)}
      />

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <Input
            id={ADDRESS_FIELD_IDS.number}
            name="number"
            label={t('form.number.label')}
            placeholder={t('form.number.placeholder')}
            value={parts.number}
            maxLength={ADDRESS_CAPS.number}
            autoComplete="off"
            enterKeyHint="next"
            aria-describedby={numberHelperId}
            onKeyDown={nextOnEnter}
            onChange={(event) => onPartChange('number', event.target.value)}
          />
          <Input
            id={ADDRESS_FIELD_IDS.complement}
            name="complement"
            label={t('form.complement.label')}
            placeholder={t('form.complement.placeholder')}
            value={parts.complement}
            maxLength={ADDRESS_CAPS.complement}
            autoComplete="off"
            enterKeyHint="next"
            onKeyDown={nextOnEnter}
            onChange={(event) => onPartChange('complement', event.target.value)}
          />
        </div>
        <p id={numberHelperId} className="text-xs font-normal text-text-tertiary">
          {t('form.number.helper')}
        </p>
      </div>

      <Input
        id={ADDRESS_FIELD_IDS.district}
        name="district"
        label={t('form.district.label')}
        placeholder={t('form.district.placeholder')}
        value={parts.district}
        maxLength={ADDRESS_CAPS.district}
        autoComplete="off"
        enterKeyHint="next"
        onKeyDown={nextOnEnter}
        onChange={(event) => onPartChange('district', event.target.value)}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
        <Input
          id={ADDRESS_FIELD_IDS.city}
          name="city"
          label={t('form.city.label')}
          placeholder={t('form.city.placeholder')}
          value={parts.city}
          maxLength={ADDRESS_CAPS.city}
          autoComplete="off"
          enterKeyHint="next"
          required
          aria-invalid={errors.city ? true : undefined}
          aria-describedby={errors.city ? cityErrorId : undefined}
          className={errors.city ? 'border-danger' : undefined}
          onKeyDown={nextOnEnter}
          onChange={(event) => onPartChange('city', event.target.value)}
        />
        <Input
          id={ADDRESS_FIELD_IDS.state}
          name="state"
          label={t('form.state.label')}
          placeholder={t('form.state.placeholder')}
          value={parts.state}
          maxLength={2}
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="done"
          required
          aria-invalid={errors.state ? true : undefined}
          aria-describedby={errors.state ? stateErrorId : undefined}
          className={cn('uppercase', errors.state && 'border-danger')}
          onChange={(event) =>
            onPartChange('state', event.target.value.replace(/[^a-z]/gi, '').toUpperCase())
          }
        />
      </div>
      {errors.city ? (
        <p id={cityErrorId} role="alert" className="text-sm text-danger">
          {errors.city}
        </p>
      ) : null}
      {errors.state ? (
        <p id={stateErrorId} role="alert" className="text-sm text-danger">
          {errors.state}
        </p>
      ) : null}
      {errors.tooLong ? (
        <p role="alert" data-event-address-too-long className="text-sm text-danger">
          {errors.tooLong}
        </p>
      ) : null}
    </div>
  );
}
