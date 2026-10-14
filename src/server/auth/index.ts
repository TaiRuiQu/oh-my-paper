import "server-only";
import { logError } from "@/server/logger";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "Oh My Paper",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    database: prismaAdapter(getDb(), { provider: "postgresql", transaction: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    plugins: [
      username({
        displayUsername: false,
        minUsernameLength: 1,
        maxUsernameLength: 254,
        immutableUsername: true,
        usernameValidator: (value) => /^[a-zA-Z0-9_.@+\-]+$/.test(value),
      }),
    ],
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "STUDENT", input: false },
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
