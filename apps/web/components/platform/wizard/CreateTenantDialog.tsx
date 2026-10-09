'use client';

import { BrandPreview } from '@rede-social/core/ui';
import { BottomSheet, Button } from '@rede-social/ui';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  type CreateTenantResult,
  createTenantFromDraftAction,
  type DraftFieldErrors,
  findCreatedTenantAction,
} from '@/app/(platform)/plataforma/novo/actions';
import { attachDomainAction } from '@/app/(platform)/plataforma/tenants/[id]/dominios/actions';
import {
  completeBrandingUploadAction,
  startBrandingUploadAction,
} from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import { lookBodyOf, resolveButtonPairs } from '@/lib/bg-tone';
import { brandingUploadErrorKey, runBrandingUpload } from '@/lib/branding-upload';
import { DEFAULT_TITLE_FONT, titleFontStyle, useTitleFont } from '@/lib/title-font';
import { needsRecompose, recomposeDraftIcon } from './draft-icon';
import { type ButtonRowKey, type InkKey, lookChanges } from './preview-colors';
import { useTenantDraft } from './TenantDraftProvider';

type Task = 'create' | 'logo' | 'icon' | 'domain';
type TaskStatus = 'pending' | 'running' | 'done' | 'failed';
/** review → running → (the invite step) | fix | generic | partial */
type Phase = 'review' | 'running' | 'fix' | 'generic' | 'partial';

const UPLOAD_ACTIONS = { start: startBrandingUploadAction, complete: completeBrandingUploadAction };

/** The confirmation's phrase of each ink (`summary.fontColorParts`). */
const INK_PART: Record<InkKey, string> = {
  titleColorLight: 'titleLight',
  titleColorDark: 'titleDark',
  appNameColorLight: 'appNameLight',
  appNameColorDark: 'appNameDark',
};

/**
 * The confirmation's phrase of each button colour (`summary.buttonParts`), by its summary row: a
 * gradient's first colour is its "cor inicial".
 */
const BUTTON_PART: Record<ButtonRowKey, string> = {
  buttonFillLight: 'fillLight',
  buttonFillStartLight: 'fillStartLight',
  buttonFillEndLight: 'fillEndLight',
  buttonInkLight: 'inkLight',
  buttonFillDark: 'fillDark',
  buttonFillStartDark: 'fillStartDark',
  buttonFillEndDark: 'fillEndDark',
  buttonInkDark: 'inkDark',
};

/**
 * The summary's confirmation: a reduced preview of the app (the kernel `BrandPreview` mini-shells,
 * light and dark, with the draft's name, colours and logo, and the very grounds, dark colours and
 * buttons the rows below list, so the frames never contradict them) and the short list a person
 * checks before a tenant exists (name, slug, modules, logo and icon, the title font and, only when
 * changed, the light ground, the dark mode's colours, the buttons' style and colours and the text
 * inks; domain, first admin). "Criar tenant" is the wizard's ONE moment of writing, in order and on
 * existing endpoints only: create the tenant with its pair, modules and look
 * (`createTenantFromDraftAction`; the look as `lookBodyOf` checks it, the very values the rows
 * list), then on its new id upload the picked logo and icon (`runBrandingUpload`, the tenant page's
 * own sequence) and attach the host (`attachDomainAction`), then move to the invite step
 * (`replace`, so Back never returns to a summary that would create the same slug again). An icon
 * whose ground follows the primary but was drawn on another one (a primary changed right before
 * Personalização was left, within the pause before that step composes it again) is composed again
 * on the tenant's primary before its upload (`recomposeDraftIcon`); should that fail, it goes as it
 * was composed.
 *
 * The new id goes into the draft the moment the API answers (`createdId`), before the uploads: from
 * then on a reload, a Back or a closed dialog lead to the invite step, never to a second creation,
 * and closing this dialog after a partial failure moves on too. An answer lost on the way back (Next
 * even replays an action whose fetch failed) turns into "slug taken": before calling that a refusal,
 * a read-only lookup (`findCreatedTenantAction`) checks whether the slug is the tenant this draft
 * just created (same slug, name and first admin), and the wizard carries on with it; an attempt
 * that never got its answer leaves its slug in the draft (`pendingSlug`), which lifts the lookup's
 * recency limit for the retry. A refused creation writes nothing: field errors (a slug or an e-mail
 * already in use) go back to the Dados step on the draft; anything else offers a retry. Once the
 * tenant exists, a failed upload or domain does not undo it: the task says why, and "Continuar"
 * moves on (the tenant page redoes either). The dialog cannot be dismissed while it writes.
 */
export function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('platform');
  const tw = useTranslations('platform.wizard');
  const tb = useTranslations('platformBranding');
  const td = useTranslations('platformDomains');
  const router = useRouter();
  const { draft, colors, enabledModules, logo, logoDark, icon, appIcon, update, setConfirming } =
    useTenantDraft();
  const [phase, setPhase] = useState<Phase>('review');
  const [status, setStatus] = useState<Partial<Record<Task, TaskStatus>>>({});
  const [reasons, setReasons] = useState<Partial<Record<Task, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<DraftFieldErrors>({});

  // Read by `close`, which keeps ONE identity while the dialog is open. Only by habit now: the
  // sheet's focus trap reads its onClose through a ref and arms once per opening, so a new
  // identity would no longer move the focus.
  const phaseRef = useRef<Phase>('review');
  const createdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // While open, this dialog owns what follows a creation: the steps' guard waits for it (its
  // progress and a partial failure stay on screen) instead of jumping to the invite step.
  useEffect(() => {
    if (!open) return;
    setConfirming(true);
    return () => setConfirming(false);
  }, [open, setConfirming]);

  const host = draft.host.trim();
  const tasks: Task[] = [
    'create',
    ...(logo ? (['logo'] as const) : []),
    ...(icon ? (['icon'] as const) : []),
    ...(host ? (['domain'] as const) : []),
  ];
  const name = draft.displayName.trim();
  const titleFont = useTitleFont(draft.titleFont);
  const mark = (task: Task, next: TaskStatus) => setStatus((prev) => ({ ...prev, [task]: next }));
  const fail = (task: Task, reason: string) => {
    mark(task, 'failed');
    setReasons((prev) => ({ ...prev, [task]: reason }));
  };

  const enter = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const toInvite = useCallback(
    (id: string) => router.replace(`/plataforma/novo/${id}/convite?toast=created`),
    [router],
  );

  const close = useCallback(() => {
    if (phaseRef.current === 'running') return;
    // The tenant exists: there is no way back to the summary, closing goes on to its invite step.
    if (createdRef.current) {
      toInvite(createdRef.current);
      return;
    }
    enter('review');
    setStatus({});
    setReasons({});
    onCloseRef.current();
  }, [enter, toInvite]);

  // The kernel mini-shells carry a real (inert, tabIndex -1) button, and the sheet's focus trap aims
  // its first focus at the first ENABLED button: disabled, they drop out of its list, so the focus
  // lands on "Voltar e revisar" (the wrapper keeps their look). Every render, before the trap runs.
  useLayoutEffect(() => {
    for (const button of previewRef.current?.querySelectorAll('button') ?? []) {
      button.disabled = true;
    }
  });

  // Each phase swaps the dialog's buttons: the focus moves to the new first one (to the content while
  // it writes), never left on a removed button behind the backdrop.
  useEffect(() => {
    if (!open || phase === 'review') return;
    const root = contentRef.current;
    if (!root) return;
    (root.querySelector<HTMLElement>('button:not([disabled])') ?? root).focus({
      preventScroll: true,
    });
  }, [open, phase]);

  /**
   * The draft's icon as the new tenant gets it, drawn on its primary: composed again when its ground
   * follows the primary and it was drawn on another one (see the docblock); when that fails, the
   * file as it was composed.
   */
  const iconOnPrimary = async (file: File): Promise<File> => {
    if (!needsRecompose(appIcon, colors.primary)) return file;
    try {
      const again = await recomposeDraftIcon({ appIcon, primary: colors.primary, logo, logoDark });
      return again ?? file;
    } catch (error) {
      console.error('platform.wizard.app_icon_failed', { error: String(error) });
      return file;
    }
  };

  const run = async () => {
    if (phaseRef.current === 'running') return;
    // The tenant exists already (this dialog reopened after a reload): its invite step is next.
    if (draft.createdId) {
      toInvite(draft.createdId);
      return;
    }
    // A host the Domínio step never accepted goes back there; nothing is written.
    if (host && !draft.hostReady) {
      close();
      router.push('/plataforma/novo/dominio');
      return;
    }

    enter('running');
    setStatus({});
    setReasons({});
    mark('create', 'running');

    const slug = draft.slug;
    // An earlier attempt with this slug never got its answer: the API may have created it.
    const retrying = draft.pendingSlug === slug;
    update({ pendingSlug: slug });

    let created: CreateTenantResult;
    try {
      created = await createTenantFromDraftAction({
        displayName: draft.displayName,
        slug,
        primary: draft.primary,
        secondary: draft.secondary,
        adminEmail: draft.adminEmail,
        modules: enabledModules,
        look: lookBodyOf(draft),
      });
    } catch (error) {
      console.error('platform.tenants.create_failed', { error: String(error) });
      created = { ok: false, error: 'generic' };
    }
    if (!created.ok && 'fieldErrors' in created && created.fieldErrors.slug === 'slugTaken') {
      // The slug may be taken by THIS creation: an answer lost on the way back (Next replays an
      // action whose fetch failed, and the replay hears "taken"), or that earlier attempt. The same
      // slug, name and first admin, just created (or by that attempt), IS it: carry on with it
      // instead of a false refusal.
      const found = await findCreatedTenantAction({
        slug,
        displayName: draft.displayName,
        adminEmail: draft.adminEmail,
        recentOnly: !retrying,
      }).catch(() => null);
      if (found) created = { ok: true, id: found.id };
    }
    if (!created.ok) {
      mark('create', 'failed');
      if ('fieldErrors' in created) {
        // A definitive refusal: nothing was created.
        update({ pendingSlug: null });
        setFieldErrors(created.fieldErrors);
        enter('fix');
      } else {
        enter('generic');
      }
      return;
    }

    const id = created.id;
    createdRef.current = id;
    update({ createdId: id, pendingSlug: null });
    mark('create', 'done');

    let missed = false;
    for (const [task, image] of [
      ['logo', logo],
      ['icon', icon],
    ] as const) {
      if (!image) continue;
      mark(task, 'running');
      const file = task === 'icon' ? await iconOnPrimary(image.file) : image.file;
      const outcome = await runBrandingUpload({
        tenantId: id,
        kind: task,
        file,
        actions: UPLOAD_ACTIONS,
      }).catch((error: unknown) => {
        console.error('platform.branding.upload_failed', { kind: task, error: String(error) });
        return { ok: false as const, code: 'generic' as const };
      });
      if (outcome.ok) {
        mark(task, 'done');
      } else {
        missed = true;
        fail(task, tb(brandingUploadErrorKey(outcome.code)));
      }
    }
    if (host) {
      mark('domain', 'running');
      const form = new FormData();
      form.set('host', host);
      const attached = await attachDomainAction(id, {}, form).catch((error: unknown) => {
        console.error('platform.domains.attach_failed', { error: String(error) });
        return { error: 'generic' as const };
      });
      if ('added' in attached && attached.added) {
        mark('domain', 'done');
      } else {
        missed = true;
        const key = ('fieldError' in attached ? attached.fieldError : undefined) ?? 'generic';
        fail('domain', td(`errors.${key}`));
      }
    }

    if (missed) {
      enter('partial');
      return;
    }
    toInvite(id);
  };

  const fixData = () => {
    // Back to the step that owns the refused field: Dados (name, slug, e-mail) closes its gate
    // again; a refused colour only needs Personalização.
    const onDados = Boolean(fieldErrors.displayName || fieldErrors.slug || fieldErrors.adminEmail);
    update(onDados ? { fieldErrors, dataReady: false } : { fieldErrors });
    enter('review');
    setStatus({});
    setReasons({});
    onCloseRef.current();
    router.push(onDados ? '/plataforma/novo' : '/plataforma/novo/marca');
  };

  const listFormatter = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });
  // The look's colours the tenant changed, one short phrase each: what it is, then its hex
  // (upper-cased, as the summary shows it) or its tone's name.
  const extra = lookChanges(draft);
  const darkParts = [
    ...(extra.dark.primary
      ? [tw('summary.darkParts.primary', { hex: extra.dark.primary.toUpperCase() })]
      : []),
    ...(extra.dark.secondary
      ? [tw('summary.darkParts.secondary', { hex: extra.dark.secondary.toUpperCase() })]
      : []),
    ...(extra.dark.tone
      ? [tw('summary.darkParts.tone', { tone: tw(`brand.tones.dark.${extra.dark.tone}`) })]
      : []),
  ];
  const inkParts = extra.inks.map(({ key, hex }) =>
    tw(`summary.fontColorParts.${INK_PART[key]}`, { hex: hex.toUpperCase() }),
  );
  // The gradient says so first; a solid button, the default, needs no word.
  const buttonParts = [
    ...(extra.buttonStyle ? [tw('summary.buttonParts.gradient')] : []),
    ...extra.buttons.map(({ row, hex }) =>
      tw(`summary.buttonParts.${BUTTON_PART[row]}`, { hex: hex.toUpperCase() }),
    ),
  ];
  // Each mode's buttons on its frame, as the phone gets them (the dark one inheriting the light,
  // a gradient whole).
  const buttons = resolveButtonPairs({
    buttonColors: draft.buttonColors,
    colors,
    darkColors: draft.darkColors,
  });
  const title = {
    review: tw('confirm.title'),
    running: tw('confirm.progress.title'),
    fix: tw('confirm.failed.dataTitle'),
    generic: tw('confirm.failed.genericTitle'),
    partial: tw('confirm.failed.partialTitle'),
  }[phase];

  return (
    <BottomSheet open={open} onClose={close} desktopCard title={title}>
      <div ref={contentRef} tabIndex={-1} className="outline-none">
        {phase === 'review' ? (
          <div data-create-dialog="review" className="flex flex-col gap-4">
            <p className="text-center text-sm text-text-secondary">{tw('confirm.body')}</p>
            {/* On a phone the two 200×140 frames go side by side at a reduced size (zoom), so the
                summary and the buttons stay close; from sm up they keep the kernel's own layout. */}
            <div
              ref={previewRef}
              className="[&_button:disabled]:opacity-100 max-sm:[&_.grid]:grid-cols-2 max-sm:[&_[data-brand-scope]]:[zoom:0.58] max-[359px]:[&_[data-brand-scope]]:[zoom:0.48]"
            >
              <BrandPreview
                className="max-sm:p-3"
                colors={colors}
                displayName={name || tb('preview.namePlaceholder')}
                logoUrl={logo?.url ?? null}
                logoDarkUrl={logoDark?.url ?? null}
                lightTone={extra.lightTone}
                dark={extra.dark}
                buttons={buttons}
                labels={{
                  light: tb('preview.light'),
                  dark: tb('preview.dark'),
                  lightAria: tb('preview.lightAria'),
                  darkAria: tb('preview.darkAria'),
                  login: tb('preview.login'),
                }}
              />
            </div>
            <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]">
              <dt className="text-text-tertiary">{tw('summary.fields.name')}</dt>
              <dd className="min-w-0 break-words font-bold text-text">{name}</dd>
              <dt className="text-text-tertiary">{tw('summary.fields.slug')}</dt>
              <dd className="min-w-0 break-words text-text">{draft.slug}</dd>
              <dt className="text-text-tertiary">{tw('done.modules')}</dt>
              <dd className="min-w-0 text-text">
                {enabledModules.length > 0
                  ? listFormatter.format(enabledModules.map((key) => t(`moduleNames.${key}`)))
                  : tw('done.noModules')}
              </dd>
              <dt className="text-text-tertiary">{tw('summary.sections.brand')}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-2 text-text">
                {logo ? (
                  // biome-ignore lint/performance/noImgElement: D-26 — the customer's file as-is, from a local object URL.
                  <img
                    src={logo.url}
                    alt={tw('summary.fields.logo')}
                    className="h-6 max-w-[120px] object-contain"
                  />
                ) : null}
                {icon ? (
                  // biome-ignore lint/performance/noImgElement: D-26 — see above.
                  <img
                    src={icon.url}
                    alt={tw('summary.fields.icon')}
                    className="size-6 rounded-md object-cover"
                  />
                ) : null}
                {logo || icon ? null : tw('summary.noLogoShort')}
              </dd>
              {extra.lightTone ? (
                <>
                  <dt className="text-text-tertiary">{tw('summary.fields.background')}</dt>
                  <dd data-confirm-background className="min-w-0 break-words text-text">
                    {tw(`brand.tones.light.${extra.lightTone}`)}
                  </dd>
                </>
              ) : null}
              {darkParts.length > 0 ? (
                <>
                  <dt className="text-text-tertiary">{tw('summary.darkTitle')}</dt>
                  <dd data-confirm-dark className="min-w-0 break-words text-text">
                    {listFormatter.format(darkParts)}
                  </dd>
                </>
              ) : null}
              {buttonParts.length > 0 ? (
                <>
                  <dt className="text-text-tertiary">{tw('summary.buttonsTitle')}</dt>
                  <dd data-confirm-buttons className="min-w-0 break-words text-text">
                    {listFormatter.format(buttonParts)}
                  </dd>
                </>
              ) : null}
              <dt className="text-text-tertiary">{tw('summary.sections.font')}</dt>
              <dd data-confirm-font className="min-w-0 break-words text-text">
                {draft.titleFont ? (
                  <span style={titleFontStyle(titleFont)} className="font-bold">
                    {draft.titleFont}
                  </span>
                ) : (
                  tw('summary.fontDefault', { font: DEFAULT_TITLE_FONT })
                )}
              </dd>
              {inkParts.length > 0 ? (
                <>
                  <dt className="text-text-tertiary">{tw('summary.fields.fontColors')}</dt>
                  <dd data-confirm-font-colors className="min-w-0 break-words text-text">
                    {listFormatter.format(inkParts)}
                  </dd>
                </>
              ) : null}
              <dt className="text-text-tertiary">{tw('summary.sections.domain')}</dt>
              <dd className="min-w-0 break-words text-text">{host || t('tenant.noHost')}</dd>
              <dt className="text-text-tertiary">{tw('summary.fields.email')}</dt>
              <dd className="min-w-0 break-words text-text">{draft.adminEmail}</dd>
            </dl>
            {/* Pinned to the sheet's bottom edge while the summary scrolls (a short phone): the
                sheet's scroller pads 1rem, so the bar spans that padding to sit flush and cover
                what passes. */}
            <div
              data-create-actions
              className="sticky -bottom-4 -mx-4 -mb-4 flex flex-col-reverse gap-3 border-t border-border bg-bg-secondary px-4 py-3 md:flex-row md:justify-end"
            >
              <Button type="button" variant="ghost" onClick={close}>
                {tw('confirm.cancel')}
              </Button>
              <Button type="button" variant="brand" onClick={run} data-create-confirm>
                {tw('confirm.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <div data-create-dialog={phase} className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3">
              {tasks.map((task) => {
                const state = status[task] ?? 'pending';
                const Icon =
                  state === 'done'
                    ? CheckCircle2
                    : state === 'failed'
                      ? XCircle
                      : state === 'running'
                        ? Loader2
                        : Circle;
                const reason = state === 'failed' ? reasons[task] : undefined;
                return (
                  <li
                    key={task}
                    data-task={task}
                    data-state={state}
                    className="flex items-start gap-3"
                  >
                    <Icon
                      aria-hidden
                      size={20}
                      className={
                        state === 'done'
                          ? 'shrink-0 text-brand'
                          : state === 'failed'
                            ? 'shrink-0 text-danger'
                            : state === 'running'
                              ? 'shrink-0 animate-spin text-text-secondary'
                              : 'shrink-0 text-text-tertiary'
                      }
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={
                          state === 'pending' ? 'text-sm text-text-tertiary' : 'text-sm text-text'
                        }
                      >
                        {tw(`confirm.progress.${task}`)}
                      </span>
                      {reason ? <span className="text-xs text-danger">{reason}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>

            {phase === 'fix' ? (
              <div role="alert" className="flex flex-col gap-3">
                <p className="text-sm text-danger">{tw('confirm.failed.data')}</p>
                <ul className="list-disc pl-5 text-sm text-text-secondary">
                  {Object.values(fieldErrors).map((key) => (
                    <li key={key}>{t(`new.errors.${key}`)}</li>
                  ))}
                </ul>
                <Button type="button" variant="brand" onClick={fixData}>
                  {tw('confirm.failed.fix')}
                </Button>
              </div>
            ) : null}

            {phase === 'generic' ? (
              <div role="alert" className="flex flex-col gap-3">
                <p className="text-sm text-danger">{tw('confirm.failed.generic')}</p>
                <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
                  <Button type="button" variant="ghost" onClick={close}>
                    {tw('confirm.cancel')}
                  </Button>
                  <Button type="button" variant="brand" onClick={run}>
                    {tw('confirm.failed.retry')}
                  </Button>
                </div>
              </div>
            ) : null}

            {phase === 'partial' ? (
              <div role="alert" className="flex flex-col gap-3">
                <p className="text-sm text-text-secondary">{tw('confirm.failed.partial')}</p>
                <Button type="button" variant="brand" onClick={close}>
                  {tw('confirm.failed.continue')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
