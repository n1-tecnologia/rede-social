'use client';

import {
  brandStyleVars,
  deriveBrandColors,
  hexColorSchema,
  NEUTRAL_BRAND,
} from '@rede-social/contracts/branding';
import { buildNav } from '@rede-social/core/ui';
import { Chip, cn, SectionTitle, Skeleton } from '@rede-social/ui';
import { Moon, ShieldCheck, Sun, User } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { previewScreenLook } from '@/lib/bg-tone';
import { previewEffectiveModules, previewNavModules } from '@/lib/preview-modules';
import { useTitleFont } from '@/lib/title-font';
import { DevicePhone } from './DevicePhone';
import { screenOfTab } from './preview-routes';
import { TenantAppPreview } from './TenantAppPreview';
import { type PreviewScreen, type PreviewView, useTenantPreview } from './TenantPreviewProvider';

/** A valid pair or the neutral brand: `deriveBrandColors` throws on anything else. */
function safeColors(colors: { primary: string; secondary: string }) {
  return hexColorSchema.safeParse(colors.primary).success &&
    hexColorSchema.safeParse(colors.secondary).success
    ? colors
    : { primary: NEUTRAL_BRAND.primary, secondary: NEUTRAL_BRAND.secondary };
}

const THEMES = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
] as const;

const VIEWS: ReadonlyArray<{ value: PreviewView; icon: typeof User }> = [
  { value: 'member', icon: User },
  { value: 'admin', icon: ShieldCheck },
];

export interface TenantPreviewPanelProps {
  className?: string;
}

/**
 * The right column of the tenant wizard: the live preview of the tenant's app in the phone device,
 * with the panel's own controls above it (which screen, which theme). Mounted once by
 * `/plataforma/novo`'s layout, so it is the same node through every step; the steps only change
 * what `TenantPreviewProvider` holds.
 *
 * Two views of the same app: the member's, and the tenant admin's, which adds the create and manage
 * controls the admin's permissions turn on (shown only; nothing in the preview publishes).
 *
 * The phone is navigated with the pointer, like the app (`DevicePhone interactive`,
 * `TenantAppPreview onNavigate`): its tabs, its links, and Perfil > Configurações > Sair for the
 * login. The phone is `aria-hidden`, so the same screens are also one native `select` for the
 * keyboard and screen readers: invisible to the pointer, it shows over the view row only while it
 * has keyboard focus. It is also the keyboard's way past the profile popup over the phone's Início:
 * leaving Início through it answers the popup for the preview's visit (`usePreviewNudge`).
 *
 * The device scale is CSS (`--device-scale` by viewport height, `globals.css`), so it is settled on
 * the first paint and never measured. Typing is deferred (`useDeferredValue`) so a keystroke in the
 * form never waits for the phone to re-render.
 */
export function TenantPreviewPanel({ className }: TenantPreviewPanelProps) {
  const t = useTranslations();
  const { tenant, source, theme, setTheme, screen, setScreen, view, setView } = useTenantPreview();
  const params = useParams<{ id?: string }>();
  const deferred = useDeferredValue(tenant);
  const titleId = useId();
  const screenId = useId();

  // A wizard step loaded in place shows a skeleton until `PreviewSeed` publishes the created tenant,
  // never the placeholder brand. Only until hydration: a step whose tenant could not be loaded (its
  // not-found or error state renders inside the wizard) has no seed, and the device then falls back
  // to the form's defaults instead of loading forever.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const waiting = !hydrated && Boolean(params?.id) && source !== 'persisted';

  const name = deferred.displayName.trim() || t('platformBranding.preview.namePlaceholder');
  const colors = safeColors(deferred.colors);
  // The titles' font reaches the screen as one variable, only once the catalogue confirmed the
  // family; `globals.css` hands it to the elements marked `data-preview-title`, nothing else.
  const titleFont = useTitleFont(deferred.titleFont ?? null);
  // The rest of the look (the draft's, or the saved one), for the theme the device shows NOW: the tone ids (tokens.css
  // applies each under its own theme), the dark colours in dark only, this theme's title and
  // app-name colours with their markers, and the buttons' raw keys of both themes (tokens.css
  // reads each scope's own; a gradient's automatic first colour is this pair's primary, in dark
  // the dark mode's own or the derived one, and its last colour that one's ramp). Spread after the
  // brand variables, so a dark primary or secondary overrides the derived one; every value
  // re-checked (`previewScreenLook`).
  const look = previewScreenLook({
    theme,
    colors,
    lightTone: deferred.lightTone,
    darkColors: deferred.darkColors,
    fontColors: deferred.fontColors,
    buttonColors: deferred.buttonColors,
  });
  const screenStyle = {
    ...brandStyleVars({ colors: deriveBrandColors(colors) }),
    ...(titleFont ? { '--preview-title-font': titleFont } : {}),
    ...look.style,
  } as CSSProperties;

  const screens = useMemo(() => {
    const tabs = buildNav(previewNavModules(previewEffectiveModules(deferred.modules)), {
      home: t('app.nav.home'),
      profile: t('app.nav.profile'),
      module: (key, fallback) => (t.has(`${key}.nav`) ? t(`${key}.nav`) : fallback),
    }).tabs;
    const fromTabs = tabs.flatMap((tab) => {
      const target = screenOfTab(tab.key);
      return target ? [{ value: target, label: tab.label }] : [];
    });
    return [
      { value: 'login' as PreviewScreen, label: t('login.title') },
      ...fromTabs,
      { value: 'settings' as PreviewScreen, label: t('app.settings.title') },
    ];
  }, [deferred.modules, t]);
  // A tab whose module was just switched off falls back to Início.
  const active: PreviewScreen = screens.some((s) => s.value === screen) ? screen : 'home';

  // A tap inside the phone moves the selection (a screen the tenant does not have is ignored).
  const navigate = useCallback(
    (target: PreviewScreen) => {
      if (screens.some((s) => s.value === target)) setScreen(target);
    },
    [screens, setScreen],
  );

  return (
    <section
      aria-labelledby={titleId}
      data-device-column
      className={cn(
        // The scale (`--device-scale`) comes from `data-device-column` in globals.css: the largest the
        // window HEIGHT allows while the sticky column still fits, so the device never moves. The
        // column is exactly as wide as the scaled phone.
        'flex flex-col gap-3 xl:w-[calc(415px*var(--device-scale))]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionTitle id={titleId} variant="micro" className="min-w-0 truncate">
          {t('platform.devicePreview.title')}
        </SectionTitle>
        <fieldset className="flex shrink-0 gap-1">
          <legend className="sr-only">{t('platform.devicePreview.theme')}</legend>
          {THEMES.map(({ value, icon: Icon }) => {
            const label = t(`platformBranding.preview.${value}`);
            return (
              <Chip
                key={value}
                active={theme === value}
                onClick={() => setTheme(value)}
                aria-label={label}
                title={label}
                className="h-7 px-2.5"
              >
                <Icon aria-hidden size={14} />
              </Chip>
            );
          })}
        </fieldset>
      </div>

      <div className="relative">
        <fieldset className="grid grid-cols-2 gap-1.5">
          <legend className="sr-only">{t('platform.devicePreview.view')}</legend>
          {VIEWS.map(({ value, icon: Icon }) => (
            <Chip
              key={value}
              active={view === value}
              onClick={() => setView(value)}
              className="h-8 w-full justify-center"
            >
              <Icon aria-hidden size={14} />
              {t(`platform.devicePreview.views.${value}`)}
            </Chip>
          ))}
        </fieldset>
        {/* The screens for the keyboard and screen readers (the phone is aria-hidden): never under
            the pointer, shown over this row only while it has keyboard focus. */}
        <label htmlFor={screenId} className="sr-only">
          {t('platform.devicePreview.screens')}
        </label>
        <select
          id={screenId}
          value={active}
          onChange={(event) => setScreen(event.target.value as PreviewScreen)}
          className="pointer-events-none absolute inset-0 h-8 w-full appearance-none rounded-full bg-bg-input px-3.5 text-xs font-bold text-text opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {screens.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <DevicePhone
        label={t('platform.devicePreview.deviceLabel', { tenant: name })}
        theme={theme}
        screenStyle={screenStyle}
        screenAttributes={look.attributes}
        mediaChrome={!waiting && active === 'reels'}
        interactive={!waiting}
      >
        {waiting ? (
          <div className="flex flex-col gap-6 px-4 pt-[calc(var(--safe-top)+4.5rem)]">
            <Skeleton variant="rect" height={64} className="mx-auto w-1/2 rounded-xl" />
            <Skeleton variant="text" width="70%" className="mx-auto h-6" />
            <Skeleton variant="rect" height={120} className="rounded-xl" />
            <Skeleton variant="rect" height={260} className="rounded-xl" />
          </div>
        ) : (
          <TenantAppPreview
            name={name}
            // The dark mode's own logo while the device is dark (2026-10-05, preview only), the
            // logo otherwise or without one.
            logoUrl={
              theme === 'dark' ? (deferred.logoDarkUrl ?? deferred.logoUrl) : deferred.logoUrl
            }
            modules={deferred.modules}
            screen={active}
            view={view}
            onNavigate={navigate}
            theme={theme}
            onTheme={setTheme}
          />
        )}
      </DevicePhone>
    </section>
  );
}
