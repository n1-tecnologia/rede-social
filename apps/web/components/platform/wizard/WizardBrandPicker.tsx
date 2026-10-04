'use client';

import { BRANDING_MAX_BYTES } from '@rede-social/contracts/branding';
import { Button, Card, FileDropZone, SectionTitle } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BRANDING_UPLOAD_ACCEPT, classifyFile, resolveMime } from '@/lib/upload';
import { type DraftImage, useTenantDraft } from './TenantDraftProvider';

/** `<input accept>`: the contracts allow-list plus the extensions (some browsers leave SVG's type empty). */
const ACCEPT = `${BRANDING_UPLOAD_ACCEPT},.png,.svg,.webp,.jpg,.jpeg`;

/**
 * Step 2 (Personalização), its last card: before the tenant exists the logo and the optional
 * square icon are PICKED, not uploaded. The same zones and copy as the tenant page's Marca tab, the
 * same type and size gate (`classifyFile`), and the picked image shows right away, here and in the
 * preview device; the files stay in this browser's memory until the summary's confirmation uploads
 * them to the new tenant (`runBrandingUpload`). What only the server checks (a corrupt image, an
 * unsafe SVG) is reported by that confirmation.
 */
export function WizardBrandPicker() {
  const t = useTranslations('platformBranding');
  const tw = useTranslations('platform.wizard');
  const { draft, logo, icon, setImage } = useTenantDraft();
  const tenant = draft.displayName.trim() || t('preview.namePlaceholder');

  return (
    <Card className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
      <ImagePicker
        kind="logo"
        image={logo}
        onPick={(file) => setImage('logo', file)}
        onRemove={() => setImage('logo', null)}
        title={t('logo.title')}
        caption={logo ? t('logo.replace') : t('logo.upload')}
        hint={logo ? t('logo.hint') : t('logo.empty')}
        alt={t('logo.alt', { tenant })}
      />
      <ImagePicker
        kind="icon"
        image={icon}
        onPick={(file) => setImage('icon', file)}
        onRemove={() => setImage('icon', null)}
        title={t('icon.title')}
        caption={icon ? t('icon.replace') : t('icon.upload')}
        hint={t('icon.helper')}
        alt={t('icon.alt', { tenant })}
      />
      <p className="text-xs text-text-tertiary md:col-span-2">{tw('brand.deferred')}</p>
    </Card>
  );
}

function ImagePicker({
  kind,
  image,
  onPick,
  onRemove,
  title,
  caption,
  hint,
  alt,
}: {
  kind: 'logo' | 'icon';
  image: DraftImage | null;
  onPick: (file: File) => void;
  onRemove: () => void;
  title: string;
  caption: string;
  hint: string;
  alt: string;
}) {
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
    <div data-wizard-image={kind} className="flex flex-col gap-3">
      <SectionTitle variant="group">{title}</SectionTitle>
      {image ? (
        <div className="flex h-24 items-center justify-center rounded-xl bg-bg px-4">
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
