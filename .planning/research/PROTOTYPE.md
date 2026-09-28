# Prototype Map: `reference/frontend-design` → modular monorepo

**Analysis Date:** 2026-09-11
**Source:** `./reference/frontend-design` (read-only; git HEAD `05f68b1`)
**Decision context:** the prototype is the visual/UX source of truth. It is NOT refactored in place; screens and components are ported into `packages/core/ui`, `packages/ui` and `packages/modules/<feature>/ui` as each vertical phase is built (see `.planning/research/ARCHITECTURE.md`, "Recommended Project Structure").

The prototype is a single-tenant demo for one creator ("Dr. Igor Alves", facial-harmonization clinic). It is a consumption-only app: the creator publishes, members consume. That matches V1's "admin publishes, members consume" model well, but the data model underneath is an Instagram-style social graph plus an LMS and a ticketing/support desk, not the tenant/community model in `REQUIREMENTS.md`.

Totals: 41 route files (34 screens + 5 layouts + 1 redirect + globals), 66 component files, 3 contexts, 11 hooks, 9 type files, 13 mock files, ~17.4k LOC of TS/TSX.

---

## 1. Stack & tooling

### package.json (exact ranges)

| Package | Range | Role |
|---|---|---|
| `next` | `^16.1.6` | App Router, `use(params)` (async params) |
| `react` / `react-dom` | `^19.2.3` | |
| `lucide-react` | `^0.475.0` | All icons (no other icon set) |
| `framer-motion` | `^12.6.3` | Sheets, dialogs, toasts, heart burst, progress bars, lightboxes |
| `clsx` `^2.1.1` + `tailwind-merge` `^3.0.2` | | `cn()` in `lib/utils.ts` |
| `date-fns` | `^4.1.0` | Only `lib/formatters.ts` (`format`, `isToday`, `isYesterday`, `ptBR` locale imported but `formatRelativeTime` is hand-rolled) |
| `tailwindcss` + `@tailwindcss/postcss` | `^4.1.3` | Tailwind v4 via PostCSS (`postcss.config.mjs`), no `tailwind.config` |
| `typescript` | `^5.8.2` | `strict: true`, target ES2017, `@/*` → `./*` |
| `eslint` `^9.25.1` + `eslint-config-next` `^16.1.6` | | `next/core-web-vitals` + `next/typescript` only (`eslint.config.mjs`) |

Package manager: npm (`package-lock.json` present). No test runner, no Prettier, no Storybook, no i18n lib, no state library, no data-fetching lib, no PWA plugin (no serwist/next-pwa).

### Next config / Vercel

- `next.config.ts`: `{ reactStrictMode: true, allowedDevOrigins: ["172.16.0.94"] }`. No `images.remotePatterns` (all images are plain `<img>`, 30 files; zero `next/image`).
- `vercel.json`: `{ "framework": "nextjs", "buildCommand": "npm run build", "installCommand": "npm install" }` — nothing else.
- `app/layout.tsx`: root layout, `lang="pt-BR"`, `data-theme="light"` on `<html>`, `suppressHydrationWarning`, `metadata.manifest = "/manifest.json"`, `viewport` with `maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: "#ffffff"`. Wraps everything in `Providers` (Auth → Theme → Notification) and `DeviceShell` (iPhone mockup on desktop).
- `app/page.tsx`: `redirect("/feed")`. Nothing gates auth: every route is reachable without login (`AuthContext` is cosmetic).

### Fonts

- `Manrope` via `next/font/google` (`variable: "--font-manrope"`, `display: "swap"`, latin subset). Applied through `@theme --font-sans` and `body { font-family }`.
- `globals.css` also declares `--font-serif: var(--font-averia), Georgia, serif` but Averia is never loaded → dead token. `.heading-serif` is just `font-weight:700; letter-spacing:-0.02em` (no serif).

### PWA

- `public/manifest.json`: name "Dr. Igor Alves", `start_url: "/feed"`, `display: standalone`, `orientation: portrait`, `background_color #f5f7fb`, `theme_color #2e6fd0`, a single 512×512 icon `/images/logo-ig.png` (no 192, no `maskable`, no screenshots).
- `public/sw.js`: install → `skipWaiting`, activate → `clients.claim`, fetch → `caches.match(req) || fetch(req)`. It never calls `cache.put`, so it caches nothing; and no code in `app/` or `components/` registers it. Effectively a placeholder. PWA-01/NOTIF-03 need a real SW (serwist) built from scratch.
- `theme-color` is inconsistent: layout says `#ffffff`, manifest says `#2e6fd0`, `ThemeContext.applyTheme` rewrites the meta to `#0f1118` / `#ffffff`.

### Tailwind v4 setup (`app/globals.css`)

`@import "tailwindcss"` then a single `@theme` block that maps semantic color tokens onto CSS variables (`--color-bg: var(--theme-bg)`, …), two animations (`--animate-shimmer`, `--animate-gold-shine`) and the two font tokens. Everything else is plain CSS classes (`.card-magazine`, `.btn-gold`, `.pill-gold`, `.glass-bar`, `.bg-glass`, `.pb-safe`, `.app-scroll`, `.showroom`, `.brand-ig-mark`, …). The `[data-theme]` selector re-declares all `--color-*` aliases so a nested `data-theme` scope repaints (comment in file explains the var() substitution trap — keep this technique).

---

## 2. Design tokens

### Color model

Two layers:

1. **Raw theme vars** `--theme-*` defined on `:root` (light, default) and `[data-theme="dark"]` (navy, not pure black).
2. **Tailwind aliases** `--color-*` in `@theme` pointing at the raw vars, giving utilities `bg-bg`, `bg-bg-secondary`, `bg-bg-tertiary`, `bg-bg-elevated`, `bg-bg-input`, `text-text`, `text-text-secondary`, `text-text-tertiary`, `text-text-inverse`, `border-border`, `border-border-secondary`, `bg-card`, `bg-card-hover`, `bg-handle`, `text-accent`, `bg-accent`, `accent-secondary`, `gold`, `gold-light`, plus legacy aliases `forest`, `forest-deep`, `emerald`, `emerald-dark`, `teal`, `teal-bright`, `sage`, `mist` (all re-valued to the blue ramp; the CSS header says the names were kept so ~100 class references keep working).

| Token | Light | Dark |
|---|---|---|
| `--theme-bg` | `#f5f7fb` | `#0f1118` |
| `--theme-bg-secondary` / `-elevated` / `card` | `#ffffff` | `#181c26` |
| `--theme-bg-tertiary` / `-input` | `#e9eef7` / `#eef2f9` | `#232937` |
| `--theme-text` | `#16233b` | `#f2f5fa` |
| `--theme-text-secondary` / `-tertiary` | `#51617c` / `#8595ad` | `#a6b1c4` / `#64718a` |
| `--theme-border` | `rgba(22,35,59,.10)` | `rgba(255,255,255,.08)` |
| `--theme-accent` (**brand primary**) | `#2e6fd0` | `#5b9cf8` |
| `--theme-accent-secondary` (**brand secondary**) | `#5b9cf8` | `#a7c9fb` |
| `--theme-gold` / `-gold-light` | `#3f7fd8` / `#a7c9fb` | `#5b9cf8` / `#a7c9fb` |
| `--theme-overlay`, `--theme-handle`, `--theme-chip`, glass-bar tokens (`--theme-glass-bar`, `--theme-rim-strong/faint`, `--theme-bar-shadow`) | see file | see file |

Semantic state colors are NOT tokenized: red-500 (likes, danger, unread badge), green-500/600 (success, online dot), amber (status "em análise"), blue-500 (`BadgeCheck` in forum, "Concluído" in `profile/edit`, `text-blue-400` in `forgot-password`), purple/orange (community topic type chips). 175 occurrences of raw Tailwind palette classes across `app/` + `components/`.

### How "brand" is expressed — hardcoded vs variables

- **Variable-driven (portable):** every `bg-accent`/`text-accent`/`border-accent`/`bg-accent/10` utility, `.brand-ig-mark` (logo is a CSS mask tinted by `var(--theme-accent)`), `BottomNav` active color, `AreaTabs`, chips, `ProgressBar` gradient `from-accent to-accent-secondary`.
- **Hardcoded hex (must change for TENANT-02):**
  - `globals.css` — 42 hex literals: the `:root` / dark accent values themselves; `.text-gradient-gold` (5-stop gradient `#2e6fd0 → #5b9cf8 → #a7c9fb`), `.text-gradient-emerald`, `.btn-gold` (6-stop animated gradient `#24549e…#5b9cf8`), `.pill-gold` gradient, `.pill-emerald` rgba(46,111,208), `.showroom` gradient, `--color-forest-deep #181c26`, `--color-sage #f5f7fb`, `--color-mist #e9eef7`, card shadows `rgba(22,35,59,…)`.
  - `components/profile/ReputationSection.tsx` — 16 hex (medal tiers; legacy feature, drop).
  - `app/(app)/event-checkin/page.tsx` — QR fill `#16233b` / `#ffffff`, `app/(app)/my-events/page.tsx` countdown pill `text-[#16233b]`, `components/events/MyEventDetails.tsx` `text-[#b8860b]` star and Airbnb `#ff5a5f`, `components/ui/DoubleTapHeart.tsx` `fill="#ef4444"`, `BottomNav` `#ffffff`, `reels/page.tsx` `--statusbar-ink #ffffff`.
  - Brand strings/assets: `"Igor Alves"` / `"Dr. Igor"` / `logo-ig` appear in 25 files (58 hits): `lib/constants.ts` (`APP_NAME`, `APP_DESCRIPTION`), `components/layout/TopBar.tsx` (`IGOR <span class="text-accent">ALVES</span>`), `app/(auth)/login/page.tsx`, `app/layout.tsx` metadata, `public/manifest.json`, `public/sw.js` cache name, `lib/support.ts` ("Equipe Igor Alves" auto-reply), `lib/mock/community.ts` `OWNER`, `app/(app)/profile/page.tsx` ("Comunidade Igor Alves", "Membro Ouro"), `components/shell/DeviceFrame.tsx` aria-label.

### What must change for per-tenant runtime theming (TENANT-02)

1. **Inject brand vars server-side.** Keep the two-layer model but make the `:root` values come from the tenant: in `apps/web/app/(app)/layout.tsx` render `<style>` (or `style` attr on the shell root) with `--brand-primary`, `--brand-secondary`, `--brand-on-primary` from `/me/bootstrap`. Map `--theme-accent: var(--brand-primary)` etc. Never ship the Igor values as defaults in `:root` — use a neutral fallback that only appears on the auth screens before tenant resolution (AUTH screens render per sign-up-link tenant anyway).
2. **Derive, don't enumerate.** Requirements cap tenants at 2–3 brand colors ("Exposing 12+ theme tokens" is out of scope). Replace the hand-tuned gradients with `color-mix(in oklch, var(--brand-primary), white 20%)` / `black 15%` stops so `.btn-brand`, `.pill-brand`, `.text-gradient-brand` follow the tenant. Dark-mode accent (`#5b9cf8`, a lighter tint) must also be derived (`color-mix(... white 30%)`) or the dark palette is dropped from V1 (ThemeContext toggle is a settings nicety, not a requirement).
3. **Contrast is a runtime concern.** `BottomNav` collapsed button and `.btn-gold` assume white text on accent; `AreaTabs` deliberately uses `text-text-inverse` for this reason. ADMIN-01 requires contrast validation — compute `--brand-on-primary` (white/navy) from luminance when saving branding, and use that token instead of `text-white` on accent surfaces.
4. **Logo:** `.brand-ig-mark` (mask trick) only works with a monochrome PNG/SVG; tenants upload arbitrary logos. Port as `<TenantLogo>` rendering `<img src={tenant.logoUrl}>` with a fixed box, keep the mask variant only as an optional "monogram" mode.
5. **Rename legacy tokens** on port: `gold*`, `emerald*`, `forest*`, `teal*`, `sage`, `mist` → `brand`, `brand-soft`, etc. Do not carry the aliases; a lint rule in `packages/config` should ban them.
6. `theme-color` meta, `manifest` name/icon/colors, favicon: generated per tenant (`app/manifest.ts`, `app/icon.tsx` as ARCHITECTURE.md already plans; V2-PLAT-02 covers the full manifest).
7. Status-color tokens: add `--color-success/danger/warning/info` so `Toast`, `Badge`, `ConfirmDialog(danger)`, status pills stop using raw `red-500`/`green-600`.

### Spacing, radius, typography

- Radius scale in use: `rounded-full` (pills, nav, chips, avatars), `rounded-xl` (buttons 12px, inputs, media), `rounded-2xl` (sheets, dialogs, cards 16px), `card-magazine` 12px + shadow `0 1px 3px rgba(22,35,59,.06)`, `card-square` variant (0 radius, full-bleed feed post).
- Spacing: horizontal page gutter `px-4` everywhere; list gaps `gap-3`; section spacing `mb-6`/`mb-7`; 44×44 minimum tap targets on icon buttons (`IconButton`, back buttons).
- Type: Manrope only. Arbitrary sizes `text-[10px]`/`[11px]`/`[15px]`/`[26px]` are common; section headers are `text-sm font-bold text-accent uppercase tracking-wider` (events, support, profile); page titles `text-2xl font-bold`; sheet titles `text-lg font-semibold`; metadata `text-xs text-text-tertiary`, `tabular-nums` on numbers.
- Layout constants: TopBar height `h-12` + `--safe-top`; content padding `pt-[calc(var(--safe-top)+3.5rem)] pb-[calc(var(--safe-bottom)+5.25rem)]`; sticky sub-headers at `top-[calc(var(--safe-top)+3rem)]`; fixed composers at `bottom-[calc(var(--safe-bottom)+5rem)]`; `BOTTOM_NAV_HEIGHT = 64` in `lib/constants.ts` (unused by CSS). z-index ladder: sub-header 40, TopBar/BottomNav 50, sheets/dialogs/lightboxes 55, device status bar 60, toast 100.
- Safe areas: never `env()` directly — `--safe-top`/`--safe-bottom` set by `DeviceFrame` (59/34 px in mockup, `max(env(...), 12px/8px)` fullscreen). `vh`/`dvh` are banned inside the app; `--screen-h`/`--screen-w` are used instead (`BottomSheet` max-height `calc(var(--screen-h)*0.8)`).
- Dark/light: `data-theme` attribute on `<html>`, toggled from `/settings`; persisted in `localStorage["social-app-theme"]`; default light; no `prefers-color-scheme` detection.

---

## 3. Route map

Navigation model: **five fixed bottom tabs** (`lib/nav.ts` `MAIN_TABS`: `/feed` Home, `/community` Comunidade, `/reels` Vídeos, `/membros` Membros, `/events` Eventos) rendered by `components/layout/BottomNav.tsx` as a floating glass pill. **Global TopBar** (`components/layout/TopBar.tsx`): brand mark + "IGOR ALVES · <area>" left; right side bell (Heart icon → `/notifications` with unread badge), help (`MessageCircle` → `/suporte`), avatar (→ `/profile`). On events routes the help/profile shortcuts collapse into a hamburger `TopBarMenu` that also lists the event sub-screens. `AreaTabs` (chip row under TopBar) only renders on `/membros/*` top-level routes. There is no sidebar and no desktop layout: on viewports > 520 px `DeviceShell` renders the app inside an iPhone 16 Pro mockup (`DeviceFrame`, 393×852, scaled to fit, mouse simulates touch); ≤ 520 px it is fullscreen. All pages are `"use client"`.

| Route | File | Screen | Chrome | Notes |
|---|---|---|---|---|
| `/` | `app/page.tsx` | redirect → `/feed` | — | no auth gate |
| `/login` | `app/(auth)/login/page.tsx` | e-mail + password, "Esqueceu a senha?", "Criar nova conta" | none (centered) | mock login always succeeds |
| `/register` | `app/(auth)/register/page.tsx` | name, e-mail, username, password ×2 | none | calls `login()`; no terms acceptance |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | e-mail → success Toast | none | |
| `/feed` | `app/(app)/feed/page.tsx` | PostCard list, pull-to-refresh, infinite scroll | TopBar + BottomNav | no stories strip, no composer |
| `/post/[postId]` | `app/(app)/post/[postId]/page.tsx` | PostCard + inline CommentsList | sticky back header | share deep-link target |
| `/community` | `app/(app)/community/page.tsx` | community picker cards (cover, members, posts, activity badge) | TopBar + BottomNav (collapses on scroll) | |
| `/community/[communityId]` | `app/(app)/community/[communityId]/page.tsx` | cover, owner, tagline, "highlights" circles, community posts | back link overlaid on cover | `notFound()` if missing |
| `/community/[communityId]/[topicId]` | `.../[topicId]/page.tsx` | topic detail + flat comments + fixed reply input | sticky back header | comments can't be replied to |
| `/reels` | `app/(app)/reels/page.tsx` | fullscreen vertical video pager, 3 lanes, comments sheet | TopBar hidden, BottomNav "media" mode | out of V1 scope |
| `/events` | `app/(app)/events/page.tsx` | two horizontal poster rails: "Meus eventos", "Outros eventos" | TopBar (collapsed menu) + BottomNav | |
| `/events/[eventId]` | `app/(app)/events/[eventId]/page.tsx` | hero card, status banners, info grid, CTA, map + nearby, programme, gallery | sticky back header | |
| `/event-photos` | `app/(app)/event-photos/page.tsx` | per-event photo grid + lightbox | in TopBarMenu | extra |
| `/event-checkin` | `app/(app)/event-checkin/page.tsx` | boarding-pass ticket, pseudo-QR, typed code, camera scanner, "Realizado às" | in TopBarMenu | |
| `/my-events` | `app/(app)/my-events/page.tsx` | stats, registered cards, participated cards + certificate | in TopBarMenu | |
| `/notifications` | `app/(app)/notifications/page.tsx` | "Novas" / "Anteriores" lists | plain back header | reads mocks, not context |
| `/profile` | `app/(app)/profile/page.tsx` | avatar, "Membro Ouro" level bar, 4 stat cells, event history, gear → settings | TopBar + BottomNav | no edit entry point |
| `/profile/edit` | `app/(app)/profile/edit/page.tsx` | EditProfileForm | sticky header | orphan (not linked) |
| `/profile/followers`, `/profile/following` | `app/(app)/profile/{followers,following}/page.tsx` | user lists with Follow buttons | sticky header | legacy IG, orphan |
| `/profile/saved` | `app/(app)/profile/saved/page.tsx` | saved posts grid | sticky header | legacy, orphan |
| `/user/[userId]` | `app/(app)/user/[userId]/page.tsx` | IG-style profile header, stats, grid | sticky header | legacy (reached from explore/user lists) |
| `/settings` | `app/(app)/settings/page.tsx` | account rows (dead), dark-mode toggle, version, logout | plain back header | only door to logout |
| `/suporte` | `app/(app)/suporte/page.tsx` | "Iniciar conversa" CTA, active/closed ticket cards, FAQ accordion | sticky header (back → /feed) | |
| `/suporte/novo` | `app/(app)/suporte/novo/page.tsx` | category, subject, related event, description, prints ×4, priority | sticky header | |
| `/suporte/[ticketId]` | `app/(app)/suporte/[ticketId]/page.tsx` | ticket summary, chat bubbles, resolve, reply composer w/ attachments, lightbox | sticky header | `useSearchParams` w/o Suspense |
| `/forum`, `/forum/[topicId]` | `app/(app)/forum/**` | category chips + topic cards; topic detail | sticky header | legacy, orphan |
| `/explore` | `app/(app)/explore/page.tsx` | search bar, "Para você" grid, "Tendências" tags | none | legacy, orphan |
| `/membros`, `/membros/cursos`, `/membros/cursos/[courseId]`, `/membros/aulas/[lessonId]`, `/membros/trilhas`, `/membros/lives`, `/membros/progresso` | `app/membros/**` (own layout, sibling of `(app)`) | LMS: courses, modules, lessons, tracks, lives, progress, Premium lock | TopBar + AreaTabs + BottomNav | out of scope (LMS is explicitly excluded in REQUIREMENTS) |

Mobile vs desktop: identical markup; the only breakpoint logic is `DeviceShell` (`max-width: 520px`) and 12 `md:`/`sm:` utilities inside `components/ui/Avatar.tsx` and `Button.tsx`. A real desktop layout (PWA-01 "fully responsive on desktop") does not exist and must be designed.

---

## 4. Screen inventory → requirement mapping

| Screen | Route | Components used | Covers | Gaps / notes |
|---|---|---|---|---|
| Login | `/login` | `ui/Input` | AUTH-02 (visual) | No tenant branding by sign-up link (AUTH-01), no session persistence beyond localStorage |
| Register | `/register` | `ui/Input` | AUTH-01/02 (visual) | Missing terms + community rules acceptance (AUTH-04); asks for `username` (not in model) |
| Forgot password | `/forgot-password` | `ui/Input`, `ui/Button`, `ui/Toast` | AUTH-03 | |
| Settings | `/settings` | inline `SettingsItem` | AUTH-05 (logout) | Dead rows "Editar perfil", "Notificações", "Privacidade"; push opt-in (NOTIF-03) and iOS install hint (PWA-02) missing |
| Feed | `/feed` | `feed/PostCard`, `layout/PullToRefresh`, `feed/InfiniteScroll` | FEED-02 (list, newest first), FEED-04 (like), FEED-05/06 (via CommentSheet) | No stories strip (STORY-02), image-only posts (FEED-01 video/embeds/files), share is a no-op (`onShare={() => {}}`, FEED-07), no community label on post, no "editado" (FEED-03) |
| Post detail | `/post/[postId]` | `feed/PostCard`, `comments/CommentsList` | FEED-04/05/06, FEED-07 landing | Same media gaps; comment submit is `console.log` |
| Community list | `/community` | inline card | COMM-03 (list w/ cover, name, tagline, counts) | shows members count + "novos posts" activity signals (not required, nice) |
| Community detail | `/community/[id]` | `ui/VerifiedBadge`, inline `CommunityPost` | COMM-03 (posts), STORY-04 (highlights ≈ pinned stories, but static circles that open nothing) | Uses a different post type (`CommunityTopic`) than the feed; no `admin` compose (COMM-04) |
| Community topic | `/community/[id]/[topicId]` | `ui/Avatar`, `ui/VerifiedBadge`, inline `CommentRow` | FEED-04/05/06 for community posts | Comments have no replies; type chips (discussion/trend/exclusive/video) not in requirements |
| Events home | `/events` | inline `EventPoster`, `Gallery` | EVENT-02 (upcoming + past) | Split is "mine vs others" not "upcoming vs past" |
| Event detail | `/events/[eventId]` | `events/MyEventDetails` (`EventLocation`, `MyEventDetails`), `events/EventMap` | EVENT-02, EVENT-03 partially ("Garantir minha vaga" = ticket purchase, no going/not-going), EVENT-04 link to check-in | No online-event link (EVENT-01), no attendee count (EVENT-03), no .ics/Google Calendar (EVENT-06), no cancel state |
| Check-in | `/event-checkin` | inline `PseudoQr`, `QrScanner`, `EmptyState` | EVENT-04 (member check-in) | Not per event (uses "next registered event"), no time window, persisted in localStorage; QR/camera are V2 (V2-EVENT-01) |
| My events | `/my-events` | inline `StatBlock`, `EmptyState`, `RegisteredCard`, `ParticipatedCard` | EVENT-02 (past), EVENT-04 entry | Certificates, hours — extras |
| Event photos | `/event-photos` | inline lightbox | — | Extra (could become community/story media later) |
| Notifications | `/notifications` | `notifications/NotificationList`, `NotificationItem` | NOTIF-02 (list, sections) | No mark-as-read on tap, no realtime; list ignores `NotificationContext`; types are follow/mention/share/forum (NOTIF-01 types missing) |
| Profile (own) | `/profile` | inline | PROF-01 (photo, name) | No bio shown, no edit link (AUTH/PROF-01 edit); gamified "Membro Ouro" level and event stats are extras |
| Edit profile | `/profile/edit` | `profile/EditProfileForm`, `ui/Avatar`, `ui/Input` | PROF-01 (edit photo, name, bio) | Has username + website fields (not in model); "Alterar foto" dead |
| Other member profile | `/user/[userId]` | `profile/ProfileHeader`, `ProfileStats`, `ProfileGrid`, `ReputationSection` | PROF-02 (view another member) | Instagram model: follow, message, posts grid, reputation medals — all out of scope |
| Followers / Following / Saved | `/profile/*` | `profile/UserListItem`, `ProfileGrid` | PROF-03 loosely (`UserListItem` is a usable member-directory row) | Follow graph out of scope |
| Explore | `/explore` | `explore/SearchBar`, `TrendingTags`, `ExploreGrid`, `SearchResults` | PROF-03 (people search UI) | Post search/trending out of scope |
| Support hub | `/suporte` | inline `ConversationCard`, `SectionTitle`, FAQ | CHAT-02 (member entry to support), CHAT-05 (visual status pill, not unread) | Multi-ticket model vs single conversation; FAQ extra |
| New ticket | `/suporte/novo` | inline form, `lib/support.compressImage` | CHAT-02 (first message) | Category/priority/related-event/attachments are extras |
| Ticket / conversation | `/suporte/[ticketId]` | `ui/ConfirmDialog`, inline bubbles, lightbox | CHAT-02 (send/receive), bubble design for CHAT-03/04 | No realtime, no support-side inbox (CHAT-03), attachments V2 |
| Reels | `/reels` | `ui/BottomSheet` | — | Out of scope entirely (video feed) |
| Forum | `/forum/**` | `forum/*` | — | Legacy; `TopicCard`/`CategoryChip` patterns reusable for community posts |
| Members area | `/membros/**` | `members/*` | — | LMS, out of scope (courses/live streaming excluded) |

### Requirements with NO screen in the prototype

- **TENANT-01..06**: no tenant concept, no branding injection, no isolation.
- **ROLE-03..05 / platform panel**: nothing for `super_admin`.
- **ADMIN-01..04**: no admin UI at all — no post composer (only three orphan stubs in `components/create/`), no story/community/event creation, no branding editor, no member management, no rules editor. ADMIN-04 ("creation flows usable from a phone") is a large design gap.
- **MODER-01..03**: no delete comment / block member / moderation log. `PostHeader` menu only has "Denunciar conteúdo" and "Copiar link".
- **STORY-01..05**: no stories at all (feed page comment: "nem stories"). Closest artifacts: community `highlights` circles and `lib/constants.ts` `STORY_DURATION_MS = 5000`, `STORY_EXPIRY_HOURS = 24` (unused).
- **FEED-01** media: video, link preview/embeds, file attachments. **FEED-03** edit/soft-delete. **FEED-07** share sheet.
- **EVENT-01** online events, **EVENT-05** attendance list, **EVENT-06** calendar export, **EVENT-07** reminders.
- **CHAT-03** support inbox, **CHAT-04** realtime, **CHAT-05** unread badge on the entry point.
- **NOTIF-03** push opt-in, **PWA-02** iOS install hint, **AUTH-04** terms/rules, **PROF-03** member directory (only the legacy followers list and explore "Pessoas" row).

### Extras in the prototype NOT in v1 requirements

Reels/vídeos, Members area (courses, tracks, lives, progress, Premium lock), forum, explore/search/trending, follow graph (followers/following, FollowButton), saved posts/bookmarks, reputation medals, "Membro Ouro/Diamante" levels, event ticketing (vagas, ingresso, código, certificado, horas), event photo galleries, Google Maps embed + nearby places + Airbnb, QR camera scanner, support ticket protocol/category/priority/attachments/FAQ, community activity badges ("3 novos posts"), verified crown badges by gender, dark mode toggle, post `location`/`tags`/`sharesCount`.

---

## 5. Component inventory

Legend for target: **core/ui** = `packages/core/ui` (shell, providers, navigation), **ui** = `packages/ui` (design-system primitives), **feed/communities/…** = `packages/modules/<name>/ui`, **drop** = do not port.

### `components/ui/` (primitives)

| File | Purpose | Props | Kind | Target | Port notes |
|---|---|---|---|---|---|
| `Avatar.tsx` | round image w/ fallback icon, online dot | `src?, alt?, size: sm\|md\|lg\|xl, showOnline?, onClick?, className?` | primitive | ui | Renders `<button disabled>` when not clickable — change to `<span>`/`<img>` unless `onClick`. Drop `showOnline` (no presence in V1). |
| `Badge.tsx` | red count badge, `99+` | `count, max=99, className?` | primitive | ui | Use `--color-danger` token |
| `BottomSheet.tsx` | framer-motion sheet, drag-to-dismiss, handle, title, scroll area | `isOpen, onClose, title?, children, className?` | primitive | ui | Add `role="dialog"`, `aria-modal`, focus trap, Escape. Keep spring `{damping:28, stiffness:300}` and dismiss rule `offset.y>100 \|\| velocity.y>500`. |
| `Button.tsx` | variants primary/secondary/outline/ghost/accent/danger; sizes sm/md/lg; loading spinner | extends button attrs + `variant?, size?, fullWidth?, loading?` | primitive | ui | `primary` and `accent` are identical; merge. Use `text-[var(--brand-on-primary)]` instead of `text-white`. Note most pages bypass it with raw `<button className="btn-gold …">` — the gradient CTA should become `variant="brand"`. |
| `ConfirmDialog.tsx` | centered confirm modal, optional icon, danger mode | `open, title, description?, icon?, confirmLabel?, cancelLabel?, danger?, onConfirm, onCancel` | primitive | ui | Has `role="dialog"`; add focus management. |
| `DoubleTapHeart.tsx` | wraps media, detects double tap, bursts heart | `onDoubleTap?, children, className?` | primitive (feed-flavored) | ui | Heart color hardcoded `#ef4444`; tokenize. Uses `onClick` timing (300 ms) — fine on touch. |
| `EmptyState.tsx` | icon circle + title + description + slot | `icon, title, description?, children?, className?` | primitive | ui | Pages re-implement their own (`my-events`, `event-checkin`, `events`, `membros/lives`) with a `card-magazine` frame — add a `variant="card"`. |
| `IconButton.tsx` | 44×44 icon button with optional badge | button attrs + `icon, size?, badge?, label?` | primitive | ui | Only `label` sets `aria-label`; make it required. |
| `Input.tsx` | labeled input with icon and error, 16 px font (iOS zoom guard) | input attrs + `label?, error?, icon?, containerClassName?` | primitive | ui | `forwardRef`; derives id from label (collisions possible). Add `Textarea` sibling (pages hand-roll textareas 5×). |
| `Skeleton.tsx` | shimmer placeholder text/circle/rect | `variant?, width?, height?, className?` | primitive | ui | Uses `via-white/60` — wrong in dark mode; tokenize. |
| `Tabs.tsx` | scrollable underline tabs, auto-centers active | `tabs: {id,label}[], activeTab, onChange, className?` | primitive | ui | Add `role="tablist"`. Most screens use chip rows instead (see `Chip` below). |
| `Toast.tsx` | top toast success/error/info, auto-dismiss | `type?, message, visible?, duration?, onDismiss?` | primitive | ui | Wrap in a `ToastProvider`/`useToast`; currently each page mounts its own. |
| `VerifiedBadge.tsx` | crown SVG by gender | `gender, size?, className?` | feature-specific | drop | Replace with role/"admin" badge (tenant admin marker) — gender-based crowns don't map to the model. |

### `components/layout/` and `components/shell/` (shell)

| File | Purpose | Kind | Target | Port notes |
|---|---|---|---|---|
| `layout/Providers.tsx` | Auth → Theme → Notification providers | shell | core/ui | Replace with `SessionProvider` (from `/me/bootstrap`), `TenantThemeProvider`, module providers registered by manifest |
| `layout/TopBar.tsx` | fixed header: brand, area suffix, bell w/ badge, help, avatar; hides on `/reels`; collapses on events | shell | core/ui | Couples to `NotificationContext` and `lib/mock/users` — port as `AppTopBar` with **slots** (`actions` filled from module registry `nav.topbar`), brand from tenant. Bell uses `Heart` icon; use `Bell`. |
| `layout/TopBarMenu.tsx` | hamburger dropdown listing area screens + shortcuts | shell | core/ui (optional) | Hardcodes events routes; regenerate from registry |
| `layout/BottomNav.tsx` | floating glass tab bar; shrinks on scroll-down (hysteresis), collapses to one icon on `/community`, media mode on `/reels` | shell | core/ui | Tabs must come from `MODULE_REGISTRY` filtered by tenant flags (MOD-04). Drop `/reels` media mode and `/community` collapse special-cases or make them declarative (`nav.collapseOnScroll`). Scroll listener uses `document` capture + `.app-scroll` class check — retarget to the real scroll container. |
| `layout/AreaTabs.tsx` | chip sub-nav under TopBar (members only) | shell | core/ui as `SubNav` | Generic chip nav; keep for module sub-routes (e.g. events: Próximos/Passados/Meus) |
| `layout/PullToRefresh.tsx` + `hooks/usePullToRefresh.ts` | touch pull-to-refresh w/ rotating loader | primitive | ui | Depends on `#app-scroll`; parametrize scroll root. V2-PLAT-03 lists native gestures as V2 — port but low priority. |
| `layout/SafeAreaWrapper.tsx` | pads with safe-area vars | primitive | ui | trivial |
| `shell/DeviceShell.tsx`, `shell/DeviceFrame.tsx` | iPhone mockup showroom on desktop, mouse-as-touch simulation, `#liquid-glass` SVG filter, `#app-scroll` container, scroll-to-top on route change | demo tooling | drop (keep `DeviceFrame` in a Storybook/preview package only) | The glass filter SVG and the `--safe-*`/`--screen-*` contract must be re-homed into the real shell (`AppShell`). |

### `components/feed/` and `components/comments/`

| File | Purpose | Props | Target | Notes |
|---|---|---|---|---|
| `feed/PostCard.tsx` | article: header, media, caption, actions, meta; opens `CommentSheet` | `post, className?` | feed | Imports `comments/CommentSheet` (feed→comments coupling; fine if comments live in feed module). Uses `useLike`/`useBookmark` local optimistic state. |
| `feed/PostHeader.tsx` | avatar, display name, verified, @handle, location, "…" → BottomSheet menu (Denunciar, Copiar link) | `post, className?` | feed | Menu is where admin edit/delete (FEED-03) and MODER actions plug in; "Copiar link" → FEED-07 share. |
| `feed/PostImage.tsx` | single image or snap carousel with dots, wrapped in `DoubleTapHeart` | `images, onDoubleTap?, className?` | feed | Keep; extend to a `PostMedia` handling video (HLS), embeds, attachments (FEED-01). |
| `feed/PostActions.tsx` | like/comment/share buttons | `post, onLike, onComment, onShare, onSave, isLiked?, isSaved?, className?` | feed | `onSave` accepted but no button (bookmark removed). |
| `feed/LikeButton.tsx` | heart with scale pulse | `isLiked, onToggle, className?` | ui (generic) | Reused by stories and comments. |
| `feed/PostCaption.tsx` | "username caption … mais" truncation at 100 chars | `username, caption, className?` | feed | Unused by `PostCard` (caption inlined); keep the "mais" pattern. |
| `feed/CommentPreview.tsx` | first two comments preview | `postId, commentsCount?, className?` | feed | Unused; imports mocks directly. |
| `feed/InfiniteScroll.tsx` + `hooks/useInfiniteScroll.ts` | sentinel + skeleton loader | `children, loadMore, hasMore, isLoading?, className?` | ui | IO root hardcoded to `#app-scroll`; make `root` a prop/context. |
| `comments/CommentSheet.tsx` | BottomSheet + CommentsList | `isOpen, onClose, postId, className?` | feed | |
| `comments/CommentsList.tsx` | scroll list + absolute-bottom `CommentInput` | `postId, className?` | feed | Submits to `console.log`. |
| `comments/CommentItem.tsx` | avatar, name, text, time, likes, "Responder", "Ver N respostas" toggle, recursive replies with `isReply` indent | `comment, isReply?, className?` | feed | Recursion allows N levels; enforce one level (FEED-05) by not rendering reply toggles when `isReply`. Reads `lib/mock/users` for gender. |
| `comments/CommentInput.tsx` | avatar + input + animated send | `onSubmit, className?` | feed (also stories, chat) | Make generic `Composer` in ui: used by story comments (STORY-05) and chat. |

### `components/events/`

| File | Purpose | Target | Notes |
|---|---|---|---|
| `events/EventMap.tsx` | keyless Google Maps `iframe` embed with category filter chips (local/hotéis/cafeterias/restaurantes/farmácias/estacionamento) + "open in Maps" link | events | Requirement only needs location + link; keep the map + "open in Maps", drop category filters/nearby list (extra). `iframe` third-party embed needs CSP + privacy review. |
| `events/MyEventDetails.tsx` | `EventLocation` (map + curated nearby places + Airbnb) and `MyEventDetails` (day-tabbed programme timeline, "Bom saber": traje/incluso/levar) | events | Programme timeline and "Bom saber" are extras (optional description sections). Curated nearby places are mock data. |

### `components/notifications/`

| File | Purpose | Target | Notes |
|---|---|---|---|
| `NotificationItem.tsx` | avatar + type icon overlay, actor + message, time, target thumbnail, unread tint | notifications | Type→icon map must be registry-extensible (events, chat contribute types). Whole row not clickable (no navigation). |
| `NotificationList.tsx` | "Novas"/"Anteriores" sections | notifications | Reads `mockNotifications` directly; wire to context/API. |

### `components/profile/`

| File | Purpose | Target | Notes |
|---|---|---|---|
| `EditProfileForm.tsx` | avatar + name/username/bio/website form, bio counter (150) | profiles | Drop username/website; wire "Alterar foto" to media upload. |
| `ProfileHeader.tsx` | centered avatar, name, @handle, bio, website, Follow + Mensagem | profiles | Port layout (avatar/name/bio) for PROF-02; drop follow/message. |
| `ProfileStats.tsx` | posts/followers/following counts | drop | |
| `ProfileGrid.tsx` | 3-col grid, every 7th large | drop (V1) | Useful later for "posts by admin" |
| `FollowButton.tsx` + `hooks/useFollow.ts` | | drop | |
| `UserListItem.tsx` | avatar + name + handle + follow | profiles | Base for PROF-03 member directory row (remove follow). |
| `ReputationSection.tsx` | medals/tiers with hex colors, BottomSheet list | drop | |

### `components/forum/`, `components/explore/`, `components/create/`, `components/members/`

| Group | Files | Target | Notes |
|---|---|---|---|
| forum | `CategoryChip`, `ForumComment`, `ForumCommentInput`, `TopicCard`, `TopicList` | drop as feature; **harvest** `CategoryChip` (generic `Chip` with color dot → ui) and `ForumCommentInput` (auto-growing textarea, Enter-to-send, fixed above nav → ui `Composer`). `TopicCard` is a good text-first post card for community posts without media. |
| explore | `SearchBar`, `SearchResults`, `ExploreGrid`, `TrendingTags` | `SearchBar` → ui (member directory / admin member search). Rest drop. |
| create | `CaptionInput` (auto-resize, counter 2200), `ImagePicker` (dashed drop zone), `LocationPicker`, `TagPeople` | `CaptionInput` + `ImagePicker` → seeds for the admin post composer (ADMIN-04/FEED-01) in feed/media. Drop the other two. |
| members | `CourseCard`, `LessonRow`, `LessonThumb`, `ModuleCover`, `ProgressBar`, `ProgressRing`, `StatBlock`, `VideoPoster` | drop as feature. **Harvest** `StatBlock` (labeled stat cell → ui, also used inline in `/profile`), `ProgressBar` (animated, tokenized → ui), `VideoPoster` (tap-to-pause poster → media/stories player scaffold). |

### Cross-feature coupling to break on port

| Importer | Imports | Why it matters |
|---|---|---|
| `components/layout/TopBar.tsx` | `contexts/NotificationContext`, `lib/mock/users` | Shell depends on notifications module state and profile data. Use registry-provided slot + session. |
| `components/feed/PostCard.tsx` | `components/comments/CommentSheet` | OK only if comments are part of the feed module (they are: FEED-05). |
| `components/comments/CommentItem.tsx`, `forum/ForumComment.tsx` | `lib/mock/users.getUserById` (for `gender`) | Component reaches into another domain's store for a presentational flag. Drop with `VerifiedBadge`. |
| `app/(app)/profile/page.tsx` | `lib/mock/events` | Profiles → events (stats/history). Must go through events' published contract or a domain event, or be dropped (it's an extra). |
| `app/(app)/suporte/novo/page.tsx` | `lib/mock/events` | Chat → events (related-event select). Extra; drop. |
| `components/notifications/NotificationItem.tsx` | type union includes `forum_reply`, `event_checkin`, `follow`, `share` | Notification module should not enumerate other modules' types; use a registry of renderers keyed by `type`. |
| `lib/nav.ts`, `BottomNav.tsx`, `TopBarMenu.tsx` | hardcoded routes of every feature | Must be generated from `ModuleManifest.nav` (MOD-04). |
| `hooks/useInfiniteScroll.ts`, `hooks/usePullToRefresh.ts`, `BottomNav.tsx`, `DeviceShell.tsx` | `document.getElementById("app-scroll")` / `.app-scroll` class | Implicit global; provide a `ScrollContainerContext`. |

---

## 6. State, contexts, hooks, mock data

### Contexts (`contexts/`)

| Context | Value | Storage | Assessment |
|---|---|---|---|
| `AuthContext.tsx` | `user, isAuthenticated, isLoading, login(username,pw), logout(), register()` | `localStorage["social-app-user"]`; `login` waits 500 ms then sets `getCurrentUser()` (mock user-1) | Cosmetic. Replace with server session (`@supabase/ssr` + `/me/bootstrap`) exposed through a `SessionProvider` in core/ui; keep the hook name `useAuth()` (`hooks/useAuth.ts` narrows to `user/isAuthenticated/login/logout`). |
| `ThemeContext.tsx` | `theme, isDark, toggleTheme, setTheme` | `localStorage["social-app-theme"]`; sets `data-theme` on `<html>` and rewrites `meta[name=theme-color]` | Port as a *user preference* layer on top of the tenant theme provider; theme-color must come from tenant. |
| `NotificationContext.tsx` | `notifications, unreadCount, markAsRead(id), markAllAsRead(), addNotification()` | in-memory, seeded from `mockNotifications` | Correct shape for NOTIF-02; `NotificationList` bypasses it. Notification module provider; `unreadCount` fed by realtime signal. |

### Hooks (`hooks/`)

| Hook | Does | Port |
|---|---|---|
| `useAuth` | context accessor | core |
| `useLike(initialLiked, initialCount)` | optimistic toggle; `toggleLike` closes over stale `isLiked` for the count (bug if called twice in one tick) | replace with mutation hook (`useToggleLike(targetType,id)`) that calls API idempotently (FEED-04) |
| `useBookmark`, `useFollow` | same pattern | drop |
| `useDoubleTap(cb, delay)` | touchend timing | ui (DoubleTapHeart has its own copy; unify) |
| `useSwipe(minDistance)` | touch start/end → direction; `onTouchMove` empty | ui; candidate for story viewer tap/hold zones |
| `useInfiniteScroll({loadMore, hasMore, threshold, rootMargin})` | IO on sentinel, root `#app-scroll` | ui, parametrize root |
| `usePullToRefresh({onRefresh, threshold=80})` | touch listeners, `pullDistance` | ui |
| `useMediaQuery(query)` | matchMedia | ui |
| `useDebounce(value, delay)` | | ui |
| `useMembersProgress` | LMS progress from localStorage pub/sub | drop |

### Mock data layer (`lib/`, `types/`)

Everything is synchronous in-memory arrays under `lib/mock/*`, anchored to `MOCK_NOW = Date.UTC(2026, 8, 8, 12:00)` in `lib/mock/now.ts` to avoid hydration mismatches (a good idea to keep for Storybook fixtures). Two "stores" persist to localStorage: `lib/support.ts` (`igor-support-tickets`, tickets array, mutates in place) and `lib/members-progress.ts` (`igor-members-progress-v2`, immutable + pub/sub). `event-checkin` writes `igor-events-checkin:<eventId>`.

Consumers import mocks directly inside components (not only pages): `TopBar`, `CommentPreview`, `CommentItem`, `CommentsList`, `NotificationList`, `ForumComment`, `ExploreGrid`, `SearchResults`, `TrendingTags`. On port, components must receive data via props/hooks from the module's API client; no module UI may import fixtures.

### Mock types vs requirements data model — mismatches

| Area | Prototype type (`types/`, `lib/mock/`) | Requirement model | Mismatch / action |
|---|---|---|---|
| **User / member** | `User { id, username, displayName, avatar, bio, isVerified, gender, isOnline, followersCount, followingCount, postsCount }`, `UserProfile` adds `coverImage, website, location, isFollowing, isFollowedBy`, `FollowRelation` | user (identity) + `membership { tenant_id, role, status }`, profile `{ display_name, photo, bio }` | Drop username/handle (`@voce`), gender, follow graph, presence, counts, verified. Add `role` (admin badge replaces crown). No tenant anywhere. |
| **Post (feed)** | `Post { id, authorId + 5 denormalized author fields, images[], profileThumbnail?, caption, location?, likesCount, commentsCount, sharesCount, isLiked, isSaved, createdAt, tags[] }`, plus `Like`, `Share { sharedTo }`, `Bookmark` | `post { tenant_id, community_id?, author_id, body, media[] (images \| video \| embed \| attachment), link_preview, edited_at, deleted_at, like_count, comment_count, viewer_liked }` | Image-only; no `community_id`; no video/embed/attachment; no edited/deleted; extras `isSaved`, `sharesCount`, `tags`, `location`. Denormalized author block is fine as an API view model. |
| **Community post** | `CommunityTopic { id, communityId, type: discussion\|trend\|exclusive\|video, title, content, image?, videoThumbnail?, isPinned, commentsCount, likesCount, createdAt }` — a **second** post type | same `post` with `community_id` set | Two models for one concept. Port `PostCard` for both; the `title` + type chip concept has no home (post has no title) — decide (see open questions). `isPinned` is V2-CONT-03. |
| **Community** | `Community { id, name, tagline, cover, coverPosition, members, newPosts, hasNewInteractions, lastActivity, highlights[] }`, `OWNER` constant | `community { name, description, cover_image, post_count, archived_at }`, pinned stories | `tagline` ≈ description; `members` count exists only if membership table populated (COMM-02 says all members see all communities — count = tenant members); `newPosts`/`hasNewInteractions` need per-user read markers (not planned); `highlights` ≈ pinned stories but static. |
| **Comment** | `Comment { id, postId, author*, content, likesCount, isLiked, parentId?, repliesCount, createdAt }` (feed); `CommunityComment` has **no** `parentId`; `ForumComment` has parentId; reels comments are `{ authorName, ago, body }` | one `comment { post_id \| story_id, parent_id? (depth ≤ 1 by DB constraint), like_count, deleted_by }`; story comments: no likes/replies | Unify. `CommentItem` recursion must be capped. Story comments need a "no like, no reply" variant. |
| **Story** | none (`STORY_DURATION_MS`, `STORY_EXPIRY_HOURS` constants unused) | `story { media, caption, expires_at, story_community_pins[] }`, viewer with progress bars | Entire module UI missing: strip, viewer (progress, auto-advance, tap/hold), likes/comments, pin-to-community. |
| **Event** | `IgorEvent { type: imersao\|masterclass\|congresso\|workshop\|encontro, typeLabel, date, endDate?, city, venue, coverImage, description, durationHours, spotsTotal, spotsLeft, isRegistered, participated, certificateAvailable, checkinCode?, photos[], hours?, address?, dressCode?, schedule?, included?, bring?, nearbyPlaces? }` | `event { title, description, cover, starts_at, ends_at (tz-aware), location? \| online_url?, canceled_at }`, `event_attendance { status: going\|not_going, checked_in_at }`, counts | Missing: online link, tz (mock formats with `getUTC*`), RSVP status enum + confirmed count, cancel, calendar export, admin attendance. Extras: capacity, purchase ("pagamento aprovado"), certificates, hours, photos, schedule, dress code, nearby places, QR code. `isRegistered` ≈ `status === going`; `participated` ≈ `checked_in_at != null`. |
| **Chat** | `Ticket { protocol, subject, category, priority, status: aberto\|em_analise\|respondido\|resolvido, eventId?, messages: TicketMessage { author: user\|equipe, authorName, text, attachments[] (data URLs) } }` | `conversation { kind: support, tenant_id }`, `conversation_participants { user_id, role }`, `message { conversation_id, seq, sender_id, body }`; one support conversation per member; support inbox ordered by last activity with unread | Ticket/protocol/category/priority/status/attachments/FAQ are extras. Bubble UI (`suporte/[ticketId]`) is the reusable part. Author is a string enum, not a participant id. |
| **Notification** | `Notification { type: like\|comment\|follow\|mention\|share\|message\|forum_reply\|event_checkin, actor*, targetId?, targetType?: post\|comment\|story\|reel\|topic\|event, targetPreview?, message (pre-rendered), isRead, createdAt }` | `notification { kind: comment_liked\|comment_replied\|post_created\|event_created\|event_reminder\|support_replied, actor_id?, target (post/comment/event/conversation), read_at, payload }` | Kinds differ; `message` should be rendered from `kind` + payload by the i18n catalog, not stored pre-rendered pt-BR text. Needs `href` to navigate. |
| **Like** | per-component `useState` toggles; counts computed locally; `isLiked` seeded by `i % 3` | idempotent toggle endpoint + `viewer_liked` | Replace hook with mutation. |
| **Tenant / branding / flags** | none | `tenant { name, slug, logo, primary_color, secondary_color, favicon }`, `tenant_modules` | Entire layer missing; nav is hardcoded. |

---

## 7. Interaction & UX details worth preserving

Navigation / shell
- **Floating glass BottomNav** (`components/layout/BottomNav.tsx`, `globals.css` `.glass-bar`): padding-box/border-box double gradient for the "rim of light", `backdrop-filter: url(#liquid-glass)` SVG refraction with `blur(2px) saturate(1.5)` fallback (kept in `@supports`, with an explicit note that Lightning CSS would dedupe duplicate declarations). Active tab = neutral chip behind icon (`--theme-chip`), stroke width 2.3 vs 1.7. Easing `cubic-bezier(0.2, 0.715, 0.205, 0.99)` everywhere the bar animates.
- **Scroll-reactive bar**: shrinks (`translateY(12px) scale(0.78)`, opacity .92) after 20 px down, restores after 10 px up, always full above 48 px; route change resets. On `/community` it collapses to a single accent button that scrolls back to top.
- Route change scrolls the app container to top (`DeviceShell`).
- Sticky page sub-headers: `ChevronLeft` 44×44 back + title, `bg-bg/95 backdrop-blur-sm` (pattern repeated in ~12 pages; extract `PageHeader`).
- TopBar shortcuts collapse into a hamburger on "area" routes, but the bell never collapses ("um aviso escondido atrás de dois toques não é aviso").

Feed
- Full-bleed `card-square` post cards; header with display name + @handle + location; "…" opens a BottomSheet action menu.
- **Double-tap to like** with spring heart (`DoubleTapHeart`, 80 px, `damping 8, stiffness 200`, 900 ms), **like pulse** `scale [1,1.2,1]` 300 ms.
- Image **carousel**: CSS scroll-snap, active-dot indicator in accent.
- Meta line "N likes · N coments · há 2h" opens the comment sheet.
- **Comments in a BottomSheet** (70% height) with threaded replies: dash + "Ver 3 respostas / Ocultar respostas", reply indent `pl-14`, heart with `whileTap scale .8`; input with animated send button that appears only when text is present.
- Pull-to-refresh (rotating loader tied to pull distance, content shifts 0.4×) and infinite scroll with a post-shaped skeleton.

Communities
- Picker cards: 16:7 cover with bottom gradient, name + tagline over image, **activity badge** top-right ("3 novos posts" / "Novas interações"), members/posts counters and relative last activity.
- Community page: cover, overlapping owner avatar (`-mt-10`, 4 px ring), "por Dr. Igor" credit, horizontal "highlights" circles (pinned-story slot), posts with pinned marker and media thumbnail with play overlay.

Events
- Poster rails (`aspect-[4/5]`, 256 px wide) with state pill ("Inscrito" brand pill / "Participou" / date / "Encerrado"), "É hoje!" / "Faltam N dias" / "Últimas N vagas" hooks.
- Detail hero card with countdown line; green confirmation banner; info grid with uppercase micro-labels; single contextual CTA per state.
- Programme as **day tabs + vertical timeline** (time column, hairline connector); "Bom saber" (dress code / included / bring) chips.
- Keyless Google Maps embed with filter chips (`aria-pressed`) and "abrir no Maps" link.
- Photo grid (3 cols, 2 px gaps) + **lightbox** with prev/next, counter "3 de 12", safe-area aware.
- Check-in **boarding pass**: cover, dashed tear line, deterministic pseudo-QR (SVG, hash of code with real finder/timing patterns), typed-code fallback with monospace tracking, camera scanner with framing mask and "no camera" fallback, persisted "Realizado às HH:MM" state, `?scan=1` deep link.
- Stat cells share one card with hairline dividers (`StatBlock` pattern, also on `/profile`).

Chat / support
- Chat bubbles: mine right in accent with `rounded-br-md`, team left on `bg-bg-secondary` with `ShieldCheck` + name; timestamps under bubbles; attachments as 64 px thumbs → lightbox; composer fixed above the nav with attach button, auto-height textarea, disabled send until content; "Anexe prints para acelerar" hint.
- FAQ accordion with icon circles and `aria-expanded`.
- Client-side image compression before upload (`compressImage`, 1200 px, JPEG 0.7) — reuse in media module for previews.
- Success banner slid in via `?novo=1` after creation.

Reels (out of scope but the gesture code is good reference for the **story viewer**): pointer-driven pager with dominant-axis lock, 60 px threshold, `translateY(-i*100%)` with rubber-band `dy*0.35`, side progress ticks, neighbours pre-mounted, mute toggle, status-bar ink override.

Global
- Empty states everywhere with pt-BR copy and CTA ("Nada por aqui ainda", "Nenhuma conversa por aqui", "Nenhum check-in disponível", "Seja o primeiro a responder!").
- Not-found states per detail page (header + message + CTA).
- Loading conventions: `null` = loading for localStorage-backed data; skeleton for feed; "Carregando conversas…" text elsewhere.
- Hydration discipline: fixed `MOCK_NOW`, stable shuffles, no `Date.now()` in render.
- Toast (spring from top), ConfirmDialog (spring scale, two-button footer split by hairline).
- Chip rows (`AreaTabs`, event-photos filters, map filters, priority selector, category chips) — one visual language: `rounded-full px-3.5 py-1.5 text-xs font-semibold`, active `bg-accent text-text-inverse`, idle `bg-bg-input text-text-secondary`.

---

## 8. Quality notes

Accessibility
- 53 `aria-label`s, 3 `role=` in total. Missing labels on icon-only back buttons in `app/(app)/notifications/page.tsx`, `settings/page.tsx`, `community/[communityId]/[topicId]/page.tsx`; send buttons in topic page; lane buttons in reels.
- `Avatar` renders a `<button disabled>` for non-interactive avatars (announced as disabled control).
- `BottomSheet` has no `role="dialog"`, no focus trap, no Escape; backdrop click only. `Tabs` lacks `tablist/tab` roles. `TopBarMenu` dropdown has no `menu` semantics or keyboard handling.
- `focus:outline-none` on nearly every interactive element with no `focus-visible` replacement → keyboard users get no focus ring.
- No `prefers-reduced-motion` handling anywhere (framer-motion `useReducedMotion` unused; CSS animations `gold-shine` run forever on CTAs).
- Decorative images use `alt=""` correctly, but content images (post photos, event covers) also have empty alt — need caption/alt from media records.
- Tiny type (`text-[10px]`) for labels; `userScalable: false` in viewport blocks pinch zoom (WCAG 1.4.4) — remove.
- `VerifiedBadge` encodes gender as crown shape; not portable.

Responsiveness
- Single fixed-width mobile layout; desktop = phone mockup in a showroom. PWA-01 requires a real responsive desktop: plan a two/three-column shell (left nav rail replacing BottomNav, centered content max ~640 px, optional right column) in core/ui. Components are mostly width-agnostic (`w-full`, `px-4`) so they will stretch; horizontal rails (`overflow-x-auto`) and full-bleed cards need a max-width container.
- `position: fixed` elements rely on the mockup's `transform: translateZ(0)` containing block; in a normal page they anchor to the viewport (fine), but the fixed composers (`bottom: calc(var(--safe-bottom)+5rem)`) hardcode the BottomNav height — on desktop without BottomNav this leaves a 5 rem gap. Derive from a `--nav-height` var.
- `--screen-h`/`--safe-*` contract must be defined by the real shell (`:root` fallbacks already exist in `globals.css`).

i18n readiness (PWA-03)
- Zero centralization: hundreds of inline pt-BR strings across pages and components, plus pre-rendered strings in mock data (`notification.message`, `typeLabel`, `STATUS_LABEL`, `CATEGORY_LABEL`, `LEVEL_LABEL`, FAQ). Several are unaccented or English ("Publicacoes", "Tendencias", "Preferencias", "Notificacao", "Codigo", "coments", "likes", "E hoje!" vs "É hoje!"). Pluralization is ad hoc (`n === 1 ? "resposta" : "respostas"`).
- Dates: `formatRelativeTime` hand-rolled; `formatEventDate` uses `getUTC*` and an uppercase `MONTHS` array (no locale, no tz). Use `Intl`/date-fns with tenant tz on port.
- Action: every string goes through a message catalog (`packages/core/i18n` or per-module `messages/pt-BR.ts`) with ICU plurals.

Anti-patterns NOT to port
- `DeviceShell`/`DeviceFrame` mouse-to-touch simulation, `cursor: none`, `#app-scroll` global id, `document`-level capture scroll listener in `BottomNav`.
- Hardcoded route lists in `lib/nav.ts`, `BottomNav`, `TopBarMenu`; per-route special cases (`/reels`, `/community`).
- Components importing fixtures (`lib/mock/*`) and reading other domains' stores (`getUserById` for gender).
- localStorage as database (`lib/support.ts`, `lib/members-progress.ts`, check-in), `console.log` submit handlers (`CommentsList`, `forum/[topicId]`), `useLike`'s stale-closure counter.
- All pages `"use client"` with `use(params)`; on port, route files are server components that fetch via the API client and mount module UI; only interactive leaves are client.
- `useSearchParams` without a Suspense boundary (`suporte/[ticketId]`) → CSR bailout of the whole route.
- Duplicated local copies of `EmptyState`, `StatBlock`, `SectionTitle`, back headers, chip buttons, lightboxes (`event-photos`, `suporte/[ticketId]`), fixed composers (`[topicId]`, `ForumCommentInput`, ticket reply).
- `.btn-gold` / `.pill-gold` / `text-gradient-gold` class names and gradients; `gold/emerald/forest/teal` aliases; hex literals in TSX.
- `<img>` instead of `next/image` (30 files) — media module must serve signed URLs (TENANT-04) with `next/image` `remotePatterns` for Supabase/Mux hosts.
- `userScalable: false`, `maximumScale: 1`.
- Sequential ids / `Math.random()` ids in `feed/page.tsx` load-more (`${p.id}-${Date.now()}`), `uid()` in support store.
- Sharing: `onShare={() => {}}`; there is no `navigator.share` or clipboard code anywhere — FEED-07 is greenfield.
- `sw.js` cache-first shell that never populates the cache.

---

## 9. Port plan

Effort: S ≈ ≤ ½ day, M ≈ 1–2 days, L ≈ 3+ days (per item, UI only, excluding API work).

### Phase A — Foundation / shell (before any vertical)

| # | What | Source files | Target | Effort |
|---|---|---|---|---|
| A1 | Tokens: de-branded `tokens.css` (light + dark), semantic status colors, `--brand-*` runtime vars, `color-mix` derived gradients, safe-area/`--screen-*`/`--nav-height` contract, `.card`, `.glass-bar` (+ `#liquid-glass` SVG mounted once by shell), keyframes | `app/globals.css` | `packages/ui/src/styles/tokens.css`, `packages/config/tailwind-preset` | M |
| A2 | `cn`, formatters (rewritten on `Intl`), `useMediaQuery`, `useDebounce` | `lib/utils.ts`, `lib/formatters.ts`, `hooks/*` | `packages/ui` | S |
| A3 | Primitives: `Button` (variants incl. `brand`), `IconButton`, `Input`, `Textarea` (new, from `CaptionInput`/ticket composer), `Avatar` (fixed semantics), `Badge`, `Chip` (from `CategoryChip`/`AreaTabs`), `Tabs`, `Skeleton`, `EmptyState` (+card variant), `StatBlock`, `ProgressBar`, `SectionTitle`, `PageHeader` (sticky back header), `Card`/`Pill` | `components/ui/*`, `components/forum/CategoryChip.tsx`, `components/members/{StatBlock,ProgressBar}.tsx`, headers inlined in pages | `packages/ui` | M |
| A4 | Overlays: `BottomSheet` (a11y added), `ConfirmDialog`, `Toast` + `ToastProvider`, `Lightbox` (from `event-photos` + `suporte/[ticketId]`) | `components/ui/{BottomSheet,ConfirmDialog,Toast}.tsx`, `app/(app)/event-photos/page.tsx` | `packages/ui` | M |
| A5 | Motion helpers: `LikeButton`, `DoubleTapHeart`, `useDoubleTap`, `useSwipe`; shared `EASE` constant; `useReducedMotion` gating | `components/feed/LikeButton.tsx`, `components/ui/DoubleTapHeart.tsx`, `hooks/*` | `packages/ui` | S |
| A6 | Lists: `InfiniteScroll` + `useInfiniteScroll` (root via `ScrollContainerContext`), `PullToRefresh` + hook, feed skeleton | `components/feed/InfiniteScroll.tsx`, `components/layout/PullToRefresh.tsx`, hooks | `packages/ui` | S |
| A7 | `AppShell`: scroll container, `AppTopBar` (tenant logo/name, registry slots, bell slot), `BottomNav` from registry (glass pill, shrink-on-scroll, declarative collapse), `SubNav` chips (from `AreaTabs`), **new desktop layout** (rail + max-width column), `TenantThemeProvider` (server-injected vars, user dark-mode preference from `ThemeContext`), `SessionProvider` (`useAuth`) | `components/layout/*`, `contexts/*`, `app/(app)/layout.tsx`, `app/layout.tsx` | `packages/core/ui` | L |
| A8 | Auth screens: login, register (+ terms/rules acceptance, tenant branding by invite slug), forgot password, `(auth)/layout` | `app/(auth)/**` | `apps/web/app/(auth)` + core/ui auth components | M |
| A9 | Settings page skeleton (logout, dark mode, push opt-in placeholder, iOS install hint placeholder) | `app/(app)/settings/page.tsx` | core/ui | S |
| A10 | PWA: manifest generated per tenant, real service worker (serwist), install hint; nothing to port from `public/sw.js` | — | `apps/web/app/manifest.ts`, `apps/web/sw.ts` | M (mostly new) |
| A11 | Storybook/preview app with `DeviceFrame` as an optional decorator (not shipped) and fixtures with a fixed clock (`MOCK_NOW` idea) | `components/shell/DeviceFrame.tsx`, `lib/mock/now.ts` | `apps/storybook` (optional) | S |

Recommended `packages/ui` contents after Phase A: `styles/tokens.css`, `cn`, `Button`, `IconButton`, `Input`, `Textarea`, `Avatar`, `Badge`, `Chip`, `Tabs`, `Skeleton`, `EmptyState`, `StatBlock`, `ProgressBar`, `SectionTitle`, `PageHeader`, `Card`, `Pill`, `BottomSheet`, `ConfirmDialog`, `Toast`/`useToast`, `Lightbox`, `LikeButton`, `DoubleTapHeart`, `Composer` (avatar + auto-growing textarea + animated send, from `CommentInput`/`ForumCommentInput`), `InfiniteScroll`, `PullToRefresh`, `SearchBar`, hooks (`useMediaQuery`, `useDebounce`, `useDoubleTap`, `useSwipe`, `useInfiniteScroll`, `usePullToRefresh`), formatters, `ScrollContainerContext`. `packages/core/ui`: `AppShell`, `AppTopBar`, `BottomNav`, `SubNav`, `DesktopRail`, `TenantThemeProvider`, `TenantLogo`, `SessionProvider`, `ModuleNav`.

### Phase B — Feature modules (in the build order from ARCHITECTURE.md)

| Module | Port (source → target) | New (no prototype) | Effort |
|---|---|---|---|
| **profiles** | `ProfileHeader` (avatar/name/bio only), `EditProfileForm` (name, bio, photo), `UserListItem` → member directory row, `SearchBar` for PROF-03; own-profile page layout from `app/(app)/profile/page.tsx` minus gamification | member directory page (paginated search), photo upload via media | M |
| **media** | `ImagePicker` drop zone, `compressImage` (previews), `VideoPoster` scaffold, `PostImage` carousel as `MediaCarousel` | signed-upload flow, HLS player, attachment chip, link-preview card, embed card | L (mostly new) |
| **feed** | `PostCard`, `PostHeader` (menu → edit/delete/share/report), `PostActions`, `PostCaption` ("mais"), `CommentSheet`, `CommentsList`, `CommentItem` (capped at one reply level), `feed/page.tsx` list, `post/[postId]` detail; community label on card | admin composer (mobile-first, ADMIN-04) from `CaptionInput` + `ImagePicker`, share sheet (`navigator.share`/clipboard) FEED-07, edited marker, soft delete | L |
| **communities** | `community/page.tsx` picker cards (drop activity badges or back them with data), `community/[id]/page.tsx` header (cover, name, description, highlights slot), reuse feed `PostCard` for posts (retire `CommunityTopic`/`CommentRow`) | create/edit/archive forms (admin), "post here" entry (COMM-04), pinned-stories strip in highlights slot | M |
| **stories** | Nothing directly; reuse `reels/page.tsx` gesture model (pointer pager, axis lock, pre-mounting) and `DoubleTapHeart`/`LikeButton`/`Composer`; highlight circles from community page as the strip ring | strip, full-screen viewer with progress bars/auto-advance/tap/hold, like + flat comments, admin publish + pin-to-community, 24 h expiry display | L |
| **events** | `events/page.tsx` rails → "Próximos / Passados" (SubNav) , `events/[eventId]` hero + info grid + CTA + `EventLocation` (map + open in Maps; drop nearby/Airbnb) + optional programme/"Bom saber" as optional sections, `my-events` registered/participated cards (simplified), check-in screen (boarding pass + persisted "Realizado às"; drop QR/camera), `EmptyState` copy | RSVP going/not going + count, online-link variant, .ics/Google Calendar buttons, cancel state, admin create/edit + attendance list | L |
| **chat** | Conversation screen from `suporte/[ticketId]` (bubbles, composer, lightbox pattern), entry card style from `suporte/page.tsx` | single-conversation member entry, support inbox (CHAT-03), realtime wiring, unread badge in nav slot (CHAT-05); drop ticket/protocol/category/priority/FAQ/attachments | M |
| **notifications** | `NotificationItem`, `NotificationList` (sections), `NotificationContext` shape, bell badge in TopBar slot | kind→renderer registry, mark-as-read on tap + navigation, realtime unread count, push opt-in UI, iOS hint | M |
| **moderation** | `PostHeader` menu slot for "Excluir comentário" (admin); nothing else | block member action in admin member list, moderation log view | M (new) |
| **admin** (tenant panel) | `EditProfileForm` pattern, `SearchBar` + `UserListItem` for member management, `settings/page.tsx` row style, chip selectors (priority selector from `suporte/novo` as a segmented control) | branding editor with live preview + contrast check (ADMIN-01), member roles/block (ADMIN-02), rules editor (ADMIN-03), all mobile-first | L (new) |
| **platform** (super_admin) | nothing | tenant list/create, flags | L (new) |

Do not port: `app/membros/**`, `components/members/*` (except harvested primitives), `app/(app)/reels`, `app/(app)/forum/**`, `components/forum/*` (except `CategoryChip`), `app/(app)/explore`, `components/explore/*` (except `SearchBar`), `app/(app)/user/[userId]`, `profile/{followers,following,saved}`, `ProfileStats`, `ProfileGrid`, `FollowButton`, `ReputationSection`, `VerifiedBadge`, `event-photos`, `components/create/{LocationPicker,TagPeople}`, `components/shell/*` (runtime), `lib/support.ts`, `lib/members-progress.ts`, `lib/mock/*` (except as Storybook fixtures), `public/sw.js`.

### Top port risks

1. **Runtime theming vs baked gradients/hex**: the brand is expressed in 42 hex literals in CSS plus gradient CTAs; getting `color-mix`-derived brand surfaces and on-brand contrast right before the first vertical is a prerequisite for TENANT-02 (server-rendered, no default flash).
2. **No desktop layout and a mockup-dependent shell**: `DeviceFrame`'s containing-block/`--safe-*`/`#app-scroll` contract is what makes every fixed element work. The real `AppShell` must reproduce that contract and add a desktop rail; every fixed composer/sub-header hardcodes offsets that depend on it.
3. **Data-model divergence**: two post types, no stories, ticket-style chat, IG-style users and event ticketing. Presentational components port well, but every container/page must be rewritten against the contracts, and a third of the screens (admin, stories, moderation, platform) have to be designed from scratch in the prototype's visual language.

---

## 10. Open questions for the design team

1. **Stories**: there is no story strip or viewer in the prototype although STORY-01..05 are V1. Should the community "highlights" circles be the pinned-stories UI, and can you deliver a viewer spec (progress bars, tap zones, hold-to-pause, comments sheet) in the same language as the reels pager?
2. **Community posts vs feed posts**: community topics have a `title` and a type chip (Discussão/Trend/Exclusivo/Vídeo); feed posts have neither. The model has one post type with optional `community_id`. Do we drop titles/types, or add an optional title to all posts?
3. **Admin creation flows on mobile (ADMIN-04)**: no composer exists (only `CaptionInput`/`ImagePicker` stubs). We need designs for: post composer (multi-image, video, link, file), story publish, community create/edit, event create/edit, branding editor with live preview, member management with block/role change, moderation log.
4. **Events semantics**: prototype models paid tickets (vagas, ingresso, pagamento aprovado, certificado). V1 is free RSVP (going / not going) + check-in in a time window, and needs online events (link) and calendar export. Which of countdown, "Últimas N vagas", programme, "Bom saber", photos, QR should survive? Are QR/camera acceptable as V2 (V2-EVENT-01)?
5. **Support chat**: V1 is one continuous member↔support conversation with realtime, plus a support inbox for `support_tenant`. The prototype is a multi-ticket helpdesk (protocol, category, priority, resolve). Keep any of ticket status / "marcar como resolvido" / FAQ? We also need the support-side inbox screen.
6. **Desktop**: the prototype only ships the phone mockup. Please propose the desktop shell (left rail instead of floating bottom bar? max content width? where do bell/help/profile go?).
7. **Bell icon**: notifications use a `Heart` icon in the TopBar (Instagram convention). Requirement calls it a bell; confirm `Bell`.
8. **Dark mode**: is the dark palette a V1 deliverable? If yes, how should the tenant's primary color be adapted for dark surfaces (the prototype hand-picks a lighter blue)? If not, we ship light only and keep the toggle for later.
9. **Branding limits**: tenants supply logo + primary + secondary (+ favicon, name). The `.brand-ig-mark` mask requires a monochrome logo; can we require a monochrome variant or should the logo render as-is?
10. **Verified crown / "Membro Ouro"**: gender-based crowns and gamified levels are out of scope. Is an "admin" badge next to the tenant admin's name acceptable, and should member profiles show event stats at all?
11. **Notification rows**: they are not tappable and have no destination. Confirm tap → target screen and mark-as-read on tap; do we want the unread tint or a dot?
12. **Copy**: many strings lack accents or are English ("coments", "likes", "Publicacoes"). We will move every string into a catalog; can you review the final pt-BR copy pass?
13. **Reels / Members area / Forum / Explore**: confirm these are parked (not V1/V2 requirements) so we do not reserve nav slots or design tokens for them.

---

*Prototype analysis: 2026-09-11*
