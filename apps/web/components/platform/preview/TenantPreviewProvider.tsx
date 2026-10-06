'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type { ButtonColors, DarkColors, FontColors, LightTone } from '@/lib/bg-tone';

/** The screens the preview device can show: the public login, the app's tabs and the settings. */
export type PreviewScreen =
  | 'login'
  | 'home'
  | 'communities'
  | 'reels'
  | 'events'
  | 'profile'
  | 'settings';

export type PreviewTheme = 'light' | 'dark';

/**
 * Whose app the device shows: a plain member's, or the tenant admin's — the same screens plus the
 * create and manage controls the admin's permissions turn on (shown, never functional).
 */
export type PreviewView = 'member' | 'admin';

/** What the preview needs of a tenant — typed in the form (draft) or read from the API (persisted). */
export type PreviewTenant = {
  /** Empty while nothing is typed: the preview shows the catalog placeholder. */
  displayName: string;
  /** The LAST VALID pair (`deriveBrandColors` throws on an invalid hex). */
  colors: { primary: string; secondary: string };
  logoUrl: string | null;
  /**
   * The dark mode's own logo (2026-10-05): the device shows it while its theme is dark, and the
   * logo above otherwise or without it. Preview only: only the wizard's draft carries it (a saved
   * tenant has no such field), so a persisted tenant leaves it absent.
   */
  logoDarkUrl?: string | null;
  /** Enabled module keys, before `requires` is applied (the preview applies it like the API). */
  modules: readonly string[];
  /**
   * The Google Fonts family of the titles (`lib/title-font.ts`); absent or `null` for Manrope. The
   * wizard's draft carries the one being picked, a persisted tenant the one it saved (2026-10-03).
   */
  titleFont?: string | null;
  /**
   * The look beyond the brand pair (`lib/bg-tone.ts`): the light screens' ground tone, the dark
   * mode's own colours, the font colours per theme and the filled buttons' own colours per theme.
   * Like `titleFont`, the draft's or the saved ones (`lookFieldsOf`); absent, like `null`, is always
   * the system's value, and the panel re-checks every one before it reaches the screen
   * (`previewScreenLook`).
   */
  lightTone?: LightTone | null;
  darkColors?: DarkColors | null;
  fontColors?: FontColors | null;
  buttonColors?: ButtonColors | null;
};

/**
 * Where the current tenant came from: nothing published yet (`empty`, the provider's initial
 * tenant), the creation form (`draft`) or the created tenant's detail (`persisted`). A wizard step
 * loaded in place is seeded by `PreviewSeed`; until it is, the device shows a skeleton instead of a
 * placeholder brand.
 */
export type PreviewSource = 'empty' | 'draft' | 'persisted';

type TenantPreviewValue = {
  tenant: PreviewTenant;
  source: PreviewSource;
  theme: PreviewTheme;
  screen: PreviewScreen;
  view: PreviewView;
  setDraft: (tenant: PreviewTenant) => void;
  setPersisted: (tenant: PreviewTenant) => void;
  setTheme: (theme: PreviewTheme) => void;
  setScreen: (screen: PreviewScreen) => void;
  setView: (view: PreviewView) => void;
};

const EMPTY_TENANT: PreviewTenant = {
  displayName: '',
  colors: { primary: '', secondary: '' },
  logoUrl: null,
  modules: [],
};

const noop = () => {};

/** Outside the wizard (the tenant tabs reuse the same components) every publish is a no-op. */
const TenantPreviewContext = createContext<TenantPreviewValue>({
  tenant: EMPTY_TENANT,
  source: 'empty',
  theme: 'light',
  screen: 'home',
  view: 'member',
  setDraft: noop,
  setPersisted: noop,
  setTheme: noop,
  setScreen: noop,
  setView: noop,
});

export interface TenantPreviewProviderProps {
  /** The panel's own theme (cookie, read on the server), so the device starts in it without a flash. */
  initialTheme: PreviewTheme;
  /**
   * What the device shows before anything is published: the creation form's own defaults (no name,
   * the neutral pair, every real module), so the server-rendered phone already matches the form and
   * nothing jumps when the form hydrates and publishes its draft.
   */
  initialTenant?: PreviewTenant;
  children: ReactNode;
}

/**
 * The tenant preview's state, mounted ONCE by `/plataforma/novo`'s layout. The layout persists across
 * every step of the wizard (App Router layouts do not remount on navigation between their children),
 * so the device it feeds stays the same DOM node from "Novo tenant" to "Pronto": the creation form
 * publishes its draft, each later step's layout publishes the created tenant (`PreviewSeed`), and
 * the device only re-renders with the new values. The tenant page's Marca tab mounts one too
 * (2026-10-03), with no device: there the look's cards turn its theme, which the title font's
 * sample follows.
 */
export function TenantPreviewProvider({
  initialTheme,
  initialTenant = EMPTY_TENANT,
  children,
}: TenantPreviewProviderProps) {
  const [tenant, setTenant] = useState<PreviewTenant>(initialTenant);
  const [source, setSource] = useState<PreviewSource>('empty');
  const [theme, setTheme] = useState<PreviewTheme>(initialTheme);
  const [screen, setScreen] = useState<PreviewScreen>('home');
  const [view, setView] = useState<PreviewView>('member');

  const setDraft = useCallback((next: PreviewTenant) => {
    setTenant(next);
    setSource('draft');
  }, []);
  const setPersisted = useCallback((next: PreviewTenant) => {
    setTenant(next);
    setSource('persisted');
  }, []);

  const value = useMemo(
    () => ({
      tenant,
      source,
      theme,
      screen,
      view,
      setDraft,
      setPersisted,
      setTheme,
      setScreen,
      setView,
    }),
    [tenant, source, theme, screen, view, setDraft, setPersisted],
  );

  return <TenantPreviewContext.Provider value={value}>{children}</TenantPreviewContext.Provider>;
}

export function useTenantPreview(): TenantPreviewValue {
  return useContext(TenantPreviewContext);
}

/**
 * Publishes the CREATED tenant to the preview from a server layout (`/plataforma/novo/{id}`). Renders
 * nothing. Re-publishes whenever the server view changes (an uploaded logo revalidates the route),
 * keyed on the serialised value because a server component hands a fresh object on every render.
 */
export function PreviewSeed({ tenant }: { tenant: PreviewTenant }) {
  const { setPersisted } = useTenantPreview();
  const serialized = JSON.stringify(tenant);
  useLayoutEffect(() => {
    setPersisted(JSON.parse(serialized) as PreviewTenant);
  }, [serialized, setPersisted]);
  return null;
}
