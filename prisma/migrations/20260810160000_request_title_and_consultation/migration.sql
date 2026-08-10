-- AlterEnum
-- A rename, not a new value. `ALTER TYPE ... RENAME VALUE` keeps every existing
-- row pointing at the same label; the diff Prisma generates for this change
-- rebuilds the enum and casts through text, which fails outright on any row
-- still holding 'HOME_VISIT'.
ALTER TYPE "RequestType" RENAME VALUE 'HOME_VISIT' TO 'CONSULTATION';

-- AlterTable
-- Added with a default so rows that already exist get a value, then the default
-- is dropped so the column ends up matching the schema: required, no default.
-- New rows have to say what the problem is.
ALTER TABLE "service_requests" ADD COLUMN "title" VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE "service_requests" ALTER COLUMN "title" DROP DEFAULT;
