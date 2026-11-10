# Phase 10: Rede Social - Member Stories and Communities - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-10
**Phase:** 10-rede-social-member-stories-and-communities
**Areas discussed:** Who sees what a member creates, The creator rule in every community, Creating a community: limits and moderation, Member stories: where and how

All four gray areas offered were selected. The discussion ran in pt-BR (the user's language); options are translated here.

---

## Who sees what a member creates

### Who sees a member-created community in the Comunidades list

| Option | Description | Selected |
|--------|-------------|----------|
| Whole tenant (Recommended) | Same as the admin's: every member sees cover, name and content and likes and comments; matches the roadmap wording | ✓ |
| Only followers of the creator | Closer to Phase 9's "open less first"; the list shows different things per member and COMM-02 changes | |
| Everyone sees the shop window, only followers open | Cover, name and description for all, posts for followers with the "Siga para ver" screen; more code | |

**User's choice:** Whole tenant (D-701).

### Where a creator's community posts appear

| Option | Description | Selected |
|--------|-------------|----------|
| Only on the community page (Recommended) | Início stays the organization's voice, Explorar stays posts with no community | ✓ |
| Also in the Explorar of the creator's followers | Changes Explorar's predicate | |
| Also in Início | Mixes the member's voice with the organization's (SOCIAL-04 avoided it) | |

**User's choice:** Only on the community page (D-702).

### Whether the creator's name shows on a member community

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, "Criada por Fulano" (Recommended) | Header and list card, name opens the profile with the Seguir button | ✓ |
| Do not show | Creator stays audit-only (D-67) | |

**User's choice:** Yes, "Criada por Fulano" (D-703).

### Where a member's active story appears beyond the Explorar row

| Option | Description | Selected |
|--------|-------------|----------|
| Only the Explorar row (Recommended) | The smallest change; profile, directory and posts untouched | ✓ |
| Explorar + ring on the member's profile | Instagram model on the profile and /membros | |
| Explorar + ring on any avatar | Posts, comments and lists too | |

**User's choice:** Only the Explorar row (D-704).
**Notes:** Moved on after four questions.

---

## The creator rule in every community

### Who publishes in a community created by an admin

| Option | Description | Selected |
|--------|-------------|----------|
| Any admin of the tenant (Recommended) | The organization's voice, as today (D-482); member communities: creator only. Refines the roadmap's "only the creator" | ✓ |
| Only the admin who created it (roadmap literal) | A second admin is locked out of the first admin's communities in every multi-admin tenant | |

**User's choice:** Any admin of the tenant (D-706).
**Notes:** This refines roadmap criterion 3; recorded as a wording change at planning.

### When the creator of a member community is blocked or leaves

| Option | Description | Selected |
|--------|-------------|----------|
| Disappears with them, returns on unblock (Recommended) | Same as D-484 for posts; nothing deleted; no ownership transfer | ✓ |
| Stays visible and read-only | A blocked member's content stays in view | |
| Passes to the admin | Needs a transfer rule and a notice | |

**User's choice:** Disappears with them, returns on unblock (D-708).

### What the creator may publish in their own community

| Option | Description | Selected |
|--------|-------------|----------|
| The same member post (Recommended) | Text, photos, one video where allowed, link; no PDF; the `social` limits | ✓ |
| The admin's full composer | Includes PDF and the larger admin media limits | |

**User's choice:** The same member post (D-709).

---

## Creating a community: limits and moderation

### How many communities a member may create

| Option | Description | Selected |
|--------|-------------|----------|
| Per-member limit, adjustable in the panel (Recommended) | Default 3, per tenant, edited by `super_admin` beside the media limits; archived ones do not count | ✓ |
| No limit | Only the API's general rate limit | |
| Fixed limit in code | Same number everywhere, needs a deploy to change | |

**User's choice:** Per-member limit, adjustable in the panel (D-710).

### Admin moderation and when the log row ships

| Option | Description | Selected |
|--------|-------------|----------|
| Keeps it, with the log already in Phase 10 (Recommended) | Delete any member story, archive or remove any member community, each with a `moderation_log` row (D-475's shape); Phase 11 keeps the reports queue and "block author" | ✓ |
| Keeps it, log left to Phase 11 | Admin power as today, no trace in between | |
| Admin only manages what they created | Contradicts the roadmap's recommendation | |

**User's choice:** Keeps it, with the log already in Phase 10 (D-711).
**Notes:** This was the open question the roadmap left for discuss-phase; the recommendation (keep moderation) was confirmed.

### Where a member community sits in the list

| Option | Description | Selected |
|--------|-------------|----------|
| After the admin's (Recommended) | Organization communities on top in the admin's order; member communities below by latest activity | ✓ |
| Mixed by activity | One list; the admin loses control of the order | |
| Separate "De membros" section | A new screen to draw and approve | |

**User's choice:** After the admin's (D-712).

### What the creator may do with their own community

| Option | Description | Selected |
|--------|-------------|----------|
| Everything the admin does with theirs (Recommended) | Edit, archive, reactivate, delete the archived one, highlights; no store products, no reorder; 05.1's form without the products field | ✓ |
| Only edit and archive | Deleting stays with the admin | |

**User's choice:** Everything the admin does with theirs (D-713).

---

## Member stories: where and how

### Where a member publishes a story

| Option | Description | Selected |
|--------|-------------|----------|
| From their own circle at the start of the Explorar row (Recommended) | The first circle is the member's, with a "+" (Instagram model); the FAB stays for posts | ✓ |
| From the Explorar floating button | One creation point; no own circle in the row | |
| Both | More paths to design and maintain | |

**User's choice:** From their own circle at the start of the Explorar row (D-714).

### What a story may hold and its limits

| Option | Description | Selected |
|--------|-------------|----------|
| Same limits as a member post (Recommended) | `social.media` photo size, video only when enabled; caption; 24 h; no new panel fields | ✓ |
| Own story limits in the panel | A separate block for member stories | |
| The admin story's limits | Photo up to 15 MB and video up to 60 s always available | |

**User's choice:** Same limits as a member post (D-715).

### Who sees a story saved in a highlight of the creator's community

| Option | Description | Selected |
|--------|-------------|----------|
| Whoever sees the community (Recommended) | Saving is the act of publishing in that community; the screen warns first | ✓ |
| Only the creator's followers | Highlights would differ per member and need a locked screen | |
| A member does not save stories in highlights | Contradicts roadmap criterion 2 ("and its highlights") | |

**User's choice:** Whoever sees the community (D-716).

### How the admin finds a member's story to delete

| Option | Description | Selected |
|--------|-------------|----------|
| Sees every circle in the Explorar row (Recommended) | Like the posts (D-475): moderators see one circle per member with an active story, no following needed | ✓ |
| Only through the member's profile | Touches the profile screen, which area 1 decided not to change | |

**User's choice:** Sees every circle in the Explorar row (D-717).

---

## Claude's Discretion

Defaults stated in CONTEXT.md, not asked:

- Stamping the community kind (organization or member) at creation.
- Reels: a member-community video appears in that community's lane, not in "Todos".
- Likes and comments on member stories work like the organization's; a non-reader gets the bare 404.
- Duplicate community names stay legal; the creator is not told when the admin removes the community.
- No notice for a new member story or community (Phase 11).
- The blocker's content filter (NATIVE-33) covers member stories and communities.
- Explorar row order: own circle first, unseen before seen, then recency.
- The member media seam extends to the story and community-cover purposes.
- The off switch (D-718): member writes stop, community reads stay, member stories leave the row but a story saved in a highlight stays.

## Deferred Ideas

- Follower notices for member stories and communities, "started following you", DMs and the block's effects on messaging: Phase 11.
- A story ring on the profile, `/membros`, post headers or any avatar.
- A "De membros" section in the Comunidades list.
- Transferring a community to another owner.
- Private or opt-in communities, and store products on a member community: V2.
- PDF attachments from members; a separate limits block for member stories.
- Showing member-community posts in Explorar for the creator's followers.
