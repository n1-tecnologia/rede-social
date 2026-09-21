# Phase 3: Media Pipeline & Member Profiles - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-21
**Phase:** 03-media-pipeline-member-profiles
**Areas discussed:** Video: vendor & pilot scope, Profile model & first access, Member directory, Upload & serving pipeline

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Video: vendor & pilot scope | Mux vs Cloudflare Stream vs MP4-only vs defer; flagged LOW-confidence pricing in STATE.md | ✓ |
| Profile model & first access | Per-tenant vs global photo/name/bio; what PROF-02 shows; the D-02 nudge | ✓ |
| Member directory | Who appears, search semantics, page size, entry point | ✓ |
| Upload & serving pipeline | Phone-side upload UX, HEIC, TUS, variant sizes, signed-URL serving | ✓ |

**User's choice:** all four areas.

---

## Video: vendor & pilot scope

### Q1 — Which video path does the pilot take? (MEDIA-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Mux | Stack's recommendation; direct upload → webhook → HLS + thumbnails; handles iPhone HEVC; best DX, highest per-minute cost | ✓ |
| Cloudflare Stream | Same architecture, cheapest at pilot volume; loses Mux Data analytics | |
| Build the broker, defer the vendor | Provider adapter + local fake, video refused in the UI until Phase 4; roadmap criterion 4 unverifiable this phase | |
| MP4-only in Supabase Storage | No transcoding; reject HEVC/MOV at the API — fails exactly the iPhone case criterion 4 names | |

**User's choice:** Mux.
**Notes:** → D-43. Cloudflare Stream retained in CONTEXT.md as the documented alternative behind the same adapter.

### Q2 — Mux playback policy, given TENANT-04 and criterion 4

| Option | Description | Selected |
|--------|-------------|----------|
| Signed playback (recommended) | Signing key in Secret Manager; API mints a short-lived per-playback JWT checked against membership; isolation suite can prove the tenant-B refusal for video | ✓ |
| Public playback | Simpler, no token endpoint — but a leaked URL plays forever and video becomes the one media kind TENANT-04 doesn't cover | |
| You decide | | |

**User's choice:** Signed playback.
**Notes:** → D-44.

### Q3 — Cost guard rails on video uploads

| Option | Description | Selected |
|--------|-------------|----------|
| Duration + per-tenant cap | Max duration per kind plus a tracked minutes-stored ceiling | |
| Duration limit only | Matches Phase 5's ~60 s story rule; runaway cost stays a Mux dashboard problem | |
| No app-level limit | Rely on Mux plan limits and billing alerts | |
| You decide | Cheap to build now, tightenable in Phase 8 | ✓ |

**User's choice:** You decide → Claude's discretion.

### Q4 — Where the Phase 3 admin video upload + playback proof lives

| Option | Description | Selected |
|--------|-------------|----------|
| Admin media library screen | Real `/midia` screen with status and preview; survives into Phase 4 | |
| Throwaway dev-only harness | Proves the pipeline, removed when Phase 4's composer ships | |
| Profile photo flow only | Image path as real UI; video proven by integration tests + one device check | |
| You decide | Based on what Phase 4 would rebuild anyway | ✓ |

**User's choice:** You decide → Claude's discretion.

**Continue check:** Next area.

---

## Profile model & first access

### Q1 — Where do photo, display name and bio live?

| Option | Description | Selected |
|--------|-------------|----------|
| On the membership (per-tenant) | `member_profiles` keyed by membership; matches the bootstrap contract and the V2 multi-tenant plan | |
| On the global user | Extend `public.users`; simplest queries, but one photo everywhere in V2 | |
| Split: name global, photo+bio per-tenant | Fewer duplicated columns, two sources for one screen | |
| You decide | Guided by the V2-safe schema conventions and the bootstrap contract | ✓ |

**User's choice:** You decide → Claude's discretion (guidance recorded in CONTEXT.md).

### Q2 — What another member's profile shows (PROF-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Photo, name, bio, role badge | Ported ProfileHeader plus an Administrador/Suporte pill | |
| Add "membro desde" | The above plus a join date from `memberships.joined_at` | |
| Photo, name, bio only | No badge, no dates; the admin is identified by their content | ✓ |
| You decide | | |

**User's choice:** Photo, name, bio only.
**Notes:** → D-45. Also answers `PROTOTYPE.md` open question 10 for V1 (no admin badge, no event stats), and by extension the directory rows carry no role badge either.

### Q3 — How insistent is the D-02 first-access photo/bio nudge?

| Option | Description | Selected |
|--------|-------------|----------|
| Dismissible card on Início | Home-slot card that disappears once a photo is set; competes with Phase 4's feed for the slot | |
| One-time sheet after first login | BottomSheet with a visible "Agora não", skip recorded | |
| Settings row only | No nudge; most members never add a photo | |
| You decide | Designed in the prototype's language under D-33 | ✓ |

**User's choice:** You decide → Claude's discretion.

### Q4 — Can a member change their display name freely?

| Option | Description | Selected |
|--------|-------------|----------|
| Free edit, no history | The member owns their display name; e-mail is the identity anchor | ✓ |
| Free edit, sign-up name retained | `users.name` keeps the sign-up value for Phase 8 member management | |
| Not editable in V1 | Changes go through support; a sign-up typo becomes permanent | |
| You decide | | |

**User's choice:** Free edit, no history.
**Notes:** → D-46.

**Continue check:** Next area.

---

## Member directory

### Q1 — Who appears in the directory (PROF-03)?

| Option | Description | Selected |
|--------|-------------|----------|
| Every active membership | Members, support and admin as equals; one rule, nothing to explain | |
| Active members only, staff hidden | `admin_tenant` and `support_tenant` excluded; staff met through content and support chat | ✓ |
| All including invited | Leaks who was invited but never joined | |
| You decide | | |

**User's choice:** Active members only, staff hidden.
**Notes:** → D-47. Confirmed during the discussion that a staff profile stays openable by direct link under PROF-02, it is only not browsable.

### Q2 — Name search semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Accent- and case-insensitive substring | `unaccent` + lower on an expression index; what a search box is expected to do | |
| Accent-insensitive prefix only | Plain btree, fastest — surprising for pt-BR surnames | |
| Full-text search | tsvector with the portuguese dictionary; overkill and awkward for partial typing | |
| You decide | Behaviour pinned by tests either way | ✓ |

**User's choice:** You decide → Claude's discretion.

### Q3 — Where does a member reach the directory from?

| Option | Description | Selected |
|--------|-------------|----------|
| Row on `/perfil` | No nav real estate, no registry change — but buried | |
| Its own kernel tab | Discoverable; by Phase 6 the bar carries five tabs | |
| TopBar search affordance | Matches the prototype's SearchBar pattern; competes with a future global search | |
| You decide | Weighing the Phase 5–6 tab budget and D-33 | ✓ (free text) |

**User's choice (free text):** *"voce decide. So lembrando que o design está na pasta reference"*
**Notes:** Claude's discretion, with the user re-anchoring the design to `reference/frontend-design/`. The relevant prototype files were verified to exist and added to CONTEXT.md's canonical refs: `components/profile/{ProfileHeader,EditProfileForm,UserListItem}.tsx`, `components/explore/SearchBar.tsx`, `components/create/ImagePicker.tsx`.

**Continue check:** Next area.

---

## Upload & serving pipeline

### Q1 — How does a private media URL reach the browser? (TENANT-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Signed URLs inline in API responses | One round trip, works with next/image; TTL must outlive the cached payload | |
| Stable API URL that 302-redirects | Permanently cacheable payloads, tenant check on every fetch; one extra hop per image | |
| Public bucket, unguessable keys | Fastest and CDN-friendly, but contradicts TENANT-04 and defeats the isolation suite | |
| You decide | Weighing the Phase 4 feed's image count against criterion 4 | ✓ |

**User's choice:** You decide → Claude's discretion. The public-bucket option is recorded in CONTEXT.md as rejected regardless.

### Q2 — iPhone HEIC handling

| Option | Description | Selected |
|--------|-------------|----------|
| Downscale in the browser first | Canvas re-encode to JPEG/WebP; solves HEIC and the 50 MB cap; watch EXIF orientation | |
| Accept HEIC, convert in the worker | Keeps quality and the original; needs proof that the image's libvips has HEIF support | |
| Reject HEIC with a message | Least code, worst pilot experience — fires on exactly the iPhone case | |
| You decide | Proven with a real iPhone-originated fixture | ✓ |

**User's choice:** You decide → Claude's discretion.

### Q3 — Which variant set does the broker commit to? (MEDIA-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Named variants per purpose | avatar / post / cover / story with fixed sizes; a new purpose means a new entry | |
| One generic width ladder | Same widths for everything, UI picks with srcset; generates sizes an avatar never uses | |
| Original + one variant, grow later | Smallest thing that satisfies the pilot; Phase 4's carousel likely forces the work anyway | |
| You decide | Keeping the Free plan and the "one contract Phases 4–6 reuse" goal in mind | ✓ |

**User's choice:** You decide → Claude's discretion.

### Q4 — What happens to uploads never attached to anything?

| Option | Description | Selected |
|--------|-------------|----------|
| pg-boss sweeper job | Deletes pending assets and objects older than N hours; window must outlive a slow upload | |
| Leave them, clean up in Phase 8 | Zero work now; the bucket fills unmeasured | |
| Replace-on-write for profiles only | Narrow and correct for what Phase 3 actually ships | |
| You decide | Sized to what this phase genuinely produces | ✓ |

**User's choice:** You decide → Claude's discretion.

**Final check:** "I'm ready for context."

---

## Claude's Discretion

Handed to Claude explicitly during this discussion (full guidance in CONTEXT.md `<decisions>` → Claude's Discretion):

- Video upload guard rails (duration limit, per-tenant minutes ceiling) and where the Phase 3 admin video upload + playback proof lives; Mux webhook verification, retries and `video.asset.errored` handling.
- Where photo / display name / bio physically live (per-membership table vs global `users` columns vs split), the shape of the D-02 first-access nudge, bio length/formatting, avatar fallback, photo removal, and what the owner's own `/perfil` adds.
- Directory search semantics, entry point, ordering, page size and pagination style, empty/no-results copy.
- How signed media URLs reach the browser (inline vs API 302 — public bucket rejected), iPhone HEIC strategy, the image variant set, orphan lifecycle, media/profiles file layout inside the kernel, TUS/progress/cancel UX and refusal copy, per-tenant quota accounting, `media.assets` columns, and the isolation-suite extensions.

## Deferred Ideas

- Link unfurling / embeds (MEDIA-04) — Phase 4.
- Admin media library as a "pick an existing asset" surface — Phase 4's composer.
- Per-member "hide-me" in the directory (V2-PROF-01) — V2; D-47's query leaves room for the predicate.
- Self-service account deletion / data export (V2-PROF-02, LGPD Art. 18) — V2; will need a photo deletion path.
- Retained sign-up name / rename history — rejected by D-46; revisit only if Phase 8 moderation needs it.
- Role badge on profiles and directory rows — rejected by D-45 for V1.
- Supabase Pro upgrade for native image transforms — V2 per PROJECT.md.
- Cloudflare Stream migration — alternative behind the same adapter if video cost binds.
- Per-tenant storage/video quota surfaced in the platform panel — Phase 8 admin-panel concern.
