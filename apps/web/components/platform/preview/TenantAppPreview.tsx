'use client';

import { buildNav, iconFor, type NavItem, TenantLogo, withTabDots } from '@rede-social/core/ui';
import { PostCard, type PostCardLabels, type PostCardView } from '@rede-social/module-feed/ui';
import { StoriesStrip, type StoryStripCircle } from '@rede-social/module-stories/ui';
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  Chip,
  cn,
  EmptyState,
  Input,
  StatusPill,
  Switch,
} from '@rede-social/ui';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Link2,
  Lock,
  type LucideIcon,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileNudgeDialog } from '@/components/profile/ProfileNudgeDialog';
import { StoriesBand } from '@/components/stories/StoriesBand';
import {
  previewEffectiveModules,
  previewHomeSlots,
  previewNavModules,
} from '@/lib/preview-modules';
import { PreviewArt, type PreviewArtScene } from './PreviewArt';
import { screenForHref, screenOfTab } from './preview-routes';
import type { PreviewScreen, PreviewTheme, PreviewView } from './TenantPreviewProvider';
import { usePreviewNudge } from './usePreviewNudge';

export interface TenantAppPreviewProps {
  /** Display name already resolved (the typed one, or the catalog placeholder). */
  name: string;
  logoUrl: string | null;
  /** Enabled module keys; `requires` is applied here, exactly as the API composes the bootstrap. */
  modules: readonly string[];
  screen: PreviewScreen;
  /** Whose app: a member's, or the tenant admin's (plus its create and manage controls, inert). */
  view?: PreviewView;
  /** Opens another screen: the tabs, the top bar, the login and every link the app renders. */
  onNavigate?: (screen: PreviewScreen) => void;
  /** The device's theme, which the settings screen's "Tema escuro" switch shows and changes. */
  theme?: PreviewTheme;
  onTheme?: (theme: PreviewTheme) => void;
}

/** Sample likes never reach a server: the preview's like toggle answers locally. */
const localLike = async () => ({ ok: true as const, liked: true, likeCount: 25 });
const localUnlike = async () => ({ ok: true as const, liked: false, likeCount: 24 });

/** The prototype's easing (noz-app curve), as the kernel `BottomNav` uses it. */
const EASE = 'cubic-bezier(0.2, 0.715, 0.205, 0.99)';

/**
 * The tenant's app as a member sees it, emulated at phone scale inside `DevicePhone` (no API call,
 * no route, no session) and NAVIGABLE: the public login and the shell's tabs, with the tenant's
 * name, logo and colours (inherited from the screen's `--brand-*`) and the tabs and Início slots its
 * ENABLED modules produce, through the kernel's own `buildNav` over a front mirror of the manifests.
 *
 * Content is the REAL presentational components — `TenantLogo`, `StoriesStrip`, `PostCard`,
 * `ProfileHeader` — with sample copy from the catalog and no asset id, so nothing requests media.
 * The sample pictures are `PreviewArt` mockups in the tenant's colours (white and gray around
 * them), shown the way an uploaded picture shows: the post's media, and the covers of twins of
 * `EventPoster` and `CommunityCard` on their PHOTO branch (veil, white type), because the real
 * cards only take an asset id and fall back to the brand gradient. The shell
 * itself is a twin of `TopBar`/`BottomNav` (same classes, geometry and scroll reaction): the real
 * ones are `fixed`, `md:hidden` and routed with `next/link` + `usePathname`, which inside the panel
 * would hide on a desktop window and navigate the panel.
 *
 * Navigation stays inside the device: the twins call `onNavigate`, and the app's own links (the
 * modules' cards are plain `<a>`) are cancelled before the browser follows them and mapped through
 * `screenForHref`, so nothing in here can reload or move the panel. The like answers locally, and
 * the login fields take text and "Entrar" opens Início.
 *
 * Over Início rises the app's "Complete seu perfil" popup (the D-02 nudge, a popup since
 * 2026-10-02): the real `ProfileNudgeDialog` in its `preview` form, absolute over this root (never
 * fixed to the panel), 500 ms after Início appears, as `ProfileNudgeOnArrival` raises it in the
 * app (`usePreviewNudge`). Either answer ends it for the preview's visit ("Completar agora" also
 * opens the profile), and the login's "Entrar" makes it due again, as a submitted sign-in does in
 * the app (`RearmProfileNudge`); the login screen merely shown does not. Leaving Início while it is
 * up answers it too: past its scrim only the panel's screen picker can, and that is how a keyboard
 * gets it off the phone. While it is up, the twin tab bar steps aside, as tokens.css hides the
 * app's BottomNav under an `aria-modal` (the preview's copy carries none: this root is
 * `aria-hidden`).
 *
 * Two views (`view`): the member's app, and the tenant admin's, which adds what the admin's
 * permissions turn on in the real app on these screens: the compose button and the "Seu story" /
 * "Gerenciar" circles on Início, the author rows of the post sheet, the create controls of
 * Comunidades and Eventos (plus the Ativas / Arquivadas filter) and the Reels empty state's call to
 * action. They are SHOWN only (`data-preview-admin`): none opens a form, and nothing is published.
 *
 * Still nothing is exposed to assistive tech: the app root is `aria-hidden` and every focusable it
 * renders is kept out of the tab order; the panel's screen picker is the accessible way to the same
 * screens. Ids and labels stay distinct from the creation form's.
 */
export function TenantAppPreview({
  name,
  logoUrl,
  modules,
  screen,
  view = 'member',
  theme = 'light',
  onTheme,
  onNavigate,
}: TenantAppPreviewProps) {
  const t = useTranslations();
  const rootRef = useRef<HTMLDivElement>(null);
  // The profile popup's visit: due when the device opens, ended by an answer (or by the picker
  // leaving Início under it), due again after the login's "Entrar".
  const nudge = usePreviewNudge(screen === 'home');
  const go = useCallback((target: PreviewScreen) => onNavigate?.(target), [onNavigate]);
  usePreviewRouting(rootRef, go);

  const effective = previewEffectiveModules(modules);
  const tabs = buildNav(previewNavModules(effective), {
    home: t('app.nav.home'),
    profile: t('app.nav.profile'),
    module: (key, fallback) => (t.has(`${key}.nav`) ? t(`${key}.nav`) : fallback),
  });
  // The sample Eventos screen always lists an event for tomorrow, so its tab carries the red dot the
  // app draws while an event is to come (2026-10-03, where Início had the next-event card). Without
  // the module there is no Eventos tab, and `withTabDots` ignores the key.
  const nav = withTabDots(tabs, { events: t('events.tabDot') });

  const media = screen === 'reels';
  const admin = view === 'admin';
  const slots = previewHomeSlots(effective);
  // ONE root for every screen: the routing listeners above are bound to this node.
  return (
    <div
      ref={rootRef}
      aria-hidden
      data-preview-view={view}
      data-preview-screen={screen}
      className="absolute inset-0 bg-bg"
    >
      {screen === 'login' ? (
        <div className="flex h-full flex-col items-center justify-center p-4">
          <PreviewLogin
            name={name}
            logoUrl={logoUrl}
            onEnter={() => {
              // A sign-in: a new visit, in which the profile popup is due again on Início.
              nudge.signIn();
              go('home');
            }}
          />
        </div>
      ) : (
        <>
          <GlassFilter />
          {media ? null : (
            <PreviewTopBar
              name={name}
              logoUrl={logoUrl}
              onProfile={screen === 'profile'}
              onNavigate={go}
            />
          )}
          {/* Keyed by screen: a tab opens at its top, as a route change does in the app. */}
          <div
            key={screen}
            tabIndex={-1}
            className={cn(
              'app-scroll absolute inset-0 pb-[calc(var(--safe-bottom)+5.25rem)]',
              media ? 'pb-0' : 'pt-[calc(var(--safe-top)+3.5rem)]',
            )}
          >
            {screen === 'home' ? (
              <PreviewHome name={name} logoUrl={logoUrl} slots={slots} admin={admin} />
            ) : screen === 'communities' ? (
              <PreviewCommunities admin={admin} />
            ) : screen === 'events' ? (
              <PreviewEvents admin={admin} />
            ) : screen === 'reels' ? (
              <PreviewReels name={name} admin={admin} />
            ) : screen === 'settings' ? (
              <PreviewSettings
                admin={admin}
                stories={effective.includes('stories')}
                dark={theme === 'dark'}
                onTheme={onTheme}
                onNavigate={go}
              />
            ) : (
              <PreviewProfile />
            )}
          </div>
          {admin && screen === 'home' && slots.includes('feed') ? <PreviewComposeFab /> : null}
          <PreviewBottomNav
            tabs={nav.tabs}
            active={screen}
            media={media}
            hidden={nudge.open}
            onNavigate={go}
          />
          <ProfileNudgeDialog
            preview
            open={nudge.open}
            onComplete={() => {
              nudge.answer();
              go('profile');
            }}
            onLater={nudge.answer}
          />
        </>
      )}
    </div>
  );
}

/**
 * Keeps the app's navigation inside the device. Capture listeners on the app root run before the
 * links' own handlers: a click on any `a[href]` is cancelled and mapped to a preview screen (a route
 * the preview does not emulate does nothing), and the middle click and the context menu of a link
 * are cancelled too, so no "open in a new tab" reaches the panel's host. Every focusable the app
 * renders, now or after a re-render, is held at `tabindex="-1"`: the root is `aria-hidden`.
 */
function usePreviewRouting(
  rootRef: RefObject<HTMLDivElement | null>,
  go: (screen: PreviewScreen) => void,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const linkOf = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      return link && root.contains(link) ? link : null;
    };
    const follow = (event: MouseEvent) => {
      const link = linkOf(event);
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      const target = screenForHref(link.getAttribute('href') ?? '');
      if (target) go(target);
    };
    const block = (event: MouseEvent) => {
      if (!linkOf(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';
    const unfocusable = () => {
      for (const node of root.querySelectorAll(FOCUSABLE)) {
        if (node.getAttribute('tabindex') !== '-1') node.setAttribute('tabindex', '-1');
      }
    };
    unfocusable();
    const observer = new MutationObserver(unfocusable);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['tabindex', 'href'],
    });

    root.addEventListener('click', follow, true);
    root.addEventListener('auxclick', block, true);
    root.addEventListener('contextmenu', block, true);
    return () => {
      observer.disconnect();
      root.removeEventListener('click', follow, true);
      root.removeEventListener('auxclick', block, true);
      root.removeEventListener('contextmenu', block, true);
    };
  }, [rootRef, go]);
}

/** The refraction filter `.glass-bar` resolves by id; the app shell mounts it once, so does the device. */
function GlassFilter() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute h-0 w-0">
      <filter id="liquid-glass" x="-60%" y="-60%" width="220%" height="220%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.004 0.009"
          numOctaves="1"
          seed="7"
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale="290"
          xChannelSelector="R"
          yChannelSelector="G"
          result="d"
        />
        <feGaussianBlur in="d" stdDeviation="0.6" result="b" />
        <feColorMatrix
          in="b"
          type="matrix"
          values="1.25 0 0 0 0  0 1.25 0 0 0  0 0 1.25 0 0  0 0 0 1 0"
        />
      </filter>
    </svg>
  );
}

/** Twin of the kernel `TopBar` (same classes), absolute inside the device instead of fixed. */
function PreviewTopBar({
  name,
  logoUrl,
  onProfile,
  onNavigate,
}: {
  name: string;
  logoUrl: string | null;
  onProfile: boolean;
  onNavigate: (screen: PreviewScreen) => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-50 border-b border-border bg-bg-secondary pt-[var(--safe-top)]">
      <div className="flex h-12 items-center justify-between px-4">
        {/* The logo ALONE, as in the app's TopBar (2026-10-02); the name only without a logo or
            when it fails to load. `data-preview-title`: that name, the bar's only text, takes the
            tenant's title font, so the font shows here only when there is no logo. Its COLOUR is
            its own (`data-preview-app-name`), never the titles' one: globals.css keeps the two
            rules apart. `min-w-11` is the TopBar's 44px floor under a square logo, mirrored like
            every other class. */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          data-preview-title
          data-preview-app-name
          className="flex h-11 min-w-11 items-center"
        >
          <TenantLogo logoUrl={logoUrl} displayName={name} size="topbar" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate('profile')}
          className={cn(
            'inline-flex rounded-full border-2 transition-colors active:opacity-80',
            onProfile ? 'border-brand' : 'border-transparent',
          )}
        >
          <Avatar size="sm" alt="" />
        </button>
      </div>
    </div>
  );
}

/**
 * Twin of the kernel `BottomNav` pill (same classes, geometry and scroll reaction), absolute inside
 * the device. The reaction listens in the capture phase on the app root, the device's own document:
 * shrink after 20 px down, restore after 10 px up, always full above 48 px, restored on a tab change.
 * `data-scroll-through`: a drag that starts on the pill scrolls the page under it. `hidden`: the
 * profile popup is up, the moment tokens.css takes the app's BottomNav away. A tab with a `dot`
 * (Eventos) draws the app's red dot on its icon's corner.
 */
function PreviewBottomNav({
  tabs,
  active,
  media,
  hidden,
  onNavigate,
}: {
  tabs: NavItem[];
  active: PreviewScreen;
  media: boolean;
  hidden: boolean;
  onNavigate: (screen: PreviewScreen) => void;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    const root = navRef.current?.parentElement;
    if (!root) return;
    let lastEl: EventTarget | null = null;
    let lastY = 0;
    let acc = 0;

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('app-scroll')) return;
      const y = el.scrollTop;
      // A different scroller (a new tab): register the position without judging direction.
      if (el !== lastEl) {
        lastEl = el;
        lastY = y;
        return;
      }
      const dy = y - lastY;
      lastY = y;
      acc = Math.max(-48, Math.min(48, acc + dy));

      if (y < 48) {
        setShrunk(false);
        acc = 0;
      } else if (acc > 20) {
        setShrunk(true);
      } else if (acc < -10) {
        setShrunk(false);
      }
    };

    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => root.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab change restores the whole bar
  useEffect(() => {
    setShrunk(false);
  }, [active]);

  return (
    <div
      ref={navRef}
      data-scroll-through
      data-theme={media ? 'dark' : undefined}
      className={cn(
        'glass-bar absolute left-3.5 z-50 flex items-center rounded-full px-1.5 py-1',
        hidden && 'hidden',
      )}
      style={{
        width: 'calc(100% - 28px)',
        bottom: 'calc(var(--safe-bottom) + 8px)',
        transform: shrunk ? 'translateY(12px) scale(0.78)' : 'translateY(0) scale(1)',
        transformOrigin: '50% 100%',
        opacity: shrunk ? 0.92 : 1,
        transition: `width 0.26s ${EASE}, transform 0.3s ${EASE}, opacity 0.3s ${EASE}`,
      }}
    >
      {tabs.map((tab) => {
        const Icon = iconFor(tab.icon);
        const target = screenOfTab(tab.key);
        const isActive = target === active;
        return (
          <button
            key={tab.key}
            type="button"
            data-preview-tab={tab.key}
            aria-label={tab.label}
            onClick={() => {
              if (target) onNavigate(target);
            }}
            className="grid min-w-0 flex-1 place-items-center overflow-hidden py-1.5"
          >
            <span
              className={cn(
                'relative grid h-11 w-[50px] place-items-center rounded-full transition-colors',
                isActive ? 'bg-[var(--theme-chip)] text-brand' : 'text-text-tertiary',
              )}
            >
              <Icon aria-hidden size={23} strokeWidth={isActive ? 2.3 : 1.7} fill="none" />
              {tab.dot ? (
                <span aria-hidden className="absolute top-0.5 right-1.5">
                  <Badge count={1} variant="dot" />
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * `/entrar` of the tenant host: brand block, tenant line, title, the two fields, CTA, sign-up. The
 * fields take text but are no login form to a browser: no `type="password"` (the dots come from
 * `text-security`) and no autocomplete, so no password manager fills or saves anything in here.
 * "Entrar", Enter in a field and "Criar conta" all open Início, as a member would land there, and
 * each is a sign-in: the profile popup is due again (`usePreviewNudge`).
 */
function PreviewLogin({
  name,
  logoUrl,
  onEnter,
}: {
  name: string;
  logoUrl: string | null;
  onEnter: () => void;
}) {
  const t = useTranslations();
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onEnter();
  };
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-8">
      {/* The logo as `size="auth"` caps it; without one, the name exactly as `AuthBrand` draws it on
          /entrar, marked like the top bar's (2026-10-03): the app draws it in the tenant's title
          font and app-name ink there too (globals.css, `auth-brand-name`). */}
      {logoUrl ? (
        <TenantLogo logoUrl={logoUrl} displayName={name} size="auth" />
      ) : (
        <p
          data-preview-title
          data-preview-app-name
          className="max-w-full break-words text-center text-2xl font-bold tracking-[-0.02em] text-text"
        >
          {name}
        </p>
      )}
      <div className="flex w-full flex-col gap-6">
        <p className="break-words text-center text-sm text-text-secondary">
          {t('login.tenantHint', { tenant: name })}
        </p>
        <p
          className={
            logoUrl
              ? 'text-center text-base font-bold text-text-secondary'
              : 'text-center text-2xl font-bold tracking-[-0.02em] text-text'
          }
        >
          {t('login.title')}
        </p>
        <div className="flex flex-col gap-4">
          <Input
            id="device-preview-email"
            icon={Mail}
            placeholder={t('login.email')}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            onKeyDown={submitOnEnter}
          />
          <Input
            id="device-preview-password"
            icon={Lock}
            placeholder={t('login.password')}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="[-webkit-text-security:disc]"
            onKeyDown={submitOnEnter}
          />
          <Button type="button" variant="brand" size="lg" fullWidth onClick={onEnter}>
            {t('login.submit')}
          </Button>
          <span className="text-center text-sm font-bold text-brand">{t('login.forgot')}</span>
        </div>
        <div className="flex w-full items-center gap-4">
          <span className="h-px flex-1 bg-border" />
          <span className="text-sm text-text-tertiary">{t('common.or')}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="outline" size="lg" fullWidth onClick={onEnter}>
          {t('login.createAccount')}
        </Button>
      </div>
    </div>
  );
}

/**
 * `/inicio`: the enabled modules' slots in order (no welcome block, and no nudge card: the profile
 * nudge is the popup the app root raises over this screen), in the real page's REINE timeline
 * layout: no side gutter, the stories in their full-bleed band, the posts edge to edge, the empty
 * state inset by `px-4`. Only the slots the app renders: Eventos still declares one (the mirror
 * keeps its manifest), but the app draws its next event as the tab's dot since 2026-10-03, so a
 * slot with no renderer here is skipped and, with none left, the empty state shows, as on
 * `/inicio`.
 */
function PreviewHome({
  name,
  logoUrl,
  slots,
  admin,
}: {
  name: string;
  logoUrl: string | null;
  slots: string[];
  admin: boolean;
}) {
  const t = useTranslations();
  const render: Record<string, () => ReactNode> = {
    stories: () => <PreviewStories key="stories" name={name} logoUrl={logoUrl} admin={admin} />,
    feed: () => <PreviewFeed key="feed" name={name} logoUrl={logoUrl} admin={admin} />,
  };
  const rendered = slots.filter((key) => Object.hasOwn(render, key));
  return (
    <div className="flex flex-col gap-3 pb-4">
      {rendered.length > 0 ? (
        rendered.map((key) => render[key]?.() ?? null)
      ) : (
        <div className="px-4">
          <EmptyState
            variant="card"
            icon={Sparkles}
            title={t('app.home.soonTitle')}
            body={t('app.home.soonBody', { tenant: name })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The Início stories row. The admin view adds the two circles its story permissions turn on: "Seu
 * story" first (`stories.story.publish`: a centred plus on the dashed ring) and "Gerenciar" last
 * (`stories.story.manage`: the dashed ring with the pencil), the same "only you see this" pair as
 * the app (UI-D-63). Shown only: every circle here is static, nothing opens or publishes.
 */
function PreviewStories({
  name,
  logoUrl,
  admin,
}: {
  name: string;
  logoUrl: string | null;
  admin: boolean;
}) {
  const t = useTranslations();
  const highlight = (key: string, title: string): StoryStripCircle => ({
    key,
    kind: 'static',
    label: title,
    actionLabel: t('stories.circle.highlight', { title }),
    ring: 'neutral',
    disc: { kind: 'monogram', text: title },
  });
  const circles: StoryStripCircle[] = [
    {
      key: 'tenant',
      kind: 'static',
      label: name,
      actionLabel: t('stories.circle.tenant', { tenant: name }),
      ring: 'brand',
      disc: logoUrl ? { kind: 'logo', src: logoUrl } : { kind: 'monogram', text: name },
    },
    highlight('one', t('platform.devicePreview.sample.highlightOne')),
    highlight('two', t('platform.devicePreview.sample.highlightTwo')),
  ];
  if (admin) {
    circles.unshift({
      key: 'own',
      kind: 'static',
      label: t('stories.own.label'),
      actionLabel: t('stories.own.action'),
      ring: 'dashed',
      disc: { kind: 'own' },
    });
    circles.push({
      key: 'manage',
      kind: 'static',
      label: t('stories.highlights.circle.label'),
      actionLabel: t('stories.highlights.circle.actionHome'),
      ring: 'dashed',
      disc: { kind: 'glyph', icon: <Pencil aria-hidden size={20} /> },
    });
  }
  return (
    <StoriesBand>
      <StoriesStrip circles={circles} regionLabel={t('stories.region')} />
    </StoriesBand>
  );
}

/**
 * The feed slot with one sample post by the tenant. Its "…" opens the post sheet as on a tenant host:
 * "Copiar link" for everyone, and in the admin view also "Editar publicação" and "Excluir publicação"
 * (the post's author is the admin: in V1 only admins post).
 */
function PreviewFeed({
  name,
  logoUrl,
  admin,
}: {
  name: string;
  logoUrl: string | null;
  admin: boolean;
}) {
  const t = useTranslations();
  const [menu, setMenu] = useState(false);
  const labels: PostCardLabels = {
    more: t('feed.caption.more'),
    like: t('feed.actions.like'),
    unlike: t('feed.actions.unlike'),
    comment: t('feed.actions.comment'),
    share: t('feed.actions.share'),
    moreOptions: t('feed.actions.more'),
    likes: { one: t.raw('feed.meta.likes.one'), other: t.raw('feed.meta.likes.other') },
    comments: { one: t.raw('feed.meta.comments.one'), other: t.raw('feed.meta.comments.other') },
    edited: t('feed.meta.edited'),
    media: { carousel: t('feed.gallery.carousel'), attachmentError: t('feed.errors.generic') },
  };
  const post: PostCardView = {
    id: 'device-preview-post',
    caption: t('platform.devicePreview.sample.postCaption', { tenant: name }),
    author: { displayName: name, profileHref: '/membros', avatarUrl: logoUrl },
    createdAtIso: '2026-01-01T10:00:00.000Z',
    createdAtRelative: t('platform.devicePreview.sample.postTime'),
    createdAtAbsolute: t('platform.devicePreview.sample.postTimeAbsolute'),
    community: null,
    shareUrl: null,
    edited: false,
    canManage: admin,
    editHref: admin ? '/post/device-preview-post/editar' : null,
    likeCount: 24,
    commentCount: 3,
    viewerLiked: false,
    ariaLabel: t('feed.post.label', { name }),
    media: {
      mediaKind: 'video',
      images: [],
      attachments: [],
      video: (
        <div className="relative aspect-[4/5] w-full overflow-hidden">
          <PreviewArt scene="welcome" />
        </div>
      ),
    },
  };
  return (
    <div className="flex flex-col gap-6">
      <PostCard
        post={post}
        captionTruncateAt={140}
        locale="pt-BR"
        labels={labels}
        onLike={localLike}
        onUnlike={localUnlike}
        onMore={() => setMenu(true)}
      />
      <PreviewPostMenu open={menu} admin={admin} onClose={() => setMenu(false)} />
    </div>
  );
}

/**
 * The post sheet (`PostMenu`, on the shared `BottomSheet`, which inside the device covers only its
 * screen). Shown only: every row just closes the sheet; nothing is edited, copied or deleted.
 */
function PreviewPostMenu({
  open,
  admin,
  onClose,
}: {
  open: boolean;
  admin: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div data-preview-post-menu className="flex flex-col gap-1">
        {admin ? (
          <PreviewMenuRow
            icon={Pencil}
            label={t('feed.menu.edit')}
            marker="post-edit"
            onClick={onClose}
          />
        ) : null}
        <PreviewMenuRow icon={Link2} label={t('feed.share.copyLink')} onClick={onClose} />
        {admin ? (
          <PreviewMenuRow
            icon={Trash2}
            label={t('feed.menu.delete')}
            marker="post-delete"
            destructive
            onClick={onClose}
          />
        ) : null}
      </div>
    </BottomSheet>
  );
}

/** One row of the post sheet (`PostMenu`'s `MenuRow` geometry: icon 20, 14/700, danger tone). */
function PreviewMenuRow({
  icon: Icon,
  label,
  marker,
  destructive = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  marker?: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-preview-admin={marker}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition-colors hover:bg-bg-hover active:bg-bg-tertiary',
        destructive ? 'text-danger' : 'text-text',
      )}
    >
      <Icon aria-hidden size={20} className="shrink-0" />
      {label}
    </button>
  );
}

/**
 * The feed's compose button (`ComposeFab`), which `feed.post.create` turns on: a 56 px circle in
 * the button colour above the right end of the tab bar, on Início. Shown only: it opens no
 * composer.
 */
function PreviewComposeFab() {
  const t = useTranslations();
  return (
    <button
      type="button"
      data-preview-admin="compose"
      aria-label={t('feed.empty.cta')}
      className="absolute right-4 bottom-[calc(var(--safe-bottom)+5.25rem)] z-40 grid h-14 w-14 place-items-center rounded-full bg-button bg-(image:--button-image) text-on-button shadow-lg transition-transform active:scale-95"
    >
      <Plus aria-hidden size={24} />
    </button>
  );
}

/**
 * `/comunidades` on a phone. The admin view adds what `communities.community.manage` turns on there:
 * the create control at the end of the title row and the Ativas / Arquivadas filter (a member gets
 * the active list only, under the bare title).
 */
function PreviewCommunities({ admin }: { admin: boolean }) {
  const t = useTranslations();
  const card = (
    key: string,
    title: string,
    body: string,
    count: number,
    scene: PreviewArtScene,
  ) => (
    <PreviewCommunityCard
      key={key}
      name={title}
      description={body}
      postCountLabel={t('communities.card.posts', { count })}
      scene={scene}
    />
  );
  return (
    <div className="flex flex-col pb-6">
      <PreviewListHeader
        title={t('communities.list.title')}
        subtitle={t('communities.list.subtitle')}
        create={
          admin ? { label: t('communities.actions.create'), marker: 'communities-create' } : null
        }
      />
      {admin ? (
        <PreviewFilterChips
          options={[t('communities.list.filter.active'), t('communities.list.filter.archived')]}
        />
      ) : null}
      <div className="flex flex-col gap-3 px-4">
        {card(
          'one',
          t('platform.devicePreview.sample.communityOne'),
          t('platform.devicePreview.sample.communityOneBody'),
          8,
          'board',
        )}
        {card(
          'two',
          t('platform.devicePreview.sample.communityTwo'),
          t('platform.devicePreview.sample.communityTwoBody'),
          3,
          'meetup',
        )}
      </div>
    </div>
  );
}

/**
 * `/eventos` on a phone (2026-10-03, the REINE galleries): "Meus eventos" with the sample the member
 * confirmed (`Inscrito` and its countdown) and "Outros eventos" with two more (their dates), each a
 * row that scrolls sideways under its title in the brand's ink; the titles take the tenant's title
 * font and colour like every marked title here. The admin view adds the create control
 * `events.event.manage` turns on, beside the first title as in the app.
 */
function PreviewEvents({ admin }: { admin: boolean }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col pt-4 pb-6">
      <PreviewGallery
        title={t('events.sections.mine.title')}
        subtitle={t('events.sections.mine.subtitle')}
        action={
          admin ? (
            <PreviewCreateButton label={t('events.actions.create')} marker="events-create" />
          ) : null
        }
      >
        <PreviewEventPoster
          title={t('platform.devicePreview.sample.eventTitle')}
          category={t('events.card.inPerson')}
          place={t('platform.devicePreview.sample.eventPlace')}
          online={false}
          badge={{ registered: true, label: t('events.card.registered') }}
          note={t('events.card.countdown', { count: 1 })}
          scene="stage"
        />
      </PreviewGallery>
      <PreviewGallery
        title={t('events.sections.others.title')}
        subtitle={t('events.sections.others.subtitle')}
      >
        <PreviewEventPoster
          title={t('platform.devicePreview.sample.eventTwoTitle')}
          category={t('events.card.online')}
          place={t('events.place.online')}
          online
          badge={{ registered: false, label: t('platform.devicePreview.sample.eventTwoDate') }}
          scene="call"
        />
        <PreviewEventPoster
          title={t('platform.devicePreview.sample.eventThreeTitle')}
          category={t('events.card.inPerson')}
          place={t('platform.devicePreview.sample.eventPlace')}
          online={false}
          badge={{ registered: false, label: t('platform.devicePreview.sample.eventThreeDate') }}
          scene="meetup"
        />
      </PreviewGallery>
    </div>
  );
}

/** Twin of a `/eventos` gallery: its header and the row of posters that scrolls sideways. */
function PreviewGallery({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p data-preview-title className="text-sm font-bold uppercase tracking-wider text-brand">
            {title}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 scrollbar-none">
        {children}
      </div>
    </div>
  );
}

/**
 * Twin of `EventPoster` on its PHOTO branch (`EventCover` with an image): the 256px slot, the 4:5
 * box, the poster's veil, the white text block at the bottom and the pill at the top left, with a
 * `PreviewArt` scene as the picture: the cover a tenant uploads, instead of the gradient of a
 * coverless event.
 */
function PreviewEventPoster({
  title,
  category,
  place,
  online,
  badge,
  note,
  scene,
}: {
  title: string;
  category: string;
  place: string;
  online: boolean;
  badge: { registered: boolean; label: string };
  note?: string;
  scene: PreviewArtScene;
}) {
  const PlaceIcon = online ? Video : MapPin;
  return (
    <a
      href="/eventos"
      className="block w-64 shrink-0 rounded-xl transition-opacity active:opacity-80"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl">
        <PreviewArt scene={scene} />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
        />
        <div className="absolute right-3.5 bottom-3 left-3.5">
          <p className="truncate text-[11px] font-bold uppercase tracking-wider text-white/75">
            {category}
          </p>
          <p
            data-preview-title
            className="mt-1 line-clamp-2 text-[15px] font-bold leading-tight text-white"
          >
            {title}
          </p>
          <p className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-white/70">
            <PlaceIcon size={11} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate">{place}</span>
          </p>
          {note ? (
            <p className="mt-1.5 text-[11px] font-bold tabular-nums text-white">{note}</p>
          ) : null}
        </div>
        <span className="absolute top-3 left-3">
          <span
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-full uppercase',
              badge.registered
                ? 'bg-button bg-(image:--button-image) px-3 py-1 text-[11px] font-semibold tracking-[0.5px] text-on-button'
                : 'bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white backdrop-blur-sm',
            )}
          >
            {badge.label}
          </span>
        </span>
      </div>
    </a>
  );
}

/**
 * Twin of `CommunityCard` on its PHOTO branch (`CommunityCover` card geometry with an image): the
 * 16:7 cover with the card's veil and the white name and description, then the counts row, with a
 * `PreviewArt` scene as the cover.
 */
function PreviewCommunityCard({
  name,
  description,
  postCountLabel,
  scene,
}: {
  name: string;
  description: string;
  postCountLabel: string;
  scene: PreviewArtScene;
}) {
  return (
    <Card>
      <a href="/comunidades" className="block">
        <div className="relative aspect-[16/7] w-full overflow-hidden">
          <PreviewArt scene={scene} />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
          />
          <div className="absolute right-4 bottom-3 left-4">
            <p data-preview-title className="truncate text-base font-bold text-white">
              {name}
            </p>
            <p className="line-clamp-1 text-xs font-normal text-white/80">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-3">
          <MessageCircle size={16} aria-hidden className="shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-text-tertiary tabular-nums">
            {postCountLabel}
          </span>
          <ChevronRight size={18} aria-hidden className="shrink-0 text-text-tertiary" />
        </div>
      </a>
    </Card>
  );
}

/**
 * Reels in the media chrome, as `ReelsHost` renders a lane with no video: the dark stage of
 * `ReelsStage` (black, its own dark scope) and the plain `EmptyState` centred on it. The admin view
 * adds its call to action (`feed.post.create`: "Criar publicação", a link to the composer in the app;
 * shown only here).
 */
function PreviewReels({ name, admin }: { name: string; admin: boolean }) {
  const t = useTranslations();
  return (
    <div
      data-theme="dark"
      className="relative h-[var(--screen-h)] overflow-hidden bg-black text-white"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState
          variant="plain"
          icon={Film}
          title={t('reels.empty.title')}
          body={t('reels.empty.body', { tenant: name })}
          action={
            admin ? (
              <Button
                type="button"
                variant="brand"
                size="md"
                data-preview-admin="reels-create"
                className="focus-visible:ring-white focus-visible:ring-offset-0"
              >
                {t('feed.empty.cta')}
              </Button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * `/perfil` on the phone: the profile header with the e-mail and the three settings rows. A tab
 * page, so no sub-header (the app dropped its "< Perfil" bar on 2026-10-09). The rows are the real
 * links; the preview follows the ones it emulates ("Configurações" opens the settings screen).
 */
function PreviewProfile() {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        displayName={t('platform.devicePreview.sample.memberName')}
        avatarAssetId={null}
        bio={t('platform.devicePreview.sample.memberBio')}
        email={t('platform.devicePreview.sample.memberEmail')}
      />
      <Card className="rounded-none bg-transparent shadow-none">
        <PreviewRow
          href="/perfil/editar"
          icon="user-circle"
          label={t('profile.rows.editProfile')}
        />
        <PreviewRow href="/membros" icon="users" label={t('profile.rows.members')} />
        <PreviewRow href="/configuracoes" icon="settings" label={t('profile.rows.settings')} />
      </Card>
    </div>
  );
}

/** The settings-row geometry of `/perfil` (icon 20, 14 px label, chevron 18). */
function PreviewRow({ href, icon, label }: { href: string; icon: string; label: string }) {
  const Icon = iconFor(icon);
  const Chevron = iconFor('chevron-right');
  return (
    <a
      href={href}
      className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-text transition-colors hover:bg-bg-hover"
    >
      <Icon aria-hidden size={20} className="shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Chevron aria-hidden size={18} className="shrink-0 text-text-tertiary" />
    </a>
  );
}

/**
 * Twin of the app's sticky `PageHeader` (back control, 16/700 title) with a `<p>` instead of the
 * screen's `h1`: the panel page has its own. `top: -0.5rem`, the primitive's default: a sticky
 * offset counts from the scroller's padded content edge, and this scroller copies the shell's
 * padding (`safe-top + 3.5rem`) under a twin TopBar ending at `safe-top + 3rem`, so the header pins
 * flush under it once the screen scrolls. The primitive's `md:static` is left out on purpose: `md:`
 * reads the panel's window, and the device is always a phone.
 */
function PreviewSubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div
      className="sticky z-40 flex items-center gap-1 bg-bg/95 px-2 py-1 backdrop-blur-sm"
      style={{ top: '-0.5rem' }}
    >
      <button
        type="button"
        onClick={onBack}
        className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary"
      >
        <ChevronLeft aria-hidden size={22} />
      </button>
      <p className="flex-1 truncate text-base font-bold text-text">{title}</p>
    </div>
  );
}

/** The app's version line, as `/configuracoes` reads it (a public build variable, or "dev"). */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

/**
 * `/configuracoes` on a phone, as the real page renders it on a tenant host: Conta, Preferências,
 * Sobre and "Sair", plus the Administração group in the admin view (Mídia, the role's row; Seus
 * stories only with the stories module on, as `stories.story.manage` needs it; both shown only). Two rows act on the preview itself: "Tema escuro" switches the device's theme, and "Sair"
 * opens the login screen, which is how the preview reaches it.
 */
function PreviewSettings({
  admin,
  stories,
  dark,
  onTheme,
  onNavigate,
}: {
  admin: boolean;
  /** The stories module is on: the only way the admin has `stories.story.manage`. */
  stories: boolean;
  dark: boolean;
  onTheme?: (theme: PreviewTheme) => void;
  onNavigate: (screen: PreviewScreen) => void;
}) {
  const t = useTranslations();
  const Logout = iconFor('log-out');
  return (
    <div className="flex flex-col gap-4">
      <PreviewSubHeader title={t('app.settings.title')} onBack={() => onNavigate('home')} />
      <Card className="rounded-none bg-transparent shadow-none">
        <PreviewSettingsGroup title={t('app.settings.groups.account')} first>
          <PreviewSettingsRow
            icon="user-circle"
            label={t('app.settings.rows.editProfile')}
            href="/perfil/editar"
          />
        </PreviewSettingsGroup>
        <PreviewSettingsGroup title={t('app.settings.groups.preferences')}>
          <PreviewSettingsRow
            icon="moon"
            label={t('app.settings.rows.darkTheme')}
            trailing={
              <Switch
                checked={dark}
                onChange={(on) => onTheme?.(on ? 'dark' : 'light')}
                label={t('app.settings.rows.darkTheme')}
              />
            }
          />
          <PreviewSettingsRow
            icon="bell"
            label={t('app.settings.rows.notifications')}
            trailing={<StatusPill tone="neutral">{t('app.settings.soon')}</StatusPill>}
          />
        </PreviewSettingsGroup>
        {admin ? (
          <PreviewSettingsGroup title={t('app.settings.groups.admin')} marker="settings-admin">
            <PreviewSettingsRow
              icon="film"
              label={t('app.settings.rows.media')}
              href="/configuracoes/midia"
            />
            {stories ? (
              <PreviewSettingsRow
                icon="sparkles"
                label={t('app.settings.rows.stories')}
                href="/stories/meus"
              />
            ) : null}
          </PreviewSettingsGroup>
        ) : null}
        <PreviewSettingsGroup title={t('app.settings.groups.about')}>
          <PreviewSettingsRow
            icon="info"
            label={t('app.settings.rows.version', { version: APP_VERSION })}
          />
        </PreviewSettingsGroup>
        <div className="border-t border-border p-4">
          <Button
            type="button"
            variant="ghost"
            fullWidth
            data-preview-logout
            className="text-danger"
            onClick={() => onNavigate('login')}
          >
            <Logout aria-hidden size={18} />
            {t('app.logout')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** A group of `/configuracoes` (its 14/700 title, a hairline above every group but the first). */
function PreviewSettingsGroup({
  title,
  first = false,
  marker,
  children,
}: {
  title: string;
  first?: boolean;
  marker?: string;
  children: ReactNode;
}) {
  return (
    <div data-preview-admin={marker} className={first ? undefined : 'border-t border-border'}>
      <p className="px-4 pt-4 pb-2 text-sm font-bold text-text-secondary">{title}</p>
      {children}
    </div>
  );
}

/**
 * A row of `/configuracoes` (icon 20, 14 px label, trailing slot): a link with the chevron when it
 * navigates, a plain row with its own control otherwise.
 */
function PreviewSettingsRow({
  icon,
  label,
  href,
  trailing,
}: {
  icon: string;
  label: string;
  href?: string;
  trailing?: ReactNode;
}) {
  const Icon = iconFor(icon);
  const Chevron = iconFor('chevron-right');
  const inner = (
    <>
      <Icon aria-hidden size={20} className="shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-sm text-text">{label}</span>
      {href ? <Chevron aria-hidden size={18} className="shrink-0 text-text-tertiary" /> : trailing}
    </>
  );
  return href ? (
    <a
      href={href}
      className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-bg-hover"
    >
      {inner}
    </a>
  ) : (
    <div className="flex w-full items-center gap-3 px-4 py-3.5">{inner}</div>
  );
}

/**
 * The title row of `/comunidades` (title 24/700, subtitle) and, in the admin view, the create
 * control at its end (`PreviewCreateButton`).
 */
function PreviewListHeader({
  title,
  subtitle,
  create,
}: {
  title: string;
  subtitle: string;
  create: { label: string; marker: string } | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
      <div className="min-w-0 flex-1">
        <p
          data-preview-title
          className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
        >
          {title}
        </p>
        <p className="mt-1 text-sm font-normal text-text-secondary">{subtitle}</p>
      </div>
      {create ? <PreviewCreateButton label={create.label} marker={create.marker} /> : null}
    </div>
  );
}

/**
 * The admin view's create control of `/comunidades` and `/eventos`, as a phone renders it (below
 * `sm`: a 44 px button square with the Plus, the label for screen readers only). The real control
 * links to the create form; this one is shown only: it creates nothing and goes nowhere.
 */
function PreviewCreateButton({ label, marker }: { label: string; marker: string }) {
  return (
    <button
      type="button"
      data-preview-admin={marker}
      className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover)"
    >
      <Plus aria-hidden size={20} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** A list page's filter row with its first option current (the preview has one list per screen). */
function PreviewFilterChips({ options }: { options: string[] }) {
  return (
    <div className="flex gap-2 px-4 pb-3">
      {options.map((label, index) => (
        <Chip key={label} active={index === 0}>
          {label}
        </Chip>
      ))}
    </div>
  );
}
