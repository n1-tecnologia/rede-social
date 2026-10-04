'use client';

import { BrandPreview } from '@rede-social/core/ui';
import { Button, Card, SectionTitle } from '@rede-social/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { resolveButtonPairs } from '@/lib/bg-tone';
import { DEFAULT_TITLE_FONT, titleFontStyle, useTitleFont } from '@/lib/title-font';
import { CreateTenantDialog } from './CreateTenantDialog';
import { lookChanges } from './preview-colors';
import { type DraftImage, useTenantDraft } from './TenantDraftProvider';

/**
 * Step 4 (Resumo), the last step before the tenant exists: everything the wizard collected, one card
 * per subject with an "Editar" link back to its step, in the steps' order (Dados, then
 * Personalização's colours, title font, logo and icon, and modules, then Domínio): the colour
 * swatches, the font drawn in itself, the picked logo and icon; the phone beside it (from `xl` up)
 * or the `BrandPreview` mini-shells (below) preview the app. "Criar tenant" opens the confirmation
 * (`CreateTenantDialog`), the wizard's only write, which saves all of it, the look included.
 *
 * The look's colours join the cards they belong to, each ONLY when the tenant changed it: the light
 * ground under the two colours (`data-summary-background`, the tone's own swatch and name), the dark
 * mode's colours and ground as a block of the same card (`data-summary-dark`), the buttons' own
 * colours set per mode as another block of it (`data-summary-buttons`, led by the style when it is
 * the gradient, whose first colour reads "Cor inicial"), and the titles' and the app name's inks per
 * theme under the font (`data-summary-font-colors`). A draft that kept the system's colours reads as
 * before. The mini-shells take the same values as those rows (`lookChanges`): the light frame on the
 * chosen ground, the dark one with the dark mode's colours and ground, each with its mode's buttons
 * (`resolveButtonPairs`: what the dark mode inherits from the light one shows there too, and a
 * gradient whole), so below `xl`, where they are the only preview, they never contradict the cards
 * above them.
 */
export function WizardSummary() {
  const t = useTranslations('platform');
  const tw = useTranslations('platform.wizard');
  const tb = useTranslations('platformBranding');
  const { draft, colors, enabledModules, logo, icon } = useTenantDraft();
  const titleFont = useTitleFont(draft.titleFont);
  const extra = lookChanges(draft);
  const dark = extra.dark;
  const buttons = resolveButtonPairs({
    buttonColors: draft.buttonColors,
    colors,
    darkColors: draft.darkColors,
  });
  const [confirming, setConfirming] = useState(false);
  const closeConfirmation = useCallback(() => setConfirming(false), []);
  const name = draft.displayName.trim();
  const host = draft.host.trim();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard title={tw('summary.sections.data')} editHref="/plataforma/novo">
          <SummaryRow label={tw('summary.fields.name')} value={name} strong />
          <SummaryRow label={tw('summary.fields.slug')} value={draft.slug} />
          <SummaryRow label={tw('summary.fields.email')} value={draft.adminEmail} />
        </SummaryCard>

        <SummaryCard title={tw('summary.sections.colors')} editHref="/plataforma/novo/marca">
          <Swatch label={t('new.primary')} hex={draft.primary} />
          <Swatch label={t('new.secondary')} hex={draft.secondary} />
          {extra.lightTone ? (
            <div data-summary-background>
              <ToneSwatch
                mode="light"
                tone={extra.lightTone}
                label={tw('summary.fields.background')}
                name={tw(`brand.tones.light.${extra.lightTone}`)}
              />
            </div>
          ) : null}
          {dark.primary || dark.secondary || dark.tone ? (
            <div data-summary-dark className="flex flex-col gap-3 border-t border-divider pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {tw('summary.darkTitle')}
              </span>
              {dark.primary ? <Swatch label={t('new.primary')} hex={dark.primary} /> : null}
              {dark.secondary ? <Swatch label={t('new.secondary')} hex={dark.secondary} /> : null}
              {dark.tone ? (
                <ToneSwatch
                  mode="dark"
                  tone={dark.tone}
                  label={tw('summary.fields.background')}
                  name={tw(`brand.tones.dark.${dark.tone}`)}
                />
              ) : null}
            </div>
          ) : null}
          {extra.buttonStyle || extra.buttons.length > 0 ? (
            <div data-summary-buttons className="flex flex-col gap-3 border-t border-divider pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {tw('summary.buttonsTitle')}
              </span>
              {extra.buttonStyle ? (
                <div data-summary-button-style>
                  <SummaryRow
                    label={tw('summary.fields.buttonStyle')}
                    value={tw('brand.buttons.styleGradient')}
                    strong
                  />
                </div>
              ) : null}
              {extra.buttons.map(({ key, row, hex }) => (
                <Swatch key={key} label={tw(`summary.fields.${row}`)} hex={hex} />
              ))}
            </div>
          ) : null}
        </SummaryCard>

        <SummaryCard title={tw('summary.sections.font')} editHref="/plataforma/novo/marca">
          {draft.titleFont ? (
            <div data-summary-font className="flex min-w-0 flex-col gap-1">
              <p
                style={titleFontStyle(titleFont)}
                className="truncate text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
              >
                {draft.titleFont}
              </p>
            </div>
          ) : (
            <p data-summary-font className="text-sm text-text">
              {tw('summary.fontDefault', { font: DEFAULT_TITLE_FONT })}
            </p>
          )}
          {extra.inks.length > 0 ? (
            <div
              data-summary-font-colors
              className="flex flex-col gap-3 border-t border-divider pt-3"
            >
              {extra.inks.map(({ key, hex }) => (
                <Swatch key={key} label={tw(`summary.fields.${key}`)} hex={hex} />
              ))}
            </div>
          ) : null}
        </SummaryCard>

        <SummaryCard title={tw('summary.sections.brand')} editHref="/plataforma/novo/marca">
          <div className="grid grid-cols-2 gap-3">
            <Thumb
              label={tw('summary.fields.logo')}
              image={logo}
              empty={tw('summary.noLogo')}
              alt={tb('logo.alt', { tenant: name })}
            />
            <Thumb
              label={tw('summary.fields.icon')}
              image={icon}
              // Without a logo nothing is derived: the app keeps the platform's neutral icons.
              empty={logo ? tw('summary.noIcon') : tw('summary.noIconNoLogo')}
              alt={tb('icon.alt', { tenant: name })}
            />
          </div>
        </SummaryCard>

        <SummaryCard
          title={tw('summary.sections.modules')}
          editHref="/plataforma/novo/marca"
          className="md:col-span-2"
        >
          {enabledModules.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {enabledModules.map((key) => (
                <li
                  key={key}
                  className="rounded-full bg-bg-input px-3 py-1 text-xs font-bold text-text-secondary"
                >
                  {t(`moduleNames.${key}`)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">{tw('done.noModules')}</p>
          )}
        </SummaryCard>

        <SummaryCard
          title={tw('summary.sections.domain')}
          editHref="/plataforma/novo/dominio"
          className="md:col-span-2"
        >
          <p className="break-words text-sm text-text">{host || tw('summary.noDomain')}</p>
        </SummaryCard>
      </div>

      <BrandPreview
        className="xl:hidden"
        colors={colors}
        displayName={name || tb('preview.namePlaceholder')}
        logoUrl={logo?.url ?? null}
        lightTone={extra.lightTone}
        dark={dark}
        buttons={buttons}
        labels={{
          light: tb('preview.light'),
          dark: tb('preview.dark'),
          lightAria: tb('preview.lightAria'),
          darkAria: tb('preview.darkAria'),
          login: tb('preview.login'),
        }}
      />

      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <LinkButton href="/plataforma/novo/dominio" variant="ghost">
          {tw('actions.back')}
        </LinkButton>
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="w-full md:w-auto"
          onClick={() => setConfirming(true)}
        >
          {tw('summary.create')}
        </Button>
      </div>

      <CreateTenantDialog open={confirming} onClose={closeConfirmation} />
    </div>
  );
}

function SummaryCard({
  title,
  editHref,
  className,
  children,
}: {
  title: string;
  editHref: string;
  className?: string;
  children: ReactNode;
}) {
  const tw = useTranslations('platform.wizard');
  return (
    <Card className={['flex flex-col gap-3 p-4 md:p-5', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <SectionTitle variant="group">{title}</SectionTitle>
        <Link
          href={editHref}
          aria-label={tw('summary.editSection', { section: title })}
          className="rounded-full px-2 py-1 text-sm font-bold text-brand transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {tw('summary.edit')}
        </Link>
      </div>
      {children}
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span
        className={
          strong ? 'break-words text-sm font-bold text-text' : 'break-words text-sm text-text'
        }
      >
        {value}
      </span>
    </div>
  );
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="h-9 w-9 shrink-0 rounded-xl border border-border"
        style={{ backgroundColor: hex }}
      />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-text-tertiary">{label}</span>
        <span className="text-sm font-bold uppercase tabular-nums text-text">{hex}</span>
      </div>
    </div>
  );
}

/**
 * A ground tone: its own swatch (the id on an element painted with the tone's variable, so no
 * colour literal reaches this file) and its name.
 */
function ToneSwatch({
  mode,
  tone,
  label,
  name,
}: {
  mode: 'light' | 'dark';
  tone: string;
  label: string;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {mode === 'light' ? (
        <span
          aria-hidden
          data-bg-tone={tone}
          className="h-9 w-9 shrink-0 rounded-xl border border-border bg-[var(--tone-ground)]"
        />
      ) : (
        <span
          aria-hidden
          data-dark-tone={tone}
          className="h-9 w-9 shrink-0 rounded-xl border border-border bg-[var(--dtone-ground)]"
        />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-text-tertiary">{label}</span>
        <span className="text-sm font-bold text-text">{name}</span>
      </div>
    </div>
  );
}

function Thumb({
  label,
  image,
  empty,
  alt,
}: {
  label: string;
  image: DraftImage | null;
  empty: string;
  alt: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs text-text-tertiary">{label}</span>
      {image ? (
        <div className="flex h-16 items-center justify-center rounded-xl bg-bg px-2">
          {/* biome-ignore lint/performance/noImgElement: D-26 — the customer's file as-is, from a local object URL. */}
          <img src={image.url} alt={alt} className="h-12 max-w-full object-contain" />
        </div>
      ) : (
        <p className="text-xs text-text-secondary">{empty}</p>
      )}
    </div>
  );
}
