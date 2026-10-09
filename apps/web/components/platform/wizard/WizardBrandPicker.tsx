'use client';

import { Button, Card } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { followsPrimary } from '@/lib/app-icon';
import { composeAppIconFile, loadIconImage } from '@/lib/app-icon-image';
import { AppIconEditor } from '../AppIconEditor';
import { BrandImagePicker } from '../BrandImagePicker';
import { useTenantDraft } from './TenantDraftProvider';

/** The pause after the primary's last change before the draft's app icon is composed again. */
const RECOMPOSE_MS = 250;

/**
 * Step 2 (Personalização), its last card: before the tenant exists the logos are PICKED, not
 * uploaded (`BrandImagePicker`, the same zones and copy as the tenant page's Marca tab), and the app
 * icon is COMPOSED, not uploaded (`AppIconEditor`, the Marca tab's editor). The picked images and
 * the composed icon show right away, here and in the preview device; the files stay in this
 * browser's memory until the summary's confirmation uploads the logo and the icon to the new tenant
 * (`runBrandingUpload`). What only the server checks (a corrupt image, an unsafe SVG) is reported by
 * that confirmation.
 *
 * Two logos (2026-10-05): the light mode's, the one the tenant is created with, and the dark
 * mode's own, optional, shown on a dark ground here and by the previews while their theme is dark
 * (without it the light mode's logo stands in both). The dark one is PREVIEW ONLY: the API has no
 * field for it, so the creation never sends it, and its hint says so.
 *
 * The app icon (2026-10-09) starts from either logo (their files, never their object URLs) or from
 * files of its own. "Usar como ícone do app" keeps the composed file as the draft's icon with the
 * choices it came from (`appIcon`); "Remover" drops both. While its ground follows the primary
 * (`followsPrimary`), a new primary composes it again, a moment after the last change, so the icon
 * the confirmation uploads is always drawn on the primary the tenant is created with.
 */
export function WizardBrandPicker() {
  const t = useTranslations('platformBranding');
  const tw = useTranslations('platform.wizard');
  const { draft, colors, logo, logoDark, icon, appIcon, setImage, setAppIcon } = useTenantDraft();
  const tenant = draft.displayName.trim() || t('preview.namePlaceholder');
  const primary = colors.primary;

  useEffect(() => {
    if (!appIcon || appIcon.primary === primary || !followsPrimary(appIcon.settings)) return;
    const { settings } = appIcon;
    const fromLogo = settings.mode === 'logo' && settings.logoSource !== 'file';
    const source = fromLogo ? (settings.logoSource === 'dark' ? logoDark : logo) : null;
    // Its logo is gone: the icon stays as it was composed.
    if (fromLogo && !source) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const image = source ? await loadIconImage({ file: source.file }) : null;
        const file = await composeAppIconFile({ settings, primary, logo: image });
        if (!live) return;
        setImage('icon', file);
        setAppIcon({ settings, primary });
      } catch (error) {
        console.error('platform.wizard.app_icon_failed', { error: String(error) });
      }
    }, RECOMPOSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [appIcon, primary, logo, logoDark, setImage, setAppIcon]);

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
      <AppIconEditor
        marker={{ 'data-wizard-image': 'icon' }}
        className="border-t border-divider pt-6 md:col-span-2"
        displayName={tenant}
        primary={primary}
        logos={{ light: logo, dark: logoDark }}
        iconUrl={icon?.url ?? null}
        initialSettings={appIcon?.settings ?? null}
        onApply={(file, settings) => {
          setImage('icon', file);
          setAppIcon({ settings, primary });
          return true;
        }}
        removeAction={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => {
              setImage('icon', null);
              setAppIcon(null);
            }}
          >
            {t('icon.remove')}
          </Button>
        }
      />
      <p className="text-xs text-text-tertiary md:col-span-2">{tw('brand.deferred')}</p>
    </Card>
  );
}
