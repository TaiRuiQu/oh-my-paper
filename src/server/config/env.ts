import "server-only";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url().refine((url) => /^(postgres|postgresql):/.test(url)),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32).refine((value) => !value.startsWith("REPLACE_")),
  STORAGE_ROOT: z.string().min(1).default("./storage"),
  TEMP_ROOT: z.string().min(1).default("./tmp"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

let cached: z.infer<typeof schema> | undefined;

export function getEnv() {
  if (!cached) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      // Zod issues can contain input values; only expose variable names.
      const keys = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
      throw new Error(`Invalid environment variables: ${keys.join(", ")}`);
    }
    cached = result.data;
  }
  return cached;
}

export function getStoragePaths() {
  const env = getEnv();
  return { storage: resolve(process.cwd(), env.STORAGE_ROOT), temp: resolve(process.cwd(), env.TEMP_ROOT) };
}
