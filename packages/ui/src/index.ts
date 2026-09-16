/**
 * @tria/ui — shared primitives ported from the design prototype (UI-01).
 *
 * Client-safe barrel: no server code, no `@tria/contracts` (its root pulls node:fs). Components take
 * every string and aria label as props and every colour from the token file, so nothing here can leak
 * a tenant's brand or language into another context.
 */
export { cn } from './cn';

export { Badge, type BadgeProps } from './primitives/Badge';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './primitives/Button';
export { Card, type CardProps } from './primitives/Card';
export { Chip, type ChipProps } from './primitives/Chip';
export { IconButton, type IconButtonProps } from './primitives/IconButton';
export { Input, type InputProps } from './primitives/Input';
export { SectionTitle, type SectionTitleProps } from './primitives/SectionTitle';
export { StatusPill, type StatusPillProps, type StatusTone } from './primitives/StatusPill';
