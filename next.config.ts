import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function buildCommit() {
  const configured = process.env.APP_COMMIT_SHA || process.env.GITHUB_SHA;
  if (configured) {
    if (!/^[a-f0-9]{40,64}$/i.test(configured)) throw new Error("Invalid APP_COMMIT_SHA");
    return configured.toLowerCase();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_COMMIT: buildCommit() },
};

export default config;
