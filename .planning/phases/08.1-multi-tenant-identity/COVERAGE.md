# API Coverage — Supabase Auth (GoTrue v2.197.0) as used by Phase 08.1

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Phase 08.1 adds no new external service. It changes how the project's existing Supabase Auth
integration is used: which calls a second-tenant join, a recovery started on another tenant's host
and an invite to an existing identity may make. The matrix is the plan-time decision record for that
surface. The plan that integrates each row is in the notes below the table.

| capability | decision | reason |
|---|---|---|
| auth.sign-in-with-password | INTEGRATE | |
| auth.sign-out-local | INTEGRATE | |
| auth.update-user-password | INTEGRATE | |
| auth.reset-password-for-email | INTEGRATE | |
| auth.verify-otp-token-hash | INTEGRATE | |
| auth.get-claims | INTEGRATE | |
| auth.admin-create-user | INTEGRATE | |
| auth.admin-invite-user-by-email | INTEGRATE | |
| auth.admin-generate-link-invite | INTEGRATE | |
| auth.admin-generate-link-recovery | INTEGRATE | |
| auth.send-email-hook | INTEGRATE | |
| auth.jwks-es256-verification | INTEGRATE | |
| auth.admin-generate-link-magiclink | OPT-OUT | explicitly out of scope: D-314 forbids magic links (deferred idea); an invite to an existing identity is tokenless |
| auth.sign-in-with-otp | OPT-OUT | explicitly out of scope: D-314, the person always signs in with their password |
| auth.sign-out-global | OPT-OUT | explicitly out of scope: global scope revokes the identity in every tenant and breaks D-304; every sign-out is local |
| auth.sign-out-others | OPT-OUT | explicitly out of scope: same reason as global (D-304) |
| auth.admin-sign-out | OPT-OUT | not needed: GoTrue has no per-session admin sign-out, and any identity-wide revocation breaks D-304 (Phase 8 MODER-02 revokes per membership) |
| auth.custom-access-token-hook | OPT-OUT | not needed: the tenant of record is selected per request from the host (D-307); a claim minted at sign-in cannot know the host |
| auth.admin-update-user-by-id | OPT-OUT | not needed: no flow of this phase edits another identity; passwords change only through the owner's recovery or accept session |
| auth.admin-delete-user | OPT-OUT | not needed yet: leaving a community and deleting an identity are V2-PROF-02 (D-313 records only the model rule); the sign-up compensation keeps its existing call |
| auth.sb-forwarded-for-rate-limit | OPT-OUT | not needed yet: per-client-IP forwarding to GoTrue's limits is the pending WR-05 hardening decision (RESEARCH Pitfall 8) |

Notes:
- `sign-in-with-password`: the `/participar` path keeps `/entrar`'s call (08.1-01); the "já tem conta"
  state verifies the password with it in the web server action and uses the returned session's token
  for `POST /v1/join` (08.1-02).
- `sign-out-local`: "Não participar", the refusal "Sair" and the picker's "Sair" (08.1-01, 08.1-03).
- `update-user-password`, `reset-password-for-email`, `verify-otp-token-hash`, `send-email-hook`: the
  D-303/D-317 recovery on B's host and the D-315 mail tenant (08.1-05). GoTrue's `LogoutAllExceptMe`
  on a password change is documented as an accepted cross-tenant side effect (RESEARCH Pitfall 4).
- `admin-create-user`: unchanged sign-up; its 409 now leads to the join state (08.1-02).
- `admin-invite-user-by-email`, `admin-generate-link-invite`, `admin-generate-link-recovery`: kept for
  identities WITHOUT a password only; an identity with a password gets the tokenless app mail (08.1-06).
- `get-claims`, `jwks-es256-verification`: unchanged; `requireIdentity` reuses `verifyBearer` (08.1-01).
