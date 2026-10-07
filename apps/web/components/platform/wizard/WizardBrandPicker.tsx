'use client';

import { Card } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { BrandImagePicker } from '../BrandImagePicker';
import { useTenantDraft } from './TenantDraftProvider';

/**
 * Step 2 (Personalização), its last card: before the tenant exists the logos and the optional
 * square icon are PICKED, not uploaded (`BrandImagePicker`, the same zones and copy as the tenant
 * page's Marca tab). The picked image shows right away, here and in the preview device; the files
 * stay in this browser's memory until the summary's confirmation uploads them to the new tenant
 * (`runBrandingUpload`). What only the server checks (a corrupt image, an unsafe SVG) is reported by
 * that confirmation.
 *
 * Two logos (2026-10-05): the light mode's, the one the tenant is created with, and the dark
 * mode's own, optional, shown on a dark ground here and by the previews while their theme is dark
 * (without it the light mode's logo stands in both). The dark one is PREVIEW ONLY: the API has no
 * field for it, so the creation never sends it, and its hint says so.
 */
export function WizardBrandPicker() {
  const t = useTranslations('platformBranding');
  const tw = useTranslations('platform.wizard');
  const { draft, logo, logoDark, icon, setImage } = useTenantDraft();
  const tenant = draft.displayName.trim() || t('preview.namePlaceholder');

  return (
    <Card className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
      <BrandImagePicker
        marker={{ 'data-wizard-image': 'logo' }}
        image={logo}
        onPick={(file) => setImage('logo', file)}
        onRemove={() => setImage('logo', null)}
        title={tw('brand.logoLight.title')}
        caption={logo ? t('logo.replace') : t('logo.upload')}
        hint={logo ? t('logo.hint') : t('logo.empty')}
        alt={t('logo.alt', { tenant })}
      />
      <BrandImagePicker
        marker={{ 'data-wizard-image': 'logoDark' }}
        image={logoDark}
        dark
        onPick={(file) => setImage('logoDark', file)}
        onRemove={() => setImage('logoDark', null)}
        title={tw('brand.logoDark.title')}
        caption={logoDark ? tw('brand.logoDark.replace') : tw('brand.logoDark.upload')}
        hint={tw('brand.logoDark.hint')}
        alt={tw('brand.logoDark.alt', { tenant })}
      />
      <BrandImagePicker
        marker={{ 'data-wizard-image': 'icon' }}
        image={icon}
        onPick={(file) => setImage('icon', file)}
        onRemove={() => setImage('icon', null)}
        title={t('icon.title')}
        caption={icon ? t('icon.replace') : t('icon.upload')}
        hint={t('icon.helper')}
        alt={t('icon.alt', { tenant })}
      />
      <p className="text-xs text-text-tertiary md:col-span-2">{tw('brand.deferred')}</p>
    </Card>
  );
}
