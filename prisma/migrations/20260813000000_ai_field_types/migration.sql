-- Corrects the three AI column types added by
-- 20260810164716_task7_ai_on_service_request, so they can hold what the
-- service actually returns. No columns are added or dropped here.

-- `request_id` is a uuid on their side (uuid4, one per prediction). Storing it
-- as one validates the format, halves the bytes, and makes the join to their
-- prediction log exact rather than string-compared. USING is required: Postgres
-- will not infer text -> uuid.
ALTER TABLE "service_requests"
    ALTER COLUMN "ai_request_id" TYPE UUID USING "ai_request_id"::uuid;

-- The service reports confidence on a 0..1 scale with four decimals (0.3789).
-- DECIMAL(5,2) rounded that to 0.38 - and the threshold it flags for review on
-- sits inside the range being rounded away.
ALTER TABLE "service_requests"
    ALTER COLUMN "ai_confidence" TYPE DECIMAL(5,4);

-- Nullable, and no default. `false` cannot distinguish "the model was
-- confident" from "no model was ever asked", which is every CONSULTATION row.
ALTER TABLE "service_requests"
    ALTER COLUMN "ai_needs_review" DROP DEFAULT,
    ALTER COLUMN "ai_needs_review" DROP NOT NULL;

UPDATE "service_requests"
SET "ai_needs_review" = NULL
WHERE "request_type" <> 'AI_ESTIMATION';

-- The review queue: "predictions the model flagged that nobody has judged yet".
-- Both columns are null on every consultation row and Postgres does not index
-- nulls in a btree, so this stays small.
CREATE INDEX "service_requests_ai_needs_review_actual_severity_idx"
    ON "service_requests"("ai_needs_review", "actual_severity");
