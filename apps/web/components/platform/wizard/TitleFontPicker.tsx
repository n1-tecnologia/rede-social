'use client';

import { Button, Card, Chip, cn, Input, SectionTitle } from '@rede-social/ui';
import { Check, Pencil, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_TITLE_FONT,
  FONT_CATEGORIES,
  type FontCategory,
  filterFonts,
  type GoogleFont,
  loadFontSamples,
  loadGoogleFonts,
  titleFontStack,
  titleFontStyle,
  useTitleFont,
} from '@/lib/title-font';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { useBrandLook } from './brand-look-context';
import { FontColorFields } from './FontColorFields';
import { FontSampleLine } from './FontSampleLine';

/** Families rendered at a time: the list grows by this much ("Mostrar mais fontes"). */
const PAGE = 40;

/** The default as a catalogue entry, for the search: Manrope never comes from Google. */
const DEFAULT_ENTRY: GoogleFont = [DEFAULT_TITLE_FONT, 'sans', [700]];

/** How long the typing has to pause before the result count is announced. */
const ANNOUNCE_DELAY_MS = 600;

/**
 * Personalização's title font: ONE Google Fonts family for the app name in the top bar (shown only
 * when the tenant has no logo: with one, the top bar shows the logo alone), the Comunidades and
 * Eventos titles and the names on community and event cards; the rest of the app keeps Manrope (the
 * default). The catalogue (about 1,600 families, `lib/google-fonts.ts`) loads when the step opens;
 * the list searches it, narrows it by kind and shows each family in its own letters (only the
 * rendered ones, a few kilobytes each). The sample draws those titles in the chosen family, for the
 * widths where the phone is not beside the form; its top-bar name line follows the same rule and
 * leaves once a logo is picked. Right under the sample, the line always names the chosen family (it
 * may sit outside the filtered list) with the way back to the default and the "Editar" that opens
 * the choice; then the titles' and the app name's inks, one per theme, under a sample of each theme
 * (`FontColorFields`). The font and the inks are part of the look the wizard's creation and the
 * Marca tab's save keep (`useBrandLook`, either one's).
 *
 * The sample is a piece of the tenant's screen in the theme the preview shows (`useTenantPreview`,
 * which the colour fields turn: a "Modo escuro" field shows the dark one), as the phone paints it:
 * the theme and that theme's ground tone on the box (tokens.css re-tints it by the ids, as it does
 * the phone's screen), and that theme's inks, the app name's on its line and the titles' on the
 * others (the last VALID ones, `previewColors`), so the inks show below `xl` too. Its label says
 * which theme it is. Its lines are `FontSampleLine`s, as are those of the inks' samples, so the
 * same line reads the same in every sample.
 *
 * The search, the kinds and the list stay CLOSED until "Editar" (a disclosure: `aria-expanded`,
 * `aria-controls`, the label turning into "Concluir" while open, and an accessible name that starts
 * with that label and says what it edits), so the card reads as the choice made, not as 1,600
 * options. Closed, the editor is `hidden` (out of the tab order and of the accessibility tree) yet
 * stays mounted, so reopening it keeps the search, the kind, the page and the scroll; the families'
 * letters are fetched only while it is open. It opens right under its line, above the inks.
 *
 * Native radios, so the list is one keyboard stop with arrow keys: each radio sits in its row
 * (`relative`), so it scrolls and clips with the list and the focus never leaves it. The default
 * heads the list whenever the search is empty; the chosen family is pinned under it when the page
 * size leaves it out. "Mostrar mais fontes" hands the focus to the first new family, the result count
 * is announced once the typing pauses, and a new search or kind starts the list from the top. No
 * switch (the step's seven switches are the modules) and no submit button (the step's only one is
 * "Continuar"); Enter in the search never submits the step.
 */
export function TitleFontPicker() {
  const t = useTranslations();
  const { draft, update, logo, previewColors } = useBrandLook();
  const { theme } = useTenantPreview();
  const editorId = useId();
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<readonly GoogleFont[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [focusFamily, setFocusFamily] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const chosen = draft.titleFont;
  const stack = useTitleFont(chosen);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadGoogleFonts().then(
      (list) => {
        if (live) setFonts(list.filter(([family]) => family !== DEFAULT_TITLE_FONT));
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  // A family the catalogue no longer has (a draft from before a refresh) falls back to the default.
  useEffect(() => {
    if (fonts && chosen && !fonts.some(([family]) => family === chosen)) {
      update({ titleFont: null });
    }
  }, [fonts, chosen, update]);

  const matches = useMemo(
    () => (fonts ? filterFonts(fonts, query, category) : []),
    [fonts, query, category],
  );
  const visible = useMemo(() => matches.slice(0, limit), [matches, limit]);
  const showDefault = !query.trim() || filterFonts([DEFAULT_ENTRY], query, 'all').length > 0;
  const chosenEntry = useMemo(
    () => (fonts && chosen ? (fonts.find(([family]) => family === chosen) ?? null) : null),
    [fonts, chosen],
  );
  const pinned =
    chosenEntry && !visible.includes(chosenEntry) && matches.includes(chosenEntry)
      ? chosenEntry
      : null;

  // The rendered families in their own letters, while the editor is open (closed, no family shows);
  // again when the browser is back online.
  useEffect(() => {
    if (!open) return;
    const rendered = pinned ? [pinned, ...visible] : visible;
    loadFontSamples(rendered);
    const again = () => loadFontSamples(rendered);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [open, visible, pinned]);

  // "Mostrar mais fontes" moves the focus to the first family it revealed (the button may be gone).
  useEffect(() => {
    if (!focusFamily) return;
    listRef.current
      ?.querySelector<HTMLInputElement>(`[data-font-option="${focusFamily}"] input`)
      ?.focus();
    setFocusFamily(null);
  }, [focusFamily]);

  // The result count reaches screen readers once the typing pauses, never once per keystroke, and
  // only after the person changed the list.
  useEffect(() => {
    if (!touched || !fonts) return;
    const timer = window.setTimeout(() => {
      setAnnouncement(
        matches.length > visible.length
          ? t('platform.wizard.brand.font.announcePage', {
              shown: visible.length,
              count: matches.length,
            })
          : t('platform.wizard.brand.font.announceAll', { count: matches.length }),
      );
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [touched, fonts, matches.length, visible.length, t]);

  const restart = () => {
    setLimit(PAGE);
    setTouched(true);
    listRef.current?.scrollTo({ top: 0 });
  };
  const search = (value: string) => {
    setQuery(value);
    restart();
  };
  const narrow = (value: FontCategory | 'all') => {
    setCategory(value);
    restart();
  };
  const showMore = () => {
    setFocusFamily(matches[limit]?.[0] ?? null);
    setLimit((n) => n + PAGE);
    setTouched(true);
  };
  const retry = () => {
    setAttempt((n) => n + 1);
    searchRef.current?.focus();
  };
  const keepEnterInSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.preventDefault();
  };

  const tenant = draft.displayName.trim() || t('platformBranding.preview.namePlaceholder');
  const kindOf = (kind: FontCategory) => t(`platform.wizard.brand.font.categories.${kind}`);
  // The sample's lines take, when the tenant picked one, the ink of the theme the preview shows (a
  // valid hex: `previewColors` never holds a half-typed one).
  const titleInk = previewColors.fontColors.title[theme];
  const appNameInk = previewColors.fontColors.appName[theme];

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6" data-title-font-picker>
      <div className="flex flex-col gap-1">
        <SectionTitle variant="group">{t('platform.wizard.brand.font.title')}</SectionTitle>
        <p className="text-xs text-text-tertiary">{t('platform.wizard.brand.font.body')}</p>
      </div>

      {/* The tenant's screen in the preview's theme: its tone and its inks (see the docblock). */}
      <div
        data-font-sample
        data-theme={theme}
        data-bg-tone={draft.lightTone ?? undefined}
        data-dark-tone={previewColors.darkColors.tone ?? undefined}
        className="grid gap-4 rounded-xl bg-bg p-4 text-text sm:grid-cols-2"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary sm:col-span-2">
          {theme === 'dark'
            ? t('platform.wizard.brand.font.sampleDark')
            : t('platform.wizard.brand.font.sampleLight')}
        </p>
        <div className="flex min-w-0 flex-col gap-2">
          {/* The app name as the top bar draws it, which it does only without a logo. */}
          {logo ? null : (
            <FontSampleLine data-font-sample-app-name kind="appName" stack={stack} ink={appNameInk}>
              {tenant}
            </FontSampleLine>
          )}
          <FontSampleLine data-font-sample-title kind="title" stack={stack} ink={titleInk}>
            {t('communities.list.title')}
          </FontSampleLine>
          <FontSampleLine data-font-sample-title kind="communityName" stack={stack} ink={titleInk}>
            {t('platform.devicePreview.sample.communityOne')}
          </FontSampleLine>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FontSampleLine data-font-sample-title kind="title" stack={stack} ink={titleInk}>
            {t('events.list.title')}
          </FontSampleLine>
          <FontSampleLine data-font-sample-title kind="eventName" stack={stack} ink={titleInk}>
            {t('platform.devicePreview.sample.eventTitle')}
          </FontSampleLine>
          <p className="text-sm text-text-secondary">
            {t('platform.wizard.brand.font.sampleRest')}
          </p>
        </div>
      </div>

      <div
        data-font-chosen
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border px-4 py-3"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-text-tertiary">
            {t('platform.wizard.brand.font.chosen')}
          </span>
          <span style={titleFontStyle(stack)} className="truncate text-base font-bold text-text">
            {chosen ?? t('platform.wizard.brand.font.default', { font: DEFAULT_TITLE_FONT })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chosen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => update({ titleFont: null })}
            >
              {t('platform.wizard.brand.font.reset')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-font-edit
            aria-expanded={open}
            aria-controls={editorId}
            // Starts with the visible label (WCAG 2.5.3) and says what it edits.
            aria-label={
              open
                ? t('platform.wizard.brand.font.doneName')
                : t('platform.wizard.brand.font.editName')
            }
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <Check aria-hidden size={14} /> : <Pencil aria-hidden size={14} />}
            {open ? t('platform.wizard.brand.font.done') : t('platform.wizard.brand.font.edit')}
          </Button>
        </div>
      </div>

      <div id={editorId} data-font-editor hidden={!open} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <Input
            ref={searchRef}
            id="titleFontSearch"
            type="search"
            icon={Search}
            label={t('platform.wizard.brand.font.searchLabel')}
            placeholder={t('platform.wizard.brand.font.searchPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={keepEnterInSearch}
          />
          <fieldset className="flex min-w-0 flex-wrap gap-2">
            <legend className="sr-only">{t('platform.wizard.brand.font.categoriesLabel')}</legend>
            {(['all', ...FONT_CATEGORIES] as const).map((value) => (
              <Chip key={value} active={category === value} onClick={() => narrow(value)}>
                {t(`platform.wizard.brand.font.categories.${value}`)}
              </Chip>
            ))}
          </fieldset>
        </div>

        {failed ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-sm text-danger">{t('platform.wizard.brand.font.loadFailed')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={retry}>
              {t('platform.wizard.brand.font.retry')}
            </Button>
          </div>
        ) : fonts === null ? (
          <p role="status" className="text-sm text-text-tertiary">
            {t('platform.wizard.brand.font.loading')}
          </p>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">{t('platform.wizard.brand.font.listLabel')}</legend>
            <p className="text-xs text-text-tertiary">
              {t('platform.wizard.brand.font.count', { count: matches.length })}
            </p>
            <div
              ref={listRef}
              data-font-list
              className="max-h-80 overflow-y-auto overscroll-contain rounded-xl border border-border"
            >
              {showDefault ? (
                <FontOption
                  family={DEFAULT_TITLE_FONT}
                  kind={t('platform.wizard.brand.font.defaultKind')}
                  checked={chosen === null}
                  onPick={() => update({ titleFont: null })}
                  isDefault
                />
              ) : null}
              {pinned ? (
                <FontOption
                  family={pinned[0]}
                  kind={kindOf(pinned[1])}
                  checked
                  onPick={() => update({ titleFont: pinned[0] })}
                />
              ) : null}
              {visible.map(([family, kind]) => (
                <FontOption
                  key={family}
                  family={family}
                  kind={kindOf(kind)}
                  checked={chosen === family}
                  onPick={() => update({ titleFont: family })}
                />
              ))}
              {!showDefault && !pinned && visible.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-tertiary">
                  {t('platform.wizard.brand.font.empty')}
                </p>
              ) : null}
              {matches.length > visible.length ? (
                <div className="border-t border-divider p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={showMore}
                  >
                    {t('platform.wizard.brand.font.more')}
                  </Button>
                </div>
              ) : null}
            </div>
          </fieldset>
        )}
      </div>

      {/* The inks after the font's line and its editor, so the line sits right under the sample. */}
      <div className="border-t border-divider pt-4">
        <FontColorFields />
      </div>

      {/* Outside the editor, so a count that lands as it closes is still read. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}

function FontOption({
  family,
  kind,
  checked,
  onPick,
  isDefault = false,
}: {
  family: string;
  /** The category, or "Padrão" for the default. */
  kind: string;
  checked: boolean;
  onPick: () => void;
  isDefault?: boolean;
}) {
  return (
    <label
      data-font-option={isDefault ? '' : family}
      className={cn(
        // `relative`: the sr-only radio is positioned in its row, so it scrolls and clips with the
        // list (and focusing it scrolls the list, never the page).
        'relative flex min-h-12 cursor-pointer items-center gap-3 border-b border-divider px-4 py-2 last:border-0',
        'hover:bg-bg-hover has-[:focus-visible]:bg-bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-inset',
        checked && 'bg-bg-active',
      )}
    >
      <input
        type="radio"
        name="titleFont"
        value={isDefault ? '' : family}
        checked={checked}
        onChange={onPick}
        className="sr-only"
      />
      {/* The default is the app's own Manrope; every other family shows in its own letters. */}
      <span
        style={isDefault ? undefined : { fontFamily: titleFontStack(family) }}
        className="min-w-0 flex-1 truncate text-lg text-text"
      >
        {family}
      </span>
      <span className="shrink-0 text-xs text-text-tertiary">{kind}</span>
      <Check
        aria-hidden
        size={18}
        className={cn('shrink-0 text-brand', checked ? 'opacity-100' : 'opacity-0')}
      />
    </label>
  );
}
