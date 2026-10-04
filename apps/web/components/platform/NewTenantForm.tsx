'use client';

import { Button, Card, Input } from '@rede-social/ui';
import { Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import {
  type DraftField,
  type TenantDraftInput,
  validateTenantDraftAction,
} from '@/app/(platform)/plataforma/novo/actions';
import { slugify } from '@/lib/slugify';
import { type TenantDraft, useTenantDraft } from './wizard/TenantDraftProvider';

/** The fields this step owns; the colours and the modules belong to Personalização. */
const DATA_FIELDS = ['displayName', 'slug', 'adminEmail'] as const satisfies readonly DraftField[];

/**
 * Step 1 (Dados) of the new-tenant wizard: who the tenant is. The display name, the slug (suggested
 * by `slugify` while untouched, editable, immutable once created) and the first-admin e-mail. The
 * colours, the modules and the logo are the next step's (Personalização). Every field lives in the
 * wizard's draft (`TenantDraftProvider`), so going back to this step finds it as it was left;
 * NOTHING is sent to the API here.
 *
 * "Continuar" runs the API's own schema in the web tier (`validateTenantDraftAction`, with the
 * draft's last VALID colours and its modules, so only this step's fields can fail here) and opens
 * Personalização; the form never duplicates a regex and never disables the button on a partial
 * fill. What only the API knows (a slug or an e-mail already in use) comes back from the summary's
 * confirmation as field errors, shown here.
 */
export function NewTenantForm() {
  const t = useTranslations('platform');
  const router = useRouter();
  const { draft, colors, enabledModules, restored, update, reset } = useTenantDraft();
  const [pending, setPending] = useState(false);
  /** A failure no field owns: the schema refused something else, or the check never ran. */
  const [problem, setProblem] = useState<'invalid' | 'unchecked' | null>(null);

  /** Any Dados edit re-opens validation: the later steps stay closed until "Continuar" again. */
  const edit = (fields: DraftField[], patch: Partial<TenantDraft>) => {
    const fieldErrors = { ...draft.fieldErrors };
    for (const field of fields) delete fieldErrors[field];
    update({ ...patch, fieldErrors, dataReady: false });
  };

  const fieldError = (name: DraftField) => {
    const key = draft.fieldErrors[name];
    return key ? t(`new.errors.${key}`) : undefined;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setProblem(null);
    const input: TenantDraftInput = {
      displayName: draft.displayName,
      slug: draft.slug,
      primary: colors.primary,
      secondary: colors.secondary,
      adminEmail: draft.adminEmail,
      modules: enabledModules,
    };
    try {
      const result = await validateTenantDraftAction(input);
      const fieldErrors = { ...draft.fieldErrors };
      for (const field of DATA_FIELDS) delete fieldErrors[field];
      if (result.ok) {
        update({ dataReady: true, fieldErrors });
        router.push('/plataforma/novo/marca');
        return;
      }
      for (const field of DATA_FIELDS) {
        const key = result.fieldErrors[field];
        if (key) fieldErrors[field] = key;
      }
      update({ dataReady: false, fieldErrors });
      if (!DATA_FIELDS.some((field) => result.fieldErrors[field])) setProblem('invalid');
    } catch (error) {
      console.error('platform.tenants.validate_failed', { error: String(error) });
      setProblem('unchecked');
    } finally {
      setPending(false);
    }
  };

  const discard = () => {
    reset();
    router.push('/plataforma');
  };

  return (
    <form onSubmit={onSubmit} noValidate data-draft-ready={restored ? '' : undefined}>
      <Card className="flex flex-col gap-6 p-4 md:p-6">
        {problem ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
          >
            {problem === 'invalid'
              ? t('wizard.errors.invalidDraft')
              : t('wizard.errors.checkFailed')}
          </div>
        ) : null}

        <Input
          id="displayName"
          name="displayName"
          label={t('new.displayName')}
          maxLength={60}
          required
          autoComplete="off"
          value={draft.displayName}
          onChange={(event) => {
            const displayName = event.target.value;
            if (draft.slugTouched) edit(['displayName'], { displayName });
            else edit(['displayName', 'slug'], { displayName, slug: slugify(displayName) });
          }}
          error={fieldError('displayName')}
        />

        <div className="flex flex-col gap-2">
          <Input
            id="slug"
            name="slug"
            label={t('new.slug')}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={draft.slug}
            onChange={(event) => edit(['slug'], { slug: event.target.value, slugTouched: true })}
            error={fieldError('slug')}
          />
          <p className="text-xs text-text-tertiary">{t('new.slugHelper')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Input
            id="adminEmail"
            name="adminEmail"
            type="email"
            icon={Mail}
            label={t('new.adminEmail')}
            autoComplete="off"
            value={draft.adminEmail}
            onChange={(event) => edit(['adminEmail'], { adminEmail: event.target.value })}
            error={fieldError('adminEmail')}
          />
          <p className="text-xs text-text-tertiary">{t('new.adminEmailHelper')}</p>
        </div>

        <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
          <Button type="button" variant="ghost" onClick={discard}>
            {t('new.discard')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            size="lg"
            loading={pending}
            className="w-full md:w-auto"
          >
            {pending ? t('wizard.actions.checking') : t('wizard.actions.next')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
