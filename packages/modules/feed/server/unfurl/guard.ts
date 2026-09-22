import net from 'node:net';
import { Agent } from 'undici';

/**
 * RED-PHASE STUB — deliberately inert, replaced wholesale in the GREEN commit.
 *
 * It exists so `tests/unfurl-guard.test.ts` fails on ASSERTIONS rather than on module resolution:
 * per #3770 a load-time crash is INVALID_RED and must not authorise GREEN, and this file does not
 * exist yet in any form. Every export below has the final signature and none of the final
 * behaviour — nothing is blocked, nothing is capped, nothing is normalised.
 */

export class BlockedTargetError extends Error {}

export interface GuardPolicy {
  blockList: net.BlockList;
  maxResponseSize: number;
  connectTimeout: number;
  headersTimeout: number;
  bodyTimeout: number;
  connectorTimeout: number;
}

export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  blockList: new net.BlockList(),
  maxResponseSize: 0,
  connectTimeout: 0,
  headersTimeout: 0,
  bodyTimeout: 0,
  connectorTimeout: 0,
};

export function isBlockedAddress(_address: string, _family: number): boolean {
  return false;
}

export function guardedAgent(_policy: GuardPolicy = DEFAULT_GUARD_POLICY): Agent {
  return new Agent();
}

export function assertAllowedUrl(raw: string): URL {
  return new URL(raw);
}

export function normaliseUrl(raw: string): string {
  return raw;
}

export function urlHash(raw: string): string {
  return raw;
}
