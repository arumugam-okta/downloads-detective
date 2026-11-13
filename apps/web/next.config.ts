import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // OAP builds Next apps from source and needs the standalone server output.
  output: "standalone",
  // Trace from the monorepo root so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@dd/shared", "@dd/db", "@dd/core"],
  // Slack's SDK is loaded at runtime, not bundled.
  serverExternalPackages: ["@slack/bolt", "@slack/web-api"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
