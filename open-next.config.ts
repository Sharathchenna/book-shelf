import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * Nothing on the site revalidates at runtime (no "use cache", no ISR), so prerendered pages are
 * served straight from the worker's static assets. Switch to the R2 incremental cache if that changes.
 */
export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache });
