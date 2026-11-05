import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import {
  absoluteBrandUrl,
  resolveBranding,
  tenantBrandingSchema,
} from '@rede-social/contracts/branding';
import {
  type AppTab,
  compareVersions,
  deriveStoreName,
  type TenantBuild,
  tenantBuildSchema,
} from '@rede-social/contracts/native';
import { ReleaseRefusal } from './report';

/**
 * The build record of a tenant's app (13-29, D-607, D-611, NATIVE-02, NATIVE-15 build half): everything the
 * store build bakes, derived from the TENANT RECORD and nothing else. No argument can set a name, a colour, an
 * id or a host; a tenant without the data is refused, never given a placeholder (the platform's own name, logo
 * and colours appear nowhere in this file or in what it writes).
 *
 * Changing a tenant's primary domain after a build needs a new build: `host` is baked into the universal-link
 * association (`applinks:<host>`) and the Android `autoVerify` intent filter (D-611).
 */

export type ReleaseEnv = 'hml' | 'prod';

export type TenantRecord = {
  tenantId: string;
  slug: string;
  displayName: string;
  /** The raw `tenants.branding` jsonb. */
  branding: unknown;
  primaryHost: string | null;
  /** Verified hosts, the primary first. */
  hosts: readonly string[];
  /** The App tab (ids, held credentials, link verdicts, last builds). */
  tab: AppTab;
  storeUrls: { ios: string | null; android: string | null };
};

export type TenantSource = { load(slug: string): Promise<TenantRecord | null> };

export type LogoBytes = { data: Buffer; mime?: string };
/** Reads the tenant's logo. The real reader fetches https; the dry run reads the repository's own files. */
export type LogoReader = (logoUrl: string, context: { primaryHost: string }) => Promise<LogoBytes>;

/** The system permission texts (UI-SPEC "System permission texts"), `{tenant}` = the store name. */
const PERMISSION_TEMPLATES = {
  camera: '{tenant} usa a câmera para você fotografar e gravar vídeos para as suas publicações.',
  photos: '{tenant} acessa suas fotos e vídeos para você escolher o que publicar.',
  microphone: '{tenant} usa o microfone para gravar o som dos seus vídeos.',
  faceId: '{tenant} usa o Face ID para proteger o acesso ao app quando você ligar o bloqueio.',
} as const;

export const permissionStrings = (storeName: string): TenantBuild['strings'] => ({
  camera: PERMISSION_TEMPLATES.camera.replace('{tenant}', storeName),
  photos: PERMISSION_TEMPLATES.photos.replace('{tenant}', storeName),
  microphone: PERMISSION_TEMPLATES.microphone.replace('{tenant}', storeName),
  faceId: PERMISSION_TEMPLATES.faceId.replace('{tenant}', storeName),
});

export type DerivedBuild = {
  build: TenantBuild;
  logo: LogoBytes;
  displayName: string;
  tenantId: string;
  /** The tab as read, for the checks that come after the derivation. */
  tab: AppTab;
};

/** The next build number: one more than the highest recorded for either store, so both stores stay monotonic. */
export function nextBuildNumber(tab: AppTab): number {
  const recorded = [tab.identity.lastBuild.ios, tab.identity.lastBuild.android]
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .map((entry) => entry.buildNumber);
  return Math.max(0, ...recorded) + 1;
}

/** The version string: the highest recorded, else 1.0.0. The version is the tenant's to raise, never ours. */
export function currentVersion(tab: AppTab): string {
  const recorded = [tab.identity.lastBuild.ios, tab.identity.lastBuild.android]
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .map((entry) => entry.version);
  return recorded.reduce(
    (best, version) => (compareVersions(version, best) > 0 ? version : best),
    '1.0.0',
  );
}

export async function deriveBuildRecord(input: {
  slug: string;
  env: ReleaseEnv;
  source: TenantSource;
  readLogo: LogoReader;
}): Promise<DerivedBuild> {
  const record = await input.source.load(input.slug);
  if (!record) throw new ReleaseRefusal('tenant_not_found');
  if (record.primaryHost === null) throw new ReleaseRefusal('no_primary_host');

  const { bundleId, applicationId } = record.tab.identity;
  if (bundleId === null || applicationId === null) throw new ReleaseRefusal('no_app_ids');

  // The brand must have been configured: `resolveBranding` would fall back to the platform's neutral colours,
  // which is exactly the placeholder a tenant's app may never carry.
  const stored = tenantBrandingSchema.safeParse(record.branding ?? {});
  if (!stored.success || !stored.data.colors.primary || !stored.data.colors.secondary) {
    throw new ReleaseRefusal('no_brand_colors');
  }
  const brand = resolveBranding(record.branding);

  const logoUrl = absoluteBrandUrl(brand.logoUrl, `https://${record.primaryHost}`);
  if (logoUrl === null) throw new ReleaseRefusal('no_logo');
  let logo: LogoBytes;
  try {
    logo = await input.readLogo(logoUrl, { primaryHost: record.primaryHost });
  } catch {
    throw new ReleaseRefusal('no_logo');
  }

  const storeName = deriveStoreName(record.displayName).name;
  const parsed = tenantBuildSchema.safeParse({
    slug: record.slug,
    host: record.primaryHost,
    hosts: record.hosts.slice(0, 10),
    env: input.env,
    storeName,
    shortName: record.tab.identity.shortName.name,
    bundleId,
    applicationId,
    version: currentVersion(record.tab),
    buildNumber: nextBuildNumber(record.tab),
    teamId: record.tab.links.teamId,
    colors: {
      primary: brand.colors.primary,
      onPrimary: brand.colors.onPrimary,
      primaryDark: brand.colors.primaryDark,
      onPrimaryDark: brand.colors.onPrimaryDark,
    },
    logoUrl,
    strings: permissionStrings(storeName),
    storeUrls: record.storeUrls,
    googleServicesFile: null,
  });
  if (!parsed.success) throw new ReleaseRefusal('no_logo');
  return {
    build: parsed.data,
    logo,
    displayName: record.displayName,
    tenantId: record.tenantId,
    tab: record.tab,
  };
}

/** The image files the build bakes, named for `apps/mobile`. */
export type BuildAssets = Readonly<Record<string, Buffer>>;

/** Derives the five images with plan 24's functions. The platform contributes no pixel. */
export async function renderAssets(derived: DerivedBuild): Promise<BuildAssets> {
  const assets = await import('@rede-social/core/server/branding/app-assets');
  const { build, logo, displayName } = derived;
  const icons = await assets.deriveStoreIcon(logo.data, {
    primary: build.colors.primary,
    ...(logo.mime ? { mime: logo.mime } : {}),
  });
  const splash = await assets.deriveSplash(logo.data, {
    primary: build.colors.primary,
    onPrimary: build.colors.onPrimary,
    displayName,
    ...(logo.mime ? { mime: logo.mime } : {}),
  });
  const adaptive = await assets.deriveAdaptiveForeground(
    logo.data,
    logo.mime ? { mime: logo.mime } : {},
  );
  const notification = await assets.deriveNotificationIcon(
    logo.data,
    logo.mime ? { mime: logo.mime } : {},
  );
  return {
    'icon.png': icons.appStore1024,
    'play-icon.png': icons.play512,
    'splash.png': splash.png,
    'adaptive-foreground.png': adaptive,
    'notification-icon.png': notification.png,
  };
}

/** `build.json` as written: schema key order, two-space indent, UTF-8, one trailing newline. */
export const serializeBuildRecord = (build: TenantBuild): string =>
  `${JSON.stringify(tenantBuildSchema.parse(build), null, 2)}\n`;

/**
 * Writes the images and `build.json` into `dir` (the build directory, `apps/mobile/.tenant` by default). The
 * record is validated by `tenantBuildSchema` before anything is written. None of these files holds a secret.
 */
export async function writeBuildRecord(input: {
  dir: string;
  build: TenantBuild;
  assets: BuildAssets;
}): Promise<void> {
  const text = serializeBuildRecord(input.build);
  await fs.mkdir(input.dir, { recursive: true });
  for (const [name, data] of Object.entries(input.assets)) {
    await fs.writeFile(join(input.dir, name), data);
  }
  await fs.writeFile(join(input.dir, 'build.json'), text, 'utf8');
}

/** Reads `build.json` back, validated (what `publish` runs from). */
export async function readBuildRecord(dir: string): Promise<TenantBuild> {
  try {
    return tenantBuildSchema.parse(JSON.parse(await fs.readFile(join(dir, 'build.json'), 'utf8')));
  } catch {
    throw new ReleaseRefusal('artifact_missing', ['build.json']);
  }
}
