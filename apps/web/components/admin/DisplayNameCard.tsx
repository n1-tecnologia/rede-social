'use client';

import { TENANT_DISPLAY_NAME_MAX } from '@rede-social/contracts/branding';
import { Button, Card, Input, SectionTitle, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type {
  SaveDisplayNameResult,
  saveDisplayNameAction,
} from '@/app/(app)/configuracoes/marca/actions';

/** Characters as the API counts them (Zod 4: Unicode code points, so an emoji is one). */
function characters(value: string): number {
  return [...value].length;
}

/** The field error of a trimmed value, or `null` when it may be saved (the API's own rule). */
function issueOf(trimmed: string): 'required' | 'tooLong' | null {
  if (trimmed.length === 0) return 'required';
  if (characters(trimmed) > TENANT_DISPLAY_NAME_MAX) return 'tooLong';
  return null;
}

export interface DisplayNameCardProps {
  /** The tenant's saved display name (the bootstrap's / the brand read's). */
  initialName: string;
  action: typeof saveDisplayNameAction;
}

/**
 * The Marca screen's name card (ADMIN-01, UI-D-279, E11): "Nome da comunidade", the shipped `Input`
 * (16px, `maxLength` 60), the helper, and a SECONDARY "Salvar nome" — the screen keeps one brand fill,
 * the colours CTA of the unchanged `BrandingForm` below.
 *
 * "Salvar nome" is enabled only when the trimmed value differs from the saved one and is 1..60
 * characters; an empty or spaces-only value shows "Informe o nome da comunidade." under the field and
 * never saves. While the action runs the button reads "Salvando…" and is disabled. Success toasts
 * "Nome salvo." and refreshes the route, so the `BrandingForm` preview adopts the new name in place. A
 * server refusal shows its field error; a failure toasts and KEEPS the typed value; a lost permission
 * (403 `FORBIDDEN`) toasts it and refreshes into the page's `notFound()` (UI-D-284).
 */
export function DisplayNameCard({ initialName, action }: DisplayNameCardProps) {
  const t = useTranslations('admin.brand.name');
  const ta = useTranslations('admin.errors');
  const toast = useToast();
  const router = useRouter();
  const [saved, setSaved] = useState(initialName);
  const [value, setValue] = useState(initialName);
  const [serverIssue, setServerIssue] = useState<'required' | 'tooLong' | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = value.trim();
  const issue = issueOf(trimmed) ?? serverIssue;
  const canSave = !pending && issue === null && trimmed !== saved;

  const onChange = (next: string) => {
    setValue(next);
    setServerIssue(null);
  };

  const save = () => {
    if (!canSave) return;
    startTransition(async () => {
      const result: SaveDisplayNameResult = await action(trimmed);
      if (result.ok) {
        setSaved(result.view.displayName);
        setValue(result.view.displayName);
        toast.show({ tone: 'success', message: t('saved') });
        router.refresh();
      } else if (result.code === 'required' || result.code === 'tooLong') {
        setServerIssue(result.code);
      } else if (result.code === 'forbidden') {
        toast.show({ tone: 'error', message: ta('forbidden') });
        router.refresh();
      } else {
        toast.show({ tone: 'error', message: t('errors.failed') });
      }
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <SectionTitle variant="micro">{t('title')}</SectionTitle>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="flex flex-col gap-2">
          <Input
            id="displayName"
            name="displayName"
            label={t('label')}
            value={value}
            maxLength={TENANT_DISPLAY_NAME_MAX}
            autoComplete="organization"
            onChange={(event) => onChange(event.target.value)}
            error={issue === null ? undefined : t(`errors.${issue}`)}
          />
          <p className="text-xs text-text-tertiary">{t('helper')}</p>
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="secondary"
            size="md"
            loading={pending}
            disabled={!canSave}
            className="w-full md:w-auto"
          >
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
