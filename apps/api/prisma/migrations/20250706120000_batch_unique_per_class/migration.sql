-- Allow the same batch name per academic year when classes differ
DROP INDEX "batches_tenant_id_name_academic_year_key";
CREATE UNIQUE INDEX "batches_tenant_id_name_academic_year_academic_class_id_key" ON "batches"("tenant_id", "name", "academic_year", "academic_class_id");
