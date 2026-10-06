'use client';

import {
  ADMIN_ICONS,
  AdminBadge,
  AdminIconGlyph,
  type AdminIconId,
  isAdminIcon,
} from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { SelectMenu } from '@/components/forms/SelectMenu';

export interface AdminIconPickerProps {
  value: AdminIconId;
  onChange: (icon: AdminIconId) => void;
  /** The name as typed above, drawn in the preview beside the picked icon. */
  previewName: string;
  /** The mark's accessible name ("Administrador"). */
  adminLabel: string;
}

/**
 * "Ícone ao lado do nome" on "Editar perfil" (2026-10-06, administrators only), a choice menu
 * (`SelectMenu`): the trigger IS the preview, the name as typed with the picked mark beside it, as a
 * post draws it, then the icon's name and the chevron; a press opens the list of the ten glyphs of
 * `ADMIN_ICONS`, each with its name, painted in the tenant's secondary colour as they will sit
 * beside the name. `data-admin-icon-option` marks each option.
 */
export function AdminIconPicker({
  value,
  onChange,
  previewName,
  adminLabel,
}: AdminIconPickerProps) {
  const t = useTranslations('profile');
  const labelId = useId();
  const hintId = useId();
  const options = ADMIN_ICONS.map((icon) => ({
    id: icon,
    label: t(`edit.adminIcon.names.${icon}`),
  }));

  return (
    <div data-admin-icon-picker className="flex min-w-0 flex-col gap-2">
      <span id={labelId} className="text-sm font-normal text-text-secondary">
        {t('edit.adminIcon.label')}
      </span>
      <SelectMenu
        options={options}
        value={value}
        onChange={(id) => {
          if (isAdminIcon(id)) onChange(id);
        }}
        labelId={labelId}
        describedBy={hintId}
        optionAttribute="admin-icon-option"
        lead={(id) =>
          isAdminIcon(id) ? (
            <span className="flex size-6 shrink-0 items-center justify-center text-brand-secondary">
              <AdminIconGlyph icon={id} size={22} />
            </span>
          ) : null
        }
        triggerLead={
          // The preview is a picture of the choice; the trigger's name is the label and the value.
          <span
            aria-hidden
            data-admin-icon-preview
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <span className="min-w-0 truncate text-sm font-bold text-text">{previewName}</span>
            <AdminBadge label={adminLabel} icon={value} size={16} />
          </span>
        }
        valueClassName="flex-none text-sm text-text-secondary"
      />
      <p id={hintId} className="text-xs text-text-tertiary">
        {t('edit.adminIcon.hint')}
      </p>
    </div>
  );
}
