'use client';

import { MediaImage } from '@rede-social/core/ui';
import { GLASS_CHIP } from '@rede-social/module-courses/ui';
import { Button, cn } from '@rede-social/ui';
import { Camera, Image as ImageIcon, LoaderCircle, Upload, X } from 'lucide-react';
import {
  type DragEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { SignedUploadState } from '@/components/media/useSignedUpload';

export interface CoverFieldLabels {
  /** The field's label ("Capa"). */
  field: string;
  /** "Adicionar capa": the frame's name (and the file input's) without a cover. */
  add: string;
  /** "Trocar capa": the frame's name (and the file input's) with one. */
  change: string;
  /** "Remover capa": the control on the label line. */
  remove: string;
  /** The preview image's alt ("Prévia da capa"). */
  preview: string;
  progress: (percent: number) => string;
  processing: string;
  /** "Cancelar": the in-flight transfer's cancel; absent → no cancel control. */
  cancel?: string;
  /** 2026-10-23: "Escolher arquivo", the explicit picker under the frame. */
  pickFile?: string;
  /** 2026-10-23: "Tirar foto", the camera picker (touch screens only). */
  camera?: string;
  /** 2026-10-23: the ways on a mouse ("Arraste…, cole com Ctrl+V ou escolha um arquivo."). */
  ways?: string;
  /** 2026-10-23: the ways on a touch screen ("Escolha da galeria ou tire uma foto."). */
  waysTouch?: string;
  /** 2026-10-23: over the frame while a file is dragged onto it ("Solte para usar como capa"). */
  dropHere?: string;
}

/** The proportions a cover is shown at, for the frame and the "also shown as" previews. */
export type CoverRatio = 'poster' | 'wide' | 'video' | 'panoramic' | 'tile' | 'banner';

/**
 * 2026-11-09 (NOVF-02, UI-D-691): the "Topo" block as a picker of its OWN, with its own asset. It is
 * the same machine as the card block, held a second time by the host: its own upload and preview
 * state, progress, announcement, remove control and error line. Hooks, beside the card's
 * `data-{hook}-cover-*` ones (which stay as they are):
 *  - `data-{hook}-top-cover-preview`: the frame (a button, a click or a drop picks a file);
 *  - `data-{hook}-top-cover-local`: the picture of the file being uploaded;
 *  - `data-{hook}-top-cover-fallback`: the empty state (the card image's status line, or the gradient);
 *  - `data-{hook}-top-cover-error`: the block's own refusal (`top_cover_invalid`);
 *  - `data-{hook}-top-cover-remove`: "Remover imagem do topo".
 */
export interface CoverTopBlock {
  /** The Topo's own asset id; null draws the fallback (the card image, else the gradient). */
  assetId: string | null;
  widths: readonly number[];
  /** The local object URL of the Topo being uploaded (`useCoverPreview`). */
  previewUrl: string | null;
  upload: { state: SignedUploadState; progress: number; error: string | null };
  /** The block's own refusal (the server's `top_cover_invalid`). */
  error: string | null;
  announced?: string;
  /** The block's own size line. */
  sizeHint?: ReactNode;
  /** Drawn over the frame's picture (the page's own eyebrow and title). */
  decor?: ReactNode;
  /** The frame's proportion; the 4:1 banner by default. */
  ratio?: CoverRatio;
  helper?: string;
  /** "Sem imagem própria: mostrando a do cartão.": the line while the Topo is empty and the card shows. */
  fallbackStatus?: string;
  /** `field` is the block's title ("Topo · página da trilha"); the rest are the block's own words. */
  labels: CoverFieldLabels;
  onPick: (file: File) => void;
  onRemove: () => void;
  onCancel?: () => void;
}

export interface CoverFieldProps {
  /** The form's hook family: `data-{hook}-cover-preview`, `-local`, `-fallback`, `-error`. */
  hook: 'course' | 'track' | 'live' | 'category' | 'module';
  /**
   * The REAL proportion of the cover where it is used: the 3:4 poster, the 16:10 card, or (2026-10-27)
   * the 4:3 track card of Início and Trilhas, or the 16:9 course card of Cursos and Início.
   */
  ratio: 'poster' | 'wide' | 'card' | 'video';
  /**
   * 2026-10-27: the frame's caption, under it ("Card · Início e Trilhas"), like the previews' own;
   * and `frameDecor`, drawn over the frame's picture to show it as the member sees it (the track
   * card's veil, title and chip). Both optional: without them the frame is as it always was.
   */
  frameLabel?: string;
  frameDecor?: ReactNode;
  /** The category sheet's small frame (120px). */
  compact?: boolean;
  /**
   * The drop target's id: since 2026-10-23 the field itself (the frame takes the file), where it used
   * to name the separate desktop drop zone under the frame.
   */
  dropzoneId?: string;
  accept: string;
  assetId: string | null;
  widths: readonly number[];
  /** The local object URL of the file being uploaded (`useCoverPreview`). */
  previewUrl: string | null;
  sizes: string;
  upload: { state: SignedUploadState; progress: number; error: string | null };
  /** The field's own refusal (the server's `cover_invalid`). */
  error: string | null;
  helper?: string;
  /** A cancelled live: the frame only, no control. */
  readOnly?: boolean;
  /** The polite announcement of the upload's quartiles. */
  announced?: string;
  /**
   * 2026-10-23: the other places the SAME image is shown, drawn beside the frame at their proportion
   * (a course's poster also heads its page horizontally), so the admin picks an image that works in
   * both. Read-only previews, no control.
   */
  alsoAs?: ReadonlyArray<{
    key: string;
    ratio: CoverRatio;
    label: string;
    decor?: ReactNode;
    /** 2026-10-27, `layout="blocks"`: this place's own size line. */
    sizeHint?: ReactNode;
  }>;
  /**
   * 2026-10-27 (the product owner: "as duas imagens devem ter seu campo de envio e suas medidas
   * separadas", "não dá pra colocar um botão e escrever as medidas, mudar o layout?"): `blocks`
   * stacks the frame and each `alsoAs` place as blocks of their own, each with its title above, its
   * preview (a picker too: a click, a drop), its size and its own "Escolher arquivo". The image is
   * still ONE: one file input, one paste listener, the hooks on the frame alone. `inline` (the
   * default) is the field as it always was.
   */
  layout?: 'inline' | 'blocks';
  /**
   * 2026-11-09: with `layout="blocks"`, a second picker of its own under the card block, in place of
   * the `alsoAs` view of the same image (see `CoverTopBlock`). A paste still goes to the card block.
   */
  topCover?: CoverTopBlock;
  /**
   * 2026-10-23: the ideal size of the image (`CoverSizeHint`), under the frame and before the
   * pickers; not on a read-only field.
   */
  sizeHint?: ReactNode;
  labels: CoverFieldLabels;
  onPick: (file: File) => void;
  onRemove: () => void;
  onCancel?: () => void;
}

/** The two frames, in the cover's real proportion (the member catalogue's poster, the live card). */
const FRAME = {
  poster: 'aspect-[3/4] max-w-[240px]',
  wide: 'aspect-[16/10] max-w-[360px]',
  card: 'aspect-[4/3] max-w-[320px]',
  video: 'aspect-video max-w-[360px]',
} as const;

/** The frame's column when it carries a caption: as wide as the frame. */
const FRAME_BOX = {
  poster: 'w-full max-w-[240px]',
  wide: 'w-full max-w-[360px]',
  card: 'w-full max-w-[320px]',
  video: 'w-full max-w-[360px]',
} as const;

/** The "also shown as" previews: smaller, at the proportion of the place they stand for. */
const ALSO_FRAME: Record<CoverRatio, string> = {
  poster: 'aspect-[3/4] w-[120px]',
  wide: 'aspect-[16/10] w-[220px]',
  video: 'aspect-video w-[240px]',
  panoramic: 'aspect-[21/9] w-[260px]',
  tile: 'aspect-[4/3] w-[150px]',
  /** 2026-10-27: the wide top of a track's page (`MemberDetailHero`). */
  banner: 'aspect-[4/1] w-[440px] max-w-full',
};

/** 2026-10-27, `layout="blocks"`: a place's preview at its own block's size. */
const BLOCK_FRAME: Record<CoverRatio, string> = {
  poster: 'aspect-[3/4] w-full max-w-[240px]',
  wide: 'aspect-[16/10] w-full max-w-[360px]',
  video: 'aspect-video w-full max-w-[420px]',
  panoramic: 'aspect-[21/9] w-full max-w-[560px]',
  tile: 'aspect-[4/3] w-full max-w-[240px]',
  banner: 'aspect-[4/1] w-full max-w-[640px]',
};

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The first image among dropped or pasted files, if any. */
function firstImage(files: FileList | null | undefined): File | null {
  if (!files) return null;
  for (const file of Array.from(files)) if (file.type.startsWith('image/')) return file;
  return null;
}

/** Focus in a text field: a paste there is text, never a cover. */
function editingText(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return (
    active.isContentEditable ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLInputElement && active.type !== 'file' && active.type !== 'button')
  );
}

/**
 * 2026-10-22 — the admin's ONE cover field (the social-igoralves `CoverPicker` frame), replacing the
 * four cover blocks the course, track and live forms and the category sheet each drew. The frame IS
 * the control: the cover in the proportion it is used at (3:4 for a course and a category, 16:10 for
 * a track and a live), outlined, with the glass "Adicionar capa" / "Trocar capa" chip over its foot
 * and a spinner veil while the file uploads; "Remover capa" moved to the label line, so the frame
 * keeps the whole width. Under it: the progress bar with its percent and "Cancelar", the polite
 * quartile announcement, the error and the helper.
 *
 * **2026-10-23 — every way to attach a cover** (the product owner's call), all into the same
 * `onPick`, so the host's upload machine is untouched:
 *  - a tap or click on the frame, or "Escolher arquivo" under it: the file picker;
 *  - a file DRAGGED onto the frame (the separate desktop drop zone it replaces), with a brand veil
 *    and "Solte para usar como capa" while it hovers;
 *  - a PASTED image (Ctrl+V / Cmd+V) anywhere on the page while no text field has the focus;
 *  - "Tirar foto" on a touch screen: the camera (`capture`), next to the gallery picker.
 * And beside the frame, `alsoAs`: the same image at the other proportions it is shown at (a course's
 * poster also heads its page horizontally), so the admin sees both crops before saving; under it,
 * `sizeHint`, the ideal size of the image (2026-10-23).
 *
 * It owns no upload: the host keeps its `useSignedUpload` / `useCoverPreview` machine (MEDIA-01,
 * zero upload code here) and passes the state in. The sr-only `<input type="file">` keeps its add /
 * change name, and every `data-{hook}-cover-*` hook keeps its element (the previews carry none), so
 * the e2e and the forms' tests read the field as before. Every word arrives from the host's catalog.
 */
export function CoverField({
  hook,
  ratio,
  compact = false,
  dropzoneId,
  accept,
  assetId,
  widths,
  previewUrl,
  sizes,
  upload,
  error,
  helper,
  readOnly = false,
  announced,
  alsoAs,
  frameLabel,
  frameDecor,
  layout = 'inline',
  topCover,
  sizeHint,
  labels,
  onPick,
  onRemove,
  onCancel,
}: CoverFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const topInputRef = useRef<HTMLInputElement>(null);
  const topCameraRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const topLabelId = useId();
  const [dragging, setDragging] = useState(false);
  const [topDragging, setTopDragging] = useState(false);
  const uploading = upload.state === 'preparing' || upload.state === 'progress';
  const topUploading =
    topCover !== undefined &&
    (topCover.upload.state === 'preparing' || topCover.upload.state === 'progress');
  const withTop = layout === 'blocks' && topCover !== undefined;
  const hasCover = assetId !== null || previewUrl !== null;
  const action = assetId ? labels.change : labels.add;
  const hooks = (part: 'preview' | 'local' | 'fallback' | 'error' | 'remove') => ({
    [`data-${hook}-cover-${part}`]: true,
  });
  const topHooks = (part: 'preview' | 'local' | 'fallback' | 'error' | 'remove') => ({
    [`data-${hook}-top-cover-${part}`]: true,
  });

  // A pasted image becomes the cover, unless the paste is text going into a field.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (event: ClipboardEvent) => {
      if (uploading || editingText()) return;
      const file = firstImage(event.clipboardData?.files);
      if (!file) return;
      event.preventDefault();
      pickRef.current(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [readOnly, uploading]);

  const picture = (withHooks: boolean, size: string): ReactNode =>
    previewUrl ? (
      // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded; next/image cannot load it (the `CommunityCover` precedent)
      <img
        src={previewUrl}
        alt={withHooks ? labels.preview : ''}
        {...(withHooks ? hooks('local') : {})}
        className="h-full w-full object-cover object-center"
      />
    ) : assetId !== null ? (
      <MediaImage
        assetId={assetId}
        widths={widths}
        alt={withHooks ? labels.preview : ''}
        sizes={size}
        ratio=""
        className="h-full w-full"
        fallback={
          <span
            aria-hidden
            className="block h-full w-full"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        }
      />
    ) : (
      <span
        {...(withHooks ? hooks('fallback') : {})}
        aria-hidden
        className="flex h-full w-full items-center justify-center"
        style={{ backgroundImage: 'var(--brand-gradient)' }}
      >
        <ImageIcon aria-hidden size={compact ? 20 : 24} className="text-white/80" />
      </span>
    );

  const frameClass = cn(
    'relative block w-full overflow-hidden rounded-2xl border border-border bg-bg-tertiary',
    compact ? 'aspect-[3/4] max-w-[120px]' : FRAME[ratio],
  );

  const dropProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = firstImage(event.dataTransfer.files);
      if (file && !uploading) onPick(file);
    },
  };

  const frame = readOnly ? (
    <div {...hooks('preview')} className={frameClass}>
      {picture(true, sizes)}
      {frameDecor}
    </div>
  ) : (
    <button
      type="button"
      {...hooks('preview')}
      aria-label={action}
      aria-describedby={labelId}
      disabled={uploading}
      onClick={() => inputRef.current?.click()}
      {...dropProps}
      className={cn(
        frameClass,
        'group text-left transition-opacity active:opacity-90 disabled:cursor-progress',
        FOCUS,
        dragging && 'ring-2 ring-brand ring-offset-2 ring-offset-bg',
      )}
    >
      {picture(true, sizes)}
      {frameDecor}
      {hasCover && !frameDecor ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent"
        />
      ) : null}
      <span
        aria-hidden
        className={cn(
          GLASS_CHIP,
          'pointer-events-none absolute right-2 bottom-2 max-w-[calc(100%-1rem)] group-hover:bg-black/70',
        )}
      >
        <ImageIcon aria-hidden size={11} className="shrink-0" />
        {action}
      </span>
      {dragging && labels.dropHere ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand/70 p-3 text-center text-sm font-bold text-white"
        >
          {labels.dropHere}
        </span>
      ) : null}
      {uploading ? (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/35">
          <LoaderCircle size={24} className="animate-spin text-white motion-reduce:animate-none" />
        </span>
      ) : null}
    </button>
  );

  const pickRowFor = (
    refs: { input: RefObject<HTMLInputElement | null>; camera: RefObject<HTMLInputElement | null> },
    busy: boolean,
    words: CoverFieldLabels,
    main: boolean,
  ): ReactNode =>
    words.pickFile || words.camera ? (
      <div className="flex flex-wrap items-center gap-2">
        {words.pickFile ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            data-cover-pick=""
            onClick={() => refs.input.current?.click()}
          >
            <Upload aria-hidden size={14} className="shrink-0" />
            {words.pickFile}
          </Button>
        ) : null}
        {words.camera && main ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            data-cover-camera=""
            className="hidden pointer-coarse:inline-flex"
            onClick={() => refs.camera.current?.click()}
          >
            <Camera aria-hidden size={14} className="shrink-0" />
            {words.camera}
          </Button>
        ) : null}
        {words.ways && main ? (
          <span className="hidden text-xs text-text-tertiary pointer-fine:inline">
            {words.ways}
          </span>
        ) : null}
        {words.waysTouch && main ? (
          <span className="hidden text-xs text-text-tertiary pointer-coarse:inline">
            {words.waysTouch}
          </span>
        ) : null}
      </div>
    ) : null;

  const pickRow = (main: boolean): ReactNode =>
    pickRowFor({ input: inputRef, camera: cameraRef }, uploading, labels, main);

  /** The progress bar, the polite announcement, the error line and the helper of ONE image. */
  const status = (s: {
    upload: CoverFieldProps['upload'];
    error: string | null;
    announced: string | undefined;
    helper: string | undefined;
    words: CoverFieldLabels;
    onCancel: (() => void) | undefined;
    errorHooks: Record<string, boolean>;
  }): ReactNode => (
    <>
      {s.upload.state === 'progress' ? (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={s.upload.progress}
            className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
              style={{ width: `${s.upload.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums text-text-tertiary">
              {s.words.progress(s.upload.progress)}
            </span>
            {s.onCancel && s.words.cancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={s.onCancel}>
                {s.words.cancel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : s.upload.state === 'processing' ? (
        <p className="text-xs text-text-tertiary">{s.words.processing}</p>
      ) : null}

      {s.announced !== undefined ? (
        <span aria-live="polite" className="sr-only">
          {s.announced}
        </span>
      ) : null}

      {s.upload.error || s.error ? (
        <p role="alert" {...s.errorHooks} className="text-sm font-normal text-danger">
          {s.upload.error ?? s.error}
        </p>
      ) : null}
      {s.helper ? <p className="text-xs font-normal text-text-tertiary">{s.helper}</p> : null}
    </>
  );

  const cardStatus = {
    upload,
    error,
    announced,
    helper,
    words: labels,
    onCancel,
    errorHooks: hooks('error'),
  };

  const previews =
    alsoAs && alsoAs.length > 0 ? (
      <ul className="flex flex-wrap items-end gap-4" data-cover-also="">
        {alsoAs.map((also) => (
          <li key={also.key} className="flex min-w-0 max-w-full flex-col gap-1.5">
            <span
              aria-hidden
              className={cn(
                'relative block overflow-hidden rounded-xl border border-border bg-bg-tertiary',
                ALSO_FRAME[also.ratio],
              )}
            >
              {picture(false, also.ratio === 'banner' ? '440px' : '260px')}
              {also.decor}
            </span>
            <span className="text-[11px] font-medium text-text-tertiary">{also.label}</span>
          </li>
        ))}
      </ul>
    ) : null;

  /** The Topo block (NOVF-02, UI-D-691): its own frame, picker, progress, remove control and error. */
  const topBlock = (() => {
    if (!withTop || !topCover) return null;
    const ratioKey = topCover.ratio ?? 'banner';
    const action = topCover.assetId ? topCover.labels.change : topCover.labels.add;
    const cardShows = previewUrl !== null || assetId !== null;
    const ownPicture = topCover.previewUrl ? (
      // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded; next/image cannot load it (the `CommunityCover` precedent)
      <img
        src={topCover.previewUrl}
        alt={topCover.labels.preview}
        {...topHooks('local')}
        className="h-full w-full object-cover object-center"
      />
    ) : topCover.assetId ? (
      <MediaImage
        assetId={topCover.assetId}
        widths={topCover.widths}
        alt={topCover.labels.preview}
        sizes="640px"
        ratio=""
        className="h-full w-full"
        fallback={
          <span
            aria-hidden
            className="block h-full w-full"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        }
      />
    ) : cardShows ? (
      // No image of its own: the card image, cropped to the Topo's proportion.
      picture(false, '640px')
    ) : (
      <span
        {...topHooks('fallback')}
        aria-hidden
        className="flex h-full w-full items-center justify-center"
        style={{ backgroundImage: 'var(--brand-gradient)' }}
      >
        <ImageIcon aria-hidden size={24} className="text-white/80" />
      </span>
    );
    const frameStyle = cn(
      'relative block overflow-hidden rounded-2xl border border-border bg-bg-tertiary',
      BLOCK_FRAME[ratioKey],
    );
    const emptyAndShowingCard = topCover.assetId === null && !topCover.previewUrl && cardShows;

    return (
      <section
        data-cover-block="page"
        className="flex flex-col gap-2.5 border-t border-border pt-6"
      >
        <div className="flex min-h-6 items-center justify-between gap-3">
          <p id={topLabelId} className="text-xs font-semibold text-text">
            {topCover.labels.field}
          </p>
          {topCover.assetId && !readOnly ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              hitArea
              {...topHooks('remove')}
              disabled={topUploading}
              className="h-7 shrink-0 px-2 text-xs font-semibold text-text-secondary hover:text-danger"
              onClick={topCover.onRemove}
            >
              <X aria-hidden size={14} className="shrink-0" />
              {topCover.labels.remove}
            </Button>
          ) : null}
        </div>
        {readOnly ? (
          <div {...topHooks('preview')} className={frameStyle}>
            {ownPicture}
            {topCover.decor}
          </div>
        ) : (
          <button
            type="button"
            {...topHooks('preview')}
            aria-label={`${action} · ${topCover.labels.field}`}
            aria-describedby={topLabelId}
            disabled={topUploading}
            onClick={() => topInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setTopDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={() => setTopDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setTopDragging(false);
              const file = firstImage(event.dataTransfer.files);
              if (file && !topUploading) topCover.onPick(file);
            }}
            className={cn(
              frameStyle,
              'group text-left transition-opacity active:opacity-90 disabled:cursor-progress',
              FOCUS,
              topDragging && 'ring-2 ring-brand ring-offset-2 ring-offset-bg',
            )}
          >
            {ownPicture}
            {topCover.decor}
            <span
              aria-hidden
              className={cn(
                GLASS_CHIP,
                'pointer-events-none absolute right-2 bottom-2 max-w-[calc(100%-1rem)] group-hover:bg-black/70',
              )}
            >
              <ImageIcon aria-hidden size={11} className="shrink-0" />
              {action}
            </span>
            {topDragging && topCover.labels.dropHere ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand/70 p-3 text-center text-sm font-bold text-white"
              >
                {topCover.labels.dropHere}
              </span>
            ) : null}
            {topUploading ? (
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center bg-black/35"
              >
                <LoaderCircle
                  size={24}
                  className="animate-spin text-white motion-reduce:animate-none"
                />
              </span>
            ) : null}
          </button>
        )}
        {readOnly ? null : topCover.sizeHint}
        {readOnly
          ? null
          : pickRowFor(
              { input: topInputRef, camera: topCameraRef },
              topUploading,
              topCover.labels,
              true,
            )}
        {readOnly ? null : (
          <>
            {emptyAndShowingCard && topCover.fallbackStatus ? (
              <p {...topHooks('fallback')} className="text-xs font-normal text-text-tertiary">
                {topCover.fallbackStatus}
              </p>
            ) : null}
            {status({
              upload: topCover.upload,
              error: topCover.error,
              announced: topCover.announced,
              helper: topCover.helper,
              words: topCover.labels,
              onCancel: topCover.onCancel,
              errorHooks: topHooks('error'),
            })}
          </>
        )}
      </section>
    );
  })();

  return (
    <div id={dropzoneId} className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <span id={labelId} className="text-sm font-normal text-text-secondary">
          {labels.field}
        </span>
        {assetId && !readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            hitArea
            {...hooks('remove')}
            disabled={uploading}
            className="h-7 shrink-0 px-2 text-xs font-semibold text-text-secondary hover:text-danger"
            onClick={onRemove}
          >
            <X aria-hidden size={14} className="shrink-0" />
            {labels.remove}
          </Button>
        ) : null}
      </div>

      {layout === 'blocks' ? (
        <div data-cover-blocks="" className="flex flex-col gap-6">
          <section className="flex flex-col gap-2.5">
            {frameLabel ? <p className="text-xs font-semibold text-text">{frameLabel}</p> : null}
            {frame}
            {readOnly ? null : sizeHint}
            {readOnly ? null : pickRow(true)}
            {readOnly || !withTop ? null : status(cardStatus)}
          </section>
          {topBlock}
          {(withTop ? [] : (alsoAs ?? [])).map((also) => (
            <section
              key={also.key}
              data-cover-block={also.key}
              className="flex flex-col gap-2.5 border-t border-border pt-6"
            >
              <p className="text-xs font-semibold text-text">{also.label}</p>
              {readOnly ? (
                <span
                  aria-hidden
                  className={cn(
                    'relative block overflow-hidden rounded-2xl border border-border bg-bg-tertiary',
                    BLOCK_FRAME[also.ratio],
                  )}
                >
                  {picture(false, '640px')}
                  {also.decor}
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`${action} · ${also.label}`}
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                  {...dropProps}
                  className={cn(
                    'group relative block overflow-hidden rounded-2xl border border-border bg-bg-tertiary text-left transition-opacity active:opacity-90 disabled:cursor-progress',
                    BLOCK_FRAME[also.ratio],
                    FOCUS,
                    dragging && 'ring-2 ring-brand ring-offset-2 ring-offset-bg',
                  )}
                >
                  {picture(false, '640px')}
                  {also.decor}
                  <span
                    aria-hidden
                    className={cn(
                      GLASS_CHIP,
                      'pointer-events-none absolute right-2 bottom-2 max-w-[calc(100%-1rem)] group-hover:bg-black/70',
                    )}
                  >
                    <ImageIcon aria-hidden size={11} className="shrink-0" />
                    {action}
                  </span>
                </button>
              )}
              {readOnly ? null : also.sizeHint}
              {readOnly ? null : pickRow(false)}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div
            className={cn(
              'flex min-w-0 flex-col gap-1.5',
              frameLabel ? FRAME_BOX[compact ? 'poster' : ratio] : 'contents',
            )}
          >
            {frame}
            {frameLabel && layout === 'inline' ? (
              <span className="text-[11px] font-medium text-text-tertiary">{frameLabel}</span>
            ) : null}
          </div>
          {previews}
        </div>
      )}

      {readOnly ? null : (
        <>
          {layout === 'inline' ? sizeHint : null}
          {layout === 'inline' ? pickRow(true) : null}

          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            aria-label={action}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onPick(file);
            }}
          />
          {labels.camera ? (
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-label={labels.camera}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onPick(file);
              }}
            />
          ) : null}

          {withTop && topCover ? (
            <>
              <input
                ref={topInputRef}
                type="file"
                accept={accept}
                className="sr-only"
                aria-label={topCover.assetId ? topCover.labels.change : topCover.labels.add}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) topCover.onPick(file);
                }}
              />
              {topCover.labels.camera ? (
                <input
                  ref={topCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={`${topCover.labels.camera} · ${topCover.labels.field}`}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) topCover.onPick(file);
                  }}
                />
              ) : null}
            </>
          ) : null}

          {withTop ? null : status(cardStatus)}
        </>
      )}
    </div>
  );
}
