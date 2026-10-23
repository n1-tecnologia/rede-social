'use client';

import { BottomSheet, Button, useMediaQuery, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import type {
  ReplaceCredentialsResult,
  ReplaceCredentialsValues,
} from '@/app/(platform)/plataforma/tenants/[id]/banco/actions';
import { ProjectAccessFields, type ProjectAccessValues } from './ProjectAccessFields';

export interface ReplaceCredentialsSheetProps {
  tenantId: string;
  /** `replaceCredentialsAction` - the API call lives in the server action; it never returns a value. */
  action: (tenantId: string, values: ReplaceCredentialsValues) => Promise<ReplaceCredentialsResult>;
}

const EMPTY: ProjectAccessValues = { databasePassword: '', serviceKey: '', publishableKey: '' };

/**
 * "Substituir credenciais" and its sheet (09.2-19, UI-D-538, D-539, DBT-40): the only reason to touch a
 * secret in the panel is that it changed upstream. The outline `sm` button opens a `BottomSheet` with the
 * intro, the shared `ProjectAccessFields` (`requireAll={false}`: any non-empty subset saves) and a brand
 * full-width "Salvar credenciais" that stays disabled until one field is filled. There is no
 * confirmation dialog: the server tries the new values against the project before it replaces anything,
 * so a typo can never take a tenant down.
 *
 * Write-only by construction:
 *  - the fields open EMPTY, every time, and are never pre-filled from anything;
 *  - the values live in this component's state and nowhere else: not `sessionStorage`, not a cookie, not
 *    a URL, not a log, not a toast; they are cleared when the sheet closes (any way) and on success;
 *  - while a save is in flight the fields are locked and the sheet cannot be closed;
 *  - the answer carries a flag and a catalog key, never a value.
 *
 * A refusal ("Não foi possível entrar no projeto com estes dados. Nada foi alterado.") keeps the sheet open
 * with a `role="alert"` and leaves what was typed in place for correction. Success closes the sheet,
 * toasts "Credenciais atualizadas." and refreshes the page so the card shows the new timestamp.
 */
export function ReplaceCredentialsSheet({ tenantId, action }: ReplaceCredentialsSheetProps) {
  const t = useTranslations('platform.database');
  const toast = useToast();
  const router = useRouter();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ProjectAccessValues>(EMPTY);
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);

  const filled = Object.values(values).some((value) => value.trim() !== '');

  const close = () => {
    if (saving) return;
    setOpen(false);
    setValues(EMPTY);
    setRefused(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !filled) return;

    const send: ReplaceCredentialsValues = {};
    for (const key of ['databasePassword', 'serviceKey', 'publishableKey'] as const) {
      const value = values[key].trim();
      if (value) send[key] = value;
    }

    setSaving(true);
    setRefused(false);
    try {
      const result = await action(tenantId, send);
      if (result.ok) {
        setOpen(false);
        setValues(EMPTY);
        toast.show({ tone: 'success', message: t('credentials.saved') });
        router.refresh();
      } else if (result.error === 'access') {
        setRefused(true);
      } else {
        toast.show({ tone: 'error', message: t('errors.generic') });
      }
    } catch {
      toast.show({ tone: 'error', message: t('errors.generic') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" hitArea onClick={() => setOpen(true)}>
        {t('credentials.replace')}
      </Button>
      <BottomSheet
        open={open}
        onClose={close}
        title={t('credentials.sheetTitle')}
        desktopCard={desktop}
        initialFocus="title"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="break-words text-sm text-text-secondary">{t('credentials.intro')}</p>
          <ProjectAccessFields
            values={values}
            onChange={(patch) => {
              setRefused(false);
              setValues((prev) => ({ ...prev, ...patch }));
            }}
            errors={refused ? { form: t('errors.access') } : {}}
            requireAll={false}
            disabled={saving}
          />
          <Button type="submit" variant="brand" fullWidth loading={saving} disabled={!filled}>
            {saving ? t('credentials.saving') : t('credentials.save')}
          </Button>
        </form>
      </BottomSheet>
    </>
  );
}
