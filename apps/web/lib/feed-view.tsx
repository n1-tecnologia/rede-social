import { avatarUrlFor } from '@rede-social/contracts/profiles';
import type { FeedComment, FeedPost, PostMediaItem } from '@rede-social/module-feed/contracts';
import type {
  AttachmentDescriptor,
  CommentView,
  PostCardMediaView,
  PostCardView,
  PostMediaImage,
} from '@rede-social/module-feed/ui';
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
 * Everything locale- or route-shaped lives HERE rather than in the module package: `@rede-social/module-feed`
 * ships no language (PWA-03) and knows no route table (MOD-02).
 *
 * The only VALUE this file imports from the module is nothing at all — the module types are
 * type-only imports, erased at build, so `lib/registry.tsx` stays the single composition point that
 * imports a module's `ui` package for real (D-42).
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * A post's and a comment's absolute timestamp, in the TENANT's zone (06-09, UI-D-203).
 *
 * The zone is `bootstrap.tenant.timezone` — the tenant's own `tenants.timezone` row, parsed on the
 * server — and every caller passes it in: a page or a home renderer from the bootstrap it already
 * holds, a server action from `getBootstrap()` (cached per request). Nothing here reads a zone
 * from a request parameter or from the device (T-06-57). Formatting is still timezone-PINNED rather
 * than local, because the same ISO instant must render identically on the server and after
 * hydration (UI-D-14); the pin is now the tenant's zone instead of a constant.
 *
 * One `Intl.DateTimeFormat` per zone, memoised: constructing one is the expensive part, and a feed
 * page formats every card with the same zone.
 */
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

export function absoluteTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let format = absoluteFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    absoluteFormatters.set(timeZone, format);
  }
  return format;
}

/**
 * "há 2 h" — re-exported from `lib/relative-time.ts`, which is where it lives since 05-06 so that a
 * module needing only the formatter does not also pull `VideoPlayer` and the env-validating server
 * action behind it. Every existing caller of `relativeFrom` from this module is unchanged.
 */
import { relativeFrom } from '@/lib/relative-time';

export { relativeFrom };

/**
 * Byte sizes in pt-BR ("1,2 MB"). The FORMATTING lives here rather than inside the module for the
 * same reason the timestamps do: `@rede-social/module-feed` ships no language (PWA-03), and a locale baked
 * into a reusable package would travel to every other Rede Social project that installs it.
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
 * `timeZone` is `bootstrap.tenant.timezone` (see `absoluteTimeFormatter`), required so a caller
 * cannot forget it and fall back to some other clock.
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
  timeZone: string,
): PostCardView {
  return {
    ...postCardBase(post, now, tf, shareOrigin),
    createdAtAbsolute: absoluteTimeFormatter(timeZone).format(new Date(post.createdAt)),
  };
}

/**
 * Everything on the card except its absolute timestamp — the ONE mapping `postCardView` and the
 * Reel (`lib/reels.ts`) share. A Reel renders no date at all, so it takes this and never needs a
 * zone; a card always goes through `postCardView`, which adds the absolute time in the tenant's
 * zone. Splitting it here keeps a single mapping for the author link, the counts and the share link
 * without inventing a zone for a surface that shows none.
 */
export function postCardBase(
  post: FeedPost,
  now: number,
  tf: Translator,
  shareOrigin: string | null,
): Omit<PostCardView, 'createdAtAbsolute'> {
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
    /**
     * D-71 / UI-D-36 — "em {Comunidade}", composed HERE for the same two reasons `profileHref` and
     * `shareUrl` are: `@rede-social/module-feed` knows no route table (MOD-02) and ships no language
     * (PWA-03). The module receives a finished string and a finished href and renders them; it
     * never learns the word "em" or the shape of `/comunidades/{id}`.
     *
     * `null` passes straight through as `null`, which is what makes a tenant-wide post render its
     * `<time>` alone rather than a middot with nothing after it.
     */
    community:
      post.community === null
        ? null
        : {
            label: tf('post.communityLabel', { community: post.community.name }),
            href: `/comunidades/${post.community.id}`,
            ariaLabel: tf('post.communityAriaLabel', { community: post.community.name }),
          },
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
 * `FeedPost` → the shape the composer pre-fills the EDIT route with (04-09, FEED-03).
 *
 * It lives beside `postCardView` for the same reason that one does: byte sizes and type labels are
 * locale- and catalog-shaped, and a second `formatBytes` inside the form would print "1.2 MB" on
 * the edit screen and "1,2 MB" on the card for the same file.
 *
 * `hasLinkPreview` is a BOOLEAN, not the preview itself: the composer's row is inert copy plus a
 * remove control (UI-D-11) and has nothing to render from a resolved card. It is true only for a
 * preview the API actually projected — a pending or refused one is already null on the wire, which
 * is the silence UI-D-13 asks for carried into the edit screen unchanged.
 */
export type ComposerImageDraft = { assetId: string; variantWidths: number[] };
export type ComposerVideoDraft = { assetId: string; status: PostMediaItem['status'] };
export type ComposerAttachmentDraft = {
  assetId: string;
  filename: string;
  typeLabel: string;
  sizeLabel: string | null;
};
export type ComposerDraft = {
  caption: string;
  images: ComposerImageDraft[];
  video: ComposerVideoDraft | null;
  attachments: ComposerAttachmentDraft[];
  hasLinkPreview: boolean;
  /**
   * D-72 / UI-D-45 — where the post was PUBLISHED, carried into the edit screen so the picker row
   * can render READ-ONLY with the destination it actually has.
   *
   * It is the post's own `community`, not a lookup against the tenant's active list: a post whose
   * community has since been ARCHIVED still has to show where it lives, and an archived community
   * is deliberately absent from that list.
   */
  community: { id: string; name: string } | null;
};

export function composerDraft(post: FeedPost, tf: Translator): ComposerDraft {
  const video = post.media.find((item) => item.kind === 'video');
  return {
    caption: post.caption,
    community:
      post.community === null ? null : { id: post.community.id, name: post.community.name },
    images: post.media
      .filter((item) => item.kind === 'image')
      .map((item) => ({ assetId: item.assetId, variantWidths: item.variantWidths })),
    video: video ? { assetId: video.assetId, status: video.status } : null,
    attachments: post.media
      .filter((item) => item.kind === 'file')
      .map((item) => ({
        assetId: item.assetId,
        filename: item.filename ?? '',
        typeLabel:
          item.mime === 'application/pdf' ? tf('attachment.type.pdf') : tf('attachment.type.other'),
        sizeLabel: formatBytes(item.bytes),
      })),
    hasLinkPreview: post.linkPreview !== null,
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
export function commentView(
  comment: FeedComment,
  now: number,
  nowLabel: string,
  timeZone: string,
): CommentView {
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
    createdAtAbsolute: absoluteTimeFormatter(timeZone).format(new Date(comment.createdAt)),
    likeCount: comment.likeCount,
    viewerLiked: comment.viewerLiked,
    replyCount: comment.replyCount,
    isReply: comment.isReply,
    canDelete: comment.canDelete,
    // 08-01 (UI-D-276): copied THROUGH, like `canDelete`. An API that predates it sends nothing, and
    // the row then reads `canDelete ? 'own' : null` — the shipped behaviour (release-order rule).
    removal: comment.removal ?? (comment.canDelete ? 'own' : null),
  };
}
