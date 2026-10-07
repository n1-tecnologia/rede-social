import { isIosLike } from '@/lib/push';

/**
 * The pure half of the install gate (quick 261007-kyp): given what the browser reports about the
 * device, which screen (if any) replaces the app. No React, no DOM access at import time, no
 * server-only imports; the component reads the real `navigator` and display mode and hands them in
 * as a plain `GateEnv`, so every rule below is a function over an object and unit-testable.
 *
 * Rule order in `decideInstallGate`: desktop -> standalone -> in-app browser -> iOS -> Android.
 * STANDALONE PRECEDES THE IN-APP RULE on purpose: the user agent of an iOS home-screen app carries
 * no `Safari` token, so the generic "iOS without Safari is a web view" rule would otherwise gate the
 * very app the member installed.
 *
 * Limits of user-agent sniffing, accepted: SFSafariViewController and Android Custom Tabs look like
 * the real browser and are treated as it; a browser that spoofs a desktop user agent ("Request
 * desktop site" on Android) is not gated. This is a UX policy, NOT an authorization boundary: every
 * API call still authenticates and tenant-scopes the session whatever this module says (T-kyp-01).
 */

export type GateEnv = {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
};

export type GatePlatform = 'ios' | 'android' | 'desktop';

/** iOS-like (iPhone, iPod, iPad and iPadOS as a touch Mac) first, then Android, else desktop. */
export function detectPlatform(env: Pick<GateEnv, 'userAgent' | 'maxTouchPoints'>): GatePlatform {
  if (isIosLike(env.userAgent, env.maxTouchPoints)) return 'ios';
  if (/Android/.test(env.userAgent)) return 'android';
  return 'desktop';
}

/**
 * Tokens the embedded browsers of social apps and web views put in their user agent. Each entry is
 * a documented, stable marker: Instagram, Facebook (`FBAN`/`FBAV` on iOS, `FB_IAB`/`FB4A` on
 * Android), TikTok (`musical_ly`, `BytedanceWebview`), LinkedIn, Snapchat, LINE, WeChat, Pinterest,
 * Twitter, the Google app (`GSA/`) and an Android WebView (the `; wv)` token).
 */
const IN_APP_TOKENS =
  /Instagram|FBAN|FBAV|FB_IAB|FB4A|TikTok|musical_ly|Bytedance|LinkedInApp|Snapchat|\bLine\/|MicroMessenger|Pinterest|Twitter|GSA\/|; wv\)/;

/**
 * An embedded browser that cannot install a PWA. Besides the token list, the generic iOS rule: an
 * iPhone/iPad/iPod user agent with no `Safari` token is a WKWebView (real iOS browsers, Chrome and
 * Firefox included, all carry it).
 */
export function isInAppBrowser(userAgent: string): boolean {
  if (IN_APP_TOKENS.test(userAgent)) return true;
  return /iPhone|iPad|iPod/.test(userAgent) && !/Safari/.test(userAgent);
}

export type IosVersion = { major: number; minor: number };

/**
 * The iOS version of an iOS-like user agent: the `CPU iPhone OS x_y` / `CPU OS x_y` token first, then
 * the `Version/x.y` token that the frozen iPadOS (`Macintosh`) user agent still carries. Null when
 * neither exists (an Android UA's `Version/4.0` is deliberately not read: only a Macintosh UA uses
 * the fallback).
 */
export function iosVersion(userAgent: string): IosVersion | null {
  const os = /CPU (?:iPhone )?OS (\d+)[_.](\d+)/.exec(userAgent);
  if (os) return { major: Number(os[1]), minor: Number(os[2]) };
  if (/Macintosh/.test(userAgent)) {
    const version = /Version\/(\d+)\.(\d+)/.exec(userAgent);
    if (version) return { major: Number(version[1]), minor: Number(version[2]) };
  }
  return null;
}

/** The first iOS where a home-screen web app can receive Web Push. */
export const MIN_IOS_FOR_INSTALL: IosVersion = { major: 16, minor: 4 };

/** `true` when the user agent is an iOS older than `major.minor`. An unknown version is `false`, so the escape never opens on a guess. */
export function iosBelow(userAgent: string, major: number, minor: number): boolean {
  const v = iosVersion(userAgent);
  if (!v) return false;
  return v.major < major || (v.major === major && v.minor < minor);
}

export type GateScreen = 'ios' | 'android' | 'in-app';

export type GateDecision =
  | { gated: false }
  | { gated: true; screen: GateScreen; canContinue: boolean };

/**
 * Which screen, if any, replaces the app. `canContinue` is true ONLY for in-app browsers (nothing to
 * install from there) and iOS below 16.4 (cannot install with push); everywhere else the gate is hard.
 */
export function decideInstallGate(env: GateEnv): GateDecision {
  const platform = detectPlatform(env);
  if (platform === 'desktop') return { gated: false };
  if (env.standalone) return { gated: false };
  if (isInAppBrowser(env.userAgent)) return { gated: true, screen: 'in-app', canContinue: true };
  if (platform === 'ios') {
    return {
      gated: true,
      screen: 'ios',
      canContinue: iosBelow(env.userAgent, MIN_IOS_FOR_INSTALL.major, MIN_IOS_FOR_INSTALL.minor),
    };
  }
  return { gated: true, screen: 'android', canContinue: false };
}

export const GATE_SKIP_KEY = 'rede_install_gate_skip';

/** The escape-hatch flag lives in sessionStorage (a new browser session asks again). A throwing store reads `false`. */
export function readGateSkipped(): boolean {
  try {
    return window.sessionStorage.getItem(GATE_SKIP_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeGateSkipped(): void {
  try {
    window.sessionStorage.setItem(GATE_SKIP_KEY, '1');
  } catch {
    // Storage unavailable: the escape holds for this render only.
  }
}
