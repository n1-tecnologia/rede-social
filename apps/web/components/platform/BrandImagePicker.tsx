'use client';

import { BRANDING_MAX_BYTES } from '@rede-social/contracts/branding';
import { Button, FileDropZone, SectionTitle } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BRANDING_UPLOAD_ACCEPT, classifyFile, resolveMime } from '@/lib/upload';

/** `<input accept>`: the contracts allow-list plus the extensions (some browsers leave SVG's type empty). */
const ACCEPT = `${BRANDING_UPLOAD_ACCEPT},.png,.svg,.webp,.jpg,.jpeg`;

export interface BrandImagePickerProps {
  /** The zone's marker: `data-wizard-image` in the wizard, `data-upload-zone` on the Marca tab. */
  marker: { [attribute: `data-${string}`]: string };
  /** The picked file as a local object URL; `null` when none is picked. */
  image: { url: string } | null;
  /** The dark mode's logo is seen on the dark ground (a dark-theme scope), as in the app. */
  dark?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  title: string;
  caption: string;
  hint: string;
  alt: string;
}

/**
 * A logo or icon PICKED, not uploaded: the same zone, copy and type/size gate (`classifyFile`) as the
 * Marca tab's upload zones, and the picked image shows right away. Where the file goes is the
 * caller's: the wizard keeps it until the summary's confirmation uploads it; the dark mode's logo
 * (2026-10-05) only ever reaches the previews, because the API has no field for it.
 */
export function BrandImagePicker({
  marker,
  image,
  dark = false,
  onPick,
  onRemove,
  title,
  caption,
  hint,
  alt,
}: BrandImagePickerProps) {
  const t = useTranslations('platformBranding');
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File) => {
    const rejected = classifyFile(file) ?? (resolveMime(file) ? null : 'type');
    if (rejected) {
      setError(t(`errors.${rejected}`));
      return;
    }
    setError(null);
    onPick(file);
  };

  return (
    <div {...marker} className="flex flex-col gap-3">
      <SectionTitle variant="group">{title}</SectionTitle>
      {image ? (
        <div
          data-theme={dark ? 'dark' : undefined}
          className="flex h-24 items-center justify-center rounded-xl bg-bg px-4"
        >
          {/* biome-ignore lint/performance/noImgElement: D-26 — the customer's file as-is, from a local object URL; next/image would re-encode it. */}
          <img src={image.url} alt={alt} className="h-16 max-w-full object-contain" />
        </div>
      ) : null}
      <FileDropZone
        accept={ACCEPT}
        maxBytes={BRANDING_MAX_BYTES}
        state="idle"
        error={error ?? undefined}
        onFile={pick}
        onReject={(reason) => setError(t(`errors.${reason}`))}
        labels={{
          caption,
          progress: (percent) => t('upload.progress', { percent }),
          processing: t('upload.processing'),
        }}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-text-tertiary">{hint}</p>
        {image ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('icon.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
