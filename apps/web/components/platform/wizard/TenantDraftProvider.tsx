'use client';

import {
  contrastReport,
  deriveBrandColors,
  hexColorSchema,
  NEUTRAL_BRAND,
} from '@rede-social/contracts/branding';
import { useParams } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DraftFieldErrors } from '@/app/(platform)/plataforma/novo/actions';
import type { AppIconSettings } from '@/lib/app-icon';
import {
  type ButtonColors,
  type DarkColors,
  emptyButtonColors,
  emptyDarkColors,
  emptyFontColors,
  type FontColors,
  type LightTone,
  lightToneOrNull,
  readButtonColors,
  readDarkColors,
  readFontColors,
  settleButtonColors,
  settleDarkColors,
  settleFontColors,
} from '@/lib/bg-tone';
import { isFontFamilyName } from '@/lib/title-font';
import { hasLowContrast } from '../ContrastFeedback';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { BrandLookContext, type PreviewColors } from './brand-look-context';

/** Who owns the Supabase project (09.4-15, UI-D-549): the platform's organisation or the customer's. */
export type DraftOwner = 'platform' | 'customer';

/** Everything the wizard collects before the tenant exists (the files apart: see `DraftImage`). */
export type TenantDraft = {
  displayName: string;
  slug: string;
  /** The slug was edited by hand, so the name stops suggesting it. */
  slugTouched: boolean;
  primary: string;
  secondary: string;
  /** Module key → on; every real module starts on (D-17). */
  modules: Record<string, boolean>;
  adminEmail: string;
  /**
   * The Supabase project's bare ref (09.2-18, UI-D-533). Not secret: it joins the persisted draft.
   * Any edit of it clears its error and closes the later steps again (`dataReady: false`).
   */
  projectRef: string;
  /**
   * Who owns the project (09.4-15, UI-D-549, A-UI-1): `platform` by default. Not secret: persisted. A
   * customer project also carries a write-only token, which is NOT in this draft (`token`, memory only).
   */
  owner: DraftOwner;
  /**
   * The expiry the operator typed for the customer's token, `YYYY-MM-DD` or empty (A-UI-4). Not secret:
   * persisted (a reload keeps it and asks for the token again).
   */
  tokenExpiresAt: string;
  /**
   * The last pre-check said the platform cannot obtain this project's access by itself, so the
   * manual-access block shows (UI-D-534). A flag only: the three values are NOT part of the draft
   * (`TenantDraftAccess`, memory only). Cleared by any edit of the ref.
   */
  manualAccess: boolean;
  /** The "Salvar mesmo assim" acknowledgement of a low-contrast pair. */
  contrastConfirmed: boolean;
  /**
   * The Google Fonts family of the tenant's titles (`lib/title-font.ts`), `null` for the app's
   * Manrope. Part of the look the creation sends (`look.titleFont`).
   */
  titleFont: string | null;
  /**
   * The ground tone of the light screens (`lib/bg-tone.ts`), `null` for the gray (cinza). This and
   * the three below are, with `titleFont`, the look beyond the brand pair: the creation sends them
   * (`lookBodyOf`, the brand contract's `look`) and they never gate a step; `null` is always the
   * system's own value.
   */
  lightTone: LightTone | null;
  /**
   * The dark mode's own primary, secondary and ground tone (`null`: the derived primary, the light
   * secondary, the grafite). The colours hold what the owner TYPES, a hex half typed included, so
   * the fields keep it; the preview only ever gets the last valid ones.
   */
  darkColors: DarkColors;
  /** The colours of the titles and of the top bar's app name, one per theme; typed as above. */
  fontColors: FontColors;
  /**
   * The filled action buttons' own colours: one style for both themes (solid or a gradient), and
   * per theme the button (a gradient's first colour), a gradient's last colour and the text
   * (`null`: automatic, the primary's look, or a gradient from it to its ramp, `buttonRampEnd`,
   * never the secondary; the dark mode takes the light colours until it has its own); typed as
   * above. A draft stored before the gradient reads back solid (`readButtonColors`).
   */
  buttonColors: ButtonColors;
  /** The host attached after creation; empty for none. */
  host: string;
  /**
   * The host passed the Domínio step's check (or is empty): any edit of it clears this until
   * "Continuar" checks it again, and the summary opens only with it.
   */
  hostReady: boolean;
  /** Dados passed validation, so the later steps open (any later Dados edit closes them again). */
  dataReady: boolean;
  /** Catalog keys per field: from the Dados validation or from a refused creation. */
  fieldErrors: DraftFieldErrors;
  /**
   * The slug of a creation whose answer never came (an error after the request left, a reload
   * mid-request): the API may have created it, so a retry that finds the slug taken looks for it.
   */
  pendingSlug: string | null;
  /**
   * The tenant this draft created. Recorded the moment the API answers, before the uploads, so a
   * reload, a Back or a closed dialog can never offer to create it again: every draft step sends it
   * on to its invite step, which clears the draft.
   */
  createdId: string | null;
};

/**
 * The manual access of the project (UI-D-534, D-539, D-541): write-only secrets. They live in the
 * provider's MEMORY and nowhere else: not in `TenantDraft`, not in the `sessionStorage` mirror (an
 * allow-list of persisted keys, `PERSISTED_KEYS`), not in a URL, a cookie or a log. They are sent
 * once with the creation and cleared the moment the API refuses or accepts it, when the ref is
 * edited, when the draft is discarded and when the wizard unmounts.
 */
export type TenantDraftAccess = {
  databasePassword: string;
  serviceKey: string;
  publishableKey: string;
};

const NO_ACCESS: TenantDraftAccess = { databasePassword: '', serviceKey: '', publishableKey: '' };

/**
 * The customer project's token (09.4-15, UI-D-550, UI-D-561, A-UI-2, T-09.4-53): a write-only secret in
 * the provider's MEMORY. Not in `TenantDraft`, not in `PERSISTED_KEYS`, not in a URL, a cookie, a log or a
 * prop beyond the field that holds it. Sent once with the pre-check and once with the creation, cleared
 * the moment the API answers, when the owner or the ref changes and when the draft is discarded.
 */
const NO_TOKEN = '';

/** A picked logo or icon: the file itself and an object URL the previews show. */
export type DraftImage = { file: File; url: string };

/**
 * The three pickable images: the logo, the dark mode's own logo (2026-10-05, PREVIEW ONLY: the
 * creation never sends it, the API has no field for it) and the optional app icon (since 2026-10-09
 * the one `AppIconEditor` composes, sent as the square override).
 */
export type DraftImageKind = 'logo' | 'logoDark' | 'icon';

/**
 * What the draft's app icon was composed from: the editor's choices (their files included) and the
 * primary it was drawn on, so a new primary composes it again while its ground follows the primary
 * (`WizardBrandPicker`).
 */
export type DraftAppIcon = { settings: AppIconSettings; primary: string };

type TenantDraftValue = {
  draft: TenantDraft;
  /** The last VALID colour pair (`deriveBrandColors` throws on anything else). */
  colors: { primary: string; secondary: string };
  /**
   * The last VALID look colours, what the device shows: the draft's `darkColors`,
   * `fontColors` and `buttonColors` with a half-typed hex replaced by the colour before it (for
   * another preview, like the `BrandPreview` mini-frames, to follow the device while a hex is being
   * typed). The same object until one of them changes.
   */
  previewColors: PreviewColors;
  /**
   * Personalização passes: both hexes valid, and a low-contrast pair acknowledged ("Salvar mesmo
   * assim"). Derived, never stored: Domínio and Resumo open only with it.
   */
  brandReady: boolean;
  enabledModules: string[];
  moduleKeys: readonly string[];
  logo: DraftImage | null;
  /** The dark mode's own logo, shown by the previews only (`DraftImageKind`). */
  logoDark: DraftImage | null;
  icon: DraftImage | null;
  /** How `icon` was composed, `null` without one; in memory only, like the files. */
  appIcon: DraftAppIcon | null;
  setAppIcon: (value: DraftAppIcon | null) => void;
  /** The text draft was read back from this tab's session (or there was none). */
  restored: boolean;
  /**
   * The summary's confirmation is open: it owns what follows a creation (the uploads' progress, a
   * partial failure), so the steps' guard waits instead of jumping to the invite step. In memory
   * only: after a reload nothing is open and the guard moves on.
   */
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  /** The manual access values, in memory only (`TenantDraftAccess`). */
  access: TenantDraftAccess;
  setAccess: (patch: Partial<TenantDraftAccess>) => void;
  clearAccess: () => void;
  /** The customer project's token, in memory only (`NO_TOKEN`); empty for a platform project. */
  token: string;
  setToken: (value: string) => void;
  clearToken: () => void;
  update: (patch: Partial<TenantDraft>) => void;
  setImage: (kind: DraftImageKind, file: File | null) => void;
  reset: () => void;
};

export const STORAGE_KEY = 'rede-social:novo-tenant';

/**
 * The ONLY keys of the draft that reach `sessionStorage` (an allow-list, never a deny-list): a key
 * added to `TenantDraft` is not persisted until it is listed here, so a secret can never leak into
 * the mirror by being added to the draft later. The manual access is not in `TenantDraft` at all.
 */
const PERSISTED_KEYS = [
  'displayName',
  'slug',
  'slugTouched',
  'primary',
  'secondary',
  'modules',
  'adminEmail',
  'projectRef',
  'owner',
  'tokenExpiresAt',
  'manualAccess',
  'contrastConfirmed',
  'titleFont',
  'lightTone',
  'darkColors',
  'fontColors',
  'buttonColors',
  'host',
  'hostReady',
  'dataReady',
  'fieldErrors',
  'pendingSlug',
  'createdId',
] as const satisfies readonly (keyof TenantDraft)[];

function persistable(draft: TenantDraft): Partial<TenantDraft> {
  return Object.fromEntries(PERSISTED_KEYS.map((key) => [key, draft[key]]));
}

/**
 * Drops the stored copy of the draft without touching the live one: for a hand-off to a page outside
 * the wizard (the Banco tab), where the in-memory draft dies with the wizard's layout but the stored
 * one would send the next "Novo tenant" to the invite step of a tenant that already exists.
 */
export function forgetStoredDraft(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage off: nothing was kept.
  }
}

const isHex = (value: string) => hexColorSchema.safeParse(value).success;

function emptyDraft(moduleKeys: readonly string[]): TenantDraft {
  return {
    displayName: '',
    slug: '',
    slugTouched: false,
    primary: NEUTRAL_BRAND.primary,
    secondary: NEUTRAL_BRAND.secondary,
    modules: Object.fromEntries(moduleKeys.map((key) => [key, true])),
    adminEmail: '',
    projectRef: '',
    owner: 'platform',
    tokenExpiresAt: '',
    manualAccess: false,
    contrastConfirmed: false,
    titleFont: null,
    lightTone: null,
    darkColors: emptyDarkColors(),
    fontColors: emptyFontColors(),
    buttonColors: emptyButtonColors(),
    host: '',
    hostReady: true,
    dataReady: false,
    fieldErrors: {},
    pendingSlug: null,
    createdId: null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A stored draft, kept only where it has the shape this version writes. */
function restoredDraft(raw: string, base: TenantDraft): TenantDraft {
  const saved = JSON.parse(raw) as Partial<TenantDraft>;
  const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;
  const modules = { ...base.modules };
  if (saved.modules && typeof saved.modules === 'object') {
    for (const key of Object.keys(modules)) {
      const value = (saved.modules as Record<string, unknown>)[key];
      if (typeof value === 'boolean') modules[key] = value;
    }
  }
  return {
    displayName: text(saved.displayName, base.displayName),
    slug: text(saved.slug, base.slug),
    slugTouched: flag(saved.slugTouched, base.slugTouched),
    primary: text(saved.primary, base.primary),
    secondary: text(saved.secondary, base.secondary),
    modules,
    adminEmail: text(saved.adminEmail, base.adminEmail),
    projectRef: text(saved.projectRef, base.projectRef),
    owner: saved.owner === 'customer' ? 'customer' : 'platform',
    tokenExpiresAt: text(saved.tokenExpiresAt, base.tokenExpiresAt),
    manualAccess: flag(saved.manualAccess, base.manualAccess),
    contrastConfirmed: flag(saved.contrastConfirmed, base.contrastConfirmed),
    // Only a name safe for CSS and URLs comes back; the preview still looks it up in the catalogue.
    titleFont: isFontFamilyName(saved.titleFont) ? saved.titleFont : null,
    // Only known ids and valid hexes come back (a default id or a half-typed hex reads as null).
    lightTone: lightToneOrNull(saved.lightTone),
    darkColors: readDarkColors(saved.darkColors),
    fontColors: readFontColors(saved.fontColors),
    buttonColors: readButtonColors(saved.buttonColors),
    host: text(saved.host, base.host),
    hostReady: flag(saved.hostReady, base.hostReady),
    dataReady: flag(saved.dataReady, base.dataReady),
    fieldErrors: {},
    pendingSlug: typeof saved.pendingSlug === 'string' ? saved.pendingSlug : null,
    createdId:
      typeof saved.createdId === 'string' && UUID.test(saved.createdId) ? saved.createdId : null,
  };
}

const TenantDraftContext = createContext<TenantDraftValue | null>(null);

/**
 * The new-tenant wizard's draft, mounted ONCE by `/plataforma/novo`'s layout, so it survives every
 * step change (App Router layouts persist across their children). Nothing in here reaches the API:
 * the summary's confirmation sends it, through `createTenantFromDraftAction` and then the existing
 * upload and domain actions on the new id.
 *
 * The text fields are mirrored into this tab's `sessionStorage` (the keys of `PERSISTED_KEYS` only),
 * so a reload keeps them; the project's manual access (`access`, UI-D-534) and the customer project's
 * token (`token`, 09.4-15, UI-D-550) are NOT among them: they are write-only, held in memory, and a
 * reload finds the ref (and the owner and the typed expiry) and asks for the secrets again. The picked
 * files live in memory only (a reload drops them, and the Marca step asks again), and so do the app
 * icon's choices (`appIcon`, files among them; `reset` clears them with the rest). The draft feeds
 * the preview device on every step before creation; once a step carries the created tenant's id,
 * `PreviewSeed` owns the device and the draft stays quiet.
 *
 * The look beyond the pair (the title font, the ground tones, the dark mode's colours, the font
 * colours and the button colours) is kept and mirrored like the rest, read back only where valid
 * (`restoredDraft`), and published to the device; the creation sends it (`lookBodyOf`, through
 * `CreateTenantDialog`), so after it the device shows the SAVED look (`PreviewSeed`). None of it
 * gates a step (`brandReady` reads the pair alone). The look's cards reach it through
 * `BrandLookContext` (this value has its shape), the same cards the Marca tab feeds from its own
 * provider.
 */
export function TenantDraftProvider({
  moduleKeys,
  children,
}: {
  moduleKeys: readonly string[];
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<TenantDraft>(() => emptyDraft(moduleKeys));
  const [colors, setColors] = useState<{ primary: string; secondary: string }>({
    primary: NEUTRAL_BRAND.primary,
    secondary: NEUTRAL_BRAND.secondary,
  });
  // The preview's copy of the typed look colours: the last VALID ones, as `colors` is for
  // the pair (`settleDarkColors`/`settleFontColors`/`settleButtonColors`; a reset to the system's
  // colour clears).
  const [previewColors, setPreviewColors] = useState<PreviewColors>(() => ({
    darkColors: emptyDarkColors(),
    fontColors: emptyFontColors(),
    buttonColors: emptyButtonColors(),
  }));
  const [restored, setRestored] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [access, setAccessState] = useState<TenantDraftAccess>(NO_ACCESS);
  const [token, setTokenState] = useState<string>(NO_TOKEN);
  const [logo, setLogo] = useState<DraftImage | null>(null);
  const [logoDark, setLogoDark] = useState<DraftImage | null>(null);
  const [icon, setIcon] = useState<DraftImage | null>(null);
  const [appIcon, setAppIcon] = useState<DraftAppIcon | null>(null);
  const logoRef = useRef<DraftImage | null>(null);
  const logoDarkRef = useRef<DraftImage | null>(null);
  const iconRef = useRef<DraftImage | null>(null);
  const keysRef = useRef(moduleKeys);

  // Read the tab's draft back once, after hydration (the server never sees sessionStorage).
  useEffect(() => {
    let next = emptyDraft(keysRef.current);
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) next = restoredDraft(raw, next);
    } catch {
      // Storage off or a foreign value: start from the empty draft.
    }
    setDraft(next);
    setColors({
      primary: isHex(next.primary) ? next.primary : NEUTRAL_BRAND.primary,
      secondary: isHex(next.secondary) ? next.secondary : NEUTRAL_BRAND.secondary,
    });
    setPreviewColors({
      darkColors: next.darkColors,
      fontColors: next.fontColors,
      buttonColors: next.buttonColors,
    });
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(draft)));
    } catch {
      // A full or blocked storage only costs the reload safety net.
    }
  }, [draft, restored]);

  // The object URLs die with the wizard.
  useEffect(
    () => () => {
      for (const ref of [logoRef, logoDarkRef, iconRef]) {
        if (ref.current) URL.revokeObjectURL(ref.current.url);
      }
    },
    [],
  );

  const update = useCallback((patch: Partial<TenantDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    const { primary, secondary, darkColors, fontColors, buttonColors } = patch;
    if (primary !== undefined || secondary !== undefined) {
      setColors((prev) => ({
        primary: primary !== undefined && isHex(primary) ? primary : prev.primary,
        secondary: secondary !== undefined && isHex(secondary) ? secondary : prev.secondary,
      }));
    }
    if (darkColors !== undefined || fontColors !== undefined || buttonColors !== undefined) {
      setPreviewColors((prev) => {
        const next = {
          darkColors: darkColors ? settleDarkColors(darkColors, prev.darkColors) : prev.darkColors,
          fontColors: fontColors ? settleFontColors(fontColors, prev.fontColors) : prev.fontColors,
          buttonColors: buttonColors
            ? settleButtonColors(buttonColors, prev.buttonColors)
            : prev.buttonColors,
        };
        return next.darkColors === prev.darkColors &&
          next.fontColors === prev.fontColors &&
          next.buttonColors === prev.buttonColors
          ? prev
          : next;
      });
    }
  }, []);

  const setImage = useCallback((kind: DraftImageKind, file: File | null) => {
    const [ref, set] =
      kind === 'logo'
        ? [logoRef, setLogo]
        : kind === 'logoDark'
          ? [logoDarkRef, setLogoDark]
          : [iconRef, setIcon];
    if (ref.current) URL.revokeObjectURL(ref.current.url);
    const next = file ? { file, url: URL.createObjectURL(file) } : null;
    ref.current = next;
    set(next);
  }, []);

  const setAccess = useCallback((patch: Partial<TenantDraftAccess>) => {
    setAccessState((prev) => ({ ...prev, ...patch }));
  }, []);
  const clearAccess = useCallback(() => setAccessState(NO_ACCESS), []);
  const setToken = useCallback((value: string) => setTokenState(value), []);
  const clearToken = useCallback(() => setTokenState(NO_TOKEN), []);

  const reset = useCallback(() => {
    clearAccess();
    clearToken();
    setImage('logo', null);
    setImage('logoDark', null);
    setImage('icon', null);
    setAppIcon(null);
    const fresh = emptyDraft(keysRef.current);
    setDraft(fresh);
    setColors({ primary: fresh.primary, secondary: fresh.secondary });
    setPreviewColors({
      darkColors: fresh.darkColors,
      fontColors: fresh.fontColors,
      buttonColors: fresh.buttonColors,
    });
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored, nothing to clear.
    }
  }, [setImage, clearAccess, clearToken]);

  const lowContrast = useMemo(
    () => hasLowContrast(contrastReport(deriveBrandColors(colors))),
    [colors],
  );
  const brandReady =
    isHex(draft.primary) && isHex(draft.secondary) && (!lowContrast || draft.contrastConfirmed);

  const enabledKey = moduleKeys.filter((key) => draft.modules[key] ?? true).join(',');
  const enabledModules = useMemo(() => (enabledKey ? enabledKey.split(',') : []), [enabledKey]);

  // The preview device follows the draft on every step before creation (name, last valid pair,
  // the picked logo, the enabled modules, and the look: the title font, ground tones and last
  // valid dark, font and button colours); a step with the created tenant's id belongs to
  // `PreviewSeed`, which carries the look the creation saved.
  const params = useParams<{ id?: string }>();
  const created = Boolean(params?.id);
  const { setDraft: publish } = useTenantPreview();
  useEffect(() => {
    if (created) return;
    publish({
      displayName: draft.displayName,
      colors,
      logoUrl: logo?.url ?? null,
      logoDarkUrl: logoDark?.url ?? null,
      modules: enabledModules,
      titleFont: draft.titleFont,
      lightTone: draft.lightTone,
      darkColors: previewColors.darkColors,
      fontColors: previewColors.fontColors,
      buttonColors: previewColors.buttonColors,
    });
  }, [
    created,
    draft.displayName,
    colors,
    logo,
    logoDark,
    enabledModules,
    draft.titleFont,
    draft.lightTone,
    previewColors,
    publish,
  ]);

  const value = useMemo(
    () => ({
      draft,
      colors,
      previewColors,
      brandReady,
      enabledModules,
      moduleKeys,
      logo,
      logoDark,
      icon,
      appIcon,
      setAppIcon,
      restored,
      confirming,
      setConfirming,
      access,
      setAccess,
      clearAccess,
      token,
      setToken,
      clearToken,
      update,
      setImage,
      reset,
    }),
    [
      draft,
      colors,
      previewColors,
      brandReady,
      enabledModules,
      moduleKeys,
      logo,
      logoDark,
      icon,
      appIcon,
      restored,
      confirming,
      access,
      setAccess,
      clearAccess,
      token,
      setToken,
      clearToken,
      update,
      setImage,
      reset,
    ],
  );

  return (
    <TenantDraftContext.Provider value={value}>
      <BrandLookContext.Provider value={value}>{children}</BrandLookContext.Provider>
    </TenantDraftContext.Provider>
  );
}

export function useTenantDraft(): TenantDraftValue {
  const value = useContext(TenantDraftContext);
  if (!value) throw new Error('useTenantDraft outside TenantDraftProvider');
  return value;
}
