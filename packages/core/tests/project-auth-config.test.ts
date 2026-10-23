import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_HOOK_URIS,
  type AuthConfigInput,
  buildAuthConfigBody,
  SMTP,
  STORAGE_FILE_SIZE_LIMIT_BYTES,
} from '../server/projects/auth-config';

/**
 * 09.2-13 (D-542, RESEARCH Question 14): the Auth configuration a tenant project receives in ONE PATCH, and
 * the drift guard that ties it to `supabase/config.toml` (project 0). No database, no network.
 */

const HOOK_SECRET = `v1,whsec_${Buffer.alloc(32, 9).toString('base64')}`;
const input: AuthConfigInput = {
  siteUrl: 'https://app.exemplo.com.br',
  apiPublicUrl: 'https://api.exemplo.com.br',
  hookRef: 'AbCdEfGhIjKlMnOpQrSt_-',
  hookSecret: HOOK_SECRET,
  smtpPass: 're_test_key',
  mailDomain: 'n1marketingdigital.com.br',
  existingAllowList: '',
};

/** A line-based reader for the few TOML shapes the file uses: `[table]` headers and `key = scalar` lines. */
function readToml(path: string): Record<string, Record<string, string | number | boolean>> {
  const tables: Record<string, Record<string, string | number | boolean>> = {};
  let current = '';
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1] as string;
      tables[current] ??= {};
      continue;
    }
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!pair || !current) continue;
    const text = (pair[2] as string).replace(/\s+#.*$/, '').trim();
    let value: string | number | boolean = text;
    if (/^".*"$/.test(text)) value = text.slice(1, -1);
    else if (text === 'true' || text === 'false') value = text === 'true';
    else if (/^-?\d+$/.test(text)) value = Number(text);
    (tables[current] as Record<string, string | number | boolean>)[pair[1] as string] = value;
  }
  return tables;
}

const toml = readToml(fileURLToPath(new URL('../../../supabase/config.toml', import.meta.url)));
const table = (name: string) => {
  const found = toml[name];
  if (!found) throw new Error(`config.toml has no [${name}]`);
  return found;
};

describe('buildAuthConfigBody', () => {
  it('yields the single PATCH body of the template for a fixed input', () => {
    expect(buildAuthConfigBody(input)).toEqual({
      site_url: 'https://app.exemplo.com.br',
      uri_allow_list: 'https://app.exemplo.com.br/auth/confirm**',
      disable_signup: true,
      jwt_exp: 3600,
      mailer_otp_exp: 86_400,
      password_min_length: 8,
      refresh_token_rotation_enabled: true,
      security_refresh_token_reuse_interval: 10,
      smtp_host: 'smtp.resend.com',
      smtp_port: '465',
      smtp_user: 'resend',
      smtp_pass: 're_test_key',
      smtp_admin_email: 'no-reply@n1marketingdigital.com.br',
      smtp_sender_name: 'Rede Social',
      rate_limit_email_sent: 100,
      hook_send_email_enabled: true,
      hook_send_email_uri:
        'https://api.exemplo.com.br/v1/hooks/auth/send-email/AbCdEfGhIjKlMnOpQrSt_-',
      hook_send_email_secrets: HOOK_SECRET,
      hook_before_user_created_enabled: false,
      hook_before_user_created_uri:
        'pg-functions://postgres/public/hook_before_user_created_allowlist',
      hook_custom_access_token_enabled: false,
      hook_custom_access_token_uri:
        'pg-functions://postgres/public/hook_custom_access_token_allowlist',
    });
  });

  it('stays equal to supabase/config.toml on every key the two share (the drift guard)', () => {
    const body = buildAuthConfigBody(input);
    const auth = table('auth');
    expect(body.jwt_exp).toBe(auth.jwt_expiry);
    expect(body.password_min_length).toBe(auth.minimum_password_length);
    expect(body.refresh_token_rotation_enabled).toBe(auth.enable_refresh_token_rotation);
    expect(body.security_refresh_token_reuse_interval).toBe(auth.refresh_token_reuse_interval);
    // The repo closes GoTrue's public sign-up; the TOML says so as `enable_signup = false`.
    expect(body.disable_signup).toBe(auth.enable_signup === false);

    const production = 'remotes.production.auth';
    expect(body.mailer_otp_exp).toBe(table(`${production}.email`).otp_expiry);
    expect(body.rate_limit_email_sent).toBe(table(`${production}.rate_limit`).email_sent);

    const smtp = table(`${production}.email.smtp`);
    expect(body.smtp_host).toBe(smtp.host);
    // `smtp_port` is a string in the Management API spec, a number in the TOML.
    expect(body.smtp_port).toBe(String(smtp.port));
    expect(body.smtp_user).toBe(smtp.user);
    expect(body.smtp_admin_email).toBe(smtp.admin_email);
    expect(body.smtp_sender_name).toBe(smtp.sender_name);

    const beforeUser = table(`${production}.hook.before_user_created`);
    const tokenHook = table(`${production}.hook.custom_access_token`);
    expect(body.hook_before_user_created_uri).toBe(beforeUser.uri);
    expect(body.hook_before_user_created_enabled).toBe(beforeUser.enabled);
    expect(body.hook_custom_access_token_uri).toBe(tokenHook.uri);
    expect(body.hook_custom_access_token_enabled).toBe(tokenHook.enabled);
    expect(table(`${production}.hook.send_email`).enabled).toBe(body.hook_send_email_enabled);
    // The exported constants are the same literals.
    expect(ACCESS_HOOK_URIS.beforeUserCreated).toBe(beforeUser.uri);
    expect(ACCESS_HOOK_URIS.customAccessToken).toBe(tokenHook.uri);
    expect(SMTP.host).toBe(smtp.host);
  });

  it('keeps both access hooks disabled whatever the input', () => {
    for (const mailDomain of ['a.example', 'b.example']) {
      const body = buildAuthConfigBody({ ...input, mailDomain });
      expect(body.hook_before_user_created_enabled).toBe(false);
      expect(body.hook_custom_access_token_enabled).toBe(false);
    }
  });

  it('site_url has no comma and no trailing slash; a comma is refused', () => {
    expect(buildAuthConfigBody({ ...input, siteUrl: 'https://app.exemplo.com.br/' }).site_url).toBe(
      'https://app.exemplo.com.br',
    );
    expect(() =>
      buildAuthConfigBody({ ...input, siteUrl: 'https://a.test,https://b.test' }),
    ).toThrow(/site url/);
    expect(() => buildAuthConfigBody({ ...input, siteUrl: '' })).toThrow(/site url/);
  });

  it('omits uri_allow_list when the project already has entries, and seeds it when it has none', () => {
    const kept = buildAuthConfigBody({
      ...input,
      existingAllowList: 'https://cliente.example/auth/confirm**',
    });
    expect('uri_allow_list' in kept).toBe(false);
    for (const empty of ['', '   ', null, undefined]) {
      const seeded = buildAuthConfigBody({ ...input, existingAllowList: empty });
      expect(seeded.uri_allow_list).toBe('https://app.exemplo.com.br/auth/confirm**');
    }
  });

  it('smtp_port is a string and no key of the body is undefined', () => {
    const body = buildAuthConfigBody(input);
    expect(typeof body.smtp_port).toBe('string');
    for (const [key, value] of Object.entries(body)) {
      expect(value, key).not.toBeUndefined();
    }
  });

  it('refuses a malformed hook coordinate, an empty SMTP password and an empty mail domain', () => {
    expect(() => buildAuthConfigBody({ ...input, hookRef: 'short' })).toThrow(/hook ref/);
    expect(() => buildAuthConfigBody({ ...input, hookSecret: 'v1,whsec_x' })).toThrow(
      /hook secret/,
    );
    expect(() => buildAuthConfigBody({ ...input, smtpPass: '' })).toThrow(/smtp password/);
    expect(() => buildAuthConfigBody({ ...input, mailDomain: '' })).toThrow(/mail domain/);
  });

  it('the Storage ceiling is the 50 MiB of config.toml', () => {
    expect(STORAGE_FILE_SIZE_LIMIT_BYTES).toBe(50 * 1024 * 1024);
    expect(table('storage').file_size_limit).toBe('50MiB');
  });
});

describe('the step runners never log a credential (PR-4, static)', () => {
  it('steps.ts contains no log call at all', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../server/projects/steps.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/\blog\.(info|warn|error|debug|trace)\b/);
    expect(source).not.toMatch(/console\./);
  });
});
