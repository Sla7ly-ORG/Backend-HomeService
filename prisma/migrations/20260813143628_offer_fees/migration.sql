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

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('CONSULTATION', 'FULL_FIX');

-- AlterTable
--
-- `accepted_at` becomes `submitted_at` - same meaning, the moment the
-- technician answered - so it is carried over rather than dropped. Three
-- statements and not one: a single ALTER TABLE cannot read the column it is
-- dropping, and that timestamp is the only record of when the answer landed.
ALTER TABLE "technician_offers" ADD COLUMN     "offer_type" "OfferType",
ADD COLUMN     "price" DECIMAL(10,2),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6);

UPDATE "technician_offers" SET "submitted_at" = "accepted_at" WHERE "accepted_at" IS NOT NULL;

ALTER TABLE "technician_offers" DROP COLUMN "accepted_at";

-- The two are written together or not at all: a price with no type is a number
-- nobody can label, and a type with no price is an offer with no offer in it.
-- Rows carried over from `ACCEPTED` have neither - they predate fees entirely -
-- and the constraint holds for them too.
ALTER TABLE "technician_offers" ADD CONSTRAINT "technician_offers_price_needs_type"
  CHECK (("offer_type" IS NULL) = ("price" IS NULL));

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "agreed_offer_type" "OfferType";
