-- AlterEnum
--
-- `ACCEPTED` is renamed to `SUBMITTED`, it is not removed: it is the state a
-- technician's answered offer has been in since task 7, and there are rows in
-- it. A plain `"status"::text::"OfferStatus_new"` cast stops the deploy with
-- `invalid input value for enum OfferStatus_new: "ACCEPTED"` the moment one
-- exists, so the rename happens inside the USING clause where the old value is
-- still readable.
BEGIN;
CREATE TYPE "OfferStatus_new" AS ENUM ('PENDING', 'SUBMITTED', 'DECLINED', 'SELECTED', 'NOT_SELECTED');
ALTER TABLE "public"."technician_offers" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "technician_offers" ALTER COLUMN "status" TYPE "OfferStatus_new" USING (
  CASE "status"::text
    WHEN 'ACCEPTED' THEN 'SUBMITTED'
    ELSE "status"::text
  END::"OfferStatus_new"
);
ALTER TYPE "OfferStatus" RENAME TO "OfferStatus_old";
ALTER TYPE "OfferStatus_new" RENAME TO "OfferStatus";
DROP TYPE "public"."OfferStatus_old";
ALTER TABLE "technician_offers" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
--
-- `accepted_at` becomes `submitted_at` - same meaning, the moment the
-- technician answered - so it is carried over rather than dropped. Three
-- statements and not one: a single ALTER TABLE cannot read the column it is
-- dropping, and that timestamp is the only record of when the answer landed.
ALTER TABLE "technician_offers" ADD COLUMN     "consultation_fee" DECIMAL(10,2),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6);

UPDATE "technician_offers" SET "submitted_at" = "accepted_at" WHERE "accepted_at" IS NOT NULL;

ALTER TABLE "technician_offers" DROP COLUMN "accepted_at";
