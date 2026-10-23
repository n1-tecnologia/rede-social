import { describe, expect, it } from 'vitest';
import { assertProductionEnv } from '../server/env';
import { createProjectProviderFor } from '../server/projects/index';

/**
 * 09.2-12 (DBT-37, D-540, T-09.2-59): the fake project provider can never be selected in production, and
 * the real one is selected only with its token, its organisation and the key that seals what it returns.
 */

const KEY = Buffer.alloc(32, 7).toString('base64');

/** Everything else production demands, so only the project provider rules are under test. */
const productionBase = {
  NODE_ENV: 'production',
  DOMAIN_PROVIDER: 'fake',
  AUTH_ALLOW_LIST: 'local',
  MAIL_TRANSPORT: 'local',
  VIDEO_PROVIDER: 'fake',
  PUSH_TRANSPORT: 'fake',
  PAYMENTS_PROVIDERS: 'kiwify',
  PAYMENTS_SECRET_KEY: KEY,
};

const check = (overrides: Record<string, unknown>) =>
  assertProductionEnv({ ...productionBase, ...overrides } as never);

const complete = {
  PROJECT_PROVIDER: 'supabase',
  SUPABASE_PAT: 'sbp_token',
  SUPABASE_ORG_SLUG: 'acme-org',
  PLATFORM_MASTER_KEYS: JSON.stringify({ 1: KEY }),
  API_PUBLIC_URL: 'https://api.example.com',
};

describe('assertProductionEnv: PROJECT_PROVIDER (DBT-37)', () => {
  it('refuses an explicit PROJECT_PROVIDER=fake in production', () => {
    expect(() => check({ PROJECT_PROVIDER: 'fake' })).toThrow(/PROJECT_PROVIDER/);
  });

  it('refuses supabase without the PAT, the organisation slug, the master keys or the API origin, naming each', () => {
    for (const missing of [
      'SUPABASE_PAT',
      'SUPABASE_ORG_SLUG',
      'PLATFORM_MASTER_KEYS',
      'API_PUBLIC_URL',
    ]) {
      expect(() => check({ ...complete, [missing]: undefined })).toThrow(
        new RegExp(`${missing} \\(required when PROJECT_PROVIDER=supabase\\)`),
      );
    }
    expect(() => check({ PROJECT_PROVIDER: 'supabase' })).toThrow(
      /SUPABASE_PAT[\s\S]*SUPABASE_ORG_SLUG[\s\S]*PLATFORM_MASTER_KEYS[\s\S]*API_PUBLIC_URL/,
    );
  });

  it('accepts a complete supabase selection in production', () => {
    expect(() => check(complete)).not.toThrow();
  });

  it('leaves development and test unconstrained: the fake, or no selection at all, boots', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() =>
        assertProductionEnv({ NODE_ENV, PROJECT_PROVIDER: 'fake' } as never),
      ).not.toThrow();
      expect(() => assertProductionEnv({ NODE_ENV } as never)).not.toThrow();
    }
  });

  it('the expand release (no PROJECT_PROVIDER named) still boots in production, and a real selection asks for its credentials in every environment', () => {
    expect(() => check({})).not.toThrow();
    expect(() =>
      assertProductionEnv({ NODE_ENV: 'development', PROJECT_PROVIDER: 'supabase' } as never),
    ).toThrow(/SUPABASE_PAT/);
  });
});

describe('createProjectProviderFor (the env-selected singleton)', () => {
  it('development and test (unset or fake) get the network-free fake', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      expect(createProjectProviderFor({ NODE_ENV }).name).toBe('fake');
      expect(createProjectProviderFor({ NODE_ENV, PROJECT_PROVIDER: 'fake' }).name).toBe('fake');
    }
  });

  it('production never hands out the fake, explicit or not', () => {
    expect(() => createProjectProviderFor({ NODE_ENV: 'production' })).toThrow(
      /PROJECT_PROVIDER=supabase is required in production/,
    );
    expect(() =>
      createProjectProviderFor({ NODE_ENV: 'production', PROJECT_PROVIDER: 'fake' }),
    ).toThrow(/production/);
  });

  it('supabase needs its token and organisation with a named error, and builds the real adapter with both', () => {
    expect(() =>
      createProjectProviderFor({
        NODE_ENV: 'production',
        PROJECT_PROVIDER: 'supabase',
        SUPABASE_ORG_SLUG: 'o',
      }),
    ).toThrow(/SUPABASE_PAT/);
    expect(() =>
      createProjectProviderFor({
        NODE_ENV: 'production',
        PROJECT_PROVIDER: 'supabase',
        SUPABASE_PAT: 'sbp_x',
      }),
    ).toThrow(/SUPABASE_ORG_SLUG/);
    const real = createProjectProviderFor({
      NODE_ENV: 'production',
      PROJECT_PROVIDER: 'supabase',
      SUPABASE_PAT: 'sbp_x',
      SUPABASE_ORG_SLUG: 'o',
    });
    expect(real.name).toBe('supabase');
  });

  it('the singleton of this test process (no PROJECT_PROVIDER, NODE_ENV=test) is the fake', async () => {
    const { projectProvider } = await import('../server/projects/index');
    expect(projectProvider.name).toBe('fake');
  });
});
