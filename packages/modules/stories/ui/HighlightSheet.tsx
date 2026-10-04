'use client';

import { MediaImage } from '@rede-social/core/ui';
import { BottomSheet, Switch } from '@rede-social/ui';
import { Check, Plus } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { HighlightTitleStep } from './HighlightTitleStep';
import { StoryMonogram } from './StoryCircle';

/**
 * D-110 — **ONE highlight component, three routes.** The viewer's "Destacar" (route 1), the
 * "Seus stories" row menu (route 2) and the composer's "Destaque" row (route 3) all draw
 * `HighlightSheet`; plan 09's "Adicionar stories" step draws the `HighlightMembershipList` toggle
 * machine it is built on, with story rows instead of highlight rows (UI-D-76). None of them forks
 * it: a second copy would drift on the revert rule or the in-flight rule the first time either
 * changed, and those two rules are what keep a switch honest.
 *
 * Two modes over one `BottomSheet`:
 *
 * - **`checklist`** (UI-D-67): rows grouped by PLACE — the host passes Início first, then every
 *   ACTIVE community with at least one highlight, in the communities list order — each group under
 *   a plain 12/700 tertiary label (never `SectionTitle`: no brand ink on a repeated header). A row is
 *   the 44px shell with a 32px round cover (or the 32px monogram), the title, and a trailing
 *   `Switch`. **Every toggle is its own immediate write**; there is no Save button and no inline
 *   creation, because curation has one door (D-109).
 * - **`single`** (UI-D-68): one choice. The origin community's group first (with its "Novo
 *   destaque" row, so a highlight-less origin puts creation first, D-112), then "Nenhum", then
 *   Início, then every other community the host passes — including ones with zero highlights — each
 *   ending with its own "Novo destaque". **Confirming a new title CREATES NOTHING**: it selects a
 *   pending `{ communityId, title }` and closes; the write happens inside the publish (D-114).
 *
 * **THE COMPONENT MAKES NO REQUEST OF ITS OWN**, and ships no words (PWA-03, MOD-02). Every sentence
 * arrives as a prop or a function, and every write is the host's `onToggle` / `onSelect`. That is
 * what lets the viewer pass `revalidate: false` and "Seus stories" pass `true` through the same
 * sheet (05.2-06 planning decision 2).
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX"** — UI-D-41's pin-sheet invariants, carried verbatim in
 * intent into the machine below:
 *
 * 1. **A failed toggle REVERTS IN PLACE and the ROW STAYS.** The commonest cause is a community
 *    archived between render and tap; removing the row mid-gesture would be a worse answer than the
 *    failure. There is no inline message and the sheet does not dismiss — the host fires the toast
 *    (generic, `archived` or `full`) and the curator retries in place.
 * 2. **A second toggle on a row while its first is in flight is a NO-OP** — not a queue, not a
 *    cancel. Two crossing writes for one row can settle in either order, and the loser would leave
 *    the switch describing a state the server does not hold.
 * 3. **The EMPTY case is the host's node.** "Nenhum destaque ainda." plus a link to CREATE one are
 *    words and a route this module owns neither of.
 *
 * Plus the re-seed rule: **the switches re-seed when the target story changes while the sheet
 * stays mounted** (the defect `stories.spec.ts` once caught on the pin sheet). And E09 loading:
 * `selectedIds === null` renders every switch DISABLED at its real row geometry, so no switch ever
 * shows a wrong state while the memberships are being read.
 */

/* ── The toggle machine ──────────────────────────────────────────────────────────────────────── */

export interface HighlightMembershipRow {
  id: string;
  /** The row's leading visual — a 32px round cover here, a 32×48 story thumb in plan 09. */
  leading: ReactNode;
  title: string;
  /** An optional 12/400 line under the title (plan 09's caption line). */
  meta?: ReactNode;
}

export interface HighlightMembershipListProps {
  rows: readonly HighlightMembershipRow[];
  /** The ids currently ON. `null` while the host is still reading them (E09 loading). */
  selectedIds: readonly string[] | null;
  /** ONE toggle, ONE request. Resolves `true` when it landed and `false` to REVERT. */
  onToggle: (id: string, next: boolean) => Promise<boolean>;
  /** The switch's accessible name. A function: only the host has the words. */
  rowLabel: (row: HighlightMembershipRow) => string;
}

export function HighlightMembershipList({
  rows,
  selectedIds,
  onToggle,
  rowLabel,
}: HighlightMembershipListProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(selectedIds ?? []));

  /**
   * **RE-SEED WHEN THE TARGET CHANGES.** Adjusting state during render is React's documented
   * alternative to an effect, and it keeps the switches and the prop in lockstep with no paint of
   * the previous story's state. The IDENTITY of `selectedIds` is the signal: the host hands a fresh
   * array with every target (and `null` → array when the read lands).
   */
  const [seed, setSeed] = useState(selectedIds);
  /**
   * Bumped on every re-seed, so a write that was in flight for the PREVIOUS target cannot revert a
   * switch of the new one when it settles. A ref, not state: nothing renders from it.
   */
  const generation = useRef(0);
  if (seed !== selectedIds) {
    setSeed(selectedIds);
    setSelected(new Set(selectedIds ?? []));
    generation.current += 1;
  }

  /** A REF rather than state: it gates the handler, and nothing renders from it (no double flash). */
  const inFlight = useRef<Set<string>>(new Set());

  const toggle = useCallback(
    (id: string, next: boolean) => {
      // Invariant 2: the second tap of a row whose write has not settled does NOTHING at all.
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      const startedIn = generation.current;

      const apply = (on: boolean) =>
        setSelected((current) => {
          const updated = new Set(current);
          if (on) updated.add(id);
          else updated.delete(id);
          return updated;
        });

      // Optimistic: the control moves now, so a one-row write never shows a spinner.
      apply(next);

      const revert = () => {
        // Invariant 1: revert IN PLACE — the row stays and the sheet stays open. Skipped when the
        // target changed meanwhile: the new seed already describes the new story.
        if (generation.current === startedIn) apply(!next);
      };

      void onToggle(id, next)
        .then((ok) => {
          if (!ok) revert();
        })
        .catch(revert)
        .finally(() => {
          inFlight.current.delete(id);
        });
    },
    [onToggle],
  );

  const loading = selectedIds === null;

  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.id}>
          {/* The row itself is INERT: the `Switch` is a `<button>`, and a switch inside a button is
              invalid HTML with two tab stops (the 05-08 rule). The switch carries the row's name. */}
          <div className="flex min-h-11 items-center gap-3 px-2 py-2">
            <span className="shrink-0">{row.leading}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-normal text-text">{row.title}</span>
              {row.meta ? (
                <span className="block truncate text-xs font-normal text-text-tertiary">
                  {row.meta}
                </span>
              ) : null}
            </span>
            <Switch
              checked={!loading && selected.has(row.id)}
              disabled={loading}
              onChange={(next) => toggle(row.id, next)}
              label={rowLabel(row)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── The sheet ───────────────────────────────────────────────────────────────────────────────── */

/** One highlight as the sheet draws it — the resolved cover (R-D-D), or null for the monogram. */
export interface HighlightSheetRow {
  id: string;
  title: string;
  cover: { assetId: string; variantWidths: readonly number[] } | null;
}

/**
 * One place's group. `key` is the host's stable id for the place (`home`, or the community id) — the
 * value `focusCreateFor` names. `label` is already the host's words ("Início" / the community name).
 */
export interface HighlightSheetPlace {
  key: string;
  label: string;
  communityId: string | null;
  rows: readonly HighlightSheetRow[];
}

/**
 * The single-select value. `pending` is a highlight that does not exist yet (D-114): the composer
 * creates it inside the publish, so the sheet can only ever SELECT it.
 */
export type HighlightSelection =
  | { kind: 'none' }
  | { kind: 'highlight'; highlightId: string }
  | { kind: 'pending'; communityId: string | null; title: string };

/** The title step's words in single mode — `HighlightTitleStep`'s labels, with the place line lazy. */
export interface HighlightSheetTitleStepLabels {
  heading: string;
  /** "Em {place}" from the place's label. */
  placeLine: (place: string) => string;
  label: string;
  placeholder: string;
  helper?: string;
  counter: (count: number, limit: number) => string;
  limit: number;
  submitLabel: string;
  submittingLabel: string;
  backLabel: string;
  emptyError: string;
}

interface HighlightSheetBaseProps {
  open: boolean;
  /**
   * Any identity works: `BottomSheet`'s focus trap reads it through a ref and arms once per
   * opening, so a new callback on every render no longer moves the focus.
   */
  onClose: () => void;
  title: string;
  helper?: string;
  places: readonly HighlightSheetPlace[];
  /** A row's accessible name — "Destacar em {title}, {place}" / "Publicar no destaque …". */
  rowLabel: (row: HighlightSheetRow, place: HighlightSheetPlace) => string;
}

export interface HighlightSheetChecklistProps extends HighlightSheetBaseProps {
  mode: 'checklist';
  /** The story's current memberships; `null` while they are being read (switches disabled). */
  selectedIds: readonly string[] | null;
  /** ONE toggle, ONE request — with the row's place, so the host can choose a revalidation. */
  onToggle: (highlightId: string, next: boolean, place: HighlightSheetPlace) => Promise<boolean>;
  /** Rendered INSIDE the sheet when there is no highlight anywhere. */
  empty: ReactNode;
}

export interface HighlightSheetSingleProps extends HighlightSheetBaseProps {
  mode: 'single';
  selection: HighlightSelection;
  /** The host records the choice; the sheet then closes itself through `onClose`. */
  onSelect: (selection: HighlightSelection) => void;
  /** "Nenhum". */
  noneLabel: string;
  /** "Novo destaque". */
  createLabel: string;
  /** "Selecionado" — the `Check` glyph's accessible name. */
  selectedLabel: string;
  /** The community the composer was opened from (`?comunidade=`): its group comes first. */
  originCommunityId?: string | null;
  titleStep: HighlightSheetTitleStepLabels;
  /** A place `key` whose "Novo destaque" row takes focus when the sheet opens (plan 08's gate). */
  focusCreateFor?: string | null;
}

export type HighlightSheetProps = HighlightSheetChecklistProps | HighlightSheetSingleProps;

/** The group label: plain 12/700 tertiary, one line (community names truncate, E09 long-text). */
function PlaceLabel({ place }: { place: HighlightSheetPlace }) {
  return (
    <p
      data-highlight-sheet-item={`label:${place.key}`}
      className="truncate pt-4 pb-1 text-xs font-bold text-text-tertiary"
    >
      {place.label}
    </p>
  );
}

/** The 32px round thumb: the resolved cover, else the monogram (UI-D-62 at sheet size). */
function HighlightThumb({ row }: { row: HighlightSheetRow }) {
  if (row.cover === null) return <StoryMonogram text={row.title} size={32} />;
  return (
    <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-bg-tertiary">
      <MediaImage
        assetId={row.cover.assetId}
        widths={row.cover.variantWidths}
        alt=""
        sizes="32px"
        ratio=""
        className="h-full w-full"
      />
    </span>
  );
}

export function HighlightSheet(props: HighlightSheetProps) {
  return props.mode === 'checklist' ? <ChecklistSheet {...props} /> : <SingleSheet {...props} />;
}

function ChecklistSheet({
  open,
  onClose,
  title,
  helper,
  places,
  rowLabel,
  selectedIds,
  onToggle,
  empty,
}: HighlightSheetChecklistProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {helper ? <p className="pb-2 text-xs font-normal text-text-tertiary">{helper}</p> : null}
      {places.length === 0
        ? empty
        : places.map((place) => (
            <div key={place.key}>
              <PlaceLabel place={place} />
              <HighlightMembershipList
                rows={place.rows.map((row) => ({
                  id: row.id,
                  title: row.title,
                  leading: <HighlightThumb row={row} />,
                }))}
                selectedIds={selectedIds}
                onToggle={(id, next) => onToggle(id, next, place)}
                rowLabel={(membership) => {
                  const row = place.rows.find((candidate) => candidate.id === membership.id);
                  return row ? rowLabel(row, place) : membership.title;
                }}
              />
            </div>
          ))}
    </BottomSheet>
  );
}

const SELECT_ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

function SelectedMark({ selected, label }: { selected: boolean; label: string }) {
  return (
    <span className="shrink-0">
      {selected ? <Check aria-label={label} role="img" size={20} className="text-brand" /> : null}
    </span>
  );
}

function SingleSheet({
  open,
  onClose,
  title,
  helper,
  places,
  rowLabel,
  selection,
  onSelect,
  noneLabel,
  createLabel,
  selectedLabel,
  originCommunityId = null,
  titleStep,
  focusCreateFor = null,
}: HighlightSheetSingleProps) {
  /** The body step: the list, or the title step for ONE place. It swaps inside the one sheet. */
  const [creatingFor, setCreatingFor] = useState<HighlightSheetPlace | null>(null);
  /** The place whose "Novo destaque" row gets focus back after "Voltar". */
  const returnFocusTo = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A closed sheet always reopens on the list.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setCreatingFor(null);
  }

  const focusCreateRow = useCallback((key: string) => {
    const target = bodyRef.current?.querySelector<HTMLElement>(
      `[data-highlight-sheet-item="create:${CSS.escape(key)}"]`,
    );
    target?.focus({ preventScroll: false });
  }, []);

  // Plan 08's gate: on open, the named place's "Novo destaque" row takes focus. Deferred one frame
  // so it lands AFTER `BottomSheet`'s focus trap has focused the panel's first control.
  useEffect(() => {
    if (!open || focusCreateFor === null) return;
    const frame = requestAnimationFrame(() => focusCreateRow(focusCreateFor));
    return () => cancelAnimationFrame(frame);
  }, [open, focusCreateFor, focusCreateRow]);

  // "Voltar" returns focus to the row the step was opened from.
  useEffect(() => {
    if (creatingFor !== null || returnFocusTo.current === null) return;
    focusCreateRow(returnFocusTo.current);
    returnFocusTo.current = null;
  }, [creatingFor, focusCreateRow]);

  const choose = (next: HighlightSelection) => {
    onSelect(next);
    onClose();
  };

  const origin =
    originCommunityId === null
      ? undefined
      : places.find((place) => place.communityId === originCommunityId);
  const home = places.find((place) => place.communityId === null);
  const others = places.filter((place) => place !== origin && place !== home);

  const group = (place: HighlightSheetPlace) => {
    const pending =
      selection.kind === 'pending' && selection.communityId === place.communityId
        ? selection
        : null;
    return (
      <div key={place.key}>
        <PlaceLabel place={place} />
        <ul className="flex flex-col">
          {place.rows.map((row) => {
            const selected = selection.kind === 'highlight' && selection.highlightId === row.id;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  data-highlight-sheet-item={`row:${row.id}`}
                  aria-label={rowLabel(row, place)}
                  onClick={() => choose({ kind: 'highlight', highlightId: row.id })}
                  className={SELECT_ROW}
                >
                  <HighlightThumb row={row} />
                  <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                    {row.title}
                  </span>
                  <SelectedMark selected={selected} label={selectedLabel} />
                </button>
              </li>
            );
          })}
          {pending ? (
            // The chosen, not-yet-created highlight: shown selected where it will live.
            <li>
              <button
                type="button"
                data-highlight-sheet-item={`pending:${place.key}`}
                onClick={() => choose(pending)}
                className={SELECT_ROW}
              >
                <StoryMonogram text={pending.title} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                  {pending.title}
                </span>
                <SelectedMark selected label={selectedLabel} />
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              data-highlight-sheet-item={`create:${place.key}`}
              onClick={() => setCreatingFor(place)}
              className={SELECT_ROW}
            >
              <span
                aria-hidden
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-dashed border-border-secondary text-text-secondary"
              >
                <Plus size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                {createLabel}
              </span>
            </button>
          </li>
        </ul>
      </div>
    );
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div ref={bodyRef}>
        {creatingFor !== null ? (
          <HighlightTitleStep
            heading={titleStep.heading}
            placeLine={titleStep.placeLine(creatingFor.label)}
            label={titleStep.label}
            placeholder={titleStep.placeholder}
            helper={titleStep.helper}
            counter={titleStep.counter}
            limit={titleStep.limit}
            submitLabel={titleStep.submitLabel}
            submittingLabel={titleStep.submittingLabel}
            backLabel={titleStep.backLabel}
            emptyError={titleStep.emptyError}
            onBack={() => {
              returnFocusTo.current = creatingFor.key;
              setCreatingFor(null);
            }}
            onSubmit={(pendingTitle) => {
              // D-114: nothing is created here — the choice is a PENDING highlight.
              choose({
                kind: 'pending',
                communityId: creatingFor.communityId,
                title: pendingTitle,
              });
              return true;
            }}
          />
        ) : (
          <>
            {helper ? (
              <p className="pb-2 text-xs font-normal text-text-tertiary">{helper}</p>
            ) : null}
            {origin ? group(origin) : null}
            <button
              type="button"
              data-highlight-sheet-item="none"
              aria-label={noneLabel}
              onClick={() => choose({ kind: 'none' })}
              className={`${SELECT_ROW} ${origin ? 'mt-2' : ''}`}
            >
              <span
                aria-hidden
                className="h-8 w-8 shrink-0 rounded-full"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                {noneLabel}
              </span>
              <SelectedMark selected={selection.kind === 'none'} label={selectedLabel} />
            </button>
            {home ? group(home) : null}
            {others.map(group)}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
