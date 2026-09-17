import { BRANDING_MAX_BYTES, BRANDING_UPLOAD_MIMES } from '@tria/contracts/branding';
import { describe, expect, it } from 'vitest';
import { BRANDING_UPLOAD_ACCEPT, classifyFile, resolveMime, uploadToSignedUrl } from './upload';

function file(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('upload helper (02-14, D-27 — client-side UX gate only)', () => {
  it('BRANDING_UPLOAD_ACCEPT is the contracts allow-list joined for <input accept>', () => {
    expect(BRANDING_UPLOAD_ACCEPT).toBe(BRANDING_UPLOAD_MIMES.join(','));
  });

  it('classifyFile: an accepted mime within the cap → null (no error)', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toBeNull();
    expect(classifyFile(file('a.webp', 'image/webp'))).toBeNull();
    expect(classifyFile(file('a.jpg', 'image/jpeg'))).toBeNull();
  });

  it("classifyFile: a mime outside the allow-list → 'type'", () => {
    expect(classifyFile(file('anim.gif', 'image/gif'))).toBe('type');
    expect(classifyFile(file('doc.pdf', 'application/pdf'))).toBe('type');
  });

  it('classifyFile: an empty type falls back to the extension (browsers leave SVG blank)', () => {
    expect(classifyFile(file('logo.svg', ''))).toBeNull();
    expect(resolveMime(file('logo.svg', ''))).toBe('image/svg+xml');
    expect(classifyFile(file('x.bin', ''))).toBe('type');
    expect(resolveMime(file('x.bin', ''))).toBeNull();
  });

  it("classifyFile: above BRANDING_MAX_BYTES → 'size'; exactly the cap → null", () => {
    expect(classifyFile(file('big.png', 'image/png', BRANDING_MAX_BYTES + 1))).toBe('size');
    expect(classifyFile(file('cap.png', 'image/png', BRANDING_MAX_BYTES))).toBeNull();
  });

  it('uploadToSignedUrl is a function (its XHR body is exercised by the e2e, not here)', () => {
    expect(typeof uploadToSignedUrl).toBe('function');
  });
});
