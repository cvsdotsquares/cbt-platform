-- Persist whether upload is a full book or single chapter (chapter uploads may have null chapter_id until auto-detected)
ALTER TABLE "study_materials" ADD COLUMN "is_full_book" BOOLEAN NOT NULL DEFAULT true;

-- Existing rows with a linked chapter were single-chapter uploads
UPDATE "study_materials" SET "is_full_book" = false WHERE "chapter_id" IS NOT NULL;
