import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/**/export": ["node_modules/katex/dist/**/*", "assets/fonts/nsimsun.ttf"],
  },
};

export default config;
