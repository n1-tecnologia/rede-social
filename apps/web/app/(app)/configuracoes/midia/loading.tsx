import { Skeleton } from '@tria/ui';
import { MediaLibrarySkeleton } from './MediaLibrary';

/**
 * `/configuracoes/midia` loading (UI-SPEC E6/loading): the upload zone's geometry and the SAME three
 * rows the list renders while a page is in flight — one shape for both loads, never a spinner.
 *
 * Three rows rather than the directory's eight because that is the size this list actually opens at:
 * a community has a handful of videos, not a roster, and eight ghost rows would promise a page that
 * is never there.
 */
export default function AdminMediaLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4" aria-busy>
      <div className="px-4 md:px-0">
        <Skeleton variant="rect" className="h-40 rounded-2xl" />
      </div>
      <MediaLibrarySkeleton />
    </div>
  );
}
