import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output bundles only the runtime deps we actually use into
  // .next/standalone — keeps the production Docker image ~50 MB instead
  // of ~500 MB, and removes the need to copy node_modules at runtime.
  output: "standalone",
  // typedRoutes requires a fresh build before each typecheck; off until we
  // wire that ordering through CI.
  transpilePackages: [
    "@outreach/config",
    "@outreach/db",
    "@outreach/discovery",
    "@outreach/geocoding",
    "@outreach/places",
    "@outreach/sequencer",
    "@outreach/templates",
    "@outreach/mailer",
  ],
  webpack: (config) => {
    // Workspace packages use NodeNext-style ".js" suffixes on relative
    // imports of TypeScript source. Teach webpack to also try ".ts" when
    // resolving those.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default config;
