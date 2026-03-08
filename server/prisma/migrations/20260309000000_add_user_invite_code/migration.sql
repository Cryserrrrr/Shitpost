-- AlterTable: add inviteCode column as nullable first
ALTER TABLE "User" ADD COLUMN "inviteCode" TEXT;

-- Populate existing rows with unique UUIDs
UPDATE "User" SET "inviteCode" = gen_random_uuid()::text WHERE "inviteCode" IS NULL;

-- Make it required and unique
ALTER TABLE "User" ALTER COLUMN "inviteCode" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "inviteCode" SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX "User_inviteCode_key" ON "User"("inviteCode");
