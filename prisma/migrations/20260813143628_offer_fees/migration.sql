/*
  Warnings:

  - The values [ACCEPTED] on the enum `OfferStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `accepted_at` on the `technician_offers` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OfferStatus_new" AS ENUM ('PENDING', 'SUBMITTED', 'DECLINED', 'SELECTED', 'NOT_SELECTED');
ALTER TABLE "public"."technician_offers" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "technician_offers" ALTER COLUMN "status" TYPE "OfferStatus_new" USING ("status"::text::"OfferStatus_new");
ALTER TYPE "OfferStatus" RENAME TO "OfferStatus_old";
ALTER TYPE "OfferStatus_new" RENAME TO "OfferStatus";
DROP TYPE "public"."OfferStatus_old";
ALTER TABLE "technician_offers" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "technician_offers" DROP COLUMN "accepted_at",
ADD COLUMN     "consultation_fee" DECIMAL(10,2),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6);
