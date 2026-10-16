ALTER TABLE "users" ADD COLUMN "permissionsVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "teaching_permissions_events" (
  "id" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetName" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teaching_permissions_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teaching_permissions_events_targetId_version_key"
  ON "teaching_permissions_events"("targetId", "version");
CREATE INDEX "teaching_permissions_events_targetId_createdAt_id_idx"
  ON "teaching_permissions_events"("targetId", "createdAt" DESC, "id" DESC);
ALTER TABLE "teaching_permissions_events"
  ADD CONSTRAINT "teaching_permissions_events_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teaching_permissions_events"
  ADD CONSTRAINT "teaching_permissions_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
