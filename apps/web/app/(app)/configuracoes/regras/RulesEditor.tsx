'use client';

import { normaliseRulesText, RULES_TEXT_MAX } from '@rede-social/contracts/rules';
import { BottomSheet, Button, Card, cn, Textarea, useMediaQuery, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { RulesText } from '@/components/rules/RulesText';
import type { SaveRulesResult, saveRulesAction } from './actions';

const FIELD_ID = 'rulesText';

export interface RulesEditorProps {
  /** The tenant's display name, interpolated into the intro and the preview title. */
  tenantName: string;
  /** The stored rules text (`GET /v1/admin/rules`). */
  initialText: string;
  /** The version in force — the one new sign-ups consent to. */
  initialVersion: number;
  action: typeof saveRulesAction;
}

/**
 * The Regras card (ADMIN-03, D-341, UI-D-280, E13): the intro, the shipped `Textarea` (12 rows, 16px,
 * `maxLength` 10,000, the "{count}/10.000" counter always visible, the placeholder and the helper),
 * "Versão {version} em vigor", then the ghost "Ver como os novos membros veem" and the brand
 * "Salvar regras".
 *
 * "Salvar regras" (and the preview) are disabled while the NORMALISED draft is empty, and the save
 * also while it equals the saved text — the same `normaliseRulesText` the API compares with — so the
 * UI never causes an empty version bump, not even from a Windows paste of the same text. While the
 * action runs the button reads "Salvando…" and is disabled. Success toasts "Regras salvas. Valem para
 * quem entrar a partir de agora." (D-341 made visible: nobody is asked again) and the version line
 * shows the new number. A server refusal shows its field error; a failure toasts and KEEPS the draft;
 * a lost permission (403 `FORBIDDEN`) toasts it and refreshes into the page's `notFound()`
 * (UI-D-284). No confirm: saving loses nothing.
 *
 * The preview (UI-D-281, E14) opens the shipped `BottomSheet` (`desktopCard` from `md`) with the
 * sign-up sheet's own title ("Regras da comunidade {tenant}") and its secondary "Fechar", and renders
 * the CURRENT DRAFT through `RulesText` — the renderer `/cadastro` and `/aceitar-convite` use — so the
 * admin sees exactly what a newcomer will read, before saving. An empty draft cannot be previewed.
 */
export function RulesEditor({ tenantName, initialText, initialVersion, action }: RulesEditorProps) {
  const t = useTranslations('admin.rules');
  const ta = useTranslations('admin.errors');
  const ts = useTranslations('signup');
  const toast = useToast();
  const router = useRouter();
  const [saved, setSaved] = useState(normaliseRulesText(initialText));
  const [version, setVersion] = useState(initialVersion);
  const [draft, setDraft] = useState(initialText);
  const [serverTooLong, setServerTooLong] = useState(false);
  /** A paste the native `maxLength` cut short: the admin must know the end of it was dropped. */
  const [pasteCut, setPasteCut] = useState(false);
  const [pending, startTransition] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 768px)');

  const normalised = normaliseRulesText(draft);
  const empty = normalised.length === 0;
  const tooLong = normalised.length > RULES_TEXT_MAX || serverTooLong || pasteCut;
  const canSave = !pending && !empty && normalised.length <= RULES_TEXT_MAX && normalised !== saved;

  const onChange = (next: string) => {
    setDraft(next);
    setServerTooLong(false);
    if (next.length < RULES_TEXT_MAX) setPasteCut(false);
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    const target = event.currentTarget;
    const selected = target.selectionEnd - target.selectionStart;
    if (target.value.length - selected + pasted.length > RULES_TEXT_MAX) setPasteCut(true);
  };

  const save = () => {
    if (!canSave) return;
    startTransition(async () => {
      let result: SaveRulesResult;
      try {
        result = await action(normalised);
      } catch {
        result = { ok: false, code: 'failed' };
      }
      if (result.ok) {
        setSaved(result.rules.rulesText);
        setDraft(result.rules.rulesText);
        setVersion(result.rules.rulesVersion);
        toast.show({ tone: 'success', message: t('saved') });
        router.refresh();
      } else if (result.code === 'tooLong') {
        setServerTooLong(true);
      } else if (result.code === 'forbidden') {
        toast.show({ tone: 'error', message: ta('forbidden') });
        router.refresh();
      } else {
        // `required` cannot leave this editor (the save is disabled for an empty draft); any other
        // outcome keeps the draft and says so.
        toast.show({ tone: 'error', message: t('errors.failed') });
      }
    });
  };

  const counterId = `${FIELD_ID}-counter`;
  const helperId = `${FIELD_ID}-helper`;
  const errorId = `${FIELD_ID}-error`;
  const atCap = draft.length >= RULES_TEXT_MAX;

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <p className="text-sm text-text-secondary">{t('intro', { tenant: tenantName })}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="flex flex-col gap-2">
          <Textarea
            id={FIELD_ID}
            name="rulesText"
            label={t('label')}
            rows={12}
            maxLength={RULES_TEXT_MAX}
            value={draft}
            placeholder={t('placeholder')}
            onChange={(event) => onChange(event.target.value)}
            onPaste={onPaste}
            error={tooLong ? t('errors.tooLong') : undefined}
            aria-describedby={[counterId, helperId, tooLong ? errorId : null]
              .filter(Boolean)
              .join(' ')}
            className="overflow-y-auto"
          />
          {/* The "{count}/10.000" counter, always visible: the catalog carries the pt-BR grouping,
              so the count is grouped the same way ("1.234/10.000"). Never announced per keystroke. */}
          <span
            id={counterId}
            aria-live="off"
            className={cn(
              'text-right text-xs tabular-nums',
              atCap ? 'text-danger' : 'text-text-tertiary',
            )}
          >
            {t('counter', { count: draft.length.toLocaleString('pt-BR') })}
          </span>
          <p id={helperId} className="text-xs text-text-tertiary">
            {t('helper')}
          </p>
        </div>
        <p className="text-xs tabular-nums text-text-tertiary">{t('version', { version })}</p>
        <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={empty}
            onClick={() => setPreviewOpen(true)}
          >
            {t('preview')}
          </Button>
          <Button type="submit" variant="brand" size="md" loading={pending} disabled={!canSave}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
      <BottomSheet
        open={previewOpen && !empty}
        title={ts('rulesSheetTitle', { tenant: tenantName })}
        onClose={() => setPreviewOpen(false)}
        desktopCard={desktop}
      >
        <div className="flex flex-col gap-4" data-rules-preview>
          <RulesText rulesText={normalised} />
          <Button type="button" variant="secondary" fullWidth onClick={() => setPreviewOpen(false)}>
            {ts('closeRules')}
          </Button>
        </div>
      </BottomSheet>
    </Card>
  );
}
