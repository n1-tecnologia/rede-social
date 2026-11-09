import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { LiveStatusChip, MEDIA_CHIP_LG, MEMBER_CARD } from '@rede-social/module-courses/ui';
import { ExclusiveBadge, type ProductChoiceItem } from '@rede-social/module-store/ui';
import { buttonClasses, Card, cn, SkinTileFx } from '@rede-social/ui';
import { ChevronRight, Lock } from 'lucide-react';
import type { HomeLiveView } from '@/lib/courses-member-view';
import { HomeLiveChoice } from './HomeLiveChoice';
import { CoverGradient, MemberSectionHeader } from './MemberSection';
import { ReminderToggle } from './ReminderToggle';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The cover's width: half the wide row beside the track, or the whole row alone. */
const HALF_SIZES = '(min-width: 1024px) 620px, (min-width: 768px) calc(100vw - 320px), 100vw';
const WIDE_SIZES = '(min-width: 1280px) 1232px, (min-width: 768px) calc(100vw - 320px), 100vw';

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
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).**
 *
 * **(a) Live now** (right under the hero): no section title — the chip says it. One link to the live
 * page in an outlined card: the prototype's red "Ao vivo" chip with the breathing dot
 * (`LiveStatusChip`, CSS motion, still under "reduzir movimento") over the title and "Começou às
 * {time} · {duration} min" (or `Lock` + "Live exclusiva · Começou às {time}"), so the title keeps the
 * row's width at 320px, and the trailing chevron. **No
 * join link** (only the live page hands the room out inside its window, T-08.6-18) and **no reminder**
 * (a started live refuses it, COURSE-40).
 *
 * **(b) Próxima live**: the 17/800 "Próxima live", then the prototype's spotlight: the 16:10 cover as
 * ONE link to the live page (`rounded-t-2xl`, the gradient without a cover or when it fails, the
 * veil from the foot), the relative-day glass chip (decided in the RSC from `serverNow`, UI-D-288)
 * followed by "Exclusiva" when locked, then the when-line 11px uppercase and the title 18/800 white.
 * The body is a SIBLING `<div class="p-4">` in the same outlined card, never inside the anchor.
 *
 * Every word arrives finished (`homeLiveView`, the host's body) and renders as React text. Nothing
 * here reads a clock or names a room link.
 *
 * 2026-10-23 (the wide desktop): Início sets "Próxima live" beside "Sua trilha" from `lg`, half the
 * row each; alone (`panoramic`) its cover flattens across the row (3:1 since 2026-10-26, the
 * rethought Início's banner, where it is always alone).
 *
 * 2026-10-23 (the product owner's call: "ativar lembrete deve estar dentro do card"): the reminder
 * body sits INSIDE the card, over the foot of the cover — the glass toggle and its helper in one row
 * (`ReminderToggle` `appearance="onArt"`), the when-line and the title lifted above it. It is still
 * the cover link's SIBLING (absolutely placed in the card), never inside the anchor. The other bodies
 * (buy, not for sale, see the live) stay under the cover as before.
 */
export function HomeLive({
  view,
  sectionTitle,
  body,
  panoramic = false,
}: {
  view: HomeLiveView;
  /** "Próxima live" — the `next` card's section title. */
  sectionTitle: string;
  /** The `next` card's body; ignored by the live-now row. */
  body: HomeLiveBody | null;
  /** The next live alone across the wide row (no track beside it): a flatter cover from `lg`. */
  panoramic?: boolean;
}) {
  if (view.kind === 'now') {
    return (
      <div className="px-4">
        <Card className={cn(MEMBER_CARD, 'border-danger/30 p-0')}>
          <a
            href={view.href}
            data-testid="courses-home-live-now"
            className={`ms-card ms-static group flex min-h-16 items-center gap-3 rounded-[inherit] p-3 transition-colors hover:bg-bg-hover ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`}
          >
            <span className="flex min-w-0 flex-1 flex-col items-start">
              <LiveStatusChip label={view.pill} icon="live" />
              <span
                data-testid="courses-home-live-now-title"
                className="mt-1.5 line-clamp-1 break-words text-sm font-bold text-text"
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
            <ChevronRight
              aria-hidden
              size={18}
              className="shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </a>
        </Card>
      </div>
    );
  }

  // The reminder rides over the cover; every other body stays under it.
  const onArt = body?.kind === 'reminder';

  return (
    <section data-testid="courses-home-next-live" data-live-id={view.id} className="flex flex-col">
      <MemberSectionHeader id="courses-home-next-live-title" title={sectionTitle} />
      {/* Beside the track (2026-10-24) the card fills the row's height and its cover takes the
          track's 16:9, so both are one size. */}
      <div className={cn('px-4', !panoramic && 'lg:flex lg:flex-1 lg:flex-col')}>
        <Card
          className={cn(
            MEMBER_CARD,
            // The member skin's glass (2026-10-26): a static panel, since the buy sheet renders
            // inside it; only the cover link lights up, and nothing here moves or isolates.
            'ms-panel relative overflow-hidden rounded-2xl p-0',
            !panoramic && 'lg:flex lg:flex-1 lg:flex-col',
          )}
        >
          <a
            href={view.href}
            data-testid="courses-home-next-live-cover"
            className={cn(
              'ms-card ms-static relative block aspect-[16/10] w-full bg-bg-tertiary transition-opacity active:opacity-90',
              FOCUS,
              'focus-visible:ring-inset focus-visible:ring-offset-0',
              panoramic ? 'lg:aspect-[3/1] 2xl:aspect-[4/1]' : 'lg:aspect-video lg:flex-1',
            )}
          >
            {view.coverAssetId ? (
              <MediaImage
                assetId={view.coverAssetId}
                widths={PURPOSE_WIDTHS.cover}
                alt=""
                sizes={panoramic ? WIDE_SIZES : HALF_SIZES}
                ratio=""
                className="ms-zoom absolute inset-0 h-full w-full"
                fallback={<CoverGradient />}
              />
            ) : (
              <CoverGradient />
            )}
            <SkinTileFx />
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
            />
            <span
              data-testid="courses-home-next-live-pills"
              className="absolute top-3 right-3 left-3 flex flex-wrap items-start gap-1.5"
            >
              <span
                data-testid="courses-home-next-live-day"
                className={cn(MEDIA_CHIP_LG, 'tabular-nums')}
              >
                {view.pill}
              </span>
              {view.exclusiveLabel ? (
                <ExclusiveBadge label={view.exclusiveLabel} size="compact" />
              ) : null}
            </span>
            <span
              className={cn(
                'absolute right-4 left-4 flex flex-col',
                onArt ? 'bottom-[4.25rem]' : 'bottom-3.5',
              )}
            >
              <span
                data-testid="courses-home-next-live-when"
                className="text-[11px] font-bold uppercase tracking-wider text-white/80 tabular-nums [overflow-wrap:anywhere]"
              >
                {view.whenLine}
              </span>
              <span
                data-testid="courses-home-next-live-title"
                className="mt-0.5 line-clamp-2 text-lg font-extrabold leading-snug text-white [overflow-wrap:anywhere]"
              >
                {view.title}
              </span>
            </span>
          </a>
          {body ? (
            <div
              data-testid="courses-home-next-live-body"
              data-body={body.kind}
              className={onArt ? 'absolute inset-x-0 bottom-0 px-4 pb-3.5' : 'p-4'}
            >
              <NextLiveBody liveId={view.id} liveTitle={view.title} body={body} onArt={onArt} />
            </div>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

function NextLiveBody({
  liveId,
  liveTitle,
  body,
  onArt = false,
}: {
  liveId: string;
  liveTitle: string;
  body: HomeLiveBody;
  /** The reminder over the cover (`ReminderToggle` `onArt`). */
  onArt?: boolean;
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
          appearance={onArt ? 'onArt' : 'default'}
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
