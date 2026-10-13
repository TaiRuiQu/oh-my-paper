import "server-only";
import { logError, logEvent } from "@/server/logger";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";

/**
 * The first account to register owns the deployment: without an ADMIN nobody can
 * reach /admin/ai to add the providers and public models every task depends on,
 * and there is no in-app way to grant the role. Deployments that already have an
 * account keep their current roles.
 */
export async function roleForNewAccount(): Promise<"ADMIN" | "USER"> {
  return (await getDb().user.count()) === 0 ? "ADMIN" : "USER";
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "Oh My Paper",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    database: prismaAdapter(getDb(), { provider: "postgresql", transaction: true }),
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "USER", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Runs before the insert, so the first account is stored as ADMIN
          // rather than promoted afterwards.
          before: async (user) => {
            const role = await roleForNewAccount();
            if (role === "USER") return;
            logEvent("auth.first_account.promoted");
            return { data: { ...user, role } };
          },
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true },
    onAPIError: {
      onError: (error) => {
        logError("auth.api.failed", error);
      },
    },
    logger: {
      level: "warn",
      log: (level, message, ...args) => {
        if (level === "warn" || level === "error")
          logError(
            "auth.internal.failed",
            args.find((arg) => arg instanceof Error) ?? new Error(message),
            {},
            { level },
          );
      },
    },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  instance ??= createAuth();
  return instance;
}
