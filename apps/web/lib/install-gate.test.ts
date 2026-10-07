// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  decideInstallGate,
  detectPlatform,
  GATE_SKIP_KEY,
  type GateEnv,
  iosBelow,
  iosVersion,
  isInAppBrowser,
  MIN_IOS_FOR_INSTALL,
  readGateSkipped,
  writeGateSkipped,
} from './install-gate';

/**
 * The pure half of the install gate (quick 261007-kyp): platform, in-app browser, iOS version and
 * the gate decision, all over a plain `{ userAgent, maxTouchPoints, standalone }` object. happy-dom
 * only because the module imports `isIosLike` from lib/push, whose import chain pulls UI modules.
 */

const UA = {
  iphoneSafari17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphoneSafari16_3:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphoneSafari16_4:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15',
  iphoneHomeScreen:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.29.110 (iPhone14,5; iOS 17_0; pt_BR; pt-BR; scale=3.00; 1170x2532; 500000000)',
  classicIpad:
    'Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  ipadosMac17:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ipadosMac16_4:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
  macNoVersion:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0;]',
  iosFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.0;FBBV/1;FBDV/iPhone14,5]',
  tiktok:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 musical_ly_35.0.0 BytedanceWebview/d8a21c6',
  linkedin:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.0',
  snapchat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.0.0.0',
  line: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Line/13.0.0',
  wechat:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40',
  pinterest:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
  twitter:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone',
  googleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/300.0.0 Mobile/15E148 Safari/604.1',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function env(userAgent: string, maxTouchPoints = 0, standalone = false): GateEnv {
  return { userAgent, maxTouchPoints, standalone };
}

describe('detectPlatform', () => {
  it('1. iPhone Safari, iPhone Chrome and the classic iPad are ios', () => {
    expect(detectPlatform(env(UA.iphoneSafari17, 5))).toBe('ios');
    expect(detectPlatform(env(UA.iphoneChrome, 5))).toBe('ios');
    expect(detectPlatform(env(UA.classicIpad, 5))).toBe('ios');
  });

  it('2. a Macintosh user agent is ios only with more than one touch point (iPadOS)', () => {
    expect(detectPlatform(env(UA.ipadosMac17, 5))).toBe('ios');
    expect(detectPlatform(env(UA.ipadosMac17, 0))).toBe('desktop');
  });

  it('3. Android phones and an Android tablet (no Mobile token) are android', () => {
    expect(detectPlatform(env(UA.androidChrome, 5))).toBe('android');
    expect(detectPlatform(env(UA.androidSamsung, 5))).toBe('android');
    expect(detectPlatform(env(UA.androidTablet, 5))).toBe('android');
  });

  it('4. Windows (touch laptops included), Linux, ChromeOS and an empty UA are desktop', () => {
    expect(detectPlatform(env(UA.windowsChrome, 0))).toBe('desktop');
    expect(detectPlatform(env(UA.windowsChrome, 10))).toBe('desktop');
    expect(detectPlatform(env(UA.linux, 0))).toBe('desktop');
    expect(detectPlatform(env(UA.cros, 0))).toBe('desktop');
    expect(detectPlatform(env('', 0))).toBe('desktop');
  });
});

describe('isInAppBrowser', () => {
  it('5. the embedded browsers of the social apps and web views are in-app', () => {
    for (const ua of [
      UA.iphoneInstagram,
      UA.androidFacebook,
      UA.iosFacebook,
      UA.tiktok,
      UA.linkedin,
      UA.snapchat,
      UA.line,
      UA.wechat,
      UA.pinterest,
      UA.twitter,
      UA.googleApp,
      UA.androidWebView,
    ]) {
      expect(isInAppBrowser(ua)).toBe(true);
    }
  });

  it('6. an iOS user agent with no Safari token is a web view', () => {
    expect(isInAppBrowser(UA.iphoneHomeScreen)).toBe(true);
  });

  it('7. the real browsers are not in-app', () => {
    for (const ua of [
      UA.iphoneSafari17,
      UA.iphoneChrome,
      UA.iphoneFirefox,
      UA.androidChrome,
      UA.androidSamsung,
      UA.ipadosMac17,
      UA.windowsChrome,
    ]) {
      expect(isInAppBrowser(ua)).toBe(false);
    }
  });
});

describe('iosVersion / iosBelow', () => {
  it('8. reads the OS token of iPhone and iPad, and Version/ for the frozen iPadOS user agent', () => {
    expect(iosVersion(UA.iphoneSafari17)).toEqual({ major: 17, minor: 0 });
    expect(iosVersion(UA.classicIpad)).toEqual({ major: 16, minor: 3 });
    expect(iosVersion(UA.ipadosMac16_4)).toEqual({ major: 16, minor: 4 });
  });

  it('9. Android, a Mac without a Version token and garbage are null', () => {
    expect(iosVersion(UA.androidChrome)).toBeNull();
    expect(iosVersion(UA.macNoVersion)).toBeNull();
    expect(iosVersion('garbage')).toBeNull();
  });

  it('10. iosBelow(16, 4): 16.3 yes, 16.4 and 17.0 no, unknown no', () => {
    expect(MIN_IOS_FOR_INSTALL).toEqual({ major: 16, minor: 4 });
    expect(iosBelow(UA.iphoneSafari16_3, 16, 4)).toBe(true);
    expect(iosBelow(UA.iphoneSafari16_4, 16, 4)).toBe(false);
    expect(iosBelow(UA.iphoneSafari17, 16, 4)).toBe(false);
    expect(iosBelow(UA.androidChrome, 16, 4)).toBe(false);
    expect(iosBelow(UA.macNoVersion, 16, 4)).toBe(false);
  });
});

describe('decideInstallGate', () => {
  it('11. desktop is never gated', () => {
    expect(decideInstallGate(env(UA.windowsChrome, 0))).toEqual({ gated: false });
    expect(decideInstallGate(env(UA.windowsChrome, 10))).toEqual({ gated: false });
    expect(decideInstallGate(env(UA.macNoVersion, 0))).toEqual({ gated: false });
    expect(decideInstallGate(env(UA.ipadosMac17, 0))).toEqual({ gated: false });
  });

  it('12. iPhone Safari 17 outside standalone: ios screen, no escape', () => {
    expect(decideInstallGate(env(UA.iphoneSafari17, 5))).toEqual({
      gated: true,
      screen: 'ios',
      canContinue: false,
    });
  });

  it('13. standalone is never gated, even for the home-screen UA that has no Safari token', () => {
    expect(decideInstallGate(env(UA.iphoneSafari17, 5, true))).toEqual({ gated: false });
    expect(decideInstallGate(env(UA.iphoneHomeScreen, 5, true))).toEqual({ gated: false });
    expect(decideInstallGate(env(UA.androidChrome, 5, true))).toEqual({ gated: false });
  });

  it('14. iPadOS (Macintosh, touch 5, Version/17.0) is ios with no escape', () => {
    expect(decideInstallGate(env(UA.ipadosMac17, 5))).toEqual({
      gated: true,
      screen: 'ios',
      canContinue: false,
    });
  });

  it('15. iOS below 16.4 can continue in the browser', () => {
    expect(decideInstallGate(env(UA.iphoneSafari16_3, 5))).toEqual({
      gated: true,
      screen: 'ios',
      canContinue: true,
    });
    expect(decideInstallGate(env(UA.classicIpad, 5))).toEqual({
      gated: true,
      screen: 'ios',
      canContinue: true,
    });
  });

  it('16. in-app browsers (iOS and Android WebView) get the in-app screen with an escape', () => {
    expect(decideInstallGate(env(UA.iphoneInstagram, 5))).toEqual({
      gated: true,
      screen: 'in-app',
      canContinue: true,
    });
    expect(decideInstallGate(env(UA.androidWebView, 5))).toEqual({
      gated: true,
      screen: 'in-app',
      canContinue: true,
    });
  });

  it('17. Android Chrome outside standalone: android screen, no escape', () => {
    expect(decideInstallGate(env(UA.androidChrome, 5))).toEqual({
      gated: true,
      screen: 'android',
      canContinue: false,
    });
  });
});

describe('skip flag helpers', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('18. write then read is true; nothing stored reads false', () => {
    expect(GATE_SKIP_KEY).toBe('rede_install_gate_skip');
    expect(readGateSkipped()).toBe(false);
    writeGateSkipped();
    expect(readGateSkipped()).toBe(true);
  });

  it('19. a throwing store reads false and never throws on write', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    Object.defineProperty(window, 'sessionStorage', { value: throwing, configurable: true });
    try {
      expect(readGateSkipped()).toBe(false);
      expect(() => writeGateSkipped()).not.toThrow();
    } finally {
      if (real) Object.defineProperty(window, 'sessionStorage', real);
    }
  });
});
