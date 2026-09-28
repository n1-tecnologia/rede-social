'use client';

import { Button, Card, Input, useToast } from '@rede-social/ui';
import { Globe } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { AttachDomainState } from '@/app/(platform)/plataforma/tenants/[id]/dominios/actions';

export interface AttachDomainFormLabels {
  label: string;
  placeholder: string;
  submit: string;
  pending: string;
  errors: { invalid: string; taken: string; platformHost: string; generic: string };
  added: string;
}

export interface AttachDomainFormProps {
  /** `attachDomainAction` already bound to the tenant id. */
  action: (prev: AttachDomainState, formData: FormData) => Promise<AttachDomainState>;
  labels: AttachDomainFormLabels;
}

function SubmitButton({ submit, pending }: { submit: string; pending: string }) {
  const status = useFormStatus();
  return (
    <Button
      type="submit"
      variant="brand"
      loading={status.pending}
      className="w-full md:w-auto md:shrink-0"
    >
      {status.pending ? pending : submit}
    </Button>
  );
}

/**
 * The always-visible attach form of the Domínios tab (D-34, mockup `tenant-page-dominios`): one
 * `Input` (`id=host`, Globe icon) and the single brand CTA, on `useActionState`. Validation happens
 * on submit — the action runs the API's own `attachDomainBodySchema` first and maps the API's
 * refusals to the three field errors; the typed value is kept on every error (E16/error). Success
 * toasts "Domínio adicionado." and clears the field; the new card appears because the action
 * revalidated the tenant layout.
 */
export function AttachDomainForm({ action, labels }: AttachDomainFormProps) {
  const toast = useToast();
  const [state, formAction] = useActionState(action, {} as AttachDomainState);
  // Controlled so React 19's automatic form reset never drops the typed value on an error.
  const [host, setHost] = useState('');

  useEffect(() => {
    if (state.nonce) {
      setHost('');
      toast.show({ tone: 'success', message: labels.added });
    } else if (state.value !== undefined) {
      setHost(state.value);
    }
  }, [state, toast, labels.added]);

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-6">
      {state.error === 'generic' ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {labels.errors.generic}
        </div>
      ) : null}
      <form
        action={formAction}
        className="flex flex-col gap-3 md:flex-row md:items-start"
        noValidate
      >
        <Input
          id="host"
          name="host"
          icon={Globe}
          label={labels.label}
          placeholder={labels.placeholder}
          maxLength={253}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          error={state.fieldError ? labels.errors[state.fieldError] : undefined}
          containerClassName="min-w-0 md:flex-1"
        />
        <div className="md:pt-7">
          <SubmitButton submit={labels.submit} pending={labels.pending} />
        </div>
      </form>
    </Card>
  );
}
