'use client';

import { Button, Switch } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface VisibilitySwitchesProps {
  required: boolean;
  showOnProfile: boolean;
  onRequiredChange: (value: boolean) => void;
  onShowOnProfileChange: (value: boolean) => void;
  /**
   * The ratchet toward private once the question has answers (D-593, PU-1, UI-D-575). `frozen`: the question is
   * private, so the switch is disabled and off, with the reason and the way out. `ratchet`: it is public, so it
   * may be turned off, and a line warns it cannot be turned on again while answers exist.
   */
  lock?: { frozen: boolean; ratchet: boolean; onReplace: () => void };
  /**
   * 12.2-18 (WR-06, PFORM-53, UI-D-675): the title of the nearest opener on the question's branch chain that does
   * not show on the profile. The question cannot show on the profile then (the mere presence of its answer would
   * reveal the opener's private one), so the "no perfil" switch is disabled and off, with this as its reason.
   */
  privateOpener?: string;
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
  lock,
  privateOpener,
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
        helper={
          <>
            {privateOpener !== undefined ? (
              <p className="break-words">{t('privacy.branchPrivate', { opener: privateOpener })}</p>
            ) : null}
            {lock?.frozen ? (
              <>
                <p>{t('public.frozen')}</p>
                <Button variant="outline" fullWidth onClick={lock.onReplace}>
                  {t('locked.replace')}
                </Button>
              </>
            ) : privateOpener === undefined ? (
              <>
                <p>{t('public.helper')}</p>
                {lock?.ratchet && showOnProfile ? <p>{t('public.ratchet')}</p> : null}
              </>
            ) : null}
          </>
        }
        checked={lock?.frozen || privateOpener !== undefined ? false : showOnProfile}
        disabled={lock?.frozen || privateOpener !== undefined}
        onChange={onShowOnProfileChange}
      />
    </div>
  );
}
