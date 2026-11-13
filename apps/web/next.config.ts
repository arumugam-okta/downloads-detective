import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OAP builds Next apps from source and needs the standalone server output.
  output: "standalone",
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@dd/shared", "@dd/db"],
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
