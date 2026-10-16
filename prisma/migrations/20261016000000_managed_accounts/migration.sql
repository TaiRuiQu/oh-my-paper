ALTER TABLE "users" ADD COLUMN "username" TEXT;
-- Existing credentials continue to work using the former email as the account name.
-- Include the id only for case-insensitive collisions between legacy email addresses.
WITH existing AS (
  SELECT "id", lower("email") AS login,
         row_number() OVER (PARTITION BY lower("email") ORDER BY "createdAt", "id") AS position
  FROM "users"
)
UPDATE "users" AS u SET "username" =
  CASE WHEN e.position = 1 THEN e.login ELSE e.login || '.' || e."id" END
FROM existing AS e WHERE u."id" = e."id";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
