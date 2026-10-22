import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Quick 261022-fku: production Supabase Auth was capped at 2 e-mails per hour for the WHOLE project
 * (`429 over_email_send_rate_limit` on recover, invite and resend). `[auth.rate_limit] email_sent` can
 * only be changed on a project that has its own SMTP server, so `[remotes.production]` declares a
 * Resend SMTP block purely to unlock that field. The Send Email Hook stays the only sender.
 *
 * This file pins the config and its deploy wiring. It is hermetic: it reads two repo files as text,
 * with no TOML dependency, no database, no stack and no network (docs/deploy/auth-mail.md,
 * "Production e-mail rate limit").
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG = readFileSync(`${REPO}supabase/config.toml`, 'utf8');
const WORKFLOW = readFileSync(`${REPO}.github/workflows/deploy-api.yml`, 'utf8');
const CONFIG_LINES = CONFIG.split('\n');

/**
 * The key/value pairs (raw right-hand sides, trailing ` # comment` stripped) of the exact `header`
 * table: the non-comment, non-blank lines up to the next line that starts a table.
 */
function tomlTable(header: string): Record<string, string> {
  const start = CONFIG_LINES.findIndex((line) => line.trim() === header);
  if (start === -1) throw new Error(`supabase/config.toml has no ${header} table`);
  const out: Record<string, string> = {};
  for (const line of CONFIG_LINES.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break;
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .replace(/\s+#.*$/, '')
      .trim();
    out[key] = value;
  }
  return out;
}

const unquote = (raw: string): string => raw.replace(/^"(.*)"$/, '$1');

const RESEND_KEY_SHAPE = /\bre_\w{16,}/;

describe('production hosted auth e-mail config (quick 261022-fku)', () => {
  const smtp = () => tomlTable('[remotes.production.auth.email.smtp]');

  it('declares the Resend SMTP block that unlocks the rate-limit field', () => {
    const t = smtp();
    expect(t.enabled).toBe('true');
    expect(unquote(t.host ?? '')).toBe('smtp.resend.com');
    expect(t.port).toBe('465');
    expect(unquote(t.user ?? '')).toBe('resend');
    expect(unquote(t.sender_name ?? '').length).toBeGreaterThan(0);
    expect(unquote(t.admin_email ?? '')).toMatch(/^no-reply@[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  it('never holds the SMTP credential: only an env() reference reaches git', () => {
    expect(smtp().pass).toBe('"env(RESEND_SMTP_PASS)"');
    const passAssignments = CONFIG_LINES.map((line) => line.trim()).filter((line) =>
      /^pass\s*=/.test(line),
    );
    expect(passAssignments.length).toBeGreaterThan(0);
    for (const line of passAssignments) {
      expect(line).toMatch(/^pass\s*=\s*"env\([A-Z0-9_]+\)"/);
    }
    expect(CONFIG).not.toMatch(RESEND_KEY_SHAPE);
    expect(WORKFLOW).not.toMatch(RESEND_KEY_SHAPE);
  });

  it('raises email_sent above the starving default without removing the flood cap', () => {
    const raw = tomlTable('[remotes.production.auth.rate_limit]').email_sent;
    expect(raw).toMatch(/^\d+$/);
    const value = Number.parseInt(raw ?? '', 10);
    expect(value).toBeGreaterThanOrEqual(30);
    expect(value).toBeLessThanOrEqual(500);
  });

  it('keeps the per-address floor and the sign-up confirmation', () => {
    const t = tomlTable('[remotes.production.auth.email]');
    expect(t.max_frequency).toBe('"60s"');
    expect(t.enable_confirmations).toBe('true');
  });

  it('keeps the Send Email Hook as the only sender', () => {
    const hook = tomlTable('[remotes.production.auth.hook.send_email]');
    expect(hook.enabled).toBe('true');
    const uri = unquote(hook.uri ?? '');
    expect(uri.startsWith('https://')).toBe(true);
    expect(uri.endsWith('/v1/hooks/auth/send-email')).toBe(true);
    expect(hook.secrets).toBe('"env(SEND_EMAIL_HOOK_SECRETS)"');
    const transports = WORKFLOW.match(/^\s*MAIL_TRANSPORT=(\S+)\s*$/gm) ?? [];
    expect(transports.length).toBe(2);
    for (const line of transports) expect(line.trim()).toBe('MAIL_TRANSPORT=resend');
  });

  it('uses the sender identity the hook already uses (no-reply@ + MAIL_DOMAIN)', () => {
    const domains = [...WORKFLOW.matchAll(/^\s*MAIL_DOMAIN=(\S+)\s*$/gm)].map((m) => m[1]);
    expect(domains.length).toBe(2);
    expect(new Set(domains).size).toBe(1);
    expect(unquote(smtp().admin_email ?? '')).toBe(`no-reply@${domains[0]}`);
  });
});

/**
 * The step bodies of the job `migrate-and-deploy-prod`: a step starts at a line made of six spaces, a
 * dash, a space and `name:` or `uses:`, and runs to the next such line. Comment lines directly above a
 * step fall into the previous slice, so assertions look at step bodies only.
 */
function productionSteps(): { name: string; body: string }[] {
  const lines = WORKFLOW.split('\n');
  const jobStart = lines.findIndex((line) => /^ {2}migrate-and-deploy-prod:\s*$/.test(line));
  if (jobStart === -1) throw new Error('deploy-api.yml has no migrate-and-deploy-prod job');
  const steps: { name: string; lines: string[] }[] = [];
  for (const line of lines.slice(jobStart + 1)) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) break;
    const start = line.match(/^ {6}- (?:name|uses):\s*(.*)$/);
    if (start) {
      steps.push({ name: line.includes('name:') ? (start[1] ?? '').trim() : '', lines: [line] });
    } else {
      steps[steps.length - 1]?.lines.push(line);
    }
  }
  return steps.map((s) => ({ name: s.name, body: s.lines.join('\n') }));
}

describe('production deploy wiring of the SMTP password (quick 261022-fku)', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal GitHub Actions expression
  const SECRET = '${{ secrets.RESEND_SMTP_PASS }}';
  const find = (prefix: string) => {
    const steps = productionSteps();
    const index = steps.findIndex((s) => s.name.startsWith(prefix));
    if (index === -1) throw new Error(`no production step named ${prefix}...`);
    return { index, step: steps[index] as { name: string; body: string } };
  };

  it('fails the job before the migrations when the secret is empty', () => {
    const guard = find('Require the auth SMTP password');
    const migrations = find('Migrations');
    expect(guard.index).toBeLessThan(migrations.index);
    expect(guard.step.body).toContain(SECRET);
    expect(guard.step.body).toContain('exit 1');
  });

  it('hands the secret to both Supabase CLI steps that read config.toml', () => {
    for (const prefix of ['Migrations', 'Push auth configuration']) {
      expect(find(prefix).step.body).toContain(`RESEND_SMTP_PASS: ${SECRET}`);
    }
  });

  it('references the secret exactly three times, so it cannot spread to another step', () => {
    expect(WORKFLOW.split('secrets.RESEND_SMTP_PASS').length - 1).toBe(3);
  });

  it('keeps the SMTP password out of the Cloud Run env and secret mappings', () => {
    expect(WORKFLOW).not.toMatch(/RESEND_SMTP_PASS\s*=/);
  });
});
