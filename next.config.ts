import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["puppeteer-core", "mathml2omml"],
  outputFileTracingIncludes: {
    "/api/**/export": [
      "node_modules/katex/dist/**/*",
      "assets/fonts/nsimsun.ttf",
      // Trace notices in pnpm's real package directory so its top-level symlink stays intact.
      "node_modules/.pnpm/mathml2omml@*/node_modules/mathml2omml/LICENSE",
      "node_modules/.pnpm/mathml2omml@*/node_modules/mathml2omml/README.md",
    ],
  },
};

export default config;
