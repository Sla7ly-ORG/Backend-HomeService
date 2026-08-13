/*
  Replaces the 1:1 `ai_estimations` table with the columns the AI service
  actually returns, on `service_requests` itself.

  Warning:
  - `ai_estimations` is dropped. Anything it held is gone; its severity is the
    only column with a home here, and `min_price` / `max_price` always belonged
    to `category_pricing` rather than to the model, which does not price.
*/

-- DropForeignKey
ALTER TABLE "ai_estimations" DROP CONSTRAINT "ai_estimations_service_request_id_fkey";

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "actual_severity" "Severity",
ADD COLUMN     "ai_confidence" DECIMAL(5,2),
ADD COLUMN     "ai_needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ai_request_id" VARCHAR(255),
ADD COLUMN     "ai_severity" "Severity";

-- DropTable
DROP TABLE "ai_estimations";
