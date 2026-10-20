'use client';

import {
  SOCIAL_SETTINGS_DEFAULTS,
  type SocialSettings,
} from '@rede-social/module-social/contracts';
import { BottomSheet, Button, Input, Switch, useMediaQuery, useToast } from '@rede-social/ui';
import { type FormEvent, useId, useState } from 'react';
import type { SaveSocialLimitsResult } from '@/app/(platform)/plataforma/tenants/[id]/modulos/actions';
import {
  SOCIAL_LIMIT_RANGES,
  type SocialLimitField,
  type SocialLimitsForm,
  socialLimitsFromSettings,
  socialLimitsToPatch,
  validateSocialLimits,
} from '@/lib/social-limits';

export interface SocialLimitsLabels {
  /** The row button, "Configurar limites". */
  open: string;
  /** The sheet title, "Limites de mídia dos membros". */
  title: string;
  fields: {
    photos: string;
    photoMb: string;
    allowVideo: string;
    videoSeconds: string;
    videoMb: string;
  };
  /** ICU template with `{min}`, `{max}` and `{default}` - the 12px helper under each number field. */
  hint: string;
  /** The footer line: the limits apply to new uploads only. */
  helper: string;
  save: string;
  saving: string;
  saved: string;
  /** ICU template with `{min}` and `{max}` - the inline error of an out-of-range field. */
  range: string;
  /** The generic error toast of a failed save. */
  error: string;
}

export interface SocialLimitsSheetProps {
  tenantId: string;
  /** The tenant's EFFECTIVE settings (the contract defaults when nothing is saved). */
  saved: SocialSettings;
  labels: SocialLimitsLabels;
  /** `saveSocialLimitsAction` - the API call lives in the server action. */
  action: (tenantId: string, patch: unknown) => Promise<SaveSocialLimitsResult>;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** What the inputs hold: the raw text, so "" and "2.5" can be told apart from a number. */
type Draft = {
  photos: string;
  photoMb: string;
  videoEnabled: boolean;
  videoSeconds: string;
  videoMb: string;
};

const draftOf = (settings: SocialSettings): Draft => {
  const form = socialLimitsFromSettings(settings);
  return {
    photos: String(form.photos),
    photoMb: String(form.photoMb),
    videoEnabled: form.videoEnabled,
    videoSeconds: String(form.videoSeconds),
    videoMb: String(form.videoMb),
  };
};

/** "" and anything that is not a plain number read as NaN, which is out of range. */
const parse = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text.trim()));

const formOf = (draft: Draft): SocialLimitsForm => ({
  photos: parse(draft.photos),
  photoMb: parse(draft.photoMb),
  videoEnabled: draft.videoEnabled,
  videoSeconds: parse(draft.videoSeconds),
  videoMb: parse(draft.videoMb),
});

/** The defaults, for the "Padrão" helper of each field (the stored value is not the default). */
const DEFAULTS = socialLimitsFromSettings({
  media: {
    ...SOCIAL_SETTINGS_DEFAULTS.media,
    video: { ...SOCIAL_SETTINGS_DEFAULTS.media.video },
  },
});

const DEFAULT_OF: Record<SocialLimitField, number> = {
  photos: DEFAULTS.photos,
  photoMb: DEFAULTS.photoMb,
  videoSeconds: DEFAULTS.videoSeconds ?? SOCIAL_LIMIT_RANGES.videoSeconds.min,
  videoMb: DEFAULTS.videoMb ?? SOCIAL_LIMIT_RANGES.videoMb.min,
};

/**
 * The limits sheet of the `social` row (09-12, UI-D-505 c, D-474): the `super_admin` edits one
 * tenant's member media allowance - photos per post, the photo cap in MB, and (only while video is
 * allowed) the video duration and size. A single column of fields, each a 14/700 label with its
 * unit, a 16px numeric `Input` and a 12/400 helper; the footer says the limits apply to new uploads
 * only (what is already published does not change).
 *
 * It opens with the SAVED values (the server page read them; the contract defaults when the blob is
 * empty), so there is no skeleton. With "Permitir vídeo" off the two video fields are absent from
 * the DOM and are not validated; the patch then carries only `media.video.enabled`. An out-of-range
 * value shows "Informe um valor entre {min} e {max}." under its own field and the sheet stays open
 * (the bounds are the API's, `lib/social-limits.ts`); a failed save keeps it open with the generic
 * error toast. The component knows no language and no route: labels and the action arrive as props.
 */
export function SocialLimitsSheet({ tenantId, saved, labels, action }: SocialLimitsSheetProps) {
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const errors = submitted ? validateSocialLimits(formOf(draft)) : {};

  const openSheet = () => {
    setDraft(draftOf(saved));
    setSubmitted(false);
    setOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    const form = formOf(draft);
    if (Object.keys(validateSocialLimits(form)).length > 0) return;

    setSaving(true);
    try {
      const result = await action(tenantId, socialLimitsToPatch(form));
      if (result.ok) {
        toast.show({ tone: 'success', message: labels.saved });
        setOpen(false);
      } else {
        toast.show({ tone: 'error', message: labels.error });
      }
    } catch {
      toast.show({ tone: 'error', message: labels.error });
    } finally {
      setSaving(false);
    }
  };

  const numberField = (
    field: SocialLimitField,
    key: 'photos' | 'photoMb' | 'videoSeconds' | 'videoMb',
    label: string,
  ) => {
    const range = SOCIAL_LIMIT_RANGES[field];
    const bounds = errors[field];
    const id = `${baseId}-${field}`;
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="break-words text-sm font-bold text-text">
          {label}
        </label>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={draft[key]}
          onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
          error={bounds ? interpolate(labels.range, bounds) : undefined}
        />
        {bounds ? null : (
          <p className="break-words text-xs text-text-tertiary">
            {interpolate(labels.hint, {
              min: range.min,
              max: range.max,
              default: DEFAULT_OF[field],
            })}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <Button variant="outline" size="sm" hitArea onClick={openSheet}>
        {labels.open}
      </Button>
      <BottomSheet
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        title={labels.title}
        desktopCard={desktop}
        initialFocus="title"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {numberField('photos', 'photos', labels.fields.photos)}
          {numberField('photoMb', 'photoMb', labels.fields.photoMb)}
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="min-w-0 break-words text-sm font-bold text-text">
              {labels.fields.allowVideo}
            </span>
            <Switch
              checked={draft.videoEnabled}
              onChange={(next) => setDraft((prev) => ({ ...prev, videoEnabled: next }))}
              label={labels.fields.allowVideo}
            />
          </div>
          {draft.videoEnabled ? (
            <>
              {numberField('videoSeconds', 'videoSeconds', labels.fields.videoSeconds)}
              {numberField('videoMb', 'videoMb', labels.fields.videoMb)}
            </>
          ) : null}
          <div className="flex flex-col gap-3">
            <p className="break-words text-xs text-text-tertiary">{labels.helper}</p>
            <Button type="submit" variant="brand" fullWidth loading={saving}>
              {saving ? labels.saving : labels.save}
            </Button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
