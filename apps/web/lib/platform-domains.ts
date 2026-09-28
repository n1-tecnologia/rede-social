import type { TenantDomain } from '@rede-social/contracts';
import type { DnsRecordView } from '@/components/platform/DnsRecordsTable';
import type {
  DomainActionError,
  DomainCardView,
  DomainStatus,
} from '@/components/platform/DomainCard';
import type { ApiClientError } from '@/lib/bootstrap';
import { formatPanelDate } from '@/lib/platform';

/**
 * Server-only helpers of the Domínios tab (TENANT-07 UI half, D-34/D-35): the contract row →
 * card view mapping (dates formatted here, the lifecycle rules decided here) and the envelope →
 * catalog-key mapping the server actions answer with. Client components never see a contract
 * object — only these plain views.
 */

/** Every catalog key under `platformDomains.errors` a domain action can answer with. */
export const DOMAIN_ACTION_ERRORS = [
  'expired',
  'notExpired',
  'notVerified',
  'removePrimary',
  'notFound',
  'generic',
] as const satisfies readonly DomainActionError[];

/** Status pill tone: pending → warning, verified → success, expired / failed → danger. */
export function domainStatusTone(status: DomainStatus): 'warning' | 'success' | 'danger' {
  if (status === 'verified') return 'success';
  if (status === 'pending') return 'warning';
  return 'danger';
}

/** Defensive de-duplication by `type + name` (the API already dedupes); provider order kept. */
function dedupeRecords(records: TenantDomain['dnsRecords']): DnsRecordView[] {
  const seen = new Set<string>();
  const out: DnsRecordView[] = [];
  for (const record of records) {
    const key = `${record.type}|${record.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: record.type,
      name: record.name,
      value: record.value,
      purpose: record.purpose,
    });
  }
  return out;
}

/**
 * The card view of one host. `total` is the tenant's host count: the primary cannot be removed
 * while other hosts exist (D-35). A verified host with a `lastError` still offers "Verificar agora"
 * because 02-09's check on a verified host only re-runs the idempotent allow-list add and the
 * claim-before-send invites — recoverable from the panel.
 */
export function toDomainCardView(domain: TenantDomain, total: number): DomainCardView {
  const status = domain.verificationStatus;
  return {
    id: domain.id,
    host: domain.host,
    isPrimary: domain.isPrimary,
    status,
    records: dedupeRecords(domain.dnsRecords),
    lastCheckedLabel: domain.lastCheckedAt
      ? formatPanelDate(domain.lastCheckedAt, 'dateTime')
      : null,
    lastError: domain.lastError,
    canRemove: !(domain.isPrimary && total > 1),
    canSetPrimary: status === 'verified' && !domain.isPrimary,
    showVerify:
      status === 'pending' ||
      status === 'failed' ||
      (status === 'verified' && domain.lastError !== null),
    showRestart: status === 'expired',
  };
}

/**
 * D-09 envelope → the catalog key the card toasts. 404 / `NOT_FOUND` → `notFound`;
 * 409 `DOMAIN_STATE_INVALID` switches on `details.reason` (`DOMAIN_STATE_REASONS`); anything else
 * is the generic error. Never carries API copy through.
 */
export function mapDomainActionError(error: ApiClientError): DomainActionError {
  if (error.status === 404 || error.code === 'NOT_FOUND') return 'notFound';
  if (error.code === 'DOMAIN_STATE_INVALID') {
    switch (error.details?.reason) {
      case 'expired':
        return 'expired';
      case 'not_expired':
        return 'notExpired';
      case 'not_verified':
        return 'notVerified';
      case 'primary_with_aliases':
        return 'removePrimary';
      default:
        return 'generic';
    }
  }
  return 'generic';
}
