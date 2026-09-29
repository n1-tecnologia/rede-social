import { describe, expect, it } from 'vitest';
import { bossConnectionString } from '../server/jobs/connection';

const POOLER = 'postgresql://api_user.ref:pw@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';

describe('bossConnectionString — node-postgres reads sslmode=require as libpq does', () => {
  it('adds uselibpqcompat=true to a bare sslmode=require and keeps the other parameters', () => {
    const out = new URL(bossConnectionString(`${POOLER}?sslmode=require&application_name=boss`));
    expect(out.searchParams.get('sslmode')).toBe('require');
    expect(out.searchParams.get('uselibpqcompat')).toBe('true');
    expect(out.searchParams.get('application_name')).toBe('boss');
    expect(out.username).toBe('api_user.ref');
    expect(out.password).toBe('pw');
  });

  it('leaves every other shape untouched', () => {
    for (const url of [
      POOLER,
      `${POOLER}?sslmode=disable`,
      `${POOLER}?sslmode=verify-full`,
      `${POOLER}?sslmode=require&uselibpqcompat=true`,
      'postgres://api_user:postgres@127.0.0.1:54322/postgres',
      'not a url',
    ]) {
      expect(bossConnectionString(url)).toBe(url);
    }
  });
});
