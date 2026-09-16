import { customType } from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text (extension created by the `app_helpers` migration). Shared by every column
 * that must compare case-insensitively: hosts (`tenant_domains.host`) and e-mail addresses
 * (`tenant_invites.email`), so `Admin@Cliente.com.br` and `admin@cliente.com.br` are one value.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});
