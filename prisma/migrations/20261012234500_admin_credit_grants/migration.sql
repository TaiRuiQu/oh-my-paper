CREATE TABLE "credit_grants" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "adminId" TEXT NOT NULL,
  "amount" DECIMAL(24,8) NOT NULL CHECK ("amount" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "credit_grants_userId_createdAt_idx" ON "credit_grants"("userId", "createdAt");
