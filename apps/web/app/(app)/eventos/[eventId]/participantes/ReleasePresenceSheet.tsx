'use client';

import { ADMIN_MEMBERS_MAX_QUERY_LENGTH } from '@rede-social/contracts/moderation';
import { avatarUrlFor } from '@rede-social/contracts/profiles';
import {
  Avatar,
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  InfiniteScroll,
  SearchBar,
  Skeleton,
  StatusPill,
  useDebounce,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { SearchX, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  type CourtesyCandidate,
  courtesyHoldersAction,
  type GrantCourtesyResult,
  grantCourtesyAction,
  searchCourtesyMembersAction,
} from '../../actions';

/** `count` member-row skeletons in the sheet row's geometry (5 on a search, 3 at the sentinel). */
function CandidateSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="release-skeleton" className="flex flex-col">
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 border-b border-divider py-2">
          <Skeleton variant="circle" className="h-8 w-8" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" className="w-1/2" />
            <Skeleton variant="text" className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The toast of one release answer (UI-D-755), shared by BOTH doors so the sheet and the "Não vão" row say
 * the same thing: granted -> success; already in -> info; ended and the cancelled event -> a plain refusal;
 * everything else (the sale switched off, a member who left, a failure) -> the generic line.
 */
export function useReleaseToast() {
  const t = useTranslations('events');
  const { show } = useToast();
  return useCallback(
    (status: GrantCourtesyResult['status'], name: string) => {
      switch (status) {
        case 'granted':
          show({ tone: 'success', message: t('participants.release.toasts.granted', { name }) });
          return;
        case 'already_in':
          show({ tone: 'info', message: t('participants.release.toasts.alreadyIn', { name }) });
          return;
        case 'event_ended':
          show({ tone: 'error', message: t('participants.release.toasts.ended') });
          return;
        case 'event_cancelled':
          show({ tone: 'error', message: t('errors.cancelled') });
          return;
        default:
          show({ tone: 'error', message: t('participants.release.toasts.generic') });
      }
    },
    [show, t],
  );
}

/**
 * The brand confirm of BOTH doors (UI-D-755): "Liberar presença de {name}?". Open while `name` is set; it
 * never decides anything, the host's `onConfirm` calls the action and updates from the server's answer.
 */
export function ReleaseConfirmDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('events');
  const { show } = useToast();
  return (
    <ConfirmDialog
      open={name !== null}
      tone="brand"
      icon={UserPlus}
      title={name === null ? '' : t('participants.release.confirm.title', { name })}
      body={t('participants.release.confirm.body')}
      confirmLabel={t('participants.release.confirm.confirm')}
      cancelLabel={t('participants.release.confirm.cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
      onError={(error) => {
        console.error('events.courtesy_grant_failed', { error: String(error) });
        show({ tone: 'error', message: t('participants.release.toasts.generic') });
      }}
    />
  );
}

type Search =
  | { state: 'idle' }
  | {
      state: 'done';
      q: string;
      items: CourtesyCandidate[];
      nextCursor: string | null;
      pageFailed: boolean;
    }
  | { state: 'error'; q: string };

export interface ReleasePresenceSheetProps {
  open: boolean;
  /** Backdrop, Escape or drag: the host closes the sheet and returns focus to its button. */
  onClose: () => void;
  eventId: string;
  /** A release that WROTE a new presence: the host refreshes the counts around the sheet. */
  onReleased: () => void;
}

/**
 * "Liberar presença" (10.1-14, D-743, A-UI-5, A-UI-6, UI-D-755): the shipped `BottomSheet` (a centred
 * card from `md`) with the shipped `SearchBar` debounced 300 ms into the Membros admin search over ACTIVE
 * members, the SAME read and permission the store's "Conceder acesso" sheet uses.
 *
 * - **States.** Before typing: ONLY the prompt (no unbounded member list, T-10.1-16). While a query is
 *   pending: 5 row skeletons. Results: rows with the avatar, the name and the e-mail (both `truncate`) and
 *   a trailing "Liberar", or the neutral pill "Já inscrito" for a member the holders read reports (asked
 *   once per page, at most 50 ids). No match: the empty state. A failed search: an inline line + retry.
 * - **Release.** A row opens the brand confirm naming the person. The row turns into "Já inscrito" in
 *   place ONLY after the action answers `granted` or `already_in` (nothing is optimistic); a refusal
 *   toasts and leaves the row as it was.
 * - **Freshness.** A response that answers a query the field no longer holds is dropped, so an older,
 *   slower request can never paint over a newer one.
 */
export function ReleasePresenceSheet({
  open,
  onClose,
  eventId,
  onReleased,
}: ReleasePresenceSheetProps) {
  const t = useTranslations('events');
  const desktop = useMediaQuery('(min-width: 768px)');
  const toastRelease = useReleaseToast();

  const [value, setValue] = useState('');
  const debounced = useDebounce(value, 300);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  /** The membership ids known to hold a presence: the holders read plus what this sheet just wrote. */
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<CourtesyCandidate | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  /** The query the latest request was for; any other answer is stale and dropped. */
  const latest = useRef('');

  const query = value.trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH);
  const settled = debounced.trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH);

  // Every opening starts from an empty field and the prompt.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setValue('');
      setSearch({ state: 'idle' });
      setHeld(new Set());
      setTarget(null);
    }
  }

  /** Who of this page already holds a presence; an unreadable answer offers every row (the write refuses). */
  const readHolders = useCallback(
    async (items: CourtesyCandidate[]): Promise<string[]> => {
      if (items.length === 0) return [];
      try {
        const answer = await courtesyHoldersAction(
          eventId,
          items.map((item) => item.membershipId),
        );
        return answer.ok ? answer.holders : [];
      } catch (error) {
        console.error('events.courtesy_holders_failed', { error: String(error) });
        return [];
      }
    },
    [eventId],
  );

  const runSearch = useCallback(
    async (q: string) => {
      latest.current = q;
      try {
        const page = await searchCourtesyMembersAction(q, null);
        if (latest.current !== q) return;
        if (!page.ok) {
          setSearch({ state: 'error', q });
          return;
        }
        const holders = await readHolders(page.items);
        if (latest.current !== q) return;
        setHeld((previous) => new Set([...previous, ...holders]));
        setSearch({
          state: 'done',
          q,
          items: page.items,
          nextCursor: page.nextCursor,
          pageFailed: false,
        });
      } catch (error) {
        if (latest.current !== q) return;
        console.error('events.courtesy_search_failed', { error: String(error) });
        setSearch({ state: 'error', q });
      }
    },
    [readHolders],
  );

  useEffect(() => {
    if (!open) return;
    if (settled === '') {
      latest.current = '';
      setSearch({ state: 'idle' });
      return;
    }
    void runSearch(settled);
  }, [open, settled, runSearch]);

  const loadMore = useCallback(async () => {
    if (search.state !== 'done' || search.nextCursor === null) return;
    const { q, nextCursor } = search;
    try {
      const page = await searchCourtesyMembersAction(q, nextCursor);
      if (latest.current !== q) return;
      if (!page.ok) {
        setSearch((current) =>
          current.state === 'done' && current.q === q ? { ...current, pageFailed: true } : current,
        );
        return;
      }
      const holders = await readHolders(page.items);
      if (latest.current !== q) return;
      setHeld((previous) => new Set([...previous, ...holders]));
      setSearch((current) => {
        if (current.state !== 'done' || current.q !== q) return current;
        const known = new Set(current.items.map((item) => item.membershipId));
        return {
          ...current,
          items: [...current.items, ...page.items.filter((item) => !known.has(item.membershipId))],
          nextCursor: page.nextCursor,
          pageFailed: false,
        };
      });
    } catch (error) {
      console.error('events.courtesy_search_more_failed', { error: String(error) });
      setSearch((current) =>
        current.state === 'done' && current.q === q ? { ...current, pageFailed: true } : current,
      );
    }
  }, [search, readHolders]);

  const confirmRelease = async () => {
    const member = target;
    if (!member) return;
    let result: GrantCourtesyResult = { status: 'generic' };
    try {
      result = await grantCourtesyAction(eventId, { membershipId: member.membershipId });
    } catch (error) {
      console.error('events.courtesy_grant_failed', { error: String(error) });
    }
    toastRelease(result.status, member.name);
    if (result.status === 'granted' || result.status === 'already_in') {
      setHeld((previous) => new Set(previous).add(member.membershipId));
      if (result.status === 'granted') onReleased();
    }
  };

  const pending = query !== '' && (search.state === 'idle' || search.q !== query);

  let body: ReactNode;
  if (query === '') {
    body = (
      <p
        data-release-prompt
        className="px-4 py-6 text-center text-xs font-normal text-text-tertiary"
      >
        {t('participants.release.prompt')}
      </p>
    );
  } else if (pending) {
    body = <CandidateSkeleton count={5} />;
  } else if (search.state === 'error') {
    body = (
      <div data-release-error className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        <p className="text-sm font-normal text-danger">{t('participants.release.error')}</p>
        <Button variant="outline" onClick={() => void runSearch(search.q)}>
          {t('errors.retry')}
        </Button>
      </div>
    );
  } else if (search.state === 'done' && search.items.length === 0) {
    body = (
      <EmptyState
        variant="plain"
        icon={SearchX}
        data-testid="release-no-match"
        title={t('participants.release.empty.title')}
        body={t('participants.release.empty.body')}
      />
    );
  } else if (search.state === 'done') {
    body = (
      <>
        <ul data-release-results className="flex flex-col">
          {search.items.map((member) => (
            <li
              key={member.membershipId}
              data-release-candidate={member.membershipId}
              className="flex min-h-14 items-center gap-3 border-b border-divider py-2 last:border-0"
            >
              <Avatar src={avatarUrlFor(member.avatarAssetId)} alt={member.name} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span data-release-name className="truncate text-sm font-bold text-text">
                  {member.name}
                </span>
                <span
                  data-release-email
                  className="truncate text-xs font-normal text-text-tertiary"
                >
                  {member.email}
                </span>
              </span>
              {held.has(member.membershipId) ? (
                <StatusPill tone="neutral" data-release-held className="shrink-0">
                  {t('participants.release.alreadyIn')}
                </StatusPill>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  hitArea
                  className="shrink-0"
                  aria-label={t('participants.release.rowAria', { name: member.name })}
                  onClick={() => setTarget(member)}
                >
                  {t('participants.release.row')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <InfiniteScroll
          hasMore={search.nextCursor !== null}
          enabled={!search.pageFailed}
          onLoadMore={loadMore}
          root={scrollRoot}
          skeleton={<CandidateSkeleton count={3} />}
        />
        {search.pageFailed ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm font-normal text-danger">{t('participants.release.error')}</p>
            <Button
              variant="outline"
              onClick={() =>
                setSearch((current) =>
                  current.state === 'done' ? { ...current, pageFailed: false } : current,
                )
              }
            >
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={t('participants.release.title')}
        desktopCard={desktop}
        scroll="content"
        initialFocus="first"
      >
        <div data-release-sheet className="flex shrink-0 flex-col gap-3 px-4 pb-3">
          <SearchBar
            id="release-presence-search"
            value={value}
            onChange={(next) => setValue(next.slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH))}
            ariaLabel={t('participants.release.search')}
            placeholder={t('participants.release.search')}
            clearLabel={t('participants.release.clear')}
          />
        </div>
        <div
          ref={setScrollRoot}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {body}
        </div>
      </BottomSheet>

      <ReleaseConfirmDialog
        name={target?.name ?? null}
        onConfirm={confirmRelease}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

/**
 * The toolbar door of "Liberar presença" (UI-D-755): an `outline` `Button md` with `UserPlus` 16, in a
 * `px-4 pt-4` row ABOVE the chips, full width below 360px and auto width above. The PAGE renders it for a
 * paid event and a viewer holding the events manage permission, nobody else (a free event has no door);
 * the API's literal manage guard is the authority. A written release refreshes the counts around it.
 */
export function ReleasePresenceToolbar({ eventId }: { eventId: string }) {
  const t = useTranslations('events');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div data-release-toolbar className="px-4 pt-4">
        <Button
          variant="outline"
          size="md"
          className="max-[359px]:w-full"
          onClick={() => setOpen(true)}
        >
          <UserPlus aria-hidden size={16} className="shrink-0" />
          {t('participants.release.door')}
        </Button>
      </div>
      <ReleasePresenceSheet
        open={open}
        onClose={() => setOpen(false)}
        eventId={eventId}
        onReleased={() => router.refresh()}
      />
    </>
  );
}
