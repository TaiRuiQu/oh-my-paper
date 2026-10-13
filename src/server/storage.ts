import "server-only";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { getStoragePaths } from "@/server/config/env";

export async function initializeStorage() {
  const paths = getStoragePaths();
  for (const directory of Object.values(paths)) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await access(directory, constants.R_OK | constants.W_OK);
  }
  return paths;
}
