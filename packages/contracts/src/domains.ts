import { z } from 'zod';
import { isRegistrableHost, normalizeHost } from './hosts';

/**
 * Custom-domain contracts (TENANT-07, D-34..D-36). One DNS instruction shown to the customer:
 * `routing` records point the host at the platform (CNAME for a subdomain, A for an apex),
 * `ownership` is the TXT challenge the provider asks for when the domain is in use elsewhere.
 * Written only by the platform lane from provider answers validated here; rendered as text.
 */
export const dnsRecordSchema = z.object({
  type: z.enum(['CNAME', 'A', 'TXT']),
  name: z.string(),
  value: z.string(),
  purpose: z.enum(['routing', 'ownership']),
});
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

/** `tenant_domains.verification_status` (D-34). `verified_at` stays the resolution predicate (D-36). */
export const domainStatusSchema = z.enum(['pending', 'verified', 'expired', 'failed']);
export type DomainStatus = z.infer<typeof domainStatusSchema>;

/** One `tenant_domains` row as the platform panel sees it (inside `platformTenantDetailSchema`). */
export const tenantDomainSchema = z.object({
  id: z.uuid(),
  host: z.string(),
  isPrimary: z.boolean(),
  verificationStatus: domainStatusSchema,
  verifiedAt: z.string().nullable(),
  dnsRecords: z.array(dnsRecordSchema),
  lastCheckedAt: z.string().nullable(),
  verifyDeadlineAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type TenantDomain = z.infer<typeof tenantDomainSchema>;

/**
 * Body of `POST /v1/platform/tenants/{id}/domains`. The host is canonicalised with the SAME
 * `normalizeHost` the proxy and the resolver use (trim, lower-case, strip `:port` and trailing dots)
 * and must satisfy `isRegistrableHost` — the predicate of `tenant_domains_host_chk` — so
 * `Comunidade.Cliente.com.br:443` and `comunidade.cliente.com.br` are ONE host at the boundary
 * (edge TENANT-07/adjacency) and an IPv6 literal or an underscore never reaches the provider.
 */
export const attachDomainBodySchema = z.object({
  host: z
    .string()
    .min(1)
    .max(260)
    .transform((raw) => normalizeHost(raw) ?? '')
    .pipe(z.string().refine(isRegistrableHost, { message: 'Informe um domínio válido.' })),
});
export type AttachDomainBody = z.infer<typeof attachDomainBodySchema>;

/** Answer of `POST …/domains/{domainId}/verify` ("Verificar agora"): the row after the check. */
export const domainCheckResultSchema = tenantDomainSchema;
export type DomainCheckResult = z.infer<typeof domainCheckResultSchema>;
