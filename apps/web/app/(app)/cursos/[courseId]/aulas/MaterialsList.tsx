'use client';

import { ATTACHMENT_MIMES, MEDIA_LIMITS, mediaAcceptFor } from '@rede-social/contracts/media';
import { LESSON_MAX_MATERIALS, materialKind } from '@rede-social/module-courses/contracts';
import { ReorderList } from '@rede-social/module-courses/ui';
import { Button, FileDropZone, IconButton, SectionTitle } from '@rede-social/ui';
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { formatMediaLimit, useSignedUpload } from '@/components/media/useSignedUpload';
import { type MaterialDraft, materialKindsSentence, materialRowView } from '@/lib/courses-view';

export interface MaterialsListProps {
  /** The draft, first to last: saved rows (`materialId`) and fresh uploads (`null`). CONTROLLED. */
  items: readonly MaterialDraft[];
  /** The new set or order after an upload, a move or a removal. */
  onChange: (items: MaterialDraft[]) => void;
  /** A SAVED row's name was tapped: the host mints the ten-minute URL and opens it. */
  onOpen: (materialId: string) => void;
  /** True while the host saves: arrows, removes and the zone are inert. */
  disabled?: boolean;
  /** How many materials a lesson may carry (D-410: 10). */
  limit?: number;
  /** A server refusal under the list (`material_invalid`, `too_many_materials`). */
  error?: string | null;
  /** Lifts "a file is in flight" to the host, whose submit must wait for it. */
  onBusyChange?: (busy: boolean) => void;
}

const ACCEPT = mediaAcceptFor('file', 'attachment');
const ZONE_ID = 'material-dropzone';
const ROW = 'flex min-h-14 items-center gap-3 rounded-xl bg-bg-secondary px-3 py-2' as const;

/** The row's glyph by kind (UI-D-399): `Image` for an image, `FileText` for everything else. */
function Glyph({ mime }: { mime: string }) {
  const Icon = materialKind(mime) === 'image' ? ImageIcon : FileText;
  return <Icon aria-hidden size={20} className="shrink-0 text-text-secondary" />;
}

/**
 * The lesson's materials (08.3-09, D-410, UI-D-399, UI-D-407, COURSE-07, A-UI-1): the `SectionTitle`
 * h3 "Materiais" with "{count}/{limit}", the rows in an `<ol>` named by that heading — glyph, the
 * file name (a BUTTON that opens the material when it is saved; plain text until then), the meta
 * "{kind} · {size}" with the kind derived from the mime (`materialKind`, never typed) and the size
 * from `formatBytes`, the two arrow `IconButton`s the `ReorderList` builds and the `X` "Remover
 * {file}" —, then the uploading row ("{percent}% enviado", no arrows) or the failed row ("Falha no
 * envio." + "Tentar novamente"), then the `FileDropZone` and the `outline` "Adicionar arquivo",
 * BOTH absent at the cap and replaced by "Limite de {limit} arquivos por aula.", and the helper
 * "Até {limit} arquivos de até {size} cada: {kinds}." whose size and kinds come from the CONTRACT
 * (`MEDIA_LIMITS.file.attachment`, `ATTACHMENT_MIMES`) — a PDF-only contract reads "… PDF." with no
 * copy change.
 *
 * **Uploads run the Phase 3 machine** — `useSignedUpload({ kind: 'file', purpose: 'attachment' })`,
 * one file at a time, browser → Storage through the signed URL; this component holds asset ids and
 * what the asset said about itself (MEDIA-01, PR-7). Nothing is written to the lesson here: the host
 * saves the WHOLE set in one `PUT …/materials` with the lesson (UI-D-399).
 *
 * The arrows, their names, their disabled ends and the focus rules are the `ReorderList`'s (the
 * three protected rules); this component draws the row around them (`renderItem`). Every file name
 * renders as React text and truncates by CSS (T-08.3-25, E10 long-text).
 */
export function MaterialsList({
  items,
  onChange,
  onOpen,
  disabled = false,
  limit = LESSON_MAX_MATERIALS,
  error = null,
  onBusyChange,
}: MaterialsListProps) {
  const t = useTranslations('courses');
  const tRoot = useTranslations();
  const headingId = useId();
  const helperId = useId();

  /** The latest draft, for a completion that lands after a re-render. */
  const latest = useRef(items);
  latest.current = items;
  /** The file in flight (or the one that failed), for the pending row's name and the retry. */
  const picked = useRef<File | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  const upload = useSignedUpload({
    kind: 'file',
    purpose: 'attachment',
    // No toast: the row appearing IS the confirmation; nothing is saved yet (the composer's rule).
    successKey: null,
    onPicked: (file) => {
      picked.current = file;
      setPickedName(file.name);
    },
    onCompleted: (asset) => {
      picked.current = null;
      setPickedName(null);
      const current = latest.current;
      if (current.length >= limit) return;
      if (current.some((item) => item.assetId === asset.id)) return;
      onChange([
        ...current,
        {
          assetId: asset.id,
          materialId: null,
          filename: asset.filename ?? '',
          mime: asset.mime,
          bytes: asset.bytes,
        },
      ]);
    },
  });

  const uploading = upload.state === 'progress' || upload.state === 'processing';
  const busy = uploading || upload.state === 'preparing';
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const atCap = items.length >= limit;
  /** A transfer that failed AFTER a pick is the failed ROW; a pick the zone refused is the zone's error. */
  const failedRow = upload.state === 'error' && picked.current !== null;
  const zoneError = upload.state === 'error' && picked.current === null ? upload.error : null;

  const pick = (file: File) => {
    setCapError(null);
    // E10 error: the eleventh file is refused before any request (the zone is absent at the cap, but
    // a drop that races a completion must still be told).
    if (latest.current.length >= limit) {
      setCapError(t('lesson.form.errors.tooManyMaterials', { limit }));
      return;
    }
    void upload.pick(file);
  };

  const retry = () => {
    const file = picked.current;
    upload.reset();
    if (file) pick(file);
  };

  const dismissFailure = () => {
    picked.current = null;
    setPickedName(null);
    upload.reset();
  };

  const remove = (assetId: string) => {
    setCapError(null);
    onChange(items.filter((item) => item.assetId !== assetId));
  };

  const move = (ids: string[]) => {
    const byId = new Map(items.map((item) => [item.assetId, item]));
    const next: MaterialDraft[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) return;
      next.push(item);
    }
    if (next.length !== items.length) return;
    onChange(next);
  };

  const rows = items.map((item) => ({
    ...materialRowView(item, tRoot as never),
    name: item.filename,
  }));

  const labels = {
    moveUp: (name: string) => t('reorder.moveUp', { name }),
    moveDown: (name: string) => t('reorder.moveDown', { name }),
    moved: (name: string, position: number, total: number) =>
      t('reorder.moved', { name, position, total }),
  };

  const helper = t('lesson.materials.helper', {
    limit,
    size: formatMediaLimit(MEDIA_LIMITS.file.attachment?.maxBytes ?? 0),
    kinds: materialKindsSentence(ATTACHMENT_MIMES, tRoot as never),
  });

  return (
    <div data-lesson-materials className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle id={headingId} as="h3" variant="group">
          {t('lesson.materials.title')}
        </SectionTitle>
        <span data-materials-count className="text-xs tabular-nums text-text-tertiary">
          {t('lesson.materials.count', { count: items.length, limit })}
        </span>
      </div>

      {items.length > 0 ? (
        <ReorderList
          items={rows}
          onChange={move}
          disabled={disabled}
          labelledBy={headingId}
          describedBy={helperId}
          labels={labels}
          className="flex flex-col gap-2"
          testId="lesson-materials"
          renderItem={(row, arrows) => (
            <div className={ROW} data-material-row={row.assetId}>
              <Glyph mime={items.find((item) => item.assetId === row.assetId)?.mime ?? ''} />
              <span className="flex min-w-0 flex-1 flex-col">
                {row.materialId ? (
                  <button
                    type="button"
                    data-material-open={row.materialId}
                    disabled={disabled}
                    onClick={() => onOpen(row.materialId as string)}
                    className="truncate text-left text-sm font-bold text-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
                  >
                    {row.name}
                  </button>
                ) : (
                  <span className="truncate text-sm font-bold text-text">{row.name}</span>
                )}
                <span
                  data-material-meta
                  className="text-xs font-normal text-text-secondary tabular-nums"
                >
                  {row.meta}
                </span>
              </span>
              {arrows}
              <IconButton
                icon={X}
                size={20}
                label={row.removeLabel}
                disabled={disabled}
                onClick={() => remove(row.assetId)}
                className="shrink-0"
              />
            </div>
          )}
        />
      ) : null}

      {/* E10 loading: the file in flight, the progress in place of the meta, no arrows. */}
      {uploading || upload.state === 'preparing' ? (
        <div className={ROW} data-material-uploading>
          <Glyph mime={picked.current?.type ?? ''} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-bold text-text">{pickedName}</span>
            <span className="text-xs font-normal text-text-secondary tabular-nums">
              {t('lesson.materials.uploading', { percent: upload.progress })}
            </span>
          </span>
        </div>
      ) : null}

      {/* E10 error: a transfer that failed keeps its row with the sentence and a retry. */}
      {failedRow ? (
        <div className={ROW} data-material-failed>
          <Glyph mime={picked.current?.type ?? ''} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-bold text-text">{pickedName}</span>
            <span role="alert" className="text-xs font-normal text-danger">
              {t('lesson.form.errors.materialUpload')}
            </span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={retry}>
            {t('errors.retry')}
          </Button>
          <IconButton
            icon={X}
            size={20}
            label={t('lesson.materials.remove', { file: pickedName ?? '' })}
            onClick={dismissFailure}
            className="shrink-0"
          />
        </div>
      ) : null}

      {atCap ? (
        <p data-materials-cap className="text-xs font-normal text-text-tertiary">
          {t('lesson.materials.atCap', { limit })}
        </p>
      ) : (
        <>
          <FileDropZone
            id={ZONE_ID}
            icon={Paperclip}
            accept={ACCEPT}
            maxBytes={MEDIA_LIMITS.file.attachment?.maxBytes}
            state={uploading ? (upload.state as 'progress' | 'processing') : 'idle'}
            progress={upload.progress}
            error={zoneError ?? undefined}
            disabled={disabled || busy}
            onFile={pick}
            onReject={(reason) => upload.reject(reason)}
            labels={{
              caption: t('lesson.materials.dropzone'),
              progress: (percent) => t('lesson.materials.uploading', { percent }),
              // The server's file check after the bytes landed: the row already reads 100%.
              processing: t('lesson.materials.uploading', { percent: 100 }),
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="md"
            className="self-start"
            data-materials-add
            disabled={disabled || busy}
            onClick={() => document.getElementById(ZONE_ID)?.click()}
          >
            <Paperclip aria-hidden size={18} className="shrink-0" />
            {t('lesson.materials.add')}
          </Button>
        </>
      )}

      {capError || error ? (
        <p role="alert" data-materials-error className="text-sm font-normal text-danger">
          {capError ?? error}
        </p>
      ) : null}

      <p id={helperId} className="text-xs font-normal text-text-tertiary">
        {helper}
      </p>
    </div>
  );
}
