'use client';

import { PurchaseDialog } from '@rede-social/module-store/ui';
import { Button, useToast } from '@rede-social/ui';
import { ShoppingBag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { returnAfterSave } from '@/lib/form-exit';
import {
  type PurchaseConfirmView,
  type PurchaseSuccessView,
  purchaseReturnView,
  STORE_OWNED_BLOCK_ID,
  successView,
} from '@/lib/store-view';
import { purchaseProductAction } from '../actions';

/**
 * The product page's action zone for an active product the viewer does not hold (08.2-08,
 * UI-D-369/370/371, D-358, D-361): "Comprar" ("Obter" at R$ 0) opens the `PurchaseDialog`.
 *
 * **Confirm.** Disabled from the first tap (a ref guards the gap before React re-renders), then
 * `purchaseProductAction(productId, priceCents)` with the `priceCents` the page rendered next to the
 * price label (P26, STORE-08): the API compares it with the product row and never charges a number
 * the client sends. A second request that still arrives answers `owned`, the same success (P27).
 *
 * **Outcomes** (UI-D-371):
 *  - `ok` → when the page came from a locked community (`?comunidade=`) and the ANSWER lists that
 *    community, close, toast "Compra concluída. {community} está liberada." and go there (D-358).
 *    Otherwise, when it came from a locked course (`?curso=`) or live (`?live=`) and the ANSWER
 *    lists that course or live (08.5-12, UI-D-440, STORE-07), close, toast "Compra concluída.
 *    {course} está liberado." / "… {live} está liberada." and go to `/cursos/{id}` or
 *    `/cursos/lives/{id}`. Every href is built from the answered row, never from the URL
 *    (T-08.2-37, T-08.5-09): an id the answer does not list gets the normal success step (E14
 *    partial). An `owned` replay (a double tap that still reached the API) answers the same lists,
 *    so it steers exactly as a first purchase (EP-61). Otherwise the panel turns into its success
 *    step for every answered community, course and live (one, several or none).
 *  - `refused` (`unavailable` / `price_changed`) → close, toast, `router.refresh()`: the page then
 *    shows the archived rules or the new price, and nothing was bought.
 *  - `gone` → toast, `/loja`; `disabled` → toast, `/inicio`.
 *  - `error` (network, 5xx) → the inline alert line, the step kept, "Confirmar" re-enabled.
 *
 * **Focus** (UI-D-386): the dialog opens on "Confirmar" and returns focus to "Comprar" after a
 * cancel or a refusal (the shipped trap). Closing the success step refreshes the page, which
 * replaces this control with the owned block, and focus lands there once it renders.
 */
export function PurchaseControl({
  productId,
  priceCents,
  productName,
  confirm,
  fromCommunity,
  fromCourse,
  fromLive,
  timeZone,
}: {
  productId: string;
  /** The SAME value the page formatted into the price label (P26). */
  priceCents: number;
  productName: string;
  confirm: PurchaseConfirmView;
  /** The page's `?comunidade=` as given; it only steers when the answer lists that community. */
  fromCommunity?: string;
  /** The page's `?curso=` / `?live=` as given; each only steers when the answer lists it. */
  fromCourse?: string;
  fromLive?: string;
  /** The tenant's timezone: a live's meta in the success list (UI-D-440). */
  timeZone: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'confirm' | 'success'>('confirm');
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<PurchaseSuccessView | null>(null);
  const inFlight = useRef(false);

  const openDialog = () => {
    setStep('confirm');
    setErrorText(undefined);
    setSuccess(null);
    setOpen(true);
  };

  const onConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setErrorText(undefined);
    let result: Awaited<ReturnType<typeof purchaseProductAction>>;
    try {
      result = await purchaseProductAction(productId, priceCents);
    } catch (error) {
      // A thrown action (network, the redirect navigation already under way) keeps the step.
      console.error('store.purchase_failed', { error: String(error) });
      result = { status: 'error' };
    }
    inFlight.current = false;
    setPending(false);

    switch (result.status) {
      case 'ok': {
        const origin =
          fromCommunity !== undefined
            ? result.communities.find((community) => community.id === fromCommunity)
            : undefined;
        if (origin) {
          setOpen(false);
          const done = {
            tone: 'success',
            message: t('store.purchase.success.returned', { community: origin.name }),
          } as const;
          toast.show(done);
          // 2026-10-09: the community the purchase started from is usually the screen behind: step
          // back to it (refreshed, now open) instead of stacking a second copy whose "Voltar" would
          // reopen this product.
          const landing = `/comunidades/${encodeURIComponent(origin.id)}`;
          if (!returnAfterSave(router, landing, done)) router.push(landing);
          return;
        }
        const back = purchaseReturnView(result, { fromCourse, fromLive }, t);
        if (back) {
          setOpen(false);
          toast.show({ tone: 'success', message: back.toast });
          router.push(back.href);
          return;
        }
        setSuccess(successView({ name: productName }, result, t, timeZone));
        setStep('success');
        return;
      }
      case 'refused':
        setOpen(false);
        toast.show({
          tone: 'error',
          message:
            result.reason === 'price_changed'
              ? t('store.purchase.errors.priceChanged')
              : t('store.purchase.errors.unavailable'),
        });
        router.refresh();
        return;
      case 'gone':
        setOpen(false);
        toast.show({ tone: 'error', message: t('store.purchase.errors.gone') });
        router.push('/loja');
        return;
      case 'disabled':
        setOpen(false);
        toast.show({ tone: 'error', message: t('store.purchase.errors.disabled') });
        router.push('/inicio');
        return;
      default:
        setErrorText(t('store.purchase.errors.generic'));
    }
  };

  const onClose = () => {
    if (pending) return;
    setOpen(false);
    if (step === 'success') {
      router.refresh();
      focusWhenRendered(STORE_OWNED_BLOCK_ID);
    }
  };

  return (
    <>
      <Button variant="brand" size="md" fullWidth data-store-buy onClick={openDialog}>
        <ShoppingBag aria-hidden size={18} className="shrink-0" />
        {confirm.buyLabel}
      </Button>
      <PurchaseDialog
        open={open}
        step={step}
        pending={pending}
        errorText={errorText}
        confirm={confirm}
        success={{
          title: success?.title ?? '',
          body: success?.body ?? '',
          closeLabel: success?.closeLabel ?? '',
          primary: success?.primary ?? undefined,
          items:
            success?.variant === 'several'
              ? success.items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  href: item.href,
                  kind: item.kind,
                  thumb: { assetId: item.coverAssetId, ratio: item.thumbRatio },
                  ...(item.meta === null ? {} : { meta: item.meta }),
                }))
              : undefined,
        }}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </>
  );
}

/**
 * Focuses the element `id` as soon as it is in the document (the refresh lands after this control
 * has unmounted, so no effect of ours can do it). Gives up after a few seconds: a refresh that never
 * renders the block (the product went away meanwhile) leaves the focus where the trap put it.
 */
function focusWhenRendered(id: string, timeoutMs = 5000): void {
  const tryFocus = () => {
    const target = document.getElementById(id);
    if (!target) return false;
    target.focus({ preventScroll: false });
    return true;
  };
  if (tryFocus()) return;
  const observer = new MutationObserver(() => {
    if (tryFocus()) {
      observer.disconnect();
      window.clearTimeout(timer);
    }
  });
  const timer = window.setTimeout(() => observer.disconnect(), timeoutMs);
  observer.observe(document.body, { childList: true, subtree: true });
}
