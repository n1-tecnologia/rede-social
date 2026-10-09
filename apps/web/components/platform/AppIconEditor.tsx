'use client';

import {
  Button,
  cn,
  FileDropZone,
  type FileDropZoneState,
  SectionTitle,
  SegmentedControl,
} from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SelectMenu } from '@/components/forms/SelectMenu';
import {
  APP_ICON_SOURCE_MAX_BYTES,
  type AppIconBackgroundKind,
  type AppIconLogoSource,
  type AppIconMode,
  type AppIconSettings,
  appIconSpec,
  clampLogoScale,
  DEFAULT_APP_ICON_SETTINGS,
  drawAppIcon,
  followsPrimary,
  type IconImage,
  LOGO_SCALE,
} from '@/lib/app-icon';
import {
  AppIconError,
  type AppIconErrorCode,
  composeAppIconFile,
  loadIconImage,
} from '@/lib/app-icon-image';
import { BRANDING_UPLOAD_ACCEPT } from '@/lib/upload';
import { HomeScreenPreview, type HomeScreenTile } from './HomeScreenPreview';
import { PreviewColorField } from './wizard/PreviewColorField';

/** `<input accept>`: the branding allow-list plus the extensions (some browsers leave SVG's type empty). */
const ACCEPT = `${BRANDING_UPLOAD_ACCEPT},.png,.svg,.webp,.jpg,.jpeg`;
/** The preview canvases' own pixels: the tiles are 64 px, crisp up to a 3x screen. */
const PREVIEW_PX = 192;
/** The size slider, in whole percents (`LOGO_SCALE`). */
const SCALE_MIN = Math.round(LOGO_SCALE.min * 100);
const SCALE_MAX = Math.round(LOGO_SCALE.max * 100);
const SCALE_STEP = 5;
/** The colour field's id (one editor per page). */
const COLOR_ID = 'app-icon-background';
/**
 * The input types whose Enter submits the form around them (the browser clicks its default button)
 * and does nothing of their own: the editor's text fields and its size slider.
 */
const ENTER_SUBMITS = new Set(['text', 'search', 'range']);

/** A logo the editor may start from: its URL, and the file itself when it was picked here. */
export type AppIconLogo = { url: string; file?: File | null };

/** The upload under way on the Marca tab (`useSignedUpload`), read by the footer. */
export type AppIconUpload = { state: FileDropZoneState; progress: number; error: string | null };

export interface AppIconEditorProps {
  /** The root's marker: `data-upload-zone="icon"` on the Marca tab, `data-wizard-image` in the wizard. */
  marker: { [attribute: `data-${string}`]: string };
  /** The tenant's name, as the home screen labels the icon. */
  displayName: string;
  /** The primary the icon's ground follows (the SAVED one on the Marca tab, the draft's in the wizard). */
  primary: string;
  /** The logos a "Logo e fundo" icon may start from: the light mode's and the dark mode's. */
  logos: { light: AppIconLogo | null; dark: AppIconLogo | null };
  /** Today's icon of its own (the uploaded override, or the draft's composed one); `null`: the logo's. */
  iconUrl: string | null;
  /**
   * The icon set the server derived and still serves (its 180 px Apple icon), shown closed when there
   * is neither an icon of its own nor a light logo: an override removed from a tenant without a logo
   * leaves that set behind (the worker derives it again from its previous render). The Marca tab's
   * only; the wizard's draft has no set.
   */
  derivedIconUrl?: string | null;
  /** What the editor opens on (the wizard keeps the last applied choices); else the defaults. */
  initialSettings?: AppIconSettings | null;
  /** Takes the composed icon; the editor closes when it resolves `true`, and stays open otherwise. */
  onApply: (file: File, settings: AppIconSettings) => Promise<boolean> | boolean;
  /** The upload under way (the Marca tab); the wizard keeps the file and has none. */
  upload?: AppIconUpload;
  /**
   * The icon goes straight to an existing tenant: a ground that follows the primary keeps TODAY's
   * (the wizard's draft composes it again on a new one), and installed apps may need a reinstall.
   */
  persisted?: boolean;
  /** Beside "Editar ícone" while there is an icon of its own: "Remover". */
  removeAction?: ReactNode;
  /**
   * The root of the view on screen, for a caller that moves the focus to the editor's button
   * (`[data-app-icon-open]`) itself: the Marca tab, once the dialog confirming its "Remover" closed.
   */
  rootRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}

type ImageState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; image: IconImage }
  | { status: 'failed'; code: AppIconErrorCode | 'generic' };

const NONE: ImageState = { status: 'none' };
const LOADING: ImageState = { status: 'loading' };

function failureCode(error: unknown): AppIconErrorCode | 'generic' {
  return error instanceof AppIconError ? error.code : 'generic';
}

/**
 * One source decoded for the preview (`loadIconImage`) while `active`: `none` without a source,
 * `loading` until it is read, then `ready` or `failed`. A source that changes meanwhile drops the
 * answer of the one before.
 */
function useIconImage(input: File | string | null, active: boolean): ImageState {
  const [loaded, setLoaded] = useState<{ input: File | string; state: ImageState } | null>(null);
  useEffect(() => {
    if (!active || input === null) return;
    let live = true;
    loadIconImage(typeof input === 'string' ? { url: input } : { file: input }).then(
      (image) => {
        if (live) setLoaded({ input, state: { status: 'ready', image } });
      },
      (error: unknown) => {
        if (live) setLoaded({ input, state: { status: 'failed', code: failureCode(error) } });
      },
    );
    return () => {
      live = false;
    };
  }, [input, active]);
  if (!active || input === null) return NONE;
  return loaded?.input === input ? loaded.state : LOADING;
}

const readyImage = (state: ImageState) => (state.status === 'ready' ? state.image : null);

/**
 * The focus is still the editor's to place: in it (the title is one element in both views), or
 * fallen to `<body>` with an element that left with a view. Not when the person took it elsewhere.
 */
function focusIsEditors(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || (root?.contains(active) ?? false);
}

/** The source to draw: the one chosen while it exists, else the light logo, the dark one, a file. */
function availableSource(
  wanted: AppIconLogoSource,
  logos: AppIconEditorProps['logos'],
): AppIconLogoSource {
  if (wanted === 'file' || logos[wanted]) return wanted;
  if (logos.light) return 'light';
  if (logos.dark) return 'dark';
  return 'file';
}

/**
 * "Ícone do app" (2026-10-09): how the installed app shows on a phone's home screen, composed here
 * and sent as the square override (`kind: 'icon'`, D-28) by the caller (`onApply`): the Marca tab
 * uploads it at once (`IconOverrideUpload`), the wizard keeps it in its draft until the tenant is
 * created. The worker derives the favicon and the 192/512/maskable/Apple set from it as from any
 * override, and the manifest follows on its own.
 *
 * Closed by default: the home screen as it is today (`HomeScreenPreview`, the icon of its own or the
 * logo the icons come from, else the set the server still serves, `derivedIconUrl`) with
 * "Personalizar ícone" ("Editar ícone" once there is an icon of its own, with the caller's "Remover"
 * beside it). Open, it composes live on two canvases, the very drawing that is uploaded
 * (`drawAppIcon`), in one of two modes ("Logo e fundo", "Arte única"):
 *
 * - the logo: the light mode's or the dark mode's (`logos`), or another file; a logo the browser
 *   cannot read from its URL (the bucket answering without CORS) says so and asks for the file; its
 *   size, 30% to 100% of the side; the ground, a colour (the primary until one is picked, with "Usar
 *   a cor principal" back to it, the button colours' own field) or an image covering the square;
 * - the art: one image covering the whole square, cropped in its centre.
 *
 * "Usar como ícone do app" composes the 1024 px square (`composeAppIconFile`, a PNG, or a JPEG when
 * the PNG passes the 2 MiB branding limit) and hands it over; the editor closes once `onApply`
 * resolves `true` and remembers the choices for the next opening, while "Cancelar" drops them. While
 * the icon is prepared or sent (`busy`) every control waits, the sources and settings in a disabled
 * `<fieldset>`: an edit then would be lost. Every source is picked up to 15 MiB in the branding
 * formats and stays in this browser; the sources are decoded into canvases and their object URLs
 * revoked at once (`loadIconImage`). Every button is `type="button"` and Enter in a field (the
 * ground's hex, the logo's size) stays in the editor: the wizard's step around it is a `<form>`, and
 * submitting it would leave the step with the choices not yet applied.
 *
 * The two views swap in place, so the focus moves with them, never to `<body>` (WCAG 2.4.3): to the
 * open view's title on opening, back to the button that opens it on closing ("Cancelar", an applied
 * icon; a focus taken elsewhere while the icon was sent stays there), and to that button too when
 * the caller's "Remover" takes the focused button away with the icon (a "Remover" that asks first
 * leaves the focus in its dialog: that caller moves it there once the dialog has closed, through
 * `rootRef`).
 */
export function AppIconEditor({
  marker,
  displayName,
  primary,
  logos,
  iconUrl,
  derivedIconUrl = null,
  initialSettings = null,
  onApply,
  upload,
  persisted = false,
  removeAction,
  rootRef: callerRoot,
  className,
}: AppIconEditorProps) {
  const t = useTranslations('platformBranding');
  const tp = useTranslations('platform');
  const sourceLabelId = useId();
  const scaleId = useId();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AppIconSettings>(DEFAULT_APP_ICON_SETTINGS);
  const [composing, setComposing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Partial<Record<'logo' | 'background' | 'art', string>>>(
    {},
  );
  /** The choices of the last icon taken here, for the next opening. */
  const applied = useRef<AppIconSettings | null>(null);
  /** The root of the view on screen, where the focus targets are found. */
  const rootRef = useRef<HTMLDivElement>(null);
  /** Each view's root, kept here and in the caller's `rootRef` when there is one. */
  const keepRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (callerRoot) callerRoot.current = node;
    },
    [callerRoot],
  );
  /** `open` and the icon of its own as the last commit had them: the focus moves on a change only. */
  const wasOpen = useRef(open);
  const hadIcon = useRef(iconUrl !== null);

  const logoMode = settings.mode === 'logo';
  const source = availableSource(settings.logoSource, logos);
  const sourceLogo = source === 'file' ? null : logos[source];
  const logo = useIconImage(
    logoMode
      ? source === 'file'
        ? settings.logoFile
        : (sourceLogo?.file ?? sourceLogo?.url ?? null)
      : null,
    open,
  );
  const background = useIconImage(
    logoMode && settings.backgroundKind === 'image' ? settings.backgroundImage : null,
    open,
  );
  const art = useIconImage(settings.mode === 'art' ? settings.art : null, open);

  const spec = useMemo(
    () =>
      appIconSpec(settings, primary, {
        logo: readyImage(logo),
        backgroundImage: readyImage(background),
        art: readyImage(art),
      }),
    [settings, primary, logo, background, art],
  );

  // The two preview canvases, redrawn from the spec on every change.
  const canvases = useRef(new Map<HomeScreenTile, HTMLCanvasElement>());
  const canvasRefs = useMemo(() => {
    const keep = (tile: HomeScreenTile) => (node: HTMLCanvasElement | null) => {
      if (node) canvases.current.set(tile, node);
      else canvases.current.delete(tile);
    };
    return { ios: keep('ios'), android: keep('android') };
  }, []);
  useEffect(() => {
    if (!open) return;
    for (const canvas of canvases.current.values()) {
      const context = canvas.getContext('2d');
      if (context) drawAppIcon(context, spec, canvas.width);
    }
  }, [open, spec]);

  // The views swap, and the focused button leaves with its view: the focus goes to the open view's
  // title on opening and back to the button that opens it on closing, unless it was taken elsewhere
  // meanwhile (an upload takes a while). Never on the first render.
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const root = rootRef.current;
    if (!open && !focusIsEditors(root)) return;
    root
      ?.querySelector<HTMLElement>(open ? '[data-app-icon-title]' : '[data-app-icon-open]')
      ?.focus();
  }, [open]);

  // The caller's "Remover" leaves with the icon it removed, and the focus it held fell to <body>:
  // the button that opens the editor takes it. A focus the person took elsewhere stays there.
  useEffect(() => {
    const had = hadIcon.current;
    hadIcon.current = iconUrl !== null;
    const root = rootRef.current;
    if (open || !had || iconUrl !== null || !focusIsEditors(root)) return;
    root?.querySelector<HTMLElement>('[data-app-icon-open]')?.focus();
  }, [open, iconUrl]);

  const uploading = upload !== undefined && upload.state !== 'idle';
  const busy = composing || uploading;
  const sourceReady = logoMode
    ? logo.status === 'ready' &&
      (settings.backgroundKind === 'color' || background.status === 'ready')
    : art.status === 'ready';
  const canApply = sourceReady && !busy;

  const update = (patch: Partial<AppIconSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const start = () => {
    setSettings(initialSettings ?? applied.current ?? DEFAULT_APP_ICON_SETTINGS);
    setError(null);
    setRejected({});
    setAttempted(false);
    setOpen(true);
  };

  const apply = async () => {
    if (!canApply) return;
    const chosen: AppIconSettings = { ...settings, logoSource: source };
    setError(null);
    setAttempted(true);
    setComposing(true);
    let file: File;
    try {
      file = await composeAppIconFile({ settings: chosen, primary, logo: readyImage(logo) });
    } catch (failure) {
      if (!(failure instanceof AppIconError)) {
        console.error('platform.branding.app_icon_failed', { error: String(failure) });
      }
      setError(t(`appIcon.errors.${failureCode(failure)}`));
      return;
    } finally {
      setComposing(false);
    }
    if (await onApply(file, chosen)) {
      applied.current = chosen;
      setOpen(false);
    }
  };

  /**
   * Enter in a field (the ground's hex, the logo's size) stays in the editor: in the wizard the step
   * around it is a `<form>`, whose implicit submission would leave the step with the choices not
   * applied. The colour and file inputs keep it: Enter opens their pickers.
   */
  const keepEnterInFields = (event: KeyboardEvent<HTMLDivElement>) => {
    const field = event.target;
    if (
      event.key === 'Enter' &&
      field instanceof HTMLInputElement &&
      ENTER_SUBMITS.has(field.type)
    ) {
      event.preventDefault();
    }
  };

  /** A file a zone refused before decoding (its type, or over 15 MiB). */
  const reject = (zone: 'logo' | 'background' | 'art') => (reason: 'type' | 'size') =>
    setRejected((prev) => ({
      ...prev,
      [zone]: reason === 'type' ? t('errors.type') : t('appIcon.errors.tooLarge'),
    }));
  const pick = (zone: 'logo' | 'background' | 'art', patch: Partial<AppIconSettings>) => {
    setRejected((prev) => ({ ...prev, [zone]: undefined }));
    update(patch);
  };
  const failureOf = (state: ImageState) =>
    state.status === 'failed' ? t(`appIcon.errors.${state.code}`) : undefined;

  const dropZone = (
    zone: 'logo' | 'background' | 'art',
    caption: string,
    onFile: (file: File) => void,
    failure?: string,
  ) => (
    <div data-app-icon-zone={zone}>
      <FileDropZone
        accept={ACCEPT}
        maxBytes={APP_ICON_SOURCE_MAX_BYTES}
        disabled={busy}
        error={rejected[zone] ?? failure}
        onFile={onFile}
        onReject={reject(zone)}
        labels={{
          caption,
          progress: (percent) => t('upload.progress', { percent }),
          processing: t('upload.processing'),
        }}
      />
    </div>
  );

  const previewLabels = {
    aria: t('appIcon.preview.aria'),
    ios: t('appIcon.preview.ios'),
    android: t('appIcon.preview.android'),
  };

  if (!open) {
    const current = iconUrl ?? logos.light?.url ?? null;
    // Neither an icon of its own nor a logo, yet a set derived before is still served: the home
    // screen shows that one, as the phone gets it.
    const shown = current ?? derivedIconUrl;
    // A square icon (its own, or the derived set's) covers the tile; a logo is fitted whole.
    const square = iconUrl !== null || current === null;
    return (
      <div
        {...marker}
        ref={keepRoot}
        data-app-icon-editor="closed"
        className={cn('flex flex-col gap-4', className)}
      >
        <SectionTitle variant="group">{t('icon.title')}</SectionTitle>
        <p className="text-sm text-text-secondary">{t('appIcon.body')}</p>
        <HomeScreenPreview
          className="w-full max-w-sm"
          displayName={displayName}
          primary={primary}
          labels={previewLabels}
          renderIcon={() =>
            shown ? (
              // biome-ignore lint/performance/noImgElement: D-26/D-28 — the tenant's own icon, its logo or its derived icon, as-is (a public bucket URL or a local object URL).
              <img
                src={shown}
                alt=""
                className={cn('size-full', square ? 'object-cover' : 'object-contain')}
                referrerPolicy="no-referrer"
              />
            ) : null
          }
        />
        <p className="text-xs text-text-tertiary">
          {shown ? t('appIcon.preview.androidNote') : t('appIcon.preview.noSource')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" data-app-icon-open onClick={start}>
            {iconUrl ? t('appIcon.edit') : t('appIcon.customize')}
          </Button>
          {iconUrl ? removeAction : null}
        </div>
      </div>
    );
  }

  const sourceOptions = [
    ...(logos.light ? [{ id: 'light', label: t('appIcon.logo.light') }] : []),
    ...(logos.dark ? [{ id: 'dark', label: t('appIcon.logo.dark') }] : []),
    { id: 'file', label: t('appIcon.logo.file') },
  ];
  // The logo's state, said where the logo is chosen. A file's own failure is the drop zone's alert;
  // a logo read from its URL says it here, and a URL that cannot be read asks for the file.
  const fromUrl = source !== 'file';
  const unreachable = logo.status === 'failed' && logo.code === 'unreachable';
  const logoState =
    logo.status === 'none'
      ? 'missing'
      : logo.status === 'failed'
        ? unreachable
          ? 'unreachable'
          : 'error'
        : logo.status;
  const logoNote =
    logoState === 'loading'
      ? t('appIcon.logo.loading')
      : logoState === 'missing'
        ? t('appIcon.logo.missing')
        : logoState === 'unreachable'
          ? t('appIcon.logo.unreachable')
          : logoState === 'error' && fromUrl
            ? failureOf(logo)
            : '';
  const percent = Math.round(clampLogoScale(settings.logoScale) * 100);
  const scaleText = t('appIcon.logo.sizeValue', { percent });
  const status = composing
    ? t('appIcon.preparing')
    : upload?.state === 'progress'
      ? t('upload.progress', { percent: upload.progress })
      : upload?.state === 'processing'
        ? t('upload.processing')
        : '';
  const failure = error ?? (attempted && !busy ? (upload?.error ?? null) : null);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only hears the keys bubbling from the editor's own controls, to keep Enter in its fields (`keepEnterInFields`); the wrapper adds no interaction.
    <div
      {...marker}
      ref={keepRoot}
      data-app-icon-editor="open"
      className={cn('flex flex-col gap-5', className)}
      onKeyDown={keepEnterInFields}
    >
      {/* Where the focus lands on opening (`tabIndex={-1}`: never a Tab stop). */}
      <SectionTitle variant="group" tabIndex={-1} data-app-icon-title className="outline-none">
        {t('icon.title')}
      </SectionTitle>
      <SegmentedControl
        label={t('appIcon.mode.label')}
        options={[
          { value: 'logo', label: t('appIcon.mode.logo') },
          { value: 'art', label: t('appIcon.mode.art') },
        ]}
        value={settings.mode}
        disabled={busy}
        onChange={(mode) => update({ mode: mode as AppIconMode })}
      />
      <div className="flex flex-col gap-2">
        <HomeScreenPreview
          className="w-full max-w-sm"
          displayName={displayName}
          primary={primary}
          labels={previewLabels}
          renderIcon={(tile) => (
            <canvas
              ref={canvasRefs[tile]}
              width={PREVIEW_PX}
              height={PREVIEW_PX}
              className="size-full"
            />
          )}
        />
        <p className="text-xs text-text-tertiary">{t('appIcon.preview.androidNote')}</p>
      </div>

      {/* While the icon is prepared or sent, the sources and settings wait with the mode and the
          footer: an edit made then would be lost. The fieldset only disables (no box of its own). */}
      <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
        {logoMode ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              {sourceOptions.length > 1 ? (
                <>
                  <span id={sourceLabelId} className="text-sm text-text-secondary">
                    {t('appIcon.logo.label')}
                  </span>
                  <SelectMenu
                    labelId={sourceLabelId}
                    options={sourceOptions}
                    value={source}
                    onChange={(id) => update({ logoSource: id as AppIconLogoSource })}
                    optionAttribute="logo-source"
                  />
                </>
              ) : null}
              <p
                role="status"
                data-app-icon-logo-state={logoState}
                className="text-sm text-text-secondary"
              >
                {logoNote}
              </p>
              {!fromUrl || logo.status === 'failed'
                ? dropZone(
                    'logo',
                    settings.logoFile && !fromUrl
                      ? t('appIcon.logo.replace')
                      : t('appIcon.logo.choose'),
                    (file) => pick('logo', { logoSource: 'file', logoFile: file }),
                    fromUrl ? undefined : failureOf(logo),
                  )
                : null}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={scaleId} className="text-sm text-text-secondary">
                  {t('appIcon.logo.size')}
                </label>
                <output htmlFor={scaleId} className="text-sm font-bold text-text tabular-nums">
                  {scaleText}
                </output>
              </div>
              <input
                id={scaleId}
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={SCALE_STEP}
                value={percent}
                aria-valuetext={scaleText}
                onChange={(event) =>
                  update({ logoScale: clampLogoScale(Number(event.target.value) / 100) })
                }
                className="h-11 w-full cursor-pointer accent-brand"
              />
            </div>

            <div className="flex flex-col gap-3">
              <SegmentedControl
                label={t('appIcon.background.label')}
                options={[
                  { value: 'color', label: t('appIcon.background.color') },
                  { value: 'image', label: t('appIcon.background.image') },
                ]}
                value={settings.backgroundKind}
                disabled={busy}
                onChange={(kind) => update({ backgroundKind: kind as AppIconBackgroundKind })}
              />
              {settings.backgroundKind === 'color' ? (
                <>
                  <PreviewColorField
                    id={COLOR_ID}
                    label={t('appIcon.background.colorLabel')}
                    pickLabel={t('appIcon.background.pick')}
                    placeholder={tp('new.hexPlaceholder')}
                    value={settings.backgroundColor}
                    fallback={primary}
                    onChange={(hex) => update({ backgroundColor: hex })}
                    onReset={() => update({ backgroundColor: null })}
                    resetLabel={t('appIcon.background.reset')}
                    resetName={t('appIcon.background.resetNamed')}
                    fallbackLabel={t('appIcon.background.primary')}
                  />
                  {persisted && followsPrimary(settings) ? (
                    <p className="text-xs text-text-tertiary">{t('appIcon.primaryNote')}</p>
                  ) : null}
                </>
              ) : (
                <>
                  {dropZone(
                    'background',
                    settings.backgroundImage
                      ? t('appIcon.background.replace')
                      : t('appIcon.background.choose'),
                    (file) => pick('background', { backgroundImage: file }),
                    failureOf(background),
                  )}
                  <p className="text-xs text-text-tertiary">{t('appIcon.background.hint')}</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {dropZone(
              'art',
              settings.art ? t('appIcon.art.replace') : t('appIcon.art.choose'),
              (file) => pick('art', { art: file }),
              failureOf(art),
            )}
            <p className="text-xs text-text-tertiary">{t('appIcon.art.hint')}</p>
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-divider pt-4">
        <div className="flex flex-col gap-1">
          <p role="status" className="text-sm text-text-secondary">
            {status}
          </p>
          {failure ? (
            <p role="alert" className="text-sm text-danger">
              {failure}
            </p>
          ) : null}
          {persisted ? (
            <p className="text-xs text-text-tertiary">{t('appIcon.reinstallNote')}</p>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            {t('appIcon.cancel')}
          </Button>
          <Button
            type="button"
            variant="brand"
            data-app-icon-apply
            loading={busy}
            disabled={!canApply}
            onClick={apply}
          >
            {t('appIcon.apply')}
          </Button>
        </div>
      </div>
    </div>
  );
}
