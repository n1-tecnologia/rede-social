'use client';

import type { AccessProduct } from '@rede-social/module-payments/contracts';
import { BottomSheet, Button, ConfirmDialog, Input, useToast } from '@rede-social/ui';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import type { AccessProductView } from '@/lib/payments-view';
import {
  createAccessProductAction,
  type PaymentsFailureCode,
  removeAccessProductAction,
  updateAccessProductAction,
} from './actions';

export interface AccessProductSheetProps {
  open: boolean;
  /** The product being edited, or `null` for a new one. */
  product: AccessProductView | null;
  /** The adapter's display name, the `{gateway}` of the labels and of the "ID in use" line. */
  gatewayName: string;
  /**
   * The gate is on and this is the only product: removing it is refused (409 `last_access_product`,
   * D-491), so the sheet says so inline instead of opening the dialog.
   */
  removalBlocked: boolean;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** The server's answer after a create or an update; the HOST updates its list in place. */
  onSaved: (product: AccessProduct) => void;
  /** The product left the list (removed, or already gone). */
  onRemoved: (id: string) => void;
}

const NAME_ID = 'payments-product-name';
const ID_ID = 'payments-product-id';
const LINK_ID = 'payments-product-link';
const MAX_NAME = 80;

type FieldErrors = { name?: string; id?: string; link?: string };

/**
 * The new / edit sheet of an access product (09.1-13, UI-D-515, D-494, D-502): what the admin calls
 * it, the product's id at the gateway (the key a purchase is recognised by) and the optional checkout
 * link behind "Assinar" and "Regularizar".
 *
 * **The server decides.** A refusal comes back as a closed code and lands under its own field with
 * `role="alert"` (the id already held by another registration never names the other tenant); the next
 * edit of that field clears it. A failed save toasts and KEEPS the sheet open with what was typed. On
 * edit only the keys that changed are sent. Nothing is optimistic: the host's list changes from the
 * answer.
 *
 * The checkout link is a text field's value here and nothing more: it is never an `href` on this
 * screen (T-09.1-62). The sheet remounts per opening (the host keys it), so every opening starts from
 * the product as stored.
 */
export function AccessProductSheet({
  open,
  product,
  gatewayName,
  removalBlocked,
  onClose,
  onSaved,
  onRemoved,
}: AccessProductSheetProps) {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const editing = product !== null;

  const [name, setName] = useState(product?.name ?? '');
  const [externalId, setExternalId] = useState(product?.externalProductId ?? '');
  const [link, setLink] = useState(product?.checkoutUrl ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastProduct, setLastProduct] = useState(false);

  const gateway = { gateway: gatewayName };
  const trimmedLink = link.trim();
  const incomplete =
    name.trim() === '' ||
    externalId.trim() === '' ||
    (trimmedLink !== '' && !trimmedLink.startsWith('https://'));

  function clear(field: keyof FieldErrors) {
    setErrors((current) =>
      current[field] === undefined ? current : { ...current, [field]: undefined },
    );
  }

  function lostPermission() {
    toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
    router.refresh();
    onClose();
  }

  function refuse(code: PaymentsFailureCode) {
    switch (code) {
      case 'name_required':
        setErrors({ name: t('payments.errors.nameRequired') });
        return;
      case 'product_id_required':
        setErrors({ id: t('payments.errors.idRequired') });
        return;
      case 'gateway_product_taken':
        setErrors({ id: t('payments.errors.idTaken', gateway) });
        return;
      case 'link_invalid':
        setErrors({ link: t('payments.errors.linkInvalid') });
        return;
      case 'forbidden':
        lostPermission();
        return;
      default:
        toast.show({ tone: 'error', message: t('payments.errors.saveProduct') });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || incomplete) return;

    // On edit only what changed travels; nothing changed means nothing to ask the server.
    const patch: { name?: string; externalProductId?: string; checkoutUrl?: string } = {};
    if (product) {
      if (name.trim() !== product.name) patch.name = name;
      if (externalId.trim() !== product.externalProductId) patch.externalProductId = externalId;
      if (trimmedLink !== (product.checkoutUrl ?? '')) patch.checkoutUrl = link;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
    }

    setPending(true);
    let outcome: Awaited<ReturnType<typeof createAccessProductAction>> = {
      ok: false,
      code: 'generic',
    };
    try {
      outcome = product
        ? await updateAccessProductAction(product.id, patch)
        : await createAccessProductAction({
            name,
            externalProductId: externalId,
            checkoutUrl: link,
          });
    } catch {
      // A network failure reads like any other failed write: the sheet stays open.
    } finally {
      setPending(false);
    }

    if (!outcome.ok) {
      refuse(outcome.code);
      return;
    }
    toast.show({
      tone: 'success',
      message: product ? t('payments.toasts.productSaved') : t('payments.toasts.productAdded'),
    });
    onSaved(outcome.product);
  }

  function askRemove() {
    if (removalBlocked) {
      setLastProduct(true);
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmRemove() {
    if (!product) return;
    let outcome: Awaited<ReturnType<typeof removeAccessProductAction>> = {
      ok: false,
      code: 'generic',
    };
    try {
      outcome = await removeAccessProductAction(product.id);
    } catch {
      // Falls through to the generic failure toast.
    }
    if (outcome.ok) {
      toast.show({ tone: 'success', message: t('payments.toasts.productRemoved') });
      onRemoved(outcome.id);
      return;
    }
    if (outcome.code === 'last_access_product') {
      setLastProduct(true);
      return;
    }
    if (outcome.code === 'forbidden') {
      lostPermission();
      return;
    }
    toast.show({ tone: 'error', message: t('payments.errors.generic') });
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={
          editing
            ? t('payments.products.sheet.editTitle')
            : t('payments.products.sheet.createTitle')
        }
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Input
              id={NAME_ID}
              label={t('payments.products.sheet.nameLabel')}
              placeholder={t('payments.products.sheet.namePlaceholder')}
              maxLength={MAX_NAME}
              value={name}
              error={errors.name}
              onChange={(event) => {
                setName(event.target.value);
                clear('name');
              }}
            />
            <p className="text-xs font-normal text-text-tertiary">
              {t('payments.products.sheet.nameHelper')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              id={ID_ID}
              label={t('payments.products.sheet.idLabel', gateway)}
              className="tabular-nums"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={externalId}
              error={errors.id}
              onChange={(event) => {
                setExternalId(event.target.value);
                clear('id');
              }}
            />
            <p className="text-xs font-normal text-text-tertiary">
              {t('payments.products.sheet.idHelper', gateway)}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              id={LINK_ID}
              type="url"
              label={t('payments.products.sheet.linkLabel')}
              placeholder={t('payments.products.sheet.linkPlaceholder')}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={link}
              error={errors.link}
              onChange={(event) => {
                setLink(event.target.value);
                clear('link');
              }}
            />
            <p className="text-xs font-normal text-text-tertiary">
              {t('payments.products.sheet.linkHelper')}
            </p>
          </div>

          {lastProduct ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-3 text-xs font-normal text-text"
            >
              <CircleAlert aria-hidden size={16} className="shrink-0 text-danger" />
              <span className="min-w-0 flex-1">{t('payments.errors.lastProduct')}</span>
            </div>
          ) : null}

          <Button type="submit" fullWidth loading={pending} disabled={incomplete}>
            {editing ? t('payments.products.sheet.save') : t('payments.products.sheet.create')}
          </Button>
          {editing ? (
            <Button
              variant="ghost"
              fullWidth
              className="text-danger"
              disabled={pending}
              onClick={askRemove}
            >
              {t('payments.products.sheet.remove')}
            </Button>
          ) : null}
        </form>
      </BottomSheet>

      {/* Beside the sheet, never inside it: a `fixed` dialog inside the sheet's transformed panel
          would be positioned against the panel instead of the screen. */}
      {product ? (
        <ConfirmDialog
          open={confirmOpen}
          tone="danger"
          icon={Trash2}
          title={t('payments.products.removeDialog.title', { name: product.name })}
          body={t('payments.products.removeDialog.body')}
          confirmLabel={t('payments.products.removeDialog.confirm')}
          cancelLabel={t('payments.products.removeDialog.cancel')}
          onConfirm={confirmRemove}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}
