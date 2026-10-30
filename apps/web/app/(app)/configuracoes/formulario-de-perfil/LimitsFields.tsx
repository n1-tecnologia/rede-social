'use client';

import { PROFILE_FORM_LIMITS, type ProfileFormType } from '@rede-social/contracts/profile-form';
import { Input } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import type { FieldError } from './editor-state';

export interface LimitsFieldsProps {
  type: ProfileFormType;
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  /** The text of the minimum or the maximum is not a value of the type. */
  minError?: FieldError;
  maxError?: FieldError;
  /** The pair rule: the minimum is above the maximum. */
  pairError?: FieldError;
}

/** The one-line note of each type that has no field of its own (UI-D-572). Text types carry their fixed cap. */
const NOTE_KEYS: Partial<Record<ProfileFormType, string>> = {
  short_text: 'notes.shortText',
  long_text: 'notes.longText',
  rating: 'notes.rating',
  yes_no: 'notes.yesNo',
  acceptance: 'notes.acceptance',
  phone: 'notes.phone',
  email: 'notes.email',
  link: 'notes.link',
};

/**
 * The type-specific block of a non-choice question (12-16, D-590, UI-D-572). Number and date show the
 * minimum and the maximum as a pair (`inputMode="decimal"` for a number, `type="date"` for a date, the shipped
 * iOS-safe field); every other type carries a single note and NO extra field: the admin never types a mask,
 * a placeholder or a character cap, because the caps are fixed.
 */
export function LimitsFields({
  type,
  min,
  max,
  onMinChange,
  onMaxChange,
  minError,
  maxError,
  pairError,
}: LimitsFieldsProps) {
  const t = useTranslations('profileForm.admin.editor');

  if (type === 'number' || type === 'date') {
    const date = type === 'date';
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
          <Input
            id="pf-min"
            type={date ? 'date' : 'text'}
            inputMode={date ? undefined : 'decimal'}
            autoComplete="off"
            label={date ? t('limits.minDate') : t('limits.minNumber')}
            value={min}
            error={minError ? t(minError.key, minError.values) : undefined}
            onChange={(event) => onMinChange(event.target.value)}
          />
          <Input
            id="pf-max"
            type={date ? 'date' : 'text'}
            inputMode={date ? undefined : 'decimal'}
            autoComplete="off"
            label={date ? t('limits.maxDate') : t('limits.maxNumber')}
            value={max}
            error={maxError ? t(maxError.key, maxError.values) : undefined}
            onChange={(event) => onMaxChange(event.target.value)}
          />
        </div>
        {pairError ? (
          <p role="alert" className="text-sm text-danger">
            {t(pairError.key, pairError.values)}
          </p>
        ) : null}
      </div>
    );
  }

  const noteKey = NOTE_KEYS[type];
  if (!noteKey) return null;
  const cap = type === 'long_text' ? PROFILE_FORM_LIMITS.longText : PROFILE_FORM_LIMITS.shortText;
  return <p className="text-xs font-normal text-text-secondary">{t(noteKey, { max: cap })}</p>;
}
