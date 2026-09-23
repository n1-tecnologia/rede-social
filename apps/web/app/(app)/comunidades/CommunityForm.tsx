'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@tria/contracts/media';
import {
  COMMUNITY_MAX_DESCRIPTION,
  COMMUNITY_MAX_NAME,
  createCommunitySchema,
  updateCommunitySchema,
} from '@tria/module-communities/contracts';
import { CommunityCover } from '@tria/module-communities/ui';
import {
  Button,
  ConfirmDialog,
  FileDropZone,
  Input,
  PageHeader,
  Textarea,
  useToast,
} from '@tria/ui';
import { Archive, Image as ImageIcon, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import {
  archiveCommunityAction,
  createCommunityAction,
  updateCommunityAction,
} from '@/app/(app)/comunidades/actions';
import { useSignedUpload } from '@/components/media/useSignedUpload';

/**
 * THE community form (COMM-01, UI-D-38) — one component, two routes: `/comunidades/nova` in
 * `create` mode and `/comunidades/[communityId]/editar` in `edit` mode, bound to values.
 *
 * **The edit form IS the create form** (UI-SPEC E13/partial). There is no populated-only layout and
 * there must never be one: an absent cover shows the SAME gradient preview the create state shows,
 * so "no cover yet" and "deliberately no cover" are one control. The only two differences are
 * STRUCTURAL — the title and submit labels, and a danger archive row that exists on edit only.
 *
 * **The composer's chrome, re-used** (D-57's precedent): a full-screen ROUTE rather than a sheet,
 * `PageHeader stickyTop="0px"` with a 44x44 `X` close, and the brand submit in the trailing slot
 * with its pending label and `aria-busy`. Phase 4 already paid for this chrome and its discard
 * flow; a second form language for three fields would be drift.
 *
 * **ZERO UPLOAD CODE LIVES HERE.** The cover runs the Phase 3 machine — `useSignedUpload` with
 * `purpose: 'cover'` — which picks, re-encodes a phone photo in the browser, brokers a signed
 * target and sends the bytes STRAIGHT to Storage. This file holds an asset ID, never a byte.
 *
 * **The gradient preview is the point of the picker** (D-69, UI-D-35). While there is no cover the
 * picker renders the very `CommunityCover` fallback a member will see — the `--brand-gradient`
 * block in `--brand-on-primary` ink, at the card geometry — so the admin is CHOOSING the brand
 * block rather than failing to add a photograph. It is the component itself rather than a copy of
 * its classes, which is what makes "exactly what they will see" true rather than approximately.
 *
 * **Submit is gated on `Nome` alone**, in both modes, and no inline error renders before the first
 * submit (UI-SPEC E13/empty). The publishable rule is IMPORTED rather than re-expressed: the same
 * Zod the API validates with runs in the action, so the disabled control and the server's refusal
 * are one definition.
 */
export type CommunityFormMode = 'create' | 'edit';

export type CommunityFormProps = {
  mode: CommunityFormMode;
  /** Edit mode only: which community is being saved. */
  communityId?: string;
  /** Edit mode only: the community as it stands, including the cover's own variant ladder. */
  initial?: {
    name: string;
    description: string;
    coverAssetId: string | null;
    coverVariantWidths: readonly number[];
  };
  /**
   * The tenant's display name, interpolated into the cover helper (UI-D-46). Both routes that render
   * this form already hold the bootstrap, so this is a value passed DOWN rather than a second read.
   */
  tenantName: string;
};

const ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only — not on every tick (UI-SPEC §Motion & Accessibility). */
const QUARTILES = [25, 50, 75, 100];

const EMPTY = {
  name: '',
  description: '',
  coverAssetId: null,
  coverVariantWidths: PURPOSE_WIDTHS.cover,
} as const;

export function CommunityForm({ mode, communityId, initial, tenantName }: CommunityFormProps) {
  const t = useTranslations('communities');
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const start = initial ?? EMPTY;
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(start.coverAssetId);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(start.coverVariantWidths);

  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [discarding, setDiscarding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    // No toast: the preview replacing the gradient block IS the confirmation, and the cover is not
    // committed until the form is saved.
    successKey: null,
    onCompleted: (asset) => {
      setCoverAssetId(asset.id);
      setCoverWidths(asset.variants.map((variant) => variant.width));
      setFormError(null);
    },
  });

  const uploading = upload.state === 'preparing' || upload.state === 'progress';
  const announced = QUARTILES.includes(upload.progress)
    ? tm('progress', { percent: upload.progress })
    : '';

  const dirty =
    name !== start.name || description !== start.description || coverAssetId !== start.coverAssetId;

  /** UI-SPEC E13/empty: the submit is gated on the NAME field alone, in both modes. */
  const submittable = name.trim().length > 0;
  const busy = pending || uploading;

  const back = mode === 'edit' && communityId ? `/comunidades/${communityId}` : '/comunidades';

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    router.push(back);
  };

  /** Exhaustive over what the actions can answer: a new refusal code cannot compile without copy. */
  const messageFor = (code: string): string => {
    switch (code) {
      case 'name_required':
        return t('errors.nameRequired');
      case 'archived':
        return t('errors.archived');
      case 'not_found':
        // The container vanished under the admin (archived elsewhere is still readable; this is a
        // real miss). The same words the page's own not-found screen uses, so the two agree.
        return t('notFound.title');
      default:
        return t('errors.save');
    }
  };

  const submit = () => {
    setFormError(null);
    setNameError(undefined);
    startTransition(async () => {
      const payload = { name, description, coverAssetId };
      const body =
        mode === 'edit'
          ? updateCommunitySchema.safeParse(payload)
          : createCommunitySchema.safeParse(payload);

      if (!body.success) {
        const empty = body.error.issues.some((issue) => issue.message === 'name_required');
        if (empty) setNameError(t('errors.nameRequired'));
        setFormError(empty ? t('errors.nameRequired') : t('errors.save'));
        return;
      }

      const result =
        mode === 'edit' && communityId
          ? await updateCommunityAction(communityId, body.data)
          : await createCommunityAction(body.data);

      if (result.ok) {
        toast.show({
          tone: 'success',
          message: mode === 'edit' ? t('toasts.saved') : t('toasts.created'),
        });
        router.push(`/comunidades/${result.communityId}`);
        return;
      }

      if (result.code === 'name_required') setNameError(t('errors.nameRequired'));
      setFormError(messageFor(result.code));
    });
  };

  const archive = async () => {
    if (!communityId) return;
    const result = await archiveCommunityAction(communityId);
    if (!result.ok) {
      // UI-SPEC E13/error: an archiving failure closes the dialog and TOASTS — it is not a field
      // error, and the form the admin was filling in is still exactly as they left it.
      toast.show({ tone: 'error', message: messageFor(result.code) });
      return;
    }
    toast.show({ tone: 'success', message: t('toasts.archived') });
    router.push('/comunidades');
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('actions.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('actions.create');

  /** The picker's preview: a real `CommunityCover` at the card geometry, both branches (UI-D-38). */
  const preview = (
    <CommunityCover
      geometry="card"
      coverAssetId={coverAssetId}
      coverVariantWidths={coverWidths}
      coverAlt={t('card.cover', { community: name || tenantName })}
      fallbackOverlay={
        <p data-cover-preview-fallback className="truncate text-xs font-bold opacity-90">
          {t('form.cover.preview')}
        </p>
      }
    />
  );

  return (
    <form
      data-community-form
      data-mode={mode}
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('form.editTitle') : t('form.createTitle')}
        backIcon={X}
        backLabel={t('form.close')}
        onBack={close}
        stickyTop="0px"
        className="md:static md:px-0"
        trailing={
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={!submittable || busy}
            loading={busy}
            aria-busy={busy || undefined}
          >
            {submitLabel}
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-4 py-4 md:gap-8 md:px-6">
        {/* E13/error: a server refusal is an alert-role card at the TOP of the form, never a toast. */}
        {formError ? (
          <p
            role="alert"
            data-community-form-error
            className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-normal text-danger"
          >
            {formError}
          </p>
        ) : null}

        {/* ── The cover picker, FIRST: the largest field, and the one whose preview shows a member
            exactly what they will see (UI-D-38). Phone gets a tap row under the preview; desktop
            gets the dashed zone, which also accepts a drop. ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-normal text-text-secondary">{t('form.cover.label')}</span>

          <div className="overflow-hidden rounded-xl md:hidden">{preview}</div>
          <div className="hidden md:block">
            <FileDropZone
              id="community-cover-dropzone"
              icon={ImageIcon}
              accept={ACCEPT}
              // The hook owns the verdict: an over-cap or phone-format image is re-encoded in the
              // browser (R-12), so the zone must not refuse it first.
              screen={false}
              state={
                upload.state === 'progress' || upload.state === 'processing' ? upload.state : 'idle'
              }
              progress={upload.progress}
              onFile={(file) => void upload.pick(file)}
              labels={{
                caption: coverAssetId ? t('form.cover.change') : t('form.cover.add'),
                progress: (percent) => tm('progress', { percent }),
                processing: tm('photo.preparing'),
              }}
            />
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label={coverAssetId ? t('form.cover.change') : t('form.cover.add')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload.pick(file);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {coverAssetId ? t('form.cover.change') : t('form.cover.add')}
            </Button>
            {coverAssetId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  setCoverAssetId(null);
                  upload.reset();
                }}
              >
                {t('form.cover.remove')}
              </Button>
            ) : null}
          </div>

          {upload.state === 'progress' ? (
            <div className="flex flex-col gap-2">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={upload.progress}
                className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tabular-nums text-text-tertiary">
                  {tm('progress', { percent: upload.progress })}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={upload.cancel}>
                  {tm('cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          {/* Quartiles only: a per-tick live region would read the whole upload out loud. */}
          <span aria-live="polite" className="sr-only">
            {announced}
          </span>

          {upload.error ? (
            <p role="alert" className="text-sm font-normal text-danger">
              {upload.error}
            </p>
          ) : (
            <p className="text-xs font-normal text-text-tertiary">
              {t('form.cover.helper', { tenant: tenantName })}
            </p>
          )}
        </div>

        <Input
          id="community-name"
          name="name"
          label={t('form.name.label')}
          placeholder={t('form.name.placeholder')}
          value={name}
          maxLength={COMMUNITY_MAX_NAME}
          required
          error={nameError}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
        />

        <Textarea
          id="community-description"
          name="description"
          label={t('form.description.label')}
          placeholder={t('form.description.placeholder')}
          value={description}
          rows={4}
          maxLength={COMMUNITY_MAX_DESCRIPTION}
          counter={{ value: description.length, max: COMMUNITY_MAX_DESCRIPTION }}
          // E13/long-text: the field grows to its content and the PAGE scrolls; the sticky header
          // keeps the submit reachable at any scroll position.
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── UI-D-38: the archive row exists on EDIT only, at the BOTTOM, behind a confirmation.
            There is no destructive DELETE anywhere in V1: COMM-01 asks for archive, archive is
            reversible, and a delete would cascade over posts, comments and likes authored by
            members who never agreed to lose them. ── */}
        {mode === 'edit' && communityId ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="md"
              data-community-archive
              className="justify-start px-0 text-danger"
              onClick={() => setArchiving(true)}
            >
              <Archive aria-hidden size={20} />
              {t('form.archive')}
            </Button>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.title')}
        body={t('discard.body')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.cancel')}
        onConfirm={() => router.push(back)}
        onClose={() => setDiscarding(false)}
      />

      <ConfirmDialog
        open={archiving}
        tone="danger"
        title={t('confirm.archive.title')}
        body={t('confirm.archive.body')}
        confirmLabel={t('confirm.archive.confirm')}
        cancelLabel={t('confirm.archive.cancel')}
        onConfirm={archive}
        onClose={() => setArchiving(false)}
        onError={(error) => {
          console.error('communities.archive_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.save') });
        }}
      />
    </form>
  );
}
