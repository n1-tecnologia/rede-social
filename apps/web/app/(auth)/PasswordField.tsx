'use client';

import { IconButton, Input } from '@rede-social/ui';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useState } from 'react';

export type PasswordFieldLabels = {
  label: string;
  show: string;
  hide: string;
  /** Shown in red while the password is shorter than the minimum (D-10: 8 characters). */
  min: string;
  weak: string;
  ok: string;
  strong: string;
};

type Strength = 'weak' | 'ok' | 'strong';

/**
 * Password input with a show/hide toggle instead of a confirm field (D-02) and the simple strength
 * indicator of D-10, on `@rede-social/ui` `Input` + `IconButton` (UI-SPEC Auth Pages Contract): the eye is a
 * 44×44 control inside the field at `right-1`, `aria-pressed` while visible; the meter is three 4px
 * segments — neutral until typed, `danger` / `warning` / `success` as the password grows — with a
 * polite live hint. Everything is computed locally: nothing about the password ever leaves the form.
 * Shared by `/cadastro`, `/redefinir-senha` and `/aceitar-invite` (02-10).
 */
export function PasswordField({
  id,
  name,
  labels,
  autoComplete = 'new-password',
  error,
}: {
  id: string;
  name: string;
  labels: PasswordFieldLabels;
  autoComplete?: 'new-password' | 'current-password';
  /** Field-level error (Input error state); the strength hint yields to it. */
  error?: string;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);

  const tooShort = value.length > 0 && value.length < 8;
  const strength = strengthOf(value);
  const filled = strength === null ? 0 : strength === 'weak' ? 1 : strength === 'ok' ? 2 : 3;
  const segmentTone =
    strength === 'weak' ? 'bg-danger' : strength === 'ok' ? 'bg-warning' : 'bg-success';
  const hint = strength ? labels[strength] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={8}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          icon={Lock}
          placeholder={labels.label}
          aria-label={labels.label}
          className="pr-14"
          error={error}
        />
        {/* Top-anchored on the input box (not the error line) so the toggle never drifts. */}
        <IconButton
          type="button"
          icon={visible ? EyeOff : Eye}
          label={visible ? labels.hide : labels.show}
          aria-pressed={visible}
          size={20}
          onClick={() => setVisible((on) => !on)}
          className="absolute top-1 right-1 text-text-tertiary"
        />
      </div>

      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={`h-1 flex-1 rounded-full ${segment <= filled ? segmentTone : 'bg-bg-tertiary'}`}
          />
        ))}
      </div>
      <p
        aria-live="polite"
        className={`text-xs ${tooShort ? 'text-danger' : 'text-text-secondary'}`}
      >
        {tooShort ? labels.min : hint}
      </p>
    </div>
  );
}

/** 8-11 -> weak; 12+ with letters and digits -> ok; 12+ with a symbol on top -> strong. */
function strengthOf(value: string): Strength | null {
  if (value.length < 8) return null;
  const mixed = /[a-zA-Z]/.test(value) && /\d/.test(value);
  const symbol = /[^a-zA-Z0-9]/.test(value);
  if (value.length >= 12 && mixed && symbol) return 'strong';
  if (value.length >= 12 && mixed) return 'ok';
  return 'weak';
}
