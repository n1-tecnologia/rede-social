'use client';

import {
  contrastReport,
  deriveBrandColors,
  hexColorSchema,
  NEUTRAL_BRAND,
} from '@rede-social/contracts/branding';
import { BrandPreview } from '@rede-social/core/ui';
import { Button, Card, Input, SectionTitle, Switch } from '@rede-social/ui';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { LinkButton } from '@/app/(auth)/LinkButton';
import type { CreateTenantState } from '@/app/(platform)/plataforma/actions';
import { slugify } from '@/lib/slugify';
import { ColorField } from './ColorField';
import { ContrastFeedback, hasLowContrast } from './ContrastFeedback';

export interface NewTenantFormProps {
  /** The six real module keys (`REAL_TENANT_DEFAULT_MODULES`, passed from the server — D-17/D-19). */
  moduleKeys: string[];
  action: (prev: CreateTenantState, formData: FormData) => Promise<CreateTenantState>;
  /**
   * Override of the preview slot between the colour fields and the contrast readout. By default
   * (02-14) the kernel `BrandPreview` renders there — the light/dark mini-shells of UI-SPEC fed with
   * the two source colours as last validly typed and the typed display name (no logo yet).
   */
  renderPreview?: (colors: { primary: string; secondary: string }) => ReactNode;
}

function SubmitButton({
  label,
  pendingLabel,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="brand"
      size="lg"
      loading={pending}
      disabled={disabled}
      className="w-full md:w-auto"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * The D-31 creation form (mockup `new-tenant`), on `useActionState(createTenantAction)`: display
 * name, slug (suggested by `slugify` while untouched, editable, immutable afterwards), the two
 * source colours with live swatches and the contrast readout (`contrastReport` over
 * `deriveBrandColors`, computed in the browser from the last VALID hexes — the API persists its own
 * copy on save), six module switches all on by default, and the first-admin e-mail. Validation
 * happens on submit in the action (the same Zod the API runs) — the form never duplicates a regex
 * and never disables the submit on a partial fill; the ONLY gate is the "Salvar mesmo assim"
 * acknowledgement when a contrast check fails. The action answers catalog KEYS translated here.
 */
export function NewTenantForm({ moduleKeys, action, renderPreview }: NewTenantFormProps) {
  const t = useTranslations('platform');
  const tb = useTranslations('platformBranding');
  const [state, formAction] = useActionState(action, {});
  const [displayName, setDisplayName] = useState(state.values?.displayName ?? '');
  const [slug, setSlug] = useState(state.values?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(state.values?.slug));
  const [primary, setPrimary] = useState(state.values?.primary || NEUTRAL_BRAND.primary);
  const [secondary, setSecondary] = useState(state.values?.secondary || NEUTRAL_BRAND.secondary);
  const [adminEmail, setAdminEmail] = useState(state.values?.adminEmail ?? '');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      moduleKeys.map((key) => [
        key,
        state.values?.modules ? state.values.modules.includes(key) : true,
      ]),
    ),
  );
  const [confirmed, setConfirmed] = useState(false);

  // The readout follows the last VALID pair (E11/E12 partial): an invalid keystroke keeps it.
  const [lastValid, setLastValid] = useState({
    primary: hexColorSchema.safeParse(primary).success ? primary : NEUTRAL_BRAND.primary,
    secondary: hexColorSchema.safeParse(secondary).success ? secondary : NEUTRAL_BRAND.secondary,
  });
  const report = useMemo(() => contrastReport(deriveBrandColors(lastValid)), [lastValid]);
  const lowContrast = hasLowContrast(report);

  const onColor = (which: 'primary' | 'secondary') => (hex: string) => {
    (which === 'primary' ? setPrimary : setSecondary)(hex);
    const check = hexColorSchema.safeParse(hex);
    if (check.success) setLastValid((prev) => ({ ...prev, [which]: check.data }));
  };

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
            <ColorField
              id="primary"
              name="primary"
              label={t('new.primary')}
              value={primary}
              onChange={onColor('primary')}
              error={fieldError('primary')}
              pickLabel={t('new.pickColor')}
              placeholder={t('new.hexPlaceholder')}
            />
            <ColorField
              id="secondary"
              name="secondary"
              label={t('new.secondary')}
              value={secondary}
              onChange={onColor('secondary')}
              error={fieldError('secondary')}
              pickLabel={t('new.pickColor')}
              placeholder={t('new.hexPlaceholder')}
            />
          </div>
          {renderPreview ? (
            renderPreview(lastValid)
          ) : (
            <BrandPreview
              colors={lastValid}
              displayName={displayName.trim() || tb('preview.namePlaceholder')}
              logoUrl={null}
              labels={{
                light: tb('preview.light'),
                dark: tb('preview.dark'),
                lightAria: tb('preview.lightAria'),
                darkAria: tb('preview.darkAria'),
                login: tb('preview.login'),
              }}
            />
          )}
          <ContrastFeedback
            report={report}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
          />
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle variant="group">{t('new.modules')}</SectionTitle>
          <ul className="rounded-xl border border-border">
            {moduleKeys.map((key) => (
              <li
                key={key}
                className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-bold text-text">{t(`moduleNames.${key}`)}</span>
                  <span className="text-xs text-text-tertiary">
                    {t(`moduleDescriptions.${key}`)}
                  </span>
                </div>
                <Switch
                  checked={enabled[key] ?? true}
                  onChange={(checked) => setEnabled((prev) => ({ ...prev, [key]: checked }))}
                  label={t(`moduleNames.${key}`)}
                />
                {enabled[key] ? <input type="hidden" name="modules" value={key} /> : null}
              </li>
            ))}
          </ul>
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
          <SubmitButton
            label={t('new.submit')}
            pendingLabel={t('new.pending')}
            disabled={lowContrast && !confirmed}
          />
        </div>
      </Card>
    </form>
  );
}
