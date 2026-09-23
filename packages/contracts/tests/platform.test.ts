import { describe, expect, it } from 'vitest';
import {
  acceptInviteBodySchema,
  acceptInviteResponseSchema,
  apiErrorEnvelopeSchema,
  attachDomainBodySchema,
  contrastReport,
  contrastReportSchema,
  createTenantBodySchema,
  deriveBrandColors,
  dnsRecordSchema,
  domainStatusSchema,
  ERROR_CODES,
  hostBrandingSchema,
  inviteStatusSchema,
  platformTenantDetailSchema,
  platformTenantsQuerySchema,
  platformTenantsSchema,
  REAL_TENANT_DEFAULT_MODULES,
  setModuleBodySchema,
  setTenantStatusBodySchema,
  tenantBrandingSchema,
  tenantDomainSchema,
  tenantInviteSchema,
  updateTenantBodySchema,
} from '../src';

const UUID = '0a000000-0000-4000-8000-000000000001';
const ISO = '2026-09-16T12:00:00.000Z';

describe('createTenantBodySchema (POST /v1/platform/tenants, ROLE-03)', () => {
  const valid = {
    displayName: 'Associação São José',
    slug: 'sao-jose',
    colors: { primary: '#7C3AED', secondary: '#A78BFA' },
    modules: ['feed', 'events'],
    adminEmail: 'Admin@Cliente.com.br',
  };

  it('accepts a full body, keeps accents in displayName, lower-cases the hex and the e-mail', () => {
    const parsed = createTenantBodySchema.parse(valid);
    expect(parsed.displayName).toBe('Associação São José');
    expect(parsed.colors).toEqual({ primary: '#7c3aed', secondary: '#a78bfa' });
    expect(parsed.modules).toEqual(['feed', 'events']);
    expect(parsed.adminEmail).toBe('admin@cliente.com.br');
  });

  it('defaults modules to the six real modules when omitted', () => {
    const { modules: _omit, ...body } = valid;
    expect(createTenantBodySchema.parse(body).modules).toEqual([...REAL_TENANT_DEFAULT_MODULES]);
    expect(createTenantBodySchema.parse(body).modules).toHaveLength(6);
  });

  it('rejects a slug with spaces or accents (ASCII regex, tenants_slug_chk)', () => {
    expect(createTenantBodySchema.safeParse({ ...valid, slug: 'São José' }).success).toBe(false);
    expect(createTenantBodySchema.safeParse({ ...valid, slug: 'ab' }).success).toBe(false);
  });

  it('rejects a displayName of 61 code units and an empty one', () => {
    expect(
      createTenantBodySchema.safeParse({ ...valid, displayName: 'a'.repeat(61) }).success,
    ).toBe(false);
    expect(createTenantBodySchema.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
    expect(
      createTenantBodySchema.safeParse({ ...valid, displayName: 'é'.repeat(60) }).success,
    ).toBe(true);
  });

  it('rejects a modules list carrying a key outside the vocabulary, and a malformed adminEmail', () => {
    // 04-10 retired the per-key refusal that used to name the reference module (D-19): what refuses
    // an unknown key is the VOCABULARY itself, so this asserts the rule that actually survives.
    expect(
      createTenantBodySchema.safeParse({ ...valid, modules: ['feed', 'nao-existe'] }).success,
    ).toBe(false);
    expect(createTenantBodySchema.safeParse({ ...valid, adminEmail: 'nope' }).success).toBe(false);
  });

  it('rejects a malformed hex', () => {
    expect(
      createTenantBodySchema.safeParse({
        ...valid,
        colors: { primary: 'purple', secondary: '#fff' },
      }).success,
    ).toBe(false);
  });
});

describe('updateTenantBodySchema / setTenantStatusBodySchema / setModuleBodySchema', () => {
  it('update requires at least one of displayName or colors', () => {
    expect(updateTenantBodySchema.safeParse({}).success).toBe(false);
    expect(updateTenantBodySchema.safeParse({ displayName: 'Novo nome' }).success).toBe(true);
    expect(
      updateTenantBodySchema.safeParse({ colors: { primary: '#000000', secondary: '#111111' } })
        .success,
    ).toBe(true);
  });

  it('status is active | suspended only; module body is a boolean flag', () => {
    expect(setTenantStatusBodySchema.parse({ status: 'suspended' })).toEqual({
      status: 'suspended',
    });
    expect(setTenantStatusBodySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(setModuleBodySchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(setModuleBodySchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});

describe('attachDomainBodySchema (TENANT-07, adjacency)', () => {
  it('normalises the host: case, port, trailing dot', () => {
    expect(attachDomainBodySchema.parse({ host: 'Comunidade.Cliente.com.br:443' })).toEqual({
      host: 'comunidade.cliente.com.br',
    });
    expect(attachDomainBodySchema.parse({ host: 'comunidade.cliente.com.br.' }).host).toBe(
      'comunidade.cliente.com.br',
    );
  });

  it('two spellings of the same host are one host at the boundary', () => {
    const a = attachDomainBodySchema.parse({ host: 'Comunidade.Cliente.com.br' });
    const b = attachDomainBodySchema.parse({ host: 'comunidade.cliente.com.br' });
    expect(a).toEqual(b);
  });

  it('refuses anything that is not a registrable host', () => {
    expect(attachDomainBodySchema.safeParse({ host: 'not a host' }).success).toBe(false);
    expect(attachDomainBodySchema.safeParse({ host: '[::1]' }).success).toBe(false);
    expect(attachDomainBodySchema.safeParse({ host: 'under_score.test' }).success).toBe(false);
    expect(attachDomainBodySchema.safeParse({ host: '' }).success).toBe(false);
    expect(attachDomainBodySchema.safeParse({ host: `${'a'.repeat(254)}.test` }).success).toBe(
      false,
    );
  });
});

describe('domain and invite shapes', () => {
  it('dnsRecordSchema carries type, name, value and a routing | ownership purpose', () => {
    expect(
      dnsRecordSchema.parse({
        type: 'CNAME',
        name: 'comunidade.cliente.com.br',
        value: 'fake.tria-dns.test',
        purpose: 'routing',
      }).purpose,
    ).toBe('routing');
    expect(
      dnsRecordSchema.safeParse({ type: 'MX', name: 'x', value: 'y', purpose: 'routing' }).success,
    ).toBe(false);
    expect(domainStatusSchema.options).toEqual(['pending', 'verified', 'expired', 'failed']);
    expect(inviteStatusSchema.options).toEqual(['pending', 'sent', 'accepted', 'expired']);
  });

  it('tenantDomainSchema and tenantInviteSchema accept the row shapes the detail answer carries', () => {
    expect(
      tenantDomainSchema.safeParse({
        id: UUID,
        host: 'comunidade.cliente.com.br',
        isPrimary: true,
        verificationStatus: 'pending',
        verifiedAt: null,
        dnsRecords: [],
        lastCheckedAt: null,
        verifyDeadlineAt: ISO,
        lastError: null,
        createdAt: ISO,
      }).success,
    ).toBe(true);
    expect(
      tenantInviteSchema.safeParse({
        id: UUID,
        email: 'admin@cliente.com.br',
        role: 'admin_tenant',
        status: 'pending',
        sentAt: null,
        acceptedAt: null,
        createdAt: ISO,
      }).success,
    ).toBe(true);
    expect(
      tenantInviteSchema.safeParse({
        id: UUID,
        email: 'a@b.c',
        role: 'member',
        status: 'pending',
        sentAt: null,
        acceptedAt: null,
        createdAt: ISO,
      }).success,
    ).toBe(false);
  });

  it('acceptInviteBodySchema carries the two consent versions and the response lands on /inicio', () => {
    expect(acceptInviteBodySchema.parse({ rulesVersion: 1, termsVersion: 2 })).toEqual({
      rulesVersion: 1,
      termsVersion: 2,
    });
    expect(acceptInviteBodySchema.safeParse({ rulesVersion: 0, termsVersion: 1 }).success).toBe(
      false,
    );
    expect(
      acceptInviteBodySchema.safeParse({ rulesVersion: 1, termsVersion: 1, password: 'x' }).success,
    ).toBe(true);
    expect(
      acceptInviteResponseSchema.parse({ tenantSlug: 'sao-jose', landing: '/inicio' }).landing,
    ).toBe('/inicio');
    expect(
      acceptInviteResponseSchema.safeParse({ tenantSlug: 'sao-jose', landing: '/' }).success,
    ).toBe(false);
  });
});

describe('platformTenantsQuerySchema (GET /v1/platform/tenants)', () => {
  it('defaults limit to 25 and caps it at 100', () => {
    expect(platformTenantsQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(platformTenantsQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(platformTenantsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(platformTenantsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('accepts status active | suspended, q up to 60 chars and a slug cursor', () => {
    expect(
      platformTenantsQuerySchema.parse({ q: '  São  ', status: 'suspended', cursor: 'sao-jose' }),
    ).toEqual({ q: 'São', status: 'suspended', cursor: 'sao-jose', limit: 25 });
    expect(platformTenantsQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(platformTenantsQuerySchema.safeParse({ q: 'x'.repeat(61) }).success).toBe(false);
    expect(platformTenantsQuerySchema.safeParse({ cursor: 'Not A Slug' }).success).toBe(false);
  });

  it('platformTenantsSchema items carry primaryHost and the list carries nextCursor', () => {
    const parsed = platformTenantsSchema.parse({
      tenants: [
        {
          id: UUID,
          slug: 'sao-jose',
          displayName: 'Associação São José',
          status: 'active',
          createdAt: ISO,
          enabledModules: ['feed'],
          primaryHost: null,
        },
      ],
      nextCursor: null,
    });
    expect(parsed.tenants[0]?.primaryHost).toBeNull();
    expect(parsed.nextCursor).toBeNull();
  });
});

describe('platformTenantDetailSchema (GET /v1/platform/tenants/{id})', () => {
  const colors = deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' });
  const fixture = {
    tenant: {
      id: UUID,
      slug: 'sao-jose',
      displayName: 'Associação São José',
      status: 'active',
      timezone: 'America/Sao_Paulo',
      createdAt: ISO,
      branding: {
        logoUrl: null,
        faviconUrl: null,
        iconUrl: null,
        iconUrls: null,
        iconVersion: 0,
        colors,
      },
      contrast: contrastReport(colors),
    },
    modules: [
      { key: 'feed', enabled: true },
      { key: 'events', enabled: false },
    ],
    domains: [
      {
        id: UUID,
        host: 'comunidade.cliente.com.br',
        isPrimary: true,
        verificationStatus: 'verified',
        verifiedAt: ISO,
        dnsRecords: [
          {
            type: 'CNAME',
            name: 'comunidade.cliente.com.br',
            value: 'fake.tria-dns.test',
            purpose: 'routing',
          },
        ],
        lastCheckedAt: ISO,
        verifyDeadlineAt: ISO,
        lastError: null,
        createdAt: ISO,
      },
    ],
    invites: [
      {
        id: UUID,
        email: 'admin@cliente.com.br',
        role: 'admin_tenant',
        status: 'sent',
        sentAt: ISO,
        acceptedAt: null,
        createdAt: ISO,
      },
    ],
    admins: [{ userId: UUID, email: 'admin@cliente.com.br', name: 'Admin', joinedAt: ISO }],
  };

  it('parses a complete fixture', () => {
    const parsed = platformTenantDetailSchema.parse(fixture);
    expect(parsed.tenant.contrast.onPrimary.ok).toBe(true);
    expect(parsed.domains[0]?.dnsRecords[0]?.purpose).toBe('routing');
  });

  it('is strict at the top level: an unknown key is refused', () => {
    expect(platformTenantDetailSchema.safeParse({ ...fixture, members: [] }).success).toBe(false);
  });

  it('modules never carry a key outside the vocabulary', () => {
    expect(
      platformTenantDetailSchema.safeParse({
        ...fixture,
        modules: [{ key: 'nao-existe', enabled: true }],
      }).success,
    ).toBe(false);
  });

  it('contrastReportSchema mirrors contrastReport()', () => {
    expect(contrastReportSchema.parse(contrastReport(colors))).toEqual(contrastReport(colors));
    expect(contrastReportSchema.safeParse({ onPrimary: { ratio: 5 } }).success).toBe(false);
  });
});

describe('brand schemas are unchanged from 02-01', () => {
  it('hostBrandingSchema stays strict and tenantBrandingSchema still defaults every key', () => {
    const colors = deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' });
    expect(
      hostBrandingSchema.safeParse({
        colors,
        logoUrl: null,
        faviconUrl: null,
        iconUrls: null,
        extra: 1,
      }).success,
    ).toBe(false);
    expect(tenantBrandingSchema.parse({})).toEqual({
      logoUrl: null,
      faviconUrl: null,
      iconUrl: null,
      iconUrls: null,
      iconVersion: 0,
      colors: {},
    });
  });
});

describe('TENANT_SUSPENDED (D-32)', () => {
  it('is a stable error code, listed right after MEMBERSHIP_BLOCKED', () => {
    expect(ERROR_CODES).toContain('TENANT_SUSPENDED');
    expect(ERROR_CODES.indexOf('TENANT_SUSPENDED')).toBe(
      ERROR_CODES.indexOf('MEMBERSHIP_BLOCKED') + 1,
    );
  });

  it('is accepted by the envelope schema', () => {
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: {
          code: 'TENANT_SUSPENDED',
          message: 'Esta comunidade está temporariamente indisponível.',
          requestId: 'r1',
        },
      }).success,
    ).toBe(true);
  });
});
