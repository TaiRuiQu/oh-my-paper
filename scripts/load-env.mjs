import { config } from "dotenv";
import { resolve } from "node:path";

// Match Next.js precedence; externally supplied environment values always win.
export function loadEnvironment() {
  const mode = process.env.NODE_ENV ?? "development";
  const files = [
    `.env.${mode}.local`,
    ...(mode === "test" ? [] : [".env.local"]),
    `.env.${mode}`,
    ".env",
  ];
  config({ path: files.map((file) => resolve(process.cwd(), file)), quiet: true });
}
