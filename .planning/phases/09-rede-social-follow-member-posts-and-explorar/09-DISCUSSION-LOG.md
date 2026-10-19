# Phase 9: Rede Social - Follow, Member Posts and Explorar - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-19
**Phase:** 09-rede-social-follow-member-posts-and-explorar
**Areas discussed:** Seguir e achar pessoas, Minhas publicações, Publicar e limites de mídia, Segurança até a Fase 11, Explorar na navegação, Reels com vídeo de membro, Papéis e liga/desliga

The user selected all seven offered gray areas. Questions and options were asked in pt-BR; they are kept here in English.

---

## Seguir e achar pessoas

### Discovery (the member directory is staff-only since 2026-10-16)

| Option | Description | Selected |
|--------|-------------|----------|
| Reopen /membros only with social on | Reuses MembersList; `GET /v1/members` accepts member only with social on; Explorar gets "Encontrar pessoas" | ✓ |
| People search inside Explorar | New section; /membros stays staff-only always | |
| No list for the member | Discovery only by names in comments and shared links | |

**User's choice:** Reopen /membros only with social on (recommended).

### Staff in the follow graph

| Option | Description | Selected |
|--------|-------------|----------|
| Members among themselves only | admin_tenant and support_tenant outside the graph; D-45 holds for them | ✓ |
| Staff follows members, members do not follow staff | Admin watches members in own Explorar | |
| Everyone follows everyone | Staff has Seguir and counts | |

**User's choice:** Members among themselves only (recommended).

### Who sees the follower/following lists

| Option | Description | Selected |
|--------|-------------|----------|
| Private: each sees their own | Counts public, lists only the owner's | ✓ |
| Open to everyone in the tenant | As in the prototype | |

**User's choice:** Private (recommended). **Notes:** opening later is easy, closing is not.

### A member post opened by a non-follower

| Option | Description | Selected |
|--------|-------------|----------|
| "Siga para ver" screen | Author name and avatar + Seguir; content stays on the server | ✓ |
| 404 for non-followers | Strictest | |
| Opens for any tenant member | Follow only decides feeds | |

**User's choice:** "Siga para ver" screen (recommended).

### Where the Seguir button appears

| Option | Description | Selected |
|--------|-------------|----------|
| Profile, "Siga para ver" and each /membros row | | ✓ |
| Profile and "Siga para ver" only | | |
| Also in comments | | |

**User's choice:** Profile, "Siga para ver" and /membros row (recommended).

---

## Minhas publicações

### Where the author sees their own posts

| Option | Description | Selected |
|--------|-------------|----------|
| In their own Explorar | Own posts mixed with followed people's; no new screen | ✓ |
| "Minhas publicações" list on the profile | Private personal list | |
| Both | | |

**User's choice:** In their own Explorar (recommended).

### Where the composer opens and where the member lands

| Option | Description | Selected |
|--------|-------------|----------|
| Explorar only, back to Explorar | Início keeps the button for admin only | ✓ |
| Início and Explorar, lands on Explorar | | |
| Explorar, lands on the post page | | |

**User's choice:** Explorar only, back to Explorar (recommended).

---

## Publicar e limites de mídia

### What the member composer offers

| Option | Description | Selected |
|--------|-------------|----------|
| Text, photos, video and link | No PDF; video only if the tenant allows it | ✓ |
| Everything the admin has, no community | | |
| Text and photos only | | |

**User's choice:** Text, photos, video and link (recommended). **Notes:** the post is always tenant-wide, no community picker (Phase 10 owns community publishing).

### Default media limits

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative, video off | Photos 5 MB, 4 per post; video off, then 60 s / 100 MB | ✓ |
| Moderate, video on | Photos 10 MB, 10 per post; video 90 s / 200 MB | |
| No default; super_admin fills on enabling | | |

**User's choice:** Conservative, video off (recommended).

### Per-member volume cap

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file and per-post limits only | No quota this phase | ✓ |
| Daily post quota per member | | |
| Storage quota per member | | |

**User's choice:** Per-file and per-post limits only (recommended).

---

## Segurança até a Fase 11

### Moderation of member posts before Phase 11

| Option | Description | Selected |
|--------|-------------|----------|
| Staff sees all and removes any | Staff Explorar lists every member post; soft-delete with moderation log; pulls the posts slice of MODER-04 forward | ✓ |
| Staff removes by link only | No list | |
| Nothing in 9; social only goes live after 11 | DEPLOY.md gate | |

**User's choice:** Staff sees all and removes any (recommended). **Notes:** `moderation.manage` is held by `admin_tenant` only, so "staff" here means the admin, not support_tenant (found after the question was asked; recorded in D-475).

### Who is notified when a member posts

| Option | Description | Selected |
|--------|-------------|----------|
| Nobody | Admin posts keep notifying everyone; follower notices are Phase 11 | ✓ |
| Followers get the bell only | New kind | |
| Followers get bell and push | | |

**User's choice:** Nobody (recommended).

### Notices to the author of a member post

| Option | Description | Selected |
|--------|-------------|----------|
| Comment only, no like | New kind `feed.post_commented`, first-level comments | ✓ |
| Comment and like | | |
| No notice to the author | | |

**User's choice:** Comment only, no like (recommended).

### Terms of use and LGPD before turning social on

| Option | Description | Selected |
|--------|-------------|----------|
| Go-live item in DEPLOY.md + confirmation when turning on | No member-facing gate | ✓ |
| Mandatory new acceptance by members | New consent flow with versioning | |
| DEPLOY.md item only | | |

**User's choice:** Go-live item in DEPLOY.md + confirmation when turning on (recommended).

---

## Explorar na navegação

| Option | Description | Selected |
|--------|-------------|----------|
| Chip inside Início | Two chips on the same area; the BottomNav does not change | ✓ |
| Icon in the TopBar | | |
| Own tab in the bar | Another module yields its tab | |

**User's choice:** Chip inside Início (recommended).

---

## Reels com vídeo de membro

### Where followed videos enter Reels

| Option | Description | Selected |
|--------|-------------|----------|
| Mixed into "Todos" by date | Keeps D-117; no new lane | ✓ |
| Own "Seguindo" lane | "Todos" stays admin-only | |
| Both | | |

**User's choice:** Mixed into "Todos" by date (recommended).

### Tapping a video in Explorar

| Option | Description | Selected |
|--------|-------------|----------|
| Opens Reels over it, as in Início | ReelsOverlay at that video | ✓ |
| Plays inside the card | | |

**User's choice:** Opens Reels over it (recommended).

---

## Papéis e liga/desliga

### Who publishes as a member with social on

| Option | Description | Selected |
|--------|-------------|----------|
| Only the member role | admin keeps today's path; support gets no composer | ✓ |
| support_tenant joins as a member | Reopens "members only" for one role | |

**User's choice:** Only the member role (recommended).

### What members see when social is turned off

| Option | Description | Selected |
|--------|-------------|----------|
| Everything disappears, returns on re-enable | Bare 404 for member posts and links; nothing deleted | ✓ |
| Posts stay open by link | | |

**User's choice:** Everything disappears, returns on re-enable (recommended).

### Posts and connections of a member the admin blocked

| Option | Description | Selected |
|--------|-------------|----------|
| Posts disappear until unblocked | Out of Explorar, Reels, link, counts, lists, directory; nothing deleted | ✓ |
| Posts stay, only access is cut | | |

**User's choice:** Posts disappear until unblocked (recommended).

---

## Claude's Discretion

Defaults recorded in CONTEXT.md without a question:
- Follow semantics (one-directional, instant, idempotent, no approval) and the follow table's shape.
- What the member profile shows with social on (button and two counts; no post count, no "Mensagem") and the strict base schema kept.
- Explorar content rules, its two empty states, the one-statement query budget, and how "authored by admin_tenant" is decided.
- Media enforcement points (a video's duration is known only after upload).
- The Admin badge follows social instead of postingPolicy; seed enables social on a test tenant.

## Deferred Ideas

- Follower notices, DMs, member-to-member block, reports and the rest of MODER-04: Phase 11.
- Member stories and communities: Phase 10.
- Per-member quotas; open follower lists; "Minhas publicações"; a "Seguindo" Reels lane; a "Pessoas" search in Explorar; a terms re-acceptance screen; member PDF attachments; like notices; a "new posts" dot on the Explorar chip; staff browsing of follower lists.
