-- CreateTable
CREATE TABLE "registration_invites" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "batch_id" TEXT,
    "registration_number" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registration_invites_tenant_id_email_idx" ON "registration_invites"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "registration_invites_token_hash_idx" ON "registration_invites"("token_hash");

-- AddForeignKey
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
