/*
  Warnings:

  - The values [HOME_VISIT] on the enum `RequestType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `ai_estimations` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `title` to the `service_requests` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "RequestType_new" AS ENUM ('AI_ESTIMATION', 'CONSULTATION');
ALTER TABLE "service_requests" ALTER COLUMN "request_type" TYPE "RequestType_new" USING ("request_type"::text::"RequestType_new");
ALTER TYPE "RequestType" RENAME TO "RequestType_old";
ALTER TYPE "RequestType_new" RENAME TO "RequestType";
DROP TYPE "public"."RequestType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ai_estimations" DROP CONSTRAINT "ai_estimations_service_request_id_fkey";

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "actual_severity" "Severity",
ADD COLUMN     "ai_confidence" DECIMAL(5,2),
ADD COLUMN     "ai_needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ai_request_id" VARCHAR(255),
ADD COLUMN     "ai_severity" "Severity",
ADD COLUMN     "title" VARCHAR(120) NOT NULL;

-- DropTable
DROP TABLE "ai_estimations";
