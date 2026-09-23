import { avatarUrlFor } from '@tria/contracts/profiles';
import type { FeedComment, FeedPost } from '@tria/module-feed/contracts';
import type {
  AttachmentDescriptor,
  CommentView,
  PostCardMediaView,
  PostCardView,
  PostMediaImage,
} from '@tria/module-feed/ui';
import type { getTranslations } from 'next-intl/server';
import { VideoPlayer } from '@/components/media/VideoPlayer';

/**
 * `FeedPost` / `FeedComment` (the wire contracts) → the views the presentational components need.
 *
 * **Why this is its own module and not part of `lib/registry.tsx`.** The home slot renders page 1
 * and `inicio/feed-actions.ts` renders every page after it; if each built its own view the two
 * would drift on the time zone, on the media node or on the profile route the first time one of
 * them changed — the same failure mode the "one fetch implementation" rule (D-58, Pitfall 9)
 * exists to prevent, one layer up. Registry imports the actions and the actions import this, so
 * there is no cycle and exactly one mapping.
 *
 * Everything locale- or route-shaped lives HERE rather than in the module package: `@tria/module-feed`
 * ships no language (PWA-03) and knows no route table (MOD-02).
 *
 * The only VALUE this file imports from the module is nothing at all — the module types are
 * type-only imports, erased at build, so `lib/registry.tsx` stays the single composition point that
 * imports a module's `ui` package for real (D-42).
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The community's time zone for a post's absolute timestamp. The bootstrap payload does not carry
 * `tenants.timezone` yet, so the column's own default — what every seeded and newly provisioned
 * community actually has — stands in. Formatting is timezone-PINNED rather than local because the
 * same ISO instant must render identically on the server and after hydration (UI-D-14).
 */
const TENANT_TIME_ZONE = 'America/Sao_Paulo';

const absoluteTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TENANT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const relativeTime = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto', style: 'narrow' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * "há 2 h" — computed on the SERVER and passed down as a string (UI-D-14): the card never calls a
 * clock in render, so there is no hydration mismatch and no per-second re-render.
 */
export function relativeFrom(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < MINUTE) return relativeTime.format(0, 'second');
  if (elapsed < HOUR) return relativeTime.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relativeTime.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < WEEK) return relativeTime.format(-Math.floor(elapsed / DAY), 'day');
  if (elapsed < MONTH) return relativeTime.format(-Math.floor(elapsed / WEEK), 'week');
  if (elapsed < YEAR) return relativeTime.format(-Math.floor(elapsed / MONTH), 'month');
  return relativeTime.format(-Math.floor(elapsed / YEAR), 'year');
}

/**
 * Byte sizes in pt-BR ("1,2 MB"). The FORMATTING lives here rather than inside the module for the
 * same reason the timestamps do: `@tria/module-feed` ships no language (PWA-03), and a locale baked
 * into a reusable package would travel to every other TRIA project that installs it.
 *
 * Binary units, one decimal, and `null` when the stored size is unknown — the row then renders the
 * type ALONE, never a dangling separator (UI-SPEC E07/partial).
 */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const sizeFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${sizeFormat.format(unit === 0 ? Math.round(value) : value)} ${SIZE_UNITS[unit]}`;
}

/**
 * The post's media band, resolved for the presentational card (04-04): the gallery in `position`
 * order with its per-slide labels already interpolated, the attachment rows with their formatted
 * sizes, and — only on the video branch — the ALREADY-CREATED `VideoPlayer` element.
 *
 * Passing the ELEMENT rather than the component is what lets an app-scoped client component cross
 * into a module package: `VideoPlayer` binds a server action for its per-request playback token
 * (D-44) and the next-intl catalog, and 02-08 found Flight refuses a component object outright.
 * An element survives BOTH boundaries this file's callers cross — a server component's props and a
 * server action's return value — which is what lets page 1 and page 2 share one mapping.
 *
 * `alt` is deliberately the empty string: `media_assets` carries no alt text, and a filename is not
 * a description — UI-SPEC asks for a decorative empty alt rather than a guessed one.
 */
function postMediaView(post: FeedPost, tf: Translator): PostCardMediaView {
  const images = post.media.filter((item) => item.kind === 'image');
  const video = post.media.find((item) => item.kind === 'video');

  return {
    mediaKind: post.mediaKind,
    images: images.map(
      (item, index): PostMediaImage => ({
        assetId: item.assetId,
        variantWidths: item.variantWidths,
        alt: '',
        label: tf('gallery.slide', { index: index + 1, total: images.length }),
        width: item.width,
        height: item.height,
      }),
    ),
    attachments: post.media
      .filter((item) => item.kind === 'file')
      .map((item): AttachmentDescriptor => {
        const filename = item.filename ?? '';
        return {
          assetId: item.assetId,
          filename,
          typeLabel:
            item.mime === 'application/pdf'
              ? tf('attachment.type.pdf')
              : tf('attachment.type.other'),
          sizeLabel: formatBytes(item.bytes),
          downloadLabel: tf('attachment.download', { name: filename }),
        };
      }),
    video: video ? <VideoPlayer assetId={video.assetId} status={video.status} /> : undefined,
    // MEDIA-04. The API projects a preview ONLY once it has resolved, so `post.linkPreview` is
    // already null while one is pending, failed or refused — the card is simply absent and the
    // caption's auto-linked URL is the whole rendering (UI-D-11 / UI-D-13). `imageAssetId` is null
    // in V1 (the worker does not copy remote thumbnails into Storage), so the ladder is empty and
    // the card renders body-only rather than hot-linking a third-party host into the tenant's page.
    linkPreview:
      post.linkPreview === null
        ? undefined
        : {
            preview: {
              status: post.linkPreview.status,
              url: post.linkPreview.url,
              hostname: post.linkPreview.hostname,
              title: post.linkPreview.title,
              description: post.linkPreview.description,
              provider: post.linkPreview.provider,
              imageAssetId: post.linkPreview.imageAssetId,
              imageVariantWidths: [],
            },
            ariaLabel: tf('linkPreview.label', {
              title: post.linkPreview.title ?? post.linkPreview.hostname,
            }),
            providerLabel:
              post.linkPreview.provider === null
                ? undefined
                : tf(`linkPreview.provider.${post.linkPreview.provider}`),
          },
  };
}

/**
 * The module's UI resolves no URL, formats no date and knows no route table; this does all three.
 *
 * `shareOrigin` is `primaryHostOrigin()`'s answer — `https://{primaryHost}` on a tenant host, `null`
 * everywhere else — and it is what turns a post id into the FEED-07 link (D-56). It is a PARAMETER
 * rather than a lookup inside this function for the same reason `now` and `tf` are: this module is
 * reached from a page, from a server action and from the post route, and only the caller is in a
 * request context that can resolve it. A `null` origin yields a `null` `shareUrl`, and the card
 * then offers no share affordance at all rather than a link to the wrong origin (T-04-51).
 */
export function postCardView(
  post: FeedPost,
  now: number,
  tf: Translator,
  shareOrigin: string | null,
): PostCardView {
  return {
    id: post.id,
    caption: post.caption,
    shareUrl: shareOrigin === null ? null : `${shareOrigin}/post/${post.id}`,
    author: {
      displayName: post.author.displayName,
      // D-52: the post is attributed to the PERSON, and their profile opens by direct link (D-47).
      profileHref: `/membros/${post.author.membershipId}`,
      avatarUrl: avatarUrlFor(post.author.avatarAssetId),
    },
    createdAtIso: post.createdAt,
    createdAtRelative: relativeFrom(post.createdAt, now),
    createdAtAbsolute: absoluteTime.format(new Date(post.createdAt)),
    // UI-D-15: the marker is a BOOLEAN here, not a second date — the meta row appends "editado" and
    // never a timestamp of its own.
    edited: post.editedAt !== null,
    // FEED-03. `canManage` is the API's OWN answer (its author predicate), copied THROUGH and never
    // recomputed here by comparing the viewer's id to the author's — the `canDelete` rule 04-07 set
    // for comments. It selects the overflow menu's variant; the API's predicate is what decides the
    // write. `editHref` is built here for the same reason `profileHref` and `shareUrl` are: the
    // module knows no route table (MOD-02), and a menu row pointing at a screen the viewer would be
    // refused on is worse than no row at all.
    canManage: post.canManage,
    editHref: post.canManage ? `/post/${post.id}/editar` : null,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    viewerLiked: post.viewerLiked,
    ariaLabel: tf('post.label', { name: post.author.displayName }),
    media: postMediaView(post, tf),
  };
}

/**
 * `FeedComment` (the wire contract) → `CommentView` (what the presentational row needs), and the
 * one place UI-D-24 becomes pixels.
 *
 * **A removed author gets NO name and NO link here.** The API already nulls `displayName` and
 * `membershipId` when `authorRemoved` is true, and this function does not try to fill either in:
 * the row's label comes from the catalog inside the component, and `profileHref` stays null so
 * there is no href for a member to follow to a profile that is gone (T-04-45). Reconstructing
 * `/membros/{id}` from anything else would defeat the projection's whole point.
 *
 * `canDelete` is copied THROUGH from the server (T-04-44) — never recomputed here by comparing the
 * viewer's id to the author's. The control it draws is a convenience; the API's own predicate is
 * what actually decides, and a client-side guess that disagreed with it would either hide a
 * legitimate control or offer one that always 404s.
 */
export function commentView(comment: FeedComment, now: number, nowLabel: string): CommentView {
  // A comment written seconds ago reads "agora" rather than "há 0 s" (UI-D-14); the ISO value and
  // the absolute title are still real, so the `<time>` element stays machine-readable.
  const elapsed = now - new Date(comment.createdAt).getTime();
  const relative = elapsed < 60_000 ? nowLabel : relativeFrom(comment.createdAt, now);

  return {
    id: comment.id,
    body: comment.body,
    author: {
      displayName: comment.author.displayName,
      profileHref:
        comment.authorRemoved || comment.author.membershipId === null
          ? null
          : `/membros/${comment.author.membershipId}`,
      avatarUrl: avatarUrlFor(comment.author.avatarAssetId),
    },
    authorRemoved: comment.authorRemoved,
    createdAtIso: comment.createdAt,
    createdAtRelative: relative,
    createdAtAbsolute: absoluteTime.format(new Date(comment.createdAt)),
    likeCount: comment.likeCount,
    viewerLiked: comment.viewerLiked,
    replyCount: comment.replyCount,
    isReply: comment.isReply,
    canDelete: comment.canDelete,
  };
}
