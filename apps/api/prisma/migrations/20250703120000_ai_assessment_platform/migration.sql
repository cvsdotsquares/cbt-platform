-- AI Assessment Platform: curriculum, batches, RAG, learning analytics

-- AlterEnum: QuestionType
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'ASSERTION_REASON';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'FILL_BLANK';

-- AlterEnum: ExamType
ALTER TYPE "ExamType" ADD VALUE IF NOT EXISTS 'PRACTICE';
ALTER TYPE "ExamType" ADD VALUE IF NOT EXISTS 'AI_ASSESSMENT';

-- CreateEnum
CREATE TYPE "SyllabusProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "MaterialType" AS ENUM ('NCERT', 'INSTITUTE_NOTES', 'QUESTION_BANK');
CREATE TYPE "MaterialStatus" AS ENUM ('PENDING', 'INDEXING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "syllabus_topic_id" TEXT;

-- CreateTable
CREATE TABLE "academic_classes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "academic_classes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "academic_class_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "books" (
    "id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL DEFAULT 'NCERT',
    "is_ncert" BOOLEAN NOT NULL DEFAULT true,
    "edition" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "syllabus_topics" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "syllabus_topics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sub_topics" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sub_topics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "academic_class_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academic_year" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "batch_enrollments" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "roll_number" TEXT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batch_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teacher_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "syllabus_progress" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "chapter_id" TEXT,
    "topic_id" TEXT,
    "status" "SyllabusProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completed_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "syllabus_progress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_materials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "book_id" TEXT,
    "chapter_id" TEXT,
    "topic_id" TEXT,
    "type" "MaterialType" NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "status" "MaterialStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "study_materials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page_number" INTEGER,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "embedding" JSONB,
    "academic_class_id" TEXT,
    "subject_id" TEXT,
    "chapter_id" TEXT,
    "topic_id" TEXT,
    "sub_topic_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_test_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "subject_id" TEXT,
    "title" TEXT NOT NULL,
    "chapter_ids" JSONB NOT NULL,
    "topic_ids" JSONB,
    "question_count" INTEGER NOT NULL DEFAULT 10,
    "difficulty_mix" JSONB,
    "question_types" JSONB NOT NULL,
    "syllabus_scope" TEXT NOT NULL DEFAULT 'COMPLETED_ONLY',
    "exam_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_test_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "generated_question_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "question_hash" TEXT NOT NULL,
    "question_id" TEXT,
    "source_chunk_ids" JSONB NOT NULL,
    "batch_id" TEXT,
    "candidate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "generated_question_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "topic_masteries" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "topic_masteries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "weak_area_recommendations" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "weak_area_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_classes_tenant_id_level_key" ON "academic_classes"("tenant_id", "level");
CREATE UNIQUE INDEX "subjects_academic_class_id_code_key" ON "subjects"("academic_class_id", "code");
CREATE UNIQUE INDEX "chapters_book_id_number_key" ON "chapters"("book_id", "number");
CREATE UNIQUE INDEX "batches_tenant_id_name_academic_year_key" ON "batches"("tenant_id", "name", "academic_year");
CREATE UNIQUE INDEX "batch_enrollments_batch_id_candidate_id_key" ON "batch_enrollments"("batch_id", "candidate_id");
CREATE UNIQUE INDEX "teacher_assignments_user_id_batch_id_subject_id_key" ON "teacher_assignments"("user_id", "batch_id", "subject_id");
CREATE UNIQUE INDEX "syllabus_progress_batch_id_chapter_id_topic_id_key" ON "syllabus_progress"("batch_id", "chapter_id", "topic_id");
CREATE UNIQUE INDEX "ai_test_configs_exam_id_key" ON "ai_test_configs"("exam_id");
CREATE UNIQUE INDEX "topic_masteries_candidate_id_topic_id_key" ON "topic_masteries"("candidate_id", "topic_id");
CREATE INDEX "questions_syllabus_topic_id_idx" ON "questions"("syllabus_topic_id");
CREATE INDEX "batches_tenant_id_is_active_idx" ON "batches"("tenant_id", "is_active");
CREATE INDEX "syllabus_progress_batch_id_status_idx" ON "syllabus_progress"("batch_id", "status");
CREATE INDEX "study_materials_tenant_id_status_idx" ON "study_materials"("tenant_id", "status");
CREATE INDEX "document_chunks_material_id_chunk_index_idx" ON "document_chunks"("material_id", "chunk_index");
CREATE INDEX "document_chunks_chapter_id_idx" ON "document_chunks"("chapter_id");
CREATE INDEX "document_chunks_topic_id_idx" ON "document_chunks"("topic_id");
CREATE INDEX "ai_test_configs_tenant_id_idx" ON "ai_test_configs"("tenant_id");
CREATE INDEX "generated_question_records_tenant_id_question_hash_idx" ON "generated_question_records"("tenant_id", "question_hash");
CREATE INDEX "generated_question_records_batch_id_candidate_id_idx" ON "generated_question_records"("batch_id", "candidate_id");
CREATE INDEX "topic_masteries_candidate_id_subject_id_idx" ON "topic_masteries"("candidate_id", "subject_id");
CREATE INDEX "weak_area_recommendations_candidate_id_is_resolved_idx" ON "weak_area_recommendations"("candidate_id", "is_resolved");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_syllabus_topic_id_fkey" FOREIGN KEY ("syllabus_topic_id") REFERENCES "syllabus_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "academic_classes" ADD CONSTRAINT "academic_classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_academic_class_id_fkey" FOREIGN KEY ("academic_class_id") REFERENCES "academic_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "books" ADD CONSTRAINT "books_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_topics" ADD CONSTRAINT "sub_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_academic_class_id_fkey" FOREIGN KEY ("academic_class_id") REFERENCES "academic_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_enrollments" ADD CONSTRAINT "batch_enrollments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batch_enrollments" ADD CONSTRAINT "batch_enrollments_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "syllabus_progress" ADD CONSTRAINT "syllabus_progress_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "syllabus_progress" ADD CONSTRAINT "syllabus_progress_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "syllabus_progress" ADD CONSTRAINT "syllabus_progress_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "study_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_sub_topic_id_fkey" FOREIGN KEY ("sub_topic_id") REFERENCES "sub_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_test_configs" ADD CONSTRAINT "ai_test_configs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "topic_masteries" ADD CONSTRAINT "topic_masteries_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "topic_masteries" ADD CONSTRAINT "topic_masteries_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "topic_masteries" ADD CONSTRAINT "topic_masteries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weak_area_recommendations" ADD CONSTRAINT "weak_area_recommendations_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weak_area_recommendations" ADD CONSTRAINT "weak_area_recommendations_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
