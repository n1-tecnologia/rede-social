'use client';

import { cn, Input } from '@rede-social/ui';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The three secrets of a project's manual access (UI-D-534), as the fields hold them. */
export type ProjectAccessValues = {
  databasePassword: string;
  serviceKey: string;
  publishableKey: string;
};

/** Already-translated messages: the component takes errors, it never decides them. */
export type ProjectAccessErrors = Partial<Record<keyof ProjectAccessValues | 'form', string>>;

const FIELDS = [
  { key: 'databasePassword', label: 'password' },
  { key: 'serviceKey', label: 'serviceKey' },
  { key: 'publishableKey', label: 'publishableKey' },
] as const;

/**
 * The three write-only fields of a Supabase project's manual access (09.2-18, UI-D-534, D-539,
 * D-541): the `postgres` password and the project's service and publishable keys. Props-only (the
 * state lives with the caller), shared by the new-tenant wizard (`requireAll`) and the Credenciais
 * replace sheet (`requireAll={false}`, plan 19).
 *
 * Write-only by construction, the contract of `IntegrationCard`'s secret field: `type="password"`,
 * `autoComplete="off"`, `spellCheck={false}`, `data-1p-ignore`, no show/hide control, never
 * pre-filled and NO `name` a password manager could recognise and offer to save. The caller owns the
 * values and clears them; this component renders exactly what it is given and nothing else, so a
 * cleared value is an empty field. `requireAll` only decides whether the info row (the wizard's
 * "we could not get the access ourselves") shows: the sheet brings its own introduction. A long
 * pasted key scrolls inside its input; it is never wrapped or shown.
 */
export function ProjectAccessFields({
  values,
  onChange,
  errors,
  requireAll,
  disabled = false,
  className,
}: {
  values: ProjectAccessValues;
  onChange: (patch: Partial<ProjectAccessValues>) => void;
  errors: ProjectAccessErrors;
  requireAll: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('platform.wizard.project.manual');

  return (
    <div data-project-access className={cn('flex flex-col gap-4', className)}>
      {requireAll ? (
        <div className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3">
          <KeyRound aria-hidden size={16} className="shrink-0 text-text-secondary" />
          <p className="text-xs text-text">{t('intro')}</p>
        </div>
      ) : null}
      {errors.form ? (
        <p role="alert" className="text-sm text-danger">
          {errors.form}
        </p>
      ) : null}
      {FIELDS.map(({ key, label }) => (
        <div key={key} className="flex flex-col gap-2">
          <Input
            id={`access-${key}`}
            type="password"
            label={t(label)}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            disabled={disabled}
            value={values[key]}
            onChange={(event) => onChange({ [key]: event.target.value })}
            error={errors[key]}
          />
          <p className="text-xs text-text-tertiary">{t('helper')}</p>
        </div>
      ))}
    </div>
  );
}
