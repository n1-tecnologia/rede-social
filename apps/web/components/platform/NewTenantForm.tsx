'use client';

import { normalizeProjectRef, projectRefSchema } from '@rede-social/contracts/projects';
import { Button, Card, Input, SectionTitle, SegmentedControl } from '@rede-social/ui';
import { Database, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  type DraftField,
  type TenantDraftInput,
  validateTenantDraftAction,
} from '@/app/(platform)/plataforma/novo/actions';
import { slugify } from '@/lib/slugify';
import { ProjectAccessFields } from './ProjectAccessFields';
import { ProjectTokenFields } from './ProjectTokenFields';
import { TokenHowTo } from './TokenHowTo';
import { type TenantDraft, useTenantDraft } from './wizard/TenantDraftProvider';

/** The fields this step owns; the colours and the modules belong to Personalização. */
const DATA_FIELDS = [
  'displayName',
  'slug',
  'adminEmail',
  'projectRef',
  'databasePassword',
  'serviceKey',
  'publishableKey',
  'access',
  'token',
  'tokenExpiresAt',
] as const satisfies readonly DraftField[];

/** The manual-access fields, with the error each one raises when it is empty on "Continuar". */
const ACCESS_REQUIRED = {
  databasePassword: 'passwordRequired',
  serviceKey: 'serviceKeyRequired',
  publishableKey: 'publishableKeyRequired',
} as const;

/** What an edit of the ref also resets: the project's own errors and the manual access with them. */
const REF_FIELDS = [
  'projectRef',
  'databasePassword',
  'serviceKey',
  'publishableKey',
  'access',
] as const satisfies readonly DraftField[];

/** What switching the owner also resets: the ref's fields plus the token and its date (UI-D-549). */
const OWNER_FIELDS = [
  ...REF_FIELDS,
  'token',
  'tokenExpiresAt',
] as const satisfies readonly DraftField[];

/** Today as `YYYY-MM-DD` in the platform's time zone: the bounds of the expiry field come from it. */
const todayLabel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

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
 *
 * Only when the pre-check says the platform cannot obtain the project's access by itself
 * (`manualAccess`, UI-D-534) the group grows the three write-only fields (`ProjectAccessFields`):
 * absent from the DOM otherwise. The first "Continuar" that learns it only reveals the block; from
 * then on all three are required, each with its own error. Their values live in the draft provider's
 * MEMORY (`access`), never in `sessionStorage`, and travel once, with the creation.
 *
 * Since 09.4-15 the group opens with the owner choice (UI-D-549): "Projeto da plataforma" (default,
 * today's flow, byte for byte) or "Projeto do cliente", which adds the write-only token and the optional
 * expiry (`ProjectTokenFields`, UI-D-550) and the open how-to (`TokenHowTo`). The token lives in the
 * draft provider's MEMORY (`token`), never in `sessionStorage`; switching the owner clears it, the date
 * and the project's errors and closes the later steps again, exactly as editing the ref does.
 */
export function NewTenantForm() {
  const t = useTranslations('platform');
  const router = useRouter();
  const {
    draft,
    colors,
    enabledModules,
    restored,
    access,
    setAccess,
    clearAccess,
    token,
    setToken,
    clearToken,
    update,
    reset,
  } = useTenantDraft();
  const customer = draft.owner === 'customer';
  /** The block was just revealed by "Continuar": its first field takes the focus (not on a reload). */
  const revealed = useRef(false);
  const [pending, setPending] = useState(false);
  /** A failure no field owns: the schema refused something else, or the check never ran. */
  const [problem, setProblem] = useState<'invalid' | 'unchecked' | 'projectUnchecked' | null>(null);

  /** Any Dados edit re-opens validation: the later steps stay closed until "Continuar" again. */
  const edit = (fields: DraftField[], patch: Partial<TenantDraft>) => {
    const fieldErrors = { ...draft.fieldErrors };
    for (const field of fields) delete fieldErrors[field];
    update({ ...patch, fieldErrors, dataReady: false });
  };

  /** A new ref is a new project: its errors, the pre-check's `manualAccess` and the secrets go. */
  const setRef = (projectRef: string) => {
    clearAccess();
    edit([...REF_FIELDS], { projectRef, manualAccess: false });
  };

  /** A new owner is a new question: the token, the date, the project's errors and the access go; the ref stays. */
  const setOwner = (value: string) => {
    const owner = value === 'customer' ? 'customer' : 'platform';
    if (owner === draft.owner) return;
    clearAccess();
    clearToken();
    setProblem(null);
    edit([...OWNER_FIELDS], { owner, tokenExpiresAt: '', manualAccess: false });
  };

  useEffect(() => {
    if (!draft.manualAccess || !revealed.current) return;
    revealed.current = false;
    document.getElementById('access-databasePassword')?.focus();
  }, [draft.manualAccess]);

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
      // A platform draft sends no new field (D-566); a customer draft adds owner, token and date, once.
      ...(customer ? { owner: 'customer', token, tokenExpiresAt: draft.tokenExpiresAt } : {}),
    };
    try {
      // A customer draft without its token asks nothing of the server (UI-D-550): the errors show here.
      if (customer && token.trim() === '') {
        const fieldErrors = { ...draft.fieldErrors };
        for (const field of DATA_FIELDS) delete fieldErrors[field];
        fieldErrors.token = 'tokenRequired';
        if (projectRef === '') fieldErrors.projectRef = 'projectRefRequired';
        else if (!projectRefSchema.safeParse(projectRef).success) {
          fieldErrors.projectRef = 'projectRefInvalid';
        }
        update({ projectRef, dataReady: false, fieldErrors });
        return;
      }
      const result = await validateTenantDraftAction(input);
      const fieldErrors = { ...draft.fieldErrors };
      for (const field of DATA_FIELDS) delete fieldErrors[field];
      // The pre-check's word on the access: undefined when it did not get that far.
      const manual = result.manualAccess;
      const blockShown = draft.manualAccess;
      if (manual === false) clearAccess();
      if (!result.ok) {
        for (const field of DATA_FIELDS) {
          const key = result.fieldErrors[field];
          if (key) fieldErrors[field] = key;
        }
      }
      // All three are required once the block is on screen, each with its own error (E02).
      let accessMissing = false;
      if (manual && blockShown) {
        for (const [field, key] of Object.entries(ACCESS_REQUIRED)) {
          if (access[field as keyof typeof ACCESS_REQUIRED].trim() === '') {
            fieldErrors[field as keyof typeof ACCESS_REQUIRED] = key;
            accessMissing = true;
          }
        }
      }
      // The first "Continuar" that learns the access is manual only reveals the block.
      const reveal = manual === true && !blockShown;
      if (reveal) revealed.current = true;
      const passed = result.ok && !accessMissing && !reveal;
      update({
        projectRef,
        dataReady: passed,
        fieldErrors,
        ...(manual === undefined ? {} : { manualAccess: manual }),
      });
      if (passed) {
        router.push('/plataforma/novo/marca');
        return;
      }
      if (!result.ok && result.unchecked) setProblem('projectUnchecked');
      else if (!result.ok && !DATA_FIELDS.some((field) => result.fieldErrors[field])) {
        setProblem('invalid');
      }
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
          <SegmentedControl
            className="mt-4"
            wrap
            label={t('wizard.project.owner.label')}
            options={[
              { value: 'platform', label: t('wizard.project.owner.platform') },
              { value: 'customer', label: t('wizard.project.owner.customer') },
            ]}
            value={draft.owner}
            onChange={setOwner}
            disabled={pending}
          />
          <p className="mt-2 text-sm text-text-secondary">
            {customer ? t('wizard.project.bodyCustomer') : t('wizard.project.body')}
          </p>
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
              onChange={(event) => setRef(event.target.value)}
              onPaste={(event) => {
                // A pasted dashboard or API address becomes the bare ref at once (UI-D-533).
                event.preventDefault();
                setRef(normalizeProjectRef(event.clipboardData.getData('text')));
              }}
              onBlur={() => {
                const normalized = normalizeProjectRef(draft.projectRef);
                if (normalized !== draft.projectRef) setRef(normalized);
              }}
              error={fieldError('projectRef')}
            />
            <p className="text-xs text-text-tertiary">{t('wizard.project.helper')}</p>
          </div>
          {customer ? (
            <>
              <ProjectTokenFields
                className="mt-4"
                disabled={pending}
                today={todayLabel()}
                values={{ token, expiresAt: draft.tokenExpiresAt }}
                onChange={(next) => {
                  const tokenChanged = next.token !== token;
                  if (tokenChanged) setToken(next.token);
                  edit(tokenChanged ? ['token'] : ['tokenExpiresAt'], {
                    tokenExpiresAt: next.expiresAt,
                  });
                }}
                errors={{
                  token: fieldError('token'),
                  expiresAt: fieldError('tokenExpiresAt'),
                }}
              />
              <TokenHowTo className="mt-4" />
            </>
          ) : null}
          {draft.manualAccess ? (
            <ProjectAccessFields
              className="mt-4"
              requireAll
              disabled={pending}
              values={access}
              onChange={(patch) => {
                setAccess(patch);
                edit(['access', ...(Object.keys(patch) as DraftField[])], {});
              }}
              errors={{
                databasePassword: fieldError('databasePassword'),
                serviceKey: fieldError('serviceKey'),
                publishableKey: fieldError('publishableKey'),
                form: fieldError('access'),
              }}
            />
          ) : null}
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
