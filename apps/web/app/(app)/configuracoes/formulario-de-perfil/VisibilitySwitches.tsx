'use client';

import { Switch } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface VisibilitySwitchesProps {
  required: boolean;
  showOnProfile: boolean;
  onRequiredChange: (value: boolean) => void;
  onShowOnProfileChange: (value: boolean) => void;
}

interface RowProps {
  id: string;
  label: string;
  helper: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

/** One switch row (UI-D-573): the label (14/700) and its helper (12/400 tertiary) beside the shipped `Switch`. */
function SwitchRow({ id, label, helper, checked, disabled, onChange }: RowProps) {
  const helperId = `${id}-helper`;
  return (
    <div className="flex min-h-11 items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span id={`${id}-label`} className="break-words text-sm font-bold text-text">
          {label}
        </span>
        <div id={helperId} className="flex flex-col gap-2 text-xs font-normal text-text-tertiary">
          {helper}
        </div>
      </div>
      <Switch
        id={id}
        label={label}
        aria-describedby={helperId}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * The two switch rows (12-16, D-585, D-593, UI-D-573): "Obrigatória" and "Mostrar no perfil do membro"
 * (the admin-voice label of what the member reads as "mostrar no meu perfil"), in a `divide-y` block with
 * no card around it.
 */
export function VisibilitySwitches({
  required,
  showOnProfile,
  onRequiredChange,
  onShowOnProfileChange,
}: VisibilitySwitchesProps) {
  const t = useTranslations('profileForm.admin.editor');
  return (
    <div className="flex flex-col divide-y divide-divider">
      <SwitchRow
        id="pf-required"
        label={t('required.label')}
        helper={<p>{t('required.helper')}</p>}
        checked={required}
        onChange={onRequiredChange}
      />
      <SwitchRow
        id="pf-public"
        label={t('public.label')}
        helper={<p>{t('public.helper')}</p>}
        checked={showOnProfile}
        onChange={onShowOnProfileChange}
      />
    </div>
  );
}
