import { StoreBrowseScreen } from '../StoreBrowseScreen';

/**
 * `/loja/comprados` (2026-10-24, the Loja area): "Comprados", the "· Loja" menu's second screen, what
 * the viewer holds (D-352: every product they hold an active entitlement to, archived ones included,
 * newest entitlement first). The old `/loja?filtro=comprados` chip, now a page of its own; the same
 * screen for every role (`StoreBrowseScreen`). A static segment, so it wins over `[productId]`. The
 * module gate lives in `layout.tsx`.
 */
export default function StoreOwnedPage() {
  return <StoreBrowseScreen screen="comprados" />;
}
