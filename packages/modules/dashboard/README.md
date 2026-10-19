# @rede-social/module-dashboard

The two `/perfil` panels on the tenant's real numbers (Phase 08.7): the client owner's panel ("Dono
do cliente", six areas, `admin_tenant` only) and the member's "Sua atividade" (role `member` only).
The module owns the whole pipe: the published contracts (`./contracts`), two snapshot tables and
their RLS (`./db`), the nightly build job, the API routes and their loaders (`./server`), and the
presentational panel primitives (`./ui`). A worker job builds one snapshot per tenant per local day,
after the tenant's midnight (D-464); both panels read the stored snapshot, never compute on open,
and say when it was taken ("Números até ontem · atualizados hoje às …"). Every number the app cannot
measure yet is "Em breve" (D-455..D-458), every group under 5 people or orders leaves the API as
"menos de 5" (D-462), and no runtime path of `apps/web` draws a fixture value (D-459, guarded by
`scripts/check-dashboard-fixtures.sh` in `pnpm lint`). The FICTIONAL fixtures (`./fixtures`) stay for
tests and component previews only; the sections "The client owner panel (level 4)" below describe
them as they were built in 2026-10, and where those sections name a web file that reads a fixture,
that reading is gone since 08.7-12.

The module has no manifest (`module.ts`): the panels are not a tenant-toggled feature and the module
is not in the API `MODULE_REGISTRY`. Its job queue and its sweep function are therefore registered
explicitly by the app registry (`apps/api/src/modules/registry.ts`) and its job is listed in
`apps/api/src/worker.ts`; its routes are mounted at `/v1/dashboard` in `apps/api/src/app.ts`. Each
owner area follows the module flag behind it instead (D-460). Level numbers (1 to 7) and "the
preview" below refer to the rede-social-dashboard project the panel comes from; the app has only
level 4 and the member's report.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./contracts` | The zod schemas of every panel answer, shared by the API (serializes) and the web (parses): `overview`, `members`, `member-lists`, `activity`, `content`, `events`, `finance`, `support`; the shared pieces in `contracts/shared.ts`: `DASHBOARD_QUEUES` (`dashboard.snapshot-build`), `DASHBOARD_SYSTEM_USER_ID` (the zero user), `NOT_MEASURED_REASONS` / `notMeasuredSchema` / `measured()` (a metric is measured with a value or not measured with a reason and NO value: there is no example branch, D-455), `preparingSchema` (`{ state: 'preparing' }`), `snapshotMetaSchema` / `snapshotWindowsSchema` (when the snapshot was taken and the windows it covers), `snapshotBuildPayloadSchema` (the job's `{ tenantId, day }`), `flooredCountSchema` / `flooredBandGroupSchema` (a floored figure carries no number); and the pure, zod-free floor (`contracts/floor.ts`): `PRIVACY_FLOOR` (5), `isBelowPrivacyFloor`, `mergeBandsBelowFloor` / `BandGroup`, `ENGAGEMENT_BAND_ORDER`. Client-safe |
| `./server` | The API tier only: `dashboardRoutes` (the Hono router mounted at `/v1/dashboard`) and each route definition; one loader per answer (`getOwnerOverview`, `getOwnerMembers`, `listOwnerBandMembers`, `getOwnerMemberDetail`, `listOwnerMemberItems`, `getOwnerContent`, `getOwnerContentDetail`, `listOwnerContentPeople`, `listOwnerContentInteractions`, `listOwnerContentUnanswered`, `getOwnerEvents`, `getOwnerFinance`, `getOwnerFinanceProduct`, `listOwnerFinanceBuyers`, `getOwnerSupport`, `getMemberActivity`); the floor applied before an answer leaves the server (`floorCount`, `floorBands`, `sortFloored`, `applyFinanceFloor`, `floorMoney`); the keyset paging wrapper (`pageInput`, `pageOf`, `NEVER_ACTIVE`); `readLatestSnapshot` / `snapshotMetaOf`; the job (`snapshotBuildJob`, `runSnapshotBuild`) and its system lane (`dashboardSystemCtx`) |
| `./db` | The Drizzle schema of `dashboard_snapshots` and `dashboard_member_snapshots` with their policies (below) |
| `./ui` | `KpiCard`, `KpiGrid`, `LineChart`, `BarList`, `ToneLabel`, `AttentionList`, `Collapsible`, `CohortHeatmap`, `ActionCard`; the pure scale helpers `linearPoints`, `pathFrom`, `niceBounds`, `barPercent`, `heatBucket` / `HEAT_BUCKETS`; the pure metric helpers (`ui/metrics.ts`): `ENGAGEMENT_BAND_ORDER`, `bandTotal`, `interactedCount`, `engagedPercent`, `percentOf`, `sumOf`, `perItem`, `topBy`, `attendancePercent`, and the privacy floor re-exported from `contracts/floor.ts` so the API and the web floor with one implementation. `KpiCard` takes an optional `badge`; the rows of `BarList` take an optional `leading` (a decorative thumbnail) and `floored: true` (no value: the empty track with the host's floor text, sorted after every shown row). `LineChart` draws `null` points as gaps. The motion pieces are `SURFACE`, `RISE` and `LIFT` (`ui/surface.ts`), `DashMotion` and `CountUp` (with its pure `countUpParts` / `countUpText`); see Card design below |
| `./fixtures` | Tests and previews only (never `apps/web` runtime, D-459): `tenantOwnerPanel` (`fixtures/tenant-owner.ts`), the band member lists (`fixtures/owner-members.ts`), the member insights and their lists (`owner-member-insights.ts`, `owner-member-lists.ts`), the posts and the Conteúdo area (`owner-posts.ts`, `owner-content.ts`), the single order list of Financeiro (`owner-finance.ts`), and the shared fixture shapes in `fixtures/shared.ts` (`ReportValue<T>` = `MeasuredValue<T>` \| `ExampleValue<T>`; the API contracts replace them with `measured()` / `notMeasuredSchema`) |

### Storage (`./db`, migration `20261018215328_dashboard_snapshots.sql`)

- `dashboard_snapshots`: one row per tenant and local day (`snapshot_day` = D), `payload_version`,
  `built_at`, `windows` and `payload` keyed by area (`overview`, `members`, `content`, `events`,
  `finance`, `support`). Policy `dashboard_snapshots_select_admin`: select for `authenticated` when
  `tenant_id = app.tenant_id()` and the claim is `admin_tenant` (D-462). Kept 8 days.
- `dashboard_member_snapshots`: one row per membership, the latest build only (band, the band 30 and
  60 days ago, last activity, 30-day counts, top community, push on, per-community bands, the
  insights and the member's own `activity`). Policy `dashboard_member_snapshots_select_own_or_admin`:
  the member's own row (`user_id = app.user_id()`) or the tenant's `admin_tenant` (D-462, D-463).
  Keyed by `(tenant_id, membership_id)`, so a shared identity's activity in one tenant never counts in
  another.
- Neither table has a write policy, and `authenticated` lost insert, update, delete and truncate on
  both: only the builder writes. Payloads hold ids and numbers only (PR-1): names, captions, comment
  text and labels are joined live in the reader's own lane.

### Database functions (hand-written migrations)

All `security definer set search_path = ''`, pinned to `app.tenant_id()`, except the prune:

| Function | Migration | What it does |
|---|---|---|
| `app.dashboard_build_snapshot(date)` | `20261018215342` (final: `20261019035403`, payload version 8) | Builds day D for the lane's tenant: the member rows, then every area key, in one transaction. Executable by `authenticated` but refuses every caller but the zero user (T-08.7-03), refuses a day that is not complete yet (22023), and skips a day already built at the current version |
| `app.dashboard_member_actions(date, date)` | `20261018222405` | The counted-action stream (like, live comment, post, RSVP "vou", check-in or walk-in, paid order) per membership, the bands' only input |
| `app.dashboard_member_rows(date)` | `20261018222405` | The member rows: band today, D-30 and D-60, insights, per-community bands |
| `app.dashboard_area_members(date)` | `20261018222405` | Membros: bands, movement, growth, per-community and per-event bands |
| `app.dashboard_member_activity(date)` | `20261018225848` | The member's own "Sua atividade" numbers (last 7 complete days against the 7 before; attendance over 30 days) |
| `app.dashboard_area_content(date)` | `20261019003131` | Conteúdo: KPIs, by kind, trend, heatmap (tenant-local weekday and slot), by community, associations |
| `app.dashboard_area_events(date)` | `20261019014815` | Eventos: upcoming, attendance by event and by the band of the day before, `attendanceTotals` |
| `app.dashboard_area_finance(date)` | `20261019022117` | Financeiro: primary and secondary revenue, by product and band, the ladder, associations, VIP |
| `app.dashboard_area_support(date)` | `20261019032741` | Atendimento: queue, first-response medians per week, conversations per week, staff, moderation |
| `app.dashboard_area_overview(date)` | `20261018215342` (final: `20261019035403`) | Visão geral: `enteredAtRisk` and the account; the other cards compose the area keys |
| `app.dashboard_snapshots_prune(int)` | `20261019035403` | Retention: deletes at most `least(p_batch, 500)` tenant rows older than 8 days before their tenant's local today, oldest first; `security invoker`, executable by `service_role` only |

The area and member functions are executable by no role: only the builder calls them.

### The job and the dispatcher

`dashboard.snapshot-build` (`snapshotBuildJob`, concurrency 1) takes `{ tenantId, day }` and runs the
builder once in `withTenantTx` under the zero user with role `support_tenant` and a 120 s statement
timeout; its log lines carry ids and timings only. Nothing in the module schedules it: the kernel's
`kernel.daily-tenant-dispatch` (`registerDailyTenantJobs`, `packages/core/server/tenancy/daily-dispatch.ts`)
enqueues each active tenant's local yesterday every hour and re-arms itself, and the worker's boot
dispatches every tenant at once (a separate singleton), so a new revision rebuilds within minutes. A
payload version bump makes the next dispatch rebuild every tenant.

### Routes (`/v1/dashboard`, all `GET`, `Cache-Control: no-store`)

`requireAuth` on the router (401; a session on another tenant's host is 403 `TENANT_HOST_MISMATCH`),
then per route the area's `requireModule` (Eventos `events`, Financeiro `store`, Atendimento `chat`;
404 `MODULE_DISABLED`) and the role (403 `FORBIDDEN`), the ROLE-06 order:

- `requireRole('admin_tenant')`: `/owner/overview`, `/owner/members`, `/owner/members/bands/{band}`,
  `/owner/members/{membershipId}`, `/owner/members/{membershipId}/lists/{list}`, `/owner/content`,
  `/owner/content/interactions`, `/owner/content/unanswered`, `/owner/content/items/{itemId}`,
  `/owner/content/items/{itemId}/people/{who}`, `/owner/events`, `/owner/finance`,
  `/owner/finance/products/{productId}`, `/owner/finance/buyers/{list}`, `/owner/support`. An id of
  another tenant, of staff or unknown is one bare 404.
- `requireRole('member')`: `/activity`, the caller's own row (no user-id parameter, D-463).

An area key that is missing or fails its contract answers `preparing`; the web shows the preparing
card, never a sample. Module-gated parts are omitted, never zeroed (D-460). Lists page by keyset (1 to
50 rows) and read live rows bounded by the snapshot's `untilAt`, never `now()`, except the unanswered
comments (a live 24-hour cut).

### The floor and "Em breve"

- **Floor (D-462).** Every group total under 5 people or orders (story reach by band, a publication's
  reactivated members, RSVPs per event, orders and their cents, every finance group) leaves the API
  as a floored value with no number; a product's buyers by band are merged with
  `mergeBandsBelowFloor`. The web renders it as "menos de 5" through one shared renderer; no component
  tests `n < 5`. No floored group comes back by subtraction (C-1): where Financeiro's parts sit
  beside an exact parent (a product's revoked orders and the area's, a post's sales by product, the
  posts and events beside their association totals), `applyFinanceFloor` withholds one shown part or
  the parent (`null`, or left out of its list) so the remainder always holds 5 or more people.
- **"Em breve" (D-455..D-458).** A metric with no source is `{ measured: false, reason }` in the
  contract: the web draws the "Em breve" tile, block or inline line (one string family on both
  panels), ignores any delta, chart, link or count-up, and keeps the card in the prototype's place. A
  list behind an "Em breve" number does not open.

The member's "Sua atividade" lives in `apps/web/components/profile/activity` (the super_admin's
preview keeps its own preview-only mock in the answer's shape,
`apps/web/components/platform/preview/member-activity-preview.ts`). The rede-social-dashboard
preview's other levels and the pieces only they use (`ResponsiveTable`, `Sparkline`, the funnel and
member-report helpers) were not brought.

UI rules (MOD-02, PWA-03, UI-03): a component holds no route, no clock and no words: every string,
href and formatted value is a prop decided by the web tier (`apps/web/components/dashboard`, copy in
`apps/web/messages/pt-BR/dashboard.json`). Colours only through token utilities and `currentColor`;
every status is an icon plus text; charts are plain SVG drawn to scale (series in brand, previous
period dashed in the tertiary text token); nothing scrolls sideways (KPI rows wrap). The layout reads
the panel's `@container` (`OwnerPanelSection` is one), not the window: from a 56rem container
(`@4xl`) a KPI row has no empty tracks and the areas go to two columns. On `/perfil` the content
column is at most 680px, so the panel keeps its phone layout at every window size.

Card design: every block sits on one surface (`SURFACE`: 16px radius, hairline border, soft shadow)
marked `RISE` (`.dash-reveal`): it waits hidden and rises in when it scrolls into view, staggered by a
`[data-dash-stagger]` parent. The host mounts `DashMotion` once (an IntersectionObserver that sets
`[data-revealed]`, also on surfaces added later); what moves inside a surface starts only then: a
`LineChart` sweeps in from the left (`.dash-sweep`) and its last dot pops, bars grow (`.dash-grow`),
heatmap cells pop along the diagonal, and every number counts up from zero (`CountUp`: KPI values,
bar values, heatmap cells; it keeps the host's pt-BR format and ends on the host's exact text, and it
is hidden while pending so it never flashes). A `KpiCard` is numbers first: the top row is an
optional icon tile with the label beside it, then the host's tag and a linked card's arrow; the value
carries its change as a compact chip when the host gives the bare `amount` (the whole comparison in
the chip's tooltip and for screen readers); a note keeps to two lines. A card inside a `group/link`
lifts with a brand glow on hover. `LineChart` has a fixed pixel `height`: only its plot stretches
with the card, so text never grows or distorts. Under reduced motion everything shows at once, and
without script everything shows as is (the CSS lives in `@rede-social/ui`'s tokens.css, in its
"Dashboard motion" block).

## The client owner panel (level 4)

**Look (user decision, 2026-10-15): the member report's rules.** Every area draws its cards and
charts like "Sua atividade": every `KpiCard` has an icon with its label beside it and the change in a
chip; no explanatory notes, captions or footnotes (a number that mattered became a card, a unit or a
short footer with an icon); a chart that goes with a number sits in that `KpiCard`, beside it, at a
fixed 150 px; every block is a `SURFACE` that rises in (`RISE`, cascading under `data-dash-stagger`)
and every number counts up (`CountUp`); a card that opens a list or a detail is a whole-card link
(`CardLink` in the web tier, `linked` on the `KpiCard`, `LIFT` on a host's own card). The areas sit on
the member report's grid (`apps/web/components/dashboard/ownerGrid.ts`: one column on a phone, two
from a 56rem container, four from 100rem). **No "exemplo" pill and no "valores de exemplo" line is
drawn**: where the sections below mention one, it is no longer on screen; the `ExampleValue` flags stay
in the fixtures for the real wiring, and the table below still lists what must be collected.

The client owner's panel (`tenantOwnerPanel`, `fixtures/tenant-owner.ts`) has six areas, in this
order: Visão geral, Membros, Conteúdo, Eventos, Financeiro and Atendimento. The web tier picks the
area with `?area=<slug>` on `/perfil`, where the slug is one of `visao-geral`, `membros`,
`conteudo`, `eventos`, `financeiro` and `atendimento` (an allow-list in
`apps/web/lib/owner-panel.ts`); anything else, or no `area`, renders `visao-geral`. The tabs are
plain links, so they work without JavaScript, and the header keeps the period and the alerts bell in
every area. The bell holds three items: conversations waiting for an answer (no member is named), the
next event with few seats left (its day and hour, 261014-dwc PD-16), and the members who entered "em
risco" this week.

In the source preview, level-4 numbers equal level 5's where they describe the same thing (the
support queue, the first response, the next event, attendance, communities, top posts, moderation,
store products); the app has no level 5, so `tests/tenant-owner.test.ts` pins those values as
literals and proves every sum. Percents and per-post figures are computed from the
raw counts, never typed.

Since Phase 08.7 the panels draw the API's answers, not these fixtures. The table says, per metric,
what the snapshot measures today and from which rows, or that it reads "Em breve" and why (the
`NOT_MEASURED_REASONS` reason of the contract, D-455; the three D-465 columns are recorded but never
written):

| Metric | Source today | Where it comes from, or what must be collected (reason) |
|---|---|---|
| Salvamentos (cartões e detalhe da publicação) | "Em breve" | Saves per post (`needs_saves`) |
| Compartilhamentos (cartões e detalhe da publicação) | "Em breve" | Shares per post (`needs_shares`) |
| Alcance e visualizações por publicação, alcance por faixa, taxa de engajamento | "Em breve" | Post views per member (`needs_post_views`), kept only to count (P3) |
| % assistido, retenção do vídeo | "Em breve" | Video playback per member (`needs_video_playback`) |
| Até o último cartão (carrossel) | "Em breve" | How far each member swiped a gallery (`needs_gallery_swipes`) |
| Cliques no link | "Em breve" | Link clicks per post (`needs_link_clicks`) |
| Toques no story (avançaram, voltaram, saíram) | "Em breve" | Story taps per viewer (`needs_story_taps`) |
| Lista de espera | "Em breve" | Only `events.capacity` exists; a waiting list per full event: who joined it, who got a seat, who came (`needs_waitlist`) |
| Acessos que vencem em 7 dias | "Em breve" | `store_entitlements.expires_at` is never written (D-465): fill it when a time-limited access is granted (`needs_access_expiry`) |
| Atendimentos por assunto | "Em breve" | `chat_conversations.subject` is never written (D-465): a subject on each support conversation (`needs_support_subject`) |
| Receita do cartão de evento | "Em breve" | No ticket sale is recorded: the ticket price and sales of each event (`needs_event_tickets`) |
| Ofertas (composição e preço, entrada ou adicional) | "Em breve" | No offer table, no `offer_id` on the order (`needs_offers`); the ladder and every list are keyed by product |
| Tempo médio diário, horários de pico (both panels) | "Em breve" | Usage sessions (`needs_usage_sessions`) |
| Posts e vídeos vistos ("O que você viu") | "Em breve" (stories seen are measured) | Post views and playback (`needs_post_views`, `needs_video_playback`) |
| Crescimento: entraram, novos por semana | measured | `memberships` joined dates (active role members) |
| Crescimento: saíram, saldo | "Em breve" | `memberships.deleted_at` is never written (D-465): a leave or removal flow (`needs_member_exit`) |
| Interações por post, por comunidade | measured | likes + live comments joined to `feed_posts.community_id` |
| Melhor dia e horário para publicar | measured | likes + comments by the post's weekday and slot in the tenant's timezone |
| Visualizações por story, visualizações únicas de story | measured | aggregate `story_views` (unique member viewers up to the snapshot's end; totals only, never who viewed, PR-5) |
| Próximos eventos, comparecimento, presencial × online, quem vai | measured | `events.capacity`, RSVPs "vou", check-ins and walk-ins; attendance by the band of the day before the event |
| Receita primária e secundária | measured | the first paid `store_orders` row per member is primary, every later one secondary (computed, never stored); paid as of the snapshot's end |
| Receita por produto e por faixa, quem compra | measured | paid `store` orders of active role members by product, and by the buyer's band; groups floored |
| Escada de compra | measured | each member's first and second paid orders, by product |
| Vendas depois de publicação e de evento | measured association, not cause (PR-6) | paid orders within 7 days after the member's own like or comment on a publication, or check-in at an event |
| Fila, 1ª resposta, atendimentos por semana, equipe | measured | support chat conversations; member turns and the next staff message (`chat_messages.author_user_id`); staff named live |
| Moderação | measured | `moderation_log` (removed comments, blocks, unblocks) of the 30 days and the tenant's live comments |
| Faixas por comunidade | measured | the counted actions joined to the community, for the community's base (`app.community_viewer_ids`) |
| Membros de cada faixa | measured | the member rows of the latest build (band, last counted action) |
| Faixas por evento | measured | the whole-base band of each member with an RSVP "vou" to the event |
| Cartão de comunidade | measured | access (the base), members with a counted action in the community, the 30-day posts and their interactions |
| Cartão de evento | measured, receita "Em breve" | `events.starts_at` and `ends_at` − `starts_at`; receita needs tickets (`needs_event_tickets`) |
| Insights do membro | measured, with "Em breve" lines | one member's counted actions, RSVPs and check-ins, paid orders and support turns; daily time (`needs_usage_sessions`), posts seen (`needs_post_views`) and access expiry (`needs_access_expiry`) are "Em breve" |
| Tipo de publicação (Conteúdo) | measured | SPEC §2.3: `feed_posts.media_kind` video; gallery with 1 `feed_post_media` row = foto, 2+ = carrossel; `none` with a link preview = link, else texto; a `stories` row = story |
| Curtidas e comentários por publicação, e quem curtiu ou comentou | measured | `feed_likes` / live `feed_comments` per member, names joined live (`admin_tenant` only, D-462) |
| Comentários respondidos pela equipe e 1ª resposta | measured | the staff replies under each comment (author role) and their time |
| Reativados, inscrições, vendas e assinaturas da vitrine até 7 dias | measured association, not cause (PR-6) | the same member's counted actions, RSVPs "vou", paid orders and VIP purchases within 7 days after their first interaction with the publication; floored |
| "Sua atividade": curtidas, comentários, stories vistos, onde interage, presença, sequência | measured | the caller's own member row (`activity`), last 7 complete days against the 7 before, attendance over 30 days (D-463) |

#### Faixas por comunidade e membros de cada faixa (261012-pkd, 261012-qer, 261012-tru)

The "Faixas de engajamento" block of the Membros area is one cascade in three equal tabs
(261012-tru D-01): **Por membro**, **Por comunidade** and **Por evento**, one row and no other menu
below it at any level. Every tab opens on the same six bands with the whole base's counts, each
member counted once (D-02); a note under the Por comunidade and Por evento tabs says so. A band
opens its member cards (Por membro), or the four community cards or the seven event cards (upcoming
soonest first, then past most recent first), each saying how many of the band it holds ("N nesta
faixa"). A card with members in the band opens, in the same place, that band's members in that
community or event (D-05), with a "Voltar às comunidades" / "Voltar aos eventos" link back to the
cards; a member card opens the insights (D-06), whose "Voltar" returns to that exact step. A card
with 0 in the band reads "0 nesta faixa" and is not a link (every event's Inativos).

The levels live in the URL and the web tier reads them in `apps/web/lib/owner-band-scope.ts`, in
order: `?recorte=` (`comunidade` or `evento`, else Por membro), `?faixa=` (one of six slugs, else all
bands closed), `?comunidade=` (the fixture id without its `c-` prefix) or `?evento=` (the event id),
then `?membro=`. An invalid value at any level falls one level up, never to an error: an unknown or
repeated item, an item with no band, or an item with nobody in the band shows the band's cards; a
`membro` outside the band of the opened list shows that list. `ownerMembersHref` builds every link
in the same parameter order; until a member opens, it ends in `#faixas`, so it lands on the block,
and every level works without JavaScript.

The community card (D-03) is the communities module's own cover (`CommunityCover`, the `card` box at
16:7, its `--brand-gradient` fallback since the sample has no photo), then the name, the
description, a thin line, four columns (Membros = the community's base, Ativos na semana, Publicações
no mês, Interações no mês) and the note "Interações: comentários e curtidas". The event card (D-04)
is the events module's cover (`EventCover`, the `hero` box at 16:10), the name, a Presencial/Online
pill, a thin line and three columns split by thin lines: Data, Duração and Receita (RSVPs "vou" × the
example ticket price, one "Receita: valores de exemplo" line with the pill per list, never per
card). Planner decision: this receita is a card example only, not part of the Financeiro store
revenue, which counts paid store orders. Both covers come through the modules' public `/ui`
surface, which `pnpm boundaries` allows for `apps/web`. The same event card (`EventCard`) draws
Próximos eventos in the Eventos area (quick 261013-p31), with Inscritos / Vagas / Receita and no
link, and the bars of Lista de espera and Comparecimento por evento lead with the cover as a 56 px
16:10 thumbnail.

Por evento shows today's whole-base band of everyone who RSVP'd "vou" to the event
(`eventEngagement`). `tests/tenant-owner.test.ts` proves that each event's bands sum to its
`confirmed`, that no band exceeds the base's, that nobody is inactive (no fixture RSVP is older than
60 days), that a past event's em risco fit in its no-shows (a check-in within 30 days makes a member
active today), and that past registrants are mostly superfãs and engajados, as `attendanceByBand`.
The roster knows each member's registrations: per event and band, the first eligible slots up to the
band count, never a past event the member joined after.

The "Recuperar quem está em risco" card follows the opened community or event (261012-tru D-08,
after 261012-qer A-2): with none opened it reads the whole base's 168 em risco with 69 reachable by
push; each community and event carries its own `atRiskWithPush`, always between 0 and its em risco
(VIP 22 · 11, Encontro mensal 6 · 3).

A community's bands follow the same rules as the whole base, counting only the member's actions in
that community. Its base is who has access: the exclusive VIP counts who bought it (186), the other
communities count every member (1.240), and their novos are the base's novos.
`tests/tenant-owner.test.ts` proves that each community sums to its base, that the VIP novos fit in
the VIP orders, that no community activates more novos than it has or than the base activated, and
that no community ranks more members from superfã down to em risco than the whole base. Subiram and
Caíram stay whole-base (a planner decision: per-community movement would need its own flows), and a
line says so in the Por comunidade and Por evento tabs. Because every header is the whole base and a
community lists the band of the actions made there, a community card can hold more of a band than
the header (Geral Ocasionais 170 against 150): the note under the tab explains it.

Each band is a closed `<details>` whose summary reads "count · percent" with a mini share bar (only
Em risco is solid). A band with members whose share rounds to 0% reads "menos de 1%", and its bar
keeps a 6 px minimum (A-1). A member list shows the 10 members of the band with the most recent
activity in its list (the whole base, or the opened community or event). A band over 10 says "Os 10 com atividade mais recente" on top and ends with
"e mais N membros" beside a disabled "Ver todos" (A-3); a band with 0 members opens to "Nenhum membro
nesta faixa." (A-4, live in every event's Inativos). The body keys on the band count, so it always
agrees with the summary.

Each member is a card (B-1): an initials circle on the brand color (the profile photo replaces the
initials once real profiles are wired), the name, and four labeled lines: Membro desde, Última
atividade ("hoje às 22:40", "ontem às HH:MM", else "há N dias"), Comunidade que mais interage (in
every scope) and Tempo médio diário, an example (`needs_usage_sessions`) with its "exemplo" pill on
that line. The roster behind the lists
(`fixtures/owner-members.ts`) is a fixed table of 72 fictional names, 12 per band, and a pure builder
with no randomness and no clock. A member keeps their band or drops one level in a community, never
rises, and their last activity there is never more recent than overall; `tests/owner-members.test.ts`
proves this, the band windows, and that every list adds up to its band count.

#### Insights do membro (261012-qer B-3)

Tapping a member card opens that member's insights in place of the Membros area
(`&faixa=<band>&membro=om-NN`, after the tab and the opened community or event; `membro` must sit
in that band of that list, anything else renders the list). "Voltar" returns one step: the same
tab, band and opened community or event, at `#faixas`. Top to
bottom: the header (initials, name, band pill, Membro desde, top community); the last 30 days
(active days, likes, comments, strong actions, plus the example daily time and posts seen); the
band 60 and 30 days ago and today with a 12-week chart of active days; where they interact
(communities and post types); their event registrations and presences; their purchases (the access
expiry is an example, `needs_access_expiry`); support as counts and dates only; and a suggestion by
band whose button is disabled like every sample action.

`fixtures/owner-member-insights.ts` builds it from the roster row, purely. Every number comes from
one set of active days per member, never after the last action nor before joining, so the 30-day
counts, the weekly chart and the band history agree with each other and with the band rules.
Attended events and the VIP purchase (exactly the members with VIP access, at 19700 cents) are active
days. Across the roster, each event's attendees stay within its check-ins, the 30-day VIP purchases
within the 21 VIP orders and the support conversations within the 8 weeks' 127.
`tests/owner-member-insights.test.ts` proves all of it over the 72 members, and that the support
object has no field for message text.

The items behind the 30-day numbers (261012-tru D-07) come from two more pure fixtures.
`fixtures/owner-posts.ts` holds the client's 61 posts of the last 30 days, matching Conteúdo per
community (22 / 25 / 8 / 6) and per format (18 / 15 / 20 / 8), with the four top posts among them;
their dates do not model the weekday and time-slot split (no list shows a weekday).
`fixtures/owner-member-lists.ts` builds, from the same active days, attended events and VIP order,
the member's active days (with their actions), likes (distinct posts the member can reach, published
before the like, the newest at the roster's last activity), comments (distinct reachable posts, each
on an active day after the post was published), strong actions (comments, check-ins, the 30-day
order) and posts seen. Each list's length is its KPI, and the builder throws otherwise. Which posts
the roster liked and commented on is assigned once for the whole roster (`assignRosterInteractions`,
261013-uoi): the roster is a sample of the base, so a post's people list with a number holds at least
1 and at most 10 of its members ("e mais N" for the rest), and each member keeps a realistic
activity. Likes: up to min(its likes, 10) likers per post, each on the member's active day with the
fewest likes (at most 6 on one day). The likes KPI is unchanged (active days + the band's extras,
every active day with a like). Comments follow the band's table, never more than 2 a day:

| Band | 30-day comments | Roster |
|---|---|---|
| superfã | 6 + (j mod 4): 6-9 | 90 |
| engajado | 3 + (j mod 3): 3-5 | 48 |
| ocasional | 1 + (j mod 2): 1-2 | 18 |
| novo | j mod 3: 0-2 | 12 |
| em risco / inativo | 0 | 0 |

168 in all (96 in 2f39aec6). A post's oldest unanswered comment sits exactly at its recorded wait,
counted from the sample's 23:00 (`momentHoursAgo`, 261013-uoi C-3), and no comment of the post is
older. On a member's last day each action has its own time, the latest at the last action and each
earlier one 35 min before (261013-uoi F-1). The actions
since joining are never fewer than the 30-day ones. "Posts vistos" counts the distinct posts of
that list (every liked or commented one plus one per active day) and stays an example
(`needs_post_views`); `tests/owner-member-lists.test.ts` proves all of it for the 72 members.

On screen, Dias ativos, Curtidas, Comentários, Ações fortes and Posts vistos are links ("Ver lista")
to `&membro=om-NN&lista=<slug>#lista`, the slug one of `dias-ativos`, `curtidas`, `comentarios`,
`acoes-fortes` and `posts-vistos`. The list screen has "Voltar" to
that number (`#insight-<slug>`), the title, the member and the window, the count with the order of
the rows (and the "exemplo" pill on Posts vistos only), then the rows, or one sentence when there
are none. `lista` is read only with a valid member: anything else shows the insights (or the level
above). Tempo médio diário stays a plain card.

**Privacy (261012-pkd D-03, 261012-qer B-1/B-3, user decisions).** Until 261012-pkd, the level-4
panel showed only counts. The band lists show member names and their engagement level to the
client's team, and the insights screen shows one member's individual behavior: 30-day numbers,
events, purchases and support counts, never message text. Since 261012-tru the lists behind the
numbers also show which posts a member liked, commented on and viewed (never a comment's text).
Before real data is wired, the app's privacy notice must tell members that the client's management
sees each member's individual behavior, including those posts. Platform levels 1–3 keep aggregates
only. Only `OwnerMemberDetail.tsx` and `OwnerMemberList.tsx` read `ownerMemberInsights`, and only
`BandMembers.tsx` reads `ownerBandList`.

#### Conteúdo (261013-h51)

The Conteúdo area is one cascade of plain links in three equal tabs, as Membros: **Visão geral**,
**Por tipo** and **Publicações** (`?vista=` none, `tipos`, `publicacoes`), one row and no period
selector (30 days against the 30 before). The params, in order: `vista`, `numero` (an overview
number: `publicacoes`, `interacoes`, `taxa`, `membros`, `visualizacoes`, `alcance`), `faixa` (a band
of "Quem interage" with interactors), `tipo` (`video`, `foto`, `carrossel`, `texto`, `link`,
`story`), `post`, `quem` (`curtidas`, `comentarios`, `salvamentos`, `compartilhamentos`; there is no
views or reach value), `membro` and `lista`; on Visão geral alone, `responder` (261013-orf E-02)
opens the unanswered comments of a post in "Precisa de atenção" (over 24 h without an answer,
`needsAttention`) and ignores every deeper param; its "Voltar" lands on the row, whose anchor is
`atencao-<id>` so it never repeats a card's `post-<id>` (E-03.10). `apps/web/lib/owner-content-view.ts` reads them level by
level: each is an exact, single, allow-listed value that the opened list holds (a post of the opened
type, a member of the opened people through `ownerContentIncludes` / `ownerContentInteractorIncludes`),
and anything else falls one level up, never to an error. Every deeper step has a "Voltar" to the exact
previous URL, landing on the card or number it closed. A member opens the same `MemberCard`,
`OwnerMemberDetail` and `OwnerMemberList` as Membros.

Data: `fixtures/owner-content.ts` holds the 61 posts of `owner-posts.ts` (now with likes, comments
and media) and 16 stories, the people behind each number (the inverse of the roster's insights lists,
so a member's like and a post's liker are one fact), the overview aggregates and each publication's
detail; `tests/owner-content.test.ts` proves the sums and both directions. Every people list with a
number above 0 has at least 1 and at most 10 people; the screen counts the rest as "e mais N" and
says the list shows the members' sample (261013-uoi).
Saves take the first likers and shares the last ones. A post reaches at most 530 members (the 513
active ones and a slice of em risco), never an inativo, and em risco is at most 10% of a reach;
`reach.value.perPost` is 385, the average of the 61 posts (261013-orf E-03.4).
`ownerContentUnanswered(itemId)` gives an item's unanswered comments, oldest first, with their text
(261013-orf E-02); the oldest one is as old as the "Precisa de atenção" row says. Only
`OwnerContentPeople.tsx` reads `ownerContentPeople`, `ownerContentInteractors` and
`ownerContentInteractions`, and only `OwnerContentReplies.tsx` reads `ownerContentUnanswered`.

Covers and cards (261013-orf). Every list row that is a publication starts with its cover thumbnail
(`apps/web/components/dashboard/CoverThumb.tsx`): the member lists (a check-in shows a
ticket, an order a bag; Dias ativos has none), Interações, Precisa de atenção and the unanswered
comments screen. The thumbnail is decorative (`aria-hidden`; the row's text stays its name) and is
the same cover as the detail: the brand's own `--brand-gradient` shifted to one of five tones by the
publication's id (`coverTone`), the kind's icon, a video's length and a story's ring. When real data
is wired, the thumbnail becomes the post's media through `MediaImage`
(`packages/core/ui/MediaImage.tsx`); the gradient stays only for posts without media. Melhores
publicações, Publicações, an opened type and the number lists use a compact card: the thumbnail at
the feed's ratio (7rem high, at most 8rem wide), the caption in two lines, the meta and the four
numbers (named for screen readers); the whole card opens the detail. On the detail the cover stays
big, its sides are the same gradient darkened (no grey band) and a video or story has a disabled
"Assistir". A people card says when the person did it ("Curtiu há 3 dias"), and "e mais N" counts in
the list's own unit.

Planner decisions:

- PD-1 Reel is folded into Vídeo; stories are the sixth type only in Por tipo; the numbers and lists count the 61 feed posts.
- PD-2 The cover takes the feed's ratio (video 9:16–1.91, gallery 4:5–1.91, link 16:9, story 9:16, no cover for text), capped in height by narrowing it.
- PD-3 The tab row shows on the tab screens (an opened type or band included); deeper steps replace the area under a "Voltar".
- PD-4 Post dates do not model the weekday and slot split; the heatmap is its own aggregate (rows and columns add up to `byWeekday` / `bySlot`).
- PD-5 Quem interage uses today's band; em risco and inativos are 0 by definition; the percent is the share of the band that interacted.
- PD-6 The heatmap tint is `heatBucket` of the min–max-normalized value, so only the best cell is solid.
- PD-7 The Interações list is the interactions themselves (who, band, liked or commented, which publication, when).
- PD-8 Saves and shares people are example subsets of the likers; story likers and repliers are picked from the active roster.
- PD-9 A comment's text is never shown, except the unanswered ones on the `responder` screen (261013-orf E-02, a user decision); the commenters list puts the unanswered first.
- PD-10 Any order count under 5, zero included, reads "menos de 5 pedidos" with no value.
- PD-11 Canais left Conteúdo with nothing moved: the panel's Visão geral already has one number per area.
- PD-12 Taxa de engajamento = likes + comments ÷ the reach of the 61 posts (an example, because the reach is).

#### Financeiro (261014-dwc)

The Financeiro area is one cascade of plain links in three equal tabs, as Membros and Conteúdo:
**Visão geral**, **Produtos** and **Quem compra** (`?vista=` none, `produtos`, `quem-compra`), one
row and no period selector (30 days against the 30 before). The params, in order: `vista`, `numero`
(an overview number: `primaria`, `secundaria`, `parte-secundaria`, `recompra`, `tempo-recompra`,
`por-membro`), `atencao` (`pagantes-sumindo`, `vencendo`), `produto` (a store product, under
Produtos or opened from Visão geral), `oferta` (one of the product's offers with orders in the
month), `faixa` (Quem compra: a band with buyers, still a tab screen), `nunca` (Quem compra: a band
with someone who never bought again), `membro` and `lista`. `apps/web/lib/owner-finance-view.ts`
reads them level by level from allow-lists; a member only counts when the open list holds them
(`ownerFinanceIncludes`, it reads no names); anything else falls one level up, never to an error,
and every deeper step has a "Voltar" to the exact previous URL, landing on the card or row it closed.

Data: `fixtures/owner-finance.ts` is ONE list of store orders (`ownerFinanceOrders`) for the 1.240
members of the base (`ownerFinanceMembers`, the 72 named roster members plus 1.168 anonymous ones).
Every money total of the panel comes from it: the Financeiro tabs, the panel's month
(`kpis.orderValue`, `store.products`, the orders channel), each member's purchases in the insights,
the sales tied to a publication in Conteúdo and the 7-day orders of levels 5 and 6;
`tests/owner-finance.test.ts` proves the sums.

- **Primary revenue** is each member's first paid order, the one that gave access to the app, dated
  the day they joined; **secondary revenue** is any paid order after it, a renewal included. The
  classification is by ORDER, never by product, and is computed (`classifyOrders`), never stored.
- **Offers**: the same product sells as an entry or as an add-on, with its own composition and price
  (`FINANCE_OFFERS`: E-book + 1 ano de acesso R$ 17, Comunidade VIP + 1 ano R$ 247, E-book R$ 27,
  Comunidade VIP por 1 ano R$ 197, Mentoria em grupo R$ 490, Workshop gravado R$ 97).
- **Access by term**: an entry (and the VIP) gives one year; the end is purchase + 365, an example
  (`needs_access_expiry`). No access has ended yet, so nobody renewed.
- **Tickets out of the total**: the paid events sit in their own section of Produtos, with one
  "exemplo" pill, never in the store's revenue.
- **Cancelled = revoked** by the admin: never revenue, never an order, never primary.
- **Floor of 5** on every group total (band, publication, event, cancellations, ladder path): under
  5 it reads "menos de 5 pedidos" (or "pessoas") with no value; a product's buyers by band are merged
  with `mergeBandsBelowFloor` so no small band is deduced from the total. Named buyer lists show name
  and value, at level 4 only.

Planner decisions:

- PD-1 The month stays R$ 8.940,00; its orders go from 96 to 126 (96 entries + 30 add-ons).
- PD-2 The six offers above; add-ons keep today's unit prices, so Conteúdo's sales and level 6's purchases keep their values.
- PD-3 The month: VIP entry 11 / R$ 2.717, E-book entry 85 / R$ 1.445, Mentoria 6 / R$ 2.940, VIP add-on 7 / R$ 1.379, E-book add-on 17 / R$ 459, Workshop 0; 2 cancellations; the 30 days before at R$ 7.982 (+12%).
- PD-4 The buyer's band is today's; em risco and inativos buy nothing in the month by definition.
- PD-5 The community opened about a year ago: the 6 founders (358-364 days) are the 6 accesses ending this week.
- PD-6 The roster enters on its `memberSince`; at most one roster order in the month, on the last active day; older roster add-ons 90+ days back.
- PD-7 Level 5's store (Mentoria 3, VIP 7, E-book 35, Workshop 0) and level 6's `orders7d` (45) are the list's last 7 days.
- PD-8 The product cover is the communities module's own 16:7 `CommunityCover` (gradient fallback), no new component.
- PD-9 A product card shows Preço · Entrada · Adicional · Receita and the change vs. the 30 days before; "Parado" after 60 days unsold (two rows of two under 20rem).
- PD-10 The stalled product and the VIP line open the product from Visão geral; Voltar lands on that row.
- PD-11 "Parte da secundária no total" opens the split by product (entries × add-ons), with nothing below it.
- PD-12 Paid events: next ones first, then past ones; event cards with no link; one pill; the free ones counted.
- PD-13 Receita por semana: two line charts (primary, secondary), each against the 12 weeks before, the axis in thousands of reais.
- PD-14 A product's buyers by band are merged below 5 orders.
- PD-15 The ladder: entry offer to second purchase since joining, paths under 5 people grouped last; no row opens.
- PD-16 The Encontro mensal moved to Saturday 17/10, 19h; the bell's `event_soon` alert says its day and hour.
- PD-17 The accesses ending this week have nobody in the roster: the list shows the count, the sample line, "e mais 6 membros" and the disabled action.
- PD-18 Primary and secondary are computed by `classifyOrders`, never stored on the order.
- PD-19 The fields only the old screen read (`ordersByBand`, `store.ordersDelta`, `renewal`, `conversion`, the typed `expiringAccess7d`) left the fixture.

Only `OwnerFinancePeople.tsx` reads `ownerFinancePeople`; no level 1-3 file imports `owner-finance`.

#### Para quando os dados reais forem ligados

**Privacy of Conteúdo (261013-h51 D-07, user decisions, next to the notice above).**

- P1: the names of who liked or commented on a publication are shown at level 4 only, to the client's
  team, as in Membros; platform levels 1–3 keep aggregates only. The privacy notice must say so.
- P2: revenue per publication is shown only from 5 orders on; below that it reads "menos de 5
  pedidos", with no value.
- P3: views per member are recorded only to count them, never to list who viewed; they are kept 90
  days. No views or reach number opens a list of people (the parser has no such `quem` value).
- P4 (261013-orf E-02, user decision): the text of a comment the team has not answered yet is shown
  to the client's team at level 4, on the screen to answer it, with who wrote it and their band. The
  privacy notice must say that the client's team reads the comments waiting for an answer.

**Privacy of Financeiro (261014-dwc D-06, D-11, user decisions).**

- Who bought, what and for how much is shown at level 4 only, to the client's own team; platform
  levels 1-3 keep aggregates (revenue per client). The privacy notice must say that the client's
  team sees each member's purchases.
- Every group total (band, publication, event, cancellations, ladder path) is shown only from 5
  orders on; below that it reads "menos de 5", with no value.

**What the real store schema still lacks (found in 261014-dwc).**

- There is no offer table and no `offer_id` on `store_orders`: entry and add-on offers of one
  product (composition and price) cannot be told apart yet.
- `store_orders_live_uq` (one live order per member and product) blocks renewing the same product
  without revoking the previous order first.
- `expires_at` is never filled, so the end of an access is an example.
- `store_orders` is read only by its own user or `admin_tenant`: decide whether the owner role reads it.
- Decide whether an access that ends without renewal ends the membership.

Notes from the 261012-oxi review, for the change that replaces the fixture with API answers.

Empty lists (C-7, not implemented). The fixture always has rows, so no level-4 block has an empty
state yet. Once real data is wired, each of these blocks needs a pt-BR sentence for "no rows" that
says what will appear there and when. What each one renders today with no rows:

- **Conteúdo** (`OwnerContent*`): the publication lists, the people lists and Precisa de atenção
  already have their empty sentence; the trend, the heatmap and the type cards still assume rows.
- **Próximos eventos** (`OwnerEvents`, an `EventCard` list): with no rows, the receita line and
  nothing else (no table at any width).
- **Lista de espera** (`OwnerEvents`): "0 pessoa entrou na espera de 0 evento lotado" (pt-BR plural
  rules put 0 in `one`), an empty bar card, no demand line, and the "Conseguiram vaga" / "Foram ao
  evento" cards at 0.
- **Atendimentos por assunto** (`OwnerSupport`): the closed summary drops the leader sentence and
  keeps only the pill; opened, an empty bar card.
- **Equipe** (`OwnerSupport`): "0 conversas respondidas por 0 pessoas em 30 dias" and, opened, an
  empty bar card.
- **Financeiro** (`OwnerFinance*`): the lists say how many and show the sample line; the charts, the
  bars and the product cards still assume rows.
- **Faixas de engajamento** (`BandMembers`): done in 261012-qer A-4. A band with 0 members reads
  "0 · 0%" and opens to "Nenhum membro nesta faixa.".

## Events emitted

None.

## Events consumed

None. The snapshot reads the other modules' tables in the builder (a definer in the system lane),
never their events.

## Flag key

None: the module has no manifest and no `ModuleKey`. The panels are always available to their role;
each owner area and card follows the flag of the module behind it (`events`, `store`, `chat`,
`communities`, `feed`, `stories`, `notifications`), read through `moduleFlags` before the lane and
mirrored by the area's `requireModule` (D-460).

## Kernel dependencies

What the module relies on from the kernel:

- `withTenantTx` (`@rede-social/core/db/tenant-tx`): every read in the caller's lane, and the build in
  the system lane under the zero user.
- `paging` (`@rede-social/core/server/paging`): the repo's one keyset cursor envelope, wrapped by
  `server/paging.ts` with the 1..50 clamp.
- `registerDailyTenantJobs` (`@rede-social/core/server/tenancy/daily-dispatch`, called by the app
  registry) and its queue `kernel.daily-tenant-dispatch`: the once-a-day-per-tenant dispatcher that
  enqueues `dashboard.snapshot-build`.
- `registerSweepFunctions` (`@rede-social/core/server/jobs/sweep-functions`, called by the app
  registry): the kernel's hourly sweeper runs `dashboard_snapshots_prune` in the admin lane.
- `requireRole` (`@rede-social/core/server/rbac/require-role`), `requireAuth`
  (`@rede-social/core/server/auth/require-auth`) and `requireModule`
  (`@rede-social/core/server/modules/require-module`): the route guards, in the ROLE-06 order.

Every kernel specifier the package imports:

- `@rede-social/core/db/schema` (the `tenants`, `memberships` and `users` tables the snapshot tables
  reference)
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/flags-cache`
- `@rede-social/core/server/modules/manifest` (the job definition type)
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/require-role`
- `@rede-social/ui` (`Card`, `StatusPill`, `cn`)

## Navigation

None of its own. The owner panel is a section of `/perfil` for `admin_tenant` and "Sua atividade" a
section of `/perfil` for `member`. The owner's areas, lists and details are query params on `/perfil`
(`apps/web/lib/owner-panel.ts`, `owner-band-scope.ts`, `owner-content-view.ts`,
`owner-finance-view.ts`): plain links, full loads, every step working without JavaScript; an
`?area=` whose module is off renders Visão geral. The wired actions open existing screens (D-461):
`/suporte` (conversations waiting), `/eventos/[eventId]/participantes` (the bell's nearly full
event), `/loja/[productId]/compradores` (a product's buyers), the member detail and the post. "Ver
operação do dia (painel do admin)" opens `/configuracoes`.

## Jobs

- `dashboard.snapshot-build`: one build per tenant and local day, concurrency 1, enqueued by
  `kernel.daily-tenant-dispatch` every hour for each active tenant's local yesterday and at worker
  boot; registered by the app registry and listed in `apps/api/src/worker.ts` (no manifest).
- `dashboard_snapshots_prune`: the sweep function the kernel's hourly sweeper runs in the admin lane
  (tenant snapshot rows older than 8 days before the tenant's local today, at most 500 per call,
  repeated while a full batch comes back). Member rows are latest-only: no sweep.

## Reuse

The `./ui` primitives are presentational: another host renders them with its own strings and data.
The pipe (`./contracts`, `./db`, `./server`) needs the kernel's tenant lane, the dispatcher and the
tables the builder reads (memberships, feed, stories, events, store, chat, moderation log). See
packages/reuse-fixture for how a module is consumed outside this app.
