# Phase 02: User Setup Required

**Generated:** 2026-09-17
**Phase:** 02-tenant-shell-branding-platform-panel
**Status:** Incomplete (hosted environments only — NOT required locally or in CI; deferred to the Phase 01.1 runbook)

Custom domains (plan 02-09, D-34) talk to two external APIs in production: the Vercel REST API
(project domains) and the Supabase Management API (auth redirect allow-list). Locally and in CI the
kernel env defaults select the `fake` provider and the `local` allow-list, so nothing below is needed
to develop, test or run the platform panel. These items become required when the production
Cloud Run services are provisioned (Phase 01.1). Full runbook: `docs/DEPLOY.md` → "Custom domains
(TENANT-07, D-34)" and the runbook item "Attach a real customer domain end-to-end".

## Environment Variables

Set on the **`api` and `worker`** Cloud Run services (same image, both read them).

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `DOMAIN_PROVIDER=vercel` | fixed value (production only; staging keeps `fake`) | Cloud Run env (`deploy-api.yml`) |
| [ ] | `VERCEL_TOKEN` | Vercel Dashboard → Team Settings → Tokens (team-scoped token) | GCP Secret Manager `vercel-token-prod`, mounted as `VERCEL_TOKEN` |
| [ ] | `VERCEL_PROJECT_ID` | Vercel Dashboard → Project (`apps/web`) → Settings → General → Project ID | Cloud Run env |
| [ ] | `VERCEL_TEAM_ID` | Vercel Dashboard → Team Settings → General → Team ID | Cloud Run env |
| [ ] | `AUTH_ALLOW_LIST=supabase` | fixed value (production only; staging keeps `local`) | Cloud Run env |
| [ ] | `SUPABASE_PAT` | Supabase Dashboard → Account → Access Tokens — a **dedicated** token with `auth:write` (not the CI `SUPABASE_ACCESS_TOKEN`) | GCP Secret Manager `supabase-pat-prod`, mounted as `SUPABASE_PAT` |
| [ ] | `SUPABASE_PROJECT_REF` | Supabase Dashboard → Project Settings → General → Reference ID (same value as the GitHub secret `SUPABASE_PROJECT_ID`) | Cloud Run env |
| [ ] | `PLATFORM_HOST` | already a GitHub environment variable; now also read by the API (attach refuses the platform host) | Cloud Run env |

## Account Setup

- [ ] **Vercel team token** — created under the team that owns the `apps/web` project (a personal token cannot manage the team's project domains).
- [ ] **Supabase personal access token** — created by a member of the organisation that owns `rede-social-prod`; scope `auth:write`.

## Dashboard Configuration

- [ ] **Vercel project domains** — nothing to pre-create: the API attaches/detaches project domains at runtime. Confirm the project has no wildcard domain configured that would shadow customer hosts.
- [ ] **Supabase auth redirect allow-list** — keep the platform host entry (`https://app.seusistema.com/auth/confirm**`) in `supabase/config.toml`; per-domain entries are written by the API. After every `supabase config push`, open each verified domain in the panel and press "Verificar agora" (see `docs/DEPLOY.md` WR-09).

## Verification

After completing setup (hosted proof, Phase 01.1):

```bash
# 1. The revision booted (assertProductionEnv accepted the selection + credentials)
curl -s https://<api-host>/v1/health
# 2. Attach a test host in the platform panel, create the shown DNS records, press "Verificar agora"
# 3. The host resolves only after verification
curl -s "https://<api-host>/v1/public/tenants/by-host?host=comunidade.<cliente>"
```

Expected results:
- `by-host` answers 404 `TENANT_NOT_FOUND` before verification and 200 (with `isPrimary`, `primaryHost`) after.
- The first-admin invite mail arrives; the project's auth `uri_allow_list` contains `https://comunidade.<cliente>/auth/confirm**`.
- `https://comunidade.<cliente>/entrar` renders the tenant brand.
- Record in `docs/DEPLOY.md`: token scope needed, Cloud Run egress needs, whether a fresh domain showed a TXT step (RESEARCH A1/A2).

---

**Once all items complete:** Mark status as "Complete" at top of file.
