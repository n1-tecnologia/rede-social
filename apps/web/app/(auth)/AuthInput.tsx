'use client';

import { Input, type InputProps } from '@rede-social/ui';
import { Lock, type LucideIcon, Mail, User } from 'lucide-react';

/**
 * `@rede-social/ui` `Input` for the server-rendered public forms. A lucide icon is a `forwardRef` object,
 * which React Flight refuses to serialise from a Server Component into the client `Input`, so the
 * pages name the icon and this client boundary resolves it — same geometry, same tokens.
 */
const ICONS = { mail: Mail, lock: Lock, user: User } satisfies Record<string, LucideIcon>;

export type AuthInputIcon = keyof typeof ICONS;

export function AuthInput({ icon, ...props }: Omit<InputProps, 'icon'> & { icon?: AuthInputIcon }) {
  return <Input icon={icon ? ICONS[icon] : undefined} {...props} />;
}
