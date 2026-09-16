# Deferred items (02-03)

- `biome.json` root: three pre-existing `lint/suspicious/useBiomeIgnoreFolder` warnings on `!.gsd/**`, `!.planning/**`, `!.claude/**` (suggested `!.gsd` etc.). Not touched by this plan; root file is not part of `pnpm lint` (per-package tasks).

## 02-04 (2026-09-16)

- **e2e `recovery.spec.ts` cases 3/5/7 fail on the local stack (environment drift, not caused by 02-04).** The running local Supabase stack sends GoTrue's default English recovery e-mail ("Reset your password", link to `/auth/v1/verify?…&redirect_to=…/auth/confirm`) instead of the configured `[auth.email.template.recovery]` (`supabase/templates/recovery.html`, `/auth/confirm` link), so `e2e/mail.ts` never finds an `/auth/confirm` link. Mailpit receives the message within ~1 s, so delivery is fine. Likely the stack was started before the template config (or by the global CLI 2.90.0). Fix: `DOCKER_CONFIG=/tmp/dockercfg pnpm supabase stop && … start`, then re-run `pnpm --filter @tria/web exec playwright test recovery.spec.ts`. 02-06 (mail hook + branded templates) touches this path anyway. Cases 1, 2, 4 and 6 (the ones that read catalog strings) pass after the split.
