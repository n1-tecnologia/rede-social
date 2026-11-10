'use client';

import {
  PROFESSIONAL_ID_EXAMPLES,
  PROFESSIONAL_ID_FORMATS,
  PROFILE_FORM_LIMITS,
  type ProfessionalIdFormat,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import { Input } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import type { FieldError } from './editor-state';
import { SheetSelect } from './SheetSelect';

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
  /** The question has answers: the pair may only widen (D-587), and a note says so. */
  widenOnly?: boolean;
  /** The mask of a professional_id question (quick 261110-ij7); empty until chosen. */
  format?: ProfessionalIdFormat | '';
  onFormatChange?: (value: ProfessionalIdFormat | '') => void;
  formatError?: FieldError;
  /** The question has answers: the format is read-only (D-587), and a note says so. */
  formatLocked?: boolean;
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
  widenOnly = false,
  format = '',
  onFormatChange,
  formatError,
  formatLocked = false,
}: LimitsFieldsProps) {
  const t = useTranslations('profileForm.admin.editor');

  if (type === 'professional_id') {
    return (
      <div className="flex flex-col gap-2">
        <SheetSelect
          id="pf-format"
          label={t('format.label')}
          value={format}
          disabled={formatLocked}
          error={formatError ? t(formatError.key, formatError.values) : undefined}
          helper={
            format === ''
              ? undefined
              : t('format.example', { example: PROFESSIONAL_ID_EXAMPLES[format] })
          }
          onChange={(value) => onFormatChange?.(value as ProfessionalIdFormat | '')}
        >
          <option value="" disabled={formatLocked}>
            {t('format.placeholder')}
          </option>
          {PROFESSIONAL_ID_FORMATS.map((key) => (
            <option key={key} value={key}>
              {t(`format.options.${key}`)}
            </option>
          ))}
        </SheetSelect>
        <p className="text-xs font-normal text-text-secondary">{t('format.note')}</p>
        {formatLocked ? (
          <p className="text-xs font-normal text-text-secondary">{t('locked.format')}</p>
        ) : null}
      </div>
    );
  }

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
        {widenOnly ? (
          <p className="text-xs font-normal text-text-secondary">{t('locked.limits')}</p>
        ) : null}
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
