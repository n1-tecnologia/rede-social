'use client';

import { NEUTRAL_BRAND } from '@tria/contracts/branding';
import { Button, Card, Input, SectionTitle } from '@tria/ui';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { LinkButton } from '@/app/(auth)/LinkButton';
import type { CreateTenantState } from '@/app/(platform)/plataforma/actions';
import { slugify } from '@/lib/slugify';

export interface NewTenantFormProps {
  /** The six real module keys (`REAL_TENANT_DEFAULT_MODULES`, passed from the server — D-17/D-19). */
  moduleKeys: string[];
  action: (prev: CreateTenantState, formData: FormData) => Promise<CreateTenantState>;
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="brand" size="lg" loading={pending} className="w-full md:w-auto">
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * The D-31 creation form (mockup `new-tenant`), on `useActionState(createTenantAction)`: display
 * name, slug (suggested by `slugify` while untouched, editable, immutable afterwards), the two
 * source colours, the module list (all six on by default) and the first-admin e-mail. Validation
 * happens on submit in the action (the same Zod the API runs) — the form never duplicates a regex
 * and never disables the submit on a partial fill; the action answers catalog KEYS that are
 * translated here.
 */
export function NewTenantForm({ moduleKeys, action }: NewTenantFormProps) {
  const t = useTranslations('platform');
  const [state, formAction] = useActionState(action, {});
  const [displayName, setDisplayName] = useState(state.values?.displayName ?? '');
  const [slug, setSlug] = useState(state.values?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(state.values?.slug));
  const [adminEmail, setAdminEmail] = useState(state.values?.adminEmail ?? '');

  const fieldError = (name: keyof NonNullable<CreateTenantState['fieldErrors']>) => {
    const key = state.fieldErrors?.[name];
    return key ? t(`new.errors.${key}`) : undefined;
  };

  return (
    <form action={formAction} noValidate>
      <Card className="flex flex-col gap-6 p-4 md:p-6">
        {state.error === 'generic' ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
          >
            {t('new.errors.generic')}
          </div>
        ) : null}

        <Input
          id="displayName"
          name="displayName"
          label={t('new.displayName')}
          maxLength={60}
          required
          autoComplete="off"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
          error={fieldError('displayName')}
        />

        <div className="flex flex-col gap-2">
          <Input
            id="slug"
            name="slug"
            label={t('new.slug')}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            error={fieldError('slug')}
          />
          <p className="text-xs text-text-tertiary">{t('new.slugHelper')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle variant="group">{t('new.colors')}</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              id="primary"
              name="primary"
              label={t('new.primary')}
              placeholder={t('new.hexPlaceholder')}
              maxLength={7}
              autoCapitalize="off"
              defaultValue={state.values?.primary ?? NEUTRAL_BRAND.primary}
              error={fieldError('primary')}
            />
            <Input
              id="secondary"
              name="secondary"
              label={t('new.secondary')}
              placeholder={t('new.hexPlaceholder')}
              maxLength={7}
              autoCapitalize="off"
              defaultValue={state.values?.secondary ?? NEUTRAL_BRAND.secondary}
              error={fieldError('secondary')}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle variant="group">{t('new.modules')}</SectionTitle>
          {moduleKeys.map((key) => (
            <input key={key} type="hidden" name="modules" value={key} />
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <Input
            id="adminEmail"
            name="adminEmail"
            type="email"
            icon={Mail}
            label={t('new.adminEmail')}
            autoComplete="off"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            error={fieldError('adminEmail')}
          />
          <p className="text-xs text-text-tertiary">{t('new.adminEmailHelper')}</p>
        </div>

        <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
          <LinkButton href="/plataforma" variant="ghost">
            {t('new.discard')}
          </LinkButton>
          <SubmitButton label={t('new.submit')} pendingLabel={t('new.pending')} />
        </div>
      </Card>
    </form>
  );
}
