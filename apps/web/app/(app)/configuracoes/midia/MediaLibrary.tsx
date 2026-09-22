'use client';

import type { MediaAsset } from '@tria/contracts/media';
import { Button, Card, EmptyState } from '@tria/ui';
import { CircleAlert, Film } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState, useTransition } from 'react';
import { MediaAssetRow } from '@/components/media/MediaAssetRow';
import { loadMoreAssetsAction } from './actions';

export interface MediaLibraryProps {
  /** The first page the SERVER rendered — the list is seeded from it. */
  initialItems: MediaAsset[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all. */
  initialError?: boolean;
}

/**
 * The admin media library's body (MEDIA-03, UI-SPEC §Admin media steps 2 and 5).
 *
 * **Pagination is keyset** (R-11), the SAME contract the member directory uses: "Carregar mais"
 * renders exactly while the API returned a non-null `nextCursor`, appends the next page without
 * re-ordering or replacing anything already rendered, and keeps the existing rows visible while it
 * is pending. There is no infinite scroll.
 *
 * The upload zone and the player mount at the two named points below; Task 2 of this plan fills
 * them. Nothing here ever offers "pick an existing asset" — that reuse surface belongs to Phase 4's
 * composer and is explicitly deferred (CONTEXT §Deferred Ideas).
 */
export function MediaLibrary({ initialItems, initialCursor, initialError }: MediaLibraryProps) {
  const t = useTranslations('media');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(Boolean(initialError));
  const [loadingMore, startLoadMore] = useTransition();

  const loadMore = () => {
    if (!cursor) return;
    const from = cursor;
    startLoadMore(async () => {
      try {
        const page = await loadMoreAssetsAction(from);
        if (!page.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        // APPEND: the rows already on screen keep their order and their DOM position.
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } catch (error) {
        console.error('media.load_more_failed', { error: String(error) });
        setFailed(true);
      }
    });
  };

  const errorState = (
    <EmptyState
      variant="card"
      icon={CircleAlert}
      title={t('errors.generic')}
      action={
        <Button variant="outline" onClick={loadMore}>
          {t('retry')}
        </Button>
      }
    />
  );

  let list: ReactNode;
  if (failed && items.length === 0) {
    list = errorState;
  } else if (items.length === 0) {
    list = (
      <EmptyState
        variant="card"
        icon={Film}
        title={t('library.empty.title')}
        body={t('library.empty.body')}
      />
    );
  } else {
    list = (
      <>
        <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
          <ul className="flex flex-col">
            {items.map((asset, index) => (
              <li
                key={asset.id}
                className={index === items.length - 1 ? undefined : 'border-b border-divider'}
              >
                <MediaAssetRow asset={asset} />
              </li>
            ))}
          </ul>
        </Card>

        {failed ? <div className="mt-4">{errorState}</div> : null}

        {!failed && cursor !== null ? (
          <div className="mt-4 px-4 md:px-0">
            <Button variant="outline" fullWidth loading={loadingMore} onClick={loadMore}>
              {loadingMore ? t('library.loadingMore') : t('library.loadMore')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="media-library">
      {/* upload-mount: `VideoUploadField` (Task 2). */}
      {list}
      {/* player-mount: the `VideoPlayer` sheet/dialog opened from a `ready` row (Task 2). */}
    </div>
  );
}
