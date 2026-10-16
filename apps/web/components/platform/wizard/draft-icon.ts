import { followsPrimary } from '@/lib/app-icon';
import { composeAppIconFile, loadIconImage } from '@/lib/app-icon-image';
import type { DraftAppIcon, DraftImage } from './TenantDraftProvider';

/**
 * The wizard's app icon composed again on another primary (2026-10-09): the draft keeps the
 * composed file with the choices and the primary it was drawn on (`DraftAppIcon`), and an icon whose
 * ground follows the primary (`followsPrimary`) must reach the new tenant drawn on the primary the
 * tenant is created with. Two callers share it: Personalização composes it again a moment after the
 * primary's last change (`WizardBrandPicker`), and the summary's confirmation does it once more right
 * before the upload (`CreateTenantDialog`), for a primary changed just before that step was left.
 */

/** The draft's icon follows the primary and was drawn on another one: it must be composed again. */
export function needsRecompose(
  appIcon: DraftAppIcon | null,
  primary: string,
): appIcon is DraftAppIcon {
  return appIcon !== null && appIcon.primary !== primary && followsPrimary(appIcon.settings);
}

/**
 * The draft's icon composed again on `primary`, from the choices it was made with: a logo it took
 * from the light or the dark mode's logo is read from that logo's FILE (never its object URL: a
 * fetch of a `blob:` needs the CSP's `connect-src`), the files of the choices as they are
 * (`composeAppIconFile`). `null` when that logo is gone: the icon stays as it was composed. Rejects
 * as `loadIconImage` and `composeAppIconFile` do.
 */
export async function recomposeDraftIcon({
  appIcon,
  primary,
  logo,
  logoDark,
}: {
  appIcon: DraftAppIcon;
  primary: string;
  logo: DraftImage | null;
  logoDark: DraftImage | null;
}): Promise<File | null> {
  const { settings } = appIcon;
  const fromLogo = settings.mode === 'logo' && settings.logoSource !== 'file';
  const source = fromLogo ? (settings.logoSource === 'dark' ? logoDark : logo) : null;
  if (fromLogo && !source) return null;
  const image = source ? await loadIconImage({ file: source.file }) : null;
  return composeAppIconFile({ settings, primary, logo: image });
}
