# Feature Research

**Domain:** Multi-tenant, white-label community / branded social-app SaaS (comparables: Circle, Mighty Networks, Skool, Kajabi Communities, Bettermode, Disciple, BuddyBoss, church/member apps such as Subsplash and Pushpay)
**Researched:** 2026-09-11
**Confidence:** MEDIUM (web-sourced; key claims cross-checked across 2+ sources; no vendor docs could be fetched as full text, so vendor-specific details are from help-center snippets and reviews)

## How to read this file

- Feature tables are scoped to **TRIA V1 as described in PROJECT.md**: admin-only publishing, members consume/react, support chat, PWA, pt-BR. Where the market expects something V1 deliberately omits, it is flagged rather than silently dropped.
- "Table stakes" here means *what a tenant's members will notice is missing in the first week*, not everything Circle ships.
- Complexity is for a Next.js + Node/TS API + Supabase stack per PROJECT.md constraints.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

#### Tenancy, branding, onboarding

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-tenant logo, primary/secondary colors, favicon, display name applied everywhere after login | This *is* the product's core value. Every white-label comparable (Bettermode, Disciple, Mighty Pro, Subsplash) leads with it; Skool is regularly abandoned for "minimal branding". | MEDIUM | Store as a `tenant_branding` record (colors, logo URL, favicon URL, name); apply via CSS variables at app shell. Must also cover PWA manifest (name/icons/theme_color) — a single-URL PWA means manifest must be served per tenant (dynamic `manifest` route keyed on the session) or you get TRIA-branded icons on the home screen. |
| Public sign-up link per tenant that lands the user in the right tenant | Circle "invitation link", Mighty "invite link", Skool group link — everyone onboards via a shareable URL. | LOW | `app.seusistema.com/join/<tenant-slug-or-token>`. Link should survive the login/register round-trip (store intent in cookie/query). Rotatable token so a leaked link can be revoked. |
| Email + password auth with password recovery | Baseline. | LOW | Supabase Auth. Password-reset email must be branded per tenant or it leaks "TRIA" to members — treat email templates as part of branding. |
| Minimal onboarding: set photo + bio on first login | Circle/Mighty force or nudge profile completion; empty avatars make a community look dead. | LOW | Optional-but-nudged, not blocking. |
| Feature modules toggled per tenant drive navigation | Explicitly in scope; also how Circle/Bettermode "spaces" avoid showing empty sections. | LOW | Flags read once at session bootstrap; navigation renders from flags. Hide, do not just disable. |
| Strict tenant isolation (no cross-tenant leakage in any list, search, notification, chat, storage URL) | Core value ("zero leakage"). | HIGH | Not a UI feature but a feature-level acceptance criterion for *every* module. RLS + tenant_id on every table + tenant check in API middleware. Storage buckets/paths must be tenant-prefixed and signed. |

#### Feed and content

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Chronological feed of admin posts with text + images (multi-image carousel) | Universal. | LOW | Carousel with swipe on mobile; image compression on upload. |
| Video in posts (upload) | In scope; members expect Instagram-grade playback. | HIGH | Raw MP4 upload to Supabase Storage works for a pilot but expect: no adaptive bitrate, slow first frame, large files on 4G. Plan a transcoding/streaming path (see PITFALLS/STACK). Enforce size/duration caps in V1. |
| Link previews and YouTube/Vimeo embeds | Every feed product (Circle, Mighty, Kajabi) unfurls links; admins paste YouTube constantly. | MEDIUM | Server-side unfurl (OG tags) at post-create time, cached on the post; oEmbed for YouTube/Vimeo. Never unfurl client-side (CORS, leaks member IPs). |
| File attachments (PDF etc.) | In scope; common in church/school/mentor tenants. | LOW | Signed, tenant-scoped download URLs; show filename + size + type icon. |
| Like on post, comment, reply | Universal. | LOW | Idempotent toggle; denormalized counters. |
| Comments with one reply level; like on comments | In scope; matches Facebook Groups / Instagram depth. Circle threads deeper but reviewers note deep nesting hurts on mobile. | MEDIUM | Model as `parent_comment_id` nullable with a DB constraint that a reply's parent has `parent_comment_id IS NULL` (enforces depth=1 without app logic). |
| Pin post to top of feed / of a community | Circle "pinned post block", Mighty "Featured Sections" + "Recommend". Admins will ask for this in week one ("regras", "avisos"). | LOW | Boolean `pinned_at` + ordering; limit to N pinned. Cheap to add now; awkward later. |
| Edit and delete own post (admin) | Universal. | LOW | Soft-delete; keep edit timestamp ("editado"). |
| Share via internal deep link (native share sheet or copy) | In scope; Web Share API is supported on Safari iOS and Chrome Android; must fall back to copy-to-clipboard on desktop. | LOW | Deep link must survive login redirect: `/p/<id>` -> if unauthenticated, store `returnTo`, then resolve after login. Verify the target belongs to the user's tenant before rendering (cross-tenant 404, never 403). |
| Post optionally scoped to a community | In scope; matches Circle/Mighty spaces. | LOW | `community_id` nullable on post. Feed = posts where `community_id IS NULL` OR user can see the community. |

#### Stories

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Horizontal strip, tap-to-open full-screen viewer, auto-advance, progress bars, swipe between authors | If you ship "stories", members will judge it against Instagram/WhatsApp Status, which 91-94% of Brazilian internet users use. Anything less than the standard gesture set feels broken. | MEDIUM | In V1 there is exactly one author per tenant (the admin), so the "swipe between authors" axis collapses to "next story". Still need: hold-to-pause, tap-left/right, progress segments, mute toggle for video. |
| 24h visibility, soft-expire | In scope. | LOW | `expires_at` column; queries filter on it; retention preserved. |
| Image + short video stories | Expected format. | MEDIUM | Cap video length (15-60s); vertical 9:16 crop guidance in the admin composer. |
| Seen/unseen ring state per member | Universal cue; without it members re-open the same story. | LOW | `story_views(story_id, user_id)` — also gives admin a view count for free. |
| Pin story to a community (persisting beyond 24h there) | In scope; analogous to Instagram Highlights. | LOW | `story_pins(story_id, community_id)`; community page shows pinned stories regardless of expiry. |
| Like + comment on story (no reply, no comment likes) | In scope. | LOW | Reuse the comment module with a `depth=0` policy for the story target type. |

**Important context:** No community-SaaS comparable (Circle, Mighty, Skool, Kajabi, Bettermode, Disciple, BuddyBoss) documents a Stories feature, and Twitter Fleets / LinkedIn Stories were both discontinued in 2021 for low usage. Stories are **not** table stakes in this category; they are table stakes *only because the product promises them*. See Differentiators and Anti-Features for how to make this work rather than flop.

#### Communities

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Community list with cover image, name, description, member/post counts | Circle Spaces, Mighty Spaces, Kajabi Circles. | LOW | |
| Community detail: its posts + pinned stories | In scope. | LOW | |
| Join/leave (or auto-membership) | Even with admin-created communities, members expect to know which they are "in". | LOW-MEDIUM | Decide V1 model explicitly: (a) all tenant members see all communities (simplest, recommended for pilot), or (b) opt-in join. Model `community_members` table regardless so V2 private communities need no migration. |
| Community-scoped notifications ("novo post em X") | Circle lets members set new-post notifications per space. | LOW | Depends on notification preferences below. |

#### Events

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Event list (upcoming/past), detail with date/time, location or online link, cover image, description | Universal; Skool, Circle, Mighty all ship a calendar. | LOW | Store timezone-aware timestamps; Brazil has multiple zones. |
| RSVP with clear state + attendee count + "who is going" | Mighty exposes Going/Maybe/Not going and lets members see who RSVP'd; Circle one-click RSVP. | LOW | V1 can ship Going/Not going only; keep an enum so "Maybe" is a data change, not a schema change. |
| Add to calendar (.ics / Google link) | Circle and Mighty both include calendar integration; reduces no-shows. | LOW | Generate `.ics` server-side; Google Calendar URL for one-tap. |
| Reminder notifications before the event | Mighty: automatic 10 min before online, 24h before in-person (one source adds 2h). Circle sends event reminders. Members expect at least one. | MEDIUM | Scheduled job (cron) emitting notifications to RSVP'd members at T-24h and T-1h; needs the notification module + a job runner on Cloud Run. |
| Check-in on the day, admin sees confirmed vs checked-in | In scope; church apps (Pushpay/Subsplash) treat check-in as core. Community SaaS (Circle/Mighty) do **not** have it — this is a church/school-app expectation you inherit. | MEDIUM | See Differentiators for the no-hardware approach. |
| Event update/cancel notifies RSVP'd members | Circle documents update/cancellation notifications; members are burned by silent cancellations. | LOW | Reuse notification module. |
| Online-event link revealed only to RSVP'd members (optional) | Mighty "restrict link to confirmed attendees". | LOW | Toggle on the event. |

#### Member profile and directory

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Profile: photo, name, bio; edit own | In scope. | LOW | |
| View other members' profiles within tenant | In scope. | LOW | |
| Member list / directory (searchable by name) | Circle, Mighty, Bettermode, Disciple, BuddyBoss all have it; members use it to find each other. | LOW | Even without member-to-member chat, a list of "who is here" is a strong social signal for the tenant. Paginate; tenant-scoped search. |
| Opt-out of directory / hide profile | Directory products consistently offer "hide me". Also an LGPD-friendly default. | LOW | Boolean on profile; respect it in search and lists. |
| Account deletion / data export request | LGPD Art. 18 (access, correction, deletion, portability). For a Brazilian product handling member data this is a legal expectation, not a nicety. | MEDIUM | V1: self-service "excluir conta" that anonymizes the user row and keeps comments as "membro removido", plus a manual export path. Document the retention policy for soft-expired stories and moderation logs. |

#### Chat (member <-> support)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One conversation per member with "Suporte", real-time delivery | In scope. | MEDIUM | Supabase Realtime or SSE from the API; PROJECT.md says frontend never talks to Supabase directly, so realtime must be proxied or the API must issue scoped realtime tokens (see ARCHITECTURE/PITFALLS). |
| Unread badge on chat tab and per conversation | Universal in chat. | LOW | |
| Message status (sent/delivered/read) and typing indicator | Listed as baseline in chat-feature guides (Stream, Sendbird, Ably). | MEDIUM | Read receipts LOW; typing indicator needs presence — defer typing to V1.x if it costs a day. |
| Image/file attachments in chat | "Users expect more than text." Support flows depend on screenshots. | LOW | Reuse upload pipeline. |
| Support inbox for `support_tenant`: list of member conversations sorted by last activity, unread counts | Support staff need an Intercom-style inbox, not one chat window. | MEDIUM | Multiple support agents share one inbox in V1; assignment can wait. |
| Push notification on new support reply | In scope. | LOW | Depends on notification module. |

#### Notifications

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| In-app center (bell + unread count) listing: likes on my content, comments/replies to me, new posts, events, support replies | In scope; matches Circle's in-app notification categories (comments on your posts, replies, mentions, likes, DMs, new posts per space, events). | MEDIUM | Single `notifications` table with `type`, `actor`, `target`, `read_at`; grouped rendering ("Ana e mais 3 curtiram"). |
| Web Push via PWA | In scope. | HIGH | iOS requires 16.4+, install to Home Screen via Safari, and a user-gesture permission prompt; no `beforeinstallprompt` on iOS so you must build an "Adicionar à Tela de Início" instruction flow. Android Chrome supports both prompt and push in-browser. Expect meaningful non-delivery on iOS until installed. |
| Per-category on/off preferences (at minimum: likes, comments/replies, new posts, events, chat) x (in-app, push) | Every comparable exposes this; Skool's noisy defaults are its most-cited complaint. "All-or-nothing" forces users to choose nothing. | LOW-MEDIUM | Ship a simple matrix page in V1; the cost of retro-fitting preferences after members turn off OS-level push (permanent loss) is high. |
| Sensible defaults: push on for replies/chat/events, off for likes | Reduces the Skool problem; likes are the highest-volume, lowest-value class. | LOW | |
| Batching of like notifications | Standard; otherwise a popular post spams the admin. | LOW-MEDIUM | Collapse by (type, target) within a window. |

#### Moderation and safety

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Admin deletes any comment/reply | In scope; universal. | LOW | Soft-delete with `deleted_by` and reason. |
| Admin blocks a member (loses access) | In scope. Circle "remove + ban", Kajabi/Tumblr "remove + ban to prevent rejoining". | LOW | Must also invalidate the session (Supabase: ban user / revoke refresh tokens) and prevent re-signup via the public link with the same email. |
| Member can **report** a comment/post with a reason | Circle, Mighty, Kajabi, BuddyBoss all have it; Apple Guideline 1.2 makes report + block + 24h response the industry baseline for UGC. Even in V1 (admin-only posts) **comments are UGC**, so this applies. Missing report = no channel for members to flag abuse other than support chat. | LOW | `reports` table + admin queue view. Cheap; do it in V1. |
| Moderation log (who deleted/blocked what, when, why) | Bettermode, Kajabi, Reddit, Discord all surface an audit log; the tenant admin is accountable for actions taken by moderators/support. | LOW | Append-only table written by the moderation service. |
| Published contact / terms + community rules shown at sign-up | Apple 1.2 requires EULA with no-tolerance clause; also needed for LGPD consent. | LOW | Tenant-editable "regras da comunidade" text + TRIA terms/privacy links. |

#### Admin / tenant panel

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Branding editor with live preview (logo, colors, favicon, name) | Every white-label product; the tenant admin will iterate colors until it "looks like us". | MEDIUM | Preview the actual app shell, not a swatch. Validate contrast (WCAG AA) so a tenant cannot pick unreadable text-on-brand. Auto-derive tints/shades from one or two brand colors rather than exposing 12 tokens. |
| Content composer for posts, stories, events with media upload, embed detection, draft state | Baseline for an admin-publishes-everything model. | MEDIUM | Mobile-friendly composer matters: church/creator admins publish from phones. |
| Scheduled publishing for posts | Circle documents drafts + scheduled posts; admins who publish "todo dia às 7h" expect it. | LOW-MEDIUM | `publish_at` + the same cron runner used for event reminders. Cheap once the job runner exists. |
| Member management: list, search, role change (member/support/admin), block/unblock, remove | Universal. | LOW | |
| Event attendance list (confirmed vs checked-in) + CSV export | In scope; Mighty exports RSVP CSV. | LOW | |
| Reports queue | Pairs with report feature. | LOW | |
| Basic analytics: member count and growth, active members (7d/30d), posts/likes/comments counts, top posts, event RSVP/check-in rates | Circle ships analytics on all plans; Bettermode "Reports"; Subsplash "content analytics". Admins need to justify the subscription to their own board. | MEDIUM | V1 can be counters over existing tables; no data warehouse. Pick 6-8 numbers and a date range. |
| TRIA platform panel (`super_admin`): create tenant, set initial branding, toggle modules, create first admin, view tenant list/status | In scope. | MEDIUM | Impersonation ("ver como este tenant") is a huge support time-saver; log every impersonation. |

#### PWA / mobile

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Installable PWA with tenant-branded icon/name, standalone display, splash | In scope; members compare against native apps. | MEDIUM | Per-tenant manifest (see branding). iOS needs apple-touch-icon per tenant too. |
| Install guidance ("Adicionar à Tela de Início") shown contextually, especially on iOS | Apple ships no install prompt; without guidance most iOS members never install, and then never get push. | LOW-MEDIUM | Show after a value moment (first RSVP, first support message), not on first load. Detect standalone mode and hide it once installed. |
| Fast, offline-tolerant shell (cached shell, graceful "sem conexão" state) | Members open the app on the bus. | MEDIUM | Service worker caching for shell + last feed page. Do not attempt full offline write queues in V1. |
| Native-feeling gestures: pull-to-refresh, bottom tab bar, story swipe, image pinch-zoom | Mobile-first promise. | MEDIUM | |
| Bottom navigation driven by feature flags | Ties module toggles to visible UX. | LOW | |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable. Aligned with the Core Value ("feels like *their* community, zero leakage").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Admin broadcast stories ("status" model)** — treat stories as WhatsApp-Status-style announcements from the organization, with view counts and reply-as-comment | No community SaaS competitor has stories; Brazilian members already live in WhatsApp Status/Instagram Stories daily. Positioned as "the organization's daily status" (admin-only) it avoids the Fleets/LinkedIn failure mode (which was *member* ephemeral content nobody wanted to make). Gives the admin a low-effort daily touchpoint that beats a feed post for urgency. | MEDIUM | Make it succeed: show the admin per-story view counts and viewer list; allow re-sharing a story into a post; allow pinning to a community (Highlights). Do **not** open member stories in V2 without evidence. |
| **Self check-in with a check-in window** (no QR hardware) | Circle/Mighty have no check-in; church apps need scanners or kiosks. A "Fazer check-in" button that is enabled only from T-1h to T+2h (and optionally within N km of the venue via geolocation) gives the admin a real attendance list with zero hardware — differentiating for schools, churches, associations. | MEDIUM | Time window LOW; geofence adds MEDIUM (permission prompt, GPS jitter, indoor). Ship time-window first; add an admin "marcar presença" override for members without phones; keep QR as a V1.x option (admin shows a rotating QR on a screen, member scans). |
| **Feature flags per tenant with navigation that reshapes itself** | Circle forces one type per space; Skool forces one shape for all. Tenants that only want feed+events get a two-tab app that feels purpose-built. | LOW | Already in scope; the differentiator is treating it as a product surface in the TRIA panel, not a config file. |
| **Branded end-to-end, including manifest, home-screen icon, splash, push sender name, and emails** | Mighty only gives a standalone branded app on Pro (enterprise) tiers; Disciple charges to remove its logo. TRIA giving full white-label at every tier is a selling point. Push notifications that show the tenant's name/icon rather than "app.seusistema.com" are the visible proof. | MEDIUM | Push notification `icon`/`badge`/`title` per tenant; email sender display-name per tenant. |
| **Support chat as a first-class tenant role** | Circle/Skool have DMs but no "support inbox" concept; institutions want a help desk, not a social DM. | MEDIUM | Already in scope. Add canned replies and "resolved" state in V1.x. |
| **Deep-link sharing that lands inside the branded app after login** | Turns every WhatsApp forward into a re-engagement loop into the tenant's own app rather than a public web page; keeps content private (institutions care). | LOW | Already in scope. Add OG title/image on the login interstitial (without content) so the WhatsApp preview still looks branded. |
| **Grouped, low-noise notifications by default** | Skool's noisiest complaint; be quiet by default and loud on what matters (event reminders, support replies). | LOW | Cheap and visible. |
| **Admin "who saw it" on stories and "who is coming" on events** | Institutions (schools, churches) care about reach and attendance more than likes. | LOW | Falls out of `story_views` and RSVP tables. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems — or that PROJECT.md already excludes for good reason.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Member-created stories (V1 or early V2) | "Instagram has it" | Ephemeral member content failed at Twitter (Fleets) and LinkedIn; in small communities almost nobody posts stories, and empty strips look dead. Also multiplies moderation surface (video, no time to review). | Keep stories admin-only ("status da organização"). Revisit only if a pilot tenant's members ask. |
| Deep nested comment threads | "Like Reddit/Circle" | Unreadable on phones; the user already chose one level. | Keep depth=1 with a DB constraint; use @mentions for addressing. |
| Emoji reactions set | "Slack/Discord have it" | Out of scope by decision; adds UI + aggregation + notification complexity for little pilot value. | Plain like; add reactions as a later flag if a tenant asks. |
| Email/WhatsApp notification channels in V1 | Admins love WhatsApp in Brazil | WhatsApp Business API needs Meta approval, template review, per-message cost; email needs deliverability work. Both delay the pilot. | Push + in-app in V1; design the notification module with a `channel` enum so email/WhatsApp are adapters later. |
| Public (logged-out) post pages / SEO | "Share to Instagram bio" | Breaks the private-community promise and leaks tenant content; needs a second rendering path and OG-image generation. | Internal deep links with a branded login interstitial. |
| Custom domains per tenant in V1 | White-label completeness | TLS automation, DNS support tickets, cookie/tenant-resolution changes. | Single URL now; keep tenant resolution decoupled from hostname. |
| Gamification (points, levels, leaderboard) | Skool's headline | Distorts behavior in institutions (churches, schools); meaningless when only the admin posts. | Revisit in V2 with member posting. |
| Courses / LMS inside the community | Circle/Kajabi/Skool bundle it | Whole separate product; not the core value. | Link out to existing course tools; embed videos in posts. |
| Live streaming / live rooms | Circle/Kajabi/Disciple ship it | Infrastructure-heavy (WebRTC/RTMP, cost per minute). | "Online event" with an external link (YouTube Live, Zoom, Meet). |
| Realtime everything (live like counters, presence dots on feed) | Feels "alive" | Realtime channels per tenant per post explode connection counts and cost on Supabase; PROJECT.md forbids direct Supabase access from the frontend anyway. | Realtime only for chat and the notification badge; poll or refresh-on-focus elsewhere. |
| Full offline mode with write queues | "PWA should work offline" | Conflict resolution for likes/comments/RSVP across tenants; large surface for a pilot. | Cached shell + read-only last feed + clear offline banner. |
| AI features (auto-moderation, summaries, agents) | Circle markets them heavily | Zero pilot value until there is member-generated volume; cost and pt-BR quality unknowns. | Keyword blocklist per tenant (cheap) in V1.x; revisit AI in V2. |
| QR-scanner-based check-in as the *only* check-in path | "Like Luma/Pushpay" | Needs a second device and someone at the door; small tenants will not staff it. | Self check-in window + admin override; QR as an optional add-on. |
| Exposing 12+ theme tokens in the branding editor | "Full control" | Tenants produce unreadable palettes; support burden. | 2-3 brand colors + logo; derive the rest; enforce contrast. |

## Feature Dependencies

```
[Tenant + branding record]
    └──required by──> [Per-tenant PWA manifest/icons]
    └──required by──> [Branded auth emails]
    └──required by──> [Feature flags -> navigation]
    └──required by──> [TRIA platform panel: create tenant]

[Auth + public sign-up link]
    └──required by──> [Member profile]
                          └──required by──> [Member directory]
                          └──required by──> [Likes/comments (actor identity)]
                          └──required by──> [Chat participants]

[Media upload pipeline (image/video/file, tenant-scoped storage)]
    └──required by──> [Feed posts with media]
    └──required by──> [Stories]
    └──required by──> [Events (cover)]
    └──required by──> [Chat attachments]
    └──required by──> [Branding editor (logo/favicon upload)]

[Feed posts]
    └──required by──> [Comments/replies] ──required by──> [Likes on comments]
    └──required by──> [Pinning]
    └──required by──> [Share deep link]
    └──required by──> [Moderation: delete comment, report]

[Communities]
    └──enhances──> [Feed posts] (community_id scoping)
    └──required by──> [Story pin to community]
    └──enhances──> [Notification preferences] (per-community new-post toggle)

[Notification module (in-app table + dispatcher + preferences)]
    └──required by──> [Web Push]
    └──required by──> [Event reminders]
    └──required by──> [Chat: new support reply push]
    └──required by──> [Like/comment/new-post notifications]

[Scheduled job runner (cron on Cloud Run)]
    └──required by──> [Event reminders]
    └──required by──> [Scheduled post publishing]
    └──required by──> [Story expiry housekeeping (optional; can be query-time)]

[Events + RSVP]
    └──required by──> [Check-in] ──required by──> [Attendance list / CSV]
    └──required by──> [Add to calendar]
    └──required by──> [Event reminders]

[Chat (conversations + participants + messages)]
    └──required by──> [Support inbox]
    └──required by──> [V2 member-to-member chat] (same schema)

[Moderation: block member]
    └──requires──> [Auth session revocation]
    └──requires──> [Moderation log]

[Report content] ──requires──> [Admin reports queue]

[PWA install guidance] ──enhances──> [Web Push] (iOS push impossible without install)

[Analytics] ──requires──> [all content + RSVP + check-in tables] (read-only aggregation, last)

[Member-created posts/communities (V2)] ──conflicts──> [Admin-only composer assumptions]
   -> keep authorship generic (author_id + tenant policy), not "admin composer"
```

### Dependency Notes

- **Branding requires tenant record before any UI work:** the app shell, manifest and emails all read from it; build it in the first phase or every later phase re-touches the shell.
- **Media pipeline is a hidden prerequisite for four modules:** feed, stories, events, chat all upload. Build it once (tenant-scoped bucket paths, signed URLs, image resize, video caps) before the first content module.
- **Notification module must exist before Web Push, event reminders and chat push:** these are three consumers of one dispatcher. Preferences belong in the same phase so defaults are quiet from day one.
- **Job runner unlocks two cheap features:** event reminders and scheduled posts share the same cron; building it for reminders makes scheduling nearly free.
- **Check-in requires RSVP only logically, not technically:** allow check-in without prior RSVP (walk-ins), but count them separately in the attendance list.
- **Block member requires session revocation:** blocking only at the DB layer leaves a live JWT working until expiry.
- **Web Push on iOS requires install guidance:** without an install flow, push effectively does not exist for iPhone members.
- **V2 member posting conflicts with an "admin composer" mental model:** design post/community/story tables with a generic `author_id` and a per-tenant policy ("who can post"), so V2 is a permission flip.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept with one pilot tenant.

- [ ] Tenant record + branding (logo, colors, favicon, name) + per-tenant manifest — the core value; nothing else matters if it does not feel like the tenant's app
- [ ] Feature flags per tenant driving bottom navigation — required to sell "modular"
- [ ] TRIA platform panel: create tenant, set branding, toggle modules, create first admin — required to onboard the pilot at all
- [ ] Public sign-up link, email/password auth, password recovery (branded emails) — required to get members in
- [ ] Profile (photo, bio), view others, simple member list with "hide me" — social baseline + LGPD-friendly
- [ ] Media pipeline (images multi, video with caps, files, link/YouTube unfurl) — prerequisite for all content
- [ ] Feed: admin posts, like, comment, one-level reply, comment likes, pin, edit/delete, share deep link — the daily habit
- [ ] Communities: admin creates, posts scoped, list/detail with pinned stories — structure the tenant expects
- [ ] Stories: admin-only, 24h, viewer with standard gestures, seen state, like/comment, pin to community, admin view counts — the promised differentiator; ship it properly or not at all
- [ ] Events: list/detail, RSVP (going/not going), who is going, add-to-calendar, update/cancel notifications, reminders (T-24h, T-1h), self check-in window + admin override, attendance list + CSV — the institution-grade feature
- [ ] Support chat: member <-> support conversation, realtime, attachments, unread badges, read receipts, support inbox for `support_tenant` — the help-desk promise
- [ ] Notifications: in-app center with grouping, per-category x per-channel preferences with quiet defaults, Web Push, iOS install guidance — without preferences, push gets turned off at the OS level and is lost
- [ ] Moderation: delete comment/reply, block member (with session revocation), member report with admin queue, moderation log, community rules text — comments are UGC; report/log are cheap
- [ ] Admin panel basics: composer for posts/stories/events, member management, reports queue, attendance list, 6-8 analytics counters
- [ ] Account deletion (self-service anonymize) — LGPD baseline for a Brazilian pilot

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] Scheduled post publishing — when the admin asks to "post every morning"; trivial once the cron runner exists
- [ ] "Maybe" RSVP state and event capacity/waitlist — when an event fills up
- [ ] QR check-in (admin shows rotating QR; member scans) and/or geofenced self check-in — when a tenant runs large in-person events
- [ ] Typing indicator, canned replies, "resolved" state, assignment in support inbox — when more than one support agent is active
- [ ] Keyword blocklist per tenant for comments — when first moderation incident occurs
- [ ] Email channel adapter for notifications (digest) — when push opt-in on iOS proves low
- [ ] Tenant impersonation in TRIA panel with audit log — as soon as TRIA supports more than 2 tenants
- [ ] Contrast validation + palette auto-derivation improvements in branding editor — after first tenant picks bad colors
- [ ] Re-share a story into a feed post; story archive for admin — when admins ask to keep good stories
- [ ] Weekly activity digest (in-app/push) — retention lever once content volume exists

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Members create posts and communities (permission flip on generic authorship) — planned V2
- [ ] Member-to-member chat on the same conversation schema — planned V2
- [ ] Multi-tenant membership for one user — schema-ready, no UI until a real case
- [ ] Custom domains per tenant — after several paying tenants
- [ ] WhatsApp notifications — after Meta Business verification and a cost model
- [ ] Emoji reactions, gamification, polls — only with member posting and evidence of demand
- [ ] Billing/subscription — after pilot converts
- [ ] Multi-language UI — strings already centralized; add when a non-pt-BR tenant appears

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Tenant branding + per-tenant manifest | HIGH | MEDIUM | P1 |
| Feature flags -> navigation | HIGH | LOW | P1 |
| TRIA platform panel (create tenant) | HIGH | MEDIUM | P1 |
| Sign-up link + auth + branded recovery | HIGH | LOW | P1 |
| Media pipeline (images/video/files/unfurl) | HIGH | HIGH | P1 |
| Feed with likes/comments/replies/pin/share | HIGH | MEDIUM | P1 |
| Communities (admin-created) | MEDIUM | LOW | P1 |
| Stories (admin broadcast, full viewer UX) | MEDIUM-HIGH (pt-BR audience) | MEDIUM | P1 |
| Events + RSVP + calendar + reminders | HIGH | MEDIUM | P1 |
| Self check-in window + attendance list | HIGH (institutions) | MEDIUM | P1 |
| Support chat + inbox | HIGH | MEDIUM-HIGH | P1 |
| In-app notification center + preferences | HIGH | MEDIUM | P1 |
| Web Push + iOS install guidance | HIGH | HIGH | P1 |
| Delete comment / block member / report / mod log | HIGH (safety) | LOW | P1 |
| Basic analytics (counters) | MEDIUM | MEDIUM | P1 (thin) |
| Account deletion (LGPD) | MEDIUM | MEDIUM | P1 (thin) |
| Scheduled posts | MEDIUM | LOW | P2 |
| "Maybe" RSVP, capacity, waitlist | MEDIUM | LOW | P2 |
| QR / geofence check-in | MEDIUM | MEDIUM | P2 |
| Typing indicator, canned replies, assignment | MEDIUM | MEDIUM | P2 |
| Keyword blocklist | MEDIUM | LOW | P2 |
| Email digest channel | MEDIUM | MEDIUM | P2 |
| Tenant impersonation | MEDIUM (TRIA ops) | LOW | P2 |
| Member posting / member chat | HIGH (V2) | HIGH | P3 |
| Custom domains, WhatsApp, reactions, gamification, LMS, live | LOW-MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Circle | Mighty Networks | Skool | Bettermode / Disciple | Church apps (Subsplash/Pushpay) | Our Approach (V1) |
|---------|--------|-----------------|-------|------------------------|----------------------------------|-------------------|
| Branding | Colors/logo/layout; branded mobile app on higher tiers | Branded standalone app only on Mighty Pro | Minimal (top complaint) | Full white-label incl. domain, typography; Disciple charges to remove logo | Fully custom-branded native apps | Full white-label at every tier inside one PWA URL: logo, colors, favicon, name, manifest, push sender, emails |
| Content structure | Spaces, one type per space | Spaces mixing types; activity feed | Single feed + calendar | Spaces with posting permissions | Dynamic home screen + media | Global feed + communities; posts optionally scoped; admin-only in V1 |
| Stories | None | None | None | None | None | Admin-only 24h "status" with full viewer UX, seen state, view counts, pin-to-community |
| Pinning / scheduling | Pinned post block; drafts + scheduled posts | Featured Sections + Recommend | Pin | Pin | Featured content | Pin in V1; schedule in V1.x on the same cron as reminders |
| Comments | Threaded, nested | Threaded | Threaded | Threaded | N/A | One reply level on posts, none on stories (DB-enforced) |
| Events | One-click RSVP, reminders, calendars, RSVP limits, update/cancel notices | Going/Maybe/Not going, reminders 10m/24h, calendar sync, CSV export, message attendees | Calendar + live calls | Events | Calendar, registration/ticketing, child check-in, pre-check with barcode | RSVP + add-to-calendar + reminders + **self check-in window + admin override + attendance CSV** |
| Notifications | Email/in-app/push matrix by category and per-space; weekly digest | Email + push; per-event reminders | Digest/notification/announcement emails; noisy defaults | Configurable | Rich, targeted push | In-app center + Web Push; per-category x per-channel prefs; quiet defaults; grouping |
| Directory | Rich directory with filters/custom fields | Member list, one-tap chat | Member list with levels | Directory | Member database (staff-side) | Simple searchable list + "hide me"; profile = photo + bio |
| Moderation | Report via three-dots; moderators delete/remove/ban; block = DMs only | Report; host removes | Basic | Keyword filters, roles, audit logs | Staff tools | Delete, block (with session kill), report + queue, mod log, rules text |
| Chat | DMs + group chat + chat spaces | DMs + chat | DMs | DMs / Disciple DMs | Messaging | Member <-> support inbox only (generic schema for V2 DMs) |
| Analytics | On all plans: engagement rate, posts/comments per member, top members/content | Basic | Basic | Reports dashboard | Content analytics | 6-8 counters with date range |
| Onboarding | Invite link with tags/access groups; welcome banner; default landing | Invite link | Group link + membership questions | Invite | App download | Public sign-up link per tenant; nudge photo/bio; rules acceptance |
| Mobile | Web + branded/shared apps | Native apps on every plan (their key claim) | Web + app | Web + native (Disciple) | Native | Installable PWA; iOS install guidance for push |

## Sources

Confidence per classify-confidence seam: unverified single web source = LOW; cross-verified across 2+ independent sources = MEDIUM. Vendor help pages could only be read via search snippets (JS-rendered), which caps vendor-specific claims at MEDIUM.

**Competitor feature sets (MEDIUM where cross-checked with vendor docs, otherwise LOW)**
- Circle features overview: https://ezycourse.com/blog/circle-community-platform ; https://linodash.com/circle-community-guide/ ; https://www.g2.com/products/circle-so-circle/features
- Circle notifications matrix: https://help.circle.so/p/members/account-access-management/manage-your-notification-preferences ; https://help-en.circle.so/c/account-access-management/get-to-know-community-notifications ; https://community.circle.so/c/product-updates/in-app-notifications ; https://community.circle.so/c/product-updates/advanced-notification-settings
- Circle scheduling/pinning/space settings: https://help.circle.so/p/posts/post-spaces/scheduling-posts ; https://help.circle.so/p/posts/post-spaces/customize-post-space-settings
- Circle events (reminders, RSVP limits): https://help.circle.so/p/live-and-events/events/understanding-event-notifications ; https://help.circle.so/p/live-and-events/events/limit-rsvps-for-events
- Circle onboarding / invite link: https://help.circle.so/p/audience/onboarding/set-up-an-invitation-link ; https://help.circle.so/p/audience/onboarding/customizing-the-onboarding-experience
- Circle analytics: https://circle.so/analytics ; https://help.circle.so/c/data-analytics/how-do-i-see-community-analytics
- Circle report/block: https://help.circle.so/p/members/account-access-management/block-a-member-from-messaging-you ; https://memberpress.com/docs/moderating-memberpress-circles/
- Mighty Networks events (official docs, fetched): https://docs.mightynetworks.com/en/articles/9140701-how-do-i-manage-rsvps-and-message-event-attendees-in-my-mighty-network ; https://docs.mightynetworks.com/for-members/engage-and-interact/how-do-i-rsvp-and-attend-events-as-a-member
- Mighty Networks pinning: https://faq.mightynetworks.com/en/articles/9140752-can-i-pin-or-recommend-a-post-to-the-top-of-the-feed ; https://faq.mightynetworks.com/en/articles/3825302-how-do-i-create-and-manage-featured-and-welcome-sections
- Mighty Networks plans/branded app: https://pipeline.zoominfo.com/sales/mighty-networks-features ; https://kourses.com/what-is-mighty-networks/
- Skool reviews/limitations: https://www.learningrevolution.net/skool-review/ ; https://www.group.app/blog/skool-review/ ; https://linodash.com/skool-review/
- Skool notification complaints: https://www.skool.com/community/default-setting-no-notifications-for-members ; https://help.skool.com/article/95-how-to-manage-my-notifications
- Bettermode: https://bettermode.com/blog/white-label-community-platform ; https://bettermode.com/product/feature-index-bettermode ; https://www.group.app/blog/bettermode-community-platform-review/
- Kajabi Communities: https://www.kajabi.com/product/communities ; https://help.kajabi.com/articles/products/community/community-moderation-tools
- Disciple / BuddyBoss white-label: https://www.disciplemedia.com/features/ ; https://www.mightynetworks.com/resources/white-label-community-software ; https://buddyboss.com/blog/white-label-community-app/
- Church apps: https://pushpay.com/blog/10-best-church-app-features/ ; https://www.subsplash.com/compare/subsplash-vs-pushpay ; https://theleadpastor.com/tools/best-custom-church-apps/

**Events / check-in norms (MEDIUM)**
- Luma check-in: https://help.luma.com/p/check-in ; https://help.luma.com/p/managing-your-guest-list
- Self / geofence / time-window check-in: https://www.onetapcheckin.com/ ; https://www.myattendancetracker.com/geofence-attendance ; https://www.vfairs.com/blog/event-check-in/
- Reminder cadence: https://help.addcal.co/en/articles/15682134-rsvp-confirmations-reminders-and-notifications ; https://www.addpinch.com/the-complete-event-management-playbook-for-community-organizers/

**Notifications (MEDIUM)**
- https://www.suprsend.com/post/the-ultimate-guide-to-perfecting-notification-preferences-putting-your-users-in-control ; https://www.feedbear.com/blog/push-vs-in-app-notifications ; https://appbot.co/blog/app-push-notifications-2026-best-practices/

**Moderation / UGC baseline (MEDIUM)**
- Apple App Review Guideline 1.2: https://developer.apple.com/app-store/review/guidelines/ ; https://buddyboss.com/docs/app-store-guideline-1-2-safety-user-generated-content/
- Audit/mod logs: https://support.reddithelp.com/hc/en-us/articles/15484543117460-Moderation-Log ; https://help.tumblr.com/knowledge-base/moderating-communities/ ; https://buddyboss.com/blog/online-community-moderation-guide/

**PWA / push / share (MEDIUM, multiple vendor docs agree)**
- iOS web push requirements: https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications ; https://documentation.onesignal.com/docs/en/web-push-for-ios ; https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- Install prompt: https://web.dev/learn/pwa/installation-prompt ; https://developer.apple.com/forums/thread/807603
- Web Share API / deep links: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Share_data_between_apps ; https://web.dev/learn/pwa/os-integration ; https://modernwebweekly.substack.com/p/modern-web-weekly-51

**Stories context (MEDIUM for discontinuations; LOW for the "no competitor has stories" negative claim — absence in search, not vendor confirmation)**
- Twitter Fleets / LinkedIn Stories shutdowns: https://techcrunch.com/2021/08/03/twitter-fleets-rip ; https://platformer.substack.com/p/why-twitters-fleets-flopped ; https://www.techtimes.com/articles/264815/20210831/linkedin-stories-discontinued-end-september-due-low-usage.htm
- Brazil usage of WhatsApp/Instagram: https://www.statista.com/topics/6949/social-media-usage-in-brazil/ ; https://www.statista.com/topics/7731/whatsapp-in-brazil/ ; https://www.skillademia.com/statistics/whatsapp-statistics/

**LGPD (MEDIUM)**
- https://securiti.ai/data-subject-rights-under-lgpd/ ; https://lgpd-brazil.info/chapter_02/article_16 ; https://iapp.org/news/a/an-overview-of-brazils-lgpd

**Member directory norms (LOW)**
- https://hivebrite.io/features/member-directory/ ; https://memberlytic.com/blog/how-to-create-membership-directory-association-guide

**Support chat baseline (LOW)**
- https://getstream.io/blog/in-app-chat/ ; https://ably.com/blog/live-chat-features ; https://sendbird.com/learn/what-is-in-app-chat

---
*Feature research for: multi-tenant white-label community / branded social-app SaaS (TRIA Rede Social)*
*Researched: 2026-09-11*
