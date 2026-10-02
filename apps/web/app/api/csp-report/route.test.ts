import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

/** The CSP violation sink (08-08, T-08-43): bounded, defensive, never reflective. */
function post(body: string, contentType: string, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://rede-demo.localhost:3000/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': contentType, ...headers },
      body,
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('POST /api/csp-report', () => {
  it('logs one bounded line for a report-uri report: directive, blocked host, document path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://comunidade.example/post/123?token=secret#x',
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/steal.js?session=abc',
        },
      }),
      'application/csp-report',
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('csp.violation', {
      directive: 'script-src-elem',
      blocked: 'evil.example',
      path: '/post/123',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('abc');
  });

  it('reads the Reporting API format, keeps CSP keywords, and caps the reports per request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = {
      type: 'csp-violation',
      body: {
        documentURL: 'http://rede-demo.localhost:3000/inicio',
        effectiveDirective: 'script-src-elem',
        blockedURL: 'inline',
      },
    };
    const res = await post(
      JSON.stringify(Array.from({ length: 9 }, () => one)),
      'application/reports+json',
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenLastCalledWith('csp.violation', {
      directive: 'script-src-elem',
      blocked: 'inline',
      path: '/inicio',
    });
  });

  it('sanitises a hostile directive and ignores unknown shapes and bad JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'not a url',
          'violated-directive': 'script-src\ncsp.violation forged',
          'blocked-uri': 'javascript:alert(1)',
        },
      }),
      'application/csp-report',
    );
    expect(warn).toHaveBeenLastCalledWith('csp.violation', {
      directive: 'script-src',
      blocked: 'javascript',
      path: 'unknown',
    });
    warn.mockClear();
    expect((await post('{nope', 'application/csp-report')).status).toBe(204);
    expect((await post('{"x":1}', 'application/reports+json')).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers 413 above 16 KB (streamed or declared) and 415 for any other content type', async () => {
    const big = 'x'.repeat(16 * 1024 + 1);
    expect((await post(big, 'application/csp-report')).status).toBe(413);
    expect(
      (await post('{}', 'application/csp-report', { 'content-length': String(1024 * 1024) }))
        .status,
    ).toBe(413);
    expect((await post('{}', 'application/json')).status).toBe(415);
    expect((await post('{}', 'text/plain')).status).toBe(415);
  });
});
