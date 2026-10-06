import { redirect } from 'next/navigation';

/** The wizard root after creation IS its one remaining step: `/plataforma/novo/{id}` → `/convite`. */
export default async function NewTenantStepsRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/plataforma/novo/${encodeURIComponent(id)}/convite`);
}
