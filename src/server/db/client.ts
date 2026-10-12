import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";

const globalDb = globalThis as typeof globalThis & { paperDb?: PrismaClient };

export function getDb() {
  if (!globalDb.paperDb) {
    const adapter = new PrismaPg({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    globalDb.paperDb = new PrismaClient({ adapter, log: [] });
  }
  return globalDb.paperDb;
}

export async function connectDatabase(attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await getDb().$queryRaw`SELECT 1`;
      return;
    } catch {
      if (attempt === attempts)
        throw new Error("Database unavailable; check PostgreSQL and DATABASE_URL.");
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

export async function disconnectDatabase() {
  if (globalDb.paperDb) {
    await globalDb.paperDb.$disconnect();
    globalDb.paperDb = undefined;
  }
}
