-- Replace long UUIDs with short 8-char hex codes for existing users
UPDATE "User" SET "inviteCode" = UPPER(SUBSTR(MD5(RANDOM()::text), 1, 8));

-- Update default for new users
ALTER TABLE "User" ALTER COLUMN "inviteCode" SET DEFAULT UPPER(SUBSTR(MD5(RANDOM()::text), 1, 8));
