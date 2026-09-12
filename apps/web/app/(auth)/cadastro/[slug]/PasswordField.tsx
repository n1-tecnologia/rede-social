'use client';

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

/**
 * Password input with a show/hide toggle instead of a confirm field (D-02) and the simple strength
 * indicator of D-10. The hint is computed locally: nothing about the password ever leaves the form.
 */
export function PasswordField({
  id,
  name,
  labels,
}: {
  id: string;
  name: string;
  labels: PasswordFieldLabels;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);

  const tooShort = value.length > 0 && value.length < 8;
  const hint = strengthLabel(value, labels);

  return (
    <>
      <label htmlFor={id}>{labels.label}</label>
      <span style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={8}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" aria-pressed={visible} onClick={() => setVisible((on) => !on)}>
          {visible ? labels.hide : labels.show}
        </button>
      </span>
      {tooShort ? (
        <p style={{ color: 'crimson', margin: 0 }}>{labels.min}</p>
      ) : hint ? (
        <p style={{ margin: 0 }}>{hint}</p>
      ) : null}
    </>
  );
}

/** 8-11 -> weak; 12+ with letters and digits -> ok; 12+ with a symbol on top -> strong. */
function strengthLabel(value: string, labels: PasswordFieldLabels): string | null {
  if (value.length < 8) return null;
  const mixed = /[a-zA-Z]/.test(value) && /\d/.test(value);
  const symbol = /[^a-zA-Z0-9]/.test(value);
  if (value.length >= 12 && mixed && symbol) return labels.strong;
  if (value.length >= 12 && mixed) return labels.ok;
  return labels.weak;
}
