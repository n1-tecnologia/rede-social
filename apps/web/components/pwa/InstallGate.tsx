'use client';

import { Button } from '@rede-social/ui';
import { Download, EllipsisVertical, MailCheck, Share, SquarePlus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { AuthBrand } from '@/app/(auth)/AuthBrand';
import type { AppBrandAttributes } from '@/lib/bg-tone';
import {
  decideInstallGate,
  type GateDecision,
  type GateEnv,
  readGateSkipped,
  writeGateSkipped,
} from '@/lib/install-gate';
import { getInstallPromptState, promptInstall, subscribeInstallPrompt } from '@/lib/install-prompt';
import { type LinkReturn, linkReturnScreen } from '@/lib/link-return';
import { isStandalone, type WindowLike } from './InstallHint';

/**
 * The install gate (quick 261007-kyp, PWA-01/02): on a phone or tablet that is not running the
 * installed app, every route (login and sign-up included) renders a full-screen "instale o app"
 * screen instead of the app. The app's children are NOT mounted while it shows.
 *
 * FIRST RENDER IS NEUTRAL (hydration). The server cannot know the device, so the first server HTML
 * and the first client render are the same: `<>{children}</>`. Only after mount does an effect read
 * `navigator.userAgent`, `navigator.maxTouchPoints` and the display mode, and only then may the
 * children be swapped for the gate. The children sit in the same fragment position in every state, so
 * going from "deciding" to "open" never remounts the app.
 *
 * NO FLASH. While the device is unknown the root layout keeps `data-install-gate="pending"` on
 * `<html>`; globals.css hides `body` for coarse-pointer browser-mode devices while that value
 * stands (desktop and standalone are never hidden), with a 4 s CSS failsafe so a failed hydration
 * cannot leave a blank phone. This component rewrites the attribute to `open` or `gated` once it
 * has decided.
 *
 * ESCAPE HATCH. "Continuar no navegador" exists ONLY when the decision says `canContinue` (in-app
 * browsers and iOS older than 16.4) and the stored flag is honored only then: a stale flag can
 * never open the hard gate for Safari 17 or Android Chrome. The flag lives in sessionStorage.
 *
 * The Android "Instalar app" button reads the install prompt captured at import time by
 * `lib/install-prompt.ts`; without a captured event (app already installed, a browser that never
 * fires it) the screen shows the manual menu steps. Brand: the same block the login page shows
 * (`AuthBrand`), because this renders on public hosts before any session exists.
 */

type BrandProps = { displayName: string; logoUrl: string | null };

type Props = {
  enabled: boolean;
  brand: BrandProps;
  brandStyle: Record<string, string>;
  brandAttributes: AppBrandAttributes;
  /** The marker `/auth/confirm` left after a mail link (null when none or the gate is off). */
  linkReturn: LinkReturn | null;
  children: ReactNode;
};

type StepIcon = ComponentType<{ 'aria-hidden'?: boolean; size?: number; className?: string }>;

function Steps({ label, steps }: { label: string; steps: { icon: StepIcon; text: string }[] }) {
  return (
    <ol aria-label={label} className="flex w-full list-none flex-col gap-3 p-0 text-left">
      {steps.map(({ icon: Icon, text }, index) => (
        <li
          key={text}
          className="flex items-center gap-3 rounded-2xl border border-border-secondary bg-bg-secondary p-3"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon aria-hidden size={18} />
          </span>
          <span className="text-sm leading-snug text-text">
            <span className="mr-1 font-bold">{`${index + 1}.`}</span>
            {text}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Screen({
  brand,
  brandStyle,
  brandAttributes,
  children,
}: Pick<Props, 'brand' | 'brandStyle' | 'brandAttributes'> & { children: ReactNode }) {
  return (
    <main
      {...brandAttributes}
      style={brandStyle}
      className="flex min-h-[var(--screen-h)] flex-col items-center justify-center bg-bg p-6 text-text"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <AuthBrand logoUrl={brand.logoUrl} displayName={brand.displayName} />
        {children}
      </div>
    </main>
  );
}

function AndroidInstall({ tenant }: { tenant: string }) {
  const t = useTranslations('pwa');
  const state = useSyncExternalStore(subscribeInstallPrompt, getInstallPromptState, () => 'none');
  const [busy, setBusy] = useState(false);

  if (state === 'installed') {
    return (
      <div role="status" className="flex flex-col gap-1">
        <p className="text-base font-bold text-text">{t('gate.installed.title')}</p>
        <p className="text-sm text-text-secondary">{t('gate.installed.body', { tenant })}</p>
      </div>
    );
  }
  if (state === 'available') {
    return (
      <Button
        variant="brand"
        fullWidth
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await promptInstall();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t('gate.installing') : t('gate.install')}
      </Button>
    );
  }
  return (
    <Steps
      label={t('gate.android.stepsLabel')}
      steps={[
        { icon: EllipsisVertical, text: t('gate.android.step1') },
        { icon: Download, text: t('gate.android.step2') },
        { icon: SquarePlus, text: t('gate.android.step3') },
      ]}
    />
  );
}

function LinkReturnScreen({
  marker,
  tenant,
  onNotInstalled,
  ...scope
}: Pick<Props, 'brand' | 'brandStyle' | 'brandAttributes'> & {
  marker: LinkReturn;
  tenant: string;
  onNotInstalled: () => void;
}) {
  const t = useTranslations('pwa');
  return (
    <Screen {...scope}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
        <MailCheck aria-hidden size={28} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold leading-tight text-text">
          {t(`gate.linkReturn.${marker}.title`)}
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          {t(`gate.linkReturn.${marker}.body`, { tenant })}
        </p>
      </div>
      <Button variant="ghost" fullWidth onClick={onNotInstalled}>
        {t('gate.linkReturn.notInstalled')}
      </Button>
    </Screen>
  );
}

function InstallScreen({
  decision,
  tenant,
  onContinue,
  ...scope
}: Pick<Props, 'brand' | 'brandStyle' | 'brandAttributes'> & {
  decision: Extract<GateDecision, { gated: true }>;
  tenant: string;
  onContinue: () => void;
}) {
  const t = useTranslations('pwa');
  const inApp = decision.screen === 'in-app';
  return (
    <Screen {...scope}>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold leading-tight text-text">
          {inApp ? t('gate.inApp.title') : t('gate.title')}
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          {inApp ? t('gate.inApp.body') : t('gate.lead', { tenant })}
        </p>
      </div>
      {decision.screen === 'ios' ? (
        <>
          <Steps
            label={t('gate.ios.stepsLabel')}
            steps={[
              { icon: Share, text: t('gate.ios.step1') },
              { icon: SquarePlus, text: t('gate.ios.step2') },
              { icon: Download, text: t('gate.ios.step3') },
            ]}
          />
          {decision.canContinue ? (
            <p className="text-xs leading-relaxed text-text-secondary">{t('gate.ios.old')}</p>
          ) : null}
        </>
      ) : null}
      {decision.screen === 'android' ? <AndroidInstall tenant={tenant} /> : null}
      {inApp ? (
        <Steps
          label={t('gate.inApp.stepsLabel')}
          steps={[
            { icon: EllipsisVertical, text: t('gate.inApp.step1') },
            { icon: Share, text: t('gate.inApp.step2') },
            { icon: Download, text: t('gate.inApp.step3') },
          ]}
        />
      ) : null}
      {inApp ? null : <p className="text-xs text-text-secondary">{t('gate.already')}</p>}
      {decision.canContinue ? (
        <Button variant="ghost" fullWidth onClick={onContinue}>
          {t('gate.continue')}
        </Button>
      ) : null}
    </Screen>
  );
}

export function InstallGate({
  enabled,
  brand,
  brandStyle,
  brandAttributes,
  linkReturn,
  children,
}: Props) {
  const pathname = usePathname();
  const [env, setEnv] = useState<GateEnv | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [showInstall, setShowInstall] = useState(false);

  // One read after mount: the device is unknown on the server and in the first client render.
  useEffect(() => {
    if (!enabled) return;
    setEnv({
      userAgent: window.navigator.userAgent,
      maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
      standalone: isStandalone(window as WindowLike),
    });
    setSkipped(readGateSkipped());
  }, [enabled]);

  // Precedence, evaluated in render and only once the device is known: not gated -> the app; a
  // link-return marker whose password form lives on this path -> the app (the one-time session is
  // in THIS browser); a marker elsewhere -> "abra o app" until the member says it is not installed;
  // otherwise the install screen, with the escape hatch only where the decision allows it.
  const decision: GateDecision = enabled && env ? decideInstallGate(env) : { gated: false };
  const markerScreen = decision.gated ? linkReturnScreen(linkReturn, pathname ?? '') : null;
  const showMarker = markerScreen === 'show' && !showInstall;
  const blocked =
    decision.gated && markerScreen !== 'pass' && (showMarker || !(decision.canContinue && skipped));

  useEffect(() => {
    if (!enabled || env === null) return;
    document.documentElement.dataset.installGate = blocked ? 'gated' : 'open';
  }, [enabled, env, blocked]);

  if (!blocked || !decision.gated) return <>{children}</>;

  if (showMarker && linkReturn) {
    return (
      <LinkReturnScreen
        marker={linkReturn}
        tenant={brand.displayName}
        brand={brand}
        brandStyle={brandStyle}
        brandAttributes={brandAttributes}
        onNotInstalled={() => setShowInstall(true)}
      />
    );
  }

  return (
    <InstallScreen
      decision={decision}
      tenant={brand.displayName}
      brand={brand}
      brandStyle={brandStyle}
      brandAttributes={brandAttributes}
      onContinue={() => {
        writeGateSkipped();
        setSkipped(true);
      }}
    />
  );
}
