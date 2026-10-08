'use client';

import {
  LockedCount,
  LockedPostPlaceholder,
  LockedSection,
  type ProductChoiceItem,
  ProductChoiceSheet,
} from '@rede-social/module-store/ui';
import { Button, EmptyState } from '@rede-social/ui';
import { Newspaper, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { LockedPageView } from '@/lib/store-view';
import { CommunityPosts, type CommunityPostsLockedProps } from './CommunityPosts';

/**
 * The locked variant of `/comunidades/[communityId]` (08.2-09, UI-D-373, UI-D-375, UI-D-376; D-354,
 * D-355, D-356). The page renders it only when the store access read says `locked` for the viewer;
 * staff never get it (the API answers `locked: false` for them).
 *
 * Top to bottom: the shipped header with its tags (built on the server and passed in), the top
 * section when a product is buyable (carrying the `?exclusivo=1` line "A publicação que você
 * abriu…" when the page was reached from a hidden post's link; with no top section that line moves
 * above the count block's body), the hairline, the SAMPLE post read-only, `min(3, N)` static
 * placeholders inside ONE `aria-hidden` wrapper, and the count block when N ≥ 1. There is no
 * highlights row (the page never asked for one) and no paging: the post column mounts neither
 * `InfiniteScroll` nor `PullToRefresh` (P85).
 *
 * **What reaches this component is only what the feed API answered**: the sample's own view and a
 * number. No hidden post, caption, media id or comment is ever in its props, so none can reach the
 * RSC payload or the DOM (T-08.2-39); there is no client-side filtering to get wrong.
 *
 * Client only for the choice sheet's open state. Every string arrives finished from the server
 * (`lockedPageView`), so nothing here formats or translates.
 */
export interface LockedCommunityProps {
  /** The shipped `CommunityHeader` with the "Exclusiva" / "Produto arquivado" pills in its slot. */
  header: ReactNode;
  view: LockedPageView;
  /** `section: 'many'` only: the sheet rows with the host's thumbs. */
  choices: ProductChoiceItem[];
  posts: Omit<CommunityPostsLockedProps, 'locked'>;
  /** The feed's first page could not be read (the shipped community error card). */
  postsError: boolean;
  labels: {
    emptyTitle: string;
    emptyBody: string;
    errorTitle: string;
    errorBody: string;
    errorRetry: string;
  };
  /** The page's own URL, for the error card's retry link. */
  selfHref: string;
}

/** The brand fill as a LINK (the shipped `Button` is a `<button>`, and a product page is a route). */
const BRAND_LINK =
  'inline-flex h-11 w-full items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const OUTLINE_LINK =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function LockedCommunity({
  header,
  view,
  choices,
  posts,
  postsError,
  labels,
  selfHref,
}: LockedCommunityProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const action = (variant: 'brand' | 'outline'): ReactNode => {
    if (view.section === 'one' && view.productHref && view.actionLabel) {
      return (
        <a
          href={view.productHref}
          data-locked-action={variant}
          className={variant === 'brand' ? BRAND_LINK : OUTLINE_LINK}
        >
          {view.actionLabel}
        </a>
      );
    }
    if (view.section === 'many' && view.actionLabel) {
      return (
        <Button
          variant={variant}
          size="md"
          fullWidth={variant === 'brand'}
          data-locked-action={variant}
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        >
          {view.actionLabel}
        </Button>
      );
    }
    return null;
  };

  const hasSection = view.section !== 'none';
  const sample = posts.items;

  let column: ReactNode;
  if (postsError) {
    column = (
      <div className="px-4 md:px-0">
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          title={labels.errorTitle}
          body={labels.errorBody}
          action={
            <a href={selfHref} className={OUTLINE_LINK}>
              {labels.errorRetry}
            </a>
          }
        />
      </div>
    );
  } else if (sample.length === 0) {
    // No posts at all: the shipped community empty state, plus the top section above (Discretion).
    column = (
      <div className="px-4 md:px-0">
        <EmptyState
          variant="card"
          icon={Newspaper}
          title={labels.emptyTitle}
          body={labels.emptyBody}
        />
      </div>
    );
  } else {
    column = (
      <>
        <div className="flex flex-col gap-6">
          <CommunityPosts locked {...posts} />
          {view.placeholders > 0 ? (
            <div aria-hidden data-locked-placeholders className="flex flex-col gap-6">
              {Array.from({ length: view.placeholders }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static, contentless, index IS the identity
                <LockedPostPlaceholder key={index} index={index} />
              ))}
            </div>
          ) : null}
        </div>
        {view.showCount ? (
          <LockedCount
            line={view.countLine}
            body={view.countBody}
            // UI-D-376: with no top section to hold it, the deep-link line sits above the body here.
            extraLine={hasSection ? undefined : (view.fromPost ?? undefined)}
            action={action('outline') ?? undefined}
          />
        ) : null}
      </>
    );
  }

  return (
    <div data-community-locked className="mx-auto flex w-full max-w-[680px] flex-col">
      {header}

      {hasSection && view.sectionBody ? (
        <LockedSection
          title={view.title}
          body={view.sectionBody}
          extraLine={view.fromPost ?? undefined}
          action={action('brand')}
        />
      ) : null}

      {/* The prototype's hairline between the container's own chrome and its content. */}
      <div aria-hidden className={hasSection ? 'mt-4 h-px bg-border' : 'h-px bg-border'} />

      <div className="pt-3 pb-6">{column}</div>

      {view.section === 'many' ? (
        <ProductChoiceSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={view.choiceTitle}
          helper={view.choiceHelper}
          items={choices}
        />
      ) : null}
    </div>
  );
}
