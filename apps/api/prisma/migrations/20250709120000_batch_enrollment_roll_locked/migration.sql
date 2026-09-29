-- Align DB with Prisma/FastAPI: manual roll numbers stay fixed when set.
ALTER TABLE "batch_enrollments"
ADD COLUMN IF NOT EXISTS "roll_locked" BOOLEAN NOT NULL DEFAULT false;
