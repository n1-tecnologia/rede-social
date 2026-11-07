'use client';

import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { SegmentedControl } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

export interface BranchValuesPickerProps {
  /** The opener whose answers can open the branch (its type, options and "Outro"). */
  opener: AdminQuestion;
  /** The ticked tokens: option ids for a choice opener, `'true'` / `'false'` for yes/no. */
  values: string[];
  onChange: (values: string[]) => void;
  /** The line under the picker (`role="alert"`), wired with `aria-describedby` and `aria-invalid`. */
  error?: string;
}

/**
 * The answers that open a branch (12.2-16, D-640, D-644, UI-D-671): the value controls of the 12.1 condition
 * editor, moved here unchanged in behaviour. For a Sim ou não opener the shipped `SegmentedControl` Sim / Não
 * with exactly one value; for a choice type a `fieldset` of 44px checkbox rows in the opener's OWN option order
 * (at least one ticked: ANY one of them opens the branch). Whatever order the boxes were ticked in, the tokens
 * leave in the opener's order. An opener that allows "Outro" adds the line that "Outro" opens nothing.
 *
 * Every label is React text (T-12.2-15). The error is tied to the control with `aria-describedby` and
 * `aria-invalid`; the server stays the authority on which tokens are real (`condition_invalid`).
 */
export function BranchValuesPicker({ opener, values, onChange, error }: BranchValuesPickerProps) {
  const ts = useTranslations('profileForm.admin.branches.sheet');
  const tc = useTranslations('profileForm.member.controls');
  const base = useId();
  const legendId = `${base}-legend`;
  const errorId = `${base}-error`;

  if (opener.type === 'yes_no') {
    return (
      <div className="flex min-w-0 flex-col gap-2" data-branch-values>
        {/* The legend of the shipped control: the group it draws is named by this line, so no second
            fieldset repeats the name to a screen reader. */}
        <p id={legendId} className="mb-2 text-sm font-bold text-text">
          {ts('legend')}
        </p>
        <SegmentedControl
          labelId={legendId}
          options={[
            { value: 'true', label: tc('yes') },
            { value: 'false', label: tc('no') },
          ]}
          value={values[0] ?? null}
          onChange={(value) => onChange([value])}
        />
        {error ? (
          <p id={errorId} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  function toggle(optionId: string, checked: boolean) {
    const wanted = new Set(values);
    if (checked) wanted.add(optionId);
    else wanted.delete(optionId);
    // The tokens keep the opener's own order, whatever order they were ticked in.
    onChange(opener.options.map((option) => option.id).filter((id) => wanted.has(id)));
  }

  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
      aria-describedby={error ? errorId : undefined}
      data-branch-values
    >
      <legend id={legendId} className="mb-2 p-0 text-sm font-bold text-text">
        {ts('legend')}
      </legend>
      {opener.options.map((option) => {
        const id = `${base}-value-${option.id}`;
        return (
          <div key={option.id} className="flex min-h-11 items-center gap-3">
            <input
              id={id}
              type="checkbox"
              checked={values.includes(option.id)}
              aria-invalid={error ? true : undefined}
              onChange={(event) => toggle(option.id, event.target.checked)}
              className="size-5 shrink-0 rounded border-border accent-brand"
            />
            <label htmlFor={id} className="min-w-0 flex-1 break-words text-sm text-text">
              {option.label}
            </label>
          </div>
        );
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <span className="text-xs font-normal text-text-tertiary">{ts('help')}</span>
      {opener.allowOther ? (
        <span className="text-xs font-normal text-text-tertiary">{ts('otherNote')}</span>
      ) : null}
    </fieldset>
  );
}
