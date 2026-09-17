import { redirect } from 'next/navigation';

/** The tenant root IS the Marca tab (UI-SPEC tenant page): `/plataforma/tenants/{id}` → `/marca`. */
export default async function TenantRootPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/plataforma/tenants/${encodeURIComponent(id)}/marca`);
}
