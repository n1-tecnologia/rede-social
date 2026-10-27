'use client';

import { BottomSheet, Button, useMediaQuery, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import type {
  ReplaceTokenError,
  ReplaceTokenResult,
  ReplaceTokenValues,
} from '@/app/(platform)/plataforma/tenants/[id]/banco/actions';
import { ProjectTokenFields, type ProjectTokenValues } from './ProjectTokenFields';
import { TokenHowTo } from './TokenHowTo';

export interface ReplaceTokenSheetProps {
  tenantId: string;
  /** `YYYY-MM-DD`, from the server: the bounds of the date field are computed from it. */
  today: string;
  /** `replaceTokenAction` - the API call lives in the server action; it never returns a value. */
  action: (tenantId: string, values: ReplaceTokenValues) => Promise<ReplaceTokenResult>;
  /** Called once after a successful save, so the card can show "Verificando…" until its follow-up refresh. */
  onSaved?: () => void;
}

const EMPTY: ProjectTokenValues = { token: '', expiresAt: '' };

/** The catalog key (`platform.new.errors.<key>`) of each refusal that belongs under a field. */
const TOKEN_FIELD_ERRORS = {
  token_invalid: 'tokenInvalid',
  token_forbidden: 'tokenForbidden',
  token_other_project: 'tokenOtherProject',
  token_account_wide: 'tokenAccountWide',
} as const;

const ALERT_CLASS = 'rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger';

/**
 * "Substituir token" and its sheet (09.4-16, UI-D-555, D-575, CTK-37): the only reason to touch the token in
 * the panel is that it changed upstream. The outline `sm` button opens a `BottomSheet` with the intro, the
 * shared `ProjectTokenFields` (the token and the optional expiry), the closed how-to and a brand full-width
 * "Salvar token" that stays disabled until the token is filled. There is NO confirmation dialog: the server
 * checks the new token against the project and the registered organisation before it replaces anything, so
 * a typo or the token of another project can never replace a working one.
 *
 * Write-only by construction (the same rules as the credentials sheet):
 *  - both fields open EMPTY, every time, and are never pre-filled from anything;
 *  - the values live in this component's state and nowhere else: not `sessionStorage`, not a cookie, not a
 *    URL, not a log, not a toast; they are cleared when the sheet closes (ANY route) and on success;
 *  - while a save is in flight the fields are locked and the sheet cannot be closed;
 *  - the answer carries a flag or a closed code, never a value.
 *
 * A refusal keeps the sheet open and what was typed in place for correction: the five token reasons render
 * under their own field and the organisation and transport refusals as sheet-level alerts. Success closes
 * the sheet, toasts "Token atualizado.", refreshes the page and tells the card (`onSaved`).
 */
export function ReplaceTokenSheet({ tenantId, today, action, onSaved }: ReplaceTokenSheetProps) {
  const t = useTranslations('platform.database');
  const tNew = useTranslations('platform.new.errors');
  const toast = useToast();
  const router = useRouter();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ProjectTokenValues>(EMPTY);
  const [refusal, setRefusal] = useState<ReplaceTokenError | null>(null);
  const [saving, setSaving] = useState(false);

  const filled = values.token.trim() !== '';

  const close = () => {
    if (saving) return;
    setOpen(false);
    setValues(EMPTY);
    setRefusal(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !filled) return;

    const expiresAt = values.expiresAt.trim();
    const send: ReplaceTokenValues = {
      token: values.token.trim(),
      ...(expiresAt ? { tokenExpiresAt: expiresAt } : {}),
    };

    setSaving(true);
    setRefusal(null);
    try {
      const result = await action(tenantId, send);
      if (result.ok) {
        setOpen(false);
        setValues(EMPTY);
        toast.show({ tone: 'success', message: t('token.saved') });
        onSaved?.();
        router.refresh();
      } else {
        setRefusal(result.error);
      }
    } catch {
      setRefusal('unavailable');
    } finally {
      setSaving(false);
    }
  };

  const tokenError =
    refusal && refusal in TOKEN_FIELD_ERRORS
      ? tNew(TOKEN_FIELD_ERRORS[refusal as keyof typeof TOKEN_FIELD_ERRORS])
      : undefined;
  const expiryError = refusal === 'token_expiry_invalid' ? tNew('tokenExpiryInvalid') : undefined;

  return (
    <>
      <Button variant="outline" size="sm" hitArea onClick={() => setOpen(true)}>
        {t('token.replace')}
      </Button>
      <BottomSheet
        open={open}
        onClose={close}
        title={t('token.sheetTitle')}
        desktopCard={desktop}
        initialFocus="title"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="break-words text-sm text-text-secondary">{t('token.intro')}</p>
          <ProjectTokenFields
            values={values}
            onChange={(next) => {
              setRefusal(null);
              setValues(next);
            }}
            errors={{
              ...(tokenError ? { token: tokenError } : {}),
              ...(expiryError ? { expiresAt: expiryError } : {}),
            }}
            disabled={saving}
            today={today}
          />
          {refusal === 'org_mismatch' ? (
            <p role="alert" className={ALERT_CLASS}>
              {t('token.errors.orgChanged')}
            </p>
          ) : null}
          {refusal === 'unavailable' ? (
            <p role="alert" className={ALERT_CLASS}>
              {t('token.errors.notSaved')}
            </p>
          ) : null}
          <TokenHowTo collapsible />
          <Button type="submit" variant="brand" fullWidth loading={saving} disabled={!filled}>
            {saving ? t('token.saving') : t('token.save')}
          </Button>
        </form>
      </BottomSheet>
    </>
  );
}
