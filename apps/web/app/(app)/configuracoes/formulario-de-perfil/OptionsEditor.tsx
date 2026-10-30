'use client';

import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { Button, IconButton, Input, Switch } from '@rede-social/ui';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef } from 'react';
import {
  addOptionRow,
  moveOptionRow,
  type OptionDraft,
  type OptionsErrors,
  removeOptionRow,
  renameOptionRow,
} from './editor-state';

export interface OptionsEditorProps {
  options: OptionDraft[];
  allowOther: boolean;
  /** The list's rules found by the last validation (or refused by the server). */
  errors?: OptionsErrors;
  onChange: (options: OptionDraft[]) => void;
  onAllowOtherChange: (value: boolean) => void;
}

const rowId = (key: string) => `pf-option-${key}`;
const buttonId = (key: string, direction: 'up' | 'down') => `${rowId(key)}-${direction}`;

/**
 * The options of a choice question (12-16, D-592, UI-D-571): a `fieldset` "Opções" of rows, each an
 * `Input` (80 characters, `aria-label` "Opção {n}") and three 44px `IconButton`s that wrap to a second line
 * at 320px, then a ghost "Adicionar opção" that moves focus into the new row, and the per-question
 * "Incluir a opção “Outro”" switch (not counted in the 20).
 *
 * The rules are the draft's (`validateOptions`) and appear as `role="alert"` sentences under the list.
 * Remove is disabled at two options and add at twenty. A reorder keeps focus on the pressed button at its
 * new place (the sibling when that button is now disabled at an edge), because a moved row loses it.
 * Every stored option keeps its server id in the draft, so a save sends `{ id, label }` and reordering or
 * renaming a never-answered option never changes what stored answers mean.
 */
export function OptionsEditor({
  options,
  allowOther,
  errors,
  onChange,
  onAllowOtherChange,
}: OptionsEditorProps) {
  const t = useTranslations('profileForm.admin.editor');
  const max = PROFILE_FORM_LIMITS.options;
  const atMax = options.length >= max;
  const atMin = options.length <= 2;

  const pendingFocus = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `options` is the trigger, focus is read through the ref
  useLayoutEffect(() => {
    const wanted = pendingFocus.current;
    if (!wanted) return;
    pendingFocus.current = null;
    const [first, second] = wanted.split('|');
    for (const id of [first, second]) {
      const element = id ? document.getElementById(id) : null;
      if (element && !(element as HTMLButtonElement).disabled) {
        element.focus();
        return;
      }
    }
  }, [options]);

  function add() {
    if (atMax) return;
    const next = addOptionRow(options);
    pendingFocus.current = rowId(next.key);
    onChange(next.options);
  }

  function move(key: string, direction: 'up' | 'down') {
    const other = direction === 'up' ? 'down' : 'up';
    pendingFocus.current = `${buttonId(key, direction)}|${buttonId(key, other)}`;
    onChange(moveOptionRow(options, key, direction === 'up' ? -1 : 1));
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-normal text-text-secondary">
        {t('options.legend')}
      </legend>

      <ul className="flex flex-col gap-2">
        {options.map((option, index) => {
          const invalid = errors?.rows[option.key] !== undefined;
          return (
            <li key={option.key} className="flex flex-wrap items-center gap-2">
              <Input
                id={rowId(option.key)}
                aria-label={t('options.label', { n: index + 1 })}
                placeholder={t('options.placeholder')}
                maxLength={PROFILE_FORM_LIMITS.optionLabel}
                value={option.label}
                aria-invalid={invalid || undefined}
                containerClassName="min-w-32 flex-1"
                onChange={(event) =>
                  onChange(renameOptionRow(options, option.key, event.target.value))
                }
              />
              <span className="flex shrink-0 items-center">
                <IconButton
                  id={buttonId(option.key, 'up')}
                  icon={ArrowUp}
                  size={18}
                  label={t('options.up', { n: index + 1 })}
                  disabled={index === 0}
                  onClick={() => move(option.key, 'up')}
                />
                <IconButton
                  id={buttonId(option.key, 'down')}
                  icon={ArrowDown}
                  size={18}
                  label={t('options.down', { n: index + 1 })}
                  disabled={index === options.length - 1}
                  onClick={() => move(option.key, 'down')}
                />
                <IconButton
                  icon={X}
                  size={18}
                  label={t('options.remove', { n: index + 1 })}
                  disabled={atMin}
                  onClick={() => onChange(removeOptionRow(options, option.key))}
                />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1" data-options-errors>
        {errors?.issues.map((issue) => (
          <p key={issue} role="alert" className="text-sm text-danger">
            {t(`options.err.${issue}`, { max })}
          </p>
        ))}
        {atMax && !errors?.issues.includes('max') ? (
          <p className="text-xs font-normal text-text-tertiary">{t('options.err.max', { max })}</p>
        ) : null}
      </div>

      <div>
        <Button variant="ghost" size="md" disabled={atMax} onClick={add}>
          <Plus aria-hidden size={18} />
          {t('options.add')}
        </Button>
      </div>

      <div className="flex min-h-11 items-start justify-between gap-3 py-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="break-words text-sm font-bold text-text">{t('other.label')}</span>
          <span id="pf-other-helper" className="text-xs font-normal text-text-tertiary">
            {t('other.helper')}
          </span>
        </div>
        <Switch
          id="pf-other"
          label={t('other.label')}
          aria-describedby="pf-other-helper"
          checked={allowOther}
          onChange={onAllowOtherChange}
        />
      </div>
    </fieldset>
  );
}
