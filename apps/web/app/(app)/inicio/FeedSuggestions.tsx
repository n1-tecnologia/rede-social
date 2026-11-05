import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { cn, MemberSkin, SkinAmbient } from '@rede-social/ui';
import { ArrowUpRight, BookOpen, Users } from 'lucide-react';
import { Fragment } from 'react';
import { riseStyle } from '@/app/(app)/cursos/rise';
import type { FeedSuggestionsView, FeedSuggestionTile } from '@/lib/feed-suggestions-view';

const TITLE_ID = 'feed-suggestions-title';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The tile's picture: the course's or the community's cover in a rounded square, over the kind's
 * glyph on the brand tint (the bento's disc), which is all a tile without a cover shows and what a
 * cover that fails to load leaves behind.
 */
function SuggestionThumb({ tile, big }: { tile: FeedSuggestionTile; big: boolean }) {
  const Glyph = tile.kind === 'course' ? BookOpen : Users;
  const widths =
    tile.coverWidths && tile.coverWidths.length > 0 ? tile.coverWidths : PURPOSE_WIDTHS.cover;
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden bg-brand/12 text-brand ring-1 ring-brand/20',
        big ? 'h-14 w-14 rounded-2xl' : 'h-10 w-10 rounded-xl',
      )}
    >
      <Glyph size={big ? 22 : 16} />
      {tile.coverAssetId ? (
        <MediaImage
          assetId={tile.coverAssetId}
          widths={widths}
          alt=""
          sizes={big ? '56px' : '40px'}
          ratio=""
          className="absolute inset-0 h-full w-full"
          // A failed cover leaves the tint and the glyph under it.
          fallback={<></>}
        />
      ) : null}
    </span>
  );
}

/**
 * One tile, the member Início's "Mais de" bento tile: the picture and "↗" on top, then the kind,
 * the name and one line at the foot. The large one adds the brand's ambient light, the member's
 * share of a course in progress and the "Continuar ↗" / "Acessar ↗" pill.
 */
function SuggestionTile({ tile, big }: { tile: FeedSuggestionTile; big: boolean }) {
  return (
    <a
      href={tile.href}
      data-testid="feed-suggestion"
      data-kind={tile.kind}
      className={cn(
        'ms-card ms-panel group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors active:opacity-90',
        big ? 'min-h-[208px] p-5' : 'min-h-[148px] p-4',
        FOCUS,
      )}
    >
      {big ? <SkinAmbient /> : null}
      <span className="relative flex items-start justify-between gap-2">
        <SuggestionThumb tile={tile} big={big} />
        <ArrowUpRight
          aria-hidden
          size={16}
          className="shrink-0 text-text-tertiary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-text motion-reduce:transition-none"
        />
      </span>
      <span className="relative mt-auto flex min-w-0 flex-col pt-3">
        <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
          {tile.eyebrow}
        </span>
        <span
          data-testid="feed-suggestion-title"
          className={cn(
            'ms-title-font mt-1 line-clamp-2 break-words font-medium leading-tight tracking-tight text-text',
            big ? 'text-xl' : 'text-[15px]',
          )}
        >
          {tile.title}
        </span>
        <span className="mt-1 truncate text-xs font-normal text-text-secondary">{tile.line}</span>
        {big && tile.percent !== null ? (
          // The line above already says it ("3 de 10 aulas"): the bar is only its picture.
          <span aria-hidden className="mt-3 block h-1 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${tile.percent}%` }}
            />
          </span>
        ) : null}
        {big ? (
          <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full bg-brand/12 px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-brand/25">
            {tile.cta}
            <ArrowUpRight aria-hidden size={13} className="shrink-0" />
          </span>
        ) : null}
      </span>
    </a>
  );
}

/**
 * The feed's suggestions column (2026-10-26, the product owner: "ao lado direito do feed uma área
 * destinada a sugestões com cards de cursos e comunidades para o user acessar rápido", a small grid
 * laid out as the member Início's "Mais de" bento, in the room Instagram gives its suggestions).
 * From `xl` only, beside the feed and pinned while it scrolls: the large tile on top, the others two
 * a row under it (a last one alone takes the row), then the way to every course and community.
 * The tiles wear the member skin (`MemberSkin` without its page ground), the look of that bento.
 * Only links: every word and number arrives from `feedSuggestionsView`.
 */
export function FeedSuggestions({ view }: { view: FeedSuggestionsView }) {
  const lastAlone = view.tiles.length > 1 && (view.tiles.length - 1) % 2 === 1;
  return (
    <aside
      aria-labelledby={TITLE_ID}
      data-testid="feed-suggestions"
      className="hidden w-80 shrink-0 xl:sticky xl:top-0 xl:block xl:self-start"
    >
      <MemberSkin backdrop={false}>
        <h2 id={TITLE_ID} className="pb-3 text-sm font-semibold text-text">
          {view.title}
        </h2>
        <ul aria-labelledby={TITLE_ID} className="grid grid-cols-2 gap-3">
          {view.tiles.map((tile, index) => (
            <li
              key={tile.key}
              style={riseStyle(index)}
              className={cn(
                'ms-rise min-w-0',
                (index === 0 || (lastAlone && index === view.tiles.length - 1)) && 'col-span-2',
              )}
            >
              <SuggestionTile tile={tile} big={index === 0} />
            </li>
          ))}
        </ul>
        {view.links.length > 0 ? (
          <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-text-tertiary">
            {view.links.map((link, index) => (
              <Fragment key={link.href}>
                {index > 0 ? <span aria-hidden>·</span> : null}
                <a
                  href={link.href}
                  data-testid="feed-suggestions-link"
                  className={cn('rounded-sm hover:text-text hover:underline', FOCUS)}
                >
                  {link.label}
                </a>
              </Fragment>
            ))}
          </p>
        ) : null}
      </MemberSkin>
    </aside>
  );
}
