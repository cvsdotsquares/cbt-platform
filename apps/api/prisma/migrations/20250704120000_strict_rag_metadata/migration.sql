-- Extend material types
ALTER TYPE "MaterialType" ADD VALUE IF NOT EXISTS 'WORKSHEET';
ALTER TYPE "MaterialType" ADD VALUE IF NOT EXISTS 'TEACHER_NOTES';

-- Study material metadata (upload-linked knowledge base)
ALTER TABLE "study_materials" ADD COLUMN IF NOT EXISTS "academic_class_id" TEXT;
ALTER TABLE "study_materials" ADD COLUMN IF NOT EXISTS "subject_id" TEXT;
ALTER TABLE "study_materials" ADD COLUMN IF NOT EXISTS "academic_session" TEXT NOT NULL DEFAULT '2025-26';
ALTER TABLE "study_materials" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "study_materials" ADD COLUMN IF NOT EXISTS "uploaded_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "study_materials_tenant_id_academic_class_id_subject_id_idx"
  ON "study_materials"("tenant_id", "academic_class_id", "subject_id");
CREATE INDEX IF NOT EXISTS "study_materials_chapter_id_idx" ON "study_materials"("chapter_id");

ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_academic_class_id_fkey"
  FOREIGN KEY ("academic_class_id") REFERENCES "academic_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Source traceability on generated questions
ALTER TABLE "generated_question_records" ADD COLUMN IF NOT EXISTS "source_material_ids" JSONB;
ALTER TABLE "generated_question_records" ADD COLUMN IF NOT EXISTS "source_chapter_id" TEXT;
ALTER TABLE "generated_question_records" ADD COLUMN IF NOT EXISTS "source_topic_id" TEXT;
ALTER TABLE "generated_question_records" ADD COLUMN IF NOT EXISTS "confidence_score" DOUBLE PRECISION;
