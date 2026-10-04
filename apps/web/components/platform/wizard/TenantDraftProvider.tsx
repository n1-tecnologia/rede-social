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

/** A picked logo or icon: the file itself and an object URL the previews show. */
export type DraftImage = { file: File; url: string };

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
  icon: DraftImage | null;
  /** The text draft was read back from this tab's session (or there was none). */
  restored: boolean;
  /**
   * The summary's confirmation is open: it owns what follows a creation (the uploads' progress, a
   * partial failure), so the steps' guard waits instead of jumping to the invite step. In memory
   * only: after a reload nothing is open and the guard moves on.
   */
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  update: (patch: Partial<TenantDraft>) => void;
  setImage: (kind: 'logo' | 'icon', file: File | null) => void;
  reset: () => void;
};

const STORAGE_KEY = 'rede-social:novo-tenant';

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
 * The text fields are mirrored into this tab's `sessionStorage`, so a reload keeps them; the picked
 * files live in memory only (a reload drops them, and the Marca step asks again). The draft feeds the
 * preview device on every step before creation; once a step carries the created tenant's id,
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
  const [logo, setLogo] = useState<DraftImage | null>(null);
  const [icon, setIcon] = useState<DraftImage | null>(null);
  const logoRef = useRef<DraftImage | null>(null);
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
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // A full or blocked storage only costs the reload safety net.
    }
  }, [draft, restored]);

  // The object URLs die with the wizard.
  useEffect(
    () => () => {
      for (const ref of [logoRef, iconRef]) if (ref.current) URL.revokeObjectURL(ref.current.url);
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

  const setImage = useCallback((kind: 'logo' | 'icon', file: File | null) => {
    const ref = kind === 'logo' ? logoRef : iconRef;
    if (ref.current) URL.revokeObjectURL(ref.current.url);
    const next = file ? { file, url: URL.createObjectURL(file) } : null;
    ref.current = next;
    (kind === 'logo' ? setLogo : setIcon)(next);
  }, []);

  const reset = useCallback(() => {
    setImage('logo', null);
    setImage('icon', null);
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
  }, [setImage]);

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
      icon,
      restored,
      confirming,
      setConfirming,
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
      icon,
      restored,
      confirming,
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
