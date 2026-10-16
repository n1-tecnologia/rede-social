import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ExclusiveBadge, type ProductChoiceItem } from '@rede-social/module-store/ui';
import { buttonClasses, Card, chipBase, cn, StatusPill } from '@rede-social/ui';
import { ChevronRight, Lock, Radio } from 'lucide-react';
import type { HomeLiveView } from '@/lib/courses-member-view';
import { HomeLiveChoice } from './HomeLiveChoice';
import { CoverGradient, HomeSectionHeader } from './HomeShelf';
import { ReminderToggle } from './ReminderToggle';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The `outline` `fullWidth` links of the locked body (A-UI-8): the hero keeps Início's one fill. */
const OUTLINE_LINK = buttonClasses({ variant: 'outline', size: 'md', fullWidth: true });

/**
 * What the next live's body shows under its cover (UI-D-452), decided by the host from the overview
 * and, for a locked live only, the store's access read:
 *  - `reminder` → the `ReminderToggle` (open live; disabled with its hint in the admin preview);
 *  - `buyOne` → the outline LINK "Comprar para liberar" to `/loja/{productId}?live={liveId}`;
 *  - `buyMany` → the outline BUTTON opening the shipped `ProductChoiceSheet`;
 *  - `notForSale` → "Esta live não está à venda no momento." 14/400 secondary;
 *  - `seeLive` → the store read failed: the outline "Ver a live" to the live page (08.5 variant (d)).
 */
export type HomeLiveBody =
  | { kind: 'reminder'; initialOn: boolean; preview: boolean }
  | { kind: 'buyOne'; href: string; label: string }
  | { kind: 'buyMany'; label: string; title: string; helper: string; choices: ProductChoiceItem[] }
  | { kind: 'notForSale'; text: string }
  | { kind: 'seeLive'; href: string; label: string };

/**
 * Início's live (08.6-11, D-444, D-446, UI-D-452, COURSE-32): the live the SERVER chose, as one of
 * two slots the host places by `view.kind`.
 *
 * **(a) Live now** (slot 3, right under the hero): no section title — the pill says it. One link to
 * the live page in a `Card mx-4`: the neutral `StatusPill` with `Radio` 12 "Ao vivo agora", the title
 * (`line-clamp-1`) and "Começou às {time} · {duration} min" (or `Lock` 12 + "Live exclusiva ·
 * Começou às {time}"), and the trailing `ChevronRight` 18. No red, no pulse, **no join link** (only
 * the live page hands the room out inside its window, T-08.6-18) and **no reminder** (a started live
 * refuses it, COURSE-40).
 *
 * **(b) Próxima live** (slot 6): `SectionTitle` "Próxima live", then a `Card mx-4 p-0`: the 16:10
 * cover as ONE link to the live page (gradient without a cover or when it fails; the
 * `from-black/85 via-black/30` veil), the relative-day pill (decided in the RSC from `serverNow`,
 * UI-D-288) followed by "Exclusiva" when locked — the stack wraps inside the cover —, then the
 * when-line 12/700 uppercase and the title 16/700 white `line-clamp-2`. The body is a SIBLING
 * `<div class="p-4">`, never inside the anchor.
 *
 * Every word arrives finished (`homeLiveView`, the host's body) and renders as React text. Nothing
 * here reads a clock or names a room link.
 */
export function HomeLive({
  view,
  sectionTitle,
  body,
}: {
  view: HomeLiveView;
  /** "Próxima live" — the `next` card's section title. */
  sectionTitle: string;
  /** The `next` card's body; ignored by the live-now row. */
  body: HomeLiveBody | null;
}) {
  if (view.kind === 'now') {
    return (
      <Card className="mx-4 p-0">
        <a
          href={view.href}
          data-testid="courses-home-live-now"
          className={`flex min-h-14 items-center gap-3 p-3 transition-opacity active:opacity-80 ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`}
        >
          <StatusPill tone="neutral" className="shrink-0">
            <Radio aria-hidden size={12} className="shrink-0" />
            {view.pill}
          </StatusPill>
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              data-testid="courses-home-live-now-title"
              className="line-clamp-1 break-words text-sm font-bold text-text"
            >
              {view.title}
            </span>
            <span
              data-testid="courses-home-live-now-meta"
              className="mt-0.5 flex items-center gap-1 text-xs font-normal text-text-tertiary tabular-nums"
            >
              {view.locked ? <Lock aria-hidden size={12} className="shrink-0" /> : null}
              <span className="min-w-0 truncate">{view.meta}</span>
            </span>
          </span>
          <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
        </a>
      </Card>
    );
  }

  return (
    <section data-testid="courses-home-next-live" data-live-id={view.id} className="flex flex-col">
      <HomeSectionHeader id="courses-home-next-live-title" title={sectionTitle} />
      <Card className="mx-4 p-0">
        <a
          href={view.href}
          data-testid="courses-home-next-live-cover"
          className={`relative block aspect-[16/10] w-full bg-bg-tertiary transition-opacity active:opacity-80 ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`}
        >
          {view.coverAssetId ? (
            <MediaImage
              assetId={view.coverAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt=""
              sizes="(min-width: 680px) 648px, 100vw"
              ratio=""
              className="absolute inset-0 h-full w-full"
              fallback={<CoverGradient />}
            />
          ) : (
            <CoverGradient />
          )}
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
          />
          <span
            data-testid="courses-home-next-live-pills"
            className="absolute top-3 right-3 left-3 flex flex-wrap items-start gap-1"
          >
            <span
              data-testid="courses-home-next-live-day"
              className={cn(chipBase, 'bg-black/60 text-white tabular-nums backdrop-blur-sm')}
            >
              {view.pill}
            </span>
            {view.exclusiveLabel ? <ExclusiveBadge label={view.exclusiveLabel} /> : null}
          </span>
          <span className="absolute right-4 bottom-3 left-4 flex flex-col">
            <span
              data-testid="courses-home-next-live-when"
              className="text-xs font-bold uppercase tracking-wider text-white/80 tabular-nums [overflow-wrap:anywhere]"
            >
              {view.whenLine}
            </span>
            <span
              data-testid="courses-home-next-live-title"
              className="mt-1 line-clamp-2 text-base font-bold leading-tight text-white [overflow-wrap:anywhere]"
            >
              {view.title}
            </span>
          </span>
        </a>
        {body ? (
          <div data-testid="courses-home-next-live-body" data-body={body.kind} className="p-4">
            <NextLiveBody liveId={view.id} liveTitle={view.title} body={body} />
          </div>
        ) : null}
      </Card>
    </section>
  );
}

function NextLiveBody({
  liveId,
  liveTitle,
  body,
}: {
  liveId: string;
  liveTitle: string;
  body: HomeLiveBody;
}) {
  switch (body.kind) {
    case 'reminder':
      // Keyed on the server's state, so a refresh that brings a new `initialOn` remounts it.
      return (
        <ReminderToggle
          key={`${liveId}:${body.initialOn}:${body.preview}`}
          liveId={liveId}
          liveTitle={liveTitle}
          initialOn={body.initialOn}
          preview={body.preview}
        />
      );
    case 'buyOne':
      return (
        <a href={body.href} data-testid="courses-home-live-buy" className={OUTLINE_LINK}>
          <Lock aria-hidden size={16} className="shrink-0" />
          {body.label}
        </a>
      );
    case 'buyMany':
      return (
        <HomeLiveChoice
          label={body.label}
          title={body.title}
          helper={body.helper}
          choices={body.choices}
        />
      );
    case 'notForSale':
      return (
        <p
          data-testid="courses-home-live-unavailable"
          className="text-sm font-normal text-text-secondary"
        >
          {body.text}
        </p>
      );
    case 'seeLive':
      return (
        <a href={body.href} data-testid="courses-home-live-see" className={OUTLINE_LINK}>
          {body.label}
        </a>
      );
  }
}
