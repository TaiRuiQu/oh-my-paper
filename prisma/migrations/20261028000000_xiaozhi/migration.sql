CREATE TABLE "xiaozhi_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "view" JSONB NOT NULL DEFAULT '{}',
    "modelId" TEXT,
    "skillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "workerId" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "encryptedCookie" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "xiaozhi_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "xiaozhi_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "xiaozhi_conversations_userId_updatedAt_idx" ON "xiaozhi_conversations"("userId", "updatedAt");
CREATE INDEX "xiaozhi_conversations_status_heartbeatAt_idx" ON "xiaozhi_conversations"("status", "heartbeatAt");
CREATE TABLE "xiaozhi_inputs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'followUp',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xiaozhi_inputs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "xiaozhi_inputs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "xiaozhi_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "xiaozhi_inputs_conversationId_createdAt_idx" ON "xiaozhi_inputs"("conversationId", "createdAt");
CREATE TABLE "xiaozhi_skills" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "xiaozhi_skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "xiaozhi_skills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "xiaozhi_skills_userId_idx" ON "xiaozhi_skills"("userId");

CREATE FUNCTION notify_xiaozhi_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('omp_xiaozhi', json_build_object('schema', current_schema(), 'userId', NEW."userId", 'id', NEW.id)::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER xiaozhi_change AFTER INSERT OR UPDATE OF view, status, title, "modelId", "skillIds", error ON xiaozhi_conversations
FOR EACH ROW EXECUTE FUNCTION notify_xiaozhi_change();
