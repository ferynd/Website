import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No ISR/PPR pages currently ship on this site (all app pages are static-
// prerendered or fully dynamic API routes), so the default in-memory/no-op
// incremental cache is sufficient. Revisit with an R2-backed cache override
// if a page starts using `revalidate`.
export default defineCloudflareConfig();
