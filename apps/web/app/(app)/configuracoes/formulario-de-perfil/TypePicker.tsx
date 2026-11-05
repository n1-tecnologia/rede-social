'use client';

import type { ProfileFormType } from '@rede-social/contracts/profile-form';
import { Button, cn } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  orderedTypes,
  QUESTION_TYPE_META,
  typeHintKey,
  typeNameKey,
} from '@/lib/profile-form/question-types';

export interface TypePickerProps {
  /** The chosen type, or `null` until the admin picks a tile. */
  value: ProfileFormType | null;
  onChange: (type: ProfileFormType) => void;
  /** Whether the 13 tiles are showing. With a type chosen and the grid closed the picker is one summary row. */
  gridOpen: boolean;
  onGridOpenChange: (open: boolean) => void;
  /**
   * The stored question has answers (D-587, UI-D-574): the picker is a read-only row with the plural
   * explanation and the way out, "Criar nova pergunta e arquivar esta".
   */
  lock?: { answerCount: number; onReplace: () => void };
  /** The choice options were dropped by the last type change: say so in a plain note (UI-D-570). */
  droppedOptions?: boolean;
  /**
   * The question opens others (12.1-17, D-632, UI-D-651): "Trocar tipo" does not open the grid, it asks the host to
   * show the refusal list under this row, because a new type would undo the conditions that depend on it.
   */
  blocked?: boolean;
  onBlocked?: () => void;
}

/**
 * The type picker (12-16, D-590, D-591, UI-D-570): a `fieldset` radiogroup "Tipo de resposta" of the
 * thirteen tiles, in the order of the one `QUESTION_TYPE_META` table (a new type adds a row there and a
 * tile here, nothing else). Each tile is a visually hidden native radio plus a label tile with the glyph,
 * the name and a one-line hint, so it is a plain radiogroup for assistive technology and the keyboard.
 *
 * Once a tile is chosen the grid collapses into "Tipo: {name}" and a ghost "Trocar tipo", which re-opens it.
 */
export function TypePicker({
  value,
  onChange,
  gridOpen,
  onGridOpenChange,
  lock,
  droppedOptions = false,
  blocked = false,
  onBlocked,
}: TypePickerProps) {
  const t = useTranslations('profileForm');
  const te = useTranslations('profileForm.admin.editor');

  if (lock && value !== null) {
    return (
      <div className="flex flex-col gap-3" data-type-locked>
        <p className="flex min-w-0 items-center gap-2 break-words text-sm font-bold text-text">
          <Lock aria-hidden size={16} className="shrink-0 text-text-secondary" />
          {te('type.current', { type: t(typeNameKey(value)) })}
        </p>
        <p className="text-xs font-normal text-text-secondary">
          {te('locked.type', { n: lock.answerCount })}
        </p>
        <Button variant="outline" fullWidth onClick={lock.onReplace}>
          {te('locked.replace')}
        </Button>
      </div>
    );
  }

  if (value !== null && !gridOpen) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 break-words text-sm font-bold text-text">
            {te('type.current', { type: t(typeNameKey(value)) })}
          </p>
          <button
            type="button"
            onClick={() => (blocked ? onBlocked?.() : onGridOpenChange(true))}
            className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-bold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {te('type.change')}
          </button>
        </div>
        {droppedOptions ? (
          <p className="text-xs font-normal text-text-secondary">{te('type.dropOptions')}</p>
        ) : null}
      </div>
    );
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-normal text-text-secondary">
        {te('type.legend')}
      </legend>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {orderedTypes().map((type) => {
          const Glyph = QUESTION_TYPE_META[type].glyph;
          const selected = value === type;
          const id = `pf-type-${type}`;
          return (
            <div key={type} className="relative">
              <input
                id={id}
                type="radio"
                name="pf-type"
                value={type}
                checked={selected}
                onChange={() => {
                  onChange(type);
                  onGridOpenChange(false);
                }}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex h-full min-h-14 cursor-pointer flex-col gap-1 rounded-xl border bg-card p-3 transition-colors',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-brand',
                  selected ? 'border-brand bg-brand/5' : 'border-border hover:bg-bg-hover',
                )}
              >
                <Glyph aria-hidden size={20} className={selected ? 'text-brand' : 'text-text'} />
                <span className="break-words text-sm font-bold text-text">
                  {t(typeNameKey(type))}
                </span>
                <span className="line-clamp-2 text-xs font-normal text-text-tertiary">
                  {t(typeHintKey(type))}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
