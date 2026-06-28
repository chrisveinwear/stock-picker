/**
 * Loads .env.local (and friends) for standalone scripts run via tsx.
 *
 * Next.js auto-loads these files for the app and API routes, but scripts like
 * scripts/refresh-due.ts run outside Next and would otherwise miss
 * FIRECRAWL_API_KEY / ANTHROPIC_API_KEY. Import this FIRST, before any module
 * that reads those vars, e.g.:  import "@/lib/load-env";
 */
import { loadEnvConfig } from "@next/env";

// cwd is web/ when scripts run from there (per the launchd plist + docs).
loadEnvConfig(process.cwd(), /* dev */ true);
