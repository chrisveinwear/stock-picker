import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Disabled: Turbopack's persistent dev cache (.next/dev) has no size cap
    // and grew to 870MB, causing a runaway rebuild loop that pegged CPU.
    // See scripts/trim-dev-cache.sh for the belt-and-suspenders cleanup job.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
