import type { Bootstrap, ModuleKey } from '@tria/contracts';
import { avatarUrlFor } from '@tria/contracts/profiles';
import type { HomeSlot } from '@tria/core/ui';
import { exampleItemsSchema } from '@tria/module-example/contracts';
import { ExampleWidget } from '@tria/module-example/ui';
import { FEED_CAPTION_TRUNCATE_AT, type FeedPost } from '@tria/module-feed/contracts';
import {
  type AttachmentDescriptor,
  FeedList,
  type PostCardMediaView,
  type PostCardView,
  type PostMediaImage,
} from '@tria/module-feed/ui';
import { EmptyState } from '@tria/ui';
import { TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { createExampleItem } from '@/app/(app)/inicio/example-actions';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { apiFetch } from '@/lib/api';
import { loadFeed } from '@/lib/feed';

/**
 * The WEB composition point for module UI (MOD-02, D-42): the only file in `apps/web` that imports a
 * module's `ui` package. The API registry (`apps/api/src/modules/registry.ts`) decides WHICH modules
 * a tenant has and emits their `home` declarations on the bootstrap; this file supplies the renderer
 * for each `<key>` → `home[index]`. Nothing here decides membership: a module without an enabled
 * flag never reaches `bootstrap.modules`, so its renderer is never called.
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** Renders one home slot for a module; receives the whole bootstrap (permissions, tenant, …). */
export type HomeSlotRenderer = (ctx: { bootstrap: Bootstrap }) => Promise<ReactNode>;

interface WebModule {
  /** One renderer per `manifest.home[index]`; an index without a renderer renders nothing. */
  home: HomeSlotRenderer[];
}

/** The reference module's data, fetched only when the tenant HAS the module (D-19). */
async function getExampleItems() {
  const res = await apiFetch('/v1/example/items');
  if (!res.ok) return [];
  return exampleItemsSchema.parse(await res.json()).items;
}

/**
 * `example` → home[0]: the 01-07 widget as a home slot (Phase 4 deletes this entry with the package).
 * `canCreate` comes from the bootstrap permissions (role AND flag); the API re-checks every write.
 */
const exampleHome: HomeSlotRenderer = async ({ bootstrap }) => {
  const [items, te] = await Promise.all([getExampleItems(), getTranslations('example')]);
  return (
    <ExampleWidget
      items={items}
      canCreate={bootstrap.permissions.includes('example.create')}
      createAction={createExampleItem}
      labels={{
        title: te('title'),
        empty: te('empty'),
        add: te('add'),
        placeholder: te('placeholder'),
        processed: te('processed'),
      }}
    />
  );
};

/**
 * The community's timezone for a post's absolute timestamp. The bootstrap payload does not carry
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
function relativeFrom(iso: string, now: number): string {
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
 * `FeedPost` (the wire contract) → `PostCardView` (what the presentational card needs). The module's
 * UI resolves no URL, formats no date and knows no route table; this is the one place that does.
 * 04-06 lifts this helper into a shared module when the post page needs the same mapping.
 */
function postCardView(post: FeedPost, now: number, tf: Translator): PostCardView {
  return {
    id: post.id,
    caption: post.caption,
    author: {
      displayName: post.author.displayName,
      // D-52: the post is attributed to the PERSON, and their profile opens by direct link (D-47).
      profileHref: `/membros/${post.author.membershipId}`,
      avatarUrl: avatarUrlFor(post.author.avatarAssetId),
    },
    createdAtIso: post.createdAt,
    createdAtRelative: relativeFrom(post.createdAt, now),
    createdAtAbsolute: absoluteTime.format(new Date(post.createdAt)),
    ariaLabel: tf('post.label', { name: post.author.displayName }),
    media: postMediaView(post, tf),
  };
}

/**
 * `feed` → home[0] (D-55): the feed is the main content of `/inicio`, and it adds NO navigation tab.
 *
 * `canPost` is the composed `feed.post.create` permission from the bootstrap — the SAME value the
 * API's `requirePermission` guard evaluates (FEED-08). There is deliberately no role comparison here:
 * flipping `tenant_modules['feed'].settings.postingPolicy` to `'members'` must turn a member into an
 * author with no web change at all.
 *
 * A load failure renders the widget's own error card rather than rejecting: `homeSlotsFor` would
 * replace the slot with the generic card anyway, but the feed is the page's main content and its
 * error deserves the feed's own region label.
 */
const feedHome: HomeSlotRenderer = async ({ bootstrap }) => {
  const [page, tf, te] = await Promise.all([
    loadFeed(),
    getTranslations('feed'),
    getTranslations('app.error'),
  ]);
  const now = Date.now();

  return (
    <FeedList
      items={page === null ? null : page.items.map((post) => postCardView(post, now, tf))}
      canPost={bootstrap.permissions.includes('feed.post.create')}
      captionTruncateAt={FEED_CAPTION_TRUNCATE_AT}
      labels={{
        region: tf('region'),
        more: tf('caption.more'),
        carousel: tf('gallery.carousel'),
        attachmentError: tf('errors.generic'),
        emptyTitle: tf('empty.title'),
        emptyBody: tf('empty.body', { tenant: bootstrap.tenant.displayName }),
        emptyBodyAuthor: tf('empty.bodyAuthor'),
        emptyCta: tf('empty.cta'),
        errorTitle: te('title'),
        errorBody: te('body'),
        errorRetry: te('retry'),
      }}
    />
  );
};

export const WEB_MODULE_REGISTRY: Partial<Record<ModuleKey, WebModule>> = {
  example: { home: [exampleHome] },
  feed: { home: [feedHome] },
};

/**
 * Module tab labels resolve from the module's own catalog namespace (`<key>.nav`, e.g.
 * `example.nav = "Exemplo"`) before the manifest label (PWA-03). `t` is the ROOT translator.
 */
export function moduleLabelResolver(
  t: Translator,
): (key: string, fallback: string) => string | null {
  return (key, fallback) => (t.has(`${key}.nav`) ? t(`${key}.nav`) : fallback);
}

/**
 * The home slots of the tenant's ENABLED modules, in registry order (D-42). Every renderer runs with
 * `Promise.allSettled`: a slot whose loader rejects is replaced, in its own position, by the generic
 * error card (UI consideration E04/error) while the welcome block and the other slots still render.
 */
export async function homeSlotsFor(bootstrap: Bootstrap): Promise<HomeSlot[]> {
  const jobs: { key: string; order: number; run: () => Promise<ReactNode> }[] = [];
  for (const module of bootstrap.modules) {
    const renderers = WEB_MODULE_REGISTRY[module.key]?.home ?? [];
    (module.home ?? []).forEach((slot, index) => {
      const render = renderers[index];
      if (!render) return;
      jobs.push({
        key: `${module.key}:${index}`,
        order: slot.order,
        run: () => render({ bootstrap }),
      });
    });
  }
  if (jobs.length === 0) return [];

  const [te, results] = await Promise.all([
    getTranslations('app.error'),
    Promise.allSettled(jobs.map((job) => job.run())),
  ]);

  return results.map((result, i) => {
    const { key, order } = jobs[i] as (typeof jobs)[number];
    if (result.status === 'fulfilled') return { key, order, node: result.value };
    console.error('home-slot.failed', { slot: key, reason: String(result.reason) });
    return {
      key,
      order,
      node: (
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          title={te('title')}
          body={te('body')}
          action={
            <a href="/inicio" className="text-sm font-bold text-brand">
              {te('retry')}
            </a>
          }
        />
      ),
    };
  });
}
