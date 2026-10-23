'use client';

import { normalizeProjectRef } from '@rede-social/contracts/projects';
import { Button, Card, Input, SectionTitle } from '@rede-social/ui';
import { Database, Mail } from 'lucide-react';
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
const DATA_FIELDS = [
  'displayName',
  'slug',
  'adminEmail',
  'projectRef',
] as const satisfies readonly DraftField[];

/**
 * Step 1 (Dados) of the new-tenant wizard: who the tenant is. The display name, the slug (suggested
 * by `slugify` while untouched, editable, immutable once created), the first-admin e-mail and, since
 * 09.2-18, the Supabase project that will hold the tenant's data (UI-D-533): one field, the 20-letter
 * ref, which also takes the address people copy (`normalizeProjectRef` on blur and on paste, so the
 * field only ever shows the bare ref). The colours, the modules and the logo are the next step's
 * (Personalização). Every field lives in the wizard's draft (`TenantDraftProvider`), so going back
 * to this step finds it as it was left; NOTHING is WRITTEN to the API here.
 *
 * "Continuar" runs the API's own schema in the web tier (`validateTenantDraftAction`, with the
 * draft's last VALID colours and its modules, so only this step's fields can fail here) and the
 * platform's read-only pre-check of the project, and opens Personalização when both pass; the form
 * never duplicates a regex and never disables the button on a partial fill. Every edit of the ref
 * clears its error and closes the later steps again. What only the API knows (a slug or an e-mail
 * already in use) comes back from the summary's confirmation as field errors, shown here.
 */
export function NewTenantForm() {
  const t = useTranslations('platform');
  const router = useRouter();
  const { draft, colors, enabledModules, restored, update, reset } = useTenantDraft();
  const [pending, setPending] = useState(false);
  /** A failure no field owns: the schema refused something else, or the check never ran. */
  const [problem, setProblem] = useState<'invalid' | 'unchecked' | 'projectUnchecked' | null>(null);

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
    // What reaches the server is always the normalised ref (P99), typed-and-never-blurred included.
    const projectRef = normalizeProjectRef(draft.projectRef);
    const input: TenantDraftInput = {
      displayName: draft.displayName,
      slug: draft.slug,
      primary: colors.primary,
      secondary: colors.secondary,
      adminEmail: draft.adminEmail,
      modules: enabledModules,
      projectRef,
    };
    try {
      const result = await validateTenantDraftAction(input);
      const fieldErrors = { ...draft.fieldErrors };
      for (const field of DATA_FIELDS) delete fieldErrors[field];
      if (result.ok) {
        update({ projectRef, dataReady: true, fieldErrors });
        router.push('/plataforma/novo/marca');
        return;
      }
      for (const field of DATA_FIELDS) {
        const key = result.fieldErrors[field];
        if (key) fieldErrors[field] = key;
      }
      update({ projectRef, dataReady: false, fieldErrors });
      if (result.unchecked) setProblem('projectUnchecked');
      else if (!DATA_FIELDS.some((field) => result.fieldErrors[field])) setProblem('invalid');
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
              : problem === 'projectUnchecked'
                ? t('wizard.errors.projectUnchecked')
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

        <div>
          <SectionTitle variant="group" as="h3">
            {t('wizard.project.title')}
          </SectionTitle>
          <p className="mt-1 text-sm text-text-secondary">{t('wizard.project.body')}</p>
          <div className="mt-4 flex flex-col gap-2">
            <Input
              id="projectRef"
              name="projectRef"
              icon={Database}
              label={t('wizard.project.label')}
              maxLength={200}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="tabular-nums"
              value={draft.projectRef}
              onChange={(event) => edit(['projectRef'], { projectRef: event.target.value })}
              onPaste={(event) => {
                // A pasted dashboard or API address becomes the bare ref at once (UI-D-533).
                event.preventDefault();
                edit(['projectRef'], {
                  projectRef: normalizeProjectRef(event.clipboardData.getData('text')),
                });
              }}
              onBlur={() => {
                const normalized = normalizeProjectRef(draft.projectRef);
                if (normalized !== draft.projectRef)
                  edit(['projectRef'], { projectRef: normalized });
              }}
              error={fieldError('projectRef')}
            />
            <p className="text-xs text-text-tertiary">{t('wizard.project.helper')}</p>
          </div>
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
