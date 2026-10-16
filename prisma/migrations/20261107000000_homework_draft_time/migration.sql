-- A teacher return/extension changes the work, not the time the student saved their draft.
ALTER TABLE "homework_works" ADD COLUMN "draftUpdatedAt" TIMESTAMP(3);
